"""Portal has one model of its own: the one-time login code (see PortalLoginCode).
Everything else the portal shows reads from clients/invoicing/library."""
import uuid
from django.db import models
from django.utils import timezone


class PortalLoginCode(models.Model):
    """A 6-digit code emailed to a client to verify they actually control the inbox
    tied to their portal login. Without this, PortalLoginView's only check was
    "does this email match a Client row with portal_access=True" — no password, no
    proof of inbox ownership, so anyone who knew (or guessed/harvested) a client's
    email could sign in as them. This code is the second factor.

    Stored hashed (sha256), never the raw 6-digit value, so a DB read alone can't
    hand out a working code. Short-lived (see PortalRequestCodeView) and capped at a
    handful of attempts (is_valid) so brute-forcing the 6-digit space is impractical
    within the code's lifetime even without the per-IP throttle also in front of it.
    """
    id          = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client      = models.ForeignKey("clients.Client", on_delete=models.CASCADE, related_name="portal_login_codes")
    code_hash   = models.CharField(max_length=64)  # sha256 hex digest of the 6-digit code
    created_at  = models.DateTimeField(auto_now_add=True)
    expires_at  = models.DateTimeField()
    attempts    = models.PositiveSmallIntegerField(default=0)
    consumed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "portal_logincode"
        indexes = [models.Index(fields=["client", "consumed_at"])]

    def is_valid(self) -> bool:
        return self.consumed_at is None and self.expires_at > timezone.now() and self.attempts < 5
