# One-time invoice payment (Stripe, per workspace): design, bugs, fixes

**Status:** live in production. P1–P8 fixed locally on 2026-11-15 to 11-18 (not yet deployed).
**Related:** `design_auto_payment.md` (auto-pay builds on this flow), CLAUDE.md §5.1.

---

## 1. What it does

A client pays an invoice by card from the invoice email or the client portal. The money goes
straight into the **workspace owner's own Stripe account**, because each workspace pastes its
own Stripe keys ("bring your own keys"). CoachOS never holds money and never sees card numbers.
Owners and coaches can also record offline payments (cash, bank transfer, cheque) by hand.

## 2. Flow

```
Owner: Settings → Integrations → Stripe
   paste sk_test_/sk_live_ key + whsec_ webhook secret  (both Fernet-encrypted at rest)
   the key is checked with Stripe before saving; the Stripe account it belongs to is shown
   add the webhook URL shown there in their Stripe Dashboard
        │
Invoice sent ─► email "Pay invoice" button / portal "Pay now"
        │        link = /invoices/pay/<signed token>/   (stored on Invoice.stripe_payment_link)
        ▼
GET /invoices/pay/<token>/                 InvoicePayView (public, no login)
   • verify token (HMAC with SECRET_KEY, invoice-scoped, 365-day expiry)
   • invoice must be sent / overdue / partially_paid and balance > 0
   • decrypt the workspace's secret key
   • lock the invoice row, then look at the checkout this link opened last time
     (Invoice.stripe_checkout_session_id):
       still open, same amount     → send the client back to THAT checkout
       still open, amount changed  → expire it (can't be paid at the old amount)
       paid, not yet recorded      → "Payment received, being processed" page, stop
       expired / recorded / gone   → nothing to reuse
   • otherwise stripe.checkout.Session.create(mode="payment", amount = balance,
       metadata = {invoice_id, workspace_id}  (also on the PaymentIntent)) and store its id
   • 302 → Stripe-hosted checkout page        (card entered on Stripe, not CoachOS)
        ▼
Client pays ─► Stripe redirects to /invoices/pay/<token>/success/
               (thank-you page only; it changes nothing)
        ▼
Stripe ─► POST /api/invoices/stripe-webhook/<workspace_id>/     StripeWebhookView
   • verify signature with THAT workspace's webhook secret
   • checkout.session.completed:
       metadata.workspace_id must equal the URL workspace
       only mode="payment" + payment_status="paid" + amount > 0 counts as a payment
         (card-save, nothing-to-pay and not-yet-cleared checkouts are acknowledged, not recorded)
       lock invoice → skip if this PaymentIntent is already recorded
       → Payment(method=stripe, stripe_payment_id=pi_…) → amount_paid += amount
       → status paid / partially_paid → receipt email when fully paid
       → paid more than the total? owner + coaches get the "Invoice Overpaid" email
   • charge.refunded: refunds made in the Stripe Dashboard are applied to the
       invoice (deduped on Invoice.stripe_refund_ids)
```

Manual payments: `POST /api/invoices/<id>/record-payment/` (Invoices **edit** permission) → the
same Payment + amount_paid + status logic, with the same lock (§4).

Refunds from CoachOS: `POST /api/invoices/<id>/refund/` → `stripe.Refund.create` with the
workspace's key when the invoice was paid by Stripe, bookkeeping only otherwise.

## 3. Components

