"""CoachOS — feedback/serializers.py"""
from rest_framework import serializers
from .models import FeedbackTicket, FeedbackComment


class FeedbackCommentSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True)

    class Meta:
        model  = FeedbackComment
        fields = ["id", "text", "created_by_name", "created_at"]
        read_only_fields = ["id", "created_by_name", "created_at"]


class FeedbackListSerializer(serializers.ModelSerializer):
    submitted_by_name = serializers.CharField(source="submitted_by.full_name", read_only=True)
    comment_count     = serializers.IntegerField(read_only=True)

    class Meta:
        model  = FeedbackTicket
        fields = [
            "id", "title", "category", "priority", "status",
            "page_url", "submitted_by_name", "comment_count",
            "created_at", "updated_at", "closed_at",
        ]


class FeedbackDetailSerializer(serializers.ModelSerializer):
    submitted_by_name = serializers.CharField(source="submitted_by.full_name", read_only=True)
    comments          = FeedbackCommentSerializer(many=True, read_only=True)

    class Meta:
        model  = FeedbackTicket
        fields = [
            "id", "title", "description", "category", "priority", "status",
            "page_url", "screenshot_data",
            "submitted_by_name", "comments",
            "created_at", "updated_at", "closed_at",
        ]
        read_only_fields = ["id", "submitted_by_name", "comments", "created_at", "updated_at"]


class FeedbackCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model  = FeedbackTicket
        fields = ["title", "description", "category", "priority", "page_url", "screenshot_data"]
