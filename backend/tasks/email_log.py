"""CoachOS — the one place every workspace email is sent and logged.

Every send path in tasks/email.py and tasks/email_notices.py calls send_logged()
instead of msg.send(), so each email — to a client, to the coach/owner, or to an
invited team member — lands in EmailLog (Email Communication page) with its type,
recipient group and outcome. A failed send is logged as "failed" with the error, then
re-raised so the caller's own error handling (and ErrorLog reporting) still runs.

Deliberately NOT routed through here: portal login codes and password resets (they
carry one-time secrets that shouldn't be stored), and platform-admin mail (feedback
tickets, error alerts, site-health) — not workspace email.

capture_emails() runs real send code in "dry-run" mode for previews: messages are
collected instead of sent, and nothing is logged.
"""
import contextvars
import logging
from contextlib import contextmanager

logger = logging.getLogger(__name__)

# Email type key → (label, audience). Keys match Settings → Emails; notice types
# (tasks/email_notices.NOTICES) are added from that registry in type_info().
_BASE_TYPES = {
    "confirmation":         ("Session Confirmation", "client"),
    "reschedule":           ("Session Rescheduled", "client"),
    "reminder_24h":         ("24h Session Reminder", "client"),
    "reminder_1h":          ("1h Session Reminder", "client"),
    "invoice":              ("Invoice", "client"),
    "payment_receipt":      ("Payment Receipt", "client"),
    "portal_invite":        ("Portal Invite", "client"),
    "client_communication": ("Client Message", "client"),
    "team_invite":          ("Team Invite", "team"),
    "pipeline":             ("Pipeline Follow-up", "coach"),
}

# Older coarse category, still filled in so existing filters keep working.
_LEGACY_CATEGORY = {
    "invoice": "invoice", "payment_receipt": "payment_receipt",
    "confirmation": "activity_confirmation", "reminder_24h": "activity_reminder",
    "reminder_1h": "activity_reminder", "reschedule": "activity_reschedule",
    "cancellation": "activity_cancellation", "client_communication": "client_message",
    "decline_reschedule": "client_message", "portal_invite": "portal_invite",
    "goal_shared": "goal_shared", "note_shared": "note_shared",
}


def type_info(use_case: str) -> tuple:
    """→ (label, audience) for an email type key."""
    if use_case in _BASE_TYPES:
        return _BASE_TYPES[use_case]
    from tasks.email_notices import NOTICES
    if use_case in NOTICES:
        return NOTICES[use_case]["label"], NOTICES[use_case]["audience"]
    return use_case.replace("_", " ").title(), "client"


_capture: contextvars.ContextVar = contextvars.ContextVar("email_capture", default=None)


@contextmanager
def capture_emails():
    """Collect messages instead of sending them (and skip logging) — for previews that
    run the real send code. Yields a list of {subject, to, html, text}."""
    captured: list = []
    token = _capture.set(captured)
    try:
        yield captured
    finally:
        _capture.reset(token)


def _html_of(msg) -> str:
    for content, mimetype in getattr(msg, "alternatives", []) or []:
        if mimetype == "text/html":
            return content
    return getattr(msg, "_html", "") or ""     # _InvoiceEmail keeps its HTML here


def send_logged(msg, *, workspace, use_case: str, client=None, related_id="", audience: str = None):
    """Send `msg` and record it in EmailLog (sent or failed). Re-raises on failure."""
    captured = _capture.get()
    if captured is not None:
        captured.append({"subject": msg.subject, "to": list(msg.to), "html": _html_of(msg), "text": msg.body})
        return

    from apps.clients.models import EmailLog
    label_audience = audience or type_info(use_case)[1]

    def record(status, error=""):
        try:
            EmailLog.objects.create(
                workspace=workspace, client=client,
                use_case=use_case, audience=label_audience,
                category=_LEGACY_CATEGORY.get(use_case, ""),
                subject=(msg.subject or "")[:300],
                recipient_email=", ".join(msg.to)[:254],
                related_id=str(related_id or ""), body_html=_html_of(msg),
                status=status, error=error[:2000],
            )
        except Exception:
            logger.exception("EmailLog write failed for %s", use_case)

    try:
        msg.send()
    except Exception as exc:
        record(EmailLog.Status.FAILED, f"{type(exc).__name__}: {exc}")
        raise
    record(EmailLog.Status.SENT)
