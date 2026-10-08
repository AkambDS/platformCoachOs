# CoachOS — Phase 2 enhancements: multi-workspace readiness (planned)

Written 2026-10-08. Companion to `CLAUDE.md` (requirements/design summary) and
`system_design.md`. Section references like §3/§6/§7 point to `CLAUDE.md`.

**Goal:** be safe to onboard 2–3 more paying workspaces within ~1 month
(target ~2026-11-08). Today there is exactly one real workspace, so several
shortcuts that are fine now (shared Zoom account, master DB login, deploying
straight to prod) become real risks the day workspace #2 signs up.

**Guiding requirement — Superadmin access.** We maintain the product, so the
platform admin must keep cross-workspace visibility *for operations*: error
logs, audit logs, workspace list/health, plan/suspend. That access is
designed in explicitly below (a separate, audited "platform" path) — it must
**not** come from the app holding a database master key, which is what
silently disables tenant isolation today.

## 1. Current state (verified 2026-10-08) — why tenant isolation is app-code-only

Postgres row-level security (RLS) policies exist (`apps/accounts/apps.py`,
12 tables) but are **inert in practice, for three independent reasons** — all
three must be fixed together, fixing one alone either changes nothing or
blanks every coach screen:

1. **App connects as a role RLS doesn't apply to.** Locally Django connects as
   `coachos`, the `POSTGRES_USER` the postgres image creates → `SUPERUSER` +
   `BYPASSRLS`, which skips RLS even with `FORCE`. In prod (RDS) it connects as
   `coachos_admin` — not superuser, no `BYPASSRLS` — but that role **owns** the
   tables and none are `FORCE`d, so Postgres exempts it all the same (§1a, DB-3).
2. **Workspace never set for coach requests.** `WorkspaceTenantMiddleware`
   (`config/middleware.py`) only reads `Authorization: Bearer …`, but the coach
   SPA authenticates via the httpOnly `access_token` cookie
   (`CookieJWTAuthentication`), so `app.workspace_id` is never set for any
   coach/owner request. (Portal requests do send a Bearer header.)
3. **Setting expires immediately.** `set_config(..., TRUE)` is
   transaction-local; Django runs in autocommit and `ATOMIC_REQUESTS` is off,
   so the value is gone before the view's first query.
4. Coverage gap: policies cover **12 of 34** tables with a `workspace_id`
   column, and are applied as DDL in `AppConfig.ready()` on every startup
   rather than in a migration.

Net effect: isolation depends entirely on every queryset filtering by
workspace. One missed `.filter(workspace=…)` in a future feature = a
cross-customer data leak, with nothing in the database to stop it.

## 1a. Tenant-isolation audit (2026-10-08) — findings

Audited every view/serializer/query path for the six login types: business
owner, coach, assistant/limited, client portal, Superadmin portal (platform
admin), Django admin (`is_superuser`). Verified against code + a throwaway
pytest probe (test DB only — no real data touched).

**Data model — OK, locked as the design.** One shared Postgres DB, shared
schema, `workspace_id` on every tenant row. 34 tables carry `workspace_id`
(NOT NULL on all customer-data tables); per-workspace uniqueness is already
correct (`(workspace_id, number)` on invoices, `(workspace_id, name/label/slug)`
on every taxonomy). **Separate DB-per-workspace is not recommended** — it
multiplies migrations/backups/connections and breaks cross-workspace
Superadmin views; reserve it for a future enterprise contract that requires it.

**Read scoping — OK.** Every list/detail queryset filters by
`request.user.workspace`, and non-owners are narrowed further
(`_client_qs`: coach/assistant → own clients only; activities → `coach=user`;
invoices/deals → `client__coach=user`; feedback → own tickets). Portal queries
all filter by **both** `client_id` and `workspace_id` from the portal JWT, and
coach-only data (unshared notes, paused goals) is excluded. Reports and
settings are workspace-filtered.

