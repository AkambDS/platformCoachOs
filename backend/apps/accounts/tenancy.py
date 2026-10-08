"""Tenant-isolation helpers for serializers.

DRF's default PrimaryKeyRelatedField resolves a writable FK (`client`, `coach`, `deal`, …)
against `<Model>.objects.all()` — every workspace's rows. That let a user in workspace B
create an invoice/deal/activity pointing at workspace A's client and read that client's
details back in the response (PHASE2.md, DB-1).

WorkspaceScopedPrimaryKeyRelatedField instead resolves against the requesting user's own
workspace, then narrows further for non-owners to the same rows they can already read
(mirrors clients.views._client_qs and the per-viewset get_queryset role filters). It fails
closed: with no request/user/workspace in the serializer context, nothing resolves.

Use it by mixing WorkspaceScopedSerializerMixin into a ModelSerializer — every FK the
ModelSerializer auto-builds then uses it, keeping the model's own required/null settings.
"""
from rest_framework import serializers

# Roles that see every row in their workspace; everyone else gets the per-model narrowing below.
FULL_WORKSPACE_ROLES = ("business_owner", "platform_admin")

# Per-model narrowing for non-owner roles, matching what they can read today:
#   Client     → clients.views._client_qs        (coach = user)
#   Deal       → pipeline DealViewSet            (client__coach = user)
#   Activity   → activities ActivityViewSet      (coach = user)
#   ClientGoal → clients ClientGoalViewSet       (client in _client_qs)
_NON_OWNER_SCOPES = {
    "Client":     lambda qs, user: qs.filter(coach=user),
    "Deal":       lambda qs, user: qs.filter(client__coach=user),
    "Activity":   lambda qs, user: qs.filter(coach=user),
    "ClientGoal": lambda qs, user: qs.filter(client__coach=user),
}


def scope_to_workspace(qs, user):
    """Restrict `qs` to `user`'s workspace (and role scope); empty if there's no workspace."""
    workspace_id = getattr(user, "workspace_id", None)
    if not workspace_id:
        return qs.none()
    qs = qs.filter(workspace_id=workspace_id)
    if getattr(user, "role", None) not in FULL_WORKSPACE_ROLES:
        narrow = _NON_OWNER_SCOPES.get(qs.model.__name__)
        if narrow:
            qs = narrow(qs, user)
    return qs


class WorkspaceScopedPrimaryKeyRelatedField(serializers.PrimaryKeyRelatedField):
    def get_queryset(self):
        qs = super().get_queryset()
        request = self.context.get("request")
        return scope_to_workspace(qs, getattr(request, "user", None))


class WorkspaceScopedSerializerMixin:
    """Make every auto-built FK field on a ModelSerializer workspace-scoped."""
    serializer_related_field = WorkspaceScopedPrimaryKeyRelatedField
