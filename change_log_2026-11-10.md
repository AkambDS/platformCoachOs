# Change Log — 2026-11-10

**Covers everything uncommitted on top of `030e4ad`** ("Change-Log—2026-10-18-1"), the
commit prod was rebuilt with on 2026-11-02.

| Part | What | Git state |
|---|---|---|
| **A** | Prod 500 when saving a session whose end time is before its start time | uncommitted (new) |
| **B** | Frontend half of the 2026-10-18 work, **never committed**, so **not live in prod** | uncommitted |
| **C** | 🔴 Prod: every background job fails after today's rebuild (Celery 5.7 vs redis 5) | uncommitted (new) |
| **D** | Portal: a client couldn't log progress on a goal they created themselves (404) | uncommitted (new) |
| **E** | Owner + coaches see the client's goal progress, and get an email for every client goal update | uncommitted (new) |
| **F** | Safe deploy: version check, image backup, deploy only what changed, health check, regression tests | uncommitted (new) |

No migrations. A backend-only deploy is **not** enough: Part B is frontend, so use the full
`make deploy`.

---

# Part A — Session save: end time before start time (prod 500)

## What happened in prod
- **When:** 2026-11-10, 18:16:04 and 18:16:28 UTC: two failed attempts, 24 seconds apart.
- **Request:** `POST /api/activities/` → **500**, sent from a client's detail page
  (`/clients/1ff68e68-…`, the "Schedule session" form) by a coach on Mac Safari 18.3.
- **Error:** `django.db.utils.DataError: range lower bound must be less than or equal to
  range upper bound`.
- **Result:** nothing was saved. The coach saw a generic failure, retried, and was stuck.
- **Not** a data or tenant-isolation problem.

## Why
- The "no double-booking" rule in the database (`activity_no_overlapping_coach_bookings`)
  builds a time range `tstzrange(start_at, end_at)`. Postgres refuses to build a range
  whose end is before its start.
- Nothing checked end vs start before saving, on the screen or on the server.
- The view only catches the double-booking `IntegrityError`. This is a `DataError`, so it
  surfaced as a raw 500.
- **How the form can send an end before the start:**
  1. End time picked earlier than the start, e.g. an AM/PM slip in Safari's time box.
  2. A session starting after 11 PM with no end time: the form adds 1 hour but keeps the
     same date.
  3. End date typed earlier than the start date. The date box's `min` only guides the
     picker; it doesn't stop typing.

## Fix
- **`backend/apps/activities/serializers.py`:** `ActivitySerializer.validate()` refuses
  `end_at < start_at` with **400** `{"end_at": "End time must be after the start time."}`.
  - It covers every screen (Calendar, Activities, Client Detail) and both create and edit.
  - On edit it compares against the saved value when only one of the two times is sent.
  - `end_at == start_at` stays allowed, for zero-duration log entries.
  - The forms already show the server's message, so the coach sees it and can correct the
    time.
- **`backend/test_activity_validation.py`** (new): checks that an end before the start is
  refused on create and on edit (PATCH of `end_at` only), that nothing is saved, and that
  a valid session still returns 201.

## Tests (local)
`pytest test_activity_validation.py test_tenant_isolation.py test_smoke_e2e.py` →
**23 passed**.

## Not done (follow-ups, frontend)
1. When the start date is moved **earlier**, the end date stays where it was, which can
   quietly save a session lasting several days. Affects the Client Detail and Calendar
   forms.
2. The automatic "+1 hour" end should move to the next day when it passes midnight.
   Today it is refused by the new check instead of crashing.

---

# Part B — 2026-10-18 frontend, not yet live

`030e4ad` contained **only backend files**. These frontend changes were made and tested
locally at the time but never committed, so prod is running the new backend with the old
screens.

| File | Change | What prod shows today without it |
|---|---|---|
| `pages/coach/ClientDetail.tsx` | "Invite to Portal / Revoke Portal" button shown to the workspace owner only | Coaches still see the button; clicking it returns 403 (the backend is already owner-only) |
| `pages/coach/Clients.tsx` | "Import CSV" shown only to coaches with the Clients **Edit** right | A coach without Edit sees the button; the import returns 403 |
| `pages/portal/ClientPortal.tsx` | Portal login branding from the invite link's `?ws=<slug>` (remembered in the browser); sidebar logo from `/api/portal/me` | The portal login page and sidebar show neutral CoachOS instead of the client's own workspace logo |
| `pages/auth/Register.tsx`, `index.css` | Create-workspace page: setup instructions, workspace-name hint, help tooltips, password hint | Older register page (still works) |
| `pages/superadmin/AdminDashboard.tsx`, `api/client.ts` | Workspace Invites: email status, "Send again" | Invite tracking columns and resend are not visible |
| `pages/superadmin/AdminWorkspace.tsx`, `api/client.ts` | Workspace "Danger Zone" → **Delete Workspace** (suspended first, typed slug, blocked for demo and Superadmin workspaces) | No delete button. The backend endpoint is live but has no UI |

