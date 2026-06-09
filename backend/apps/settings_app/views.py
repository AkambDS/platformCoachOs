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
    ClientStatusConfigSerializer, ClientTagConfigSerializer,
)
from apps.pipeline.models import PipelineStageConfig
from apps.activities.models import ActivityTypeConfig, BUILTIN_TYPES
from apps.clients.models import ClientStatusConfig, ClientTagConfig
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
    if PipelineStageConfig.objects.filter(workspace=workspace).exists():
        return
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
    """Seed built-in types once — skip if any builtin already exists for this workspace."""
    if ActivityTypeConfig.objects.filter(workspace=workspace, is_builtin=True).exists():
        return
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


@api_view(["GET"])
@permission_classes([IsWorkspaceMember])
def email_preview(request):
    """
    GET /api/settings/email-preview/?type=...&intro=...&closing=...
    Renders email HTML using the values passed in the request params.
    Falls back to saved DB template when params are omitted.
    This makes the preview independent of save — it always reflects what
    the user has typed in the editor, not what's committed to the DB.
    """
    from types import SimpleNamespace
    from tasks.email_html import build_confirmation_email, build_reminder_email, build_invoice_email, build_portal_invite_email
    from tasks.email import _logo_src, _owner_info

    email_type = request.query_params.get("type", "confirmation")
    workspace  = Workspace.objects.get(pk=request.user.workspace_id)  # fresh DB read
    logo_url   = _logo_src(workspace)
    owner_email, owner_name = _owner_info(workspace)

    DUMMY = dict(
        client_name="Jane Smith", coach_name="Coach Mike",
        session_title="Discovery Session",
        session_time="Wednesday, June 5 at 10:00 AM",
        workspace_name=workspace.name,
        time_label="24 hours",
        invoice_number="INV-0042", amount="150.00",
        due_date="June 30, 2026",
    )

    def apply(text):
        try:
            return text.format(**DUMMY) if text else ""
        except (KeyError, ValueError):
            return text

    # Use request params when present (live preview); fall back to saved DB values
    tmpl = (workspace.email_templates or {}).get(email_type, {})
    raw_intro   = request.query_params.get("intro",   tmpl.get("intro",   ""))
    raw_closing = request.query_params.get("closing", tmpl.get("closing", ""))
    custom_intro   = apply(raw_intro)
    custom_closing = apply(raw_closing)

    # Style overrides: request params take priority over saved DB values.
    # header_tagline uses None sentinel so '' (logo-only) is preserved;
    # all other fields use '' sentinel so absent params are omitted (builders use defaults).
    saved_style = tmpl.get("style", {})
    style = {}
    for key, default in (
        ("header_bg",      ""),
        ("accent_color",   ""),
        ("body_font",      ""),
        ("heading_font",   ""),
        ("value_color",    ""),
    ):
        v = request.query_params.get(key, saved_style.get(key, default))
        if v:  # omit empty strings — builders supply defaults
            style[key] = v
    # header_tagline is special: '' means "logo only / no tagline", not "use default"
    style["header_tagline"] = request.query_params.get(
        "header_tagline", saved_style.get("header_tagline", "Coaching Platform")
    )

    if email_type == "confirmation":
        client   = SimpleNamespace(first_name="Jane", full_name="Jane Smith", email="jane@example.com")
        activity = SimpleNamespace(
            title="Discovery Session", activity_type="session",
            location="123 Main St", notes="", client=client,
        )
        html = build_confirmation_email(
            activity=activity, workspace_name=workspace.name, logo_url=logo_url,
            coach_name="Coach Mike", coach_email="",
            dt_human="Wednesday, June 5 at 10:00 AM",
            owner_email=owner_email, owner_name=owner_name,
            google_cal_url="", custom_intro=custom_intro, custom_closing=custom_closing,
            style=style,
        )

    elif email_type in ("reminder_24h", "reminder_1h"):
        time_label = "24 hours" if email_type == "reminder_24h" else "1 hour"
        client   = SimpleNamespace(first_name="Jane", full_name="Jane Smith", email="jane@example.com")
        activity = SimpleNamespace(
            title="Discovery Session", activity_type="session",
            location="123 Main St", client=client,
        )
        html = build_reminder_email(
            activity=activity, workspace_name=workspace.name, logo_url=logo_url,
            coach_name="Coach Mike", coach_email="",
            dt_human="Wednesday, June 5 at 10:00 AM",
            time_label=time_label,
            owner_email=owner_email, owner_name=owner_name,
            custom_intro=custom_intro, custom_closing=custom_closing,
            style=style,
        )

    elif email_type == "invoice":
        client  = SimpleNamespace(first_name="Jane", full_name="Jane Smith", email="jane@example.com")
        invoice = SimpleNamespace(
            number="INV-0042", total=150.00, currency="USD",
            stripe_payment_link="", client=client,
        )
        html = build_invoice_email(
            invoice=invoice, workspace_name=workspace.name, logo_url=logo_url,
            due_str="June 30, 2026",
            owner_email=owner_email, owner_name=owner_name,
            custom_intro=custom_intro, custom_closing=custom_closing,
            style=style,
        )

    elif email_type == "portal_invite":
        frontend_url = getattr(__import__('django.conf', fromlist=['settings']).settings, 'FRONTEND_URL', '').rstrip('/')
        html = build_portal_invite_email(
            client_name="Jane Smith",
            workspace_name=workspace.name,
            portal_url=f"{frontend_url}/client-portal",
            coach_name="Coach Mike",
            logo_url=logo_url,
            owner_email=owner_email,
            owner_name=owner_name,
            custom_intro=custom_intro,
            custom_closing=custom_closing,
            style=style,
        )

    else:
        return Response({"detail": "Unknown type."}, status=status.HTTP_400_BAD_REQUEST)

    return Response({"html": html})


