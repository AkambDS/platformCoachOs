# CoachOS — System Design

Practice-management SaaS for independent coaches and consulting businesses:
client CRM, scheduling with Google Calendar sync, invoicing/payments,
a sales pipeline, a document library, and a self-serve client portal — all
scoped per workspace.

Reviewed from source on 2026-08-29. This is a living document — the
"Known gaps" section in particular should be updated as they're closed.

---

## 1. High-level architecture

```mermaid
flowchart TB
    subgraph Client-side
        Coach["Coach / WS owner browser<br/>(React SPA)"]
        ClientBrowser["Client browser<br/>(Portal SPA + public pay/sign links)"]
    end

    subgraph EC2["Single EC2 host — docker-compose.prod.yml"]
        Nginx["nginx<br/>TLS termination, path routing"]
        Django["Django / gunicorn<br/>DRF API"]
        Celery["Celery worker"]
        Beat["Celery beat<br/>(5 scheduled jobs)"]
        Redis[(Redis<br/>broker + result backend)]
        PG[(PostgreSQL)]
        OnlyOffice["OnlyOffice<br/>Document Server"]
        Static["Static SPA build<br/>(shared volume)"]
    end

    subgraph External
        Stripe["Stripe<br/>(per-workspace BYOK)"]
        Google["Google Calendar<br/>OAuth + push webhooks"]
        Zoom["Zoom REST API<br/>(per-workspace BYOK)"]
        SES["AWS SES / Brevo<br/>(transactional email)"]
        Twilio["Twilio (optional SMS)"]
        S3["AWS S3<br/>(files, media)"]

    end

    Coach -->|HTTPS| Nginx
    ClientBrowser -->|HTTPS| Nginx
    Nginx -->|/api/, /accounts/, /django-admin/,<br/>/invoices/, /contract/, /session/, /stripe/| Django
    Nginx -->|/, /static assets| Static
    Nginx -->|:8443, own server block| OnlyOffice
    Django <--> PG
    Django <--> Redis
    Django -->|delay()| Celery
    Beat -->|schedules| Celery
    Celery <--> PG
    Celery --> Stripe
    Celery --> Google
    Celery --> Zoom
    Celery --> SES
    Celery --> Twilio
    Django --> S3
    Django <-->|fetch/callback| OnlyOffice
    Django --> Stripe
    Django --> Google
```

One EC2 host, one Postgres, one Redis, one domain (`coachos.rass-consulting.com`)
routing both the API and the static SPA build via nginx path rules. No
per-tenant infrastructure — isolation is entirely at the application/data
layer (see §2).

---

## 2. Multi-tenancy model

- **Tenant boundary = `Workspace`.** Every business-scoped model carries a
  `workspace` FK (`WorkspaceModel` abstract base in `apps.accounts.models`).
  There is no schema-per-tenant or database-per-tenant — all workspaces share
  one Postgres database, isolated by `workspace_id` filtering in every
  queryset.
- **Users belong to exactly one workspace** (`User.workspace`, nullable only
  transiently before an invite is accepted). `platform_admin` is the one role
  that crosses workspace boundaries (superadmin).
- **Roles**: `business_owner` (WS owner), `coach`, `assistant`, `limited`,
  `platform_admin`. Role defaults are extended by `TabPermission` — a
  per-(user, tab) override table, so a business owner can grant/restrict an
  individual coach's view/edit/delete access to a specific section (Clients,
  Invoices, Reports, …) beyond their role's baseline. The frontend's
  `TabRoute`/`RoleRoute` wrappers mirror this so gated UI never renders for a
  role that would 403 anyway.
- **Auth**: JWT (`djangorestframework-simplejwt`) issued on login, carried in
  httpOnly cookies via a custom `CookieJWTAuthentication`, not the
  Authorization header — no server-side session for the main app. A second,
  parallel auth scope (`PortalJWTAuthentication`) exists for the client
  portal, scoped to `client_id`+`workspace_id`, with a distinct `role=
  portal_client` claim so a coach's JWT can never be replayed against the
  portal API or vice versa.

---

## 3. Domain modules

