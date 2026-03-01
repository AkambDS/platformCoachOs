from django.contrib import admin
from .models import Client, Assessment, ClientGoal, Commitment, GoalProgress


@admin.register(Client)
class ClientAdmin(admin.ModelAdmin):
    list_display   = ["full_name", "company", "email", "active_flag", "workspace", "created_at"]
    list_filter    = ["active_flag", "portal_access", "workspace"]
    search_fields  = ["first_name", "last_name", "email", "company"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(Assessment)
class AssessmentAdmin(admin.ModelAdmin):
    list_display  = ["client", "assessment_type", "date", "visible_to_client"]
    list_filter   = ["assessment_type", "visible_to_client"]


@admin.register(ClientGoal)
class GoalAdmin(admin.ModelAdmin):
    list_display  = ["title", "client", "status", "target_date", "created_at"]
    list_filter   = ["status"]
