"""CoachOS — accounts/views.py — Auth, Registration, Invites"""
from rest_framework import status, generics
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from django.utils import timezone
from datetime import timedelta
import uuid

from .models import User, Workspace, WorkspaceInvitation
from .serializers import (
    RegisterWorkspaceSerializer, InviteUserSerializer,
    AcceptInviteSerializer, UserSerializer, WorkspaceSerializer,
    CoachOSTokenObtainPairSerializer,
)
from .permissions import IsBusinessOwner, IsWorkspaceMember


class LoginView(TokenObtainPairView):
    """POST /api/auth/login/ — returns access + refresh tokens."""
    serializer_class = CoachOSTokenObtainPairSerializer


class RefreshView(TokenRefreshView):
    """POST /api/auth/refresh/ — rotates refresh token."""
    pass


@api_view(["POST"])
@permission_classes([AllowAny])
def register(request):
    """
    POST /api/auth/register/
    Bootstrap first workspace + Business Owner account.
    Used for POC setup and Phase 3 self-serve signup.
    """
    serializer = RegisterWorkspaceSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    user = serializer.save()

    # Return tokens immediately so user lands on dashboard
    from rest_framework_simplejwt.tokens import RefreshToken
    refresh = RefreshToken.for_user(user)
    refresh["workspace_id"] = str(user.workspace_id)
    refresh["role"]         = user.role
    refresh["full_name"]    = user.full_name

    return Response({
        "access":    str(refresh.access_token),
        "refresh":   str(refresh),
        "user":      UserSerializer(user).data,
        "workspace": WorkspaceSerializer(user.workspace).data,
    }, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsBusinessOwner])
def invite_user(request):
    """
    POST /api/auth/invite/
    Business Owner invites a Coach or Assistant.
    Creates an invitation record and sends email with accept link.
    """
    serializer = InviteUserSerializer(data=request.data, context={"request": request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    invitation = WorkspaceInvitation.objects.create(
        workspace=request.user.workspace,
        invited_by=request.user,
        email=serializer.validated_data["email"],
        role=serializer.validated_data["role"],
        expires_at=timezone.now() + timedelta(hours=48),
    )

    # Send invite email via Celery task
    from tasks.email import send_invite_email
    send_invite_email.delay(str(invitation.id))

    return Response({"detail": "Invitation sent.", "token": str(invitation.token)},
                    status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([AllowAny])
def accept_invite(request):
    """
    POST /api/auth/accept-invite/
    Invited user sets their password and gets a JWT.
    """
    serializer = AcceptInviteSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    try:
        invitation = WorkspaceInvitation.objects.get(
            token=serializer.validated_data["token"],
            accepted=False,
            expires_at__gt=timezone.now(),
        )
    except WorkspaceInvitation.DoesNotExist:
        return Response({"detail": "Invalid or expired invitation."},
                        status=status.HTTP_400_BAD_REQUEST)

    user = User.objects.create_user(
        email=invitation.email,
        password=serializer.validated_data["password"],
        full_name=serializer.validated_data["full_name"],
        workspace=invitation.workspace,
        role=invitation.role,
    )
    invitation.accepted = True
    invitation.save()

    from rest_framework_simplejwt.tokens import RefreshToken
    refresh = RefreshToken.for_user(user)
    refresh["workspace_id"] = str(user.workspace_id)
    refresh["role"]         = user.role
    refresh["full_name"]    = user.full_name

    return Response({
        "access":  str(refresh.access_token),
        "refresh": str(refresh),
        "user":    UserSerializer(user).data,
    }, status=status.HTTP_201_CREATED)


class MeView(generics.RetrieveUpdateAPIView):
    """GET/PUT /api/auth/me/ — current user's profile."""
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user


class TeamView(generics.ListAPIView):
    """GET /api/auth/team/ — list all users in workspace."""
    serializer_class = UserSerializer
    permission_classes = [IsWorkspaceMember]

    def get_queryset(self):
        return User.objects.filter(workspace=self.request.user.workspace)
