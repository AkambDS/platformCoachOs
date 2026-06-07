"""CoachOS — email tasks using Django mail (Gmail SMTP)."""
import logging
import re
from celery import shared_task
from django.core.mail import EmailMultiAlternatives, EmailMessage
from django.conf import settings
from datetime import timezone as dt_timezone

logger = logging.getLogger(__name__)


def _logo_src(workspace) -> str:
    """Return a public HTTPS URL for the workspace logo, or empty string if none."""
    if not getattr(workspace, "logo_data", ""):
        return ""
    backend_base = getattr(settings, "BACKEND_URL", "").rstrip("/")
    if not backend_base:
        return ""
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


def _apply_tmpl(text: str, **vars) -> str:
    """Substitute {variable} placeholders in a template string. Returns text unchanged on error."""
    try:
        return text.format(**vars) if text else ""
    except (KeyError, ValueError):
        return text


def _workspace_from_email(workspace) -> str:
    """Build a 'Display Name <addr>' from email using the workspace name as the display name."""
    default = settings.DEFAULT_FROM_EMAIL
    m = re.search(r'<(.+?)>', default)
    addr = m.group(1) if m else default
    name = workspace.name.replace('"', "'") if workspace.name else ""
    return f"{name} <{addr}>" if name else default


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


def _fmt_dt_human(dt, tz_name: str = "") -> str:
    """Format a datetime in the given IANA timezone (e.g. 'America/New_York').
    Falls back to UTC if tz_name is empty or invalid. Appends the timezone abbreviation."""
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    try:
        tz = ZoneInfo(tz_name) if tz_name else ZoneInfo("UTC")
    except (ZoneInfoNotFoundError, Exception):
        tz = ZoneInfo("UTC")
    local_dt = dt.astimezone(tz)
    return local_dt.strftime("%A, %B %d at %I:%M %p %Z").replace(" 0", " ")


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

        dt         = _fmt_dt_human(activity.start_at, getattr(workspace, "workspace_timezone", ""))
        coach_name = activity.coach.full_name if activity.coach else activity.workspace.name
        coach_email = activity.coach.email if activity.coach else ""
        workspace  = activity.workspace
        owner_email, owner_name = _owner_info(workspace)
        location_line = f"\nLocation: {activity.location}" if activity.location else ""

        tmpl_vars = dict(
            client_name=client.full_name, coach_name=coach_name,
            session_title=activity.title, session_time=dt,
            workspace_name=workspace.name,
        )
        tmpl = (workspace.email_templates or {}).get("confirmation", {})
        custom_intro   = _apply_tmpl(tmpl.get("intro", ""),   **tmpl_vars)
        custom_closing = _apply_tmpl(tmpl.get("closing", ""), **tmpl_vars)
        subject = _apply_tmpl(tmpl.get("subject", ""), **tmpl_vars) or f"Confirmed: {activity.title} with {coach_name}"

        from apps.activities.tokens import make_session_token
        backend_url = getattr(settings, "BACKEND_URL", "").rstrip("/")
        confirm_url     = f"{backend_url}/session/confirm/{make_session_token('confirm', str(activity.id))}/"
        cancel_url      = f"{backend_url}/session/cancel/{make_session_token('cancel', str(activity.id))}/"
        reschedule_url  = f"{backend_url}/session/reschedule/{make_session_token('reschedule', str(activity.id))}/"

        plain = (
            f"Hi {client.first_name},\n\nYour {activity.activity_type} has been scheduled.\n\n"
            f"  What:   {activity.title}\n  When:   {dt}{location_line}\n  Coach:  {coach_name}\n\n"
            f"A calendar invite (.ics) is attached — open it to add this session to your calendar.\n\n"
            f"Confirm attendance: {confirm_url}\n"
            f"Request reschedule: {reschedule_url}\n"
            f"Cancel session:     {cancel_url}\n\n— {workspace.name}"
        )
        saved_style      = tmpl.get("style", {})
        custom_from      = tmpl.get("from_email", "").strip()
        from_email_addr  = custom_from or settings.DEFAULT_FROM_EMAIL

        custom_html_tmpl = tmpl.get("custom_html", "").strip()
        if custom_html_tmpl:
            html = _apply_tmpl(custom_html_tmpl, **tmpl_vars)
        else:
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
                custom_intro=custom_intro,
                custom_closing=custom_closing,
                confirm_url=confirm_url,
                cancel_url=cancel_url,
                reschedule_url=reschedule_url,
                style=saved_style,
            )
        ics_bytes = _build_ics(activity, method="REQUEST")

        msg = EmailMultiAlternatives(
            subject=subject,
            body=plain,
            from_email=from_email_addr,
            to=[client.email],
        )
        msg.attach_alternative(html, "text/html")
        msg.attach("invite.ics", ics_bytes, "text/calendar; method=REQUEST")
        msg.send()

        # ── Coach copy ──────────────────────────────────────────────────────────
        if coach_email:
            frontend_url  = getattr(settings, "FRONTEND_URL", "").rstrip("/")
            coach_subject = f"Session booked: {activity.title} with {client.full_name}"
            coach_first   = activity.coach.first_name if activity.coach else coach_name
            loc_note      = f"\n  Where:  {activity.location}" if activity.location else ""
            coach_plain   = (
                f"Hi {coach_first},\n\n"
                f"A session has been scheduled with your client {client.full_name}.\n\n"
                f"  What:   {activity.title}\n"
                f"  When:   {dt}"
                f"{loc_note}\n"
                f"  Client: {client.full_name}"
                f"{f' ({client.email})' if client.email else ''}\n\n"
                f"View in CoachOS: {frontend_url}/clients/{client.id}\n\n"
                f"— {workspace.name}"
            )
            coach_msg = EmailMultiAlternatives(
                subject=coach_subject,
                body=coach_plain,
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=[coach_email],
            )
            coach_msg.attach("invite.ics", ics_bytes, "text/calendar; method=REQUEST")
            coach_msg.send()
            logger.info(f"Coach copy sent to {coach_email} for activity {activity_id}")

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

        dt         = _fmt_dt_human(activity.start_at, getattr(workspace, "workspace_timezone", ""))
        coach_name  = activity.coach.full_name if activity.coach else activity.workspace.name
        coach_email = activity.coach.email if activity.coach else ""
        workspace   = activity.workspace
        owner_email, owner_name = _owner_info(workspace)
        time_label  = "24 hours" if hours_before == 24 else f"{hours_before} hour{'s' if hours_before != 1 else ''}"
        location_line = f"\nLocation: {activity.location}" if activity.location else ""

        tmpl_key  = "reminder_24h" if hours_before == 24 else "reminder_1h"
        tmpl_vars = dict(
            client_name=client.full_name, coach_name=coach_name,
            session_title=activity.title, session_time=dt,
            workspace_name=workspace.name, time_label=time_label,
        )
        tmpl = (workspace.email_templates or {}).get(tmpl_key, {})
        custom_intro   = _apply_tmpl(tmpl.get("intro", ""),   **tmpl_vars)
        custom_closing = _apply_tmpl(tmpl.get("closing", ""), **tmpl_vars)
        subject = _apply_tmpl(tmpl.get("subject", ""), **tmpl_vars) or f"Reminder: {activity.title} in {time_label}"

        from apps.activities.tokens import make_session_token
        backend_url    = getattr(settings, "BACKEND_URL", "").rstrip("/")
        cancel_url     = f"{backend_url}/session/cancel/{make_session_token('cancel', str(activity.id))}/"
        reschedule_url = f"{backend_url}/session/reschedule/{make_session_token('reschedule', str(activity.id))}/"

        plain = (
            f"Hi {client.first_name},\n\nThis is a reminder that you have a "
            f"{activity.activity_type} in {time_label}.\n\n"
            f"  What:   {activity.title}\n  When:   {dt}{location_line}\n  Coach:  {coach_name}\n\n"
            f"Cancel session:     {cancel_url}\n"
            f"Request reschedule: {reschedule_url}\n\n— {workspace.name}"
        )
        saved_style      = tmpl.get("style", {})
        custom_from      = tmpl.get("from_email", "").strip()
        from_email_addr  = custom_from or settings.DEFAULT_FROM_EMAIL

        custom_html_tmpl = tmpl.get("custom_html", "").strip()
        if custom_html_tmpl:
            html = _apply_tmpl(custom_html_tmpl, **tmpl_vars)
        else:
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
                custom_intro=custom_intro,
                custom_closing=custom_closing,
                cancel_url=cancel_url,
                reschedule_url=reschedule_url,
                style=saved_style,
            )
        msg = EmailMultiAlternatives(
            subject=subject,
            body=plain,
            from_email=from_email_addr,
            to=[client.email],
        )
        msg.attach_alternative(html, "text/html")
        msg.send()
        logger.info(f"Reminder email ({hours_before}h) sent to {client.email} for activity {activity_id}")

        # ── Coach copy ──────────────────────────────────────────────────────────
        if coach_email:
            coach_first   = activity.coach.first_name if activity.coach else coach_name
            loc_note      = f"\n  Where:  {activity.location}" if activity.location else ""
            coach_subject = f"Reminder: {activity.title} with {client.full_name} in {time_label}"
            coach_plain   = (
                f"Hi {coach_first},\n\n"
                f"Reminder: you have a session with {client.full_name} in {time_label}.\n\n"
                f"  What:   {activity.title}\n"
                f"  When:   {dt}"
                f"{loc_note}\n"
                f"  Client: {client.full_name}"
                f"{f' ({client.email})' if client.email else ''}\n\n"
                f"— {workspace.name}"
            )
            coach_msg = EmailMultiAlternatives(
                subject=coach_subject,
                body=coach_plain,
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=[coach_email],
            )
            coach_msg.send()
            logger.info(f"Coach reminder copy sent to {coach_email} for activity {activity_id}")
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

        dt          = _fmt_dt_human(activity.start_at, getattr(workspace, "workspace_timezone", ""))
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

        # ── Coach copy ──────────────────────────────────────────────────────────
        if coach_email:
            coach_first   = activity.coach.first_name if activity.coach else coach_name
            loc_note      = f"\n  Where:  {activity.location}" if activity.location else ""
            coach_subject = f"Session updated: {activity.title} with {client.full_name}"
            coach_plain   = (
                f"Hi {coach_first},\n\n"
                f"The following session with {client.full_name} has been rescheduled "
                f"and the client has been notified.\n\n"
                f"  What:   {activity.title}\n"
                f"  When:   {dt}"
                f"{loc_note}\n"
                f"  Client: {client.full_name}"
                f"{f' ({client.email})' if client.email else ''}\n\n"
                f"— {workspace.name}"
            )
            coach_msg = EmailMultiAlternatives(
                subject=coach_subject,
                body=coach_plain,
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=[coach_email],
            )
            coach_msg.attach("invite.ics", ics_bytes, "text/calendar; method=REQUEST")
            coach_msg.send()
            logger.info(f"Coach reschedule copy sent to {coach_email} for activity {activity_id}")
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

        dt          = _fmt_dt_human(activity.start_at, getattr(workspace, "workspace_timezone", ""))
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
            from_email=_workspace_from_email(workspace),
            to=[client.email],
        )
        msg.attach_alternative(html, "text/html")
        msg.attach("cancel.ics", ics_bytes, "text/calendar")
        msg.send()

        # ── Coach copy ──────────────────────────────────────────────────────────
        notify_email = coach_email or owner_email
        notify_name  = (activity.coach.first_name if activity.coach else None) or owner_name or workspace.name
        if notify_email:
            coach_plain = (
                f"Hi {notify_name},\n\n"
                f"The following session with {client.full_name} has been cancelled "
                f"and the client has been notified.\n\n"
                f"  What:   {activity.title}\n"
                f"  Was:    {dt}\n"
                f"  Client: {client.full_name}"
                f"{f' ({client.email})' if client.email else ''}\n\n"
                f"— {workspace.name}"
            )
            coach_msg = EmailMultiAlternatives(
                subject=f"Session cancelled: {activity.title} with {client.full_name}",
                body=coach_plain,
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=[notify_email],
            )
            coach_msg.attach("cancel.ics", ics_bytes, "text/calendar")
            coach_msg.send()
            logger.info(f"Coach cancellation copy sent to {notify_email} for activity {activity_id}")

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

        tmpl_vars = dict(
            client_name=invoice.client.full_name, workspace_name=workspace.name,
            invoice_number=invoice.number, amount=str(invoice.total), due_date=due_str,
        )
        tmpl = (workspace.email_templates or {}).get("invoice", {})
        custom_intro   = _apply_tmpl(tmpl.get("intro", ""),   **tmpl_vars)
        custom_closing = _apply_tmpl(tmpl.get("closing", ""), **tmpl_vars)
        subject = _apply_tmpl(tmpl.get("subject", ""), **tmpl_vars) or f"Invoice #{invoice.number} from {workspace.name}"
        custom_from = tmpl.get("from_email", "").strip()

        plain = (
            f"Hi {invoice.client.first_name},\n\n"
            f"Please find attached invoice #{invoice.number} for ${invoice.total}.\n\n"
            f"{'Due: ' + due_str + chr(10) + chr(10) if due_str else ''}"
            f"{'Pay online: ' + invoice.stripe_payment_link + chr(10) + chr(10) if invoice.stripe_payment_link else ''}"
            f"— {workspace.name}"
        )
        custom_html_tmpl = tmpl.get("custom_html", "").strip()
        if custom_html_tmpl:
            html = _apply_tmpl(custom_html_tmpl, **tmpl_vars)
        else:
            html = build_invoice_email(
                invoice=invoice,
                workspace_name=workspace.name,
                logo_url=_logo_src(workspace),
                due_str=due_str,
                owner_email=owner_email,
                owner_name=owner_name,
                custom_intro=custom_intro,
                custom_closing=custom_closing,
                style=tmpl.get("style", {}),
            )
        from_addr = (
            f"{workspace.name} <{custom_from}>" if custom_from else _workspace_from_email(workspace)
        )
        msg = EmailMultiAlternatives(
            subject=subject,
            body=plain,
            from_email=from_addr,
            to=[invoice.client.email],
        )
        msg.attach_alternative(html, "text/html")
        try:
            from weasyprint import HTML as WeasyHTML
            pdf_bytes = WeasyHTML(string=html).write_pdf()
            msg.attach(f"{invoice.number}.pdf", pdf_bytes, "application/pdf")
        except Exception as pdf_err:
            logger.warning(f"PDF generation failed for {invoice.number}: {pdf_err}")
        msg.send()
        logger.info(f"Invoice email sent for {invoice.number}")
    except Exception as e:
        logger.error(f"send_invoice_email failed: {e}")


