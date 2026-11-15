# Change Log — 2026-11-15

Work from 2026-11-11 to 2026-11-15, after the 2026-11-10 log. One commit per part, in this
order. **Nothing here is deployed yet** — see **Deploy** at the end (6 migrations).

| Part | Change |
|---|---|
| — | `sql.md`: troubleshooting queries for prod (RDS) and local |

---

# sql.md — troubleshooting queries

- New `sql.md` at the repo root: read-only queries for pgAdmin (prod through the SSH
  tunnel, or local) — workspaces (active/suspended, size, team, invitations), clients per
  workspace, finding a client, portal-login troubleshooting, ErrorLog, EmailLog, failed
  Celery tasks, sessions with bad times, audit trail.
- Starts with `SET default_transaction_read_only = on;` for prod. All queries run clean
  against the local schema.
