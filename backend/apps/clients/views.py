"""CoachOS — clients/views.py"""
from rest_framework import viewsets, status, generics
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
import uuid, csv
from django.http import StreamingHttpResponse

from .models import Client, Assessment, ClientGoal, Commitment, GoalProgress
from .serializers import (ClientListSerializer, ClientDetailSerializer,
                          AssessmentSerializer, ClientGoalSerializer,
                          CommitmentSerializer, GoalProgressSerializer)
from apps.accounts.permissions import IsAssistantOrAbove, IsCoachOrAbove


class ClientViewSet(viewsets.ModelViewSet):
    """
    GET    /api/clients/         — list (filterable by tags, active_flag, coach)
    POST   /api/clients/         — create new client
    GET    /api/clients/{id}/    — full client detail + engagement history
    PUT    /api/clients/{id}/    — update
    DELETE /api/clients/{id}/    — permanent delete (FR-CRM-08: no soft delete)
    POST   /api/clients/import/  — CSV bulk import (FR-CRM-07)
    """
    permission_classes = [IsAssistantOrAbove]
    filter_backends    = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields   = ["active_flag", "coach"]
    search_fields      = ["first_name", "last_name", "email", "company"]
    ordering_fields    = ["last_name", "created_at"]
    ordering           = ["last_name"]

    def get_queryset(self):
        #return Client.objects.filter(workspace=self.request.user.workspace).select_related("coach")
        qs = Client.objects.filter(workspace=self.request.user.workspace).select_related("coach")
        tags = self.request.query_params.getlist("tag")
        if tags:
            qs = qs.filter(tags__contains=tags)
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return ClientListSerializer
        return ClientDetailSerializer

    def perform_create(self, serializer):
        serializer.save(
            workspace=self.request.user.workspace,
            coach=self.request.user,
        )

    @action(detail=False, methods=["post"], url_path="import",
            parser_classes=[MultiPartParser])
    def csv_import(self, request):
        """POST /api/clients/import/ — CSV bulk import (FR-CRM-07)"""
        file = request.FILES.get("file")
        if not file:
            return Response({"detail": "No file provided."}, status=400)

        reader  = csv.DictReader(chunk.decode() for chunk in file.chunks())
        created = 0
        errors  = []
        for i, row in enumerate(reader, start=2):
            try:
                Client.objects.create(
                    workspace=request.user.workspace,
                    coach=request.user,
                    first_name=row.get("first_name", "").strip(),
                    last_name=row.get("last_name", "").strip(),
                    email=row.get("email", "").strip(),
                    company=row.get("company", "").strip(),
                    job_title=row.get("job_title", "").strip(),
                )
                created += 1
            except Exception as e:
                errors.append({"row": i, "error": str(e)})

        return Response({"created": created, "errors": errors}, status=201)


class AssessmentViewSet(viewsets.ModelViewSet):
    """GET/POST/DELETE /api/clients/{client_id}/assessments/"""
    serializer_class   = AssessmentSerializer
    permission_classes = [IsAssistantOrAbove]

    def get_queryset(self):
        return Assessment.objects.filter(
            workspace=self.request.user.workspace,
            client_id=self.kwargs["client_pk"],
        )

    def perform_create(self, serializer):
        client = Client.objects.get(pk=self.kwargs["client_pk"],
                                    workspace=self.request.user.workspace)
        serializer.save(workspace=self.request.user.workspace,
                        client=client, uploaded_by=self.request.user)


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
