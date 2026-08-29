import base64
from rest_framework.generics import RetrieveUpdateAPIView
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status
from django.http import HttpResponse
from apps.accounts.models import Workspace
from .serializers import (
    BrandingSerializer, SchedulingSerializer, WorkspaceSerializer,
    PipelineStageConfigSerializer, ActivityTypeConfigSerializer,
    ClientStatusConfigSerializer, ClientTagConfigSerializer,
    CommunicationTagConfigSerializer, LeadSourceConfigSerializer,
    AffiliationConfigSerializer,
)
from apps.pipeline.models import PipelineStageConfig
from apps.activities.models import ActivityTypeConfig, BUILTIN_TYPES, AffiliationConfig
from apps.clients.models import ClientStatusConfig, ClientTagConfig, CommunicationTagConfig, LeadSourceConfig
from apps.accounts.permissions import IsBusinessOwner, IsWorkspaceMember


class BrandingSettingsView(RetrieveUpdateAPIView):
    """GET/PUT /api/settings/branding/"""
    serializer_class   = BrandingSerializer

    def get_permissions(self):
        if self.request.method in ("PUT", "PATCH"):
            return [IsBusinessOwner()]
        return [IsWorkspaceMember()]

    def get_object(self):
        return self.request.user.workspace


class SchedulingSettingsView(RetrieveUpdateAPIView):
    """GET/PUT /api/settings/scheduling/"""
    serializer_class   = SchedulingSerializer

    def get_permissions(self):
        if self.request.method in ("PUT", "PATCH"):
            return [IsBusinessOwner()]
        return [IsWorkspaceMember()]

    def get_object(self):
        return self.request.user.workspace


class WorkspaceSettingsView(RetrieveUpdateAPIView):
    """GET/PATCH /api/settings/workspace/ — combined settings used by the frontend"""
    serializer_class   = WorkspaceSerializer
    http_method_names  = ["get", "patch", "put", "head", "options"]

    def get_permissions(self):
        if self.request.method in ("PUT", "PATCH"):
            return [IsBusinessOwner()]
        return [IsWorkspaceMember()]

    def get_object(self):
        return self.request.user.workspace


