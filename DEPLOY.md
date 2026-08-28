# CoachOS Deployment Guide

## Option A: DigitalOcean Droplet (Recommended — $24/month)

### 1. Create Server
```bash
# On DigitalOcean, create a Droplet:
# - Image: Ubuntu 22.04 LTS
# - Size: 2 vCPUs, 4GB RAM (minimum)
# - Region: closest to your clients
# - Enable backups
```

### 2. Install Docker on Server
```bash
ssh root@YOUR_SERVER_IP

# Install Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker

# Install Docker Compose plugin
apt-get install -y docker-compose-plugin

# Create deploy user
adduser deploy
usermod -aG docker deploy
```

### 3. Point Your Domain
In your domain registrar (Namecheap, GoDaddy, etc.):
```
A record: @ → YOUR_SERVER_IP
A record: www → YOUR_SERVER_IP
```
Wait ~10 minutes for DNS propagation.

### 4. Set Up SSL Certificate
```bash
# On your server
apt install -y certbot
certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com

# Certs will be at:
# /etc/letsencrypt/live/yourdomain.com/fullchain.pem
# /etc/letsencrypt/live/yourdomain.com/privkey.pem

# Link to nginx certs directory
mkdir -p /srv/coachos/nginx/certs
ln -s /etc/letsencrypt/live/yourdomain.com/fullchain.pem /srv/coachos/nginx/certs/fullchain.pem
ln -s /etc/letsencrypt/live/yourdomain.com/privkey.pem /srv/coachos/nginx/certs/privkey.pem

# Auto-renew SSL
crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet && docker restart coachos-nginx-1
```

### 5. Upload Code
```bash
# From your local machine
rsync -avz --exclude 'node_modules' --exclude '__pycache__' --exclude '.git' \
  ./coachos/ deploy@YOUR_SERVER_IP:/srv/coachos/
```

Or push to GitHub and pull on server:
```bash
git push origin main
ssh deploy@YOUR_SERVER_IP "cd /srv/coachos && git pull"
```

### 6. Configure Environment
```bash
ssh deploy@YOUR_SERVER_IP
cd /srv/coachos

# Copy and fill in production env
cp backend/.env.production.template backend/.env
nano backend/.env   # Fill in all values
```

### 7. Deploy
```bash
cd /srv/coachos

# Build and start all services
docker compose -f docker-compose.prod.yml up -d --build

# Check status
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f backend

# Create first admin user
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py createsuperuser
```

### 8. Verify
- Visit https://yourdomain.com — CoachOS login page
- Visit https://yourdomain.com/admin — Django admin
- Visit https://yourdomain.com/api/schema/swagger-ui/ — API docs

---

## Option B: Railway (Easiest, ~$20/month)

Railway deploys directly from GitHub with minimal config.

### 1. Push to GitHub
```bash
git init && git add . && git commit -m "Initial CoachOS"
git remote add origin https://github.com/YOUR_USER/coachos.git
git push -u origin main
```

### 2. Deploy on Railway
1. Go to railway.app → New Project → Deploy from GitHub repo
2. Add services:
   - **Backend**: Root dir `backend`, Start command: `gunicorn config.wsgi:application --bind 0.0.0.0:$PORT`
   - **PostgreSQL**: Add plugin
   - **Redis**: Add plugin
   - **Frontend**: Root dir `frontend`, Build: `npm run build`, serve dist/

3. Add environment variables from `.env.production.template`
4. Railway provides a free SSL domain like `coachos-production.up.railway.app`

---

## Option C: Render (Free tier available)

1. Create `render.yaml` in repo root
2. Connect GitHub repo at render.com
3. Free PostgreSQL + Redis available

---

## Ongoing Operations

### Routine Deployment (after every code change)

**Step 1 — Local machine: commit and push**
```bash
git add -A
git commit -m "your message"
git push origin main
```

