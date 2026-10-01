# Change Log — 2026-10-01

High-level summary of everything currently sitting in the working tree, not yet
committed. Grouped by feature. Written before commit per team convention (see
bottom of file for the process note). This picks up where
`change_log_2026-09-30.md` left off — that one covers the portal-login OTP fix and
the Email Communication overdue-status badge, both already committed
(`Change-Log—2026-09-30`); none of that is repeated here.

---

## 1. Local dev — Docker proxy was silently breaking every OAuth connect flow

- **What was wrong:** clicking "Connect Google Calendar" (and later "Connect
  Zoom") in local dev returned `HTTP ERROR 500`. Root cause was three stacked
  bugs in how Vite's dev-server proxy is configured under Docker Compose:
  1. `vite.config.ts`'s proxy `target` was `http://localhost:8000` — correct
     for a browser (on the host), but this proxy itself runs *inside the
     frontend container*, where `localhost` means the frontend container, not
     the `api` container. Every proxied request got `ECONNREFUSED`, which Vite
     turned into the `500` the browser saw.
  2. Only `/api` was proxied — `/accounts/*` wasn't, which is where
     `google_calendar_connect`/`zoom_connect` redirect the browser to hand off
     to `django-allauth`. Without that route, the second hop silently landed
     back on the Vite dev server (served the SPA shell) instead of continuing
     to Google/Zoom's consent screen.
  3. `changeOrigin: true` rewrites the outgoing request's `Host` header to
     match the proxy target (`api:8000`) — so once (1) was fixed, Django
     started building OAuth `redirect_uri`s as `http://api:8000/accounts/...`,
     an internal-only Docker hostname Google/Zoom's consent screen rejects as
     an unregistered redirect (and the browser can't resolve anyway).
- `frontend/vite.config.ts` — added a dedicated `VITE_PROXY_TARGET` (separate
  from `VITE_API_BASE_URL`, which stays `localhost:8000` for the browser's own
  direct calls), added `/accounts` to the proxy map, and added a
  `configure: pinHostHeader` hook that forces the outgoing `Host` header back
  to the real public address so Django builds correct, externally-valid
  callback URLs regardless of the internal proxy target.
- `docker-compose.yml` — added `VITE_PROXY_TARGET: http://api:8000` to the
  `frontend` service's environment.
- **Verified locally**: confirmed via curl at each layer — proxy reaches the
  backend (`500` → `401` for an unauthenticated request), the `/accounts`
  hop returns a real `302` instead of the SPA shell, and the final
  `redirect_uri` sent to Google (and later Zoom) reads
  `http://localhost:8000/...`, matching what's registered in each provider's
  console.

## 2. Zoom — interim dual-path rollout flag (`ZOOM_OAUTH_ENABLED`)

- **Context**: the per-coach "Connect Zoom" OAuth app (built earlier, see
  `integrations.md` §2) hit a persistent `Invalid redirect` error from Zoom's
  own console — confirmed not caused by anything in this codebase (redirect
  URI, allow list, scopes, and client credentials all verified byte-identical
  to what Zoom has saved, across three separately-created apps) and still
  unresolved as of this writing. Rather than ship a broken Zoom integration
  while that gets sorted out with Zoom directly, the old Server-to-Server flow
  was restored **alongside** the new one, gated by one flag — both code paths
  are fully live simultaneously, nothing commented out.
- `backend/config/settings/base.py` — new `ZOOM_OAUTH_ENABLED` flag
  (`env.bool`, default `False`) plus three new env vars,
  `ZOOM_S2S_ACCOUNT_ID`/`ZOOM_S2S_CLIENT_ID`/`ZOOM_S2S_CLIENT_SECRET`.
- `backend/apps/settings_app/views.py` — restored `_get_zoom_token` (the old
  Server-to-Server token exchange helper); `zoom_create_meeting` now branches
  on the flag. **Design note**: unlike the original Server-to-Server design
  (one credential typed in per workspace via a Settings form), this interim
  version sources the old path's credentials from env vars, shared by every
  workspace on the platform — no per-workspace setup, no UI form at all. That
  pools every workspace's meetings under one Zoom identity (the exact
  tradeoff the per-workspace form originally existed to avoid), which was a
  deliberate call given there's exactly one real workspace on the platform
  right now — revisit if a second one joins before OAuth is unblocked.
- `backend/apps/settings_app/urls.py` — removed the `zoom/` GET/POST route
  (no longer backed by a view — credentials are env-sourced now, not
  per-workspace, so there's nothing to GET/POST).
- `backend/apps/accounts/views.py` (`MeView`) — `zoom_connected` now reflects
  whichever path is active (a per-user `SocialToken` vs. the platform-wide env
  vars being set); added `zoom_oauth_enabled` to the response so the frontend
  knows which UI to render.
- `frontend/src/pages/coach/Settings.tsx` (`IntegrationsTab`) — removed the
  credentials-form panel entirely (nothing left for any coach or owner to
  configure); the Zoom tile is now a plain status pill, clickable to send a
  test meeting-creation call once connected. Available to all roles, not just
  the owner — matches the "any coach can already schedule" reality of a
  platform-wide credential.
- `frontend/src/api/client.ts` — removed `getZoomSettings`/`saveZoomSettings`
  (no longer backed by a route).
- `backend/.env` (local) and `.env.production.template` — both set
  `ZOOM_OAUTH_ENABLED=False`, with the three `ZOOM_S2S_*` vars added
  (local's left blank pending the real credential values; the production
  template documents the same three as placeholders).
- `integrations.md` — new §2.7 documenting the flag, the env-sourced design
  and its tradeoff, and the exact list of what to delete once OAuth is
  confirmed working and the flag is retired for good. Also flags that a
  pre-existing Server-to-Server app called **"coachos"** already exists in
  the Zoom Marketplace account from before the OAuth rework — reuse it
  rather than creating a new one, and its credentials can be identical in
  both local and prod `.env` files since Server-to-Server has no redirect URI
  to register per environment.
- **Verified locally** against the real dev stack, both states: with the
  three `ZOOM_S2S_*` vars blank, confirmed `GET /api/settings/zoom/` now
  correctly `404`s (route removed), `/api/auth/me/` reports
  `zoom_connected: false`, and `create-meeting` returns a clean "not
  configured" error. Then with fake-but-present values set, confirmed
  `zoom_connected` flips to `true` and `create-meeting` correctly attempts
  the Server-to-Server token exchange against Zoom's real API (clean `400` on
  the fake credentials, not a crash). Reverted `.env` to its blank state
  afterward and cleaned up all test data/containers.

---

## Not part of this session's work — flagging for your review

The working tree also contains several changes I did not make, sitting
uncommitted alongside the above (confirmed by diffing against files I never
opened or edited in this conversation):

- `backend/apps/accounts/allauth_adapters.py` — a fix so the post-connect
  redirect's toast query param is provider-aware (`zoom=connected` vs.
  `google_calendar=connected`); previously hardcoded to always say Google
  regardless of which provider was connected.
