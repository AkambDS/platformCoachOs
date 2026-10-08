# Change Log — 2026-10-07

Covers everything uncommitted since `523a891` (Client portal: clients can mark
coach-set goals complete). Four groups of changes:

1. Email Communication — every workspace email is now logged (sent **and**
   failed), with a live Scheduled forecast and previews
2. Public demo — "Preview the Client Portal" tour step, demo-safe outbound
   email/SMS, richer seed data, tour UX polish
3. Django admin rendered unstyled (prod + local) — nginx / Vite fix
4. Docs

---

## 1. Email Communication — every email logged, plus Sent / Scheduled / Failed

Request: the Email Communication page should show *all* reminder and notice
emails, not just the handful of client-facing ones that happened to call
`EmailLog.log()` after sending.

### Backend

**One send path for every workspace email** — new `backend/tasks/email_log.py`:
- `send_logged(msg, workspace=, use_case=, client=, related_id=, audience=)`
  replaces `msg.send()` everywhere in `tasks/email.py` and
  `tasks/email_notices.py::send_notice`. It sends, then writes an `EmailLog`
  row. On failure it logs the row as `failed` with the error text and
  **re-raises**, so callers' own error handling / ErrorLog still runs.
- The scattered per-function `EmailLog.log(...)` blocks after each send were
  removed. A new email type can no longer skip the log by forgetting that call.
- Newly logged (previously invisible): pipeline follow-ups (owner, coach and
  client check-in), all coach copies and client-action notices,
  reschedule-request + acknowledgement, payment-failed, contract-signed,
  team invites.
- **Deliberately not logged:** portal login codes and password resets (contain
  one-time secrets), and platform-admin mail (feedback, error alerts,
  site health).
- `type_info(use_case)` → `(label, audience)`, using the same type keys as
  Settings → Emails; notice types come from `tasks.email_notices.NOTICES`.
- `capture_emails()` context manager: runs real send code in dry-run mode
  (messages collected, nothing sent or logged) — used by previews.

**`EmailLog` model** (`apps/clients/models.py`) + migration
`0025_emaillog_use_case_audience_status`:
- New fields: `use_case` (indexed), `audience` (`client` / `coach` / `team`),
  `status` (`sent` / `failed`), `error`.
- `category` is now `blank=True` — kept and still filled for old filters.
- Data migration backfills `use_case` on existing rows. Older 1-hour reminders
  show as "24h Session Reminder" because the old log never recorded which
  reminder it was.

**Scheduled forecast** — new `backend/tasks/email_forecast.py`:
- `scheduled_items(workspace, days)` computes, live, every email the scheduled
  jobs will send in the next N days (max 90): session reminders (24h + 1h, plus
  the coach's copy), recurring subscription invoices (voided ones now excluded,
  matching the real job), and pipeline follow-ups per recipient on their own
  schedule. Not stored as a queue, so it can't drift when a session moves or a
  stage's schedule changes.
- `preview(workspace, params)` renders an upcoming email by running the real
  send function inside `capture_emails()` and a rolled-back transaction —
  nothing is sent, logged or saved.

**Pipeline refactor** (`tasks/pipeline.py`) so the dispatcher and the forecast
share one set of rules: extracted `_workspace_tz()`, `_in_alert_window()`,
`recipient_settings()` and new `next_pipeline_send()` (next local 8 AM send for a
recipient). `dispatch_pipeline_alerts` behavior is unchanged.

**API** (`apps/clients/views.py`, `urls.py`):
- `GET /api/clients/email-log/` — new filters `audience`, `status`, `use_case`
  (plus existing `client`, `category`); limit raised 500 → 1000. Rows built by a
  shared `_email_log_row()` (detail view reuses it).
- `GET /api/clients/email-log/scheduled/` — now delegates to
  `scheduled_items()`; the old inline invoice/reminder logic was removed.
