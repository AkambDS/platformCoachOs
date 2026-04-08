"""CoachOS — Celery email tasks"""
from celery import shared_task
from django.core.mail import send_mail, EmailMessage
from django.conf import settings
from datetime import timezone as dt_timezone
import uuid
import logging

logger = logging.getLogger(__name__)

FRONTEND_URL = getattr(settings, "FRONTEND_URL", "http://localhost:5173")


def _ics_escape(text: str) -> str:
    """Escape special characters per RFC 5545."""
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _build_ics(activity, method: str = "REQUEST", cancelled: bool = False) -> bytes:
    """
    Build a valid iCalendar (.ics) payload per RFC 5545.
    - method="REQUEST"  → new/updated invite  (Add to Calendar)
    - method="CANCEL"   → cancellation        (Remove from Calendar)
    """
    from datetime import timedelta
    from django.utils import timezone as dj_tz

    def fmt_dt(dt):
        utc = dt.astimezone(dt_timezone.utc)
        return utc.strftime("%Y%m%dT%H%M%SZ")

    # ORGANIZER must match the FROM address (DEFAULT_FROM_EMAIL) for Gmail to
    # auto-process the invite. Using the coach's DB email causes a mismatch.
    import re
    _from = settings.DEFAULT_FROM_EMAIL
    _from_match = re.search(r'<(.+?)>', _from)
    coach_email  = _from_match.group(1) if _from_match else _from
    coach_name   = activity.coach.full_name if activity.coach  else activity.workspace.name
    client_email = activity.client.email
    client_name  = activity.client.full_name

    # Default duration: 1 hour if no end_at set
    end_at = activity.end_at or (activity.start_at + timedelta(hours=1))

    uid     = f"{activity.id}@coachos.app"
    now_str = fmt_dt(dj_tz.now())
    summary = _ics_escape(activity.title + (" (Cancelled)" if cancelled else ""))
    desc    = _ics_escape(f"{activity.activity_type.capitalize()} with {coach_name}")

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//CoachOS//CoachOS//EN",
        f"METHOD:{method}",
        "CALSCALE:GREGORIAN",
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{now_str}",          # required by RFC 5545
        f"DTSTART:{fmt_dt(activity.start_at)}",
        f"DTEND:{fmt_dt(end_at)}",
        f"SUMMARY:{summary}",
        f"DESCRIPTION:{desc}",
    ]
    if activity.location:
        lines.append(f"LOCATION:{_ics_escape(activity.location)}")
    lines += [
        f"ORGANIZER;CN=\"{coach_name}\":mailto:{coach_email}",
        f"ATTENDEE;CN=\"{client_name}\";RSVP=TRUE;ROLE=REQ-PARTICIPANT:mailto:{client_email}",
        f"STATUS:{'CANCELLED' if cancelled else 'CONFIRMED'}",
        f"SEQUENCE:{'1' if cancelled else '0'}",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    return "\r\n".join(lines).encode("utf-8")


@shared_task(name="tasks.email.send_invite_email")
def send_invite_email(invitation_id: str):
    from apps.accounts.models import WorkspaceInvitation
    try:
        invite = WorkspaceInvitation.objects.select_related("workspace","invited_by").get(id=invitation_id)
        from django.conf import settings as django_settings
        frontend_url = getattr(django_settings, "FRONTEND_URL", "http://localhost:5173")
        accept_url = f"{frontend_url}/accept-invite?token={invite.token}"
        send_mail(
            subject=f"You're invited to join {invite.workspace.name} on CoachOS",
            message=f"Hi,\n\n{invite.invited_by.full_name} has invited you to join "
                    f"{invite.workspace.name} as {invite.get_role_display()}.\n\n"
                    f"Accept here: {accept_url}\n\nThis link expires in 48 hours.",
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[invite.email],
        )
        logger.info(f"Invite email sent to {invite.email}")
    except Exception as e:
        logger.error(f"send_invite_email failed: {e}")


@shared_task(name="tasks.email.send_invoice_email")
def send_invoice_email(invoice_id: str):
    """Generate PDF and email invoice to client."""
    from apps.invoicing.models import Invoice
    try:
        invoice = Invoice.objects.select_related("client", "coach", "workspace").get(id=invoice_id)
        # TODO: WeasyPrint PDF generation + attach to email
        send_mail(
            subject=f"Invoice #{invoice.number} from {invoice.workspace.name}",
            message=f"Hi {invoice.client.first_name},\n\n"
                    f"Please find attached invoice #{invoice.number} for ${invoice.total}.\n\n"
                    f"Due: {invoice.due_date}\n\n"
                    f"{'Pay online: ' + invoice.stripe_payment_link if invoice.stripe_payment_link else ''}",
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[invoice.client.email],
        )
        logger.info(f"Invoice email sent for {invoice.number}")
    except Exception as e:
        logger.error(f"send_invoice_email failed: {e}")


def _fmt_dt_human(dt) -> str:
    """Format datetime for email body — cross-platform safe."""
    return dt.strftime("%A, %B %d at %I:%M %p").replace(" 0", " ")


@shared_task(name="tasks.email.send_activity_confirmation_email")
def send_activity_confirmation_email(activity_id: str):
    """Email the client confirming a newly scheduled activity, with a .ics calendar invite."""
    from apps.activities.models import Activity
    try:
        activity = Activity.objects.select_related("client", "coach", "workspace").get(id=activity_id)
        client = activity.client
        if not client.email:
            logger.warning(f"send_activity_confirmation_email: no email for client on activity {activity_id}")
            return

        dt = _fmt_dt_human(activity.start_at)
        coach_name = activity.coach.full_name if activity.coach else activity.workspace.name
        location_line = f"\nLocation: {activity.location}" if activity.location else ""

        body = (
            f"Hi {client.first_name},\n\n"
            f"Your {activity.activity_type} has been scheduled.\n\n"
            f"  What:   {activity.title}\n"
            f"  When:   {dt}{location_line}\n"
            f"  Coach:  {coach_name}\n\n"
            f"A calendar invite is attached — open it to add this session to your calendar.\n\n"
            f"You will also receive a reminder 24 hours and 1 hour before your session.\n\n"
            f"If you need to reschedule, please contact {coach_name} directly.\n\n"
            f"— {activity.workspace.name}"
        )

        ics_bytes = _build_ics(activity, method="REQUEST")

        # Primary message: plain text body
        msg = EmailMessage(
            subject=f"Confirmed: {activity.title} with {coach_name}",
            body=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[client.email],
        )
        # Attach ics as file (opens Google Calendar on click/download)
        msg.attach(
            filename="invite.ics",
            content=ics_bytes,
            mimetype="text/calendar; method=REQUEST; charset=utf-8",
        )
        # Also embed ics as inline body part — triggers Gmail's native
        # "Add to Calendar" button without needing to download
        from email.mime.text import MIMEText
        cal_part = MIMEText(ics_bytes.decode("utf-8"), "calendar", "utf-8")
        cal_part["Content-Disposition"] = "inline"
        cal_part.set_param("method", "REQUEST")
        msg.attach(cal_part)
        msg.send()
        from django.utils import timezone
        Activity.objects.filter(pk=activity_id).update(confirmation_sent_at=timezone.now())
        logger.info(f"Confirmation email (+.ics) sent to {client.email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_activity_confirmation_email failed: {e}")


@shared_task(name="tasks.email.send_activity_reminder_email")
def send_activity_reminder_email(activity_id: str, hours_before: int = 24):
    """Email the client a reminder before their session."""
    from apps.activities.models import Activity
    try:
        activity = Activity.objects.select_related("client", "coach", "workspace").get(id=activity_id)
        client = activity.client
        if not client.email:
            return
        if activity.status != "scheduled":
            return  # don't remind for cancelled/missed activities

        dt = _fmt_dt_human(activity.start_at)
        coach_name = activity.coach.full_name if activity.coach else activity.workspace.name
        location_line = f"\nLocation: {activity.location}" if activity.location else ""
        time_label = "24 hours" if hours_before == 24 else f"{hours_before} hour{'s' if hours_before != 1 else ''}"

        send_mail(
            subject=f"Reminder: {activity.title} in {time_label}",
            message=(
                f"Hi {client.first_name},\n\n"
                f"This is a reminder that you have a {activity.activity_type} in {time_label}.\n\n"
                f"  What:   {activity.title}\n"
                f"  When:   {dt}{location_line}\n"
                f"  Coach:  {coach_name}\n\n"
                f"If you need to reschedule, please contact {coach_name} as soon as possible.\n\n"
                f"— {activity.workspace.name}"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[client.email],
        )
        logger.info(f"Reminder email ({hours_before}h) sent to {client.email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_activity_reminder_email failed: {e}")


@shared_task(name="tasks.email.send_activity_cancellation_email")
def send_activity_cancellation_email(activity_id: str):
    """Email the client when a scheduled activity is cancelled, with a METHOD:CANCEL .ics."""
    from apps.activities.models import Activity
    try:
        activity = Activity.objects.select_related("client", "coach", "workspace").get(id=activity_id)
        client = activity.client
        if not client.email:
            return

        dt = _fmt_dt_human(activity.start_at)
        coach_name = activity.coach.full_name if activity.coach else activity.workspace.name

        body = (
            f"Hi {client.first_name},\n\n"
            f"Your upcoming {activity.activity_type} has been cancelled.\n\n"
            f"  What:   {activity.title}\n"
            f"  Was:    {dt}\n"
            f"  Coach:  {coach_name}\n\n"
            f"The calendar invite has been cancelled — open the attachment to remove it from your calendar.\n\n"
            f"Please contact {coach_name} to reschedule.\n\n"
            f"— {activity.workspace.name}"
        )

        msg = EmailMessage(
            subject=f"Cancelled: {activity.title} on {activity.start_at.strftime('%b %d').replace(' 0', ' ')}",
            body=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[client.email],
        )
        msg.attach(
            filename="cancel.ics",
            content=_build_ics(activity, method="CANCEL", cancelled=True),
            mimetype="text/calendar; method=CANCEL; charset=utf-8",
        )
        msg.send()
        from django.utils import timezone
        Activity.objects.filter(pk=activity_id).update(cancellation_sent_at=timezone.now())
        logger.info(f"Cancellation email (+.ics) sent to {client.email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_activity_cancellation_email failed: {e}")


@shared_task(name="tasks.email.send_payment_failed_email")
def send_payment_failed_email(invoice_id: str):
    from apps.invoicing.models import Invoice
    try:
        invoice = Invoice.objects.select_related("client", "coach").get(id=invoice_id)
        # Notify coach
        send_mail(
            subject=f"Payment failed — Invoice #{invoice.number}",
            message=f"Payment failed for invoice #{invoice.number} (${invoice.total}) "
                    f"for {invoice.client.full_name}.",
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[invoice.coach.email],
        )
    except Exception as e:
        logger.error(f"send_payment_failed_email failed: {e}")
