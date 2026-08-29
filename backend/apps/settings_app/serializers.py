from rest_framework import serializers
from apps.accounts.models import Workspace
from apps.pipeline.models import PipelineStageConfig
from apps.activities.models import ActivityTypeConfig, AffiliationConfig
from apps.clients.models import ClientStatusConfig, ClientTagConfig, CommunicationTagConfig, LeadSourceConfig


class BrandingSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Workspace
        fields = ["name", "primary_colour", "logo_s3_key"]


class SchedulingSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Workspace
        fields = ["workspace_timezone", "buffer_minutes", "cancellation_hours"]


SYNCABLE_USE_CASES = {"confirmation", "reschedule", "reminder_24h", "reminder_1h", "invoice", "payment_receipt", "portal_invite", "team_invite", "pipeline"}


class WorkspaceSerializer(serializers.ModelSerializer):
    """Combined serializer for the frontend /api/settings/workspace/ endpoint."""
    timezone = serializers.CharField(source="workspace_timezone", required=False)

    class Meta:
        model  = Workspace
        fields = ["id", "name", "timezone", "workspace_timezone",
                  "buffer_minutes", "cancellation_hours",
                  "primary_colour", "logo_s3_key", "logo_data", "email_templates",
                  "generic_templates", "template_use_case_map",
                  "address", "city", "state", "zip_code", "phone"]
        read_only_fields = ["id", "name"]
        extra_kwargs = {"workspace_timezone": {"required": False}}

    def update(self, instance, validated_data):
        instance = super().update(instance, validated_data)
        # Sync any generic-template → use-case assignment into email_templates, so the
        # existing send pipeline (tasks/email.py) picks it up with zero changes there.
        # 'client_communication' has no runtime sender — it's read directly from
        # generic_templates/template_use_case_map by the client-draft compose UI instead.
        use_case_map    = instance.template_use_case_map or {}
        templates_by_id = {t.get("id"): t for t in (instance.generic_templates or []) if isinstance(t, dict)}
        email_templates = dict(instance.email_templates or {})
        changed = False
        for use_case, tmpl_id in use_case_map.items():
            if use_case not in SYNCABLE_USE_CASES:
                continue
            tmpl = templates_by_id.get(tmpl_id)
            if not tmpl:
                continue
            email_templates[use_case] = {
                "subject":       tmpl.get("subject", ""),
                "intro":         tmpl.get("intro", ""),
                "closing":       tmpl.get("closing", ""),
                "custom_html":   tmpl.get("custom_html", ""),
                "disable_style": tmpl.get("disable_style", False),
                "show_logo":     tmpl.get("show_logo", True),
                "style":         tmpl.get("style", {}),
            }
            changed = True
        if changed:
            instance.email_templates = email_templates
            instance.save(update_fields=["email_templates"])
        return instance


class PipelineStageConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model        = PipelineStageConfig
        fields       = ["id", "slug", "label", "color", "order", "follow_up_days",
                        "alert_stop_after_days", "notify_owner", "notify_client", "is_builtin"]
        read_only_fields = ["id", "is_builtin"]


class ActivityTypeConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ActivityTypeConfig
        fields = ["id", "name", "color", "is_active", "is_builtin", "sort_order"]
        read_only_fields = ["id", "is_builtin"]


class ClientStatusConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ClientStatusConfig
        fields = ["id", "label", "color", "is_builtin", "sort_order"]
        read_only_fields = ["id", "is_builtin"]


class ClientTagConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ClientTagConfig
        fields = ["id", "name", "color"]
        read_only_fields = ["id"]


class CommunicationTagConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model  = CommunicationTagConfig
        fields = ["id", "name", "color"]
        read_only_fields = ["id"]


class LeadSourceConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model  = LeadSourceConfig
        fields = ["id", "label", "is_builtin", "sort_order"]
        read_only_fields = ["id", "is_builtin"]


class AffiliationConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model  = AffiliationConfig
        fields = ["id", "name", "color", "sort_order"]
        read_only_fields = ["id"]
