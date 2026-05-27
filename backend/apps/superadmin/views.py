"""CoachOS — Superadmin API (platform_admin role or is_staff)"""
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework import status as http_status
from apps.accounts.permissions import IsPlatformAdmin
from django.utils import timezone
from datetime import timedelta

from apps.accounts.models import Workspace, User, WorkspaceInvitation, WorkspaceRegistrationToken, AuditLog, ErrorLog
from apps.pipeline.models import PipelineStageConfig
from apps.clients.models import Client, ClientStatusConfig, ClientTagConfig
from apps.activities.models import Activity
from apps.invoicing.models import Invoice
from apps.pipeline.models import Deal
from apps.settings_app.serializers import ClientStatusConfigSerializer, ClientTagConfigSerializer
from apps.settings_app.views import _seed_client_statuses


# ── Dashboard ─────────────────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsPlatformAdmin])
def dashboard(request):
    """GET /api/superadmin/dashboard/"""
    from django.db.models import Sum
    workspaces = Workspace.objects.all()
    users      = User.objects.filter(is_superuser=False)
    plan_counts = {}
    for p in ["trial", "starter", "growth", "enterprise"]:
        plan_counts[p] = workspaces.filter(plan=p).count()

    seven_days_ago = timezone.now() - timedelta(days=7)
    revenue_total = Invoice.objects.aggregate(s=Sum("amount_paid"))["s"] or 0
    overdue_count = Invoice.objects.filter(status="overdue").count()
    new_workspaces_7d = workspaces.filter(created_at__gte=seven_days_ago).count()
    total_errors = ErrorLog.objects.count()

    return Response({
        "workspaces":         workspaces.count(),
        "workspaces_active":  workspaces.filter(is_active=True).count(),
        "new_workspaces_7d":  new_workspaces_7d,
        "users":              users.count(),
        "plans":              plan_counts,
        "clients":            Client.objects.count(),
        "deals":              Deal.objects.count(),
        "invoices":           Invoice.objects.count(),
        "activities":         Activity.objects.count(),
        "revenue_total":      float(revenue_total),
        "overdue_count":      overdue_count,
        "total_errors":       total_errors,
    })


# ── Workspace list ─────────────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsPlatformAdmin])
def workspace_list(request):
    """GET /api/superadmin/workspaces/"""
    from django.db.models import Sum, Count, Q
    workspaces = Workspace.objects.all().order_by("-created_at")
    result = []
    for ws in workspaces:
        user_count    = User.objects.filter(workspace=ws).count()
        client_count  = Client.objects.filter(workspace=ws).count()
        deal_count    = Deal.objects.filter(workspace=ws).count()
        invoice_stats = Invoice.objects.filter(workspace=ws).aggregate(
            total=Count("id"), revenue=Sum("amount_paid"),
            overdue=Count("id", filter=Q(status="overdue")),
        )
        error_count   = ErrorLog.objects.filter(workspace=ws).count()
        last_activity = AuditLog.objects.filter(workspace=ws).order_by("-created_at").first()
        owner = User.objects.filter(workspace=ws, role="business_owner").first()
        result.append({
            "id":            str(ws.id),
            "name":          ws.name,
            "slug":          ws.slug,
            "plan":          ws.plan,
            "is_active":     ws.is_active,
            "created_at":    ws.created_at.isoformat(),
            "users":         user_count,
            "clients":       client_count,
            "deals":         deal_count,
            "invoices":      invoice_stats["total"] or 0,
            "revenue":       float(invoice_stats["revenue"] or 0),
            "overdue":       invoice_stats["overdue"] or 0,
            "error_count":   error_count,
            "last_activity": last_activity.created_at.isoformat() if last_activity else None,
            "owner_email":   owner.email if owner else None,
        })
    return Response(result)


# ── Workspace detail ───────────────────────────────────────────────────────────

