"""CoachOS — accounts/views.py — Auth, Registration, Invites"""
from rest_framework import status, generics
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from django.utils import timezone
from datetime import timedelta
import uuid

from .models import User, Workspace, WorkspaceInvitation, WorkspaceRegistrationToken
from .serializers import (
    RegisterWorkspaceSerializer, InviteUserSerializer,
    AcceptInviteSerializer, UserSerializer, WorkspaceSerializer,
    CoachOSTokenObtainPairSerializer,
)
from .permissions import IsBusinessOwner, IsWorkspaceMember


class LoginRateThrottle(AnonRateThrottle):
    """Max 10 login attempts per minute per IP — blocks brute-force password attacks."""
    scope = "login"


class PasswordResetRateThrottle(AnonRateThrottle):
    """Max 5 reset requests per minute per IP — prevents email flooding."""
    scope = "password_reset"


class RegisterRateThrottle(AnonRateThrottle):
    """Max 5 registration attempts per hour per IP — prevents mass fake workspace creation."""
    scope = "register"


def _set_auth_cookies(response, access: str, refresh: str | None = None):
    """Write JWT tokens into httpOnly cookies so JS cannot read them."""
    from django.conf import settings as dj_settings
    secure = not dj_settings.DEBUG   # HTTPS-only in production; allow HTTP in local dev
    response.set_cookie(
        "access_token", access,
        max_age=30 * 60,             # 30 minutes — matches SIMPLE_JWT ACCESS_TOKEN_LIFETIME
        httponly=True,
        secure=secure,
        samesite="Lax",
        path="/",
    )
    if refresh:
        response.set_cookie(
            "refresh_token", refresh,
            max_age=7 * 24 * 60 * 60,  # 7 days — matches SIMPLE_JWT REFRESH_TOKEN_LIFETIME
            httponly=True,
            secure=secure,
            samesite="Lax",
            path="/api/auth/",         # cookie only sent to /api/auth/* endpoints
        )


class CookieJWTAuthentication:
    """
    DRF authentication class that reads JWT from httpOnly cookie first,
    then falls back to the Authorization: Bearer header (for API / mobile clients).
    """
    def authenticate(self, request):
        from rest_framework_simplejwt.authentication import JWTAuthentication
        auth = JWTAuthentication()
        raw_token = request.COOKIES.get("access_token")
        if raw_token:
            try:
                validated = auth.get_validated_token(raw_token)
                return auth.get_user(validated), validated
            except Exception:
                pass
        return auth.authenticate(request)

    def authenticate_header(self, request):
        return "Bearer"


class LoginView(TokenObtainPairView):
    """POST /api/auth/login/
    Sets httpOnly cookies (access_token, refresh_token).
    Returns { user, workspace } — no tokens in the response body.
    """
    serializer_class = CoachOSTokenObtainPairSerializer
    throttle_classes = [LoginRateThrottle]

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            access  = response.data.pop("access")
            refresh = response.data.pop("refresh")
            _set_auth_cookies(response, access, refresh)

            from rest_framework_simplejwt.tokens import AccessToken
            token = AccessToken(access)
            try:
                user = User.objects.select_related("workspace").get(id=token["user_id"])
                if user.workspace_id is None and user.role != User.Role.PLATFORM_ADMIN:
                    first_ws = Workspace.objects.first()
                    if first_ws:
                        user.workspace = first_ws
                        user.save(update_fields=["workspace"])
                        from rest_framework_simplejwt.tokens import RefreshToken
                        new_refresh = RefreshToken.for_user(user)
                        new_refresh["workspace_id"] = str(user.workspace_id)
                        new_refresh["role"]         = user.role
                        new_refresh["full_name"]    = user.full_name
                        new_refresh["email"]        = user.email
                        _set_auth_cookies(response, str(new_refresh.access_token), str(new_refresh))
                response.data["user"]      = UserSerializer(user).data
                response.data["workspace"] = WorkspaceSerializer(user.workspace).data if user.workspace else None
            except User.DoesNotExist:
                pass
        return response


