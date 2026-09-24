# CoachOS — Requirements & Design Reference

Practice-management SaaS for independent coaches and small coaching firms:
client CRM, scheduling with Google Calendar sync, invoicing/payments, a sales
pipeline, a document library, and a self-serve client portal — all scoped
per workspace (tenant).

**Live production:** https://coachos.rass-consulting.com/login
Compiled 2026-09-16 from `README.md`, `system_design.md`, `DEPLOY.md`,
`DEMO_PPT.md`, the Django app layout under `backend/apps/`, and the route
list under `frontend/src/pages/`. Treat `system_design.md` as the deeper
technical companion to this file — this file is the requirements/design
summary; that one has flow-level detail (Stripe payment flow, Google
Calendar RSVP sync, encryption-at-rest specifics).

---

## 1. Product summary

**Who it's for:** solo executive coaches and small coaching firms (2–10
coaches) who today juggle Notion/Google Docs (client notes), Calendly +
Google Calendar (scheduling), Stripe + QuickBooks (invoicing), and a
spreadsheet (pipeline) as disconnected tools.

**Core value proposition:** one workspace-scoped system of record for the
coach's whole practice — clients, sessions, pipeline, invoicing, documents —
plus a branded self-serve portal their own clients can log into.

**Roles** (per workspace):
| Role | Scope |
|---|---|
| `business_owner` | Full admin: billing, team, all data, integrations |
| `coach` | Own clients & schedule; extendable per-tab via `TabPermission` |
| `assistant` | Limited operational access |
| `limited` | Further-restricted role, gated per tab |
| `platform_admin` | Crosses workspace boundaries — CoachOS's own superadmin console |
| `portal_client` | Separate auth scope — the coach's own client, self-serve portal only |

---

## 2. High-level architecture

```
Coach browser (React SPA)  ─┐
Client browser (Portal SPA, ├─HTTPS─▶  nginx (TLS + path routing)
 public pay/sign links)     ┘              │
                                            ├─▶ /api/, /accounts/, /django-admin/,
                                            │   /invoices/, /contract/, /session/,
                                            │   /stripe/  →  Django/gunicorn (DRF)
                                            ├─▶ /, static assets → SPA build
                                            └─▶ :8443 → OnlyOffice Document Server

Django ──▶ PostgreSQL (single DB, RLS-style workspace_id filtering)
Django ──▶ Redis (Celery broker/result backend)
Django ──delay()──▶ Celery worker ──▶ Celery beat (5 scheduled jobs)
Celery ──▶ Stripe / Google Calendar / Zoom / SES(Resend) / Twilio
Django ──▶ S3 (files, media)
```

- **Single EC2 host**, single Postgres, single Redis, one domain
  (`coachos.rass-consulting.com`) — `docker-compose.prod.yml` runs everything.
  No per-tenant infrastructure; isolation is entirely application/data-layer.
- **Frontend:** React 18 + TypeScript + Vite, Zustand (auth store),
  React Query, Tailwind, FullCalendar, Recharts.
- **Backend:** Django 5 + DRF, `djangorestframework-simplejwt`, dj-stripe
  (installed, mostly unused — see §7), Celery + Redis, WeasyPrint (PDF).
- **Note on `DEMO_PPT.md`:** it documents an earlier Render-based deployment
  (cron-job.org instead of Celery beat, Brevo instead of Resend). Current
  production is the EC2/`docker-compose.prod.yml` architecture described in
  `system_design.md` and above — treat `DEMO_PPT.md`'s slides 6–9 as
  historical, not current-state.

---

## 3. Multi-tenancy & auth (requirements this shapes every feature)

- **Tenant boundary = `Workspace`.** Every business-scoped model carries a
  `workspace` FK. All workspaces share one Postgres database; isolation is
  `workspace_id` filtering in every queryset, set via
  `WorkspaceTenantMiddleware` from the JWT on each request.
- **A user belongs to exactly one workspace.** Role defaults are extended
  per-user, per-tab by `TabPermission` — an owner can grant/restrict an
  individual coach's view/edit/delete rights on a specific section (Clients,
  Invoices, Reports, …). The frontend mirrors this with `TabRoute`/
  `RoleRoute` wrappers so gated UI never renders for a role that would 403.