@api_view(["GET", "PATCH"])
@permission_classes([IsPlatformAdmin])
def workspace_detail(request, pk):
    """GET/PATCH /api/superadmin/workspaces/{pk}/"""
    try:
        ws = Workspace.objects.get(pk=pk)
    except Workspace.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    if request.method == "PATCH":
        if "plan" in request.data:
            ws.plan = request.data["plan"]
        if "is_active" in request.data:
            ws.is_active = bool(request.data["is_active"])
        if "name" in request.data:
            ws.name = request.data["name"]
        ws.save()

    from django.db.models import Sum, Count, Q
    invoice_stats = Invoice.objects.filter(workspace=ws).aggregate(
        total=Count("id"), revenue=Sum("amount_paid"),
        overdue=Count("id", filter=Q(status="overdue")),
        outstanding=Count("id", filter=Q(status__in=["sent","overdue","partially_paid"])),
    )
    owner = User.objects.filter(workspace=ws, role="business_owner").first()
    last_activity = AuditLog.objects.filter(workspace=ws).order_by("-created_at").first()
    return Response({
        "id":            str(ws.id),
        "name":          ws.name,
        "slug":          ws.slug,
        "plan":          ws.plan,
        "is_active":     ws.is_active,
        "created_at":    ws.created_at.isoformat(),
        "updated_at":    ws.updated_at.isoformat(),
        "last_activity": last_activity.created_at.isoformat() if last_activity else None,
        "owner_email":   owner.email if owner else None,
        "owner_name":    owner.full_name if owner else None,
        "owner_id":      str(owner.id) if owner else None,
        "owner_joined":  owner.date_joined.isoformat() if owner else None,
        "owner_last_login": owner.last_login.isoformat() if owner and owner.last_login else None,
        "stats": {
            "clients":    Client.objects.filter(workspace=ws).count(),
            "deals":      Deal.objects.filter(workspace=ws).count(),
            "activities": Activity.objects.filter(workspace=ws).count(),
            "invoices":   invoice_stats["total"] or 0,
            "revenue":    float(invoice_stats["revenue"] or 0),
            "overdue":    invoice_stats["overdue"] or 0,
            "outstanding": invoice_stats["outstanding"] or 0,
            "error_count": ErrorLog.objects.filter(workspace=ws).count(),
        },
    })


# ── Workspace users ────────────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsPlatformAdmin])
def workspace_users(request, pk):
    """GET /api/superadmin/workspaces/{pk}/users/"""
    try:
        ws = Workspace.objects.get(pk=pk)
    except Workspace.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    since_30d = timezone.now() - timedelta(days=30)
    users = User.objects.filter(workspace=ws)
    result = []
    for u in users:
        activity_count = AuditLog.objects.filter(user=u, created_at__gte=since_30d).count()
        result.append({
            "id":             str(u.id),
            "email":          u.email,
            "full_name":      u.full_name,
            "role":           u.role,
            "is_active":      u.is_active,
            "date_joined":    u.date_joined.isoformat(),
            "last_login":     u.last_login.isoformat() if u.last_login else None,
            "activity_30d":   activity_count,
        })
    return Response(result)


# ── Workspace activity log ─────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsPlatformAdmin])
def workspace_activity(request, pk):
    """GET /api/superadmin/workspaces/{pk}/activity/"""
    try:
        ws = Workspace.objects.get(pk=pk)
    except Workspace.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    logs = AuditLog.objects.filter(workspace=ws).select_related("user")[:50]
    return Response([{
        "id":         entry.id,
        "action":     entry.action,
        "table":      entry.table_name,
        "record_id":  entry.record_id,
        "user":       entry.user.full_name if entry.user else "—",
        "user_email": entry.user.email if entry.user else None,
        "created_at": entry.created_at.isoformat(),
    } for entry in logs])


# ── Pipeline stages for workspace ─────────────────────────────────────────────

