"""CoachOS — Root URL Configuration"""
from django.contrib import admin
from django.urls import path, include
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView, SpectacularRedocView
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.conf import settings as django_settings
from apps.superadmin.views import public_banner
from apps.activities.public_views import (
    SessionConfirmView, SessionCancelView, SessionRescheduleView, GoogleCalendarWebhookView,
)
from apps.clients.public_views import ContractSignView


@api_view(["POST"])
@permission_classes([AllowAny])
def run_reminders(request):
    """
    POST /api/internal/reminders/
    Called by cron-job.org every 15 min. Protected by a shared secret header.
    Free alternative to Render's paid cron service.
    """
    secret = request.headers.get("X-Cron-Secret", "")
    expected = getattr(django_settings, "CRON_SECRET", "")
    if not expected or secret != expected:
        return Response({"detail": "Forbidden"}, status=403)
    import threading
    from django.core.management import call_command
    import io

    def _run():
        out = io.StringIO()
        call_command("dispatch_reminders", stdout=out)

    threading.Thread(target=_run, daemon=True).start()
    return Response({"detail": "ok"})


@api_view(["POST"])
@permission_classes([AllowAny])
def run_pending_invites(request):
    """
    POST /api/internal/invites/
    Called by cron-job.org every 5 min. Retries any invite emails that failed on creation.
    Responds immediately then processes in a background thread to avoid cron-job.org timeout.
    Uses the same CRON_SECRET as the reminders endpoint.
    """
    secret = request.headers.get("X-Cron-Secret", "")
    expected = getattr(django_settings, "CRON_SECRET", "")
    if not expected or secret != expected:
        return Response({"detail": "Forbidden"}, status=403)

    from apps.accounts.models import WorkspaceInvitation
    from tasks.email import send_invite_email
    from django.utils import timezone
    import threading
    import logging
    logger = logging.getLogger(__name__)

    pending_ids = list(
        WorkspaceInvitation.objects.filter(
            email_sent=False,
            accepted=False,
            expires_at__gt=timezone.now(),
        ).values_list("id", flat=True)
    )

    if not pending_ids:
        return Response({"detail": "ok", "sent": 0})

    def _send_all():
        for invite_id in pending_ids:
            try:
                send_invite_email(str(invite_id))
                WorkspaceInvitation.objects.filter(pk=invite_id).update(email_sent=True)
                logger.info(f"Pending invite email sent: {invite_id}")
            except Exception as e:
                logger.error(f"Pending invite email failed {invite_id}: {e}")

    threading.Thread(target=_send_all, daemon=True).start()
    return Response({"detail": "ok", "queued": len(pending_ids)})

@api_view(["POST"])
@permission_classes([AllowAny])
def run_pipeline_alerts(request):
    """POST /api/internal/pipeline-alerts/ — optional external-cron trigger for the same
    daily pipeline-alert dispatch that already runs automatically via Celery Beat
    (tasks.pipeline.dispatch_pipeline_alerts). Kept for parity with the other
    cron-job.org-triggered endpoints above; harmless to call twice in the same day since
    the dispatch function dedupes per-deal per-day itself."""
    secret = request.headers.get("X-Cron-Secret", "")
    expected = getattr(django_settings, "CRON_SECRET", "")
    if not expected or secret != expected:
        return Response({"detail": "Forbidden"}, status=403)

    import threading
    from tasks.pipeline import dispatch_pipeline_alerts

    threading.Thread(target=dispatch_pipeline_alerts, daemon=True).start()
    return Response({"detail": "ok"})


# Health check endpoint - doesn't require database
def health_check(request):
    return JsonResponse({"status": "ok"}, status=200)

# API root endpoint
def api_root(request):
    return JsonResponse({
        "status": "ok",
        "message": "CoachOS API",
        "docs": "/api/schema/swagger-ui/",
        "endpoints": {
            "auth": "/api/auth/",
            "clients": "/api/clients/",
            "activities": "/api/activities/",
            "pipeline": "/api/pipeline/",
            "invoices": "/api/invoices/",
            "reports": "/api/reports/",
            "library": "/api/library/",
            "settings": "/api/settings/",
            "portal": "/api/portal/",
            "stripe": "/api/stripe/",
        }
    }, status=200)

urlpatterns = [
    path("",                 health_check),
    path("api/",             api_root),
    path("django-admin/",    admin.site.urls),
    # ── Public session action pages (no login, CSRF exempt) ──
    path("session/confirm/<str:token>/",    csrf_exempt(SessionConfirmView.as_view())),
    path("session/cancel/<str:token>/",     csrf_exempt(SessionCancelView.as_view())),
    path("session/reschedule/<str:token>/", csrf_exempt(SessionRescheduleView.as_view())),
    path("contract/sign/<str:token>/",      csrf_exempt(ContractSignView.as_view())),
    path("api/auth/",        include("apps.accounts.urls")),
    path("api/clients/",     include("apps.clients.urls")),
    path("api/activities/",  include("apps.activities.urls")),
    path("api/pipeline/",    include("apps.pipeline.urls")),
    path("api/invoices/",    include("apps.invoicing.urls")),
    path("api/reports/",     include("apps.reports.urls")),
    path("api/library/",     include("apps.library.urls")),
    path("api/settings/",    include("apps.settings_app.urls")),
    path("api/portal/",      include("apps.portal.urls")),
    path("api/feedback/",    include("apps.feedback.urls")),
    path("api/audit/",       include("apps.audit.urls")),
    path("api/superadmin/",  include("apps.superadmin.urls")),
    path("api/system/banner/", public_banner),
    path("api/stripe/",      include("djstripe.urls", namespace="djstripe")),
    path("api/internal/reminders/",       run_reminders),
    path("api/internal/invites/",         run_pending_invites),
    path("api/internal/pipeline-alerts/", run_pipeline_alerts),
    path("api/webhooks/google-calendar/", csrf_exempt(GoogleCalendarWebhookView.as_view())),
    path("accounts/",        include("allauth.urls")),
    # OpenAPI
    path("api/schema/",            SpectacularAPIView.as_view(), name="schema"),
    path("api/schema/swagger-ui/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/schema/redoc/",      SpectacularRedocView.as_view(url_name="schema"),   name="redoc"),
]