| Piece | File |
|---|---|
| Stripe key settings (GET status / PATCH keys / disconnect) | `backend/apps/settings_app/views.py` → `stripe_settings`; screen in `frontend/src/pages/coach/Settings.tsx` → `StripePaymentsCard` |
| Payment problems → ErrorLog + platform admin email + owner email + Settings banner | `backend/apps/invoicing/stripe_problems.py` (`record` / `clear`; owner texts in `PROBLEMS`) |
| "Payment Received" email to the owner; receipt to the client | `backend/tasks/email.py` → `send_payment_received_email`, `send_payment_receipt_email`; switch `PAYMENT_RECEIVED_EMAIL_ENABLED` |
| Key encryption | `backend/apps/accounts/crypto.py` (`FIELD_ENCRYPTION_KEY`) |
| Pay token | `backend/apps/invoicing/tokens.py` |
| Amount conversion to/from Stripe (all currencies) | `backend/apps/invoicing/money.py` (new, P5) |
| Pay page, success page, webhook | `backend/apps/invoicing/public_views.py` |
| Record payment, refund | `backend/apps/invoicing/views.py` → `InvoiceViewSet` |
| Pay link in emails | `backend/tasks/email.py` (`make_invoice_pay_token`, ~line 1122) |
| "Invoice Overpaid" email to owner + coaches | `backend/tasks/email.py` → `send_invoice_overpaid_email`; text in `tasks/email_notices.py` (`invoice_overpaid`, editable in Settings → Emails) |
| Models | `backend/apps/invoicing/models.py` → `Invoice`, `Payment` |
| Tests | `backend/apps/invoicing/tests.py` (new 2026-11-15) |

Data: `Invoice.total`, `amount_paid`, `status`, `paid_at`, `refund_amount`, `stripe_refund_ids`,
`stripe_payment_link`, `stripe_checkout_session_id` (new, P3). `Payment(invoice, workspace, amount, method, stripe_payment_id, paid_at,
recorded_by)`. Keys live in `Workspace.integrations["stripe"]`.

Security properties already in place: keys encrypted at rest and never returned by the API;
webhook signature verified per workspace; webhook metadata cross-checked against the URL
workspace; invoice-scoped signed pay token with the payable status re-checked on every click;
card entry only on Stripe's page (PCI SAQ-A).

---

## 4. Bugs found (review 2026-11-15) and what was fixed

### P1: the same Stripe payment could be recorded twice — FIXED
**Bug.** The webhook checked "is this PaymentIntent already recorded?" with a plain query, then
inserted the Payment. Stripe delivers webhooks *at least once* and can send the same event twice
at the same moment (its own retries, or "Resend" in the Dashboard). Both deliveries could pass
the check before either inserted, and nothing in the database stopped a second row. **Result:**
two Payment rows and `amount_paid` doubled (a $300 payment shown as $600, invoice wrongly
"paid"/over-paid).

**Fix.**
1. **Database rule:** unique constraint `unique_stripe_payment_per_workspace` on
   `Payment(workspace, stripe_payment_id)`, only where `stripe_payment_id` isn't blank, so manual
   cash/bank/cheque payments are unaffected. Migration
   `invoicing/0014_payment_unique_stripe_payment_per_workspace.py`.
2. **Row lock:** the webhook now runs in a transaction and locks the invoice row
   (`select_for_update`) **before** the "already recorded?" check. A twin delivery waits for
   the first to commit, then sees the Payment and stops.
3. The "already recorded?" check now looks across the whole workspace (it was per invoice).
4. If the database rule ever fires anyway, the webhook catches it, logs it and returns 200,
   so Stripe doesn't keep retrying.
5. The receipt email is sent **after** the transaction commits, so the lock is held only for
   milliseconds.

### P2: a webhook and a manual "Record payment" at the same moment lost one amount — FIXED
**Bug.** Both paths did `amount_paid += amount` on a copy of the invoice read at the start of the
request. When they overlapped, both started from the same old value and the second save
overwrote the first. **Result:** e.g. $300 by card + $200 by bank on a $500 invoice ended with
`amount_paid = $200`, status "partially paid", although both Payment rows existed.

**Fix.** `record_payment` now takes the same invoice row lock inside a transaction and re-reads
the invoice under the lock. Whichever request comes second waits and adds to the committed total.
A manual payment entered with a Stripe payment ID that's already recorded is rejected with 400
"This Stripe payment is already recorded." instead of a server error.