@api_view(["GET", "PUT"])
@permission_classes([IsPlatformAdmin])
def workspace_pipeline_stages(request, pk):
    """
    GET  /api/superadmin/workspaces/{pk}/pipeline-stages/
    PUT  /api/superadmin/workspaces/{pk}/pipeline-stages/  — full replace
    """
    try:
        ws = Workspace.objects.get(pk=pk)
    except Workspace.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    if request.method == "PUT":
        stages_data = request.data  # list of {slug, label, color, order, follow_up_days}
        if not isinstance(stages_data, list):
            return Response({"detail": "Expected a list."}, status=400)

        existing = {s.slug: s for s in PipelineStageConfig.objects.filter(workspace=ws)}
        seen_slugs = set()
        for i, s in enumerate(stages_data):
            slug = s.get("slug", "").strip()
            if not slug:
                continue
            seen_slugs.add(slug)
            if slug in existing:
                cfg = existing[slug]
            else:
                cfg = PipelineStageConfig(workspace=ws, slug=slug)
            cfg.label          = s.get("label", slug)
            cfg.color          = s.get("color", "#1e3a5f")
            cfg.order          = s.get("order", i)
            cfg.follow_up_days = s.get("follow_up_days") or None
            cfg.notify_owner   = s.get("notify_owner", True)
            cfg.save()

        # remove deleted slugs
        PipelineStageConfig.objects.filter(workspace=ws).exclude(slug__in=seen_slugs).delete()

    stages = PipelineStageConfig.objects.filter(workspace=ws).order_by("order")
    return Response([{
        "slug":          s.slug,
        "label":         s.label,
        "color":         s.color,
        "order":         s.order,
        "follow_up_days": s.follow_up_days,
        "notify_owner":  s.notify_owner,
    } for s in stages])


# ── Registration tokens ────────────────────────────────────────────────────────

@api_view(["GET", "POST"])
@permission_classes([IsPlatformAdmin])
def registration_tokens(request):
    """
    GET  /api/superadmin/registration-tokens/  — list all tokens
    POST /api/superadmin/registration-tokens/  — create a new one
    """
    if request.method == "POST":
        note = request.data.get("note", "")
        days = int(request.data.get("days", 7))
        token = WorkspaceRegistrationToken.objects.create(
            created_by=request.user,
            note=note,
            expires_at=timezone.now() + timedelta(days=days),
        )
        from django.conf import settings as dj_settings
        frontend_url = getattr(dj_settings, "FRONTEND_URL", "http://localhost:5173")
        return Response({
            "id":         str(token.id),
            "note":       token.note,
            "url":        f"{frontend_url}/register?token={token.id}",
            "expires_at": token.expires_at.isoformat(),
            "used":       token.used,
            "created_at": token.created_at.isoformat(),
        }, status=201)

    tokens = WorkspaceRegistrationToken.objects.all()[:50]
    from django.conf import settings as dj_settings
    frontend_url = getattr(dj_settings, "FRONTEND_URL", "http://localhost:5173")
    return Response([{
        "id":         str(t.id),
        "note":       t.note,
        "url":        f"{frontend_url}/register?token={t.id}",
        "expires_at": t.expires_at.isoformat(),
        "used":       t.used,
        "used_by":    t.used_by.name if t.used_by else None,
        "created_at": t.created_at.isoformat(),
    } for t in tokens])


@api_view(["DELETE"])
@permission_classes([IsPlatformAdmin])
def registration_token_detail(request, pk):
    """DELETE /api/superadmin/registration-tokens/{pk}/"""
    try:
        token = WorkspaceRegistrationToken.objects.get(pk=pk)
    except WorkspaceRegistrationToken.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)
    token.delete()
    return Response(status=204)


# ── Feedback ───────────────────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsPlatformAdmin])
def feedback_list(request):
    """GET /api/superadmin/feedback/  — all tickets across all workspaces."""
    from apps.feedback.models import FeedbackTicket
    from django.db.models import Count

    qs = (
        FeedbackTicket.objects
        .select_related("workspace", "submitted_by")
        .annotate(comment_count=Count("comments"))
        .order_by("-created_at")
    )

    ws_id    = request.query_params.get("workspace")
    status_f = request.query_params.get("status")
    category = request.query_params.get("category")
    if ws_id:    qs = qs.filter(workspace_id=ws_id)
    if status_f: qs = qs.filter(status=status_f)
    if category: qs = qs.filter(category=category)

    return Response([{
        "id":                  str(t.id),
        "title":               t.title,
        "category":            t.category,
        "priority":            t.priority,
        "status":              t.status,
        "workspace_id":        str(t.workspace_id),
        "workspace_name":      t.workspace.name,
        "submitted_by":        t.submitted_by.full_name if t.submitted_by else "—",
        "submitted_by_email":  t.submitted_by.email if t.submitted_by else None,
        "comment_count":       t.comment_count,
        "created_at":          t.created_at.isoformat(),
        "updated_at":          t.updated_at.isoformat(),
    } for t in qs])


