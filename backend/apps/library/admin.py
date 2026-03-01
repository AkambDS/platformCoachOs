from django.contrib import admin
from .models import KnowledgeFolder, KnowledgeItem

@admin.register(KnowledgeFolder)
class FolderAdmin(admin.ModelAdmin):
    list_display = ["name", "parent", "workspace", "created_at"]

@admin.register(KnowledgeItem)
class ItemAdmin(admin.ModelAdmin):
    list_display  = ["title", "content_type", "visibility", "view_count", "version", "created_at"]
    list_filter   = ["content_type", "visibility"]
    search_fields = ["title", "description"]
