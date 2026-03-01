from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from .models import Activity
from .serializers import ActivitySerializer
from apps.accounts.permissions import IsAssistantOrAbove


class ActivityViewSet(viewsets.ModelViewSet):
    """
    GET    /api/activities/?start=&end=  — calendar range query
    POST   /api/activities/             — create (triggers Google Cal sync)
    PUT    /api/activities/{id}/        — update (records edit history FR-ACT-15)
    DELETE /api/activities/{id}/        — delete (triggers Google Cal sync)
    POST   /api/activities/{id}/missed/ — mark as missed session (FR-ACT-13)
    """
    serializer_class   = ActivitySerializer
    permission_classes = [IsAssistantOrAbove]
    filter_backends    = [DjangoFilterBackend]
    filterset_fields   = ["activity_type", "status", "client", "coach"]

    def get_queryset(self):
        qs = Activity.objects.filter(workspace=self.request.user.workspace) \
                             .select_related("client", "coach")
        # Calendar range filter
        start = self.request.query_params.get("start")
        end   = self.request.query_params.get("end")
        if start: qs = qs.filter(start_at__gte=start)
        if end:   qs = qs.filter(start_at__lte=end)
        return qs

    def perform_destroy(self, instance):
        from tasks.calendar import sync_to_google_calendar
        sync_to_google_calendar.delay(str(instance.id), "delete")
        instance.delete()

    @action(detail=True, methods=["post"], url_path="missed")
    def mark_missed(self, request, pk=None):
        activity = self.get_object()
        activity.mark_missed(request.user)
        return Response(ActivitySerializer(activity).data)
