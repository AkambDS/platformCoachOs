"""
Management command: dispatch_reminders

Sends email (and SMS if configured) reminders for upcoming activities.
Uses DB flags (reminder_24h_sent, reminder_1h_sent) to prevent double-firing.

Usage:
    python manage.py dispatch_reminders

Schedule on Render as a Cron Job running every 15 minutes:
    schedule: "*/15 * * * *"
    command:  python manage.py dispatch_reminders
"""
from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
import logging

logger = logging.getLogger(__name__)

WINDOWS = [
    (24, "reminder_24h_sent", "24 hours"),
    (1,  "reminder_1h_sent",  "1 hour"),
]


class Command(BaseCommand):
    help = "Dispatch email/SMS reminders for activities starting in ~24h or ~1h"

    def handle(self, *args, **options):
        from apps.activities.models import Activity
        from tasks.email import send_activity_reminder_email
        from tasks.sms import send_session_reminder

        now = timezone.now()
        total = 0

        for hours_before, flag_field, label in WINDOWS:
            window_start = now + timedelta(hours=hours_before) - timedelta(minutes=10)
            window_end   = now + timedelta(hours=hours_before) + timedelta(minutes=10)

            activities = Activity.objects.filter(
                status="scheduled",
                start_at__gte=window_start,
                start_at__lte=window_end,
                **{flag_field: False},          # not yet sent
            ).select_related("client", "coach", "workspace")

            for activity in activities:
                try:
                    # Email reminder
                    if activity.client.email:
                        send_activity_reminder_email(str(activity.id), hours_before)
                        self.stdout.write(f"  ✓ Email reminder ({label}) → {activity.client.email}")
                        total += 1

                    # SMS reminder (if phone on file and Twilio configured)
                    if activity.client.phone:
                        send_session_reminder(str(activity.id))
                        self.stdout.write(f"  ✓ SMS reminder ({label}) → {activity.client.phone}")
                        total += 1

                    # Mark as sent so this cron run doesn't fire again
                    sent_at_field = flag_field.replace("_sent", "_sent_at")
                    Activity.objects.filter(pk=activity.pk).update(
                        **{flag_field: True, sent_at_field: now}
                    )

                except Exception as e:
                    logger.error(f"Reminder failed for activity {activity.id}: {e}")
                    self.stderr.write(f"  ✗ Failed for {activity.id}: {e}")

        self.stdout.write(self.style.SUCCESS(f"dispatch_reminders: {total} reminders sent"))
