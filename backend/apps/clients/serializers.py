"""CoachOS — clients/serializers.py"""
from rest_framework import serializers
from .models import Client, Assessment, ClientGoal, Commitment, GoalProgress, ClientNote


class ClientNoteSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True)

    class Meta:
        model  = ClientNote
        fields = ["id", "text", "note_type", "created_by_name", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at", "created_by_name"]


class AssessmentSerializer(serializers.ModelSerializer):
    presigned_url    = serializers.SerializerMethodField()
    uploaded_by_name = serializers.CharField(source="uploaded_by.full_name", read_only=True)

    class Meta:
        model  = Assessment
        fields = ["id", "assessment_type", "date", "file_name",
                  "visible_to_client", "uploaded_by", "uploaded_by_name",
                  "created_at", "presigned_url"]
        read_only_fields = ["id", "created_at", "uploaded_by", "uploaded_by_name"]

    def get_presigned_url(self, obj):
        try:
            from django.core.files.storage import default_storage
            from django.conf import settings
            url = default_storage.url(obj.file_s3_key)
            public_url = getattr(settings, 'MINIO_PUBLIC_URL', '')
            endpoint    = getattr(settings, 'AWS_S3_ENDPOINT_URL', '') or ''
            if public_url and endpoint and endpoint in url:
                url = url.replace(endpoint, public_url)
            return url
        except Exception:
            return None


class ClientGoalSerializer(serializers.ModelSerializer):
    progress_count = serializers.IntegerField(
        source="progress_entries.count", read_only=True)

    class Meta:
        model  = ClientGoal
        fields = ["id", "title", "description", "target_date",
                  "status", "created_by", "created_at", "progress_count"]
        read_only_fields = ["id", "created_at", "created_by"]


class CommitmentSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Commitment
        fields = ["id", "text", "activity", "created_by", "created_at"]
        read_only_fields = ["id", "created_at", "created_by"]


class ClientListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list views."""
    coach_name         = serializers.CharField(source="coach.full_name", read_only=True)
    last_activity_type = serializers.CharField(read_only=True, allow_null=True, default=None)
    last_activity_at   = serializers.DateTimeField(read_only=True, allow_null=True, default=None)

    class Meta:
        model  = Client
        fields = ["id", "first_name", "last_name", "job_title", "company", "email",
                  "phone", "active_flag", "status", "portal_access", "lead_source",
                  "tags", "coach_name", "created_at",
                  "last_activity_type", "last_activity_at"]


class ClientDetailSerializer(serializers.ModelSerializer):
    """Full serializer for client detail view."""
    assessments = AssessmentSerializer(many=True, read_only=True)
    goals       = ClientGoalSerializer(many=True, read_only=True)
    commitments = CommitmentSerializer(many=True, read_only=True)
    coach_name  = serializers.CharField(source="coach.full_name", read_only=True)

    class Meta:
        model  = Client
        fields = "__all__"
        read_only_fields = ["id", "workspace", "created_at", "updated_at"]

    def validate_email(self, value):
        if not value:
            return value
        request = self.context.get("request")
        if not request or not request.user.workspace_id:
            return value
        workspace_id = request.user.workspace_id
        # Duplicate client check
        qs = Client.objects.filter(workspace_id=workspace_id, email=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A client with this email already exists in your workspace.")
        # Workspace user (coach/owner) check
        from apps.accounts.models import User
        if User.objects.filter(workspace_id=workspace_id, email=value).exists():
            raise serializers.ValidationError("This email belongs to a coach or team member in your workspace.")
        return value


class GoalProgressSerializer(serializers.ModelSerializer):
    class Meta:
        model  = GoalProgress
        fields = ["id", "goal", "progress_text", "created_at"]
        read_only_fields = ["id", "created_at"]