| App | Owns | Notes |
|---|---|---|
| `accounts` | User, Workspace, WorkspaceInvitation, TabPermission | Auth, roles, invites, Google Calendar OAuth connect flow |
| `clients` | Client, ClientNote, Assessment, ClientGoal, Commitment, GoalProgress, ClientMessageDraft, EmailLog | Core CRM; CSV import/export; contract e-signing (public link) |
| `activities` | Activity, GoogleCalendarWatch | Sessions/appointments; Google Calendar sync + RSVP push webhooks; reminders |
| `pipeline` | Deal, PipelineStageConfig, StageHistory, DealProgress | Sales pipeline / kanban; workspace-configurable stages; daily stall alerts |
| `invoicing` | Invoice, Payment | Billing; Stripe Checkout (BYOK per workspace); refunds; recurring invoices |
| `library` | KnowledgeFolder, KnowledgeItem | Document/resource library; OnlyOffice live editing; per-client sharing |
| `portal` | *(none — reads other apps' models)* | Client-facing self-serve app: goals, invoices, sessions, materials, notes |
| `reports` | *(none — computed)* | Revenue/outstanding invoice analytics only |
| `feedback` | FeedbackTicket, FeedbackComment | Internal bug/feature ticketing between workspace members and the owner |
| `settings_app` | *(none — Workspace.integrations JSON blob)* | Branding, taxonomies (statuses/tags/sources), Zoom + Stripe key storage |
| `audit` | AccessLog | Per-action audit trail, surfaced in Settings (owner) and Superadmin |
| `superadmin` | *(reads everything)* | Platform-admin console: workspace list, error log, audit log, plan/suspend controls |

**Notable design pattern repeated across the app**: "bring your own
credentials." Stripe and Zoom both work by each workspace pasting their own
API key into Settings, encrypted at rest via Fernet
(`apps.accounts.crypto`, key separate from Django's `SECRET_KEY`). CoachOS
never holds funds or a shared Stripe/Zoom account — money and meetings flow
directly between the workspace's own account and their client. This is the
model to follow for any future integration that touches a WS owner's own
external account or funds.

---

## 4. Key flows

### 4.1 Getting paid
```
Client clicks "Pay Invoice" (email or portal)
  → GET /invoices/pay/<signed-token>/   (public, no login)
  → Stripe Checkout Session created with THAT workspace's own secret key
  → client redirected to Stripe's hosted checkout page
  → Stripe redirects back to a plain "Payment received" confirmation page
  → (async, in parallel) Stripe calls
    POST /api/invoices/stripe-webhook/<workspace_id>/
    → signature verified against that workspace's own webhook secret
    → Payment row created, Invoice.status/amount_paid updated
```
Refunds mirror this: `InvoiceViewSet.issue_refund` calls Stripe's Refund API
with the workspace's key (money actually moves), and refunds issued directly
from the coach's own Stripe Dashboard reconcile back in via the
`charge.refunded` webhook — both paths dedupe against `Invoice.stripe_refund_ids`.

### 4.2 Scheduling + Google Calendar RSVP sync
```
Coach schedules a session (Activity created/updated)
  → tasks.calendar.sync_to_google_calendar
    → creates/updates a real Google Calendar event on THAT coach's
      calendar, client added as attendee
    → ensure_watch_channel: (re)registers a push-notification channel
      for that coach's calendar if none is fresh
Client accepts/declines the Google Calendar invite in their own inbox
  → Google pushes a notification to /api/webhooks/google-calendar/
  → tasks.calendar.process_calendar_notification
    → pulls the delta via events.list(syncToken=...)
    → Activity.client_rsvp_status updated; ACCEPTED also flips the
      existing client_confirmed flag (same signal your token-link
      confirm/cancel emails use)
```
Requires the coach to have connected their Google account (per-coach, not
workspace-wide) — see §5 for a caveat on this.

### 4.3 Client portal
Separate JWT scope, email-only login gated by `Client.portal_access`. A
client can: view goals and log progress, view/download invoices and pay
them, view upcoming/past sessions (coach-internal notes excluded), request a
reschedule, view materials shared with them, and read/write their own
portal notes. No assessment viewing, no messaging, no contract access from
here (contract signing is a separate public token-link flow).

---

## 5. Cross-cutting concerns

- **Encryption at rest**: Stripe/Zoom secrets via Fernet
  (`FIELD_ENCRYPTION_KEY`, `MultiFernet`-ready for future key rotation).
  Everything else (Zoom's older path, some config) stored plaintext in the
  `Workspace.integrations` JSON blob — intentionally lower bar than payment
  credentials per the code's own comments.
- **Audit logging**: `AccessLog` records per-user actions (viewed/created/
  updated/deleted across notes, files, goals, clients, team, password
  changes). Surfaced to the WS owner (`/api/audit/`, last 100) and to
  Superadmin (`/api/superadmin/workspaces/{id}/audit-log/`, last 20).
- **Error logging**: a custom DRF exception handler
  (`apps.accounts.error_logging.drf_exception_handler`) captures any
  unhandled 500 from a `/api/...` DRF view into `ErrorLog`, visible in
  Superadmin's Error Log tab. **Views outside DRF — allauth's
  `/accounts/...` flow, the public pay/contract/sign links — are not
  covered by this**; those only surface in raw container logs.
- **Async processing**: Celery + Redis, 5 scheduled jobs (activity
  reminders every 15 min, calendar-watch renewal daily, subscription
  invoice dispatch daily, pipeline stall alerts daily, pending-invite retry
  every 5 min), plus on-demand tasks (Stripe sync isn't async — it's
  synchronous inside the request; calendar sync, email, and SMS are).

---

## 6. Known gaps / unwired scaffolding

Worth knowing about before building on top of these areas:

- **`dj-stripe` (platform-level Stripe billing)** is installed and
  configured (`DJSTRIPE_WEBHOOK_SECRET` etc.) for CoachOS to bill *its own*
  workspaces, but `PlatformInvoice`/`PlatformPayment` billing is 100% manual
  today — this scaffolding is unused. Don't confuse its webhook with the
  per-workspace invoicing one.
- **`/portal` route is a dead stub** (`<Stub name="Client Portal" />`,
  "Coming soon") — the real client portal lives at `/client-portal`. Worth
  removing or redirecting to avoid confusion.
- **`Assessment.visible_to_client`** exists as a field (references "FR-CP-12"
  in its help text) but no `apps/portal` endpoint currently surfaces
  `Assessment` records to clients — only `library.KnowledgeItem` is exposed
  via `PortalMaterialsView`. Either the field is aspirational or there's a
  missing endpoint.
- **Google Calendar connect, while the OAuth app stays in Google's "Testing"
  publishing status** (unverified, external audience): refresh tokens expire
  after 7 days per Google policy, so each connected coach silently loses the
  connection weekly until the app completes Google's verification process
  for the Calendar sensitive scope.
- **No AI/LLM integration of any kind exists today** — confirmed via a full
  grep across backend and frontend (no SDK, no vector store, nothing in
  `requirements.txt`/`package.json`). See §7 — this is greenfield.

---

## 7. AI opportunities for WS owners

CoachOS already captures a lot of the raw material AI features need — session
notes, goal progress, pipeline notes, invoice history — it just doesn't do
anything with it yet beyond storing and displaying it. The suggestions below
are grounded in models/flows that already exist, ranked by leverage vs.
effort, not a generic "add a chatbot" list.

### Architecture recommendation first
Unlike Stripe/Zoom, an AI provider key isn't something each WS owner should
have to bring themselves — there's no funds/account-ownership reason to push
that burden onto them, and requiring your own OpenAI/Anthropic account would
kill adoption. Recommend a **platform-level API key** (env var, like
`RESEND_API_KEY`/`TWILIO_*` today), with usage metered/rate-limited per
workspace server-side if cost control matters. This is a smaller lift than
BYOK and matches how the rest of your third-party transactional services
(email, SMS) are already configured.

### Phase 1 — highest leverage, lowest risk (pure read + generate, human-in-the-loop)

1. **Session note summarization & action-item extraction.** A coach writes
   freeform notes on an `Activity`/`ClientNote` after a session; one call
   summarizes it and proposes `Commitment` rows and/or a `ClientMessageDraft`
   recap email for the coach to review and send. Plugs directly into three
   models that already exist for exactly this purpose — no new schema.
2. **Client health digest.** A weekly per-client or per-workspace summary
   generated from `GoalProgress` cadence, session attendance/RSVP patterns,
   and recent note sentiment — surfaces which clients need attention
   *before* they churn, rather than a coach having to notice on their own.
   This is the single highest-value idea here: it turns data coaches are
   already entering into proactive signal, which is the actual business
   value a coaching-practice tool should add beyond record-keeping.

### Phase 2 — builds on Phase 1's summarization infra

3. **Pipeline next-best-action.** `Deal.notes`/`next_action`/`DealProgress`
   history already exist; the daily `dispatch_pipeline_alerts` job currently
   sends a generic "this deal is stalling" nudge — enrich it with an
   AI-suggested next action drafted from the deal's own history.
4. **Drafted client communications beyond recaps** — re-engagement nudges
   for stalled clients, invoice reminder tone variants — using
   `ClientMessageDraft` as the existing draft-then-send pattern, so nothing
   ever auto-sends without a human clicking Send.
5. **DISC/behavioral assessment interpretation.** `Assessment` today is a
   dumb file upload with no scoring/interpretation layer. Extracting text
   from an uploaded PDF and generating coach-facing talking points would
   meaningfully upgrade an existing-but-inert feature.

### Phase 3 — needs genuinely new infrastructure, don't start here

6. **Semantic search** across notes/library/assessments (Library already has
   Postgres full-text search; going semantic needs an embeddings/vector
   store — real new infra, not a config addition).
7. **Session recording/transcript recap** — would need a Zoom recording
   pipeline that doesn't exist today (current Zoom integration only creates
   meetings via REST, no recording/transcript access).
8. **AI setup concierge** for new WS owners (configuring pipeline stages,
   client statuses, templates from a plain-language description of their
   business) — novel, higher design risk, lower urgency than 1–5.

---

## 8. Suggested scope

Recommend scoping an initial AI milestone to **items 1 and 2 only**:
- Both are pure read-existing-data-and-generate-text, no new write paths
  into money or scheduling flows.
- Both keep a human in the loop (coach reviews before anything goes to a
  client), matching the trust model of a coaching relationship.
- Both reuse existing models (`ClientNote`, `Activity`, `Commitment`,
  `ClientMessageDraft`, `GoalProgress`) — no new tenant-scoping or
  permission logic to design, TabPermission gating already applies.
- Together they directly answer "help the WS owner run their business":
  less time writing recaps, and earlier warning on clients at risk of
  churning — which is the actual commercial value a coach would pay more
  for, versus a general-purpose chatbot bolted onto the UI.

Everything past that (items 3–8) should wait until Phase 1 validates real
usage and cost, and until a decision is made on the platform-key-with-
metering approach above.

---

## 9. Technology Stack

Reviewed from `backend/requirements.txt`, `frontend/package.json`, and actual code
usage (not just what's installed) on 2026-09-30. Appended rather than inserted
earlier in the document so it doesn't shift the section numbers §2–§8 already
cross-referenced from `CLAUDE.md`.

### 9.1 Backend

| Layer | Technology | Version pin | Role in this app |
|---|---|---|---|
| Language / framework | Python 3.12, Django | `Django>=5.0,<5.2` | Core web framework, ORM, admin |
| API | Django REST Framework | `djangorestframework>=3.15,<3.16` | All `/api/...` endpoints |
| API docs | drf-spectacular | `>=0.27,<1.0` | OpenAPI schema + Swagger UI at `/api/schema/swagger-ui/` |
| Auth (coach/owner) | djangorestframework-simplejwt | `>=5.3,<6.0` | JWT issuance; custom `CookieJWTAuthentication` reads it from an httpOnly cookie, not a header |
| Auth (portal client) | PyJWT (direct) | `>=2.8,<3.0` | Separate `PortalJWTAuthentication` scope — a coach's JWT can never be replayed against the portal API |
| OAuth connect flows | django-allauth | `[socialaccount]>=0.61,<1.0` | Per-user "Connect Google Calendar" / "Connect Zoom" (see `integrations.md`) — issues/stores each user's own `SocialToken`, not used for primary login |
| Database | PostgreSQL | — | Single DB, `workspace_id` filtering in every queryset (no schema/DB-per-tenant) |
| DB driver | psycopg2-binary | `>=2.9,<3.0` | |
| Query filtering | django-filter | `>=24.0,<25.0` | `DjangoFilterBackend` on list endpoints |
| Cache + broker | Redis | — | Celery broker/result backend *and* Django's cache backend (falls back to in-memory locmem cache if `REDIS_URL` unset, e.g. bare local dev) |
| Async tasks | Celery | `>=5.3,<6.0` | All email/SMS sends, calendar sync, invoice generation, reminders, pipeline alerts |
| Scheduled jobs | django-celery-beat | `>=2.6,<3.0` | DB-backed cron schedule (`CELERY_BEAT_SCHEDULE`), editable/visible at `/django-admin/django_celery_beat/periodictask/` |
| Task result storage | django-celery-results | `>=2.5,<3.0` | Every task run persisted to DB (`CELERY_RESULT_BACKEND="django-db"`), visible at `/django-admin/django_celery_results/taskresult/` |
| Payments (platform billing) | dj-stripe + stripe-python | `dj-stripe>=2.9,<2.10`, `stripe>=8.0,<12.0` | dj-stripe is installed for CoachOS's *own* future platform billing (mostly unused/manual today, see `CLAUDE.md` §7) — the per-workspace client-invoicing Stripe integration calls the `stripe` SDK directly with each workspace's own BYOK secret, not through dj-stripe's models |
| File storage | django-storages + boto3 | `django-storages>=1.14,<2.0`, `boto3>=1.34,<2.0` | S3 in prod; MinIO (S3-compatible) in local dev — see `backend/apps/accounts/storage_utils.py` for the public/internal endpoint split this requires locally |
| PDF generation | WeasyPrint + pydyf | `weasyprint>=60.0,<63.0` | Renders invoice PDFs from HTML/CSS server-side |
| Images | Pillow | `>=10.0,<11.0` | Logo upload processing |
| Rate limiting | django-ratelimit + DRF throttle classes | `>=4.0,<5.0` | Per-view throttles (login, password reset, registration, portal login codes, etc. — see `DEFAULT_THROTTLE_RATES` in `config/settings/base.py`) |
| AI | Anthropic Python SDK | `anthropic>=0.40,<1.0` | Powers "Suggest with AI" session-note drafting (`apps/clients/ai_notes.py`); mockable locally via `AI_NOTES_MOCK` |
| Prod server | Gunicorn | `>=21.0,<22.0` | WSGI server behind nginx |
| Testing | pytest, pytest-django, factory-boy | `pytest>=8.0`, `pytest-django>=4.8`, `factory-boy>=3.3` | |

**Installed but not actively used today**: `django-anymail[brevo]` is in `requirements.txt`
but commented out of `INSTALLED_APPS` — a leftover from an earlier Render-based
deployment (see `CLAUDE.md`'s note on `DEMO_PPT.md`). Actual production email goes
through Django's built-in SMTP backend (`EmailBackend`) pointed at Resend's SMTP
relay via `EMAIL_HOST`/`EMAIL_HOST_USER`/`EMAIL_HOST_PASSWORD`; `RESEND_API_KEY` is
defined in settings but not currently called anywhere (Resend's HTTP API isn't used,
only its SMTP credentials).

### 9.2 Frontend

| Layer | Technology | Version pin | Role in this app |
|---|---|---|---|
| Language | TypeScript | `^5.4.5` | |
| Framework | React | `^18.3.1` | |
| Build tool | Vite | `^5.2.13` | Dev server + production bundling (`@vitejs/plugin-react`) |
| Routing | react-router-dom | `^6.23.1` | |
| Server state | @tanstack/react-query | `^5.40.0` | All API data fetching/caching — no Redux; see any `useQuery`/`useMutation` call across `pages/` |
| Client state | zustand | `^4.5.2` | Auth store (`useAuthStore`) — current user/workspace/role, persisted across the app shell |
| HTTP client | axios | `^1.7.2` | Wrapped in `src/api/client.ts`'s single `api` instance (cookie-based auth, interceptors) |
| Forms | react-hook-form + zod + @hookform/resolvers | `^7.51.5`, `^3.23.8`, `^3.6.0` | Form state + schema validation |
| Styling | Tailwind CSS + hand-written CSS | `^3.4.4` (+ `postcss`, `autoprefixer`) | Utility classes mixed with a bespoke design-system stylesheet (`index.css` — `.card`, `.pill`, `.btn-*`, CSS custom properties for the cream/navy/gold theme) |
| Icons | lucide-react | `^0.395.0` | Used throughout — sidebar nav, tab icons, inline action icons |
| Calendar UI | @fullcalendar/* (core, react, daygrid, timegrid, interaction) | `^6.1.14` | Powers the Schedule/Calendar page's month/week/day views and drag-to-reschedule |
| Charts | recharts | `^2.12.7` | Dashboard KPIs, Reports revenue/outstanding charts |
| Guided tour | driver.js | `^1.4.0` | Demo workspace walkthrough and the real "Take a Tour" feature (`useTour.ts`) |
| Dates | date-fns | `^3.6.0` | |
| Utilities | lodash, clsx | `^4.17.21`, `^2.1.1` | |

### 9.3 Infrastructure (not a library, but part of the stack)

| Component | Role |
|---|---|
| Docker Compose | `docker-compose.yml` (local dev) / `docker-compose.prod.yml` (single EC2 host) — orchestrates every service below |
| nginx | TLS termination, path-based routing to Django/static SPA/OnlyOffice; serves collected static files from a volume shared with the backend container (`/static/` → Django admin's CSS/JS) |
| OnlyOffice Document Server | Self-hosted (own container), JWT-signed requests between Django and the Document Server — in-browser live editing + view-only preview for Library files and client-portal shared files |
| MinIO | S3-compatible object storage, **local dev only** — a public/internal endpoint split (`MINIO_ENDPOINT` vs `MINIO_PUBLIC_URL`) that doesn't exist in prod (`AWS_S3_ENDPOINT_URL=None` there) |
| Let's Encrypt / certbot | TLS certs in prod, renewed via a webroot path nginx serves at `/.well-known/acme-challenge/` |

### 9.4 Third-party APIs / external services

| Service | Integration pattern | Used for |
|---|---|---|
| Stripe | Per-workspace BYOK — workspace pastes its own secret key, Fernet-encrypted at rest | Client invoice payments, Checkout, refunds — money moves directly between the workspace's own Stripe account and their client, never through a CoachOS-owned account |
| Google Calendar | Per-user OAuth (django-allauth) | Two-way session sync + client RSVP tracking via push-notification watch channels. **Known limitation**: the OAuth app is still in Google's "Testing" publishing status, so a connected coach's token silently expires every 7 days until verification completes (`CLAUDE.md` §7) |
| Zoom | Per-user OAuth (django-allauth) — reworked 2026-09-30, see `integrations.md` §2 | Auto-generates a meeting link under the *scheduling coach's own* Zoom account when a session's location is Zoom. Previously a single Server-to-Server app shared by the whole workspace; now each person connects their own account, Calendly-style |
| Resend | SMTP relay (Django's built-in SMTP backend, not Resend's HTTP API) | All transactional email — confirmations, reminders, invoices, portal invites, etc. |
| Twilio | Direct SDK call, optional (workspace can leave it unconfigured) | SMS session reminders |
| Anthropic (Claude) | Direct API call via the official Python SDK | AI-drafted session-note suggestions (coach reviews/edits before saving — nothing auto-persists) |
| AWS S3 | Via django-storages/boto3 | File storage in production (documents, logos, uploaded media) |
