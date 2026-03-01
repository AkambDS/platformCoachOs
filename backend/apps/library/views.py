from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.contrib.postgres.search import SearchVector, SearchQuery
from .models import KnowledgeFolder, KnowledgeItem
from .serializers import FolderSerializer, KnowledgeItemSerializer
from apps.accounts.permissions import IsAssistantOrAbove


class FolderViewSet(viewsets.ModelViewSet):
    serializer_class   = FolderSerializer
    permission_classes = [IsAssistantOrAbove]

    def get_queryset(self):
        # Return only root folders (tree built recursively in serializer)
        return KnowledgeFolder.objects.filter(
            workspace=self.request.user.workspace, parent=None
        )


class KnowledgeItemViewSet(viewsets.ModelViewSet):
    serializer_class   = KnowledgeItemSerializer
    permission_classes = [IsAssistantOrAbove]

    def get_queryset(self):
        qs = KnowledgeItem.objects.filter(workspace=self.request.user.workspace)
        # Full-text search (FR-LIB-08) — PostgreSQL SearchVector
        q = self.request.query_params.get("q")
        if q:
            qs = qs.annotate(
                search=SearchVector("title", "description")
            ).filter(search=SearchQuery(q))
        # Filters
        ctype = self.request.query_params.get("content_type")
        vis   = self.request.query_params.get("visibility")
        if ctype: qs = qs.filter(content_type=ctype)
        if vis:   qs = qs.filter(visibility=vis)
        return qs

    @action(detail=True, methods=["post"], url_path="track-view")
    def track_view(self, request, pk=None):
        """POST /api/library/items/{id}/track-view/ (FR-LIB-07)"""
        item = self.get_object()
        item.view_count += 1
        item.save(update_fields=["view_count"])
        return Response({"view_count": item.view_count})
