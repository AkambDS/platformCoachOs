from rest_framework import serializers
from apps.accounts.models import Workspace
from apps.pipeline.models import PipelineStageConfig
from apps.activities.models import ActivityTypeConfig


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
        fields = ["name", "timezone", "workspace_timezone",
                  "buffer_minutes", "cancellation_hours",
                  "primary_colour", "logo_s3_key", "logo_data", "email_templates"]
        extra_kwargs = {"workspace_timezone": {"required": False}}


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