**Step 2 — EC2: pull, rebuild, restart**
```bash
ssh ubuntu@YOUR_EC2_IP
cd ~/platformCoachOs
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

> ⚠️ Always use `-f docker-compose.prod.yml`. Running bare `docker compose up --build`
> uses the dev compose file (Mailpit, local Postgres, Dockerfile.dev) — wrong on EC2.

**Step 3 — EC2: run migrations (if any model changes)**
```bash
docker compose -f docker-compose.prod.yml exec backend python manage.py migrate
```
"No migrations to apply" is fine — the entrypoint already ran them on startup.

**Check service names before running exec commands:**
```bash
docker compose -f docker-compose.prod.yml ps
# Backend service is called "backend", not "api"
```

### Update only backend (faster, skips frontend rebuild)
```bash
docker compose -f docker-compose.prod.yml up -d --build backend celery celery-beat
```

### Backup database
```bash
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U coachos coachos > backup_$(date +%Y%m%d).sql
```

### View logs
```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Just backend
docker compose -f docker-compose.prod.yml logs -f backend

# Just Celery
docker compose -f docker-compose.prod.yml logs -f celery
```

### Run Django management commands
```bash
docker compose -f docker-compose.prod.yml exec backend python manage.py shell
docker compose -f docker-compose.prod.yml exec backend python manage.py migrate
```

---

## OnlyOffice Setup (real-time Word/Excel/PPT editing)

The `onlyoffice` container is added automatically by `docker-compose.prod.yml` and
proxied by nginx on port 8443 of your existing domain/cert — no new DNS record or
certbot run needed. Manual steps on EC2:

1. **Open port 8443** in the EC2 instance's security group (inbound TCP, same source rules as 443).
2. Generate a real random secret: `python3 -c "import secrets; print(secrets.token_urlsafe(50))"`, then set it in **both** of these files with the *same* value:
   - `backend/.env` → `ONLYOFFICE_JWT_SECRET=...` (read by the Django app at runtime, via `env_file:`)
   - `.env` at the repo root, next to `docker-compose.prod.yml` → `ONLYOFFICE_JWT_SECRET=...` (read by `docker compose` itself to resolve the `${ONLYOFFICE_JWT_SECRET:?...}` in the `onlyoffice` service block — same mechanism `DB_PASSWORD` already relies on)

   These are two different files loaded two different ways — `env_file: ./backend/.env` only injects vars into a container's own environment, it does **not** feed `docker compose`'s own `${VAR}` interpolation. Setting it in `backend/.env` alone is not enough and will fail with `required variable ONLYOFFICE_JWT_SECRET is missing a value`. If the two copies ever drift apart, OnlyOffice's editor/PDF-conversion features will fail with silent 403s (JWT signature mismatch) rather than an obvious error.
3. Set `ONLYOFFICE_SERVER_URL` in `backend/.env` to your **exact** site domain (the same one your SSL cert and nginx `server_name` use, e.g. `https://coachos.yourdomain.com:8443`, not a shorter/parent domain) — a mismatch here gets silently blocked by the CSP header and/or fails TLS hostname verification, showing up in the browser console as `net::ERR_CONNECTION_TIMED_OUT` or a blank editor with no obvious error.
4. Add `backend` to `ALLOWED_HOSTS` in `backend/.env`, alongside your real domain (e.g. `ALLOWED_HOSTS=yourdomain.com,backend`) — the OnlyOffice document server fetches files by calling `http://backend:8000/...` directly (`ONLYOFFICE_CALLBACK_BASE_URL`), which sends `Host: backend:8000`. Without `backend` in `ALLOWED_HOSTS`, Django's host-header check rejects that request with a `400`, and the editor shows "Download failed." (Confirm the fetch is even reaching Django with `docker compose -f docker-compose.prod.yml logs backend | grep onlyoffice-file` — a `400` there with `Node.js/...` as the user agent is this exact issue.)

Then `docker compose -f docker-compose.prod.yml up -d --build` picks it up (use `--force-recreate backend celery celery-beat` if you only changed `backend/.env` and want to be sure the new values are actually loaded).

