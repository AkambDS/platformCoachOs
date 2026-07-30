import hashlib
import uuid as uuid_lib
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.conf import settings as dj_settings
from django.contrib.postgres.search import SearchVector, SearchQuery
from django.core.files.storage import default_storage
from django.shortcuts import get_object_or_404
from .models import KnowledgeFolder, KnowledgeItem
from .serializers import FolderSerializer, KnowledgeItemSerializer
from apps.accounts.permissions import IsAssistantOrAbove

FILE_SIZE_LIMIT = 100 * 1024 * 1024  # 100 MB

MIME_TO_CTYPE = {
    "application/pdf": "pdf",
    "video/":          "video",
    "audio/":          "video",
}

# Office files OnlyOffice can open for real-time in-browser editing, by editor type.
# "pdf" uses OnlyOffice's PDF editor (rewrites text in place, not just annotations) —
# quality depends on the PDF having a real text layer; scanned/image-only PDFs won't
# expose editable text no matter what tool is used.
ONLYOFFICE_DOC_TYPES = {
    "doc": "word", "docx": "word", "odt": "word", "rtf": "word",
    "xls": "cell", "xlsx": "cell", "ods": "cell", "csv": "cell",
    "ppt": "slide", "pptx": "slide", "odp": "slide",
    "pdf": "pdf",
}


