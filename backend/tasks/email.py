"""CoachOS — email tasks using Django mail (Gmail SMTP)."""
import logging
import re
from celery import shared_task
from django.core.mail import EmailMultiAlternatives, EmailMessage
from django.conf import settings
from datetime import timezone as dt_timezone

logger = logging.getLogger(__name__)


def _logo_src(workspace) -> str:
    """Return a public HTTPS URL for the workspace logo, or empty string if none.
    Falls back to empty (not localhost) so broken URLs never appear in emails."""
    if not getattr(workspace, "logo_data", ""):
        return ""
    backend_base = getattr(settings, "BACKEND_URL", "").rstrip("/")
    if not backend_base:
        allowed = getattr(settings, "ALLOWED_HOSTS", [])
        host = next((h for h in allowed if "onrender.com" in h and not h.startswith(".")), None)
        backend_base = f"https://{host}" if host else ""
    if not backend_base:
        return ""  # No valid public URL — show workspace name text fallback instead
    return f"{backend_base}/api/settings/logo/{workspace.id}/"


def _logo_url(workspace) -> str:
    return _logo_src(workspace)


def _owner_info(workspace) -> tuple:
    """Return (owner_email, owner_name) for the business owner of the workspace."""
    try:
        from apps.accounts.models import User
        owner = workspace.users.filter(role=User.Role.BUSINESS_OWNER).first()
        if owner:
            return owner.email, owner.full_name
    except Exception:
        pass
    return "", ""


# ── ICS builder ────────────────────────────────────────────────────────────────

def _ics_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _build_ics(activity, method: str = "REQUEST", cancelled: bool = False) -> bytes:
    from datetime import timedelta
    from django.utils import timezone as dj_tz

    def fmt_dt(dt):
        return dt.astimezone(dt_timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    _from = settings.DEFAULT_FROM_EMAIL
    m = re.search(r'<(.+?)>', _from)
    coach_email  = m.group(1) if m else _from
    coach_name   = activity.coach.full_name if activity.coach else activity.workspace.name
    client_email = activity.client.email
    client_name  = activity.client.full_name
    end_at       = activity.end_at or (activity.start_at + timedelta(hours=1))
    now_str      = fmt_dt(dj_tz.now())
    summary      = _ics_escape(activity.title + (" (Cancelled)" if cancelled else ""))
    desc         = _ics_escape(f"{activity.activity_type.capitalize()} with {coach_name}")

    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CoachOS//CoachOS//EN",
        f"METHOD:{method}", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
        f"UID:{activity.id}@coachos.app", f"DTSTAMP:{now_str}",
        f"DTSTART:{fmt_dt(activity.start_at)}", f"DTEND:{fmt_dt(end_at)}",
        f"SUMMARY:{summary}", f"DESCRIPTION:{desc}",
    ]
    if activity.location:
        lines.append(f"LOCATION:{_ics_escape(activity.location)}")
    lines += [
        f"ORGANIZER;CN=\"{coach_name}\":mailto:{coach_email}",
        f"ATTENDEE;CN=\"{client_name}\";RSVP=TRUE;ROLE=REQ-PARTICIPANT:mailto:{client_email}",
        f"STATUS:{'CANCELLED' if cancelled else 'CONFIRMED'}",
        f"SEQUENCE:{'1' if cancelled else '0'}",
        "END:VEVENT", "END:VCALENDAR",
    ]
    return "\r\n".join(lines).encode("utf-8")


def _fmt_dt_human(dt) -> str:
    return dt.strftime("%A, %B %d at %I:%M %p").replace(" 0", " ")


