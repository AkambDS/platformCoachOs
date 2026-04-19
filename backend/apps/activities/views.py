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

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        activity = self.get_object()
        if activity.status == Activity.Status.CANCELLED:
            return Response({"detail": "Already cancelled."}, status=status.HTTP_400_BAD_REQUEST)
        serializer = self.get_serializer(activity, data={"status": "cancelled"}, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @action(detail=True, methods=["get"], url_path="email-preview")
    def email_preview(self, request, pk=None):
        """
        GET /api/activities/{id}/email-preview/?type=confirmation|reminder|cancellation
        Returns HTML email preview for the given activity.
        """
        from tasks.email import _logo_url, _fmt_dt_human, _owner_info
        from tasks.email_html import (
            build_confirmation_email, build_reminder_email, build_cancellation_email
        )
        activity   = self.get_object()
        email_type = request.query_params.get("type", "confirmation")
        workspace  = activity.workspace
        coach_name = activity.coach.full_name if activity.coach else workspace.name
        coach_email = activity.coach.email if activity.coach else ""
        dt_human   = _fmt_dt_human(activity.start_at)
        owner_email, owner_name = _owner_info(workspace)
        logo_url   = _logo_url(workspace)

        if email_type == "reminder":
            html = build_reminder_email(
                activity=activity, workspace_name=workspace.name,
                logo_url=logo_url, coach_name=coach_name, coach_email=coach_email,
                dt_human=dt_human, time_label="24 hours",
                owner_email=owner_email, owner_name=owner_name,
            )
        elif email_type == "cancellation":
            html = build_cancellation_email(
                activity=activity, workspace_name=workspace.name,
                logo_url=logo_url, coach_name=coach_name, coach_email=coach_email,
                dt_human=dt_human, owner_email=owner_email, owner_name=owner_name,
            )
        else:
            html = build_confirmation_email(
                activity=activity, workspace_name=workspace.name,
                logo_url=logo_url, coach_name=coach_name, coach_email=coach_email,
                dt_human=dt_human, owner_email=owner_email, owner_name=owner_name,
            )
        return Response({"html": html})
