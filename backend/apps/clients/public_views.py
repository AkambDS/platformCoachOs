"""
Public (no-auth) contract-signing page.
Clients land here from the "Review & Sign Online" link in a Client Communication
email (see tasks.email.send_client_communication_email). Mirrors the styling/structure
of apps.activities.public_views (session confirm/cancel/reschedule) — same token
convention, same plain-HTML-page approach (no React/SPA involved).

Routes (added in config/urls.py):
    GET  /contract/sign/<token>/
    POST /contract/sign/<token>/  → captures the client's drawn signature
"""
import logging

from django.http import HttpResponse
from django.views import View
from django.utils.html import escape

from .tokens import verify_contract_token

logger = logging.getLogger(__name__)

_NAVY   = "#1a2f4e"
_GOLD   = "#b8922e"
_PAPER  = "#faf8f4"
_MUTED  = "#6e6560"
_BORDER = "#ede9e1"
_GREEN  = "#4a7c59"


def _shell(workspace_name: str, body: str, extra_head: str = "") -> str:
    name = escape(workspace_name)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{name}</title>
  <style>
    *{{box-sizing:border-box;margin:0;padding:0}}
    body{{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
          background:{_PAPER};color:#1a1714;min-height:100vh;
          display:flex;flex-direction:column}}
    header{{background:{_NAVY};padding:18px 24px;text-align:center}}
    header span{{font-family:Georgia,'Times New Roman',serif;
                 font-size:22px;font-weight:400;color:#f7f4ef;letter-spacing:.04em}}
    main{{flex:1;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px}}
    .card{{background:#fff;border:1px solid {_BORDER};border-radius:10px;
           padding:40px 36px;max-width:560px;width:100%;
           box-shadow:0 2px 12px rgba(0,0,0,.06)}}
    .card.center{{text-align:center}}
    .icon{{font-size:48px;margin-bottom:16px}}
    h1{{font-family:Georgia,'Times New Roman',serif;font-size:26px;
        font-weight:400;color:#16130f;margin-bottom:10px}}
    .sub{{font-size:14px;color:{_MUTED};line-height:1.6;margin-bottom:20px}}
    .contract-body{{background:{_PAPER};border:1px solid {_BORDER};border-radius:8px;
                    padding:20px 22px;margin-bottom:24px;font-size:13px;line-height:1.8;
                    color:#3a3530;white-space:pre-wrap;max-height:360px;overflow-y:auto}}
    .contract-body h2{{font-family:Georgia,'Times New Roman',serif;font-size:18px;
                       font-weight:400;color:#16130f;margin-bottom:10px;white-space:normal}}
    label.field{{display:block;font-size:11px;font-weight:700;letter-spacing:.06em;
                text-transform:uppercase;color:{_MUTED};margin-bottom:6px;margin-top:16px}}
    input[type=text]{{width:100%;border:1px solid {_BORDER};border-radius:6px;
              padding:10px 12px;font-size:14px;font-family:inherit;background:#fff}}
    input[type=text]:focus{{outline:none;border-color:{_GOLD}}}
    .sig-mode-toggle{{display:flex;gap:8px}}
    .sig-mode-btn{{flex:0 0 auto;padding:9px 18px;border-radius:6px;border:1px solid {_BORDER};
                   background:#fff;color:{_MUTED};font-size:12px;font-weight:700;cursor:pointer}}
    .sig-mode-btn.active{{background:{_NAVY};color:#fff;border-color:{_NAVY}}}
    .typed-sig-preview{{border:1px solid {_BORDER};border-radius:6px;background:#fff;min-height:74px;
                        display:flex;align-items:center;justify-content:center;padding:10px;
                        margin-top:10px;font-family:'Segoe Script','Bradley Hand','Brush Script MT',cursive;
                        font-size:30px;color:#1a1714;text-align:center;word-break:break-word}}
    .typed-sig-preview.empty{{color:#c8c2ba;font-family:inherit;font-size:13px}}
    .sig-pad-wrap{{border:1px solid {_BORDER};border-radius:6px;background:#fff;position:relative;margin-top:10px}}
    canvas{{display:block;width:100%;height:140px;cursor:crosshair;touch-action:none}}
    .sig-hint{{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
              color:#c8c2ba;font-size:12px;pointer-events:none}}
    .sig-actions{{display:flex;justify-content:flex-end;margin-top:6px}}
    .sig-actions button{{background:none;border:none;color:{_MUTED};font-size:11px;cursor:pointer;
                         text-decoration:underline}}
    .consent{{display:flex;align-items:flex-start;gap:8px;margin-top:18px;font-size:12px;
             color:{_MUTED};line-height:1.5}}
    .consent input{{margin-top:2px}}
    .btn{{display:inline-block;padding:13px 28px;border-radius:6px;font-size:13px;
          font-weight:700;letter-spacing:.06em;text-transform:uppercase;
          cursor:pointer;border:none;text-decoration:none;width:100%;text-align:center;margin-top:20px}}
    .btn-primary{{background:{_GREEN};color:#fff}}
    .btn-primary:disabled{{background:#c8c2ba;cursor:not-allowed}}
    .error{{color:#b91c1c;font-size:12px;margin-top:8px}}
    footer{{padding:16px;text-align:center;font-size:11px;color:{_MUTED}}}
  </style>
  {extra_head}
</head>
<body>
  <header><span>{name}</span></header>
  <main>{body}</main>
  <footer>Sent by {name} via CoachOS &mdash; this link is unique to you.</footer>
</body>
</html>"""


def _invalid_response():
    return HttpResponse(_shell("CoachOS", """
      <div class="card center">
        <div class="icon">⚠️</div>
        <h1>Link not valid</h1>
        <p class="sub">This signing link has expired or is invalid.<br>
          Please contact your coach for a new link.</p>
      </div>"""), status=400)


def _get_draft(draft_id: str):
    from .models import ClientMessageDraft
    return ClientMessageDraft.objects.select_related("client", "client__coach", "workspace").get(id=draft_id)


class ContractSignView(View):
    def get(self, request, token):
        try:
            draft_id = verify_contract_token(token)
            draft = _get_draft(draft_id)
        except Exception:
            return _invalid_response()

        ws = draft.workspace
        client_name = escape(draft.client.first_name or draft.client.full_name)

        if draft.client_signed_at:
            signed_date = draft.client_signed_at.strftime("%B %d, %Y")
            body = f"""
              <div class="card center">
                <div class="icon">✅</div>
                <h1>Already signed</h1>
                <p class="sub">Hi {client_name}, you signed this agreement on {escape(signed_date)}.<br>
                  Contact your coach if you need a copy.</p>
              </div>"""
            return HttpResponse(_shell(ws.name, body))

        from tasks.email import _apply_tmpl, _owner_info
        _, owner_name = _owner_info(ws)
        coach_name = draft.signature_name.strip() or owner_name or ws.name
        tmpl_vars = dict(client_name=draft.client.full_name, coach_name=coach_name, workspace_name=ws.name)
        subject = escape(_apply_tmpl(draft.subject.strip(), **tmpl_vars) or "Agreement")
        intro   = escape(_apply_tmpl(draft.intro, **tmpl_vars))
        closing = escape(_apply_tmpl(draft.closing, **tmpl_vars))

        body = f"""
          <div class="card">
            <h1>Review &amp; Sign</h1>
            <p class="sub">Hi {client_name}, please review the agreement below and add your signature to confirm.</p>
            <div class="contract-body">
              <h2>{subject}</h2>
              {intro}

              {closing}
            </div>

            <form method="POST" action="" id="signForm">
              <label class="field">Your full legal name</label>
              <input type="text" name="full_name" id="fullName" required placeholder="Jane Smith" />

              <label class="field">Your signature</label>
              <div class="sig-mode-toggle">
                <button type="button" id="modeType" class="sig-mode-btn active">Type my name</button>
                <button type="button" id="modeDraw" class="sig-mode-btn">Draw my signature</button>
              </div>

              <div id="typedSigPreview" class="typed-sig-preview empty">Your typed name will appear here</div>

              <div id="drawSigWrap" class="sig-pad-wrap" style="display:none;">
                <canvas id="sigCanvas" width="480" height="140"></canvas>
                <div class="sig-hint" id="sigHint">Sign here</div>
              </div>
              <div class="sig-actions" id="clearWrap" style="display:none;">
                <button type="button" id="clearSig">Clear</button>
              </div>

              <input type="hidden" name="signature_mode" id="signatureMode" value="type" />
              <input type="hidden" name="signature_data" id="signatureData" />

              <label class="consent">
                <input type="checkbox" name="consent" required />
                <span>I have read and agree to the terms above, and I intend this name/signature
                  to be my electronic signature on this document.</span>
              </label>

              <div id="formError" class="error" style="display:none;"></div>
              <button type="submit" class="btn btn-primary" id="submitBtn">Sign &amp; Submit</button>
            </form>
          </div>

          <script>
            (function() {{
              // ── Mode toggle: typing a name is the default (works without a mouse/
              // trackpad drawing well, and even without JS at all — see the server-side
              // fallback in the POST handler); drawing is the alternate, opt-in option.
              var mode = 'type';
              var modeTypeBtn = document.getElementById('modeType');
              var modeDrawBtn = document.getElementById('modeDraw');
              var typedPreview = document.getElementById('typedSigPreview');
              var drawWrap = document.getElementById('drawSigWrap');
              var clearWrap = document.getElementById('clearWrap');
              var fullNameInput = document.getElementById('fullName');
              var signatureMode = document.getElementById('signatureMode');

              function renderTypedPreview() {{
                var v = (fullNameInput.value || '').trim();
                typedPreview.textContent = v || 'Your typed name will appear here';
                typedPreview.classList.toggle('empty', !v);
              }}
              fullNameInput.addEventListener('input', renderTypedPreview);

              function setMode(next) {{
                mode = next;
                signatureMode.value = next;
                modeTypeBtn.classList.toggle('active', next === 'type');
                modeDrawBtn.classList.toggle('active', next === 'draw');
                typedPreview.style.display = next === 'type' ? 'flex' : 'none';
                drawWrap.style.display = next === 'draw' ? 'block' : 'none';
                clearWrap.style.display = next === 'draw' ? 'flex' : 'none';
              }}
              modeTypeBtn.addEventListener('click', function() {{ setMode('type'); }});
              modeDrawBtn.addEventListener('click', function() {{ setMode('draw'); }});

              // ── Drawn-signature canvas (only used when mode === 'draw') ──
              var canvas = document.getElementById('sigCanvas');
              var ctx = canvas.getContext('2d');
              var hint = document.getElementById('sigHint');
              var drawing = false, hasStroke = false, points = [];
              ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1a1714';

              function drawBaseline() {{
                ctx.save();
                ctx.strokeStyle = '#e3ddd3'; ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(16, canvas.height - 28); ctx.lineTo(canvas.width - 16, canvas.height - 28);
                ctx.stroke();
                ctx.restore();
                ctx.strokeStyle = '#1a1714'; ctx.lineWidth = 2.4;
              }}
              drawBaseline();

              function pos(e) {{
                var rect = canvas.getBoundingClientRect();
                var p = e.touches ? e.touches[0] : e;
                var scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
                return {{ x: (p.clientX - rect.left) * scaleX, y: (p.clientY - rect.top) * scaleY }};
              }}
              // Straight lineTo() per raw mouse-move point looks jagged/angular since
              // mousemove fires at a coarser rate than the cursor actually travels —
              // quadratic-curving through the midpoint of each new pair of points (the
              // standard signature-pad smoothing technique) renders a natural, fluid
              // stroke from the same input instead.
              function start(e) {{
                e.preventDefault(); drawing = true; hint.style.display = 'none';
                var p = pos(e); points = [p];
                ctx.beginPath(); ctx.moveTo(p.x, p.y);
              }}
              function move(e) {{
                if (!drawing) return;
                e.preventDefault();
                var p = pos(e); points.push(p);
                var len = points.length;
                if (len >= 3) {{
                  var xc = (points[len - 1].x + points[len - 2].x) / 2;
                  var yc = (points[len - 1].y + points[len - 2].y) / 2;
                  ctx.quadraticCurveTo(points[len - 2].x, points[len - 2].y, xc, yc);
                }} else {{
                  ctx.lineTo(p.x, p.y);
                }}
                ctx.stroke();
                hasStroke = true;
              }}
              function end() {{ drawing = false; points = []; }}
              canvas.addEventListener('mousedown', start);
              canvas.addEventListener('mousemove', move);
              canvas.addEventListener('mouseup', end);
              canvas.addEventListener('mouseleave', end);
              canvas.addEventListener('touchstart', start);
              canvas.addEventListener('touchmove', move);
              canvas.addEventListener('touchend', end);

              document.getElementById('clearSig').addEventListener('click', function() {{
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                drawBaseline();
                hasStroke = false; hint.style.display = 'flex';
              }});

              document.getElementById('signForm').addEventListener('submit', function(e) {{
                var err = document.getElementById('formError');
                if (mode === 'draw') {{
                  if (!hasStroke) {{
                    e.preventDefault();
                    err.textContent = 'Please draw your signature before submitting.';
                    err.style.display = 'block';
                    return;
                  }}
                  document.getElementById('signatureData').value = canvas.toDataURL('image/png');
                }} else if (!fullNameInput.value.trim()) {{
                  e.preventDefault();
                  err.textContent = 'Please type your name before submitting.';
                  err.style.display = 'block';
                  return;
                }}
                document.getElementById('submitBtn').disabled = true;
                document.getElementById('submitBtn').textContent = 'Submitting…';
              }});
            }})();
          </script>"""
        return HttpResponse(_shell(ws.name, body))

    def post(self, request, token):
        try:
            draft_id = verify_contract_token(token)
            draft = _get_draft(draft_id)
        except Exception:
            return _invalid_response()

        if draft.client_signed_at:
            return self.get(request, token)

        # "type" (default — also the natural fallback if JS never ran, since typing a
        # name needs no canvas at all) stores a "TEXT:<name>" sentinel, same convention
        # as the coach's own typed signature (see tasks/email_html.py); "draw" keeps the
        # existing real "data:image/..." canvas capture. Either way full_name + consent
        # are required — the typed-name mode just doesn't also require a drawn image.
        mode = (request.POST.get("signature_mode") or "type").strip()
        full_name = (request.POST.get("full_name") or "").strip()[:200]
        consent = request.POST.get("consent") == "on"

        if mode == "draw":
            signature_data = (request.POST.get("signature_data") or "").strip()
            valid = signature_data.startswith("data:image/") and full_name and consent
            error_msg = ("Please go back, draw your signature, enter your name, "
                         "and check the consent box before submitting.")
        else:
            signature_data = f"TEXT:{full_name}" if full_name else ""
            valid = bool(full_name) and consent
            error_msg = "Please go back, type your name, and check the consent box before submitting."

        if not valid:
            ws = draft.workspace
            body = f"""
              <div class="card center">
                <div class="icon">⚠️</div>
                <h1>Missing information</h1>
                <p class="sub">{error_msg}</p>
              </div>"""
            return HttpResponse(_shell(ws.name, body), status=400)

        from django.utils import timezone
        draft.client_signature = signature_data
        draft.client_signed_at = timezone.now()
        draft.client_signer_ip = (request.META.get("REMOTE_ADDR") or "")[:64] or None
        draft.client_signer_user_agent = (request.META.get("HTTP_USER_AGENT") or "")[:300]
        draft.status = "signed"
        draft.save(update_fields=[
            "client_signature", "client_signed_at", "client_signer_ip",
            "client_signer_user_agent", "status", "updated_at",
        ])

        self._finalize_signed_pdf(draft)

        try:
            import threading
            from tasks.email import send_contract_signed_notice
            threading.Thread(target=send_contract_signed_notice, args=(str(draft.id),), daemon=True).start()
        except Exception as e:
            logger.error(f"Contract-signed coach notice failed: {e}")

        ws = draft.workspace
        client_name = escape(draft.client.first_name or draft.client.full_name)
        body = f"""
          <div class="card center">
            <div class="icon">✅</div>
            <h1>Signed successfully</h1>
            <p class="sub">Thank you, {client_name} — your signature has been recorded.<br>
              A copy of the signed agreement has been saved.</p>
          </div>"""
        return HttpResponse(_shell(ws.name, body))

    def _finalize_signed_pdf(self, draft):
        """Regenerate the contract HTML with both signatures baked in, convert to PDF,
        and save it as a client File so it's visible in the Files tab like any other
        document (and pickable from Client Communication's attachment picker)."""
        import uuid as uuid_lib
        from django.core.files.base import ContentFile
        from django.core.files.storage import default_storage
        from tasks.email import _apply_tmpl, _owner_info, _logo_src
        from tasks.email_html import build_client_communication_email
        from .models import Assessment

        client = draft.client
        workspace = draft.workspace
        owner_email, owner_name = _owner_info(workspace)
        coach_name = draft.signature_name.strip() or owner_name or workspace.name
        tmpl_vars = dict(client_name=client.full_name, coach_name=coach_name, workspace_name=workspace.name)
        subject = _apply_tmpl(draft.subject.strip(), **tmpl_vars) or "Agreement"

        try:
            html = build_client_communication_email(
                client_name=client.full_name,
                subject=subject,
                workspace_name=workspace.name,
                coach_name=coach_name,
                logo_url=_logo_src(workspace) if draft.show_logo else "",
                owner_email=owner_email, owner_name=owner_name,
                custom_intro=_apply_tmpl(draft.intro, **tmpl_vars),
                custom_closing=_apply_tmpl(draft.closing, **tmpl_vars),
                style=draft.style or {},
                coach_signature=draft.coach_signature,
                include_client_signature_line=True,
                client_signature=draft.client_signature,
                client_signed_at_human=draft.client_signed_at.strftime("%B %d, %Y"),
            )
            from weasyprint import HTML as WeasyHTML
            pdf_bytes = WeasyHTML(string=html).write_pdf()

            # Strictly ASCII — .isalnum() alone is Unicode-aware (true for accented
            # letters etc.), and a non-ASCII filename breaks the presigned S3 URL's
            # Content-Disposition header later (must be ISO-8859-1-encodable). Also
            # avoid the em dash specifically: same charset problem.
            ascii_subject = subject.encode("ascii", "ignore").decode("ascii")
            safe_subject = "".join(c for c in ascii_subject if c.isalnum() or c in " -_").strip() or "Agreement"
            file_name = f"{safe_subject} - Signed.pdf"
            s3_key = f"assessments/{workspace.id}/{client.id}/{uuid_lib.uuid4()}.pdf"
            default_storage.save(s3_key, ContentFile(pdf_bytes))

            assessment = Assessment.objects.create(
                workspace=workspace, client=client, uploaded_by=draft.created_by,
                assessment_type="contract", date=draft.client_signed_at.date(),
                file_s3_key=s3_key, file_name=file_name, visible_to_client=True,
            )
            draft.signed_pdf_assessment = assessment
            draft.save(update_fields=["signed_pdf_assessment", "updated_at"])
        except Exception as e:
            logger.error(f"Failed to finalize signed PDF for draft {draft.id}: {e}")
