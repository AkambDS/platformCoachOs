# Change Log — 2026-10-08 (part 2)

Picks up after `change_log_2026-10-08.md` (committed as `98d34cd`) and
`294a415` ("tour desc changed": the guided tour's intro only promises the
client-portal preview to the demo user).

Four groups of changes:
1. Tenant isolation fixes (backend, security).
2. Rate-limit and demo-lead hardening (backend).
3. Login and client-portal login redesign (frontend).
4. Planning and architecture docs.

None of this is deployed yet. See **Deploy** at the end.

---

## 1. Tenant isolation: data never crosses workspaces

**Why:** a code audit for the "basic multi-tenant rule" found two critical
bugs and three smaller gaps. Read access was already correctly scoped (every
list/detail queryset filters by workspace, and coaches only see their own
clients). The holes were in **writes** and **login**. The full audit, with
the role-by-role access model, is in `PHASE2.md` §1a.

### DB-1 (critical): cross-workspace links through foreign keys
- **Bug:** writable FK fields (`client`, `coach`, `deal`, `affiliation`, …)
  used DRF's default `PrimaryKeyRelatedField(queryset=Model.objects.all())`,
  which looks across every workspace. A throwaway test confirmed that
  workspace B could create an invoice, a deal and a session against
  workspace A's client (all returned 201). The invoice response also returned
  A's client name and email. Inside one workspace, a coach could do the same
  with another coach's client.
- **Fix:** new `backend/apps/accounts/tenancy.py`:
  - `WorkspaceScopedPrimaryKeyRelatedField` resolves an FK only within the
    requester's workspace.
  - For non-owners it narrows further, to the rows they can already read:
    - Client: `coach = user`
    - Deal and ClientGoal: `client__coach = user`
    - Activity: `coach = user`
  - It fails closed: with no request, user or workspace in the serializer
    context, nothing resolves.
- `WorkspaceScopedSerializerMixin` makes every auto-built FK on a
  ModelSerializer use the scoped field, keeping the model's own
  required/null settings. It's applied to all 8 serializers that have
  writable FKs, covering 13 fields:
  - `ActivitySerializer`: client, coach, deal, affiliation
  - `ClientDetailSerializer`: coach
  - `CommitmentSerializer`: activity
  - `GoalProgressSerializer`: goal
  - `InvoiceDetailSerializer`: client, coach
  - `FolderSerializer`: parent
  - `KnowledgeItemSerializer`: folder
  - `DealSerializer`: client, coach

### DB-2 (critical): login attached workspace-less users to the oldest workspace
- **Bug:** `LoginView` gave any non-platform-admin user with no workspace
  `Workspace.objects.first()`, which in production is LMT Consulting, the
  only real customer. It then issued tokens for that workspace.