def _build_google_cal_url(activity) -> str:
    """Build a Google Calendar 'add event' URL for the activity."""
    from urllib.parse import urlencode
    from datetime import timedelta

    def gcal_fmt(dt):
        from datetime import timezone as dt_timezone
        return dt.astimezone(dt_timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    end_at = activity.end_at or (activity.start_at + timedelta(hours=1))
    coach_name = activity.coach.full_name if activity.coach else activity.workspace.name
    params = {
        "action": "TEMPLATE",
        "text": activity.title,
        "dates": f"{gcal_fmt(activity.start_at)}/{gcal_fmt(end_at)}",
        "details": f"{activity.activity_type.capitalize()} with {coach_name}",
    }
    if activity.location:
        params["location"] = activity.location
    return "https://www.google.com/calendar/render?" + urlencode(params)


# ── Email tasks ────────────────────────────────────────────────────────────────

@shared_task(name="tasks.email.send_invite_email")
def send_invite_email(invitation_id: str):
    from apps.accounts.models import WorkspaceInvitation
    from tasks.email_html import build_invite_email
    try:
        invite = WorkspaceInvitation.objects.select_related("workspace", "invited_by").get(id=invitation_id)
        frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:5173")
        accept_url   = f"{frontend_url}/accept-invite?token={invite.token}"
        workspace    = invite.workspace

        plain = (
            f"Hi,\n\n{invite.invited_by.full_name} has invited you to join "
            f"{workspace.name} as {invite.get_role_display()}.\n\n"
            f"Accept here: {accept_url}\n\nThis link expires in 48 hours."
        )
        owner_email, owner_name = _owner_info(workspace)
        html = build_invite_email(
            invited_by_name=invite.invited_by.full_name,
            workspace_name=workspace.name,
            role_display=invite.get_role_display(),
            accept_url=accept_url,
            logo_url=_logo_src(workspace),
            invited_email=invite.email,
            owner_email=owner_email,
        )
        msg = EmailMultiAlternatives(
            subject=f"You're invited to join {workspace.name} on CoachOS",
            body=plain,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[invite.email],
        )
        msg.attach_alternative(html, "text/html")
        msg.send()
        logger.info(f"Invite email sent to {invite.email}")
    except Exception as e:
        logger.error(f"send_invite_email failed: {e}")
        raise


@shared_task(name="tasks.email.send_activity_confirmation_email")
def send_activity_confirmation_email(activity_id: str):
    from apps.activities.models import Activity
    from tasks.email_html import build_confirmation_email
    try:
        activity = Activity.objects.select_related("client", "coach", "workspace").get(id=activity_id)
        client = activity.client
        if not client.email:
            logger.warning(f"No email for client on activity {activity_id}")
            return

        dt         = _fmt_dt_human(activity.start_at)
        coach_name = activity.coach.full_name if activity.coach else activity.workspace.name
        coach_email = activity.coach.email if activity.coach else ""
        workspace  = activity.workspace
        owner_email, owner_name = _owner_info(workspace)
        location_line = f"\nLocation: {activity.location}" if activity.location else ""

        plain = (
            f"Hi {client.first_name},\n\nYour {activity.activity_type} has been scheduled.\n\n"
            f"  What:   {activity.title}\n  When:   {dt}{location_line}\n  Coach:  {coach_name}\n\n"
            f"A calendar invite (.ics) is attached — open it to add this session to your calendar.\n\n"
            f"You will also receive a reminder 24 hours and 1 hour before your session.\n\n"
            f"If you need to reschedule, please contact {coach_name} directly.\n\n— {workspace.name}"
        )
        html = build_confirmation_email(
            activity=activity,
            workspace_name=workspace.name,
            logo_url=_logo_src(workspace),
            coach_name=coach_name,
            coach_email=coach_email,
            dt_human=dt,
            owner_email=owner_email,
            owner_name=owner_name,
            google_cal_url=_build_google_cal_url(activity),
        )
        ics_bytes = _build_ics(activity, method="REQUEST")

        msg = EmailMultiAlternatives(
            subject=f"Confirmed: {activity.title} with {coach_name}",
            body=plain,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[client.email],
        )
        msg.attach_alternative(html, "text/html")
        # Attach ICS as a file — triggers "Add to Calendar" in most clients
        msg.attach("invite.ics", ics_bytes, "text/calendar; method=REQUEST")
        msg.send()

        from django.utils import timezone
        Activity.objects.filter(pk=activity_id).update(confirmation_sent_at=timezone.now())
        logger.info(f"Confirmation email sent to {client.email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_activity_confirmation_email failed: {e}")


@shared_task(name="tasks.email.send_activity_reminder_email")
def send_activity_reminder_email(activity_id: str, hours_before: int = 24):
    from apps.activities.models import Activity
    from tasks.email_html import build_reminder_email
    try:
        activity = Activity.objects.select_related("client", "coach", "workspace").get(id=activity_id)
        client = activity.client
        if not client.email or activity.status != "scheduled":
            return

        dt         = _fmt_dt_human(activity.start_at)
        coach_name  = activity.coach.full_name if activity.coach else activity.workspace.name
        coach_email = activity.coach.email if activity.coach else ""
        workspace   = activity.workspace
        owner_email, owner_name = _owner_info(workspace)
        time_label  = "24 hours" if hours_before == 24 else f"{hours_before} hour{'s' if hours_before != 1 else ''}"
        location_line = f"\nLocation: {activity.location}" if activity.location else ""

        plain = (
            f"Hi {client.first_name},\n\nThis is a reminder that you have a "
            f"{activity.activity_type} in {time_label}.\n\n"
            f"  What:   {activity.title}\n  When:   {dt}{location_line}\n  Coach:  {coach_name}\n\n"
            f"If you need to reschedule, please contact {coach_name} as soon as possible.\n\n— {workspace.name}"
        )
        html = build_reminder_email(
            activity=activity,
            workspace_name=workspace.name,
            logo_url=_logo_src(workspace),
            coach_name=coach_name,
            coach_email=coach_email,
            dt_human=dt,
            time_label=time_label,
            owner_email=owner_email,
            owner_name=owner_name,
        )
        msg = EmailMultiAlternatives(
            subject=f"Reminder: {activity.title} in {time_label}",
            body=plain,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[client.email],
        )
        msg.attach_alternative(html, "text/html")
        msg.send()
        logger.info(f"Reminder email ({hours_before}h) sent to {client.email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_activity_reminder_email failed: {e}")


@shared_task(name="tasks.email.send_activity_reschedule_email")
def send_activity_reschedule_email(activity_id: str):
    from apps.activities.models import Activity
    from tasks.email_html import build_reschedule_email
    try:
        activity = Activity.objects.select_related("client", "coach", "workspace").get(id=activity_id)
        client = activity.client
        if not client.email:
            return

        dt          = _fmt_dt_human(activity.start_at)
        coach_name  = activity.coach.full_name if activity.coach else activity.workspace.name
        coach_email = activity.coach.email if activity.coach else ""
        workspace   = activity.workspace
        owner_email, owner_name = _owner_info(workspace)
        location_line = f"\nLocation: {activity.location}" if activity.location else ""

        plain = (
            f"Hi {client.first_name},\n\nYour session has been updated.\n\n"
            f"  What:   {activity.title}\n  When:   {dt}{location_line}\n  Coach:  {coach_name}\n\n"
            f"A new calendar invite is attached. Open it to update your calendar.\n\n— {workspace.name}"
        )
        html = build_reschedule_email(
            activity=activity,
            workspace_name=workspace.name,
            logo_url=_logo_src(workspace),
            coach_name=coach_name,
            coach_email=coach_email,
            dt_human=dt,
            owner_email=owner_email,
            owner_name=owner_name,
            google_cal_url=_build_google_cal_url(activity),
        )
        ics_bytes = _build_ics(activity, method="REQUEST")

        msg = EmailMultiAlternatives(
            subject=f"Updated: {activity.title} with {coach_name}",
            body=plain,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[client.email],
        )
        msg.attach_alternative(html, "text/html")
        msg.attach("invite.ics", ics_bytes, "text/calendar; method=REQUEST")
        msg.send()
        logger.info(f"Reschedule email sent to {client.email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_activity_reschedule_email failed: {e}")


@shared_task(name="tasks.email.send_activity_cancellation_email")
def send_activity_cancellation_email(activity_id: str):
    from apps.activities.models import Activity
    from tasks.email_html import build_cancellation_email
    try:
        activity = Activity.objects.select_related("client", "coach", "workspace").get(id=activity_id)
        client = activity.client
        if not client.email:
            return

        dt          = _fmt_dt_human(activity.start_at)
        coach_name  = activity.coach.full_name if activity.coach else activity.workspace.name
        coach_email = activity.coach.email if activity.coach else ""
        workspace   = activity.workspace
        owner_email, owner_name = _owner_info(workspace)
        ics_bytes   = _build_ics(activity, method="CANCEL", cancelled=True)

        plain = (
            f"Hi {client.first_name},\n\nYour upcoming {activity.activity_type} has been cancelled.\n\n"
            f"  What:   {activity.title}\n  Was:    {dt}\n  Coach:  {coach_name}\n\n"
            f"Please contact {coach_name} to reschedule.\n\n— {workspace.name}"
        )
        html = build_cancellation_email(
            activity=activity,
            workspace_name=workspace.name,
            logo_url=_logo_src(workspace),
            coach_name=coach_name,
            coach_email=coach_email,
            dt_human=dt,
            owner_email=owner_email,
            owner_name=owner_name,
        )
        msg = EmailMultiAlternatives(
            subject=f"Cancelled: {activity.title} on {activity.start_at.strftime('%b %d').replace(' 0', ' ')}",
            body=plain,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[client.email],
        )
        msg.attach_alternative(html, "text/html")
        msg.attach("cancel.ics", ics_bytes, "text/calendar")
        msg.send()

        from django.utils import timezone
        Activity.objects.filter(pk=activity_id).update(cancellation_sent_at=timezone.now())
        logger.info(f"Cancellation email sent to {client.email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_activity_cancellation_email failed: {e}")


@shared_task(name="tasks.email.send_invoice_email")
def send_invoice_email(invoice_id: str):
    from apps.invoicing.models import Invoice
    from tasks.email_html import build_invoice_email
    try:
        invoice   = Invoice.objects.select_related("client", "coach", "workspace").get(id=invoice_id)
        workspace = invoice.workspace
        owner_email, owner_name = _owner_info(workspace)
        due_str   = invoice.due_date.strftime("%B %d, %Y") if invoice.due_date else ""

        plain = (
            f"Hi {invoice.client.first_name},\n\n"
            f"Please find attached invoice #{invoice.number} for ${invoice.total}.\n\n"
            f"{'Due: ' + due_str + chr(10) + chr(10) if due_str else ''}"
            f"{'Pay online: ' + invoice.stripe_payment_link + chr(10) + chr(10) if invoice.stripe_payment_link else ''}"
            f"— {workspace.name}"
        )
        html = build_invoice_email(
            invoice=invoice,
            workspace_name=workspace.name,
            logo_url=_logo_src(workspace),
            due_str=due_str,
            owner_email=owner_email,
            owner_name=owner_name,
        )
        msg = EmailMultiAlternatives(
            subject=f"Invoice #{invoice.number} from {workspace.name}",
            body=plain,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[invoice.client.email],
        )
        msg.attach_alternative(html, "text/html")
        msg.send()
        logger.info(f"Invoice email sent for {invoice.number}")
    except Exception as e:
        logger.error(f"send_invoice_email failed: {e}")


@shared_task(name="tasks.email.send_payment_failed_email")
def send_payment_failed_email(invoice_id: str):
    from apps.invoicing.models import Invoice
    try:
        invoice = Invoice.objects.select_related("client", "coach").get(id=invoice_id)
        msg = EmailMessage(
            subject=f"Payment failed — Invoice #{invoice.number}",
            body=(
                f"Payment failed for invoice #{invoice.number} (${invoice.total}) "
                f"for {invoice.client.full_name}."
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[invoice.coach.email],
        )
        msg.send()
    except Exception as e:
        logger.error(f"send_payment_failed_email failed: {e}")


def send_pipeline_alert(deal_id: str):
    """Send a styled HTML pipeline follow-up alert to the business owner (and optionally the client)."""
    from apps.pipeline.models import Deal, PipelineStageConfig
    from django.utils import timezone as dj_tz
    from django.core.mail import EmailMultiAlternatives
    from tasks.email_html import build_pipeline_alert_email
    try:
        deal      = Deal.objects.select_related("workspace", "client", "coach").get(id=deal_id)
        workspace = deal.workspace
        client    = deal.client
        owner_email, owner_name = _owner_info(workspace)
        if not owner_email:
            return

        try:
            cfg = PipelineStageConfig.objects.get(workspace=workspace, slug=deal.stage)
        except PipelineStageConfig.DoesNotExist:
            return

        stage_label   = cfg.label
        stage_color   = cfg.color or "#1a2f4e"
        days_in_stage = (dj_tz.now() - deal.stage_changed_at).days
        client_name   = f"{client.first_name} {client.last_name}".strip()
        deal_value    = f"${deal.deal_value:,.0f}" if deal.deal_value else "—"
        stage_entered = deal.stage_changed_at.strftime("%B %d, %Y")
        logo_url      = _logo_src(workspace)
        pipeline_url  = f"{getattr(settings, 'FRONTEND_URL', '').rstrip('/')}/pipeline"

        subject = f"Follow-up needed: {client_name} — {stage_label} ({days_in_stage} days)"

        plain_body = (
            f"Hi {owner_name},\n\n"
            f"{client_name}'s deal has been in '{stage_label}' for {days_in_stage} days "
            f"(threshold: {cfg.follow_up_days} days).\n\n"
            f"Deal value: {deal_value}\n"
            f"Stage entered: {stage_entered}\n\n"
            f"View your pipeline: {pipeline_url}\n\n"
            f"— {workspace.name}"
        )

        html_body = build_pipeline_alert_email(
            workspace_name=workspace.name,
            logo_url=logo_url,
            owner_name=owner_name,
            owner_email=owner_email,
            client_name=client_name,
            stage_label=stage_label,
            stage_color=stage_color,
            days_in_stage=days_in_stage,
            follow_up_days=cfg.follow_up_days,
            deal_value=deal_value,
            stage_entered=stage_entered,
            pipeline_url=pipeline_url,
        )

        recipients = [owner_email]
        if cfg.notify_client and client.email:
            recipients.append(client.email)

        msg = EmailMultiAlternatives(
            subject=subject,
            body=plain_body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=recipients,
        )
        msg.attach_alternative(html_body, "text/html")
        msg.send()
        logger.info(f"Pipeline alert sent for deal {deal_id} ({stage_label})")
    except Exception as e:
        logger.error(f"send_pipeline_alert failed for deal {deal_id}: {e}")