### P3: a client could pay the same invoice twice — FIXED
**Bug.** Every click on the pay link created a **brand-new** Stripe checkout, and nothing closed
the previous one. Each checkout is a separate Stripe payment, so P1's "same payment twice" rule
can't catch it. Ways it happened:
- the client opens the email link in two tabs (or email + portal) and pays in both;
- the client pays in tab 1 and, before the webhook arrives, clicks the link again; the invoice
  still looks unpaid, so a new checkout opens;
- the client opens checkout for $300, the owner records a $100 bank payment, and the old $300
  checkout is still payable.

**Result:** the card is charged twice. The money sits in the owner's Stripe and nobody is told.

**Fix.**
1. The invoice remembers the checkout its pay link last opened (`stripe_checkout_session_id`,
   migration `0015`).
2. On every click, under a lock on the invoice row, the pay page asks Stripe about that checkout
   first:
   - **still open, same amount** → the client is sent back to **the same** checkout. Two tabs
     end up on one checkout, and Stripe only lets a checkout be paid once;
   - **still open, but the balance changed** → it is **expired** in Stripe so it can't be paid at
     the old amount, then a new one is created for the new balance;
   - **already paid, webhook not here yet** → "Payment received, being processed" page, no new
     checkout;
   - **expired, already recorded, or not in this Stripe account** (owner changed keys) → a new
     checkout as before.
3. If the client finishes paying in the split second before the expire, Stripe refuses the
   expire. The page re-checks and shows "being processed".
4. The lock also covers two clicks at the same instant: the second waits and reuses the first
   one's checkout.
