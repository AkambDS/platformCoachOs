"""CoachOS — clients/models.py (FR-CRM-*)"""
import uuid
from django.contrib.postgres.fields import ArrayField
from django.db import models
from apps.accounts.models import WorkspaceModel, User, Workspace


class ClientStatusConfig(models.Model):
    """Per-workspace client status labels (Lead, Active, Inactive, Archive, custom…)."""
    workspace  = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='client_status_configs')
    label      = models.CharField(max_length=50)
    color      = models.CharField(max_length=7, default='#8c8279')
    is_builtin = models.BooleanField(default=False)
    sort_order = models.IntegerField(default=0)

    class Meta:
        db_table       = 'clients_statusconfig'
        ordering       = ['sort_order', 'label']
        unique_together = [['workspace', 'label']]

    def __str__(self):
        return self.label


class ClientTagConfig(models.Model):
    """Per-workspace tag definitions with colors."""
    workspace  = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='client_tag_configs')
    name       = models.CharField(max_length=50)
    color      = models.CharField(max_length=7, default='#2d6a9f')

    class Meta:
        db_table       = 'clients_tagconfig'
        ordering       = ['name']
        unique_together = [['workspace', 'name']]

    def __str__(self):
        return self.name


class Client(WorkspaceModel):
    """Core client CRM record (FR-CRM-01 to 15)."""
    class LeadSource(models.TextChoices):
        REFERRAL   = "referral",    "Referral"
        WEBSITE    = "website",     "Website"
        LINKEDIN   = "linkedin",    "LinkedIn"
        CONFERENCE = "conference",  "Conference"
        OTHER      = "other",       "Other"

    id           = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    coach        = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="clients")
    # Core fields
    first_name   = models.CharField(max_length=100)
    last_name    = models.CharField(max_length=100)
    company      = models.CharField(max_length=200, blank=True)
    job_title    = models.CharField(max_length=200, blank=True)
    email        = models.EmailField()
    phone        = models.CharField(max_length=30, blank=True)
    website      = models.URLField(blank=True)
    linkedin_url = models.URLField(blank=True)
    # Address
    primary_address  = models.JSONField(default=dict, blank=True)
    billing_address  = models.JSONField(default=dict, blank=True)
    # CRM metadata (FR-CRM-02/03/06)
    tags         = ArrayField(models.CharField(max_length=50), default=list, blank=True)
    status       = models.CharField(max_length=50, default='Lead', blank=True)
    active_flag  = models.BooleanField(default=False, help_text="Manually set by coach (FR-CRM-03)")
    portal_access = models.BooleanField(default=False, help_text="Enables client portal login (FR-CP-11)")
    lead_source  = models.CharField(max_length=200, blank=True)
    birth_date   = models.DateField(null=True, blank=True)
    anniversary_date = models.DateField(null=True, blank=True)
    notes        = models.TextField(blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "clients_client"
        ordering = ["last_name", "first_name"]

    def __str__(self):
        return f"{self.first_name} {self.last_name}"

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}"


class ClientNote(WorkspaceModel):
    """Date-stamped coach notes per client."""
    class NoteType(models.TextChoices):
        GENERAL     = "general",     "General"
        SESSION     = "session",     "Session Note"
        OBSERVATION = "observation", "Observation"
        COMMITMENT  = "commitment",  "Commitment"

    id                = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client            = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="client_notes")
    text              = models.TextField()
    note_type         = models.CharField(max_length=20, choices=NoteType.choices, default=NoteType.GENERAL)
    created_by        = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")
    visible_to_client = models.BooleanField(default=False, help_text="Share this note with the client in their portal")
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "clients_clientnote"
        ordering = ["-created_at"]


class Assessment(WorkspaceModel):
    """Files uploaded per client — assessments, contracts, reports."""
    class AssessmentType(models.TextChoices):
        CONTRACT   = "contract",   "Contract"
        DISC       = "disc",       "DISC Assessment"
        MOTIVATORS = "motivators", "Motivators"
        BEHAVIORAL = "behavioral", "Behavioral Assessment"
        OTHER      = "other",      "Other"

    id               = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client           = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="assessments")
    assessment_type  = models.CharField(max_length=20, choices=AssessmentType.choices)
    date             = models.DateField()
    file_s3_key      = models.CharField(max_length=500)
    file_name        = models.CharField(max_length=255)
    visible_to_client = models.BooleanField(default=False, help_text="Shows in portal (FR-CP-12)")
    uploaded_by      = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at       = models.DateTimeField(auto_now_add=True)
    updated_at       = models.DateTimeField(auto_now=True)
    # Versioning — bumped when edited live via OnlyOffice (mirrors library.KnowledgeItem)
    version          = models.PositiveSmallIntegerField(default=1)
    previous_versions = models.JSONField(default=list)  # [{version, s3_key, replaced_at}]

    class Meta:
        db_table = "clients_assessment"
        ordering = ["-date"]


class ClientGoal(WorkspaceModel):
    """Goals per client, set by coach (FR-CP-02)."""
    class Status(models.TextChoices):
        ACTIVE    = "active",    "Active"
        COMPLETED = "completed", "Completed"
        PAUSED    = "paused",    "Paused"

    id          = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client      = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="goals")
    title       = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    target_date = models.DateField(null=True, blank=True)
    status      = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    created_by  = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "clients_clientgoal"
        ordering = ["-created_at"]


