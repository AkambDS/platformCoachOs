"""
Public (no-auth) invoice payment views — Stripe Checkout via each workspace's own
connected Stripe account ("bring your own key", not a shared platform account).

Routes (added in config/urls.py, csrf_exempt):
    GET  /invoices/pay/<token>/                        → redirects to Stripe Checkout
    POST /api/invoices/stripe-webhook/<workspace_id>/  → Stripe event receiver

A client reaches the pay link either from the "Pay Invoice Online" button in the
invoice email or the client portal's "Pay Now" button — both just link here with a
signed, invoice-scoped token (see tokens.py). The actual Checkout Session is created
fresh on every click rather than pre-generated and stored, so it never goes stale.
"""
import logging
from decimal import Decimal

from django.conf import settings
from django.http import HttpResponse, HttpResponseRedirect
from django.views import View

from . import stripe_problems
from .money import from_minor, smallest_unit, to_minor
from .tokens import verify_invoice_pay_token

logger = logging.getLogger(__name__)

_PAYABLE_STATUSES = {"sent", "overdue", "partially_paid"}


def _shell(workspace_name: str, body: str) -> str:
    """Minimal branded HTML page — mirrors apps/activities/public_views.py's shell."""
    from django.utils.html import escape
    name = escape(workspace_name)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{name}</title>
  <style>
    *{{box-sizing:border-box;margin:0;padding:0}}
    body{{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
          background:#faf8f4;color:#1a1714;min-height:100vh;display:flex;flex-direction:column}}
    header{{background:#1a2f4e;padding:18px 24px;text-align:center}}
    header span{{font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#f7f4ef;letter-spacing:.04em}}
    main{{flex:1;display:flex;align-items:center;justify-content:center;padding:40px 16px}}
    .card{{background:#fff;border:1px solid #ede9e1;border-radius:10px;padding:40px 36px;
           max-width:480px;width:100%;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.06)}}
    .icon{{font-size:48px;margin-bottom:16px}}
    h1{{font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:400;color:#16130f;margin-bottom:10px}}
    .sub{{font-size:14px;color:#6e6560;line-height:1.6}}
  </style>
</head>
<body>
  <header><span>{name}</span></header>
  <main>{body}</main>
</body>
</html>"""


def _invalid_response():
    return HttpResponse(_shell("CoachOS", """
      <div class="card">
        <div class="icon">⚠️</div>
        <h1>Link not valid</h1>
        <p class="sub">This payment link has expired or is invalid.<br>Please contact your coach for a new invoice.</p>
      </div>"""), status=400)


def _processing_response(workspace_name, invoice_number):
    return HttpResponse(_shell(workspace_name, f"""
      <div class="card">
        <div class="icon">✅</div>
        <h1>Payment received</h1>
        <p class="sub">Your payment for invoice #{invoice_number} is being processed.
          You'll receive a receipt by email shortly.</p>
      </div>"""))


class _CheckoutAlreadyPaid(Exception):
    """The invoice's last Checkout session was paid, but its webhook hasn't been recorded yet."""


def _reusable_checkout(stripe, invoice, secret_key, amount, currency):
    """Before starting a new Checkout for this invoice, settle the previous one so the client
    can never have two payable sessions at once (one-time-pay.md, P3):
      * still open, same amount  → return it; the client continues on the same session
      * still open, amount changed (e.g. a manual payment was recorded) → expire it, so it
        can't be paid at the old amount, and let the caller create a new one
      * already paid, payment not recorded yet (webhook on its way) → _CheckoutAlreadyPaid
      * expired, or paid and already recorded, or gone from this Stripe account → None
    """
    from .models import Payment
    session_id = invoice.stripe_checkout_session_id
    if not session_id:
        return None
    try:
        previous = stripe.checkout.Session.retrieve(session_id, api_key=secret_key)
    except stripe.error.InvalidRequestError:
        return None     # not in this Stripe account (keys changed) — it can't be paid here either

    def paid_but_unrecorded(session):
        return session.status == "complete" and not Payment.objects.filter(
            workspace_id=invoice.workspace_id, stripe_payment_id=session.payment_intent or session.id,
        ).exists()

    if previous.status == "complete":
        if paid_but_unrecorded(previous):
            raise _CheckoutAlreadyPaid
        return None
    if previous.status != "open":
        return None
    if previous.amount_total == amount and previous.currency == currency:
        return previous
    try:
        stripe.checkout.Session.expire(session_id, api_key=secret_key)
    except stripe.error.InvalidRequestError:
        # Only an open session can be expired — the client finished paying it just now.
        if paid_but_unrecorded(stripe.checkout.Session.retrieve(session_id, api_key=secret_key)):
            raise _CheckoutAlreadyPaid
    return None


class InvoicePayView(View):
    """GET /invoices/pay/<token>/ — creates a fresh Stripe Checkout Session for this
    invoice's workspace and redirects the client straight to Stripe's hosted page."""

    def get(self, request, token):
        from .models import Invoice
        from apps.accounts.crypto import decrypt_secret
        from django.db import transaction

        try:
            invoice_id = verify_invoice_pay_token(token)
            invoice = Invoice.objects.select_related("client", "workspace").get(id=invoice_id)
        except (ValueError, Invoice.DoesNotExist):
            return _invalid_response()

        workspace = invoice.workspace
        # Not request.path: the token in it lets anyone pay this invoice, and ErrorLog is emailed.
        pay_endpoint = f"/invoices/pay/<token>/ (invoice {invoice.number})"

        from config.middleware import is_demo_workspace_id
        if is_demo_workspace_id(workspace.id):
            return HttpResponse(_shell(workspace.name, """
              <div class="card">
                <div class="icon">ℹ️</div>
                <h1>Payments are off in the demo</h1>
                <p class="sub">This is a read-only demo workspace, so online payments are disabled.</p>
              </div>"""))

        if invoice.status not in _PAYABLE_STATUSES:
            return HttpResponse(_shell(workspace.name, f"""
              <div class="card">
                <div class="icon">ℹ️</div>
                <h1>Nothing to pay</h1>
                <p class="sub">Invoice #{invoice.number} is {invoice.get_status_display().lower()} — there's no
                  outstanding balance to collect online.</p>
              </div>"""))

        cfg = (workspace.integrations or {}).get("stripe", {})
        secret_key_enc = cfg.get("secret_key_encrypted")
        if not secret_key_enc:
            return HttpResponse(_shell(workspace.name, """
              <div class="card">
                <div class="icon">⚠️</div>
                <h1>Online payment not available</h1>
                <p class="sub">This coach hasn't enabled online card payments yet. Please contact them
                  directly to arrange payment.</p>
              </div>"""), status=400)

        try:
            secret_key = decrypt_secret(secret_key_enc)
        except ValueError as e:
            logger.error(f"Could not decrypt Stripe key for workspace {workspace.id}")
            stripe_problems.record(e, workspace, "pay_decrypt", endpoint=pay_endpoint)
            return HttpResponse(_shell(workspace.name, """
              <div class="card"><div class="icon">⚠️</div><h1>Payment temporarily unavailable</h1>
              <p class="sub">Please contact your coach or try again shortly.</p></div>"""), status=500)

        backend_base = getattr(settings, "BACKEND_URL", "").rstrip("/") or "http://localhost:8000"
        success_url = f"{backend_base}/invoices/pay/{token}/success/"
        cancel_url  = f"{backend_base}/invoices/pay/{token}/"
        unavailable = HttpResponse(_shell(workspace.name, """
              <div class="card"><div class="icon">⚠️</div><h1>Payment temporarily unavailable</h1>
              <p class="sub">Something went wrong starting checkout. Please try again shortly or contact
              your coach.</p></div>"""), status=502)

        import stripe
        # Locked so two clicks at the same moment (link open in two tabs, or email + portal)
        # can't both start a checkout: the second waits, then reuses the first one's session.
        with transaction.atomic():
            invoice = Invoice.objects.select_for_update().get(id=invoice.id)
            balance = invoice.total - invoice.amount_paid
            if balance <= 0:
                return HttpResponse(_shell(workspace.name, f"""
                  <div class="card"><div class="icon">✅</div><h1>Already paid</h1>
                  <p class="sub">Invoice #{invoice.number} has no remaining balance.</p></div>"""))
            amount, currency = to_minor(balance, invoice.currency), invoice.currency.lower()

            try:
                previous = _reusable_checkout(stripe, invoice, secret_key, amount, currency)
            except _CheckoutAlreadyPaid:
                return _processing_response(workspace.name, invoice.number)
            except stripe.error.StripeError as e:
                logger.error(f"Stripe Checkout Session lookup failed for invoice {invoice.id}: {e}")
                stripe_problems.record(e, workspace, "pay_stripe", endpoint=pay_endpoint, invoice=invoice)
                return unavailable
            if previous:
                stripe_problems.clear(workspace, "pay_")
                return HttpResponseRedirect(previous.url)

            try:
                session = stripe.checkout.Session.create(
                    api_key=secret_key,
                    mode="payment",
                    payment_method_types=["card"],
                    line_items=[{
                        "price_data": {
                            "currency": currency,
                            "product_data": {"name": f"Invoice {invoice.number} — {workspace.name}"},
                            "unit_amount": amount,
                        },
                        "quantity": 1,
                    }],
                    customer_email=invoice.client.email or None,
                    success_url=success_url,
                    cancel_url=cancel_url,
                    metadata={"invoice_id": str(invoice.id), "workspace_id": str(workspace.id)},
                    payment_intent_data={"metadata": {"invoice_id": str(invoice.id), "workspace_id": str(workspace.id)}},
                )
            except Exception as e:
                logger.error(f"Stripe Checkout Session creation failed for invoice {invoice.id}: {e}")
                stripe_problems.record(e, workspace, "pay_stripe", endpoint=pay_endpoint, invoice=invoice)
                return unavailable
            invoice.stripe_checkout_session_id = session.id
            invoice.save(update_fields=["stripe_checkout_session_id"])

        stripe_problems.clear(workspace, "pay_")
        return HttpResponseRedirect(session.url)


class InvoicePaySuccessView(View):
    """GET /invoices/pay/<token>/success/ — Stripe's success_url lands here. The webhook
    (not this page load) is the source of truth for marking the invoice paid — this is
    purely a friendly confirmation screen for the client."""

    def get(self, request, token):
        from .models import Invoice
        try:
            invoice_id = verify_invoice_pay_token(token)
            invoice = Invoice.objects.select_related("workspace").get(id=invoice_id)
        except (ValueError, Invoice.DoesNotExist):
            return _invalid_response()
        return HttpResponse(_shell(invoice.workspace.name, f"""
          <div class="card">
            <div class="icon">✅</div>
            <h1>Payment received</h1>
            <p class="sub">Thank you! Your payment for invoice #{invoice.number} is being processed.
              You'll receive a receipt by email shortly.</p>
          </div>"""))


class StripeWebhookView(View):
    """POST /api/invoices/stripe-webhook/<workspace_id>/ — the URL identifies which
    workspace's webhook secret to verify against, since each workspace has its own
    Stripe account (and therefore its own signing secret) rather than sharing one
    platform-level endpoint."""

    def post(self, request, workspace_id):
        import stripe
        from apps.accounts.models import Workspace
        from apps.accounts.crypto import decrypt_secret

        try:
            workspace = Workspace.objects.get(id=workspace_id)
        except Workspace.DoesNotExist:
            return HttpResponse(status=404)

        # Each failure below means a client's payment isn't being recorded, so each one
        # goes to ErrorLog (once an hour per workspace and kind), not just the container log.
        endpoint = request.path
        cfg = (workspace.integrations or {}).get("stripe", {})
        webhook_secret_enc = cfg.get("webhook_secret_encrypted")
        if not webhook_secret_enc:
            stripe_problems.record(
                RuntimeError("Stripe sent a webhook but no webhook signing secret is saved in Settings → "
                             "Integrations → Stripe, so payments can't be verified or recorded."),
                workspace, "webhook_no_secret", endpoint=endpoint)
            return HttpResponse(status=400)

        try:
            webhook_secret = decrypt_secret(webhook_secret_enc)
        except ValueError as e:
            logger.error(f"Could not decrypt Stripe webhook secret for workspace {workspace_id}")
            stripe_problems.record(e, workspace, "webhook_decrypt", endpoint=endpoint)
            return HttpResponse(status=500)     # Stripe retries once the key is fixed

        try:
            event = stripe.Webhook.construct_event(
                request.body, request.headers.get("Stripe-Signature", ""), webhook_secret,
            )
        except (ValueError, stripe.error.SignatureVerificationError) as e:
            logger.warning(f"Stripe webhook signature verification failed for workspace {workspace_id}: {e}")
            # Usually the saved signing secret is from a different endpoint, account or mode.
            stripe_problems.record(e, workspace, "webhook_signature", endpoint=endpoint)
            return HttpResponse(status=400)

        try:
            if event["type"] == "checkout.session.completed":
                self._handle_checkout_completed(event["data"]["object"], workspace_id)
            elif event["type"] == "charge.refunded":
                self._handle_charge_refunded(event["data"]["object"], workspace_id)
        except Exception as e:
            logger.exception(f"Stripe webhook {event['type']} failed for workspace {workspace_id}")
            stripe_problems.record(e, workspace, "webhook_error", endpoint=endpoint)
            return HttpResponse(status=500)     # Stripe retries the event

        stripe_problems.clear(workspace, "webhook_")
        return HttpResponse(status=200)

    def _handle_checkout_completed(self, session, workspace_id):
        from .models import Invoice, Payment
        from django.db import IntegrityError, transaction
        from django.utils import timezone

        metadata   = session.get("metadata") or {}
        invoice_id = metadata.get("invoice_id")
        # Defense in depth: even though the signature already proved this event came
        # from the Stripe account tied to workspace_id (via the secret used to verify
        # it), also confirm the invoice referenced in metadata actually belongs to that
        # same workspace before touching it.
        if not invoice_id or str(metadata.get("workspace_id")) != str(workspace_id):
            logger.warning(f"Stripe webhook metadata/workspace mismatch: {metadata} vs {workspace_id}")
            return

        # Only a checkout that actually took money is a payment. Stripe sends this same
        # event for a card-save checkout (mode "setup", nothing charged — auto-pay), for a
        # checkout with nothing to pay ("no_payment_required"), and for a bank debit that
        # hasn't cleared yet ("unpaid"). Recording those would put a $0 or not-yet-real
        # payment on the invoice (one-time-pay.md, P4).
        if session.get("mode") != "payment" or session.get("payment_status") != "paid":
            logger.info(f"Stripe checkout {session.get('id')} for invoice {invoice_id} not recorded: "
                        f"mode={session.get('mode')} payment_status={session.get('payment_status')}")
            return

        payment_intent_id = session.get("payment_intent") or session.get("id", "")
        if (session.get("amount_total") or 0) <= 0:
            logger.warning(f"Stripe checkout {session.get('id')} for invoice {invoice_id} paid "
                           f"{session.get('amount_total')}, not recorded")
            return

        # Stripe delivers at-least-once and can send the same event twice at the same
        # moment. Locking the invoice row makes a twin delivery (or a manual "Record
        # payment" on the same invoice) wait here until this one commits, so its
        # "already recorded?" check sees this Payment and its amount_paid starts from
        # the committed value. The unique constraint on (workspace, stripe_payment_id)
        # is the backstop if anything gets past that.
        try:
            with transaction.atomic():
                try:
                    invoice = Invoice.objects.select_for_update().get(id=invoice_id, workspace_id=workspace_id)
                except Invoice.DoesNotExist:
                    logger.warning(f"Stripe webhook referenced unknown invoice {invoice_id} for workspace {workspace_id}")
                    return
                if Payment.objects.filter(workspace_id=workspace_id, stripe_payment_id=payment_intent_id).exists():
                    return

                amount_total = from_minor(session["amount_total"], session.get("currency") or invoice.currency)
                payment = Payment.objects.create(
                    invoice=invoice, workspace_id=workspace_id,
                    amount=amount_total, method=Payment.Method.STRIPE,
                    stripe_payment_id=payment_intent_id, paid_at=timezone.now(),
                )
                invoice.amount_paid += amount_total
                invoice.status = (Invoice.Status.PAID if invoice.amount_paid >= invoice.total
                                   else Invoice.Status.PARTIALLY_PAID)
                if invoice.status == Invoice.Status.PAID:
                    invoice.paid_at = timezone.now()
                invoice.save()
        except IntegrityError:
            logger.info(f"Stripe payment {payment_intent_id} already recorded for workspace {workspace_id}")
            return

        # The money has moved, so it's always recorded — but more than the invoice total
        # means the client paid twice (e.g. a checkout left open from before the P3 fix,
        # or a card payment on top of a manual one). Tell the owner so they can refund it.
        # Below one smallest unit is rounding (e.g. a ¥5,000.40 balance charged as ¥5,000), not
        # a second payment.
        overpaid = invoice.amount_paid - invoice.total
        if overpaid >= smallest_unit(invoice.currency):
            logger.warning(f"Invoice {invoice.id} overpaid by {overpaid} (Stripe payment {payment_intent_id})")
            from tasks.email import send_invoice_overpaid_email
            send_invoice_overpaid_email.delay(str(invoice.id), str(overpaid))

        # Every card payment, partial or full: receipt to the client, "Payment received" to the owner.
        from tasks.email import send_payment_receipt_email, send_payment_received_email
        try:
            send_payment_receipt_email(str(invoice.id), str(payment.id))
        except Exception as e:
            logger.error(f"Payment receipt email failed for invoice {invoice.id}: {e}")
        send_payment_received_email.delay(str(payment.id))

    def _handle_charge_refunded(self, charge, workspace_id):
        """Reconciles a refund issued directly from the coach's own Stripe Dashboard
        (bypassing InvoiceViewSet.issue_refund entirely) back onto the invoice. A refund
        issued *through* CoachOS already recorded its Stripe refund id in
        invoice.stripe_refund_ids at creation time, so this dedupes cleanly against
        Stripe's at-least-once webhook retries either way — see Invoice.stripe_refund_ids."""
        from .models import Invoice
        from django.utils import timezone

        metadata   = charge.get("metadata") or {}
        invoice_id = metadata.get("invoice_id")
        # Defense in depth, mirroring _handle_checkout_completed: the signature already
        # proved this event came from the Stripe account tied to workspace_id, but also
        # confirm the invoice referenced in metadata belongs to that same workspace. A
        # charge with no CoachOS metadata (e.g. unrelated to any invoice) has nothing to
        # reconcile here.
        if not invoice_id or str(metadata.get("workspace_id")) != str(workspace_id):
            return

        try:
            invoice = Invoice.objects.get(id=invoice_id, workspace_id=workspace_id)
        except Invoice.DoesNotExist:
            logger.warning(f"Stripe refund webhook referenced unknown invoice {invoice_id} for workspace {workspace_id}")
            return

        already_seen = set(invoice.stripe_refund_ids or [])
        new_ids = set(already_seen)
        new_amount = Decimal("0")
        for r in (charge.get("refunds") or {}).get("data", []):
            if r["id"] in already_seen:
                continue
            new_ids.add(r["id"])
            new_amount += from_minor(r["amount"], r.get("currency") or charge.get("currency") or invoice.currency)

        if new_amount <= 0:
            return

        invoice.stripe_refund_ids = list(new_ids)
        invoice.refund_amount += new_amount
        invoice.refunded_at = timezone.now()
        invoice.status = (Invoice.Status.REFUNDED
                           if invoice.refund_amount >= invoice.amount_paid
                           else Invoice.Status.PARTIALLY_REFUNDED)
        invoice.save()
