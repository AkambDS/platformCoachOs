# Design — Invoice Auto-Payment (saved card, charged automatically)

**Status:** in review. One-time payment groundwork **done** (P1–P8 + payment notifications,
2026-11-15 to 11-18, see `one-time-pay.md`); auto-pay itself not built yet.
**Owner:** CoachOS. **Date:** 2026-11-10, revised 2026-11-15 and 2026-11-18 (error logging + email options).

**Scope (revised 2026-11-15):** auto-pay is a switch in **New Invoice → Monthly Subscription →
Subscription Settings**, **off by default**. One-time invoices keep today's pay link only.

A client saves a card **once** in the workspace's own Stripe account, normally while paying the
first subscription invoice. From then on, CoachOS charges each period's invoice automatically on
its due date. Failures fall back to the existing email pay link.

The design keeps the existing **bring-your-own-Stripe-keys** model (CLAUDE.md §3): each
workspace pastes its own Stripe keys, money goes straight to the coach's Stripe balance,
and CoachOS never holds funds or card numbers.

---

## 1. How payment works today (baseline, from the code)

| Piece | Where | What it does |
|---|---|---|
| Pay link in invoice email | `config/urls.py` → `invoices/pay/<token>/` (`InvoicePayView`, `apps/invoicing/public_views.py`) | Creates a **one-off** Stripe Checkout Session (`mode="payment"`) with the workspace's decrypted secret key, for the invoice balance. Reuses/expires the previous session (P3) |
| Webhook | `POST /api/invoices/stripe-webhook/<workspace_id>/` (`StripeWebhookView`) | `checkout.session.completed` (only `mode=payment` + `paid`, P4) → `Payment` row + invoice paid, under an invoice row lock (P1/P2); `charge.refunded` → refund reconcile |
| Payment record | `apps/invoicing/models.py` → `Payment(invoice, amount, method, stripe_payment_id, paid_at, …)` | Unique per `(workspace, stripe_payment_id)` (P1) |
| Amounts | `apps/invoicing/money.py` → `to_minor` / `from_minor` | Every currency, Decimal only (P5). Auto-pay uses it for the PaymentIntent amount |
| Stripe key check | `apps/settings_app/views.py` → `stripe_settings` | Key verified with Stripe on save; `account_id` stored; webhook secret dropped on account/mode change (P6) |
| **Problem reporting** | `apps/invoicing/stripe_problems.py` → `record(exc, workspace, kind)` / `clear(workspace, prefix)` | ErrorLog + platform-admin email (hourly), **owner email "Action needed: …"** (daily), **red banner** in Settings → Integrations until fixed (P7 + 2026-11-18). Auto-pay adds its own kinds (§7.3) |
| Recurring invoices | `tasks/invoicing.py` → `dispatch_subscription_invoices` (Celery beat, daily) | Clones the next period's invoice and emails it (`subscription_auto_send`) |
| Keys | `Workspace.integrations["stripe"]` (Fernet-encrypted, `FIELD_ENCRYPTION_KEY`) | Stripe secret key, webhook secret, `account_id`, `problems` (banner) |
| Emails already built | `tasks/email.py`, `tasks/email_notices.py` | `payment_receipt` (client, every payment, shows balance), `payment_received` (owner, every card payment), `invoice_overpaid` (owner + coach), `stripe_problem` (owner). `payment_failed` (owner) exists but is **not sent yet**; auto-pay is its first user |

**Gap:** nothing is saved for later. Every payment is a one-off checkout.

### 1.1 Review of today's one-time Stripe flow (2026-11-15)

Auto-pay builds on this code, so these fixes came **first** (Phase 0.5). P1–P8 are done and
documented in `one-time-pay.md`. P9 and P11 are part of auto-pay Phase 1; P10 is a test-mode
check.

| # | Finding (file) | Risk | Fix |
|---|---|---|---|
| P1 ✅ fixed 2026-11-15 (see `one-time-pay.md`) | Webhook dedupe is `exists()` then `create()`, and `Payment.stripe_payment_id` has **no unique constraint** (`public_views.py` `_handle_checkout_completed`) | Two webhook deliveries arriving together (Stripe retries, or Stripe + resend from Dashboard) can record the payment **twice** → `amount_paid` doubled | Unique constraint on `(workspace, stripe_payment_id)` where not blank, plus `transaction.atomic()` + `select_for_update()` on the invoice. Pre-deploy check: no existing duplicates |
| P2 ✅ fixed 2026-11-15 | `invoice.amount_paid += …` read-modify-write without a lock (webhook **and** `record_payment`) | A manual "Record payment" at the same moment as a webhook can lose one update | Same lock as P1 in both places |
| P3 ✅ fixed 2026-11-15 | Every click on the pay link creates a **new** Checkout Session and nothing expires the old one | Client opens the link in two tabs (or email + portal) and pays both → **paid twice** | Store `stripe_checkout_session_id` on the invoice; on a new click, `Session.expire()` the previous open one. In the webhook, a payment for an already-paid invoice is still recorded but flags the invoice "Overpaid" and alerts the owner |
| P4 ✅ fixed 2026-11-15 | Webhook handles `checkout.session.completed` without checking `mode` / `payment_status` | Harmless today. With auto-pay, a **setup-mode** session (amount 0) carrying `invoice_id` would record a $0 payment | Only treat it as a payment when `mode == "payment"` and `payment_status == "paid"`; route `mode == "setup"` to the card-save handler |
| P5 ✅ fixed 2026-11-16 | Amounts: `int(balance * 100)` to Stripe, `Decimal(str(amount_total / 100))` back (float) | Wrong for zero-decimal currencies (JPY, KRW…); float rounding risk on the way back | One helper `to_minor(amount, currency)` / `from_minor(int, currency)` using Decimal; used by pay, refund, webhook and auto-pay |
| P6 ✅ fixed 2026-11-18 | Stripe settings PATCH stores the key **without calling Stripe** (`settings_app/views.py` `stripe_settings`) | A typo'd key is only discovered when a client tries to pay. No `acct_…` is recorded, so a switch to a different Stripe account is invisible (auto-pay needs this, B10) | On save: `stripe.Account.retrieve()` with the key → reject if it fails, store `account_id`. Also check the webhook secret starts with `whsec_` |
| P7 ✅ fixed 2026-11-18 | Webhook errors don't reach **ErrorLog** (plain Django view, not DRF; only `tasks.*` logs are mirrored) | A failing webhook is only visible in container logs and Stripe's Dashboard | Wrap the handler: log to ErrorLog with the workspace, and still return 500 so Stripe retries |
| P8 ✅ fixed 2026-11-18 | **No tests** cover `InvoicePayView` or `StripeWebhookView` | Regressions in money code go unnoticed | Pytest with Stripe mocked: signature fail, metadata/workspace mismatch, dedupe, partial pay, refund webhook |
| P9 | Disconnect in Settings deletes the keys with open pay links outstanding | Fine for one-time (page says "not available"). With auto-pay it must **pause** charges, not fail them | Disconnect sets auto-pay paused and warns: "N clients have auto-pay on" |
| P10 | `charge.refunded` relies on the **charge** carrying `invoice_id` metadata | Verify in test mode that metadata set via `payment_intent_data.metadata` appears on the charge event; if not, look up the PaymentIntent | Covered by the local test plan (§14). Auto-pay PaymentIntents set the same metadata |
| P11 | `issue_refund` and the refund webhook save the whole invoice from a copy read earlier, without the lock | A refund at the same moment as a payment (now likelier: auto-pay charges run unattended) could overwrite `amount_paid` | Same row lock as P2 → **T1.29** |

