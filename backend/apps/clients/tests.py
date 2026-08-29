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
def test_create_goal_requires_target_date(api_client, client_record):
    """Target date is now a required field for a goal (was silently optional)."""
    res = api_client.post(f"/api/clients/{client_record.id}/goals/", {
        "title": "Improve executive presence",
    }, format="json")
    assert res.status_code == 400
    assert "target_date" in res.data


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
