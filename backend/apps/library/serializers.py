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
    presigned_url = serializers.SerializerMethodField()

    class Meta:
        model  = KnowledgeItem
        fields = ["id", "folder", "content_type", "title", "description", "tags",
                  "visibility", "s3_key", "file_name", "url", "version",
                  "view_count", "download_count", "uploaded_by",
                  "created_at", "presigned_url"]
        read_only_fields = ["id", "view_count", "download_count",
                            "uploaded_by", "created_at", "version"]

    def get_presigned_url(self, obj):
        if not obj.s3_key: return None
        try:
            from django.core.files.storage import default_storage
            from django.conf import settings as dj_settings
            url = default_storage.url(obj.s3_key)
            # In local dev, MinIO is reachable from the browser at localhost:9000
            # but the Docker-internal hostname is 'minio' — swap it out.
            minio_internal = getattr(dj_settings, "AWS_S3_ENDPOINT_URL", "")
            public_minio   = getattr(dj_settings, "MINIO_PUBLIC_URL", "")
            if minio_internal and public_minio and minio_internal in url:
                url = url.replace(minio_internal, public_minio)
            return url
        except Exception:
            return None

    def create(self, validated_data):
        validated_data["workspace"]   = self.context["request"].user.workspace
        validated_data["uploaded_by"] = self.context["request"].user
        return super().create(validated_data)
