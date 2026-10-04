"""CoachOS — template-driven "notice" emails.

Every email that used to be a hardcoded plain-text message (the coach's copy of a
booking/update/cancellation, client-action notices to the coach, reschedule request and
acknowledgement, decline-reschedule, goal/note shared, payment failed, contract signed)
now goes through here, so each one:

  * is an assignable use case in Settings → Generic Templates (NOTICES is the registry,
    and is also served to the frontend via apps.settings_app.views.email_use_cases so
    the editor's defaults/placeholders never drift from what actually sends), and
  * renders in the same branded shell as every other email — white header + logo by
    default — with every visible piece editable (see compose_body in email_html.py).

A use case with no template assigned sends NOTICES' built-in copy, so nothing changes
for a workspace until a coach chooses to customize it.
"""
import html as _html
import logging

from django.conf import settings

logger = logging.getLogger(__name__)

_SESSION = ["{client_name}", "{client_first_name}", "{client_email}", "{coach_name}",
            "{workspace_name}", "{session_title}", "{session_time}"]
_TO_COACH = ["{recipient_name}", "{recipient_first_name}"]

# audience: who receives it — "client" or "coach" (coach/owner of the workspace).
NOTICES: dict[str, dict] = {
    # ── Sent to the client ────────────────────────────────────────────────────
    "cancellation": dict(
        label="Session Cancelled", audience="client",
        subject="Cancelled: {session_title} on {session_date}",
        eyebrow="Session Cancelled", heading="Your session has been cancelled",
        intro="Hi {client_first_name}, we're writing to let you know that the following session has been cancelled. A calendar update has been attached to this email.",
        closing="To reschedule or book a new session, please contact {coach_name} directly.",
        placeholders=_SESSION + ["{session_date}"],
    ),
    "reschedule_ack": dict(
        label="Reschedule Request Received", audience="client",
        subject="Reschedule request received — {session_title}",
        eyebrow="Request Received", heading="We got your reschedule request",
        intro="Hi {client_first_name},\n\nYour reschedule request has been received and forwarded to {coach_name}.",
        closing="They will reach out to confirm the new time. If you need to follow up, just reply to this email.",
        placeholders=_SESSION + ["{proposed_time}"],
    ),
    "decline_reschedule": dict(
        label="Reschedule Declined", audience="client",
        subject="Re: rescheduling {session_title}",
        eyebrow="Reschedule Request", heading="About your reschedule request",
        intro="Hi {client_first_name},\n\n{message}",
        closing="", signoff="— {coach_name}",
        placeholders=_SESSION + ["{message}"],
    ),
    "goal_shared": dict(
        label="Goal Shared", audience="client",
        subject="New goal shared — {workspace_name}",
        eyebrow="New Goal", heading="A new goal for you",
        intro="Hi {client_first_name},\n\n{coach_name} shared a new goal with you.",
        closing="Questions? Just reply to this email.",
        placeholders=["{client_name}", "{client_first_name}", "{coach_name}", "{workspace_name}",
                      "{goal_title}", "{target_date}", "{portal_url}"],
    ),
    "note_shared": dict(
        label="Note Shared", audience="client",
        subject="New note shared — {workspace_name}",
        eyebrow="New Note", heading="Your coach shared a note",
        intro="Hi {client_first_name},\n\n{coach_name} shared a note with you.",
        closing="Questions? Just reply to this email.",
        placeholders=["{client_name}", "{client_first_name}", "{coach_name}", "{workspace_name}",
                      "{note_topic}", "{session_date}", "{portal_url}"],
    ),
    "pipeline_client": dict(
        label="Pipeline Check-in", audience="client",
        subject="Checking in — {workspace_name}",
        eyebrow="Checking In", heading="Just checking in",
        intro="Hi {client_first_name},\n\nJust checking in to see if you have any questions, or would like to take the next step with {coach_name}.",
        closing="Simply reply to this email — we'd love to hear from you.",
        placeholders=["{client_name}", "{client_first_name}", "{coach_name}", "{workspace_name}"],
    ),
    # ── Sent to the coach ─────────────────────────────────────────────────────
    "coach_session_booked": dict(
        label="Coach Copy — Session Booked", audience="coach",
        subject="Session booked: {session_title} with {client_name}",
        eyebrow="Session Booked", heading="New session on your calendar",
        intro="Hi {recipient_first_name},\n\nA session has been scheduled with your client {client_name}. A calendar invite is attached.",
        closing="",
        placeholders=_TO_COACH + _SESSION,
    ),
    "coach_session_reminder": dict(
        label="Coach Copy — Session Reminder", audience="coach",
        subject="Reminder: {session_title} with {client_name} in {time_label}",
        eyebrow="Coming Up", heading="Session in {time_label}",
        intro="Hi {recipient_first_name},\n\nReminder: you have a session with {client_name} in {time_label}.",
        closing="",
        placeholders=_TO_COACH + _SESSION + ["{time_label}"],
    ),
    "coach_session_updated": dict(
        label="Coach Copy — Session Updated", audience="coach",
        subject="Session updated: {session_title} with {client_name}",
        eyebrow="Session Updated", heading="Session rescheduled",
        intro="Hi {recipient_first_name},\n\nThe following session with {client_name} has been rescheduled and the client has been notified.",
        closing="",
        placeholders=_TO_COACH + _SESSION,
    ),
    "coach_session_cancelled": dict(
        label="Coach Copy — Session Cancelled", audience="coach",
        subject="Session cancelled: {session_title} with {client_name}",
        eyebrow="Session Cancelled", heading="Session cancelled",
        intro="Hi {recipient_first_name},\n\nThe following session with {client_name} has been cancelled and the client has been notified.",
        closing="",
        placeholders=_TO_COACH + _SESSION,
    ),
    "client_confirmed_notice": dict(
        label="Client Confirmed Attendance", audience="coach",
        subject="{client_name} confirmed attendance",
        eyebrow="Client Confirmed", heading="{client_first_name} confirmed",
        intro="Hi {recipient_first_name},\n\n{client_name} has confirmed their attendance. The session is marked as confirmed in CoachOS.",
        closing="",
        placeholders=_TO_COACH + _SESSION,
    ),
    "client_cancelled_notice": dict(
        label="Client Cancelled Session", audience="coach",
        subject="Session cancelled by {client_name}",
        eyebrow="Client Cancelled", heading="{client_first_name} cancelled a session",
        intro="Hi {recipient_first_name},\n\n{client_name} has cancelled their session. It has been marked as cancelled in CoachOS.",
        closing="",
        placeholders=_TO_COACH + _SESSION,
    ),
    "client_rsvp_notice": dict(
        label="Client Calendar RSVP", audience="coach",
        subject="{client_name} {rsvp_verb} the calendar invite",
        eyebrow="Calendar RSVP", heading="{client_first_name} {rsvp_verb} the invite",
        intro="Hi {recipient_first_name},\n\n{client_name} has {rsvp_verb} the calendar invite for this session.",
        closing="",
        placeholders=_TO_COACH + _SESSION + ["{rsvp_verb}"],
    ),
    "reschedule_request": dict(
        label="Client Reschedule Request", audience="coach",
        subject="Reschedule request from {client_name}",
        eyebrow="Reschedule Request", heading="{client_first_name} wants to reschedule",
        intro="Hi {recipient_first_name},\n\n{client_name} has asked to reschedule their session.",
        closing="Open the session in CoachOS to confirm the new time, or reply to {client_email}. Nothing changes on your calendar until you confirm.",
        placeholders=_TO_COACH + _SESSION + ["{proposed_time}", "{message}"],
    ),
    "payment_failed": dict(
        label="Payment Failed", audience="coach",
        subject="Payment failed — Invoice #{invoice_number}",
        eyebrow="Payment Failed", heading="A payment didn't go through",
        intro="Hi {recipient_first_name},\n\nA payment attempt for invoice #{invoice_number} (${amount}) from {client_name} failed.",
        closing="You may want to follow up with {client_first_name} or resend the invoice.",
        placeholders=_TO_COACH + ["{client_name}", "{client_first_name}", "{workspace_name}",
                                  "{invoice_number}", "{amount}"],
    ),
    "contract_signed": dict(
        label="Contract Signed", audience="coach",
        subject="Signed: {document_title} — {client_name}",
        eyebrow="Contract Signed", heading="{client_first_name} signed {document_title}",
        intro="{client_name} has signed \"{document_title}\" on {signed_at}.\n\nA copy of the signed document has been saved to their Files.",
        closing="",
        placeholders=["{client_name}", "{client_first_name}", "{workspace_name}",
                      "{document_title}", "{signed_at}"],
    ),
}


