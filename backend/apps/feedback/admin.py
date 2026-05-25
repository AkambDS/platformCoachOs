from django.contrib import admin
from .models import FeedbackTicket, FeedbackComment


class CommentInline(admin.TabularInline):
    model = FeedbackComment
    extra = 0
    readonly_fields = ["created_by", "created_at"]


@admin.register(FeedbackTicket)
class FeedbackTicketAdmin(admin.ModelAdmin):
    list_display   = ["title", "category", "priority", "status", "submitted_by", "workspace", "created_at"]
    list_filter    = ["category", "priority", "status", "workspace"]
    search_fields  = ["title", "description"]
    readonly_fields = ["id", "submitted_by", "created_at", "updated_at"]
    inlines        = [CommentInline]


@admin.register(FeedbackComment)
class FeedbackCommentAdmin(admin.ModelAdmin):
    list_display  = ["ticket", "created_by", "created_at"]
    readonly_fields = ["id", "created_by", "created_at"]
