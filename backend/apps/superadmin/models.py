from django.db import models


class PlatformInvoice(models.Model):
    """Invoice raised by superadmin to a workspace owner for CoachOS subscription."""
    class Status(models.TextChoices):
        DRAFT   = "draft",   "Draft"
        SENT    = "sent",    "Sent"
        PAID    = "paid",    "Paid"
        OVERDUE = "overdue", "Overdue"

    workspace    = models.ForeignKey("accounts.Workspace", on_delete=models.CASCADE, related_name="platform_invoices")
    amount       = models.DecimalField(max_digits=10, decimal_places=2)
    plan         = models.CharField(max_length=20)
    period_start = models.DateField()
    period_end   = models.DateField()
    notes        = models.TextField(blank=True)
    line_items   = models.JSONField(default=list, blank=True)  # [{description, quantity, unit_price}]
    status       = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "superadmin_platforminvoice"
        ordering = ["-created_at"]


class MaintenanceBanner(models.Model):
    """Maintenance notices shown on the login screen. Multiple can exist; only active ones show."""
    message    = models.TextField()
    is_active  = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "superadmin_maintenancebanner"
        ordering = ["-created_at"]
