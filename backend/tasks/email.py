"""CoachOS — email tasks using Django mail (Gmail SMTP)."""
import logging
import re
from email.mime.application import MIMEApplication
from email.utils import formatdate, make_msgid
from django.core.mail.message import SafeMIMEMultipart, SafeMIMEText
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


def _get_invoice_template(invoice) -> dict:
    """Resolve which template dict drives this invoice's email. A per-invoice override
    (invoice.email_template_id, set from the "Email template" picker in Review-before-
    sending) takes precedence over the workspace's default "invoice" slot (Settings >
    Generic Templates) — lets a coach keep e.g. separate "Daily"/"Monthly" invoice
    templates and pick one per invoice instead of only ever having one default."""
    workspace = invoice.workspace
    if invoice.email_template_id:
        tmpl = next(
            (t for t in (workspace.generic_templates or [])
             if isinstance(t, dict) and t.get("id") == invoice.email_template_id),
            None,
        )
        if tmpl:
            return {
                "subject":       tmpl.get("subject", ""),
                "intro":         tmpl.get("intro", ""),
                "closing":       tmpl.get("closing", ""),
                "custom_html":   tmpl.get("custom_html", ""),
                "disable_style": tmpl.get("disable_style", False),
                "show_logo":     tmpl.get("show_logo", True),
                "style":         tmpl.get("style", {}),
                "attachments":   tmpl.get("attachments", []),
            }
    return (workspace.email_templates or {}).get("invoice", {})


def _get_activity_template(activity, use_case: str) -> dict:
    """Resolve which template dict drives one of this activity's emails — mirrors
    _get_invoice_template. A per-activity override (activity.email_template_id, set from
    the "Email template" picker on the schedule/edit form — whichever was chosen most
    recently) takes precedence over the workspace's default template for that use case
    (Settings > Generic Templates), e.g. use_case="confirmation" or "reschedule"."""
    workspace = activity.workspace
    if activity.email_template_id:
        tmpl = next(
            (t for t in (workspace.generic_templates or [])
             if isinstance(t, dict) and t.get("id") == activity.email_template_id),
            None,
        )
        if tmpl:
            return {
                "subject":       tmpl.get("subject", ""),
                "intro":         tmpl.get("intro", ""),
                "closing":       tmpl.get("closing", ""),
                "custom_html":   tmpl.get("custom_html", ""),
                "disable_style": tmpl.get("disable_style", False),
                "show_logo":     tmpl.get("show_logo", True),
                "style":         tmpl.get("style", {}),
            }
    return (workspace.email_templates or {}).get(use_case, {})


def _get_activity_confirmation_template(activity) -> dict:
    return _get_activity_template(activity, "confirmation")


def _get_invite_template(invitation) -> dict:
    """Resolve which template dict drives this team invite's email — mirrors
    _get_invoice_template. A per-invite override (invitation.email_template_id, set from
    the "Email template" picker on the Invite Team Member modal) takes precedence over
    the workspace's default "team_invite" slot (Settings > Generic Templates)."""
    workspace = invitation.workspace
    if invitation.email_template_id:
        tmpl = next(
            (t for t in (workspace.generic_templates or [])
             if isinstance(t, dict) and t.get("id") == invitation.email_template_id),
            None,
        )
        if tmpl:
            return {
                "subject":       tmpl.get("subject", ""),
                "intro":         tmpl.get("intro", ""),
                "closing":       tmpl.get("closing", ""),
                "custom_html":   tmpl.get("custom_html", ""),
                "disable_style": tmpl.get("disable_style", False),
                "show_logo":     tmpl.get("show_logo", True),
                "style":         tmpl.get("style", {}),
            }
    return (workspace.email_templates or {}).get("team_invite", {})


def _get_pipeline_template(workspace) -> dict:
    """Resolve the workspace's default "pipeline" template (Settings > Generic Templates).
    Pipeline alerts are dispatched automatically off the stage-tracking cron, not reviewed
    per-deal before sending, so — like reminders — there's no per-record override to check."""
    return (workspace.email_templates or {}).get("pipeline", {})


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


def _coach_has_google_calendar(coach) -> bool:
    """True if this coach has a connected Google account with a stored SocialToken.

    When true, the client's real Google Calendar invite (native Accept/Decline/Maybe,
    tracked back into CoachOS via the RSVP webhook) is the one actionable email — our own
    branded email drops its Confirm/Reschedule/Cancel buttons to avoid sending the client
    two emails with two different, conflicting response mechanisms for the same booking.
    """
    if not coach:
        return False
    from allauth.socialaccount.models import SocialToken
    return SocialToken.objects.filter(account__user=coach, account__provider="google").exists()


class _PartialFormatMap(dict):
    """Returns {key} literally for any key not in the dict, enabling partial substitution."""
    def __missing__(self, key):
        return "{" + key + "}"


def _apply_tmpl(text: str, **vars) -> str:
    """Substitute {variable} placeholders. Unknown keys are left as-is rather than failing."""
    if not text:
        return ""
    try:
        return text.format_map(_PartialFormatMap(vars))
    except (KeyError, ValueError):
        return text


class _InvoiceEmail(EmailMessage):
    """EmailMessage subclass that produces the correct MIME structure for an invoice email:

        multipart/mixed
          ├── multipart/alternative
          │   ├── text/plain
          │   └── text/html
          └── application/pdf

    Django's EmailMultiAlternatives + attach() produces the wrong structure
    (wraps plain+PDF in multipart/mixed then buries that inside multipart/alternative),
    which causes Gmail and some clients to render the HTML as a download attachment.
    """
    def __init__(self, *args, html: str = "", pdf_bytes: bytes = b"", pdf_filename: str = "invoice.pdf",
                 extra_attachments: list = None, **kwargs):
        super().__init__(*args, **kwargs)
        self._html = html
        self._pdf_bytes = pdf_bytes
        self._pdf_filename = pdf_filename
        self._extra_attachments = extra_attachments or []  # [(filename, content_bytes, mimetype), ...]

    def message(self):
        encoding = self.encoding or "utf-8"

        alt = SafeMIMEMultipart("alternative")
        alt.attach(SafeMIMEText(self.body or "", "plain", encoding))
        alt.attach(SafeMIMEText(self._html, "html", encoding))

        if self._pdf_bytes or self._extra_attachments:
            root = SafeMIMEMultipart("mixed")
            root.attach(alt)
            if self._pdf_bytes:
                pdf = MIMEApplication(self._pdf_bytes, "pdf")
                pdf.add_header("Content-Disposition", "attachment", filename=self._pdf_filename)
                pdf.add_header("Content-Type", "application/pdf", name=self._pdf_filename)
                root.attach(pdf)
            for filename, content, mime in self._extra_attachments:
                _, _, subtype = (mime or "application/octet-stream").partition("/")
                part = MIMEApplication(content, subtype or "octet-stream")
                part.add_header("Content-Disposition", "attachment", filename=filename)
                root.attach(part)
            msg = root
        else:
            msg = alt

        msg["Subject"] = self.subject
        msg["From"] = self.extra_headers.get("From", self.from_email)
        msg["To"] = self.extra_headers.get("To", ", ".join(map(str, self.to)))
        if self.cc:
            msg["Cc"] = ", ".join(map(str, self.cc))
        if self.reply_to:
            msg["Reply-To"] = ", ".join(map(str, self.reply_to))
        msg["Date"] = formatdate(localtime=False)
        msg["Message-ID"] = make_msgid()
        for name, value in self.extra_headers.items():
            if name.lower() in ("from", "to"):
                continue
            try:
                msg.replace_header(name, value)
            except KeyError:
                msg[name] = value
        return msg


