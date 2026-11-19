"""One-time invoice payments — recording a payment exactly once (one-time-pay.md, P1/P2).

P1: two deliveries of the same Stripe webhook arriving together could both pass the
    "already recorded?" check and record the payment twice.
P2: a Stripe webhook and a manual "Record payment" at the same moment both started from
    the same old amount_paid, so one of the two amounts was lost from the invoice total.

The race tests use real threads on committed data (transaction=True) and slow down the
Payment insert so both requests are inside the handler at the same time — on the old
code they fail every run, not just occasionally.
"""
import threading
import time
import types
from decimal import Decimal
from unittest import mock

import pytest
import stripe
from django.db import IntegrityError, connection

WEBHOOK = "/api/invoices/stripe-webhook/{}/"


def _stripe_workspace(workspace):
    from apps.accounts.crypto import encrypt_secret
    workspace.integrations = {"stripe": {"secret_key_encrypted": encrypt_secret("sk_test_x"),
                                         "webhook_secret_encrypted": encrypt_secret("whsec_x")}}
    workspace.save(update_fields=["integrations"])


def _invoice(workspace, client_record, total="300.00", currency="USD"):
    from apps.invoicing.models import Invoice
    return Invoice.objects.create(workspace=workspace, client=client_record, number="INV-0001",
                                  status=Invoice.Status.SENT, total=Decimal(total), currency=currency)


def _checkout_event(invoice, pi="pi_123", amount_cents=30000):
    return {"type": "checkout.session.completed", "data": {"object": {
        "id": "cs_test_1", "mode": "payment", "payment_status": "paid",
        "payment_intent": pi, "amount_total": amount_cents, "currency": invoice.currency.lower(),
        "metadata": {"invoice_id": str(invoice.id), "workspace_id": str(invoice.workspace_id)},
    }}}


def _post_webhook(workspace, event):
    from django.test import Client
    with mock.patch("stripe.Webhook.construct_event", return_value=event):
        return Client(SERVER_NAME="localhost").post(
            WEBHOOK.format(workspace.id), data=b"{}", content_type="application/json",
            HTTP_STRIPE_SIGNATURE="t=1,v1=x")


def _slow_payment_insert(monkeypatch, seconds=0.4):
    """Widen the gap between the "already recorded?" check / amount read and the write,
    so concurrent requests reliably overlap."""
    from apps.invoicing.models import Payment
    manager, real_create = Payment.objects, Payment.objects.create

    def slow_create(**kwargs):
        time.sleep(seconds)
        return real_create(**kwargs)
    monkeypatch.setattr(manager, "create", slow_create)


def _run_together(*fns):
    errors = []

    def wrap(fn):
        def run():
            try:
                fn()
            except Exception as e:      # surfaced below — a thread can't fail the test itself
                errors.append(e)
            finally:
                connection.close()
        return run
    threads = [threading.Thread(target=wrap(fn)) for fn in fns]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)
    assert not errors, errors


# ── P1: the same Stripe payment is recorded once ──────────────────────────────────

@pytest.mark.django_db
def test_repeated_webhook_records_payment_once(workspace, client_record):
    from apps.invoicing.models import Payment
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record)
    event = _checkout_event(invoice)

    assert _post_webhook(workspace, event).status_code == 200
    assert _post_webhook(workspace, event).status_code == 200

    invoice.refresh_from_db()
    assert Payment.objects.filter(invoice=invoice).count() == 1
    assert invoice.amount_paid == Decimal("300.00") and invoice.status == "paid"


@pytest.mark.django_db(transaction=True)
def test_simultaneous_duplicate_webhooks_record_payment_once(workspace, client_record, monkeypatch):
    from apps.invoicing.models import Payment
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record)
    event = _checkout_event(invoice)
    _slow_payment_insert(monkeypatch)

    statuses = []
    _run_together(lambda: statuses.append(_post_webhook(workspace, event).status_code),
                  lambda: statuses.append(_post_webhook(workspace, event).status_code))

    invoice.refresh_from_db()
    assert statuses == [200, 200]           # a duplicate is not an error, Stripe must not retry
    assert Payment.objects.filter(invoice=invoice).count() == 1
    assert invoice.amount_paid == Decimal("300.00")


