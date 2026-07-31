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
        CLIENT_COMMUNICATION = "client_communication", "Client Communication"

    class Status(models.TextChoices):
        SCHEDULED    = "scheduled",     "Scheduled"
        COMPLETED    = "completed",     "Completed"
        LATE         = "late",          "Late"
        RESCHEDULED  = "rescheduled",   "Rescheduled"
        MISSED       = "missed",        "Missed Session"
        CANCELLED    = "cancelled",     "Cancelled"

    class RsvpStatus(models.TextChoices):
        NEEDS_ACTION = "needsAction", "Needs Action"
        ACCEPTED     = "accepted",    "Accepted"
        DECLINED     = "declined",    "Declined"
        TENTATIVE    = "tentative",   "Tentative"

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
    meeting_link   = models.URLField(max_length=500, blank=True, help_text="Zoom / Meet / Teams join URL")
    # Recurrence (FR-ACT-07)
    rrule          = models.TextField(blank=True, help_text="RRULE string e.g. FREQ=WEEKLY;COUNT=12")
    repeat_until   = models.DateField(null=True, blank=True, help_text="End date for recurring series")
    recurrence_id  = models.UUIDField(null=True, blank=True,
                                      help_text="Parent activity for recurring series")
    # Calendar sync (FR-ACT-05/06)
    google_cal_uid = models.CharField(max_length=500, blank=True)
    caldav_uid     = models.CharField(max_length=500, blank=True)
    # Edit history (FR-ACT-15) — list of {changed_by, changed_at, diff}
    edit_history   = models.JSONField(default=list)
    # Client RSVP — set via the tokenized confirm/cancel/reschedule links
    client_confirmed      = models.BooleanField(default=False)
    client_confirmed_at   = models.DateTimeField(null=True, blank=True)
    # Client RSVP — set via Google Calendar attendee sync (accept/decline on the real invite)
    client_rsvp_status    = models.CharField(max_length=20, choices=RsvpStatus.choices,
                                              default=RsvpStatus.NEEDS_ACTION)
    client_rsvp_synced_at = models.DateTimeField(null=True, blank=True)
    # Overrides the workspace's default "confirmation" generic template (Settings >
    # Generic Templates) for this activity's booking confirmation email — e.g. picking
    # a specific booking-confirmation flavor at schedule time. Blank = workspace default.
    email_template_id = models.CharField(max_length=100, blank=True)
    # Notification tracking — timestamps show exactly when each email was sent
    confirmation_sent_at  = models.DateTimeField(null=True, blank=True)
    cancellation_sent_at  = models.DateTimeField(null=True, blank=True)
    # Reminder tracking — prevents double-firing when cron job runs every 15 min
    reminder_24h_sent = models.BooleanField(default=False)
    reminder_1h_sent  = models.BooleanField(default=False)
    reminder_24h_sent_at  = models.DateTimeField(null=True, blank=True)
    reminder_1h_sent_at   = models.DateTimeField(null=True, blank=True)
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


class GoogleCalendarWatch(models.Model):
    """One active Google Calendar push-notification channel per coach's primary calendar.

    Google delivers only a change ping (no payload) to our webhook — sync_token lets us
    pull the actual delta via events.list(syncToken=...) to see what changed.
    """
    coach       = models.OneToOneField(User, on_delete=models.CASCADE, related_name="calendar_watch")
    channel_id  = models.UUIDField(default=uuid.uuid4, editable=False)
    resource_id = models.CharField(max_length=200, blank=True)
    sync_token  = models.TextField(blank=True)
    expiration  = models.DateTimeField(null=True, blank=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "activities_googlecalendarwatch"

    def __str__(self):
        return f"watch({self.coach_id}) exp={self.expiration}"


BUILTIN_TYPES = ["appointment", "task", "call", "session", "training", "travel", "custom", "client_communication"]


class ActivityTypeConfig(WorkspaceModel):
    """Workspace-configurable activity types. Built-ins seeded on first access."""
    name       = models.CharField(max_length=50)
    color      = models.CharField(max_length=7, default="#1a1714")
    is_active  = models.BooleanField(default=True)
    is_builtin = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table        = "activities_activitytypeconfig"
        unique_together = ["workspace", "name"]
        ordering        = ["sort_order", "name"]

    def __str__(self):
        return f"{self.workspace} / {self.name}"