- **Auth (coach/owner side):** JWT (SimpleJWT), issued on login, carried in
  httpOnly cookies via a custom `CookieJWTAuthentication` — no server-side
  session for the main app.
- **Auth (client portal side):** a second, parallel JWT scope
  (`PortalJWTAuthentication`), scoped to `client_id` + `workspace_id`, with a
  distinct `role=portal_client` claim — a coach's JWT can never be replayed
  against the portal API or vice versa.
- **"Bring your own credentials" pattern:** Stripe and Zoom each work by the
  workspace pasting their *own* API key into Settings (Fernet-encrypted at
  rest, key separate from `SECRET_KEY`). CoachOS never holds client funds or
  a shared Stripe/Zoom account — this is the required pattern for any future
  integration touching a workspace owner's own money or meetings.

---

## 4. Domain modules → functional requirements

| Module (`backend/apps/`) | Frontend pages | Owns | Requirement group |
|---|---|---|---|
| `accounts` | `auth/Login`, `Register`, `ForgotPassword`, `ResetPassword`, `AcceptInvite`; `coach/Team` | User, Workspace, WorkspaceInvitation, TabPermission | FR-AUTH-*: signup/login, team invites, Google Calendar OAuth connect |
| `clients` | `coach/Clients`, `ClientDetail`, `NewClient` | Client, ClientNote, Assessment, ClientGoal, Commitment, GoalProgress, ClientMessageDraft, EmailLog | FR-CRM-*: CRM, goals/commitments, assessments, CSV import/export, contract e-signing (public link) |
| `activities` | `coach/Calendar`, `Activities` | Activity, GoogleCalendarWatch | FR-ACT-*: sessions/appointments, recurrence, reminders, Google Calendar 2-way sync |
| `pipeline` | `coach/Pipeline`, `NewDeal` | Deal, PipelineStageConfig, StageHistory, DealProgress | FR-SF-*: sales pipeline/kanban, configurable stages, stall alerts |
| `invoicing` | `coach/Invoices`, `InvoiceDetail`, `NewInvoice` | Invoice, Payment | FR-INV-*: billing, Stripe Checkout (BYOK), refunds, recurring invoices, PDF |
| `reports` | `coach/Reports` | *(computed only)* | FR-REP-*: revenue/outstanding analytics, CSV export, dashboard KPIs |
| `library` | `coach/Library` | KnowledgeFolder, KnowledgeItem | FR-LIB-*: document/resource library, OnlyOffice live editing, per-client sharing |
| `portal` | `portal/ClientPortal` | *(reads other apps)* | FR-CP-*: client self-serve — goals, invoices, sessions, materials, notes |
| `settings_app` | `coach/Settings` | *(Workspace.integrations JSON)* | Branding, taxonomies (statuses/tags/sources), Zoom + Stripe key storage |
| `feedback` | `coach/FeedbackList`, `FeedbackDetail` | FeedbackTicket, FeedbackComment | Internal bug/feature ticketing between team and owner |
| `audit` | (surfaced in Settings) | AccessLog | Per-action audit trail |
| `superadmin` | `superadmin/AdminDashboard`, `AdminWorkspace` | *(reads everything)* | Platform-admin console: workspace list, error log, audit log, plan/suspend |

Also present: `coach/Dashboard` (KPI home), `coach/EmailCommunication`,
`legal/PrivacyPolicy` + `TermsOfService`, `Home.tsx` (marketing/landing).

---

## 5. Key flows

### 5.1 Getting paid (Stripe, per-workspace BYOK)
```
Client clicks "Pay Invoice" (email or portal)
 → GET /invoices/pay/<signed-token>/           (public, no login)
 → Stripe Checkout Session created with THAT workspace's own secret key
 → client redirected to Stripe's hosted checkout page
 → Stripe redirects back to a "Payment received" confirmation page
 → (async) Stripe calls POST /api/invoices/stripe-webhook/<workspace_id>/
   → signature verified against that workspace's own webhook secret
   → Payment row created; Invoice.status/amount_paid updated
```
Refunds mirror this — `InvoiceViewSet.issue_refund` calls Stripe's Refund
API with the workspace's own key (money actually moves); refunds issued
directly from the coach's Stripe Dashboard reconcile back via the
`charge.refunded` webhook. Both paths dedupe on `Invoice.stripe_refund_ids`.