@pytest.mark.django_db
def test_db_rejects_second_payment_with_same_stripe_id(workspace, client_record):
    from django.db import transaction
    from django.utils import timezone
    from apps.invoicing.models import Payment
    invoice = _invoice(workspace, client_record)
    row = dict(invoice=invoice, workspace=workspace, amount=1, method="stripe", paid_at=timezone.now())
    Payment.objects.create(stripe_payment_id="pi_dup", **row)
    with pytest.raises(IntegrityError), transaction.atomic():
        Payment.objects.create(stripe_payment_id="pi_dup", **row)
    # manual payments carry no Stripe id — any number of them is fine
    Payment.objects.create(stripe_payment_id="", **{**row, "method": "cash"})
    Payment.objects.create(stripe_payment_id="", **{**row, "method": "cash"})


# ── P2: webhook + manual "Record payment" at the same time keep both amounts ──────

@pytest.mark.django_db(transaction=True)
def test_simultaneous_webhook_and_manual_payment_both_count(workspace, client_record, api_client, monkeypatch):
    from apps.invoicing.models import Payment
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record, total="500.00")
    event = _checkout_event(invoice, amount_cents=30000)                       # $300 by card
    _slow_payment_insert(monkeypatch)

    statuses = []
    _run_together(
        lambda: statuses.append(_post_webhook(workspace, event).status_code),
        lambda: statuses.append(api_client.post(
            f"/api/invoices/{invoice.id}/record-payment/",
            {"amount": "200.00", "method": "bank", "paid_at": "2026-11-15T10:00:00Z"},
            format="json", SERVER_NAME="localhost").status_code),                # $200 by bank
    )

    invoice.refresh_from_db()
    assert sorted(statuses) == [200, 200]
    assert Payment.objects.filter(invoice=invoice).count() == 2
    assert invoice.amount_paid == Decimal("500.00")
    assert invoice.status == "paid"


@pytest.mark.django_db
def test_manual_payment_with_already_recorded_stripe_id_is_rejected(workspace, client_record, api_client):
    from apps.invoicing.models import Payment
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record, total="500.00")
    _post_webhook(workspace, _checkout_event(invoice, pi="pi_abc", amount_cents=30000))

    res = api_client.post(f"/api/invoices/{invoice.id}/record-payment/", {
        "amount": "300.00", "method": "stripe", "stripe_payment_id": "pi_abc",
        "paid_at": "2026-11-15T10:00:00Z"}, format="json", SERVER_NAME="localhost")

    invoice.refresh_from_db()
    assert res.status_code == 400
    assert Payment.objects.filter(invoice=invoice).count() == 1
    assert invoice.amount_paid == Decimal("300.00")


@pytest.mark.django_db
def test_partial_then_final_webhook_payments_add_up(workspace, client_record):
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record)
    _post_webhook(workspace, _checkout_event(invoice, pi="pi_1", amount_cents=10000))
    invoice.refresh_from_db()
    assert invoice.status == "partially_paid" and invoice.amount_paid == Decimal("100.00")
    _post_webhook(workspace, _checkout_event(invoice, pi="pi_2", amount_cents=20000))
    invoice.refresh_from_db()
    assert invoice.status == "paid" and invoice.amount_paid == Decimal("300.00")


@pytest.mark.django_db
def test_webhook_for_another_workspaces_invoice_is_ignored(workspace, client_record):
    from apps.accounts.models import Workspace
    from apps.invoicing.models import Payment
    other = Workspace.objects.create(name="Other", slug="other-pay-ws")
    _stripe_workspace(other)
    invoice = _invoice(workspace, client_record)
    event = _checkout_event(invoice)
    event["data"]["object"]["metadata"]["workspace_id"] = str(other.id)     # forged to match the URL

    assert _post_webhook(other, event).status_code == 200
    assert Payment.objects.filter(invoice=invoice).count() == 0


