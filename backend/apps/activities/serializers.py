import threading
from rest_framework import serializers
from .models import Activity


def _fire(fn, *args):
    """Run fn(*args) in a daemon thread — works with or without a Celery worker."""
    threading.Thread(target=fn, args=args, daemon=True).start()


class ActivitySerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source="client.full_name", read_only=True)
    coach_name  = serializers.CharField(source="coach.full_name",  read_only=True)
    # Frontend passes send_confirmation=false to suppress confirmation email
    send_confirmation = serializers.BooleanField(write_only=True, required=False, default=True)
    # Frontend passes send_update=false to suppress reschedule email on edit
    send_update = serializers.BooleanField(write_only=True, required=False, default=True)

    class Meta:
        model  = Activity
        fields = ["id", "activity_type", "title", "status", "start_at", "end_at",
                  "location", "notes", "rrule", "recurrence_id",
                  "google_cal_uid", "client", "client_name", "coach", "coach_name",
                  "deal", "edit_history", "created_at", "send_confirmation", "send_update",
                  "confirmation_sent_at", "cancellation_sent_at",
                  "reminder_24h_sent", "reminder_24h_sent_at",
                  "reminder_1h_sent",  "reminder_1h_sent_at"]
        read_only_fields = ["id", "google_cal_uid", "caldav_uid", "edit_history", "created_at",
                            "confirmation_sent_at", "cancellation_sent_at",
                            "reminder_24h_sent", "reminder_24h_sent_at",
                            "reminder_1h_sent",  "reminder_1h_sent_at"]

    def create(self, validated_data):
        request = self.context["request"]
        send_confirmation = validated_data.pop("send_confirmation", True)
        validated_data["workspace"] = request.user.workspace
        validated_data.setdefault("coach", request.user)
        activity = super().create(validated_data)

        # Google Calendar sync (Celery task — optional, fire-and-forget)
        try:
            from tasks.calendar import sync_to_google_calendar
            sync_to_google_calendar.delay(str(activity.id), "create")
        except Exception:
            pass

        # Client confirmation email with .ics invite — fire in background thread
        if send_confirmation and activity.client.email:
            from tasks.email import send_activity_confirmation_email
            _fire(send_activity_confirmation_email, str(activity.id))

        return activity

    def update(self, instance, validated_data):
        request = self.context["request"]
        validated_data.pop("send_confirmation", None)
        send_update = validated_data.pop("send_update", True)

        # Detect cancellation before saving
        new_status = validated_data.get("status")
        was_scheduled = instance.status == Activity.Status.SCHEDULED
        being_cancelled = new_status == Activity.Status.CANCELLED and was_scheduled

        # Detect scheduling changes that warrant a reschedule email
        scheduling_fields = {"start_at", "end_at", "title", "location"}
        scheduling_changed = any(
            k in scheduling_fields and getattr(instance, k) != v
            for k, v in validated_data.items()
        )

        # Record edit history
        diff = {k: [getattr(instance, k), v]
                for k, v in validated_data.items()
                if getattr(instance, k) != v}
        if diff:
            instance._append_edit(request.user, diff)

        activity = super().update(instance, validated_data)

        # Google Calendar sync
        try:
            from tasks.calendar import sync_to_google_calendar
            sync_to_google_calendar.delay(str(activity.id), "update")
        except Exception:
            pass

        # Cancellation email — fire in background thread
        if being_cancelled and activity.client.email:
            from tasks.email import send_activity_cancellation_email
            _fire(send_activity_cancellation_email, str(activity.id))
        # Reschedule/update notification email
        elif send_update and scheduling_changed and was_scheduled and activity.client.email:
            from tasks.email import send_activity_reschedule_email
            _fire(send_activity_reschedule_email, str(activity.id))

        return activity
