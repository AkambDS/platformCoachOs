"""CoachOS — SMS tasks (MockSmsProvider in dev, Twilio in prod)"""
from celery import shared_task
from django.conf import settings
import logging

logger = logging.getLogger(__name__)


def get_sms_provider():
    if settings.SMS_BACKEND == "twilio":
        from twilio.rest import Client
        return Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    return None   # mock mode


@shared_task(name="tasks.sms.send_session_reminder")
def send_session_reminder(activity_id: str):
    from apps.activities.models import Activity
    try:
        activity = Activity.objects.select_related("client", "workspace").get(id=activity_id)
        client   = activity.client
        if not client.phone:
            return

        message = (f"Reminder: You have a {activity.activity_type} with "
                   f"{activity.coach.full_name} on "
                   f"{activity.start_at.strftime('%A %b %d at %I:%M %p')}.")

        provider = get_sms_provider()
        if provider:
            provider.messages.create(
                body=message,
                from_=settings.TWILIO_FROM_NUMBER,
                to=client.phone,
            )
            logger.info(f"SMS sent to {client.phone} for activity {activity_id}")
        else:
            logger.info(f"[MOCK SMS] To: {client.phone} | Msg: {message}")
    except Exception as e:
        logger.error(f"send_session_reminder failed: {e}")
