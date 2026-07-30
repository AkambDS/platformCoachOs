"""CoachOS — Google Calendar sync + RSVP push-notification tasks"""
from celery import shared_task
import logging

logger = logging.getLogger(__name__)


def _build_service(coach):
    """Build an authorized Calendar API client for a coach, or None if not connected."""
    from allauth.socialaccount.models import SocialToken
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    try:
        token = SocialToken.objects.get(account__user=coach, account__provider="google")
    except SocialToken.DoesNotExist:
        return None

    creds = Credentials(
        token=token.token,
        refresh_token=token.token_secret,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=token.app.client_id,
        client_secret=token.app.secret,
    )
    return build("calendar", "v3", credentials=creds)


@shared_task(name="tasks.calendar.sync_to_google_calendar")
def sync_to_google_calendar(activity_id: str, action: str):
    """
    Sync an activity to Google Calendar, with the client as a real attendee so their
    accept/decline is tracked by Google and can be picked up via push notification.
    action: "create" | "update" | "delete"
    """
    from apps.activities.models import Activity
    try:
        activity = Activity.objects.select_related("coach", "client").get(id=activity_id)
        coach    = activity.coach
        if not coach:
            return

        service = _build_service(coach)
        if not service:
            logger.info(f"No Google token for coach {coach.id} — skipping cal sync")
            return

        attendees = [{"email": activity.client.email}] if activity.client.email else []

        if action == "create":
            event = {
                "summary":     activity.title,
                "description": activity.notes,
                "start":       {"dateTime": activity.start_at.isoformat()},
                "end":         {"dateTime": activity.end_at.isoformat()},
                "attendees":   attendees,
            }
            result = service.events().insert(
                calendarId="primary", body=event, sendUpdates="all"
            ).execute()
            activity.google_cal_uid = result["id"]
            activity.save(update_fields=["google_cal_uid"])
            logger.info(f"Created Google Cal event {result['id']} for activity {activity_id}")

        elif action == "update" and activity.google_cal_uid:
            event = {
                "summary":     activity.title,
                "start":       {"dateTime": activity.start_at.isoformat()},
                "end":         {"dateTime": activity.end_at.isoformat()},
                "attendees":   attendees,
            }
            service.events().update(
                calendarId="primary", eventId=activity.google_cal_uid, body=event,
                sendUpdates="all",
            ).execute()

        elif action == "delete" and activity.google_cal_uid:
            service.events().delete(
                calendarId="primary", eventId=activity.google_cal_uid, sendUpdates="all",
            ).execute()

        ensure_watch_channel.delay(str(coach.id))

    except Exception as e:
        logger.error(f"sync_to_google_calendar failed ({action} {activity_id}): {e}")


@shared_task(name="tasks.calendar.ensure_watch_channel")
def ensure_watch_channel(coach_id: str):
    """
    Create (or renew, if expiring within 24h) a Google Calendar push-notification
    channel for this coach's primary calendar, so attendee RSVP changes reach our webhook.
    """
    import uuid as uuid_lib
    from datetime import timedelta
    from django.conf import settings
    from django.utils import timezone
    from apps.accounts.models import User
    from apps.activities.models import GoogleCalendarWatch

    try:
        coach = User.objects.get(id=coach_id)
    except User.DoesNotExist:
        return

    watch = GoogleCalendarWatch.objects.filter(coach=coach).first()
    if watch and watch.expiration and watch.expiration > timezone.now() + timedelta(hours=24):
        return  # still fresh, nothing to do

    service = _build_service(coach)
    if not service:
        return

    backend_url = getattr(settings, "BACKEND_URL", "").rstrip("/")
    webhook_url = f"{backend_url}/api/webhooks/google-calendar/"
    channel_id  = str(uuid_lib.uuid4())
    token       = getattr(settings, "GOOGLE_CALENDAR_WEBHOOK_TOKEN", "")

    try:
        result = service.events().watch(
            calendarId="primary",
            body={
                "id":      channel_id,
                "type":    "web_hook",
                "address": webhook_url,
                "token":   token,
            },
        ).execute()
    except Exception as e:
        logger.error(f"ensure_watch_channel failed for coach {coach_id}: {e}")
        return

    from datetime import datetime, timezone as dt_timezone
    expiration_ms = result.get("expiration")
    expiration = (
        datetime.fromtimestamp(int(expiration_ms) / 1000, tz=dt_timezone.utc)
        if expiration_ms else None
    )

    GoogleCalendarWatch.objects.update_or_create(
        coach=coach,
        defaults={
            "channel_id":  channel_id,
            "resource_id": result.get("resourceId", ""),
            "expiration":  expiration,
        },
    )
    logger.info(f"Calendar watch channel established for coach {coach_id}, expires {expiration}")


