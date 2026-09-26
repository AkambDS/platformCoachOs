from rest_framework import serializers
from .models import KnowledgeFolder, KnowledgeItem


class FolderSerializer(serializers.ModelSerializer):
    children = serializers.SerializerMethodField()

    class Meta:
        model  = KnowledgeFolder
        fields = ["id", "name", "parent", "children", "created_at"]
        read_only_fields = ["id", "created_at"]

    def get_children(self, obj):
        return FolderSerializer(obj.children.all(), many=True).data

    def create(self, validated_data):
        validated_data["workspace"] = self.context["request"].user.workspace
        return super().create(validated_data)


class KnowledgeItemSerializer(serializers.ModelSerializer):
    presigned_url    = serializers.SerializerMethodField()
    inline_url       = serializers.SerializerMethodField()
    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model  = KnowledgeItem
        fields = ["id", "folder", "content_type", "title", "description", "tags",
                  "visibility", "s3_key", "file_name", "url", "video_url",
                  "shared_client_ids", "shared_user_ids",
                  "version", "view_count", "download_count", "uploaded_by",
                  "uploaded_by_name", "created_at", "presigned_url", "inline_url"]
        read_only_fields = ["id", "view_count", "download_count",
                            "uploaded_by", "created_at", "version"]

    def get_inline_url(self, obj):
        """Presigned URL with inline disposition — for iframe/image preview."""
        if not obj.s3_key: return None
        from urllib.parse import quote
        from apps.accounts.storage_utils import generate_presigned_url

        filename = obj.file_name or obj.s3_key.split("/")[-1]
        # Content-Disposition must be ISO-8859-1-encodable — S3 rejects the whole
        # presigned request if the filename has e.g. an em dash, accented letters,
        # or emoji. ASCII fallback in `filename=`, real Unicode name (percent-encoded,
        # always ASCII itself) in `filename*=` per RFC 5987.
        ascii_name = filename.encode("ascii", "ignore").decode("ascii").replace('"', "'") or "file"
        disposition = f"inline; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"
        return generate_presigned_url(obj.s3_key, disposition=disposition)

    def get_uploaded_by_name(self, obj):
        return obj.uploaded_by.full_name if obj.uploaded_by else None

    def get_presigned_url(self, obj):
        if not obj.s3_key: return None
        from urllib.parse import quote
        from apps.accounts.storage_utils import generate_presigned_url

        filename   = obj.file_name or obj.s3_key.split("/")[-1]
        ascii_name = filename.encode("ascii", "ignore").decode("ascii").replace('"', "'") or "file"
        disposition = f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"
        return generate_presigned_url(obj.s3_key, disposition=disposition)

    def create(self, validated_data):
        validated_data["workspace"]   = self.context["request"].user.workspace
        validated_data["uploaded_by"] = self.context["request"].user
        return super().create(validated_data)
