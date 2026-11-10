# CoachOS — Phase 2: multi-tenant hardening

Updated 2026-10-08. Companion to `CLAUDE.md`. Scope trimmed to what is **required to
keep every workspace's data isolated** — nice-to-haves (staging/CI, database-level RLS,
separate DB logins, Superadmin redesign, scale work) are out of scope for now.

**Design decision (locked):** one shared Postgres database on AWS RDS, one shared
schema, `workspace_id` on every customer-data row. Isolation is enforced in the
application layer and proven by `backend/test_tenant_isolation.py`.

---

## 1. Done (2026-10-08)

**Status column:** ✅ *pushed* = committed in `b53692f` and on `origin/main` · 🟡 *local* = in the working tree, not yet committed (ships with the next deploy).

| Fix | What it prevents | Where | Status |
|---|---|---|---|
| **DB-1** workspace-scoped links | Creating an invoice/deal/session (or any record) that points at another workspace's client, coach, deal, folder… — and reading that client's details back. Coaches also limited to their own clients. | `apps/accounts/tenancy.py` (new) + 8 serializers | ✅ pushed |
| **DB-2** no fallback workspace on login | A user with no workspace being silently attached to the oldest workspace (LMT Consulting). Now refused with 403. | `apps/accounts/views.py` | ✅ pushed |
| **DB-11** library file reference | Pointing a library item at another workspace's S3 file to get a download link. | `apps/library/serializers.py` | ✅ pushed |
| **DB-8 / DB-9** share lists & attachment check | Sharing library items with other workspaces' clients/users; cross-workspace S3 reference check. | `apps/library/serializers.py`, `apps/clients/views.py` | ✅ pushed |
| CSV import permission | Importing clients with only Clients *view*; now needs Clients *edit*. Import also verified to stay in the importer's workspace. | `apps/clients/views.py`, `pages/coach/Clients.tsx` | 🟡 local |
| Portal access owner-only | Coaches granting/revoking a client's portal login (or flipping it via a plain edit). | `apps/clients/views.py`, `apps/clients/serializers.py`, `pages/coach/ClientDetail.tsx` | 🟡 local |
| **DB-6** OnlyOffice endpoints | Anyone with a document id (or any valid OnlyOffice token) downloading or overwriting any workspace's document; forged/tampered saves; the server fetching arbitrary URLs (SSRF). Now: every file/callback URL carries a `doc` token bound to one document + purpose (file tokens expire after 2 h, callback tokens after 30 days); the save callback uses only the Document-Server-signed body and only downloads from our own OnlyOffice server; fail closed without `ONLYOFFICE_JWT_SECRET` in prod. Verified against the real local Document Server (PDF conversion) + `test_onlyoffice_security.py` (6 tests). | `apps/accounts/onlyoffice_auth.py` (new), `apps/library/views.py`, `apps/clients/views.py`, `apps/portal/views.py` | 🟡 local |
| **Invite role escalation** (found in code review 2026-10-15) | The invite API accepted **any** role (the UI only offers coach/assistant/limited), so any workspace owner could invite a **platform_admin** (sees every workspace — cross-tenant) or a second business owner. Now `INVITABLE_ROLES = coach/assistant/limited` in the serializer, and accept-invite refuses stored invitations with any other role. | `apps/accounts/serializers.py`, `apps/accounts/views.py` | 🟡 local |
| **Branding leak** (found in local test 2026-10-15) | `public-branding` returned the **oldest workspace's** name + logo to everyone, so every workspace's clients (portal login + sidebar) and every new business on the Register page saw another company's branding. Now: no workspace named → neutral CoachOS; `?workspace=<slug>` → that workspace only; portal sidebar uses `/api/portal/me`'s own-workspace logo; portal invite emails link to `/client-portal?ws=<slug>` (remembered in the browser). | `apps/settings_app/views.py`, `apps/portal/views.py`, `tasks/email.py`, `pages/portal/ClientPortal.tsx` | 🟡 local |
| **One owner per workspace** | A second `business_owner` in a workspace (found locally: an owner account with no workspace had been auto-attached to another workspace by the pre-fix DB-2 login fallback). DB constraint `one_business_owner_per_workspace` (partial unique index on `users.workspace_id` where role = business_owner) + `Workspace.owner_email`. Coaches/assistants/clients unaffected. | `apps/accounts/models.py`, migration `accounts/0022` | 🟡 local |
| Rate limits | Bypassing every per-IP limit (login, reset, portal code…) with a forged `X-Forwarded-For`. | `config/settings/base.py` (`NUM_PROXIES: 1`) | ✅ pushed |
| Isolation test suite | Regressions. 21 tests: cross-workspace read / update / delete / link, coach-vs-coach, portal client-vs-client, CSV import, tab permissions, owner-only portal, login, and a guard that fails if any new serializer adds an unscoped link field. Verified to **fail** with the fixes removed. | `backend/test_tenant_isolation.py` | ✅ pushed (14) · 🟡 local (+7 → 21, incl. one-owner, invite-escalation and branding tests; plus `test_onlyoffice_security.py` 7) |