_DEFAULT_INVOICE_HTML = (
    '<!DOCTYPE html>\n'
    '<html lang="en">\n'
    '<head>\n'
    '  <meta charset="utf-8">\n'
    '  <meta name="viewport" content="width=device-width,initial-scale=1">\n'
    '  <title>{workspace_name}</title>\n'
    '</head>\n'
    '<body style="margin:0;padding:0;background:#f0ede8;font-family:{body_font_css};">\n'
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">\n'
    '  <tr><td style="padding:32px 16px;">\n'
    '    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">\n'
    '\n'
    '      {header_block}\n'
    '\n'
    '      <!-- Body -->\n'
    '      <tr>\n'
    '        <td style="background:#fff;padding:40px;border-radius:{body_radius};">\n'
    '          {heading_block}\n'
    '          {body_para}\n'
    '          {pay_button}\n'
    '          {signature_block}\n'
    '        </td>\n'
    '      </tr>\n'
    '\n'
    '      {footer_block}\n'
    '\n'
    '    </table>\n'
    '  </td></tr>\n'
    '</table>\n'
    '</body>\n'
    '</html>'
)

# The plain, fully-editable email body — this is the ENTIRE middle content of the
# invoice email (below the optional heading, above the pay button), not just an
# "opening paragraph" tacked onto fixed boilerplate. A coach can freely rewrite or
# delete any part of this, including the amount/due-date line — nothing is force-added
# beyond what ends up in this string. {view_instructions} is left as a placeholder
# (rather than baked in as literal text) so it still adapts to whether a Stripe pay
# link exists, even though the surrounding sentence is otherwise plain, editable text.
_DEFAULT_INVOICE_BODY = (
    "Hi {client_name},\n"
    "\n"
    "Please find your invoice attached.\n"
    "\n"
    "You've received an invoice for ${amount} with payment due on {due_date}.\n"
    "\n"
    "{view_instructions}"
)


def _invoice_body_block(body: str) -> str:
    """Wrap the plain-text (newline-separated) invoice email body in a single styled
    <p> using white-space:pre-line — preserves the author's blank-line paragraph
    breaks without needing to split the text into separate <p> tags."""
    if not body.strip():
        return ""
    return (
        '<p style="margin:0 0 28px;font-size:15px;color:#3a3530;line-height:1.7;'
        f'white-space:pre-line;">{body}</p>'
    )


def _invoice_header_block(show_header: bool, *, header_bg: str, accent_color: str,
                           logo_img: str, workspace_name: str) -> str:
    """The invoice email's header (brand bar + accent line) — hand-rolled like
    _invoice_footer_block, for the same reason: the invoice template is its own HTML
    string rather than going through _email_shell."""
    if not show_header:
        return ""
    return (
        '<tr>\n'
        f'  <td style="background:{header_bg};padding:24px 40px;border-radius:8px 8px 0 0;">\n'
        f'    {logo_img}\n'
        f'    <span style="font-family:Georgia,serif;font-size:22px;color:#f7f4ef;">{workspace_name}</span>\n'
        '  </td>\n'
        '</tr>\n'
        f'<tr><td style="height:3px;background:{accent_color};"></td></tr>'
    )


def _invoice_heading_block(show_heading: bool, *, heading_font_css: str, workspace_name: str) -> str:
    """The "{workspace_name} sent you an invoice." heading — optional so a coach who
    writes a full custom body isn't stuck with this redundant boilerplate above it."""
    if not show_heading:
        return ""
    return (
        f'<h1 style="margin:0 0 24px;font-family:{heading_font_css};font-size:26px;'
        f'font-weight:400;color:#16130f;line-height:1.3;">\n'
        f'  {workspace_name} sent you an invoice.\n'
        f'</h1>'
    )


def _invoice_signature_block(show_signature: bool, *, workspace_name: str) -> str:
    """The "Thanks! / {workspace_name}" sign-off — optional for the same reason as
    _invoice_heading_block."""
    if not show_signature:
        return ""
    return (
        '<p style="margin:0 0 4px;font-size:15px;color:#3a3530;">Thanks!</p>\n'
        f'<p style="margin:0;font-size:15px;color:#3a3530;font-weight:600;">{workspace_name}</p>'
    )


def _invoice_footer_block(show_footer: bool, *, body_font_css: str, owner_email: str,
                           owner_name: str, accent_color: str, workspace_name: str,
                           invoice_number: str, show_contact_line: bool = True) -> str:
    """The invoice email's footer — unlike every other email type (which goes through
    _email_shell and already respects show_footer/show_contact_line), the invoice
    template is its own hand-rolled HTML string, so it needs the same conditionals
    handled separately. Values are interpolated directly here (not left as
    {placeholders}) because the caller substitutes the surrounding template in a single
    str.format() pass, which would leave any nested {placeholders} un-substituted."""
    if not show_footer:
        return ""
    contact_line = (
        f'    <p style="margin:0 0 8px;font-size:13px;color:#9e9890;font-family:{body_font_css};line-height:1.7;">\n'
        f'      Questions? Contact us at <a href="mailto:{owner_email}" style="color:{accent_color};text-decoration:none;font-weight:600;">{owner_name}</a>\n'
        f'      &mdash; <a href="mailto:{owner_email}" style="color:#b5afa6;text-decoration:none;font-size:11px;">{owner_email}</a>\n'
        '    </p>\n'
    ) if show_contact_line else ""
    return (
        '<tr>\n'
        f'  <td style="padding:28px 20px 20px;text-align:center;">\n'
        f'{contact_line}'
        f'    <p style="margin:0;font-size:11px;color:#b5afa6;font-family:{body_font_css};">\n'
        f'      Sent by {workspace_name} &middot; Invoice #{invoice_number}\n'
        '    </p>\n'
        '  </td>\n'
        '</tr>'
    )


# Maps a workspace owner's email address to the Resend-verified sending domain for that workspace.
# Any workspace whose owner is not listed here defaults to _DEFAULT_SENDING_DOMAIN below.
# Keys must be lowercase — _workspace_from_email() lowercases the owner's email before lookup.
# laura.lmtconsulting@gmail.com temporarily omitted (falls back to the default below) —
# lauratreonze.com is added in Resend but not yet DNS-verified. Re-add once verified:
#     "laura.lmtconsulting@gmail.com": "lauratreonze.com",
_OWNER_SENDING_DOMAIN: dict[str, str] = {}
# NOT YET DNS-verified in Resend (SPF/DKIM) as of this change — outgoing mail from this
# domain may fail to send or land in spam until that's done. Set anyway per explicit
# request; switch back to "rass-consulting.com" (or whatever the last known-good verified
# domain is) if sending breaks.
_DEFAULT_SENDING_DOMAIN = "lmtconsulting.com"


