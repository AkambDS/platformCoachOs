"""
CoachOS — WorkspaceTenantMiddleware
Sets PostgreSQL session variable app.workspace_id from JWT before every request.
This activates RLS policies — one workspace can never read another's rows.
"""
import logging
from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse

logger = logging.getLogger(__name__)

class WorkspaceTenantMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Admin uses session auth and needs unrestricted access to all workspaces
        if request.path.startswith("/admin/"):
            return self.get_response(request)

        workspace_id = None
        client_id    = None

        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            try:
                from rest_framework_simplejwt.tokens import AccessToken
                token = AccessToken(auth.split(" ")[1])
                workspace_id = token.get("workspace_id")
                client_id    = token.get("client_id")   # portal users only
            except Exception:
                pass  # invalid token → DRF returns 401

        if workspace_id:
            try:
                with connection.cursor() as cur:
                    cur.execute("SELECT set_config('app.workspace_id', %s, TRUE)", [str(workspace_id)])
                    if client_id:
                        cur.execute("SELECT set_config('app.client_id', %s, TRUE)", [str(client_id)])
            except Exception as e:
                logger.error(f"RLS context failed: {e}")

        return self.get_response(request)


DEMO_WORKSPACE_SLUG = "coachos-demo"
_DEMO_WORKSPACE_ID_CACHE_KEY = "demo_workspace_id_v1"
_DEMO_EXEMPT_PATHS = {
    "/api/auth/login/", "/api/auth/logout/", "/api/auth/refresh/",
    # Lead-capture/tour-event pings (apps.superadmin.views.capture_demo_lead /
    # demo_lead_event) — these record interest in the demo itself, not workspace data,
    # and the tour-event ping fires while already logged in as the demo user.
    "/api/demo/lead/", "/api/demo/lead/event/",
}
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def invalidate_demo_workspace_cache():
    """Call after (re)provisioning the demo workspace (see seed_demo_workspace) so the
    read-only block below activates immediately instead of waiting out the cache TTL."""
    cache.delete(_DEMO_WORKSPACE_ID_CACHE_KEY)


def _get_demo_workspace_id():
    cached = cache.get(_DEMO_WORKSPACE_ID_CACHE_KEY, "__unset__")
    if cached != "__unset__":
        return cached
    from apps.accounts.models import Workspace
    workspace_id = Workspace.objects.filter(slug=DEMO_WORKSPACE_SLUG).values_list("id", flat=True).first()
    cache.set(_DEMO_WORKSPACE_ID_CACHE_KEY, workspace_id, 300)
    return workspace_id


class DemoWorkspaceReadOnlyMiddleware:
    """
    Read-only enforcement for the shared public "Log In as Demo User" workspace
    (coachos-demo, see Login.tsx + seed_demo_workspace) — for that workspace only,
    blocks every mutating request (anything but GET/HEAD/OPTIONS) under /api/ with a
    403, regardless of which view/permission_classes would otherwise handle it.

    This has to be true Django middleware rather than a DRF permission class: most
    views here declare their own `permission_classes`, which *replaces* rather than
    extends DRF's DEFAULT_PERMISSION_CLASSES, so a global default permission class
    would silently miss most endpoints. Middleware wraps every request unconditionally,
    which is also why it's the one place that reliably stops the demo account from
    triggering real outbound email (team invites, invoice sends, session confirmations)
    through CoachOS's production mail pipeline — those all happen inside the POST/PATCH
    views this blocks before they ever run. Real coach/owner accounts are unaffected.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if (
            request.method not in _SAFE_METHODS
            and request.path.startswith("/api/")
            and request.path not in _DEMO_EXEMPT_PATHS
        ):
            token = request.COOKIES.get("access_token")
            if not token:
                auth = request.headers.get("Authorization", "")
                if auth.startswith("Bearer "):
                    token = auth.split(" ")[1]

            if token:
                workspace_id = None
                try:
                    from rest_framework_simplejwt.tokens import AccessToken
                    workspace_id = AccessToken(token).get("workspace_id")
                except Exception:
                    pass  # invalid/expired token → let the real auth layer 401 it

                demo_id = _get_demo_workspace_id()
                if workspace_id and demo_id and str(workspace_id) == str(demo_id):
                    return JsonResponse(
                        {"detail": "This is a read-only demo workspace — changes, deletions, "
                                    "and notifications are disabled here."},
                        status=403,
                    )

        return self.get_response(request)
