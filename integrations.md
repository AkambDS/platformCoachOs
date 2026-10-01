# CoachOS — Third-Party Integrations

Reference for how each third-party integration is wired, and the exact setup steps
for whichever one you're configuring. Written 2026-09-30 alongside the Zoom OAuth
rework described in §2 — see `change_log_2026-09-30.md` for the code-level diff.

---

## 1. Two different patterns — know which one you're looking at

| Pattern | Used by | Who connects | Where credentials live |
|---|---|---|---|
| **Per-user OAuth** | Google Calendar, Zoom | Every individual coach/owner, for their own account | `django-allauth`'s `SocialToken`, one row per (user, provider) |
| **Per-workspace API key ("bring your own account")** | Stripe | The business owner, once, for the whole workspace | `Workspace.integrations` (Fernet-encrypted for Stripe) |

Google Calendar and Zoom both need to act as a **specific person's** calendar/meeting
host — there is no shared "CoachOS Calendar" or "CoachOS Zoom account", so each coach
connects their own. Stripe is the opposite: invoicing needs one payment destination
per business, so the owner connects once and the whole workspace shares it.

Don't confuse the two when adding a new integration — picking the wrong pattern is
exactly the mistake this document's §2 is unwinding for Zoom.

---

## 2. Zoom — per-coach OAuth (current design, since 2026-09-30)

### 2.1 What changed and why

Zoom used to work like Stripe: the workspace owner pasted an **Account ID / Client
ID / Client Secret** for a **Server-to-Server OAuth** Zoom app into Settings →
Integrations, and every coach's "Schedule via Zoom" click used that one shared
credential. Zoom's `users/me/meetings` API call always resolved to the **same single
Zoom account** regardless of which coach was scheduling — there was no way for
different coaches to have their own Zoom identity, and Server-to-Server apps are
architecturally incapable of a multi-user consent flow (no redirect URI, no per-user
authorization — they only ever authenticate as the one account that owns them).

This is now a **per-user OAuth ("Connect Zoom") flow**, matching how Google Calendar
already worked — the same pattern Calendly uses: click Connect, log into your own
Zoom account, done. No API keys, no Settings form. Each coach's meetings are created
under their own connected Zoom account.

**Removed:** the Settings → Integrations → Zoom credentials form (Account ID/Client
ID/Client Secret fields), `GET/POST /api/settings/zoom/`, and the Server-to-Server
token exchange helper. Old `Workspace.integrations["zoom"]` data is simply unused now
— harmless leftover, no migration needed to clean it up.

**Added:** `allauth.socialaccount.providers.zoom`, per-user `SocialToken` storage,
`GET /api/auth/zoom/connect/`, and a "Connect Zoom" tile in Settings → Integrations
available to **every role**, not just the business owner.

`POST /api/settings/zoom/create-meeting/` (called from Calendar and ClientDetail's
scheduling forms) is unchanged from the caller's point of view — same endpoint, same
request body. Internally it now looks up the *requesting user's own* Zoom token
instead of the workspace's shared one.

### 2.2 One-time setup: registering the Zoom OAuth app

This is a developer action, done once (not per coach, not per deploy). Free — no paid
Zoom plan needed to register or own the app itself.

1. Go to <https://marketplace.zoom.us/> → **Develop** → **Build App**.
2. Choose app type **OAuth** (NOT "Server-to-Server OAuth" — that's the old, wrong
   type for this design; it has no redirect URI or user consent screen at all).
3. Choose **User-managed app** (lets any Zoom user connect, not just your own
   account) rather than "Account-level app".
4. Under **OAuth Redirect URL**, add (you can list more than one — see §2.3 on
   reusing one app for both dev and prod):
   ```
   https://coachos.rass-consulting.com/accounts/zoom/login/callback/
   ```
   and, if testing locally against this same app:
   ```
   http://localhost:8000/accounts/zoom/login/callback/
   ```
5. Under **Scopes**, add meeting-creation scopes — `meeting:write` (classic) or the
   granular equivalents Zoom's current console shows (`meeting:write:meeting`,
   `meeting:write:invite_links` or similar — Zoom has migrated some apps to granular
   scopes; add whatever the console groups under "create/manage meetings"). This is
   required on the app's own dashboard regardless of what's set in Django — adding a
   scope in code doesn't grant it, the Zoom app itself must have it enabled.
6. Save, then copy the **Client ID** and **Client Secret** from the app's Basic
   Information page — these two values are all you need.
7. If Zoom marks the app "Development" only: that's fine for testing with your own
   Zoom account, but for *other people's* Zoom accounts (real coaches) to connect,
   the app needs to be activated for broader use. This is generally lighter-weight
   than Google's OAuth verification process, but confirm the exact current
   requirement in Zoom's own docs before assuming it's a zero-friction toggle —
   Google's equivalent step turned out to be a real, ongoing limitation for this app
   (see `CLAUDE.md` §7), so don't take this on faith.

