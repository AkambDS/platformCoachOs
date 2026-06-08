"""CoachOS — clients/views.py"""
from rest_framework import viewsets, status, generics
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from django.db.models import Subquery, OuterRef
import uuid, csv
from django.http import StreamingHttpResponse

from django.shortcuts import get_object_or_404
from django.core.files.storage import default_storage
from django.utils import timezone
from .models import Client, Assessment, ClientGoal, Commitment, GoalProgress, ClientNote
from .serializers import (ClientListSerializer, ClientDetailSerializer,
                          AssessmentSerializer, ClientGoalSerializer,
                          CommitmentSerializer, GoalProgressSerializer,
                          ClientNoteSerializer)
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
