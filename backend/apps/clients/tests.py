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
