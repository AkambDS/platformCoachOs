"""CoachOS — library/models.py (FR-LIB-*)"""
import uuid
from django.db import models
from apps.accounts.models import WorkspaceModel, User


class KnowledgeFolder(WorkspaceModel):
    """Nested folder system (FR-LIB-02/12). parent=None → root folder."""
    id     = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name   = models.CharField(max_length=200)
    parent = models.ForeignKey("self", on_delete=models.CASCADE,
                               null=True, blank=True, related_name="children")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "library_folder"
        ordering = ["name"]

    def __str__(self):
        return self.name


class KnowledgeItem(WorkspaceModel):
    """Library content item (FR-LIB-01 to 13)."""

    class ContentType(models.TextChoices):
        PDF      = "pdf",      "PDF"
        DOCUMENT = "document", "Document"
        VIDEO    = "video",    "Video"
        LINK     = "link",     "Link"
        PLAYBOOK = "playbook", "Playbook/Worksheet"

    class Visibility(models.TextChoices):
        INTERNAL       = "internal",       "Internal Only"
        CLIENT_VISIBLE = "client_visible", "Client Visible"

    id             = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    folder         = models.ForeignKey(KnowledgeFolder, on_delete=models.SET_NULL,
                                       null=True, blank=True, related_name="items")
    content_type   = models.CharField(max_length=20, choices=ContentType.choices)
    title          = models.CharField(max_length=300)
    description    = models.TextField(blank=True)
    tags           = models.JSONField(default=list)
    visibility     = models.CharField(max_length=20, choices=Visibility.choices,
                                      default=Visibility.INTERNAL)
    # Content — file or URL
    s3_key         = models.CharField(max_length=500, blank=True)
    file_name      = models.CharField(max_length=255, blank=True)
    url            = models.URLField(blank=True)            # for VIDEO/LINK types
    rich_text      = models.TextField(blank=True)           # for DOCUMENT type
    # Versioning (FR-LIB-10)
    version        = models.PositiveSmallIntegerField(default=1)
    previous_versions = models.JSONField(default=list)     # [{version, s3_key, created_at}]
    # Usage tracking (FR-LIB-07)
    view_count     = models.PositiveIntegerField(default=0)
    download_count = models.PositiveIntegerField(default=0)
    uploaded_by    = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at     = models.DateTimeField(auto_now_add=True)
    updated_at     = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_item"
        ordering = ["-created_at"]

    def __str__(self):
        return self.title