class RefreshView(TokenRefreshView):
    """POST /api/auth/refresh/
    Reads refresh_token from httpOnly cookie, issues a new access cookie (and rotated refresh cookie).
    The request body can be empty — no tokens needed from the client.
    """
    def post(self, request, *args, **kwargs):
        refresh_cookie = request.COOKIES.get("refresh_token")
        if refresh_cookie and not request.data.get("refresh"):
            data = request.data.copy()
            data["refresh"] = refresh_cookie
            request._full_data = data
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            access  = response.data.pop("access", None)
            refresh = response.data.pop("refresh", None)
            if access:
                _set_auth_cookies(response, access, refresh)
        return response


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout_view(request):
    """POST /api/auth/logout/ — blacklist refresh token and clear auth cookies."""
    try:
        from rest_framework_simplejwt.tokens import RefreshToken
        refresh_token = request.COOKIES.get("refresh_token")
        if refresh_token:
            RefreshToken(refresh_token).blacklist()
    except Exception:
        pass
    response = Response({"detail": "Logged out."})
    response.delete_cookie("access_token",  path="/")
    response.delete_cookie("refresh_token", path="/api/auth/")
    return response


@api_view(["POST"])
@permission_classes([AllowAny])
@api_view(["GET"])
@permission_classes([AllowAny])
def token_info(request):
    """GET /api/auth/token-info/?token=<uuid> — return recipient pre-fill info for register page."""
    token_value = request.query_params.get("token")
    if not token_value:
        return Response({"detail": "token required"}, status=400)
    try:
        t = WorkspaceRegistrationToken.objects.get(id=token_value, used=False, expires_at__gt=timezone.now())
    except (WorkspaceRegistrationToken.DoesNotExist, Exception):
        return Response({"detail": "Invalid or expired token."}, status=400)
    return Response({
        "recipient_name":  t.recipient_name,
        "recipient_email": t.recipient_email,
        "note":            t.note,
    })


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([RegisterRateThrottle])
def register(request):
    """
    POST /api/auth/register/
    Bootstrap first workspace + Business Owner account.
    Blocked by default — only open when REGISTRATION_OPEN=True in settings,
    or a valid registration_token (from superadmin) is supplied.
    """
    from django.conf import settings as django_settings
    reg_token = None
    token_value = request.data.get("registration_token")
    if token_value:
        try:
            reg_token = WorkspaceRegistrationToken.objects.get(
                id=token_value, used=False, expires_at__gt=timezone.now()
            )
        except (WorkspaceRegistrationToken.DoesNotExist, Exception):
            return Response(
                {"detail": "Invalid or expired registration link."},
                status=status.HTTP_400_BAD_REQUEST,
            )
    elif not getattr(django_settings, "REGISTRATION_OPEN", False):
        return Response(
            {"detail": "Workspace registration is currently closed. Contact your administrator."},
            status=status.HTTP_403_FORBIDDEN,
        )

    serializer = RegisterWorkspaceSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    # Workspaces created via invite token start inactive — superadmin must activate.
    user = serializer.save(is_active=not bool(reg_token))
    if reg_token:
        reg_token.used = True
        reg_token.used_by = user.workspace
        reg_token.save(update_fields=["used", "used_by"])
        return Response({
            "pending": True,
            "detail": (
                "Your workspace has been created and is pending activation. "
                "Our team will review and activate it shortly — you'll then be able to log in."
            ),
        }, status=status.HTTP_201_CREATED)

    # Open registration (REGISTRATION_OPEN=True) — log in immediately.
    from rest_framework_simplejwt.tokens import RefreshToken
    refresh = RefreshToken.for_user(user)
    refresh["workspace_id"] = str(user.workspace_id)
    refresh["role"]         = user.role
    refresh["full_name"]    = user.full_name

    response = Response({
        "user":      UserSerializer(user).data,
        "workspace": WorkspaceSerializer(user.workspace).data,
    }, status=status.HTTP_201_CREATED)
    _set_auth_cookies(response, str(refresh.access_token), str(refresh))
    return response


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

    response = Response({"detail": "Invite accepted."}, status=status.HTTP_201_CREATED)
    _set_auth_cookies(response, str(refresh.access_token), str(refresh))
    return response


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
    pagination_class = None

    def get_queryset(self):
        return User.objects.filter(workspace=self.request.user.workspace).order_by("full_name")


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


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([PasswordResetRateThrottle])
def password_reset_request(request):
    """POST /api/auth/password-reset/ — send reset email if address is registered."""
    from django.contrib.auth.tokens import default_token_generator
    from django.utils.http import urlsafe_base64_encode
    from django.utils.encoding import force_bytes
    from django.core.mail import EmailMultiAlternatives
    from django.conf import settings as dj_settings
    import logging
    logger = logging.getLogger(__name__)

    email = (request.data.get("email") or "").strip().lower()
    if not email:
        return Response({"detail": "Email is required."}, status=status.HTTP_400_BAD_REQUEST)

    # Always return the same message so we don't reveal whether an address is registered
    ok = Response({"detail": "If that email is registered you'll receive a reset link shortly."})

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        return ok

    uid       = urlsafe_base64_encode(force_bytes(user.pk))
    token     = default_token_generator.make_token(user)
    base_url  = getattr(dj_settings, "FRONTEND_URL", "http://localhost:5173")
    reset_url = f"{base_url}/reset-password?uid={uid}&token={token}"

    plain = (
        f"Hi {user.full_name},\n\n"
        f"Someone requested a password reset for your CoachOS account.\n\n"
        f"Reset here: {reset_url}\n\n"
        f"This link expires in 24 hours. If you didn't request this, ignore this email."
    )
    html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#eeebe5;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
  <tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="background:#1a2f4e;padding:24px 40px;border-radius:8px 8px 0 0;">
      <span style="font-family:Georgia,serif;font-size:22px;color:#f5f0e8;">CoachOS</span>
    </td></tr>
    <tr><td style="height:3px;background:linear-gradient(90deg,#b8922e,#d9b96a,#b8922e);"></td></tr>
    <tr><td style="background:#fff;padding:40px;border-radius:0 0 8px 8px;font-family:Arial,sans-serif;">
      <h2 style="margin:0 0 16px;font-size:22px;color:#16130f;">Reset your password</h2>
      <p style="color:#4a443e;line-height:1.6;">Hi {user.full_name},<br><br>
         We received a request to reset your CoachOS password. Click below to choose a new one.</p>
      <div style="text-align:center;margin:32px 0;">
        <a href="{reset_url}" style="background:#1B3A6B;color:#fff;padding:14px 32px;
           text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;display:inline-block;">
          Reset Password
        </a>
      </div>
      <p style="color:#8c8279;font-size:13px;">This link expires in 24 hours.<br>
         If you didn't request this, you can safely ignore this email.</p>
    </td></tr>
  </table></td></tr>