@api_view(["POST", "DELETE"])
@permission_classes([IsBusinessOwner])
@parser_classes([MultiPartParser])
def logo_upload(request):
    """
    POST  /api/settings/logo/  — upload workspace logo (multipart, field: logo)
    DELETE /api/settings/logo/ — remove workspace logo
    Stores as base64 data-URL in the database so it survives Render deploys.
    """
    workspace = request.user.workspace

    if request.method == "DELETE":
        workspace.logo_data = ""
        workspace.save(update_fields=["logo_data"])
        return Response({"detail": "Logo removed."})

    file = request.FILES.get("logo")
    if not file:
        return Response({"detail": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)

    if file.size > 2 * 1024 * 1024:  # 2 MB limit
        return Response({"detail": "Logo must be under 2 MB."}, status=status.HTTP_400_BAD_REQUEST)

    mime = file.content_type or "image/png"
    if not mime.startswith("image/"):
        return Response({"detail": "File must be an image."}, status=status.HTTP_400_BAD_REQUEST)

    data_url = f"data:{mime};base64,{base64.b64encode(file.read()).decode()}"
    workspace.logo_data = data_url
    workspace.save(update_fields=["logo_data"])
    return Response({"logo_data": data_url})


@api_view(["POST", "DELETE"])
@permission_classes([IsBusinessOwner])
@parser_classes([MultiPartParser])
def email_template_attachments(request):
    """
    POST   /api/settings/email-template-attachments/?use_case=invoice   (multipart, field: file)
        — attach a file (doc/pdf/any) that gets sent alongside every email using this
          workspace's default template for the given use case (currently only "invoice").
    DELETE /api/settings/email-template-attachments/?use_case=invoice&s3_key=...
        — remove a previously attached file.
    """
    import uuid
    from django.core.files.storage import default_storage

    workspace = request.user.workspace
    use_case  = request.query_params.get("use_case", "invoice")
    templates = dict(workspace.email_templates or {})
    tmpl      = dict(templates.get(use_case, {}))
    attachments = list(tmpl.get("attachments", []))

    if request.method == "DELETE":
        s3_key = request.query_params.get("s3_key")
        remaining = [a for a in attachments if a.get("s3_key") != s3_key]
        if len(remaining) != len(attachments):
            try:
                default_storage.delete(s3_key)
            except Exception:
                pass
        tmpl["attachments"] = remaining
        templates[use_case] = tmpl
        workspace.email_templates = templates
        workspace.save(update_fields=["email_templates"])
        return Response({"attachments": remaining})

    file = request.FILES.get("file")
    if not file:
        return Response({"detail": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)
    if file.size > 10 * 1024 * 1024:  # 10 MB limit
        return Response({"detail": "File must be under 10 MB."}, status=status.HTTP_400_BAD_REQUEST)

    ext = file.name.rsplit(".", 1)[-1].lower() if "." in file.name else "bin"
    s3_key = f"email-template-attachments/{workspace.id}/{use_case}/{uuid.uuid4()}.{ext}"
    try:
        default_storage.save(s3_key, file)
    except Exception as e:
        return Response({"detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    attachments.append({"s3_key": s3_key, "file_name": file.name, "size": file.size})
    tmpl["attachments"] = attachments
    templates[use_case] = tmpl
    workspace.email_templates = templates
    workspace.save(update_fields=["email_templates"])
    return Response({"attachments": attachments})


@api_view(["GET"])
@permission_classes([AllowAny])
def public_branding(request):
    """
    GET /api/settings/public-branding/ — no auth required.
    Returns the first workspace's name and logo URL for the login/register pages.
    """
    try:
        workspace = Workspace.objects.filter(is_active=True).order_by("created_at").first()
        if not workspace:
            return Response({"name": "CoachOS", "logo_url": "", "primary_colour": "#1B3A6B"})
        from django.conf import settings as dj_settings
        backend_base = getattr(dj_settings, "BACKEND_URL", "").rstrip("/")
        if not backend_base:
            allowed = getattr(dj_settings, "ALLOWED_HOSTS", [])
            host = next((h for h in allowed if "onrender.com" in h and not h.startswith(".")), None)
            backend_base = f"https://{host}" if host else "http://localhost:8000"
        logo_url = f"{backend_base}/api/settings/logo/{workspace.id}/" if workspace.logo_data else ""
        return Response({
            "name": workspace.name,
            "logo_url": logo_url,
            "primary_colour": workspace.primary_colour or "#1B3A6B",
        })
    except Exception:
        return Response({"name": "CoachOS", "logo_url": "", "primary_colour": "#1B3A6B"})


_BUILTIN_COLORS = {
    "appointment": "#c9a84c", "task": "#4a7c59", "call": "#2d6a9f",
    "session": "#1a1714",    "training": "#7c4d9f", "travel": "#8c8279",
    "custom": "#a0522d",     "client_communication": "#1565c0",
}

_BUILTIN_STAGES = [
    {"slug": "lead_new",            "label": "Lead – New",            "color": "#8c8279", "order": 0},
    {"slug": "discovery_scheduled", "label": "Discovery Scheduled",   "color": "#2d6a9f", "order": 1},
    {"slug": "discovery_completed", "label": "Discovery Completed",   "color": "#2980b9", "order": 2},
    {"slug": "proposal_sent",       "label": "Proposal Sent",         "color": "#c9a84c", "order": 3},
    {"slug": "verbal_yes",          "label": "Verbal Yes",            "color": "#4a7c59", "order": 4},
    {"slug": "active_client",       "label": "Active Client",         "color": "#1a1714", "order": 5},
    {"slug": "on_hold",             "label": "On Hold",               "color": "#7c4d9f", "order": 6},
    {"slug": "closed_lost",         "label": "Closed – Lost",         "color": "#c0392b", "order": 7},
]


def _seed_pipeline_stages(workspace):
    if PipelineStageConfig.objects.filter(workspace=workspace).exists():
        return
    for s in _BUILTIN_STAGES:
        PipelineStageConfig.objects.get_or_create(
            workspace=workspace, slug=s["slug"],
            defaults={**s, "is_builtin": True, "follow_up_days": None,
                      "notify_owner": True, "notify_client": False},
        )


@api_view(["GET", "POST"])
@permission_classes([IsWorkspaceMember])
def pipeline_stage_configs(request):
    """GET /api/settings/pipeline-stages/ — list; POST — create custom stage."""
    workspace = request.user.workspace
    _seed_pipeline_stages(workspace)

    if request.method == "GET":
        qs = PipelineStageConfig.objects.filter(workspace=workspace)
        return Response(PipelineStageConfigSerializer(qs, many=True).data)

    if request.user.role != "business_owner":
        return Response({"detail": "Forbidden."}, status=status.HTTP_403_FORBIDDEN)
    ser = PipelineStageConfigSerializer(data=request.data)
    if ser.is_valid():
        ser.save(workspace=workspace, is_builtin=False)
        return Response(ser.data, status=status.HTTP_201_CREATED)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsBusinessOwner])
def pipeline_stage_config_detail(request, pk):
    """PATCH/DELETE /api/settings/pipeline-stages/<pk>/"""
    workspace = request.user.workspace
    try:
        obj = PipelineStageConfig.objects.get(pk=pk, workspace=workspace)
    except PipelineStageConfig.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)

    if request.method == "DELETE":
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    ser = PipelineStageConfigSerializer(obj, data=request.data, partial=True)
    if ser.is_valid():
        ser.save()
        return Response(ser.data)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


def _seed_activity_types(workspace):
    """Seed any built-in types not yet present for this workspace — idempotent, and
    backfills newly-added BUILTIN_TYPES (e.g. client_communication) for workspaces that
    were already seeded before that type existed."""
    existing = set(ActivityTypeConfig.objects.filter(
        workspace=workspace, is_builtin=True
    ).values_list("name", flat=True))
    missing = [n for n in BUILTIN_TYPES if n not in existing]
    if not missing:
        return
    start = ActivityTypeConfig.objects.filter(workspace=workspace).count()
    for i, name in enumerate(missing):
        ActivityTypeConfig.objects.get_or_create(
            workspace=workspace, name=name,
            defaults={"color": _BUILTIN_COLORS.get(name, "#1a1714"), "is_builtin": True,
                      "is_active": True, "sort_order": start + i},
        )


@api_view(["GET", "POST"])
@permission_classes([IsWorkspaceMember])
def activity_type_configs(request):
    """GET /api/settings/activity-types/ — list; POST — create custom type."""
    workspace = request.user.workspace
    _seed_activity_types(workspace)

    if request.method == "GET":
        qs = ActivityTypeConfig.objects.filter(workspace=workspace)
        return Response(ActivityTypeConfigSerializer(qs, many=True).data)

    if not request.user.role == "business_owner":
        return Response({"detail": "Forbidden."}, status=status.HTTP_403_FORBIDDEN)
    data = {**request.data, "is_builtin": False}
    ser = ActivityTypeConfigSerializer(data=data)
    if ser.is_valid():
        ser.save(workspace=workspace)
        return Response(ser.data, status=status.HTTP_201_CREATED)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsBusinessOwner])
