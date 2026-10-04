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


def _report_send_failure(task_name: str, exc: Exception, *, workspace=None, activity_id=None):
    """Every send_* task below catches its own exceptions so one bad email never fails
    the whole Celery task — but that also means the exception never reaches Celery's
    task_failure signal, so apps.accounts.error_logging's automatic ErrorLog + platform-
    admin alert email never fired for any of these. Call this from each except block to
    route send failures into that same pipeline (Error Log tab + immediate admin email)
    instead of them being visible only via `docker compose logs`."""
    try:
        from apps.accounts.error_logging import capture_error
        endpoint = f"tasks.email.{task_name}"
        if activity_id:
            endpoint += f"(activity_id={activity_id})"
        capture_error(exc, workspace=workspace, endpoint=endpoint, source="celery")
    except Exception:
        logger.exception(f"_report_send_failure failed for {task_name}")


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


def _resolve_generic_template(workspace, use_case: str) -> dict:
    """Whichever named template (Settings -> Generic Templates) a coach has assigned as
    the default for this use case, via template_use_case_map — the data actually behind
    every "Default (Settings -> Generic Templates -> ...)" picker option across the app.

    Every send path used to skip generic_templates/template_use_case_map entirely and
    read straight from the legacy per-use-case `workspace.email_templates` dict instead —
    a field the Generic Templates UI never writes to. The result: editing and assigning a
    template in Settings had no effect on the email actually sent when "Default" was
    picked; previewing there looked right because the preview endpoint (unlike these send
    functions) does read generic_templates/template_use_case_map correctly.

    Falls back to the legacy dict only when this use case has no assignment in the new
    system at all (e.g. workspaces that never touched Generic Templates), so nothing
    regresses for a use case nobody has migrated yet."""
    use_case_map = getattr(workspace, "template_use_case_map", None) or {}
    template_id = use_case_map.get(use_case)
    if template_id:
        tmpl = next(
            (t for t in (workspace.generic_templates or [])
             if isinstance(t, dict) and t.get("id") == template_id),
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
    # Nothing assigned in Settings → the starter (tasks/email_starters.py) — exactly what
    # Settings shows as "Built-in" and what its editor opens with. The legacy per-use-case
    # dict is only still consulted for use cases without a starter (invoice, client
    # communication); for everything else it held content the Settings UI never showed,
    # which made "Built-in" in Settings and the email actually sent disagree.
    from tasks.email_starters import starter_for
    starter = starter_for(use_case)
    if starter:
        return starter
    return (workspace.email_templates or {}).get(use_case, {})


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
    return _resolve_generic_template(workspace, "invoice")


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
    return _resolve_generic_template(workspace, use_case)


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
    return _resolve_generic_template(workspace, "team_invite")


def _get_pipeline_template(workspace) -> dict:
    """Resolve the workspace's default "pipeline" template (Settings > Generic Templates).
    Pipeline alerts are dispatched automatically off the stage-tracking cron, not reviewed
    per-deal before sending, so — like reminders — there's no per-record override to check."""
    return _resolve_generic_template(workspace, "pipeline")


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


def _format_address(addr: dict) -> str:
    """Render a Client.primary_address JSON blob as a single-line postal address."""
    if not addr:
        return ""
    street = " ".join(p for p in (addr.get("street", ""), addr.get("street2", "")) if p)
    city_state_zip = ", ".join(p for p in (addr.get("city", ""), " ".join(p for p in (addr.get("state", ""), addr.get("zip", "")) if p)) if p)
    return ", ".join(p for p in (street, city_state_zip) if p)


def _session_notice_values(activity, dt: str, recipient_first: str = "", recipient_full: str = "") -> dict:
    """Placeholder values shared by every session-related notice (tasks/email_notices.py)."""
    client = activity.client
    coach_name = activity.coach.full_name if activity.coach else activity.workspace.name
    return dict(
        client_name=client.full_name, client_first_name=client.first_name,
        client_email=client.email or "", coach_name=coach_name,
        workspace_name=activity.workspace.name,
        session_title=activity.title, session_time=dt,
        recipient_first_name=recipient_first or recipient_full or coach_name,
        recipient_name=recipient_full or recipient_first or coach_name,
    )


def _session_notice_rows(activity, dt: str, when_label: str = "When", include_client: bool = True) -> list:
    client = activity.client
    rows = [("What", activity.title), (when_label, dt), ("Where", activity.location or "")]
    if include_client:
        rows.append(("Client", f"{client.full_name}{f' ({client.email})' if client.email else ''}"))
    return rows


def _template_plain(intro: str, closing: str, links: list = None) -> str:
    """Plain-text alternative built from the same message/closing text as the HTML
    (so the two never say different things), plus any action links as "Label: url"."""
    def clean(t):
        t = re.sub(r"<br\s*/?>", "\n", t or "", flags=re.IGNORECASE)
        return re.sub(r"<[^>]+>", "", t).strip()
    parts = [clean(intro)]
    if links:
        parts.append("\n".join(f"{label}: {url}" for label, url in links if url))
    parts.append(clean(closing))
    return "\n\n".join(p for p in parts if p)


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
    '          {closing_block}\n'
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
    """Render the invoice email body as real HTML paragraphs — same paragraph-splitting,
    HTML-escaping, and safe <a href="http(s)://…"> link handling as a Client Communication
    message (see _paragraphs_html in email_html.py). Previously interpolated the coach's
    text straight into the HTML with zero escaping (relying on white-space:pre-line for
    paragraph breaks instead), which meant any HTML a coach typed went out raw and
    unsanitized in the actual sent email."""
    from tasks.email_html import _paragraphs_html
    return _paragraphs_html(body, "margin:0 0 28px;font-size:15px;color:#3a3530;line-height:1.7;")


def _invoice_header_block(show_header: bool, *, header_bg: str, accent_color: str,
                           logo_img: str, workspace_name: str) -> str:
    """The invoice email's header (brand bar + accent line) — hand-rolled like
    _invoice_footer_block, for the same reason: the invoice template is its own HTML
    string rather than going through _email_shell.

    Shows the logo OR the workspace name, never both — matching _email_shell's brand
    logic (email_html.py). Previously always rendered both stacked in the same cell:
    with a logo present, the name text (styled to read against the dark header_bg)
    ended up sitting directly against/behind the logo's own white box, reading as
    illegible ghosting rather than a second line of branding.

    Text color also adapts when a coach picks a light/white header — the fallback
    text was hardcoded light-on-dark, so a white header made it disappear."""
    if not show_header:
        return ""
    from tasks.email_html import is_light_color
    text_color = "#1a2f4e" if is_light_color(header_bg) else "#f7f4ef"
    brand = logo_img or (
        f'<span style="font-family:Georgia,serif;font-size:22px;color:{text_color};">{workspace_name}</span>'
    )
    # No accent-color line under the header — a coach asked for it removed; the header
    # is just the background + logo/brand, nothing else. accent_color is still accepted
    # (unused here now) since it's still used elsewhere, e.g. the footer's contact link.
    return (
        '<tr>\n'
        f'  <td style="background:{header_bg};padding:24px 40px;border-radius:8px 8px 0 0;">\n'
        f'    {brand}\n'
        '  </td>\n'
        '</tr>'
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


def _invoice_closing_block(closing: str) -> str:
    """Optional closing paragraph, shown above the "Thanks!" sign-off — every other
    email type (confirmation, reminder, payment receipt, ...) has this slot via
    custom_closing; the invoice template never did, so the "Body — Closing" field in
    the editor silently did nothing. Matches the invoice template's own styling.
    Escaped/paragraph-split via _paragraphs_html like _invoice_body_block — see there."""
    from tasks.email_html import _paragraphs_html
    return _paragraphs_html(closing, "margin:0 0 20px;font-size:13px;color:#9e9890;line-height:1.7;")


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
        f'    <p style="margin:0;font-size:11px;color:#1a1714;font-family:{body_font_css};">\n'
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
# lmtconsulting.com was set here before being DNS-verified in Resend (see prior comment
# history) — confirmed broken in production 2026-08-29 (Resend 550: "domain is not
# verified"), silently failing every outgoing email for every workspace using the
# default. Reverted to the last known-good verified domain per that comment's own
# instruction. Switch back to "lmtconsulting.com" once it's actually verified in
# https://resend.com/domains (SPF/DKIM records confirmed, not just added).
_DEFAULT_SENDING_DOMAIN = "rass-consulting.com"


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
            client_name=client.full_name, client_first_name=client.first_name,
            client_email=client.email or "", client_address=_format_address(client.primary_address),
            coach_name=coach_name,
            session_title=activity.title, session_time=dt,
            workspace_name=workspace.name,
        )
        tmpl = _get_activity_confirmation_template(activity)
        custom_intro   = _apply_tmpl(tmpl.get("intro", ""),   **tmpl_vars)
        custom_closing = _apply_tmpl(tmpl.get("closing", ""), **tmpl_vars)
        subject = _apply_tmpl(tmpl.get("subject", ""), **tmpl_vars) or f"Confirmed: {activity.title} with {coach_name}"

        # CoachOS's own branded email is always the one actionable email for the client —
        # it carries both "add to calendar" (ics attachment + one-click Google/Apple/Outlook
        # links, built below) and Confirm/Cancel/Reschedule, regardless of whether the coach
        # also happens to have Google Calendar connected. We used to suppress these buttons
        # whenever a Google token was on file, on the assumption Google's own native invite
        # would carry Yes/No/Maybe instead — but that invite silently stops sending the
        # moment the coach's Google connection lapses (see tasks/calendar.py's sendUpdates
        # change), which left clients with no way to respond at all. One email, always
        # actionable, is simpler and doesn't depend on a fragile third-party connection.
        from apps.activities.tokens import make_session_token
        backend_url = getattr(settings, "BACKEND_URL", "").rstrip("/")
        confirm_url     = f"{backend_url}/session/confirm/{make_session_token('confirm', str(activity.id))}/"
        cancel_url      = f"{backend_url}/session/cancel/{make_session_token('cancel', str(activity.id))}/"
        reschedule_url  = f"{backend_url}/session/reschedule/{make_session_token('reschedule', str(activity.id))}/"

        plain = _template_plain(custom_intro, custom_closing, [("Confirm attendance", confirm_url), ("Request reschedule", reschedule_url), ("Cancel session", cancel_url)])
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
            from tasks.email_notices import send_notice, app_url
            coach = activity.coach
            send_notice(
                workspace, "coach_session_booked", [coach_email],
                _session_notice_values(activity, dt, coach.first_name if coach else "", coach.full_name if coach else ""),
                rows=_session_notice_rows(activity, dt),
                cta=("Open in CoachOS", app_url(f"/clients/{client.id}")),
                attachments=[("invite.ics", ics_bytes, "text/calendar; method=PUBLISH")],
            )
            logger.info(f"Coach copy sent to {coach_email} for activity {activity_id}")

        from django.utils import timezone
        Activity.objects.filter(pk=activity_id).update(confirmation_sent_at=timezone.now())
        logger.info(f"Confirmation email sent to {client.email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_activity_confirmation_email failed: {e}")
        _report_send_failure("send_activity_confirmation_email", e, workspace=locals().get("workspace"), activity_id=activity_id)


@shared_task(name="tasks.email.send_activity_reminder_email")
def send_activity_reminder_email(activity_id: str, hours_before: int = 24):
    from django.utils import timezone
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
        # hours_before picks which of the two coach-configured templates to use
        # (reminder_24h vs reminder_1h below) — but the wording is computed from the
        # actual time left, not from that fixed 24/1 label. This matters once a
        # reminder can go out late (a missed tick caught up on the next run — see
        # tasks/reminders.py): if a "24 hour" reminder actually fires only 3 hours
        # out, the email must say "3 hours", not "24 hours".
        remaining_minutes = max(0, int((activity.start_at - timezone.now()).total_seconds() // 60))
        if remaining_minutes >= 90:
            remaining_hours = round(remaining_minutes / 60)
            time_label = f"{remaining_hours} hour{'s' if remaining_hours != 1 else ''}"
        elif remaining_minutes >= 1:
            time_label = f"{remaining_minutes} minute{'s' if remaining_minutes != 1 else ''}"
        else:
            time_label = "a few minutes"
        location_line = f"\nLocation: {activity.location}" if activity.location else ""

        tmpl_key  = "reminder_24h" if hours_before == 24 else "reminder_1h"
        tmpl_vars = dict(
            client_name=client.full_name, client_first_name=client.first_name,
            client_email=client.email or "", client_address=_format_address(client.primary_address),
            coach_name=coach_name,
            session_title=activity.title, session_time=dt,
            workspace_name=workspace.name, time_label=time_label,
        )
        tmpl = _resolve_generic_template(workspace, tmpl_key)
        custom_intro   = _apply_tmpl(tmpl.get("intro", ""),   **tmpl_vars)
        custom_closing = _apply_tmpl(tmpl.get("closing", ""), **tmpl_vars)
        subject = _apply_tmpl(tmpl.get("subject", ""), **tmpl_vars) or f"Reminder: {activity.title} in {time_label}"

        from apps.activities.tokens import make_session_token
        backend_url    = getattr(settings, "BACKEND_URL", "").rstrip("/")
        cancel_url     = f"{backend_url}/session/cancel/{make_session_token('cancel', str(activity.id))}/"
        reschedule_url = f"{backend_url}/session/reschedule/{make_session_token('reschedule', str(activity.id))}/"

        plain = _template_plain(custom_intro, custom_closing, [("Request reschedule", reschedule_url), ("Cancel session", cancel_url)])
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
            from tasks.email_notices import send_notice, app_url
            coach = activity.coach
            values = _session_notice_values(activity, dt, coach.first_name if coach else "", coach.full_name if coach else "")
            values["time_label"] = time_label
            send_notice(
                workspace, "coach_session_reminder", [coach_email], values,
                rows=_session_notice_rows(activity, dt),
                cta=("Open in CoachOS", app_url(f"/clients/{client.id}")),
            )
            logger.info(f"Coach reminder copy sent to {coach_email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_activity_reminder_email failed: {e}")
        _report_send_failure("send_activity_reminder_email", e, workspace=locals().get("workspace"), activity_id=activity_id)


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
            client_name=client.full_name, client_first_name=client.first_name,
            client_email=client.email or "", client_address=_format_address(client.primary_address),
            coach_name=coach_name,
            session_title=activity.title, session_time=dt,
            workspace_name=workspace.name,
        )
        tmpl = _get_activity_template(activity, "reschedule")
        custom_intro   = _apply_tmpl(tmpl.get("intro", ""),   **tmpl_vars)
        custom_closing = _apply_tmpl(tmpl.get("closing", ""), **tmpl_vars)
        subject = _apply_tmpl(tmpl.get("subject", ""), **tmpl_vars) or f"Updated: {activity.title} with {coach_name}"

        # Same reasoning as send_activity_confirmation_email above: always give the client
        # working Cancel/Reschedule links in CoachOS's own email rather than assuming a
        # (possibly-lapsed) Google Calendar connection will handle it.
        from apps.activities.tokens import make_session_token
        backend_url    = getattr(settings, "BACKEND_URL", "").rstrip("/")
        cancel_url     = f"{backend_url}/session/cancel/{make_session_token('cancel', str(activity.id))}/"
        reschedule_url = f"{backend_url}/session/reschedule/{make_session_token('reschedule', str(activity.id))}/"

        plain = _template_plain(custom_intro, custom_closing, [("Request reschedule", reschedule_url), ("Cancel session", cancel_url)])
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
            from tasks.email_notices import send_notice, app_url
            coach = activity.coach
            send_notice(
                workspace, "coach_session_updated", [coach_email],
                _session_notice_values(activity, dt, coach.first_name if coach else "", coach.full_name if coach else ""),
                rows=_session_notice_rows(activity, dt),
                cta=("Open in CoachOS", app_url(f"/clients/{client.id}")),
                attachments=[("invite.ics", ics_bytes, "text/calendar; method=PUBLISH")],
            )
            logger.info(f"Coach reschedule copy sent to {coach_email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_activity_reschedule_email failed: {e}")
        _report_send_failure("send_activity_reschedule_email", e, workspace=locals().get("workspace"), activity_id=activity_id)


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

        from tasks.email_notices import resolve_notice_template, send_notice, app_url
        tmpl      = resolve_notice_template(workspace, "cancellation")
        tmpl_vars = _session_notice_values(activity, dt)
        tmpl_vars.update(client_address=_format_address(client.primary_address),
                         session_date=activity.start_at.strftime("%b %d").replace(" 0", " "))
        custom_intro   = _apply_tmpl(tmpl.get("intro", ""),   **tmpl_vars)
        custom_closing = _apply_tmpl(tmpl.get("closing", ""), **tmpl_vars)
        subject        = _apply_tmpl(tmpl.get("subject", ""), **tmpl_vars)

        plain = _template_plain(custom_intro, custom_closing)
        html = build_cancellation_email(
            activity=activity,
            workspace_name=workspace.name,
            logo_url=_logo_src(workspace) if tmpl.get("show_logo", True) else "",
            coach_name=coach_name,
            coach_email=coach_email,
            dt_human=dt,
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
            to=[client.email],
        )
        msg.attach_alternative(html, "text/html")
        msg.attach("cancel.ics", ics_bytes, "text/calendar")
        msg.send()

        from apps.clients.models import EmailLog
        EmailLog.log(workspace=workspace, category=EmailLog.Category.ACTIVITY_CANCELLATION,
                     client=client, subject=subject, recipient_email=client.email,
                     related_id=activity_id, body_html=html)

        # ── Coach copy ──────────────────────────────────────────────────────────
        notify_email = coach_email or owner_email
        if notify_email:
            coach = activity.coach
            send_notice(
                workspace, "coach_session_cancelled", [notify_email],
                _session_notice_values(activity, dt, (coach.first_name if coach else "") or owner_name,
                                       (coach.full_name if coach else "") or owner_name),
                rows=_session_notice_rows(activity, dt, when_label="Was"),
                cta=("Open in CoachOS", app_url(f"/clients/{client.id}")),
                attachments=[("cancel.ics", ics_bytes, "text/calendar")],
            )
            logger.info(f"Coach cancellation copy sent to {notify_email} for activity {activity_id}")

        from django.utils import timezone
        Activity.objects.filter(pk=activity_id).update(cancellation_sent_at=timezone.now())
        logger.info(f"Cancellation email sent to {client.email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_activity_cancellation_email failed: {e}")
        _report_send_failure("send_activity_cancellation_email", e, workspace=locals().get("workspace"), activity_id=activity_id)


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
        _accent_color  = "#b8922e" if disable_style else (tmpl_style.get("accent_color") or "#b8922e")
        tmpl_vars = dict(
            client_name=invoice.client.full_name, client_first_name=invoice.client.first_name,
            client_email=invoice.client.email or "", client_address=_format_address(invoice.client.primary_address),
            workspace_name=workspace.name,
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
            # header_bg: see apps/settings_app/views.py's identical fix for why this is
            # ".get(key) or default" (empty-string safe) and defaults to white, not navy.
            header_bg="#1a2f4e" if disable_style else (tmpl_style.get("header_bg") or "#ffffff"),
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
                header_bg="#1a2f4e" if disable_style else (tmpl_style.get("header_bg") or "#ffffff"),
                accent_color=_accent_color, logo_img=_logo_img, workspace_name=workspace.name,
            ),
            body_radius="0 0 8px 8px" if (tmpl_style.get("show_header", True) and not disable_style) else "8px",
            heading_block=_invoice_heading_block(
                tmpl_style.get("show_heading", False) and not disable_style,
                heading_font_css="Georgia,'Times New Roman',serif" if disable_style else (_hf or "Georgia,'Times New Roman',serif"),
                workspace_name=workspace.name,
            ),
            # Defaults to False (was True) — see the matching preview-side comment in
            # apps/settings_app/views.py. The sign-off is now just editable body text
            # (USE_CASE_SAMPLE.invoice.closing), not a separate hardcoded block.
            signature_block=_invoice_signature_block(
                tmpl_style.get("show_signature", False) and not disable_style,
                workspace_name=workspace.name,
            ),
            closing_block=_invoice_closing_block(_apply_tmpl(tmpl.get("closing", ""), **tmpl_vars)),
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
            logo_url=_logo_url,
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
        # Re-raise (unlike the other email tasks in this file) — this one has callers
        # that mark an invoice "Sent" right after calling it. Swallowing the error here
        # let that happen unconditionally, so an invoice could show "Sent" in the UI
        # while the client never received anything.
        raise


def send_payment_receipt_email(invoice_id: str):
    from apps.invoicing.models import Invoice
    from tasks.email_html import build_payment_receipt_email
    try:
        invoice   = Invoice.objects.select_related("client", "coach", "workspace").get(id=invoice_id)
        workspace = invoice.workspace
        owner_email, owner_name = _owner_info(workspace)

        from django.utils import timezone
        last_payment = invoice.payments.order_by("-paid_at").first()
        payment_date = (last_payment.paid_at if last_payment else timezone.now()).strftime("%B %d, %Y")
        amount_paid  = f"{invoice.amount_paid:,.2f}"

        tmpl = _resolve_generic_template(workspace, "payment_receipt")
        tmpl_vars = dict(
            client_name=invoice.client.full_name, client_first_name=invoice.client.first_name,
            client_email=invoice.client.email or "", client_address=_format_address(invoice.client.primary_address),
            workspace_name=workspace.name,
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

        plain = _template_plain(custom_intro, custom_closing)
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
    from tasks.email_notices import send_notice, app_url
    try:
        invoice = Invoice.objects.select_related("client", "coach", "workspace").get(id=invoice_id)
        if not invoice.coach or not invoice.coach.email:
            return
        client = invoice.client
        send_notice(
            invoice.workspace, "payment_failed", [invoice.coach.email],
            dict(recipient_first_name=invoice.coach.first_name or invoice.coach.full_name,
                 recipient_name=invoice.coach.full_name,
                 client_name=client.full_name, client_first_name=client.first_name,
                 invoice_number=invoice.number, amount=str(invoice.total)),
            rows=[("Invoice", f"#{invoice.number}"), ("Amount", f"${invoice.total}"), ("Client", client.full_name)],
            cta=("Open invoice", app_url(f"/invoices/{invoice.id}")),
        )
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


def send_pipeline_alert(deal_id: str, recipient: str = "owner") -> bool:
    """Send the internal pipeline follow-up alert ("pipeline" template) to the workspace
    owner (recipient="owner") or the deal's assigned coach (recipient="coach"). Who and
    how often is decided by tasks.pipeline.dispatch_pipeline_alerts. The client never
    gets this one — they get send_pipeline_client_checkin instead. Returns True if sent."""
    from apps.pipeline.models import Deal, PipelineStageConfig
    from django.utils import timezone as dj_tz
    from django.core.mail import EmailMultiAlternatives
    from tasks.email_html import build_pipeline_alert_email
    try:
        deal      = Deal.objects.select_related("workspace", "client", "coach").get(id=deal_id)
        workspace = deal.workspace
        client    = deal.client
        owner_email, owner_name = _owner_info(workspace)
        if recipient == "coach":
            if not deal.coach or not deal.coach.email:
                return False
            # {owner_name} in the template is the greeting name — the coach's, here.
            to_email, owner_name = deal.coach.email, deal.coach.full_name
        else:
            to_email = owner_email
        if not to_email:
            return False

        try:
            cfg = PipelineStageConfig.objects.get(workspace=workspace, slug=deal.stage)
        except PipelineStageConfig.DoesNotExist:
            return False

        stage_label   = cfg.label
        stage_color   = cfg.color or "#1a2f4e"
        days_in_stage = (dj_tz.now() - deal.stage_changed_at).days
        client_name   = f"{client.first_name} {client.last_name}".strip()
        deal_value    = f"${deal.deal_value:,.0f}" if deal.deal_value else "—"
        stage_entered = deal.stage_changed_at.strftime("%B %d, %Y")
        logo_url      = _logo_src(workspace)
        pipeline_url  = f"{getattr(settings, 'FRONTEND_URL', '').rstrip('/')}/pipeline"

        tmpl_vars = dict(
            owner_name=owner_name, client_name=client_name, client_first_name=client.first_name,
            client_email=client.email or "", client_address=_format_address(client.primary_address),
            stage_label=stage_label,
            days_in_stage=days_in_stage, follow_up_days=cfg.follow_up_days,
            deal_value=deal_value, stage_entered=stage_entered, workspace_name=workspace.name,
        )
        tmpl = _get_pipeline_template(workspace)
        custom_intro   = _apply_tmpl(tmpl.get("intro", ""),   **tmpl_vars)
        custom_closing = _apply_tmpl(tmpl.get("closing", ""), **tmpl_vars)
        subject = _apply_tmpl(tmpl.get("subject", ""), **tmpl_vars) or (
            f"Follow-up needed: {client_name} — {stage_label} ({days_in_stage} days)"
        )

        plain_body = _template_plain(custom_intro, custom_closing, [("View your pipeline", pipeline_url)]) if custom_intro else (
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

        msg = EmailMultiAlternatives(
            subject=subject,
            body=plain_body,
            from_email=_workspace_from_email(workspace),
            to=[to_email],
        )
        msg.attach_alternative(html_body, "text/html")
        msg.send()
        logger.info(f"Pipeline alert sent to {recipient} for deal {deal_id} ({stage_label})")
        return True
    except Exception as e:
        logger.error(f"send_pipeline_alert failed for deal {deal_id}: {e}")
        return False


def send_pipeline_client_checkin(deal_id: str) -> bool:
    """The client-facing follow-up for a deal that's been sitting in a stage — a friendly
    check-in ("pipeline_client" template, Settings → Emails), never the internal alert.
    Replies go to the deal's coach (or the owner)."""
    from apps.pipeline.models import Deal
    from tasks.email_notices import send_notice
    try:
        deal = Deal.objects.select_related("workspace", "client", "coach").get(id=deal_id)
        client, workspace = deal.client, deal.workspace
        if not client.email:
            return False
        owner_email, owner_name = _owner_info(workspace)
        coach = deal.coach or client.coach
        send_notice(
            workspace, "pipeline_client", [client.email],
            dict(client_name=client.full_name, client_first_name=client.first_name,
                 coach_name=coach.full_name if coach else (owner_name or workspace.name)),
            reply_to=[(coach.email if coach else "") or owner_email],
        )
        logger.info(f"Pipeline client check-in sent for deal {deal_id}")
        return True
    except Exception as e:
        logger.error(f"send_pipeline_client_checkin failed for deal {deal_id}: {e}")
        return False


# ── Client session action notifications ────────────────────────────────────────
# All template-driven via tasks/email_notices.py (Settings → Generic Templates).

def _coach_notice(activity_id: str, key: str, task_name: str, extra_values: dict = None):
    """Shared body for the "client did X" notices to the session's coach."""
    from apps.activities.models import Activity
    from tasks.email_notices import send_notice, app_url
    try:
        activity = Activity.objects.select_related("client", "coach", "workspace").get(id=activity_id)
        coach = activity.coach
        if not coach or not coach.email:
            return
        workspace = activity.workspace
        dt = _fmt_dt_human(activity.start_at, getattr(workspace, "workspace_timezone", ""))
        values = _session_notice_values(activity, dt, coach.first_name, coach.full_name)
        values.update(extra_values or {})
        send_notice(workspace, key, [coach.email], values,
                    rows=_session_notice_rows(activity, dt, include_client=False),
                    cta=("Open in CoachOS", app_url(f"/clients/{activity.client_id}")))
        logger.info(f"{key} sent to coach {coach.email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"{task_name} failed: {e}")
        _report_send_failure(task_name, e, workspace=locals().get("workspace"), activity_id=activity_id)


def send_client_confirmation_notice(activity_id: str):
    """Email the coach when a client confirms attendance via their email link."""
    _coach_notice(activity_id, "client_confirmed_notice", "send_client_confirmation_notice")


@shared_task(name="tasks.email.send_client_cancellation_notice")
def send_client_cancellation_notice(activity_id: str):
    """Email the coach when a client cancels via their email link."""
    _coach_notice(activity_id, "client_cancelled_notice", "send_client_cancellation_notice")


@shared_task(name="tasks.email.send_client_rsvp_notice")
def send_client_rsvp_notice(activity_id: str, response_status: str):
    """Email the coach when a client accepts/declines/tentatively-RSVPs the Google Calendar invite."""
    verb = {"accepted": "accepted", "declined": "declined", "tentative": "tentatively accepted"}.get(
        response_status, response_status
    )
    _coach_notice(activity_id, "client_rsvp_notice", "send_client_rsvp_notice", {"rsvp_verb": verb})


@shared_task(name="tasks.email.send_client_reschedule_request")
def send_client_reschedule_request(activity_id: str, message: str = ""):
    """Email the coach (and business owner as fallback) when a client requests a reschedule."""
    from apps.activities.models import Activity
    from tasks.email_notices import send_notice, app_url
    try:
        activity = Activity.objects.select_related("client", "coach", "workspace").get(id=activity_id)
        workspace    = activity.workspace
        client_email = activity.client.email or ""
        tz_name      = getattr(workspace, "workspace_timezone", "")
        dt           = _fmt_dt_human(activity.start_at, tz_name)
        requested_dt = _fmt_dt_human(activity.requested_start_at, tz_name) if activity.requested_start_at else ""

        # Notify assigned coach; fall back to business owner
        coach = activity.coach
        if coach and coach.email:
            recipient_email, recipient_first, recipient_full = coach.email, coach.first_name, coach.full_name
        else:
            owner_email, owner_name = _owner_info(workspace)
            if not owner_email:
                logger.warning(f"No recipient for reschedule notice on activity {activity_id}")
                return
            recipient_email, recipient_first, recipient_full = owner_email, "", owner_name or workspace.name

        values = _session_notice_values(activity, dt, recipient_first, recipient_full)
        values.update(proposed_time=requested_dt or "No specific time proposed", message=message or "")
        send_notice(
            workspace, "reschedule_request", [recipient_email], values,
            rows=_session_notice_rows(activity, dt, when_label="Current", include_client=False)
                 + [("Proposed", requested_dt), ("Message", message)],
            cta=("Review in CoachOS", app_url(f"/clients/{activity.client_id}")),
            reply_to=[client_email],
        )
        logger.info(f"Reschedule request sent to {recipient_email} for activity {activity_id}")

        # ── Acknowledge to client ───────────────────────────────────────────────
        if client_email:
            send_notice(
                workspace, "reschedule_ack", [client_email], values,
                rows=[("What", activity.title), ("Current", dt), ("Proposed", requested_dt)],
                reply_to=[recipient_email],
            )
            logger.info(f"Reschedule acknowledgement sent to {client_email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_client_reschedule_request failed: {e}")


@shared_task(name="tasks.email.send_decline_reschedule_email")
def send_decline_reschedule_email(activity_id: str, message: str):
    """Email the client the coach's own message when declining their proposed time
    (apps.activities.views.ActivityViewSet.decline_reschedule — calendar.md §7.3/§9.2
    Task 4). Only ever fires when the coach has written something themselves and
    explicitly opted into sending it — the view never calls this with an empty message
    or without that opt-in. The coach's text fills {message} in the "decline_reschedule"
    template, so the wrapper around it (greeting, sign-off, branding) is editable too."""
    from apps.activities.models import Activity
    from apps.clients.models import EmailLog
    from tasks.email_notices import send_notice
    try:
        activity = Activity.objects.select_related("client", "coach", "workspace").get(id=activity_id)
        client = activity.client
        if not client.email:
            return

        workspace = activity.workspace
        dt        = _fmt_dt_human(activity.start_at, getattr(workspace, "workspace_timezone", ""))
        values    = _session_notice_values(activity, dt)
        values["message"] = message
        send_notice(
            workspace, "decline_reschedule", [client.email], values,
            reply_to=[activity.coach.email] if activity.coach and activity.coach.email else [],
            log=dict(category=EmailLog.Category.CLIENT_MESSAGE, client=client, related_id=activity_id),
        )
        logger.info(f"Decline message sent to {client.email} for activity {activity_id}")
    except Exception as e:
        logger.error(f"send_decline_reschedule_email failed: {e}")


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

        tmpl      = _resolve_generic_template(workspace, "portal_invite")
        tmpl_vars = dict(
            client_name=client.full_name, client_first_name=client.first_name,
            client_email=client.email or "", client_address=_format_address(client.primary_address),
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

    owner_email, owner_name = _owner_info(workspace)
    # Falls back to the workspace owner, not the client's assigned coach — a Client
    # Communication message reads as coming from the practice, and should default the
    # same way regardless of which team member actually composed/sent it.
    coach_name = draft.signature_name.strip() or owner_name or workspace.name
    logo_url = _logo_src(workspace) if draft.show_logo else ""

    # Generic-template samples (and any coach-written draft) may contain {client_name} /
    # {coach_name} / {workspace_name} / {workspace_owner} / {client_email} / {client_address}
    # placeholders — substitute them here since this is the only place client_communication
    # content actually gets sent (the Settings preview substitutes for display only and never
    # persists back into the draft). {client_name} is first-name-only here (a greeting reads
    # "Hi {client_name}," so the full legal name would be stilted) — distinct from the
    # client_name=client.full_name passed to build_client_communication_email() below, which
    # is unrelated template metadata, not this placeholder.
    tmpl_vars = dict(client_name=client.first_name, coach_name=coach_name, workspace_name=workspace.name,
                      workspace_owner=owner_name or workspace.name, client_email=client.email or "",
                      client_address=_format_address(client.primary_address))
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
    from tasks.email_notices import send_notice, app_url
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

        title      = draft.subject or "Agreement"
        signed_str = draft.client_signed_at.strftime("%B %d, %Y at %I:%M %p") if draft.client_signed_at else ""
        send_notice(
            workspace, "contract_signed", sorted(to_addrs),
            dict(client_name=client.full_name, client_first_name=client.first_name,
                 document_title=title, signed_at=signed_str),
            rows=[("Document", title), ("Client", client.full_name), ("Signed", signed_str)],
            cta=("Open client", app_url(f"/clients/{client.id}")),
        )
        logger.info(f"Contract-signed notice sent for draft {draft_id}")
    except Exception as e:
        logger.error(f"send_contract_signed_notice failed: {e}")


@shared_task(name="tasks.email.send_goal_shared_email")
def send_goal_shared_email(goal_id: str):
    """Notifies the client that their coach shared a new goal — triggered from
    ClientGoalViewSet.perform_update the moment visible_to_client flips False -> True.
    Sharing itself only ever set that flag with no other side effect; nothing told the
    client it happened until they next logged into their portal on their own."""
    from apps.clients.models import ClientGoal, EmailLog
    from tasks.email_notices import send_notice, app_url
    try:
        goal = ClientGoal.objects.select_related("client", "client__workspace", "client__coach").get(id=goal_id)
        client = goal.client
        workspace = client.workspace
        if not client.email:
            return

        portal_url      = app_url("/client-portal")
        coach_name      = client.coach.full_name if client.coach else workspace.name
        target_date_str = goal.target_date.strftime("%B %d, %Y") if goal.target_date else ""
        send_notice(
            workspace, "goal_shared", [client.email],
            dict(client_name=client.full_name, client_first_name=client.first_name,
                 coach_name=coach_name, goal_title=goal.title, target_date=target_date_str,
                 portal_url=portal_url),
            rows=[("Goal", goal.title), ("Details", goal.description or ""), ("Target date", target_date_str)],
            cta=("View in your portal", portal_url),
            log=dict(category=EmailLog.Category.GOAL_SHARED, client=client, related_id=goal_id),
        )
        logger.info(f"Goal-shared email sent to {client.email} for goal {goal_id}")
    except Exception as e:
        logger.error(f"send_goal_shared_email failed: {e}")


def _note_preview_text(text: str, limit: int = 400) -> str:
    """Session notes are stored as free text, or as a JSON blob behind a
    "##STRUCTURED##" prefix (see frontend's parseStructured) holding
    {notes, reflection, commitment}. Pull something readable out of either
    shape for the notification email, rather than showing raw JSON."""
    import json
    prefix = "##STRUCTURED##"
    if text.startswith(prefix):
        try:
            data = json.loads(text[len(prefix):])
            preview = (data.get("notes") or data.get("reflection") or data.get("commitment") or "").strip()
        except Exception:
            preview = ""
    else:
        preview = (text or "").strip()
    if len(preview) > limit:
        preview = preview[:limit].rstrip() + "…"
    return preview


@shared_task(name="tasks.email.send_note_shared_email")
def send_note_shared_email(note_id: str):
    """Notifies the client that their coach shared a note — triggered from
    ClientNoteViewSet the moment visible_to_client flips False -> True, on
    either create or update. Mirrors send_goal_shared_email above."""
    from apps.clients.models import ClientNote, EmailLog
    from tasks.email_notices import send_notice, app_url
    try:
        note = ClientNote.objects.select_related("client", "client__workspace", "client__coach").get(id=note_id)
        client = note.client
        workspace = client.workspace
        if not client.email:
            return

        portal_url       = app_url("/client-portal")
        coach_name       = client.coach.full_name if client.coach else workspace.name
        topic            = (note.topic or "").strip() or "Session Note"
        session_date_str = note.session_date.strftime("%B %d, %Y") if note.session_date else ""
        send_notice(
            workspace, "note_shared", [client.email],
            dict(client_name=client.full_name, client_first_name=client.first_name,
                 coach_name=coach_name, note_topic=topic, session_date=session_date_str,
                 portal_url=portal_url),
            rows=[("Topic", topic), ("Note", _note_preview_text(note.text)), ("Session date", session_date_str)],
            cta=("View in your portal", portal_url),
            log=dict(category=EmailLog.Category.NOTE_SHARED, client=client, related_id=note_id),
        )
        logger.info(f"Note-shared email sent to {client.email} for note {note_id}")
    except Exception as e:
        logger.error(f"send_note_shared_email failed: {e}")


@shared_task(name="tasks.email.send_error_alert_email")
def send_error_alert_email(error_log_id):
    """Fires immediately from apps.accounts.error_logging.capture_error whenever a real
    (non-warning) error is captured — a live paying customer hitting an error with no
    one watching the super-admin dashboard is exactly the case this exists for. Emails
    every platform_admin the same troubleshooting context the Error Log tab shows:
    the stack trace plus whatever the affected user was doing right before it happened."""
    from apps.accounts.models import ErrorLog, User
    from apps.audit.utils import recent_actions_for
    try:
        entry = ErrorLog.objects.select_related("user", "workspace").get(id=error_log_id)
        if entry.severity == "warning":
            return
        to_addrs = list(User.objects.filter(role="platform_admin").exclude(email="").values_list("email", flat=True))
        if not to_addrs:
            logger.warning("send_error_alert_email: no platform_admin recipients configured")
            return

        actions = recent_actions_for(entry.user, entry.workspace, entry.created_at)
        actions_block = "\n".join(
            f"  {a['created_at'].strftime('%H:%M:%S')}  {a['action']}"
            f"{' — ' + a['client_name'] if a['client_name'] else ''}"
            f"{' (' + ', '.join(f'{k}={v}' for k, v in a['metadata'].items()) + ')' if a['metadata'] else ''}"
            for a in actions
        ) or "  (no prior actions recorded for this user)"

        subject = f"[CoachOS {entry.severity.upper()}] {entry.error_type} — {entry.workspace.name if entry.workspace else 'no workspace'}"
        body = (
            f"{entry.severity.upper()} in {entry.source} at {entry.created_at.strftime('%Y-%m-%d %H:%M:%S %Z')}\n\n"
            f"Workspace: {entry.workspace.name if entry.workspace else '—'}\n"
            f"User:      {entry.user.full_name if entry.user else '—'} ({entry.user.email if entry.user else '—'})\n"
            f"Endpoint:  {entry.endpoint or '—'}\n"
            f"Error:     {entry.error_type}: {entry.message}\n\n"
            f"User's actions leading up to this:\n{actions_block}\n\n"
            f"Traceback:\n{entry.traceback or '(none captured)'}\n"
        )
        msg = EmailMessage(
            subject=subject, body=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=to_addrs,
        )
        msg.send()
    except Exception as e:
        # Must never raise — this runs inline in capture_error, itself inline in the
        # request/exception-handling path of the very error being reported.
        logger.error(f"send_error_alert_email failed: {e}")


@shared_task(name="tasks.email.send_portal_login_code_email")
def send_portal_login_code_email(client_id: str, code: str, minutes_valid: int = 10):
    """Send the 6-digit portal sign-in code. Deliberately not routed through
    _resolve_generic_template/EmailLog like the other client-facing sends — this is a
    security code, not a brand message, and logging the plaintext code into the
    Email Communications log would hand any coach/team member on the workspace a live
    credential for the client's account during its validity window."""
    from apps.clients.models import Client
    from tasks.email_html import build_portal_login_code_email
    try:
        client    = Client.objects.select_related("workspace").get(id=client_id)
        workspace = client.workspace
        if not client.email:
            return

        owner_email, owner_name = _owner_info(workspace)
        html = build_portal_login_code_email(
            client_name=client.full_name,
            workspace_name=workspace.name,
            code=code,
            minutes_valid=minutes_valid,
            logo_url=_logo_src(workspace),
            owner_email=owner_email,
            owner_name=owner_name,
        )
        plain = (
            f"Your {workspace.name} portal login code is: {code}\n\n"
            f"This code expires in {minutes_valid} minutes and can only be used once. "
            f"If you didn't request it, you can ignore this email."
        )
        msg = EmailMultiAlternatives(
            subject=f"Your portal login code: {code}",
            body=plain,
            from_email=_workspace_from_email(workspace),
            to=[client.email],
        )
        msg.attach_alternative(html, "text/html")
        msg.send()
        logger.info(f"Portal login code sent to client {client_id}")
    except Exception as e:
        logger.error(f"send_portal_login_code_email failed: {e}")
        _report_send_failure("send_portal_login_code_email", e, workspace=locals().get("workspace"))
