from django.db import models
from apps.accounts.models import WorkspaceModel, User


class AccessLog(WorkspaceModel):
    class Action(models.TextChoices):
        VIEWED_NOTES        = "viewed_notes",         "Viewed Notes"
        CREATED_NOTE        = "created_note",         "Created Note"
        UPDATED_NOTE        = "updated_note",         "Updated Note"
        DELETED_NOTE        = "deleted_note",         "Deleted Note"
        VIEWED_ASSESSMENTS  = "viewed_assessments",   "Viewed Assessments"
        DOWNLOADED_FILE     = "downloaded_file",      "Downloaded File"
        UPLOADED_FILE       = "uploaded_file",        "Uploaded File"
        DELETED_FILE        = "deleted_file",         "Deleted File"
        VIEWED_GOALS        = "viewed_goals",         "Viewed Goals"
        VIEWED_FEEDBACK     = "viewed_feedback",      "Viewed Feedback"
        CREATED_CLIENT      = "created_client",       "Created Client"
        UPDATED_CLIENT      = "updated_client",       "Updated Client"
        DELETED_CLIENT      = "deleted_client",       "Deleted Client"
        CHANGED_PASSWORD    = "changed_password",     "Changed Password"
        INVITED_TEAM_MEMBER = "invited_team_member",  "Invited Team Member"
        UPDATED_TEAM_MEMBER = "updated_team_member",  "Updated Team Member"
        REMOVED_TEAM_MEMBER = "removed_team_member",  "Removed Team Member"

    user       = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="access_logs")
    user_name  = models.CharField(max_length=200, blank=True)
    client_id  = models.UUIDField(null=True, blank=True)
    client_name = models.CharField(max_length=200, blank=True)
    action     = models.CharField(max_length=30, choices=Action.choices)
    metadata   = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "audit_accesslog"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user_name} — {self.action} ({self.created_at.date()})"
