"""Stripe payment problems — who hears about them, and the Settings banner.

Every problem on the pay page or the Stripe webhook (one-time-pay.md, P7 and "owner alerts"):

  * ErrorLog row + alert email to the platform admins — at most once an hour per workspace
    and kind (capture_error does the email);
  * email to the workspace owner, in plain words with what to do — at most once a day per
    kind (Settings → Emails "Stripe Payment Problem");
  * a red banner in the owner's Settings → Integrations until it's fixed: stored under
    Workspace.integrations["stripe"]["problems"] and cleared by the next success of the
    same kind (a webhook handled, a checkout opened) or by re-saving the Stripe settings.

Both rate limits matter: a wrong webhook secret fails every delivery, and Stripe retries
each event for days.
"""
import logging

from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

# What the owner reads. {error}, {invoice_number}, {webhook_url} are filled in when known.
PROBLEMS = {
    "webhook_no_secret": dict(
        title="Stripe payments aren't being recorded",
        detail="Stripe is sending payment updates to CoachOS, but no webhook signing secret is saved, "
               "so CoachOS can't verify them. Clients' payments reach your Stripe account, but their "
               "invoices stay unpaid here.",
        fix="Settings → Integrations → Stripe → Step 2: in Stripe Dashboard → Developers → Webhooks, "
            "open your CoachOS endpoint, copy its Signing secret (whsec_…) and paste it.",
    ),
    "webhook_signature": dict(
        title="Stripe payments aren't being recorded: the webhook secret doesn't match",
        detail="Payment updates from Stripe are being rejected because the saved webhook signing secret "
               "doesn't match your Stripe endpoint. Payments reach your Stripe account, but invoices here "
               "aren't marked paid.",
        fix="Re-do Step 2 in Settings → Integrations → Stripe: in Stripe Dashboard → Developers → Webhooks, "
            "open the endpoint for {webhook_url} (in the same test/live mode as your key), reveal its "
            "Signing secret and paste it. Stripe resends the missed updates afterwards.",
    ),
    "webhook_decrypt": dict(
        title="Stripe payments aren't being recorded: saved settings can't be read",
        detail="CoachOS couldn't read your saved Stripe webhook secret, so payment updates can't be "
               "recorded. The CoachOS team has been alerted.",
        fix="Paste the webhook signing secret again in Settings → Integrations → Stripe (Step 2). "
            "Stripe resends the missed updates afterwards.",
    ),
    "webhook_error": dict(
        title="A Stripe payment couldn't be recorded",
        detail="A payment update from Stripe hit an error in CoachOS: {error}. The CoachOS team has been "
               "alerted, and Stripe retries automatically.",
        fix="Nothing to do unless an invoice that's paid in Stripe still shows unpaid here after an hour. "
            "Then record that payment manually on the invoice.",
    ),
    "pay_decrypt": dict(
        title="Clients can't pay online",
        detail="CoachOS couldn't read your saved Stripe secret key, so the Pay button on invoices "
               "isn't working. The CoachOS team has been alerted.",
        fix="Save your Stripe secret key again in Settings → Integrations → Stripe.",
    ),
    "pay_stripe": dict(
        title="A client couldn't start an online payment",
        detail="A client tried to pay invoice #{invoice_number}, but Stripe refused or couldn't be "
               "reached: {error}",
        fix="If this keeps happening, check your Stripe account (was the key rolled or deleted? is the "
            "account restricted?) and save the key again in Settings → Integrations → Stripe.",
    ),
}


def _format(text, values):
    try:
        return text.format(**values)
    except (KeyError, IndexError):
        return text


def _problems_of(workspace):
    return ((workspace.integrations or {}).get("stripe") or {}).get("problems") or {}


def _write_problems(workspace, change):
    """Apply `change(problems) -> problems` under a row lock, so a webhook and the pay page
    flagging/clearing at the same moment can't overwrite each other."""
    from apps.accounts.models import Workspace
    with transaction.atomic():
        ws = Workspace.objects.select_for_update().get(id=workspace.id)
        integrations = ws.integrations or {}
        cfg = integrations.get("stripe") or {}
        before = cfg.get("problems") or {}
        after = change(dict(before))
        if after == before:
            return
        cfg["problems"] = after
        integrations["stripe"] = cfg
        ws.integrations = integrations
        ws.save(update_fields=["integrations"])
        workspace.integrations = integrations


def record(exc, workspace, kind, *, endpoint="", invoice=None):
    """Report one problem of `kind` (a PROBLEMS key) to the platform admins, the owner and
    the Settings banner. Never raises — reporting must not break the payment flow."""
    try:
        from apps.accounts.error_logging import capture_error
        if cache.add(f"stripe_problem:{workspace.id}:{kind}", True, timeout=60 * 60):
            capture_error(exc, workspace=workspace, endpoint=endpoint, severity="error")

        from django.conf import settings as dj_settings
        backend_base = getattr(dj_settings, "BACKEND_URL", "").rstrip("/") or "http://localhost:8000"
        values = dict(
            error=(getattr(exc, "user_message", None) or str(exc))[:300],
            invoice_number=getattr(invoice, "number", ""),
            webhook_url=f"{backend_base}/api/invoices/stripe-webhook/{workspace.id}/",
        )
        problem = {k: _format(v, values) for k, v in PROBLEMS[kind].items()}
        problem["at"] = timezone.now().isoformat()

        def flag(problems):
            problem["since"] = (problems.get(kind) or {}).get("since") or problem["at"]
            problems[kind] = problem
            return problems
        _write_problems(workspace, flag)

        today = timezone.now().date().isoformat()
        if cache.add(f"stripe_owner_alert:{workspace.id}:{kind}:{today}", True, timeout=60 * 60 * 25):
            from tasks.email import send_stripe_problem_email
            send_stripe_problem_email.delay(str(workspace.id), kind)
    except Exception:
        logger.exception(f"Reporting Stripe problem {kind} for workspace {workspace.id} failed")


def clear(workspace, prefix):
    """The thing that was failing works again: drop banner entries whose kind starts with
    `prefix` ("webhook_" / "pay_"). Cheap no-op when there's nothing to clear."""
    if not any(k.startswith(prefix) for k in _problems_of(workspace)):
        return
    try:
        _write_problems(workspace, lambda p: {k: v for k, v in p.items() if not k.startswith(prefix)})
    except Exception:
        logger.exception(f"Clearing Stripe problems for workspace {workspace.id} failed")
