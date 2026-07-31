"""CoachOS — clients/views.py"""
from rest_framework import viewsets, status, generics
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from django.db.models import Subquery, OuterRef
from django.conf import settings as dj_settings
import uuid, csv
from django.http import StreamingHttpResponse

# Office files OnlyOffice can open for real-time in-browser editing, by editor type
# (same mapping used by apps.library.views for Library items).
ONLYOFFICE_DOC_TYPES = {
    "doc": "word", "docx": "word", "odt": "word", "rtf": "word",
    "xls": "cell", "xlsx": "cell", "ods": "cell", "csv": "cell",
    "ppt": "slide", "pptx": "slide", "odp": "slide",
    "pdf": "pdf",
}

from django.shortcuts import get_object_or_404
from django.core.files.storage import default_storage
from django.utils import timezone
from .models import Client, Assessment, ClientGoal, Commitment, GoalProgress, ClientNote, ClientMessageDraft
from .serializers import (ClientListSerializer, ClientDetailSerializer,
                          AssessmentSerializer, ClientGoalSerializer,
                          CommitmentSerializer, GoalProgressSerializer,
                          ClientNoteSerializer, ClientMessageDraftSerializer)
from apps.accounts.permissions import IsAssistantOrAbove, IsCoachOrAbove, IsBusinessOwnerOrSuperuser


def _log(request, client, action, **metadata):
    """Fire-and-forget audit log write."""
    try:
        from apps.audit.models import AccessLog
        AccessLog.objects.create(
            workspace=request.user.workspace,
            user=request.user,
            user_name=request.user.full_name,
            client_id=client.pk if client else None,
            client_name=client.full_name if client else "",
            action=action,
            metadata=metadata or {},
        )
    except Exception:
        pass


def _client_qs(request):
    """Return the base Client queryset scoped to the requesting user.

    business_owner → all workspace clients
    coach / assistant → only clients where client.coach == request.user
    """
    qs = Client.objects.filter(workspace=request.user.workspace)
    if request.user.role != "business_owner":
        qs = qs.filter(coach=request.user)
    return qs


