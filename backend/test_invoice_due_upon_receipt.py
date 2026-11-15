"""
Subscription invoices: "Due upon receipt" radio. The flag only changes how the due date
is shown/worded — the billing date stays in due_date so the monthly schedule still moves
forward, and every generated invoice in the series inherits the choice.

Run: pytest test_invoice_due_upon_receipt.py -v
"""
from datetime import date
from unittest import mock

import pytest

from test_tenant_isolation import _api, _make_workspace, _no_side_effects  # noqa: F401  (autouse fixture)


@pytest.mark.django_db
def test_upon_receipt_saved_inherited_and_schedule_advances():
    from apps.invoicing.models import Invoice
    from tasks.invoicing import _generate_and_send_next
    ws, owner, _, _, client, _ = _make_workspace("i")

    res = _api(owner).post("/api/invoices/", {
        "client": str(client.id), "invoice_type": "subscription", "currency": "USD",
        "issue_date": "2026-11-01", "due_date": "2026-12-01", "due_upon_receipt": True,
        "billing_cycle": "monthly", "billing_day": 1, "subscription_start": "2026-11-01",
        "subscription_auto_send": True,
        "items": [{"description": "Coaching", "quantity": 1, "unit_price": "500"}],
    }, format="json")
    assert res.status_code == 201, res.content
    inv = Invoice.objects.get(pk=res.json()["id"])
    assert inv.due_upon_receipt is True
    assert inv.due_date == date(2026, 12, 1)          # billing date kept for scheduling
    assert inv.due_text() == "receipt"                 # "payment due on receipt"

    # Generated next-period invoice inherits the flag; the schedule moves a month on
    inv.next_invoice_date = date(2026, 12, 1)
    inv.save(update_fields=["next_invoice_date"])
    with mock.patch("tasks.email.send_invoice_email"):
        _generate_and_send_next(inv)
    child = Invoice.objects.filter(workspace=ws).exclude(pk=inv.pk).get()
    assert child.due_upon_receipt is True
    assert child.due_date == date(2026, 12, 1)
    assert child.next_invoice_date == date(2027, 1, 1)


@pytest.mark.django_db
def test_default_and_editable_after_send():
    from apps.invoicing.models import Invoice
    ws, owner, _, _, client, _ = _make_workspace("j")
    inv = Invoice.objects.create(workspace=ws, client=client, coach=owner, number="INV-0001",
                                 due_date=date(2026, 12, 15), status=Invoice.Status.SENT)
    assert inv.due_upon_receipt is False and inv.due_text() == "December 15, 2026"
    # Like due_date, it's a presentation detail — still changeable after sending
    res = _api(owner).patch(f"/api/invoices/{inv.id}/", {"due_upon_receipt": True}, format="json")
    assert res.status_code == 200, res.content
    inv.refresh_from_db()
    assert inv.due_upon_receipt is True
