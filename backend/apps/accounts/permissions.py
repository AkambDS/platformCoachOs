"""CoachOS — DRF Permission Classes (maps to 4 roles from SDD)"""
from rest_framework.permissions import BasePermission


class IsBusinessOwner(BasePermission):
    """Business Owner only — full access including financial data."""
    def has_permission(self, request, view):
        return (request.user and request.user.is_authenticated
                and request.user.role == "business_owner")


class IsCoachOrAbove(BasePermission):
    """Business Owner + Coach — manage own clients, activities, invoices."""
    def has_permission(self, request, view):
        return (request.user and request.user.is_authenticated
                and request.user.role in ("business_owner", "coach"))


class IsAssistantOrAbove(BasePermission):
    """Business Owner + Coach + Assistant — schedule, create invoices."""
    def has_permission(self, request, view):
        return (request.user and request.user.is_authenticated
                and request.user.role in ("business_owner", "coach", "assistant"))


class IsClientPortalUser(BasePermission):
    """Client portal users only — own data via separate JWT scope."""
    def has_permission(self, request, view):
        return (request.user and request.user.is_authenticated
                and getattr(request.user, "portal_role", None) == "client")


class IsWorkspaceMember(BasePermission):
    """Any authenticated user belonging to a workspace."""
    def has_permission(self, request, view):
        return (request.user and request.user.is_authenticated
                and request.user.workspace_id is not None)