def send_payment_receipt_email(invoice_id: str):
    from apps.invoicing.models import Invoice
    from tasks.email_html import build_invoice_email
    try:
        invoice   = Invoice.objects.select_related("client", "coach", "workspace").get(id=invoice_id)
        workspace = invoice.workspace
        owner_email, owner_name = _owner_info(workspace)
        due_str = invoice.due_date.strftime("%B %d, %Y") if invoice.due_date else ""
        plain = (
            f"Hi {invoice.client.first_name},\n\n"
            f"Thank you — payment of ${invoice.total} for invoice #{invoice.number} has been received.\n\n"
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
            subject=f"Receipt: Invoice #{invoice.number} — Payment Received",
            body=plain,
            from_email=_workspace_from_email(workspace),
            to=[invoice.client.email],
        )
        msg.attach_alternative(html, "text/html")
        try:
            from weasyprint import HTML as WeasyHTML
            pdf_bytes = WeasyHTML(string=html).write_pdf()
            msg.attach(f"{invoice.number}-receipt.pdf", pdf_bytes, "application/pdf")
        except Exception as pdf_err:
            logger.warning(f"PDF generation failed for {invoice.number}: {pdf_err}")
        msg.send()
        logger.info(f"Receipt email sent for {invoice.number}")
    except Exception as e:
        logger.error(f"send_payment_receipt_email failed: {e}")


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