⚠️ **Delete Workspace:** shipping this UI makes the delete one click away in prod. It still
has no production switch and no check that other workspaces stay untouched (see PHASE2.md
"Deploy status (2026-11-02)"). Consider adding the `ALLOW_WORKSPACE_DELETE` guard before
this deploy, or accept that only the Superadmin can reach it.

Docs also uncommitted: `CLAUDE.md`, `PHASE2.md`, `change_log_2026-10-18.md`, the deleted
`change_log_2026-10-08_part2.md` (merged into 2026-10-18), and `ops/` (the pre- and
post-deploy check scripts from 2026-10-18).

---

# Part C — 🔴 Background jobs broken by an unpinned Celery upgrade

## What happened in prod
- **Error (2026-11-10 21:45 UTC, `/api/portal/request-code/`):** `kombu.exceptions.VersionMismatch: Redis transport
  requires redis-py versions 6.1.0 or later. You have 5.3.1`.
- **Cause:**
  - `requirements.txt` allowed `celery>=5.3,<6.0`, and kombu came in unpinned through
    Celery.
  - **Celery 5.7.0 and kombu 5.7.0 were released on 2026-11-03** and require redis-py ≥ 6.4.
  - `redis` is pinned `<6.0`.
  - The 2026-11-02 rebuild got 5.6 and was fine. Today's `make deploy` rebuilt the image
    and pulled 5.7.
- **Impact:** every `.delay()` (about 29 call sites) raises as soon as it tries to queue.
  The Celery worker and beat run the same image, so they can't use the queue either.
  - **Client portal login codes** (`send_portal_login_code_email.delay`) fail, so clients
    can't log in to the portal.
  - Google Calendar sync, reminders, scheduled invoices, stall alerts and invite retries
    are also affected.
  - Not affected: emails sent from a background thread rather than Celery, such as the
    portal invite and the session confirmation. That's why Kendra's invite at 19:30 UTC
    shows `sent`.

## Fix
- **`backend/requirements.txt`:** `celery>=5.3,<5.7` plus an explicit `kombu>=5.3,<5.7`.
  A fresh resolve in a clean `python:3.12-slim` gives **celery 5.6.3, kombu 5.6.2,
  redis 5.3.1**, the same versions the local stack runs.
- **Later, a separate change:** upgrading to redis-py 6.4+ and Celery 5.7 is a separate,
  tested change.
- **Every version is now locked**, so this can't happen again:
  - **`backend/requirements.lock`** (new) holds the exact version of all 115 packages,
    including sub-dependencies. It was taken with `pip freeze` from the local stack the
    test suite runs on.
  - **`backend/Dockerfile`** installs `-r requirements.txt -c requirements.lock` and pins
    the base image to `python:3.12.14-slim`, so a rebuild installs exactly the same set.
  - **Verified:** a fresh `docker build` gives celery 5.6.3, kombu 5.6.2, redis 5.3.1 and
    Django 5.1.15. `pip check` is clean, and the kombu Redis transport loads.
  - **To upgrade a package later:**
    1. Change `requirements.txt`.
    2. Rebuild locally and run the tests.
    3. Regenerate the lock (the command is at the top of the file).

## Verify after deploy
```bash
docker compose -f docker-compose.prod.yml exec -T backend pip list 2>/dev/null | grep -iE "^(celery|kombu|redis) "
#   expect: celery 5.6.3 / kombu 5.6.2 / redis 5.3.1
docker compose -f docker-compose.prod.yml logs --since 10m celery 2>&1 | grep -iE "ready|VersionMismatch|error"
#   expect: "celery@… ready." and no VersionMismatch
```
Then request a portal login code from `/client-portal`. The email should arrive, and the
backend log should show a `200` for `/api/portal/request-code/`.

---

# Part D — Portal: progress on a client's own goal returned 404

