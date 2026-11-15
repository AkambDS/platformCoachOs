# Change Log — 2026-11-15

Work from 2026-11-11 to 2026-11-15, after the 2026-11-10 log. One commit per part, in this
order. **Nothing here is deployed yet** — see **Deploy** at the end (6 migrations).

| Part | Change |
|---|---|
| — | `sql.md`: troubleshooting queries for prod (RDS) and local |
| **A** | Save errors are readable and name the field; Website/LinkedIn accept `www.…`; LinkedIn is checked and clickable |
| **B** | Clients list: real Status column, "Recently viewed" sort, case-insensitive name sort, spacing |
| **C** | Affiliations move from sessions to clients |
| **D** | Session status: one "Mark as" menu (Confirmed/Late/Completed/Missed/Rescheduled) |
| **E** | Monthly subscription invoices: "Due upon receipt" option |

---

# sql.md — troubleshooting queries

- New `sql.md` at the repo root: read-only queries for pgAdmin (prod through the SSH
  tunnel, or local) — workspaces (active/suspended, size, team, invitations), clients per
  workspace, finding a client, portal-login troubleshooting, ErrorLog, EmailLog, failed
  Celery tasks, sessions with bad times, audit trail.
- Starts with `SET default_transaction_read_only = on;` for prod. All queries run clean
  against the local schema.

---

# Part A — Readable save errors; Website / LinkedIn

## What was wrong
- **Hidden errors:** toasts sat at bottom-right, underneath the floating Feedback "+"
  button (higher z-index), and vanished after 3 s. "Enter a valid URL." also never said
  which field.
- **LinkedIn without `https://`** (`www.linkedin.com/in/…`) failed: Django's URLField
  needs a scheme.

## Fix
- **Toasts:** top-centre, above modals; errors are red, stay 10 s, have a ×, wrap long text
  (`components/ui/index.tsx`, `index.css`). Applies to every page.
- **Error text:** new `lib/apiError.ts` turns a DRF error into "LinkedIn: Enter a valid
  URL." (field named); a raw HTML 500 page becomes "Server error — please try again".
  Used on the client edit form and New Client.
- **Website / LinkedIn:** `https://` is added when missing
  (`ClientDetailSerializer.to_internal_value`).
- **LinkedIn must be a LinkedIn profile:** any `*.linkedin.com` host (typo `ww.`, `uk.`) is
  saved as `https://www.linkedin.com/<path>`; other domains, misspellings (`linkdin.com`)
  and a bare `linkedin.com` are rejected with a clear message. An unchanged stored value is
  left alone, so old data never blocks other edits.
- **Clickable:** Website and LinkedIn on the client Overview open in a new tab (http/https
  only).

## Tests
`test_client_url_fields.py` (3 tests).

---

# Part B — Clients list

## What was wrong
- The **Status** column showed the pipeline deal stage, not the client status ("—" for
  clients without a deal).
- **Name sort put capitals first** (local Postgres sorts byte-wise:
  "Bhatlapanumarti, Tanzoe, bhatlap").
- Columns spread unevenly; "View →" sat far from ✕.

## Fix
- **Status** (client status, coloured) and **Pipeline** (deal stage) are separate columns.
- **Sorting:** case-insensitive first/last name (`Lower()`), and a new default
  **"Recently viewed"**: clients this user opened or worked on most recently first (from
  AccessLog), then the rest by last name; archived clients still last. Per user.
- Opening a client logs **"Viewed Client"** in the audit trail (at most once per user per
  client every 10 minutes).
- Fixed widths for the narrow columns.
- **Migration `audit/0004`:** the new action label + an index for the sort.

## Tests
`test_client_list_sort.py` (2 tests).

---

# Part C — Affiliations belong to clients, not sessions

## Change
- **Client page:** new **Affiliations** field (pick several from Settings → Affiliation,
  owner-managed), shown on Overview with colour dots. Not in the client list.
- **Removed from sessions:** Affiliation column + filter on the Activities page, and the
  dropdown on every schedule/edit session form (Calendar, client page). Values already saved
  on sessions stay in the database, unused.
- **Workspace-scoped:** a client can't be given another workspace's affiliation (the
  existing scoped-field mixin covers many-to-many fields).
- `check_tenant_integrity` now also checks **many-to-many links** (it only checked single
  links before). Verified it reports a deliberately bad link.
- Settings → Affiliation wording updated; the delete message no longer claims sessions keep
  the label (they never did).
- **Migration `clients/0026`:** new client ↔ affiliation link table.

## Tests
`test_client_affiliations.py` (2 tests).

---

# Part D — Session status: one "Mark as" menu

## Change
- Calendar and Activities session pop-ups: **Mark as ▾** (Confirmed, Late, Completed,
  Missed, Rescheduled — same colours and wording as the Calendar legend) replaces "Mark
  Missed" (Calendar) and the Complete/Late/Reschedule/Missed buttons (Activities).
  Cancel keeps its own button (it emails the client and frees the slot).
- Shown on any non-cancelled session, so a wrong Completed/Missed can be undone.
- **Server rules** (`ActivitySerializer.validate`): Completed/Missed only once the session
  has started; a cancelled session can't be revived. No email is sent on a status change;
  each change is in the session's edit history.

## Tests
`test_activity_validation.py::test_mark_as_status_rules`.

---

# Part E — Invoices: "Due upon receipt" for monthly subscriptions

## Change
- New Invoice → Monthly Subscription: **Due date** radio — "On billing date (…)" or
  "Upon receipt".
- Shown as "Due: Upon Receipt" in the PDF preview, the invoice page / Download PDF, and the
  client portal; the email reads "payment due on receipt".
- New field `Invoice.due_upon_receipt`; the billing date stays in `due_date`, because the
  monthly scheduler counts the next send date from it (an empty due date would make the
  series re-send). Generated monthly invoices inherit the choice. Editable after sending.
- **Migration `invoicing/0013`.**

## Tests
`test_invoice_due_upon_receipt.py` (2 tests).
