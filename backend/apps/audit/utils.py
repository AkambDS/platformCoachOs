def log_access(request, action, client=None, **metadata):
    """Fire-and-forget audit log write, shared across apps."""
    try:
        from .models import AccessLog
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


def recent_actions_for(user, workspace, before, limit=5):
    """What a user was doing right before a given moment — shared by the super-admin
    Error Log tab (workspace_errors) and the error-alert email, so both surface the
    same troubleshooting context the same way."""
    if not user or not workspace:
        return []
    from .models import AccessLog
    qs = (AccessLog.objects
          .filter(workspace=workspace, user=user, created_at__lte=before)
          .order_by("-created_at")[:limit])
    return [{
        "action":      a.action,
        "client_name": a.client_name,
        "metadata":    a.metadata,
        "created_at":  a.created_at,
    } for a in qs]