@api_view(["GET", "PATCH"])
@permission_classes([IsPlatformAdmin])
def feedback_detail(request, pk):
    """GET/PATCH /api/superadmin/feedback/{pk}/"""
    from apps.feedback.models import FeedbackTicket, FeedbackComment

    try:
        ticket = FeedbackTicket.objects.select_related("workspace", "submitted_by").get(pk=pk)
    except FeedbackTicket.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    if request.method == "PATCH":
        for field in ("title", "description", "priority", "category"):
            if field in request.data:
                setattr(ticket, field, request.data[field])
        if "status" in request.data:
            ticket.status = request.data["status"]
            if request.data["status"] == FeedbackTicket.Status.CLOSED:
                ticket.closed_at = timezone.now()
        ticket.save()

    comments = FeedbackComment.objects.filter(ticket=ticket).select_related("created_by").order_by("created_at")
    return Response({
        "id":                  str(ticket.id),
        "title":               ticket.title,
        "description":         ticket.description,
        "category":            ticket.category,
        "priority":            ticket.priority,
        "status":              ticket.status,
        "page_url":            ticket.page_url,
        "screenshot_data":     ticket.screenshot_data,
        "workspace_id":        str(ticket.workspace_id),
        "workspace_name":      ticket.workspace.name,
        "submitted_by":        ticket.submitted_by.full_name if ticket.submitted_by else "—",
        "submitted_by_email":  ticket.submitted_by.email if ticket.submitted_by else None,
        "created_at":          ticket.created_at.isoformat(),
        "updated_at":          ticket.updated_at.isoformat(),
        "closed_at":           ticket.closed_at.isoformat() if ticket.closed_at else None,
        "comments": [{
            "id":         str(c.id),
            "text":       c.text,
            "created_by": c.created_by.full_name if c.created_by else "Admin",
            "is_admin":   getattr(c.created_by, "role", None) == "platform_admin",
            "created_at": c.created_at.isoformat(),
        } for c in comments],
    })


@api_view(["POST"])
@permission_classes([IsPlatformAdmin])
def feedback_comment(request, pk):
    """POST /api/superadmin/feedback/{pk}/comment/"""
    from apps.feedback.models import FeedbackTicket, FeedbackComment

    try:
        ticket = FeedbackTicket.objects.select_related("workspace").get(pk=pk)
    except FeedbackTicket.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    text = request.data.get("text", "").strip()
    if not text:
        return Response({"detail": "Comment text is required."}, status=400)

    comment = FeedbackComment.objects.create(
        ticket=ticket,
        workspace=ticket.workspace,
        text=text,
        created_by=request.user,
    )
    return Response({
        "id":         str(comment.id),
        "text":       comment.text,
        "created_by": request.user.full_name,
        "is_admin":   True,
        "created_at": comment.created_at.isoformat(),
    }, status=201)


# ── Workspace error log ────────────────────────────────────────────────────────

SUGGESTION_MAP = {
    "OperationalError":        "Database connection issue — check DB container health and connection pool.",
    "ProgrammingError":        "SQL or schema mismatch — a migration may be missing or unapplied.",
    "IntegrityError":          "Constraint violation — duplicate key or missing required FK.",
    "ValidationError":         "Bad input reached the backend — check the API payload from the client.",
    "PermissionDenied":        "A permission check failed unexpectedly — review role/workspace logic.",
    "AuthenticationFailed":    "JWT or token issue — check token expiry settings and secret keys.",
    "NotAuthenticated":        "An API call was made without a valid token — likely a frontend auth bug.",
    "ConnectionError":         "External service unreachable — check email (SES), S3, or Redis config.",
    "TimeoutError":            "A task or query timed out — look for slow queries or overloaded workers.",
    "ImproperlyConfigured":    "Missing or invalid setting — check environment variables and settings files.",
    "FileNotFoundError":       "A file path is wrong or the file was deleted — check S3/MinIO and media config.",
    "KeyError":                "Missing key in dict or config — often a missing env var or changed API response.",
    "AttributeError":          "None or unexpected object type — check for unguarded optional fields.",
    "celery":                  "Celery task failure — ensure the worker is running and the task module is imported.",
}

