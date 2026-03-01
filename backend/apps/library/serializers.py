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
            return default_storage.url(obj.s3_key)
        except Exception:
            return None

    def create(self, validated_data):
        validated_data["workspace"]   = self.context["request"].user.workspace
        validated_data["uploaded_by"] = self.context["request"].user
        return super().create(validated_data)