# ── P3: the pay link never leaves two payable checkouts open ──────────────────────
#
# Old behaviour: every click on the pay link created a NEW Stripe Checkout session and
# nothing closed the previous one, so a client with the link open in two tabs (or email
# + portal) could pay both — two different Stripe payments, so P1's dedupe can't help.

class _FakeCheckout:
    """Stand-in for stripe.checkout.Session: keeps sessions and their status like Stripe."""

    def __init__(self, create_delay=0):
        self.sessions, self.created, self.create_delay = {}, 0, create_delay
        self.complete_on_expire = None      # pi id: client finishes paying just before we expire

    def create(self, **kw):
        time.sleep(self.create_delay)
        self.created += 1
        sid, price = f"cs_{self.created}", kw["line_items"][0]["price_data"]
        s = types.SimpleNamespace(id=sid, url=f"https://checkout.stripe.test/{sid}", status="open",
                                  amount_total=price["unit_amount"], currency=price["currency"],
                                  payment_intent=None)
        self.sessions[sid] = s
        return s

    def retrieve(self, sid, api_key=None):
        if sid not in self.sessions:
            raise stripe.error.InvalidRequestError(f"No such checkout.session: '{sid}'", "id")
        return self.sessions[sid]

    def expire(self, sid, api_key=None):
        s = self.sessions[sid]
        if self.complete_on_expire:
            self.pay(sid, self.complete_on_expire)
        if s.status != "open":
            raise stripe.error.InvalidRequestError("Only Checkout Sessions with a status of open can be expired", None)
        s.status = "expired"
        return s

    def pay(self, sid, pi):
        self.sessions[sid].status, self.sessions[sid].payment_intent = "complete", pi


@pytest.fixture
def fake_checkout(monkeypatch):
    fake = _FakeCheckout()
    for name in ("create", "retrieve", "expire"):
        monkeypatch.setattr(stripe.checkout.Session, name, getattr(fake, name))
    return fake


def _click_pay(invoice):
    from django.test import Client
    from apps.invoicing.tokens import make_invoice_pay_token
    return Client(SERVER_NAME="localhost").get(f"/invoices/pay/{make_invoice_pay_token(str(invoice.id))}/")


@pytest.mark.django_db
def test_second_click_reuses_the_open_checkout(workspace, client_record, fake_checkout):
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record)
    first, second = _click_pay(invoice), _click_pay(invoice)
    assert first.status_code == second.status_code == 302
    assert first["Location"] == second["Location"] == "https://checkout.stripe.test/cs_1"
    assert fake_checkout.created == 1


@pytest.mark.django_db(transaction=True)
def test_simultaneous_clicks_open_one_checkout(workspace, client_record, fake_checkout):
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record)
    fake_checkout.create_delay = 0.4
    locations = []
    _run_together(lambda: locations.append(_click_pay(invoice)["Location"]),
                  lambda: locations.append(_click_pay(invoice)["Location"]))
    assert fake_checkout.created == 1
    assert locations == ["https://checkout.stripe.test/cs_1"] * 2


@pytest.mark.django_db
def test_click_after_paying_shows_processing_not_a_new_checkout(workspace, client_record, fake_checkout):
    """Tab 1 paid; Stripe's webhook hasn't arrived yet; client clicks the link in tab 2."""
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record)
    _click_pay(invoice)
    fake_checkout.pay("cs_1", "pi_1")

    res = _click_pay(invoice)
    assert res.status_code == 200 and b"being processed" in res.content
    assert fake_checkout.created == 1


@pytest.mark.django_db
def test_balance_change_expires_the_old_checkout(workspace, client_record, api_client, fake_checkout):
    """A manual $100 payment after the client opened checkout for $300: the $300 checkout
    must not stay payable, the next click is for the $200 left."""
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record)
    _click_pay(invoice)
    api_client.post(f"/api/invoices/{invoice.id}/record-payment/",
                    {"amount": "100.00", "method": "bank", "paid_at": "2026-11-15T10:00:00Z"},
                    format="json", SERVER_NAME="localhost")

    res = _click_pay(invoice)
    assert fake_checkout.sessions["cs_1"].status == "expired"
    assert res["Location"].endswith("cs_2") and fake_checkout.sessions["cs_2"].amount_total == 20000