## What happened in prod
- **2026-11-10 23:32 UTC:** a RassConsulting portal client created goal "test1" in the portal,
  then tried to log progress on it. Both attempts returned **404**
  (`POST /api/portal/goals/<id>/progress/`, visible in the nginx log; not a 500, so not in
  ErrorLog).
- **Cause:** the portal shows two kinds of goals. The client's **own** goals (created in the
  portal, `created_by` empty) are always shown. **Coach** goals are shown only when shared.
  `PortalProgressView`, however, required `visible_to_client=True` for **every** goal. A
  client's own goal is never "shared", so the portal offered progress on a goal that the
  endpoint then refused.

## Fix
- `apps/portal/views.py` → `PortalProgressView` now uses the same rule as the goal list:
  `created_by IS NULL OR visible_to_client = True`, still limited to the logged-in client
  and their workspace.
- **Tests (new): `apps/portal/tests.py`:**
  - The client can log progress on their own goal. This test failed with 404 before the fix
    and passes after.
  - The client can log progress on a shared coach goal.
  - An **unshared** coach goal still returns 404.
  - Another client's goal still returns 404.
- **Full suite: 68 passed.**

## Verify after deploy
As a portal client: create a goal → log progress on it → it saves. Or check that nginx shows
`201` for it:
```bash
docker compose -f docker-compose.prod.yml logs --since 15m nginx | grep "/progress/"
```

---

# Part E — Owner and coaches see and hear about the client's goal activity

## Requirement
In the portal a client can add goals, log progress and change status. The workspace owner,
and the coaches involved, must **see** all of it (on both client-added goals and shared
coach goals) and **be told** about it.

## What was missing
- **Seeing it:** no coach-side endpoint or UI showed progress entries. `GoalProgress` was
  imported in the coach views but never used, and the coach screen only had a count.
- **Being told:** there was no notification for any client goal action. Only coach → client
  emails existed ("goal shared").

## Now
- **Client page → Goals (owner and coach):** each goal shows a **"Client progress (n)"**
  timeline, newest first, with the date and text. It shows the latest 2, with "Show all".
  Client-added goals keep their "Client-added" tag.
  - Files: `apps/clients/serializers.py` (`ClientGoalSerializer.progress_entries`, plus
    `updated_at`), `apps/clients/views.py` (prefetch, so one query not one per goal),
    `pages/coach/ClientDetail.tsx`.
- **New email "Client Goal Update"** (Settings → Emails, editable like the others). It's
  sent when the client, in the portal:

  | Action | Wording in the email |
  |---|---|
  | Adds a goal | "added a new goal" |
  | Logs progress | "logged progress" (includes the progress text) |
  | Marks complete / reopens | "marked a goal complete" / "reopened a goal" |
  | Edits their own goal | "updated a goal" |
  | Deletes their own goal | "deleted a goal" |

  - **Who gets it:** the workspace **owner**, the client's **assigned coach**, and the
    **coach who set the goal**. Each person gets it once, and only users of the same
    workspace (never the platform admin).
  - **Nothing changed means no email:** for example, re-marking an already-complete goal.
  - Reply-To is the client, and the email links to the client's page.
  - It's logged in Email Communication.
  - Sent through Celery (fixed in Part C).
  - Files: `tasks/email_notices.py` (`client_goal_update`), `tasks/email.py`
    (`send_client_goal_update`, `_goal_update_recipients`), `apps/portal/views.py` (hooks on
    create, progress, status, edit, delete), `pages/coach/Settings.tsx` (description).
- **Tests:** `apps/portal/tests.py` now has 9 tests:
  - recipients for each action, and the coach who set the goal is included;
  - re-marking with the same status sends no email;
  - edit and delete send emails;
  - a user in another workspace is never emailed;
  - owner and coach both see the progress on own and shared goals.
- **Full suite: 77 passed.**

## Verify after deploy
1. As a portal client: add a goal, log progress, mark it complete.
2. The owner and the coach each get 3 "Client Goal Update" emails.
3. On the client's page → Goals, the goal shows "Client progress (1)" with the text.

```bash
docker compose -f docker-compose.prod.yml logs --since 15m celery | grep send_client_goal_update   # "succeeded"
```

---

# Part F — Safe deploy: version check, image backup, health check

**Why:** Part C reached prod because a rebuild silently pulled new package versions,
and nothing checked the result. Every deploy now goes through one script that shows
what changed, backs up the running images, rebuilds only what changed, tests the new
image before going live, and checks health afterwards.