@shared_task(name="tasks.calendar.renew_expiring_watch_channels")
def renew_expiring_watch_channels():
    """Beat task — renew any channel expiring within 24h. Google channels expire (~1 week max)."""
    from datetime import timedelta
    from django.utils import timezone
    from apps.activities.models import GoogleCalendarWatch

    soon = timezone.now() + timedelta(hours=24)
    coach_ids = list(
        GoogleCalendarWatch.objects.filter(expiration__lte=soon).values_list("coach_id", flat=True)
    )
    for coach_id in coach_ids:
        ensure_watch_channel.delay(str(coach_id))
    return len(coach_ids)


@shared_task(name="tasks.calendar.process_calendar_notification")
def process_calendar_notification(channel_id: str, resource_state: str):
    """
    Handle a Google Calendar push-notification ping. The ping carries no payload —
    pull the actual delta via events.list(syncToken=...) and reconcile attendee RSVPs.
    """
    from apps.activities.models import Activity, GoogleCalendarWatch

    if resource_state == "sync":
        return  # the initial handshake notification when a channel is first created — no-op

    try:
        watch = GoogleCalendarWatch.objects.select_related("coach").get(channel_id=channel_id)
    except GoogleCalendarWatch.DoesNotExist:
        logger.warning(f"Calendar notification for unknown channel {channel_id}")
        return

    coach   = watch.coach
    service = _build_service(coach)
    if not service:
        return

    try:
        _reconcile_events(service, watch)
    except Exception as e:
        # 410 Gone means the sync token expired — drop it and do a full resync next call
        if "410" in str(e):
            watch.sync_token = ""
            watch.save(update_fields=["sync_token"])
            logger.info(f"Sync token expired for coach {coach.id}, will full-resync next run")
        else:
            logger.error(f"process_calendar_notification failed for coach {coach.id}: {e}")


def _reconcile_events(service, watch):
    from django.utils import timezone
    from apps.activities.models import Activity

    kwargs = {"calendarId": "primary", "singleEvents": True}
    if watch.sync_token:
        kwargs["syncToken"] = watch.sync_token
    else:
        # First run for this channel — bound the initial sync to avoid pulling full history
        kwargs["timeMin"] = timezone.now().isoformat()

    page_token = None
    events = []
    while True:
        if page_token:
            kwargs["pageToken"] = page_token
        result = service.events().list(**kwargs).execute()
        events.extend(result.get("items", []))
        page_token = result.get("nextPageToken")
        if not page_token:
            new_sync_token = result.get("nextSyncToken", watch.sync_token)
            break

    for event in events:
        google_event_id = event.get("id")
        if not google_event_id:
            continue
        activity = Activity.objects.select_related("client", "coach", "workspace").filter(
            google_cal_uid=google_event_id
        ).first()
        if not activity:
            continue
        _apply_rsvp(activity, event)

    watch.sync_token = new_sync_token or watch.sync_token
    watch.save(update_fields=["sync_token"])


def _apply_rsvp(activity, event):
    from django.utils import timezone

    client_email = (activity.client.email or "").lower()
    if not client_email:
        return

    response_status = None
    for attendee in event.get("attendees", []):
        if (attendee.get("email") or "").lower() == client_email:
            response_status = attendee.get("responseStatus")
            break

    if not response_status or response_status == activity.client_rsvp_status:
        return  # no attendee entry, or unchanged since last sync

    activity.client_rsvp_status = response_status
    activity.client_rsvp_synced_at = timezone.now()
    update_fields = ["client_rsvp_status", "client_rsvp_synced_at"]

    if response_status == Activity.RsvpStatus.ACCEPTED and not activity.client_confirmed:
        activity.client_confirmed = True
        activity.client_confirmed_at = timezone.now()
        update_fields += ["client_confirmed", "client_confirmed_at"]

    activity.save(update_fields=update_fields)

    from tasks.email import send_client_rsvp_notice
    send_client_rsvp_notice.delay(str(activity.id), response_status)
    logger.info(f"Activity {activity.id} RSVP updated to {response_status}")