def send_feedback_submitted_email(ticket_id: str):
    """Notify the business owner that a new feedback ticket was submitted."""
    from apps.feedback.models import FeedbackTicket
    try:
        ticket    = FeedbackTicket.objects.select_related("workspace", "submitted_by").get(id=ticket_id)
        workspace = ticket.workspace
        owner_email, owner_name = _owner_info(workspace)
        if not owner_email:
            return
        frontend_url = getattr(settings, "FRONTEND_URL", "").rstrip("/")
        ticket_url   = f"{frontend_url}/feedback/{ticket.id}"

        subject = f"[CoachOS Feedback] {ticket.get_category_display()}: {ticket.title}"
        plain = (
            f"Hi {owner_name},\n\n"
            f"A new feedback ticket has been submitted.\n\n"
            f"  Title:    {ticket.title}\n"
            f"  Category: {ticket.get_category_display()}\n"
            f"  Priority: {ticket.get_priority_display()}\n"
            f"  From:     {ticket.submitted_by.full_name if ticket.submitted_by else 'Unknown'}\n"
            f"  Page:     {ticket.page_url or '—'}\n\n"
            f"Description:\n{ticket.description}\n\n"
            f"View ticket: {ticket_url}\n\n— CoachOS"
        )
        from_name = ticket.submitted_by.full_name if ticket.submitted_by else "CoachOS"
        html = f"""<!DOCTYPE html><html><body style="font-family:DM Sans,Arial,sans-serif;background:#f5f5f0;padding:32px">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;border:1px solid #e8e4df">
<h2 style="color:#1B3A6B;margin:0 0 4px">New Feedback Ticket</h2>
<p style="color:#8c8279;margin:0 0 24px;font-size:13px">Submitted by {from_name}</p>
<table style="width:100%;border-collapse:collapse;margin-bottom:20px">
  <tr><td style="padding:6px 0;color:#8c8279;font-size:13px;width:90px">Title</td><td style="padding:6px 0;font-size:13px;color:#1a1a1a;font-weight:600">{ticket.title}</td></tr>
  <tr><td style="padding:6px 0;color:#8c8279;font-size:13px">Category</td><td style="padding:6px 0;font-size:13px;color:#1a1a1a">{ticket.get_category_display()}</td></tr>
  <tr><td style="padding:6px 0;color:#8c8279;font-size:13px">Priority</td><td style="padding:6px 0;font-size:13px;color:#1a1a1a">{ticket.get_priority_display()}</td></tr>
  <tr><td style="padding:6px 0;color:#8c8279;font-size:13px">Page</td><td style="padding:6px 0;font-size:13px;color:#1a1a1a">{ticket.page_url or '—'}</td></tr>
</table>
<div style="background:#f9f7f5;border-radius:6px;padding:16px;margin-bottom:24px">
  <p style="margin:0;font-size:13px;color:#333;white-space:pre-wrap">{ticket.description}</p>
</div>
<a href="{ticket_url}" style="display:inline-block;background:#1B3A6B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px">View Ticket</a>
</div></body></html>"""

        msg = EmailMultiAlternatives(subject=subject, body=plain,
                                     from_email=settings.DEFAULT_FROM_EMAIL, to=[owner_email])
        msg.attach_alternative(html, "text/html")
        msg.send()
        logger.info(f"Feedback submitted email sent for ticket {ticket_id}")
    except Exception as e:
        logger.error(f"send_feedback_submitted_email failed: {e}")