def _workspace_from_email(workspace) -> str:
    """Return 'Workspace Name <noreply@domain>' using the SES-verified domain for this workspace."""
    name = workspace.name.replace('"', "'") if workspace.name else ""
    owner_email, _ = _owner_info(workspace)
    domain = _OWNER_SENDING_DOMAIN.get(
        owner_email.lower() if owner_email else "",
        _DEFAULT_SENDING_DOMAIN,
    )
    addr = f"noreply@{domain}"
    return f"{name} <{addr}>" if name else addr


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
        f"ATTENDEE;CN=\"{client_name}\";ROLE=REQ-PARTICIPANT:mailto:{client_email}",
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
        tmpl = _get_invite_template(invite)
        tmpl_vars = dict(
            invited_by_name=invite.invited_by.full_name, workspace_name=workspace.name,
            role=invite.get_role_display(), owner_email=owner_email, owner_name=owner_name or owner_email,
            accept_url=accept_url,
        )
        subject = _apply_tmpl(tmpl.get("subject", ""), **tmpl_vars) or f"You're invited to join {workspace.name} on CoachOS"
        custom_html = tmpl.get("custom_html", "").strip()
        if custom_html:
            html = _apply_tmpl(custom_html, **tmpl_vars)
        else:
            custom_intro   = _apply_tmpl(tmpl.get("intro", ""),   **tmpl_vars)
            custom_closing = _apply_tmpl(tmpl.get("closing", ""), **tmpl_vars)
            html = build_invite_email(
                invited_by_name=invite.invited_by.full_name,
                workspace_name=workspace.name,
                role_display=invite.get_role_display(),
                accept_url=accept_url,
                logo_url=_logo_src(workspace),
                invited_email=invite.email,
                owner_email=owner_email,
                owner_name=owner_name,
                custom_intro=custom_intro,
                custom_closing=custom_closing,
                style=tmpl.get("style", {}),
            )
        msg = EmailMultiAlternatives(
            subject=subject,
            body=plain,
            from_email=_workspace_from_email(workspace),
            to=[invite.email],
        )
        msg.attach_alternative(html, "text/html")
        msg.send()
        logger.info(f"Invite email sent to {invite.email}")
    except Exception as e:
        logger.error(f"send_invite_email failed: {e}")
        raise


