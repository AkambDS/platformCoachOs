from django.contrib import admin
from .models import Deal, StageHistory

@admin.register(Deal)
class DealAdmin(admin.ModelAdmin):
    list_display  = ["client", "stage", "deal_value", "coach", "stage_changed_at"]
    list_filter   = ["stage", "workspace"]
    search_fields = ["client__first_name", "client__last_name"]

@admin.register(StageHistory)
class StageHistoryAdmin(admin.ModelAdmin):
    list_display = ["deal", "from_stage", "to_stage", "changed_by", "changed_at"]
    readonly_fields = [f.name for f in StageHistory._meta.fields]
    def has_add_permission(self, r): return False
    def has_change_permission(self, r, o=None): return False