What is already right and stays as it is: per-workspace keys encrypted at rest, signature check
with the workspace's own webhook secret, metadata ↔ workspace cross-check, the signed pay token
with a server-side status check, refunds deduped on `stripe_refund_ids`, Stripe-hosted card entry
(no card data touches CoachOS).

---

## 2. Where the card is stored

```
Client types card ──► Stripe-hosted page (CoachOS never sees the number)
                              │
              ┌───────────────▼──────────────────────────┐
              │ STRIPE — the WORKSPACE OWNER's account   │
              │ Customer  cus_ABC123  (the client)       │
              │   └─ Card pm_XYZ789   (Visa •••• 4242)   │  ← real card, encrypted, PCI-certified
              └───────────────┬──────────────────────────┘
                              │ only reference IDs come back
              ┌───────────────▼──────────────────────────┐
              │ COACHOS DB — ClientPaymentMethod row     │
              │ stripe_customer_id = cus_ABC123          │
              │ stripe_payment_method_id = pm_XYZ789     │  ← useless without the workspace's
              │ brand/last4/exp for display, consent log │    secret key, and only in that account
              └──────────────────────────────────────────┘
Due date → CoachOS: "charge cus_ABC123/pm_XYZ789 $300" (workspace key) → money → coach's Stripe
```

- **CoachOS stores no card numbers**, so its PCI scope stays SAQ-A, as today.
- This is the same pattern Udemy, Netflix, Bonsai and others use: the provider keeps the card,
  and the app keeps a reference.

---

## 3. Decisions

Defaults are recommended; confirm before building.

| # | Decision | Recommended default | Status |
|---|---|---|---|
| D1 | When to charge | On the **due date** (= the billing day) | ☐ confirm |
| D2 | Heads-up before charging | The subscription invoice email **is** the notice ("This invoice will be charged automatically to Visa •••• 4242 on {due date}"). See D9 for how early it goes out. | ☐ confirm |
| D3 | Scope | **Subscription invoices only.** Switch "Charge automatically with the client's saved card" in Subscription Settings, **off by default**. Every generated period copies it. One-time invoices: not in scope. | ✅ decided 2026-11-15 |
| D8 | How the client saves the card | While paying the **first** invoice of an auto-pay subscription: the pay page saves the card for future periods (`setup_future_usage`), with the consent text shown. Fallback: a separate "Set up auto-pay" link (no charge) when the first invoice is already paid or paid offline. | ☐ confirm |
| D9 | Invoice email timing for auto-pay subscriptions | Today the next invoice is generated and emailed **on its due date** (`next_invoice_date` = due date), so the notice and the charge happen the same day. Option A: keep that, charge a few hours after the email. Option B: generate auto-pay periods **3 days early** so the client gets notice before the charge. | ☐ open |
| D4 | Retry policy | See §7 (classify the decline; temporary failures retry on days 3, 7, 14) | ☐ confirm |
| D5 | Who can enable it on an invoice / request it from clients | Workspace owner, plus users with Invoices **edit** rights (`TabPermission`) | ☐ confirm |
| D6 | Payment types | Cards only in Phase 1. US bank debit (ACH, `us_bank_account`) later. | ☐ confirm |
| D7 | Integration model | Charge the saved card directly with off-session PaymentIntents (no Stripe Billing fee). Stripe Connect is a separate, later project. | ☐ confirm |

---

## 4. End-to-end flows

### 4.1 Workspace owner: one-time setup (~5 min)
1. Stripe Dashboard → Developers → Webhooks → open the existing CoachOS endpoint →
   **Add events**:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `setup_intent.succeeded`
   - `payment_method.detached`
2. CoachOS → Settings → Integrations → Stripe → **Auto-pay: On**. The key was already verified with Stripe when it was
   saved (P6); this screen shows the Stripe account ID and the event checklist.

### 4.2 Owner turns on auto-pay for a subscription (~1 min)
Invoices → New Invoice → **Monthly Subscription** → Subscription Settings:

```
[■] Automatically send invoice email each billing period      (exists today)
[ ] Charge automatically with the client's saved card          (NEW, off by default)
    ↳ "Sarah has no saved card yet. Her first invoice email will ask her to pay
       and save her card. Later months are charged on the 1st."      (hint)
```
- The switch is greyed out, with a link to Settings, when the workspace has no Stripe keys or
  auto-pay is off in Settings.
- It needs "Automatically send…" on (auto-pay without generated invoices makes no sense).
- It can also be switched on or off later on an existing subscription (Invoice detail), which
  updates the series anchor so the next period inherits it.
- Status shows **Auto-pay: Waiting for card** until the client saves one.

Bulk "Request auto-pay" from the Clients list moves to Phase 2. The subscription switch covers
the main case.

### 4.3 Client saves their card (~1 min)
**Main path (D8):** the first invoice email → **Pay invoice** → the pay page knows this
invoice belongs to an auto-pay subscription → Checkout with `customer=cus_…` and
`payment_intent_data.setup_future_usage="off_session"`, plus the consent text
*"By paying, you authorize {Workspace} to charge this card automatically each month for this
subscription until you cancel."* → client pays → card saved → **Visa •••• 4242, exp 12/28**.

**Fallback:** a separate "Set up auto-pay" link (Checkout `mode="setup"`, no charge) for when
the current invoice is already paid, paid offline, or the card needs replacing. It's sent from
the client's page or in the failure emails.

### 4.4 Each later period is charged automatically
`dispatch_subscription_invoices` generates the next period's invoice (copying `auto_charge`)
and emails it with the auto-pay wording (D2/D9). Then:
- **Due date, 09:00 workspace time:** the hourly job charges the card → succeeded →
  `Payment` + **Paid** + the existing receipt email.
- No saved card yet → nothing is charged; the invoice behaves like today (pay link) and shows
  **Waiting for card**.

### 4.5 How CoachOS learns that the client set up auto-pay
CoachOS never sees the card form. It learns everything from **Stripe webhooks** on the
existing endpoint `/api/invoices/stripe-webhook/<workspace_id>/`:

