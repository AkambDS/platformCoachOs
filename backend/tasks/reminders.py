"""CoachOS — Celery Beat task: dispatch email + SMS reminders for upcoming activities.

Runs every 15 minutes. Uses DB flags (reminder_24h_sent / reminder_1h_sent) as the
authoritative deduplication guard, with Redis cache as a secondary within-window lock.

Reminder timing is "due by", not "due at exactly": once a reminder's target lead time
has arrived (the session starts within `hours_before` hours) and its flag isn't set
yet, it fires on the next tick — regardless of how long it's been due, as long as the
session itself hasn't started. The previous version matched only a tight ±10-minute
band around exactly "now + hours_before", so a Celery outage spanning one or more
15-minute ticks lost that reminder permanently once the band passed. This version
just sends it a bit late instead (see tasks/email.py::send_activity_reminder_email,
which computes the email's wording from the actual remaining time, not a hardcoded
24h/1h label, precisely so a late catch-up send doesn't say "24 hours" three hours out).
"""
from celery import shared_task
from django.core.cache import cache
from django.utils import timezone
from datetime import timedelta
import logging

logger = logging.getLogger(__name__)

# (hours_before, label, db_flag_field) — most-urgent (1h) checked first. If an outage
# leaves both the 24h and 1h reminders simultaneously overdue for the same session,
# only the more relevant 1h one actually emails/texts the client; the 24h slot is just
# marked sent (not fired) rather than sending both back-to-back in the same run.
REMINDER_WINDOWS = [
    (1,  "1h",  "reminder_1h_sent"),
    (24, "24h", "reminder_24h_sent"),
]


@shared_task(name="tasks.reminders.dispatch_activity_reminders")
def dispatch_activity_reminders():
    """Scan for scheduled activities whose reminder lead time has arrived (or was
    missed) and fire tasks — see module docstring for the catch-up behavior."""
    from apps.activities.models import Activity
    from tasks.email import send_activity_reminder_email
    from tasks.sms import send_session_reminder

    now = timezone.now()
    dispatched = 0
    handled_ids: set[str] = set()  # at most one reminder slot actually fires per activity per run

    for hours_before, label, db_flag in REMINDER_WINDOWS:
        due_by = now + timedelta(hours=hours_before)

        # start_at__gt=now: never fires for a session that has already started —
        # this is what makes reminders stop on their own once the event has passed,
        # with no separate "is this event over" check needed.
        activities = (
            Activity.objects
            .filter(
                status="scheduled",
                start_at__gt=now,
                start_at__lte=due_by,
                **{db_flag: False},
            )
            .select_related("client")
        )

        for activity in activities:
            activity_id = str(activity.id)

            if activity_id in handled_ids:
                # A more urgent window already fired for this activity this run —
                # mark this slot sent too so it doesn't linger False and re-trigger
                # next tick, but don't send a second, redundant email/SMS right
                # behind the first.
                Activity.objects.filter(pk=activity.pk).update(
                    **{db_flag: True},
                    **{db_flag.replace("_sent", "_sent_at"): now},
                )
                continue

            handled_ids.add(activity_id)

            # Email reminder
            email_key = f"reminder_email_{label}_{activity_id}"
            if activity.client.email and not cache.get(email_key):
                send_activity_reminder_email.delay(activity_id, hours_before)
                cache.set(email_key, True, timeout=60 * 60 * 3)
                dispatched += 1
                logger.info(f"Queued email reminder ({label}) for activity {activity_id}")

            # SMS reminder (if phone on file)
            sms_key = f"reminder_sms_{label}_{activity_id}"
            if activity.client.phone and not cache.get(sms_key):
                send_session_reminder.delay(activity_id)
                cache.set(sms_key, True, timeout=60 * 60 * 3)
                dispatched += 1
                logger.info(f"Queued SMS reminder ({label}) for activity {activity_id}")

            # Mark the DB flag immediately so a Redis flush can't cause a double-send
            Activity.objects.filter(pk=activity.pk).update(
                **{db_flag: True},
                **{db_flag.replace("_sent", "_sent_at"): now},
            )

    logger.info(f"dispatch_activity_reminders: {dispatched} tasks queued")
    return dispatched


@shared_task(name="tasks.reminders.expire_stale_reschedule_requests")
def expire_stale_reschedule_requests():
    """Daily: auto-clear a pending client-proposed reschedule time
    (Activity.requested_start_at) that's sat unconfirmed/undeclined past the owning
    workspace's configured TTL (Workspace.reschedule_request_ttl_days, default 5,
    blank = never expire — same "leave blank to never" convention already used for
    PipelineStageConfig.alert_stop_after_days). Silent by design (calendar.md §7.2/§9.2
    Task 5) — no email to the client, same as Decline. Ages off requested_at, not
    updated_at, since the latter bumps on any unrelated edit to the activity and would
    otherwise make a genuinely stale request look fresh forever.
    """
    from apps.activities.models import Activity

    now = timezone.now()
    expired = 0
    pending = (
        Activity.objects
        .filter(requested_start_at__isnull=False, requested_at__isnull=False)
        .select_related("workspace")
    )
    for activity in pending:
        ttl_days = activity.workspace.reschedule_request_ttl_days
        if ttl_days is None:
            continue
        if now - activity.requested_at >= timedelta(days=ttl_days):
            Activity.objects.filter(pk=activity.pk).update(
                requested_start_at=None, requested_at=None,
            )
            expired += 1
            logger.info(f"Expired stale reschedule request for activity {activity.id} (TTL {ttl_days}d)")

    logger.info(f"expire_stale_reschedule_requests: {expired} cleared")
    return expired
