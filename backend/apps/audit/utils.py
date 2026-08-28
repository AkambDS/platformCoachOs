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