def activity_type_config_detail(request, pk):
    """PATCH/DELETE /api/settings/activity-types/<pk>/"""
    workspace = request.user.workspace
    try:
        obj = ActivityTypeConfig.objects.get(pk=pk, workspace=workspace)
    except ActivityTypeConfig.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)

    if request.method == "DELETE":
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    ser = ActivityTypeConfigSerializer(obj, data=request.data, partial=True)
    if ser.is_valid():
        ser.save()
        return Response(ser.data)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET"])
@permission_classes([IsWorkspaceMember])
def email_preview(request):
    """
    GET /api/settings/email-preview/?type=...&intro=...&closing=...
    Renders email HTML using the values passed in the request params.
    Falls back to saved DB template when params are omitted.
    This makes the preview independent of save — it always reflects what
    the user has typed in the editor, not what's committed to the DB.
    """
    from types import SimpleNamespace
    from tasks.email_html import (build_confirmation_email, build_reschedule_email, build_reminder_email,
                                   build_invoice_email, build_payment_receipt_email, build_portal_invite_email,
                                   build_client_communication_email, build_invite_email, build_pipeline_alert_email)
    from tasks.email import _logo_src, _owner_info

    email_type = request.query_params.get("type", "confirmation")
    workspace  = Workspace.objects.get(pk=request.user.workspace_id)  # fresh DB read
    hide_logo  = request.query_params.get("hide_logo") == "1"
    # Embed logo as data URI in preview — avoids BACKEND_URL requirement and browser caching
    if not hide_logo and workspace.logo_data and workspace.logo_data.startswith("data:"):
        logo_url = workspace.logo_data
    elif not hide_logo:
        logo_url = _logo_src(workspace)
    else:
        logo_url = ""
    owner_email, owner_name = _owner_info(workspace)

    DUMMY = dict(
        client_name="Jane Smith", coach_name="Coach Mike",
        session_title="Discovery Session",
        session_time="Wednesday, June 5 at 10:00 AM",
        workspace_name=workspace.name,
        time_label="24 hours",
        invoice_number="INV-0042", amount="150.00",
        due_date="June 30, 2026", payment_date="June 30, 2026",
        # Team Invite placeholders — this preview endpoint is always called with
        # type=client_communication from the Settings editor regardless of which use
        # case the template is actually assigned to, and str.format() fails (and
        # silently returns the raw unsubstituted text) if ANY placeholder in the text
        # is missing from this dict — so every use case's placeholders must live here.
        invited_by_name="Coach Mike", role="Coach", accept_url="#",
        owner_name="Coach Mike", owner_email="owner@example.com",
        # Pipeline alert placeholders
        stage_label="Proposal Sent", days_in_stage="9", follow_up_days="5",
        deal_value="$2,400", stage_entered="June 12, 2026",
    )
    if email_type == "client_communication":
        # Real client name (not the generic Jane Smith placeholder) — lets a coach
        # reference {client_name} in a draft's intro/closing and see it substituted
        # for the actual client they're messaging.
        DUMMY["client_name"] = request.query_params.get("client_name", DUMMY["client_name"])

    def apply(text):
        try:
            return text.format(**DUMMY) if text else ""
        except (KeyError, ValueError):
            return text

    # Use request params when present (live preview); fall back to saved DB values
    tmpl = (workspace.email_templates or {}).get(email_type, {})
    raw_intro   = request.query_params.get("intro",   tmpl.get("intro",   ""))
    raw_closing = request.query_params.get("closing", tmpl.get("closing", ""))
    custom_intro   = apply(raw_intro)
    custom_closing = apply(raw_closing)

    # Style overrides: request params take priority over saved DB values.
    # header_tagline uses None sentinel so '' (logo-only) is preserved;
    # all other fields use '' sentinel so absent params are omitted (builders use defaults).
    saved_style = tmpl.get("style", {})
    style = {}
    for key, default in (
        ("header_bg",      ""),
        ("accent_color",   ""),
        ("body_font",      ""),
        ("heading_font",   ""),
        ("value_color",    ""),
    ):
        v = request.query_params.get(key, saved_style.get(key, default))
        if v:  # omit empty strings — builders supply defaults
            style[key] = v
    # header_tagline is special: '' means "logo only / no tagline", not "use default"
    style["header_tagline"] = request.query_params.get(
        "header_tagline", saved_style.get("header_tagline", "Coaching Platform")
    )
    # show_header/show_footer are bools, not color strings — '0'/'false' turns them off
    raw_show_header = request.query_params.get("show_header")
    if raw_show_header is not None:
        style["show_header"] = raw_show_header not in ("0", "false", "False")
    else:
        style["show_header"] = saved_style.get("show_header", True)

    raw_show_footer = request.query_params.get("show_footer")
    if raw_show_footer is not None:
        style["show_footer"] = raw_show_footer not in ("0", "false", "False")
    else:
        style["show_footer"] = saved_style.get("show_footer", True)

    # footer_text: '' means "use default disclaimer", same None-sentinel convention as header_tagline
    style["footer_text"] = request.query_params.get(
        "footer_text", saved_style.get("footer_text", "")
    )

    raw_show_contact = request.query_params.get("show_contact_line")
    if raw_show_contact is not None:
        style["show_contact_line"] = raw_show_contact not in ("0", "false", "False")
    else:
        style["show_contact_line"] = saved_style.get("show_contact_line", True)

    # show_heading/show_signature: hide the auto heading (e.g. "{name} sent you an
    # invoice." / "Your session is confirmed") and/or "Thanks! / {name}" sign-off when
    # a coach's custom body already covers that (avoids redundant boilerplate on top).
    raw_show_heading = request.query_params.get("show_heading")
    if raw_show_heading is not None:
        style["show_heading"] = raw_show_heading not in ("0", "false", "False")
    else:
        style["show_heading"] = saved_style.get("show_heading", True)

    raw_show_signature = request.query_params.get("show_signature")
    if raw_show_signature is not None:
        style["show_signature"] = raw_show_signature not in ("0", "false", "False")
    else:
        style["show_signature"] = saved_style.get("show_signature", True)

    if email_type == "confirmation":
        # Allow callers (e.g. the Schedule Activity preview) to pass the real client/
        # session details instead of dummy placeholders.
        _preview_client_name   = request.query_params.get("client_name",   "Jane Smith")
        _preview_coach_name    = request.query_params.get("coach_name",    "Coach Mike")
        _preview_session_title = request.query_params.get("session_title", "Discovery Session")
        _preview_session_time  = request.query_params.get("session_time",  "Wednesday, June 5 at 10:00 AM")
        _preview_location      = request.query_params.get("location",      "123 Main St")
        client   = SimpleNamespace(first_name=_preview_client_name.split()[0], full_name=_preview_client_name, email="jane@example.com")
        activity = SimpleNamespace(
            title=_preview_session_title, activity_type="session",
            location=_preview_location, notes="", client=client,
        )
        html = build_confirmation_email(
            activity=activity, workspace_name=workspace.name, logo_url=logo_url,
            coach_name=_preview_coach_name, coach_email="",
            dt_human=_preview_session_time,
            owner_email=owner_email, owner_name=owner_name,
            google_cal_url="", custom_intro=custom_intro, custom_closing=custom_closing,
            style=style,
        )

    elif email_type == "reschedule":
        client   = SimpleNamespace(first_name="Jane", full_name="Jane Smith", email="jane@example.com")
        activity = SimpleNamespace(
            title="Discovery Session", activity_type="session",
            location="123 Main St", notes="", client=client,
        )
        html = build_reschedule_email(
            activity=activity, workspace_name=workspace.name, logo_url=logo_url,
            coach_name="Coach Mike", coach_email="",
            dt_human="Wednesday, June 5 at 10:00 AM",
            owner_email=owner_email, owner_name=owner_name,
            google_cal_url="", custom_intro=custom_intro, custom_closing=custom_closing,
            style=style,
        )

    elif email_type in ("reminder_24h", "reminder_1h"):
        time_label = "24 hours" if email_type == "reminder_24h" else "1 hour"
        client   = SimpleNamespace(first_name="Jane", full_name="Jane Smith", email="jane@example.com")
        activity = SimpleNamespace(
            title="Discovery Session", activity_type="session",
            location="123 Main St", client=client,
        )
        html = build_reminder_email(
            activity=activity, workspace_name=workspace.name, logo_url=logo_url,
            coach_name="Coach Mike", coach_email="",
            dt_human="Wednesday, June 5 at 10:00 AM",
            time_label=time_label,
            owner_email=owner_email, owner_name=owner_name,
            custom_intro=custom_intro, custom_closing=custom_closing,
            style=style,
        )

    elif email_type == "invoice":
        client  = SimpleNamespace(first_name="Jane", full_name="Jane Smith", email="jane@example.com")
        invoice = SimpleNamespace(
            number="INV-0042", total=150.00, currency="USD",
            stripe_payment_link="", client=client,
        )
        custom_html_tmpl = tmpl.get("custom_html", "").strip()
        skip_custom = request.query_params.get("skip_custom_html") == "1"
        # disable_style only applies when custom HTML is actually being used
        using_custom = custom_html_tmpl and not skip_custom
        disable_style = using_custom and tmpl.get("disable_style", False)
        from tasks.email import (
            _apply_tmpl, _DEFAULT_INVOICE_HTML, _DEFAULT_INVOICE_BODY, _invoice_body_block,
            _invoice_footer_block, _invoice_header_block,
            _invoice_heading_block, _invoice_signature_block,
        )
        _show_logo = tmpl.get("show_logo", True) and not disable_style
        logo_img_tag = (
            f'<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
            f'<td style="background:#ffffff;padding:8px 14px;border-radius:5px;">'
            f'<img src="{logo_url}" alt="{workspace.name}" '
            f'style="max-height:40px;max-width:160px;object-fit:contain;display:block;" />'
            f'</td></tr></table>'
        ) if (logo_url and _show_logo) else ""
        _bf = style.get("body_font", "")
        _hf = style.get("heading_font", "")
        _p = 'style="margin:0 0 16px;font-size:15px;color:#3a3530;line-height:1.7;"'
        _body_font_css = "'Helvetica Neue',Helvetica,Arial,sans-serif" if disable_style else (_bf or "'Helvetica Neue',Helvetica,Arial,sans-serif")
        _accent_color  = "#b8922e" if disable_style else style.get("accent_color", "#b8922e")
        # Allow callers (e.g. new-invoice preview) to pass real values instead of dummy ones
        _preview_amount      = request.query_params.get("amount",      "150.00")
        _preview_due_date    = request.query_params.get("due_date",    "June 30, 2026")
        _preview_client_name = request.query_params.get("client_name", "Jane Smith")
        preview_vars = dict(
            client_name=_preview_client_name, workspace_name=workspace.name,
            invoice_number="INV-0042", amount=_preview_amount, due_date=_preview_due_date,
            owner_email=owner_email, owner_name=owner_name or owner_email,
            payment_link="", pay_button="", logo_img=logo_img_tag,
            view_instructions="You can view the invoice by clicking on the attached file.",
            header_bg="#1a2f4e" if disable_style else style.get("header_bg", "#1a2f4e"),
            accent_color="#b8922e" if disable_style else style.get("accent_color", "#b8922e"),
            value_color="#1a1714" if disable_style else style.get("value_color", "#1a1714"),
            body_font_css=_body_font_css,
            heading_font_css="Georgia,'Times New Roman',serif" if disable_style else (_hf or "Georgia,'Times New Roman',serif"),
            footer_block=_invoice_footer_block(
                style.get("show_footer", True) and not disable_style,
                body_font_css=_body_font_css, owner_email=owner_email,
                owner_name=owner_name or owner_email, accent_color=_accent_color,
                workspace_name=workspace.name, invoice_number="INV-0042",
                show_contact_line=style.get("show_contact_line", True),
            ),
            header_block=_invoice_header_block(
                style.get("show_header", True) and not disable_style,
                header_bg="#1a2f4e" if disable_style else style.get("header_bg", "#1a2f4e"),
                accent_color=_accent_color, logo_img=logo_img_tag, workspace_name=workspace.name,
            ),
            body_radius="0 0 8px 8px" if (style.get("show_header", True) and not disable_style) else "8px",
            heading_block=_invoice_heading_block(
                style.get("show_heading", True) and not disable_style,
                heading_font_css="Georgia,'Times New Roman',serif" if disable_style else (_hf or "Georgia,'Times New Roman',serif"),
                workspace_name=workspace.name,
            ),
            signature_block=_invoice_signature_block(
                style.get("show_signature", True) and not disable_style,
                workspace_name=workspace.name,
            ),
        )
        raw_body = raw_intro.strip() or _DEFAULT_INVOICE_BODY
        preview_vars["body_para"] = _invoice_body_block(_apply_tmpl(raw_body, **preview_vars))
        effective_tmpl = (custom_html_tmpl if not skip_custom else "") or _DEFAULT_INVOICE_HTML
        html = _apply_tmpl(effective_tmpl, **preview_vars)

    elif email_type == "payment_receipt":
        client  = SimpleNamespace(first_name="Jane", full_name="Jane Smith", email="jane@example.com")
        invoice = SimpleNamespace(number="INV-0042", total=150.00, amount_paid=150.00, currency="USD", client=client)
        html = build_payment_receipt_email(
            invoice=invoice, workspace_name=workspace.name, logo_url=logo_url,
            amount_paid="150.00", payment_date="June 30, 2026",
            owner_email=owner_email, owner_name=owner_name,
            custom_intro=custom_intro, custom_closing=custom_closing,
            style=style,
        )

    elif email_type == "portal_invite":
        frontend_url = getattr(__import__('django.conf', fromlist=['settings']).settings, 'FRONTEND_URL', '').rstrip('/')
        html = build_portal_invite_email(
            client_name="Jane Smith",
            workspace_name=workspace.name,
            portal_url=f"{frontend_url}/client-portal",
            coach_name="Coach Mike",
            logo_url=logo_url,
            owner_email=owner_email,
            owner_name=owner_name,
            custom_intro=custom_intro,
            custom_closing=custom_closing,
            style=style,
        )

    elif email_type == "client_communication":
        preview_client_name = request.query_params.get("client_name", "Jane Smith")
        preview_subject     = request.query_params.get("subject", tmpl.get("subject", ""))
        html = build_client_communication_email(
            client_name=preview_client_name,
            subject=preview_subject,
            workspace_name=workspace.name,
            coach_name=request.query_params.get("coach_name") or "Coach Mike",
            logo_url=logo_url,
            owner_email=owner_email, owner_name=owner_name,
            custom_intro=custom_intro, custom_closing=custom_closing,
            style=style,
            coach_signature=request.query_params.get("coach_signature", ""),
            include_client_signature_line=request.query_params.get("include_client_signature_line") == "1",
        )

    elif email_type == "team_invite":
        html = build_invite_email(
            invited_by_name=request.query_params.get("invited_by_name") or owner_name or "Coach Mike",
            workspace_name=workspace.name,
            role_display=request.query_params.get("role") or "Coach",
            accept_url="#",
            logo_url=logo_url,
            invited_email="colleague@example.com",
            owner_email=owner_email, owner_name=owner_name,
            custom_intro=custom_intro, custom_closing=custom_closing,
            style=style,
        )

    elif email_type == "pipeline":
        from django.conf import settings as dj_settings
        frontend_url = getattr(dj_settings, 'FRONTEND_URL', '').rstrip('/')
        html = build_pipeline_alert_email(
            workspace_name=workspace.name,
            logo_url=logo_url,
            owner_name=owner_name,
            owner_email=owner_email,
            client_name="Jane Smith",
            stage_label=DUMMY["stage_label"],
            stage_color="#1a2f4e",
            days_in_stage=int(DUMMY["days_in_stage"]),
            follow_up_days=int(DUMMY["follow_up_days"]),
            deal_value=DUMMY["deal_value"],
            stage_entered=DUMMY["stage_entered"],
            pipeline_url=f"{frontend_url}/pipeline",
            custom_intro=custom_intro, custom_closing=custom_closing,
            style=style,
        )

    else:
        return Response({"detail": "Unknown type."}, status=status.HTTP_400_BAD_REQUEST)

    return Response({"html": html})