**Other local UI change (2026-10-18, ships with the same deploy):** Register page
(`pages/auth/Register.tsx`, the business-owner sign-up reached from a registration invite)
now explains the steps — workspace name = your company/practice name (e.g. *Rass
Consulting*, *Bright Path LLC*), must be unique, shown on invoices/emails/portal; name and
email pre-filled from the invite; password ≥ 8 characters — and the left panel shows
neutral CoachOS branding (branding fix).

Verified in production (read-only): no user without a workspace exists, so DB-2 locks
nobody out. Prod data lives in RDS (`coachos-db`); the compose `db` container is unused.

**Backup status (2026-10-08): no manual backup has been taken.** `make backup` has never
been run against prod — and wouldn't help if it were, since it dumps the empty compose
`db` container, not RDS. The only copy of prod data today is RDS's automatic backup at
1-day retention. Must-do #1 (manual RDS snapshot) is therefore the first real backup.

---

**Deploy status (2026-11-02):** prod rebuilt with commit `030e4ad` (all §1 fixes, migrations
`0022`/`0023`, `check_tenant_integrity`, `delete_workspace`, Superadmin delete-workspace button).
Post-deploy `check_tenant_integrity` on prod: **CLEAN** (one owner per workspace, no
cross-workspace links). ⚠️ The Superadmin delete-workspace button is now live in prod without a
prod switch or cross-workspace check — see must-do below.

## 2. Must-do (in order) — updated 2026-10-15

**Rule: nothing goes to production until the local test run (§5A) passes and the
owner approves the deploy.** Claude has no EC2 access and does not deploy.

