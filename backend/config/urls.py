"""CoachOS — Root URL Configuration"""
from django.contrib import admin
from django.urls import path, include
from django.http import JsonResponse
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView, SpectacularRedocView
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.conf import settings as django_settings


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
    from django.core.management import call_command
    import io
    out = io.StringIO()
    call_command("dispatch_reminders", stdout=out)
    return Response({"detail": "ok", "output": out.getvalue()})

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
    path("",                 health_check),  # Root / endpoint for health checks
    path("api/",             api_root),      # API root endpoint
    path("admin/",           admin.site.urls),
    path("api/auth/",        include("apps.accounts.urls")),
    path("api/clients/",     include("apps.clients.urls")),
    path("api/activities/",  include("apps.activities.urls")),
    path("api/pipeline/",    include("apps.pipeline.urls")),
    path("api/invoices/",    include("apps.invoicing.urls")),
    path("api/reports/",     include("apps.reports.urls")),
    path("api/library/",     include("apps.library.urls")),
    path("api/settings/",    include("apps.settings_app.urls")),
    path("api/portal/",      include("apps.portal.urls")),
    path("api/stripe/",      include("djstripe.urls", namespace="djstripe")),
    path("api/internal/reminders/", run_reminders),
    path("accounts/",        include("allauth.urls")),
    # OpenAPI
    path("api/schema/",            SpectacularAPIView.as_view(), name="schema"),
    path("api/schema/swagger-ui/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/schema/redoc/",      SpectacularRedocView.as_view(url_name="schema"),   name="redoc"),
]
