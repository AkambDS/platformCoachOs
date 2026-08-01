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
    """Business Owner + Coach + Assistant + Limited — any non-owner workspace role that can
    reach the app at all. This is the coarse outer gate; for Assistant/Limited members the
    actual per-section access is refined further by the tab-permission checks below."""
    def has_permission(self, request, view):
        return (request.user and request.user.is_authenticated
                and request.user.role in ("business_owner", "coach", "assistant", "limited"))


class IsBusinessOwnerOrSuperuser(BasePermission):
    """Business Owner or Django superuser — destructive / admin operations."""
    def has_permission(self, request, view):
        return (request.user and request.user.is_authenticated
                and (request.user.role == "business_owner" or request.user.is_superuser))


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


class IsPlatformAdmin(BasePermission):
    """Platform-admin role or Django is_staff — grants access to superadmin API."""
    def has_permission(self, request, view):
        return (request.user and request.user.is_authenticated
                and (request.user.role == "platform_admin" or request.user.is_staff))


# ── Per-tab granular permissions ─────────────────────────────────────────────
# Business Owner / Platform Admin always have full access to every tab and never
# consult this table. For everyone else, a saved TabPermission row (set by the owner
# on the Team page) overrides the role default below; no row means "use the default".
ROLE_TAB_DEFAULTS = {
    "coach": {
        "clients":    {"view": True,  "edit": True,  "delete": False},
        "pipeline":   {"view": True,  "edit": True,  "delete": False},
        "activities": {"view": True,  "edit": True,  "delete": False},
        "invoices":   {"view": True,  "edit": True,  "delete": False},
        "reports":    {"view": False, "edit": False, "delete": False},
        "library":    {"view": True,  "edit": True,  "delete": False},
    },
    "assistant": {
        "clients":    {"view": True,  "edit": True,  "delete": False},
        "pipeline":   {"view": False, "edit": False, "delete": False},
        "activities": {"view": True,  "edit": True,  "delete": False},
        "invoices":   {"view": False, "edit": False, "delete": False},
        "reports":    {"view": False, "edit": False, "delete": False},
        "library":    {"view": True,  "edit": False, "delete": False},
    },
    "limited": {
        "clients":    {"view": True,  "edit": False, "delete": False},
        "pipeline":   {"view": False, "edit": False, "delete": False},
        "activities": {"view": True,  "edit": False, "delete": False},
        "invoices":   {"view": False, "edit": False, "delete": False},
        "reports":    {"view": False, "edit": False, "delete": False},
        "library":    {"view": False, "edit": False, "delete": False},
    },
}
ALL_TABS = ["clients", "pipeline", "activities", "invoices", "reports", "library"]


def get_effective_tab_permissions(user):
    """{tab: {"view": bool, "edit": bool, "delete": bool}} for every tab — role default
    merged with any saved per-user overrides."""
    if user.role in ("business_owner", "platform_admin"):
        return {t: {"view": True, "edit": True, "delete": True} for t in ALL_TABS}
    from .models import TabPermission
    defaults = ROLE_TAB_DEFAULTS.get(user.role, {})
    result = {t: dict(defaults.get(t, {"view": False, "edit": False, "delete": False})) for t in ALL_TABS}
    for o in TabPermission.objects.filter(user=user):
        result[o.tab] = {"view": o.can_view, "edit": o.can_edit, "delete": o.can_delete}
    return result


def has_tab_access(user, tab, action="view"):
    if not user or not user.is_authenticated:
        return False
    if user.role in ("business_owner", "platform_admin"):
        return True
    return get_effective_tab_permissions(user).get(tab, {}).get(action, False)


def require_tab(tab, action="view"):
    """DRF permission-class factory: gate a view behind a tab-permission check."""
    class _TabPermission(BasePermission):
        def has_permission(self, request, view):
            return has_tab_access(request.user, tab, action)
    return _TabPermission