---

## Stripe Payments (per-workspace — "bring your own account")

Each workspace connects its **own** Stripe account from Settings → Integrations →
Stripe — client invoice payments go straight to that coach's Stripe balance, not
through a shared CoachOS platform account (same model as Bonsai). This is entirely
unrelated to the `STRIPE_*`/`DJSTRIPE_*` settings and the "Stripe Webhook Setup" note
further down this file, which are leftover scaffolding for a platform-level CoachOS-
bills-its-coaches feature that was never actually built (`apps.superadmin`'s
`PlatformInvoice`/`PlatformPayment` billing is 100% manual today, no Stripe involved) —
don't configure those for this feature, and don't confuse their webhook with the one
below.

### How it works

- **Code**: `apps/invoicing/public_views.py` (`InvoicePayView`, `InvoicePaySuccessView`,
  `StripeWebhookView`), `apps/invoicing/tokens.py` (signed pay-link tokens),
  `apps/invoicing/views.py` (`InvoiceViewSet.issue_refund`), `apps/settings_app/views.py`
  (`stripe_settings` — connect/disconnect API), `apps/accounts/crypto.py` (Fernet
  encryption for stored keys). Frontend: Settings → Integrations tab in
  `frontend/src/pages/coach/Settings.tsx`, "Pay Now" buttons in `InvoiceDetail.tsx` /
  `ClientPortal.tsx`.
- **Getting paid**: client clicks "Pay Invoice" (email) or "Pay Now" (client portal) →
  hits `GET /invoices/pay/<token>/` → a fresh Stripe Checkout Session is created against
  *that workspace's* secret key and the client is redirected to Stripe's hosted page →
  Stripe calls back `POST /api/invoices/stripe-webhook/<workspace_id>/` with
  `checkout.session.completed` → the webhook (not the browser redirect — that's just a
  confirmation screen) creates a `Payment` row and updates `Invoice.amount_paid` /
  `status`. This is why the invoice list can lag a few seconds behind the client seeing
  "Payment received."
- **Refunding**: a coach clicking Refund on a Stripe-paid invoice
  (`InvoiceViewSet.issue_refund`) calls Stripe's Refund API directly with that
  workspace's key — this actually returns the client's money, it's not just a local
  status flip. If a coach instead refunds straight from their own Stripe Dashboard, the
  `charge.refunded` webhook event reconciles that back onto the invoice. Both paths write
  the Stripe refund id to `Invoice.stripe_refund_ids` so the same refund is never double-
  counted regardless of which path recorded it first.
- **Recurring invoices** are CoachOS's own scheduling (`tasks.invoicing.dispatch_subscription_invoices`
  clones + emails a new invoice each period) — each period is still a one-off Stripe
  Checkout payment, not a Stripe Subscription object.

### Operator setup (once, at deploy time)

1. Set `FIELD_ENCRYPTION_KEY` in `backend/.env` (see `.env.production.template` for the
   generation command) — required before any workspace can save a Stripe key; encrypts
   it at rest. Losing this key makes every already-saved Stripe/webhook key
   undecryptable, so back it up like you would `SECRET_KEY`. Never reuse a dev/test
   value in production.
2. Set `BACKEND_URL` in `backend/.env` to your real public HTTPS domain (see
   `.env.production.template`) — it's used to build both the client-facing "Pay Invoice"
   link and the webhook URL shown to the coach in Settings. **This is easy to miss**: it
   defaults to `http://localhost:8000` if unset, which silently ships broken pay links
   to real clients.
3. Confirm nginx has a `location /invoices/` block proxying to the backend
   (`nginx/nginx.conf`) — `InvoicePayView`/`InvoicePaySuccessView` are registered at the
   Django root, not under `/api/`, so without this block they fall through to the React
   SPA catch-all and 404 into the app shell instead of reaching Django.
4. Run migrations as usual (`docker compose -f docker-compose.prod.yml exec backend
   python manage.py migrate`) — picks up `Invoice.stripe_refund_ids` etc.

