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


class WorkspaceSerializer(serializers.ModelSerializer):
    """Combined serializer for the frontend /api/settings/workspace/ endpoint."""
    timezone = serializers.CharField(source="workspace_timezone", required=False)

    class Meta:
        model  = Workspace
        fields = ["id", "name", "timezone", "workspace_timezone",
                  "buffer_minutes", "cancellation_hours",
                  "primary_colour", "logo_s3_key", "logo_data", "email_templates",
                  "address", "city", "state", "zip_code"]
        read_only_fields = ["id", "name"]
        extra_kwargs = {"workspace_timezone": {"required": False}}

    def validate_email_templates(self, value):
        if not isinstance(value, dict):
            return value
        allowed_domains = getattr(settings, "ALLOWED_FROM_EMAIL_DOMAINS", None)
        if not allowed_domains:
            return value
        for tmpl_key, tmpl in value.items():
            if not isinstance(tmpl, dict):
                continue
            from_email = tmpl.get("from_email", "").strip()
            if not from_email:
                continue
            if "@" not in from_email:
                raise serializers.ValidationError(
                    f"'{tmpl_key}': from_email must be a valid email address."
                )
            domain = from_email.split("@", 1)[1].lower()
            if domain not in allowed_domains:
                allowed = ", ".join(sorted(allowed_domains))
                raise serializers.ValidationError(
                    f"'{tmpl_key}': from_email domain '{domain}' is not authorized. "
                    f"Allowed domains: {allowed}."
                )
        return value


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