def resolve_notice_template(workspace, key: str) -> dict:
    """The coach's assigned template for this notice (Settings → Generic Templates) if
    there is one, else NOTICES' built-in copy. A customized template's closing is used
    as-is even when blank — a coach clearing it means "no closing", not "use default"."""
    from tasks.email import _resolve_generic_template
    default = NOTICES[key]
    tmpl = _resolve_generic_template(workspace, key) if workspace is not None else {}
    if not tmpl:
        return dict(subject=default["subject"], intro=default["intro"], closing=default["closing"],
                    show_logo=True, style={})
    return dict(
        subject=tmpl.get("subject") or default["subject"],
        intro=tmpl.get("intro") or default["intro"],
        closing=tmpl.get("closing", ""),
        show_logo=tmpl.get("show_logo", True),
        style=tmpl.get("style") or {},
    )


def render_notice(workspace, key: str, values: dict, *, rows=None, cta=None, tmpl: dict = None,
                  logo_url: str = None, owner_email: str = "", owner_name: str = "") -> tuple:
    """→ (subject, html, plain). `rows` is [(label, plain_value), ...] — values are
    escaped here; `cta` is (label, url) or None. `tmpl` overrides the resolved template
    (used by the live preview in Settings)."""
    from tasks.email_html import (compose_body, shell_from_style, fill_placeholders,
                                  has_legacy_html, _cta_button)
    default = NOTICES[key]
    tmpl = tmpl if tmpl is not None else resolve_notice_template(workspace, key)
    style = dict(tmpl.get("style") or {})
    workspace_name = values.get("workspace_name", "")

    # Values can carry client-typed text (e.g. a reschedule note) — escape them whenever
    # the template itself is legacy HTML (rendered raw); plain-text templates are escaped
    # as a whole by compose_body, so they get raw values here to avoid double-escaping.
    def fill(text):
        if has_legacy_html(text):
            return fill_placeholders(text, {k: _html.escape(str(v)) for k, v in values.items()})
        return fill_placeholders(text, values)

    subject = fill_placeholders(tmpl.get("subject") or default["subject"], values)
    intro   = fill(tmpl.get("intro") or "")
    closing = fill(tmpl.get("closing") or "")
    rows    = [(label, value) for label, value in (rows or []) if value]
    accent  = style.get("accent_color") or "#b8922e"

    actions = ""
    if cta and cta[1]:
        actions = f'<div style="margin:28px 0 4px;">{_cta_button(_html.escape(cta[0]), cta[1], "#1a2f4e")}</div>'

    body = compose_body(
        style, eyebrow=default["eyebrow"], heading=default["heading"],
        eyebrow_color="#c0392b" if "cancel" in key or key == "payment_failed" else accent,
        intro=intro, closing=closing, workspace_name=workspace_name,
        details_rows=[(label, _html.escape(str(value)).replace("\n", "<br>")) for label, value in rows],
        actions_html=actions, values=values, default_signoff=default.get("signoff", ""),
    )
    if logo_url is None:
        from tasks.email import _logo_src
        logo_url = _logo_src(workspace) if tmpl.get("show_logo", True) else ""
    html = shell_from_style(body, style, workspace_name=workspace_name, logo_url=logo_url,
                            owner_email=owner_email, owner_name=owner_name)

    plain_parts = [intro]
    if rows and style.get("show_details", True) not in (False, "0", "false"):
        plain_parts.append("\n".join(f"  {label}: {value}" for label, value in rows))
    if cta and cta[1]:
        plain_parts.append(f"{cta[0]}: {cta[1]}")
    if closing:
        plain_parts.append(closing)
    if style.get("show_signature", True) not in (False, "0", "false"):
        plain_parts.append(fill_placeholders(style.get("signoff_text") or default.get("signoff") or f"— {workspace_name}", values))
    plain = "\n\n".join(p.strip() for p in plain_parts if p and p.strip())
    if has_legacy_html(plain):
        import re
        plain = re.sub(r"<br\s*/?>", "\n", plain, flags=re.IGNORECASE)
        plain = re.sub(r"<[^>]+>", "", plain)
    return subject, html, plain