@shared_task(name="tasks.email.retry_pending_invites")
def retry_pending_invites():
    """Runs every 5 minutes: retries any invite email that failed on creation (send_invite_email
    raises so accounts/views.py leaves email_sent=False when the initial send fails) — the
    Celery Beat equivalent of the old cron-job.org-triggered /api/internal/invites/ endpoint."""
    from apps.accounts.models import WorkspaceInvitation
    from django.utils import timezone

    pending_ids = list(
        WorkspaceInvitation.objects.filter(
            email_sent=False, accepted=False, expires_at__gt=timezone.now(),
        ).values_list("id", flat=True)
    )
    sent = 0
    for invite_id in pending_ids:
        try:
            send_invite_email(str(invite_id))
            WorkspaceInvitation.objects.filter(pk=invite_id).update(email_sent=True)
            sent += 1
        except Exception as e:
            logger.error(f"Pending invite email failed {invite_id}: {e}")
    if sent:
        logger.info(f"retry_pending_invites: sent {sent} invite(s)")
    return sent


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

        workspace  = activity.workspace
        dt         = _fmt_dt_human(activity.start_at, getattr(workspace, "workspace_timezone", ""))
        coach_name = activity.coach.full_name if activity.coach else activity.workspace.name
        coach_email = activity.coach.email if activity.coach else ""
        owner_email, owner_name = _owner_info(workspace)
        location_line = f"\nLocation: {activity.location}" if activity.location else ""

        tmpl_vars = dict(
            client_name=client.full_name, coach_name=coach_name,
            session_title=activity.title, session_time=dt,
            workspace_name=workspace.name,
        )
        tmpl = _get_activity_confirmation_template(activity)
        custom_intro   = _apply_tmpl(tmpl.get("intro", ""),   **tmpl_vars)
        custom_closing = _apply_tmpl(tmpl.get("closing", ""), **tmpl_vars)
        subject = _apply_tmpl(tmpl.get("subject", ""), **tmpl_vars) or f"Confirmed: {activity.title} with {coach_name}"

        google_connected = _coach_has_google_calendar(activity.coach)

        from apps.activities.tokens import make_session_token
        backend_url = getattr(settings, "BACKEND_URL", "").rstrip("/")
        if google_connected:
            # Google's own calendar invite (separate email, native Accept/Decline/Maybe)
            # is the one actionable email in this case — avoid a second, conflicting
            # set of response links here.
            confirm_url = cancel_url = reschedule_url = ""
        else:
            confirm_url     = f"{backend_url}/session/confirm/{make_session_token('confirm', str(activity.id))}/"
            cancel_url      = f"{backend_url}/session/cancel/{make_session_token('cancel', str(activity.id))}/"
            reschedule_url  = f"{backend_url}/session/reschedule/{make_session_token('reschedule', str(activity.id))}/"

        if google_connected:
            plain = (
                f"Hi {client.first_name},\n\nYour {activity.activity_type} has been scheduled.\n\n"
                f"  What:   {activity.title}\n  When:   {dt}{location_line}\n  Coach:  {coach_name}\n\n"
                f"You'll receive a separate Google Calendar invite — accept, decline, or propose a new "
                f"time directly on that invite to let {coach_name} know.\n\n— {workspace.name}"
            )
        else:
            plain = (
                f"Hi {client.first_name},\n\nYour {activity.activity_type} has been scheduled.\n\n"
                f"  What:   {activity.title}\n  When:   {dt}{location_line}\n  Coach:  {coach_name}\n\n"
                f"A calendar invite (.ics) is attached — open it to add this session to your calendar.\n\n"
                f"Confirm attendance: {confirm_url}\n"
                f"Request reschedule: {reschedule_url}\n"
                f"Cancel session:     {cancel_url}\n\n— {workspace.name}"
            )
        saved_style      = tmpl.get("style", {})
        from_email_addr  = _workspace_from_email(workspace)

        _show_logo = tmpl.get("show_logo", True)
        _eff_logo_url = _logo_src(workspace) if _show_logo else ""
        custom_html_tmpl = tmpl.get("custom_html", "").strip()
        if custom_html_tmpl:
            _ds = tmpl.get("disable_style", True)
            _bf = saved_style.get("body_font", "")
            _hf = saved_style.get("heading_font", "")
            _logo_img = (
                f'<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
                f'<td style="background:#ffffff;padding:8px 14px;border-radius:5px;">'
                f'<img src="{_eff_logo_url}" alt="{workspace.name}" '
                f'style="max-height:40px;max-width:160px;object-fit:contain;display:block;" />'
                f'</td></tr></table>'
            ) if _eff_logo_url else ""
            _p = 'style="margin:0 0 16px;font-size:15px;color:#3a3530;line-height:1.7;"'
            tmpl_vars.update(dict(
                header_bg="#1a2f4e" if _ds else saved_style.get("header_bg", "#1a2f4e"),
                accent_color="#b8922e" if _ds else saved_style.get("accent_color", "#b8922e"),
                value_color="#1a1714" if _ds else saved_style.get("value_color", "#1a1714"),
                body_font_css="'Helvetica Neue',Helvetica,Arial,sans-serif" if _ds else (_bf or "'Helvetica Neue',Helvetica,Arial,sans-serif"),
                heading_font_css="Georgia,'Times New Roman',serif" if _ds else (_hf or "Georgia,'Times New Roman',serif"),
                logo_img=_logo_img,
                intro=custom_intro, closing=custom_closing,
                intro_para=f'<p {_p}>{custom_intro}</p>' if custom_intro.strip() else '',
                closing_para=f'<p {_p}>{custom_closing}</p>' if custom_closing.strip() else '',
            ))
            html = _apply_tmpl(custom_html_tmpl, **tmpl_vars)
        else:
            html = build_confirmation_email(
                activity=activity,
                workspace_name=workspace.name,
                logo_url=_eff_logo_url,
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
        ics_bytes = _build_ics(activity, method="PUBLISH")

        msg = EmailMultiAlternatives(
            subject=subject,
            body=plain,
            from_email=from_email_addr,
            to=[client.email],
        )
        msg.attach_alternative(html, "text/html")
        msg.attach("invite.ics", ics_bytes, "text/calendar; method=PUBLISH")
        msg.send()

        from apps.clients.models import EmailLog
        EmailLog.log(workspace=workspace, category=EmailLog.Category.ACTIVITY_CONFIRMATION,
                     client=client, subject=subject, recipient_email=client.email, related_id=activity_id,
                     body_html=html)

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
                from_email=_workspace_from_email(workspace),
                to=[coach_email],
            )
            coach_msg.attach("invite.ics", ics_bytes, "text/calendar; method=PUBLISH")
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

        workspace   = activity.workspace
        dt          = _fmt_dt_human(activity.start_at, getattr(workspace, "workspace_timezone", ""))
        coach_name  = activity.coach.full_name if activity.coach else activity.workspace.name
        coach_email = activity.coach.email if activity.coach else ""
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
        from_email_addr  = _workspace_from_email(workspace)

        _show_logo = tmpl.get("show_logo", True)
        _eff_logo_url = _logo_src(workspace) if _show_logo else ""
        custom_html_tmpl = tmpl.get("custom_html", "").strip()
        if custom_html_tmpl:
            _ds = tmpl.get("disable_style", True)
            _bf = saved_style.get("body_font", "")
            _hf = saved_style.get("heading_font", "")
            _logo_img = (
                f'<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
                f'<td style="background:#ffffff;padding:8px 14px;border-radius:5px;">'
                f'<img src="{_eff_logo_url}" alt="{workspace.name}" '
                f'style="max-height:40px;max-width:160px;object-fit:contain;display:block;" />'
                f'</td></tr></table>'
            ) if _eff_logo_url else ""
            _p = 'style="margin:0 0 16px;font-size:15px;color:#3a3530;line-height:1.7;"'
            tmpl_vars.update(dict(
                header_bg="#1a2f4e" if _ds else saved_style.get("header_bg", "#1a2f4e"),
                accent_color="#b8922e" if _ds else saved_style.get("accent_color", "#b8922e"),
                value_color="#1a1714" if _ds else saved_style.get("value_color", "#1a1714"),
                body_font_css="'Helvetica Neue',Helvetica,Arial,sans-serif" if _ds else (_bf or "'Helvetica Neue',Helvetica,Arial,sans-serif"),
                heading_font_css="Georgia,'Times New Roman',serif" if _ds else (_hf or "Georgia,'Times New Roman',serif"),
                logo_img=_logo_img,
                intro=custom_intro, closing=custom_closing,
                intro_para=f'<p {_p}>{custom_intro}</p>' if custom_intro.strip() else '',
                closing_para=f'<p {_p}>{custom_closing}</p>' if custom_closing.strip() else '',
            ))
            html = _apply_tmpl(custom_html_tmpl, **tmpl_vars)
        else:
            html = build_reminder_email(
                activity=activity,
                workspace_name=workspace.name,
                logo_url=_eff_logo_url,
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

        from apps.clients.models import EmailLog
        EmailLog.log(workspace=workspace, category=EmailLog.Category.ACTIVITY_REMINDER,
                     client=client, subject=subject, recipient_email=client.email, related_id=activity_id,
                     body_html=html)

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
                from_email=_workspace_from_email(workspace),
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

        workspace   = activity.workspace
        dt          = _fmt_dt_human(activity.start_at, getattr(workspace, "workspace_timezone", ""))
        coach_name  = activity.coach.full_name if activity.coach else activity.workspace.name
        coach_email = activity.coach.email if activity.coach else ""
        owner_email, owner_name = _owner_info(workspace)
        location_line = f"\nLocation: {activity.location}" if activity.location else ""

        tmpl_vars = dict(
            client_name=client.full_name, coach_name=coach_name,
            session_title=activity.title, session_time=dt,
            workspace_name=workspace.name,
        )
        tmpl = _get_activity_template(activity, "reschedule")
        custom_intro   = _apply_tmpl(tmpl.get("intro", ""),   **tmpl_vars)
        custom_closing = _apply_tmpl(tmpl.get("closing", ""), **tmpl_vars)
        subject = _apply_tmpl(tmpl.get("subject", ""), **tmpl_vars) or f"Updated: {activity.title} with {coach_name}"

        google_connected = _coach_has_google_calendar(activity.coach)

        from apps.activities.tokens import make_session_token
        backend_url    = getattr(settings, "BACKEND_URL", "").rstrip("/")
        if google_connected:
            cancel_url = reschedule_url = ""
        else:
            cancel_url     = f"{backend_url}/session/cancel/{make_session_token('cancel', str(activity.id))}/"
            reschedule_url = f"{backend_url}/session/reschedule/{make_session_token('reschedule', str(activity.id))}/"

        if google_connected:
            plain = (
                f"Hi {client.first_name},\n\nYour session has been updated.\n\n"
                f"  What:   {activity.title}\n  When:   {dt}{location_line}\n  Coach:  {coach_name}\n\n"
                f"You'll receive an updated Google Calendar invite — accept, decline, or propose a new "
                f"time directly on that invite to let {coach_name} know.\n\n— {workspace.name}"
            )
        else:
            plain = (
                f"Hi {client.first_name},\n\nYour session has been updated.\n\n"
                f"  What:   {activity.title}\n  When:   {dt}{location_line}\n  Coach:  {coach_name}\n\n"
                f"A new calendar invite is attached. Open it to update your calendar.\n\n"
                f"Request reschedule: {reschedule_url}\n"
                f"Cancel session:     {cancel_url}\n\n"
                f"— {workspace.name}"
            )
        saved_style     = tmpl.get("style", {})
        _show_logo      = tmpl.get("show_logo", True)
        _eff_logo_url   = _logo_src(workspace) if _show_logo else ""
        custom_html_tmpl = tmpl.get("custom_html", "").strip()
        if custom_html_tmpl:
            _ds = tmpl.get("disable_style", True)
            _bf = saved_style.get("body_font", "")
            _hf = saved_style.get("heading_font", "")
            _logo_img = (
                f'<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
                f'<td style="background:#ffffff;padding:8px 14px;border-radius:5px;">'
                f'<img src="{_eff_logo_url}" alt="{workspace.name}" '
                f'style="max-height:40px;max-width:160px;object-fit:contain;display:block;" />'
                f'</td></tr></table>'
            ) if _eff_logo_url else ""
            _p = 'style="margin:0 0 16px;font-size:15px;color:#3a3530;line-height:1.7;"'
            tmpl_vars.update(dict(
                header_bg="#1a2f4e" if _ds else saved_style.get("header_bg", "#1a2f4e"),
                accent_color="#b8922e" if _ds else saved_style.get("accent_color", "#b8922e"),
                value_color="#1a1714" if _ds else saved_style.get("value_color", "#1a1714"),
                body_font_css="'Helvetica Neue',Helvetica,Arial,sans-serif" if _ds else (_bf or "'Helvetica Neue',Helvetica,Arial,sans-serif"),
                heading_font_css="Georgia,'Times New Roman',serif" if _ds else (_hf or "Georgia,'Times New Roman',serif"),
                logo_img=_logo_img,
                intro=custom_intro, closing=custom_closing,
                intro_para=f'<p {_p}>{custom_intro}</p>' if custom_intro.strip() else '',
                closing_para=f'<p {_p}>{custom_closing}</p>' if custom_closing.strip() else '',
            ))
            html = _apply_tmpl(custom_html_tmpl, **tmpl_vars)
        else:
            html = build_reschedule_email(
                activity=activity,
                workspace_name=workspace.name,
                logo_url=_eff_logo_url,
                coach_name=coach_name,
                coach_email=coach_email,
                dt_human=dt,
                owner_email=owner_email,
                owner_name=owner_name,
                google_cal_url=_build_google_cal_url(activity),
                custom_intro=custom_intro,
                custom_closing=custom_closing,
                cancel_url=cancel_url,
                reschedule_url=reschedule_url,
                style=saved_style,
            )
        ics_bytes = _build_ics(activity, method="PUBLISH")

        msg = EmailMultiAlternatives(
            subject=subject,
            body=plain,
            from_email=_workspace_from_email(workspace),
            to=[client.email],
        )
        msg.attach_alternative(html, "text/html")
        msg.attach("invite.ics", ics_bytes, "text/calendar; method=PUBLISH")
        msg.send()
        logger.info(f"Reschedule email sent to {client.email} for activity {activity_id}")

        from apps.clients.models import EmailLog
        EmailLog.log(workspace=workspace, category=EmailLog.Category.ACTIVITY_RESCHEDULE,
                     client=client, subject=subject, recipient_email=client.email, related_id=activity_id,
                     body_html=html)

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
                from_email=_workspace_from_email(workspace),
                to=[coach_email],
            )
            coach_msg.attach("invite.ics", ics_bytes, "text/calendar; method=PUBLISH")
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

        workspace   = activity.workspace
        dt          = _fmt_dt_human(activity.start_at, getattr(workspace, "workspace_timezone", ""))
        coach_name  = activity.coach.full_name if activity.coach else activity.workspace.name
        coach_email = activity.coach.email if activity.coach else ""
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

        from apps.clients.models import EmailLog
        EmailLog.log(workspace=workspace, category=EmailLog.Category.ACTIVITY_CANCELLATION,
                     client=client, subject=f"Cancelled: {activity.title}", recipient_email=client.email,
                     related_id=activity_id, body_html=html)

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
                from_email=_workspace_from_email(workspace),
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
    from tasks.email_html import build_invoice_pdf_html
    try:
        invoice   = Invoice.objects.select_related("client", "coach", "workspace").prefetch_related("items").get(id=invoice_id)
        workspace = invoice.workspace

        # Keep the invoice's online-payment link in sync with the workspace's current
        # Stripe connection — recomputed on every send/reminder (not just once at first
        # send) so connecting Stripe later still lights up an already-sent invoice, and
        # disconnecting it removes a pay button that would otherwise silently 404.
        stripe_cfg = (workspace.integrations or {}).get("stripe", {})
        if stripe_cfg.get("secret_key_encrypted") and invoice.total > invoice.amount_paid:
            from apps.invoicing.tokens import make_invoice_pay_token
            backend_base = getattr(settings, "BACKEND_URL", "").rstrip("/") or "http://localhost:8000"
            new_link = f"{backend_base}/invoices/pay/{make_invoice_pay_token(str(invoice.id))}/"
            if invoice.stripe_payment_link != new_link:
                invoice.stripe_payment_link = new_link
                invoice.save(update_fields=["stripe_payment_link"])
        elif invoice.stripe_payment_link:
            invoice.stripe_payment_link = ""
            invoice.save(update_fields=["stripe_payment_link"])

        owner_email, owner_name = _owner_info(workspace)
        due_str   = invoice.due_date.strftime("%B %d, %Y") if invoice.due_date else ""

        _pay_link = invoice.stripe_payment_link or ""
        _pay_button = (
            f'<div style="margin:0 0 32px;">'
            f'<a href="{_pay_link}" style="display:inline-block;background:#1a2f4e;color:#fff;'
            f'text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:600;">'
            f'Pay Invoice</a></div>'
        ) if _pay_link else ""
        _view_instructions = (
            "You can view and pay the invoice by clicking the button below."
            if _pay_link else
            "You can view the invoice by clicking on the attached file."
        )
        tmpl = _get_invoice_template(invoice)
        tmpl_style = tmpl.get("style", {})
        custom_html_tmpl = tmpl.get("custom_html", "").strip()
        disable_style = bool(custom_html_tmpl) and tmpl.get("disable_style", False)
        # When disable_style is on, suppress logo injection — custom HTML controls its own layout
        _show_logo = tmpl.get("show_logo", True) and not disable_style
        _logo_url = _logo_src(workspace) if _show_logo else ""
        _logo_img = (
            f'<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
            f'<td style="background:#ffffff;padding:8px 14px;border-radius:5px;">'
            f'<img src="{_logo_url}" alt="{workspace.name}" '
            f'style="max-height:40px;max-width:160px;object-fit:contain;display:block;" />'
            f'</td></tr></table>'
        ) if _logo_url else ""
        _bf = tmpl_style.get("body_font", "")
        _hf = tmpl_style.get("heading_font", "")
        _body_font_css = "'Helvetica Neue',Helvetica,Arial,sans-serif" if disable_style else (_bf or "'Helvetica Neue',Helvetica,Arial,sans-serif")
        _accent_color  = "#b8922e" if disable_style else tmpl_style.get("accent_color", "#b8922e")
        tmpl_vars = dict(
            client_name=invoice.client.full_name, workspace_name=workspace.name,
            invoice_number=invoice.number, amount=str(invoice.total), due_date=due_str,
            owner_email=owner_email, owner_name=owner_name or owner_email,
            payment_link=_pay_link, pay_button=_pay_button,
            view_instructions=_view_instructions, logo_img=_logo_img,
        )
        raw_body = tmpl.get("intro", "").strip() or _DEFAULT_INVOICE_BODY
        body_text = _apply_tmpl(raw_body, **tmpl_vars)
        subject = _apply_tmpl(tmpl.get("subject", ""), **tmpl_vars) or f"Invoice #{invoice.number} from {workspace.name}"
        tmpl_vars.update(dict(
            body_para=_invoice_body_block(body_text),
            header_bg="#1a2f4e" if disable_style else tmpl_style.get("header_bg", "#1a2f4e"),
            accent_color=_accent_color,
            value_color="#1a1714" if disable_style else tmpl_style.get("value_color", "#1a1714"),
            body_font_css=_body_font_css,
            heading_font_css="Georgia,'Times New Roman',serif" if disable_style else (_hf or "Georgia,'Times New Roman',serif"),
            footer_block=_invoice_footer_block(
                tmpl_style.get("show_footer", True) and not disable_style,
                body_font_css=_body_font_css, owner_email=owner_email,
                owner_name=owner_name or owner_email, accent_color=_accent_color,
                workspace_name=workspace.name, invoice_number=invoice.number,
                show_contact_line=tmpl_style.get("show_contact_line", True),
            ),
            header_block=_invoice_header_block(
                tmpl_style.get("show_header", True) and not disable_style,
                header_bg="#1a2f4e" if disable_style else tmpl_style.get("header_bg", "#1a2f4e"),
                accent_color=_accent_color, logo_img=_logo_img, workspace_name=workspace.name,
            ),
            body_radius="0 0 8px 8px" if (tmpl_style.get("show_header", True) and not disable_style) else "8px",
            heading_block=_invoice_heading_block(
                tmpl_style.get("show_heading", True) and not disable_style,
                heading_font_css="Georgia,'Times New Roman',serif" if disable_style else (_hf or "Georgia,'Times New Roman',serif"),
                workspace_name=workspace.name,
            ),
            signature_block=_invoice_signature_block(
                tmpl_style.get("show_signature", True) and not disable_style,
                workspace_name=workspace.name,
            ),
        ))

        plain = (
            f"Hi {invoice.client.first_name},\n\n"
            f"Please find attached invoice #{invoice.number} for ${invoice.total}.\n\n"
            f"{'Due: ' + due_str + chr(10) + chr(10) if due_str else ''}"
            f"{'Pay online: ' + invoice.stripe_payment_link + chr(10) + chr(10) if invoice.stripe_payment_link else ''}"
            f"— {workspace.name}"
        )
        effective_html_tmpl = custom_html_tmpl or _DEFAULT_INVOICE_HTML
        html = _apply_tmpl(effective_html_tmpl, **tmpl_vars)
        pdf_html = build_invoice_pdf_html(
            invoice=invoice,
            workspace_name=workspace.name,
            logo_url="",
            due_str=due_str,
            owner_email=owner_email,
            owner_name=owner_name,
            style=tmpl.get("style", {}),
        )
        from_addr = _workspace_from_email(workspace)
        pdf_bytes = b""
        try:
            from weasyprint import HTML as WeasyHTML
            pdf_bytes = WeasyHTML(string=pdf_html).write_pdf()
        except Exception as pdf_err:
            logger.warning(f"PDF generation failed for {invoice.number}: {pdf_err}")

        import mimetypes
        from django.core.files.storage import default_storage
        extra_attachments = []
        for att in (tmpl.get("attachments") or []):
            s3_key = att.get("s3_key")
            if not s3_key:
                continue
            try:
                with default_storage.open(s3_key, "rb") as f:
                    content = f.read()
                mime = mimetypes.guess_type(att.get("file_name", ""))[0] or "application/octet-stream"
                extra_attachments.append((att.get("file_name") or "attachment", content, mime))
            except Exception as att_err:
                logger.warning(f"Could not attach {s3_key} to invoice {invoice.number}: {att_err}")

        msg = _InvoiceEmail(
            subject=subject,
            body=plain,
            from_email=from_addr,
            to=[invoice.client.email],
            reply_to=[owner_email] if owner_email else None,
            html=html,
            pdf_bytes=pdf_bytes,
            pdf_filename=f"{invoice.number}.pdf",
            extra_attachments=extra_attachments,
        )
        msg.send()
        logger.info(f"Invoice email sent for {invoice.number}")

        from apps.clients.models import EmailLog
        EmailLog.log(workspace=workspace, category=EmailLog.Category.INVOICE,
                     client=invoice.client, subject=subject, recipient_email=invoice.client.email,
                     related_id=invoice_id, body_html=html)
    except Exception as e:
        logger.error(f"send_invoice_email failed: {e}")