_INACTIVE_GREY = "#b8b2ab"  # also the app-wide fallback color for an unrecognized status
_BUILTIN_CLIENT_STATUSES = [
    {"label": "Lead",     "color": "#8c8279",     "sort_order": 0},
    {"label": "Active",   "color": "#4a7c59",     "sort_order": 1},
    {"label": "Inactive", "color": _INACTIVE_GREY, "sort_order": 2},
    {"label": "Archive",  "color": _INACTIVE_GREY, "sort_order": 3},
]


def _seed_client_statuses(workspace):
    if ClientStatusConfig.objects.filter(workspace=workspace, is_builtin=True).exists():
        return
    for s in _BUILTIN_CLIENT_STATUSES:
        ClientStatusConfig.objects.get_or_create(
            workspace=workspace, label=s["label"],
            defaults={**s, "is_builtin": True},
        )


@api_view(["GET", "POST"])
@permission_classes([IsWorkspaceMember])
def client_status_configs(request):
    """GET /api/settings/client-statuses/ — list; POST — create custom status."""
    workspace = request.user.workspace
    _seed_client_statuses(workspace)

    if request.method == "GET":
        qs = ClientStatusConfig.objects.filter(workspace=workspace)
        return Response(ClientStatusConfigSerializer(qs, many=True).data)

    if request.user.role != "business_owner":
        return Response({"detail": "Forbidden."}, status=status.HTTP_403_FORBIDDEN)
    ser = ClientStatusConfigSerializer(data=request.data)
    if ser.is_valid():
        ser.save(workspace=workspace, is_builtin=False)
        return Response(ser.data, status=status.HTTP_201_CREATED)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsBusinessOwner])
