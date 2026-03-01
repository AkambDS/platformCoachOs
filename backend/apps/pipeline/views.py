from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Deal, StageHistory
from .serializers import DealSerializer, AdvanceStageSerializer
from apps.accounts.permissions import IsAssistantOrAbove


class DealViewSet(viewsets.ModelViewSet):
    """
    GET  /api/pipeline/deals/?stage=&coach=  — filterable kanban data
    POST /api/pipeline/deals/               — create deal
    POST /api/pipeline/deals/{id}/advance/  — move to next stage
    """
    serializer_class   = DealSerializer
    permission_classes = [IsAssistantOrAbove]

    def get_queryset(self):
        qs = Deal.objects.filter(workspace=self.request.user.workspace) \
                         .select_related("client", "coach") \
                         .prefetch_related("stage_history")
        stage = self.request.query_params.get("stage")
        if stage: qs = qs.filter(stage=stage)
        return qs

    @action(detail=True, methods=["post"], url_path="advance")
    def advance(self, request, pk=None):
        deal = self.get_object()
        serializer = AdvanceStageSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        old_stage = deal.stage
        deal.advance_stage(serializer.validated_data["stage"])
        StageHistory.objects.create(
            workspace=deal.workspace, deal=deal,
            from_stage=old_stage,
            to_stage=deal.stage,
            changed_by=request.user,
        )
        return Response(DealSerializer(deal).data)