</table>
</body></html>"""

    try:
        msg = EmailMultiAlternatives(
            subject="Reset your CoachOS password",
            body=plain,
            from_email=dj_settings.DEFAULT_FROM_EMAIL,
            to=[email],
        )
        msg.attach_alternative(html, "text/html")
        msg.send()
    except Exception as exc:
        logger.error(f"password_reset_request: email failed for {email}: {exc}")

    return ok


@api_view(["POST"])
@permission_classes([AllowAny])
def password_reset_confirm(request):
    """POST /api/auth/password-reset/confirm/ — validate token and set new password."""
    from django.contrib.auth.tokens import default_token_generator
    from django.utils.http import urlsafe_base64_decode
    from django.utils.encoding import force_str

    uid      = (request.data.get("uid")      or "").strip()
    token    = (request.data.get("token")    or "").strip()
    password = (request.data.get("password") or "").strip()

    if not uid or not token or not password:
        return Response({"detail": "uid, token and password are all required."},
                        status=status.HTTP_400_BAD_REQUEST)
    if len(password) < 8:
        return Response({"detail": "Password must be at least 8 characters."},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        user_id = force_str(urlsafe_base64_decode(uid))
        user    = User.objects.get(pk=user_id)
    except (TypeError, ValueError, User.DoesNotExist):
        return Response({"detail": "Reset link is invalid."}, status=status.HTTP_400_BAD_REQUEST)

    if not default_token_generator.check_token(user, token):
        return Response({"detail": "Reset link has expired or already been used."},
                        status=status.HTTP_400_BAD_REQUEST)

    user.set_password(password)
    user.save(update_fields=["password"])
    return Response({"detail": "Password updated. You can now sign in with your new password."})