5. **Safety net:** if a second payment still gets through (for example a checkout opened
   **before** this fix was deployed, which CoachOS can't know about), the webhook records it,
   because the money really moved, and emails the owner and the client's coach: *"Invoice
   #INV-0042 was overpaid by $300.00. Refund the extra from the invoice in CoachOS or from your
   Stripe Dashboard."* The refund itself stays a human decision. After refunding the extra, the
   invoice shows "Partially refunded" (existing refund logic).

### P4: a checkout that took no money could be recorded as a payment — FIXED
**Bug.** Stripe sends the same "checkout finished" event for every kind of checkout. The webhook
recorded a payment for **any** finished checkout carrying an invoice ID, without checking what
kind it was or whether money was taken:

| Kind of checkout | What Stripe reports | Old webhook did |
|---|---|---|
| Card **save only** (what auto-pay will use to store a card) | mode `setup`, no amount | recorded a **$0 payment** on the invoice |
| Bank debit still clearing (e.g. ACH, days to settle) | payment_status `unpaid` | recorded the **full amount as paid** before any money arrived. Worse than $0: the invoice shows Paid and sends a receipt, and if the debit later fails, the money never comes |
| Nothing to pay (100% discount / $0 total) | payment_status `no_payment_required` | recorded a $0 payment |

**Impact today: none.** CoachOS only opens card checkouts in payment mode, so Stripe always reports
`paid`. It would break as soon as auto-pay (card save) or bank debit is added.

**Fix.** The webhook only records a payment when the checkout is `mode = "payment"`,
`payment_status = "paid"` **and** the amount is above zero. Anything else is logged and answered
with 200, so Stripe doesn't retry, and the invoice is not touched. When auto-pay comes, the
card-save checkout gets its own handler (save the card, no payment). When bank debit comes, it
must also handle Stripe's `checkout.session.async_payment_succeeded` event, which is when that
money actually arrives.

### P5: amounts were converted as if every currency had cents — FIXED
**Background.** Stripe takes and returns amounts as a whole number in the currency's
**smallest unit**. For dollars that's cents: $300.00 is sent as `30000`. But about 16
currencies have **no** smaller unit (Japanese yen, Korean won, and others), so ¥5,000 must be
sent as `5000`. Five currencies (Kuwaiti dinar and others) have **three** decimals.

**Bug.** CoachOS always used `× 100` going to Stripe and a float `÷ 100` coming back. For a
¥5,000 invoice:

| Step | Old code | Correct |
|---|---|---|
| Pay link opens Stripe checkout | sent `500000` → client charged **¥500,000** (100× too much) | `5000` → ¥5,000 |
| Webhook records the payment | `5000 ÷ 100` → **¥50 paid**, invoice "partially paid" | ¥5,000, invoice "paid" |
| Refund ¥1,000 from CoachOS | refused: "Cannot refund more than ¥50" (and would have sent `100000`) | sends `1000` |
| Refund made in the Stripe Dashboard | recorded as ¥20 instead of ¥2,000 | ¥2,000 |

The float maths (`÷ 100` on a float) gave correct results at realistic invoice sizes, but money
code should never use floats.

**Impact today: none.** The invoice form only offers USD, EUR, GBP, CAD and AUD (all with
cents), and all existing invoices are USD. It would have hit the first workspace to bill in
yen or won, or anyone setting another currency through the API, which accepts any 3-letter
code.

**Fix.** One helper, `backend/apps/invoicing/money.py`, used by every place that sends an amount
to Stripe or reads one back (pay page, payment webhook, refund from CoachOS, refund webhook):
- `to_minor(amount, currency)` / `from_minor(value, currency)` know Stripe's zero-decimal and
  three-decimal currency lists and use Decimal maths only;
- an amount the currency can't charge (e.g. ¥5,000.40) is rounded half up to what it can (¥5,000);
- a refund with more decimals than the currency allows is rejected with a clear message
  ("A JPY refund amount must be a whole number.") instead of being silently cut;
- the P3 "overpaid" email ignores differences smaller than one unit (¥1 / $0.01), so rounding
  doesn't trigger a false "paid twice" alert.

Not changed: invoice PDFs and emails still show a `$` sign for every currency. That's a display
issue, separate from the amounts charged.

### P6: the Stripe key was saved without checking it with Stripe — FIXED
**Bug.** Settings only checked that the key *started* with `sk_test_` or `sk_live_`, then saved it.
- A mistyped, rolled or deleted key was accepted with "Stripe key saved". Nobody found out until
  a **client** clicked "Pay invoice" and got "Payment temporarily unavailable".
- CoachOS never recorded **which Stripe account** the key belongs to. When an owner switched to a
  different Stripe account, or from test keys to live keys, the saved webhook signing secret
  still belonged to the old endpoint. A webhook secret only works for one endpoint, in one
  account, in one mode. Every payment's webhook then failed its signature check, and **payments
  silently stopped being recorded** (money in Stripe, invoices still "Sent").
- Settings accepted anything as the webhook secret. Pasting the API key into that box was
  accepted too.

**Fix.**
1. Before saving a new key, CoachOS asks Stripe "whose account is this?" (`Account.retrieve`):
   - Stripe rejects the key → **not saved**, and the owner sees "Stripe didn't accept this key…".
     The previous working key stays.
   - Stripe can't be reached → **not saved**: "Couldn't reach Stripe… try again in a minute".
   - Accepted → saved together with the **account ID** (`acct_…`) and its display name.
2. If the new key belongs to a **different account or mode** than the saved one, the old webhook
   secret is removed. The owner is told to set up the webhook again (Step 2) and paste the new
   secret. Re-saving a rolled key for the same account and mode keeps the webhook secret.
3. The webhook secret must start with `whsec_`.
4. Settings shows **"Stripe account: <name> (acct_…)"** under the Connected badge.
5. Keys saved **before** this change get their account filled in the first time anyone opens the
   Stripe settings. If Stripe is slow then, the page still loads and it tries again next time.
   Nothing changes for an existing connection otherwise. In particular, its webhook secret is
   kept.

Auto-pay needs the account ID later, to spot a change to a different Stripe account (B10 in
`design_auto_payment.md`).

### P7: payment failures didn't reach ErrorLog — FIXED
**Bug.** The pay page and the webhook are plain Django views, so DRF's error handler (which fills
Superadmin → Error Log) never saw their failures (CLAUDE.md §6). If something broke, the only trace
was the container log. Examples: a wrong webhook secret, a crash while recording a payment, or
Stripe refusing to open a checkout. A misconfigured webhook could leave every payment
unrecorded for days with nothing visible in CoachOS.

