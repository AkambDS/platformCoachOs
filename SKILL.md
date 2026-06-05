# CoachOS — Quick Reference

## What It Is
Executive coaching CRM. Coaches manage clients, sessions, goals, notes, files, invoices, and a sales pipeline. Single-tenant per workspace.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript, Vite, TanStack Query, Zustand, Axios |
| Backend | Django 5 + DRF, SimpleJWT, Celery, django-storages |
| Database | PostgreSQL 16 |
| Cache / Queue | Redis 7 |
| File Storage | AWS S3 (prod) / MinIO (local) |
| Email | AWS SES via SMTP (prod) / Mailpit (local) |
| Web Server | Nginx (prod only) |
| Auth | JWT (access 8h, refresh 30d) + django-allauth (Google OAuth) |

---

## Backend Apps

| App | Purpose |
|---|---|
| `accounts` | Users, workspaces, invites, JWT auth |
| `clients` | Client profiles, goals, notes, file assessments |
| `activities` | Sessions/calls — scheduled, completed, missed, cancelled |
| `invoicing` | Invoices, payments, send via email |
| `pipeline` | Sales pipeline deals and stages |
| `reports` | Revenue and outstanding invoice reports |
| `library` | Shared file/folder library (MinIO/S3) |
| `settings_app` | Pipeline stages config, activity types config |
| `portal` | Client-facing portal (read-only) |

---

## Local Development

**File:** `docker-compose.yml` | **Settings:** `config.settings.local`

```
http://localhost:5173   → React frontend (Vite dev server, hot reload)
http://localhost:8000   → Django API (runserver)
http://localhost:8025   → Mailpit (catch-all email UI)
http://localhost:9001   → MinIO console (files browser)
http://localhost:9000   → MinIO S3 API
```

### Services (local)

| Container | What it runs |
|---|---|
| `frontend` | `vite` dev server |
| `api` | `python manage.py runserver` |
| `celery_worker` | `celery worker` |
| `celery_beat` | `celery beat` (reminders every 15 min) |
| `db` | PostgreSQL |
| `redis` | Redis broker + cache |
| `minio` | S3-compatible file storage |
| `mailpit` | SMTP trap — catches all outbound email |

```bash
docker compose up -d              # start everything
docker compose logs api -f        # backend logs
docker compose logs celery_worker -f
```

---

## AWS Production

**File:** `docker-compose.prod.yml` | **Settings:** `config.settings.production`
**Server:** EC2 → `~/platformCoachOs/` | **SSH:** `ubuntu@<EC2-IP>`
**Operations:** `make <target>` (see Makefile at repo root)

```
https://<domain>        → React SPA (nginx serves built static files)
https://<domain>/api/   → Django API (Gunicorn, 3 workers)
https://<domain>/admin/ → Django Admin
GET /                   → health check → {"status": "ok"}
```

### Services (production)

| Container | What it runs |
|---|---|
| `nginx` | Reverse proxy — HTTP→HTTPS, routes `/api/` to backend, serves SPA |
| `backend` | Gunicorn 3 workers — runs `migrate` + `collectstatic` on startup |
| `celery` | Celery worker (2 concurrent tasks) |
| `celery-beat` | Celery beat — fires reminders every 15 min |
| `db` | PostgreSQL (persistent volume: `pgdata`) |
| `redis` | Redis broker + cache (persistent volume: `redisdata`) |
| `frontend` | Build-only container — copies React dist to shared volume, then exits |

### AWS Services Used

| Service | Purpose |
|---|---|
| EC2 | Runs all Docker containers |
| S3 | File storage (client assessments, library uploads) — private + presigned URLs |
| SES | Transactional email (invoices, reminders, invites) via SMTP |

### Common operations (run from `~/platformCoachOs` on EC2)

```bash
make status          # show all container states
make logs-api        # tail backend logs live
make logs-celery     # tail celery logs live
make deploy          # git pull → rebuild → restart (safe, keeps DB)
make restart         # restart backend + celery only (no rebuild)
make shell           # Django shell
make backup          # dump Postgres to .sql.gz
```

---

## EC2 Docker Setup (first-time migration)

The EC2 previously ran gunicorn directly via venv with no process manager.
This is the one-time migration to Docker with auto-restart.

