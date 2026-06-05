from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Deal, StageHistory, DealProgress
from .serializers import DealSerializer, AdvanceStageSerializer
from apps.accounts.permissions import IsAssistantOrAbove

TRACKED_FIELDS = ["deal_value", "deal_type", "source", "notes", "tags",
                  "expected_close_date", "probability", "next_action", "next_action_date"]


class DealViewSet(viewsets.ModelViewSet):
    """
    GET  /api/pipeline/deals/?stage=&coach=  — filterable kanban data
    POST /api/pipeline/deals/               — create deal
    PATCH /api/pipeline/deals/{id}/         — edit deal fields (logs DealProgress)
    POST /api/pipeline/deals/{id}/advance/  — move to next stage
    """
    serializer_class   = DealSerializer
    permission_classes = [IsAssistantOrAbove]

    def get_queryset(self):
        user = self.request.user
        qs = Deal.objects.filter(workspace=user.workspace) \
                         .select_related("client", "coach") \
                         .prefetch_related("stage_history", "progress_log")
        if user.role != "business_owner":
            qs = qs.filter(client__coach=user)
        stage = self.request.query_params.get("stage")
        if stage: qs = qs.filter(stage=stage)
        client = self.request.query_params.get("client")
        if client: qs = qs.filter(client__id=client)
        return qs

    def perform_update(self, serializer):
        deal = serializer.instance
        old = {f: str(getattr(deal, f) or "") for f in TRACKED_FIELDS}
        instance = serializer.save()
        new = {f: str(getattr(instance, f) or "") for f in TRACKED_FIELDS}
        for field in TRACKED_FIELDS:
            if old[field] != new[field]:
                DealProgress.objects.create(
                    workspace=instance.workspace,
                    deal=instance,
                    changed_by=self.request.user,
                    field_name=field,
                    old_value=old[field],
                    new_value=new[field],
                )

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