def _suggest(error_type: str, source: str) -> str:
    if source == "celery":
        return SUGGESTION_MAP.get(error_type) or SUGGESTION_MAP["celery"]
    return SUGGESTION_MAP.get(error_type, "Review the traceback for details and check recent deployments or config changes.")


# ── Activity type config (per workspace) ──────────────────────────────────────

@api_view(["GET", "POST"])
@permission_classes([IsPlatformAdmin])
def workspace_activity_types(request, pk):
    """
    GET  /api/superadmin/workspaces/{pk}/activity-types/  — list (seeds built-ins if empty)
    POST /api/superadmin/workspaces/{pk}/activity-types/  — create custom type
    """
    from apps.activities.models import ActivityTypeConfig, BUILTIN_TYPES

    try:
        ws = Workspace.objects.get(pk=pk)
    except Workspace.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    _BUILTIN_COLORS = {
        "appointment": "#1B3A6B", "task": "#2e7d32", "call": "#6a1b9a",
        "session": "#c76a1b",     "training": "#1565c0", "travel": "#546e7a",
        "custom": "#795548",
    }

    if not ActivityTypeConfig.objects.filter(workspace=ws).exists():
        for i, name in enumerate(BUILTIN_TYPES):
            ActivityTypeConfig.objects.get_or_create(
                workspace=ws, name=name,
                defaults={"color": _BUILTIN_COLORS.get(name, "#1a1714"),
                          "is_builtin": True, "is_active": True, "sort_order": i},
            )

    if request.method == "POST":
        name = request.data.get("name", "").strip()
        if not name:
            return Response({"detail": "Name is required."}, status=400)
        if ActivityTypeConfig.objects.filter(workspace=ws, name__iexact=name).exists():
            return Response({"detail": "An activity type with this name already exists."}, status=400)
        obj = ActivityTypeConfig.objects.create(
            workspace=ws,
            name=name,
            color=request.data.get("color", "#1a1714"),
            is_active=request.data.get("is_active", True),
            is_builtin=False,
            sort_order=ActivityTypeConfig.objects.filter(workspace=ws).count(),
        )
        return Response(_serialize_type(obj), status=201)

    qs = ActivityTypeConfig.objects.filter(workspace=ws).order_by("sort_order", "name")
    return Response([_serialize_type(t) for t in qs])


def _serialize_type(t):
    return {
        "id":         t.id,
        "name":       t.name,
        "color":      t.color,
        "is_active":  t.is_active,
        "is_builtin": t.is_builtin,
        "sort_order": t.sort_order,
    }


@api_view(["PATCH", "DELETE"])
@permission_classes([IsPlatformAdmin])
def workspace_activity_type_detail(request, pk, type_pk):
    """
    PATCH  /api/superadmin/workspaces/{pk}/activity-types/{type_pk}/
    DELETE /api/superadmin/workspaces/{pk}/activity-types/{type_pk}/
    """
    from apps.activities.models import ActivityTypeConfig

    try:
        obj = ActivityTypeConfig.objects.get(pk=type_pk, workspace_id=pk)
    except ActivityTypeConfig.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    if request.method == "DELETE":
        if obj.is_builtin:
            return Response({"detail": "Built-in activity types cannot be deleted."}, status=400)
        obj.delete()
        return Response(status=204)

    for field in ("name", "color", "is_active", "sort_order"):
        if field in request.data:
            setattr(obj, field, request.data[field])
    obj.save()
    return Response(_serialize_type(obj))


@api_view(["POST"])
@permission_classes([IsPlatformAdmin])
def workspace_user_set_password(request, pk, user_pk):
    """
    POST /api/superadmin/workspaces/{pk}/users/{user_pk}/set-password/
    Body: { "password": "newpassword" }
    Directly sets a user's password without sending any email.
    """
    try:
        ws = Workspace.objects.get(pk=pk)
    except Workspace.DoesNotExist:
        return Response({"detail": "Workspace not found."}, status=404)

    try:
        user = User.objects.get(pk=user_pk, workspace=ws)
    except User.DoesNotExist:
        return Response({"detail": "User not found in this workspace."}, status=404)

    password = (request.data.get("password") or "").strip()
    if len(password) < 8:
        return Response({"detail": "Password must be at least 8 characters."}, status=400)

    user.set_password(password)
    user.save(update_fields=["password"])
    return Response({"detail": f"Password updated for {user.email}."})


