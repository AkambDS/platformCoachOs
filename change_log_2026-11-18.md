# Change Log — 2026-11-18

Work from 2026-11-15 to 2026-11-18, after the 2026-11-15 log. One commit per part, in this
order. **Nothing here is deployed yet** — see **Deploy** at the end (2 migrations).

| Part | Change |
|---|---|
| **A** | Site-health job runs in production only (no more false "Site unreachable" alerts from a laptop) |
| **B** | Stripe one-time payments: fixes P1–P8, payment emails to the owner, Stripe problems shown to the owner |

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