def send_feedback_comment_email(ticket_id: str, comment_id: str):
    """Notify the ticket submitter that the admin replied."""
    from apps.feedback.models import FeedbackTicket, FeedbackComment
    try:
        ticket  = FeedbackTicket.objects.select_related("workspace", "submitted_by").get(id=ticket_id)
        comment = FeedbackComment.objects.select_related("created_by").get(id=comment_id)
        if not ticket.submitted_by or not ticket.submitted_by.email:
            return
        frontend_url = getattr(settings, "FRONTEND_URL", "").rstrip("/")
        ticket_url   = f"{frontend_url}/feedback/{ticket.id}"
        recipient    = ticket.submitted_by

        subject = f"[CoachOS] Update on your feedback: {ticket.title}"
        plain = (
            f"Hi {recipient.full_name},\n\n"
            f"The admin has replied to your feedback ticket '{ticket.title}'.\n\n"
            f"Comment:\n{comment.text}\n\n"
            f"View your ticket: {ticket_url}\n\n— CoachOS"
        )
        html = f"""<!DOCTYPE html><html><body style="font-family:DM Sans,Arial,sans-serif;background:#f5f5f0;padding:32px">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;border:1px solid #e8e4df">
<h2 style="color:#1B3A6B;margin:0 0 4px">Update on Your Feedback</h2>
<p style="color:#8c8279;margin:0 0 24px;font-size:13px">{ticket.title}</p>
<div style="background:#f9f7f5;border-radius:6px;padding:16px;margin-bottom:24px">
  <p style="margin:0;font-size:13px;color:#333;white-space:pre-wrap">{comment.text}</p>
</div>
<a href="{ticket_url}" style="display:inline-block;background:#1B3A6B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px">View Ticket</a>
</div></body></html>"""

        msg = EmailMultiAlternatives(subject=subject, body=plain,
                                     from_email=settings.DEFAULT_FROM_EMAIL, to=[recipient.email])
        msg.attach_alternative(html, "text/html")
        msg.send()
        logger.info(f"Feedback comment email sent for ticket {ticket_id}")
    except Exception as e:
        logger.error(f"send_feedback_comment_email failed: {e}")


