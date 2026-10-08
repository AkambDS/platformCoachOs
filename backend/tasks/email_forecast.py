"""CoachOS — what the scheduled jobs are going to email, and when (Email Communication →
Scheduled). Computed live from the same data and rules the senders use, rather than
stored as a queue, so it can never drift from reality when a session is moved, a
pipeline stage's schedule is edited or a deal changes stage:

  * session reminders     — tasks.reminders.dispatch_activity_reminders (24h + 1h, plus
                            the coach's copy)
  * subscription invoices — tasks.invoicing.dispatch_subscription_invoices (07:00 UTC)
  * pipeline follow-ups   — tasks.pipeline.dispatch_pipeline_alerts, via the shared
                            next_pipeline_send() (owner / coach / client schedules)

Goal/note-shared, confirmations, etc. are sent the moment something happens, so they
only ever appear under Sent.

preview() renders an upcoming email by running the real send function inside
tasks.email_log.capture_emails() and a rolled-back transaction — nothing is sent,
logged or saved.
"""
from datetime import datetime, time, timedelta, timezone as dt_tz

from django.utils import timezone

from tasks.email_log import type_info


def _item(*, key, use_case, at, recipient_name, recipient_email, client, reason, related_id,
          preview, now, overdue_grace=timedelta(minutes=30), audience=None):
    label, default_audience = type_info(use_case)
    return {
        "id": key,
        "use_case": use_case,
        "label": label,
        "audience": audience or default_audience,
        "recipient_name": recipient_name,
        "recipient_email": recipient_email,
        "client_id": str(client.id) if client else None,
        "client_name": client.full_name if client else "",
        "scheduled_for": at.isoformat(),
        "reason": reason,
        "related_id": str(related_id),
        "preview": preview,
        # Past its send time and still unsent → a job run was missed.
        "status": "overdue" if at < now - overdue_grace else "scheduled",
    }


def scheduled_items(workspace, days: int = 30) -> list:
    from apps.activities.models import Activity
    from apps.invoicing.models import Invoice
    from apps.pipeline.models import Deal, PipelineStageConfig
    from tasks.pipeline import next_pipeline_send, recipient_settings
    from tasks.email import _owner_info, _fmt_dt_human

    now = timezone.now()
    horizon = now + timedelta(days=days)
    items = []

    # ── Session reminders (24h and 1h, each with the coach's copy) ────────────
    for act in (Activity.objects
                .filter(workspace=workspace, status="scheduled", start_at__gt=now,
                        start_at__lte=horizon + timedelta(hours=24))
                .select_related("client", "coach")):
        client = act.client
        when = _fmt_dt_human(act.start_at, getattr(workspace, "workspace_timezone", ""))
        for hours, flag in ((24, "reminder_24h_sent"), (1, "reminder_1h_sent")):
            if getattr(act, flag):
                continue
            at = act.start_at - timedelta(hours=hours)
            if at > horizon:
                continue
            use_case = f"reminder_{hours}h"
            reason = f"“{act.title}” on {when}"
            preview = {"kind": "reminder", "activity": str(act.id), "hours": hours}
            if client and client.email:
                items.append(_item(key=f"rem-{hours}-{act.id}", use_case=use_case, at=at,
                                   recipient_name=client.full_name, recipient_email=client.email,
                                   client=client, reason=reason, related_id=act.id,
                                   preview={**preview, "to": "client"}, now=now))
                if act.coach and act.coach.email:
                    items.append(_item(key=f"rem-{hours}-{act.id}-coach", use_case="coach_session_reminder",
                                       at=at, recipient_name=act.coach.full_name,
                                       recipient_email=act.coach.email, client=client,
                                       reason=reason, related_id=act.id,
                                       preview={**preview, "to": "coach"}, now=now))

    # ── Subscription invoices (sent by the 07:00 UTC job) ────────────────────
    for inv in (Invoice.objects
                .filter(workspace=workspace, invoice_type=Invoice.InvoiceType.SUBSCRIPTION,
                        subscription_auto_send=True, next_invoice_date__isnull=False,
                        next_invoice_date__lte=horizon.date())
                .exclude(status=Invoice.Status.VOID)
                .select_related("client")):
        at = datetime.combine(inv.next_invoice_date, time(7), tzinfo=dt_tz.utc)
        items.append(_item(key=f"inv-{inv.id}", use_case="invoice", at=at,
                           recipient_name=inv.client.full_name, recipient_email=inv.client.email or "",
                           client=inv.client, reason=f"Recurring invoice (series from #{inv.number})",
                           related_id=inv.id, preview={"kind": "invoice", "invoice": str(inv.id)},
                           now=now, overdue_grace=timedelta(hours=2)))

    # ── Pipeline follow-ups (owner / assigned coach / client) ────────────────
    stages = {c.slug: c for c in PipelineStageConfig.objects.filter(workspace=workspace)}
    owner_email, owner_name = _owner_info(workspace)
    for deal in (Deal.objects.filter(workspace=workspace)
                 .exclude(stage__in=["closed_lost", "active_client"])
                 .select_related("client", "coach", "workspace")):
        cfg = stages.get(deal.stage)
        if not cfg or not cfg.follow_up_days:
            continue
        last = {"owner": deal.pipeline_alert_sent_at, "coach": deal.coach_alert_sent_at,
                "client": deal.client_alert_sent_at}
        who = {
            "owner":  (owner_name or "You", owner_email, "pipeline"),
            "coach":  ((deal.coach.full_name if deal.coach else ""), (deal.coach.email if deal.coach else ""), "pipeline"),
            "client": (deal.client.full_name, deal.client.email or "", "pipeline_client"),
        }
        for key, enabled, freq, opts in recipient_settings(cfg):
            name, email, use_case = who[key]
            if not enabled or not email:
                continue
            if key == "coach" and email == owner_email:
                continue          # dispatcher skips the coach copy when the coach is the owner
            if key == "client" and cfg.client_alert_max_count is not None \
                    and deal.client_alert_count >= cfg.client_alert_max_count:
                continue
            at = next_pipeline_send(deal, cfg, freq, opts, last[key], now, days)
            if not at:
                continue
            items.append(_item(
                key=f"pipe-{deal.id}-{key}", use_case=use_case, at=at,
                recipient_name=name, recipient_email=email, client=deal.client,
                reason=f"“{cfg.label}” stage · {_schedule_text(freq, opts)}",
                related_id=deal.id, now=now, overdue_grace=timedelta(hours=2),
                audience="coach" if key != "client" else "client",
                preview={"kind": "pipeline", "deal": str(deal.id), "to": key},
            ))

    items.sort(key=lambda x: x["scheduled_for"])
    return items


