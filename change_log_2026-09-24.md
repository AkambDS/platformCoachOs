# Change Log — 2026-09-24

High-level summary of everything currently sitting in the working tree, not yet
committed. Grouped by feature. Written before commit per team convention (see
bottom of file for the process note).

---

## 1. Idle-timeout / auto-logout (uniform across all roles)

- New shared modal component `frontend/src/components/InactivityWarningModal.tsx`
  — the "Still there?" warning UI, used by both surfaces below so they can't
  visually drift apart.
- **Coach app** (`business_owner`, `coach`, `assistant`, `limited`,
  `platform_admin`): `frontend/src/App.tsx` refactored to use the shared modal
  instead of an inline copy. Behavior unchanged — 15 min idle → warning,
  30 min idle → auto logout (`useInactivityTimer`, pre-existing hook).
- **Client portal** (`portal_client`): `frontend/src/pages/portal/ClientPortal.tsx`
  now wired to the same `useInactivityTimer` hook and the same shared modal —
  previously the portal had **no** idle timeout at all, only a flat 8-hour
  hard JWT expiry (`backend/apps/portal/views.py`, unchanged). Now every role
  gets the identical 15 min warn / 30 min logout behavior.
- Frontend-only change. No new env vars, no backend/API changes.

## 2. AI session-note suggestions (Anthropic)

- New backend module `backend/apps/clients/ai_notes.py` +
  `POST /api/clients/{client_id}/notes/suggest/` action on
  `ClientNoteViewSet` (`backend/apps/clients/views.py`) — takes raw session
  notes, returns a drafted Coach Reflection + Commitment. Nothing is
  persisted server-side; the coach accepts/rejects per field, then saves
  through the normal note create/update endpoints.
- New audit action `requested_ai_note_suggestion` (`backend/apps/audit/models.py`).
- New dependency `anthropic>=0.40,<1.0` (`backend/requirements.txt`).
- New settings: `ANTHROPIC_API_KEY` (required for the feature to work — returns
  a clear 400 error instead of failing silently if unset) and `AI_NOTES_MOCK`
  (dev-only canned-response bypass, must stay `False`/unset in production) —
  both added to `backend/config/settings/base.py` and documented in
  `backend/.env.production.template`.
- Frontend: "Suggest with AI" button + accept/reject UI added to the
  structured note form in `frontend/src/pages/coach/ClientDetail.tsx`.

## 3. New Client form — "Create deal" now defaults to unchecked

- `frontend/src/pages/coach/NewClient.tsx:52` — `create_deal` default changed
  from `true` to `false`. Coaches now have to explicitly opt in to opening a
  pipeline deal when adding a client, instead of it happening by default.
  Self-contained change — the checkbox only gates itself and its explanatory
  note (`NewClient.tsx:395-399`), nothing else reads the default.
- Frontend-only. No new env vars, no backend/API changes.

## 4. Public demo / guided product tour + lead capture

(Built earlier, still uncommitted — see `CLAUDE.md` §9 for full detail.)

- "Log In as Demo User & Take the Tour" flow from `/` and `/login`, backed by
  a real seeded workspace (`coachos-demo`), walking every feature area via a
  router-aware `driver.js` tour (`frontend/src/hooks/useTour.ts`).
- Idempotent seed command:
  `backend/apps/accounts/management/commands/seed_demo_workspace.py`.
- **Read-only enforcement**: `backend/config/middleware.py`
  (`DemoWorkspaceReadOnlyMiddleware`) blocks all non-GET/HEAD/OPTIONS writes
  from the demo workspace at the middleware layer, registered in
  `backend/config/settings/base.py`. `frontend/src/components/layout/AppShell.tsx`
  shows a persistent read-only banner for that workspace.
- **Lead capture gate**: `frontend/src/components/DemoGateModal.tsx` collects
  first name + email before demo login. New `DemoLead` model
  (`backend/apps/superadmin/models.py`, migration `0008_demolead_...`), two
  public endpoints (`POST /api/demo/lead/`, `POST /api/demo/lead/event/` —
  `backend/apps/superadmin/views.py`, wired in `backend/config/urls.py`),
  throttled at `demo_lead: 30/hour` (`backend/config/settings/base.py`). New
  "Demo Leads" tab in Superadmin (`frontend/src/pages/superadmin/AdminDashboard.tsx`).
- Supporting frontend changes: `frontend/src/constants/demo.ts` (shared demo
  credentials + sessionStorage handoff key), `frontend/src/pages/auth/Login.tsx`,
  `frontend/src/pages/Home.tsx`, `frontend/src/pages/coach/Dashboard.tsx`
  (auto-launch tour), `frontend/src/components/layout/Sidebar.tsx` and
  `frontend/src/pages/coach/Settings.tsx` (tour anchors).
- **Not yet deployed to production** — verified locally only.

---

## Production deploy notes

- **New required env var:** `ANTHROPIC_API_KEY` must be set in
  `backend/.env` on EC2 before the AI note-suggestion feature will work in
  prod (it degrades to a clear error, not a crash, if left blank — so this
  is a feature-enablement step, not a hard blocker for deploying everything
  else). Do **not** set `AI_NOTES_MOCK=true` in production.
- **No other new env vars** from today's idle-timeout work (frontend-only).
- The demo/lead-capture batch (section 4) needs no new env vars beyond what
  `DEPLOY.md` §9 already documents, but does need a migration
  (`0008_demolead_...`) and the `seed_demo_workspace` management command run
  once after deploy — see `CLAUDE.md` §9 for the exact commands.
- Standard reminder from `DEPLOY.md`: rebuild `backend`, `celery`, and
  `celery-beat` together, not just `backend`, since Celery tasks share the
  same image.

---

## Process note

Per team convention: a `change_log_<YYYY-MM-DD>.md` file like this one is
added/updated before every commit, summarizing what that commit contains at
a high level.