### Workspace owner setup (per coach, in-app — no server access needed)

From **Settings → Integrations → Stripe**:

1. Paste their Stripe **secret key** (`sk_live_...` for real payments, `sk_test_...` for
   testing) from `dashboard.stripe.com/apikeys` and click Connect.
2. Copy the **webhook URL** the page now shows
   (`https://yourdomain.com/api/invoices/stripe-webhook/<workspace_id>/`), add it as a
   webhook endpoint in their own Stripe Dashboard, and select both:
   - `checkout.session.completed` — required; without it, payments never mark the
     invoice paid.
   - `charge.refunded` — required to catch refunds issued directly from their Stripe
     Dashboard instead of from CoachOS.
3. Paste the webhook's signing secret (`whsec_...`) back into the same Settings page.

Once "Webhook configured" shows green, every invoice with a balance due automatically
gets a working pay link the next time it's sent (`tasks/email.py` regenerates
`stripe_payment_link` on send/reminder) — no per-invoice setup needed.

### Testing locally

The `api` container already exposes `localhost:8000` directly (see `docker-compose.yml`),
so `backend/.env`'s default `BACKEND_URL=http://localhost:8000` is correct as-is for
local testing — no nginx involved in dev.

1. **Get test keys**: `dashboard.stripe.com/test/apikeys` (toggle "Test mode" on) →
   `sk_test_...`. `backend/.env` already has a placeholder under `STRIPE_TEST_SECRET_KEY`
   — that env var is for the *unused platform* feature, though; the per-workspace key is
   entered in-app, not via `.env`.
2. **Connect it in-app**: log in as a coach → Settings → Integrations → Stripe → paste
   the `sk_test_...` key → Connect.
3. **Forward webhooks with the Stripe CLI** (`brew install stripe/stripe-cli/stripe`,
   then `stripe login`):
   ```
   stripe listen --forward-to localhost:8000/api/invoices/stripe-webhook/<workspace_id>/
   ```
   `<workspace_id>` is in the webhook URL the Settings page shows once a key is
   connected. This prints a `whsec_...` — paste that into the Settings page's Webhook
   Signing Secret field (it's session-specific and changes every time you restart
   `stripe listen`, so re-copy it each session rather than reusing an old one).
4. **Pay an invoice**: create/send an invoice to a test client, open its pay link
   (`http://localhost:8000/invoices/pay/<token>/`), and complete Checkout with a
   [Stripe test card](https://docs.stripe.com/testing#cards) (`4242 4242 4242 4242`, any
   future expiry/CVC/ZIP). Watch the `stripe listen` terminal for the
   `checkout.session.completed` event and the `celery_worker`/`api` container logs
   (`docker compose logs -f api`) to confirm the webhook fired; the invoice should flip
   to Paid within a second or two.
5. **Test a refund**: click Refund on that now-paid invoice in CoachOS. Because this
   calls Stripe's Refund API for real (even in test mode), you should see the refund
   appear in the Stripe Dashboard's test-mode Payments list immediately, and the
   `charge.refunded` event go by in the `stripe listen` terminal — that event should
   no-op on arrival (the id it carries is already in `Invoice.stripe_refund_ids` from
   the direct API call), confirming the dedup logic works rather than double-refunding.
6. **Test dashboard-initiated refunds** (the other path): instead of using CoachOS's
   Refund button, refund the same payment from the Stripe test Dashboard directly —
   confirm the invoice flips to Refunded/Partially Refunded in CoachOS via the
   `charge.refunded` webhook alone.
7. Trigger a failure path without a real card: `stripe trigger payment_intent.payment_failed`
   or just decline with test card `4000 0000 0000 0002` — confirm the invoice stays
   unpaid rather than incorrectly flipping to Paid.

---

## Email Setup (Production)

**Actual transport in use: [Resend](https://resend.com) SMTP relay** — not SendGrid (below cost
table is stale) and not literally AWS SES, despite the env var names.

