import threading
import datetime
from dateutil.relativedelta import relativedelta
from rest_framework import serializers
from .models import Activity

_REPEAT_DELTA = {
    'daily':    relativedelta(days=1),
    'weekly':   relativedelta(weeks=1),
    'biweekly': relativedelta(weeks=2),
    'monthly':  relativedelta(months=1),
    'yearly':   relativedelta(years=1),
}
_RRULE_MAP = {
    'daily':    'FREQ=DAILY',
    'weekly':   'FREQ=WEEKLY',
    'biweekly': 'FREQ=WEEKLY;INTERVAL=2',
    'monthly':  'FREQ=MONTHLY',
    'yearly':   'FREQ=YEARLY',
}

def _parse_rrule(rrule_str: str):
    """Return the repeat key for a stored RRULE string, or None if none."""
    if not rrule_str:
        return None
    if 'INTERVAL=2' in rrule_str:
        return 'biweekly'
    if 'FREQ=DAILY' in rrule_str:
        return 'daily'
    if 'FREQ=WEEKLY' in rrule_str:
        return 'weekly'
    if 'FREQ=MONTHLY' in rrule_str:
        return 'monthly'
    if 'FREQ=YEARLY' in rrule_str:
        return 'yearly'
    return None


def _generate_series(parent: Activity, repeat: str, repeat_until):
    """Bulk-create recurring child activities linked to parent."""
    delta      = _REPEAT_DELTA[repeat]
    rrule_str  = _RRULE_MAP[repeat]
    duration   = (parent.end_at - parent.start_at) if parent.end_at else None

    # Store rrule and repeat_until on parent, mark it as its own series root
    Activity.objects.filter(pk=parent.pk).update(
        rrule=rrule_str, recurrence_id=parent.pk, repeat_until=repeat_until or None
    )

    if repeat_until:
        end_date = (repeat_until if isinstance(repeat_until, datetime.date)
                    else datetime.date.fromisoformat(str(repeat_until)))
    else:
        end_date = parent.start_at.date() + relativedelta(years=1)

    to_create   = []
    current_start = parent.start_at + delta
    while current_start.date() <= end_date:
        to_create.append(Activity(
            workspace     = parent.workspace,
            coach         = parent.coach,
            client        = parent.client,
            activity_type = parent.activity_type,
            title         = parent.title,
            status        = Activity.Status.SCHEDULED,
            start_at      = current_start,
            end_at        = (current_start + duration) if duration else None,
            location      = parent.location,
            notes         = parent.notes,
            deal          = parent.deal,
            affiliation   = parent.affiliation,
            rrule         = rrule_str,
            recurrence_id = parent.pk,
        ))
        current_start = current_start + delta

    Activity.objects.bulk_create(to_create)


def _fire(fn, *args):
    """Run fn(*args) in a daemon thread — works with or without a Celery worker."""
    threading.Thread(target=fn, args=args, daemon=True).start()


class ActivitySerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source="client.full_name", read_only=True)
    coach_name  = serializers.CharField(source="coach.full_name",  read_only=True)
    affiliation_name  = serializers.CharField(source="affiliation.name",  read_only=True, default="")
    affiliation_color = serializers.CharField(source="affiliation.color", read_only=True, default="")
    # Frontend passes send_confirmation=false to suppress confirmation email
    send_confirmation = serializers.BooleanField(write_only=True, required=False, default=True)
    # Frontend passes send_update=false to suppress reschedule email on edit
    send_update = serializers.BooleanField(write_only=True, required=False, default=True)
    # Recurrence
    repeat       = serializers.ChoiceField(
        choices=['none', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly'],
        write_only=True, required=False, allow_null=True,
    )
    repeat_until = serializers.DateField(required=False, allow_null=True)
    # Series edit scope
    edit_scope   = serializers.ChoiceField(
        choices=['this', 'all'],
        write_only=True, required=False, allow_null=True,
    )

    class Meta:
        model  = Activity
        fields = ["id", "activity_type", "title", "status", "start_at", "end_at",
                  "location", "meeting_link", "notes", "rrule", "recurrence_id",
                  "google_cal_uid", "client", "client_name", "coach", "coach_name",
                  "deal", "affiliation", "affiliation_name", "affiliation_color",
                  "edit_history", "created_at", "send_confirmation", "send_update",
                  "email_template_id",
                  "repeat", "repeat_until", "edit_scope",
                  "confirmation_sent_at", "cancellation_sent_at",
                  "reminder_24h_sent", "reminder_24h_sent_at",
                  "reminder_1h_sent",  "reminder_1h_sent_at",
                  "client_confirmed",  "client_confirmed_at",
                  "client_rsvp_status", "client_rsvp_synced_at"]
        read_only_fields = ["id", "google_cal_uid", "caldav_uid", "edit_history", "created_at",
                            "confirmation_sent_at", "cancellation_sent_at",
                            "reminder_24h_sent", "reminder_24h_sent_at",
                            "reminder_1h_sent",  "reminder_1h_sent_at",
                            "client_confirmed",  "client_confirmed_at",
                            "client_rsvp_status", "client_rsvp_synced_at"]

    def create(self, validated_data):
        request = self.context["request"]
        send_confirmation = validated_data.pop("send_confirmation", True)
        validated_data.pop("send_update", None)
        repeat       = validated_data.pop("repeat", None) or None
        repeat_until = validated_data.pop("repeat_until", None)
        validated_data.pop("edit_scope", None)
        validated_data["workspace"] = request.user.workspace
        if not validated_data.get("coach"):
            client = validated_data.get("client")
            validated_data["coach"] = (
                client.coach if client and client.coach else request.user
            )
        activity = super().create(validated_data)

        if repeat and repeat != "none" and repeat in _REPEAT_DELTA:
            _generate_series(activity, repeat, repeat_until)

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
        from django.db.models import Q
        request = self.context["request"]
        validated_data.pop("send_confirmation", None)
        send_update  = validated_data.pop("send_update", True)
        edit_scope   = validated_data.pop("edit_scope", "this") or "this"
        repeat       = validated_data.pop("repeat", None)        # None = not changed
        repeat_until = validated_data.pop("repeat_until", None)
        # Fields safe to broadcast across all events in a series
        propagatable = {k: validated_data[k] for k in ("title", "activity_type", "location", "notes", "affiliation") if k in validated_data}

        # Detect cancellation before saving
        new_status = validated_data.get("status")
        was_scheduled = instance.status == Activity.Status.SCHEDULED
        being_cancelled = new_status == Activity.Status.CANCELLED and was_scheduled

        # Detect scheduling changes that warrant a reschedule email.
        # Use try/except because comparing tz-aware (DB) vs tz-naive (submitted) datetimes
        # raises TypeError — treat that as "changed" so the email still fires.
        scheduling_fields = {"start_at", "end_at", "title", "location"}
        scheduling_changed = False
        for k, v in validated_data.items():
            if k not in scheduling_fields:
                continue
            try:
                if getattr(instance, k) != v:
                    scheduling_changed = True
                    break
            except TypeError:
                scheduling_changed = True
                break

        # Record edit history — values must be JSON-safe (datetimes/UUIDs → strings)
        def _json_safe(val):
            import datetime, uuid
            if isinstance(val, (datetime.datetime, datetime.date)):
                return val.isoformat()
            if isinstance(val, uuid.UUID):
                return str(val)
            return val

        diff = {}
        for k, v in validated_data.items():
            try:
                old = getattr(instance, k)
                changed = old != v
            except TypeError:
                changed = True
                old = getattr(instance, k)
            if changed:
                diff[k] = [_json_safe(old), _json_safe(v)]
        if diff:
            instance._append_edit(request.user, diff)

        activity = super().update(instance, validated_data)

        # ── Series handling ───────────────────────────────────────────────────
        series_root_id = activity.recurrence_id

        if edit_scope == "all" and series_root_id:
            # Propagate shared fields to every other event in the series
            if propagatable:
                Activity.objects.filter(
                    Q(id=series_root_id) | Q(recurrence_id=series_root_id)
                ).exclude(pk=activity.pk).update(**propagatable)

            if repeat is not None:
                if repeat == "none":
                    # Stop the series: delete future occurrences, detach root
                    Activity.objects.filter(
                        recurrence_id=series_root_id,
                        start_at__gt=activity.start_at,
                    ).delete()
                    Activity.objects.filter(pk=series_root_id).update(recurrence_id=None, rrule="")
                    activity.recurrence_id = None
                    activity.rrule = ""
                elif repeat in _REPEAT_DELTA and repeat != _parse_rrule(activity.rrule):
                    # Repeat pattern changed — find root, wipe children, regenerate
                    try:
                        root = (activity if str(activity.pk) == str(series_root_id)
                                else Activity.objects.get(pk=series_root_id, workspace=activity.workspace))
                    except Activity.DoesNotExist:
                        root = activity
                    Activity.objects.filter(recurrence_id=root.pk).exclude(pk=root.pk).delete()
                    _generate_series(root, repeat, repeat_until)

        elif repeat and repeat != "none" and repeat in _REPEAT_DELTA and not series_root_id:
            # Standalone activity → start a new recurring series from it
            _generate_series(activity, repeat, repeat_until)

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