def client_status_config_detail(request, pk):
    """PATCH/DELETE /api/settings/client-statuses/<pk>/"""
    workspace = request.user.workspace
    try:
        obj = ClientStatusConfig.objects.get(pk=pk, workspace=workspace)
    except ClientStatusConfig.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)

    if request.method == "DELETE":
        if obj.is_builtin:
            return Response({"detail": "Cannot delete built-in statuses."}, status=status.HTTP_400_BAD_REQUEST)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    ser = ClientStatusConfigSerializer(obj, data=request.data, partial=True)
    if ser.is_valid():
        ser.save()
        return Response(ser.data)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET", "POST"])
@permission_classes([IsWorkspaceMember])
def client_tag_configs(request):
    """GET /api/settings/client-tags/ — list; POST — create tag."""
    workspace = request.user.workspace

    if request.method == "GET":
        qs = ClientTagConfig.objects.filter(workspace=workspace)
        return Response(ClientTagConfigSerializer(qs, many=True).data)

    if request.user.role != "business_owner":
        return Response({"detail": "Forbidden."}, status=status.HTTP_403_FORBIDDEN)
    ser = ClientTagConfigSerializer(data=request.data)
    if ser.is_valid():
        ser.save(workspace=workspace)
        return Response(ser.data, status=status.HTTP_201_CREATED)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsBusinessOwner])