- **New** `GET /api/clients/email-log/scheduled/preview/` — rendered preview of
  one scheduled item (404 if it can't be previewed).

### Frontend — `pages/coach/EmailCommunication.tsx` (rewrite), `api/client.ts`
- Tabs: **Sent** (last 30 days) · **Scheduled** (next 30 days) · **Failed**
  (only shown when something failed, in red).
- Filters: recipient (All / Clients / Me & coaches / Team), email type (grouped
  by recipient, built from the types present in the current tab), client, search.
- Scheduled is grouped by day (Overdue, Today, Tomorrow, …); each row shows time,
  type, recipient and why (e.g. "Proposal Sent" stage · every Monday).
- Click a row: Sent → exact snapshot that went out; Failed → the error;
  Scheduled → preview with real data, with an "overdue" warning if it should
  already have gone out.
- New `emailCommApi.scheduledPreview()`.

### Tests (`apps/clients/tests.py`)
- `test_every_email_is_logged_including_failures` — notices log with the right
  type/audience; a simulated SMTP failure is logged as `failed` with the error
  and still raises.
- `test_scheduled_forecast_covers_pipeline_and_reminders` — forecast includes
  owner + client pipeline follow-ups (client weekly → lands on a Monday),
  24h/1h reminders and coach reminder copy; preview renders real data and
  writes no `EmailLog` rows.

---

## 2. Public demo — client portal preview, demo-safe sends, tour polish

### "Preview the Client Portal" as the final tour step
- **Backend:** new `PortalDemoLoginView` — `POST /api/portal/demo-login/`
  (throttled 20/min). Accepts **no input**; it always issues a 24h portal token
  for one hardcoded client (`DEMO_PORTAL_CLIENT_EMAIL = "maria.chen@example.com"`
  in `config/middleware.py`) in the `coachos-demo` workspace. Because there's no
  parameter, it can't be used to skip the login code for a real client. The
  client id is cached 5 min; returns 503 if the demo client is missing.
- Path added to `DemoWorkspaceReadOnlyMiddleware`'s exempt list (it only mints a
  token). Every portal write made with that token still carries the demo
  `workspace_id` and is blocked by the middleware.
- **Frontend:** `ClientPortal.tsx` — when opened as `/client-portal?demo=1`
  without a token, it calls `demo-login`, stores the session (plus a new
  `portal_is_demo` flag, cleared on logout), strips the query string, and shows
  a banner: "You're previewing {name}'s read-only client portal — nothing
  entered here is saved."
- `useTour.ts` — the last step ("Now, your client's view", `demoOnly`) opens
  that URL in a new tab on Finish. Only shown when logged in as the demo user,
  never on a real coach's "Take a Tour".

### Demo workspace can't send real email/SMS
Celery beat jobs run outside HTTP requests, so the read-only middleware never
saw them. Seeded upcoming sessions/invoices would have triggered real sends to
the fake `@example.com` addresses in production.
- New `config/email_backends.py::DemoSafeEmailBackend` (wraps Django's SMTP
  backend) drops any message whose recipients are **all** demo-workspace users
  or clients. Anything with a real recipient still sends. Recipient list cached
  5 min; `invalidate_demo_recipient_cache()` clears it.
- `production.py`: `EMAIL_BACKEND` → `config.email_backends.DemoSafeEmailBackend`
  (local still uses the plain SMTP backend → Mailpit).
- `tasks/sms.py::send_session_reminder` skips activities in the demo workspace.

### Seed data (`seed_demo_workspace.py`) — still idempotent
- Second team member **Jamie Park** (coach, random unusable password) so Team
  Management isn't a solo owner.
- A weekly Coach Availability block (Tue 09:00–12:00) on Maria Chen.
- Five backdated `EmailLog` rows (invoice, receipt, confirmation, reminder) so
  Email Communication has history; keyed with `get_or_create` to avoid
  duplicates on re-run.
- Asserts `DEMO_PORTAL_CLIENT_EMAIL` matches the seeded client; calls
  `invalidate_demo_recipient_cache()` at the end.

