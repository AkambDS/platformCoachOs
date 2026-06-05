from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from apps.accounts.permissions import IsBusinessOwnerOrSuperuser
from .models import AccessLog


@api_view(["GET"])
@permission_classes([IsBusinessOwnerOrSuperuser])
def workspace_audit_log(request):
    """GET /api/audit/  — business owner sees their workspace's access log"""
    logs = (AccessLog.objects
            .filter(workspace=request.user.workspace)
            .exclude(user=request.user)
            .select_related("user")
            .order_by("-created_at")[:100])
    return Response([{
        "id":          l.id,
        "user_name":   l.user_name,
        "client_name": l.client_name,
        "action":      l.action,
        "metadata":    l.metadata,
        "created_at":  l.created_at.isoformat(),
    } for l in logs])
