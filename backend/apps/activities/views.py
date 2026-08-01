from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from .models import Activity
from .serializers import ActivitySerializer
from apps.accounts.permissions import IsAssistantOrAbove, require_tab


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

    def get_permissions(self):
        if self.action == "destroy":
            return [IsAssistantOrAbove(), require_tab("activities", "delete")()]
        if self.action in ("create", "update", "partial_update", "mark_missed", "cancel"):
            return [IsAssistantOrAbove(), require_tab("activities", "edit")()]
        return [IsAssistantOrAbove(), require_tab("activities", "view")()]

    def get_queryset(self):
        user = self.request.user
        qs = Activity.objects.filter(workspace=user.workspace) \
                             .select_related("client", "coach")
        if user.role != "business_owner":
            qs = qs.filter(client__coach=user)
        # Calendar range filter
        start = self.request.query_params.get("start")
        end   = self.request.query_params.get("end")
        if start: qs = qs.filter(start_at__gte=start)
        if end:   qs = qs.filter(start_at__lte=end)
        # Upcoming queries need ascending order; default model ordering is -start_at
        if start and not end:
            qs = qs.order_by("start_at")
        return qs

    def perform_update(self, serializer):
        instance = serializer.instance
        # When a coach edits a rescheduled session without explicitly setting status,
        # reset it to "scheduled" so it no longer shows as pending reschedule
        data = serializer.validated_data
        if instance.status == "rescheduled" and "status" not in data:
            data["status"] = "scheduled"
        serializer.save(**data)

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
        from django.db.models import Q
        activity = self.get_object()
        if activity.status == Activity.Status.CANCELLED:
            return Response({"detail": "Already cancelled."}, status=status.HTTP_400_BAD_REQUEST)

        scope = request.data.get("scope", "this")  # 'this' | 'future' | 'all'

        if scope == "this":
            serializer = self.get_serializer(activity, data={"status": "cancelled"}, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            from tasks.email import send_activity_cancellation_email
            send_activity_cancellation_email.delay(str(activity.id))
            return Response(serializer.data)

        # Series cancel — find all related activities
        root_id = activity.recurrence_id or activity.id
        series_qs = Activity.objects.filter(
            Q(id=root_id) | Q(recurrence_id=root_id),
            workspace=request.user.workspace,
        ).exclude(status=Activity.Status.CANCELLED)

        if scope == "future":
            series_qs = series_qs.filter(start_at__gte=activity.start_at)

        ids = list(series_qs.values_list("id", flat=True))
        series_qs.update(status="cancelled")

        # Send cancellation email for each cancelled activity
        for aid in ids:
            from tasks.email import send_activity_cancellation_email
            send_activity_cancellation_email.delay(str(aid))

        return Response({"cancelled": len(ids), "scope": scope})

    @action(detail=True, methods=["get"], url_path="email-preview")
    def email_preview(self, request, pk=None):
        """
        GET /api/activities/{id}/email-preview/?type=confirmation|reminder|cancellation
        Returns HTML email preview for the given activity.
        """
        from tasks.email import _logo_url, _fmt_dt_human, _owner_info
        from tasks.email_html import (
            build_confirmation_email, build_reschedule_email, build_reminder_email, build_cancellation_email
        )
        activity   = self.get_object()
        email_type = request.query_params.get("type", "confirmation")
        workspace  = activity.workspace
        coach_name = activity.coach.full_name if activity.coach else workspace.name
        coach_email = activity.coach.email if activity.coach else ""
        dt_human   = _fmt_dt_human(activity.start_at, getattr(workspace, "workspace_timezone", ""))
        owner_email, owner_name = _owner_info(workspace)
        logo_url   = _logo_url(workspace)

        if email_type == "reminder":
            html = build_reminder_email(
                activity=activity, workspace_name=workspace.name,
                logo_url=logo_url, coach_name=coach_name, coach_email=coach_email,
                dt_human=dt_human, time_label="24 hours",
                owner_email=owner_email, owner_name=owner_name,
            )
        elif email_type == "reschedule":
            html = build_reschedule_email(
                activity=activity, workspace_name=workspace.name,
                logo_url=logo_url, coach_name=coach_name, coach_email=coach_email,
                dt_human=dt_human, owner_email=owner_email, owner_name=owner_name,
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
