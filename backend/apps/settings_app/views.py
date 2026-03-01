from rest_framework.generics import RetrieveUpdateAPIView
from apps.accounts.models import Workspace
from .serializers import BrandingSerializer, SchedulingSerializer
from apps.accounts.permissions import IsBusinessOwner, IsWorkspaceMember


class BrandingSettingsView(RetrieveUpdateAPIView):
    """GET/PUT /api/settings/branding/"""
    serializer_class   = BrandingSerializer
    permission_classes = [IsWorkspaceMember]

    def get_object(self):
        return self.request.user.workspace


class SchedulingSettingsView(RetrieveUpdateAPIView):
    """GET/PUT /api/settings/scheduling/"""
    serializer_class   = SchedulingSerializer
    permission_classes = [IsWorkspaceMember]

    def get_object(self):
        return self.request.user.workspace
