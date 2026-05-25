"""CoachOS — Celery Beat task: dispatch email + SMS reminders for upcoming activities.

Runs every 15 minutes. Uses DB flags (reminder_24h_sent / reminder_1h_sent) as the
authoritative deduplication guard, with Redis cache as a secondary within-window lock.
"""
from celery import shared_task
from django.core.cache import cache
from django.utils import timezone
from datetime import timedelta
import logging

logger = logging.getLogger(__name__)

# (hours_before, label, db_flag_field)
REMINDER_WINDOWS = [
    (24, "24h", "reminder_24h_sent"),
    (1,  "1h",  "reminder_1h_sent"),
]


@shared_task(name="tasks.reminders.dispatch_activity_reminders")
def dispatch_activity_reminders():
    """Scan for activities whose start_at falls in a reminder window and fire tasks."""
    from apps.activities.models import Activity
    from tasks.email import send_activity_reminder_email
    from tasks.sms import send_session_reminder

    now = timezone.now()
    dispatched = 0

    for hours_before, label, db_flag in REMINDER_WINDOWS:
        window_start = now + timedelta(hours=hours_before) - timedelta(minutes=10)
        window_end   = now + timedelta(hours=hours_before) + timedelta(minutes=10)

        # Exclude activities where the DB flag is already set (primary guard)
        activities = (
            Activity.objects
            .filter(
                status="scheduled",
                start_at__gte=window_start,
                start_at__lte=window_end,
                **{db_flag: False},
            )
            .select_related("client")
        )

        for activity in activities:
            activity_id = str(activity.id)

            # Email reminder
            email_key = f"reminder_email_{label}_{activity_id}"
            if activity.client.email and not cache.get(email_key):
                send_activity_reminder_email.delay(activity_id, hours_before)
                # Mark the DB flag immediately so a Redis flush can't cause a double-send
                Activity.objects.filter(pk=activity.pk).update(
                    **{db_flag: True},
                    **{db_flag.replace("_sent", "_sent_at"): now},
                )
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

    logger.info(f"dispatch_activity_reminders: {dispatched} tasks queued")
    return dispatched
