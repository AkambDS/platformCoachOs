"""CoachOS — pipeline follow-up alert automation."""
import logging
from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)

# Follow-ups go out at this local hour in each workspace's own timezone (8 AM Eastern
# for America/New_York, both EST and EDT). Beat runs dispatch_pipeline_alerts hourly;
# each run only handles workspaces where it's currently this hour.
SEND_HOUR = 8


def _scheduled_today(frequency: str, opts: dict, today) -> bool:
    """Is `today` a send day for this recipient? Daily: every day. Once a week: on the
    chosen weekday. Once a month: on the chosen date (clamped to the month's last day,
    so "31st" means the last day in shorter months) or the chosen Nth/last weekday."""
    import calendar
    opts = opts or {}
    if frequency == "weekly":
        return today.weekday() == int(opts.get("weekday", 0))
    if frequency == "monthly":
        last_day = calendar.monthrange(today.year, today.month)[1]
        if opts.get("month_mode") == "nth":
            if today.weekday() != int(opts.get("month_weekday", 0)):
                return False
            week = int(opts.get("month_week", 1))
            if week == -1:
                return today.day + 7 > last_day           # no later same weekday this month
            return (today.day - 1) // 7 + 1 == week
        return today.day == min(int(opts.get("month_day", 1)), last_day)
    return True


def _is_due(last_sent_at, frequency: str, opts: dict, today, tz) -> bool:
    """A send day for this recipient, and not already sent to them today."""
    if not _scheduled_today(frequency, opts, today):
        return False
    return not last_sent_at or last_sent_at.astimezone(tz).date() != today


def _workspace_tz(workspace):
    from zoneinfo import ZoneInfo
    try:
        return ZoneInfo(getattr(workspace, "workspace_timezone", "") or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def _in_alert_window(deal, cfg, at, day) -> bool:
    """Is the deal overdue at `at` (a datetime) and still inside its alert window on
    `day` (local date)? Shared by the dispatcher and the Scheduled forecast."""
    if not cfg.follow_up_days:
        return False
    days_in_stage = (at - deal.stage_changed_at).days
    if days_in_stage < cfg.follow_up_days:
        return False
    if deal.alert_stop_date:
        return day <= deal.alert_stop_date
    return cfg.alert_stop_after_days is None or days_in_stage <= cfg.alert_stop_after_days


def recipient_settings(cfg):
    """[(key, enabled, frequency, schedule-options)] for owner / coach / client."""
    sched = cfg.alert_schedule or {}
    return [
        ("owner",  cfg.notify_owner,  cfg.owner_frequency,  sched.get("owner")),
        ("coach",  cfg.notify_coach,  cfg.coach_frequency,  sched.get("coach")),
        ("client", cfg.notify_client, cfg.client_frequency, sched.get("client")),
    ]


def next_pipeline_send(deal, cfg, frequency, opts, last_sent_at, now, horizon_days=30):
    """The next local 8 AM a follow-up to this recipient will go out, within
    `horizon_days`, or None — same rules as dispatch_pipeline_alerts."""
    from datetime import datetime, time, timedelta
    tz = _workspace_tz(deal.workspace)
    local_now = now.astimezone(tz)
    day = local_now.date()
    sent_today = last_sent_at and last_sent_at.astimezone(tz).date() == day
    if sent_today or local_now.hour > SEND_HOUR:
        day += timedelta(days=1)
    for _ in range(horizon_days + 1):
        at = datetime.combine(day, time(SEND_HOUR), tzinfo=tz)
        if _in_alert_window(deal, cfg, at, day) and _scheduled_today(frequency, opts, day):
            return at
        day += timedelta(days=1)
    return None


@shared_task(name="tasks.pipeline.dispatch_pipeline_alerts")
def dispatch_pipeline_alerts(respect_send_hour: bool = True):
    """Daily: for every active deal that's overdue in its current stage, email each
    recipient the stage is set to notify (Settings > Pipeline) — you (the workspace
    owner), the deal's assigned coach, and/or the client — each on its own schedule
    (daily / a chosen weekday / a chosen day of the month, see _scheduled_today),
    once the deal has been in the stage follow_up_days, and stopping once the deal
    has been in the stage alert_stop_after_days (or a per-deal Deal.alert_stop_date),
    or as soon as it moves stage. Runs hourly; a workspace is only processed during its
    local SEND_HOUR (respect_send_hour=False — the manual trigger — sends right away).
    Returns the number of emails sent."""
    from apps.pipeline.models import Deal, PipelineStageConfig
    from .email import send_pipeline_alert, send_pipeline_client_checkin, _owner_info

    now = timezone.now()

    active_deals = Deal.objects.exclude(
        stage__in=["closed_lost", "active_client"]
    ).select_related("workspace", "client", "coach")

    sent = 0
    for deal in active_deals:
        # "Today" in the workspace's own timezone, so "every Monday" / "the 15th" match the
        # coach's calendar rather than UTC's.
        tz = _workspace_tz(deal.workspace)
        local_now = now.astimezone(tz)
        if respect_send_hour and local_now.hour != SEND_HOUR:
            continue
        today = local_now.date()

        try:
            cfg = PipelineStageConfig.objects.get(workspace=deal.workspace, slug=deal.stage)
        except PipelineStageConfig.DoesNotExist:
            continue
        if not _in_alert_window(deal, cfg, now, today):
            continue

        updates = {}
        sched = cfg.alert_schedule or {}
        try:
            owner_email, _ = _owner_info(deal.workspace)
            if cfg.notify_owner and _is_due(deal.pipeline_alert_sent_at, cfg.owner_frequency, sched.get("owner"), today, tz):
                if send_pipeline_alert(str(deal.id), recipient="owner"):
                    updates["pipeline_alert_sent_at"] = now
                    sent += 1

            coach = deal.coach
            # Skip when the assigned coach IS the owner — they'd get the same email twice.
            if (cfg.notify_coach and coach and coach.email and coach.email != owner_email
                    and _is_due(deal.coach_alert_sent_at, cfg.coach_frequency, sched.get("coach"), today, tz)):
                if send_pipeline_alert(str(deal.id), recipient="coach"):
                    updates["coach_alert_sent_at"] = now
                    sent += 1

            # client_alert_max_count: an optional cap kept from the older settings.
            if (cfg.notify_client and deal.client.email
                    and (cfg.client_alert_max_count is None or deal.client_alert_count < cfg.client_alert_max_count)
                    and _is_due(deal.client_alert_sent_at, cfg.client_frequency, sched.get("client"), today, tz)):
                if send_pipeline_client_checkin(str(deal.id)):
                    updates["client_alert_sent_at"] = now
                    updates["client_alert_count"] = deal.client_alert_count + 1
                    sent += 1
        except Exception as e:
            logger.error(f"Pipeline alert failed for deal {deal.id}: {e}")
        if updates:
            Deal.objects.filter(pk=deal.pk).update(**updates)

    logger.info(f"dispatch_pipeline_alerts: sent {sent} email(s)")
    return sent
