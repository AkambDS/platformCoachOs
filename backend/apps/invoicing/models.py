"""CoachOS — invoicing/models.py (FR-INV-*)"""
import uuid
from django.db import models
from apps.accounts.models import WorkspaceModel, User
from apps.clients.models import Client


class Invoice(WorkspaceModel):
    """CoachOS invoice — links to dj-stripe via stripe_invoice_id (FR-INV-01 to 17)."""

    class InvoiceType(models.TextChoices):
        ONE_TIME     = "one_time",     "One-Time"
        SUBSCRIPTION = "subscription", "Subscription"

    class Status(models.TextChoices):
        DRAFT            = "draft",            "Draft"
        SENT             = "sent",             "Sent"
        PARTIALLY_PAID   = "partially_paid",   "Partially Paid"
        PAID             = "paid",             "Paid"
        OVERDUE          = "overdue",          "Overdue"
        VOID             = "void",             "Void"
        REFUNDED         = "refunded",         "Refunded"

    id                = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client            = models.ForeignKey(Client, on_delete=models.PROTECT, related_name="invoices")
    coach             = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    invoice_type      = models.CharField(max_length=20, choices=InvoiceType.choices, default=InvoiceType.ONE_TIME)
    status            = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    number            = models.CharField(max_length=50, unique=True)
    currency          = models.CharField(max_length=3, default="USD")
    subtotal          = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    discount_type     = models.CharField(max_length=10, default="percent",
                                          choices=[("percent","Percent"),("fixed","Fixed")])
    discount_value    = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    tax_percent       = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    total             = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    amount_paid       = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    notes             = models.TextField(blank=True)
    due_date          = models.DateField(null=True, blank=True)
    sent_at           = models.DateTimeField(null=True, blank=True)
    paid_at           = models.DateTimeField(null=True, blank=True)
    # Stripe link
    stripe_invoice_id     = models.CharField(max_length=100, blank=True, db_index=True)
    stripe_payment_link   = models.URLField(blank=True)
    stripe_subscription_id = models.CharField(max_length=100, blank=True)
    # PDF
    pdf_s3_key        = models.CharField(max_length=500, blank=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "invoicing_invoice"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Invoice #{self.number} — {self.client}"

    def calculate_total(self):
        subtotal = sum(item.line_total for item in self.items.all())
        self.subtotal = subtotal
        discount = (subtotal * self.discount_value / 100
                    if self.discount_type == "percent"
                    else self.discount_value)
        after_discount = subtotal - discount
        tax = after_discount * self.tax_percent / 100
        self.total = after_discount + tax
        return self.total


class InvoiceItem(models.Model):
    """Line items per invoice (FR-INV-01)."""
    id          = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice     = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="items")
    description = models.CharField(max_length=300)
    quantity    = models.DecimalField(max_digits=8, decimal_places=2, default=1)
    unit_price  = models.DecimalField(max_digits=12, decimal_places=2)
    discount    = models.DecimalField(max_digits=5, decimal_places=2, default=0)

    class Meta:
        db_table = "invoicing_invoiceitem"

    @property
    def line_total(self):
        return self.quantity * self.unit_price * (1 - self.discount / 100)


class Payment(WorkspaceModel):
    """Manual / offline payment recording (FR-INV-08)."""
    class Method(models.TextChoices):
        STRIPE   = "stripe",   "Stripe"
        CASH     = "cash",     "Cash"
        BANK     = "bank",     "Bank Transfer"
        CHEQUE   = "cheque",   "Cheque"

    id              = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice         = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="payments")
    amount          = models.DecimalField(max_digits=12, decimal_places=2)
    method          = models.CharField(max_length=10, choices=Method.choices)
    stripe_payment_id = models.CharField(max_length=100, blank=True)
    notes           = models.TextField(blank=True)
    paid_at         = models.DateTimeField()
    recorded_by     = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "invoicing_payment"
        ordering = ["-paid_at"]