def client_tag_config_detail(request, pk):
    """PATCH/DELETE /api/settings/client-tags/<pk>/"""
    workspace = request.user.workspace
    try:
        obj = ClientTagConfig.objects.get(pk=pk, workspace=workspace)
    except ClientTagConfig.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)

    if request.method == "DELETE":
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    ser = ClientTagConfigSerializer(obj, data=request.data, partial=True)
    if ser.is_valid():
        ser.save()
        return Response(ser.data)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET", "POST"])
@permission_classes([IsWorkspaceMember])
def communication_tag_configs(request):
    """GET /api/settings/communication-tags/ — list; POST — create tag.
    A second, independent tag set from client-tags (Client.communication_tags)."""
    workspace = request.user.workspace

    if request.method == "GET":
        qs = CommunicationTagConfig.objects.filter(workspace=workspace)
        return Response(CommunicationTagConfigSerializer(qs, many=True).data)

    if request.user.role != "business_owner":
        return Response({"detail": "Forbidden."}, status=status.HTTP_403_FORBIDDEN)
    ser = CommunicationTagConfigSerializer(data=request.data)
    if ser.is_valid():
        ser.save(workspace=workspace)
        return Response(ser.data, status=status.HTTP_201_CREATED)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsBusinessOwner])
def communication_tag_config_detail(request, pk):
    """PATCH/DELETE /api/settings/communication-tags/<pk>/"""
    workspace = request.user.workspace
    try:
        obj = CommunicationTagConfig.objects.get(pk=pk, workspace=workspace)
    except CommunicationTagConfig.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)

    if request.method == "DELETE":
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    ser = CommunicationTagConfigSerializer(obj, data=request.data, partial=True)
    if ser.is_valid():
        ser.save()
        return Response(ser.data)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


_BUILTIN_LEAD_SOURCES = [
    # Lowercase to exactly match Client.lead_source values already stored under the old
    # hardcoded LEAD_SOURCES array — changing casing here would silently break the
    # dropdown match for every already-saved client.
    {"label": "referral",       "sort_order": 0},
    {"label": "website",        "sort_order": 1},
    {"label": "linkedin",       "sort_order": 2},
    {"label": "conference",     "sort_order": 3},
    {"label": "cold outreach",  "sort_order": 4},
    {"label": "other",          "sort_order": 5},
]


def _seed_lead_sources(workspace):
    if LeadSourceConfig.objects.filter(workspace=workspace, is_builtin=True).exists():
        return
    for s in _BUILTIN_LEAD_SOURCES:
        LeadSourceConfig.objects.get_or_create(
            workspace=workspace, label=s["label"],
            defaults={**s, "is_builtin": True},
        )


