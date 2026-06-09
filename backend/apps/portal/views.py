"""
CoachOS — portal/views.py (FR-CP-*)
Client portal views — separate JWT scope (portal_client role + client_id claim).
PostgreSQL RLS enforces row-level isolation at DB layer.
"""
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework import status as http_status
from rest_framework.exceptions import PermissionDenied, NotFound, ValidationError
from rest_framework.throttling import AnonRateThrottle
from apps.clients.models import Client, ClientGoal, Commitment, GoalProgress
from apps.clients.serializers import ClientGoalSerializer, CommitmentSerializer, GoalProgressSerializer
from apps.invoicing.models import Invoice
from apps.library.models import KnowledgeItem
from apps.library.serializers import KnowledgeItemSerializer


# ── Custom throttle: strict limit on the public login endpoint ─────────────────
class PortalLoginThrottle(AnonRateThrottle):
    rate = "10/minute"


# ── Auth helper ────────────────────────────────────────────────────────────────

def _get_portal_claims(request):
    """
    Validate portal JWT claims. Enforces:
      - role == 'portal_client'  (prevents coach tokens from accessing portal)
      - client_id present
      - workspace_id present
    Returns (client_id, workspace_id) or raises PermissionDenied.
    """
    auth = request.auth
    if not auth:
        raise PermissionDenied("Portal access required.")
    if auth.get("role") != "portal_client":
        raise PermissionDenied("Portal access required.")
    client_id    = auth.get("client_id")
    workspace_id = auth.get("workspace_id")
    if not client_id or not workspace_id:
        raise PermissionDenied("Portal access required.")
    return client_id, workspace_id


# ── Login ──────────────────────────────────────────────────────────────────────

class PortalLoginView(APIView):
    """
    POST /api/portal/login/ — email-only portal login.
    Body: { "email": "client@example.com" }
    Returns: { "token": "...", "client_name": "...", "workspace_name": "...", "coach_name": "..." }

    Security notes:
    - Rate-limited to 10 req/min per IP to prevent enumeration
    - Always returns the same error message and similar timing regardless of outcome
    - Token contains role='portal_client'; coach JWTs cannot satisfy this claim
    """
    permission_classes = [AllowAny]
    throttle_classes   = [PortalLoginThrottle]

    def post(self, request):
        import time
        _start = time.monotonic()

        email = (request.data.get("email") or "").strip().lower()
        if not email:
            raise ValidationError({"email": "Email is required."})

        _DENY = Response(
            {"detail": "No portal account found for this email address."},
            status=http_status.HTTP_404_NOT_FOUND,
        )

        try:
            client = Client.objects.select_related("workspace", "coach").get(
                email__iexact=email,
                portal_access=True,
            )
        except Client.DoesNotExist:
            # Constant-time padding so timing doesn't reveal whether email exists
            elapsed = time.monotonic() - _start
            if elapsed < 0.05:
                time.sleep(0.05 - elapsed)
            return _DENY

        if not client.workspace.is_active:
            return _DENY

        from rest_framework_simplejwt.tokens import AccessToken
        from datetime import timedelta
        token = AccessToken()
        token["client_id"]    = str(client.id)
        token["workspace_id"] = str(client.workspace_id)
        token["role"]         = "portal_client"
        token["email"]        = client.email
        token.set_exp(lifetime=timedelta(hours=8))

        coach_name = client.coach.full_name if client.coach else client.workspace.name

        return Response({
            "token":          str(token),
            "client_name":    client.full_name,
            "workspace_name": client.workspace.name,
            "coach_name":     coach_name,
        })


# ── Portal views (all require valid portal_client token) ──────────────────────

class PortalMeView(APIView):
    """GET /api/portal/me/ — return client profile info."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        client_id, workspace_id = _get_portal_claims(request)
        try:
            client = Client.objects.select_related("workspace", "coach").get(
                pk=client_id, workspace_id=workspace_id
            )
        except Client.DoesNotExist:
            raise NotFound()

        coach_name = client.coach.full_name if client.coach else client.workspace.name
        return Response({
            "id":             str(client.id),
            "name":           client.full_name,
            "email":          client.email,
            "coach_name":     coach_name,
            "workspace_name": client.workspace.name,
        })


class PortalGoalsView(APIView):
    """GET /api/portal/goals/ — client sees own active goals + recent commitments."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        client_id, workspace_id = _get_portal_claims(request)

        goals = list(ClientGoal.objects.filter(
            client_id=client_id, workspace_id=workspace_id, status="active"
        ))
        commitments = Commitment.objects.filter(
            client_id=client_id, workspace_id=workspace_id
        ).order_by("-created_at")[:10]

        goals_data = ClientGoalSerializer(goals, many=True).data
        for goal_data, goal_obj in zip(goals_data, goals):
            progress = GoalProgress.objects.filter(goal=goal_obj).order_by("-created_at")
            goal_data["progress_entries"] = GoalProgressSerializer(progress, many=True).data

        return Response({
            "goals":       goals_data,
            "commitments": CommitmentSerializer(commitments, many=True).data,
        })


