"""Tests — accounts app"""
import pytest
from django.urls import reverse


@pytest.mark.django_db
def test_register_workspace():
    from rest_framework.test import APIClient
    client = APIClient()
    res = client.post("/api/auth/register/", {
        "workspace_name": "Webb Coaching",
        "full_name":      "Marcus Webb",
        "email":          "marcus@webb.com",
        "password":       "securepass123",
    }, format="json")
    assert res.status_code == 201
    assert "access" in res.data
    assert res.data["workspace"]["name"] == "Webb Coaching"
    assert res.data["user"]["role"] == "business_owner"


@pytest.mark.django_db
def test_login(business_owner):
    from rest_framework.test import APIClient
    client = APIClient()
    res = client.post("/api/auth/login/", {
        "email": "owner@test.com",
        "password": "testpassword123",
    }, format="json")
    assert res.status_code == 200
    assert "access" in res.data
    assert res.data["role"] == "business_owner"


@pytest.mark.django_db
def test_me_returns_current_user(api_client, business_owner):
    res = api_client.get("/api/auth/me/")
    assert res.status_code == 200
    assert res.data["email"] == business_owner.email


@pytest.mark.django_db
def test_team_list_scoped_to_workspace(api_client, workspace, coach):
    """Team endpoint must only return users from same workspace."""
    from apps.accounts.models import Workspace, User
    other_ws = Workspace.objects.create(name="Other Co", slug="other-co")
    User.objects.create_user(email="spy@other.com", password="x",
                             full_name="Spy", workspace=other_ws)
    res = api_client.get("/api/auth/team/")
    assert res.status_code == 200
    emails = [u["email"] for u in res.data["results"]]
    assert "spy@other.com" not in emails
