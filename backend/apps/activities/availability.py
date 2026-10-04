"""CoachOS — coach availability → bookable slot computation.

Used by the public reschedule page (apps.activities.public_views.SessionRescheduleView)
to offer a client real open times instead of a free-text box. See
CoachAvailabilityRule's docstring in models.py for the per-client-window /
coach-wide-conflict design this implements.
"""
from datetime import datetime, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.utils import timezone

AVAILABILITY_WINDOW_DAYS = 30

# Candidate slot start times advance in fixed 15-minute steps from the block's own
# start_time, independent of the session's own duration. Without this, consecutive
# slots were spaced by `duration` (the original session's length) instead — a session
# booked with an odd historical duration (e.g. 2h36m) made every slot after the first
# land on an ugly, non-round minute (9:00, 11:36, 14:12, ...) since each one simply
# started where the previous one ended. Stepping by a fixed round increment keeps every
# offered start time clean regardless of how odd the session's own duration is, at the
# cost of offered slots now being able to overlap each other (e.g. a 1h session offered
# at 9:00, 9:15, 9:30, ...) — standard behavior for this kind of picker (Calendly does
# the same), and the busy-conflict check below already excludes any candidate that
# would actually overlap a real booking, so this can't double-book anything.
SLOT_STEP_MINUTES = 15

# Matches Activity.Status values that represent a real, calendar-occupying booking —
# a cancelled/missed/completed session shouldn't block a slot.
_BUSY_STATUSES = ["scheduled", "rescheduled"]


def _workspace_zoneinfo(workspace) -> ZoneInfo:
    tz_name = getattr(workspace, "workspace_timezone", "") or "UTC"
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, Exception):
        return ZoneInfo("UTC")


def compute_available_slots(activity, *, now=None):
    """Return a list of (start, end) aware UTC datetime tuples the client can pick from
    to reschedule `activity`, sized to match its own existing duration.

    Availability window (which times are even offered) is specific to this coach+client
    pair (CoachAvailabilityRule). Conflict exclusion (which of those times are already
    taken) is coach-wide — checked against every one of the coach's other activities,
    not just this client's — since the coach can't be double-booked regardless of whose
    availability rule the slot came from.

    The busy set checked against is the union of two things (calendar.md §6.2/§9.2
    Task 2): every other activity's CONFIRMED [start_at, end_at), and every other
    activity's still-open PENDING [requested_start_at, requested_start_at + its own
    duration) — a time another client has already proposed and the coach hasn't acted
    on yet. Without the second half, two different clients could both be offered, and
    both propose, the exact same time, right up until the coach confirms one of them —
    only an actually-confirmed booking used to block anything.
    """
    from .models import Activity, CoachAvailabilityRule

    client = activity.client
    # The client's CURRENT coach, not whichever coach happened to be on this specific
    # (possibly old) Activity record — if the client was reassigned since this session
    # was booked, rescheduling should offer their current coach's open hours and check
    # conflicts against that coach's calendar, not a coach they're no longer working
    # with. Falls back to the activity's own coach only if the client has none assigned.
    coach = (client.coach if client else None) or activity.coach
    if not coach or not client:
        return []

    duration = activity.end_at - activity.start_at
    if duration.total_seconds() <= 0:
        duration = timedelta(hours=1)

    rules = list(CoachAvailabilityRule.objects.filter(coach=coach, client=client))
    if not rules:
        return []

    now = now or timezone.now()
    horizon = now + timedelta(days=AVAILABILITY_WINDOW_DAYS)
    tz = _workspace_zoneinfo(activity.workspace)

    # Coach-wide busy set — every other live booking for this coach in the window,
    # regardless of which client it's with.
    busy = list(
        Activity.objects.filter(
            coach=coach,
            status__in=_BUSY_STATUSES,
            start_at__lt=horizon,
            end_at__gt=now,
        ).exclude(pk=activity.pk).values_list("start_at", "end_at")
    )

    # Every other activity for this coach with a still-open pending proposal — excludes
    # dead sessions (cancelled/completed/missed) explicitly, since nothing today clears
    # requested_start_at when a session with a pending request gets cancelled; without
    # this exclusion a cancelled session's stale proposal would block a slot forever.
    pending_rows = (
        Activity.objects.filter(coach=coach, requested_start_at__isnull=False)
        .exclude(pk=activity.pk)
        .exclude(status__in=["cancelled", "completed", "missed"])
        .values_list("requested_start_at", "start_at", "end_at")
    )
    for req_start, orig_start, orig_end in pending_rows:
        req_end = req_start + (orig_end - orig_start)
        if req_start < horizon and req_end > now:
            busy.append((req_start, req_end))

    def overlaps_busy(slot_start, slot_end):
        return any(slot_start < b_end and slot_end > b_start for b_start, b_end in busy)

    rules_by_weekday: dict[int, list] = {}
    for r in rules:
        rules_by_weekday.setdefault(r.weekday, []).append(r)

    slots = []
    day = now.astimezone(tz).date()
    end_day = horizon.astimezone(tz).date()
    while day <= end_day:
        for rule in rules_by_weekday.get(day.weekday(), []):
            block_start = datetime.combine(day, rule.start_time, tzinfo=tz)
            block_end   = datetime.combine(day, rule.end_time, tzinfo=tz)
            slot_start = block_start
            step = timedelta(minutes=SLOT_STEP_MINUTES)
            while slot_start + duration <= block_end:
                slot_end = slot_start + duration
                slot_start_utc = slot_start.astimezone(dt_timezone.utc)
                slot_end_utc   = slot_end.astimezone(dt_timezone.utc)
                if slot_start_utc > now and not overlaps_busy(slot_start_utc, slot_end_utc):
                    slots.append((slot_start_utc, slot_end_utc))
                slot_start = slot_start + step
        day += timedelta(days=1)

    return slots


def is_within_availability(coach, client, workspace, start_utc, end_utc) -> bool:
    """True if [start_utc, end_utc) falls entirely inside one of (coach, client)'s
    current CoachAvailabilityRule windows. Used by confirm_reschedule to re-validate a
    proposed time hasn't gone stale between when it was offered and when the coach
    actually confirms it (calendar.md §7.1/§9.2 Task 3) — the rules themselves could
    have been edited or deleted in that gap. Deliberately a separate, narrower check
    from compute_available_slots: this only asks "does this one specific time still
    fit?", not "what are all the open times?", and it does NOT consider the coach-wide
    busy set — a stale-availability rejection and a slot-just-got-taken rejection are
    different failure reasons, so Task 3 and the exclusion constraint (Task 1) each
    guard against their own case rather than this function trying to do both.
    """
    from .models import CoachAvailabilityRule

    if not coach or not client:
        return False
    tz = _workspace_zoneinfo(workspace)
    local_start = start_utc.astimezone(tz)
    local_end   = end_utc.astimezone(tz)
    if local_start.date() != local_end.date():
        return False  # rules are same-day blocks only, same assumption as compute_available_slots
    for rule in CoachAvailabilityRule.objects.filter(coach=coach, client=client, weekday=local_start.weekday()):
        block_start = datetime.combine(local_start.date(), rule.start_time, tzinfo=tz)
        block_end   = datetime.combine(local_start.date(), rule.end_time, tzinfo=tz)
        if block_start <= local_start and local_end <= block_end:
            return True
    return False