```
Client pays + saves card on Stripe's page
  │
  ├─► Stripe ──webhook── checkout.session.completed  (mode=payment, metadata purpose=autopay_capture)
  │       1. verify signature (workspace's whsec_) + metadata.workspace_id = URL workspace
  │       2. record Payment for the invoice (as today, deduped)
  │       3. read session.payment_intent → payment_method (pm_…) + customer (cus_…)
  │       4. stripe.PaymentMethod.retrieve → brand, last4, exp
  │       5. ClientPaymentMethod: status=active, consent text/time/IP saved
  │       6. emails E2: client "Auto-pay is on", owner + coach "Sarah turned on auto-pay"
  │
  ├─► Fallback setup link: checkout.session.completed (mode=setup) → same steps 3–6, no Payment
  │
  └─► Later: payment_method.detached / card replaced → status updated (E11/E12)
```

Where the owner sees it: the invoice (**Auto-pay: Visa •••• 4242**), the client page (auto-pay
card), the Auto-pay tab (§8.1), and the E2 email. The **success page** the client lands on is
only a thank-you; the webhook is the source of truth (same rule as today). If the webhook is
delayed, the status stays "Waiting for card" until it arrives. The owner can also press
**Refresh from Stripe** on the client's auto-pay card, which reads the customer's saved card
directly.

### 4.6 Failure
See §7: classify the decline, then retry or ask the client, then email the client the pay
link and alert the owner.

### 4.7 Client manages or cancels auto-pay
Client portal → **Payment method**: replace the card or turn off auto-pay (detaches the card
in Stripe). The owner can remove it from the client's page too. Removing always stops future
charges immediately.

---

## 5. Data model (migrations)

### 5.1 New model `ClientPaymentMethod` (`apps/invoicing/models.py`, `WorkspaceModel`)
| Field | Type | Notes |
|---|---|---|
| `client` | FK Client, CASCADE | One **active** row per client (unique constraint where `is_active`) |
| `stripe_account_id` | char | `acct_…` of the workspace's Stripe account when saved. Used to detect a key change to another account. |
| `stripe_customer_id` | char | `cus_…` |
| `stripe_payment_method_id` | char | `pm_…` |
| `brand`, `last4`, `exp_month`, `exp_year` | char/int | Display only |
| `status` | choice | `pending`, `active`, `needs_attention`, `removed` |
| `consent_text`, `consent_at`, `consent_ip` | text/datetime/ip | Dispute evidence, with the exact wording version |
| `setup_requested_at`, `setup_requested_by` | datetime/FK User | For the bulk request |
| `created_at`, `updated_at` | | |

### 5.2 `Invoice` new fields
| Field | Type | Notes |
|---|---|---|
| `auto_charge` | bool, default False | Subscription Settings switch; only allowed on `invoice_type=subscription`. `_generate_and_send_next` (`tasks/invoicing.py`) must copy it; today that clone copies fields one by one, so it's an explicit add |
| `stripe_checkout_session_id` | char, blank | P3: the last open Checkout session, expired on the next click |
| `auto_charge_attempts` | small int | Count of charge attempts |
| `auto_charge_next_at` | datetime, null | When the next attempt is due (drives the job) |
| `auto_charge_last_error` | text | Stripe `decline_code` + message |
| `auto_charge_state` | choice | `scheduled`, `succeeded`, `retrying`, `needs_client`, `gave_up` |
| `heads_up_sent_at` | datetime, null | D2 |

### 5.3 `Workspace.integrations` (JSON, no migration)
`stripe_account_id` and `autopay_enabled` (bool).

### 5.4 New table `AutoChargeAttempt` (audit, `WorkspaceModel`)
`invoice`, `amount`, `stripe_payment_intent_id`, `result` (`succeeded`, `failed`,
`requires_action`), `decline_code`, `message`, `attempted_at`. This is the history shown on
the invoice.

---

## 6. Backend components

| # | Component | Details |
|---|---|---|
| B1 | **Stripe customer helper** | `get_or_create_stripe_customer(client)` with the workspace key; reuse the stored `cus_…` when it's in the same `acct_…` |
| B2 | **Setup link endpoint** (public, signed token like the pay link) | `GET /invoices/autopay/<token>/` → Checkout `mode="setup"`, `customer=cus_…`, consent text in `custom_text`, metadata `{client_id, workspace_id, purpose: "autopay_setup"}` → redirect to Stripe. A success page confirms it. |
| B3 | **Request auto-pay API** (staff) | `POST /api/clients/<id>/autopay/request/` and bulk `POST /api/clients/autopay/request/ {client_ids}` → create a `pending` row, email the link (new notice `autopay_request`, audience client) |
| B4 | **Remove auto-pay API** | `DELETE /api/clients/<id>/autopay/` (staff) and `DELETE /api/portal/autopay/` (client) → detach in Stripe, mark `removed` |
| B5 | **Pay page opt-in** | `InvoicePayView`: when the checkbox is ticked, use `customer=cus_…` + `payment_intent_data.setup_future_usage="off_session"`, plus the consent text |
| B6 | **Webhook handlers** (`StripeWebhookView`) | `checkout.session.completed` with `mode=setup` → read SetupIntent → save PM (brand, last4, expiry), status `active`. `setup_intent.succeeded` → same, idempotent. `payment_intent.succeeded` (metadata `purpose=autopay`) → `Payment` (dedupe on PI id) + paid + receipt. `payment_intent.payment_failed` → §7. `payment_method.detached` → `removed`. Also handle `checkout.session.completed` with `setup_future_usage` → save the PM. |
| B7 | **Charge task** `charge_autopay_invoices` (Celery beat, hourly) | Select invoices where `auto_charge`, status in (sent, overdue, partially_paid), balance > 0, `auto_charge_next_at <= now`, and the client's PM is `active` in the same `acct_…`. **`select_for_update(skip_locked=True)`** per invoice. `stripe.PaymentIntent.create(amount=balance, currency, customer, payment_method, off_session=True, confirm=True, idempotency_key=f"autopay-{invoice.id}-{attempt}", metadata={invoice_id, workspace_id, purpose: "autopay"})`. Record the result synchronously as well as by webhook (both dedupe). Declines → §7; Stripe/API/key errors → `stripe_problems.record(…, "autopay_charge_error")` (§7.3), and a successful charge clears it. |
| B8 | **Heads-up task** `send_autopay_heads_up` (daily) | Invoices due within N days (D2), `heads_up_sent_at` null → email (notice `autopay_heads_up`) |
| B9 | **Scheduling hooks** | When an invoice is sent or its due date changes → set `auto_charge_next_at = due_date 09:00` in the workspace's timezone. Recurring clone copies `auto_charge`. When the client saves a new card and has open auto-pay invoices that are past due → schedule now. |
| B10 | **Account-change guard** | On saving Stripe keys in Settings, fetch the `acct_…`. If it changed, mark every `active` PM `needs_attention` and email those clients to set up again. |
| B11 | **Card-expiry reminder** (Phase 2) | Monthly: cards expiring within 30 days → email the client an update link |
| B12 | **Amount safety** | Charge `min(balance, invoice.total)`, never ≤ 0, never draft or void invoices. Amount via `money.to_minor(balance, currency)` (P5, done). |
| B13 | **Pause on disconnect** (P9) | Disconnecting Stripe, or a key Stripe now rejects, **pauses** auto-pay: nothing is charged, retries aren't used up, and the owner is told (§7.3 `autopay_paused`). Reconnecting the **same** `acct_…` resumes; a different account → B10 |
| B14 | **Problem kinds** | Add the auto-pay kinds of §7.3 to `stripe_problems.PROBLEMS`, with the same rate limits, and `clear()` them on the matching success |

