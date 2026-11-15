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
| **F** | Activities page shows one month at a time |
| **G** | Session reminders: 24h only (1h switched off by a setting) |
| **H** | Client portal files: uploads, per-client permissions, share with coach, Library → Shared with you |
| **I** | Health check catches a Celery worker running old code |

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

---

# Part F — Activities page: one month at a time

- ‹ Month › navigation (default this month, "This month" to jump back); status tabs, type
  filter and search apply within the month. Uses the existing `start`/`end` API filter.
- Who sees what is unchanged and confirmed: owner — the whole workspace; coach — sessions
  they run; client portal — their own sessions.

## Tests
`test_activity_month_view.py` (1 test: month range + owner/coach scope).

---

# Part G — Session reminders: 24h only

- **Switch:** `SESSION_REMINDER_HOURS` in `config/settings/base.py`, default `[24]`, for
  every workspace. To bring 1h back: `SESSION_REMINDER_HOURS=24,1` in `backend/.env` and
  restart Celery — no code or DB change.
- `tasks/reminders.py` (email + SMS) and the email forecast use only the enabled lead times.
- UI: reminder descriptions say 24h only; the "1h Reminder" template is hidden in Settings;
  the 1-hour row in a session's notification status shows only for past sends.
- A session booked < 24h ahead gets the 24h reminder straight away (wording uses the real
  time left).

## Tests
`test_reminder_windows.py` (2 tests: 1h off; 1h back when re-enabled).

---

# Part H — Client portal files

## Client page → Portal Permissions (owner or the client's coach)
| Setting | Default |
|---|---|
| File upload | On |
| Maximum file size | 10 MB (1–100) |
| Maximum number of files | 5 (0–100) |
| Client can delete their uploads | Off |

## Client portal → Files
- **Upload** (count, size and type enforced server-side; executables blocked).
- Uploads are **private** until the client presses **Share with coach**; **Stop sharing**
  hides the file again.
- The client can **edit their own uploads** in the document editor; files the coach shared
  stay view-only (one Library file can be shared with many clients).
- Delete own uploads only when allowed.

## Coach side
- **Library → Shared with you → <client>** (sidebar): files clients shared. Owner sees every
  client's; a coach only their own clients'. **Library → All Files never lists client
  files.** Also listed on the **Client Files** page and on the client's Files tab.
- Owner and the client's coach can **edit a client's shared file live**; its sharing, file
  and "Save as PDF" are locked (server-side too).
- **Client Files tab** on the client page: the client's coach can now edit client files
  (Clients → edit) and the client's shared uploads (Library → edit), not only the owner.
- **Email "Client File Shared"** to the workspace owner and the client's coach when a client
  shares a file (editable in Settings → Emails).

## Workspace isolation
- Each upload is stored under `library/<workspace_id>/`, tied to the client's own
  workspace; the portal login of the same person in another workspace can't see, share,
  delete or count it, and that workspace's owner can't open it. A private upload can't be
  opened by anyone else, even by id.

## Migrations
`clients/0027` (four permission fields), `library/0005` (`uploaded_by_client`; also a
pending choices-only change to `visibility`, no SQL), `library/0006` (shared flag + date).

## Tests
`test_portal_uploads.py` (10 tests).

---

# Part I — Health check: Celery worker running old code

- **What happened (local):** the Celery worker had been started before the new
  file-share email task existed; it rejected each one as "unregistered task" and the email
  was dropped. Restarting the worker fixed it; the missed emails were re-sent.
- **Prevention:** `deploy_check` (run by `make health` and every `make deploy-safe`) now
  fails with "a Celery worker is running old code — restart celery (and celery-beat)" if
  any running worker is missing a task that exists in the code.
- `make deploy-safe` already restarts Celery when backend code changes; this catches a
  manual `git pull` + backend-only restart.

---

## Deploy
1. **Locally:** run the tests below and `cd frontend && npx tsc --noEmit`, then push.
2. **On EC2:** `make deploy-plan`, then `make deploy-safe`. It will list **6 migrations**
   and ask you to confirm an **RDS snapshot** first:
   `audit/0004`, `clients/0026`, `clients/0027`, `invoicing/0013`, `library/0005`, `library/0006`.
   All add tables/columns/an index; existing data is unchanged (new client permission
   fields get their defaults).
3. Nothing to add to `.env` — reminders default to 24h only.

## Tests (local, all passing)
```
docker compose exec -T api pytest -q test_portal_uploads.py test_tenant_isolation.py \
  test_client_affiliations.py test_client_list_sort.py test_client_url_fields.py \
  test_activity_validation.py test_activity_month_view.py test_invoice_due_upon_receipt.py \
  test_reminder_windows.py test_deploy_regression.py apps/portal/tests.py
```

## Post-deploy checks
1. `make health` → HEALTHY, including "workers know all … background tasks".
2. Client page → Portal Permissions → defaults shown; client portal → Files → upload, Share
   with coach → owner + coach emailed; file appears under Library → Shared with you.
3. Clients list → Status column shows client statuses; sort defaults to Recently viewed.
4. New Invoice → Monthly Subscription → "Upon receipt" → preview shows "Due: Upon Receipt".
