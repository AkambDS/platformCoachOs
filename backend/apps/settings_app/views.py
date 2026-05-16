import base64
from rest_framework.generics import RetrieveUpdateAPIView
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status
from django.http import HttpResponse
from apps.accounts.models import Workspace
from .serializers import (
    BrandingSerializer, SchedulingSerializer, WorkspaceSerializer,
    PipelineStageConfigSerializer, ActivityTypeConfigSerializer,
)
from apps.pipeline.models import PipelineStageConfig
from apps.activities.models import ActivityTypeConfig, BUILTIN_TYPES
from apps.accounts.permissions import IsBusinessOwner, IsWorkspaceMember


class BrandingSettingsView(RetrieveUpdateAPIView):
    """GET/PUT /api/settings/branding/"""
    serializer_class   = BrandingSerializer

    def get_permissions(self):
        if self.request.method in ("PUT", "PATCH"):
            return [IsBusinessOwner()]
        return [IsWorkspaceMember()]

    def get_object(self):
        return self.request.user.workspace


class SchedulingSettingsView(RetrieveUpdateAPIView):
    """GET/PUT /api/settings/scheduling/"""
    serializer_class   = SchedulingSerializer

    def get_permissions(self):
        if self.request.method in ("PUT", "PATCH"):
            return [IsBusinessOwner()]
        return [IsWorkspaceMember()]

    def get_object(self):
        return self.request.user.workspace


class WorkspaceSettingsView(RetrieveUpdateAPIView):
    """GET/PATCH /api/settings/workspace/ — combined settings used by the frontend"""
    serializer_class   = WorkspaceSerializer
    http_method_names  = ["get", "patch", "put", "head", "options"]

    def get_permissions(self):
        if self.request.method in ("PUT", "PATCH"):
            return [IsBusinessOwner()]
        return [IsWorkspaceMember()]

    def get_object(self):
        return self.request.user.workspace


@api_view(["POST", "DELETE"])
@permission_classes([IsBusinessOwner])
@parser_classes([MultiPartParser])
def logo_upload(request):
    """
    POST  /api/settings/logo/  — upload workspace logo (multipart, field: logo)
    DELETE /api/settings/logo/ — remove workspace logo
    Stores as base64 data-URL in the database so it survives Render deploys.
    """
    workspace = request.user.workspace

    if request.method == "DELETE":
        workspace.logo_data = ""
        workspace.save(update_fields=["logo_data"])
        return Response({"detail": "Logo removed."})

    file = request.FILES.get("logo")
    if not file:
        return Response({"detail": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)

    if file.size > 2 * 1024 * 1024:  # 2 MB limit
        return Response({"detail": "Logo must be under 2 MB."}, status=status.HTTP_400_BAD_REQUEST)

    mime = file.content_type or "image/png"
    if not mime.startswith("image/"):
        return Response({"detail": "File must be an image."}, status=status.HTTP_400_BAD_REQUEST)

    data_url = f"data:{mime};base64,{base64.b64encode(file.read()).decode()}"
    workspace.logo_data = data_url
    workspace.save(update_fields=["logo_data"])
    return Response({"logo_data": data_url})


@api_view(["GET"])
@permission_classes([AllowAny])
def public_branding(request):
    """
    GET /api/settings/public-branding/ — no auth required.
    Returns the first workspace's name and logo URL for the login/register pages.
    """
    try:
        workspace = Workspace.objects.filter(is_active=True).order_by("created_at").first()
        if not workspace:
            return Response({"name": "CoachOS", "logo_url": "", "primary_colour": "#1B3A6B"})
        from django.conf import settings as dj_settings
        backend_base = getattr(dj_settings, "BACKEND_URL", "").rstrip("/")
        if not backend_base:
            allowed = getattr(dj_settings, "ALLOWED_HOSTS", [])
            host = next((h for h in allowed if "onrender.com" in h and not h.startswith(".")), None)
            backend_base = f"https://{host}" if host else "http://localhost:8000"
        logo_url = f"{backend_base}/api/settings/logo/{workspace.id}/" if workspace.logo_data else ""
        return Response({
            "name": workspace.name,
            "logo_url": logo_url,
            "primary_colour": workspace.primary_colour or "#1B3A6B",
        })
    except Exception:
        return Response({"name": "CoachOS", "logo_url": "", "primary_colour": "#1B3A6B"})


_BUILTIN_COLORS = {
    "appointment": "#c9a84c", "task": "#4a7c59", "call": "#2d6a9f",
    "session": "#1a1714",    "training": "#7c4d9f", "travel": "#8c8279",
    "custom": "#a0522d",
}

_BUILTIN_STAGES = [
    {"slug": "lead_new",            "label": "Lead – New",            "color": "#8c8279", "order": 0},
    {"slug": "discovery_scheduled", "label": "Discovery Scheduled",   "color": "#2d6a9f", "order": 1},
    {"slug": "discovery_completed", "label": "Discovery Completed",   "color": "#2980b9", "order": 2},
    {"slug": "proposal_sent",       "label": "Proposal Sent",         "color": "#c9a84c", "order": 3},
    {"slug": "verbal_yes",          "label": "Verbal Yes",            "color": "#4a7c59", "order": 4},
    {"slug": "active_client",       "label": "Active Client",         "color": "#1a1714", "order": 5},
    {"slug": "on_hold",             "label": "On Hold",               "color": "#7c4d9f", "order": 6},
    {"slug": "closed_lost",         "label": "Closed – Lost",         "color": "#c0392b", "order": 7},
]


def _seed_pipeline_stages(workspace):
    for s in _BUILTIN_STAGES:
        PipelineStageConfig.objects.get_or_create(
            workspace=workspace, slug=s["slug"],
            defaults={**s, "is_builtin": True, "follow_up_days": None,
                      "notify_owner": True, "notify_client": False},
        )


@api_view(["GET", "POST"])
@permission_classes([IsWorkspaceMember])
def pipeline_stage_configs(request):
    """GET /api/settings/pipeline-stages/ — list; POST — create custom stage."""
    workspace = request.user.workspace
    _seed_pipeline_stages(workspace)

    if request.method == "GET":
        qs = PipelineStageConfig.objects.filter(workspace=workspace)
        return Response(PipelineStageConfigSerializer(qs, many=True).data)

    if request.user.role != "business_owner":
        return Response({"detail": "Forbidden."}, status=status.HTTP_403_FORBIDDEN)
    ser = PipelineStageConfigSerializer(data=request.data)
    if ser.is_valid():
        ser.save(workspace=workspace, is_builtin=False)
        return Response(ser.data, status=status.HTTP_201_CREATED)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsBusinessOwner])
