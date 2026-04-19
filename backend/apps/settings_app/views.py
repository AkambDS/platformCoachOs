import base64
from rest_framework.generics import RetrieveUpdateAPIView
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework import status
from django.http import HttpResponse
from apps.accounts.models import Workspace
from .serializers import BrandingSerializer, SchedulingSerializer, WorkspaceSerializer
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
