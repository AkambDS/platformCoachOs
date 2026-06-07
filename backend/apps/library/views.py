import uuid as uuid_lib
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from django.contrib.postgres.search import SearchVector, SearchQuery
from django.core.files.storage import default_storage
from .models import KnowledgeFolder, KnowledgeItem
from .serializers import FolderSerializer, KnowledgeItemSerializer
from apps.accounts.permissions import IsAssistantOrAbove

FILE_SIZE_LIMIT = 100 * 1024 * 1024  # 100 MB

MIME_TO_CTYPE = {
    "application/pdf": "pdf",
    "video/":          "video",
    "audio/":          "video",
}


def _detect_ctype(mime: str, filename: str) -> str:
    for prefix, ctype in MIME_TO_CTYPE.items():
        if mime.startswith(prefix):
            return ctype
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext == "pdf":
        return "pdf"
    if ext in ("mp4", "mov", "avi", "webm", "mkv"):
        return "video"
    return "document"


class FolderViewSet(viewsets.ModelViewSet):
    serializer_class   = FolderSerializer
    permission_classes = [IsAssistantOrAbove]

    def get_queryset(self):
        return KnowledgeFolder.objects.filter(
            workspace=self.request.user.workspace, parent=None
        )

    def perform_create(self, serializer):
        serializer.save(workspace=self.request.user.workspace)


class KnowledgeItemViewSet(viewsets.ModelViewSet):
    serializer_class   = KnowledgeItemSerializer
    permission_classes = [IsAssistantOrAbove]

    def get_queryset(self):
        from django.db.models import Q
        user = self.request.user
        qs = KnowledgeItem.objects.filter(workspace=user.workspace)
        if user.role in ("business_owner", "platform_admin"):
            pass  # owner sees everything
        else:
            # Coaches/assistants: see internal + client_visible + their own private uploads
            qs = qs.filter(
                Q(visibility__in=["internal", "client_visible"]) |
                Q(visibility="private", uploaded_by=user)
            )
        q      = self.request.query_params.get("q")
        ctype  = self.request.query_params.get("content_type")
        vis    = self.request.query_params.get("visibility")
        folder = self.request.query_params.get("folder")
        if q:
            qs = qs.annotate(search=SearchVector("title", "description")).filter(search=SearchQuery(q))
        if ctype:  qs = qs.filter(content_type=ctype)
        if vis:    qs = qs.filter(visibility=vis)
        if folder == "root":
            qs = qs.filter(folder__isnull=True)
        elif folder:
            qs = qs.filter(folder__id=folder)
        return qs

    @action(detail=False, methods=["post"], url_path="upload", parser_classes=[MultiPartParser])
    def upload(self, request):
        """POST /api/library/items/upload/ — upload a file to S3 and create a library item."""
        file = request.FILES.get("file")
        if not file:
            return Response({"detail": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)
        if file.size > FILE_SIZE_LIMIT:
            return Response({"detail": "File must be under 100 MB."}, status=status.HTTP_400_BAD_REQUEST)

        mime  = file.content_type or ""
        ext   = file.name.rsplit(".", 1)[-1].lower() if "." in file.name else "bin"
        s3_key = f"library/{request.user.workspace.id}/{uuid_lib.uuid4()}.{ext}"

        try:
            default_storage.save(s3_key, file)
        except Exception as e:
            return Response({"detail": f"Upload failed: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        folder_id = request.data.get("folder") or None
        data = {
            "title":        request.data.get("title") or file.name,
            "description":  request.data.get("description", ""),
            "content_type": request.data.get("content_type") or _detect_ctype(mime, file.name),
            "visibility":   request.data.get("visibility", "internal"),
            "folder":       folder_id,
            "tags":         [],
            "s3_key":       s3_key,
            "file_name":    file.name,
        }
        ser = KnowledgeItemSerializer(data=data, context={"request": request})
        if ser.is_valid():
            ser.save()
            return Response(ser.data, status=status.HTTP_201_CREATED)
        default_storage.delete(s3_key)
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"], url_path="track-view")
    def track_view(self, request, pk=None):
        item = self.get_object()
        item.view_count += 1
        item.save(update_fields=["view_count"])
        return Response({"view_count": item.view_count})