@api_view(["GET", "POST"])
@permission_classes([IsWorkspaceMember])
def lead_source_configs(request):
    """GET /api/settings/lead-sources/ — list; POST — create custom lead source."""
    workspace = request.user.workspace
    _seed_lead_sources(workspace)

    if request.method == "GET":
        qs = LeadSourceConfig.objects.filter(workspace=workspace)
        return Response(LeadSourceConfigSerializer(qs, many=True).data)

    if request.user.role != "business_owner":
        return Response({"detail": "Forbidden."}, status=status.HTTP_403_FORBIDDEN)
    ser = LeadSourceConfigSerializer(data=request.data)
    if ser.is_valid():
        ser.save(workspace=workspace, is_builtin=False)
        return Response(ser.data, status=status.HTTP_201_CREATED)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsBusinessOwner])
def lead_source_config_detail(request, pk):
    """PATCH/DELETE /api/settings/lead-sources/<pk>/"""
    workspace = request.user.workspace
    try:
        obj = LeadSourceConfig.objects.get(pk=pk, workspace=workspace)
    except LeadSourceConfig.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)

    if request.method == "DELETE":
        if obj.is_builtin:
            return Response({"detail": "Cannot delete built-in lead sources."}, status=status.HTTP_400_BAD_REQUEST)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    ser = LeadSourceConfigSerializer(obj, data=request.data, partial=True)
    if ser.is_valid():
        ser.save()
        return Response(ser.data)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET", "POST"])
@permission_classes([IsWorkspaceMember])
def affiliation_configs(request):
    """GET /api/settings/affiliations/ — list; POST — create affiliation."""
    workspace = request.user.workspace

    if request.method == "GET":
        qs = AffiliationConfig.objects.filter(workspace=workspace)
        return Response(AffiliationConfigSerializer(qs, many=True).data)

    if request.user.role != "business_owner":
        return Response({"detail": "Forbidden."}, status=status.HTTP_403_FORBIDDEN)
    ser = AffiliationConfigSerializer(data=request.data)
    if ser.is_valid():
        ser.save(workspace=workspace)
        return Response(ser.data, status=status.HTTP_201_CREATED)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsBusinessOwner])
def affiliation_config_detail(request, pk):
    """PATCH/DELETE /api/settings/affiliations/<pk>/"""
    workspace = request.user.workspace
    try:
        obj = AffiliationConfig.objects.get(pk=pk, workspace=workspace)
    except AffiliationConfig.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)

    if request.method == "DELETE":
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    ser = AffiliationConfigSerializer(obj, data=request.data, partial=True)
    if ser.is_valid():
        ser.save()
        return Response(ser.data)
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)


def serve_workspace_logo(request, workspace_id):
    """
    GET /api/settings/logo/<workspace_id>/ — public endpoint, no auth required.
    Used in emails so clients' mail apps can load the logo via HTTP (base64 data-URIs
    are blocked by Gmail/Outlook).
    """
    try:
        workspace = Workspace.objects.get(pk=workspace_id)
    except Workspace.DoesNotExist:
        return HttpResponse(status=404)

    logo_data = workspace.logo_data
    if not logo_data or not logo_data.startswith("data:"):
        return HttpResponse(status=404)

    # Parse "data:<mime>;base64,<data>"
    header, encoded = logo_data.split(",", 1)
    mime = header.split(":")[1].split(";")[0]
    image_bytes = base64.b64decode(encoded)

    response = HttpResponse(image_bytes, content_type=mime)
    response["Cache-Control"] = "public, max-age=86400"
    return response


# ── Zoom integration ───────────────────────────────────────────────────────────

@api_view(["GET", "POST"])
@permission_classes([IsBusinessOwner])
def zoom_settings(request):
    """GET/POST /api/settings/zoom/ — store Zoom Server-to-Server OAuth credentials."""
    workspace = request.user.workspace
    integrations = workspace.integrations or {}
    zoom = integrations.get("zoom", {})

    if request.method == "GET":
        return Response({
            "account_id":    zoom.get("account_id", ""),
            "client_id":     zoom.get("client_id", ""),
            "client_secret": "***" if zoom.get("client_secret") else "",
            "configured":    bool(zoom.get("account_id") and zoom.get("client_id") and zoom.get("client_secret")),
        })

    data = request.data
    zoom["account_id"]    = (data.get("account_id")    or "").strip()
    zoom["client_id"]     = (data.get("client_id")     or "").strip()
    # Only update secret if a real value was sent (not the masked "***")
    if data.get("client_secret") and data["client_secret"] != "***":
        zoom["client_secret"] = (data["client_secret"] or "").strip()

    integrations["zoom"] = zoom
    workspace.integrations = integrations
    workspace.save(update_fields=["integrations"])
    return Response({"detail": "Zoom credentials saved.", "configured": bool(zoom.get("account_id") and zoom.get("client_id") and zoom.get("client_secret"))})