**Fix.** Each of these now writes an **ErrorLog** row for that workspace, as an error, so the
platform admins also get the usual alert email:

| Where | What is logged | Response to Stripe / client |
|---|---|---|
| Webhook | No webhook secret saved, but Stripe is sending events | 400 (as before) |
| Webhook | Webhook secret can't be decrypted (`FIELD_ENCRYPTION_KEY` problem) | **500** so Stripe retries once fixed |
| Webhook | Signature check fails (usually a secret from another endpoint, account or mode) | 400 (as before) |
| Webhook | Any crash while recording a payment or refund | **500** (was an unhandled error) so Stripe retries the event |
| Pay page | Stripe key can't be decrypted; Stripe refuses or can't be reached when opening checkout | "Payment temporarily unavailable" page (as before) |

**At most one row per workspace and kind of problem per hour.** A wrong webhook secret fails
every delivery and Stripe retries for days, so without that limit it would mean an alert email
for every retry. The pay page logs `/invoices/pay/<token>/ (invoice INV-0042)` rather than the
real link, because the link lets anyone pay the invoice and ErrorLog entries are emailed.

The workspace owner is now told as well (2026-11-18, next section).

### Who is told about payments and payment problems (added 2026-11-18)
Before this change the owner got **no email for any payment**. The client got a receipt only
when the invoice became fully paid. Stripe problems reached only the platform admins, although
it's the owner who has to fix their own Stripe setup.

**Payments**

