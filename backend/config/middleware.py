"""
CoachOS — WorkspaceTenantMiddleware
Sets PostgreSQL session variable app.workspace_id from JWT before every request.
This activates RLS policies — one workspace can never read another's rows.
"""
import logging
from django.db import connection

logger = logging.getLogger(__name__)

class WorkspaceTenantMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
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
