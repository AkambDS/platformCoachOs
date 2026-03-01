"""CoachOS — clients/serializers.py"""
from rest_framework import serializers
from .models import Client, Assessment, ClientGoal, Commitment, GoalProgress


class AssessmentSerializer(serializers.ModelSerializer):
    presigned_url = serializers.SerializerMethodField()

    class Meta:
        model  = Assessment
        fields = ["id", "assessment_type", "date", "file_name",
                  "visible_to_client", "uploaded_by", "created_at", "presigned_url"]
        read_only_fields = ["id", "created_at", "uploaded_by"]

    def get_presigned_url(self, obj):
        # Generate 60-second presigned URL via django-storages
        try:
            from django.core.files.storage import default_storage
            return default_storage.url(obj.file_s3_key)
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
    coach_name = serializers.CharField(source="coach.full_name", read_only=True)

    class Meta:
        model  = Client
        fields = ["id", "first_name", "last_name", "company", "email",
                  "active_flag", "tags", "coach_name", "created_at"]


class ClientDetailSerializer(serializers.ModelSerializer):
    """Full serializer for client detail view."""
    assessments = AssessmentSerializer(many=True, read_only=True)
    goals       = ClientGoalSerializer(many=True, read_only=True)
    commitments = CommitmentSerializer(many=True, read_only=True)

    class Meta:
        model  = Client
        fields = "__all__"
        read_only_fields = ["id", "workspace", "created_at", "updated_at"]

    def create(self, validated_data):
        validated_data["workspace"] = self.context["request"].user.workspace
        validated_data["coach"]     = self.context["request"].user
        return super().create(validated_data)


class GoalProgressSerializer(serializers.ModelSerializer):
    class Meta:
        model  = GoalProgress
        fields = ["id", "goal", "progress_text", "created_at"]
        read_only_fields = ["id", "created_at"]