@pytest.mark.django_db
def test_paid_just_before_expire_shows_processing(workspace, client_record, api_client, fake_checkout):
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record)
    _click_pay(invoice)
    api_client.post(f"/api/invoices/{invoice.id}/record-payment/",
                    {"amount": "100.00", "method": "bank", "paid_at": "2026-11-15T10:00:00Z"},
                    format="json", SERVER_NAME="localhost")
    fake_checkout.complete_on_expire = "pi_1"

    res = _click_pay(invoice)
    assert res.status_code == 200 and b"being processed" in res.content
    assert fake_checkout.created == 1


@pytest.mark.django_db
def test_paid_and_recorded_checkout_does_not_block_a_new_one(workspace, client_record, fake_checkout):
    """Previous checkout paid + recorded, then the owner raised the invoice total: the
    client can pay the new balance."""
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record)
    _click_pay(invoice)
    fake_checkout.pay("cs_1", "pi_1")
    _post_webhook(workspace, _checkout_event(invoice, pi="pi_1", amount_cents=30000))
    invoice.refresh_from_db()
    invoice.total, invoice.status = Decimal("400.00"), "partially_paid"
    invoice.save()

    res = _click_pay(invoice)
    assert res["Location"].endswith("cs_2") and fake_checkout.sessions["cs_2"].amount_total == 10000


@pytest.mark.django_db
def test_checkout_unknown_to_stripe_is_replaced(workspace, client_record, fake_checkout):
    """Stored session isn't in this Stripe account (e.g. the owner switched accounts)."""
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record)
    invoice.stripe_checkout_session_id = "cs_from_old_account"
    invoice.save()
    assert _click_pay(invoice)["Location"].endswith("cs_1")


@pytest.mark.django_db
def test_overpayment_is_recorded_and_owner_alerted(workspace, client_record, business_owner):
    """Safety net: if a second payment still gets through (e.g. a checkout opened before
    this fix), the money is recorded and the owner + coach are told to refund it."""
    from django.core import mail
    from apps.invoicing.models import Payment
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record)
    _post_webhook(workspace, _checkout_event(invoice, pi="pi_1"))
    mail.outbox.clear()
    _post_webhook(workspace, _checkout_event(invoice, pi="pi_2"))

    invoice.refresh_from_db()
    assert Payment.objects.filter(invoice=invoice).count() == 2
    assert invoice.amount_paid == Decimal("600.00") and invoice.status == "paid"
    alerts = [m for m in mail.outbox if "overpaid" in m.subject]
    assert sorted(m.to[0] for m in alerts) == ["coach@test.com", "owner@test.com"]
    assert all("$300.00" in m.subject for m in alerts)


def test_payment_received_email_has_no_button(workspace, client_record, business_owner):
    """The owner's "Payment Received" email carries no action button (the old "Open
    invoice" link pointed at the wrong address) — in the real email and in the Settings
    → Emails preview."""
    from django.core import mail
    from tasks.email_notices import NO_BUTTON_NOTICES
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record)
    mail.outbox.clear()
    _post_webhook(workspace, _checkout_event(invoice))
    owner_mail = [m for m in mail.outbox if m.to == ["owner@test.com"] and "paid" in m.subject]
    assert owner_mail, [m.subject for m in mail.outbox]
    html = owner_mail[0].alternatives[0][0]
    assert "Open invoice" not in html and "/invoices/" not in html
    assert "Open invoice" not in owner_mail[0].body
    assert "payment_received" in NO_BUTTON_NOTICES


# ── P4: only a checkout that actually took money is recorded as a payment ─────────
#
# Old behaviour: any finished checkout carrying invoice metadata was recorded — including
# a card-save checkout (mode "setup", which auto-pay will use) that charges nothing,
# giving the invoice a $0 Payment row.