class Commitment(WorkspaceModel):
    """Post-session commitment recorded by coach (FR-CP-03)."""
    id         = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client     = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="commitments")
    activity   = models.ForeignKey("activities.Activity", on_delete=models.SET_NULL,
                                   null=True, blank=True, related_name="commitments")
    text       = models.TextField()
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "clients_commitment"
        ordering = ["-created_at"]


class ClientMessageDraft(WorkspaceModel):
    """Client-communication email — composed from a generic email template
    (tagged for the 'client_communication' use-case in Workspace.generic_templates)
    and freely edited per-client. Can be saved as a draft and/or sent to the client;
    sending also logs a matching Activity on the client (see ClientMessageDraftViewSet.send)."""
    id                  = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client              = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="message_drafts")
    subject             = models.CharField(max_length=300, blank=True)
    intro               = models.TextField(blank=True)
    closing             = models.TextField(blank=True)
    custom_html         = models.TextField(blank=True)
    disable_style       = models.BooleanField(default=False)
    show_logo           = models.BooleanField(default=True)
    style               = models.JSONField(default=dict, blank=True)
    source_template_id  = models.CharField(max_length=64, blank=True)
    source_template_name = models.CharField(max_length=200, blank=True)
    attachments         = models.JSONField(default=list, blank=True)  # [{s3_key, file_name, size}]
    status              = models.CharField(max_length=20, default="draft")  # draft | sent | signed
    sent_at             = models.DateTimeField(null=True, blank=True)
    # Signature block — coach draws their signature (stored as a PNG data URL) in the
    # compose screen. When include_client_signature_line is set, the outgoing email also
    # gets a "Review & Sign" link (see apps.clients.tokens / apps.clients.public_views)
    # the client can use to draw their own signature with no login required; once signed,
    # both signatures are baked into a finalized PDF saved as a client File (see
    # signed_pdf_assessment).
    coach_signature             = models.TextField(blank=True)
    include_client_signature_line = models.BooleanField(default=False)
    signature_name              = models.CharField(max_length=200, blank=True,
                                        help_text="Overrides the coach's account name in the '— {name}' sign-off line")
    client_signature     = models.TextField(blank=True)
    client_signed_at     = models.DateTimeField(null=True, blank=True)
    client_signer_ip     = models.GenericIPAddressField(null=True, blank=True)
    client_signer_user_agent = models.CharField(max_length=300, blank=True)
    signed_pdf_assessment = models.ForeignKey("Assessment", on_delete=models.SET_NULL,
                                              null=True, blank=True, related_name="+")
    created_by          = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")
    created_at          = models.DateTimeField(auto_now_add=True)
    updated_at          = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "clients_messagedraft"
        ordering = ["-updated_at"]


class GoalProgress(WorkspaceModel):
    """Free-form progress entry by client (FR-CP-04)."""
    id            = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client        = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="progress_entries")
    goal          = models.ForeignKey(ClientGoal, on_delete=models.CASCADE, related_name="progress_entries")
    progress_text = models.TextField()
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "clients_goalprogress"
        ordering = ["-created_at"]


class EmailLog(WorkspaceModel):
    """A record of every client-facing email actually sent — powers the Email
    Communication tab's "sent" history. Written by the various tasks.email.send_*
    functions right after a successful send; see EmailLog.log() below."""
    class Category(models.TextChoices):
        INVOICE               = "invoice",               "Invoice"
        PAYMENT_RECEIPT       = "payment_receipt",        "Payment Receipt"
        ACTIVITY_CONFIRMATION = "activity_confirmation",  "Session Confirmation"
        ACTIVITY_REMINDER     = "activity_reminder",      "Session Reminder"
        ACTIVITY_RESCHEDULE   = "activity_reschedule",    "Session Rescheduled"
        ACTIVITY_CANCELLATION = "activity_cancellation",  "Session Cancelled"
        CLIENT_MESSAGE        = "client_message",         "Client Message"
        PORTAL_INVITE         = "portal_invite",           "Portal Invite"

    id              = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client          = models.ForeignKey(Client, on_delete=models.CASCADE, null=True, blank=True, related_name="email_logs")
    category        = models.CharField(max_length=30, choices=Category.choices)
    subject         = models.CharField(max_length=300, blank=True)
    recipient_email = models.EmailField(blank=True)
    body_html       = models.TextField(blank=True)  # snapshot of what was actually sent, for the detail view
    related_id      = models.CharField(max_length=64, blank=True)  # invoice/activity/draft id — informational
    sent_at         = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "clients_emaillog"
        ordering = ["-sent_at"]

    def __str__(self):
        return f"{self.category} -> {self.recipient_email} ({self.sent_at})"

    @classmethod
    def log(cls, *, workspace, category, recipient_email, client=None, subject="", related_id="", body_html=""):
        """Best-effort logging — a logging failure must never break the actual send."""
        try:
            cls.objects.create(
                workspace=workspace, category=category, client=client,
                subject=subject or "", recipient_email=recipient_email or "",
                related_id=str(related_id) if related_id else "", body_html=body_html or "",
            )
        except Exception:
            import logging
            logging.getLogger(__name__).exception("EmailLog.log failed for category=%s", category)