## New files
| File | What it does |
|---|---|
| `ops/deploy.sh` | `prod` (default) or `local`. **1** files changed since the last deploy · **2** version checks: STOPS if `requirements.txt` changed without `requirements.lock` (or `package.json` without `package-lock.json`); lists every package version change and base-image change · **3** plan: what rebuilds; migrations → asks for an RDS snapshot · **5** backs up the running images (`coachos-backup:<svc>-<time>-<commit>`, newest 3 kept) · **6** builds only the changed services · **4** regression tests **in the new image**, before anything live changes (prod: DB-free tests; local: the full tenant/activity/regression suites) · restarts only what changed (nginx config tested first) · **7** health check; on success records the commit in `.deploy_state_<env>` |
| `ops/postdeploy_health.sh` | Your health commands, plus pass/fail. **Hard checks** (exit 1): every container up/healthy, site URLs answer, `manage.py deploy_check`. **Warnings**: backend errors and 500s, Celery errors, nginx 404/5xx, app ErrorLog. `SINCE=10m` sets the log window (default 1h) |
| `ops/rollback.sh` | Re-tags the backed-up images and restarts those services, then runs the health check. Warns if the rolled-back deploy had migrations |
| `backend/apps/accounts/management/commands/deploy_check.py` | Read-only: DB · installed packages == `requirements.lock` · opens a real Celery broker channel (where `VersionMismatch` was raised) · worker ping · tenant integrity |
| `backend/test_deploy_regression.py` | Installed packages == lock · every `requirements.txt` package is in the lock · broker channel opens · `POST /api/portal/request-code/` returns 200 and queues the email |
| `Makefile` | `make deploy-plan`, `make deploy-safe`, `make health`, `make rollback` |
| `.gitignore` | `.deploy_state_*`, `.deploy_backup_*` (per-server state) |

Also: `requirements.lock` lost `pyflakes`. It had been installed by hand inside the old
local container, so a clean image doesn't have it. The fresh build is now identical to
the lock (115 packages).

## Tested locally
- `ops/deploy.sh local --plan`: listed the changes, showed the new lock and the base
  image change (`python:3.12-slim` → `3.12.14-slim`), and planned the rebuild.
- `ops/deploy.sh local --yes`: backed up 3 images, rebuilt, **26 regression tests
  passed**, restarted, health check **HEALTHY**.
  - The first attempts failed for real reasons, and the checks caught them: pyflakes
    drift, and a worker or app still starting (retries added).
- `ops/rollback.sh local`: restored the backed-up images and restarted.
- With redis-py faked to an old version, `deploy_check` fails with the same
  `VersionMismatch` as prod.
- The prod-style DB-free test run in a one-off container passed (3 passed).

**Not run on prod:** the `prod` paths (`git fetch` / fast-forward, the `backend` /
`celery` / `celery-beat` / `nginx` service names, prod URLs) are untested until the first
`make deploy-plan` on EC2.

---

## Deploy
1. **Locally:** run the tests above and `cd frontend && npx tsc --noEmit`, then commit and
   push.
2. **On EC2,** the first time with the new scripts:
   ```bash
   cd ~/platformCoachOs
   git pull                                     # brings in ops/deploy.sh itself
   chmod +x ops/*.sh
   ops/deploy.sh --plan --from <commit running now>   # e.g. c6310ce, or whatever `git log -1` showed before the pull
   ops/deploy.sh --from <same commit>           # backs up, rebuilds backend + frontend, tests, health check
   ```
   From then on: `make deploy-plan`, then `make deploy-safe`. The script remembers the
   last deployed commit.
   - The old `make deploy` still works, but skips every check and backup.

## Post-deploy checks
1. **Tenant integrity:** `docker compose -f docker-compose.prod.yml exec -T backend python
   manage.py check_tenant_integrity` → expect `CLEAN — tenant isolation intact`.
2. **Part A:** in a test workspace, try to save a session with end 1:00 PM and start
   2:00 PM. Expect the message "End time must be after the start time." and no 500 in the
   logs:
   ```bash
   docker compose -f docker-compose.prod.yml logs --since 15m backend | grep "POST /api/activities/"
   #   expect 400 for the bad attempt, 201 for a valid one, no 500
   ```
3. **Part B:**
   - As a coach: there is no Invite to Portal button.
   - A portal invite link (`/client-portal?ws=<slug>`) shows that workspace's logo.
   - Superadmin: Workspace Invites shows the status columns, and a workspace page shows
     the Danger Zone.

## Rollback
No migrations, so a code-only rollback:
```bash
git checkout 030e4ad && make deploy && git checkout main
```