```bash
# 1. Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
newgrp docker                         # or log out and back in

# 2. Stop the old bare gunicorn
sudo pkill -f gunicorn || true

# 3. Copy SSL certs (Let's Encrypt) to the path nginx expects
mkdir -p ~/platformCoachOs/nginx/certs
sudo cp /etc/letsencrypt/live/<DOMAIN>/fullchain.pem ~/platformCoachOs/nginx/certs/
sudo cp /etc/letsencrypt/live/<DOMAIN>/privkey.pem   ~/platformCoachOs/nginx/certs/
sudo chown ubuntu:ubuntu ~/platformCoachOs/nginx/certs/*

# 4. Set required env var (docker-compose requires DB_PASSWORD)
echo "DB_PASSWORD=coachos_prod_secret" >> ~/platformCoachOs/backend/.env

# 5. Pull latest code and start everything
cd ~/platformCoachOs
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

# 6. Check all containers are healthy
make status
make logs-api
```

### SSL cert renewal (add to crontab)
```bash
# sudo crontab -e
0 3 * * * certbot renew --quiet && \
  cp /etc/letsencrypt/live/<DOMAIN>/fullchain.pem /home/ubuntu/platformCoachOs/nginx/certs/ && \
  cp /etc/letsencrypt/live/<DOMAIN>/privkey.pem   /home/ubuntu/platformCoachOs/nginx/certs/ && \
  docker compose -f /home/ubuntu/platformCoachOs/docker-compose.prod.yml exec nginx nginx -s reload
```

---

## Key Environment Variables (`backend/.env` on EC2)

| Variable | Notes |
|---|---|
| `SECRET_KEY` | **Must be set permanently** — if missing, regenerates on restart and logs everyone out |
| `DB_PASSWORD` | Postgres password (also referenced by docker-compose.prod.yml) |
| `DATABASE_URL` | `postgresql://coachos:<DB_PASSWORD>@db:5432/coachos` |
| `REDIS_URL` | `redis://redis:6379/0` |
| `DJANGO_SETTINGS_MODULE` | `config.settings.production` |
| `AWS_S3_BUCKET_NAME` | S3 bucket for uploads |
| `AWS_SES_SMTP_USER` | SES SMTP credentials |
| `AWS_SES_SMTP_PASSWORD` | SES SMTP password |
| `FRONTEND_URL` | Used in email links (e.g. `https://app.coachos.com`) |
| `ALLOWED_HOSTS` | Domain name(s), comma-separated |
| `CORS_ALLOWED_ORIGINS` | Same as FRONTEND_URL (comma-separated) |

---

## Viewing Logs

### On EC2 (Docker)
```bash
make logs-api                      # live tail — API
make logs-celery                   # live tail — background tasks
make logs-nginx                    # live tail — HTTP access log
make logs-all                      # dump all services last 72h to file
docker compose -f docker-compose.prod.yml logs backend --since 24h -t
```

### In the Browser (frontend issues)
React SPA runs client-side — server logs don't capture JS errors.
- **Console tab** — JS exceptions, network errors
- **Network tab → Fetch/XHR** — API calls and HTTP status codes
- **Application → Local Storage** — must have `access_token`, `refresh_token`, `user`, `workspace`

---

## Celery Scheduled Tasks

| Task | Schedule | Purpose |
|---|---|---|
| `tasks.reminders.dispatch_activity_reminders` | Every 15 min | Email/SMS reminders for upcoming sessions |

> **Note:** Celery was NOT running on EC2 before Docker migration — reminders were broken.

---

## TODO — Pending Deployment (next 2-3 days)

Run `make deploy` on EC2 — migrations apply automatically on container start.

| Migration | App | What it adds |
|---|---|---|
| `0006_clientstatusconfig_client_status.py` | `clients` | ClientStatusConfig model + status field on Client |
| `0007_clienttagconfig.py` | `clients` | ClientTagConfig model |
| `0009_activity_repeat_until.py` | `activities` | `repeat_until` DateField on Activity (fixes repeat end-date editing) |

**After deploy — verify:**
- [ ] Settings → Client Statuses and Client Tags tabs work
- [ ] Calendar → Schedule Activity → Repeat with "On Date" saves and restores correctly on edit
- [ ] Admin portal → workspace statuses/tags tabs work

---

## Important Gotchas

| Issue | Cause | Fix |
|---|---|---|
| Users logged out randomly | `SECRET_KEY` not set → regenerates on restart | Add `SECRET_KEY=<stable-value>` to `.env` |
| Files not uploading to S3 | Django 4.2+ ignores `DEFAULT_FILE_STORAGE` | Must use `STORAGES` dict in settings |
| Download links broken (local) | Presigned URL uses internal Docker hostname `minio:9000` | Serializer replaces with `MINIO_PUBLIC_URL` |
| Notes edit broken | Component defined inside another component → remounts on every render | Define helper components at module level, not inside render functions |