@api_view(["GET"])
@permission_classes([IsPlatformAdmin])
def workspace_invoices(request, pk):
    """GET /api/superadmin/workspaces/{pk}/invoices/"""
    try:
        ws = Workspace.objects.get(pk=pk)
    except Workspace.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    invoices = Invoice.objects.filter(workspace=ws).select_related("client").order_by("-created_at")
    return Response([{
        "id":          str(inv.id),
        "number":      inv.number,
        "client_name": inv.client.full_name if inv.client else "—",
        "status":      inv.status,
        "total":       float(inv.total),
        "amount_paid": float(inv.amount_paid),
        "currency":    inv.currency,
        "issue_date":  inv.issue_date.isoformat() if inv.issue_date else None,
        "due_date":    inv.due_date.isoformat() if inv.due_date else None,
        "sent_at":     inv.sent_at.isoformat() if inv.sent_at else None,
    } for inv in invoices])


@api_view(["GET"])
@permission_classes([IsPlatformAdmin])
def workspace_errors(request, pk):
    """GET /api/superadmin/workspaces/{pk}/errors/"""
    try:
        ws = Workspace.objects.get(pk=pk)
    except Workspace.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    logs = ErrorLog.objects.filter(workspace=ws).select_related("user")[:100]
    return Response([{
        "id":         entry.id,
        "severity":   entry.severity,
        "source":     entry.source,
        "error_type": entry.error_type,
        "message":    entry.message,
        "traceback":  entry.traceback,
        "endpoint":   entry.endpoint,
        "user":       entry.user.full_name if entry.user else None,
        "user_email": entry.user.email if entry.user else None,
        "suggestion": _suggest(entry.error_type, entry.source),
        "created_at": entry.created_at.isoformat(),
    } for entry in logs])


