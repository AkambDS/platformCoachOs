"""
CoachOS — portal/views.py (FR-CP-*)
Client portal views — separate JWT scope (portal_client role + client_id claim).
"""
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework import status as http_status
from rest_framework.exceptions import PermissionDenied, NotFound, ValidationError
from rest_framework.throttling import AnonRateThrottle
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import TokenError, InvalidToken
from apps.clients.models import Client, ClientGoal, Commitment, GoalProgress
from apps.clients.serializers import ClientGoalSerializer, CommitmentSerializer, GoalProgressSerializer
from apps.invoicing.models import Invoice
from apps.library.models import KnowledgeItem
from apps.library.serializers import KnowledgeItemSerializer


# ── Portal JWT authentication ──────────────────────────────────────────────────

class _PortalUser:
    """Lightweight pseudo-user for portal tokens — satisfies IsAuthenticated."""
    is_authenticated = True
    is_anonymous     = False
    is_active        = True

    def __init__(self, payload):
        self.client_id    = payload.get("client_id")
        self.workspace_id = payload.get("workspace_id")
        self.email        = payload.get("email", "")
        self.role         = "portal_client"
        self.pk           = self.client_id   # required by DRF throttling


class PortalJWTAuthentication(JWTAuthentication):
    """Accepts only tokens with role='portal_client'; rejects coach tokens."""

    def authenticate(self, request):
        header = self.get_header(request)
        if header is None:
            return None
        raw_token = self.get_raw_token(header)
        if raw_token is None:
            return None
        try:
            validated = self.get_validated_token(raw_token)
        except (TokenError, InvalidToken):
            return None
        if validated.get("role") != "portal_client":
            return None
        return (_PortalUser(validated), validated)


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
    authentication_classes = [PortalJWTAuthentication]
    permission_classes     = [IsAuthenticated]

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
    authentication_classes = [PortalJWTAuthentication]
    permission_classes     = [IsAuthenticated]

    def get(self, request):
        client_id, workspace_id = _get_portal_claims(request)

        goals = list(ClientGoal.objects.filter(
            client_id=client_id, workspace_id=workspace_id,
            status="active",
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
    authentication_classes = [PortalJWTAuthentication]
    permission_classes     = [IsAuthenticated]

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
    authentication_classes = [PortalJWTAuthentication]
    permission_classes     = [IsAuthenticated]

    def get(self, request):
        client_id, workspace_id = _get_portal_claims(request)
        from django.db.models import Q
        items = KnowledgeItem.objects.filter(
            workspace_id=workspace_id,
        ).filter(
            Q(visibility="client_visible") |
            Q(visibility="specific", shared_client_ids__contains=[str(client_id)])
        )
        return Response(KnowledgeItemSerializer(items, many=True, context={"request": request}).data)


class PortalInvoicesView(APIView):
    """GET /api/portal/invoices/ — client sees own invoices with line items."""
    authentication_classes = [PortalJWTAuthentication]
    permission_classes     = [IsAuthenticated]

    def get(self, request):
        client_id, workspace_id = _get_portal_claims(request)
        invoices = Invoice.objects.filter(
            client_id=client_id,
            workspace_id=workspace_id,
            status__in=[
                Invoice.Status.SENT, Invoice.Status.PAID,
                Invoice.Status.PARTIALLY_PAID, Invoice.Status.OVERDUE,
            ]
        ).prefetch_related("items")

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
                "items": [
                    {
                        "description": item.description,
                        "quantity":    str(item.quantity),
                        "unit_price":  str(item.unit_price),
                        "line_total":  str(item.line_total),
                    }
                    for item in inv.items.all()
                ],
            })
        return Response(data)


class PortalActivitiesView(APIView):
    """GET /api/portal/activities/ — client sees own sessions (no internal notes exposed)."""
    authentication_classes = [PortalJWTAuthentication]
    permission_classes     = [IsAuthenticated]

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
    authentication_classes = [PortalJWTAuthentication]
    permission_classes     = [IsAuthenticated]

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


# ── Portal Notes (client-written) ─────────────────────────────────────────────

class PortalNotesView(APIView):
    """GET /api/portal/notes/ — list + POST create client notes."""
    authentication_classes = [PortalJWTAuthentication]
    permission_classes     = [IsAuthenticated]

    def get(self, request):
        client_id, workspace_id = _get_portal_claims(request)
        from apps.clients.models import ClientNote
        # Coach notes: only show if explicitly shared; client's own notes always show
        from django.db.models import Q
        notes = ClientNote.objects.filter(
            client_id=client_id,
            workspace_id=workspace_id,
        ).filter(
            Q(created_by__isnull=True) |          # client-written: always visible
            Q(visible_to_client=True)              # coach-written: only if shared
        ).order_by("-created_at")
        return Response([_serialize_note(n) for n in notes])

    def post(self, request):
        client_id, workspace_id = _get_portal_claims(request)
        from apps.clients.models import ClientNote
        text = (request.data.get("text") or "").strip()
        if not text:
            return Response({"detail": "text is required."}, status=400)
        note = ClientNote.objects.create(
            client_id=client_id,
            workspace_id=workspace_id,
            text=text,
            note_type="general",
            created_by=None,
        )
        return Response(_serialize_note(note), status=201)


class PortalNoteDetailView(APIView):
    """PATCH/DELETE /api/portal/notes/{note_id}/"""
    authentication_classes = [PortalJWTAuthentication]
    permission_classes     = [IsAuthenticated]

    def _get_note(self, note_id, client_id, workspace_id):
        from apps.clients.models import ClientNote
        try:
            return ClientNote.objects.get(
                pk=note_id,
                client_id=client_id,
                workspace_id=workspace_id,
                created_by__isnull=True,
            )
        except ClientNote.DoesNotExist:
            raise NotFound()

    def patch(self, request, note_id):
        client_id, workspace_id = _get_portal_claims(request)
        note = self._get_note(note_id, client_id, workspace_id)
        text = (request.data.get("text") or "").strip()
        if not text:
            return Response({"detail": "text is required."}, status=400)
        note.text = text
        note.save(update_fields=["text", "updated_at"])
        return Response(_serialize_note(note))

    def delete(self, request, note_id):
        client_id, workspace_id = _get_portal_claims(request)
        note = self._get_note(note_id, client_id, workspace_id)
        note.delete()
        return Response(status=204)


def _serialize_note(note):
    return {
        "id":               str(note.id),
        "text":             note.text,
        "note_type":        note.note_type,
        "created_by_name":  note.created_by.full_name if note.created_by else None,
        "client_owned":     note.created_by is None,   # client can edit/delete own notes
        "created_at":       note.created_at.isoformat(),
        "updated_at":       note.updated_at.isoformat(),
    }
