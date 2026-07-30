"""CoachOS — clients/serializers.py"""
from rest_framework import serializers
from .models import Client, Assessment, ClientGoal, Commitment, GoalProgress, ClientNote, ClientMessageDraft


class ClientNoteSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True)

    class Meta:
        model  = ClientNote
        fields = ["id", "text", "note_type", "visible_to_client", "created_by_name", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at", "created_by_name"]


class AssessmentSerializer(serializers.ModelSerializer):
    presigned_url    = serializers.SerializerMethodField()
    inline_url       = serializers.SerializerMethodField()
    uploaded_by_name = serializers.CharField(source="uploaded_by.full_name", read_only=True)

    class Meta:
        model  = Assessment
        fields = ["id", "assessment_type", "date", "file_name",
                  "visible_to_client", "uploaded_by", "uploaded_by_name",
                  "created_at", "presigned_url", "inline_url", "version"]
        read_only_fields = ["id", "created_at", "uploaded_by", "uploaded_by_name", "version"]

    def _presigned(self, obj, disposition_type):
        try:
            from django.core.files.storage import default_storage
            from django.conf import settings

            filename  = obj.file_name or obj.file_s3_key.split("/")[-1]
            safe_name = filename.replace('"', '\\"')
            if hasattr(default_storage, "bucket"):
                try:
                    url = default_storage.bucket.meta.client.generate_presigned_url(
                        "get_object",
                        Params={
                            "Bucket": default_storage.bucket_name,
                            "Key":    obj.file_s3_key,
                            "ResponseContentDisposition": f'{disposition_type}; filename="{safe_name}"',
                        },
                        ExpiresIn=3600,
                    )
                except Exception:
                    url = default_storage.url(obj.file_s3_key)
            else:
                url = default_storage.url(obj.file_s3_key)
            public_url = getattr(settings, 'MINIO_PUBLIC_URL', '')
            endpoint    = getattr(settings, 'AWS_S3_ENDPOINT_URL', '') or ''
            if public_url and endpoint and endpoint in url:
                url = url.replace(endpoint, public_url)
            return url
        except Exception:
            return None

    def get_presigned_url(self, obj):
        return self._presigned(obj, "attachment")

    def get_inline_url(self, obj):
        """Presigned URL with inline disposition — for iframe/image preview."""
        return self._presigned(obj, "inline")


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


def _presigned_url(s3_key):
    try:
        from django.core.files.storage import default_storage
        from django.conf import settings
        url = default_storage.url(s3_key)
        public_url = getattr(settings, 'MINIO_PUBLIC_URL', '')
        endpoint    = getattr(settings, 'AWS_S3_ENDPOINT_URL', '') or ''
        if public_url and endpoint and endpoint in url:
            url = url.replace(endpoint, public_url)
        return url
    except Exception:
        return None


class ClientMessageDraftSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True)
    attachments      = serializers.SerializerMethodField()
    signed_pdf_url   = serializers.SerializerMethodField()

    class Meta:
        model  = ClientMessageDraft
        fields = ["id", "client", "subject", "intro", "closing", "custom_html",
                  "disable_style", "show_logo", "style",
                  "source_template_id", "source_template_name",
                  "coach_signature", "include_client_signature_line", "signature_name",
                  "client_signed_at", "signed_pdf_url",
                  "attachments", "status", "sent_at", "created_by", "created_by_name",
                  "created_at", "updated_at"]
        read_only_fields = ["id", "client", "attachments", "status", "sent_at",
                            "client_signed_at", "signed_pdf_url",
                            "created_by", "created_by_name", "created_at", "updated_at"]

    def get_attachments(self, obj):
        return [
            {**a, "url": _presigned_url(a.get("s3_key"))}
            for a in (obj.attachments or [])
        ]

    def get_signed_pdf_url(self, obj):
        if not obj.signed_pdf_assessment_id:
            return None
        return _presigned_url(obj.signed_pdf_assessment.file_s3_key)


class GoalProgressSerializer(serializers.ModelSerializer):
    class Meta:
        model  = GoalProgress
        fields = ["id", "goal", "progress_text", "created_at"]
        read_only_fields = ["id", "created_at"]
