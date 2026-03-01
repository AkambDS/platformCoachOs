"""CoachOS — activities/models.py (FR-ACT-*)"""
import uuid
from django.db import models
from apps.accounts.models import WorkspaceModel, User
from apps.clients.models import Client


class Activity(WorkspaceModel):
    """All 7 activity types (FR-ACT-01). RRULE recurrence. edit_history for FR-ACT-15."""

    class ActivityType(models.TextChoices):
        APPOINTMENT = "appointment", "Appointment"
        TASK        = "task",        "Task"
        CALL        = "call",        "Call"
        SESSION     = "session",     "Session"
        TRAINING    = "training",    "Training"
        TRAVEL      = "travel",      "Travel"
        CUSTOM      = "custom",      "Custom"

    class Status(models.TextChoices):
        SCHEDULED    = "scheduled",     "Scheduled"
        COMPLETED    = "completed",     "Completed"
        MISSED       = "missed",        "Missed Session"
        CANCELLED    = "cancelled",     "Cancelled"

    id             = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    coach          = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="activities")
    client         = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="activities")
    activity_type  = models.CharField(max_length=20, choices=ActivityType.choices)
    title          = models.CharField(max_length=300)
    status         = models.CharField(max_length=20, choices=Status.choices, default=Status.SCHEDULED)
    start_at       = models.DateTimeField()
    end_at         = models.DateTimeField()
    location       = models.CharField(max_length=300, blank=True)
    notes          = models.TextField(blank=True, help_text="Internal notes — not visible to client")
    # Linked deal (optional)
    deal           = models.ForeignKey("pipeline.Deal", on_delete=models.SET_NULL,
                                       null=True, blank=True, related_name="activities")
    # Recurrence (FR-ACT-07)
    rrule          = models.TextField(blank=True, help_text="RRULE string e.g. FREQ=WEEKLY;COUNT=12")
    recurrence_id  = models.UUIDField(null=True, blank=True,
                                      help_text="Parent activity for recurring series")
    # Calendar sync (FR-ACT-05/06)
    google_cal_uid = models.CharField(max_length=500, blank=True)
    caldav_uid     = models.CharField(max_length=500, blank=True)
    # Edit history (FR-ACT-15) — list of {changed_by, changed_at, diff}
    edit_history   = models.JSONField(default=list)
    created_at     = models.DateTimeField(auto_now_add=True)
    updated_at     = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "activities_activity"
        ordering = ["-start_at"]

    def __str__(self):
        return f"{self.activity_type}: {self.title} ({self.start_at.date()})"

    def mark_missed(self, recorded_by):
        """Mark as missed session and record in client engagement history (FR-ACT-13)."""
        self.status = self.Status.MISSED
        self._append_edit(recorded_by, {"status": ["scheduled", "missed"]})
        self.save()

    def _append_edit(self, user, diff):
        from django.utils import timezone
        self.edit_history.append({
            "changed_by":   str(user.id),
            "changed_by_name": user.full_name,
            "changed_at":   timezone.now().isoformat(),
            "diff":         diff,
        })