@api_view(["POST"])
@permission_classes([IsPlatformAdmin])
def workspace_reset_password(request, pk):
    """
    POST /api/superadmin/workspaces/<pk>/reset-password/
    Body: { "user_id": "<uuid>" }  — optional; defaults to the business owner.
    Generates a password-reset token and sends the reset email on behalf of the admin.
    """
    from django.contrib.auth.tokens import default_token_generator
    from django.utils.http import urlsafe_base64_encode
    from django.utils.encoding import force_bytes
    from django.core.mail import EmailMultiAlternatives
    from django.conf import settings as dj_settings
    import logging
    logger = logging.getLogger(__name__)

    try:
        ws = Workspace.objects.get(pk=pk)
    except Workspace.DoesNotExist:
        return Response({"detail": "Workspace not found."}, status=404)

    user_id = request.data.get("user_id")
    if user_id:
        try:
            user = User.objects.get(pk=user_id, workspace=ws)
        except User.DoesNotExist:
            return Response({"detail": "User not found in this workspace."}, status=404)
    else:
        user = User.objects.filter(workspace=ws, role="business_owner").first()
        if not user:
            return Response({"detail": "No business owner found for this workspace."}, status=404)

    uid       = urlsafe_base64_encode(force_bytes(user.pk))
    token     = default_token_generator.make_token(user)
    base_url  = getattr(dj_settings, "FRONTEND_URL", "http://localhost:5173")
    reset_url = f"{base_url}/reset-password?uid={uid}&token={token}"

    plain = (
        f"Hi {user.full_name},\n\n"
        f"A CoachOS administrator has initiated a password reset for your account.\n\n"
        f"Reset here: {reset_url}\n\n"
        f"This link expires in 24 hours."
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
      <h2 style="margin:0 0 16px;font-size:22px;color:#16130f;">Password reset requested</h2>
      <p style="color:#4a443e;line-height:1.6;">Hi {user.full_name},<br><br>
         A CoachOS administrator has initiated a password reset for your account.
         Click below to choose a new password.</p>
      <div style="text-align:center;margin:32px 0;">
        <a href="{reset_url}" style="background:#1B3A6B;color:#fff;padding:14px 32px;
           text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;display:inline-block;">
          Reset Password
        </a>
      </div>
      <p style="color:#8c8279;font-size:13px;">This link expires in 24 hours.<br>
         If you did not expect this, please contact your platform administrator.</p>
    </td></tr>
  </table></td></tr>
</table>
</body></html>"""

    try:
        msg = EmailMultiAlternatives(
            subject="Your CoachOS password has been reset",
            body=plain,
            from_email=dj_settings.DEFAULT_FROM_EMAIL,
            to=[user.email],
        )
        msg.attach_alternative(html, "text/html")
        msg.send()
    except Exception as exc:
        logger.error(f"workspace_reset_password email failed for {user.email}: {exc}")
        return Response({"detail": f"Reset link generated but email delivery failed: {exc}",
                         "reset_url": reset_url}, status=http_status.HTTP_207_MULTI_STATUS)

    return Response({"detail": f"Password reset email sent to {user.email}.", "email": user.email})


# ── Client statuses for workspace ─────────────────────────────────────────────

@api_view(["GET", "POST"])
@permission_classes([IsPlatformAdmin])
def workspace_client_statuses(request, pk):
    """GET/POST /api/superadmin/workspaces/{pk}/client-statuses/"""
    try:
        ws = Workspace.objects.get(pk=pk)
    except Workspace.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    _seed_client_statuses(ws)

    if request.method == "GET":
        qs = ClientStatusConfig.objects.filter(workspace=ws).order_by("order", "label")
        return Response(ClientStatusConfigSerializer(qs, many=True).data)

    ser = ClientStatusConfigSerializer(data=request.data)
    if ser.is_valid():
        ser.save(workspace=ws, is_builtin=False)
        return Response(ser.data, status=201)
    return Response(ser.errors, status=400)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsPlatformAdmin])
def workspace_client_status_detail(request, pk, status_pk):
    """PATCH/DELETE /api/superadmin/workspaces/{pk}/client-statuses/{status_pk}/"""
    try:
        ws = Workspace.objects.get(pk=pk)
        obj = ClientStatusConfig.objects.get(pk=status_pk, workspace=ws)
    except (Workspace.DoesNotExist, ClientStatusConfig.DoesNotExist):
        return Response({"detail": "Not found."}, status=404)

    if request.method == "DELETE":
        if obj.is_builtin:
            return Response({"detail": "Cannot delete built-in statuses."}, status=400)
        obj.delete()
        return Response(status=204)

    ser = ClientStatusConfigSerializer(obj, data=request.data, partial=True)
    if ser.is_valid():
        ser.save()
        return Response(ser.data)
    return Response(ser.errors, status=400)


# ── Client tags for workspace ──────────────────────────────────────────────────

@api_view(["GET", "POST"])
@permission_classes([IsPlatformAdmin])
def workspace_client_tags(request, pk):
    """GET/POST /api/superadmin/workspaces/{pk}/client-tags/"""
    try:
        ws = Workspace.objects.get(pk=pk)
    except Workspace.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    if request.method == "GET":
        qs = ClientTagConfig.objects.filter(workspace=ws).order_by("name")
        return Response(ClientTagConfigSerializer(qs, many=True).data)

    ser = ClientTagConfigSerializer(data=request.data)
    if ser.is_valid():
        ser.save(workspace=ws)
        return Response(ser.data, status=201)
    return Response(ser.errors, status=400)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsPlatformAdmin])
def workspace_client_tag_detail(request, pk, tag_pk):
    """PATCH/DELETE /api/superadmin/workspaces/{pk}/client-tags/{tag_pk}/"""
    try:
        ws = Workspace.objects.get(pk=pk)
        obj = ClientTagConfig.objects.get(pk=tag_pk, workspace=ws)
    except (Workspace.DoesNotExist, ClientTagConfig.DoesNotExist):
        return Response({"detail": "Not found."}, status=404)

    if request.method == "DELETE":
        obj.delete()
        return Response(status=204)

    ser = ClientTagConfigSerializer(obj, data=request.data, partial=True)
    if ser.is_valid():
        ser.save()
        return Response(ser.data)
    return Response(ser.errors, status=400)