def send_payment_receipt_email(invoice_id: str):
    from apps.invoicing.models import Invoice
    from tasks.email_html import build_payment_receipt_email
    try:
        invoice   = Invoice.objects.select_related("client", "coach", "workspace").get(id=invoice_id)
        workspace = invoice.workspace
        owner_email, owner_name = _owner_info(workspace)

        last_payment = invoice.payments.order_by("-paid_at").first()
        payment_date = (last_payment.paid_at if last_payment else timezone.now()).strftime("%B %d, %Y")
        amount_paid  = f"{invoice.amount_paid:,.2f}"

        tmpl = (workspace.email_templates or {}).get("payment_receipt", {})
        tmpl_vars = dict(
            client_name=invoice.client.full_name, workspace_name=workspace.name,
            invoice_number=invoice.number, amount=amount_paid, payment_date=payment_date,
            owner_email=owner_email, owner_name=owner_name or owner_email,
        )
        custom_intro   = _apply_tmpl(tmpl.get("intro", ""),   **tmpl_vars)
        custom_closing = _apply_tmpl(tmpl.get("closing", ""), **tmpl_vars)
        subject = _apply_tmpl(tmpl.get("subject", ""), **tmpl_vars) or f"Receipt: Invoice #{invoice.number} — Payment Received"

        custom_html_tmpl = tmpl.get("custom_html", "").strip()
        if custom_html_tmpl:
            html = _apply_tmpl(custom_html_tmpl, **tmpl_vars)
        else:
            html = build_payment_receipt_email(
                invoice=invoice,
                workspace_name=workspace.name,
                logo_url=_logo_src(workspace),
                amount_paid=amount_paid,
                payment_date=payment_date,
                owner_email=owner_email,
                owner_name=owner_name,
                custom_intro=custom_intro,
                custom_closing=custom_closing,
                style=tmpl.get("style", {}),
            )

        plain = (
            f"Hi {invoice.client.first_name},\n\n"
            f"Thank you — payment of ${amount_paid} for invoice #{invoice.number} has been received.\n\n"
            f"— {workspace.name}"
        )
        msg = EmailMultiAlternatives(
            subject=subject,
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

        from apps.clients.models import EmailLog
        EmailLog.log(workspace=workspace, category=EmailLog.Category.PAYMENT_RECEIPT,
                     client=invoice.client, subject=subject, recipient_email=invoice.client.email,
                     related_id=invoice_id, body_html=html)
    except Exception as e:
        logger.error(f"send_payment_receipt_email failed: {e}")


@shared_task(name="tasks.email.send_payment_failed_email")
def send_payment_failed_email(invoice_id: str):
    from apps.invoicing.models import Invoice
    try:
        invoice = Invoice.objects.select_related("client", "coach", "workspace").get(id=invoice_id)
        msg = EmailMessage(
            subject=f"Payment failed — Invoice #{invoice.number}",
            body=(
                f"Payment failed for invoice #{invoice.number} (${invoice.total}) "
                f"for {invoice.client.full_name}."
            ),
            from_email=_workspace_from_email(invoice.workspace),
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
                                     from_email=_workspace_from_email(workspace), to=[owner_email])
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
                                     from_email=_workspace_from_email(ticket.workspace), to=[recipient.email])
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
                                     from_email=_workspace_from_email(ticket.workspace), to=[recipient.email])
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

        tmpl_vars = dict(
            owner_name=owner_name, client_name=client_name, stage_label=stage_label,
            days_in_stage=days_in_stage, follow_up_days=cfg.follow_up_days,
            deal_value=deal_value, stage_entered=stage_entered, workspace_name=workspace.name,
        )
        tmpl = _get_pipeline_template(workspace)
        custom_intro   = _apply_tmpl(tmpl.get("intro", ""),   **tmpl_vars)
        custom_closing = _apply_tmpl(tmpl.get("closing", ""), **tmpl_vars)
        subject = _apply_tmpl(tmpl.get("subject", ""), **tmpl_vars) or (
            f"Follow-up needed: {client_name} — {stage_label} ({days_in_stage} days)"
        )

        plain_body = (
            f"Hi {owner_name},\n\n"
            f"{client_name}'s deal has been in '{stage_label}' for {days_in_stage} days "
            f"(threshold: {cfg.follow_up_days} days).\n\n"
            f"Deal value: {deal_value}\n"
            f"Stage entered: {stage_entered}\n\n"
            f"View your pipeline: {pipeline_url}\n\n"
            f"— {workspace.name}"
        )

        _show_logo = tmpl.get("show_logo", True)
        _eff_logo_url = logo_url if _show_logo else ""
        saved_style = tmpl.get("style", {})
        custom_html_tmpl = tmpl.get("custom_html", "").strip()
        if custom_html_tmpl:
            _ds = tmpl.get("disable_style", True)
            _bf = saved_style.get("body_font", "")
            _hf = saved_style.get("heading_font", "")
            _logo_img = (
                f'<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
                f'<td style="background:#ffffff;padding:8px 14px;border-radius:5px;">'
                f'<img src="{_eff_logo_url}" alt="{workspace.name}" '
                f'style="max-height:40px;max-width:160px;object-fit:contain;display:block;" />'
                f'</td></tr></table>'
            ) if _eff_logo_url else ""
            _p = 'style="margin:0 0 16px;font-size:15px;color:#3a3530;line-height:1.7;"'
            tmpl_vars.update(dict(
                header_bg="#1a2f4e" if _ds else saved_style.get("header_bg", "#1a2f4e"),
                accent_color="#b8922e" if _ds else saved_style.get("accent_color", "#b8922e"),
                value_color="#1a1714" if _ds else saved_style.get("value_color", "#1a1714"),
                body_font_css="'Helvetica Neue',Helvetica,Arial,sans-serif" if _ds else (_bf or "'Helvetica Neue',Helvetica,Arial,sans-serif"),
                heading_font_css="Georgia,'Times New Roman',serif" if _ds else (_hf or "Georgia,'Times New Roman',serif"),
                logo_img=_logo_img,
                intro=custom_intro, closing=custom_closing,
                intro_para=f'<p {_p}>{custom_intro}</p>' if custom_intro.strip() else '',
                closing_para=f'<p {_p}>{custom_closing}</p>' if custom_closing.strip() else '',
                pipeline_url=pipeline_url,
            ))
            html_body = _apply_tmpl(custom_html_tmpl, **tmpl_vars)
        else:
            html_body = build_pipeline_alert_email(
                workspace_name=workspace.name,
                logo_url=_eff_logo_url,
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
                custom_intro=custom_intro,
                custom_closing=custom_closing,
                style=saved_style,
            )

        recipients = [owner_email]
        if cfg.notify_client and client.email:
            recipients.append(client.email)

        msg = EmailMultiAlternatives(
            subject=subject,
            body=plain_body,
            from_email=_workspace_from_email(workspace),
            to=recipients,
        )
        msg.attach_alternative(html_body, "text/html")
        msg.send()
        logger.info(f"Pipeline alert sent for deal {deal_id} ({stage_label})")
    except Exception as e:
        logger.error(f"send_pipeline_alert failed for deal {deal_id}: {e}")


