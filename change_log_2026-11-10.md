# Change Log — 2026-11-10

**Covers everything uncommitted on top of `030e4ad`** ("Change-Log—2026-10-18-1"), the
commit prod was rebuilt with on 2026-11-02.

| Part | What | Git state |
|---|---|---|
| **A** | Prod 500 when saving a session whose end time is before its start time | uncommitted (new) |
| **B** | Frontend half of the 2026-10-18 work, **never committed**, so **not live in prod** | uncommitted |

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

## Deploy
1. **Locally:** run the tests above and `cd frontend && npx tsc --noEmit`, then commit and
   push.
2. **On EC2:**
   ```bash
   git pull
   make deploy        # full: Part B is frontend
   docker compose -f docker-compose.prod.yml logs --since 10m backend 2>&1 | grep -E "Error|Traceback"
   ```

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
