"""
CoachOS — portal/views.py (FR-CP-*)
Client portal views — separate JWT scope (client_id claim).
"""
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework import status as http_status
from rest_framework.exceptions import PermissionDenied, NotFound, ValidationError
from apps.clients.models import Client, ClientGoal, Commitment, GoalProgress
from apps.clients.serializers import ClientGoalSerializer, CommitmentSerializer, GoalProgressSerializer
from apps.invoicing.models import Invoice
from apps.library.models import KnowledgeItem
from apps.library.serializers import KnowledgeItemSerializer


def _get_client_id(request):
    """Extract client_id from JWT auth payload. Raises PermissionDenied if missing."""
    client_id = request.auth.get("client_id") if request.auth else None
    if not client_id:
        raise PermissionDenied("Portal access required.")
    return client_id


class PortalLoginView(APIView):
    """
    POST /api/portal/login/ — passwordless portal login via email (FR-CP-01).
    Body: { "email": "client@example.com" }
    Returns: { "token": "...", "client_name": "...", "workspace_name": "...", "coach_name": "..." }
    """
    permission_classes = [AllowAny]

    def post(self, request):
        email = (request.data.get("email") or "").strip().lower()
        if not email:
            raise ValidationError({"email": "Email is required."})

        try:
            client = Client.objects.select_related("workspace", "coach").get(
                email__iexact=email,
                portal_access=True,
            )
        except Client.DoesNotExist:
            return Response(
                {"detail": "No portal account found for this email address."},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        if not client.workspace.is_active:
            return Response(
                {"detail": "No portal account found for this email address."},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        from rest_framework_simplejwt.tokens import AccessToken
        from datetime import timedelta
        token = AccessToken()
        token["client_id"]    = str(client.id)
        token["workspace_id"] = str(client.workspace_id)
        token["role"]         = "portal_client"
        token["email"]        = client.email
        # 8-hour TTL for portal sessions
        token.set_exp(lifetime=timedelta(hours=8))

        coach_name = client.coach.full_name if client.coach else client.workspace.name

        return Response({
            "token":          str(token),
            "client_name":    client.full_name,
            "workspace_name": client.workspace.name,
            "coach_name":     coach_name,
        })


class PortalMeView(APIView):
    """GET /api/portal/me/ — return client profile info."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        client_id = _get_client_id(request)
        try:
            client = Client.objects.select_related("workspace", "coach").get(pk=client_id)
        except Client.DoesNotExist:
            raise NotFound()

        coach_name = client.coach.full_name if client.coach else client.workspace.name

        return Response({
            "id":             str(client.id),
            "name":           client.full_name,
            "email":          client.email,
            "coach_name":     coach_name,
            "workspace_name": client.workspace.name,
            "portal_access":  client.portal_access,
        })


class PortalGoalsView(APIView):
    """GET /api/portal/goals/ — client sees own goals + commitments (FR-CP-02/03)"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        client_id = _get_client_id(request)

        goals = list(ClientGoal.objects.filter(client_id=client_id, status="active"))
        commitments = Commitment.objects.filter(client_id=client_id).order_by("-created_at")[:10]

        goals_data = ClientGoalSerializer(goals, many=True).data
        for goal_data, goal_obj in zip(goals_data, goals):
            from apps.clients.serializers import GoalProgressSerializer as GPS
            progress = GoalProgress.objects.filter(goal=goal_obj).order_by("-created_at")
            goal_data["progress_entries"] = GPS(progress, many=True).data

        return Response({
            "goals":       goals_data,
            "commitments": CommitmentSerializer(commitments, many=True).data,
        })


class PortalProgressView(APIView):
    """POST /api/portal/goals/{goal_id}/progress/ — client records progress (FR-CP-04)"""
    permission_classes = [IsAuthenticated]

    def post(self, request, goal_id):
        client_id = _get_client_id(request)
        try:
            goal = ClientGoal.objects.get(pk=goal_id, client_id=client_id)
        except ClientGoal.DoesNotExist:
            raise NotFound()

        progress = GoalProgress.objects.create(
            workspace=goal.workspace,
            client=goal.client,
            goal=goal,
            progress_text=request.data.get("progress_text", ""),
        )
        return Response(GoalProgressSerializer(progress).data, status=201)


class PortalMaterialsView(APIView):
    """GET /api/portal/materials/ — client sees shared library items (FR-CP-05)"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        client_id    = _get_client_id(request)
        workspace_id = request.auth.get("workspace_id") if request.auth else None
        items = KnowledgeItem.objects.filter(
            workspace_id=workspace_id,
            visibility="client_visible",
        )
        return Response(KnowledgeItemSerializer(items, many=True, context={"request": request}).data)


class PortalInvoicesView(APIView):
    """GET /api/portal/invoices/ — client sees own invoices (FR-CP-06/07)"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        client_id = _get_client_id(request)
        invoices = Invoice.objects.filter(
            client_id=client_id,
            status__in=[Invoice.Status.SENT, Invoice.Status.PAID,
                        Invoice.Status.PARTIALLY_PAID, Invoice.Status.OVERDUE]
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
    """GET /api/portal/activities/ — client sees own upcoming + recent activities."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        client_id = _get_client_id(request)
        from apps.activities.models import Activity
        activities = (
            Activity.objects
            .filter(client_id=client_id)
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
                "location":      act.location,
                "meeting_link":  act.meeting_link,
                "coach_name":    act.coach.full_name if act.coach else "",
            })
        return Response(data)


class PortalActivityRespondView(APIView):
    """POST /api/portal/activities/{activity_id}/respond/ — client responds to an activity."""
    permission_classes = [IsAuthenticated]

    def post(self, request, activity_id):
        client_id = _get_client_id(request)
        from apps.activities.models import Activity
        try:
            activity = Activity.objects.select_related("client", "coach", "workspace").get(
                pk=activity_id,
                client_id=client_id,
            )
        except Activity.DoesNotExist:
            raise NotFound()

        action  = request.data.get("action")
        message = request.data.get("message", "")

        if action == "reschedule_request":
            activity.status = Activity.Status.RESCHEDULED
            activity.save(update_fields=["status", "updated_at"])

            try:
                from tasks.email import send_client_reschedule_request
                send_client_reschedule_request.delay(str(activity.id), message)
            except Exception:
                import threading
                from tasks.email import send_client_reschedule_request as _task
                threading.Thread(
                    target=_task,
                    args=(str(activity.id), message),
                    daemon=True,
                ).start()

            return Response({
                "detail": "Reschedule request sent.",
                "status": activity.status,
                "id":     str(activity.id),
            })

        return Response(
            {"detail": f"Unknown action '{action}'."},
            status=http_status.HTTP_400_BAD_REQUEST,
        )
