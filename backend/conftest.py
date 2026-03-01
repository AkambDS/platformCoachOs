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