# ── Client session action notifications ────────────────────────────────────────

def send_client_confirmation_notice(activity_id: str):
    """Email the coach when a client confirms attendance via their email link."""
    from apps.activities.models import Activity
    try:
        activity = Activity.objects.select_related("client", "coach", "workspace").get(id=activity_id)
        coach = activity.coach
        if not coach or not coach.email:
            return
        workspace   = activity.workspace
        client_name = activity.client.full_name
        dt          = _fmt_dt_human(activity.start_at, getattr(workspace, "workspace_timezone", ""))
        subject = f"{client_name} confirmed attendance"
        body = (
            f"Hi {coach.first_name or coach.full_name},\n\n"
            f"{client_name} has confirmed their attendance for:\n\n"
            f"  What:  {activity.title}\n"
            f"  When:  {dt}\n\n"
            f"The session is marked as confirmed in CoachOS.\n\n"
            f"— {workspace.name}"
        )
        EmailMultiAlternatives(
            subject=subject, body=body,
            from_email=_workspace_from_email(workspace), to=[coach.email],
        ).send()
        logger.info(f"Client confirmation notice sent to coach {coach.email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_client_confirmation_notice failed: {e}")


@shared_task(name="tasks.email.send_client_cancellation_notice")
def send_client_cancellation_notice(activity_id: str):
    """Email the coach when a client cancels via their email link."""
    from apps.activities.models import Activity
    try:
        activity = Activity.objects.select_related("client", "coach", "workspace").get(id=activity_id)
        coach = activity.coach
        if not coach or not coach.email:
            return

        workspace   = activity.workspace
        client_name = activity.client.full_name
        dt          = _fmt_dt_human(activity.start_at, getattr(workspace, "workspace_timezone", ""))

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
            from_email=_workspace_from_email(workspace),
            to=[coach.email],
        )
        msg.send()
        logger.info(f"Client cancellation notice sent to coach {coach.email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_client_cancellation_notice failed: {e}")


