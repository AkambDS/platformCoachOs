from django.conf import settings
from rest_framework import serializers
from apps.accounts.models import Workspace
from apps.pipeline.models import PipelineStageConfig
from apps.activities.models import ActivityTypeConfig
from apps.clients.models import ClientStatusConfig, ClientTagConfig


class BrandingSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Workspace
        fields = ["name", "primary_colour", "logo_s3_key"]


class SchedulingSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Workspace
        fields = ["workspace_timezone", "buffer_minutes", "cancellation_hours"]


SYNCABLE_USE_CASES = {"confirmation", "reminder_24h", "reminder_1h", "invoice", "portal_invite"}


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

    def _validate_from_email_domain(self, from_email, label):
        allowed_domains = getattr(settings, "ALLOWED_FROM_EMAIL_DOMAINS", None)
        if not allowed_domains or not from_email:
            return
        if "@" not in from_email:
            raise serializers.ValidationError(f"'{label}': from_email must be a valid email address.")
        domain = from_email.split("@", 1)[1].lower()
        if domain not in allowed_domains:
            allowed = ", ".join(sorted(allowed_domains))
            raise serializers.ValidationError(
                f"'{label}': from_email domain '{domain}' is not authorized. Allowed domains: {allowed}."
            )

    def validate_email_templates(self, value):
        if not isinstance(value, dict):
            return value
        for tmpl_key, tmpl in value.items():
            if isinstance(tmpl, dict):
                self._validate_from_email_domain(tmpl.get("from_email", "").strip(), tmpl_key)
        return value

    def validate_generic_templates(self, value):
        if not isinstance(value, list):
            return value
        for tmpl in value:
            if isinstance(tmpl, dict):
                self._validate_from_email_domain(
                    (tmpl.get("from_email") or "").strip(), tmpl.get("name") or tmpl.get("id", "")
                )
        return value

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
                "from_email":    tmpl.get("from_email", ""),
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
                        "notify_owner", "notify_client", "is_builtin"]
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
