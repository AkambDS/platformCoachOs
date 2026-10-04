import re
from datetime import datetime
from zoneinfo import ZoneInfo

from django.db import IntegrityError
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from .models import Activity
from .serializers import ActivitySerializer
from apps.accounts.permissions import IsAssistantOrAbove, require_tab

# Raised by Postgres when a write would violate the "no overlapping bookings for the
# same coach" exclusion constraint (calendar.md §7.5/§9.2 Task 1,
# activity_no_overlapping_coach_bookings in models.py) — the hard backstop underneath
# every application-level availability/conflict check in this app. Every write path
# below that can move start_at/end_at catches this specific DB error and turns it into
# a clear 400 instead of a raw 500, since this constraint can legitimately fire under
# normal use (two people racing for the same slot), not just as a bug condition.
_OVERLAP_CONSTRAINT = "activity_no_overlapping_coach_bookings"

# Postgres's error DETAIL names the row it collided with, e.g.
#   ... conflicts with existing key (tstzrange(start_at, end_at), coach_id)=(["2026-10-05 15:00:00+00","2026-10-05 16:15:00+00"), <uuid>).
# Parsing it (rather than re-querying from the request's own start/end) also pins down
# the right row when the clash comes from a recurring-series occurrence, not the one
# being edited.
_EXISTING_KEY_RE = re.compile(
    r'conflicts with existing key \(.*?\)=\(\["([^"]+)","([^"]+)"\), ([0-9a-f-]{36})\)'
)


def _describe_conflict(exc: IntegrityError) -> str:
    """Best-effort "'call' with Jane Doe, Mon, Oct 5, 11:00 AM – 12:15 PM" for the
    existing session that blocked the write; "" if it can't be identified."""
    match = _EXISTING_KEY_RE.search(str(exc))
    if not match:
        return ""
    start_raw, end_raw, coach_id = match.groups()
    try:
        start = datetime.fromisoformat(start_raw.replace("+00", "+00:00"))
        end   = datetime.fromisoformat(end_raw.replace("+00", "+00:00"))
        other = (Activity.objects.select_related("client", "coach")
                 .filter(coach_id=coach_id, start_at=start, end_at=end,
                         status__in=["scheduled", "rescheduled"])
                 .first())
        tz = ZoneInfo((other.coach.user_timezone if other and other.coach else None) or "America/New_York")
    except Exception:
        return ""
    s, e = start.astimezone(tz), end.astimezone(tz)
    clock = lambda d: f"{d:%I:%M %p}".lstrip("0")
    when = f"{s:%a, %b} {s.day}, {clock(s)} – {clock(e)}"
    if not other:
        return when
    who = f" with {other.client.full_name}" if other.client else ""
    return f"'{other.title}'{who}, {when}"


