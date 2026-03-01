"""CoachOS — Google Calendar sync tasks"""
from celery import shared_task
import logging

logger = logging.getLogger(__name__)


@shared_task(name="tasks.calendar.sync_to_google_calendar")
def sync_to_google_calendar(activity_id: str, action: str):
    """
    Sync an activity to Google Calendar.
    action: "create" | "update" | "delete"
    Uses django-allauth SocialToken for the coach's Google OAuth2 tokens.
    """
    from apps.activities.models import Activity
    try:
        activity = Activity.objects.select_related("coach", "client").get(id=activity_id)
        coach    = activity.coach
        if not coach:
            return

        # Get stored Google OAuth2 tokens via django-allauth
        from allauth.socialaccount.models import SocialToken, SocialApp
        try:
            token = SocialToken.objects.get(
                account__user=coach,
                account__provider="google",
            )
        except SocialToken.DoesNotExist:
            logger.info(f"No Google token for coach {coach.id} — skipping cal sync")
            return

        # Build Google Calendar API service
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        creds = Credentials(
            token=token.token,
            refresh_token=token.token_secret,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=token.app.client_id,
            client_secret=token.app.secret,
        )
        service = build("calendar", "v3", credentials=creds)

        if action == "create":
            event = {
                "summary":     activity.title,
                "description": activity.notes,
                "start":       {"dateTime": activity.start_at.isoformat()},
                "end":         {"dateTime": activity.end_at.isoformat()},
            }
            result = service.events().insert(calendarId="primary", body=event).execute()
            activity.google_cal_uid = result["id"]
            activity.save(update_fields=["google_cal_uid"])
            logger.info(f"Created Google Cal event {result['id']} for activity {activity_id}")

        elif action == "update" and activity.google_cal_uid:
            event = {
                "summary":     activity.title,
                "start":       {"dateTime": activity.start_at.isoformat()},
                "end":         {"dateTime": activity.end_at.isoformat()},
            }
            service.events().update(
                calendarId="primary", eventId=activity.google_cal_uid, body=event
            ).execute()

        elif action == "delete" and activity.google_cal_uid:
            service.events().delete(
                calendarId="primary", eventId=activity.google_cal_uid
            ).execute()

    except Exception as e:
        logger.error(f"sync_to_google_calendar failed ({action} {activity_id}): {e}")