class ClientViewSet(viewsets.ModelViewSet):
    """
    GET    /api/clients/         — list (filterable by tags, active_flag, coach)
    POST   /api/clients/         — create new client  [Coach+]
    GET    /api/clients/{id}/    — full client detail + engagement history
    PUT    /api/clients/{id}/    — update  [Coach+]
    DELETE /api/clients/{id}/    — permanent delete  [Coach+]
    POST   /api/clients/import/  — CSV bulk import  [Coach+]
    """
    permission_classes = [IsAssistantOrAbove]

    def get_permissions(self):
        if self.action == "destroy":
            return [IsBusinessOwnerOrSuperuser()]
        if self.action in ("create", "update", "partial_update", "csv_import", "csv_export"):
            return [IsCoachOrAbove()]
        return [IsAssistantOrAbove()]
    filter_backends    = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields   = ["active_flag", "status", "coach"]
    search_fields      = ["first_name", "last_name", "email", "company"]
    ordering_fields    = ["last_name", "created_at"]
    ordering           = ["last_name"]

    def get_queryset(self):
        from apps.activities.models import Activity
        qs = _client_qs(self.request).select_related("coach")
        tags = self.request.query_params.getlist("tag")
        if tags:
            qs = qs.filter(tags__contains=tags)
        if self.action == "list":
            last_act = Activity.objects.filter(client=OuterRef("pk")).order_by("-start_at")
            qs = qs.annotate(
                last_activity_type=Subquery(last_act.values("activity_type")[:1]),
                last_activity_at=Subquery(last_act.values("start_at")[:1]),
            )
        return qs

    def perform_destroy(self, instance):
        from apps.invoicing.models import Invoice, Payment
        # Payment.invoice is PROTECT; Invoice.client is PROTECT — delete in order
        invoice_ids = Invoice.objects.filter(client=instance).values_list("id", flat=True)
        Payment.objects.filter(invoice_id__in=invoice_ids).delete()
        Invoice.objects.filter(client=instance).delete()
        instance.delete()

    def get_serializer_class(self):
        if self.action == "list":
            return ClientListSerializer
        return ClientDetailSerializer

    def perform_create(self, serializer):
        if not self.request.user.workspace_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"detail": "Your account is not linked to a workspace. Contact your administrator."})
        coach = serializer.validated_data.get('coach') or self.request.user
        serializer.save(
            workspace=self.request.user.workspace,
            coach=coach,
        )

    @action(detail=True, methods=["post"], url_path="invite-portal")
    def invite_portal(self, request, pk=None):
        """POST /api/clients/{id}/invite-portal/ — grant portal access and email the client."""
        client = self.get_object()
        if not client.email:
            return Response({"detail": "Client has no email address."}, status=400)
        client.portal_access = True
        client.save(update_fields=["portal_access"])
        try:
            import threading
            from tasks.email import send_portal_invite_email
            threading.Thread(target=send_portal_invite_email, args=(str(client.id),), daemon=True).start()
        except Exception as exc:
            import logging
            logging.getLogger(__name__).error("send_portal_invite_email failed: %s", exc)
        from .serializers import ClientDetailSerializer
        return Response(ClientDetailSerializer(client, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="revoke-portal")
    def revoke_portal(self, request, pk=None):
        """POST /api/clients/{id}/revoke-portal/ — remove portal access."""
        client = self.get_object()
        client.portal_access = False
        client.save(update_fields=["portal_access"])
        from .serializers import ClientDetailSerializer
        return Response(ClientDetailSerializer(client, context={"request": request}).data)

    @action(detail=False, methods=["get"], url_path="export")
    def csv_export(self, request):
        """GET /api/clients/export/ — download all clients as CSV"""
        if not request.user.workspace_id:
            return Response({"detail": "Your account is not linked to a workspace."}, status=400)

        fields = ["first_name", "last_name", "email", "phone", "company",
                  "job_title", "tags", "status", "notes"]

        def rows():
            yield ",".join(fields) + "\r\n"
            for c in _client_qs(request).order_by("last_name"):
                row = [
                    c.first_name, c.last_name, c.email, c.phone or "",
                    c.company or "", c.job_title or "",
                    "|".join(c.tags or []),
                    c.status or "Lead",
                    (c.notes or "").replace("\r\n", " ").replace("\n", " "),
                ]
                yield ",".join(f'"{v.replace(chr(34), chr(34)+chr(34))}"' for v in row) + "\r\n"

        resp = StreamingHttpResponse(rows(), content_type="text/csv")
        resp["Content-Disposition"] = 'attachment; filename="clients.csv"'
        return resp

    @action(detail=False, methods=["post"], url_path="import",
            parser_classes=[MultiPartParser])
    def csv_import(self, request):
        """POST /api/clients/import/ — CSV bulk import"""
        if not request.user.workspace_id:
            return Response({"detail": "Your account is not linked to a workspace."}, status=400)
        file = request.FILES.get("file")
        if not file:
            return Response({"detail": "No file provided."}, status=400)

        import io
        try:
            text = file.read().decode("utf-8-sig")
        except UnicodeDecodeError:
            return Response({"detail": "File must be UTF-8 encoded."}, status=400)

        reader  = csv.DictReader(io.StringIO(text))
        created = 0
        skipped = 0
        errors  = []
        for i, row in enumerate(reader, start=2):
            first = row.get("first_name", "").strip()
            last  = row.get("last_name", "").strip()
            email = row.get("email", "").strip()
            if not first and not last and not email:
                skipped += 1
                continue
            raw_tags = row.get("tags", "").strip()
            tags = [t.strip() for t in raw_tags.replace(",", "|").split("|") if t.strip()]
            client_status = row.get("status", "Lead").strip() or "Lead"
            active = client_status.lower() == "active"
            try:
                Client.objects.create(
                    workspace=request.user.workspace,
                    coach=request.user,
                    first_name=first,
                    last_name=last,
                    email=email,
                    phone=row.get("phone", "").strip(),
                    company=row.get("company", "").strip(),
                    job_title=row.get("job_title", "").strip(),
                    tags=tags,
                    status=client_status,
                    active_flag=active,
                    notes=row.get("notes", "").strip(),
                )
                created += 1
            except Exception as e:
                errors.append({"row": i, "error": str(e)})

        return Response({"created": created, "skipped": skipped, "errors": errors}, status=201)


class ClientNoteViewSet(viewsets.ModelViewSet):
    """CRUD /api/clients/{client_pk}/notes/"""
    serializer_class   = ClientNoteSerializer
    permission_classes = [IsCoachOrAbove]

    def _get_client(self):
        return get_object_or_404(_client_qs(self.request), pk=self.kwargs["client_pk"])

    def get_queryset(self):
        return ClientNote.objects.filter(
            workspace=self.request.user.workspace,
            client_id=self.kwargs["client_pk"],
            client__in=_client_qs(self.request),
        )

    def list(self, request, *args, **kwargs):
        client = self._get_client()
        _log(request, client, "viewed_notes")
        return super().list(request, *args, **kwargs)

    def perform_create(self, serializer):
        client = self._get_client()
        serializer.save(workspace=self.request.user.workspace,
                        client=client, created_by=self.request.user)
        _log(self.request, client, "created_note")

    def perform_update(self, serializer):
        instance = serializer.save()
        _log(self.request, instance.client, "updated_note")

    def perform_destroy(self, instance):
        _log(self.request, instance.client, "deleted_note")
        instance.delete()

    @action(detail=False, methods=["get"], url_path="export")
    def export(self, request, client_pk=None):
        """GET /api/clients/{client_pk}/notes/export/ — download all notes as plain text."""
        import json
        from django.http import HttpResponse
        client = self._get_client()
        notes  = self.get_queryset().order_by("-created_at")

        lines = [
            f"Notes Export — {client.full_name}",
            f"Exported by: {request.user.full_name}",
            "=" * 60,
            "",
        ]
        for n in notes:
            created = n.created_at.strftime("%a %b %d, %Y at %I:%M %p UTC")
            author  = n.created_by.full_name if n.created_by else "Unknown"
            lines.append(f"[{n.note_type.upper()}]  {created}  —  {author}")
            lines.append("-" * 60)

            # Structured session notes
            if n.text.startswith("##STRUCTURED##"):
                try:
                    data = json.loads(n.text[len("##STRUCTURED##"):])
                    if data.get("notes"):
                        lines += ["NOTES:", data["notes"], ""]
                    if data.get("reflection"):
                        lines += ["COACH REFLECTION:", data["reflection"], ""]
                    if data.get("commitment"):
                        lines += ["COMMITMENT:", data["commitment"], ""]
                except Exception:
                    lines.append(n.text)
            else:
                lines.append(n.text)
            lines.append("")

        content = "\n".join(lines)
        safe_name = client.full_name.replace(" ", "_")
        response = HttpResponse(content, content_type="text/plain; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="notes_{safe_name}.txt"'
        return response


class AssessmentViewSet(viewsets.ModelViewSet):
    """GET/DELETE /api/clients/{client_id}/assessments/ + POST upload/"""
    serializer_class   = AssessmentSerializer
    permission_classes = [IsAssistantOrAbove]

    def get_permissions(self):
        if self.action == "destroy":
            return [IsBusinessOwnerOrSuperuser()]
        # onlyoffice_file/onlyoffice_callback are called by the OnlyOffice Document
        # Server itself (no user session) — their own JWT check is the real gate,
        # so this class-level override must not force IsAssistantOrAbove on them.
        if self.action in ("onlyoffice_file", "onlyoffice_callback"):
            return [AllowAny()]
        return [IsAssistantOrAbove()]

    def _get_client(self):
        return get_object_or_404(_client_qs(self.request), pk=self.kwargs["client_pk"])

    def get_queryset(self):
        return Assessment.objects.filter(
            workspace=self.request.user.workspace,
            client_id=self.kwargs["client_pk"],
            client__in=_client_qs(self.request),
        )

    def list(self, request, *args, **kwargs):
        client = self._get_client()
        _log(request, client, "viewed_assessments")
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        _log(request, instance.client, "downloaded_file", file_name=instance.file_name)
        return super().retrieve(request, *args, **kwargs)

    def perform_create(self, serializer):
        client = self._get_client()
        serializer.save(workspace=self.request.user.workspace,
                        client=client, uploaded_by=self.request.user)

    def perform_destroy(self, instance):
        _log(self.request, instance.client, "deleted_file", file_name=instance.file_name)
        instance.delete()

    @action(detail=False, methods=["post"], url_path="upload",
            parser_classes=[MultiPartParser])
    def upload(self, request, client_pk=None):
        """POST /api/clients/{id}/assessments/upload/ — upload file to S3"""
        file = request.FILES.get("file")
        if not file:
            return Response({"detail": "No file provided."}, status=400)

        assessment_type = request.data.get("assessment_type", "other")
        date_str        = request.data.get("date", timezone.now().date().isoformat())
        visible         = request.data.get("visible_to_client", "false").lower() == "true"

        ext     = file.name.rsplit(".", 1)[-1].lower() if "." in file.name else "bin"
        s3_key  = f"assessments/{request.user.workspace.id}/{client_pk}/{uuid.uuid4()}.{ext}"

        try:
            default_storage.save(s3_key, file)
        except Exception as e:
            return Response({"detail": str(e)}, status=500)

        client = get_object_or_404(_client_qs(request), pk=client_pk)
        obj    = Assessment.objects.create(
            workspace=request.user.workspace,
            client=client,
            uploaded_by=request.user,
            assessment_type=assessment_type,
            date=date_str,
            file_s3_key=s3_key,
            file_name=file.name,
            visible_to_client=visible,
        )
        _log(request, client, "uploaded_file", file_name=file.name)
        return Response(AssessmentSerializer(obj, context={"request": request}).data,
                        status=201)

    def _doc_server_file_url(self, obj):
        """Mirrors apps.library.views._doc_server_file_url — routes the OnlyOffice
        container through our own backend rather than a presigned S3/MinIO URL, since
        JWT + presigned-query-string auth can't coexist on the same request."""
        if not obj.file_s3_key:
            return None
        return (f"{dj_settings.ONLYOFFICE_CALLBACK_BASE_URL}"
                f"/api/clients/{obj.client_id}/assessments/{obj.id}/onlyoffice-file/")

    @action(detail=True, methods=["get"], url_path="edit-config")
    def edit_config(self, request, pk=None, client_pk=None):
        """GET /api/clients/{client_pk}/assessments/{id}/edit-config/?mode=view|edit —
        OnlyOffice editor config, same pattern as library.KnowledgeItemViewSet.edit_config."""
        obj = self.get_object()
        if not obj.file_s3_key:
            return Response({"detail": "No file to preview."}, status=status.HTTP_400_BAD_REQUEST)

        is_owner    = request.user.role == "business_owner"
        is_uploader = obj.uploaded_by_id == request.user.id
        can_edit    = is_owner or is_uploader

        requested_mode = request.query_params.get("mode", "view")
        if requested_mode == "edit" and not can_edit:
            return Response({"detail": "Only the uploader or workspace owner can edit this file."},
                             status=status.HTTP_403_FORBIDDEN)
        mode = "edit" if (requested_mode == "edit" and can_edit) else "view"

        ext = obj.file_name.rsplit(".", 1)[-1].lower() if "." in obj.file_name else ""
        doc_type = ONLYOFFICE_DOC_TYPES.get(ext)
        if not doc_type:
            return Response({"detail": "This file type can't be previewed with the document editor."},
                             status=status.HTTP_400_BAD_REQUEST)

        file_url = self._doc_server_file_url(obj)
        if not file_url:
            return Response({"detail": "File is unavailable."}, status=status.HTTP_400_BAD_REQUEST)

        import hashlib
        key = hashlib.md5(
            f"{obj.id}-{obj.version}-{obj.updated_at.timestamp()}".encode()
        ).hexdigest()
        callback_url = (f"{dj_settings.ONLYOFFICE_CALLBACK_BASE_URL}"
                        f"/api/clients/{obj.client_id}/assessments/{obj.id}/onlyoffice-callback/")

        config = {
            "document": {
                "fileType": ext,
                "key":      key,
                "title":    obj.file_name,
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

    @action(detail=True, methods=["post"], url_path="convert-to-pdf")
    def convert_to_pdf(self, request, pk=None, client_pk=None):
        """POST /api/clients/{client_pk}/assessments/{id}/convert-to-pdf/ — converts an
        Office document to PDF via OnlyOffice's ConvertService and saves the result as
        a NEW client File (the original is untouched), so it can be downloaded or attached
        to a Client Communication email as a real PDF. Body may include `assessment_type`
        (which File category/"folder" to file the PDF under — defaults to the source
        file's own category) and `visible_to_client` (defaults to false, same as before)."""
        obj = self.get_object()
        if not obj.file_s3_key:
            return Response({"detail": "No file to convert."}, status=status.HTTP_400_BAD_REQUEST)

        ext = obj.file_name.rsplit(".", 1)[-1].lower() if "." in obj.file_name else ""
        if ext == "pdf":
            return Response({"detail": "This file is already a PDF."}, status=status.HTTP_400_BAD_REQUEST)
        if ext not in ONLYOFFICE_DOC_TYPES:
            return Response({"detail": "This file type can't be converted to PDF."},
                             status=status.HTTP_400_BAD_REQUEST)

        assessment_type = request.data.get("assessment_type") or obj.assessment_type
        valid_types = {c[0] for c in Assessment.AssessmentType.choices}
        if assessment_type not in valid_types:
            return Response({"detail": "Invalid assessment_type."}, status=status.HTTP_400_BAD_REQUEST)
        visible_to_client = str(request.data.get("visible_to_client", "false")).lower() == "true"

        import hashlib, uuid as uuid_lib, requests

        # ConvertService fetches `url` itself with no auth headers of its own (unlike the
        # editor, which signs document.url requests) — so the token has to travel as a
        # query param that onlyoffice_file accepts as a fallback to the Authorization header.
        file_token = ""
        if dj_settings.ONLYOFFICE_JWT_SECRET:
            import jwt
            file_token = jwt.encode({"aid": str(obj.id)}, dj_settings.ONLYOFFICE_JWT_SECRET, algorithm="HS256")
        source_url = self._doc_server_file_url(obj)
        if not source_url:
            return Response({"detail": "File is unavailable."}, status=status.HTTP_400_BAD_REQUEST)
        if file_token:
            source_url += f"?token={file_token}"

        convert_key = hashlib.md5(f"convert-{obj.id}-{uuid_lib.uuid4()}".encode()).hexdigest()
        payload = {
            "async": False,
            "filetype": ext,
            "outputtype": "pdf",
            "title": obj.file_name,
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
        base_name = obj.file_name.rsplit(".", 1)[0] if "." in obj.file_name else obj.file_name
        new_file_name = f"{base_name}.pdf"
        new_key = f"assessments/{obj.workspace_id}/{obj.client_id}/{uuid_lib.uuid4()}.pdf"
        default_storage.save(new_key, ContentFile(pdf_resp.content))

        new_obj = Assessment.objects.create(
            workspace=obj.workspace, client=obj.client, uploaded_by=request.user,
            assessment_type=assessment_type, date=timezone.now().date(),
            file_s3_key=new_key, file_name=new_file_name, visible_to_client=visible_to_client,
        )
        _log(request, obj.client, "converted_to_pdf", file_name=obj.file_name)
        return Response(AssessmentSerializer(new_obj, context={"request": request}).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path="onlyoffice-file",
            permission_classes=[AllowAny], authentication_classes=[])
    def onlyoffice_file(self, request, pk=None, client_pk=None):
        """GET .../onlyoffice-file/ — serves the raw file to the OnlyOffice Document
        Server. Not user-authenticated — verified via a JWT instead, same as
        onlyoffice_callback below. Editor opens sign this request themselves (Authorization
        header); the conversion API (convert_to_pdf) does not, so it passes the token as
        a ?token= query param on the URL it hands to ConvertService instead."""
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
            obj = Assessment.objects.get(pk=pk, client_id=client_pk)
        except Assessment.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not obj.file_s3_key:
            return Response(status=status.HTTP_404_NOT_FOUND)

        import mimetypes
        from django.http import FileResponse
        content_type = mimetypes.guess_type(obj.file_name)[0] or "application/octet-stream"
        return FileResponse(default_storage.open(obj.file_s3_key, "rb"), content_type=content_type)

    @action(detail=True, methods=["post"], url_path="onlyoffice-callback",
            permission_classes=[AllowAny], authentication_classes=[])
    def onlyoffice_callback(self, request, pk=None, client_pk=None):
        """POST from the OnlyOffice Document Server when a document is saved.
        Not user-authenticated — the JWT token OnlyOffice signs the payload with is
        verified instead, same as apps.library.views.onlyoffice_callback."""
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
            obj = Assessment.objects.get(pk=pk, client_id=client_pk)
        except Assessment.DoesNotExist:
            return Response({"error": 1})

        # status 2 = ready for saving (editor closed), 6 = force-save while still open
        if body.get("status") in (2, 6):
            download_url = body.get("url")
            if download_url:
                import requests
                if download_url.startswith(dj_settings.ONLYOFFICE_SERVER_URL):
                    download_url = download_url.replace(
                        dj_settings.ONLYOFFICE_SERVER_URL, dj_settings.ONLYOFFICE_INTERNAL_URL, 1
                    )
                resp = requests.get(download_url, timeout=30)
                if resp.status_code == 200:
                    from django.core.files.base import ContentFile
                    ext = obj.file_name.rsplit(".", 1)[-1] if "." in obj.file_name else "bin"
                    new_key = f"assessments/{obj.workspace_id}/{obj.client_id}/{uuid.uuid4()}.{ext}"
                    default_storage.save(new_key, ContentFile(resp.content))

                    prev = list(obj.previous_versions or [])
                    if obj.file_s3_key:
                        prev.append({"version": obj.version, "s3_key": obj.file_s3_key,
                                      "replaced_at": timezone.now().isoformat()})
                    obj.previous_versions = prev
                    obj.version += 1
                    obj.file_s3_key = new_key
                    obj.save(update_fields=["file_s3_key", "version", "previous_versions", "updated_at"])

        return Response({"error": 0})


class ClientMessageDraftViewSet(viewsets.ModelViewSet):
    """CRUD /api/clients/{client_pk}/messages/ — draft/edit client-communication emails.
    Draft-only for now: no send action exists yet."""
    serializer_class   = ClientMessageDraftSerializer
    permission_classes = [IsCoachOrAbove]

    def _get_client(self):
        return get_object_or_404(_client_qs(self.request), pk=self.kwargs["client_pk"])

    def get_queryset(self):
        return ClientMessageDraft.objects.filter(
            workspace=self.request.user.workspace,
            client_id=self.kwargs["client_pk"],
            client__in=_client_qs(self.request),
        )

    def list(self, request, *args, **kwargs):
        client = self._get_client()
        _log(request, client, "viewed_message_drafts")
        return super().list(request, *args, **kwargs)

    def perform_create(self, serializer):
        client = self._get_client()
        serializer.save(workspace=self.request.user.workspace,
                        client=client, created_by=self.request.user)
        _log(self.request, client, "created_message_draft")

    def perform_update(self, serializer):
        instance = serializer.save()
        _log(self.request, instance.client, "updated_message_draft")

    def perform_destroy(self, instance):
        _log(self.request, instance.client, "deleted_message_draft")
        instance.delete()

    @action(detail=True, methods=["post"], url_path="send")
    def send(self, request, client_pk=None, pk=None):
        """POST /api/clients/{client_pk}/messages/{id}/send/ — email this draft to the
        client now, and log it as a completed Activity so it shows up in their timeline."""
        draft = self.get_object()
        if not draft.client.email:
            return Response({"detail": "This client has no email address on file."}, status=400)
        if not draft.subject.strip() and not draft.intro.strip():
            return Response({"detail": "Add a subject or message before sending."}, status=400)

        from tasks.email import send_client_communication_email
        try:
            send_client_communication_email(str(draft.id))
        except Exception as e:
            return Response({"detail": f"Failed to send: {e}"}, status=502)

        draft.refresh_from_db()

        from apps.activities.models import Activity
        from django.utils import timezone
        now = timezone.now()
        Activity.objects.create(
            workspace=request.user.workspace,
            coach=request.user,
            client=draft.client,
            activity_type=Activity.ActivityType.CLIENT_COMMUNICATION,
            title=f"Email: {draft.subject or '(no subject)'}",
            status=Activity.Status.COMPLETED,
            start_at=now, end_at=now,
            notes=draft.intro,
        )
        _log(request, draft.client, "sent_message", subject=draft.subject)
        return Response(ClientMessageDraftSerializer(draft, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="attach",
            parser_classes=[MultiPartParser])
    def attach(self, request, client_pk=None, pk=None):
        """POST /api/clients/{client_pk}/messages/{id}/attach/ — attach a file (ad-hoc, per-message)."""
        file = request.FILES.get("file")
        if not file:
            return Response({"detail": "No file provided."}, status=400)
        if file.size > 25 * 1024 * 1024:
            return Response({"detail": "File must be under 25 MB."}, status=400)

        draft = self.get_object()
        ext    = file.name.rsplit(".", 1)[-1].lower() if "." in file.name else "bin"
        s3_key = f"message-attachments/{request.user.workspace.id}/{draft.id}/{uuid.uuid4()}.{ext}"
        try:
            default_storage.save(s3_key, file)
        except Exception as e:
            return Response({"detail": str(e)}, status=500)

        attachments = list(draft.attachments or [])
        attachments.append({"s3_key": s3_key, "file_name": file.name, "size": file.size})
        draft.attachments = attachments
        draft.save(update_fields=["attachments", "updated_at"])
        return Response(ClientMessageDraftSerializer(draft, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="attach-existing")
    def attach_existing(self, request, client_pk=None, pk=None):
        """POST /api/clients/{client_pk}/messages/{id}/attach-existing/  Body: {assessment_id}
        Attach one of this client's existing Files (Assessment records) by reference —
        no re-upload, just points at the same S3 object."""
        draft = self.get_object()
        assessment_id = request.data.get("assessment_id")
        if not assessment_id:
            return Response({"detail": "assessment_id is required."}, status=400)

        assessment = get_object_or_404(
            Assessment.objects.filter(workspace=request.user.workspace, client_id=client_pk),
            pk=assessment_id,
        )

        attachments = list(draft.attachments or [])
        if not any(a.get("s3_key") == assessment.file_s3_key for a in attachments):
            try:
                size = default_storage.size(assessment.file_s3_key)
            except Exception:
                size = None
            attachments.append({
                "s3_key": assessment.file_s3_key,
                "file_name": assessment.file_name,
                "size": size,
            })
            draft.attachments = attachments
            draft.save(update_fields=["attachments", "updated_at"])
        return Response(ClientMessageDraftSerializer(draft, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="remove-attachment")
    def remove_attachment(self, request, client_pk=None, pk=None):
        """POST /api/clients/{client_pk}/messages/{id}/remove-attachment/  Body: {s3_key}"""
        draft  = self.get_object()
        s3_key = request.data.get("s3_key")
        attachments = [a for a in (draft.attachments or []) if a.get("s3_key") != s3_key]
        if len(attachments) != len(draft.attachments or []):
            # Don't delete the underlying S3 object if it's actually a client File
            # (Assessment) attached by reference — only ad-hoc uploads own their object.
            is_referenced_file = Assessment.objects.filter(file_s3_key=s3_key).exists()
            if not is_referenced_file:
                try:
                    default_storage.delete(s3_key)
                except Exception:
                    pass
            draft.attachments = attachments
            draft.save(update_fields=["attachments", "updated_at"])
        return Response(ClientMessageDraftSerializer(draft, context={"request": request}).data)


class ClientGoalViewSet(viewsets.ModelViewSet):
    serializer_class   = ClientGoalSerializer
    permission_classes = [IsCoachOrAbove]

    def get_queryset(self):
        return ClientGoal.objects.filter(
            workspace=self.request.user.workspace,
            client_id=self.kwargs["client_pk"],
            client__in=_client_qs(self.request),
        )

    def list(self, request, *args, **kwargs):
        client = get_object_or_404(_client_qs(request), pk=self.kwargs["client_pk"])
        _log(request, client, "viewed_goals")
        return super().list(request, *args, **kwargs)

    def perform_create(self, serializer):
        client = get_object_or_404(_client_qs(self.request), pk=self.kwargs["client_pk"])
        serializer.save(workspace=self.request.user.workspace,
                        client=client, created_by=self.request.user)
