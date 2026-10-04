# Change Log — 2026-10-04

Picks up where `change_log_2026-10-03.md` left off (Session Notes + Goals CRUD
work, not yet committed).

---

## 1. Client portal — session now lasts 24h instead of 8h, so the login code isn't re-entered mid-session

Request: a client shouldn't have to re-request/re-enter their 6-digit login
code every time they come back to the portal within a reasonable window —
maintain the session for ~24 hours.

Three things were actually gating this, found via investigation before
changing anything:

1. **The JWT itself was capped at 8h**, not 24h — `PortalLoginView` mints a
   SimpleJWT `AccessToken` with an explicit `token.set_exp(lifetime=...)`
   that overrides the global `SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"]` setting
   entirely (that global setting is 30min and only applies to the *coach*
   login — irrelevant here).
2. **The token was stored in `sessionStorage`**, which clears on tab/browser
   close — so even an 8h (or 24h) token was pointless the moment a client
   closed the tab, which is the single most common way anyone "closes" a
   web app.
3. **A 15min-warn/30min-logout idle timer** (`useInactivityTimer`, shared
   with the coach app) was independently logging an idle-but-still-open
   portal tab out well before either of the above even mattered.

**Backend** — `backend/apps/portal/views.py`:
- New `PORTAL_SESSION_LIFETIME_HOURS = 24` constant (next to the existing
  `CODE_LIFETIME_MINUTES = 10`).
- `PortalLoginView.post`: `token.set_exp(lifetime=timedelta(hours=8))` →
  `timedelta(hours=PORTAL_SESSION_LIFETIME_HOURS)`.
- Verified directly in a shell: a token minted this way carries exactly a
  24.0h gap between its `iat` and `exp` claims.

**Frontend** — `frontend/src/pages/portal/ClientPortal.tsx`:
- All 4 portal session keys (`portal_token`, `portal_client_name`,
  `portal_workspace_name`, `portal_coach_name`) switched from
  `sessionStorage` to `localStorage` (8 call sites) — otherwise the 24h
  token would still be thrown away on every tab close.

### Follow-up — raised the public-facing security question, resolved with a longer (not disabled) idle timeout

First pass disabled the idle-auto-logout outright (`enabled: false`), reasoning
that any idle timeout would contradict "no code re-entry within 24h." Flagged
this to the user as a real regression for shared/public devices (a client
logging in on a library/hotel/shared-family computer would now stay silently
logged in for up to 24h with nothing forcing re-auth) and asked how to balance
it. Decision: **re-add idle logout at a longer threshold (3h) instead of
removing it** — long enough that normal same-day use never trips it, short
enough that a session left open unattended on a shared device doesn't sit
logged in for the full 24h.

- `frontend/src/hooks/useInactivityTimer.ts` — thresholds are now
  overridable per caller (`warnMs?`/`logoutMs?` params, defaulting to the
  existing 15min/30min constants) instead of hardcoded module constants.
  The coach app (`frontend/src/App.tsx`) calls it with no overrides, so its
  behavior is byte-for-byte unchanged.
- `ClientPortal.tsx` — portal now passes `warnMs: 2h45m, logoutMs: 3h`
  (`enabled: !!session`, matching the coach app's pattern rather than the
  earlier `enabled: false`), and forwards the same values in minutes to
  `InactivityWarningModal`'s `warnMinutes`/`logoutMinutes` props so the "You've
  been inactive for N minutes" copy stays accurate instead of still saying
  "15 minutes."
- Net result: a client actively using the portal across a day is never
  interrupted (24h ceiling, no re-code needed); a session left open and
  completely untouched on any device self-logs-out after 3h, same safety
  net the coach app has, just tuned to a window that won't fight the 24h
  goal.

**Verified locally**
- `python manage.py check` clean; `pytest apps/clients/tests.py` — 12/12
  (unaffected by this change, re-run as a general regression check).
- `npx tsc --noEmit` clean after both passes (hook signature change +
  portal wiring), including confirming the coach app's unmodified call site
  still type-checks against the now-optional `warnMs`/`logoutMs` params.
