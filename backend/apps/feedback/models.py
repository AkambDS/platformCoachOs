"""CoachOS — feedback/models.py"""
import uuid
from django.db import models
from apps.accounts.models import WorkspaceModel


class FeedbackTicket(WorkspaceModel):
    class Category(models.TextChoices):
        BUG         = "bug",         "Bug"
        FEATURE     = "feature",     "Feature Request"
        UI          = "ui",          "UI / UX"
        PERFORMANCE = "performance", "Performance"
        GENERAL     = "general",     "General"

    class Priority(models.TextChoices):
        LOW      = "low",      "Low"
        MEDIUM   = "medium",   "Medium"
        HIGH     = "high",     "High"
        CRITICAL = "critical", "Critical"

    class Status(models.TextChoices):
        NEW         = "new",         "New"
        REVIEWING   = "reviewing",   "Reviewing"
        IN_PROGRESS = "in_progress", "In Progress"
        RESOLVED    = "resolved",    "Resolved"
        CLOSED      = "closed",      "Closed"

    id              = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title           = models.CharField(max_length=200)
    description     = models.TextField()
    category        = models.CharField(max_length=20, choices=Category.choices, default=Category.GENERAL)
    priority        = models.CharField(max_length=20, choices=Priority.choices, default=Priority.MEDIUM)
    status          = models.CharField(max_length=20, choices=Status.choices, default=Status.NEW)
    page_url        = models.CharField(max_length=500, blank=True)
    screenshot_data = models.TextField(blank=True)   # base64 data-URL, same pattern as logo_data
    submitted_by    = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True,
        related_name="feedback_submitted",
    )
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)
    closed_at       = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "feedback_tickets"
        ordering = ["-created_at"]

    def __str__(self):
        return f"[{self.get_category_display()}] {self.title}"


class FeedbackComment(WorkspaceModel):
    id         = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ticket     = models.ForeignKey(FeedbackTicket, on_delete=models.CASCADE, related_name="comments")
    text       = models.TextField()
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True,
        related_name="feedback_comments",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "feedback_comments"
        ordering = ["created_at"]

    def __str__(self):
        return f"Comment on {self.ticket_id}"
