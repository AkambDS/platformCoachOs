"""CoachOS — invoicing/models.py (FR-INV-*)"""
import uuid
from django.db import models
from apps.accounts.models import WorkspaceModel, User
from apps.clients.models import Client


class ServiceCatalogItem(WorkspaceModel):
    """Reusable service/line-item template for quick invoice population."""
    id          = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name        = models.CharField(max_length=200)
    description = models.CharField(max_length=500, blank=True)
    unit_price  = models.DecimalField(max_digits=12, decimal_places=2)
    sort_order  = models.PositiveSmallIntegerField(default=0)
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "invoicing_service_catalog"
        ordering = ["sort_order", "name"]

    def __str__(self):
        return f"{self.name} (${self.unit_price})"


class Invoice(WorkspaceModel):
    """CoachOS invoice — links to dj-stripe via stripe_invoice_id (FR-INV-01 to 17)."""

    class InvoiceType(models.TextChoices):
        ONE_TIME     = "one_time",     "One-Time"
        SUBSCRIPTION = "subscription", "Subscription"

    class Status(models.TextChoices):
        DRAFT              = "draft",              "Draft"
        SENT               = "sent",              "Sent"
        PARTIALLY_PAID     = "partially_paid",    "Partially Paid"
        PAID               = "paid",              "Paid"
        OVERDUE            = "overdue",           "Overdue"
        VOID               = "void",             "Void"
        REFUNDED           = "refunded",          "Refunded"
        PARTIALLY_REFUNDED = "partially_refunded","Partially Refunded"

    id                = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client            = models.ForeignKey(Client, on_delete=models.PROTECT, related_name="invoices")
    coach             = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    invoice_type      = models.CharField(max_length=20, choices=InvoiceType.choices, default=InvoiceType.ONE_TIME)
    status            = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    number            = models.CharField(max_length=50)
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
    # Dates
    issue_date        = models.DateField(null=True, blank=True)
    # Subscription billing
    class BillingCycle(models.TextChoices):
        MONTHLY   = "monthly",   "Monthly"
        QUARTERLY = "quarterly", "Quarterly"
        YEARLY    = "yearly",    "Yearly"

    billing_cycle         = models.CharField(max_length=20, choices=BillingCycle.choices, blank=True)
    billing_day           = models.PositiveSmallIntegerField(null=True, blank=True)  # 1-28
    subscription_start    = models.DateField(null=True, blank=True)
    subscription_end      = models.DateField(null=True, blank=True)  # null = run until manually stopped
    subscription_auto_send = models.BooleanField(default=True)
    # When set, tasks.invoicing.dispatch_subscription_invoices will clone this invoice
    # into the next period's invoice and (if subscription_auto_send) email it once this
    # date arrives. Cleared on the invoice that fires — the newly-generated invoice
    # becomes the new schedule anchor — so each invoice fires at most once.
    next_invoice_date = models.DateField(null=True, blank=True)
    # Refunds
    refund_amount     = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    refund_reason     = models.CharField(max_length=300, blank=True)
    refunded_at       = models.DateTimeField(null=True, blank=True)
    # PDF
    pdf_s3_key        = models.CharField(max_length=500, blank=True)
    # Hides a closed-out invoice (paid/void/refunded) from the default list without
    # touching its financial state — purely a view filter, always reversible.
    archived          = models.BooleanField(default=False)
    archived_at       = models.DateTimeField(null=True, blank=True)
    # Overrides the workspace's default "invoice" generic template (Settings > Generic
    # Templates) for this invoice's send/reminder emails — e.g. a separate "Monthly"
    # template vs the default "Daily"/one-time one. Blank = use the workspace default.
    email_template_id = models.CharField(max_length=100, blank=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "invoicing_invoice"
        ordering = ["-created_at"]
        unique_together = [("workspace", "number")]

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

    def compute_next_invoice_date(self):
        """Date the next invoice in this subscription series should be generated and
        sent — one billing_cycle after this invoice's own due date, with the day-of-
        month snapped to billing_day. None if this isn't an auto-sending subscription
        invoice, or the series has ended (subscription_end reached)."""
        if self.invoice_type != self.InvoiceType.SUBSCRIPTION or not self.subscription_auto_send:
            return None
        if not self.billing_cycle or not self.billing_day:
            return None
        from dateutil.relativedelta import relativedelta
        from django.utils import timezone as _tz
        cycle_delta = {
            self.BillingCycle.MONTHLY:   relativedelta(months=1),
            self.BillingCycle.QUARTERLY: relativedelta(months=3),
            self.BillingCycle.YEARLY:    relativedelta(years=1),
        }.get(self.billing_cycle)
        if not cycle_delta:
            return None
        base = self.due_date or self.subscription_start or _tz.now().date()
        next_date = base + cycle_delta
        day = min(self.billing_day, 28)
        try:
            next_date = next_date.replace(day=day)
        except ValueError:
            pass
        if self.subscription_end and next_date > self.subscription_end:
            return None
        return next_date


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