@pytest.mark.parametrize("change", [
    {"mode": "setup", "payment_status": "no_payment_required", "payment_intent": None, "amount_total": None},
    {"payment_status": "unpaid"},                 # bank debit still clearing
    {"payment_status": "no_payment_required", "amount_total": 0},
    {"mode": None, "payment_status": None},       # fields missing altogether
    {"amount_total": 0},                          # "paid" but nothing taken
], ids=["card-save-setup", "unpaid", "no-payment-required", "fields-missing", "zero-amount"])
@pytest.mark.django_db
def test_checkout_that_took_no_money_is_not_recorded(workspace, client_record, change):
    from apps.invoicing.models import Payment
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record)
    event = _checkout_event(invoice)
    event["data"]["object"].update(change)

    assert _post_webhook(workspace, event).status_code == 200      # acknowledged, so Stripe doesn't retry
    invoice.refresh_from_db()
    assert Payment.objects.filter(invoice=invoice).count() == 0
    assert invoice.amount_paid == 0 and invoice.status == "sent"


# ── P5: amounts in the currency's own smallest unit, Decimal maths only ───────────
#
# Old behaviour: ×100 to Stripe and float ÷100 back, for every currency. Yen have no
# cents, so a ¥5,000 invoice was sent as 500000 (charging ¥500,000) and a ¥5,000 payment
# was recorded as ¥50.

@pytest.mark.parametrize("amount,currency,minor", [
    ("300.00", "USD", 30000), ("19.99", "EUR", 1999), ("0.01", "GBP", 1),
    ("5000", "JPY", 5000), ("5000.00", "JPY", 5000), ("12000", "KRW", 12000),
    ("12.34", "KWD", 12340),                        # three-decimal: ×1000, last digit 0
    ("10000000.01", "USD", 1000000001),
])
def test_to_and_from_stripe_amounts(amount, currency, minor):
    from apps.invoicing.money import from_minor, to_minor
    assert to_minor(Decimal(amount), currency) == minor
    assert from_minor(minor, currency) == Decimal(amount)
    assert to_minor(Decimal(amount), currency.lower()) == minor     # Stripe sends lower case


def test_amounts_round_to_what_the_currency_can_charge():
    from apps.invoicing.money import is_chargeable, to_minor
    assert to_minor(Decimal("5000.40"), "JPY") == 5000 and to_minor(Decimal("5000.50"), "JPY") == 5001
    assert to_minor(Decimal("1.005"), "USD") == 101
    assert is_chargeable(Decimal("10.50"), "USD") and not is_chargeable(Decimal("10.50"), "JPY")
    assert not is_chargeable(Decimal("1.005"), "USD")


@pytest.mark.django_db
def test_yen_invoice_charges_and_records_the_right_amount(workspace, client_record, fake_checkout):
    from apps.invoicing.models import Payment
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record, total="5000", currency="JPY")

    _click_pay(invoice)
    assert fake_checkout.sessions["cs_1"].amount_total == 5000          # ¥5,000, not ¥500,000
    assert fake_checkout.sessions["cs_1"].currency == "jpy"

    _post_webhook(workspace, _checkout_event(invoice, pi="pi_jpy", amount_cents=5000))
    invoice.refresh_from_db()
    assert Payment.objects.get(invoice=invoice).amount == Decimal("5000")
    assert invoice.amount_paid == Decimal("5000") and invoice.status == "paid"


@pytest.mark.django_db
def test_yen_refund_sends_and_records_the_right_amount(workspace, client_record, api_client, monkeypatch):
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record, total="5000", currency="JPY")
    _post_webhook(workspace, _checkout_event(invoice, pi="pi_jpy", amount_cents=5000))
    sent = {}

    def fake_refund(**kw):
        sent.update(kw)
        return types.SimpleNamespace(id="re_1")
    monkeypatch.setattr(stripe.Refund, "create", fake_refund)

    bad = api_client.post(f"/api/invoices/{invoice.id}/refund/", {"amount": "1000.50"},
                          format="json", SERVER_NAME="localhost")
    assert bad.status_code == 400 and "whole number" in bad.data["detail"]

    res = api_client.post(f"/api/invoices/{invoice.id}/refund/", {"amount": "1000"},
                          format="json", SERVER_NAME="localhost")
    assert res.status_code == 200 and sent["amount"] == 1000             # ¥1,000, not ¥100,000
    invoice.refresh_from_db()
    assert invoice.refund_amount == Decimal("1000") and invoice.status == "partially_refunded"


