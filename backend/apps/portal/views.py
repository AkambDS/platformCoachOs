"""
CoachOS — portal/views.py (FR-CP-*)
Client portal views — separate JWT scope (client_id claim).
PostgreSQL RLS enforces row-level isolation at DB layer.
"""
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from apps.clients.models import Client, ClientGoal, Commitment, GoalProgress
from apps.clients.serializers import ClientGoalSerializer, CommitmentSerializer, GoalProgressSerializer
from apps.invoicing.models import Invoice
from apps.invoicing.serializers import InvoiceListSerializer
from apps.library.models import KnowledgeItem
from apps.library.serializers import KnowledgeItemSerializer


class PortalGoalsView(APIView):
    """GET /api/portal/goals/ — client sees own goals + commitments (FR-CP-02/03)"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        client_id = request.auth.get("client_id") if request.auth else None
        if not client_id:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Portal access required.")

        goals       = ClientGoal.objects.filter(client_id=client_id, status="active")
        commitments = Commitment.objects.filter(client_id=client_id).order_by("-created_at")[:10]

        return Response({
            "goals":       ClientGoalSerializer(goals, many=True).data,
            "commitments": CommitmentSerializer(commitments, many=True).data,
        })


class PortalProgressView(APIView):
    """POST /api/portal/goals/{goal_id}/progress/ — client records progress (FR-CP-04)"""
    permission_classes = [IsAuthenticated]

    def post(self, request, goal_id):
        client_id = request.auth.get("client_id") if request.auth else None
        try:
            goal = ClientGoal.objects.get(pk=goal_id, client_id=client_id)
        except ClientGoal.DoesNotExist:
            from rest_framework.exceptions import NotFound
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
        client_id   = request.auth.get("client_id") if request.auth else None
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
        client_id = request.auth.get("client_id") if request.auth else None
        invoices  = Invoice.objects.filter(
            client_id=client_id,
            status__in=[Invoice.Status.SENT, Invoice.Status.PAID,
                        Invoice.Status.PARTIALLY_PAID, Invoice.Status.OVERDUE]
        )
        return Response(InvoiceListSerializer(invoices, many=True).data)
