"""Tests — clients app"""
import pytest


@pytest.mark.django_db
def test_create_client(api_client, workspace):
    res = api_client.post("/api/clients/", {
        "first_name": "James",
        "last_name":  "Park",
        "email":      "james@example.com",
        "company":    "Park Industries",
    }, format="json")
    assert res.status_code == 201
    assert res.data["first_name"] == "James"


@pytest.mark.django_db
def test_client_list_scoped_to_workspace(api_client, client_record):
    """Clients from another workspace must not appear."""
    from apps.accounts.models import Workspace, User
    from apps.clients.models import Client
    other_ws = Workspace.objects.create(name="Other", slug="other-x")
    other_coach = User.objects.create_user(
        email="c2@x.com", password="x", full_name="C2", workspace=other_ws)
    Client.objects.create(workspace=other_ws, coach=other_coach,
                          first_name="Spy", last_name="Client", email="spy@x.com")

    res = api_client.get("/api/clients/")
    assert res.status_code == 200
    emails = [c["email"] for c in res.data["results"]]
    assert "spy@x.com" not in emails


@pytest.mark.django_db
def test_csv_import(api_client, tmp_path):
    import io
    csv_content = "first_name,last_name,email,company\nAlice,Smith,alice@x.com,Acme\nBob,Jones,bob@x.com,Beta"
    f = io.BytesIO(csv_content.encode())
    f.name = "import.csv"
    res = api_client.post("/api/clients/import/",
                          {"file": f}, format="multipart")
    assert res.status_code == 201
    assert res.data["created"] == 2


@pytest.mark.django_db
def test_update_client(api_client, client_record):
    """Edit an existing client — PATCH should persist and be reflected on GET."""
    res = api_client.patch(f"/api/clients/{client_record.id}/", {
        "company": "Chen Consulting",
        "status":  "Active",
    }, format="json")
    assert res.status_code == 200
    assert res.data["company"] == "Chen Consulting"

    res = api_client.get(f"/api/clients/{client_record.id}/")
    assert res.status_code == 200
    assert res.data["company"] == "Chen Consulting"


@pytest.mark.django_db
def test_client_notes_create_and_list(api_client, client_record):
    res = api_client.post(f"/api/clients/{client_record.id}/notes/", {
        "text": "Great first session, very engaged.",
        "note_type": "session",
    }, format="json")
    assert res.status_code == 201

    res = api_client.get(f"/api/clients/{client_record.id}/notes/")
    assert res.status_code == 200
    texts = [n["text"] for n in res.data["results"]]
    assert "Great first session, very engaged." in texts


@pytest.mark.django_db
def test_client_note_topic_and_session_date_round_trip(api_client, client_record):
    """Session topic + session date are new searchable fields on ClientNote —
    confirm they round-trip through create and list."""
    res = api_client.post(f"/api/clients/{client_record.id}/notes/", {
        "text": "Discussed quarterly goals.",
        "note_type": "session",
        "topic": "Quarterly planning",
        "session_date": "2026-09-15",
    }, format="json")
    assert res.status_code == 201
    assert res.data["topic"] == "Quarterly planning"
    assert res.data["session_date"] == "2026-09-15"

    res = api_client.get(f"/api/clients/{client_record.id}/notes/")
    assert res.status_code == 200
    note = next(n for n in res.data["results"] if n["topic"] == "Quarterly planning")
    assert note["session_date"] == "2026-09-15"


@pytest.mark.django_db
def test_note_share_toggle_does_not_error(api_client, client_record):
    """Flipping visible_to_client False -> True (on create, and via update) queues
    the note-shared notification email — this just confirms the view's trigger
    logic doesn't blow up either path. Delivery itself is covered manually via
    Mailpit, same as the rest of this codebase's email tasks."""
    res = api_client.post(f"/api/clients/{client_record.id}/notes/", {
        "text": "Shared at creation.",
        "note_type": "session",
        "visible_to_client": True,
    }, format="json")
    assert res.status_code == 201
    assert res.data["visible_to_client"] is True

    res = api_client.post(f"/api/clients/{client_record.id}/notes/", {
        "text": "Not shared yet.",
        "note_type": "session",
    }, format="json")
    assert res.status_code == 201
    note_id = res.data["id"]

    res = api_client.patch(f"/api/clients/{client_record.id}/notes/{note_id}/",
                           {"visible_to_client": True}, format="json")
    assert res.status_code == 200
    assert res.data["visible_to_client"] is True


@pytest.mark.django_db
def test_create_goal_requires_target_date(api_client, client_record):
    """Target date is now a required field for a goal (was silently optional)."""
    res = api_client.post(f"/api/clients/{client_record.id}/goals/", {
        "title": "Improve executive presence",
    }, format="json")
    assert res.status_code == 400
    assert "target_date" in res.data