@pytest.mark.django_db
def test_yen_refund_from_stripe_dashboard_is_recorded_in_yen(workspace, client_record):
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record, total="5000", currency="JPY")
    _post_webhook(workspace, _checkout_event(invoice, pi="pi_jpy", amount_cents=5000))
    meta = {"invoice_id": str(invoice.id), "workspace_id": str(workspace.id)}
    _post_webhook(workspace, {"type": "charge.refunded", "data": {"object": {
        "currency": "jpy", "metadata": meta,
        "refunds": {"data": [{"id": "re_dash", "amount": 2000, "currency": "jpy"}]}}}})

    invoice.refresh_from_db()
    assert invoice.refund_amount == Decimal("2000")


@pytest.mark.django_db
def test_rounding_cent_is_not_reported_as_overpaid(workspace, client_record, business_owner):
    """¥5,000.40 can only be charged as ¥5,000 — paying ¥5,001 for a ¥5,000.50 balance is
    rounding, not a double payment."""
    from django.core import mail
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record, total="5000.50", currency="JPY")
    _post_webhook(workspace, _checkout_event(invoice, pi="pi_jpy", amount_cents=5001))
    invoice.refresh_from_db()
    assert invoice.status == "paid"
    assert not [m for m in mail.outbox if "overpaid" in m.subject]


# ── P7: payment failures reach ErrorLog (once an hour per workspace and kind) ──────
#
# Old behaviour: the pay page and the webhook are plain Django views, so their failures
# only reached the container log — a wrong webhook secret meant every payment silently
# went unrecorded with nothing in Superadmin → Error Log.

def _error_logs(workspace):
    from apps.accounts.models import ErrorLog
    return list(ErrorLog.objects.filter(workspace=workspace).values_list("error_type", "severity", "endpoint"))


@pytest.mark.django_db
def test_webhook_handler_crash_is_logged_and_stripe_retries(workspace, client_record, monkeypatch):
    from django.core import mail
    from apps.accounts.models import User
    from apps.invoicing.public_views import StripeWebhookView
    User.objects.create_user(email="admin@coachos.test", password="x" * 12, full_name="Admin", role="platform_admin")
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record)

    def boom(*a, **kw):
        raise RuntimeError("database went away")
    monkeypatch.setattr(StripeWebhookView, "_handle_checkout_completed", boom)

    assert _post_webhook(workspace, _checkout_event(invoice)).status_code == 500   # Stripe will retry
    assert _error_logs(workspace) == [("RuntimeError", "error", WEBHOOK.format(workspace.id))]
    assert any("admin@coachos.test" in m.to for m in mail.outbox)                   # platform admin alerted


@pytest.mark.django_db
def test_wrong_webhook_secret_is_logged_once_an_hour(workspace, client_record):
    from django.test import Client
    _stripe_workspace(workspace)
    for _ in range(3):      # real signature check — the request isn't signed with this secret
        res = Client(SERVER_NAME="localhost").post(WEBHOOK.format(workspace.id), data=b"{}",
                                                   content_type="application/json", HTTP_STRIPE_SIGNATURE="t=1,v1=bad")
        assert res.status_code == 400
    assert _error_logs(workspace) == [("SignatureVerificationError", "error", WEBHOOK.format(workspace.id))]


@pytest.mark.django_db
def test_webhook_without_saved_secret_is_logged(workspace, client_record):
    from django.test import Client
    res = Client(SERVER_NAME="localhost").post(WEBHOOK.format(workspace.id), data=b"{}",
                                               content_type="application/json")
    assert res.status_code == 400
    assert [e[0] for e in _error_logs(workspace)] == ["RuntimeError"]