---

## 7. Failure and retry rules (usual industry practice)

Classify Stripe's `decline_code` / `last_payment_error.code`:

| Class | Examples | Action |
|---|---|---|
| **Needs client action**, no automatic retry | `expired_card`, `incorrect_number`, `lost_card`, `stolen_card`, `pickup_card`, `card_not_supported`, `authentication_required` (SCA), payment method detached | `auto_charge_state=needs_client`, PM → `needs_attention`. Email the client "update card / pay now" (pay link + setup link) now, then reminders on day 3 and day 7. Alert the owner. |
| **Temporary**, retry | `insufficient_funds`, `generic_decline`, `do_not_honor`, `processing_error`, `try_again_later`, `rate_limit` | Retry on **day 3, day 7, day 14** after the first attempt (4 attempts total, within card-network limits). Email the client after the 1st failure with the next retry date and a pay-now link. Alert the owner on the **first** and **final** failure only. |
| **Any:** client pays via link or saves a new card | | Stop retries. A new card is charged immediately. |
| **All attempts failed** | | `gave_up`. Invoice stays **Overdue** (existing reminders). Client flagged "Needs attention". Nothing is cancelled automatically. |

Emails: reuse `payment_failed` (owner; finally sent). New client-facing notices: `autopay_failed`
(with the reason class wording) and `autopay_final_notice`. **A decline is not an ErrorLog
entry**: a client's card being declined is a normal business event, not a CoachOS or Stripe-setup
problem. It's tracked in `AutoChargeAttempt`, the Auto-pay tab and the owner's `payment_failed`
email. ErrorLog and the platform admin are for system and setup problems only (§7.3).

### 7.1 What is tracked for every charge attempt
Every attempt, successful or not, writes **one `AutoChargeAttempt` row**. Nothing is inferred
later from logs.

| Field | Example |
|---|---|
| `invoice`, `workspace`, `client` | INV-0042 / LMT / Sarah Chen |
| `attempt_no` | 1, 2, 3, 4 |
| `amount`, `currency` | 300.00 USD (the balance at the moment of charging) |
| `stripe_payment_intent_id` | `pi_…` (also the dedupe key for `Payment`) |
| `result` | `succeeded`, `failed`, `requires_action` |
| `failure_class` | `needs_client` or `temporary` (§7) |
| `decline_code`, `message` | `insufficient_funds` / "Your card has insufficient funds." |
| `triggered_by` | `schedule`, `retry`, `new_card`, `manual` (owner "Charge now"), `webhook` |
| `next_attempt_at` | When the next retry will run, if any |
| `emails_sent` | Which notices went out for this attempt, e.g. `["autopay_failed→client","payment_failed→owner"]`, or `["payment_receipt→client","payment_received→owner"]` on success |
| `error_log_id` | Set only for a system/setup error (§7.3), linking the attempt to its ErrorLog row |
| `attempted_at` | timestamp |

The invoice keeps the **summary** (`auto_charge_state`, `auto_charge_attempts`,
`auto_charge_next_at`, `auto_charge_last_error`). Every email also lands in **EmailLog**
(Email Communication page), as all workspace email does via `send_logged`. An `AccessLog`
entry records manual actions (Charge now, Remove card, Request auto-pay).

### 7.2 Email matrix: who gets what, for every event
✅ = already built for one-time payments and reused as is. **New** = to build.

