# Change Log — 2026-11-18

Work from 2026-11-15 to 2026-11-18, after the 2026-11-15 log. One commit per part, in this
order. **Nothing here is deployed yet** — see **Deploy** at the end (2 migrations).

| Part | Change |
|---|---|
| **A** | Site-health job runs in production only (no more false "Site unreachable" alerts from a laptop) |
| **B** | Stripe one-time payments: fixes P1–P8, payment emails to the owner, Stripe problems shown to the owner |
| **C** | Demo workspace: every integration switched off (Google, Zoom, Stripe, document editing, allauth pages) |
| **D** | "Payment Received" email: "Open invoice" button removed (it pointed at the wrong address in prod) |

---

# Part A — Site-health job: production only

## What was wrong
`tasks.health.check_site_health` (Celery beat, every 30 min) always checks the **production**
URL. Run from a laptop, it emailed "Site unreachable" (to Mailpit locally) whenever the machine
slept or lost its network — the alerts seen on 2026-11-10.

## Fix
- New setting `SITE_HEALTH_CHECK_ENABLED`: off in `base.py` (local/dev), on in `production.py`.
  The task returns straight away when it's off.
- Checked inside the task, not by removing the beat entry, because beat's
  `DatabaseScheduler` keeps running a job it has already saved.
- Prod is unchanged (on by default); `SITE_HEALTH_CHECK_ENABLED=False` in `.env` would stop it.

---

# Part B — Stripe one-time payments: fixes P1–P8 + payment notifications

Full design, each bug with before/after, and deploy/rollback steps: **`one-time-pay.md`**.

## Fixed
| # | Bug | Fix |
|---|---|---|
| P1 | The same Stripe payment could be recorded twice (duplicate webhook) → `amount_paid` doubled | Unique `Payment(workspace, stripe_payment_id)` (migration `invoicing/0014`) + invoice row lock in the webhook |
| P2 | A webhook and a manual "Record payment" at the same moment lost one amount | `record_payment` takes the same row lock and re-reads the invoice |
| P3 | A client could pay the same invoice twice (two tabs, re-click, balance changed) | The invoice remembers its open checkout (`stripe_checkout_session_id`, migration `invoicing/0015`): reused, expired or replaced; "Invoice Overpaid" email as a safety net |
| P4 | A checkout that took no money ($0, card-save, uncleared bank debit) could be recorded as paid | Only `mode=payment`, `payment_status=paid`, amount > 0 is recorded |
| P5 | Amounts converted as if every currency had cents (¥5,000 charged as ¥500,000) | New `apps/invoicing/money.py`: zero/three-decimal currencies, Decimal maths only |
| P6 | Stripe key saved without asking Stripe; switching account/mode silently broke the webhook | Key checked with Stripe before saving; account shown; webhook secret cleared when the account/mode changes; the secret's format is checked |
| P7 | Payment failures never reached ErrorLog | New `apps/invoicing/stripe_problems.py`: ErrorLog + platform-admin alert |
| P8 | No tests for the pay page or the webhook | `apps/invoicing/tests.py` (37) + `apps/settings_app/tests.py` (9) |

## Who is told (new)
- **Workspace owner:** "Payment Received" email for every card payment (partial or full) —
  switch `PAYMENT_RECEIVED_EMAIL_ENABLED` (default on, every workspace).
- **Client:** receipt now also for **partial** payments, with total paid so far and balance due.
- **Owner + client's coach:** "Invoice Overpaid" when an invoice is paid more than its total.
- **Owner:** Stripe problems in plain words — "Action needed: …" email (at most once a day per
  kind, "Stripe Payment Problem" in Settings → Emails) and a red banner in Settings →
  Integrations until it works again. The email button opens `/settings?tab=integrations`.
- "Payment Failed" stays unsent for one-time payments, by decision: a declined card is handled
  on Stripe's page.

## Still open
P9–P11 (disconnect without warning, refund webhook metadata, refund save without the lock) —
see `one-time-pay.md` §4 "Still open".

---

# Part C — Demo workspace: all integrations off