@pytest.mark.django_db
def test_pay_page_stripe_failure_is_logged_without_the_pay_token(workspace, client_record, monkeypatch):
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record)
    monkeypatch.setattr(stripe.checkout.Session, "create",
                        mock.Mock(side_effect=stripe.error.APIConnectionError("Stripe unreachable")))
    res = _click_pay(invoice)
    assert res.status_code == 502
    [(error_type, severity, endpoint)] = _error_logs(workspace)
    assert error_type == "APIConnectionError" and severity == "error"
    assert endpoint == "/invoices/pay/<token>/ (invoice INV-0001)"


# ── Who hears about payments (2026-11-18) ─────────────────────────────────────────
#
# Old behaviour: the client got a receipt only when the invoice became fully paid; the
# workspace owner got no email for any payment; Stripe problems only reached the
# platform admins (ErrorLog) — the owner, who has to fix their own Stripe setup, never knew.

def _subjects(to):
    from django.core import mail
    return [m.subject for m in mail.outbox if to in m.to]


@pytest.mark.django_db
def test_partial_card_payment_sends_receipt_and_owner_email(workspace, client_record, business_owner):
    from django.core import mail
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record)
    _post_webhook(workspace, _checkout_event(invoice, pi="pi_1", amount_cents=10000))      # $100 of $300

    [receipt] = [m for m in mail.outbox if "sarah@example.com" in m.to]
    assert "Receipt" in receipt.subject
    assert "Amount paid: $100.00" in receipt.body
    assert "Total paid so far: $100.00" in receipt.body and "Balance due: $200.00" in receipt.body
    assert _subjects("owner@test.com") == ["Sarah Chen paid $100.00 on invoice #INV-0001 (partially paid, $200.00 still due)"]
    assert _subjects("coach@test.com") == []                 # owner only


@pytest.mark.django_db
def test_final_card_payment_says_fully_paid(workspace, client_record, business_owner):
    from django.core import mail
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record)
    _post_webhook(workspace, _checkout_event(invoice, pi="pi_1", amount_cents=10000))
    mail.outbox.clear()
    _post_webhook(workspace, _checkout_event(invoice, pi="pi_2", amount_cents=20000))

    [receipt] = [m for m in mail.outbox if "sarah@example.com" in m.to]
    assert "Amount paid: $200.00" in receipt.body and "paid in full" in receipt.body
    assert "Balance due" not in receipt.body
    assert _subjects("owner@test.com") == ["Sarah Chen paid $200.00 on invoice #INV-0001 (fully paid)"]


@pytest.mark.django_db
def test_owner_payment_email_can_be_switched_off(workspace, client_record, business_owner, settings):
    settings.PAYMENT_RECEIVED_EMAIL_ENABLED = False
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record)
    _post_webhook(workspace, _checkout_event(invoice))
    assert _subjects("owner@test.com") == []
    assert len(_subjects("sarah@example.com")) == 1          # the client's receipt still goes


@pytest.mark.django_db
def test_manual_partial_payment_sends_client_receipt(workspace, client_record, api_client):
    invoice = _invoice(workspace, client_record)
    api_client.post(f"/api/invoices/{invoice.id}/record-payment/",
                    {"amount": "50.00", "method": "cash", "paid_at": "2026-11-18T10:00:00Z"},
                    format="json", SERVER_NAME="localhost")
    assert len(_subjects("sarah@example.com")) == 1
    assert _subjects("owner@test.com") == []                 # they recorded it themselves