def send_notice(workspace, key: str, to: list, values: dict, *, rows=None, cta=None,
                reply_to=None, attachments=None, log: dict = None) -> str:
    """Render + send one notice. `attachments` is [(filename, bytes, mimetype), ...];
    `log` (category/client/related_id) records it in the client's EmailLog. Returns the
    subject actually sent."""
    from django.core.mail import EmailMultiAlternatives
    from tasks.email import _workspace_from_email, _owner_info
    owner_email, owner_name = _owner_info(workspace)
    values = {"workspace_name": workspace.name, **values}
    subject, html, plain = render_notice(workspace, key, values, rows=rows, cta=cta,
                                         owner_email=owner_email, owner_name=owner_name)
    msg = EmailMultiAlternatives(subject=subject, body=plain, from_email=_workspace_from_email(workspace),
                                 to=[t for t in to if t], reply_to=[r for r in (reply_to or []) if r])
    msg.attach_alternative(html, "text/html")
    for filename, content, mime in attachments or []:
        msg.attach(filename, content, mime)
    msg.send()
    if log:
        from apps.clients.models import EmailLog
        EmailLog.log(workspace=workspace, category=log["category"], client=log.get("client"),
                     subject=subject, recipient_email=", ".join(t for t in to if t),
                     related_id=log.get("related_id", ""), body_html=html)
    return subject


def app_url(path: str = "") -> str:
    return f"{getattr(settings, 'FRONTEND_URL', '').rstrip('/')}{path}"
