from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User, Workspace, WorkspaceInvitation, AuditLog


@admin.register(Workspace)
class WorkspaceAdmin(admin.ModelAdmin):
    list_display  = ["name", "slug", "plan", "is_active", "created_at"]
    list_filter   = ["plan", "is_active"]
    search_fields = ["name", "slug"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display   = ["email", "full_name", "role", "workspace", "is_active", "date_joined"]
    list_filter    = ["role", "is_active", "workspace"]
    search_fields  = ["email", "full_name"]
    ordering       = ["-date_joined"]
    fieldsets      = (
        (None,           {"fields": ("email", "password")}),
        ("Profile",      {"fields": ("full_name", "timezone", "avatar_url")}),
        ("Workspace",    {"fields": ("workspace", "role")}),
        ("Permissions",  {"fields": ("is_active", "is_staff", "is_superuser")}),
        ("Dates",        {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = ((None, {"fields": ("email", "full_name", "password1", "password2", "workspace", "role")}),)


@admin.register(WorkspaceInvitation)
class InvitationAdmin(admin.ModelAdmin):
    list_display  = ["email", "workspace", "role", "accepted", "expires_at", "created_at"]
    list_filter   = ["role", "accepted"]
    search_fields = ["email"]
    readonly_fields = ["token", "created_at"]


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display   = ["action", "table_name", "record_id", "user", "workspace", "created_at"]
    list_filter    = ["action", "table_name"]
    search_fields  = ["table_name", "record_id"]
    readonly_fields = [f.name for f in AuditLog._meta.fields]

    def has_add_permission(self, request):    return False
    def has_change_permission(self, request, obj=None): return False
    def has_delete_permission(self, request, obj=None): return False
