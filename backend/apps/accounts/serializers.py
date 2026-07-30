"""CoachOS — accounts/serializers.py"""
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from django.utils import timezone as tz
from datetime import timedelta
import uuid

from .models import User, Workspace, WorkspaceInvitation


class CoachOSTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Adds workspace_id, role, full_name to JWT payload."""

    def validate(self, attrs):
        data = super().validate(attrs)
        user = self.user
        if (
            user.workspace
            and not user.workspace.is_active
            and user.role != "platform_admin"
        ):
            raise serializers.ValidationError(
                "Your workspace is not yet active. "
                "Please contact your administrator for access."
            )
        return data

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["workspace_id"] = str(user.workspace_id) if user.workspace_id else None
        token["role"]         = user.role
        token["full_name"]    = user.full_name
        token["email"]        = user.email
        return token


class WorkspaceSerializer(serializers.ModelSerializer):
    """Used by LoginView/MeView to hydrate the frontend's auth store on login and page
    load. Must include generic_templates/template_use_case_map (also read by the
    Settings page, and by ClientCommunicationPanel's "Start from a template?" picker) —
    without them here, those features work fine mid-session (apps.settings_app's own,
    fuller WorkspaceSerializer returns the full object on save, which the frontend merges
    into its in-memory store) but appear to have "lost" all saved templates the moment
    the user logs back in or reloads the page, since this serializer silently omitted
    the fields instead of erroring."""
    class Meta:
        model  = Workspace
        fields = ["id", "name", "slug", "plan", "primary_colour",
                  "workspace_timezone", "buffer_minutes", "cancellation_hours",
                  "logo_s3_key", "logo_data", "email_templates",
                  "generic_templates", "template_use_case_map",
                  "address", "city", "state", "zip_code", "created_at"]
        read_only_fields = ["id", "created_at", "slug"]


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model  = User
        fields = ["id", "email", "full_name", "role", "user_timezone", "phone",
                  "avatar_url", "is_active", "is_superuser", "date_joined"]
        read_only_fields = ["id", "is_superuser", "date_joined"]


class RegisterWorkspaceSerializer(serializers.Serializer):
    workspace_name = serializers.CharField(max_length=200)
    full_name      = serializers.CharField(max_length=200)
    email          = serializers.EmailField()
    password       = serializers.CharField(min_length=8, write_only=True)

    def validate_email(self, value):
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate(self, attrs):
        name = attrs.get("workspace_name", "")
        if Workspace.objects.filter(name__iexact=name).exists():
            raise serializers.ValidationError(
                {"workspace_name": "A workspace with this name already exists. Please choose a different name."}
            )
        return attrs

    def create(self, validated_data):
        from django.utils.text import slugify
        is_active = validated_data.pop("is_active", True)
        slug = slugify(validated_data["workspace_name"])
        if Workspace.objects.filter(slug=slug).exists():
            slug = f"{slug}-{str(uuid.uuid4())[:8]}"

        workspace = Workspace.objects.create(
            name=validated_data["workspace_name"],
            owner_email=validated_data["email"],
            slug=slug,
            is_active=is_active,
            pending_activation=not is_active,
        )
        user = User.objects.create_user(
            email=validated_data["email"],
            password=validated_data["password"],
            full_name=validated_data["full_name"],
            workspace=workspace,
            role=User.Role.BUSINESS_OWNER,
        )
        return user


class InviteUserSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role  = serializers.ChoiceField(choices=User.Role.choices)

    def validate_email(self, value):
        workspace = self.context["request"].user.workspace
        if User.objects.filter(email=value, workspace=workspace).exists():
            raise serializers.ValidationError("User already exists in this workspace.")
        return value


class AcceptInviteSerializer(serializers.Serializer):
    token     = serializers.UUIDField()
    password  = serializers.CharField(min_length=8, write_only=True)
    full_name = serializers.CharField(max_length=200)
