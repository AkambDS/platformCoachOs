# CoachOS — Demo Presentation
> Slide-by-slide script. Each `---` is a new slide. Suggested tool: Google Slides or PowerPoint.

---

## Slide 1 — Title

# CoachOS
### The Operating System for Professional Coaches

> Manage clients, schedule sessions, track pipeline, invoice, and grow your practice — in one place.

**Live:** https://platformcoachos-1.onrender.com
**API Docs:** https://platformcoachos.onrender.com/api/schema/swagger-ui/

---

## Slide 2 — The Problem

**Executive coaches juggle too many disconnected tools:**

| Pain Point | Typical Workaround |
|---|---|
| Client notes & history | Google Docs / Notion |
| Scheduling | Calendly + Google Calendar |
| Invoicing | Stripe + QuickBooks |
| Pipeline tracking | Spreadsheet |
| Knowledge sharing | Email attachments |

> CoachOS unifies all of this in a single, coach-specific platform.

---

## Slide 3 — Who It's For

**Primary users:**
- Solo executive coaches
- Small coaching firms (2–10 coaches)

**Roles in the system:**
- **Business Owner** — full admin access, billing, team management
- **Coach** — manages own clients & schedule
- **Assistant** — limited operational access
- **Client** *(TBD)* — read-only portal

---

## Slide 4 — Live Demo Flow (Key Screens)

Walk through in this order during demo:

1. **Dashboard** — headline KPIs (active clients, pipeline value, upcoming sessions, outstanding invoices)
2. **Clients (CRM)** — create client, add goal + commitment, upload assessment
3. **Calendar** — create recurring session, trigger email reminder
4. **Pipeline** — move deal through stage funnel, view stage history audit trail
5. **Invoices** — create invoice with line items, mark paid, view PDF
6. **Reports** — monthly revenue bar chart, outstanding report, CSV export

---

## Slide 5 — Feature Map

```
┌──────────────────────────────────────────────────────────────────┐
│  CoachOS Feature Set                                             │
├───────────────┬──────────────┬────────────────┬─────────────────┤
│  CRM          │  Calendar    │  Pipeline      │  Invoicing      │
│  ─────────    │  ─────────   │  ─────────     │  ─────────      │
│  Clients      │  7 act types │  8-stage funnel│  One-time &     │
│  Goals        │  Recurrence  │  Deal value    │  subscriptions  │
│  Assessments  │  Reminders   │  Stage history │  Line items     │
│  Commitments  │  Google Cal  │  audit trail   │  Stripe ready   │
│  Progress log │  sync (TBD)  │                │  PDF invoices   │
├───────────────┴──────────────┴────────────────┴─────────────────┤
│  Reports          │  Library (TBD)    │  Client Portal (TBD)    │
│  ─────────        │  ─────────        │  ─────────              │
│  Revenue/mo       │  Nested folders   │  Client login           │
│  Outstanding      │  PDF/Video/Links  │  Goals + progress       │
│  CSV export       │  Versioning       │  Assessments            │
│  Dashboard KPIs   │  Client visible   │  Library items          │
└───────────────────┴───────────────────┴─────────────────────────┘
```

---

## Slide 6 — Technical Architecture

```
  Google OAuth2                        cron-job.org
  (django-allauth)                     (every 15 min)
        │                                    │
        │                     X-Cron-Secret  │
        ▼                                    ▼
┌───────────────────────────────────────────────────────┐
│              Render — Static Site                     │
│   React 18 · Vite · TypeScript · Tailwind CSS        │
│   Zustand · React Query · FullCalendar · Recharts    │
└────────────────────────┬──────────────────────────────┘
                         │  HTTPS REST  (JWT access + refresh)
                         ▼
┌───────────────────────────────────────────────────────┐
│              Render — Docker Web Service              │
│   Django 5 · DRF · Gunicorn + Uvicorn worker         │
│   WorkspaceTenantMiddleware  (sets RLS session var)   │
│   SimpleJWT · django-allauth · dj-stripe              │
└──────────────┬──────────────────────┬─────────────────┘
               │                      │
    ┌──────────▼──────────┐  ┌────────▼──────────────────┐
    │  Render Managed DB  │  │  External Services        │
    │  PostgreSQL 16      │  │  ───────────────────────  │
    │  Row-Level Security │  │  Brevo  — transactional   │
    │  (workspace + client│  │           email (anymail) │
    │   session variables)│  │  Stripe — payments (TBD)  │
    └─────────────────────┘  │  Twilio — SMS (TBD)       │
                             │  Sentry — errors (opt.)   │
                             └───────────────────────────┘

  Dev only:  MinIO (S3-compat) · Mailpit · Redis · Celery Beat
```

---

## Slide 7 — Technical Design Deep Dive

### Multi-Tenancy via Row-Level Security (RLS)