_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _schedule_text(freq: str, opts: dict) -> str:
    opts = opts or {}
    if freq == "weekly":
        return f"every {_WEEKDAYS[int(opts.get('weekday', 0))]}"
    if freq == "monthly":
        if opts.get("month_mode") == "nth":
            week = int(opts.get("month_week", 1))
            nth = {1: "first", 2: "second", 3: "third", 4: "fourth", -1: "last"}.get(week, "first")
            return f"{nth} {_WEEKDAYS[int(opts.get('month_weekday', 0))]} of the month"
        day = int(opts.get("month_day", 1))
        suffix = "th" if 11 <= day <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
        return f"{day}{suffix} of each month"
    return "daily"


def preview(workspace, params: dict) -> dict:
    """Render one upcoming email by running its real send function in capture mode
    inside a rolled-back transaction. → {subject, to, html} or {} if it can't render."""
    from django.db import transaction
    from tasks.email_log import capture_emails

    kind = params.get("kind")
    to = params.get("to", "client")

    class _Rollback(Exception):
        pass

    captured = []
    try:
        with transaction.atomic(), capture_emails() as captured:
            if kind == "reminder":
                from apps.activities.models import Activity
                Activity.objects.get(pk=params["activity"], workspace=workspace)
                from tasks.email import send_activity_reminder_email
                send_activity_reminder_email(params["activity"], int(params.get("hours", 24)))
            elif kind == "invoice":
                from apps.invoicing.models import Invoice
                Invoice.objects.get(pk=params["invoice"], workspace=workspace)
                from tasks.email import send_invoice_email
                send_invoice_email(params["invoice"])
            elif kind == "pipeline":
                from apps.pipeline.models import Deal
                Deal.objects.get(pk=params["deal"], workspace=workspace)
                from tasks.email import send_pipeline_alert, send_pipeline_client_checkin
                if to == "client":
                    send_pipeline_client_checkin(params["deal"])
                else:
                    send_pipeline_alert(params["deal"], recipient=to)
            raise _Rollback
    except _Rollback:
        pass
    except Exception:
        return {}
    if not captured:
        return {}
    # Reminders send the client's email first, then the coach's copy.
    msg = captured[-1] if (kind == "reminder" and to == "coach" and len(captured) > 1) else captured[0]
    return {"subject": msg["subject"], "to": msg["to"], "html": msg["html"]}