### 2.3 Env vars — one app, both environments (recommended) or two apps

Add to `.env` (both local and prod — see `.env.production.template`):

```
ZOOM_CLIENT_ID=<client id from the app's Basic Information page>
ZOOM_CLIENT_SECRET=<client secret from the same page>
```

**You can reuse the exact same Zoom app/credentials for local dev and prod** — this
mirrors how `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are already shared between
both environments in this codebase. Zoom (like Google) allows an app to list
multiple valid redirect URIs, so add both the `localhost:8000` and the prod
callback URL to the same app (step 4 above) and use one `ZOOM_CLIENT_ID`/
`ZOOM_CLIENT_SECRET` pair everywhere.

If you'd rather keep dev fully isolated from prod (e.g. so a local test can't ever
accidentally touch a real coach's Zoom connection), register a **second** Zoom app
for dev only and give local's `.env` its own `ZOOM_CLIENT_ID`/`ZOOM_CLIENT_SECRET`.
Either approach works; this is a hygiene preference, not a correctness requirement.

**Important — this does *not* mean "one Zoom account for everyone".** The client
id/secret identify the *app* ("CoachOS"), not a person. The actual Zoom account
behind any given meeting is whoever logs in and clicks Allow when they hit "Connect
Zoom" — in prod that's each real coach's own Zoom login; for local testing, use
a dedicated free Zoom account set aside for QA rather than a real coach's or your
own production Zoom account, so test meetings never land somewhere real.

### 2.4 Deploying

1. Set `ZOOM_CLIENT_ID`/`ZOOM_CLIENT_SECRET` in `.env` (local) or `backend/.env` (prod).
2. Restart/rebuild `backend` — `entrypoint.sh` automatically runs
   `python manage.py ensure_zoom_socialapp` on every boot, which creates or updates
   the `SocialApp` DB row from those env vars. It's a safe no-op if the vars are
   still unset (logs a message and skips, same as the existing Google equivalent).
3. No new migration — this reuses `django-allauth`'s existing `socialaccount` tables,
   already present from the Google Calendar integration.
4. Done — every coach in every workspace now sees a "Connect Zoom" tile in
   Settings → Integrations.

### 2.5 How a coach uses it

1. Settings → Integrations → click **Connect Zoom**.
2. Log into their own Zoom account (whatever email/password or SSO they already use)
   and click **Allow**.
3. Redirected back into CoachOS, tile shows **Connected**.
4. From then on, scheduling a session with Zoom as the location (Calendar or a
   client's Activity page) auto-creates the meeting under their own Zoom account and
   fills in the join link — no manual copy-pasting.

If they don't have a Zoom account at all, they need to sign up at zoom.us first
(free Basic plan is enough — unlimited duration for 1-on-1 meetings; a paid plan is
only needed for group sessions over 40 minutes, cloud recording, etc.). That's the
only prerequisite — no credential of any kind.

### 2.6 Code map

| File | What it does |
|---|---|
| `backend/config/settings/base.py` | `allauth.socialaccount.providers.zoom` in `THIRD_PARTY_APPS`; `ZOOM_CLIENT_ID`/`SECRET` env vars; `SOCIALACCOUNT_PROVIDERS["zoom"]` scope config |
| `backend/apps/accounts/management/commands/ensure_zoom_socialapp.py` | Syncs env vars → `SocialApp` DB row (mirrors `ensure_google_socialapp.py`) |
| `backend/entrypoint.sh` | Runs that command on every backend boot |
| `backend/apps/accounts/views.py::zoom_connect` | Bridges JWT auth → Django session → allauth's `/accounts/zoom/login/?process=connect` (mirrors `google_calendar_connect`) |
| `backend/apps/accounts/urls.py` | `GET /api/auth/zoom/connect/` |
| `backend/apps/accounts/allauth_adapters.py::get_connect_redirect_url` | Sends the browser back to `/settings?zoom=connected` (provider-aware — also handles Google's `?google_calendar=connected`) |
| `backend/apps/accounts/views.py::MeView` | Reports `zoom_connected` (and `google_calendar_connected`) on `/api/auth/me/` |
| `backend/apps/settings_app/views.py::_get_zoom_access_token` | Looks up the requesting user's own `SocialToken`, refreshes it if expired (Zoom rotates the refresh token on every use — the new one is saved back) |
| `backend/apps/settings_app/views.py::zoom_create_meeting` | `POST /api/settings/zoom/create-meeting/` — unchanged request/response shape, now uses the per-user token above |
| `frontend/src/pages/coach/Settings.tsx::IntegrationsTab` | "Connect Zoom" tile, available to all roles (not owner-gated like Stripe) |

### 2.7 Interim rollout flag — `ZOOM_OAUTH_ENABLED` (added 2026-09-30, temporary)

The OAuth app described above hit a persistent `Invalid redirect` error from Zoom's
own console during setup/testing — confirmed not caused by anything in this codebase
(redirect URI, allow list, scopes, and client credentials all verified byte-identical
to what Zoom has saved, across multiple freshly-created apps) and still unresolved as
of this writing. Rather than ship a broken Zoom integration while that gets sorted
out with Zoom directly, the **old Server-to-Server flow was restored alongside the
new one**, gated by one env var:

```
ZOOM_OAUTH_ENABLED=False   # old path: one platform-wide Server-to-Server app (below)
ZOOM_OAUTH_ENABLED=True    # new path: per-coach "Connect Zoom" OAuth (this section)
```

Both code paths are fully live in the codebase simultaneously — nothing is
commented out. The flag only changes which one `zoom_create_meeting`, `MeView`
(what "connected" means), and the Integrations tab's Zoom tile use.

**Who configures what, while `False`:** unlike the original Server-to-Server design
(one credential typed in per workspace, via a Settings form — see §2.1), this interim
version has **no per-workspace setup and no UI form at all**. One Server-to-Server
app's credentials live in env vars and are shared by every workspace on the
platform — any coach or owner in any workspace can schedule a Zoom session the
moment the server has them configured, with nothing to click or fill in first. This
was a deliberate simplification given there's exactly one real workspace on the
platform right now; it reintroduces the pooled-account tradeoff the per-workspace
form was originally built to avoid (every workspace's meetings created under the
same Zoom identity) — reassess if a second real workspace joins before OAuth is
unblocked. **Setup is also meaningfully lighter than the OAuth path**: a
Server-to-Server app has no redirect URI, no user consent screen, and none of the
Marketplace Technical Design/Monetization/Publish gates that only apply to apps
other people's Zoom accounts can authorize — just Develop → Build App →
**Server-to-Server OAuth** → add the `meeting:write` scope → copy the Account
ID/Client ID/Secret. A pre-existing app called **"coachos"** (Server-to-Server type)
is already sitting in the Zoom Marketplace account from before the OAuth rework —
reuse it rather than creating a new one.

```
ZOOM_S2S_ACCOUNT_ID=<Account ID from the "coachos" app's credentials page>
ZOOM_S2S_CLIENT_ID=<Client ID from the same page>
ZOOM_S2S_CLIENT_SECRET=<Client Secret from the same page>
```

No redirect URI is involved at all, so (unlike the OAuth app) there's no reason these
three values need to differ between local dev and prod — the same "coachos"
Server-to-Server app's credentials can go in both `.env` files directly.

| | `False` (current default) | `True` |
|---|---|---|
| Who connects | Nobody — pre-configured for the whole platform via env | Each coach, individually |
| Credentials | `ZOOM_S2S_ACCOUNT_ID`/`CLIENT_ID`/`CLIENT_SECRET` env vars | `ZOOM_CLIENT_ID`/`SECRET` env vars (§2.3) |
| Backend | `apps.settings_app.views._get_zoom_token` | `apps.accounts.views.zoom_connect` + `_get_zoom_access_token` |
| Frontend | Status-only tile, click to send a test meeting | Plain OAuth connect link |

**To flip it back to OAuth once Zoom's redirect issue is resolved:** set
`ZOOM_OAUTH_ENABLED=True` in `.env` (both environments independently — no need to
flip them together), redeploy. No code change needed. Once confirmed stable in
production, delete the old-path code entirely: `_get_zoom_token`, the old-path
branches in `zoom_create_meeting` and `MeView`, the old-path tile JSX in
`IntegrationsTab`, and this flag plus the three `ZOOM_S2S_*` env vars (settings, both
`.env` files, this section).

---

## 3. Google Calendar — per-coach OAuth (existing, unchanged)

Same shape as Zoom above, already in place before this work:

- App type: Google Cloud OAuth 2.0 Client (not a service account).
- Env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- Sync command: `ensure_google_socialapp`.
- Connect endpoint: `GET /api/auth/google-calendar/connect/`.
- Known limitation (see `CLAUDE.md` §7): the app is still in Google's "Testing"
  publishing status, so a connected coach's refresh token silently expires every 7
  days until Google's verification for the Calendar sensitive scope completes. Worth
  checking whether Zoom's app has an equivalent constraint once real coaches start
  connecting in prod.

---

## 4. Stripe — per-workspace API key ("bring your own account")

Different pattern on purpose — see §1's table. One workspace owner connects one
Stripe account for the whole business, because invoicing needs a single payment
destination, not a per-coach one. Config lives in `Workspace.integrations["stripe"]`,
Fernet-encrypted, set up in Settings → Integrations → Stripe by the business owner
only. See `DEPLOY.md` for the full Stripe operator + workspace-owner setup and test
plan — not duplicated here since nothing about it changed in this session.
