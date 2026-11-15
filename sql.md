# CoachOS — troubleshooting SQL

Handy read-only queries for the prod database (AWS RDS) or local Docker Postgres.

**Connect**
- Prod: SSH tunnel through EC2 → pgAdmin `localhost:5433`, database **`coachos`**
  (not `postgres` — empty; not `rdsadmin` — AWS-internal, always refuses).
- Local: pgAdmin `localhost:5432`, db `coachos`, user `coachos` / `coachos_dev_secret`.

**Before anything on prod, make the session read-only** (any write is then refused):
```sql
SET default_transaction_read_only = on;
```
Prod is live customer data (LMT). Take an RDS snapshot before any manual write.
Times are stored in UTC.

Table names: `workspaces`, `users`, `clients_client`, `activities_activity`,
`invoicing_invoice`, `clients_emaillog`, `error_log`, `audit_accesslog`,
`workspace_invitations`, `portal_logincode`, `django_celery_results_taskresult`.

---

## 1. Workspaces

### 1a. How many workspaces — active vs not
```sql
SELECT
  COUNT(*)                                            AS total,
  COUNT(*) FILTER (WHERE is_active)                   AS active,
  COUNT(*) FILTER (WHERE NOT is_active)               AS suspended,
  COUNT(*) FILTER (WHERE pending_activation)          AS pending_activation
FROM workspaces;
```

### 1b. Every workspace with its size
```sql
SELECT w.name, w.slug, w.plan, w.is_active, w.pending_activation, w.owner_email,
       w.created_at::date AS created,
       (SELECT COUNT(*) FROM users u          WHERE u.workspace_id = w.id) AS users,
       (SELECT COUNT(*) FROM clients_client c WHERE c.workspace_id = w.id) AS clients,
       (SELECT COUNT(*) FROM activities_activity a WHERE a.workspace_id = w.id) AS sessions,
       (SELECT COUNT(*) FROM invoicing_invoice i   WHERE i.workspace_id = w.id) AS invoices
FROM workspaces w
ORDER BY w.created_at;
```

### 1c. Team members per workspace (who can log in, with which role)
```sql
SELECT w.name AS workspace, u.full_name, u.email, u.role, u.is_active,
       u.last_login, u.date_joined::date AS joined
FROM users u
LEFT JOIN workspaces w ON w.id = u.workspace_id
ORDER BY w.name NULLS FIRST, u.role, u.email;
```
Rows with an empty workspace are platform admins (or orphans — worth a look).

### 1d. Pending team invitations
```sql
SELECT w.name AS workspace, i.email, i.role, i.email_sent, i.accepted,
       i.created_at, i.expires_at, (i.expires_at < now()) AS expired
FROM workspace_invitations i
JOIN workspaces w ON w.id = i.workspace_id
WHERE NOT i.accepted
ORDER BY i.created_at DESC;
```

---

## 2. Clients

### 2a. Client count per workspace
```sql
SELECT w.name AS workspace, w.slug,
       COUNT(c.id)                                   AS clients,
       COUNT(c.id) FILTER (WHERE c.active_flag)      AS active_clients,
       COUNT(c.id) FILTER (WHERE c.portal_access)    AS with_portal_access
FROM workspaces w
LEFT JOIN clients_client c ON c.workspace_id = w.id
GROUP BY w.id
ORDER BY clients DESC;
```

### 2b. Every client, grouped by workspace
```sql
SELECT w.name AS workspace, c.first_name, c.last_name, c.email, c.status,
       c.active_flag, c.portal_access, coach.email AS coach, c.created_at::date AS created
FROM clients_client c
JOIN workspaces w      ON w.id = c.workspace_id
LEFT JOIN users coach  ON coach.id = c.coach_id
ORDER BY w.name, c.last_name, c.first_name;
```
Add `WHERE w.slug = 'lmt-consulting'` (use the slug from 1b) for one workspace.