@shared_task(name="tasks.email.send_client_rsvp_notice")
def send_client_rsvp_notice(activity_id: str, response_status: str):
    """Email the coach when a client accepts/declines/tentatively-RSVPs the Google Calendar invite."""
    from apps.activities.models import Activity
    try:
        activity = Activity.objects.select_related("client", "coach", "workspace").get(id=activity_id)
        coach = activity.coach
        if not coach or not coach.email:
            return

        workspace   = activity.workspace
        client_name = activity.client.full_name
        dt          = _fmt_dt_human(activity.start_at, getattr(workspace, "workspace_timezone", ""))
        verb = {"accepted": "accepted", "declined": "declined", "tentative": "tentatively accepted"}.get(
            response_status, response_status
        )

        subject = f"{client_name} {verb} the calendar invite"
        body    = (
            f"Hi {coach.first_name or coach.full_name},\n\n"
            f"{client_name} has {verb} the calendar invite for:\n\n"
            f"  What:  {activity.title}\n"
            f"  When:  {dt}\n\n"
            f"— {workspace.name}"
        )
        EmailMultiAlternatives(
            subject=subject, body=body,
            from_email=_workspace_from_email(workspace), to=[coach.email],
        ).send()
        logger.info(f"RSVP notice ({response_status}) sent to coach {coach.email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_client_rsvp_notice failed: {e}")


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


# ── Portal invite ──────────────────────────────────────────────────────────────

@shared_task(name="tasks.email.send_portal_invite_email")
def send_portal_invite_email(client_id: str):
    """Send portal access invitation email to the client."""
    from apps.clients.models import Client
    from tasks.email_html import build_portal_invite_email
    try:
        client    = Client.objects.select_related("workspace", "coach").get(id=client_id)
        workspace = client.workspace
        if not client.email:
            return

        frontend_url = getattr(settings, "FRONTEND_URL", "").rstrip("/")
        portal_url   = f"{frontend_url}/client-portal"
        coach_name   = client.coach.full_name if client.coach else workspace.name
        owner_email, owner_name = _owner_info(workspace)

        tmpl      = (workspace.email_templates or {}).get("portal_invite", {})
        tmpl_vars = dict(
            client_name=client.full_name,
            workspace_name=workspace.name,
            portal_url=portal_url,
            coach_name=coach_name,
        )
        custom_intro   = _apply_tmpl(tmpl.get("intro",   ""), **tmpl_vars)
        custom_closing = _apply_tmpl(tmpl.get("closing", ""), **tmpl_vars)
        subject        = _apply_tmpl(tmpl.get("subject", ""), **tmpl_vars) or \
                         f"Your portal access is ready — {workspace.name}"

        saved_style   = tmpl.get("style", {})
        from_email_addr = _workspace_from_email(workspace)

        _show_logo = tmpl.get("show_logo", True)
        _eff_logo_url = _logo_src(workspace) if _show_logo else ""
        custom_html = tmpl.get("custom_html", "").strip()
        if custom_html:
            _ds = tmpl.get("disable_style", True)
            _bf = saved_style.get("body_font", "")
            _hf = saved_style.get("heading_font", "")
            _logo_img = (
                f'<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
                f'<td style="background:#ffffff;padding:8px 14px;border-radius:5px;">'
                f'<img src="{_eff_logo_url}" alt="{workspace.name}" '
                f'style="max-height:40px;max-width:160px;object-fit:contain;display:block;" />'
                f'</td></tr></table>'
            ) if _eff_logo_url else ""
            _p = 'style="margin:0 0 16px;font-size:15px;color:#3a3530;line-height:1.7;"'
            tmpl_vars.update(dict(
                header_bg="#1a2f4e" if _ds else saved_style.get("header_bg", "#1a2f4e"),
                accent_color="#b8922e" if _ds else saved_style.get("accent_color", "#b8922e"),
                value_color="#1a1714" if _ds else saved_style.get("value_color", "#1a1714"),
                body_font_css="'Helvetica Neue',Helvetica,Arial,sans-serif" if _ds else (_bf or "'Helvetica Neue',Helvetica,Arial,sans-serif"),
                heading_font_css="Georgia,'Times New Roman',serif" if _ds else (_hf or "Georgia,'Times New Roman',serif"),
                logo_img=_logo_img,
                intro=custom_intro, closing=custom_closing,
                intro_para=f'<p {_p}>{custom_intro}</p>' if custom_intro.strip() else '',
                closing_para=f'<p {_p}>{custom_closing}</p>' if custom_closing.strip() else '',
            ))
            html = _apply_tmpl(custom_html, **tmpl_vars)
        else:
            html = build_portal_invite_email(
                client_name=client.full_name,
                workspace_name=workspace.name,
                portal_url=portal_url,
                coach_name=coach_name,
                logo_url=_eff_logo_url,
                owner_email=owner_email,
                owner_name=owner_name,
                custom_intro=custom_intro,
                custom_closing=custom_closing,
                style=saved_style,
            )

        plain = (
            f"Hi {client.first_name},\n\n"
            f"{workspace.name} has given you access to your client portal.\n\n"
            f"Log in here: {portal_url}\n\n"
            f"Your login email is: {client.email}\n\n"
            f"If you have any questions, reply to this email or contact {coach_name}.\n\n"
            f"— {workspace.name}"
        )
        msg = EmailMultiAlternatives(
            subject=subject,
            body=plain,
            from_email=from_email_addr,
            to=[client.email],
        )
        msg.attach_alternative(html, "text/html")
        msg.send()
        logger.info(f"Portal invite sent to {client.email} for client {client_id}")

        from apps.clients.models import EmailLog
        EmailLog.log(workspace=workspace, category=EmailLog.Category.PORTAL_INVITE,
                     client=client, subject=subject, recipient_email=client.email, related_id=client_id,
                     body_html=html)
    except Exception as e:
        logger.error(f"send_portal_invite_email failed: {e}")