def _doc_server_file_url(item):
    """URL the OnlyOffice container fetches the document from. Deliberately points at
    our OWN backend (proxied through onlyoffice_file below) rather than a presigned S3/
    MinIO URL: when JWT is enabled, OnlyOffice's document server attaches its own
    `Authorization: Bearer <jwt>` header to every outbound request it makes — including
    the document download — and MinIO rejects a request carrying both that header AND
    a presigned query-string signature with "multiple authentication types". Routing
    through our backend means there's exactly one auth mechanism on that request (the
    JWT we already verify), and the backend fetches the S3 object itself, server-side."""
    if not item.s3_key:
        return None
    return f"{dj_settings.ONLYOFFICE_CALLBACK_BASE_URL}/api/library/items/{item.id}/onlyoffice-file/"


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

        shared_with_client = self.request.query_params.get("shared_with_client")
        if shared_with_client:
            # "What's been shared with this client" (client Files > Shared Files) —
            # a different question than the requesting coach's own Library visibility,
            # so it isn't ANDed with the role-based filter below.
            qs = qs.filter(
                Q(visibility="client_visible") |
                Q(visibility="specific", shared_client_ids__contains=[shared_with_client])
            )
        elif user.role in ("business_owner", "platform_admin"):
            pass  # owner sees everything
        else:
            # Coaches/assistants: see internal + client_visible + their own private uploads
            # + items specifically shared with them
            qs = qs.filter(
                Q(visibility__in=["internal", "client_visible"]) |
                Q(visibility="private", uploaded_by=user) |
                Q(visibility="specific", shared_user_ids__contains=[str(user.id)])
            )
        q      = self.request.query_params.get("q")
        ctype  = self.request.query_params.get("content_type")
        vis    = self.request.query_params.get("visibility")
        folder = self.request.query_params.get("folder")
        if q:
            qs = qs.annotate(search=SearchVector("title", "description")).filter(search=SearchQuery(q))
        if ctype:  qs = qs.filter(content_type=ctype)
        if vis and not shared_with_client:
            qs = qs.filter(visibility=vis)
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
        import json as _json
        def _parse_ids(key):
            raw = request.data.get(key, "")
            if not raw:
                return []
            try:
                return _json.loads(raw) if isinstance(raw, str) else raw
            except Exception:
                return []

        data = {
            "title":             request.data.get("title") or file.name,
            "description":       request.data.get("description", ""),
            "content_type":      request.data.get("content_type") or _detect_ctype(mime, file.name),
            "visibility":        request.data.get("visibility", "internal"),
            "folder":            folder_id,
            "tags":              [],
            "s3_key":            s3_key,
            "file_name":         file.name,
            "video_url":         request.data.get("video_url", ""),
            "shared_client_ids": _parse_ids("shared_client_ids"),
            "shared_user_ids":   _parse_ids("shared_user_ids"),
        }
        ser = KnowledgeItemSerializer(data=data, context={"request": request})
        if ser.is_valid():
            ser.save()
            return Response(ser.data, status=status.HTTP_201_CREATED)
        default_storage.delete(s3_key)
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"], url_path="replace-file", parser_classes=[MultiPartParser])
    def replace_file(self, request, pk=None):
        """POST /api/library/items/{id}/replace-file/ — swap the file, bump version."""
        item = self.get_object()
        file = request.FILES.get("file")
        if not file:
            return Response({"detail": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)
        if file.size > FILE_SIZE_LIMIT:
            return Response({"detail": "File must be under 100 MB."}, status=status.HTTP_400_BAD_REQUEST)

        ext    = file.name.rsplit(".", 1)[-1].lower() if "." in file.name else "bin"
        s3_key = f"library/{request.user.workspace.id}/{uuid_lib.uuid4()}.{ext}"
        try:
            default_storage.save(s3_key, file)
        except Exception as e:
            return Response({"detail": f"Upload failed: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        from django.utils import timezone
        prev = list(item.previous_versions or [])
        if item.s3_key:
            prev.append({"version": item.version, "s3_key": item.s3_key, "replaced_at": timezone.now().isoformat()})

        item.previous_versions = prev
        item.version   += 1
        item.s3_key     = s3_key
        item.file_name  = file.name
        item.save(update_fields=["s3_key", "file_name", "version", "previous_versions"])

        ser = KnowledgeItemSerializer(item, context={"request": request})
        return Response(ser.data)

    @action(detail=True, methods=["post"], url_path="convert-to-pdf")
    def convert_to_pdf(self, request, pk=None):
        """POST /api/library/items/{id}/convert-to-pdf/ — converts an Office document to
        PDF via OnlyOffice's ConvertService and saves the result as a NEW Library item
        (the original is untouched), optionally into a chosen folder.
        Body: {folder: <folder id> | "root" | omitted (defaults to source item's folder)}"""
        item = self.get_object()
        if not item.s3_key:
            return Response({"detail": "No file to convert."}, status=status.HTTP_400_BAD_REQUEST)

        ext = item.file_name.rsplit(".", 1)[-1].lower() if "." in item.file_name else ""
        if ext == "pdf":
            return Response({"detail": "This file is already a PDF."}, status=status.HTTP_400_BAD_REQUEST)
        if ext not in ONLYOFFICE_DOC_TYPES:
            return Response({"detail": "This file type can't be converted to PDF."},
                             status=status.HTTP_400_BAD_REQUEST)

        folder_param = request.data.get("folder", None)
        if folder_param in (None, ""):
            target_folder = item.folder
        elif folder_param == "root":
            target_folder = None
        else:
            target_folder = get_object_or_404(
                KnowledgeFolder, pk=folder_param, workspace=request.user.workspace
            )

        import requests

        # ConvertService fetches `url` itself with no auth headers of its own (unlike the
        # editor, which signs document.url requests) — token travels as a query param
        # that onlyoffice_file accepts as a fallback to the Authorization header.
        file_token = ""
        if dj_settings.ONLYOFFICE_JWT_SECRET:
            import jwt
            file_token = jwt.encode({"iid": str(item.id)}, dj_settings.ONLYOFFICE_JWT_SECRET, algorithm="HS256")
        source_url = _doc_server_file_url(item)
        if not source_url:
            return Response({"detail": "File is unavailable."}, status=status.HTTP_400_BAD_REQUEST)
        if file_token:
            source_url += f"?token={file_token}"

        convert_key = hashlib.md5(f"convert-{item.id}-{uuid_lib.uuid4()}".encode()).hexdigest()
        payload = {
            "async": False,
            "filetype": ext,
            "outputtype": "pdf",
            "title": item.file_name,
            "key": convert_key,
            "url": source_url,
        }
        if dj_settings.ONLYOFFICE_JWT_SECRET:
            import jwt
            payload["token"] = jwt.encode(payload, dj_settings.ONLYOFFICE_JWT_SECRET, algorithm="HS256")

        try:
            resp = requests.post(
                f"{dj_settings.ONLYOFFICE_INTERNAL_URL}/ConvertService.ashx",
                json=payload,
                headers={"Accept": "application/json"},
                timeout=60,
            )
            data = resp.json()
        except Exception as e:
            return Response({"detail": f"Conversion request failed: {e}"}, status=status.HTTP_502_BAD_GATEWAY)

        if data.get("error"):
            return Response({"detail": f"Conversion failed (error {data['error']})."},
                             status=status.HTTP_502_BAD_GATEWAY)
        file_url = data.get("fileUrl")
        if not file_url:
            return Response({"detail": "Conversion did not return a file."}, status=status.HTTP_502_BAD_GATEWAY)

        try:
            pdf_resp = requests.get(file_url, timeout=60)
            pdf_resp.raise_for_status()
        except Exception as e:
            return Response({"detail": f"Could not download converted file: {e}"},
                             status=status.HTTP_502_BAD_GATEWAY)

        from django.core.files.base import ContentFile
        base_name = item.file_name.rsplit(".", 1)[0] if "." in item.file_name else item.file_name
        new_file_name = f"{base_name}.pdf"
        new_key = f"library/{request.user.workspace.id}/{uuid_lib.uuid4()}.pdf"
        default_storage.save(new_key, ContentFile(pdf_resp.content))

        new_item = KnowledgeItem.objects.create(
            workspace=request.user.workspace,
            folder=target_folder,
            content_type="pdf",
            title=f"{item.title} (PDF)",
            description=item.description,
            visibility=item.visibility,
            shared_client_ids=item.shared_client_ids,
            shared_user_ids=item.shared_user_ids,
            s3_key=new_key,
            file_name=new_file_name,
            uploaded_by=request.user,
        )
        ser = KnowledgeItemSerializer(new_item, context={"request": request})
        return Response(ser.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="track-view")
    def track_view(self, request, pk=None):
        item = self.get_object()
        item.view_count += 1
        item.save(update_fields=["view_count"])
        return Response({"view_count": item.view_count})

    @action(detail=True, methods=["get"], url_path="onlyoffice-file",
            permission_classes=[AllowAny], authentication_classes=[])
    def onlyoffice_file(self, request, pk=None):
        """GET /api/library/items/{id}/onlyoffice-file/ — serves the raw file to the
        OnlyOffice Document Server. Editor opens sign this request themselves
        (Authorization header); the conversion API (convert_to_pdf) does not, so it
        passes the token as a ?token= query param on the URL it hands to ConvertService
        instead — same pattern as apps.clients.views.AssessmentViewSet."""
        if dj_settings.ONLYOFFICE_JWT_SECRET:
            import jwt
            token = (request.headers.get("Authorization", "").removeprefix("Bearer ")
                      or request.query_params.get("token", ""))
            if not token:
                return Response({"detail": "Missing token."}, status=status.HTTP_403_FORBIDDEN)
            try:
                jwt.decode(token, dj_settings.ONLYOFFICE_JWT_SECRET, algorithms=["HS256"])
            except jwt.InvalidTokenError:
                return Response({"detail": "Invalid token."}, status=status.HTTP_403_FORBIDDEN)

        try:
            item = KnowledgeItem.objects.get(pk=pk)
        except KnowledgeItem.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not item.s3_key:
            return Response(status=status.HTTP_404_NOT_FOUND)

        import mimetypes
        from django.http import FileResponse
        content_type = mimetypes.guess_type(item.file_name)[0] or "application/octet-stream"
        return FileResponse(default_storage.open(item.s3_key, "rb"), content_type=content_type)

    @action(detail=True, methods=["get"], url_path="edit-config")
    def edit_config(self, request, pk=None):
        """GET /api/library/items/{id}/edit-config/?mode=view|edit — OnlyOffice
        editor config, used both for the inline read-only preview (anyone who can
        already see the item, via the normal get_queryset visibility rules) and
        for real-time editing (?mode=edit — uploader/workspace owner only)."""
        item = self.get_object()
        if not item.s3_key:
            return Response({"detail": "No file to preview."}, status=status.HTTP_400_BAD_REQUEST)

        is_owner    = request.user.role == "business_owner"
        is_uploader = item.uploaded_by_id == request.user.id
        can_edit    = is_owner or is_uploader

        requested_mode = request.query_params.get("mode", "view")
        if requested_mode == "edit" and not can_edit:
            return Response({"detail": "Only the uploader or workspace owner can edit this file."},
                             status=status.HTTP_403_FORBIDDEN)
        mode = "edit" if (requested_mode == "edit" and can_edit) else "view"

        ext = item.file_name.rsplit(".", 1)[-1].lower() if "." in item.file_name else ""
        doc_type = ONLYOFFICE_DOC_TYPES.get(ext)
        if not doc_type:
            return Response({"detail": "This file type can't be previewed with the document editor."},
                             status=status.HTTP_400_BAD_REQUEST)

        file_url = _doc_server_file_url(item)
        if not file_url:
            return Response({"detail": "File is unavailable."}, status=status.HTTP_400_BAD_REQUEST)

        key = hashlib.md5(
            f"{item.id}-{item.version}-{item.updated_at.timestamp()}".encode()
        ).hexdigest()
        callback_url = f"{dj_settings.ONLYOFFICE_CALLBACK_BASE_URL}/api/library/items/{item.id}/onlyoffice-callback/"

        config = {
            "document": {
                "fileType": ext,
                "key":      key,
                "title":    item.file_name,
                "url":      file_url,
                "permissions": {"edit": mode == "edit", "download": True, "print": True},
            },
            "documentType": doc_type,
            "editorConfig": {
                "callbackUrl": callback_url,
                "user": {"id": str(request.user.id), "name": request.user.full_name or request.user.email},
                "mode": mode,
                "customization": {"forcesave": mode == "edit"},
            },
        }
        if dj_settings.ONLYOFFICE_JWT_SECRET:
            import jwt
            config["token"] = jwt.encode(config, dj_settings.ONLYOFFICE_JWT_SECRET, algorithm="HS256")

        return Response({"config": config, "server_url": dj_settings.ONLYOFFICE_SERVER_URL})

    @action(detail=True, methods=["post"], url_path="onlyoffice-callback",
            permission_classes=[AllowAny], authentication_classes=[])
    def onlyoffice_callback(self, request, pk=None):
        """POST from the OnlyOffice Document Server when a document is saved.
        Not user-authenticated — the doc server calls this directly — so the
        JWT token OnlyOffice signs the payload with is verified instead."""
        body = request.data

        if dj_settings.ONLYOFFICE_JWT_SECRET:
            import jwt
            token = body.get("token") or request.headers.get("Authorization", "").removeprefix("Bearer ")
            if not token:
                return Response({"error": 1})
            try:
                jwt.decode(token, dj_settings.ONLYOFFICE_JWT_SECRET, algorithms=["HS256"])
            except jwt.InvalidTokenError:
                return Response({"error": 1})

        try:
            item = KnowledgeItem.objects.get(pk=pk)
        except KnowledgeItem.DoesNotExist:
            return Response({"error": 1})

        # status 2 = ready for saving (editor closed), 6 = force-save while still open
        if body.get("status") in (2, 6):
            download_url = body.get("url")
            if download_url:
                import requests
                # download_url is built from the browser-facing ONLYOFFICE_SERVER_URL —
                # not reachable from inside our own container. Swap in the internal address.
                if download_url.startswith(dj_settings.ONLYOFFICE_SERVER_URL):
                    download_url = download_url.replace(
                        dj_settings.ONLYOFFICE_SERVER_URL, dj_settings.ONLYOFFICE_INTERNAL_URL, 1
                    )
                resp = requests.get(download_url, timeout=30)
                if resp.status_code == 200:
                    from django.core.files.base import ContentFile
                    from django.utils import timezone
                    ext = item.file_name.rsplit(".", 1)[-1] if "." in item.file_name else "bin"
                    new_key = f"library/{item.workspace_id}/{uuid_lib.uuid4()}.{ext}"
                    default_storage.save(new_key, ContentFile(resp.content))

                    prev = list(item.previous_versions or [])
                    if item.s3_key:
                        prev.append({"version": item.version, "s3_key": item.s3_key,
                                      "replaced_at": timezone.now().isoformat()})
                    item.previous_versions = prev
                    item.version += 1
                    item.s3_key = new_key
                    item.save(update_fields=["s3_key", "version", "previous_versions"])

        return Response({"error": 0})