**Issues found**
| ID | Severity | Issue | Where |
|---|---|---|---|
| DB-1 ✅ | **Critical** | **Cross-workspace writes via foreign keys.** Writable FK fields (`client`, `coach`, `deal`, `affiliation`) use DRF's default `PrimaryKeyRelatedField(queryset=<Model>.objects.all())` — no workspace check. Probe confirmed: workspace B created an **invoice, deal, and activity** against workspace A's client (all 201), and the invoice response returned A's client name/email/phone. Same gap lets a coach attach another coach's client inside one workspace. | `invoicing/serializers.py` (`InvoiceDetailSerializer` `fields="__all__"`), `pipeline/serializers.py` (`DealSerializer`), `activities/serializers.py` (`ActivitySerializer`); check every other ModelSerializer exposing an FK |
| DB-2 ✅ | **Critical** | **Login auto-attaches workspace-less users to the oldest workspace.** If a non-platform-admin user has `workspace_id=NULL`, login sets `user.workspace = Workspace.objects.first()` — i.e. LMT Consulting in prod — and issues a token for it. | `accounts/views.py` ~L98-110 (login view) |
| DB-3 | High | **RLS is not enforced in prod (confirmed on RDS 2026-10-08).** App connects as `coachos_admin` (`rolsuper=f`, `rolbypassrls=f`) but that role **owns the tables**, and the 12 RLS tables all have `relforcerowsecurity=f` → Postgres skips RLS for the owner. Plus the code bugs in §1 (cookie not read, transaction-local setting). Only 12 of 34 tenant tables have policies at all. | `config/middleware.py`, `apps/accounts/apps.py`, RDS |
| DB-4 | High | **Superadmin portal sees client PII + financials**, contrary to the requirement (troubleshooting only — never session notes, invoices, client details). Exposes client names/emails on activities, invoice list with client names and amounts, email-log recipients/subjects, and platform-wide revenue sum. | `superadmin/views.py`: `workspace_activity`, `workspace_invoices`, `workspace_email_diagnostics`, `dashboard` |
| DB-5 | High | **Django admin (`/django-admin/`) shows everything** to any `is_superuser`/`is_staff`: Client, Assessment, ClientGoal, Invoice, Payment, Activity, Deal, Library items — full client details and notes. | `apps/*/admin.py` |
| DB-6 | Medium | **OnlyOffice file/callback endpoints aren't bound to a workspace or document.** `AllowAny` + OnlyOffice JWT; lookup is `KnowledgeItem.objects.get(pk=pk)` / `Assessment.objects.get(pk, client_id)` with no workspace. If `ONLYOFFICE_JWT_SECRET` is unset, anyone with a UUID can download or overwrite a file; if set, any valid editor token works for any document. | `library/views.py` ~L337/L424, `clients/views.py` ~L920/L950 |
| DB-7 | Medium | `invoicing_invoiceitem` has no `workspace_id` (only via parent invoice) — blocks a simple RLS policy. | `invoicing/models.py` |
| DB-8 ✅ | Low | Library `shared_client_ids` / `shared_user_ids` accept any UUIDs (not validated against the workspace). Not a leak today (portal filters by workspace) but dirty data. | `library/serializers.py` |
| DB-9 ✅ | Low | `remove_attachment` checks `Assessment.objects.filter(file_s3_key=…)` across all workspaces. | `clients/views.py` ~L1116 |
| DB-11 ✅ | High | Library item `s3_key` was writable by the client — an item could be pointed at another workspace's file (`library/<other ws>/…`) and return a presigned download URL for it. | `library/serializers.py` |
| DB-10 | Info | `users.email` is globally unique → one person can't belong to two workspaces. Matches "a user belongs to exactly one workspace" (§3 of CLAUDE.md) — confirm as product decision. | `accounts/models.py` |

