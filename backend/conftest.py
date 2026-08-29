"""
pytest-django conftest — factories and shared fixtures for all tests.
"""
import pytest
from django.utils import timezone
from datetime import timedelta
import uuid

@pytest.fixture
def workspace(db):
    from apps.accounts.models import Workspace
    return Workspace.objects.create(
        name="Test Coaching Co",
        slug=f"test-{uuid.uuid4().hex[:6]}",
    )

@pytest.fixture
def business_owner(db, workspace):
    from apps.accounts.models import User
    return User.objects.create_user(
        email="owner@test.com",
        password="testpassword123",
        full_name="Test Owner",
        workspace=workspace,
        role="business_owner",
    )

@pytest.fixture
def coach(db, workspace):
    from apps.accounts.models import User
    return User.objects.create_user(
        email="coach@test.com",
        password="testpassword123",
        full_name="Test Coach",
        workspace=workspace,
        role="coach",
    )

@pytest.fixture
def client_record(db, workspace, coach):
    from apps.clients.models import Client
    return Client.objects.create(
        workspace=workspace,
        coach=coach,
        first_name="Sarah",
        last_name="Chen",
        email="sarah@example.com",
    )

@pytest.fixture
def api_client(db, business_owner):
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken
    client = APIClient()
    refresh = RefreshToken.for_user(business_owner)
    refresh["workspace_id"] = str(business_owner.workspace_id)
    refresh["role"]         = business_owner.role
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(refresh.access_token)}")
    return client


@pytest.fixture
def portal_api_client(db):
    """Factory: portal_api_client(client_record, workspace) -> APIClient authenticated
    as that client via a portal_client-scoped JWT (mirrors PortalLoginView's token)."""
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import AccessToken

    def _make(client_record, workspace):
        token = AccessToken()
        token["client_id"]    = str(client_record.id)
        token["workspace_id"] = str(workspace.id)
        token["role"]         = "portal_client"
        token["email"]        = client_record.email
        api = APIClient()
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {str(token)}")
        return api

    return _make