### 5.2 Scheduling + Google Calendar RSVP sync
```
Coach schedules a session (Activity created/updated)
 → sync_to_google_calendar: creates/updates the event on that coach's
   own Google Calendar, client added as attendee
 → ensure_watch_channel: (re)registers a push-notification channel
Client accepts/declines in their own inbox
 → Google pushes to /api/webhooks/google-calendar/
 → process_calendar_notification pulls the delta, updates
   Activity.client_rsvp_status (ACCEPTED also flips client_confirmed)
```
Per-coach connection, not workspace-wide — see §7 for the token-expiry caveat.

### 5.3 Client portal
Separate JWT scope, email-only login gated by `Client.portal_access`. A
client can: view goals and log progress, view/download/pay invoices, view
upcoming/past sessions (internal coach notes excluded), request a
reschedule, view shared materials, read/write their own portal notes.
Explicitly **out of scope** from the portal: assessments, messaging,
contract access (contract signing is a separate public token-link flow).

---

## 6. Cross-cutting requirements

- **Encryption at rest:** Stripe/Zoom secrets via Fernet
  (`FIELD_ENCRYPTION_KEY`). Losing this key makes every saved Stripe/webhook
  key undecryptable — must be backed up like `SECRET_KEY`, never reused
  between dev and prod.
- **Audit logging:** `AccessLog` records per-user actions (view/create/
  update/delete across notes, files, goals, clients, team, password
  changes) — surfaced to the workspace owner (last 100) and Superadmin
  (last 20 per workspace).
- **Error logging:** unhandled 500s from `/api/...` DRF views are captured
  into `ErrorLog`, visible in Superadmin. Views outside DRF (allauth's
  `/accounts/...`, public pay/contract/sign links) are **not** covered —
  only visible in raw container logs.
- **Async processing:** Celery + Redis in production, 5 scheduled jobs
  (activity reminders every 15 min, calendar-watch renewal daily,
  subscription invoice dispatch daily, pipeline stall alerts daily,
  pending-invite retry every 5 min). Stripe calls are synchronous inside
  the request; calendar sync, email, and SMS are async.

---

## 7. Known gaps / unwired scaffolding

Important to know before building on top of these areas:

- **`dj-stripe`** (platform-level billing) is installed/configured for
  CoachOS to bill *its own* workspaces, but `PlatformInvoice`/
  `PlatformPayment` billing is 100% manual today — unused scaffolding, not
  to be confused with the per-workspace invoicing Stripe integration.
- **`/portal` route is a dead stub** — the real client portal is at
  `/client-portal`. Worth removing/redirecting to avoid confusion.
- **`Assessment.visible_to_client`** exists as a field but no portal
  endpoint currently surfaces `Assessment` to clients — only
  `KnowledgeItem` is exposed via `PortalMaterialsView`.
- **Google Calendar OAuth app is in Google's "Testing" publishing status**
  (unverified, external audience) → refresh tokens expire after 7 days, so
  every connected coach silently loses the connection weekly until the app
  completes Google's verification for the Calendar sensitive scope.
- **No AI/LLM integration exists today** — confirmed via full grep, no SDK,
  no vector store. See `system_design.md` §7–8 for a ranked list of AI
  opportunities (session-note summarization + client health digest are the
  recommended first milestone — pure read-and-generate, human-in-the-loop,
  reuse existing models, no new tenant-scoping to design).
- **File storage / SSL-redirect / Brevo-vs-Resend flags** called out in
  `DEMO_PPT.md` slide 10 reflect the *old* Render deployment, not current
  EC2 prod — re-verify against `backend/config/settings/production.py`
  before treating any of those as still-open.

---

## 8. Operations quick reference

- **Deploy:** `git push` locally → on EC2, `git pull` then
  `make deploy` (full), `make deploy-backend` (skip frontend rebuild), or
  `make deploy-frontend HOST=ubuntu@<ec2-ip>` (local build + rsync). Always
  via `docker-compose.prod.yml` — the bare `docker compose up` uses the dev
  compose file and is wrong on EC2.