### Access model to enforce (target)
| Login | Sees | Never sees |
|---|---|---|
| Business owner | Everything in own workspace | Any other workspace |
| Coach | Own clients + their notes/goals/sessions/invoices/deals; tab perms may extend | Other coaches' clients (unless owner grants), other workspaces |
| Assistant / Limited | Per `TabPermission`, within own workspace | Other workspaces |
| Client (portal) | Own goals, shared notes, own sessions/invoices, shared materials | Other clients, coach-only notes, anything outside own workspace |
| Superadmin portal (platform admin) | Workspaces, users/roles, plan/status, ErrorLog, AccessLog/AuditLog, per-workspace **counts**, email delivery status (no recipient/subject), own platform invoicing | Session notes, client names/emails/phones, client invoices/amounts, assessments, files |
| Postgres superuser / Django `is_superuser` | Break-glass DBA only, manual, logged | Not used by any app code path |

### DB TODO — in order
**Step 0 — before any change (today)**
- [x] Find the real prod DB: **AWS RDS** (`coachos-db…rds.amazonaws.com/coachos`). The `db` container in `docker-compose.prod.yml` is unused/empty — earlier "prod" checks against it were meaningless.
- [x] RDS automated backups checked 2026-10-08: **enabled, but retention = 1 day** (PITR available, backup window 03:43–04:13 UTC). Maintenance window Oct 13 01:51–02:21 EDT; auto minor upgrade on; pending: engine patch 18.3.R2 + OS update (brief DB restart in that window).
- [ ] Raise backup retention to **7–14 days**; enable **deletion protection**; confirm storage encryption (Configuration tab — can't be turned on in place if off).
- [ ] Take a **manual RDS snapshot** before every deploy that touches the backend/schema (manual snapshots don't expire).
- [ ] Fix or remove `make backup` (it dumps the empty container, not RDS); remove the unused `db` service from `docker-compose.prod.yml` once nothing references it.
- [x] Re-ran role/RLS checks against RDS: app user `coachos_admin` (not superuser, no BYPASSRLS) **owns all tables**; 12 tables RLS-enabled, none FORCEd. Workspaces: **LMT Consulting (57 clients) = only real customer data**; RassConsulting = our own Superadmin/audit workspace; Temp, CoachOS Demo, Shreya LLC = test/demo.
- [ ] Mark test/demo workspaces (`Workspace.is_test` flag) so Superadmin stats and future checks can exclude them.

**Step 1 — code fixes, ship before the 2 new owners start (low risk, no schema change)**
- [x] **DB-1** — done 2026-10-08 (see "Done log" below).
- [x] **DB-2** — done 2026-10-08.
- [x] **DB-8 / DB-9** — done 2026-10-08.
- [x] **DB-11** (found while fixing DB-1: library item `s3_key` was client-writable → could point an item at another workspace's file and get a download link) — done 2026-10-08.
- [x] **Isolation test suite** — `backend/test_tenant_isolation.py`, 14 tests, all passing; also verified they **fail** with the fixes reverted.
- [ ] **DB-6:** OnlyOffice endpoints — require `ONLYOFFICE_JWT_SECRET` in prod (fail closed if missing), and verify the token's document key/URL matches the requested item. *Next.*
- [ ] Run `test_tenant_isolation.py` in CI on every PR once CI exists (P2-4); until then run it before every deploy.
- [ ] Pre-existing, unrelated: `test_smoke_e2e.py` fails at the goal-share email (`mail.outbox` empty — task runs via Celery, not eagerly in tests). Fix with `CELERY_TASK_ALWAYS_EAGER=True` in a test settings module (§7 gap).

### Done log — tenant isolation, 2026-10-08
| Item | What changed | Files |
|---|---|---|
| DB-1 | New `WorkspaceScopedPrimaryKeyRelatedField` + `WorkspaceScopedSerializerMixin`: every writable FK resolves only within the requester's workspace, and for non-owners only to rows they can already read (Client → own; Deal/ClientGoal → own clients'; Activity → own). Fails closed if the serializer has no request/workspace. Applied to all 8 serializers with writable FKs (13 fields: Activity client/coach/deal/affiliation; Client coach; Commitment activity; GoalProgress goal; Invoice client/coach; Folder parent; KnowledgeItem folder; Deal client/coach). A guard test fails if any future ModelSerializer adds an unscoped writable FK. | `apps/accounts/tenancy.py` (new), `apps/{activities,clients,invoicing,library,pipeline}/serializers.py` |
| DB-2 | Login no longer attaches a workspace-less user to `Workspace.objects.first()` (= LMT Consulting in prod). Such a login now gets 403 with no cookies and a warning log. Platform admins unaffected. | `apps/accounts/views.py` (`LoginView`) |
| DB-8 | Library `shared_client_ids` / `shared_user_ids` keep only valid ids of this workspace's clients/users (foreign, stale, or malformed ids are dropped, not rejected). | `apps/library/serializers.py` |
| DB-9 | `remove_attachment`'s "is this S3 file still referenced?" check is scoped to the workspace. | `apps/clients/views.py` |
| DB-11 | Library item `s3_key` must start with `library/<own workspace id>/`. | `apps/library/serializers.py` |
| Hardening | Per-IP throttles took the client IP from the whole `X-Forwarded-For` header, which the client controls — a forged header dodged every per-IP limit (login, portal code, demo lead…). DRF now uses only the hop nginx appended (`NUM_PROXIES = 1`). Demo-lead capture also rejects first names over 100 chars. | `config/settings/base.py`, `apps/superadmin/views.py` |
| Tests | `test_tenant_isolation.py`: cross-workspace detail/list reads (owner + coach), update/delete, cross-linking on create and reassign, library share lists, coach-vs-coach inside a workspace, portal client-vs-client and cross-workspace, workspace-less login refused, normal login + normal create still work, guard over all serializers. | `backend/test_tenant_isolation.py` (new) |

**Behaviour change to know:** a coach/assistant can now only pick **their own clients** when creating an invoice, deal, or session (matches what they could already see in lists). Owners are unaffected. If a coach legitimately needs to act on another coach's client, the owner reassigns the client or does it themselves.

**Deploy:** backend-only, no migration. Before deploying, check no real user lacks a workspace (they'd now be refused at login instead of silently joining LMT):
```sql
select email, role from users where workspace_id is null and role <> 'platform_admin';
```

**Step 2 — Superadmin & admin lockdown (low risk) — on hold by decision 2026-10-08; tenant data isolation first**
- [ ] **DB-4:** redact Superadmin responses: activities/invoices/email diagnostics return ids, status, timestamps, delivery result — no client name/email/phone, invoice amounts, or email subject; dashboard shows counts, not revenue. Keep ErrorLog/AuditLog/AccessLog/user-role views.
- [ ] **DB-5:** unregister client-data models (Client, Assessment, ClientGoal, ClientNote, Invoice, Payment, Activity, Deal, Library) from Django admin, or make them read-only metadata views; keep Workspace/User/AuditLog.
- [ ] Log every Superadmin request to `AccessLog` (who, which workspace, endpoint).
- [ ] Build the Superadmin "Usage (last 7 days)" + errors view per §1b (SA-1, SA-2, SA-5, SA-6).

**Step 3 — database enforcement (after go-live, on staging first)** — see P2-2/P2-3 below
- [ ] **DB-7:** add + backfill `workspace_id` on `invoicing_invoiceitem`.
- [ ] Roles (note: **`coachos_admin` already exists in RDS** — it's today's app login and table owner): keep `coachos_admin` as the **owner/migrations-only** role; create `coachos_app` (runtime web requests, NOBYPASSRLS, not owner), `coachos_platform` (Superadmin portal + cross-workspace Celery scans; reads platform tables + aggregates only), `coachos_readonly` (backups/reporting). Switch the app's `DATABASE_URL` to `coachos_app`; `migrate` uses `coachos_admin`.
- [ ] Fix middleware (read cookie, set inside request transaction); RLS + FORCE + WITH CHECK on every tenant table via migration; `tenant_context()` for Celery/webhooks/public links; Superadmin on `coachos_admin` alias.
- [ ] Prod cutover with backup; rollback = switch `DATABASE_URL` back.

## 1b. Superadmin portal — requirements & design

**Who:** platform admins in the RassConsulting workspace (`role=platform_admin`).
**Purpose:** operate the product — never to read customers' coaching data.

**Must see**
1. **Errors per workspace** — ErrorLog list (time, source web/celery, error
   type, endpoint, user name/role, traceback) + error count per day for the
   last 7 days. Scrub client PII from stored messages (mask emails/phones on
   write) so tracebacks stay safe to show.
2. **1-week usage summary per workspace (high level)** — counts only:
   - Logins per day and active users (owner / coaches / assistants) — needs a
     new `logged_in` event (AccessLog action, written on successful login; no
     client data). Today only a single `last_login` timestamp exists.
   - "Last active" per user.
   - Feature usage counts for the last 7 days, derived from existing
     `created_at`/`updated_at` columns (no new tracking): clients added,
     sessions scheduled/completed, notes written, goals created/updated, deals
     moved stage, invoices created/sent/paid (**counts, not amounts**), library
     uploads, emails sent, portal logins by clients.
   - Top actions from AccessLog grouped by action type (counts).
   - Workspace health flags: Google Calendar disconnected, Stripe not
     configured, failed emails count, overdue-invoice **count**.
3. Workspace list: name, plan, status (active/suspended), created, owner
   name/email, user count, client **count**, `is_test` flag (filter test/demo
   out by default).

**Must never see** — client names/emails/phones, session notes, goals text,
assessments/files, invoice line items or amounts, email subjects/recipients
to clients, platform-wide revenue sums of customers' invoices.

**Current gaps vs this design**
| ID | Today | Change |
|---|---|---|
| SA-1 | Audit tab = last 20 AccessLog rows incl. `client_name` + `metadata` | Replace with the 7-day aggregate above; drop `client_name`/`metadata` from Superadmin responses |
| SA-2 | No login history | Write `logged_in` AccessLog event on login (coach side + portal side, separate actions) |
| SA-3 | Activities, invoices, email diagnostics endpoints return client names/emails, amounts, subjects | Return ids/status/timestamps/delivery result only (DB-4) |
| SA-4 | Dashboard sums customers' invoice revenue | Remove; show counts |
| SA-5 | Errors: last 10 only, messages may contain PII | Paginate 7 days + per-day counts; mask PII at write time in `error_logging.py` |
| SA-6 | No test/demo flag | `Workspace.is_test`; exclude from stats by default |
| SA-7 | Superadmin reads via the app's DB login | After Step 3, Superadmin queries run on `coachos_platform` (aggregates + platform tables); every Superadmin request logged to AccessLog |

## 2. TODO list (in recommended order)

| # | Item | Priority | Must be done before workspace #2? |
|---|---|---|---|
| P2-1 | Automated off-host backups + restore drill | High | **Yes** |
| P2-2 | Separate DB roles (retire the master login) | High | **Yes** |
| P2-3 | Enforce row-level security end-to-end | High | **Yes** |
| P2-4 | Staging environment + CI/CD + one-command rollback | High | **Yes** |
| P2-5 | Multi-tenant DB design hardening (scale) | Medium | Partly (indexes/constraints yes; managed DB can follow) |
| P2-6 | Per-workspace integrations (Zoom OAuth, Google verification) | High | **Yes** for Zoom |
| P2-7 | Observability: errors outside DRF, alerts, uptime | Medium | Recommended |
| P2-8 | Workspace onboarding/offboarding tooling | Medium | Recommended |
| P2-9 | Cleanup of §7 low-severity items | Low | No |

Dependencies: P2-2 → P2-3 (RLS needs the non-superuser role). P2-4 should
land early so P2-2/P2-3 themselves ship through staging. P2-5's managed-DB
step unlocks true server failover in P2-4.

---

### P2-1 — Backups + restore drill (prod is on RDS — mostly configuration)
**Design**
- Celery beat (or host cron) job: nightly `pg_dump -Fc` → upload to a
  dedicated, versioned S3 bucket (`coachos-backups`), server-side encrypted,
  lifecycle rule: 30 daily + 12 monthly. Separate IAM user with put-only.
- Back up `FIELD_ENCRYPTION_KEY` / `SECRET_KEY` separately (password manager or
  AWS Secrets Manager) — a DB backup without the Fernet key can't decrypt
  saved Stripe/Zoom keys (§6).
- Automatic pre-deploy dump (hooked into the deploy command, see P2-4).
- Monthly restore drill: restore latest dump into staging and run the smoke
  test — proves backups actually work.
- Write down targets: RPO ≤ 24h (≤ 5 min once on managed Postgres with PITR),
  RTO ≤ 2h.
**Benefit:** losing the EC2 host or a bad migration no longer means losing
customer data; every deploy has a known-good restore point.

### P2-2 — Separate database roles (fix the "master account")
**Design** — four roles, created by a one-off SQL script / migration:
| Role | Attributes | Used by |
|---|---|---|
| `coachos_owner` | owns schema/tables, NOLOGIN for app | migrations only (`MIGRATE_DATABASE_URL`) |
| `coachos_app` | `NOSUPERUSER NOBYPASSRLS`, SELECT/INSERT/UPDATE/DELETE only | all normal web requests (`DATABASE_URL`) |
| `coachos_platform` | `BYPASSRLS`, read-mostly | Superadmin views, cross-workspace Celery scans, webhook/token lookups — via a second Django DB alias `platform` |
| `coachos_backup` | read-only | backup job |
- Django: add `DATABASES["platform"]`; a small helper
  `platform_db()` / `.using("platform")` used only in an allow-listed set of
  modules (`apps/superadmin`, Celery schedulers, webhook resolvers). A test
  greps that `.using("platform")` never appears elsewhere.
- `migrate` runs with the owner URL in the deploy step; the app container
  never holds owner/superuser credentials.
- Keep `REVOKE DELETE ON audit_log FROM coachos_app` (append-only audit).
**Benefit:** the app can no longer bypass isolation even by accident; a
compromised app container can't drop tables or rewrite audit history;
Superadmin keeps its cross-workspace view through a narrow, auditable door.

### P2-3 — Enforce row-level security end-to-end
**Design**
1. **Set the workspace inside the request transaction.** Replace the
   header-only middleware with one that resolves the workspace *after*
   authentication (cookie or Bearer — reuse `CookieJWTAuthentication`) and
   wraps the request: `with transaction.atomic(): set_config('app.workspace_id', …, true); response = get_response(request)`
   (or `ATOMIC_REQUESTS=True` + set it from the auth class). Same for
   `app.client_id` on portal requests.
2. **Policies on every workspace table**, generated in a migration from model
   metadata (every model with a `workspace` FK), not ad-hoc in
   `AppConfig.ready()`. `ENABLE` + `FORCE ROW LEVEL SECURITY`.
   Policy: `USING (workspace_id = current_setting('app.workspace_id', true)::uuid)`
   plus a matching `WITH CHECK` so writes can't target another workspace.
   Missing setting → NULL → **zero rows (fail closed)**.
3. **Child tables without a direct `workspace_id`** (e.g. notes, progress
   rows hanging off a client): either add a denormalized `workspace_id`
   (preferred — simple, indexable) or a policy that joins to the parent.
4. **Portal:** keep the extra `client_id` condition on every table the portal
   reads (goals, notes, activities, invoices, materials), not just
   `clients_clientgoal`.
5. **Non-request code gets an explicit tenant context:**
   `with tenant_context(workspace_id): …` helper (sets the config inside an
   atomic block).
   - Celery: every task takes `workspace_id` and runs inside `tenant_context`.
     Periodic "scan all workspaces" jobs (reminders, stall alerts, invite
     retry, subscription invoices) list workspace ids via the `platform`
     alias, then process each one inside `tenant_context`.
   - Webhooks: Stripe URL already carries `workspace_id`; Google Calendar
     webhook resolves channel → workspace via `platform`, then
     `tenant_context`.
   - Public token links (pay / contract / session): resolve token →
     workspace via `platform`, then `tenant_context`.
6. **Superadmin (operations visibility):** reads `ErrorLog`, `AccessLog`,
   `Workspace`, `User`, `DemoLead`, and per-workspace aggregate counts through
   the `platform` alias. It does **not** read client records/notes by default;
   if support ever needs to look inside a workspace, that's an explicit
   "support access" action that is itself written to `AccessLog`
   (who/when/which workspace/why).
7. **Tests (gate in CI):** for every RLS table, create rows in workspace A
   and B, set context to A via `coachos_app`, assert B's rows are invisible
   and inserts into B fail. Plus "no context → zero rows".
8. Rollout: ship to staging with policies in permissive/logging mode first,
   run the full smoke test + a click-through, then enforce; deploy to prod
   with a pre-deploy backup and a ready rollback (P2-4).
**Benefit:** two independent locks — app filters *and* the database — so a
single coding mistake can no longer leak one customer's clients, notes, or
invoices to another. A strong, provable answer to customer security
questionnaires.

### P2-4 — Staging, CI/CD, rollback, and live server switch
**Design**
- **Environments:** `staging` on its own small EC2 + own Postgres/Redis/S3
  bucket at `stage.coachos.rass-consulting.com`, using Stripe *test* keys,
  a Resend test domain, and the same `docker-compose.prod.yml` (env-specific
  `.env`). Never shares a DB or keys with prod.
- **CI (GitHub Actions) on every PR:** backend `pytest` (test settings with
  `CELERY_TASK_ALWAYS_EAGER=True` — fixes the "tests use the live broker"
  gap), `makemigrations --check`, `tsc --noEmit`, `npm run build`, RLS
  isolation tests (P2-3). Merge to `main` blocked unless green.
- **Build once, promote the same artifact:** CI builds `backend` and
  `frontend` images, tags them with the git SHA, pushes to a registry (GHCR
  or ECR). Compose files reference `image: …:${APP_TAG}` instead of building
  on the server — EC2 stops running `npm`/`pip` builds.
- **Pipeline:** merge to `main` → auto-deploy that SHA to staging → run
  smoke test → manual "Promote to prod" approval → prod pulls the *same* tag.
  `make deploy TAG=<sha>` does: pre-deploy DB dump (P2-1) → `migrate` (owner
  role) → `up -d` → health check (`config/urls.py` `health_check`) → record
  the tag in `deploys.log`.
- **Rollback:** `make rollback` re-deploys the previous tag from
  `deploys.log` (seconds, no rebuild); last ~10 tags retained in the
  registry. Covers frontend too since the frontend image is versioned.
- **Migrations must be backward-compatible ("expand → contract"):** add
  columns/tables first, deploy code that uses them, remove old ones in a
  later release. This is what makes code rollback safe without a DB restore.
- **Live server switch (blue/green):** two app stacks (`blue`, `green`) on
  the host behind nginx; deploy to the idle colour, health-check it, flip
  the nginx upstream with a reload (zero downtime), keep the old colour
  running for instant switch-back. Moving to a second EC2 behind an ALB
  later is the same pattern across hosts — but requires the DB off the app
  host first (P2-5).
- Optional: feature flags (Workspace-level or env) for risky features so
  they can be switched off without a deploy.
**Benefit:** every change is tested in a prod-like staging before customers
see it; deploys become repeatable and fast; any bad release is undone in
seconds; deploys stop causing downtime.

### P2-5 — Multi-tenant database design for scale
**Design**
- **Keep the shared-database, shared-schema model** (`workspace_id` on every
  row + RLS). Right choice for tens-to-hundreds of small workspaces;
  schema-per-tenant or DB-per-tenant multiplies migrations, backups, and
  connections for no benefit at this size.
- **Schema hygiene:** `workspace_id NOT NULL` on every tenant table; composite
  indexes leading with `workspace_id` on hot lists (clients, activities by
  date, invoices by status, deals by stage); uniqueness scoped per workspace
  (e.g. `(workspace_id, email)`, `(workspace_id, invoice_number)`) instead of
  global; FKs between tenant tables can't cross workspaces (enforced by RLS
  `WITH CHECK` + serializer validation).
- **Managed Postgres (AWS RDS) — already in place in prod** (verified 2026-10-08); remaining: confirm backup retention/PITR, consider Multi-AZ. Gives automated
  backups with point-in-time recovery, Multi-AZ standby, independent of the
  app server — the prerequisite for real failover in P2-4.
- **Connection pooling:** PgBouncer in *transaction* mode (compatible with
  `set_config(..., true)` inside the request transaction from P2-3).
- **Files:** S3 keys prefixed `workspaces/<workspace_id>/…` so a workspace's
  files can be listed, exported, or deleted as a unit.
- **Noisy-neighbour limits:** per-workspace plan limits (clients, storage,
  emails/SMS per day) and per-workspace API throttle scope.
**Benefit:** queries stay fast as data grows; workspaces can't trip over each
other's unique values or resources; the DB survives a server loss.

### P2-6 — Per-workspace integrations
**Design**
- **Zoom:** fix the OAuth "Invalid redirect" issue, set
  `ZOOM_OAUTH_ENABLED=True`, delete the shared Server-to-Server path and its
  env vars. **Blocker for workspace #2** — otherwise a new customer's
  meetings are created under our Zoom account.
- **Google Calendar:** complete Google's verification for the Calendar
  scope so refresh tokens stop expiring every 7 days.
- Stripe is already per-workspace (BYOK) — no change.
**Benefit:** each customer's meetings and calendars belong to their own
accounts; no weekly silent disconnects.

### P2-7 — Observability
**Design:** capture unhandled exceptions from non-DRF views (public pay /
contract / session links, allauth) into `ErrorLog` via a Django
`got_request_exception` handler or middleware (or adopt Sentry for all three:
web, Celery, frontend); external uptime check on `/` and the health
endpoint; alert (email/Slack) on ErrorLog spikes or failed backups/deploys.
**Benefit:** we hear about failures — especially on client-facing payment
pages — before the customer tells us; Superadmin error view becomes complete.

### P2-8 — Workspace onboarding / offboarding
**Design:** a Superadmin "Create workspace" flow (seed defaults via the
existing `_seed_*` helpers in `apps/settings_app/views.py`), plan/limits
assignment, a per-workspace data export (ZIP of CSVs + S3 files), and a
verified delete (DB rows + `workspaces/<id>/` S3 prefix), all audit-logged.
**Benefit:** onboarding a customer takes minutes and is consistent; we can
honour export/deletion requests.

### P2-9 — Cleanup (from §7 / gap review)
Redirect or delete the `/portal` stub route; build the portal assessment
endpoint or drop `Assessment.visible_to_client`; set or remove the unused
`Activity.Status.LATE`; remove `dj-stripe` and its `/api/stripe/` route until
platform billing is automated; update §3 (Zoom is currently a shared S2S
account, not BYOK, while `ZOOM_OAUTH_ENABLED=False`).

## 3. Suggested 4-week plan
| Week | Work |
|---|---|
| 1 | P2-1 backups to S3 + restore drill; P2-4 CI + registry + staging EC2 |
| 2 | P2-4 tagged deploys + rollback + blue/green; P2-2 DB roles on staging |
| 3 | P2-3 RLS end-to-end on staging (middleware, policies migration, tenant_context for Celery/webhooks, platform alias for Superadmin, isolation tests) |
| 4 | P2-3 to prod behind backup + rollback; P2-6 Zoom OAuth; P2-5 indexes/constraints; P2-7 non-DRF error capture. Onboard workspace #2 only after P2-1–P2-4 + Zoom are done |