`backend/config/settings/production.py` has an "AWS SES via SMTP" block left over from an
earlier SES setup:
```python
EMAIL_BACKEND       = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST          = env("EMAIL_HOST",     default="email-smtp.us-east-1.amazonaws.com")
EMAIL_PORT          = env.int("EMAIL_PORT", default=587)
EMAIL_USE_TLS       = True
EMAIL_HOST_USER     = env("AWS_SES_SMTP_USER",     default="")
EMAIL_HOST_PASSWORD = env("AWS_SES_SMTP_PASSWORD", default="")
```
Since this reads the host/user/password from env vars, it was repointed at Resend without a
code change — `backend/.env` on EC2 (`~/platformCoachOs/backend/.env`) actually holds:
```
EMAIL_HOST=smtp.resend.com
AWS_SES_SMTP_USER=resend           # Resend's SMTP username is always the literal string "resend"
AWS_SES_SMTP_PASSWORD=<resend API key>
```
Don't be misled by the `AWS_SES_SMTP_*` names — they're just repurposed, not actually SES. The
real AWS SES account for this project (if you ever check the SES console) is unused/sandboxed
(200/day cap) and completely unrelated to production mail delivery.

**Resend account**: logged in as `rassconsulting.co` (not any other Resend login you might have —
e.g. an `artikamb` account exists but is empty/unused, zero domains, zero sent mail). Dashboard:
resend.com → Domains / Emails (send log, statuses, bounce reasons) / Logs.

**Per-workspace sending domain**: `backend/tasks/email.py` (`_OWNER_SENDING_DOMAIN`) maps a
workspace owner's login email to the "From" domain used for that workspace's outgoing mail —
lets each coach's clients see mail from the coach's own domain instead of one shared domain.
Every domain used here must be added and verified in the Resend dashboard (Domains → Add
Domain → add the SPF/DKIM/MX records it generates to that domain's DNS, e.g. GoDaddy) before
mail from it will send — an unverified "From" domain fails silently (the task's `except`
block logs the error but the UI shows no failure).

- `rass-consulting.com` — verified, this is `_DEFAULT_SENDING_DOMAIN`. Any workspace owner not
  explicitly listed in `_OWNER_SENDING_DOMAIN` sends from `noreply@rass-consulting.com`.
- `lauratreonze.com` — owned/managed by Laura (workspace owner `laura.lmtconsulting@gmail.com`),
  added in Resend but **DNS records not yet added, status "Not Started"** as of 2026-08-26.

> **TODO — revert once lauratreonze.com verifies in Resend:** `_OWNER_SENDING_DOMAIN` is
> currently `{}` (empty) as a stopgap, so `laura.lmtconsulting@gmail.com`'s workspace falls
> back to sending from `noreply@rass-consulting.com` instead of her own domain — same as every
> other unlisted owner (e.g. `shreya1201@gmail.com`). This was done so her workspace could send
> mail immediately instead of waiting on DNS. Once Resend shows `lauratreonze.com` as
> **Verified**, restore the mapping in `backend/tasks/email.py`:
> ```python
> _OWNER_SENDING_DOMAIN: dict[str, str] = {
>     "laura.lmtconsulting@gmail.com": "lauratreonze.com",
> }
> ```
> then deploy (`git push` → on EC2: `git pull` →
> `docker compose -f docker-compose.prod.yml up -d --build backend celery celery-beat` — celery
> must be rebuilt too since invoice/session emails send via Celery tasks, not the web process).

## Cost Breakdown

| Service | Monthly |
|---------|---------|
| DigitalOcean 2CPU/4GB | $24 |
| Domain name | ~$1 |
| Resend (3k emails/month free, then usage-based) | $0+ |
| Stripe (2.9% + 30¢/transaction) | Variable |
| S3 (minimal usage) | ~$1 |
| **Total fixed** | **~$26/month** |

Scale up to 4GB/2CPU ($48) when you have 50+ clients.
