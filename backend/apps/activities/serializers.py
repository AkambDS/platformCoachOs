from rest_framework import serializers
from .models import Activity


class ActivitySerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source="client.full_name", read_only=True)
    coach_name  = serializers.CharField(source="coach.full_name",  read_only=True)

    class Meta:
        model  = Activity
        fields = ["id", "activity_type", "title", "status", "start_at", "end_at",
                  "location", "notes", "rrule", "recurrence_id",
                  "google_cal_uid", "client", "client_name", "coach", "coach_name",
                  "deal", "edit_history", "created_at"]
        read_only_fields = ["id", "google_cal_uid", "caldav_uid", "edit_history", "created_at"]

    def create(self, validated_data):
        request = self.context["request"]
        validated_data["workspace"] = request.user.workspace
        validated_data.setdefault("coach", request.user)
        activity = super().create(validated_data)
        # Trigger Google Calendar sync
        from tasks.calendar import sync_to_google_calendar
        sync_to_google_calendar.delay(str(activity.id), "create")
        return activity

    def update(self, instance, validated_data):
        # Record edit history before saving (FR-ACT-15)
        request = self.context["request"]
        diff = {k: [getattr(instance, k), v]
                for k, v in validated_data.items()
                if getattr(instance, k) != v}
        if diff:
            instance._append_edit(request.user, diff)

        activity = super().update(instance, validated_data)
        from tasks.calendar import sync_to_google_calendar
        sync_to_google_calendar.delay(str(activity.id), "update")
        return activity
