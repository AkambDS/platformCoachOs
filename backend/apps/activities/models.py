"""CoachOS — activities/models.py (FR-ACT-*)"""
import uuid
from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateTimeRangeField, RangeOperators
from django.db import models
from django.db.models import F, Func, Q
from apps.accounts.models import WorkspaceModel, User
from apps.clients.models import Client


class _TsTzRange(Func):
    """SQL tstzrange(start_at, end_at) — used only to build the exclusion constraint
    below; start_at/end_at stay plain DateTimeFields, no new column or data migration."""
    function = "tstzrange"
    output_field = DateTimeRangeField()


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
    # Which of the coach's businesses this session was booked under (optional) —
    # e.g. "Rass Consulting" vs "LMT Consulting" — workspace-configurable, see AffiliationConfig.
    affiliation    = models.ForeignKey("AffiliationConfig", on_delete=models.SET_NULL,
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
    # Set when a client picks a slot from the coach's availability on the public
    # reschedule page (apps.activities.public_views.SessionRescheduleView) — a proposed
    # new time awaiting the coach/owner's confirmation, not yet applied to start_at/
    # end_at. Confirming (apps.activities.views.confirm_reschedule) moves start_at/
    # end_at here, clears this field, and re-syncs everything downstream (Google
    # Calendar, reminder flags, confirmation email).
    requested_start_at = models.DateTimeField(null=True, blank=True)
    # When requested_start_at was (most recently) set — deliberately separate from
    # updated_at, which bumps on ANY save (editing notes, title, etc.) and would
    # otherwise make a stale pending request look "fresh" every time something
    # unrelated changes. Used by tasks.reminders.expire_stale_reschedule_requests
    # (calendar.md §7.2/§9.2 Task 5) to measure true age against the workspace's
    # configured TTL. Always set/cleared in lockstep with requested_start_at.
    requested_at   = models.DateTimeField(null=True, blank=True)
    created_at     = models.DateTimeField(auto_now_add=True)
    updated_at     = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "activities_activity"
        ordering = ["-start_at"]
        constraints = [
            # Hard backstop under every application-level check above (calendar.md §7.5,
            # §9.2 Task 1) — Postgres itself refuses to INSERT/UPDATE a row whose
            # [start_at, end_at) overlaps another active row for the same coach, as a
            # single atomic operation. This is what actually closes the race condition
            # application-level "check then write" can't: two concurrent requests can't
            # both pass a Python-side check before either has saved, but they can't both
            # get past this, no matter which of the several write paths (direct edit,
            # confirm_reschedule, portal respond, public token views) either one uses.
            # NULL coach rows never conflict with each other or anything else (Postgres
            # treats NULL as distinct in exclusion constraints, same as unique
            # constraints) — fine, since an activity with no coach assigned isn't really
            # "booked" against anyone's calendar yet.
            ExclusionConstraint(
                name="activity_no_overlapping_coach_bookings",
                expressions=[
                    (_TsTzRange(F("start_at"), F("end_at")), RangeOperators.OVERLAPS),
                    ("coach", RangeOperators.EQUAL),
                ],
                condition=Q(status__in=["scheduled", "rescheduled"]),
            ),
        ]

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


class CoachAvailabilityRule(WorkspaceModel):
    """A recurring weekly open-hours block a coach has set for one specific client.

    Scoped per (coach, client) pair, not per coach — a coach can offer different hours
    to different clients (confirmed design choice, not an oversight). Projected forward
    live over a rolling window rather than stored per-date, so nothing needs refilling
    month to month — see apps.activities.availability.compute_available_slots.

    Availability itself is per-client, but booking a slot removes it from every other
    client's options for that same coach too — conflict-checking against the coach's
    other Activities is always coach-wide, never scoped to just this client, since the
    coach obviously can't be in two sessions at once regardless of whose rule it is.
    """
    coach      = models.ForeignKey(User, on_delete=models.CASCADE, related_name="availability_rules")
    client     = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="coach_availability_rules")
    weekday    = models.PositiveSmallIntegerField(help_text="0=Monday .. 6=Sunday")
    start_time = models.TimeField()
    end_time   = models.TimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "activities_coach_availability_rule"
        ordering = ["weekday", "start_time"]

    def __str__(self):
        return f"{self.coach_id} x {self.client_id}: weekday {self.weekday} {self.start_time}-{self.end_time}"


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


class AffiliationConfig(WorkspaceModel):
    """Workspace-configurable list of businesses a session can be booked under
    (e.g. "Rass Consulting", "LMT Consulting"), each with its own color for the
    Activities list / Schedule Activity picker. Fully custom — no seeded builtins."""
    name       = models.CharField(max_length=50)
    color      = models.CharField(max_length=7, default="#1a2f4e")
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table        = "activities_affiliationconfig"
        unique_together = ["workspace", "name"]
        ordering        = ["sort_order", "name"]

    def __str__(self):
        return f"{self.workspace} / {self.name}"