- **Local dev:** `docker compose up --build` → frontend `:5173`, Django
  admin `:8000/admin`, API docs `:8000/api/schema/swagger-ui/`.
- **Full deployment/runbook detail:** `DEPLOY.md` (OnlyOffice JWT setup,
  Stripe operator + workspace-owner setup and test plan, Resend domain
  verification, backup commands).

---

## 9. Public demo / guided product tour

Built 2026-09-16: a "Log In as Demo User" flow reachable from `/` and
`/login`, backed by a real seeded workspace, that launches an in-app
screen-by-screen guided tour (driver.js) across every feature area,
including Settings. **Not yet deployed to production** — built and verified
locally (see below); deploying is a separate step for whoever has EC2 SSH
access (§8), since this environment doesn't have that access.

- **Backend seed command:** `backend/apps/accounts/management/commands/seed_demo_workspace.py`
  — idempotent (`get_or_create`/`update_or_create` throughout, safe to
  re-run any time to top up data demo visitors have edited/deleted).
  Provisions workspace slug `coachos-demo` (`demo@coachos.rass-consulting.com`
  / `CoachOSDemo!2026`, `business_owner` role), reuses the app's own
  builtin-default helpers from `apps/settings_app/views.py`
  (`_seed_pipeline_stages`, `_seed_client_statuses`, `_seed_lead_sources`,
  `_seed_activity_types`) rather than duplicating those lists, and seeds 6
  clients across all pipeline stages, goals/commitments/progress, 3
  activities (1 past + 2 upcoming), 3 invoices (paid/sent/overdue), and a
  Library folder with sample documents.
  **Run once after deploying** (also whenever you want to refresh the demo
  data): `docker compose -f docker-compose.prod.yml exec backend python manage.py seed_demo_workspace`.