- **Fix:** such a login now returns **403** ("This account isn't attached to
  a workspace…"), no auth cookies are set, and a warning is logged. Platform
  admins are unaffected. A production check run before deploying returned
  `[]`, so no real user is affected.
- File: `backend/apps/accounts/views.py` (also adds the module `logger`).

### DB-11 (found while fixing DB-1): library item could point at another workspace's file
- `KnowledgeItem.s3_key` was writable by the client. An item could be pointed
  at `library/<other workspace>/…` and would then hand out a presigned
  download URL for that file.
- **Fix:** `validate_s3_key` only accepts keys under
  `library/<own workspace id>/`, which is where uploads are always stored.

### DB-8 / DB-9: smaller scoping gaps
- **DB-8:** `shared_client_ids` and `shared_user_ids` on library items now
  keep only valid ids of this workspace's clients and users. Foreign, stale
  or malformed ids are **dropped, not rejected**, so an edit doesn't fail
  because a client was since deleted. File: `apps/library/serializers.py`.
- **DB-9:** `remove_attachment`'s "is this S3 file still referenced?" check is
  now scoped to the workspace. File: `apps/clients/views.py`.

### Behaviour change to know
Coaches and assistants can now pick **only their own clients** when creating
an invoice, deal or session. This matches what they could already see in
their lists. Owners are unaffected.

### Tests: `backend/test_tenant_isolation.py` (new, 14 tests)
Two workspaces, A and B, each with an owner and two coaches, and A fully
populated (client, note, goal, commitment, assessment, session, invoice,
deal, library folder and item, feedback ticket, affiliation). It covers:
- **Cross-workspace reads:** detail and nested-list endpoints, plus 12 list
  endpoints, for both owner and coach. Each must be denied, or return a 2xx
  that contains none of A's ids or names.
- **Cross-workspace updates and deletes:** denied, and A's rows unchanged.
- **Cross-linking:** creating an invoice, deal, session, folder or library
  item that points at A's client, coach, deal, affiliation, folder or file is
  denied. Reassigning B's client to A's coach is denied.
- **Library share lists:** foreign ids are dropped.
- **Coach vs coach in one workspace:** no reading of, or linking to, another
  coach's client.
- **Positive controls:** owner and coach can still create invoices, deals and
  sessions for their own clients. The owner can reassign a client's coach.
- **Client portal:** client vs client, and cross-workspace.
- **Login:** a workspace-less login is refused with no cookies set, and a
  normal login still works.
- **Guard:** fails if any ModelSerializer ever adds an unscoped writable FK.

**Verified:**
- All 14 pass.
- With the fixes temporarily removed, 6 of them **fail**, so they do catch
  these bugs.
- Full suite: 42 passed, 1 failed. The failure is the pre-existing
  `test_smoke_e2e.py` goal-share email assertion (`mail.outbox` is empty
  because the task runs through Celery, not eagerly, in tests). It fails
  identically without these changes and is tracked in `PHASE2.md`.

Run: `docker compose exec api pytest test_tenant_isolation.py -v`.
Run it before every deploy until CI exists.

---

## 2. Rate limiting and demo-lead hardening

- **Every per-IP rate limit could be bypassed** (login 10/min, password
  reset, register, demo lead, portal code):
  - The cause: `NUM_PROXIES` was unset, so DRF used the whole client-supplied
    `X-Forwarded-For` header as the client's identity, and a forged header
    gave each request a fresh bucket.
  - The fix: `"NUM_PROXIES": 1` in `REST_FRAMEWORK`
    (`backend/config/settings/base.py`). With nginx as the single trusted
    proxy, DRF now takes the IP nginx appended.
  - If Cloudflare or a load balancer is ever put in front, this needs to
    become `2`.
- **The demo-lead form returned a 500 on a long first name:**
  `capture_demo_lead` returned a 500 for names over 100 characters (the model
  limit). It now returns `400 {"detail": "First name is too long."}`. File:
  `backend/apps/superadmin/views.py`.

---

## 3. Login and client-portal login redesign

### Coach login: `frontend/src/pages/auth/Login.tsx`, `frontend/src/index.css`
- Rebuilt to match the client-portal login's layout:
  - CoachOS masthead top-left.
  - Editorial left column: large faded quote mark, headline "Your coaching
    practice, *elevated*", intro, short gold rule, and a numbered 01–05
    feature list (CRM; scheduling with Google Calendar and Zoom; branded
    client portal; pipeline with scheduled follow-ups; Stripe invoicing and
    reports).
  - An invisible gutter, then the sign-in card on the right.
- New `.auth-ombre` background: warm paper bottom-left fading to champagne and
  a soft dawn blue top-right, with a gold glow in the corner.
- The sign-in card (`.auth-form-card--boxed`) is white with a gold gradient
  bar on top, rounded corners and a soft shadow. A small breathing gold
  North Star (`FlowStar`) sits next to "Welcome back".
- The old white two-panel `auth-brand--light` / `auth-form-area--light` styles
  were removed (only Login used them). Register, Forgot Password and Accept
  Invite keep the original navy panel.
- Below 900px the layout stacks and centres, and the animation is off.

### `NorthStarFlow.tsx`, reworked (coach login background)
- The canvas now lays itself out around the real page:
  - It measures the feature-bullet numbers (`data-flow-in`), the bullet texts
    (`data-flow-source`), the card (`data-flow-target`) and the star
    (`data-flow-star`).
  - Chains of dots fan in from the bottom-left corner to each bullet, large
    and close at first and shrinking with depth. The bullet's node lights up
    as a chain arrives.
  - The chains pass behind the bullet text, re-emerge, and flow across the
    gutter into the card. The star in the card's title pulses on each
    arrival.
- The lines never cross the copy or the form at any size. It is hidden on the
  stacked mobile layout. It still draws a single still frame under
  `prefers-reduced-motion`.
- Exports `FlowStar` and the path helpers (`build`, `pointAt`, `glow`) used by
  `GoldenThreadFlow`.

### Client-portal login: `frontend/src/pages/portal/ClientPortal.tsx`
- The same `.auth-ombre` background. The oversized "progress" watermark word
  and the visible divider line were removed. `FlowStar` sits next to the
  "Client Portal" title.
- New background component `frontend/src/components/GoldenThreadFlow.tsx`:
  - Eight thin curves sweep in from the whole left edge and merge at the
    start of the short gold rule under the intro paragraph (`data-flow-rule`).
  - From there a single straight gold line with breathing nodes runs to the
    gutter, then curves up into the card's star.
- Flow tuning, after feedback in this session:
  - **Every left-edge line has its own dots flowing continuously:** two
    evenly staggered chains per line (`PER_FAN = 2`). They fade out at the
    merge point and restart on the same line immediately. Before, 8 shared
    chains hopped between random lines, so only a couple of rows moved at
    once.
  - **The gold line has its own stream** (`TRUNK_CHAINS = 3`) into the star.
    Only these pulse the star.
  - **Slower, steadier motion:** `SPEED` went from 85 to 42 px/s, a calm
    drift instead of a busy swarm.
  - **Tried and reverted:** extra curves coming in from the top and bottom
    edges ("from all directions"). The user preferred left-only.

**Verified:**
- `npx tsc --noEmit` passes.
- Rendered `/login` and `/client-portal` in headless Chrome against the local
  dev server, at 1440×900 and 1580×800 desktop, and 390px phone width for the
  coach login.
- Not yet watched by hand across a full animation cycle in a real browser.

---

## 4. Docs and planning

- **`PHASE2.md` (new):** the multi-workspace readiness plan, split out of
  `CLAUDE.md` to keep that file short. It contains:
  - §1: why database row-level security is inert today. The app's RDS login
    `coachos_admin` owns the tables and none of the 12 policies is forced.
    The middleware also doesn't read the cookie JWT, and the setting is
    transaction-local and expires.
  - §1a: the tenant-isolation audit (DB-1 … DB-11), the access model per
    login type, an ordered DB TODO list, and a done log.
  - §1b: the Superadmin portal requirements (errors and a 7-day usage
    summary; never client data). This work is **on hold** by decision.
  - §2 and §3: the wider Phase 2 items (backups, DB roles, RLS, staging/CI,
    scale, integrations, observability, onboarding) and a 4-week plan.
- **`CLAUDE.md`:**
  - §2 now records that production data lives in **AWS RDS**
    (`coachos-db…rds.amazonaws.com`). The `db` service in
    `docker-compose.prod.yml` is unused and empty, so **`make backup` dumps
    the wrong (empty) database**.
  - §10 now points to `PHASE2.md`.
- **RDS findings:**
  - Automated backups are on, but **retention is 1 day**. Raise it to 7–14
    days and enable deletion protection.
  - Take a manual snapshot before deploying. There were no manual snapshots
    yet.
  - An engine patch (18.3.R2) and an OS update will auto-apply in the
    Oct 13, 01:51–02:21 EDT maintenance window, with a brief database
    restart.
- **`docs/CoachOS_Architecture_and_Design.pdf`** plus its source
  (`docs/src/build_architecture_doc.py` and the generated `.html`): an
  architecture and design document with inline-SVG diagrams, rebuilt with
  `python3 docs/src/build_architecture_doc.py` (prints to PDF via headless
  Chrome).

---

## Deploy

1. **Take an RDS manual snapshot** first (RDS → Snapshots → Take snapshot,
   `coachos-db`, e.g. `pre-tenant-isolation-2026-10-08`). Wait for
   *Available*.
2. Commit and push, then on EC2:
   ```bash
   git pull
   make deploy-backend
   docker compose -f docker-compose.prod.yml build frontend
   docker compose -f docker-compose.prod.yml up -d --force-recreate frontend
   ```
   There is no migration.
3. **Smoke check:**
   - As LMT's owner, clients, calendar, invoices and pipeline all load.
   - Creating a session or invoice for an own client works.
   - A coach's client picker shows only their own clients.
   - `/login` and `/client-portal` render with the new design.
4. **Rollback:** re-deploy the previous commit with `make deploy-backend`
   plus the frontend rebuild. No data changes are involved.