def _get_zoom_token(zoom_creds: dict) -> str:
    """Exchange Zoom Server-to-Server OAuth credentials for an access token."""
    import requests
    from base64 import b64encode
    account_id    = zoom_creds["account_id"]
    client_id     = zoom_creds["client_id"]
    client_secret = zoom_creds["client_secret"]
    credentials   = b64encode(f"{client_id}:{client_secret}".encode()).decode()
    resp = requests.post(
        f"https://zoom.us/oauth/token?grant_type=account_credentials&account_id={account_id}",
        headers={"Authorization": f"Basic {credentials}"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


@api_view(["POST"])
@permission_classes([IsWorkspaceMember])
def zoom_create_meeting(request):
    """
    POST /api/settings/zoom/create-meeting/
    Body: { topic, start_time (ISO), duration_minutes }
    Returns: { join_url, meeting_id }
    """
    import requests as req_lib
    workspace    = request.user.workspace
    integrations = workspace.integrations or {}
    zoom         = integrations.get("zoom", {})

    if not (zoom.get("account_id") and zoom.get("client_id") and zoom.get("client_secret")):
        return Response({"detail": "Zoom is not configured. Add credentials in Settings → Integrations."}, status=400)

    try:
        token = _get_zoom_token(zoom)
    except Exception as e:
        return Response({"detail": f"Failed to authenticate with Zoom: {e}"}, status=400)

    topic    = (request.data.get("topic") or "Coaching Session").strip()
    start_time   = request.data.get("start_time", "")
    duration     = int(request.data.get("duration_minutes", 60))

    payload = {
        "topic":      topic,
        "type":       2,           # Scheduled meeting
        "duration":   duration,
        "settings": {
            "join_before_host":     True,
            "waiting_room":         False,
            "auto_recording":       "none",
            "host_video":           True,
            "participant_video":    True,
        },
    }
    if start_time:
        payload["start_time"] = start_time

    try:
        resp = req_lib.post(
            "https://api.zoom.us/v2/users/me/meetings",
            json=payload,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        return Response({"join_url": data["join_url"], "meeting_id": data["id"]})
    except Exception as e:
        return Response({"detail": f"Failed to create Zoom meeting: {e}"}, status=400)


# ── Stripe integration (per-workspace — "bring your own account") ──────────────
# Each workspace connects its OWN Stripe account so client invoice payments go
# straight to them, not through a shared CoachOS platform account. Unlike Zoom's
# credentials above (stored plaintext), the Stripe secret/webhook keys are encrypted
# at rest via apps/accounts/crypto.py — they grant direct access to move money, so
# they get a stricter bar than a meeting-scheduling API key.

def _stripe_key_meta(secret_key: str) -> dict:
    """Derive display-safe metadata from a raw secret key without storing the key itself."""
    if secret_key.startswith("sk_live_"):
        mode = "live"
    elif secret_key.startswith("sk_test_"):
        mode = "test"
    else:
        mode = ""
    return {"mode": mode, "last4": secret_key[-4:] if len(secret_key) >= 4 else ""}


@api_view(["GET", "PATCH"])
@permission_classes([IsWorkspaceMember])
def stripe_settings(request):
    """
    GET   /api/settings/stripe/ — connection status + the webhook URL to configure.
          Never returns the actual secret/webhook keys, only derived display metadata.
    PATCH /api/settings/stripe/ — set/replace this workspace's Stripe secret key
          and/or webhook signing secret. Business-owner only (enforced below, not via
          decorator, so GET stays available to any workspace member).
    Body (PATCH): { secret_key?, publishable_key?, webhook_secret?, disconnect? }
    """
    from django.conf import settings as dj_settings
    from apps.accounts.crypto import encrypt_secret

    workspace    = request.user.workspace
    integrations = workspace.integrations or {}
    cfg          = integrations.get("stripe", {})

    if request.method == "GET":
        backend_base = getattr(dj_settings, "BACKEND_URL", "").rstrip("/") or "http://localhost:8000"
        return Response({
            "connected":          bool(cfg.get("secret_key_encrypted")),
            "mode":               cfg.get("mode", ""),
            "last4":              cfg.get("last4", ""),
            "publishable_key":    cfg.get("publishable_key", ""),
            "webhook_configured": bool(cfg.get("webhook_secret_encrypted")),
            "webhook_url":        f"{backend_base}/api/invoices/stripe-webhook/{workspace.id}/",
        })

    if request.user.role not in ("business_owner", "platform_admin"):
        return Response({"detail": "Only the workspace owner can manage payment settings."}, status=status.HTTP_403_FORBIDDEN)

    data = request.data
    if data.get("disconnect"):
        integrations["stripe"] = {}
        workspace.integrations = integrations
        workspace.save(update_fields=["integrations"])
        return Response({"connected": False, "mode": "", "last4": "", "webhook_configured": False})

    secret_key = (data.get("secret_key") or "").strip()
    if secret_key:
        if not (secret_key.startswith("sk_test_") or secret_key.startswith("sk_live_")):
            return Response(
                {"detail": "That doesn't look like a Stripe secret key — it should start with sk_test_ or sk_live_."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        meta = _stripe_key_meta(secret_key)
        from django.utils import timezone
        cfg["secret_key_encrypted"] = encrypt_secret(secret_key)
        cfg["mode"]         = meta["mode"]
        cfg["last4"]        = meta["last4"]
        cfg["connected_at"] = timezone.now().isoformat()

    if "publishable_key" in data:
        cfg["publishable_key"] = (data.get("publishable_key") or "").strip()

    webhook_secret = (data.get("webhook_secret") or "").strip()
    if webhook_secret:
        cfg["webhook_secret_encrypted"] = encrypt_secret(webhook_secret)

    integrations["stripe"] = cfg
    workspace.integrations = integrations
    workspace.save(update_fields=["integrations"])
    return Response({
        "connected":          bool(cfg.get("secret_key_encrypted")),
        "mode":               cfg.get("mode", ""),
        "last4":              cfg.get("last4", ""),
        "webhook_configured": bool(cfg.get("webhook_secret_encrypted")),
    })