- **Frontend:**
  - `frontend/src/constants/demo.ts` — single source of truth for the demo
    credentials (must stay in sync with the backend command) and the
    `sessionStorage` key used to hand off "start the tour" across the
    login → dashboard redirect.
  - `frontend/src/pages/auth/Login.tsx` — new panel below the sign-in form
    showing the test login and a one-click "Log In as Demo User & Take the
    Tour" button.
  - `frontend/src/pages/Home.tsx` — "Try the Live Demo" CTA added next to
    "Sign In" on the public `/` page (the one Google's OAuth review
    requires to stay accessible without login — this CTA doesn't affect
    that, it's just a link to `/login`).
  - `frontend/src/hooks/useTour.ts` — rewritten from a static sidebar-only
    tour into a router-aware walkthrough: each step navigates to the real
    screen (`/dashboard`, `/clients`, `/pipeline`, `/calendar`, `/invoices`,
    `/reports`, `/library`, `/settings` ×2, `/team`) and highlights it via
    `driver.js`, filtering the Team step for non-owners. This is also the
    same "Take a Tour" button already on the Dashboard for real users —
    the demo didn't introduce a second tour engine.
  - `frontend/src/pages/coach/Dashboard.tsx` — auto-launches the tour on
    mount when the demo login set its flag.
  - `frontend/src/components/layout/Sidebar.tsx`,
    `frontend/src/pages/coach/Settings.tsx` — added `data-tour` anchors for
    Library, Team, and the Settings → Integrations section (Dashboard,
    Clients, Pipeline, Activities, Invoices, Reports, Settings anchors
    already existed from an earlier partial tour implementation).
- **Verified locally** (`docker compose up --build`): seed command runs
  clean, is idempotent on a second run (checked row counts), demo login
  succeeds against the real `/api/auth/login/` endpoint, pipeline-stage
  defaults lazy-seed correctly, `tsc --noEmit` passes, and both `/` and
  `/login` serve 200. Not visually click-tested in a real browser in this
  environment — worth a manual pass through the tour before/after deploy.
- **Read-only enforcement (added after initial build):** the demo workspace
  is hard-locked to read-only at the middleware layer —
  `backend/config/middleware.py`'s `DemoWorkspaceReadOnlyMiddleware` blocks
  every non-GET/HEAD/OPTIONS request under `/api/` whose JWT resolves to the
  `coachos-demo` workspace, returning a 403 with a friendly `detail`
  message, before any view (and therefore any Stripe/email/DB-write side
  effect) runs. This had to be true Django middleware rather than a DRF
  `DEFAULT_PERMISSION_CLASSES` entry — most views here declare their own
  `permission_classes`, which *replaces* rather than extends the defaults,
  so a global default permission class would silently miss most endpoints.
  Registered in `MIDDLEWARE` right after `WorkspaceTenantMiddleware`.
  Login/logout/refresh (`/api/auth/login|logout|refresh/`) are exempted so
  the demo flow itself keeps working. Real workspaces are entirely
  unaffected — verified locally by registering a throwaway real workspace
  and confirming its writes succeed while the demo workspace's are blocked.
  The demo workspace id is cached (5 min TTL, Redis-backed in prod); the
  seed command invalidates it immediately after (re)provisioning via
  `invalidate_demo_workspace_cache()`, so re-seeding doesn't leave a stale
  window. Frontend: `frontend/src/components/layout/AppShell.tsx` shows a
  persistent banner ("You're viewing a shared, read-only demo workspace…")
  whenever `workspace.slug === 'coachos-demo'`, so visitors see this
  up front rather than only discovering it via a failed save.
- **Known trade-off:** visitors can't mutate data anymore, but the workspace
  is still shared — if data ever needs a reset (e.g. someone floods it with
  garbage via read-only-safe fields, or you just want it pristine again),
  re-run `seed_demo_workspace`; it's idempotent and safe to schedule.
- **Lead capture gate (added 2026-09-16):** clicking "Log In as Demo User &
  Take the Tour" now opens `frontend/src/components/DemoGateModal.tsx` first
  — first name + email required — before the demo login proceeds. This is
  for sales follow-up, entirely separate from the read-only enforcement
  above (a submitted lead still can't write anything in the demo workspace).
  - **Backend:** new `DemoLead` model (`apps/superadmin/models.py`,
    migration `0008_demolead_...`) keyed by unique email. Three endpoints in
    `apps/superadmin/views.py`: `POST /api/demo/lead/` (public, captures/
    updates a lead — get_or_create by email, bumps `login_count` each visit)
    and `POST /api/demo/lead/event/` (public, marks `tour_started` /
    `tour_completed`, called from `useTour.ts` while already logged in as
    the demo user — both paths are in `DemoWorkspaceReadOnlyMiddleware`'s
    exempt list since they're analytics writes about the demo, not
    workspace data), and `GET /api/superadmin/demo-leads/`
    (`IsPlatformAdmin`-gated, lists every lead). All three throttled via a
    new `demo_lead: "30/hour"` rate in `DEFAULT_THROTTLE_RATES`.
  - **Frontend:** `Login.tsx` now calls `demoApi.captureLead()` on gate
    submit before the fixed-credential login, then stores the entered email
    in `sessionStorage` (`DEMO_LEAD_EMAIL_KEY`) so `useTour.ts` can report
    `tour_started` when the tour opens and `tour_completed` on the "Finish"
    click — gated on `user?.email === DEMO_EMAIL` so a real coach's own
    "Take a Tour" click never touches this endpoint.
  - **Superadmin UI:** new "Demo Leads" tab (`/admin#demo-leads`,
    `pages/superadmin/AdminDashboard.tsx` + nav entry in `Sidebar.tsx`) —
    table of first name / email (mailto link) / login count / tour started
    / tour completed / first seen / last seen, newest activity first.
  - **Verified locally**, same method as the rest of this feature: gate
    submission → demo login → tour-started/completed events → confirmed
    visible in the superadmin list via a throwaway `platform_admin` test
    account (cleaned up after). `tsc --noEmit` clean; migration applied
    without pulling in unrelated pre-existing schema drift (see the
    migration file's own comment — the autodetector also flagged
    unrelated, already-existing changes on `MaintenanceBanner`/
    `PlatformInvoice`/`PlatformPayment` that predate this work and were
    deliberately left out of this migration).