| Event | Client | Workspace owner | Platform admin |
|---|---|---|---|
| Card payment, **partial** | Receipt: amount paid, **total paid so far, balance due** (new) | **"Payment Received"** email (new): *"Sarah Chen paid $100.00 on invoice #INV-0042 (partially paid, $200.00 still due)"* | — |
| Card payment, **completes** the invoice | Receipt: *"This invoice is now paid in full."* | "Payment Received": *"… (fully paid)"* | — |
| Manual "Record payment" (cash/bank/cheque), partial or full | Receipt (partial is new) | — (they recorded it) | — |
| Paid twice (P3) | — | "Invoice Overpaid" (owner + client's coach) | — |
| Card declined on Stripe's page | Stripe shows it; client retries | — (deliberately; see below) | — |

**Stripe problems** (all five kinds from P7)

| Who | How | How often |
|---|---|---|
| Platform admin (you) | ErrorLog row + "[CoachOS ERROR] …" email, with traceback | Once an hour per workspace and kind |
| **Workspace owner** (new) | **"Action needed: …"** email in plain words, with what happened and how to fix it (Settings → Emails "Stripe Payment Problem", editable) | **Once a day** per kind |
| **Workspace owner** (new) | **Red banner** at the top of Settings → Integrations, with the same text and when it was last seen | Until fixed |

The owner email's button opens Settings → Integrations directly (`/settings?tab=integrations`).
What the owner reads for each kind:

| Kind | Owner sees |
|---|---|
| No webhook secret saved | "Stripe payments aren't being recorded": paste the signing secret in Step 2 |
| Wrong webhook secret | "…the webhook secret doesn't match": re-do Step 2, naming the exact endpoint URL and the test/live mode |
| Secret can't be decrypted | "…saved settings can't be read": paste the secret again; Stripe resends the missed updates |
| Crash while recording | "A Stripe payment couldn't be recorded", with the error; Stripe retries; record manually if still unpaid after an hour |
| Pay page can't decrypt the key | "Clients can't pay online": save the key again |
| Stripe refuses / unreachable when a client clicks Pay | "A client couldn't start an online payment" for invoice #…, with Stripe's message |

**The banner clears itself** once the same thing works again: the next webhook handled for
webhook problems, the next checkout opened for pay-page problems. It also clears when the owner
saves the Stripe key or webhook secret. If that didn't fix it, the next failure brings it back.

**Switching off "Payment Received":** set `PAYMENT_RECEIVED_EMAIL_ENABLED=False` in the backend
`.env`. Like `SESSION_REMINDER_HOURS`, it applies to every workspace. Its wording is editable per
workspace in Settings → Emails. Receipts and problem alerts can't be switched off.

**"Payment Failed" email stays unsent for one-time payments**, by decision (2026-11-18). A
declined card is handled on Stripe's own page and the client simply tries another card, so
there's nothing for the owner to do. It will be wired up for auto-pay, where a failed automatic
charge does need the owner (`design_auto_payment.md` §7.2).

### P8: no tests for the pay page or the webhook — FIXED
Before 2026-11-15 there were no tests for any of this code. There are now **46**:
`backend/apps/invoicing/tests.py` (37: pay page, webhook, record payment, refunds, amount
conversion, error logging) and `backend/apps/settings_app/tests.py` (9: Stripe key settings).
Stripe itself is never called. It's replaced by mocks and a small fake that keeps checkouts the
way Stripe does. Every fix above was also run against the **old** code to confirm the tests catch
the bug (the "Old code" column below).

### Proof (tests in `backend/apps/invoicing/tests.py`)
| Test | Old code | Fixed |
|---|---|---|
| Same webhook delivered twice, one after the other | pass | pass |
| **Same webhook delivered twice at the same moment** (2 real threads) | **fail: 2 payments** | pass: 1 |
| **Webhook $300 + manual $200 at the same moment** on a $500 invoice | **fail: amount_paid $200** | pass: $500, paid |
| Database rejects a second Payment with the same Stripe id | fail (no rule) | pass |
| Manual payment reusing a recorded Stripe id | fail: accepted | pass: 400 |
| Partial then final card payment add up | pass | pass |
| Webhook with metadata pointing at another workspace's invoice | pass: ignored | pass |
| **P3:** second click while checkout is open | **fail: 2nd checkout created** | pass: same checkout |
| **P3:** two clicks at the same instant (2 real threads) | **fail: 2 checkouts** | pass: 1 |
| **P3:** click after paying, before the webhook | **fail: new checkout** | pass: "being processed" |
| **P3:** balance changed after checkout opened | **fail: old $300 checkout stays payable** | pass: expired, new $200 one |
| P3: client pays just before the expire | — | pass: "being processed" |
| P3: earlier checkout paid **and recorded**, total raised later | pass | pass: new checkout for the rest (not blocked) |
| P3: stored checkout not in this Stripe account | pass | pass: new checkout |
| **P3 safety net:** second payment on a paid invoice | **fail: nobody told** | pass: recorded + owner and coach emailed |
| **P4:** card-save checkout (`mode=setup`) | **fail: $0 payment recorded** | pass: nothing recorded |
| **P4:** bank debit not cleared (`unpaid`) | **fail: full $300 marked paid** | pass: nothing recorded |
| **P4:** nothing to pay (`no_payment_required`) | **fail: $0 payment recorded** | pass: nothing recorded |
| **P4:** event without mode / status fields | **fail: recorded** | pass: nothing recorded |
| **P4:** "paid" but amount 0 | **fail: $0 payment recorded** | pass: nothing recorded |
| P5: conversion table (USD, EUR, GBP, JPY, KRW, KWD, large amounts) and rounding | — (no helper) | pass |
| **P5:** ¥5,000 invoice → checkout amount and recorded payment | **fail: ¥500,000 sent, ¥50 recorded** | pass: ¥5,000 / ¥5,000 |
| **P5:** ¥1,000 refund from CoachOS; ¥1,000.50 rejected | **fail: refused ("more than ¥50")** | pass: sends 1000; .50 → clear 400 |
| **P5:** ¥2,000 refund made in Stripe Dashboard | **fail: recorded ¥20** | pass: ¥2,000 |
| **P5:** ¥1 rounding is not an "overpaid" alert | **fail: alert sent** | pass: no alert |
| **P6:** good key → checked with Stripe, account ID and name saved | **fail: never checked** | pass |
| **P6:** key Stripe rejects → not saved, old key kept | **fail: saved** | pass: 400 |
| **P6:** Stripe unreachable while saving → nothing saved | **fail: saved unchecked** | pass: 502 |
| **P6:** switch to another account → old webhook secret cleared + owner told | **fail: kept (payments silently unrecorded)** | pass |
| **P6:** switch test → live, same account → same | **fail: kept** | pass |
| **P6:** rolled key, same account → webhook secret kept | — | pass |
| **P6:** webhook secret must start with `whsec_` | **fail: anything accepted** | pass |
| **P6:** older connection gets its account filled in; page loads even if Stripe is down | **fail** | pass |
| P6: only the owner can change keys | pass | pass |
| **P7:** crash while recording a payment → ErrorLog + admin alert, 500 so Stripe retries | **fail: not logged** | pass |
| **P7:** wrong webhook secret, 3 deliveries → **one** ErrorLog row | **fail: not logged** | pass |
| **P7:** webhook with no secret saved → logged | **fail: not logged** | pass |
| **P7:** pay page can't reach Stripe → logged, without the pay link | **fail: not logged** | pass |
| Partial card payment → client receipt with balance due + owner "Payment Received" (owner only) | no email to anyone | pass |
| Final card payment → receipt "paid in full" + owner email "(fully paid)" | receipt only | pass |
| `PAYMENT_RECEIVED_EMAIL_ENABLED=False` → no owner email, receipt still sent | — | pass |
| Manual partial payment → client receipt | no receipt | pass |
| Wrong webhook secret ×3 → **one** owner email, one admin alert, banner; next good webhook clears it | admin only (P7) | pass |
| Saving a new webhook secret clears the banner | — | pass |
| Pay page can't reach Stripe → owner email naming the invoice + banner; next working click clears it | admin only | pass |
| Crash while recording → owner email | admin only | pass |
| A problem in one workspace never reaches another workspace's owner or banner | — | pass |

The race tests slow the Payment insert so both requests are inside the handler together. On the
old code they fail every run. Stripe is replaced by a small fake that keeps checkouts and
their status the way Stripe does. The notification rows' "Old code" column comes from reading
the old code, not from re-running these tests against it. Full backend suite: 154 passed, 1 failed. The failure is
`apps/clients/tests.py::test_scheduled_forecast_covers_pipeline_and_reminders`, unrelated and
pre-existing: it still expects the 1-hour session reminder removed in commit `2a389e9`.

### Still open (not fixed yet; see `design_auto_payment.md` §1.1)
| # | Bug | Risk |
|---|---|---|
| P9 | Disconnect deletes keys with no warning | Matters once auto-pay exists |
| P10 | Refund webhook relies on the charge carrying `invoice_id` metadata | Verify in Stripe test mode |
| P11 | `issue_refund` and the refund webhook save the whole invoice from a copy read earlier, without the lock | Low: a refund at the same moment as a new payment on a partially paid invoice could overwrite `amount_paid`. Same fix pattern as P2 |

---

## 5. Deploying the P1–P8 fixes and payment notifications

Changed files: `backend/apps/invoicing/models.py`, `public_views.py`, `views.py`, new `money.py`, new
`migrations/0014_payment_unique_stripe_payment_per_workspace.py` and
`0015_invoice_stripe_checkout_session_id.py`, new `tests.py`; `backend/tasks/email.py` and
`tasks/email_notices.py`, `tasks/email_html.py`, `tasks/email_starters.py` (Invoice Overpaid, Payment
Received and Stripe Payment Problem emails; receipt with balance); new
`apps/invoicing/stripe_problems.py`; `backend/config/settings/base.py`
(`PAYMENT_RECEIVED_EMAIL_ENABLED`, default on); `backend/apps/settings_app/views.py` (Stripe key
check, problems for the banner, email previews) and new `apps/settings_app/tests.py`;
`frontend/src/pages/coach/Settings.tsx` (Stripe account line, red problem banner, `?tab=` link,
messages, email descriptions). The **Celery worker must run the new code** (new email tasks).
`make deploy-safe` rebuilds it, and its health check fails if a worker runs old code.
No new settings or environment variables. Needs a backend **and** frontend rebuild.

**Before deploy (read-only).** The migration fails if prod already has duplicate Stripe
payments, so check first:
```bash
docker compose -f docker-compose.prod.yml exec backend python manage.py shell -c "
from django.db.models import Count
from apps.invoicing.models import Payment
d = list(Payment.objects.exclude(stripe_payment_id='').values('workspace_id','stripe_payment_id').annotate(n=Count('id')).filter(n__gt=1))
print('Stripe payments:', Payment.objects.exclude(stripe_payment_id='').count(), '| DUPLICATES:', d or 'none')"
```
Expected: `DUPLICATES: none`. If any are listed, stop. That invoice was already double-counted
and needs a manual correction (delete the extra Payment, fix `amount_paid`) before deploying.

**Impact.** Adds one unique index on `invoicing_payment` and one empty text column on
`invoicing_invoice` (both small tables, well under a second). No existing data is changed.
Payments keep working during and after deploy. Checkouts opened **before** the deploy aren't
known to CoachOS, so they can't be reused or expired. For those, the overpaid email is the
safety net, and they expire on their own 24 hours after opening (Stripe default).
P6 changes nothing for an existing Stripe connection: its key and webhook secret are kept, and
its account ID is filled in the first time the Stripe settings are opened.

**Stripe connections in prod (read-only, before and after):** shows each connected
workspace's mode, whether its account is recorded yet, and whether a webhook secret is saved:
```bash
docker compose -f docker-compose.prod.yml exec backend python manage.py shell -c "
from apps.accounts.models import Workspace
for w in Workspace.objects.all():
    s = (w.integrations or {}).get('stripe', {})
    if s.get('secret_key_encrypted'):
        print(w.slug, '| mode:', s.get('mode'), '| account:', s.get('account_id') or '(fills in on next Settings visit)', '| webhook secret:', bool(s.get('webhook_secret_encrypted')))"
```
A workspace with `webhook secret: False` has **never** had payments recorded automatically. Tell
its owner to finish Step 2 in Settings → Integrations → Stripe.

**After deploy.**
```bash
docker compose -f docker-compose.prod.yml exec backend python manage.py showmigrations invoicing | tail -2
docker compose -f docker-compose.prod.yml exec backend python manage.py shell -c "
from django.db import connection
c = connection.cursor(); c.execute(\"select indexname from pg_indexes where indexname='unique_stripe_payment_per_workspace'\")
print(c.fetchall() or 'MISSING')"
```
Expected: `[X] 0014_payment_unique_stripe_payment_per_workspace`,
`[X] 0015_invoice_stripe_checkout_session_id` and
`[('unique_stripe_payment_per_workspace',)]`. Postgres stores a conditional unique constraint as
a unique **index**, so look in `pg_indexes`, not `pg_constraint`.

**Rollback.** Revert the code first, then `python manage.py migrate invoicing 0013` removes the
column and the constraint.

**Manual check after deploy (test-mode workspace, see `design_auto_payment.md` §14):** open the pay
link in two tabs → both show the same Stripe checkout; pay in one → the other tab's "Pay" fails
at Stripe, and clicking the email link again shows "Payment received".
