# Change Log — 2026-11-15

Work from 2026-11-11 to 2026-11-15, after the 2026-11-10 log. One commit per part, in this
order. **Nothing here is deployed yet** — see **Deploy** at the end (6 migrations).

| Part | Change |
|---|---|
| — | `sql.md`: troubleshooting queries for prod (RDS) and local |
| **A** | Save errors are readable and name the field; Website/LinkedIn accept `www.…`; LinkedIn is checked and clickable |
| **B** | Clients list: real Status column, "Recently viewed" sort, case-insensitive name sort, spacing |

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