| # | Event | Client email | Workspace owner email | Platform admin | Status shown in CoachOS |
|---|---|---|---|---|---|
| E1 | Owner sends a **setup link** | **New** `autopay_request`: "Set up automatic payments" + setup link | — | — | Client: **Waiting for card** |
| E2 | Client **saved card** (with first payment, or via setup link) | **New** `autopay_confirmed`: "Auto-pay is on: Visa •••• 4242", repeats the consent text | **New** `autopay_activated`: "Sarah Chen turned on auto-pay (Visa •••• 4242)" | — | Client: **Visa •••• 4242** |
| E3 | **Notice before a charge** (D2/D9) | The subscription invoice email itself, with auto-pay wording: "will be charged automatically to Visa •••• 4242 on {date}" | — | — | Invoice: **Scheduled {date}** |
| E4 | Charge **succeeded** | ✅ `payment_receipt` ("paid in full") | ✅ `payment_received`: "Sarah Chen paid $300.00 on invoice #INV-0051 (fully paid)", worded "charged automatically" | — | Invoice: **Paid** |
| E5 | **Temporary** decline, attempt 1 | **New** `autopay_failed`: "Payment didn't go through. We'll try again on {date}, or **pay now**" (pay link) | ✅ `payment_failed` (first use): "Auto-payment failed for INV-0051 ($300): insufficient funds. Retrying {date}." | — (a decline isn't an error) | Invoice: **Retrying {date}** |
| E6 | Temporary decline, attempts 2–3 | — (no email per retry; avoids nagging) | — | — | **Retrying {date}** (history updated) |
| E7 | Temporary decline, **final** attempt (4) | **New** `autopay_final_notice`: "We couldn't collect payment. Please pay here or update your card" | ✅ `payment_failed` (final wording): "Auto-pay gave up on INV-0051 after 4 attempts. Invoice is overdue." | — | Invoice: **Overdue / Auto-pay gave up**; Client: **Needs attention** |
| E8 | **Needs client action** (expired, lost/stolen, wrong number, SCA) | **New** `autopay_failed` (update-card wording): "Your card can't be charged ({reason}). **Update card** or **pay now**" | ✅ `payment_failed`: "Sarah Chen's card needs updating ({reason})" | — | Invoice: **Waiting for client**; Client: **Needs attention** |
| E9 | Needs-client reminders, **day 3 and day 7** | Same as E8, marked "Reminder" | — | — | unchanged |
| E10 | Client **pays via link** after a failure | ✅ `payment_receipt` | ✅ `payment_received` | — | **Paid**; retries cancelled |
| E11 | Client **updates card** after a failure | **New** `autopay_confirmed` | **New** `autopay_activated` ("card updated") | — | Open auto-pay invoices charged **immediately** → E4 or E5/E8 |
| E12 | Card **removed** (client in portal, owner, or detached in Stripe) | **New** `autopay_removed`: "Auto-pay is off. Future invoices will be emailed as usual." | **New** `autopay_removed` (owner copy) | — | Client: **Off**; future invoices revert to the email pay link |
| E13 | Workspace **Stripe account changed** (B10) | **New** `autopay_request` (re-setup wording) | ✅ `stripe_problem` kind `autopay_account_changed` + banner: "N clients must set up auto-pay again" | — | Client: **Needs attention** |
| E14 | Card **expires within 30 days** (Phase 2) | **New** `autopay_card_expiring` + update link | — | — | Client: **Expiring soon** |
| E15 | **Refund** of an auto-paid invoice | Existing refund flow (unchanged) | — | — | Existing |
| E16 | **Charge error on our side** (Stripe API down, key rejected, crash) | — (client not involved) | ✅ `stripe_problem` kind `autopay_charge_error` + **banner** | ✅ ErrorLog + alert email | Invoice: **Retrying**; retried next hour, up to 24h, then E7-style "gave up" |
| E17 | Stripe **disconnected** / key rejected while auto-pay invoices are open (P9, B13) | — | ✅ `stripe_problem` kind `autopay_paused` + **banner**: "Auto-pay is paused for N clients" | ✅ ErrorLog (key rejected only) | Invoices: **Paused**; nothing charged, no attempts used |
| E18 | **Webhook** broken (no secret, wrong secret, can't decrypt) | — | ✅ existing `stripe_problem` webhook kinds + banner | ✅ ErrorLog + alert | Card saves wait (status stays **Waiting for card**); charges still recorded (synchronous result) |
| E19 | **Setup link** can't open Stripe (key rejected, Stripe down) | — (client sees "temporarily unavailable") | ✅ `stripe_problem` kind `autopay_setup_error` + banner | ✅ ErrorLog + alert | unchanged |
| E20 | Paid twice (auto-charge + manual/link at the same time) | — | ✅ `invoice_overpaid` (owner + client's coach) | — | Invoice: **Paid**, overpaid amount shown |

**Recipients rule** (same as one-time payments, decided 2026-11-18):
- **Payment emails** (`payment_received`, `payment_failed`, `autopay_activated`, `autopay_removed`)
  go to the **workspace owner** only. Adding the client's assigned coach is open question Q8.
- **Problem alerts** (`stripe_problem`) go to the **workspace owner**, at most once a day per kind,
  plus the red banner in Settings → Integrations until fixed.
- **Platform admins** get ErrorLog alerts for **system and setup errors only** (E16–E19), at
  most once an hour per workspace and kind. Never for declines (E5–E9), which are business events.
- `invoice_overpaid` keeps its existing recipients (owner + client's coach).
- All recipients are from the same workspace, never another workspace's users.
- All notices appear in **Settings → Emails**, so owners can edit the wording.

**Never sent:** the card number, full expiry or a payment link that charges without the
client's action. Emails show only the brand and last 4 digits.

### 7.3 Errors and logging for auto-pay
Everything goes through the existing `apps/invoicing/stripe_problems.py` (built for one-time
payments, see `one-time-pay.md`). It already writes ErrorLog with an hourly limit per workspace
and kind, emails the owner at most once a day per kind, keeps the Settings banner up until fixed,
and never leaks one workspace's problems to another. Auto-pay only adds **kinds** to its
`PROBLEMS` table (B14):

| Kind (new) | When | Owner reads (title → fix) | Cleared by |
|---|---|---|---|
| `autopay_charge_error` | Stripe API error, network failure or crash **while charging** (not a decline) | "Automatic payments couldn't be taken" → "Nothing to do now; we retry every hour for 24 hours. If it keeps failing, check your Stripe key in Settings." | The next successful auto-charge |
| `autopay_paused` | Stripe disconnected, or Stripe rejects the saved key, while auto-pay invoices are open | "Auto-pay is paused for N clients" → "Reconnect Stripe in Settings → Integrations. Nothing is charged while paused, and no retries are used up." | Same Stripe account reconnected |
| `autopay_account_changed` | New key belongs to a different Stripe account (B10) | "N clients must set up auto-pay again" → "Their saved cards are in your old Stripe account. Use **Send setup link** on each client, or the Auto-pay tab." | Every affected client has saved a card again, or the owner dismisses it |
| `autopay_setup_error` | Setup link can't open a Stripe checkout (B2) | "A client couldn't save their card" (names the client) → "Check your Stripe account and key." | Next setup checkout opened |
| `autopay_webhook_error` | Crash while handling `setup_intent.*`, `payment_intent.*`, `payment_method.detached` | "A Stripe update couldn't be recorded" → "Stripe retries automatically." | Next webhook handled |

The existing webhook kinds (`webhook_no_secret`, `webhook_signature`, `webhook_decrypt`)
already cover auto-pay webhooks, because it's the same endpoint.

**Where each thing is visible:**

| | ErrorLog (Superadmin) | Platform admin email | Owner email | Settings banner | `AutoChargeAttempt` / Auto-pay tab |
|---|---|---|---|---|---|
| Declines (E5–E9) | — | — | ✅ `payment_failed` | — | ✅ every attempt |
| System/setup errors (E16–E19) | ✅ hourly | ✅ hourly | ✅ daily `stripe_problem` | ✅ until fixed | ✅ attempt row has `error_log_id` |
| Successful charges (E4) | — | — | ✅ `payment_received` | — | ✅ |
| Manual actions (Charge now, Remove card, Send setup link) | — | — | — | — | `AccessLog` (audit) |

Logs never contain card numbers, full Stripe responses, keys or pay/setup tokens (S3). ErrorLog
endpoints use the `<token>` placeholder, as the pay page already does.

### 7.4 Email options (what the owner can change)
| Email | Audience | Wording editable in Settings → Emails | Can be switched off |
|---|---|---|---|
| `payment_receipt` | Client | ✅ | No (the client's proof of payment) |
| `payment_received` | Owner | ✅ | ✅ platform-wide: `PAYMENT_RECEIVED_EMAIL_ENABLED=False` in `.env` |
| `payment_failed` | Owner | ✅ | No (money not collected) |
| `invoice_overpaid` | Owner + coach | ✅ | No |
| `stripe_problem` | Owner | ✅ (one email per kind; the kind's text fills `{problem_title}` / `{problem_detail}` / `{problem_fix}`) | No (once a day at most) |
| **New** `autopay_request`, `autopay_confirmed`, `autopay_failed`, `autopay_final_notice`, `autopay_removed`, `autopay_card_expiring` | Client | ✅ | No (the client must know about charges to their card) |
| **New** `autopay_activated`, `autopay_removed` (owner copy) | Owner | ✅ | Proposed: same platform-wide switch as `payment_received` (Q9) |

A per-workspace on/off switch for owner-only emails (instead of the platform-wide `.env`
switch) is open question Q9.

---

## 8. Frontend

| # | Screen | Change |
|---|---|---|
| F1 | Settings → Integrations → Stripe | Auto-pay switch, webhook-event checklist with a "Verify" button (test call), consent wording preview. Already there (one-time work): Stripe account name + `acct_…`, red problem banner (auto-pay kinds appear in it automatically) |
| F2 | Clients list | Auto-pay badge (Waiting for card / Visa •••• 4242 / Needs attention). Bulk "Request auto-pay" → Phase 2 |
| F3 | Client detail | Auto-pay card: status, card, expiry, consent date, **Send setup link / Refresh from Stripe / Remove** |
| F4 | New Invoice → Monthly Subscription → Subscription Settings | Switch under "Automatically send invoice email…": **"Charge automatically with the client's saved card"**, off by default, with the hint from §4.2. Same switch on the subscription's Invoice detail to change it later |
| F9 | **Invoices → Auto-pay tab** | See §8.1 |
| F5 | Invoice detail | Auto-pay status and next attempt date; attempt history (`AutoChargeAttempt`); "Charge now" button (owner) |
| F6 | Client portal | Payment method section: card on file, Replace card, Turn off auto-pay |
| F7 | Public pay page | "Save my card for automatic payments" checkbox + consent text |
| F8 | Settings → Emails | New notices listed (§7.4: `autopay_request`, `autopay_confirmed`, `autopay_activated`, `autopay_failed`, `autopay_final_notice`, `autopay_removed`) + descriptions in `Settings.tsx`; `payment_failed` description updated now that it's sent |

### 8.1 Where to track auto-pay: recommendation

**Recommended: an "Auto-pay" tab inside the Invoices page, not a new sidebar item.** Auto-pay is
a way invoices get paid, so owners look for it under Invoices. A sidebar item for a feature that
most workspaces leave off would add clutter. The tab only appears when auto-pay is on in
Settings.

```
Invoices    [ All invoices ]  [ Auto-pay ]
──────────────────────────────────────────────────────────────────────────────
 Needs attention (2)   Upcoming charges (5)   Active subscriptions (8)      ← summary tiles

 NEEDS ATTENTION
 Client        Subscription   Problem                         Since    Action
 Sarah Chen    $300/mo        Card expired (12/26)            Nov 1    [Send update link]
 Raj Patel     $250/mo        Insufficient funds · retry Nov 8 Nov 1   [View invoice]

 UPCOMING CHARGES (next 30 days)
 Date     Client        Invoice    Amount   Card
 Dec 1    Sarah Chen    INV-0051   $300     Visa •••• 4242
 Dec 1    Mia Lopez     INV-0052   $200     Waiting for card ⚠

 SUBSCRIPTIONS WITH AUTO-PAY
 Client        Plan       Card              Last charge         Status
 Mia Lopez     $200/mo    —                 —                   Waiting for card  [Resend link]
 Tom Reed      $400/mo    MC •••• 5555      Nov 1 ✓ $400        Active

 RECENT ATTEMPTS (from AutoChargeAttempt)
 Nov 1 09:00  Raj Patel  INV-0049  $250  ✗ insufficient_funds  attempt 1/4
```

Alongside the tab, so nobody has to open it to notice a problem:
- **Invoice list and detail:** small badge "Auto-pay · Visa 4242" / "Retrying Nov 8" / "Waiting
  for card"; the detail page shows the attempt history (F5).
- **Client page:** the auto-pay card (F3).
- **Dashboard:** one "Auto-pay needs attention: 2" tile, shown only when the count is above 0.
- **Emails:** E2/E5/E7/E8 to the owner and coach (§7.2).

The tab reads from one endpoint, `GET /api/invoices/autopay/overview/`, scoped to the
workspace. Coaches see only their own clients, like the invoice list does today.

---

## 9. Secure-transaction checklist

Every item below must hold before release. Each one has a test (§10) or a review step.

### 9.1 Card data
- [ ] **S1** Card numbers, CVC and full expiry **never** reach CoachOS. Only Stripe-hosted
  Checkout collects them (no card fields in our pages, no Stripe Elements on our domain). This
  keeps PCI scope at SAQ-A.
- [ ] **S2** CoachOS stores only `cus_…`, `pm_…`, `acct_…`, brand, last 4, expiry month/year.
- [ ] **S3** Logs, ErrorLog, EmailLog and emails never contain secret keys, full Stripe API
  responses or anything beyond brand and last 4.
- [ ] **S4** Stripe secret and webhook keys stay Fernet-encrypted at rest (existing,
  `FIELD_ENCRYPTION_KEY`), are decrypted only in memory at call time, and are never returned by
  any API.

### 9.2 Authorization and tenancy
- [ ] **S5** Every query is scoped by `workspace_id`. A PM is used only when
  `pm.workspace == invoice.workspace == client.workspace` **and** `pm.stripe_account_id` equals
  the workspace's current `acct_…`.
- [ ] **S6** The charge always uses **that invoice's workspace key**. Keys are never cached
  across workspaces in a worker.
- [ ] **S7** Request, remove and Charge now: workspace owner, or users with Invoices **edit**
  rights. Coaches who can only view get 403. Portal users can only remove or replace **their
  own** card.
- [ ] **S8** Setup and pay links are **signed, single-purpose and expiring** tokens (setup link
  7 days, single use). The token binds client + workspace + purpose, and a setup token can't be
  used as a pay token, or the reverse.
- [ ] **S9** Tenant-isolation tests: workspace B can't read, request, charge or remove
  workspace A's auto-pay (added to `test_tenant_isolation.py`).

### 9.3 Consent and the right to charge
- [ ] **S10** Only the **client** enters their card and ticks consent. The owner can never add
  a card in CoachOS.
- [ ] **S11** Store the exact consent text version, time, IP and user agent with the PM. Stripe
  also stores the off-session mandate on the SetupIntent.
- [ ] **S12** Charge only invoices with `auto_charge=True`, status sent/overdue/partially paid,
  balance > 0, and an `active` PM. Never charge draft, void or cancelled invoices.
- [ ] **S13** The client can turn auto-pay off at any time (portal + email link). It takes
  effect immediately, and pending retries are cancelled.

### 9.4 Correct amount, exactly once
- [ ] **S14** Re-read the invoice **inside the lock** (`select_for_update`) and charge
  `balance = total − amount_paid` computed at that moment. Never more than the balance, never
  ≤ 0.
- [ ] **S15** **Idempotency key** per attempt (`autopay-{invoice_id}-{attempt_no}`), so a
  retried request or a crashed worker can't charge twice.
- [ ] **S16** Only one worker charges an invoice (`select_for_update(skip_locked=True)`).
  `auto_charge_next_at` is advanced **before** calling Stripe.
- [ ] **S17** `Payment` is deduped on `stripe_payment_intent_id`, so the synchronous result and
  the webhook can't both record it (same pattern as today).
- [ ] **S18** Currency stays the invoice's currency, with the correct minor-unit conversion
  (zero-decimal currencies).
- [ ] **S19** If a manual or Checkout payment arrives while auto-pay is scheduled, the next run
  sees balance 0 and skips (re-check in S14).

### 9.5 Webhooks
- [ ] **S20** Signature verified with that workspace's webhook secret (existing), and the
  workspace in the URL must match `metadata.workspace_id` on the event object.
- [ ] **S21** Events are processed idempotently (store the processed `event.id`; ignore
  repeats) and tolerate arriving out of order.
- [ ] **S22** Unknown or irrelevant event types return 200 without action, so Stripe doesn't
  retry forever.
- [x] **S23** Webhook failures go to **ErrorLog**. Done for the shared endpoint (P7,
  `stripe_problems.record`); auto-pay's new handlers must report through it too (`autopay_webhook_error`).

### 9.6 Abuse and network rules
- [ ] **S24** At most **4 attempts per invoice in 14 days**, and no retries at all for
  needs-client declines (lost/stolen/expired/wrong number), within Visa/Mastercard
  excessive-retry rules.
- [ ] **S25** Rate-limit the public setup and pay endpoints (existing throttles), and
  bulk-request at most 200 clients per call.
- [ ] **S26** SCA: `off_session=True`. On `authentication_required` never retry automatically;
  send the client the link so they confirm with their bank.

### 9.7 Audit and monitoring
- [ ] **S27** `AutoChargeAttempt` row for **every** attempt (§7.1). `AccessLog` for request,
  remove, Charge now and Settings changes.
- [ ] **S28** Every email logged in EmailLog (existing `send_logged`).
- [ ] **S29** Owner and Superadmin visibility (§7.3): declines in the Auto-pay tab, invoice
  detail, client badge and `payment_failed` email; system/setup errors (E16–E19) in ErrorLog +
  platform-admin email (hourly) + owner `stripe_problem` email (daily) + Settings banner.
  Mechanism already built; auto-pay adds kinds.
- [ ] **S30** Daily reconciliation task (Phase 2): compare yesterday's succeeded PaymentIntents
  in Stripe (`metadata.purpose=autopay`) with `Payment` rows, and alert on any mismatch.

### 9.8 Environments and demo
- [ ] **S31** Demo workspace: auto-pay disabled. The charge task skips `coachos-demo`.
- [ ] **S32** Test-mode keys (`sk_test_…`) and live keys are never mixed. Settings shows "TEST
  MODE" when a test key is saved, and the charge task logs the mode on each attempt.
- [ ] **S33** Feature flag `autopay_enabled` per workspace. Turning it off stops all charges
  immediately (retries paused, not lost).

---

## 10. Testing

| Level | What |
|---|---|
| Unit/API (pytest, Stripe mocked) | Setup link, webhook saving the PM, charge-task selection rules, idempotency, the lock, the classify-and-retry schedule, stop-on-pay, account-change guard, permissions (owner/edit vs coach view-only), tenant isolation. Extend the existing `apps/invoicing/tests.py` (fake Stripe, `_post_webhook`, `_run_together` helpers) |
| Emails and errors (pytest) | Each row of the §7.2 matrix sends exactly the listed emails to exactly the listed people (and nothing to coaches/other workspaces); declines never create ErrorLog; each §7.3 kind → one ErrorLog/hour, one owner email/day, banner shown and cleared by the matching success; `emails_sent` and `error_log_id` filled on `AutoChargeAttempt` |
| Stripe **test mode**, end to end | Test cards: `4242 4242 4242 4242` succeeds · `4000 0000 0000 9995` insufficient funds (retry path) · `4000 0000 0000 0069` expired (needs-client path) · `4000 0027 6000 3184` requires authentication (SCA path) · `4000 0000 0000 0341` attaches but fails when charged |
| Stripe CLI | `stripe listen --forward-to localhost:8000/api/invoices/stripe-webhook/<ws_id>/` + `stripe trigger payment_intent.payment_failed` |
| Manual walkthrough | Owner setup → bulk request → client saves card → invoice due → charged → receipt; then the failure paths |

---

## 11. Rollout

1. Build behind `Workspace.integrations.autopay_enabled` (off by default). Nothing changes for
   workspaces that don't switch it on.
2. Test fully in Stripe **test mode** on local, then on prod with a throwaway workspace using
   test keys.
3. Enable for one real workspace (LMT) with 1–2 consenting clients, watch one full cycle.
4. Update `DEPLOY.md` (owner webhook events) and write a short owner help page.

---

## 12. TODO checklist

### Phase 0 — Decisions
- [ ] **T0.1** Confirm D1, D2, D4–D9 (§3); D3 decided 2026-11-15 (subscriptions only, off by default)
- [ ] **T0.2** Approve consent wording (legal review if needed)
- [ ] **T0.3** Approve the email texts (request, heads-up, failed, final notice)

### Phase 0.5 — Fix today's one-time Stripe flow first (§1.1) — ✅ done 2026-11-15 to 11-18 except T0.5.8
- [x] **T0.5.1** P1/P2 (done 2026-11-15, `one-time-pay.md`): unique `(workspace, stripe_payment_id)` + lock the invoice in webhook and `record_payment` (+ pre-deploy duplicate check)
- [x] **T0.5.2** P3 (done 2026-11-15, `one-time-pay.md`): store + expire the previous Checkout session; overpaid flag + owner alert
- [x] **T0.5.3** P4 (done 2026-11-15, `one-time-pay.md`): webhook only records a payment for `mode=payment` + `payment_status=paid`
- [x] **T0.5.4** P5 (done 2026-11-16, `one-time-pay.md`): `to_minor` / `from_minor` Decimal helpers used by pay, refund and webhook
- [x] **T0.5.5** P6 (done 2026-11-18): verify key with `stripe.Account.retrieve` on save; store `account_id`; `whsec_` check
- [x] **T0.5.6** P7 (done 2026-11-18): webhook failures → ErrorLog
- [x] **T0.5.7** P8 (done 2026-11-18, 46 tests): pytest for pay view + webhook (Stripe mocked)
- [ ] **T0.5.8** P10: confirm refund metadata in the local test-mode run (§14)
- [x] **T0.5.9** Payment notifications (2026-11-18): `payment_received` to owner, receipts for partial payments, owner `stripe_problem` emails + Settings banner for every Stripe error, platform admin via ErrorLog

### Phase 1 — Core auto-pay (≈ 5–6 dev days incl. tests and the §9 checklist)
**Data**
- [ ] **T1.1** `ClientPaymentMethod` model + migration (§5.1)
- [ ] **T1.2** `Invoice` auto-pay fields + migration (§5.2)
- [ ] **T1.3** `AutoChargeAttempt` model + migration (§5.4)
- [ ] **T1.4** `Workspace.integrations["stripe"]["autopay_enabled"]`. (`account_id` is already stored on key save, P6)

**Backend**
- [ ] **T1.5** Stripe customer helper (B1)
- [ ] **T1.6** Signed setup link + Checkout `mode="setup"` + success page (B2)
- [ ] **T1.7** Send-setup-link API for one client + `autopay_request` email (B3); bulk → T2.8
- [ ] **T1.8** Remove auto-pay API, staff + portal (B4)
- [ ] **T1.9** Pay page: for an auto-pay subscription invoice, Checkout with `customer` + `setup_future_usage=off_session` + consent text (D8, B5)
- [ ] **T1.10** Webhook handlers: setup/save PM, PI succeeded, PI failed, PM detached (B6)
- [ ] **T1.11** `charge_autopay_invoices` task + beat schedule, lock, idempotency, synchronous + webhook record (B7)
- [ ] **T1.12** Scheduling hooks: send / due-date change / new card (B9); `_generate_and_send_next` copies `auto_charge`; invoice email shows the auto-pay wording (D2/D9)
- [ ] **T1.13** Decline classification + retry schedule + state machine (§7)
- [ ] **T1.14** Emails per the matrix (§7.2): new `autopay_request`, `autopay_confirmed`, `autopay_activated`, `autopay_failed`, `autopay_final_notice`, `autopay_removed`; reuse `payment_receipt`, `payment_received`, `payment_failed` (first sender), `invoice_overpaid`, `stripe_problem`. Recipients rule and options per §7.2/§7.4
- [ ] **T1.14d** Auto-pay problem kinds in `stripe_problems.PROBLEMS` + `clear()` on matching success (§7.3, B14); `error_log_id` on the attempt
- [ ] **T1.14a** `AutoChargeAttempt` written for every attempt with all §7.1 fields, incl. `emails_sent`
- [ ] **T1.14b** Webhook event-ID dedupe store + metadata workspace check (S20–S22)
- [ ] **T1.14c** Secure-transaction checklist §9 (S1–S33) reviewed item by item; each has a test or a sign-off
- [ ] **T1.15** Account-change guard (B10)
- [ ] **T1.16** Amount/currency safety (B12) — `money.to_minor` already built
- [ ] **T1.28** Pause on disconnect / rejected key, resume on same account (P9, B13, kind `autopay_paused`)
- [ ] **T1.29** Lock the invoice in `issue_refund` and the refund webhook (P11)

**Frontend**
- [ ] **T1.17** Settings → Integrations → Stripe: auto-pay switch + webhook checklist (F1)
- [ ] **T1.18** Clients list: auto-pay status badge (F2)
- [ ] **T1.19** Client detail: auto-pay card (F3)
- [ ] **T1.20** Subscription Settings switch, off by default, + the same switch on Invoice detail (F4)
- [ ] **T1.21** Invoice detail: status + attempt history + "Charge now" (F5)
- [ ] **T1.22** Public pay page: consent text for auto-pay invoices (F7)
- [ ] **T1.22a** Invoices → Auto-pay tab + `GET /api/invoices/autopay/overview/` + Dashboard tile (§8.1, F9)
- [ ] **T1.23** Settings → Emails descriptions for the new notices (F8)

**Quality**
- [ ] **T1.24** Pytest suite (§10, unit/API), incl. tenant-isolation cases
- [ ] **T1.25** Stripe test-mode walkthrough with all test cards (§10)
- [ ] **T1.26** `DEPLOY.md`: owner webhook events + auto-pay setup steps
- [ ] **T1.27** Change log + pre/post-deploy checks (migration gates, like `ops/predeploy_check_*`)

### Phase 2 — Polish
- [ ] **T2.1** Heads-up email N days before charging (B8, D2) if not in Phase 1
- [ ] **T2.2** Client portal payment-method management (F6)
- [ ] **T2.3** Card-expiry reminders (B11)
- [ ] **T2.4** Configurable retry schedule per workspace
- [ ] **T2.5** Reports: auto-pay success rate, failed and recovered amounts
- [ ] **T2.6** Daily Stripe ↔ CoachOS reconciliation with alert on mismatch (S30)
- [ ] **T2.7** Card-expiring email `autopay_card_expiring` (E14)
- [ ] **T2.8** Clients list bulk "Request auto-pay" (B3 bulk)

### Phase 3 — Later / optional
- [ ] **T3.1** US bank debit (ACH) as a second payment method (D6)
- [ ] **T3.2** Stripe Connect onboarding instead of pasted keys (central webhooks, optional platform fee)
- [ ] **T3.3** Client-chosen charge day for recurring invoices

---

## 13. Open questions (under review)

- **Q1** Does any workspace bill in a zero-decimal currency (e.g. JPY)? This affects B12 and the
  existing pay page (P5).
- **Q2** Should the client be able to pause auto-pay temporarily, or only remove it?
- **Q3** Should "Charge now" (manual, owner) skip the heads-up email? Suggest yes, with a confirm dialog.
- **Q4** D9: same-day email + charge, or generate auto-pay periods 3 days early?
- **Q5** If the client pays the first invoice **without** saving the card (or pays offline), should
  later periods email a setup link automatically, or only when the owner presses "Send setup link"?
- **Q6** When auto-pay is switched **off** on a subscription, should the client be emailed, and
  should their saved card stay in Stripe for later or be detached?
- **Q7** One saved card per client across all their subscriptions (current design), or one per
  subscription?
- **Q8** Should auto-pay emails to the owner (`payment_failed`, `autopay_activated`,
  `autopay_removed`) also go to the client's **assigned coach**? Today's rule (2026-11-18):
  owner only, like `payment_received`.
- **Q9** Owner-only emails can be switched off only platform-wide (`.env`). Is a **per-workspace**
  on/off switch in Settings → Emails needed?

---

## 14. Local Stripe test-mode setup

Nothing here touches real money: test keys (`sk_test_…`) only accept test cards.

1. **Stripe account → test mode.** dashboard.stripe.com → toggle **Test mode** →
   Developers → API keys → copy the **Secret key** (`sk_test_…`).
2. **Log in the Stripe CLI** (already installed, v1.50.6): `stripe login` → approve in the browser.
3. **Forward webhooks to local Django** (keep this terminal open):
   ```bash
   stripe listen --forward-to localhost:8000/api/invoices/stripe-webhook/<WORKSPACE_ID>/
   ```
   It prints `Ready! Your webhook signing secret is whsec_…`. That secret is stable per CLI login.
   Get the workspace id:
   ```bash
   docker compose exec api python manage.py shell -c "from apps.accounts.models import Workspace as W; [print(w.id, w.slug) for w in W.objects.all()]"
   ```
4. **Connect in CoachOS** (local, as the workspace owner): Settings → Integrations → Stripe →
   paste `sk_test_…` and the `whsec_…` from step 3 → Save. The page shows mode **test**.
5. **One-time payment test:** create an invoice for a client with your own email → Send → open
   Mailpit (http://localhost:8025) → **Pay invoice** → Stripe Checkout → card `4242 4242 4242 4242`,
   any future expiry, any CVC → back on the "Payment received" page. The `stripe listen` terminal
   shows `checkout.session.completed → 200`; the invoice shows **Paid**; Mailpit has the receipt.
6. **Refund test:** Invoice detail → Refund → check the invoice and Stripe Dashboard → Payments.
   Also refund one directly in the Stripe Dashboard and confirm the `charge.refunded` webhook updates
   the invoice (P10).
7. **Failure cards:** `4000 0000 0000 0002` (declined), `4000 0000 0000 9995` (insufficient funds),
   `4000 0027 6000 3184` (3-D Secure). For the P3 double-pay check, open the pay link in two tabs and
   try paying both.
8. **Replay an event** (dedupe check): `stripe events resend <evt_id>` → no second Payment.

The platform-level `STRIPE_TEST_SECRET_KEY` in `backend/.env` is for dj-stripe (CoachOS billing its
own workspaces) and is **not** used by invoice payments. Leave it alone.
