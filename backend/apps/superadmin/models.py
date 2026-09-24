import uuid

from django.db import models


class DemoLead(models.Model):
    """Captured from the "Log In as Demo User" gate on the public Login page (see
    frontend/src/components/DemoGateModal.tsx) — lets the team follow up with people
    who tried the product demo. Not tied to any Workspace; the demo session itself
    always runs against the one shared coachos-demo workspace regardless of who's
    behind the wheel."""
    id             = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email          = models.EmailField(unique=True)
    first_name     = models.CharField(max_length=100)
    login_count    = models.PositiveIntegerField(default=0)
    tour_started   = models.BooleanField(default=False)
    tour_completed = models.BooleanField(default=False)
    first_seen_at  = models.DateTimeField(auto_now_add=True)
    last_seen_at   = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "superadmin_demolead"
        ordering = ["-last_seen_at"]


class PlatformInvoice(models.Model):
    """Invoice raised by superadmin to a workspace owner for CoachOS subscription."""
    class Status(models.TextChoices):
        DRAFT   = "draft",   "Draft"
        SENT    = "sent",    "Sent"
        PAID    = "paid",    "Paid"
        OVERDUE = "overdue", "Overdue"

    workspace         = models.ForeignKey("accounts.Workspace", on_delete=models.CASCADE, related_name="platform_invoices")
    amount            = models.DecimalField(max_digits=10, decimal_places=2)
    plan              = models.CharField(max_length=20)
    period_start      = models.DateField()
    period_end        = models.DateField()
    notes             = models.TextField(blank=True)
    line_items        = models.JSONField(default=list, blank=True)
    status            = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    is_recurring      = models.BooleanField(default=False)
    recurrence_months = models.PositiveSmallIntegerField(default=1, null=True, blank=True)
    logo_data           = models.TextField(blank=True, default='')
    show_platform_text  = models.BooleanField(default=True)
    billed_to_name      = models.CharField(max_length=200, blank=True, default='')
    billed_to_email     = models.CharField(max_length=200, blank=True, default='')
    billed_to_extra     = models.TextField(blank=True, default='')
    created_at          = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "superadmin_platforminvoice"
        ordering = ["-created_at"]


class PlatformPayment(models.Model):
    """A payment recorded against a PlatformInvoice (supports partial/recurring payments)."""
    class Method(models.TextChoices):
        BANK_TRANSFER = "bank_transfer", "Bank Transfer"
        CASH          = "cash",          "Cash"
        CARD          = "card",          "Card"
        OTHER         = "other",         "Other"

    invoice      = models.ForeignKey(PlatformInvoice, on_delete=models.CASCADE, related_name="payments")
    amount       = models.DecimalField(max_digits=10, decimal_places=2)
    payment_date = models.DateField()
    method       = models.CharField(max_length=30, choices=Method.choices, default=Method.BANK_TRANSFER)
    notes        = models.TextField(blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "superadmin_platformpayment"
        ordering = ["-payment_date"]


class MaintenanceBanner(models.Model):
    """Maintenance notices shown on the login screen. Multiple can exist; only active ones show."""
    message    = models.TextField()
    is_active  = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "superadmin_maintenancebanner"
        ordering = ["-created_at"]