class PortalProgressView(APIView):
    """POST /api/portal/goals/{goal_id}/progress/ — client logs progress on a goal."""
    permission_classes = [IsAuthenticated]

    def post(self, request, goal_id):
        client_id, workspace_id = _get_portal_claims(request)
        try:
            goal = ClientGoal.objects.get(
                pk=goal_id, client_id=client_id, workspace_id=workspace_id
            )
        except ClientGoal.DoesNotExist:
            raise NotFound()

        progress_text = (request.data.get("progress_text") or "").strip()
        if not progress_text:
            raise ValidationError({"progress_text": "Progress text is required."})

        progress = GoalProgress.objects.create(
            workspace=goal.workspace,
            client=goal.client,
            goal=goal,
            progress_text=progress_text,
        )
        return Response(GoalProgressSerializer(progress).data, status=201)


class PortalMaterialsView(APIView):
    """GET /api/portal/materials/ — client sees workspace library items marked client_visible."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _, workspace_id = _get_portal_claims(request)
        items = KnowledgeItem.objects.filter(
            workspace_id=workspace_id,
            visibility="client_visible",
        )
        return Response(KnowledgeItemSerializer(items, many=True, context={"request": request}).data)


class PortalInvoicesView(APIView):
    """GET /api/portal/invoices/ — client sees own invoices."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        client_id, workspace_id = _get_portal_claims(request)
        invoices = Invoice.objects.filter(
            client_id=client_id,
            workspace_id=workspace_id,
            status__in=[
                Invoice.Status.SENT, Invoice.Status.PAID,
                Invoice.Status.PARTIALLY_PAID, Invoice.Status.OVERDUE,
            ]
        )

        data = []
        for inv in invoices:
            data.append({
                "id":                  str(inv.id),
                "number":              inv.number,
                "status":              inv.status,
                "total":               str(inv.total),
                "amount_paid":         str(inv.amount_paid) if inv.amount_paid else "0.00",
                "due_date":            inv.due_date.isoformat() if inv.due_date else None,
                "stripe_payment_link": inv.stripe_payment_link or "",
                "created_at":          inv.created_at.isoformat(),
            })
        return Response(data)


class PortalActivitiesView(APIView):
    """GET /api/portal/activities/ — client sees own sessions (no internal notes exposed)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        client_id, workspace_id = _get_portal_claims(request)
        from apps.activities.models import Activity
        activities = (
            Activity.objects
            .filter(client_id=client_id, workspace_id=workspace_id)
            .select_related("coach")
            .order_by("-start_at")[:50]
        )

        data = []
        for act in activities:
            data.append({
                "id":            str(act.id),
                "title":         act.title,
                "activity_type": act.activity_type,
                "status":        act.status,
                "start_at":      act.start_at.isoformat(),
                "end_at":        act.end_at.isoformat() if act.end_at else None,
                "location":      act.location or "",
                "meeting_link":  act.meeting_link or "",
                "coach_name":    act.coach.full_name if act.coach else "",
                # notes intentionally excluded — internal coach use only
            })
        return Response(data)


class PortalActivityRespondView(APIView):
    """POST /api/portal/activities/{activity_id}/respond/ — client requests reschedule."""
    permission_classes = [IsAuthenticated]

    def post(self, request, activity_id):
        client_id, workspace_id = _get_portal_claims(request)
        from apps.activities.models import Activity
        try:
            activity = Activity.objects.select_related("client", "coach", "workspace").get(
                pk=activity_id,
                client_id=client_id,
                workspace_id=workspace_id,
            )
        except Activity.DoesNotExist:
            raise NotFound()

        action  = (request.data.get("action") or "").strip()
        message = (request.data.get("message") or "").strip()[:500]

        if action == "reschedule_request":
            if activity.status in ("cancelled", "completed", "missed"):
                return Response(
                    {"detail": "Cannot request reschedule for this session."},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            activity.status = "rescheduled"
            activity.save(update_fields=["status", "updated_at"])
            try:
                from tasks.email import send_client_reschedule_request
                send_client_reschedule_request.delay(str(activity.id), message)
            except Exception:
                pass
            return Response({"detail": "Reschedule request sent.", "status": "rescheduled"})

        return Response(
            {"detail": "Unknown action."},
            status=http_status.HTTP_400_BAD_REQUEST,
        )