def _reraise_if_overlap(exc: IntegrityError):
    """Convert the DB's overlap-constraint violation into a clean 400; re-raise
    anything else unchanged so a genuinely unexpected IntegrityError still surfaces
    as a 500 + ErrorLog entry rather than being silently mislabeled."""
    if _OVERLAP_CONSTRAINT in str(exc):
        conflict = _describe_conflict(exc)
        if conflict:
            msg = f"That time overlaps {conflict}, already on this coach's calendar. Please pick a different time."
        else:
            msg = "That time overlaps another session already on this coach's calendar. Please pick a different time."
        raise ValidationError({"detail": msg})
    raise exc


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
    filterset_fields   = ["activity_type", "status", "client", "coach", "affiliation"]

    def get_permissions(self):
        if self.action == "destroy":
            return [IsAssistantOrAbove(), require_tab("activities", "delete")()]
        if self.action in ("create", "update", "partial_update", "mark_missed", "cancel", "confirm_reschedule", "decline_reschedule"):
            return [IsAssistantOrAbove(), require_tab("activities", "edit")()]
        return [IsAssistantOrAbove(), require_tab("activities", "view")()]

    def get_queryset(self):
        user = self.request.user
        qs = Activity.objects.filter(workspace=user.workspace) \
                             .select_related("client", "coach", "affiliation")
        if user.role != "business_owner":
            # Scope to activities this person is actually assigned to run — not every
            # activity belonging to a client who happens to be nominally "theirs".
            # A client can have activities run by more than one coach over time; using
            # client__coach here would leak other coaches' sessions for a shared client.
            qs = qs.filter(coach=user)
        # Calendar range filter
        start = self.request.query_params.get("start")
        end   = self.request.query_params.get("end")
        if start: qs = qs.filter(start_at__gte=start)
        if end:   qs = qs.filter(start_at__lte=end)
        # Upcoming queries need ascending order; default model ordering is -start_at
        if start and not end:
            qs = qs.order_by("start_at")
        return qs

    def perform_create(self, serializer):
        try:
            serializer.save()
        except IntegrityError as exc:
            _reraise_if_overlap(exc)

    def perform_update(self, serializer):
        instance = serializer.instance
        # When a coach edits a rescheduled session without explicitly setting status,
        # reset it to "scheduled" so it no longer shows as pending reschedule
        data = serializer.validated_data
        if instance.status == "rescheduled" and "status" not in data:
            data["status"] = "scheduled"
        # A pending client-proposed time (requested_start_at) must only be cleared by
        # explicitly confirming it (confirm_reschedule, below) or by the coach setting
        # a new time here themselves — not as a side effect of editing something
        # unrelated (title, notes, ...). Previously this status reset fired regardless,
        # which silently flipped status back to "scheduled" while leaving
        # requested_start_at populated — the pending request kept existing in the data
        # but stopped being visible anywhere, since the "Pending" badge/banner keyed off
        # status=="rescheduled" too.
        if instance.requested_start_at and ("start_at" in data or "end_at" in data):
            data["requested_start_at"] = None
            data["requested_at"] = None
        try:
            serializer.save(**data)
        except IntegrityError as exc:
            _reraise_if_overlap(exc)

    def perform_destroy(self, instance):
        from tasks.calendar import sync_to_google_calendar
        sync_to_google_calendar.delay(str(instance.id), "delete")
        instance.delete()

    @action(detail=True, methods=["post"], url_path="missed")
    def mark_missed(self, request, pk=None):
        activity = self.get_object()
        activity.mark_missed(request.user)
        return Response(ActivitySerializer(activity).data)

    @action(detail=True, methods=["post"], url_path="confirm-reschedule")
    def confirm_reschedule(self, request, pk=None):
        """POST /api/activities/{id}/confirm-reschedule/ — apply a client's requested
        new time (picked from the coach's availability on the public reschedule page,
        see apps.activities.public_views.SessionRescheduleView) to the real schedule.
        Until this fires, requested_start_at is only a proposal — Google Calendar,
        reminders, and the client's confirmed time all still reflect the old slot."""
        activity = self.get_object()
        if not activity.requested_start_at:
            return Response({"detail": "No pending reschedule request for this session."},
                             status=status.HTTP_400_BAD_REQUEST)

        duration = activity.end_at - activity.start_at
        old_start, old_end = activity.start_at, activity.end_at
        old_coach = activity.coach
        new_start = activity.requested_start_at
        new_end   = activity.requested_start_at + duration

        # Re-validate against the client's CURRENT availability rules before applying
        # anything — the proposal could have gone stale between when the client picked
        # it and now (the coach may have edited or removed that window since). This is
        # a hard block, not a warning (calendar.md §7.1/§9.2 Task 3): nothing is
        # touched if it fails, so the coach can either restore the availability window
        # or use Edit to set a different time manually.
        from .availability import is_within_availability
        check_coach = (activity.client.coach if activity.client else None) or activity.coach
        if not is_within_availability(check_coach, activity.client, activity.workspace, new_start, new_end):
            return Response(
                {"detail": "This time is no longer in your available hours for this client. "
                           "Update your availability for them, or use Edit to set a different time."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        activity.start_at = new_start
        activity.end_at   = new_end
        activity.requested_start_at = None
        activity.requested_at = None
        activity.status = Activity.Status.SCHEDULED
        # The slot was computed against the client's CURRENT coach's availability (see
        # apps.activities.availability.compute_available_slots) — if that's not who was
        # on this Activity already (e.g. the client was reassigned since this session
        # was booked), reassign it here too, so the session actually lands on the
        # coach whose hours and calendar it was just checked against.
        if activity.client and activity.client.coach:
            activity.coach = activity.client.coach
        # The old reminder flags are either already True (so a reminder for the new
        # time would never fire) or, worse, still pending against the OLD time — reset
        # both so reminders fire correctly relative to the confirmed new slot.
        activity.reminder_24h_sent    = False
        activity.reminder_1h_sent     = False
        activity.reminder_24h_sent_at = None
        activity.reminder_1h_sent_at  = None
        diff = {
            "start_at": [old_start.isoformat(), activity.start_at.isoformat()],
            "end_at":   [old_end.isoformat(), activity.end_at.isoformat()],
        }
        coach_reassigned = activity.coach_id != (old_coach.id if old_coach else None)
        if coach_reassigned:
            diff["coach"] = [str(old_coach.id) if old_coach else None, str(activity.coach_id)]
            # google_cal_uid (if set) is an event id on the OLD coach's calendar — updating
            # it under the new coach would hit a 404 (wrong calendar, wrong id). Clear it so
            # the sync below creates a fresh event on the new coach's calendar instead. The
            # stale event left behind on the old coach's calendar isn't cleaned up here —
            # a cosmetic leftover, not a functional break, and reassignment-driven calendar
            # cleanup is a pre-existing gap in this codebase, not something new to this flow.
            activity.google_cal_uid = ""
        activity._append_edit(request.user, diff)
        try:
            activity.save()
        except IntegrityError as exc:
            _reraise_if_overlap(exc)

        try:
            from tasks.calendar import sync_to_google_calendar
            sync_to_google_calendar.delay(str(activity.id), "create" if coach_reassigned else "update")
        except Exception:
            pass

        if activity.client.email:
            from tasks.email import send_activity_reschedule_email
            send_activity_reschedule_email.delay(str(activity.id))

        return Response(ActivitySerializer(activity).data)

    @action(detail=True, methods=["post"], url_path="decline-reschedule")
    def decline_reschedule(self, request, pk=None):
        """POST /api/activities/{id}/decline-reschedule/ — release a pending client
        proposal without applying it: clears requested_start_at only, start_at/end_at/
        status are untouched (mirrors confirm_reschedule's shape, opposite effect).
        Unlike Confirm, there's no fixed email — the coach optionally writes their own
        message and explicitly opts into sending it (calendar.md §7.3/§9.2 Task 4);
        declining is not assumed to need a notification the way confirming always does.
        """
        activity = self.get_object()
        if not activity.requested_start_at:
            return Response({"detail": "No pending reschedule request for this session."},
                             status=status.HTTP_400_BAD_REQUEST)

        old_requested = activity.requested_start_at
        activity.requested_start_at = None
        activity.requested_at = None
        activity._append_edit(request.user, {
            "requested_start_at": [old_requested.isoformat(), None],
        })
        activity.save(update_fields=["requested_start_at", "requested_at", "edit_history", "updated_at"])

        message    = (request.data.get("message") or "").strip()
        send_email = bool(request.data.get("send_email")) and bool(message)
        if send_email and activity.client.email:
            from tasks.email import send_decline_reschedule_email
            send_decline_reschedule_email.delay(str(activity.id), message)

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
