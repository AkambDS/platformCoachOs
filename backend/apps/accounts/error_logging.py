"""Utilities for capturing errors into ErrorLog."""
import traceback as tb
import logging

logger = logging.getLogger(__name__)


def capture_error(exc, workspace=None, user=None, endpoint="", source="api", severity="error"):
    """Write one ErrorLog row. Never raises — logging must not break the request."""
    try:
        from apps.accounts.models import ErrorLog
        entry = ErrorLog.objects.create(
            workspace=workspace,
            user=user,
            severity=severity,
            source=source,
            error_type=type(exc).__name__,
            message=str(exc)[:2000],
            traceback="".join(tb.format_exception(type(exc), exc, exc.__traceback__))[:10000],
            endpoint=endpoint[:500],
        )
    except Exception:
        logger.exception("ErrorLog.capture_error failed")
        return

    # Real-time alert — nobody was watching the super-admin dashboard while a live
    # customer hit this, so it needs to reach someone immediately rather than sit in
    # the Error Log tab until the next time a human happens to check it. Runs inline
    # (matches how every other email task in this codebase is triggered, e.g.
    # send_invoice_email) — its own try/except means a slow or failed send never
    # affects the ErrorLog write above or the original request/response.
    try:
        from tasks.email import send_error_alert_email
        send_error_alert_email(str(entry.id))
    except Exception:
        logger.exception("send_error_alert_email dispatch failed")


def drf_exception_handler(exc, context):
    """Custom DRF exception handler — logs unhandled (500) errors, then delegates."""
    from rest_framework.views import exception_handler
    response = exception_handler(exc, context)

    # Only log errors that DRF couldn't turn into a clean response (true 500s)
    if response is None:
        request = context.get("request")
        workspace = getattr(getattr(request, "user", None), "workspace", None)
        user = getattr(request, "user", None)
        if user and not getattr(user, "is_authenticated", False):
            user = None
        endpoint = getattr(request, "path", "")
        capture_error(exc, workspace=workspace, user=user, endpoint=endpoint, source="api")

    return response


def register_celery_failure_handler():
    """Connect Celery task_failure signal to ErrorLog. Call once from AppConfig.ready()."""
    try:
        from celery.signals import task_failure

        @task_failure.connect
        def on_task_failure(sender, task_id, exception, traceback, kwargs, **kw):
            capture_error(
                exception,
                workspace=None,
                endpoint=f"celery:{sender.name}",
                source="celery",
                severity="error",
            )
    except Exception:
        logger.exception("Failed to register Celery failure handler")