@pytest.mark.django_db
def test_wrong_webhook_secret_alerts_owner_once_a_day_and_shows_banner(workspace, client_record, business_owner, api_client):
    from django.test import Client
    from apps.accounts.models import User
    User.objects.create_user(email="admin@coachos.test", password="x" * 12, full_name="Admin", role="platform_admin")
    _stripe_workspace(workspace)
    for _ in range(3):
        Client(SERVER_NAME="localhost").post(WEBHOOK.format(workspace.id), data=b"{}",
                                             content_type="application/json", HTTP_STRIPE_SIGNATURE="t=1,v1=bad")

    owner = _subjects("owner@test.com")
    assert owner == ["Action needed: Stripe payments aren't being recorded: the webhook secret doesn't match"]
    assert len(_subjects("admin@coachos.test")) == 1         # platform admin: ErrorLog alert, once an hour

    problems = api_client.get("/api/settings/stripe/", SERVER_NAME="localhost").data["problems"]
    assert list(problems) == ["webhook_signature"]
    assert str(workspace.id) in problems["webhook_signature"]["fix"]     # tells them which endpoint

    # the next correctly signed webhook clears the banner
    _post_webhook(workspace, _checkout_event(_invoice(workspace, client_record)))
    assert api_client.get("/api/settings/stripe/", SERVER_NAME="localhost").data["problems"] == {}


@pytest.mark.django_db
def test_resaving_webhook_secret_clears_the_banner(workspace, client_record, business_owner, api_client):
    from django.test import Client
    _stripe_workspace(workspace)
    Client(SERVER_NAME="localhost").post(WEBHOOK.format(workspace.id), data=b"{}",
                                         content_type="application/json", HTTP_STRIPE_SIGNATURE="t=1,v1=bad")
    res = api_client.patch("/api/settings/stripe/", {"webhook_secret": "whsec_new"}, format="json", SERVER_NAME="localhost")
    assert res.data["problems"] == {}


@pytest.mark.django_db
def test_pay_page_failure_alerts_owner_with_the_invoice(workspace, client_record, business_owner, api_client,
                                                       fake_checkout, monkeypatch):
    from django.core import mail
    _stripe_workspace(workspace)
    invoice = _invoice(workspace, client_record)
    monkeypatch.setattr(stripe.checkout.Session, "create",
                        mock.Mock(side_effect=stripe.error.APIConnectionError("Stripe unreachable")))
    _click_pay(invoice)

    [alert] = [m for m in mail.outbox if "owner@test.com" in m.to]
    assert alert.subject == "Action needed: A client couldn't start an online payment"
    assert "INV-0001" in alert.alternatives[0][0] and "Stripe unreachable" in alert.alternatives[0][0]
    assert "pay_stripe" in api_client.get("/api/settings/stripe/", SERVER_NAME="localhost").data["problems"]

    # Stripe works again → the next click clears it
    monkeypatch.setattr(stripe.checkout.Session, "create", fake_checkout.create)
    _click_pay(invoice)
    assert api_client.get("/api/settings/stripe/", SERVER_NAME="localhost").data["problems"] == {}


@pytest.mark.django_db
def test_webhook_crash_alerts_owner(workspace, client_record, business_owner, monkeypatch):
    from apps.invoicing.public_views import StripeWebhookView
    _stripe_workspace(workspace)
    monkeypatch.setattr(StripeWebhookView, "_handle_checkout_completed",
                        mock.Mock(side_effect=RuntimeError("database went away")))
    _post_webhook(workspace, _checkout_event(_invoice(workspace, client_record)))
    assert _subjects("owner@test.com") == ["Action needed: A Stripe payment couldn't be recorded"]


@pytest.mark.django_db
def test_problems_stay_in_their_own_workspace(workspace, client_record, business_owner):
    from django.core import mail
    from django.test import Client
    from apps.accounts.models import User, Workspace
    other = Workspace.objects.create(name="Other", slug="other-stripe-ws")
    User.objects.create_user(email="other-owner@test.com", password="x" * 12, full_name="Other Owner",
                             workspace=other, role="business_owner")
    _stripe_workspace(workspace)
    Client(SERVER_NAME="localhost").post(WEBHOOK.format(workspace.id), data=b"{}",
                                         content_type="application/json", HTTP_STRIPE_SIGNATURE="t=1,v1=bad")
    assert _subjects("other-owner@test.com") == []
    other.refresh_from_db()
    assert not ((other.integrations or {}).get("stripe") or {}).get("problems")