### Tour changes (`useTour.ts`, `Sidebar.tsx`, `index.css`, `Dashboard.tsx`)
- New intro step "One practice, three logins" (centered, no highlight —
  `element` is now optional).
- Three new owner-only Email Communication steps (page, tabs, filters);
  `data-tour="email-communication"` added to the sidebar link. Reports moved
  after Library. Clients step now mentions the Coach Availability tab.
- Step counter moved out of the title into a "Step N of M" label + gold
  progress bar (driver.js `onPopoverRender`; styles in `index.css`).
- `Dashboard.tsx` — the WelcomeModal is suppressed when the demo login
  auto-starts the tour, so two walkthroughs no longer stack on top of each other.

---

## 3. Django admin rendered without CSS (prod and local)

**Prod cause:** in `nginx/nginx.conf`, the regex block
`location ~* \.(js|css)$ { root /var/www/frontend; }` took priority over the
prefix block `location /static/`, so `/static/admin/css/*.css` was looked up in
the React build and 404'd. Images (`.svg`) still loaded through `/static/`.
Confirmed against prod: `base.css` → 404, `icon-yes.svg` → 200.
- **Fix:** `location /static/` → `location ^~ /static/` (wins over regex
  locations).

**Local cause:** opening the admin via Vite (`:5173`) served the SPA shell for
`/django-admin` and `/static`, because only `/api` and `/accounts` were proxied.
- `frontend/vite.config.ts` — proxy `/django-admin` and `/static` to Django.
- `backend/config/settings/local.py` — `CSRF_TRUSTED_ORIGINS` for
  `localhost:5173` / `127.0.0.1:5173`, otherwise the admin login form fails the
  CSRF origin check when submitted through Vite.
- `http://localhost:8000/django-admin/` worked before and still works.

---

## 4. Docs
- `CLAUDE.md` §9 — tour route list now includes `/email-communication` ×3.
- `calendar.md` — notes on the Email Communication logging feature.

---

## Verification (local, 2026-10-07)
- `npx tsc --noEmit` — clean.
- `makemigrations --check clients` — no missing migrations.
- `pytest` — **28 passed, 1 failed**: `test_smoke_e2e.py::test_full_client_lifecycle_smoke`
  asserts the goal-shared email lands in `mail.outbox`, but tests run with
  `config.settings.local` and a real Redis broker, so `send_goal_shared_email.delay()`
  went to the running `celery_worker` container. Its log shows the task ran there
  and failed with `ClientGoal matching query does not exist` (the dev DB, not the
  test DB). The test depends on the environment (no eager Celery in tests), and
  this changeset didn't cause it — the `.delay()` call is unchanged. It passes
  when the worker isn't consuming the queue. Worth fixing separately with
  `CELERY_TASK_ALWAYS_EAGER = True` in a test settings module.
- Admin static: via `:5173`, `base.css` → `200 text/css`, `/django-admin/login/` →
  Django page, and a login POST passes CSRF (bad credentials → 200 form error,
  not 403).
- Not browser-click-tested: new Email Communication page, portal-preview tour
  step.

---

## Deploy notes
1. `git pull` then `make deploy` (backend + frontend). Migration `0025` runs
   from the backend entrypoint.
2. `docker compose -f docker-compose.prod.yml restart nginx` — picks up the
   `^~ /static/` fix (config is bind-mounted, no rebuild needed). Check:
   `https://coachos.rass-consulting.com/static/admin/css/base.css` → 200.
3. Re-run `docker compose -f docker-compose.prod.yml exec backend python manage.py seed_demo_workspace`
   — adds Jamie Park, availability block, email history, and refreshes the
   demo caches.
4. Prod `EMAIL_BACKEND` changes to `DemoSafeEmailBackend` — after deploy, send
   one real email (e.g. an invite to yourself) to confirm normal delivery still works.
