"""Tests — accounts app"""
import pytest
from django.urls import reverse


@pytest.mark.django_db
def test_register_workspace():
    """Auth tokens are set as httpOnly cookies, not returned in the response body
    (see LoginView/register docstrings) — assert on that, not res.data['access']."""
    from rest_framework.test import APIClient
    client = APIClient()
    res = client.post("/api/auth/register/", {
        "workspace_name": "Webb Coaching",
        "full_name":      "Marcus Webb",
        "email":          "marcus@webb.com",
        "password":       "securepass123",
    }, format="json")
    assert res.status_code == 201
    assert "access_token" in res.cookies
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
    assert "access_token" in res.cookies
    assert res.data["user"]["role"] == "business_owner"


@pytest.mark.django_db
def test_me_returns_current_user(api_client, business_owner):
    res = api_client.get("/api/auth/me/")
    assert res.status_code == 200
    assert res.data["user"]["email"] == business_owner.email


@pytest.mark.django_db
def test_team_list_scoped_to_workspace(api_client, workspace, coach):
    """Team endpoint must only return users from same workspace. TeamView disables
    pagination (pagination_class = None), so res.data is a plain list."""
    from apps.accounts.models import Workspace, User
    other_ws = Workspace.objects.create(name="Other Co", slug="other-co")
    User.objects.create_user(email="spy@other.com", password="x",
                             full_name="Spy", workspace=other_ws)
    res = api_client.get("/api/auth/team/")
    assert res.status_code == 200
    emails = [u["email"] for u in res.data]
    assert "spy@other.com" not in emails