def send_feedback_status_email(ticket_id: str):
    """Notify the ticket submitter when the admin updates the status."""
    from apps.feedback.models import FeedbackTicket
    try:
        ticket = FeedbackTicket.objects.select_related("workspace", "submitted_by").get(id=ticket_id)
        if not ticket.submitted_by or not ticket.submitted_by.email:
            return
        frontend_url = getattr(settings, "FRONTEND_URL", "").rstrip("/")
        ticket_url   = f"{frontend_url}/feedback/{ticket.id}"
        recipient    = ticket.submitted_by

        subject = f"[CoachOS] Feedback status updated: {ticket.title}"
        plain = (
            f"Hi {recipient.full_name},\n\n"
            f"The status of your feedback ticket '{ticket.title}' has been updated to "
            f"'{ticket.get_status_display()}'.\n\n"
            f"View your ticket: {ticket_url}\n\n— CoachOS"
        )
        status_colors = {
            "new": "#6b7280", "reviewing": "#d97706", "in_progress": "#2563eb",
            "resolved": "#16a34a", "closed": "#1B3A6B",
        }
        color = status_colors.get(ticket.status, "#6b7280")
        html = f"""<!DOCTYPE html><html><body style="font-family:DM Sans,Arial,sans-serif;background:#f5f5f0;padding:32px">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;border:1px solid #e8e4df">
<h2 style="color:#1B3A6B;margin:0 0 4px">Feedback Status Updated</h2>
<p style="color:#8c8279;margin:0 0 24px;font-size:13px">{ticket.title}</p>
<p style="font-size:14px;color:#333">Your ticket status is now:
  <span style="display:inline-block;margin-left:8px;padding:3px 10px;border-radius:20px;background:{color};color:#fff;font-size:12px;font-weight:600">{ticket.get_status_display()}</span>
</p>
<br>
<a href="{ticket_url}" style="display:inline-block;background:#1B3A6B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px">View Ticket</a>
</div></body></html>"""

        msg = EmailMultiAlternatives(subject=subject, body=plain,
                                     from_email=settings.DEFAULT_FROM_EMAIL, to=[recipient.email])
        msg.attach_alternative(html, "text/html")
        msg.send()
        logger.info(f"Feedback status email sent for ticket {ticket_id}")
    except Exception as e:
        logger.error(f"send_feedback_status_email failed: {e}")


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


