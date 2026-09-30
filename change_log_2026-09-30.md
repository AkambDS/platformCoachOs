# Change Log — 2026-09-30

High-level summary of everything currently sitting in the working tree, not yet
committed. Grouped by feature. Written before commit per team convention (see
bottom of file for the process note).

---

## 1. Client portal — email-only login was a full auth bypass (critical fix)

- **What was wrong:** `POST /api/portal/login/` only ever checked "does this
  email match a `Client` row with `portal_access=True`" and, if so, issued a
  full 8-hour session token immediately — no password, no proof the caller
  actually controls that inbox. Anyone who knew (or guessed/harvested) a
  client's email could sign in as them and read their goals, invoices,
  session details, and coach notes shared with them.
- A `PortalLoginCode` model already existed in the codebase
  (`backend/apps/portal/models.py`) with a docstring describing exactly this
  problem and a hashed, rate-limited, attempt-capped 6-digit email code as
  the intended second factor — but it was never wired into any view. Dead
  scaffolding sitting next to a live hole.
- **Fix — two-step, email-verified login:**
  - `backend/apps/portal/views.py` — new `PortalRequestCodeView`
    (`POST /api/portal/request-code/`): looks up the email, and if it
    matches an active portal-access client, emails a 6-digit code (10 min
    expiry, SHA-256 hashed at rest, only one outstanding code per client at
    a time). Always returns the same generic acknowledgement regardless of
    match, so it can't be used to enumerate which emails have portal
    access — same rationale the old login endpoint used to have, moved to
    the step that now actually does the lookup.
  - `PortalLoginView` (`POST /api/portal/login/`) now requires
    `{email, code}` instead of just `{email}`. Verifies via
    `hmac.compare_digest` (constant-time), enforces the existing 5-attempt
    cap and expiry from `PortalLoginCode.is_valid()`, consumes the code on
    success, then issues the same portal JWT as before. Old email-only
    calls now hard-fail with `400 Email and code are required`.
  - New `PortalRequestCodeThrottle` (5/min per IP, registered in
    `DEFAULT_THROTTLE_RATES` in `backend/config/settings/base.py`) — separate
    from the existing 10/min login throttle, so the code-sending step can't
    be used to spam a client's inbox.
  - `backend/apps/portal/urls.py` — new `request-code/` route.
  - `backend/tasks/email.py` + `backend/tasks/email_html.py` — new
    `send_portal_login_code_email` task and `build_portal_login_code_email`
    template. Deliberately **not** routed through the Generic
    Templates/`EmailLog` system like other client-facing sends — this is a
    security code, not a brand message, and logging the plaintext code into
    the coach-visible Email Communications log would hand any team member on
    the workspace a live credential for the client's account during its
    10-minute validity window.
  - `frontend/src/pages/portal/ClientPortal.tsx` (`LoginScreen`) — now a
    two-step form: email → "Send Login Code", then a 6-digit code entry →
    "Access My Portal", with a "use a different email" fallback.
- **No migration needed** — reuses the `PortalLoginCode` model as-is.
- **Verified locally** against the real dev stack (Postgres, Redis, Celery
  worker, Mailpit): confirmed the old email-only attack now hard-fails,
  confirmed a wrong code is rejected, a correct code issues a working token
  that successfully calls `/api/portal/me/`, the code can't be reused after
  consumption, and an unknown email gets the identical generic response
  (no enumeration). `tsc --noEmit` clean.
- **Client-facing impact:** any client whose 8-hour session expires will go
  through the new two-step login next time — expected, not a regression.

## 2. Coach — Email Communication "Scheduled" tab now flags missed runs

- **What was wrong:** the Scheduled tab (subscription invoices due to
  auto-send, pending session reminders) is a live projection, not a stored
  queue — under normal operation it already stops showing an item once it's
  actually sent (invoice: `next_invoice_date` cleared; reminder: DB flag
  set). But the invoice query has no lower bound on `next_invoice_date`, so
  if a daily Celery Beat run is ever missed, an invoice's date sits in the
  past with nothing distinguishing it from a normal, comfortably-upcoming
  item — it just reads "Scheduled for [a date that's already gone by]".
- `backend/apps/clients/views.py` (`email_log_scheduled`) — each returned
  item now carries a `status` field: `"overdue"` when an invoice's
  `next_invoice_date` is before today, or a session reminder's fire time
  (`reminder_at`) is already behind `now`; `"scheduled"` otherwise.
- `frontend/src/pages/coach/EmailCommunication.tsx` — new `StatusBadge`
  (red "Overdue" / gold "Scheduled") in a new STATUS column on the
  Scheduled tab; the date itself also turns red when overdue. The detail
  modal swaps its explainer copy to "This didn't go out on schedule…" for
  overdue items instead of the normal per-category description.
- No model/migration changes.
- **Verified locally**: created one subscription invoice 3 days past due
  and one 5 days out against a real test workspace, called the endpoint
  directly — correctly returned `overdue` and `scheduled` respectively.
  `tsc --noEmit` and `py_compile` both clean. Test data cleaned up after.

---

## Not part of this session's work — flagging for your review

- `backend/tasks/reminders.py` has a third, substantial uncommitted diff in
  the working tree (reminder dispatch changed from a tight ±10-minute
  window around "now + hours_before" to a "due by" model that catches up
  after a missed Celery tick, plus de-duplicating so only the more urgent
  window fires per activity per run). **I did not make this change in this
  conversation** — it was already sitting in the working tree before this
  session touched anything. Worth confirming it's intentional/from a prior
  session before it goes into the same commit as §1–2 above, since it's
  functionally related to §2's "missed run" concept but independent code.

---

## Production deploy notes

- **No new env vars, no new migrations** for §1 or §2.
- §1 needs the Celery worker restarted after deploy (it registers the new
  `tasks.email.send_portal_login_code_email` task at worker startup — a
  plain code reload via `runserver`/gunicorn picks up the view changes
  immediately, but the worker process does not auto-reload task
  registrations):
  ```
  docker compose -f docker-compose.prod.yml restart celery_worker
  ```
- §2 is a pure read-path change (API response + frontend rendering) — no
  restart dependencies beyond the normal deploy.

---

## Process note

Per team convention: a `change_log_<YYYY-MM-DD>.md` file like this one is
added/updated before every commit, summarizing what that commit contains at
a high level.