- Confirmed in a Django shell that a token minted with the new constant has
  a 24.0-hour `exp - iat` gap.

---

## 2. Client portal Goals — redesigned to match Notes, plus two real bugs found and fixed

Request: give the portal's Goals tab the same look/feel as the just-redesigned
Notes tab, and fix two reported issues — "can't edit the first goal" and
"search by target date doesn't work."

**Investigation before touching code:** tested the actual reported endpoints
directly (real login via the real `/api/portal/` flow — request a code,
pull it out of Mailpit, log in, create/edit/list goals via `curl`) rather
than guessing from reading the source. The backend's create/edit/search
logic for goals was already correct — a PATCH on the newest (first-in-list)
client-owned goal succeeded cleanly, and the search comparison matched real
API data exactly. That ruled out a backend logic bug and pointed at either
silent frontend error-swallowing or a frontend-only display bug — confirmed
both by then driving the actual app in a real headless Chrome (Playwright,
pointed at the system-installed Google Chrome rather than downloading a
browser, since this environment had no browser binaries pre-installed):
logged in as a real seeded client (`paige@paigecochran.com`, LMT Consulting
workspace — not the read-only demo workspace, which would have made every
write silently 403 and look identically "broken"), created goals, expanded
rows, opened the edit form, and exercised the date search — all against the
live dev server at `localhost:5173`.

