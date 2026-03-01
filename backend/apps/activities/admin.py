from django.contrib import admin
from .models import Activity

@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    list_display  = ["title", "activity_type", "status", "client", "coach", "start_at"]
    list_filter   = ["activity_type", "status", "workspace"]
    search_fields = ["title", "client__first_name", "client__last_name"]
    readonly_fields = ["id", "edit_history", "google_cal_uid", "created_at"]