_BUILTIN_CLIENT_STATUSES = [
    {"label": "Lead",     "color": "#8c8279", "sort_order": 0},
    {"label": "Active",   "color": "#4a7c59", "sort_order": 1},
    {"label": "Inactive", "color": "#b8b2ab", "sort_order": 2},
    {"label": "Archive",  "color": "#c8c4bc", "sort_order": 3},
]


def _seed_client_statuses(workspace):
    if ClientStatusConfig.objects.filter(workspace=workspace, is_builtin=True).exists():
        return
    for s in _BUILTIN_CLIENT_STATUSES:
        ClientStatusConfig.objects.get_or_create(
            workspace=workspace, label=s["label"],
            defaults={**s, "is_builtin": True},
        )


@api_view(["GET", "POST"])
@permission_classes([IsWorkspaceMember])
def client_status_configs(request):
    """GET /api/settings/client-statuses/ — list; POST — create custom status."""
    workspace = request.user.workspace
    _seed_client_statuses(workspace)

    if request.method == "GET":
        qs = ClientStatusConfig.objects.filter(workspace=workspace)
        return Response(ClientStatusConfigSerializer(qs, many=True).data)

    if request.user.role != "business_owner":
        return Response({"detail": "Forbidden."}, status=status.HTTP_403_FORBIDDEN)
    ser = ClientStatusConfigSerializer(data=request.data)
    if ser.is_valid():
        ser.save(workspace=workspace, is_builtin=False)
        return Response(ser.data, status=status.HTTP_201_CREATED)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsBusinessOwner])
def client_status_config_detail(request, pk):
    """PATCH/DELETE /api/settings/client-statuses/<pk>/"""
    workspace = request.user.workspace
    try:
        obj = ClientStatusConfig.objects.get(pk=pk, workspace=workspace)
    except ClientStatusConfig.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)

    if request.method == "DELETE":
        if obj.is_builtin:
            return Response({"detail": "Cannot delete built-in statuses."}, status=status.HTTP_400_BAD_REQUEST)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    ser = ClientStatusConfigSerializer(obj, data=request.data, partial=True)
    if ser.is_valid():
        ser.save()
        return Response(ser.data)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET", "POST"])
@permission_classes([IsWorkspaceMember])
def client_tag_configs(request):
    """GET /api/settings/client-tags/ — list; POST — create tag."""
    workspace = request.user.workspace

    if request.method == "GET":
        qs = ClientTagConfig.objects.filter(workspace=workspace)
        return Response(ClientTagConfigSerializer(qs, many=True).data)

    if request.user.role != "business_owner":
        return Response({"detail": "Forbidden."}, status=status.HTTP_403_FORBIDDEN)
    ser = ClientTagConfigSerializer(data=request.data)
    if ser.is_valid():
        ser.save(workspace=workspace)
        return Response(ser.data, status=status.HTTP_201_CREATED)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsBusinessOwner])
def client_tag_config_detail(request, pk):
    """PATCH/DELETE /api/settings/client-tags/<pk>/"""
    workspace = request.user.workspace
    try:
        obj = ClientTagConfig.objects.get(pk=pk, workspace=workspace)
    except ClientTagConfig.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)

    if request.method == "DELETE":
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    ser = ClientTagConfigSerializer(obj, data=request.data, partial=True)
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