**Bug #1 — real, found via the browser test:** the goal explorer's date-group
header (e.g. "NOV 20, 2026") and the expanded row's "Target: …" line
disagreed by one day ("Target: Nov 19, 2026" under a "NOV 20, 2026" group
header for a goal whose stored `target_date` was `2026-11-20`). Root cause:
`fmtDate()` does `new Date('2026-11-20').toLocaleDateString(...)` — parsing
a date-only string as UTC midnight, then formatting in the browser's local
timezone, which rolls the displayed date back a day in any negative-UTC-offset
zone (all of the Americas). This is almost certainly the real explanation for
"search by target date doesn't work": a client would see "Target: Nov 19",
type Nov 19 into the search box, and get no match — because the goal is
actually stored and searched against Nov 20. The group header was already
timezone-safe (used the `fmtDayKey` helper built for the Notes redesign);
the "Target: …" display line and two spots in `OverviewTab`'s "Goals Due"
widget (date display + the overdue calculation itself, which had the same
bug — a goal due "today" could wrongly show as overdue depending on the
browser's timezone) were not. Fixed all three call sites in
`ClientPortal.tsx` (plus the matching one in the coach side's
`ClientDetail.tsx` Goals tab, same bug, same fix) to use `fmtDayKey` / plain
string comparison instead of `new Date()` on a date-only string. This exact
bug class (`fmtDate`/`new Date()` on a plain date string) is pervasive
elsewhere in both files for unrelated fields — not touched, out of scope,
but worth knowing it's a systemic pattern if other date-off-by-one reports
come in.

**Bug #2 — not actually a logic bug, but a real UX gap:** every create/
update/delete handler in both `NotesTab` and `GoalsTab` had a bare
`catch { }` — any failure (a validation error, a 403 from e.g. the
read-only demo-workspace guard, a network blip) failed completely silently,
with no visible change and no explanation. That's indistinguishable from
"the button doesn't work." Added a toast notification system to the portal
(reused the existing `useToast`/`Toast` component from
`components/ui/index.tsx` — already framework-agnostic, just not previously
imported into the portal bundle) and wired real success/error messages into
every Notes and Goals create/edit/delete/progress action.

**Frontend — `ClientPortal.tsx`:**
- `GoalsTab` rewritten to match `NotesTab`'s structure: collapsed-by-default
  rows grouped under date headers (new `goalDateKey`/`goalDateGroupLabel`/
  `groupGoalsByDate` helpers — sorted soonest-target-date-first, since a
  goal is forward-looking, unlike a note's backward-looking session log),
  the same search-bar styling, same row/expand pattern. Every row now always
  shows "Your goal" or "From {coach name}" (even collapsed) so it's visually
  obvious which goals are editable before a client even tries to click Edit.
- `useToast` wired in at the top level (`ClientPortal` component), passed
  down to both `NotesTab` and `GoalsTab` as `showToast`.

**Verified locally**
- `pytest apps/clients/tests.py` — 12/12, `npx tsc --noEmit` clean.
- Full live browser run (Playwright + system Chrome) against the real dev
  stack: login via real email code (Mailpit), create goal, confirm
  group-header date and expanded "Target:" date now agree, open the Edit
  form on the first (most-recent) goal in the list and confirm it
  pre-fills correctly, filter by target date and confirm exactly the goals
  with that stored date appear (3 goals matching `2026-11-20`, the one
  goal with `2026-11-25` correctly excluded). Screenshots taken at each
  step. All test goals and the scratch Playwright project deleted
  afterward — no leftover dev data.

---

## 3. Client portal — login screen redesigned ("looks AI-generated, too much dead space")

Request: the login screen felt generic/AI-template and wasted most of the
screen; wanted a more professional design, inspired by CoachHub and
Simply.Coach, and wanted to see directions before any real code changed.

**Process:** researched both competitors' marketing sites (feature
inventory landed in `new_features.md`, see below) for visual language, then
built two full-fidelity mockups as a Claude Artifact (canvas with two
side-by-side login directions) rather than guessing in code — user picked
"Direction B," then asked for the four mirrored icon-cards around the login
card to be dropped (read as cluttered/templated) in favor of something more
distinctive, then approved the result and asked to implement it for real.

**Final design — "Asymmetric Editorial":** an editorial two-column layout,
not the old `.auth-split` grid:
- Left: a large pale serif quotation mark as the one signature background
  element (not decorative circles or icon tiles), a real headline ("A quiet
  place to keep up with your own progress"), one line of supporting copy,
  a thin gold rule, and a plain-text 01/02/03 list naming concrete portal
  features (goals, session notes, resources) — no icon boxes.
- Right: the actual sign-in card, now with a thin gold gradient top accent
  instead of relying only on a drop shadow, plus a "Visible only to you and
  your coach" trust line underneath.
- Stacks cleanly under 900px (divider hidden, left column re-centers) via
  a small scoped `<style>` media-query block in the component — no new
  global CSS.

**`frontend/src/pages/portal/ClientPortal.tsx` — `LoginScreen`:** JSX fully
rewritten (both the email step and the code step); all state/handlers
(`submitEmail`, `submitCode`, error/info/loading) untouched. Deliberately
stopped using the shared `.auth-split`/`.auth-brand`/`.auth-form-*` CSS
classes for this component — those are still used by the coach-side auth
pages (`pages/auth/Login.tsx`, `Register.tsx`, etc.), so this change is
fully inline-styled and scoped to the portal only; nothing in `index.css`
touched, zero risk to the coach-side screens. Uses the workspace's real
`branding.logo_url` when set, falling back to a generated lettermark.

**Verified locally:** `tsc --noEmit` clean; live Playwright screenshots
(system Chrome) of the real dev server at 1440px and 820px widths, plus the
code-entry step — logo, headline, numbered list, card accent, and mobile
stacking all render as designed. Scratch Playwright project deleted after.

**Artifact:** both mockup directions are at
https://claude.ai/artifact/9oMpFgk7eoW8CkgMe2vQZF (private to the user) —
kept as a reference since Direction A ("Editorial Split," navy panel) was
never implemented, in case it's wanted for another screen later.

---

## 4. `new_features.md` — client portal feature-gap analysis vs. CoachHub / Simply.Coach

Added `new_features.md` (git-ignored — added `new_features.md` to
`.gitignore`'s existing "local-only reference docs" section) comparing
CoachOS's client portal against both competitors' publicly documented
feature sets. Ranked list, highest value-for-effort first:

1. **Self-serve scheduling** — `CoachAvailabilityRule` already exists
   per-client on the backend and is coach-editable; the portal just never
   reads it to let a client book a new session (today: reschedule-request
   on existing sessions only). Biggest ROI item — mostly frontend + one
   endpoint.
2. **Private, coach-invisible journal** — today every client-written note
   is visible to the coach; Simply.Coach offers a genuinely private
   journal. Would mirror the `visible_to_client` pattern, inverted.
3. **Client → coach action requests** — bidirectional task assignment;
   `Commitment` is coach-authored only today.
4. **Two-way messaging thread** — biggest item, scope as its own project.
5. **Assessments/intake forms in the portal** — `Assessment.visible_to_client`
   already exists as a field (per `CLAUDE.md`'s known-gaps section) with no
   portal endpoint ever built for it; smallest fix on the list.
6. **Progress/trend charts on Overview** — polish, not a functional gap.

Full writeup with sources in `new_features.md` itself.

---

## 5. Login screen follow-up — bigger logo, filled the remaining dead space

Request: on a tall/wide viewport the new login screen (#3 above) still left
a lot of bare cream space top and bottom, and the masthead logo felt small.

- **Masthead logo** — real `branding.logo_url` image: `maxHeight` 28→44px,
  `maxWidth` 140→220px. Fallback lettermark: 28×28→44×44px box, letter
  14px→21px, wordmark text 12px→14px in `var(--ink-soft)` (was `--muted`,
  too faint at the larger size).
- **Oversized background word** — new absolutely-positioned `"progress"` in
  italic Cormorant Garamond behind the left column, `min(26vw, 400px)`,
  2.8% opacity in `var(--navy)`. First pass spanned the full width behind
  both columns and bled past the card's edge unevenly (stray letters
  visible past the divider); re-centered (`left: 38%`) and sized down so
  it sits fully behind the left column and never crosses under the card.
  Hidden under 900px via the same scoped media-query block the divider
  already uses (`.portal-login-word { display: none }`) — no value at
  phone width, just noise.
- **Footer** — new `"Powered by CoachOS"` line anchored to the bottom of
  the page (the page container is now `position: relative` with the
  background word and content both `zIndex: 1` above it), so the viewport
  reads as one composed page end-to-end instead of a content block
  floating in empty space with nothing below it.

**Verified locally:** `tsc --noEmit` clean; live screenshots (system Chrome
via Playwright) at 1920×1040 (confirmed the word no longer bleeds past the
card) and 780×1000 (confirmed it's hidden and the layout still stacks
correctly on mobile). Scratch Playwright project deleted after.

---

## 6. Calendar — booking overlap error now names the conflicting session

Request: a coach couldn't book Oct 5 at 10:30 even though the 10:00 session that
day was cancelled.

**Investigation:** the cancelled session was *not* the blocker. The exclusion
constraint (`activity_no_overlapping_coach_bookings`) only counts
`scheduled`/`rescheduled` rows, and the 10:00 row really is `cancelled`. The
requested 10:30–12:22 slot overlapped a *different*, still-scheduled
11:00–12:15 session — the generic "That time overlaps another session" message
just didn't say so.

- `backend/apps/activities/views.py` — `_reraise_if_overlap` now parses the
  Postgres `DETAIL` line ("conflicts with existing key (...)=([start, end), coach)")
  via `_EXISTING_KEY_RE`, looks up that row, and returns e.g. *"That time
  overlaps 'call' with shreya bhatlapenumarti, Mon, Oct 5, 11:00 AM – 12:15 PM,
  already on this coach's calendar."* Times in the coach's `user_timezone`.
  Parsing the DB's own error (rather than re-querying by the request's times)
  also identifies the right row when the clash is in a recurring-series
  occurrence. Falls back to the old generic message if anything can't be
  resolved — never a 500.
- Covers every path that already used the helper: create, update,
  `confirm_reschedule`.

**Verified:** reproduced the real conflict inside a rolled-back transaction —
message names the 11:00 session; fallback path tested; `pytest apps/activities` green.

---

## 7. Calendar — status shown as labelled chips, status legend replaces type legend

Request: the coloured dots on calendar blocks were confusing; show the real
status, and replace the Activity Types legend with a status legend.

`frontend/src/pages/coach/Calendar.tsx`:
- New `STATUS_STYLE` map keyed by `displayActivityStatus()` (Confirmed,
  Pending, Rescheduled, Late, Completed, Missed, Cancelled) — each with a
  background, accent and one-line meaning. Accents reuse `STATUS_HEX` so the
  grid, legend and pills elsewhere agree.
- Blocks are now coloured by **status**, not activity type (the old type
  legend used Settings' per-type colours, which never matched `TYPE_CONFIG`'s
  block colours).
- The unlabelled dot is replaced by a small worded chip (CONFIRMED / PENDING …).
- Only **Cancelled** is struck through — Pending used to be struck and dimmed
  too, which made pending sessions look cancelled.
- Pending and Rescheduled ("needs action") get a dashed left edge
  (`.ev-dashed`); hover tooltip shows status + meaning.
- Right sidebar: "Activity Types" legend removed → "Session Status" legend with
  swatches drawn exactly like blocks plus a one-line meaning each. The now-unused
  activity-types query in that component was removed.

### Follow-up — week/day blocks get the same full border as month view
- `.fc-timegrid-event` now has a 1px status-coloured outline on all sides plus
  the 3px left edge (was left edge only), matching `.fc-daygrid-event`.

---

## 8. Emails — every email editable, white header + logo by default

Request: make all emails configurable, default to a white header with logo
(as the invoice email already was), and let the coach edit the entire message.

### 8a. Shared, fully-editable body (`backend/tasks/email_html.py`)
- `_email_shell` default `header_bg` navy → **white**. On a light header the
  logo sits directly on it (no white "card"), the gold accent bar is replaced by
  a 1px hairline — the invoice email's look. Dark headers keep the old style.
- New `compose_body()` — one renderer for eyebrow + heading, message, details
  card, action buttons, add-to-calendar box, closing and sign-off. Every piece
  is overridable from the template's `style`:
  `heading_text`, `eyebrow_text`, `signoff_text`, and
  `show_heading` / `show_details` / `show_actions` / `show_calendar` / `show_signature`.
  Plain-text messages are escaped and split into real paragraphs
  (`rich_text_html`); older templates containing HTML keep rendering as HTML
  (`has_legacy_html`). Heading/eyebrow/sign-off accept placeholders.
- Builders rewritten on `compose_body` (signatures unchanged, so no caller
  changed): confirmation, reschedule, reminder, cancellation, team invite,
  payment receipt, pipeline alert, portal invite.
- **Mandatory actions:** the response buttons (Confirm / Reschedule / Cancel),
  Accept-invitation, Access-portal and View-pipeline buttons are forced on
  (`{**s, "show_actions": True}`) — a template cannot remove the thing the
  recipient needs to act.

### 8b. Hardcoded emails turned into templates (`backend/tasks/email_notices.py`, new)
Previously plain-text-only, unbranded and uneditable. Now each is a use case in
Settings → Emails, rendered in the same shell via `send_notice()` /
`render_notice()`:
- To clients: Session Cancelled, Reschedule Request Received, Reschedule
  Declined (`{message}` = the coach's note), Goal Shared, Note Shared,
  Pipeline Check-in (see §12).
- To the coach: Coach copy — Session Booked / Reminder / Updated / Cancelled,
  Client Confirmed Attendance, Client Cancelled Session, Client Calendar RSVP,
  Client Reschedule Request, Payment Failed, Contract Signed.
- `backend/tasks/email.py` — every one of those send paths now goes through
  `send_notice` (shared helpers `_session_notice_values`, `_session_notice_rows`,
  `_coach_notice`). Client-typed text (e.g. a reschedule note) is escaped.
- Portal Invite was already template-driven on the backend but missing from the
  Settings list — now listed.

### 8c. Starter content — what "Built-in" sends (`backend/tasks/email_starters.py`, new)
Follow-up request: start every email (except invoices) with only header + logo
switched on, everything else editable text.
- `STARTERS` — subject / message / closing for every use case except invoice and
  client communication. Details are written into the message ("What: … / When: …"),
  the closing ends with "Thanks, {workspace_name}". `STARTER_STYLE`: header +
  logo on; heading, details card, calendar box, sign-off, footer **off**;
  actions on.
- `_resolve_generic_template` (`tasks/email.py`): with nothing assigned in
  Settings, sends the **starter** — the same content the editor opens with and
  Settings labels "Built-in", so preview, editor and sent email always match.
- **Behaviour change:** the legacy `workspace.email_templates` dict is no longer
  read for use cases that have a starter (it's kept for invoice / client
  communication). It held content the Settings UI never showed; for Rass
  consulting it was old default copy plus test data ("RECEIPTMARK…",
  "session scheduled :"), and it was silently overriding what Settings called
  "Built-in". Templates customized in Settings are unaffected.
- Plain-text alternatives are now built from the same message/closing text
  (`_template_plain`) instead of separate hardcoded wording.

### 8d. Settings API (`backend/apps/settings_app/views.py`, `urls.py`)
- New `GET /api/settings/email-use-cases/` → `{notices, starters}` — the
  frontend's single source for notice labels/placeholders and starter content.
- `email_preview`: renders every new type; accepts the new `style` params;
  preview of session emails now shows sample response buttons and calendar box
  (previously omitted because the preview passed no URLs, though real sends
  always have them); sample values for all new placeholders.

### 8e. Bugs fixed along the way
- Pipeline alert's "View Pipeline" button took its colour from `header_bg` →
  white-on-white once the header became white. Now fixed navy.
- `send_payment_receipt_email` referenced `timezone` without importing it —
  a receipt sent with no recorded payment row would crash. Fixed.
- Invoice/receipt details tables used `header_bg` for their top border
  (invisible on white) — now fixed navy.

---

## 9. Settings → Emails screen redesigned

Request: the "Still on built-in defaults" chip wall was hard to read; make it
professional and simple; the copy icon was unclear.

`frontend/src/pages/coach/Settings.tsx` (`GenericTemplatesTab`):
- Header "Emails" with "N of M customized" summary and + New Template.
- Tabs by recipient: **To clients · To you & coaches · To team members ·
  Template library**, each with a count.
- One row per email: name, a plain-English "when it's sent" line
  (`USE_CASE_WHEN`), the current subject, a **Built-in** / **Customized ·
  {template}** status, and a single **Edit** button. The confusing duplicate
  icon was removed from email rows (it saved a copy to the library); duplicate
  remains in the Template library tab. Contract Agreement quick-start moved
  into the library tab.
- Notice use cases, placeholders and starter copy are loaded from the API
  (`frontend/src/hooks/useEmailUseCases.ts`, new) and merged with the static
  list (`useAllUseCases`).
- Editor: new **Heading** (label + heading, Show toggle), **Message**,
  **Closing**, **What else to include** (details card, add-to-calendar box,
  sign-off text) controls; response buttons shown as "always included". Header
  colour picker defaults to white. Opening a saved session template fills
  blank subject/heading/sign-off with the built-in words (`withBuiltinText`) so
  nothing in the preview is hidden from the editor.

---

## 10. Calendar → "Edit default template" (confirmation) popup

Request: the popup showed parts of the email that weren't editable; fields were
blank while the preview showed text; buttons should be mandatory; the popup
closed on an outside click and lost work.

`frontend/src/components/EmailEditModal.tsx`:
- Opens with the server starter (waits for it — brief "Loading…"); "Reset to
  default" restores the starter.
- Same Heading / Message (with insertable placeholders) / Closing / Sign-off /
  Also-include controls as Settings; Confirm/Reschedule/Cancel shown checked and
  disabled ("always included").
- **No accidental loss:** `Modal` gained `dismissible` (`components/ui/index.tsx`,
  default `true`, so every other modal is unchanged). This popup passes
  `false` — outside click and Esc do nothing; × and Cancel confirm before
  discarding *unsaved* changes (tracked against the last saved snapshot).
- `frontend/src/constants/emailStarters.ts` (new) now holds only
  `BUILTIN_TEXT` (built-in headings); starter content lives on the server.

Deferred by request: replacing this popup with Preview + "Edit template ↗"
(opening Settings → Emails in a new tab) — "make it stable first".

---

## 11. Settings → Pipeline redesigned — per-recipient follow-ups and schedules

Request: notify me, the client and the coach; add an end; let each choose its
frequency — then: frequencies should be "Once a week" / "Once a month" on a
chosen day (e.g. every Monday, the 15th / first Monday), sent at 8 AM Eastern.

### Backend
- `apps/pipeline/models.py` — `PipelineStageConfig`: `owner_frequency`,
  `notify_coach`, `coach_frequency`, `client_frequency`
  (`daily | weekly | monthly`) and `alert_schedule` (JSON, per recipient:
  `weekday`, `month_mode` = `day | nth`, `month_day`, `month_week` (1–4 / -1 =
  last), `month_weekday`). `Deal`: `coach_alert_sent_at`, `client_alert_sent_at`
  (owner keeps `pipeline_alert_sent_at`); all reset in `advance_stage()`.
- Migration `0012_stage_followup_recipients_schedule` (single, merged) —
  includes a data step: stages that already emailed clients stay **daily**
  (new stages default client → weekly), and each deal's last client alert is
  carried over so no duplicate goes out after deploy.
- `tasks/pipeline.py` — `dispatch_pipeline_alerts` rewritten:
  - Each recipient gets **their own email** on their own schedule
    (`_scheduled_today`: daily; chosen weekday; chosen date — clamped to month
    end — or Nth/last weekday), never twice in one day.
  - **8 AM in each workspace's own timezone** (`SEND_HOUR = 8`): beat now runs
    hourly (`crontab(minute=0)`, `config/settings/base.py`) and a workspace is
    only processed during its local 8 AM — 8 AM Eastern year-round, EST and EDT.
    The external cron endpoint (`/api/internal/pipeline-alerts/`,
    `config/urls.py`) passes `respect_send_hour=False` and sends immediately.
  - Assigned coach skipped when they are the owner (no duplicate).
  - **"Notify me" is now respected** — previously the owner was emailed even
    with it off.
- `tasks/email.py` — `send_pipeline_alert(deal_id, recipient="owner"|"coach")`
  (returns bool) and new `send_pipeline_client_checkin`.
  **Bug fixed:** with "notify client" on, the client used to be added as a
  recipient of the *internal* alert ("Follow-up needed: {client} — Proposal Sent
  (9 days)…"). The client now gets a separate friendly **Pipeline Check-in**
  (editable in Settings → Emails), replies going to the coach.
- `apps/settings_app/serializers.py` — exposes the new fields.

### Frontend (`Settings.tsx` → `PipelineTab`)
- Header + description; one row per stage with order number, colour, a plain
  summary ("After 14 days · until it moves stage") and recipient tags
  ("You · Daily", "Coach · Every Monday", "Client · 15th of each month",
  "Client · First Monday of the month"). Built-in stages no longer show a
  Delete button that could only error.
- Add/Edit share one `StageForm`: Stage (name, position, colour) →
  Follow-up emails (on/off, Start after N days, Stop after N days / blank = until
  it moves) → Who gets them: You / Assigned coach / Client, each with a checkbox,
  **Daily · Once a week · Once a month**, and a `SchedulePicker` (weekday, or
  date / First–Last + weekday). Save blocked if follow-ups are on with no
  recipient.
- The old "Max reminders to client" field is replaced by the client's own
  schedule (saved as `null`; the backend still honours an existing value).

---

## 12. Verification, deploy notes, known gaps

**Verified locally**
- `pytest` — **27 passed** (with Celery tasks eager). New tests:
  `test_pipeline_schedule_rules` (weekday, date incl. Feb clamp, first Monday,
  last Friday), `test_pipeline_alerts_per_recipient_and_schedule` (three
  separate emails, client gets check-in not alert, no same-day repeat, off-day
  sends only daily), `test_pipeline_owner_not_emailed_when_notify_me_off`,
  `test_pipeline_alerts_only_at_8am_workspace_time` (7 AM vs 8 AM in EDT and EST).
- `tsc --noEmit` clean; `pyflakes` clean on all touched backend files.
- Every email type rendered through `/api/settings/email-preview/` (no navy
  header, no unfilled placeholders, heading/sign-off overrides and hide toggles
  honoured); real sends to Mailpit for all session/notice emails inside a
  rolled-back transaction; HTML screenshots reviewed (headless Chrome).
- Not clicked through in a browser this session: the new Settings → Emails,
  Settings → Pipeline screens and the calendar border change.

**Deploy notes**
- Run migrations (`make deploy` does): `pipeline.0012_stage_followup_recipients_schedule`.
- Celery worker/beat must restart to load the new email code and the hourly
  pipeline schedule (`make deploy` restarts them). `django_celery_beat` updates
  the `dispatch-pipeline-alerts` row from settings on beat start — verify it
  shows `0 * * * *` afterwards.
- Behaviour changes users will notice: emails now default to a white header;
  un-customized emails send the new plain starter wording; legacy hidden
  templates are ignored (except invoice); pipeline client emails are a separate
  check-in.

**Known gaps / follow-ups**
- `test_smoke_e2e.py::test_full_client_lifecycle_smoke` fails when run against
  the dev compose stack without eager Celery — `.delay()` goes to the real
  worker (dev DB, not the test DB). Pre-existing test-setup issue, not caused by
  this work; passes with `task_always_eager`.
- "Reset to default" exists only in the Calendar popup; in Settings, removing a
  customization means deleting its template in the Template library.
- Saved customized templates (e.g. "Team Invite2") keep their own look and are
  not migrated to the starter.
- Open suggestions: weekdays-only daily follow-ups, "same schedule for everyone"
  per stage, "Next follow-up" date on each deal, Settings tab-bar overflow,
  replacing the email popup with a link to Settings → Emails.

---

## 13. Client portal — clients can mark a coach-set goal complete

Request: "not able to edit the goals in client portal" — on a goal shown as
"From Arti Kamboj".

**Investigation:** not a bug. Goals the coach created were deliberately read-only
in the portal (only the client's own goals had Edit/Delete; see
`change_log_2026-10-03.md`), but the screen didn't say so, so it looked broken.
Decision (user): let the client **mark a coach goal complete / reopen it** and log
progress; title, description, target date and delete stay coach-only.

**Backend — `backend/apps/portal/views.py`**
- `PortalGoalDetailView.patch`: now also finds shared coach goals. For those, the
  only accepted change is `{"status": "completed" | "active"}`; anything else →
  400 *"You can mark this goal complete or reopen it; only your coach can change
  its details."* The client's own goals keep full edit. Delete still only works
  on the client's own goals (404 otherwise). Unshared coach goals → 404.
- `PortalGoalsView.get`: coach goals are listed when shared and **active or
  completed** (was active only — a goal the client completed would otherwise
  disappear from their portal). Paused stays hidden.
- Small refactor: `_get_goal(..., own_only)` and `_respond()` helpers.

**Frontend — `frontend/src/pages/portal/ClientPortal.tsx` (`GoalsTab`)**
- Expanded coach goal shows: *"Set by {coach} — you can log progress and mark it
  complete. To change the goal itself, ask your coach."*
- New **✓ Mark complete / Reopen** button next to **+ Progress** on every goal
  (`toggleComplete`), with success/error toasts.

**Tests — `backend/apps/clients/tests.py`**
- `test_portal_client_cannot_edit_coach_goal` updated: title edit → 400 and
  unchanged; delete → 404; mark complete → 200 and still listed as completed;
  reopen → 200; unshared coach goal → 404.

**Verified:** `pytest` 27 passed (Celery eager); `tsc --noEmit` clean; `pyflakes`
clean. Not clicked through in the portal UI in a browser.

**Suggested follow-up:** email the coach when a client completes one of their
goals (new "Client Completed a Goal" template in Settings → Emails).
