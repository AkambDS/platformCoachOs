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
        # Assistants can only read — all writes require Coach+
        if self.action in ("create", "update", "partial_update", "destroy", "csv_import", "csv_export"):
            return [IsCoachOrAbove()]
        return [IsAssistantOrAbove()]
    filter_backends    = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields   = ["active_flag", "status", "coach"]
    search_fields      = ["first_name", "last_name", "email", "company"]
    ordering_fields    = ["last_name", "created_at"]
    ordering           = ["last_name"]

    def get_queryset(self):
        from apps.activities.models import Activity
        qs = Client.objects.filter(workspace=self.request.user.workspace).select_related("coach")
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

    def get_serializer_class(self):
        if self.action == "list":
            return ClientListSerializer
        return ClientDetailSerializer

    def perform_create(self, serializer):
        if not self.request.user.workspace_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"detail": "Your account is not linked to a workspace. Contact your administrator."})
        serializer.save(
            workspace=self.request.user.workspace,
            coach=self.request.user,
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
            for c in Client.objects.filter(workspace=request.user.workspace).order_by("last_name"):
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

    def get_queryset(self):
        return ClientNote.objects.filter(
            workspace=self.request.user.workspace,
            client_id=self.kwargs["client_pk"],
        )

    def perform_create(self, serializer):
        client = get_object_or_404(Client, pk=self.kwargs["client_pk"],
                                   workspace=self.request.user.workspace)
        serializer.save(workspace=self.request.user.workspace,
                        client=client, created_by=self.request.user)


class AssessmentViewSet(viewsets.ModelViewSet):
    """GET/DELETE /api/clients/{client_id}/assessments/ + POST upload/"""
    serializer_class   = AssessmentSerializer
    permission_classes = [IsAssistantOrAbove]

    def get_permissions(self):
        if self.action == "destroy":
            return [IsBusinessOwnerOrSuperuser()]
        return [IsAssistantOrAbove()]

    def get_queryset(self):
        return Assessment.objects.filter(
            workspace=self.request.user.workspace,
            client_id=self.kwargs["client_pk"],
        )

    def perform_create(self, serializer):
        client = get_object_or_404(Client, pk=self.kwargs["client_pk"],
                                   workspace=self.request.user.workspace)
        serializer.save(workspace=self.request.user.workspace,
                        client=client, uploaded_by=self.request.user)

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

        client = get_object_or_404(Client, pk=client_pk, workspace=request.user.workspace)
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
        return Response(AssessmentSerializer(obj, context={"request": request}).data,
                        status=201)


class ClientGoalViewSet(viewsets.ModelViewSet):
    serializer_class   = ClientGoalSerializer
    permission_classes = [IsCoachOrAbove]

    def get_queryset(self):
        return ClientGoal.objects.filter(
            workspace=self.request.user.workspace,
            client_id=self.kwargs["client_pk"],
        )

    def perform_create(self, serializer):
        client = Client.objects.get(pk=self.kwargs["client_pk"],
                                    workspace=self.request.user.workspace)
        serializer.save(workspace=self.request.user.workspace,
                        client=client, created_by=self.request.user)