def pipeline_stage_config_detail(request, pk):
    """PATCH/DELETE /api/settings/pipeline-stages/<pk>/"""
    workspace = request.user.workspace
    try:
        obj = PipelineStageConfig.objects.get(pk=pk, workspace=workspace)
    except PipelineStageConfig.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)

    if request.method == "DELETE":
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    ser = PipelineStageConfigSerializer(obj, data=request.data, partial=True)
    if ser.is_valid():
        ser.save()
        return Response(ser.data)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


def _seed_activity_types(workspace):
    """Create built-in types for a workspace if they don't exist yet."""
    for i, name in enumerate(BUILTIN_TYPES):
        ActivityTypeConfig.objects.get_or_create(
            workspace=workspace, name=name,
            defaults={"color": _BUILTIN_COLORS.get(name, "#1a1714"), "is_builtin": True,
                      "is_active": True, "sort_order": i},
        )


@api_view(["GET", "POST"])
@permission_classes([IsWorkspaceMember])
def activity_type_configs(request):
    """GET /api/settings/activity-types/ — list; POST — create custom type."""
    workspace = request.user.workspace
    _seed_activity_types(workspace)

    if request.method == "GET":
        qs = ActivityTypeConfig.objects.filter(workspace=workspace)
        return Response(ActivityTypeConfigSerializer(qs, many=True).data)

    if not request.user.role == "business_owner":
        return Response({"detail": "Forbidden."}, status=status.HTTP_403_FORBIDDEN)
    data = {**request.data, "is_builtin": False}
    ser = ActivityTypeConfigSerializer(data=data)
    if ser.is_valid():
        ser.save(workspace=workspace)
        return Response(ser.data, status=status.HTTP_201_CREATED)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsBusinessOwner])
def activity_type_config_detail(request, pk):
    """PATCH/DELETE /api/settings/activity-types/<pk>/"""
    workspace = request.user.workspace
    try:
        obj = ActivityTypeConfig.objects.get(pk=pk, workspace=workspace)
    except ActivityTypeConfig.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)

    if request.method == "DELETE":
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    ser = ActivityTypeConfigSerializer(obj, data=request.data, partial=True)
    if ser.is_valid():
        ser.save()
        return Response(ser.data)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


def serve_workspace_logo(request, workspace_id):
    """
    GET /api/settings/logo/<workspace_id>/ — public endpoint, no auth required.
    Used in emails so clients' mail apps can load the logo via HTTP (base64 data-URIs
    are blocked by Gmail/Outlook).
    """
    try:
        workspace = Workspace.objects.get(pk=workspace_id)
    except Workspace.DoesNotExist:
        return HttpResponse(status=404)

    logo_data = workspace.logo_data
    if not logo_data or not logo_data.startswith("data:"):
        return HttpResponse(status=404)

    # Parse "data:<mime>;base64,<data>"
    header, encoded = logo_data.split(",", 1)
    mime = header.split(":")[1].split(";")[0]
    image_bytes = base64.b64decode(encoded)

    response = HttpResponse(image_bytes, content_type=mime)
    response["Cache-Control"] = "public, max-age=86400"
    return response