| # | Item | Who | Status |
|---|---|---|---|
| 1 | **Local test run** of everything in §1 — steps A.3–A.6 in §5A (A.1–A.2 ✅) | You, guided | 🔄 In progress |
| 2 | **Confirm what prod runs** — on EC2 `git log --oneline -1` (is `b53692f` deployed?) | You | ☐ |
| 2a | **⚠️ Prod one-owner check (§5 B.4) — must print nothing under 1.** Migration `0022` runs automatically when the backend starts; if any prod workspace has 2 owners it fails and **the backend won't start**. Fix duplicates first (decide per case: demote to coach or move to own workspace). | You (EC2, read-only) | ✅ 2026-10-15 — prod: no workspace with >1 owner, none with 0; only note: Superadmin `rassconsulting.co@gmail.com` (platform_admin, not an owner) is linked to workspace *Temp* and predates it — harmless, optional cleanup later |
| 2c | **Prod branding check** (read-only, from any browser/terminal): `curl https://coachos.rass-consulting.com/api/settings/public-branding/` shows which company's name/logo every portal client and new registrant sees today — expected to become neutral "CoachOS" after deploy | You | ☐ |
| 2b | **Prod escalation check** (§5 B.5): list all platform admins and any invitation ever sent as business_owner/platform_admin — expect only `rassconsulting.co@gmail.com` and no such invitations | You (EC2, read-only) | ☐ |
| 2d | **Prod cross-workspace integrity scan** (every link checked: does a row point at a record in another workspace?) | You (EC2, read-only) | ✅ 2026-10-18 — only 2 rows: Superadmin replies (`Temp` workspace user) on LMT's feedback tickets — by design. No cross-workspace sessions/invoices/notes/files/clients. |
| 3 | **Commit the 🟡 local changes** (DB-6, CSV import needs edit, owner-only portal, +9 tests, docs) — only after #1 passes | You | ☐ |
| 4 | **Deploy to prod** per §5 B → C → D — only with owner approval; RDS snapshot ✅ taken (take a fresh one if data changed since) | You (EC2) | ⏸ Waiting on #1–#3 |
| 5 | **RDS settings:** backup retention 1 → 14 days, deletion protection on, confirm encryption | You (AWS console) | ☐ |
| 6 | **Tab-permission gaps** (same workspace — owner's ticks must hold): client notes/goals/files/availability follow the Clients ticks; Library *folders* follow the Library ticks; invoice service catalog follows the Invoices ticks. *Decision needed: does deleting a note/goal/file need the Delete or the Edit tick?* | Code (after decision) | ☐ |
| 7 | Remove or repoint `make backup` (it dumps the empty compose `db` container, not RDS) | Code | ☐ |
| 8 | Back up `FIELD_ENCRYPTION_KEY` + `SECRET_KEY` (+ `ONLYOFFICE_JWT_SECRET`) outside the server — no effect on the running app; only matters if the EC2 host is lost | You | ⏸ Deferred |

---

## 2c. Code review of local changes (2026-10-15)

| Finding | Verdict | Action |
|---|---|---|
| Invite API accepts any role → owner can create a platform admin / second owner | **Confirmed, critical** | ✅ Fixed (see §1 "Invite role escalation") + tests |
| Migration `0022` fails if prod already has 2 owners in a workspace | Valid risk | ✅ Gated: prod check run 2026-10-15 — no duplicates |
| OnlyOffice callback token expired after 3 days → late saves lost | Confirmed | ✅ Callback tokens now 30 days |
| File tokens in browsers stay valid 3 days after access is revoked | Confirmed (minor) | ✅ File tokens now 2 hours |
| DEBUG/no-secret callback path turned form data into lists | Confirmed (dev only) | ✅ Fixed |
| Saves refused if the Document Server reports a URL not on `ONLYOFFICE_SERVER_URL`/`INTERNAL_URL` | By design (blocks SSRF) | Kept; refusals are logged — verify a save right after deploy (§5 D) |
| Callback doesn't compare the signed body's document `key` | Low risk | Not done: the URL token already binds the item, only the Document Server can sign bodies, and the key changes after a force-save (would drop the final save) |
| Platform admin can't invite/revoke portal access | Intended | Owner-only by decision |
| OnlyOffice save logic duplicated in library + client files | Maintainability | Later refactor |

---

 (keeps multi-tenancy intact)

1. **Every new customer-data model** gets `workspace = ForeignKey(Workspace)` (non-null).
2. **Every queryset** starts from `request.user.workspace` — never `Model.objects.all()` /
   `.get(pk=…)` without a workspace filter. Non-owners are narrowed further (coach → own
   clients), matching `clients.views._client_qs`.
3. **Every ModelSerializer with a writable link field** mixes in
   `WorkspaceScopedSerializerMixin` (the guard test enforces this).
4. **Never take a workspace id from the request body** — always from the logged-in user
   (or the portal token's `workspace_id`/`client_id` claims).
5. **S3 keys** are always `<area>/<workspace_id>/…`; never accept a client-supplied key
   outside the user's own prefix.
6. **Public / token links and webhooks** resolve the object from the signed token or URL,
   then act only on that object's workspace.
8. **Run `python manage.py check_tenant_integrity` before and after every deploy**
   (read-only; exit code 1 if any workspace has ≠1 owner or any row links to another
   workspace's data). Prod: `docker compose -f docker-compose.prod.yml exec -T backend python manage.py check_tenant_integrity`.
7. **Run before every push:** `docker compose exec api pytest test_tenant_isolation.py -q`
   (locally — never on the prod container, it would create a test DB on RDS). Add a test
   to it for any new endpoint that reads or writes customer data.

---

## 4. Who may see what (access model)

| Login | Sees | Never sees |
|---|---|---|
| Business owner | Everything in own workspace; grants portal access | Any other workspace |
| Coach | Own clients and their notes/goals/sessions/invoices/deals, per tab ticks | Other coaches' clients, other workspaces; can't grant portal access |
| Assistant / Limited | Per tab ticks, within own workspace | Other workspaces |
| Client (portal) | Own goals, shared notes, own sessions/invoices, shared materials | Other clients, coach-only notes, other workspaces |
| Superadmin (platform admin) | Operations: workspaces, users/roles, errors, audit logs | *Intended:* client details, notes, invoices — today's Superadmin screens still show some (on hold) |

---

## 5. Deployment runbook (test locally first, then prod)

> **Superseded for the next deploy (2026-10-18):** that release also carries migrations
> `accounts.0022`/`0023` and more changes. Use the checklist in
> **`change_log_2026-10-18.md`** (Pre-deploy → Deploy → Post-deploy → Rollback) and the
> scripts `ops/predeploy_check_2026-10-18.py` / `ops/postdeploy_check_2026-10-18.py`.
> The steps below remain a generic reference.

Applies to the §1 fixes. Backend + frontend change, **no database migration**.

### A. Test locally

**Progress (local run started 2026-10-12)** — test workspace: *Rass consulting*
(owner `artikamb@gmail.com`, coach `sanvibhat@gmail.com` with 1 client, 1 portal
client, 2 Office documents).

| Step | What | Result |
|---|---|---|
| A.1 | Local stack up (frontend, API, OnlyOffice all 200) | ✅ 2026-10-12 |
| A.2 | 23 security tests pass · full suite 51 passed + known smoke-email failure · `tsc` clean | ✅ 2026-10-12 |
| A.3a | Owner: all main screens load | ✅ 2026-10-15 (both "owners" saw the same data because they were in the same workspace → led to the one-owner fix) |
| A.3a+ | Local cleanup: `artikamb@gmail.com` moved out of *Rass consulting* into its own **Arti Test Workspace** (sole owner); her 7 sent invitations reassigned to Shreya. Every local workspace now has exactly one owner. Re-test: Arti and Shreya now see **different** data | ☐ |
| A.3b | Owner: create client, session, invoice, deal | ☐ |
| A.3c | Owner: Invite to Portal visible and works | ☐ |
| A.3d | Owner: Import CSV (2 rows) | ☐ |
| A.3e | Owner: OnlyOffice edit + save + reopen; Convert to PDF (library + client file) | ☐ |
| A.4a | Coach: only own clients; no Invite to Portal | ☐ |
| A.4b | Coach with Clients Edit unticked: no Import CSV / add client | ☐ |
| A.5 | Client portal: own data only; shared document previews | ☐ |
| A.6 | `/login` and `/client-portal` new design | ☐ |

1. **Stack up to date:** `docker compose up -d --build` (frontend `:5173`, API `:8000`,
   OnlyOffice `:8082`).
2. **Automated tests** — all must pass except the known pre-existing
   (the old `test_smoke_e2e.py` goal-share failure is fixed in `conftest.py`, 2026-10-18 — full suite 63/63):
   ```bash
   docker compose exec api pytest test_tenant_isolation.py test_onlyoffice_security.py -q   # 28 tests
   docker compose exec api pytest -q                                                       # full suite
   (cd frontend && npx tsc --noEmit)
   ```
3. **Click-through as a business owner** (`http://localhost:5173/login`):
   - Clients, Calendar, Invoices, Pipeline, Library, Reports all load.
   - Create a client, a session, an invoice and a deal for that client — all succeed.
   - Client detail shows **Invite to Portal / Revoke Portal**; invite works.
   - Clients → **Import CSV** a 2-row file (`first_name,last_name,email_1`) — imported.
   - Library: open an Office document in **edit** mode, change a word, close, reopen —
     change kept. Run **Convert to PDF** — a PDF item appears. Same for a client File.
4. **Click-through as a coach** (create one under Team if needed; give it a client):
   - Sees only their own clients; no **Invite to Portal** button.
   - Team → Permissions: untick Clients **Edit** for the coach → as the coach, the
     **Import CSV** and add-client actions are gone; re-tick to restore.
5. **Client portal** (`http://localhost:5173/client-portal`, client with portal access):
   - Sees own goals / notes / sessions / invoices only; shared library document
     previews in the viewer.
6. **Login pages:** `/login` and `/client-portal` show the new design.

### B. Pre-deploy checks (prod, read-only)
1. **RDS manual snapshot:** AWS console → RDS → Snapshots → *Take snapshot*,
   `coachos-db`, e.g. `pre-deploy-YYYY-MM-DD` → wait for *Available*.
2. **No user without a workspace** (DB-2 would refuse their login) — expect `[]`:
   ```bash
   cd ~/platformCoachOs
   docker compose -f docker-compose.prod.yml exec -T backend python manage.py shell -c "from apps.accounts.models import User; print(list(User.objects.filter(workspace__isnull=True).exclude(role='platform_admin').values_list('email','role')))"
   ```
   ✅ checked 2026-10-08: `[]`.
3. **OnlyOffice secret present and identical in backend + document server** (DB-6 fails
   closed without it) — the two fingerprints must match:
   ```bash
   grep -c '^ONLYOFFICE_JWT_SECRET=.' backend/.env        # expect 1  (✅ 2026-10-08)
   echo "backend:    $(docker compose -f docker-compose.prod.yml exec -T backend printenv ONLYOFFICE_JWT_SECRET | tr -d '\r' | sha256sum | cut -c1-12)"
   echo "onlyoffice: $(docker compose -f docker-compose.prod.yml exec -T onlyoffice printenv JWT_SECRET | tr -d '\r' | sha256sum | cut -c1-12)"
   ```
4. **One owner per workspace** (gate for migration `0022` — see §2 #2a). Save as
   `owner_check.py` on EC2 and run; section 1 **must be empty**:
   ```python
   from django.db.models import Count, Q, F
   from apps.accounts.models import User, Workspace
   owners = Workspace.objects.annotate(n=Count("users", filter=Q(users__role="business_owner")))
   print("1. Workspaces with MORE than one owner:")
   for w in owners.filter(n__gt=1):
       print("   ", w.name, "|", w.slug, "|", list(w.users.filter(role="business_owner").values_list("email", flat=True)))
   print("2. Workspaces with NO owner:")
   for w in owners.filter(n=0):
       print("   ", w.name, "|", w.slug)
   print("3. Users who joined BEFORE their workspace existed:")
   for u in User.objects.filter(workspace__isnull=False, date_joined__lt=F("workspace__created_at")):
       print("   ", u.email, "|", u.role, "|", u.workspace.name)
   print("done")
   ```
   ```bash
   docker compose -f docker-compose.prod.yml exec -T backend python manage.py shell < owner_check.py
   ```
5. **Invite-escalation check** (was the hole ever used?) — save as `escalation_check.py`:
   ```python
   from apps.accounts.models import User, WorkspaceInvitation
   print("1. All platform admins (should be only CoachOS staff):")
   for u in User.objects.filter(role="platform_admin"):
       print("   ", u.email, "|", u.workspace.name if u.workspace else "-", "| joined", u.date_joined.date())
   print("2. Invitations ever sent with role business_owner / platform_admin:")
   for i in WorkspaceInvitation.objects.filter(role__in=["business_owner", "platform_admin"]):
       print("   ", i.email, "|", i.role, "| workspace", i.workspace.name, "| accepted", i.accepted, "|", i.created_at.date())
   print("done")
   ```
   `docker compose -f docker-compose.prod.yml exec -T backend python manage.py shell < escalation_check.py`
6. Pick a quiet time — **nobody editing a document** (editors opened before the deploy
   can't save afterwards; reopening fixes it).

### C. Deploy
1. **From your Mac** (after local tests pass):
   ```bash
   cd ~/Desktop/CoachOs/coachos
   git status                      # review the file list
   git add -A backend/ frontend/src/ ops/ PHASE2.md CLAUDE.md change_log_2026-10-18.md change_log_2026-10-08_part2.md
   git commit -m "Tenant isolation follow-ups: OnlyOffice doc tokens (DB-6), CSV import needs edit, portal access owner-only"
   git push origin main
   ```
2. **On EC2:**
   ```bash
   cd ~/platformCoachOs
   git log --oneline -1            # note the CURRENT commit (rollback target)
   git pull
   make deploy-backend
   docker compose -f docker-compose.prod.yml build frontend
   docker compose -f docker-compose.prod.yml up -d --force-recreate frontend
   docker compose -f docker-compose.prod.yml ps   # backend healthy, celery up
   ```

After the deploy, run the integrity check — must end with `CLEAN`:
```bash
docker compose -f docker-compose.prod.yml exec -T backend python manage.py check_tenant_integrity
```

### D. Smoke test in prod
- **LMT owner:** Clients, Calendar, Invoices, Pipeline, Library load; create a session
  or invoice for an existing client; **Invite to Portal** visible.
- **A coach:** only their own clients; no Invite to Portal; no Import CSV if Clients
  Edit is off.
- **OnlyOffice:** open a library document in edit mode, change a word, close, reopen —
  change kept; **Convert to PDF** works; a client's shared document previews in the portal.
  If a save didn't stick:
  `docker compose -f docker-compose.prod.yml logs backend --since 10m | grep "OnlyOffice save refused"`
  (means `ONLYOFFICE_SERVER_URL` doesn't match the address the Document Server reports).
- **Logged out:** `/login` and `/client-portal` show the new design.

### E. Rollback
No data or schema changes, so rollback is code-only:
```bash
cd ~/platformCoachOs
git checkout <commit noted in C.2>
make deploy-backend
docker compose -f docker-compose.prod.yml build frontend
docker compose -f docker-compose.prod.yml up -d --force-recreate frontend
```
then `git checkout main` once the fix is pushed. The RDS snapshot (B.1) is only a
precaution.
