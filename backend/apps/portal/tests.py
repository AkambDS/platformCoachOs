"""Client portal — logging progress on goals (POST /api/portal/goals/<id>/progress/).

A client may log progress on exactly the goals the portal shows them: their own goals
(created in the portal, always visible) and coach goals that are shared. Prod
2026-11-10: a client's own goal returned 404 because this endpoint required
visible_to_client=True for every goal, which a client-created goal never has.
"""
from datetime import date, timedelta

import pytest

PROGRESS = "/api/portal/goals/{}/progress/"


def _coach_goal(client_record, workspace, coach, shared):
    from apps.clients.models import ClientGoal
    return ClientGoal.objects.create(
        workspace=workspace, client=client_record, created_by=coach, title="Coach goal",
        target_date=date.today() + timedelta(days=30), visible_to_client=shared,
    )


@pytest.mark.django_db
def test_client_can_log_progress_on_own_goal(client_record, workspace, portal_api_client):
    portal = portal_api_client(client_record, workspace)
    res = portal.post("/api/portal/goals/", {
        "title": "Run 5k", "target_date": (date.today() + timedelta(days=60)).isoformat(),
    }, format="json")
    assert res.status_code == 201
    goal_id = res.data["id"]
    # the portal lists it…
    assert goal_id in [g["id"] for g in portal.get("/api/portal/goals/").data["goals"]]
    # …so progress on it must work too
    res = portal.post(PROGRESS.format(goal_id), {"progress_text": "Ran 2k today"}, format="json")
    assert res.status_code == 201


@pytest.mark.django_db
def test_progress_on_shared_coach_goal(client_record, workspace, coach, portal_api_client):
    goal = _coach_goal(client_record, workspace, coach, shared=True)
    res = portal_api_client(client_record, workspace).post(
        PROGRESS.format(goal.id), {"progress_text": "Halfway"}, format="json")
    assert res.status_code == 201


@pytest.mark.django_db
def test_no_progress_on_unshared_coach_goal(client_record, workspace, coach, portal_api_client):
    goal = _coach_goal(client_record, workspace, coach, shared=False)
    res = portal_api_client(client_record, workspace).post(
        PROGRESS.format(goal.id), {"progress_text": "x"}, format="json")
    assert res.status_code == 404


@pytest.mark.django_db
def test_no_progress_on_another_clients_goal(client_record, workspace, coach, portal_api_client):
    from apps.clients.models import Client, ClientGoal
    other = Client.objects.create(workspace=workspace, coach=coach, first_name="O",
                                  last_name="T", email="other@example.com")
    own_goal_of_other = ClientGoal.objects.create(
        workspace=workspace, client=other, created_by=None, title="Theirs",
        target_date=date.today() + timedelta(days=30))
    res = portal_api_client(client_record, workspace).post(
        PROGRESS.format(own_goal_of_other.id), {"progress_text": "x"}, format="json")
    assert res.status_code == 404


# ── Owner/coach are told about, and can see, the client's goal activity ───────────

def _staff_client(user):
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken
    api, refresh = APIClient(), RefreshToken.for_user(user)
    refresh["workspace_id"], refresh["role"] = str(user.workspace_id), user.role
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {str(refresh.access_token)}")
    return api


def _goal_mail(mail):
    return [m for m in mail.outbox if "goal" in m.subject.lower() or "progress" in m.subject.lower()]


@pytest.mark.django_db
def test_owner_and_coach_emailed_when_client_adds_goal_and_logs_progress(
        client_record, workspace, business_owner, coach, portal_api_client):
    from django.core import mail
    portal = portal_api_client(client_record, workspace)
    goal_id = portal.post("/api/portal/goals/", {
        "title": "Run 5k", "target_date": (date.today() + timedelta(days=60)).isoformat(),
    }, format="json").data["id"]
    sent = _goal_mail(mail)
    assert sorted(m.to[0] for m in sent) == ["coach@test.com", "owner@test.com"]
    assert all("added a new goal" in m.subject and "Run 5k" in m.subject for m in sent)
    mail.outbox.clear()

    portal.post(PROGRESS.format(goal_id), {"progress_text": "Ran 2k today"}, format="json")
    sent = _goal_mail(mail)
    assert sorted(m.to[0] for m in sent) == ["coach@test.com", "owner@test.com"]
    assert all("logged progress" in m.subject for m in sent)
    assert all("Ran 2k today" in m.alternatives[0][0] for m in sent)


