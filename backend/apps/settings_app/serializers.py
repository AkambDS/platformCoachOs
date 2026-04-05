from rest_framework import serializers
from apps.accounts.models import Workspace


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
                  "primary_colour", "logo_s3_key"]
        extra_kwargs = {"workspace_timezone": {"required": False}}