## What was wrong
The read-only middleware only blocks mutating `/api/` calls made with the demo JWT. Verified
locally: a visitor could open a Django session through the Google/Zoom "connect" GET bridge,
then change the **shared demo password** at allauth's `/accounts/password/change/`, or link
their own Google/Zoom account to the demo user.

## Fix
- `config/middleware.py`: `is_demo_workspace_id()` + one message; the middleware refuses any
  demo-user session on `/accounts/` (403) and logs it out.
- Google Calendar / Zoom connect bridges (`accounts/views.py`) send a demo user back to
  `/settings?integrations=demo_disabled`.
- OnlyOffice: `?mode=edit` returns 403 for demo files, and the save callbacks ignore them
  (Library and client files).
- Public pay page `/invoices/pay/…` shows "Payments are off in the demo".
- Settings → Integrations: each tile shows "Off in demo" and can't be clicked; a note explains
  why; the Stripe card stays closed.
- Email was already covered (`DemoSafeEmailBackend` in prod + the middleware). CLAUDE.md §9
  updated.

## Tests
No automated tests for this part yet; verified by hand locally (see CLAUDE.md §9).

# Part D — "Payment Received" email: no "Open invoice" button

## What was wrong
The owner's "Payment Received" email (Part B) had an **Open invoice** button linking to
`<FRONTEND_URL>/invoices/<id>`. In prod, `nginx/nginx.conf` sends **every** `/invoices/…`
address to Django (the client pay links live at `/invoices/pay/…`), so the link reached
Django instead of the app's invoice page and failed. Locally there's no nginx, so it worked.

## Fix
- The button is removed (`tasks/email.py` → `send_payment_received_email`). The email already
  lists the invoice number, amount, date, invoice total, balance due and client.
- New `NO_BUTTON_NOTICES` in `tasks/email_notices.py`; the Settings → Emails preview follows it,
  so the preview matches the real email (it used to add a sample button to every owner/coach
  email).

## Tests
`apps/invoicing/tests.py::test_payment_received_email_has_no_button` (real email has no button
or invoice link). Invoicing + Stripe settings tests: 56 passing.

## Still open (not changed)
- The **"Invoice Overpaid"** email has the same **Open invoice** button, so it has the same
  problem in prod (so does "Payment Failed", which isn't sent today).
- Probably also: reloading an invoice page in prod (`/invoices/<id>`), which should hit the
  same nginx rule.
- Suggested fix: narrow the nginx block to `location /invoices/pay/` (Django has no other
  `/invoices/` pages).

---

## Deploy
1. **Before (read-only, on EC2):** check prod has no duplicate Stripe payments, or migration
   `0014` fails — command in `one-time-pay.md` §5 ("Before deploy"). Expect `DUPLICATES: none`.
2. `make deploy-plan`, then `make deploy-safe`. It lists **2 migrations** and asks for an
   **RDS snapshot**: `invoicing/0014` (unique index on payments), `invoicing/0015` (empty text
   column on invoices). Both are small and change no existing data.
3. Backend **and** frontend rebuild; the Celery worker must run the new code (new email
   tasks) — `make deploy-safe` does this and its health check fails otherwise.
4. Nothing to add to `.env` (`SITE_HEALTH_CHECK_ENABLED` and `PAYMENT_RECEIVED_EMAIL_ENABLED`
   default correctly for prod).

## Tests (local, all passing — 114)
```
docker compose exec -T api pytest -q apps/invoicing/tests.py apps/settings_app/tests.py \
  apps/portal/tests.py test_portal_uploads.py test_tenant_isolation.py test_client_affiliations.py \
  test_client_list_sort.py test_client_url_fields.py test_activity_validation.py \
  test_activity_month_view.py test_invoice_due_upon_receipt.py test_reminder_windows.py \
  test_deploy_regression.py
```

## Post-deploy checks
1. `make health` → HEALTHY.
2. Migrations and the unique index: commands in `one-time-pay.md` §5 ("After deploy").
3. Stripe connections: `one-time-pay.md` §5 command — a workspace with
   `webhook secret: False` has never had payments recorded automatically; tell its owner.
4. Demo: log in as the demo user → Settings → Integrations shows "Off in demo".