@pytest.mark.django_db
def test_goal_setting_coach_also_emailed_and_status_changes_notify(
        client_record, workspace, business_owner, coach, portal_api_client):
    from django.core import mail
    from apps.accounts.models import User
    other_coach = User.objects.create_user(email="coach2@test.com", password="x" * 12,
                                           full_name="Second Coach", workspace=workspace, role="coach")
    goal = _coach_goal(client_record, workspace, other_coach, shared=True)
    portal = portal_api_client(client_record, workspace)

    portal.post(PROGRESS.format(goal.id), {"progress_text": "Done half"}, format="json")
    assert sorted(m.to[0] for m in _goal_mail(mail)) == ["coach2@test.com", "coach@test.com", "owner@test.com"]
    mail.outbox.clear()

    portal.patch(f"/api/portal/goals/{goal.id}/", {"status": "completed"}, format="json")
    sent = _goal_mail(mail)
    assert len(sent) == 3 and all("marked a goal complete" in m.subject for m in sent)
    mail.outbox.clear()

    # same status again → nothing changed → no email
    portal.patch(f"/api/portal/goals/{goal.id}/", {"status": "completed"}, format="json")
    assert _goal_mail(mail) == []


@pytest.mark.django_db
def test_client_edit_and_delete_of_own_goal_notify(
        client_record, workspace, business_owner, coach, portal_api_client):
    from django.core import mail
    portal = portal_api_client(client_record, workspace)
    target = (date.today() + timedelta(days=60)).isoformat()
    goal_id = portal.post("/api/portal/goals/", {"title": "Read", "target_date": target}, format="json").data["id"]
    mail.outbox.clear()

    portal.patch(f"/api/portal/goals/{goal_id}/", {"title": "Read 12 books", "target_date": target}, format="json")
    assert all("updated a goal" in m.subject for m in _goal_mail(mail)) and len(_goal_mail(mail)) == 2
    mail.outbox.clear()

    portal.delete(f"/api/portal/goals/{goal_id}/")
    sent = _goal_mail(mail)
    assert len(sent) == 2 and all("deleted a goal" in m.subject and "Read 12 books" in m.subject for m in sent)


@pytest.mark.django_db
def test_platform_admin_and_other_workspaces_never_emailed(
        client_record, workspace, business_owner, coach, portal_api_client):
    from django.core import mail
    from apps.accounts.models import User, Workspace
    other_ws = Workspace.objects.create(name="Other", slug="other-ws-goals")
    outsider = User.objects.create_user(email="outsider@test.com", password="x" * 12,
                                        full_name="Outsider", workspace=other_ws, role="coach")
    goal = _coach_goal(client_record, workspace, outsider, shared=True)   # bad cross-workspace link
    portal_api_client(client_record, workspace).post(PROGRESS.format(goal.id), {"progress_text": "x"}, format="json")
    assert "outsider@test.com" not in [m.to[0] for m in _goal_mail(mail)]


@pytest.mark.django_db
def test_owner_and_coach_see_client_progress(client_record, workspace, business_owner, coach, portal_api_client):
    portal = portal_api_client(client_record, workspace)
    own_id = portal.post("/api/portal/goals/", {
        "title": "Own goal", "target_date": (date.today() + timedelta(days=60)).isoformat(),
    }, format="json").data["id"]
    shared = _coach_goal(client_record, workspace, coach, shared=True)
    portal.post(PROGRESS.format(own_id), {"progress_text": "own progress"}, format="json")
    portal.post(PROGRESS.format(shared.id), {"progress_text": "shared progress"}, format="json")

    for user in (business_owner, coach):
        body = _staff_client(user).get(f"/api/clients/{client_record.id}/goals/").json()
        goals = {g["id"]: g for g in (body["results"] if isinstance(body, dict) else body)}
        assert [p["progress_text"] for p in goals[own_id]["progress_entries"]] == ["own progress"]
        assert [p["progress_text"] for p in goals[str(shared.id)]["progress_entries"]] == ["shared progress"]
        assert goals[own_id]["client_owned"] is True
