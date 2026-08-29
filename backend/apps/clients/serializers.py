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
            from urllib.parse import quote

            filename = obj.file_name or obj.file_s3_key.split("/")[-1]
            # The Content-Disposition header value must be ISO-8859-1-encodable — S3
            # rejects the whole presigned request otherwise (e.g. em dashes, accented
            # letters, emoji in a filename). Give an ASCII-only fallback in `filename=`
            # plus the real Unicode name (percent-encoded, always ASCII-safe itself) in
            # `filename*=` per RFC 5987 — modern clients use the latter, older ones the former.
            ascii_name = filename.encode("ascii", "ignore").decode("ascii").replace('"', "'") or "file"
            disposition = f"{disposition_type}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"
            if hasattr(default_storage, "bucket"):
                try:
                    url = default_storage.bucket.meta.client.generate_presigned_url(
                        "get_object",
                        Params={
                            "Bucket": default_storage.bucket_name,
                            "Key":    obj.file_s3_key,
                            "ResponseContentDisposition": disposition,
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
    # Model keeps target_date nullable for old rows created before this was required —
    # enforced here instead so new creates/full updates can't skip it (PATCH from the
    # goals list's Share toggle stays partial, so this doesn't block that).
    target_date = serializers.DateField(required=True)

    class Meta:
        model  = ClientGoal
        fields = ["id", "title", "description", "target_date",
                  "status", "visible_to_client", "created_by", "created_at", "progress_count"]
        read_only_fields = ["id", "created_at", "created_by"]


class CommitmentSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Commitment
        fields = ["id", "text", "activity", "created_by", "created_at"]
        read_only_fields = ["id", "created_at", "created_by"]


class ClientListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list views."""
    coach_name         = serializers.CharField(source="coach.full_name", read_only=True)
    # Annotated in ClientViewSet.get_queryset — the client's most-recently-updated
    # pipeline deal, if any (a client isn't required to have one).
    pipeline_stage     = serializers.CharField(read_only=True, allow_null=True, default=None)
    pipeline_deal_id   = serializers.UUIDField(read_only=True, allow_null=True, default=None)

    class Meta:
        model  = Client
        fields = ["id", "first_name", "last_name", "job_title", "company", "email",
                  "phone", "active_flag", "status", "portal_access", "lead_source",
                  "tags", "communication_tags", "coach_name", "created_at",
                  "pipeline_stage", "pipeline_deal_id"]


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
        # Editing an existing client re-submits its current email on every save (the
        # edit form sends the full record, not just the changed field) — if that email
        # happens to collide with another client's (pre-existing duplicate data, or a
        # legacy import), that's not a NEW duplicate being introduced, so it shouldn't
        # block unrelated edits like a job title change. Only enforce uniqueness when
        # the email is actually changing to a new value.
        if self.instance and self.instance.email.lower() == value.lower():
            return value
        request = self.context.get("request")
        if not request or not request.user.workspace_id:
            return value
        workspace_id = request.user.workspace_id
        # Duplicate client check — case-insensitive, since Foo@x.com and foo@x.com are
        # the same mailbox and CSV import already treats them as one duplicate.
        qs = Client.objects.filter(workspace_id=workspace_id, email__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A client with this email already exists in your workspace.")
        # Workspace user (coach/owner) check
        from apps.accounts.models import User
        if User.objects.filter(workspace_id=workspace_id, email__iexact=value).exists():
            raise serializers.ValidationError("This email belongs to a coach or team member in your workspace.")
        return value

    def validate(self, attrs):
        # Second, independent duplicate signal alongside the email check above — catches
        # the same person being re-entered under a different (or blank) email, and
        # matches the same email-or-name duplicate rule CSV import already enforces.
        request = self.context.get("request")
        if not request or not request.user.workspace_id:
            return attrs
        first = (attrs.get("first_name", getattr(self.instance, "first_name", "")) or "").strip()
        last  = (attrs.get("last_name",  getattr(self.instance, "last_name",  "")) or "").strip()
        if not (first or last):
            return attrs
        # Same rationale as validate_email: a full-record resave of an unchanged name
        # shouldn't fail because some other pre-existing record happens to share it.
        if self.instance and self.instance.first_name.lower() == first.lower() and self.instance.last_name.lower() == last.lower():
            return attrs
        workspace_id = request.user.workspace_id
        qs = Client.objects.filter(workspace_id=workspace_id, first_name__iexact=first, last_name__iexact=last)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            full_name = f"{first} {last}".strip()
            raise serializers.ValidationError({"first_name": f'A client named "{full_name}" already exists in this workspace.'})
        return attrs


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
    signed_pdf_name  = serializers.SerializerMethodField()

    class Meta:
        model  = ClientMessageDraft
        fields = ["id", "client", "subject", "intro", "closing", "custom_html",
                  "disable_style", "show_logo", "style",
                  "source_template_id", "source_template_name",
                  "coach_signature", "include_client_signature_line", "signature_name",
                  "client_signed_at", "signed_pdf_url", "signed_pdf_name",
                  "attachments", "status", "sent_at", "created_by", "created_by_name",
                  "created_at", "updated_at"]
        read_only_fields = ["id", "client", "attachments", "status", "sent_at",
                            "client_signed_at", "signed_pdf_url", "signed_pdf_name",
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

    def get_signed_pdf_name(self, obj):
        if not obj.signed_pdf_assessment_id:
            return None
        return obj.signed_pdf_assessment.file_name


class GoalProgressSerializer(serializers.ModelSerializer):
    class Meta:
        model  = GoalProgress
        fields = ["id", "goal", "progress_text", "created_at"]
        read_only_fields = ["id", "created_at"]
