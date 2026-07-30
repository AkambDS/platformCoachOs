"""
Signed, time-limited tokens for the public contract-signing link.
Same scheme as apps.activities.tokens (session confirm/cancel/reschedule) — kept as a
separate small module rather than a shared import since activities already depends on
clients (Activity FKs Client) and importing back the other way would invert that.

Token format (before base64):
    sign_contract:{draft_uuid}:{expiry_unix}:{hmac_sha256_hex}
"""
import base64
import hashlib
import hmac
import time

from django.conf import settings


def _sign(payload: str) -> str:
    return hmac.new(
        settings.SECRET_KEY.encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()


def make_contract_token(draft_id: str, expiry_days: int = 90) -> str:
    """Return a URL-safe base64 token for signing this ClientMessageDraft."""
    expiry = int(time.time()) + expiry_days * 24 * 3600
    payload = f"sign_contract:{draft_id}:{expiry}"
    sig = _sign(payload)
    raw = f"{payload}:{sig}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def verify_contract_token(token: str) -> str:
    """Verify and decode a contract-signing token. Returns draft_id or raises ValueError."""
    try:
        padding = (4 - len(token) % 4) % 4
        raw = base64.urlsafe_b64decode((token + "=" * padding).encode()).decode()
        payload, sig = raw.rsplit(":", 1)
        expected = _sign(payload)
        if not hmac.compare_digest(sig, expected):
            raise ValueError("Invalid token signature")
        action, draft_id, expiry = payload.split(":", 2)
        if action != "sign_contract":
            raise ValueError("Unknown action")
        if int(time.time()) > int(expiry):
            raise ValueError("Token has expired")
        return draft_id
    except ValueError:
        raise
    except Exception:
        raise ValueError("Malformed token")