# ── Client session action notifications ────────────────────────────────────────

@shared_task(name="tasks.email.send_client_cancellation_notice")
def send_client_cancellation_notice(activity_id: str):
    """Email the coach when a client cancels via their email link."""
    from apps.activities.models import Activity
    try:
        activity = Activity.objects.select_related("client", "coach", "workspace").get(id=activity_id)
        coach = activity.coach
        if not coach or not coach.email:
            return

        client_name = activity.client.full_name
        dt          = _fmt_dt_human(activity.start_at, getattr(workspace, "workspace_timezone", ""))
        workspace   = activity.workspace

        subject = f"Session cancelled by {client_name}"
        body    = (
            f"Hi {coach.first_name or coach.full_name},\n\n"
            f"{client_name} has cancelled their session:\n\n"
            f"  What:  {activity.title}\n"
            f"  When:  {dt}\n\n"
            f"The session has been marked as cancelled in CoachOS.\n\n"
            f"— {workspace.name}"
        )
        msg = EmailMultiAlternatives(
            subject=subject,
            body=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[coach.email],
        )
        msg.send()
        logger.info(f"Client cancellation notice sent to coach {coach.email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_client_cancellation_notice failed: {e}")


@shared_task(name="tasks.email.send_client_reschedule_request")
def send_client_reschedule_request(activity_id: str, message: str = ""):
    """Email the coach (and business owner as fallback) when a client requests a reschedule."""
    from apps.activities.models import Activity
    try:
        activity = Activity.objects.select_related("client", "coach", "workspace").get(id=activity_id)
        workspace    = activity.workspace
        client_name  = activity.client.full_name
        client_email = activity.client.email or ""
        dt           = _fmt_dt_human(activity.start_at, getattr(workspace, "workspace_timezone", ""))

        # Notify assigned coach; fall back to business owner
        coach = activity.coach
        if coach and coach.email:
            recipient_email = coach.email
            recipient_name  = coach.first_name or coach.full_name
        else:
            owner_email, owner_name = _owner_info(workspace)
            if not owner_email:
                logger.warning(f"No recipient for reschedule notice on activity {activity_id}")
                return
            recipient_email = owner_email
            recipient_name  = owner_name or workspace.name

        subject = f"Reschedule request from {client_name}"
        note    = f"\nClient's message:\n  {message}\n" if message else ""
        body    = (
            f"Hi {recipient_name},\n\n"
            f"{client_name} has requested to reschedule their session:\n\n"
            f"  What:  {activity.title}\n"
            f"  When:  {dt}\n"
            f"{note}\n"
            f"Please reply to {client_email} or update the session in CoachOS.\n\n"
            f"— {workspace.name}"
        )
        msg = EmailMultiAlternatives(
            subject=subject,
            body=body,
            from_email=_workspace_from_email(workspace),
            to=[recipient_email],
            reply_to=[client_email] if client_email else [],
        )
        msg.send()
        logger.info(f"Reschedule request sent to {recipient_email} for activity {activity_id}")

        # ── Acknowledge to client ───────────────────────────────────────────────
        if client_email:
            coach_display = (coach.full_name if coach else workspace.name)
            ack_subject   = f"Reschedule request received — {activity.title}"
            ack_body      = (
                f"Hi {activity.client.first_name or client_name},\n\n"
                f"Your reschedule request has been received and forwarded to {coach_display}.\n\n"
                f"  What:  {activity.title}\n"
                f"  When:  {dt}\n\n"
                f"They will reach out to confirm a new time. "
                f"If you need to follow up, you can reply to this email.\n\n"
                f"— {workspace.name}"
            )
            ack_msg = EmailMultiAlternatives(
                subject=ack_subject,
                body=ack_body,
                from_email=_workspace_from_email(workspace),
                to=[client_email],
                reply_to=[recipient_email],
            )
            ack_msg.send()
            logger.info(f"Reschedule acknowledgement sent to {client_email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_client_reschedule_request failed: {e}")
