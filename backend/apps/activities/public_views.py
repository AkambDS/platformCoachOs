"""
Public (no-auth) session action views.
Clients land here from links in confirmation / reminder emails.

Routes (added in config/urls.py):
    GET  /session/confirm/<token>/
    GET  /session/cancel/<token>/
    POST /session/cancel/<token>/     → processes cancellation
    GET  /session/reschedule/<token>/
    POST /session/reschedule/<token>/ → sends reschedule request to coach
"""
import logging

from django.http import HttpResponse
from django.views import View
from django.utils.html import escape

from .tokens import verify_session_token

logger = logging.getLogger(__name__)


# ── Brand colours (matches CoachOS theme) ──────────────────────────────────────
_NAVY   = "#1a2f4e"
_GOLD   = "#b8922e"
_PAPER  = "#faf8f4"
_MUTED  = "#6e6560"
_BORDER = "#ede9e1"


def _shell(workspace_name: str, body: str) -> str:
    """Minimal branded HTML page wrapper."""
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
    main{{flex:1;display:flex;align-items:center;justify-content:center;padding:40px 16px}}
    .card{{background:#fff;border:1px solid {_BORDER};border-radius:10px;
           padding:40px 36px;max-width:480px;width:100%;text-align:center;
           box-shadow:0 2px 12px rgba(0,0,0,.06)}}
    .icon{{font-size:48px;margin-bottom:16px}}
    h1{{font-family:Georgia,'Times New Roman',serif;font-size:26px;
        font-weight:400;color:#16130f;margin-bottom:10px}}
    .sub{{font-size:14px;color:{_MUTED};line-height:1.6;margin-bottom:24px}}
    .detail-box{{background:{_PAPER};border:1px solid {_BORDER};border-radius:8px;
                 padding:16px 20px;text-align:left;margin-bottom:24px;font-size:13px}}
    .detail-box .row{{display:flex;gap:8px;padding:5px 0;border-bottom:1px solid {_BORDER}}}
    .detail-box .row:last-child{{border-bottom:none}}
    .detail-box .lbl{{color:{_MUTED};min-width:60px;font-weight:500}}
    .detail-box .val{{color:#1a1714;font-weight:600}}
    .btn{{display:inline-block;padding:12px 28px;border-radius:6px;font-size:13px;
          font-weight:700;letter-spacing:.06em;text-transform:uppercase;
          cursor:pointer;border:none;text-decoration:none}}
    .btn-primary{{background:{_NAVY};color:#fff}}
    .btn-danger{{background:#b91c1c;color:#fff}}
    .btn-outline{{background:#fff;color:{_MUTED};border:1px solid {_BORDER}}}
    textarea{{width:100%;border:1px solid {_BORDER};border-radius:6px;
              padding:12px;font-size:13px;line-height:1.6;resize:vertical;
              font-family:inherit;background:#faf9f7;margin-bottom:16px}}
    textarea:focus{{outline:none;border-color:{_GOLD}}}
    footer{{padding:16px;text-align:center;font-size:11px;color:{_MUTED}}}
  </style>
</head>
<body>
  <header><span>{name}</span></header>
  <main>{body}</main>
  <footer>Sent by {name} via CoachOS &mdash; this link is unique to you.</footer>
</body>
</html>"""


def _detail_box(activity) -> str:
    from tasks.email import _fmt_dt_human
    dt = _fmt_dt_human(activity.start_at, getattr(activity.workspace, "workspace_timezone", ""))
    coach = escape(activity.coach.full_name if activity.coach else activity.workspace.name)
    rows = [
        ("What",  escape(activity.title)),
        ("When",  escape(dt)),
        ("Coach", coach),
    ]
    if activity.location:
        rows.insert(2, ("Where", escape(activity.location)))
    rows_html = "".join(
        f'<div class="row"><span class="lbl">{l}</span><span class="val">{v}</span></div>'
        for l, v in rows
    )
    return f'<div class="detail-box">{rows_html}</div>'


def _get_activity(activity_id: str):
    from .models import Activity
    return Activity.objects.select_related("client", "coach", "workspace").get(id=activity_id)


# ── Confirm ────────────────────────────────────────────────────────────────────

class SessionConfirmView(View):
    def get(self, request, token):
        try:
            action, activity_id = verify_session_token(token)
            if action != "confirm":
                raise ValueError("Wrong action")
            activity = _get_activity(activity_id)
        except Exception:
            return HttpResponse(_shell("CoachOS", """
              <div class="card">
                <div class="icon">⚠️</div>
                <h1>Link not valid</h1>
                <p class="sub">This link has expired or is invalid.<br>
                  Please contact your coach for a new confirmation.</p>
              </div>"""), status=400)

        # Mark confirmed in DB and notify coach
        if not activity.client_confirmed:
            from django.utils import timezone
            activity.client_confirmed = True
            activity.client_confirmed_at = timezone.now()
            activity.save(update_fields=["client_confirmed", "client_confirmed_at"])
            try:
                import threading
                from tasks.email import send_client_confirmation_notice
                threading.Thread(target=send_client_confirmation_notice, args=(str(activity.id),), daemon=True).start()
            except Exception as e:
                logger.error(f"Coach confirmation notice failed: {e}")

        ws = activity.workspace
        client_name = escape(activity.client.first_name or activity.client.full_name)

        body = f"""
          <div class="card">
            <div class="icon">✅</div>
            <h1>You're confirmed!</h1>
            <p class="sub">Hi {client_name}, your session is on the books.<br>
              We look forward to seeing you.</p>
            {_detail_box(activity)}
            <p style="font-size:12px;color:{_MUTED};">
              Need to cancel or reschedule? Use the links in your email.
            </p>
          </div>"""
        return HttpResponse(_shell(ws.name, body))


# ── Cancel ─────────────────────────────────────────────────────────────────────

class SessionCancelView(View):
    def _validate(self, token):
        action, activity_id = verify_session_token(token)
        if action != "cancel":
            raise ValueError("Wrong action")
        return _get_activity(activity_id)

    def get(self, request, token):
        try:
            activity = self._validate(token)
        except Exception:
            return self._invalid_response()

        if activity.status == "cancelled":
            return HttpResponse(_shell(activity.workspace.name, f"""
              <div class="card">
                <div class="icon">ℹ️</div>
                <h1>Already cancelled</h1>
                <p class="sub">This session has already been cancelled.</p>
                {_detail_box(activity)}
              </div>"""))

        ws = activity.workspace
        client_name = escape(activity.client.first_name or activity.client.full_name)
        body = f"""
          <div class="card">
            <div class="icon">❌</div>
            <h1>Cancel your session?</h1>
            <p class="sub">Hi {client_name}, you are about to cancel the following session:</p>
            {_detail_box(activity)}
            <form method="POST" action="">
              <input type="hidden" name="csrfmiddlewaretoken" value="">
              <p style="font-size:12px;color:{_MUTED};margin-bottom:20px;">
                This action cannot be undone. Your coach will be notified immediately.
              </p>
              <button type="submit" class="btn btn-danger" style="width:100%;margin-bottom:10px;">
                Yes, Cancel This Session
              </button>
            </form>
          </div>"""
        return HttpResponse(_shell(ws.name, body))

    def post(self, request, token):
        try:
            activity = self._validate(token)
        except Exception:
            return self._invalid_response()

        if activity.status == "cancelled":
            return HttpResponse(_shell(activity.workspace.name, f"""
              <div class="card">
                <div class="icon">ℹ️</div>
                <h1>Already cancelled</h1>
                <p class="sub">This session was already cancelled.</p>
              </div>"""))

        # Cancel the activity
        activity.status = "cancelled"
        activity.save(update_fields=["status"])

        # Notify coach
        try:
            import threading
            from tasks.email import send_client_cancellation_notice
            threading.Thread(target=send_client_cancellation_notice, args=(str(activity.id),), daemon=True).start()
        except Exception as e:
            logger.error(f"Coach cancellation notice failed: {e}")

        ws = activity.workspace
        client_name = escape(activity.client.first_name or activity.client.full_name)
        body = f"""
          <div class="card">
            <div class="icon">✅</div>
            <h1>Session cancelled</h1>
            <p class="sub">Hi {client_name}, your session has been cancelled.<br>
              Your coach has been notified. Contact them to reschedule.</p>
            {_detail_box(activity)}
          </div>"""
        return HttpResponse(_shell(ws.name, body))

    def _invalid_response(self):
        return HttpResponse(_shell("CoachOS", """
          <div class="card">
            <div class="icon">⚠️</div>
            <h1>Link not valid</h1>
            <p class="sub">This link has expired or is invalid.<br>
              Please contact your coach directly to cancel.</p>
          </div>"""), status=400)


# ── Reschedule ─────────────────────────────────────────────────────────────────

class SessionRescheduleView(View):
    def _validate(self, token):
        action, activity_id = verify_session_token(token)
        if action != "reschedule":
            raise ValueError("Wrong action")
        return _get_activity(activity_id)

    def get(self, request, token):
        try:
            activity = self._validate(token)
        except Exception:
            return self._invalid_response()

        ws = activity.workspace
        client_name = escape(activity.client.first_name or activity.client.full_name)
        coach_name  = escape(activity.coach.full_name if activity.coach else ws.name)

        body = f"""
          <div class="card">
            <div class="icon">🔄</div>
            <h1>Request to reschedule</h1>
            <p class="sub">Hi {client_name}, let {coach_name} know your availability
              and they will confirm a new time.</p>
            {_detail_box(activity)}
            <form method="POST" action="">
              <textarea name="message" rows="4"
                placeholder="e.g. I'm available Monday–Wednesday after 3pm, or anytime Friday."
                required></textarea>
              <button type="submit" class="btn btn-primary" style="width:100%;">
                Send Reschedule Request
              </button>
            </form>
          </div>"""
        return HttpResponse(_shell(ws.name, body))

    def post(self, request, token):
        try:
            activity = self._validate(token)
        except Exception:
            return self._invalid_response()

        message = (request.POST.get("message") or "").strip()[:1000]

        # Mark activity as rescheduled so it shows in the Activities list
        if activity.status not in ("cancelled", "completed"):
            activity.status = "rescheduled"
            activity.save(update_fields=["status"])

        # Send reschedule request to coach
        try:
            import threading
            from tasks.email import send_client_reschedule_request
            threading.Thread(target=send_client_reschedule_request, args=(str(activity.id), message), daemon=True).start()
        except Exception as e:
            logger.error(f"Coach reschedule notice failed: {e}")

        ws = activity.workspace
        client_name = escape(activity.client.first_name or activity.client.full_name)
        coach_name  = escape(activity.coach.full_name if activity.coach else ws.name)

        body = f"""
          <div class="card">
            <div class="icon">✅</div>
            <h1>Request sent</h1>
            <p class="sub">Hi {client_name}, your reschedule request has been sent to {coach_name}.<br>
              They will reach out to confirm a new time.</p>
            {_detail_box(activity)}
          </div>"""
        return HttpResponse(_shell(ws.name, body))

    def _invalid_response(self):
        return HttpResponse(_shell("CoachOS", """
          <div class="card">
            <div class="icon">⚠️</div>
            <h1>Link not valid</h1>
            <p class="sub">This link has expired or is invalid.<br>
              Please contact your coach directly to reschedule.</p>
          </div>"""), status=400)
