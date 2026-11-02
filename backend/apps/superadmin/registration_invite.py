"""CoachOS — workspace registration invite email: send + delivery tracking.

Used by the Superadmin "Workspace Invites" tab (create link, Send again). Every send
records its outcome on the WorkspaceRegistrationToken row so the admin can see whether
the email actually went out, instead of the old fire-and-forget msg.send() whose
failures only reached the container log.

Delivery tracking: when Resend is the mail provider, the email is sent through Resend's
HTTP API (not SMTP) so we get back its email id, then refresh_delivery_statuses() asks
Resend for that email's last_event (delivered / bounced / complained / …) whenever the
invite list is loaded. Without a Resend key (local dev → Mailpit) it falls back to plain
SMTP and the status stops at "sent".
"""
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import requests
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.utils import timezone

logger = logging.getLogger(__name__)

RESEND_API = "https://api.resend.com"
# Resend last_event values that can still change — only these are re-polled.
_PENDING_STATUSES = {"sent", "queued", "scheduled", "delivery_delayed"}
_POLL_MIN_INTERVAL = timedelta(seconds=60)
_POLL_MAX_AGE      = timedelta(days=14)


def _resend_api_key() -> str:
    """RESEND_API_KEY if set, else the SMTP password when the SMTP host is Resend's
    (prod repurposes AWS_SES_SMTP_PASSWORD for the Resend key — see DEPLOY.md)."""
    key = getattr(settings, "RESEND_API_KEY", "") or ""
    if not key and "resend" in (getattr(settings, "EMAIL_HOST", "") or ""):
        key = getattr(settings, "EMAIL_HOST_PASSWORD", "") or ""
    return key


def _build_email(token, register_url: str):
    name        = token.recipient_name
    expires_str = token.expires_at.strftime("%B %d, %Y")
    subject = "You're invited to set up your CoachOS workspace"
    plain = (
        f"Hi {name},\n\n"
        f"You've been invited to create your coaching workspace on CoachOS.\n\n"
        f"Click the link below to set up your workspace:\n{register_url}\n\n"
        f"This link expires on {expires_str} and can only be used once.\n\n"
        f"If you have any questions, reply to this email."
    )
    html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#eeebe5;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
  <tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="background:#1a2f4e;padding:24px 40px;border-radius:8px 8px 0 0;">
      <span style="font-family:Georgia,serif;font-size:22px;color:#f5f0e8;">CoachOS</span>
    </td></tr>
    <tr><td style="height:3px;background:linear-gradient(90deg,#b8922e,#d9b96a,#b8922e);"></td></tr>
    <tr><td style="background:#fff;padding:40px;border-radius:0 0 8px 8px;font-family:Arial,sans-serif;">
      <h2 style="margin:0 0 16px;font-size:22px;color:#16130f;">You're invited to CoachOS</h2>
      <p style="color:#4a443e;line-height:1.6;margin:0 0 24px;">
        Hi {name},<br><br>
        You've been invited to create your coaching workspace on CoachOS — a dedicated platform to manage clients, sessions, invoices, and your pipeline.
      </p>
      <div style="text-align:center;margin:0 0 32px;">
        <a href="{register_url}" style="background:#1B3A6B;color:#fff;padding:14px 32px;
           text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;display:inline-block;">
          Set Up My Workspace
        </a>
      </div>
      <p style="color:#8c8279;font-size:13px;margin:0;">
        This link expires on <strong>{expires_str}</strong> and can only be used once.<br>
        If you did not expect this invitation, you can safely ignore this email.
      </p>
    </td></tr>
  </table></td></tr>
</table>
</body></html>"""
    return subject, plain, html


def send_registration_invite(token, register_url: str, reply_to: str = "") -> bool:
    """Send (or re-send) the invite email for `token` and record the outcome on it.
    Never raises — returns True when the provider accepted the email."""
    subject, plain, html = _build_email(token, register_url)
    from_email = settings.DEFAULT_FROM_EMAIL
    api_key = _resend_api_key()
    email_id = ""
    try:
        if api_key:
            payload = {
                "from": from_email, "to": [token.recipient_email],
                "subject": subject, "html": html, "text": plain,
            }
            if reply_to:
                payload["reply_to"] = reply_to
            r = requests.post(
                f"{RESEND_API}/emails", json=payload, timeout=10,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if r.status_code >= 400:
                raise RuntimeError(f"Resend {r.status_code}: {r.text[:500]}")
            email_id = (r.json() or {}).get("id", "")
        else:
            msg = EmailMultiAlternatives(
                subject=subject, body=plain, from_email=from_email,
                to=[token.recipient_email], reply_to=[reply_to] if reply_to else None,
            )
            msg.attach_alternative(html, "text/html")
            msg.send()
    except Exception as exc:
        logger.error("Registration invite email failed for %s: %s", token.recipient_email, exc)
        token.email_status = "failed"
        token.email_error  = f"{type(exc).__name__}: {exc}"[:2000]
        token.save(update_fields=["email_status", "email_error"])
        return False

    now = timezone.now()
    token.email_status            = "sent"
    token.email_error             = ""
    token.email_sent_at           = now
    token.email_send_count       += 1
    token.resend_email_id         = email_id
    token.email_status_checked_at = None
    token.save(update_fields=[
        "email_status", "email_error", "email_sent_at", "email_send_count",
        "resend_email_id", "email_status_checked_at",
    ])
    return True


def _fetch_last_event(api_key: str, email_id: str):
    try:
        r = requests.get(
            f"{RESEND_API}/emails/{email_id}", timeout=4,
            headers={"Authorization": f"Bearer {api_key}"},
        )
        if r.status_code == 200:
            return (r.json() or {}).get("last_event") or None
        # 401/403 = a sending-only API key, which can't read email status.
        logger.warning("Resend status lookup %s → %s %s", email_id, r.status_code, r.text[:200])
    except Exception as exc:
        logger.warning("Resend status lookup %s failed: %s", email_id, exc)
    return None


def refresh_delivery_statuses(tokens) -> None:
    """Ask Resend for the latest event of every recently-sent invite whose status can
    still change. Rate-limited per row so reloading the list doesn't hammer the API."""
    api_key = _resend_api_key()
    if not api_key:
        return
    now = timezone.now()
    due = [
        t for t in tokens
        if t.resend_email_id
        and t.email_status in _PENDING_STATUSES
        and t.email_sent_at and now - t.email_sent_at < _POLL_MAX_AGE
        and (not t.email_status_checked_at or now - t.email_status_checked_at > _POLL_MIN_INTERVAL)
    ]
    if not due:
        return
    with ThreadPoolExecutor(max_workers=5) as pool:
        events = list(pool.map(lambda t: _fetch_last_event(api_key, t.resend_email_id), due))
    for t, event in zip(due, events):
        if event:
            t.email_status = event[:20]
        t.email_status_checked_at = now
        t.save(update_fields=["email_status", "email_status_checked_at"])