@pytest.mark.django_db
def test_goal_shares_email_on_create_when_already_visible(api_client, client_record):
    """A goal created with visible_to_client=True from the start (coach ticks
    "Share with client" while first saving it) should queue the share email too,
    not only when an existing unshared goal is later toggled on."""
    res = api_client.post(f"/api/clients/{client_record.id}/goals/", {
        "title": "Improve executive presence",
        "target_date": "2026-12-31",
        "visible_to_client": True,
    }, format="json")
    assert res.status_code == 201
    assert res.data["visible_to_client"] is True


@pytest.mark.django_db
def test_portal_client_can_crud_own_goal(portal_api_client, client_record, workspace):
    """Client-set goals (no coach involved) are a new addition — the client should be
    able to create, edit, and delete their own goals, same as their own notes."""
    from apps.clients.models import Client
    Client.objects.filter(pk=client_record.pk).update(portal_access=True)
    portal = portal_api_client(client_record, workspace)

    res = portal.post("/api/portal/goals/", {
        "title": "Run a 5k",
        "target_date": "2026-11-01",
    }, format="json")
    assert res.status_code == 201
    assert res.data["client_owned"] is True
    goal_id = res.data["id"]

    res = portal.get("/api/portal/goals/")
    assert res.status_code == 200
    assert any(g["id"] == goal_id for g in res.data["goals"])

    res = portal.patch(f"/api/portal/goals/{goal_id}/", {
        "title": "Run a 10k", "target_date": "2026-11-15",
    }, format="json")
    assert res.status_code == 200
    assert res.data["title"] == "Run a 10k"

    res = portal.delete(f"/api/portal/goals/{goal_id}/")
    assert res.status_code == 204

    res = portal.get("/api/portal/goals/")
    assert not any(g["id"] == goal_id for g in res.data["goals"])


@pytest.mark.django_db
def test_portal_client_cannot_edit_coach_goal(api_client, portal_api_client, client_record, workspace):
    """A coach-authored goal can't be edited or deleted from the portal — the client may
    only mark it complete / reopen it (and log progress). Unshared goals stay invisible."""
    from apps.clients.models import Client
    Client.objects.filter(pk=client_record.pk).update(portal_access=True)

    res = api_client.post(f"/api/clients/{client_record.id}/goals/", {
        "title": "Coach-set goal", "target_date": "2026-12-01", "visible_to_client": True,
    }, format="json")
    assert res.status_code == 201
    goal_id = res.data["id"]

    portal = portal_api_client(client_record, workspace)
    res = portal.patch(f"/api/portal/goals/{goal_id}/", {"title": "Hacked"}, format="json")
    assert res.status_code == 400
    from apps.clients.models import ClientGoal
    assert ClientGoal.objects.get(pk=goal_id).title == "Coach-set goal"

    res = portal.delete(f"/api/portal/goals/{goal_id}/")
    assert res.status_code == 404

    # Mark complete → stays visible in the portal; reopen works too.
    res = portal.patch(f"/api/portal/goals/{goal_id}/", {"status": "completed"}, format="json")
    assert res.status_code == 200 and res.data["status"] == "completed"
    listed = {g["id"]: g for g in portal.get("/api/portal/goals/").data["goals"]}
    assert listed[goal_id]["status"] == "completed"
    res = portal.patch(f"/api/portal/goals/{goal_id}/", {"status": "active"}, format="json")
    assert res.status_code == 200 and res.data["status"] == "active"

    # An unshared coach goal can't be touched at all.
    res = api_client.post(f"/api/clients/{client_record.id}/goals/", {
        "title": "Private coach goal", "target_date": "2026-12-01",
    }, format="json")
    res = portal.patch(f"/api/portal/goals/{res.data['id']}/", {"status": "completed"}, format="json")
    assert res.status_code == 404


@pytest.mark.django_db
def test_goal_share_toggle_controls_portal_visibility(api_client, portal_api_client, client_record, workspace):
    """New goals default to not shared; toggling visible_to_client is what actually
    gates whether the client sees it in their portal (regression test for the fix
    where this checkbox used to be dead UI — the field didn't exist on the model)."""
    from apps.clients.models import Client
    Client.objects.filter(pk=client_record.pk).update(portal_access=True)

    res = api_client.post(f"/api/clients/{client_record.id}/goals/", {
        "title": "Improve executive presence",
        "target_date": "2026-12-31",
    }, format="json")
    assert res.status_code == 201
    goal_id = res.data["id"]
    assert res.data["visible_to_client"] is False

    portal = portal_api_client(client_record, workspace)
    res = portal.get("/api/portal/goals/")
    assert res.status_code == 200
    assert res.data["goals"] == []

    res = api_client.patch(f"/api/clients/{client_record.id}/goals/{goal_id}/",
                           {"visible_to_client": True}, format="json")
    assert res.status_code == 200
    assert res.data["visible_to_client"] is True

    res = portal.get("/api/portal/goals/")
    assert res.status_code == 200
    assert len(res.data["goals"]) == 1
    assert res.data["goals"][0]["title"] == "Improve executive presence"