### 2c. Find one client by email (and which workspace they're in)
```sql
SELECT w.name AS workspace, w.slug, c.id, c.first_name, c.last_name, c.email,
       c.status, c.active_flag, c.portal_access
FROM clients_client c
JOIN workspaces w ON w.id = c.workspace_id
WHERE lower(c.email) = lower('someone@example.com');
```
Same email in two workspaces = two separate clients (by design).

### 2d. Client portal login troubleshooting ("can't log in" / "no code email")
```sql
-- Has the client got portal access?  (2c above)
-- Were login codes generated, and used?
SELECT c.email, lc.created_at, lc.expires_at, lc.attempts, lc.consumed_at
FROM portal_logincode lc
JOIN clients_client c ON c.id = lc.client_id
WHERE lower(c.email) = lower('someone@example.com')
ORDER BY lc.created_at DESC
LIMIT 10;
```
- No rows at all → the request never reached the code step (no portal access,
  wrong workspace in the `?ws=` link, or a 500 — check §3a).
- Codes created but no email → check §3c (EmailLog) and §3d (Celery).
- `attempts` high, `consumed_at` empty → wrong/expired code typed.

---

## 3. Errors

### 3a. Recent app errors (500s captured from /api/)
```sql
SELECT e.created_at, e.severity, e.error_type, e.endpoint,
       left(e.message, 200) AS message, w.name AS workspace, u.email AS user_email
FROM error_log e
LEFT JOIN workspaces w ON w.id = e.workspace_id
LEFT JOIN users u      ON u.id = e.user_id
ORDER BY e.created_at DESC
LIMIT 50;
```
Full traceback for one row: `SELECT traceback FROM error_log WHERE id = <id>;`
Not captured here: non-`/api/` pages (pay/contract/sign links, `/accounts/…`) — use
`docker compose -f docker-compose.prod.yml logs backend` on EC2 for those.

### 3b. Which errors keep happening (last 7 days)
```sql
SELECT error_type, endpoint, COUNT(*) AS times, MAX(created_at) AS last_seen,
       left(MIN(message), 150) AS sample
FROM error_log
WHERE created_at > now() - interval '7 days'
GROUP BY error_type, endpoint
ORDER BY times DESC;
```

### 3c. Emails — failed or recent (portal invites, codes, confirmations, reminders)
```sql
SELECT e.sent_at, e.status, e.category, e.use_case, e.recipient_email,
       left(e.subject, 80) AS subject, left(e.error, 200) AS error, w.name AS workspace
FROM clients_emaillog e
LEFT JOIN workspaces w ON w.id = e.workspace_id
WHERE e.sent_at > now() - interval '2 days'      -- or: WHERE e.status <> 'sent'
ORDER BY e.sent_at DESC
LIMIT 100;
```
`status = sent` here only means our side handed it off — if the client still didn't
get it, check spam and the Resend dashboard.

### 3d. Background jobs (Celery) that failed
```sql
SELECT date_done, task_name, status, left(result, 200) AS result, worker
FROM django_celery_results_taskresult
WHERE status <> 'SUCCESS'
ORDER BY date_done DESC
LIMIT 50;
```
If this is empty but emails/reminders still aren't going out, the job may never have
been queued — check `make health` and `make logs-celery` on EC2.

### 3e. Sessions with suspicious times (the 2026-11-10 end-before-start crash)
```sql
SELECT w.name AS workspace, a.id, a.title, a.start_at, a.end_at, a.status
FROM activities_activity a
JOIN workspaces w ON w.id = a.workspace_id
WHERE a.end_at < a.start_at
   OR a.end_at - a.start_at > interval '12 hours';
```

### 3f. Who did what (audit trail, last 100)
```sql
SELECT l.created_at, w.name AS workspace, l.user_name, l.action, l.client_name, l.metadata
FROM audit_accesslog l
LEFT JOIN workspaces w ON w.id = l.workspace_id
ORDER BY l.created_at DESC
LIMIT 100;
```
