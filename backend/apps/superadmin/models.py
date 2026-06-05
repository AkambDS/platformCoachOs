from django.db import models


class MaintenanceBanner(models.Model):
    """Maintenance notices shown on the login screen. Multiple can exist; only active ones show."""
    message    = models.TextField()
    is_active  = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "superadmin_maintenancebanner"
        ordering = ["-created_at"]
