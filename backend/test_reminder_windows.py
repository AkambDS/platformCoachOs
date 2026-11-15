"""
Session reminders: 24h only (settings.SESSION_REMINDER_HOURS = [24]). The 1h reminder is
switched off for every workspace; re-enabling it is a settings change only.

Run: pytest test_reminder_windows.py -v
"""
from datetime import timedelta
from unittest import mock

import pytest
from django.utils import timezone

from test_tenant_isolation import _make_workspace, _no_side_effects  # noqa: F401  (autouse fixture)


def _session(ws, coach, client, starts_in, **kw):
    from apps.activities.models import Activity
    start = timezone.now() + starts_in
    return Activity.objects.create(workspace=ws, coach=coach, client=client, title="s", activity_type="call",
                                   start_at=start, end_at=start + timedelta(hours=1), **kw)


@pytest.mark.django_db
def test_only_24h_reminder_fires(settings):
    from django.core.cache import cache
    from tasks.reminders import dispatch_activity_reminders
    settings.SESSION_REMINDER_HOURS = [24]
    cache.clear()
    ws, _, coach, _, client, _ = _make_workspace("rm")
    soon  = _session(ws, coach, client, timedelta(minutes=30), reminder_24h_sent=True)  # 1h slot open
    later = _session(ws, coach, client, timedelta(hours=20))                              # 24h slot open

    with mock.patch("tasks.email.send_activity_reminder_email.delay") as email, \
         mock.patch("tasks.sms.send_session_reminder.delay"):
        dispatch_activity_reminders()

    assert [c.args for c in email.call_args_list] == [(str(later.id), 24)]   # no 1h send for `soon`
    soon.refresh_from_db(); later.refresh_from_db()
    assert soon.reminder_1h_sent is False
    assert later.reminder_24h_sent is True


@pytest.mark.django_db
def test_1h_comes_back_when_re_enabled(settings):
    from django.core.cache import cache
    from tasks.reminders import dispatch_activity_reminders
    settings.SESSION_REMINDER_HOURS = [24, 1]
    cache.clear()
    ws, _, coach, _, client, _ = _make_workspace("rn")
    soon = _session(ws, coach, client, timedelta(minutes=30), reminder_24h_sent=True)
    with mock.patch("tasks.email.send_activity_reminder_email.delay") as email, \
         mock.patch("tasks.sms.send_session_reminder.delay"):
        dispatch_activity_reminders()
    assert [c.args for c in email.call_args_list] == [(str(soon.id), 1)]