- Every request passes through `WorkspaceTenantMiddleware`
- Middleware extracts `workspace_id` from JWT and sets a **PostgreSQL session variable** (`app.workspace_id`)
- All queries automatically filtered at the DB layer — no chance of data leak across tenants
- Client portal users additionally set `app.client_id` for a second isolation boundary

### Auth — Google OAuth2 + JWT
- Google sign-in via **django-allauth** → issues a SimpleJWT access + refresh token pair
- Access token (short-lived) + refresh token (rotating) stored in `localStorage`
- Axios interceptor auto-refreshes on 401 — seamless UX
- Team invitations use time-limited signed tokens (48-hr expiry)

### Session Reminders — cron-job.org (not Celery in prod)
- **No Redis or Celery worker deployed on Render** (free tier limitation)
- cron-job.org calls `POST /api/internal/reminders/` every 15 minutes
- Request authenticated via `X-Cron-Secret` header (auto-generated in `render.yaml`)
- Django handler runs `dispatch_activity_reminders` inline and returns immediately
- Cache-based deduplication (Django cache key per activity+window) prevents double-firing
- Redis + Celery Beat used in **local dev only** via docker-compose

### Email — Brevo HTTP API (prod.py override)
- `render.yaml` contains `EMAIL_HOST_USER` / `EMAIL_HOST_PASSWORD` (Gmail SMTP) — **these are unused in production**
- `production.py` overrides `EMAIL_BACKEND` → `anymail.backends.brevo.EmailBackend`
- `BREVO_API_KEY` must be set manually in the Render dashboard (not in render.yaml)

### Invoice PDF Generation
- WeasyPrint renders HTML templates → PDF bytes
- **Currently stored on Render's ephemeral local disk** (FileSystemStorage) — files lost on redeploy
- Auto-increment invoice numbering per workspace (INV-0001, INV-0002, …)
- S3 / Azure Blob blocks are written in `production.py` but commented out (TBD)

---

## Slide 8 — Tech Stack Summary

| Layer | Technology | Where defined |
|---|---|---|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS | render.yaml (static site) |
| **State** | Zustand (auth), React Query (server state) | frontend only |
| **Forms** | React Hook Form + Zod | frontend only |
| **Charts / Calendar** | Recharts, FullCalendar | frontend only |
| **Backend** | Django 5 + DRF, Gunicorn + Uvicorn | render.yaml (Docker web service) |
| **Auth** | Google OAuth2 (django-allauth) + SimpleJWT | prod.py / base.py |
| **Database** | PostgreSQL 16, Row-Level Security | render.yaml (managed DB) |
| **Session Reminders** | cron-job.org → `/api/internal/reminders/` | render.yaml `CRON_SECRET` |
| **Email** | Brevo HTTP API via django-anymail | prod.py `EMAIL_BACKEND` |
| **File Storage** | FileSystemStorage *(ephemeral — TBD)* | prod.py `DEFAULT_FILE_STORAGE` |
| **Payments** | dj-stripe — *(keys not set, TBD)* | render.yaml `STRIPE_*` |
| **SMS** | Twilio — *(credentials not set, TBD)* | base.py |
| **PDF** | WeasyPrint | backend |
| **Observability** | Sentry SDK (optional), Render stdout logs | prod.py `SENTRY_DSN` |
| **Dev only** | Redis, Celery Beat, MinIO, Mailpit | docker-compose.yml |

---

## Slide 9 — Deployment Architecture (Render)

```
render.yaml  (3 resources)
│
├── backend  (Web Service — Docker)
│   ├── rootDir: backend/  ·  Port: 10000
│   ├── Runtime: Docker (backend/Dockerfile)
│   ├── Start cmd: gunicorn -k uvicorn.workers.UvicornWorker config.asgi:application
│   ├── Env vars in render.yaml (committed, safe defaults):
│   │     PORT=10000 · DEBUG=False
│   │     ALLOWED_HOSTS=platformcoachos.onrender.com,.onrender.com
│   │     FRONTEND_URL=https://platformcoachos-1.onrender.com
│   │     CORS_ALLOWED_ORIGINS=<backend+frontend URLs>
│   │     EMAIL_HOST_USER=CHANGE_ME  ← ⚠ unused (prod.py uses Brevo)
│   │     EMAIL_HOST_PASSWORD=CHANGE_ME  ← ⚠ unused
│   │     STRIPE_TEST_SECRET_KEY=""  ← TBD
│   │     DJSTRIPE_WEBHOOK_SECRET=""  ← TBD
│   │     CRON_SECRET=<auto-generated>  ← shared with cron-job.org
│   │     SECRET_KEY=<auto-generated>
│   └── Env vars set MANUALLY in Render dashboard (not in yaml):
│         BREVO_API_KEY  ← actual email sender
│         SENTRY_DSN     ← optional error tracking
│
├── frontend  (Static Site)
│   ├── rootDir: frontend/
│   ├── Build: npm ci && npm run build  ·  Publish: dist/
│   ├── SPA rewrite: /* → /index.html
│   └── VITE_API_BASE_URL=https://platformcoachos.onrender.com
│
└── db  (Managed PostgreSQL 16 — free plan)
    ├── databaseName: coachos  ·  user: coachos_user
    └── DATABASE_URL auto-injected into backend

External (not in render.yaml):
  cron-job.org → POST /api/internal/reminders/  every 15 min
                 Header: X-Cron-Secret: <CRON_SECRET>
  Google OAuth → django-allauth handles callback at /accounts/google/
```

