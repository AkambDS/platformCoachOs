"""
Signed, time-limited tokens for the public "Pay Invoice" link — mirrors
apps/activities/tokens.py's scheme for session confirm/cancel/reschedule links.

Token format (before base64):
    pay:{invoice_uuid}:{expiry_unix}:{hmac_sha256_hex}

Security properties:
- Cannot be forged without SECRET_KEY
- Scoped to exactly one invoice
- Expires automatically (long-lived by design — invoices can be paid weeks after
  sending — the actual payability check happens server-side against the invoice's
  live status at click time, not solely by token freshness)
- Constant-time comparison prevents timing attacks
"""
import base64
import hashlib
import hmac
import time

from django.conf import settings


def _sign(payload: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()


def make_invoice_pay_token(invoice_id: str, expiry_days: int = 365) -> str:
    """Return a URL-safe base64 token authorizing payment of the given invoice."""
    expiry = int(time.time()) + expiry_days * 24 * 3600
    payload = f"pay:{invoice_id}:{expiry}"
    sig = _sign(payload)
    raw = f"{payload}:{sig}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def verify_invoice_pay_token(token: str) -> str:
    """Verify and decode a pay token. Returns invoice_id or raises ValueError."""
    try:
        padding = (4 - len(token) % 4) % 4
        raw = base64.urlsafe_b64decode((token + "=" * padding).encode()).decode()
        payload, sig = raw.rsplit(":", 1)
        expected = _sign(payload)
        if not hmac.compare_digest(sig, expected):
            raise ValueError("Invalid token signature")
        action, invoice_id, expiry = payload.split(":", 2)
        if action != "pay":
            raise ValueError("Unknown action")
        if int(time.time()) > int(expiry):
            raise ValueError("Token has expired")
        return invoice_id
    except ValueError:
        raise
    except Exception:
        raise ValueError("Malformed token")
