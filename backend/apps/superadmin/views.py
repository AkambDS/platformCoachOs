"""CoachOS — Superadmin API (platform_admin role or is_staff)"""
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.response import Response
from rest_framework import status as http_status
from rest_framework.permissions import AllowAny
from apps.accounts.permissions import IsPlatformAdmin
from django.utils import timezone
from datetime import timedelta

from apps.accounts.models import Workspace, User, WorkspaceInvitation, WorkspaceRegistrationToken, AuditLog, ErrorLog
from .models import PlatformInvoice, PlatformPayment
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

    recent_logs = AuditLog.objects.select_related("user", "workspace").order_by("-created_at")[:10]
    audit_log_entries = [{
        "id":             entry.id,
        "action":         entry.action,
        "table":          entry.table_name,
        "record_id":      entry.record_id,
        "user":           entry.user.full_name if entry.user else "—",
        "user_email":     entry.user.email if entry.user else None,
        "workspace_name": entry.workspace.name if entry.workspace else None,
        "created_at":     entry.created_at.isoformat(),
    } for entry in recent_logs]

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
        "audit_logs":         audit_log_entries,
    })


# ── Workspace list ─────────────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsPlatformAdmin])
def workspace_list(request):
    """GET /api/superadmin/workspaces/"""
    from django.db.models import Sum, Count, Q
    workspaces = Workspace.objects.all().order_by("-pending_activation", "-created_at")
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
            "is_active":          ws.is_active,
            "pending_activation": ws.pending_activation,
            "created_at":    ws.created_at.isoformat(),
            "users":         user_count,
            "clients":       client_count,
            "deals":         deal_count,
            "invoices":      invoice_stats["total"] or 0,
            "revenue":       float(invoice_stats["revenue"] or 0),
            "overdue":       invoice_stats["overdue"] or 0,
            "error_count":   error_count,
            "last_activity":      last_activity.created_at.isoformat() if last_activity else None,
            "owner_email":        owner.email if owner else None,
            "owner_last_login":   owner.last_login.isoformat() if owner and owner.last_login else None,
            "owner_role":         owner.role if owner else None,
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
            if ws.is_active and ws.pending_activation:
                ws.pending_activation = False
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
        "is_active":          ws.is_active,
        "pending_activation": ws.pending_activation,
        "created_at":    ws.created_at.isoformat(),
        "updated_at":    ws.updated_at.isoformat(),
        "last_activity": last_activity.created_at.isoformat() if last_activity else None,
        "owner_email":   owner.email if owner else None,
        "owner_name":    owner.full_name if owner else None,
        "owner_id":      str(owner.id) if owner else None,
        "owner_joined":  owner.date_joined.isoformat() if owner else None,
        "owner_last_login": owner.last_login.isoformat() if owner and owner.last_login else None,
        "owner_role":       owner.role if owner else None,
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
    from django.conf import settings as dj_settings
    frontend_url = getattr(dj_settings, "FRONTEND_URL", "http://localhost:5173")

    def _fmt(t):
        return {
            "id":               str(t.id),
            "note":             t.note,
            "recipient_name":   t.recipient_name,
            "recipient_email":  t.recipient_email,
            "url":              f"{frontend_url}/register?token={t.id}",
            "expires_at":       t.expires_at.isoformat(),
            "used":             t.used,
            "used_by":          t.used_by.name if t.used_by else None,
            "used_by_id":       str(t.used_by.id) if t.used_by else None,
            "used_by_pending":  t.used_by.pending_activation if t.used_by else False,
            "created_at":       t.created_at.isoformat(),
        }

    if request.method == "POST":
        days = int(request.data.get("days", 7))
        recipient_name  = request.data.get("recipient_name", "").strip()
        recipient_email = request.data.get("recipient_email", "").strip()

        if not recipient_name or not recipient_email:
            return Response({"detail": "Owner name and email are required."}, status=400)

        # Block if this email is already a registered workspace owner.
        if User.objects.filter(email__iexact=recipient_email, role="business_owner").exists():
            return Response(
                {"detail": f"{recipient_email} is already a registered workspace owner. No invite needed."},
                status=400,
            )

        # Revoke any existing unused tokens for the same email so old links stop working.
        WorkspaceRegistrationToken.objects.filter(
            recipient_email__iexact=recipient_email, used=False
        ).delete()

        note = recipient_name
        token = WorkspaceRegistrationToken.objects.create(
            created_by=request.user,
            note=note,
            recipient_name=recipient_name,
            recipient_email=recipient_email,
            expires_at=timezone.now() + timedelta(days=days),
        )

        # Send the invite email with the registration link.
        register_url = f"{frontend_url}/register?token={token.id}"
        expires_str  = token.expires_at.strftime("%B %d, %Y")
        try:
            from django.core.mail import EmailMultiAlternatives
            import logging
            logger = logging.getLogger(__name__)
            plain = (
                f"Hi {recipient_name},\n\n"
                f"You've been invited to create your coaching workspace on CoachOS.\n\n"
                f"Click the link below to set up your workspace:\n{register_url}\n\n"
                f"This link expires on {expires_str} and can only be used once.\n\n"
                f"If you have any questions, reply to this email."
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
      <h2 style="margin:0 0 16px;font-size:22px;color:#16130f;">You're invited to CoachOS</h2>
      <p style="color:#4a443e;line-height:1.6;margin:0 0 24px;">
        Hi {recipient_name},<br><br>
        You've been invited to create your coaching workspace on CoachOS — a dedicated platform to manage clients, sessions, invoices, and your pipeline.
      </p>
      <div style="text-align:center;margin:0 0 32px;">
        <a href="{register_url}" style="background:#1B3A6B;color:#fff;padding:14px 32px;
           text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;display:inline-block;">
          Set Up My Workspace
        </a>
      </div>
      <p style="color:#8c8279;font-size:13px;margin:0;">
        This link expires on <strong>{expires_str}</strong> and can only be used once.<br>
        If you did not expect this invitation, you can safely ignore this email.
      </p>
    </td></tr>
  </table></td></tr>
</table>
</body></html>"""
            msg = EmailMultiAlternatives(
                subject="You're invited to set up your CoachOS workspace",
                body=plain,
                from_email=dj_settings.DEFAULT_FROM_EMAIL,
                to=[recipient_email],
            )
            msg.attach_alternative(html, "text/html")
            msg.send()
            logger.info(f"Registration invite sent to {recipient_email}")
        except Exception as exc:
            import logging
            logging.getLogger(__name__).error(f"Registration invite email failed for {recipient_email}: {exc}")
            # Token still created — admin can copy the link manually.

        return Response(_fmt(token), status=201)

    tokens = WorkspaceRegistrationToken.objects.all()[:50]
    return Response([_fmt(t) for t in tokens])


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
        "custom": "#795548",      "client_communication": "#0d6e6e",
    }

    existing = set(ActivityTypeConfig.objects.filter(
        workspace=ws, is_builtin=True
    ).values_list("name", flat=True))
    missing = [n for n in BUILTIN_TYPES if n not in existing]
    if missing:
        start = ActivityTypeConfig.objects.filter(workspace=ws).count()
        for i, name in enumerate(missing):
            ActivityTypeConfig.objects.get_or_create(
                workspace=ws, name=name,
                defaults={"color": _BUILTIN_COLORS.get(name, "#1a1714"),
                          "is_builtin": True, "is_active": True, "sort_order": start + i},
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

    logs = ErrorLog.objects.filter(workspace=ws).select_related("user").order_by("-created_at")[:10]
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
        qs = ClientStatusConfig.objects.filter(workspace=ws).order_by("sort_order", "label")
        return Response(ClientStatusConfigSerializer(qs, many=True).data)

    ser = ClientStatusConfigSerializer(data=request.data)
    if ser.is_valid():
        try:
            ser.save(workspace=ws, is_builtin=False)
            return Response(ser.data, status=201)
        except Exception:
            return Response({"detail": "A status with that label already exists."}, status=400)
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


# ── Workspace Audit Log ───────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsPlatformAdmin])
def workspace_audit_log(request, pk):
    """GET /api/superadmin/workspaces/{pk}/audit-log/"""
    from apps.audit.models import AccessLog
    try:
        ws = Workspace.objects.get(pk=pk)
    except Workspace.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    logs = (AccessLog.objects
            .filter(workspace=ws)
            .order_by("-created_at")[:20])
    return Response([{
        "id":          l.id,
        "user_name":   l.user_name,
        "client_name": l.client_name,
        "action":      l.action,
        "metadata":    l.metadata,
        "created_at":  l.created_at.isoformat(),
    } for l in logs])


# ── Maintenance Banner ────────────────────────────────────────────────────────

def _banner_data(banner):
    return {
        "id":         banner.id,
        "message":    banner.message,
        "is_active":  banner.is_active,
        "created_at": banner.created_at.isoformat(),
        "updated_at": banner.updated_at.isoformat(),
    }


@api_view(["GET"])
@permission_classes([AllowAny])
@throttle_classes([])
def public_banner(request):
    """GET /api/system/banner/ — public, no auth. Returns first active banner with content."""
    from apps.superadmin.models import MaintenanceBanner
    banner = MaintenanceBanner.objects.filter(is_active=True).exclude(message='').first()
    if not banner:
        return Response({"is_active": False, "message": ""})
    return Response({"is_active": True, "message": banner.message})


@api_view(["GET", "POST"])
@permission_classes([IsPlatformAdmin])
def admin_banners(request):
    """GET /api/superadmin/banners/ — list all | POST — create new."""
    from apps.superadmin.models import MaintenanceBanner
    if request.method == "POST":
        msg = (request.data.get("message") or "").strip()
        if not msg:
            return Response({"detail": "Message is required."}, status=400)
        banner = MaintenanceBanner.objects.create(
            message=msg,
            is_active=request.data.get("is_active", False),
        )
        return Response(_banner_data(banner), status=201)
    banners = MaintenanceBanner.objects.all()
    return Response([_banner_data(b) for b in banners])


@api_view(["PATCH", "DELETE"])
@permission_classes([IsPlatformAdmin])
def admin_banner_detail(request, pk):
    """PATCH /api/superadmin/banners/{pk}/ — toggle or edit | DELETE — remove."""
    from apps.superadmin.models import MaintenanceBanner
    try:
        banner = MaintenanceBanner.objects.get(pk=pk)
    except MaintenanceBanner.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)
    if request.method == "DELETE":
        banner.delete()
        return Response(status=204)
    if "message" in request.data:
        banner.message = request.data["message"]
    if "is_active" in request.data:
        banner.is_active = bool(request.data["is_active"])
    banner.save()
    return Response(_banner_data(banner))


# ── Platform Invoices (CoachOS billing to workspace owners) ───────────────────

def _parse_date(val):
    from datetime import date as _date
    if not val:
        return None
    return val if isinstance(val, _date) else _date.fromisoformat(str(val))


def _platform_invoice_data(inv, include_payments=True):
    from django.conf import settings as dj_settings
    backend_base = getattr(dj_settings, "BACKEND_URL", "").rstrip("/")
    logo_url = f"{backend_base}/api/settings/logo/{inv.workspace_id}/" if inv.workspace.logo_data else ""

    payments = []
    paid_total = 0
    if include_payments:
        for p in inv.payments.all():
            payments.append({
                "id":           p.id,
                "amount":       str(p.amount),
                "payment_date": p.payment_date.isoformat(),
                "method":       p.method,
                "notes":        p.notes,
                "created_at":   p.created_at.isoformat(),
            })
            paid_total += float(p.amount)

    return {
        "id":                inv.id,
        "workspace_id":      str(inv.workspace_id),
        "workspace_name":    inv.workspace.name,
        "workspace_logo":    logo_url,
        "logo_data":           inv.logo_data or "",
        "show_platform_text":  inv.show_platform_text,
        "billed_to_name":      inv.billed_to_name or "",
        "billed_to_email":     inv.billed_to_email or "",
        "billed_to_extra":     inv.billed_to_extra or "",
        "owner_email":         User.objects.filter(workspace=inv.workspace, role="business_owner").values_list("email", flat=True).first() or "",
        "amount":            str(inv.amount),
        "plan":              inv.plan,
        "period_start":      inv.period_start.isoformat() if inv.period_start else None,
        "period_end":        inv.period_end.isoformat() if inv.period_end else None,
        "notes":             inv.notes,
        "line_items":        inv.line_items or [],
        "status":            inv.status,
        "is_recurring":      inv.is_recurring,
        "recurrence_months": inv.recurrence_months,
        "payments":          payments,
        "paid_total":        str(round(paid_total, 2)),
        "created_at":        inv.created_at.isoformat(),
    }


@api_view(["GET", "POST"])
@permission_classes([IsPlatformAdmin])
def platform_invoices(request):
    """GET /api/superadmin/platform-invoices/ — list all platform invoices.
       POST — create a new platform invoice."""
    if request.method == "POST":
        ws_id = request.data.get("workspace_id")
        try:
            ws = Workspace.objects.get(pk=ws_id)
        except Workspace.DoesNotExist:
            return Response({"detail": "Workspace not found."}, status=404)
        inv = PlatformInvoice.objects.create(
            workspace         = ws,
            amount            = request.data.get("amount", 0),
            plan              = request.data.get("plan", ws.plan),
            period_start      = _parse_date(request.data.get("period_start")),
            period_end        = _parse_date(request.data.get("period_end")),
            notes             = request.data.get("notes", ""),
            status            = request.data.get("status", "draft"),
            line_items        = request.data.get("line_items", []),
            is_recurring      = request.data.get("is_recurring", False),
            recurrence_months = request.data.get("recurrence_months", 1),
            logo_data           = request.data.get("logo_data", ""),
            show_platform_text  = request.data.get("show_platform_text", True),
            billed_to_name      = request.data.get("billed_to_name", ""),
            billed_to_email     = request.data.get("billed_to_email", ""),
            billed_to_extra     = request.data.get("billed_to_extra", ""),
        )
        return Response(_platform_invoice_data(inv), status=201)

    workspace_id = request.query_params.get("workspace_id")
    qs = PlatformInvoice.objects.select_related("workspace").all()
    if workspace_id:
        qs = qs.filter(workspace_id=workspace_id)
    return Response([_platform_invoice_data(i) for i in qs])


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsPlatformAdmin])
def platform_invoice_detail(request, pk):
    """GET/PATCH/DELETE /api/superadmin/platform-invoices/{pk}/"""
    try:
        inv = PlatformInvoice.objects.select_related("workspace").get(pk=pk)
    except PlatformInvoice.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    if request.method == "DELETE":
        inv.delete()
        return Response(status=204)

    if request.method == "PATCH":
        for field in ("amount", "plan", "notes", "status", "line_items", "is_recurring", "recurrence_months",
                      "logo_data", "show_platform_text", "billed_to_name", "billed_to_email", "billed_to_extra"):
            if field in request.data:
                setattr(inv, field, request.data[field])
        if "period_start" in request.data:
            inv.period_start = _parse_date(request.data["period_start"])
        if "period_end" in request.data:
            inv.period_end = _parse_date(request.data["period_end"])
        inv.save()

    return Response(_platform_invoice_data(inv))


def _li_total(li):
    qty  = float(li.get('quantity', 1) or 1)
    rate = float(li.get('rate') or li.get('unit_price') or 0)
    if li.get('line_type') == 'fixed':
        return qty * rate
    hours = float(li.get('hours') or 0)
    if 'hours' in li or 'rate' in li:
        return qty * hours * rate
    return qty * rate


def _invoice_html(inv):
    """Shared A4-ready HTML for WeasyPrint PDF and print window."""
    from django.conf import settings as dj_settings
    from datetime import date as _date

    backend_base = getattr(dj_settings, "BACKEND_URL", "").rstrip("/")
    logo_src     = inv.logo_data or (f"{backend_base}/api/settings/logo/{inv.workspace_id}/" if inv.workspace.logo_data else "")
    owner_email  = User.objects.filter(workspace=inv.workspace, role="business_owner").values_list("email", flat=True).first() or ""
    billed_name  = inv.billed_to_name  or inv.workspace.name
    billed_email = inv.billed_to_email or owner_email
    billed_extra = inv.billed_to_extra or ""

    logo_html     = f'<img src="{logo_src}" style="max-height:44px;max-width:140px;object-fit:contain;display:block;margin-bottom:8px">' if logo_src else ""
    branding_html = '<div style="font-family:Georgia,serif;font-size:20px;font-weight:300">CoachOS</div><div style="font-size:11px;color:#8c8279">Coaching Management Platform</div>' if inv.show_platform_text else ""
    extra_html    = "".join(f'<div style="font-size:12px;color:#8c8279;margin-top:2px">{ln}</div>' for ln in billed_extra.split('\n')) if billed_extra else ""
    email_html    = f'<div style="font-size:13px;color:#8c8279">{billed_email}</div>' if billed_email else ""

    period  = f"{inv.period_start.strftime('%Y-%m-%d')} – {inv.period_end.strftime('%Y-%m-%d')}"
    issued  = inv.created_at.strftime('%b %d, %Y')
    line_items = inv.line_items or []

    if line_items:
        rows = ""
        for li in line_items:
            is_fixed   = li.get('line_type') == 'fixed'
            hours_cell = "—" if is_fixed else str(li.get('hours') or 0)
            hours_color = "color:#8c8279;" if is_fixed else ""
            rate_val   = float(li.get('rate') or li.get('unit_price') or 0)
            total      = _li_total(li)
            rows += (
                f"<tr>"
                f"<td style='padding:10px;border-bottom:1px solid #ede9e1;font-size:13px'>{li.get('description','')}</td>"
                f"<td style='padding:10px;border-bottom:1px solid #ede9e1;text-align:center;font-size:13px'>{li.get('quantity',1)}</td>"
                f"<td style='padding:10px;border-bottom:1px solid #ede9e1;text-align:center;font-size:13px;{hours_color}'>{hours_cell}</td>"
                f"<td style='padding:10px;border-bottom:1px solid #ede9e1;text-align:right;font-size:13px'>${rate_val:.2f}</td>"
                f"<td style='padding:10px;border-bottom:1px solid #ede9e1;font-weight:600;text-align:right;font-size:13px'>${total:.2f}</td>"
                f"</tr>"
            )
        items_section = (
            f"<table style='width:100%;border-collapse:collapse;margin-bottom:20px'>"
            f"<thead><tr style='background:#f8f6f2'>"
            f"<th style='padding:8px 10px;text-align:left;font-size:11px;color:#8c8279;text-transform:uppercase'>Description</th>"
            f"<th style='padding:8px 10px;text-align:center;font-size:11px;color:#8c8279;width:50px'>Qty</th>"
            f"<th style='padding:8px 10px;text-align:center;font-size:11px;color:#8c8279;width:65px'>Hours</th>"
            f"<th style='padding:8px 10px;text-align:right;font-size:11px;color:#8c8279;width:80px'>Rate</th>"
            f"<th style='padding:8px 10px;text-align:right;font-size:11px;color:#8c8279;width:90px'>Total</th>"
            f"</tr></thead><tbody>{rows}</tbody></table>"
        )
        total_amount = sum(_li_total(li) for li in line_items)
    else:
        items_section = "<div style='border-top:1px solid #ede9e1;margin-bottom:20px'></div>"
        total_amount  = float(inv.amount)

    notes_html = f'<div style="margin-top:20px;font-size:12px;color:#8c8279;border-left:3px solid #b8922e;padding-left:12px">{inv.notes}</div>' if inv.notes else ""
    generated  = _date.today().strftime('%B %d, %Y')

    return f"""<!doctype html>
<html><head><meta charset="utf-8"><style>
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{font-family:Helvetica,Arial,sans-serif;color:#1a1714;padding:28px;max-width:760px;margin:0 auto}}
  @page{{margin:15mm}}
  @media print{{body{{padding:0}}}}
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid #1a1714">
  <div>{logo_html}{branding_html}</div>
  <div style="text-align:right">
    <div style="font-family:Georgia,serif;font-size:28px;font-weight:300">INVOICE</div>
    <div style="font-size:12px;color:#8c8279;margin-top:4px">#{inv.id}</div>
  </div>
</div>
<div style="display:flex;justify-content:space-between;margin-bottom:28px">
  <div>
    <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8c8279;margin-bottom:6px">Billed to</div>
    <div style="font-size:14px;font-weight:600">{billed_name}</div>
    {email_html}{extra_html}
  </div>
  <div style="text-align:right">
    <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8c8279;margin-bottom:6px">Details</div>
    <div style="font-size:13px">Period: {period}</div>
    <div style="font-size:13px;color:#8c8279">Issued: {issued}</div>
  </div>
</div>
{items_section}
<div style="border-top:2px solid #1a1714;padding-top:12px;display:flex;justify-content:space-between;align-items:baseline">
  <span style="font-size:15px;font-weight:700">Total Due</span>
  <span style="font-family:Georgia,serif;font-size:32px;font-weight:300">${total_amount:,.2f}</span>
</div>
{notes_html}
<div style="margin-top:28px;padding-top:16px;border-top:1px solid #ede9e1;font-size:11px;color:#8c8279;text-align:center">
  Rass Consulting · Generated {generated}
</div>
</body></html>"""


@api_view(["GET"])
@permission_classes([IsPlatformAdmin])
def platform_invoice_pdf(request, pk):
    """GET /api/superadmin/platform-invoices/{pk}/pdf/ — download as PDF."""
    try:
        inv = PlatformInvoice.objects.select_related("workspace").get(pk=pk)
    except PlatformInvoice.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)
    from weasyprint import HTML as WeasyprintHTML
    from django.http import HttpResponse
    pdf = WeasyprintHTML(string=_invoice_html(inv)).write_pdf()
    response = HttpResponse(pdf, content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="invoice-{inv.id}.pdf"'
    return response


@api_view(["POST"])
@permission_classes([IsPlatformAdmin])
def platform_invoice_send(request, pk):
    """POST /api/superadmin/platform-invoices/{pk}/send/ — email invoice with PDF attachment."""
    try:
        inv = PlatformInvoice.objects.select_related("workspace").get(pk=pk)
    except PlatformInvoice.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    owner_email = User.objects.filter(workspace=inv.workspace, role="business_owner").values_list("email", flat=True).first()
    if not owner_email:
        return Response({"detail": "No business owner found for this workspace."}, status=400)

    from django.core.mail import EmailMultiAlternatives
    from django.conf import settings as dj_settings
    from weasyprint import HTML as WeasyprintHTML

    subject = f"Invoice #{inv.id} — {inv.workspace.name}"
    period  = f"{inv.period_start.strftime('%b %d, %Y')} – {inv.period_end.strftime('%b %d, %Y')}"
    billed_name = inv.billed_to_name or inv.workspace.name

    # Simple plain text body
    plain = (
        f"Invoice #{inv.id}\nBilled to: {billed_name}\n"
        f"Period: {period}\nTotal: ${inv.amount}\n\n"
        f"Please find the invoice attached as a PDF.\n"
        f"{'Notes: ' + inv.notes if inv.notes else ''}"
    )

    # Brief HTML email body (invoice detail is in the PDF attachment)
    html = f"""
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1714;">
      <div style="font-family:Georgia,serif;font-size:22px;font-weight:300;margin-bottom:4px">Invoice #{inv.id}</div>
      <div style="font-size:12px;color:#8c8279;margin-bottom:24px">Rass Consulting</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr><td style="padding:10px 0;border-bottom:1px solid #ede9e1;font-size:13px;color:#8c8279">Billed to</td>
            <td style="padding:10px 0;border-bottom:1px solid #ede9e1;font-size:13px;font-weight:600;text-align:right">{billed_name}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #ede9e1;font-size:13px;color:#8c8279">Period</td>
            <td style="padding:10px 0;border-bottom:1px solid #ede9e1;font-size:13px;text-align:right">{period}</td></tr>
        <tr><td style="padding:12px 0;font-size:15px;font-weight:700;border-top:2px solid #1a1714">Total Due</td>
            <td style="padding:12px 0;font-size:22px;font-weight:300;text-align:right;font-family:Georgia,serif;border-top:2px solid #1a1714">${inv.amount}</td></tr>
      </table>
      {f'<p style="font-size:13px;color:#8c8279;border-left:3px solid #b8922e;padding-left:12px;margin-bottom:20px">{inv.notes}</p>' if inv.notes else ''}
      <p style="font-size:12px;color:#8c8279">The full invoice is attached as a PDF. Questions? Reply to this email.</p>
    </div>"""

    msg = EmailMultiAlternatives(
        subject=subject, body=plain,
        from_email=dj_settings.DEFAULT_FROM_EMAIL,
        to=[owner_email],
    )
    msg.attach_alternative(html, "text/html")

    # Attach PDF
    try:
        pdf_bytes = WeasyprintHTML(string=_invoice_html(inv)).write_pdf()
        msg.attach(f"invoice-{inv.id}.pdf", pdf_bytes, "application/pdf")
    except Exception:
        pass  # send without PDF rather than failing entirely

    msg.send()
    inv.status = "sent"
    inv.save(update_fields=["status"])
    return Response({"detail": f"Invoice sent to {owner_email}.", "status": "sent"})


@api_view(["GET", "POST"])
@permission_classes([IsPlatformAdmin])
def platform_invoice_payments(request, pk):
    """GET list / POST create a payment for a platform invoice."""
    try:
        inv = PlatformInvoice.objects.select_related("workspace").get(pk=pk)
    except PlatformInvoice.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    if request.method == "POST":
        payment = PlatformPayment.objects.create(
            invoice      = inv,
            amount       = request.data.get("amount", 0),
            payment_date = _parse_date(request.data.get("payment_date")),
            method       = request.data.get("method", "bank_transfer"),
            notes        = request.data.get("notes", ""),
        )
        from django.db.models import Sum as _Sum
        paid_total = float(inv.payments.aggregate(total=_Sum("amount"))["total"] or 0)
        if paid_total >= float(inv.amount):
            inv.status = "paid"
            inv.save(update_fields=["status"])
        return Response({
            "id":           payment.id,
            "amount":       str(payment.amount),
            "payment_date": payment.payment_date.isoformat(),
            "method":       payment.method,
            "notes":        payment.notes,
            "created_at":   payment.created_at.isoformat(),
            "invoice_status": inv.status,
        }, status=201)

    payments = inv.payments.all()
    return Response([{
        "id":           p.id,
        "amount":       str(p.amount),
        "payment_date": p.payment_date.isoformat(),
        "method":       p.method,
        "notes":        p.notes,
        "created_at":   p.created_at.isoformat(),
    } for p in payments])


@api_view(["DELETE"])
@permission_classes([IsPlatformAdmin])
def platform_invoice_payment_detail(request, pk, payment_pk):
    """DELETE a specific payment."""
    try:
        payment = PlatformPayment.objects.select_related("invoice").get(pk=payment_pk, invoice_id=pk)
    except PlatformPayment.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)
    payment.delete()
    return Response(status=204)
