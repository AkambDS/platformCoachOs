# Change Log — 2026-10-18 (consolidated)

**One file for everything since `294a415`** ("tour desc changed"). It replaces
`change_log_2026-10-08_part2.md`, whose content is merged here as **Part A**; that file
stays in git history at `b53692f`.

| Part | What | Git state |
|---|---|---|
| **A** | 2026-10-08 part 2: tenant isolation (DB-1/2/8/9/11), rate-limit fix, login and portal redesign, docs | committed `2af6854` + `b53692f`. **Possibly already live**; check with P0 below |
| **B** | 2026-10-08 follow-ups: CSV import permission, owner-only portal access, OnlyOffice lock (DB-6) | uncommitted |
| **C** | 2026-10-15…18: invite tracking, workspace delete, register page, one-owner constraint, branding fix, invitable roles, tools | uncommitted |
| **D** | Test-suite fixes (test code only) | uncommitted |

Migrations: **`accounts.0022`, `accounts.0023`** (both in Part C). Part A has none.

**Prod checklist in one place:** [Pre-deploy](#pre-deploy-checklist-prod-read-only) →
[Deploy](#deploy) → [Post-deploy](#post-deploy-checks-no-lmt-login-needed) →
[Rollback](#rollback). It's built so that **nobody has to log in to LMT**: LMT is verified
from data (row counts, errors, its own live activity), and features are tested in a
throwaway workspace.

---

# Part A — 2026-10-08 part 2 (committed)

## A1. Tenant isolation: data never crosses workspaces

**Why:** a code audit for the "basic multi-tenant rule" found two critical bugs and
three smaller gaps. Read access was already correctly scoped (every list/detail queryset
filters by workspace, and coaches only see their own clients). The holes were in
**writes** and **login**. The full audit is in `PHASE2.md`.

**DB-1 (critical): cross-workspace links through foreign keys.**
- **Bug:** writable FK fields (`client`, `coach`, `deal`, `affiliation`, …) used DRF's
  default `PrimaryKeyRelatedField(queryset=Model.objects.all())`, which looks across
  every workspace. Workspace B could create an invoice, deal or session against
  workspace A's client (all returned 201), and the invoice response returned A's client
  name and email. Inside one workspace, a coach could do the same with another coach's
  client.
- **Fix:** `backend/apps/accounts/tenancy.py`.
  - `WorkspaceScopedPrimaryKeyRelatedField` resolves an FK only within the requester's
    workspace. For non-owners it narrows further, to rows they can already read
    (Client: `coach=user`; Deal and ClientGoal: `client__coach=user`; Activity:
    `coach=user`).
  - It fails closed: with no request, user or workspace in the context, nothing resolves.
  - `WorkspaceScopedSerializerMixin` covers 13 fields on 8 serializers: Activity,
    ClientDetail, Commitment, GoalProgress, InvoiceDetail, Folder, KnowledgeItem, Deal.

**DB-2 (critical): login attached workspace-less users to the oldest workspace** (LMT
in prod). Such a login now returns **403** with no cookies set, and a warning is logged.
Platform admins are unaffected. A prod check returned `[]`, so no real user is affected.
File: `apps/accounts/views.py`.

**DB-11: library item could point at another workspace's file.** `validate_s3_key`
only accepts `library/<own workspace id>/…`.

**DB-8 / DB-9:**
- **DB-8:** library `shared_client_ids`/`shared_user_ids` keep only valid ids of this
  workspace (others are dropped, not rejected).
- **DB-9:** `remove_attachment`'s "file still referenced?" check is now workspace-scoped.

**Behaviour change:** coaches and assistants can pick **only their own clients** when
creating an invoice, deal or session (matching their lists). Owners are unaffected.

**Tests:** `backend/test_tenant_isolation.py`. It covers cross-workspace reads, updates,
deletes and linking, library share lists, coach vs coach, positive controls, the portal,
login, and a guard that fails if a serializer ever adds an unscoped writable FK. With the
fixes removed, 6 tests fail.

## A2. Rate limiting and demo-lead hardening
- **Every per-IP rate limit could be bypassed** (login, password reset, register, demo
  lead, portal code). `NUM_PROXIES` was unset, so a forged `X-Forwarded-For` gave each
  request a fresh bucket. Now `"NUM_PROXIES": 1` (`config/settings/base.py`). **It
  becomes `2` if Cloudflare or a load balancer is ever added.**
- The demo-lead form returned a 500 on a first name over 100 chars; it now returns 400.

## A3. Login and client-portal login redesign
- **Coach `/login`** (`Login.tsx`, `index.css`): an editorial left column (headline
  "Your coaching practice, *elevated*", 01–05 feature list), the sign-in card on the
  right, a new `.auth-ombre` background, and a breathing gold North Star. It stacks below
  900px. Register, Forgot Password and Accept Invite keep the navy panel.
- **`NorthStarFlow.tsx`:** dot chains flow from the corner through the bullets into the
  card; they never cross text, are hidden on mobile, and draw a still frame under
  reduced motion.
- **Portal `/client-portal`:** same background, plus `GoldenThreadFlow.tsx` (eight
  left-edge curves merging into a gold line that runs to the card's star).
- Checked in headless Chrome at desktop and 390px. Not watched by hand over a full
  animation cycle.

## A4. Docs and planning
- **`PHASE2.md`:** the multi-workspace readiness plan (why DB row-level security is
  inert, the tenant audit, the must-do list).
- **`CLAUDE.md`:** prod data lives in **AWS RDS**; the `db` container is empty, so
  **`make backup` dumps the wrong database**. §10 points to `PHASE2.md`.
- **RDS findings:** automated backup **retention is 1 day**. Raise it to 7–14 days and
  enable deletion protection.
- `docs/CoachOS_Architecture_and_Design.pdf` and its source.

---

# Part B — 2026-10-08 follow-ups (uncommitted)

## B1. CSV import needs Clients *edit*
It used to create clients with only *view* rights, bypassing the owner's Team →
Permissions settings. It now requires `require_tab("clients", "edit")`, same as the New
Client form, and the Import CSV button is hidden without it. Imports stay in the
importer's workspace. Files: `apps/clients/views.py`, `pages/coach/Clients.tsx`.

## B2. Client-portal access is owner-only
Invite/revoke portal access requires `IsBusinessOwner`. `portal_access` is read-only in
`ClientDetailSerializer`, so there's no back door through a plain edit, and the button
shows for owners only. Files: `apps/clients/views.py`, `apps/clients/serializers.py`,
`pages/coach/ClientDetail.tsx`.

## B3. DB-6: OnlyOffice document endpoints locked to one document
- **Was:** the file and save-callback endpoints (`AllowAny`, called by the Document
  Server) accepted *any* valid OnlyOffice token for *any* document, in any workspace.
  They skipped verification entirely when `ONLYOFFICE_JWT_SECRET` was empty, and the
  callback downloaded whatever `url` the unsigned body named (overwrite + SSRF).
- **Now** (`apps/accounts/onlyoffice_auth.py`, used by library, client files and the
  portal preview):
  - Every file/callback URL carries a `?doc=` token bound to one document and one
    purpose. File tokens expire after **2 hours**, save-callback tokens after **30 days**.
  - The callback requires that token **and** a Document-Server-signed body, uses only
    the signed values, and downloads only from `ONLYOFFICE_SERVER_URL`/`_INTERNAL_URL`.
  - **Without `ONLYOFFICE_JWT_SECRET` everything is refused** (except in `DEBUG`).
- Verified against the real local Document Server: no token → 403, another document's
  token → 403, own token → 200, PDF conversion → 201. `test_onlyoffice_security.py`
  covers it.
- **Deploy notes:** pre-check gate 3 and P4. Editors open during the deploy can't save
  afterwards.

---

# Part C — 2026-10-15…18 (uncommitted)

## C1. Workspace Invites: email tracking, Send again, Delete (Superadmin)
**Why:** two invites (Shreya, Cynthia) "didn't arrive", and finding out took EC2 commands
plus a manual Resend search. The old send was fire-and-forget: failures went only to the
container log (prod logging drops INFO, so a *successful* send left no trace), and
expired links couldn't be re-sent.

**Now:**
- **Invite email column:** Sent / Delivered / Opened / Bounced / Marked spam / Delayed /
  Failed (hover for the error), with the time sent and "sent N×". Older links show
  *Not tracked*.
- **Send again** on unused rows. An expired link is extended by 7 days first.
- **Delete** on every row. It removes only the invite record; a registered workspace is
  untouched.
- A failed send when creating a link now shows a red message.
- **Reply-To** = the admin who sent it.
- **Tracking:** the invite is sent through Resend's API (same account, key, sender and
  content), which returns a message id. When the tab opens, non-final rows are checked
  with Resend: at most once a minute per row, for 14 days, with a 4-second timeout.
  Without a Resend key it falls back to SMTP and stays at *Sent*.
- **Scope:** only this one email. Team invites and all client emails are unchanged.

Files: `apps/superadmin/registration_invite.py` (new), `apps/superadmin/views.py`,
`apps/superadmin/urls.py`, `apps/accounts/models.py`, migration **`0023`**,
`pages/superadmin/AdminDashboard.tsx`, `api/client.ts`.

## C2. Delete a workspace (Admin Console)
**Why:** suspending only blocks login. The users still exist, and `users.email` is
globally unique, so a suspended workspace's owner can't be re-invited.

**Now:** Workspaces → View → **Danger Zone** → Delete Workspace. You type the slug to
confirm, and the dialog shows what will be deleted. Safeguards, enforced on the server:
- **Must be suspended first** (so LMT, which is active, can't be deleted by a misclick).
- The demo workspace and any workspace holding a **platform-admin** account (e.g.
  "Temp") can't be deleted.
- **No collateral damage:** every row in the delete plan is checked. If anything in
  another workspace would be deleted or changed, nothing is deleted and the API returns
  409 listing the rows. This reuses `delete_with_checks()` from the local command.
- It runs in one transaction (payments, then invoices first, because they're `PROTECT`).
- An AuditLog record (`delete_workspace`, `workspace=NULL`) survives the deletion.
- **Not cleaned up:** S3 files, and any Google Calendar watch channel (it expires on its
  own).

Files: `apps/superadmin/views.py`, `pages/superadmin/AdminWorkspace.tsx`, `api/client.ts`.

## C3. Create-workspace page (`/register?token=…`)
- The "How to set up" box is replaced by a **"? How it works"** popover that floats over
  the page, so the form doesn't move. Field hints became one-liners plus **?** tooltips.
- Invite name and email are **locked** ("🔒 from your invite"). The popover ends with a
  note on why.
- **Security fix:** `POST /api/auth/register/` rejects an email that doesn't match the
  invite (400). Before, the lock was browser-only. The name is locked in the form only.
- An invalid, expired or used link shows a clean "Invite link expired" screen.
- Mobile-checked.

Files: `pages/auth/Register.tsx`, `index.css`, `apps/accounts/views.py`.

## C4. One business owner per workspace (migration **`0022`**)
A partial unique index `one_business_owner_per_workspace` on `users(workspace_id)
WHERE role='business_owner'`. The migration **fails if any workspace has two owners**
(pre-check gate 1).

## C5. Pre-login branding no longer leaks another workspace
- **Was:** `/api/settings/public-branding/` returned the **oldest active workspace's**
  name and logo to every visitor of `/login`, `/register` and the portal login.
- **Now:** neutral CoachOS unless `?workspace=<slug>`. Portal invite emails link to
  `/client-portal?ws=<slug>` (remembered in the browser), and the portal sidebar uses
  `/api/portal/me`'s logo.
- **Visible:** `/login` shows the "CoachOS" wordmark. Portal clients invited before the
  deploy see neutral branding until their next login.

Files: `apps/settings_app/views.py`, `apps/portal/views.py`, `tasks/email.py`,
`pages/portal/ClientPortal.tsx`.

## C6. Invitable roles
Owners can invite only `coach`, `assistant` or `limited`. Before, the role field
accepted **`business_owner` and `platform_admin`** (which sees every workspace), a
privilege-escalation hole. File: `apps/accounts/serializers.py`.

## C7. Tools
- `check_tenant_integrity`: **read-only, safe in prod**. It reports owner counts and
  cross-workspace links, and exits 1 on problems.
- `delete_workspace <slug> [--confirm <slug>]`: refuses unless `DEBUG`, so it's local
  only. Dry run by default.
- `ops/predeploy_check_2026-10-18.py` and `ops/postdeploy_check_2026-10-18.py`: the prod
  checklists below, as read-only scripts.

---

# Part D — test-suite fixes (test code only, no app change)

`pytest` gave **60 passed, 3 failed**, with results depending on test order. None of
the failures was an app bug; all three came from tests leaking side effects:

| Failing test | Root cause | Fix (`backend/conftest.py`) |
|---|---|---|
| `test_smoke_e2e` (goal-shared email) | On 2026-10-04 (`e0c327a`) the email moved to Celery `.delay()`. In tests it went to the **dev worker** (dev DB) instead of `mail.outbox`. The app is fine; in prod the worker sends it. | Celery runs **eager** (inline) in tests |
| `test_delete_workspace` ×2 (only when run after `apps/` tests) | `_fire()` starts **background threads** with their own DB connection outside the test transaction. They couldn't see the test's session and committed an `ErrorLog` row that leaked into later tests. | App/task threads run **synchronously** in tests |
| random `429` in `apps/` tests | Throttle counters lived in the **shared dev Redis** and built up across tests and runs | In-memory cache, cleared before every test (not Redis, so the dev Celery queue isn't touched) |

**Result: 63 passed, 0 failed.** The same result holds in normal order, in reverse file
order, and on back-to-back runs.

Plus API-level checks run against the real local stack (shell scripts): workspace
invites 13/13, workspace delete 16/16 (including the cross-workspace 409), register
email lock 2/2. Also clean: `tsc --noEmit`, `check_tenant_integrity`, migrations `0022`
and `0023` reversed to `0021` and re-applied, a rolled-back delete dry run on all 17
local workspaces (up to 1,672 rows in 31 tables), and the pre-check script run against
the **committed (current-prod) code**.

---

## Prod DB impact

| Change | Effect on RDS | Risk |
|---|---|---|
| `0022` unique index on `users` | `CREATE UNIQUE INDEX … WHERE role='business_owner'`. Small table, millisecond lock. | **Migration fails if any workspace has 2+ owners**, and then the backend won't start. Gate 1. |
| `0023` six columns on `workspace_registration_tokens` | Additive; instant on Postgres 11+. | None forward. **Rollback order matters** (see Rollback). |
| Part A | No schema change. | — |
| Workspace delete (runtime) | Deletes rows when an admin uses Danger Zone. | **Irreversible** except by restoring a snapshot (P1). |

There are no data migrations; nothing rewrites existing rows. `migrate` runs when the
backend container starts. Pre-existing model drift in `djstripe`, `library` and
`superadmin` is untouched by deploy (it only runs `migrate`). **Don't run
`makemigrations` on EC2.**

## Who notices what (no login needed; pre-check section 5 counts them)

| Who | What they'll see |
|---|---|
| Every visitor of `/login` | CoachOS wordmark instead of the oldest workspace's logo (pre-check section 8 shows today's) |
| Owners (LMT) | Nothing new in daily use. Team invite role list = coach/assistant/limited |
| Coaches/assistants | No "Invite to Portal" button (owner-only); coaches with view-only Clients lose "Import CSV"; client pickers show only their own clients (Part A) |
| Portal clients | Neutral login branding until their next login, then their workspace's |
| Anyone with an OnlyOffice document open during the deploy | Can't save that session: reopen the document |
| New-workspace invitees | Locked name/email; must register with the invited email |

---

## Pre-deploy checklist (prod, read-only)

On EC2, from `~/platformCoachOs`. Set this once per shell:
```bash
DC="docker compose -f docker-compose.prod.yml"
git pull            # brings the scripts; does NOT change the running app
```

**P0. Is Part A already live?** (This tells you what the deploy actually changes.)
```bash
$DC exec -T backend sh -c 'test -f apps/accounts/tenancy.py && echo "Part A is LIVE" || echo "Part A NOT live — this deploy also ships Part A"'
```

**P1. RDS snapshot** (the only way back after a workspace delete):
```bash
aws rds create-db-snapshot --db-instance-identifier coachos-db \
  --db-snapshot-identifier pre-2026-10-18-release
aws rds wait db-snapshot-available --db-snapshot-identifier pre-2026-10-18-release && echo "snapshot ready"
```
Or use the console: RDS → Snapshots → Take snapshot. Wait for *Available*.

**P2. Impact pre-check:** gates and per-workspace impact. **Save the output**; section 5b
is compared after the deploy.
```bash
$DC exec -T backend python manage.py shell < ops/predeploy_check_2026-10-18.py 2>&1 \
  | grep -v "^time=" | tee ~/predeploy_2026-10-18.txt
```
Every GATE must say PASS:
1. No workspace has 2+ owners (else `0022` fails).
2. No cross-workspace links.
3. `ONLYOFFICE_JWT_SECRET` is set (else all editing stops).
4. No pending invite with a disallowed role.

Section 6 shows who is active right now; deploy when it says nobody is working (no ⚠).

**P3. New image vs prod data**, with no migration and no restart (`--entrypoint python`
skips `entrypoint.sh`):
```bash
$DC build backend
$DC run --rm --no-deps --entrypoint python backend manage.py migrate --plan
#   expect exactly two lines: accounts.0022_one_business_owner_per_workspace
#                             accounts.0023_registration_token_email_tracking
$DC run --rm --no-deps --entrypoint python backend manage.py check_tenant_integrity
#   expect: CLEAN — tenant isolation intact
```

**P4. OnlyOffice secret matches between backend and the OnlyOffice container** (prints
hashes only):
```bash
$DC exec -T backend python -c "import os,hashlib;v=os.environ.get('ONLYOFFICE_JWT_SECRET','');print('backend   :', hashlib.sha256(v.encode()).hexdigest()[:12] if v else 'MISSING')"
$DC exec -T onlyoffice sh -c 'printf %s "$JWT_SECRET" | sha256sum | cut -c1-12 | sed "s/^/onlyoffice: /"'
```
The hashes must match. If they don't, set the same value in `backend/.env` before
deploying.

**P5. Resend key and email settings** are printed by pre-check section 9. A sending-only
key is fine; "Delivered" just won't show.

## Deploy
1. Locally: commit and push.
2. On EC2, at a quiet time (P2 section 6):
   ```bash
   make deploy                      # full deploy: frontend changed too
   $DC logs --since 10m backend 2>&1 | grep -E "Applying|Error|Traceback"
   #   expect: Applying accounts.0022… OK / Applying accounts.0023… OK
   ```

## Post-deploy checks (no LMT login needed)

**1. Data and health script.** Run right after the deploy, and again about an hour later:
```bash
$DC exec -T backend python manage.py shell < ops/postdeploy_check_2026-10-18.py 2>&1 \
  | grep -v "^time=" | tee ~/postdeploy_2026-10-18.txt
diff <(sed -n '/5b\./,/── 6/p' ~/predeploy_2026-10-18.txt | sed '1d;$d' | grep -v '^\s*$') \
     <(sed -n '/── 3\./,/a difference/p' ~/postdeploy_2026-10-18.txt | sed '1d;$d' | grep -v '^\s*$') \
  && echo "ROW COUNTS IDENTICAL ✅"
```
It checks:
- Migrations and the index exist.
- Config is set.
- **Row counts per workspace equal the pre-check** (LMT's data intact).
- **No new ErrorLog entries since the deploy.**
- **Each workspace's own activity since the deploy is going through.** Once LMT's owner
  uses the app as usual, their actions appear here, which proves it works for them
  without you logging in.

**2. HTTP checks** (from anywhere):
```bash
H=https://coachos.rass-consulting.com
curl -s $H/api/settings/public-branding/; echo                      # {"name":"CoachOS",...}
curl -s -o /dev/null -w "onlyoffice file, no token: %{http_code} (expect 403)\n" \
  $H/api/library/items/00000000-0000-0000-0000-000000000000/onlyoffice-file/
curl -s -o /dev/null -w "register, bad token: %{http_code} (expect 400)\n" -X POST \
  -H "Content-Type: application/json" -d '{"registration_token":"00000000-0000-0000-0000-000000000000"}' $H/api/auth/register/
curl -s -o /dev/null -w "login page: %{http_code} (expect 200)\n" $H/login
```

**3. Feature test in a throwaway workspace** (exercises everything without touching
LMT). Use Gmail plus-addresses: they arrive in your inbox but are new emails to CoachOS.
1. **Superadmin → Workspace Invites →** name "Deploy Test", email
   `artikamb+deploytest@gmail.com` → the row shows *Sent* → open the tab again after a
   minute → *Delivered* (with a full-access key). Try **Send again**.
2. Open the email link: name and email are locked, "? How it works" opens. Change the
   email in the browser dev tools and submit → refused. Register normally as
   **"Deploy Test 2026-10-18"**.
3. In that workspace: **Library** → upload a `.docx` → open in the editor → change a word
   → close → reopen → the change is there (proves OnlyOffice / DB-6 end to end).
4. Add a client with `artikamb+portal@gmail.com` → **Invite to Portal** → the email's link
   contains `?ws=` → the portal login shows "Deploy Test" branding.
5. **Team → Invite:** the role list shows only coach/assistant/limited. Invite
   `artikamb+coach@gmail.com` as coach → accept → as that coach there's no "Invite to
   Portal" on a client.
6. **Clean up:** Superadmin → Workspaces → Deploy Test → Suspend → **Danger Zone → Delete**
   (type the slug). Then generate an invite for `artikamb+deploytest@gmail.com` again:
   no "already registered" error, which proves the email was freed. Delete that invite
   row.
7. Then do the real one: **Shreya** (suspended) → Delete → send her a fresh invite.

## Rollback
**Order matters.** Old code doesn't know the six new columns, and `email_send_count` is
`NOT NULL` with no DB default, so old code creating an invite link would fail while they
exist. Reverse the migrations **while the new code is still running**:
```bash
$DC exec -T backend python manage.py migrate accounts 0021   # drops 0023 columns + 0022 index (tested locally)
git checkout <previous deployed commit>     # b53692f if P0 said Part A was live
make deploy
git checkout main
```
This loses only the invite-tracking data. **Workspaces deleted through the console come
back only by restoring the P1 snapshot.**

## Known issues / not done
1. "Delivered" needs a **full-access** Resend key; sending-only keys stay at "Sent".
2. Invite names are locked on the register page, so fix typos in Superadmin before
   sending.
3. A deleted workspace's S3 files stay in the bucket.
4. The Superadmin screens were tested through the API and the register page by
   screenshots, not clicked through end to end; post-deploy step 3 covers that.
5. Pre-existing model drift in other apps (see Prod DB impact).