@shared_task(name="tasks.email.send_client_communication_email")
def send_client_communication_email(draft_id: str):
    """Send a Client Communication draft (ClientMessageDraft) to the client and mark
    it sent. Called synchronously from ClientMessageDraftViewSet.send so the coach gets
    immediate success/failure feedback, rather than queued like the reminder/confirmation
    tasks — this is a single manual send, not a bulk background job."""
    from apps.clients.models import ClientMessageDraft
    from tasks.email_html import build_client_communication_email
    from django.core.files.storage import default_storage
    from django.utils import timezone
    import mimetypes

    draft     = ClientMessageDraft.objects.select_related("client", "client__coach", "workspace").get(id=draft_id)
    client    = draft.client
    workspace = draft.workspace
    if not client.email:
        raise ValueError("This client has no email address on file.")

    coach_name = draft.signature_name.strip() or (client.coach.full_name if client.coach else workspace.name)
    owner_email, owner_name = _owner_info(workspace)
    logo_url = _logo_src(workspace) if draft.show_logo else ""

    # Generic-template samples (and any coach-written draft) may contain {client_name} /
    # {coach_name} / {workspace_name} placeholders — substitute them here since this is
    # the only place client_communication content actually gets sent (the Settings
    # preview substitutes for display only and never persists back into the draft).
    tmpl_vars = dict(client_name=client.full_name, coach_name=coach_name, workspace_name=workspace.name)
    subject        = _apply_tmpl(draft.subject.strip(), **tmpl_vars) or "A message from your coach"
    custom_intro   = _apply_tmpl(draft.intro,   **tmpl_vars)
    custom_closing = _apply_tmpl(draft.closing, **tmpl_vars)

    sign_url = ""
    if draft.include_client_signature_line and not draft.client_signed_at:
        from apps.clients.tokens import make_contract_token
        backend_url = getattr(settings, "BACKEND_URL", "").rstrip("/")
        sign_url = f"{backend_url}/contract/sign/{make_contract_token(str(draft.id))}/"

    client_signed_human = ""
    if draft.client_signed_at:
        client_signed_human = draft.client_signed_at.strftime("%B %d, %Y")

    html = build_client_communication_email(
        client_name=client.full_name,
        subject=subject,
        workspace_name=workspace.name,
        coach_name=coach_name,
        logo_url=logo_url,
        owner_email=owner_email, owner_name=owner_name,
        custom_intro=custom_intro, custom_closing=custom_closing,
        style=draft.style or {},
        coach_signature=draft.coach_signature,
        include_client_signature_line=draft.include_client_signature_line,
        sign_url=sign_url,
        client_signature=draft.client_signature,
        client_signed_at_human=client_signed_human,
    )
    plain_lines = [custom_intro, custom_closing, f"— {coach_name or workspace.name}"]
    if sign_url:
        plain_lines.append(f"Review & sign online: {sign_url}")
    plain = "\n\n".join(filter(None, plain_lines))

    msg = EmailMultiAlternatives(
        subject=subject,
        body=plain,
        from_email=_workspace_from_email(workspace),
        to=[client.email],
        reply_to=[owner_email] if owner_email else None,
    )
    msg.attach_alternative(html, "text/html")

    # Contracts (client signature requested) also go out as a real PDF attachment,
    # not just inline HTML — same WeasyPrint pattern used for invoices.
    if draft.include_client_signature_line:
        try:
            from weasyprint import HTML as WeasyHTML
            pdf_bytes = WeasyHTML(string=html).write_pdf()
            safe_subject = "".join(c for c in subject if c.isalnum() or c in " -_").strip() or "contract"
            msg.attach(f"{safe_subject}.pdf", pdf_bytes, "application/pdf")
        except Exception as e:
            logger.warning(f"Could not attach contract PDF for draft {draft_id}: {e}")

    for att in (draft.attachments or []):
        s3_key = att.get("s3_key")
        if not s3_key:
            continue
        try:
            with default_storage.open(s3_key, "rb") as f:
                content = f.read()
            mime = mimetypes.guess_type(att.get("file_name", ""))[0] or "application/octet-stream"
            msg.attach(att.get("file_name") or "attachment", content, mime)
        except Exception as e:
            logger.warning(f"Could not attach {s3_key} to client communication {draft_id}: {e}")

    msg.send()

    if draft.status != "signed":
        draft.status = "sent"
    draft.sent_at = timezone.now()
    draft.save(update_fields=["status", "sent_at", "updated_at"])
    logger.info(f"Client communication sent to {client.email} (draft {draft_id})")

    from apps.clients.models import EmailLog
    EmailLog.log(workspace=workspace, category=EmailLog.Category.CLIENT_MESSAGE,
                 client=client, subject=subject, recipient_email=client.email, related_id=draft_id,
                 body_html=html)


@shared_task(name="tasks.email.send_contract_signed_notice")
def send_contract_signed_notice(draft_id: str):
    """Notify the coach (and the workspace owner, if different) that a client has
    signed a contract sent via Client Communication. Fire-and-forget, called from
    apps.clients.public_views.ContractSignView.post right after the signature is
    captured — mirrors the pattern used for session confirm/cancel notices."""
    from apps.clients.models import ClientMessageDraft
    try:
        draft = ClientMessageDraft.objects.select_related("client", "client__coach", "workspace").get(id=draft_id)
        client, workspace = draft.client, draft.workspace
        owner_email, owner_name = _owner_info(workspace)

        to_addrs = set()
        if client.coach and client.coach.email:
            to_addrs.add(client.coach.email)
        if owner_email:
            to_addrs.add(owner_email)
        if not to_addrs:
            return

        subject = f"Signed: {draft.subject or 'Agreement'} — {client.full_name}"
        signed_str = draft.client_signed_at.strftime("%B %d, %Y at %I:%M %p") if draft.client_signed_at else ""
        plain = (
            f"{client.full_name} has signed \"{draft.subject or 'Agreement'}\" on {signed_str}.\n\n"
            f"A copy of the signed document has been saved to their Files.\n\n"
            f"— CoachOS"
        )
        msg = EmailMultiAlternatives(
            subject=subject, body=plain,
            from_email=_workspace_from_email(workspace),
            to=list(to_addrs),
        )
        msg.send()
        logger.info(f"Contract-signed notice sent for draft {draft_id}")
    except Exception as e:
        logger.error(f"send_contract_signed_notice failed: {e}")
