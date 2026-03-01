# CoachOS — Development Starter

**Stack:** Django 5 + DRF + dj-stripe | React 18 + TypeScript | PostgreSQL 16 | Redis | MinIO

## Quick Start (5 commands)

```bash
# 1. Clone / navigate to project root
cd coachos

# 2. Copy env file (already pre-filled for local dev)
cp backend/.env.example backend/.env   # edit Stripe + Google keys when ready

# 3. Start all services
docker compose up --build

# 4. Create Django superuser (new terminal)
docker compose exec api python manage.py createsuperuser

# 5. Open in browser
# Frontend:     http://localhost:5173
# Django Admin: http://localhost:8000/admin
# API Docs:     http://localhost:8000/api/schema/swagger-ui/
# Mailpit:      http://localhost:8025
# MinIO:        http://localhost:9001  (user: coachos / pass: coachos_minio_secret)
```

## Project Structure

```
coachos/
├── docker-compose.yml          ← Start everything
├── backend/
│   ├── .env                    ← All secrets (never commit)
│   ├── manage.py
│   ├── config/
│   │   ├── settings/
│   │   │   ├── base.py         ← Shared settings
│   │   │   └── local.py        ← Dev overrides
│   │   ├── middleware.py       ← WorkspaceTenantMiddleware (RLS)
│   │   ├── urls.py             ← Root router
│   │   └── celery.py
│   ├── apps/
│   │   ├── accounts/           ← Auth, Users, Workspaces (FR-AUTH-*)
│   │   ├── clients/            ← CRM, Goals, Assessments (FR-CRM-*)
│   │   ├── activities/         ← Scheduling, Calendar (FR-ACT-*)
│   │   ├── pipeline/           ← Deals, Stages (FR-SF-*)
│   │   ├── invoicing/          ← Invoices, Stripe, Payments (FR-INV-*)
│   │   ├── reports/            ← Revenue reports, CSV (FR-REP-*)
│   │   ├── portal/             ← Client portal views (FR-CP-*)
│   │   ├── library/            ← Knowledge library (FR-LIB-*)
│   │   └── settings_app/       ← Branding, scheduling prefs
│   └── tasks/
│       ├── email.py            ← Celery email tasks
│       ├── sms.py              ← Twilio SMS tasks
│       └── calendar.py         ← Google Calendar sync tasks
└── frontend/
    └── src/
        ├── api/client.ts       ← Axios client + all API functions
        ├── store/auth.ts       ← Zustand auth store
        ├── pages/              ← Route components (build sprint by sprint)
        └── App.tsx             ← Router + PrivateRoute guard
```

## Sprint Plan

| Sprint | Week | Focus |
|--------|------|-------|
| 0 | 1 | This setup — stack running, migrations, Admin live, API docs at /swagger-ui/ |
| 1 | 2 | Auth flow + CRM screens (Login, Register, Client List, Client Detail) |
| 2 | 3 | Dashboard stats + Pipeline kanban board |
| 3 | 4 | Calendar + Activities + Google Calendar OAuth2 |
| 4 | 5 | Invoicing + dj-stripe + Stripe CLI webhooks + PDF |
| 5 | 6 | Revenue reports + Knowledge Library |
| 6 | 7 | Client Portal (separate JWT scope + RLS) |
| 7 | 8 | Settings + Branding + All 5 scenarios tested |

## Useful Commands

```bash
# Django migrations
docker compose exec api python manage.py makemigrations
docker compose exec api python manage.py migrate

# Create first workspace + admin via Django Admin at /admin/
# Or POST to /api/auth/register/ with workspace_name, full_name, email, password

# Run tests
docker compose exec api pytest

# Stripe webhooks (local testing)
stripe listen --forward-to localhost:8000/api/stripe/webhook/

# Watch Celery tasks
docker compose logs -f celery_worker

# Access PostgreSQL
docker compose exec db psql -U coachos coachos
```

## Adding the First Workspace (API)

```bash
curl -X POST http://localhost:8000/api/auth/register/ \
  -H "Content-Type: application/json" \
  -d '{
    "workspace_name": "Webb Executive Coaching",
    "full_name": "Marcus Webb",
    "email": "marcus@webbcoaching.com",
    "password": "securepassword123"
  }'
```

Returns `access` + `refresh` tokens. Use `access` as `Authorization: Bearer <token>` on all subsequent requests.

## install FE
* install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
* brew install node

or Visit https://nodejs.org/.

Download the macOS .pkg for the current LTS version.
* git hub -https://github.com/AkambDS/platformCoachOs.git
