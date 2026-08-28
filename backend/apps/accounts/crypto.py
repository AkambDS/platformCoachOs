"""
Field-level encryption for secrets stored in JSONField blobs (e.g. a workspace's own
Stripe API key). Uses Fernet (symmetric, authenticated) via FIELD_ENCRYPTION_KEY — a
key deliberately separate from Django's SECRET_KEY so the two can be rotated
independently, and so a SECRET_KEY leak (used for sessions/CSRF/tokens) doesn't also
expose every stored credential.

Built on MultiFernet from day one: to rotate FIELD_ENCRYPTION_KEY later without a
big-bang re-encryption migration, prepend the new key to FIELD_ENCRYPTION_KEYS (comma-
separated) — new writes use the first key, reads still decrypt values written under any
key in the list.
"""
from cryptography.fernet import Fernet, MultiFernet, InvalidToken
from django.conf import settings


def _get_fernet() -> MultiFernet:
    keys = getattr(settings, "FIELD_ENCRYPTION_KEYS", None) or []
    if not keys:
        raise RuntimeError(
            "FIELD_ENCRYPTION_KEY is not set — required to store third-party secrets "
            "(e.g. a workspace's Stripe key). Generate one with: "
            "python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
    return MultiFernet([Fernet(k) for k in keys])


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a secret for storage. Returns a URL-safe base64 string."""
    if not plaintext:
        return ""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt a previously-encrypted secret. Returns '' if ciphertext is empty."""
    if not ciphertext:
        return ""
    try:
        return _get_fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        raise ValueError("Could not decrypt secret — FIELD_ENCRYPTION_KEY may have changed")
