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
    """POST /api/auth/login/ — returns access + refresh + user + workspace."""
    serializer_class = CoachOSTokenObtainPairSerializer

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            from rest_framework_simplejwt.tokens import AccessToken
            token = AccessToken(response.data["access"])
            try:
                user = User.objects.select_related("workspace").get(id=token["user_id"])
                response.data["user"]      = UserSerializer(user).data
                response.data["workspace"] = WorkspaceSerializer(user.workspace).data
            except User.DoesNotExist:
                pass
        return response


class RefreshView(TokenRefreshView):
    """POST /api/auth/refresh/ — rotates refresh token."""
    pass


@api_view(["POST"])
@permission_classes([AllowAny])
def register(request):
    """
    POST /api/auth/register/
    Bootstrap first workspace + Business Owner account.
    Blocked by default — only open when REGISTRATION_OPEN=True in settings.
    """
    from django.conf import settings as django_settings
    if not getattr(django_settings, "REGISTRATION_OPEN", False):
        return Response(
            {"detail": "Workspace registration is currently closed. Contact your administrator."},
            status=status.HTTP_403_FORBIDDEN,
        )
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

    # Send invite email synchronously (no Celery worker needed)
    from tasks.email import send_invite_email
    try:
        send_invite_email(str(invitation.id))
        invitation.email_sent = True
        invitation.save(update_fields=["email_sent"])
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error("send_invite_email failed: %s", exc)
        # email_sent stays False — cron job will retry

    return Response({"detail": "Invitation sent.", "token": str(invitation.token)},
                    status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsBusinessOwner])
def invite_email_preview(request):
    """
    GET /api/auth/invite-email-preview/?email=x&role=coach
    Returns HTML preview of the invite email.
    """
    from tasks.email import _logo_url, _owner_info
    from tasks.email_html import build_invite_email
    from django.conf import settings as dj_settings

    email = request.query_params.get("email", "colleague@example.com")
    role  = request.query_params.get("role", "coach")
    workspace = request.user.workspace

    role_labels = {"business_owner": "Business Owner", "coach": "Coach", "assistant": "Assistant"}
    frontend_url = getattr(dj_settings, "FRONTEND_URL", "http://localhost:5173")
    owner_email, owner_name = _owner_info(workspace)

    html = build_invite_email(
        invited_by_name=request.user.full_name,
        workspace_name=workspace.name,
        role_display=role_labels.get(role, role.capitalize()),
        accept_url=f"{frontend_url}/accept-invite?token=preview-token",
        logo_url=_logo_url(workspace),
        invited_email=email,
        owner_email=owner_email,
    )
    return Response({"html": html})


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

    # Check if user already exists (e.g. re-invite or previous failed attempt)
    existing = User.objects.filter(email=invitation.email).first()
    if existing:
        # If already in this workspace, just mark accepted and return tokens
        if existing.workspace_id == invitation.workspace_id:
            invitation.accepted = True
            invitation.save()
        else:
            return Response(
                {"detail": f"An account with email {invitation.email} already exists. Please sign in instead."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user = existing
    else:
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
    """GET/PATCH /api/auth/me/ — current user profile + workspace."""
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user

    def retrieve(self, request, *args, **kwargs):
        user = self.get_object()
        return Response({
            "user":      UserSerializer(user).data,
            "workspace": WorkspaceSerializer(user.workspace).data,
        })

    def partial_update(self, request, *args, **kwargs):
        user = self.get_object()
        # Handle password change separately
        new_password = request.data.get("password")
        current_password = request.data.get("current_password")
        if new_password:
            if not current_password or not user.check_password(current_password):
                return Response({"current_password": ["Incorrect password."]},
                                status=status.HTTP_400_BAD_REQUEST)
            user.set_password(new_password)
            user.save(update_fields=["password"])
            return Response({"detail": "Password updated."})

        serializer = UserSerializer(user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class TeamView(generics.ListAPIView):
    """GET /api/auth/team/ — list all users in workspace."""
    serializer_class = UserSerializer
    permission_classes = [IsWorkspaceMember]

    def get_queryset(self):
        return User.objects.filter(workspace=self.request.user.workspace)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsBusinessOwner])
def team_member_detail(request, pk):
    """
    PATCH /api/auth/team/<pk>/ — change a member's role (coach ↔ assistant).
    DELETE /api/auth/team/<pk>/ — remove a member from the workspace.
    Business Owner only. Cannot target yourself or another Business Owner.
    """
    try:
        member = User.objects.get(id=pk, workspace=request.user.workspace)
    except User.DoesNotExist:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    if member.id == request.user.id:
        return Response({"detail": "You cannot edit or remove yourself."},
                        status=status.HTTP_400_BAD_REQUEST)

    if member.role == "business_owner":
        return Response({"detail": "Business Owner accounts cannot be edited or removed here."},
                        status=status.HTTP_400_BAD_REQUEST)

    if request.method == "PATCH":
        role = request.data.get("role")
        if role not in ("coach", "assistant"):
            return Response({"detail": "Role must be 'coach' or 'assistant'."},
                            status=status.HTTP_400_BAD_REQUEST)
        member.role = role
        member.save(update_fields=["role"])
        return Response(UserSerializer(member).data)

    # DELETE
    member.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)