**prod.py security settings:**
- `SECURE_PROXY_SSL_HEADER` — trusts Render's `X-Forwarded-Proto: https`
- `SESSION_COOKIE_SECURE = True`, `CSRF_COOKIE_SECURE = True`
- `SECURE_HSTS_SECONDS = 31536000` (1 year)
- `SECURE_SSL_REDIRECT = False` ← **TBD: re-enable after confirming no redirect loops**
- CSRF trusted origins: `*.onrender.com`

---

## Slide 10 — Known TBDs & Gaps

### 🔴 Critical (Blocks Production Readiness)

| # | Issue | Location | Fix Needed |
|---|---|---|---|
| 1 | **`SECURE_SSL_REDIRECT = False`** | `production.py:20` | Re-enable after confirming HTTPS works end-to-end |
| 2 | **File storage = `FileSystemStorage`** | `production.py:51` | Files stored on Render's ephemeral disk — **lost on redeploy**. Uncomment AWS S3 or Azure Blob block |
| 3 | **`BREVO_API_KEY` defaults to `""`** | `production.py:39` | Emails silently fail if key not set in Render dashboard |
| 4 | **Stripe keys empty** | `render.yaml` | `STRIPE_TEST_SECRET_KEY=""` — payments non-functional until set |

### 🟡 Feature Gaps (Planned, Not Yet Built)

| # | Feature | Status |
|---|---|---|
| 5 | **Client Portal** | Backend models exist; frontend routed to "Coming Soon" stub |
| 6 | **Knowledge Library** | Backend models exist; frontend routed to "Coming Soon" stub |
| 7 | **Google Calendar Sync** | Backend `tasks/calendar.py` written; not tested or wired to UI |
| 8 | **SMS Reminders (Twilio)** | Integration code written; Twilio account credentials not configured |

### 🟢 Future Roadmap

| # | Idea |
|---|---|
| 9 | **AI coaching assistant** — Claude API for session summaries, goal analysis, follow-up suggestions |
| 10 | **Real-time updates** — WebSocket or SSE for live calendar and notification updates |
| 11 | **Test coverage** — currently minimal (accounts + clients basic tests only) |
| 12 | **RLS policy migrations** — middleware references DB-level policies; migrations should explicitly define them |

---

## Slide 11 — Security Posture

**What's in place:**
- Multi-tenant data isolation at DB level (PostgreSQL RLS session variables)
- JWT with rotating refresh tokens
- CORS locked to Render domains
- CSRF protection with trusted origins
- HTTPS enforced via Render's proxy (HSTS 1 year)
- Role-based access control (Business Owner / Coach / Assistant)
- Timed invitation tokens (48hr expiry)

**What still needs attention:**
- `SECURE_SSL_REDIRECT = False` in production.py — temporary debug flag, must be re-enabled
- File storage on ephemeral disk — not a security issue but a data loss risk
- No rate limiting on auth endpoints
- No 2FA / MFA option yet

---

## Slide 12 — What's Next / Ask

**Short term (ship-blockers):**
1. Enable `SECURE_SSL_REDIRECT = True` and verify no redirect loops
2. Configure S3 or Azure Blob for persistent file storage
3. Set Brevo + Stripe keys in Render dashboard and smoke-test

**Medium term (feature complete):**
4. Ship Client Portal (backend already done)
5. Ship Knowledge Library UI
6. Wire and test Google Calendar 2-way sync

**Longer term (growth):**
7. AI coaching features (Claude API integration)
8. Mobile-responsive polish / native app
9. Expand to team/enterprise plan tier

---

## Appendix A — API Surface

All endpoints under `/api/`:

| Group | Endpoints |
|---|---|
| `auth/` | login, register, refresh, team, invite |
| `clients/` | CRUD clients, goals, assessments, commitments, progress |
| `activities/` | CRUD activities, recurrence, reminders |
| `pipeline/` | deals, stage history |
| `invoices/` | invoices, line items, payments, PDF |
| `reports/` | revenue, outstanding, CSV export |
| `library/` | folders, items, versions |
| `settings/` | workspace branding, prefs |
| `portal/` | client-scoped read-only views |
| `stripe/` | webhook receiver |

Full OpenAPI spec: `/api/schema/swagger-ui/`

---

## Appendix B — Local Dev Quick Start

```bash
# Clone and start full stack
git clone <repo>
cd coachos
docker compose up --build

# Backend: http://localhost:8000
# Frontend: http://localhost:5173
# MinIO (S3): http://localhost:9001
# Mailpit (email): http://localhost:8025
```