- `backend/apps/accounts/urls.py` — new `google-calendar/disconnect/` and
  `zoom/connect/` routes (the latter is what today's §2 work above actually
  calls when `ZOOM_OAUTH_ENABLED=True`).
- `backend/entrypoint.sh` + new
  `backend/apps/accounts/management/commands/ensure_zoom_socialapp.py` — syncs
  `ZOOM_CLIENT_ID`/`SECRET` into the allauth `SocialApp` DB row on every boot,
  mirroring the existing `ensure_google_socialapp`.
- `system_design.md` — a new §9 "Technology Stack" section (full
  backend/frontend/infra/third-party dependency inventory, reviewed from
  `requirements.txt`/`package.json`/actual usage).
- `docs/design.pdf`, `docs/coachOs_architecure.pdf`,
  `docs/stripe-setup-guide.html` — new reference files, untracked.
- `integrations.md` §1–2.6 and §3–4 — the base Zoom-OAuth-rework
  documentation and the Google Calendar/Stripe reference sections; I only
  authored §2.7 on top of this (see above).

Worth confirming these are intentional and from a teammate's parallel session
before they land in the same commit as the work above — I can't vouch for
anything in this list since I didn't write or verify it.

---

## Production deploy notes

- **New env vars for prod**: `ZOOM_OAUTH_ENABLED=False`,
  `ZOOM_S2S_ACCOUNT_ID`, `ZOOM_S2S_CLIENT_ID`, `ZOOM_S2S_CLIENT_SECRET` (same
  values as local — see §2). `ZOOM_CLIENT_ID`/`ZOOM_CLIENT_SECRET` should
  already be set from the earlier OAuth rework; worth confirming they're
  there even though unused while the flag is `False`, so flipping it later is
  a one-line config change, not a scramble.
- **No new migrations.**
- `make deploy-backend` picks up both the code changes and the new env vars
  in one step (rebuilds + restarts `backend`/`celery`/`celery-beat`).
- §1's Docker proxy fix is **local-dev-only** — prod's nginx already routes
  `/api/`, `/accounts/`, etc. directly to Django with correct `Host` headers,
  so it has no prod-side effect at all.

---

## Process note

Per team convention: a `change_log_<YYYY-MM-DD>.md` file like this one is
added/updated before every commit, summarizing what that commit contains at
a high level.
