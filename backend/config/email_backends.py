"""
CoachOS — demo-safe email backend.

Celery beat's periodic tasks (tasks/reminders.py::dispatch_activity_reminders,
tasks/invoicing.py's subscription dispatch, etc.) query the database directly and
have no concept of HTTP requests, so DemoWorkspaceReadOnlyMiddleware — which only
blocks mutating /api/ requests — never sees them and can't stop them. Left alone,
the seeded "coachos-demo" workspace's upcoming activities/invoices would cause
real outbound email attempts to its fake @example.com client addresses in
production (EMAIL_BACKEND there is Resend's real SMTP relay, not a sandbox).

Rather than hunting down and guarding every individual tasks/email.py send
function (19 and counting), this wraps the real SMTP backend at the one point
every single one of them funnels through — Django's EMAIL_BACKEND — and drops
any message addressed only to the demo workspace's own users/clients before it
reaches SMTP. A message with any real, non-demo recipient still sends normally.
"""
import logging

from django.core.cache import cache
from django.core.mail.backends.smtp import EmailBackend as SMTPBackend

from config.middleware import DEMO_WORKSPACE_SLUG

logger = logging.getLogger(__name__)

_DEMO_RECIPIENTS_CACHE_KEY = "demo_workspace_recipient_emails_v1"


def _get_demo_recipient_emails() -> frozenset:
    cached = cache.get(_DEMO_RECIPIENTS_CACHE_KEY)
    if cached is not None:
        return cached

    from apps.accounts.models import User
    from apps.clients.models import Client

    emails = {
        e.lower() for e in
        Client.objects.filter(workspace__slug=DEMO_WORKSPACE_SLUG).values_list("email", flat=True) if e
    } | {
        e.lower() for e in
        User.objects.filter(workspace__slug=DEMO_WORKSPACE_SLUG).values_list("email", flat=True) if e
    }
    emails = frozenset(emails)
    cache.set(_DEMO_RECIPIENTS_CACHE_KEY, emails, 300)
    return emails


def invalidate_demo_recipient_cache():
    """Call after (re)provisioning the demo workspace (see seed_demo_workspace) so a
    newly added/changed demo address is blocked immediately instead of waiting out
    the cache TTL."""
    cache.delete(_DEMO_RECIPIENTS_CACHE_KEY)


class DemoSafeEmailBackend(SMTPBackend):
    """Drop-in replacement for django.core.mail.backends.smtp.EmailBackend."""

    def send_messages(self, email_messages):
        demo_emails = _get_demo_recipient_emails()
        if not demo_emails:
            return super().send_messages(email_messages)

        real_messages = []
        skipped = 0
        for msg in email_messages:
            recipients = {
                addr.lower() for addr in
                list(msg.to or []) + list(msg.cc or []) + list(msg.bcc or [])
            }
            if recipients and recipients.issubset(demo_emails):
                skipped += 1
                continue
            real_messages.append(msg)

        sent = super().send_messages(real_messages) if real_messages else 0
        if skipped:
            logger.info(
                "DemoSafeEmailBackend: skipped %d email(s) addressed only to the demo workspace",
                skipped,
            )
        return sent
