"""
Signed, time-limited tokens for client session actions (confirm / cancel / reschedule).

Token format (before base64):
    {action}:{activity_uuid}:{expiry_unix}:{hmac_sha256_hex}

Security properties:
- Cannot be forged without SECRET_KEY
- Scoped to one action + one activity
- Expire automatically after `expiry_days`
- Constant-time comparison prevents timing attacks
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


def make_session_token(action: str, activity_id: str, expiry_days: int = 30) -> str:
    """Return a URL-safe base64 token for the given action + activity."""
    expiry = int(time.time()) + expiry_days * 24 * 3600
    payload = f"{action}:{activity_id}:{expiry}"
    sig = _sign(payload)
    raw = f"{payload}:{sig}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def verify_session_token(token: str) -> tuple[str, str]:
    """
    Verify and decode a session token.
    Returns (action, activity_id) or raises ValueError on any failure.
    """
    try:
        padding = (4 - len(token) % 4) % 4
        raw = base64.urlsafe_b64decode((token + "=" * padding).encode()).decode()
        # Split off the HMAC signature (last segment)
        payload, sig = raw.rsplit(":", 1)
        expected = _sign(payload)
        if not hmac.compare_digest(sig, expected):
            raise ValueError("Invalid token signature")
        action, activity_id, expiry = payload.split(":", 2)
        if int(time.time()) > int(expiry):
            raise ValueError("Token has expired")
        if action not in ("confirm", "cancel", "reschedule"):
            raise ValueError("Unknown action")
        return action, activity_id
    except ValueError:
        raise
    except Exception:
        raise ValueError("Malformed token")
