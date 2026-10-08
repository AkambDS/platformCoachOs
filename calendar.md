# CoachOS — Calendar & Scheduling Design

Reference for the scheduling/calendar feature: what's actually built today,
walkthroughs of what each status/action does, the open questions you raised,
and design options for the gaps — written to decide on before anything gets
coded. Reviewed from source on 2026-10-02. Revisited 2026-10-03 with answers
to §5's open questions — see §6 for what's now locked in and what that
decision newly surfaces.

---

## 1. What exists today

### 1.1 The `Activity` model (`backend/apps/activities/models.py`)

One row per session/appointment. Key fields, grouped by purpose:

| Group | Fields |
|---|---|
| Core | `coach`, `client`, `activity_type`, `title`, `start_at`, `end_at`, `location`, `notes`, `meeting_link` |
| **Status** | `status` — the one field that drives almost everything (see 1.2) |
| Client response | `client_confirmed`/`client_confirmed_at` (via tokenized email link), `client_rsvp_status`/`client_rsvp_synced_at` (via real Google Calendar attendee sync — a *separate* signal from `client_confirmed`) |
| Pending reschedule | `requested_start_at` — a client-proposed new time, **staged but not applied** until the coach confirms it |
| Recurrence | `rrule`, `repeat_until`, `recurrence_id` |
| External sync | `google_cal_uid`, `caldav_uid` |
| Reminders | `reminder_24h_sent`/`_at`, `reminder_1h_sent`/`_at` |
| Audit | `edit_history` (JSON list), `confirmation_sent_at`, `cancellation_sent_at` |

Two **separate status-like axes** exist on the same row, which matters a lot
for §3.3 below:
- `Activity.Status`: `scheduled`, `completed`, `late`, `rescheduled`, `missed`, `cancelled`
- `Activity.RsvpStatus`: `needsAction`, `accepted`, `declined`, `tentative` (this is Google Calendar's attendee-response vocabulary, stored in `client_rsvp_status`)

### 1.2 Related models

- **`CoachAvailabilityRule`** (`activities/models.py`) — a weekly open-hours
  block (`weekday`, `start_time`, `end_time`), scoped per **(coach, client)
  pair** — a confirmed, deliberate design choice (per the model's own
  docstring), not a coach-wide setting. Managed by the coach on each client's
  detail page ("Coach Availability" tab, `ClientDetail.tsx`).
- **`GoogleCalendarWatch`** — one per coach, holds the push-notification
  channel + `sync_token` for incremental Google Calendar pulls.

### 1.3 What can create/change an `Activity.status`, and who triggers it

| Actor | Action | What happens |
|---|---|---|
| Coach | Direct edit (change time/fields) | If editing a `rescheduled` activity without explicitly changing status, it silently flips back to `scheduled`. Detects time-change vs. cancellation and fires the matching email; resets reminder flags. |
| Coach | **Confirm new time** (`confirm_reschedule`) | Applies the staged `requested_start_at` to `start_at`/`end_at`, clears it, sets `status=scheduled`, resets reminders, re-syncs to Google Calendar, emails the client. This is the *only* place a client-proposed time actually takes effect. |
| Coach | **Cancel** (`scope`: this / future / all) | `this`: sets `status=cancelled` on one row. `future`/`all`: bulk-updates the whole recurrence series by `recurrence_id`, **no per-row validation on the bulk path**. Emails per cancelled id. |
| Coach | Mark Missed | Sets `status=missed`. |
| Client | Token-link **Confirm** (no login) | Does *not* touch `status` — only sets `client_confirmed`/`client_confirmed_at`. |
| Client | Token-link **Cancel** (no login) | Sets `status=cancelled` directly. |
| Client | Token-link **Reschedule** (no login) | Sets `status=rescheduled`; if the coach has `CoachAvailabilityRule`s for that client, offers a real slot picker and stores the pick in `requested_start_at` (staged, not applied — see Coach "Confirm new time" above). Falls back to a free-text request if no rules exist. |
| Client | **Portal** reschedule request | Sets `status=rescheduled` directly; **free-text only, no slot picker** — a different, narrower path than the token-link one above. Blocked if the activity is already cancelled/completed/missed. |
| Google Calendar (automated) | Attendee RSVP changes | Updates `client_rsvp_status`; if `accepted`, also sets `client_confirmed` (unless already set). **Never touches `Activity.status`.** |

### 1.4 Google Calendar sync (`backend/tasks/calendar.py`)

One-way push on every create/update (`sync_to_google_calendar`) — unconditional
insert/update, **no conflict check against the coach's real Google Calendar
busy times before writing**. A separate pull path
(`process_calendar_notification`) reacts to Google's push-ping, pulls the
delta via `syncToken`, and updates `client_rsvp_status` only — it never
creates, blocks, or rejects an `Activity`.

### 1.5 Frontend status display (`Calendar.tsx` + `components/ui/index.tsx`)

**Two independent, overlapping indicators are shown per activity today:**

1. A general status pill (`STATUS_COLOURS` + `displayActivityStatus`):
   | Raw status | Displayed as | Color |
   |---|---|---|
   | `scheduled` (no pending request) | **Confirmed** | blue |
   | has `requested_start_at` | **Pending** | gold |
   | `completed` | Completed | green |
   | `late` | Late | gold |
   | `rescheduled` | Rescheduled | blue |
   | `missed` | Missed | red |
   | `cancelled` | Cancelled | grey |

2. A second, independently-computed **client-response** icon
   (`rsvpStatus()` in `Calendar.tsx`), checked in this order: cancelled → ✕
   red; pending request → ⏳ gold; `rescheduled` → ↻ blue; RSVP declined → ✕
   red; RSVP tentative → ~ gold; confirmed (either `client_confirmed` or RSVP
   accepted) → ✓ green; confirmation email sent but no response yet → ⋯
   "Awaiting Response" grey.

Cancelled/missed rows are additionally faded (grey background/border/text).
**Coach-visible actions**: "Mark Missed" and "Cancel" (gated to
scheduled/rescheduled/late); "Confirm New Time" (only shown when
`requested_start_at` is set). **There is no "Reschedule" button for the
coach** — a coach reschedules by directly editing the time, which routes
through the same update path as any other edit.

### 1.6 Client-facing self-serve booking

**Does not exist.** Nothing lets a client pick an open slot and create a
brand-new session, Calendly-style. The only client-initiated flows are
*reschedule requests* against an *existing* activity (§1.3) — both produce a
proposal the coach must confirm, never an auto-applied booking.

### 1.7 `compute_available_slots` (`backend/apps/activities/availability.py`)

This is the **only** overlap/availability-aware logic in the codebase, and
it's narrowly scoped: it builds the slot picker for the token-link reschedule
flow only. How it works:
- Looks up `CoachAvailabilityRule`s for the client's current coach + that
  specific client (falls back to the activity's own coach if the client has
  none assigned).
- Projects those weekly blocks forward over a rolling 30-day window.
- Steps candidate slot starts every 15 minutes (deliberately independent of
  session length, so offered slots can overlap each other — intentional,
  per the file's own comment).
- Excludes any candidate overlapping the coach's **other** `scheduled`/
  `rescheduled` activities — this busy-check is coach-wide across *all* that
  coach's clients, not scoped to the one client.
- Computed fresh on every call — nothing is cached or persisted.

So: **the pieces for "combine the client's availability with the coach's
confirmed-session calendar" partially exist already** — the coach-wide busy
check is already folded in — but two things are missing relative to what you
asked for: (a) "the client's own availability" as a concept the *client*
declares doesn't exist at all — everything today is coach-authored rules
about that client, not the client's own stated free times; (b) this logic
only ever runs for a *reschedule*, never for an initial booking, because
initial booking doesn't exist yet (§1.6).

### 1.8 Concurrency today

**No guard exists anywhere.** Confirmed by direct inspection: no DB
constraint (`unique_together`, exclusion constraint) on `Activity` touching
`(coach, start_at, end_at)`; no `select_for_update()` calls in any of the
write paths (`views.py`, `serializers.py`, `public_views.py`,
`availability.py`); no application-level lock. `compute_available_slots`'s
busy check is read-only and advisory — it decides what to *offer*, and is
never re-checked at save time.

---

## 2. Your specific questions, answered against the current code

**"What if two clients pick the same schedule?"** — Right now, both
succeed. Two concurrent requests that land on the same coach + overlapping
time (via create, update, or `confirm_reschedule`) both get written and both
sync to Google Calendar. There's no race-condition window that's narrower or
wider than normal request latency — it's simply unguarded, full stop, on
every write path listed in §1.3.

**"How do we keep the coach-to-client availability calendar updated, and
when?"** — There isn't a stored "availability calendar" to update — it's
computed live, on every request, from two live sources: the
`CoachAvailabilityRule` rows (updated whenever the coach edits them on the
client's page) and a live query of the coach's other `scheduled`/
`rescheduled` activities. So in one sense it's always current by
construction (no caching to go stale) — but it also means it's recomputed
from scratch every time it's needed, and it's only ever invoked from the
reschedule flow, never from a persistent "my calendar" view a client could
browse.

**"What statuses does the coach see?"** — See §1.5's two tables. Worth
naming directly: there are **two parallel, independently-maintained status
displays** on the same activity today (the general pill and the
client-response icon), computed by separate functions with separately
hardcoded color/priority logic. That's not wrong, but it's a real
maintenance seam — see §4.4.

**"Confirm / reschedule / cancel — what happens?"** — Fully walked through
in §1.3's table, per actor.

**Colors for confirmed / rescheduled / awaiting response** — current
mapping, pulled from §1.5: **Confirmed** = blue (pill) or green (✓ icon,
when the client has actually responded — note these are two different
"confirmed"s: pill-confirmed means "not pending a reschedule," icon-confirmed
means "client said yes"). **Rescheduled** = blue (pill) / ↻ blue (icon).
**Awaiting response** = ⋯ grey (icon only — no pill equivalent). This
inconsistency (confirmed meaning two different things depending on which
indicator you're looking at) is worth resolving — see §4.4.

---

## 3. Known gaps, named plainly

1. **No double-booking prevention** anywhere in the write path (§1.8).
2. **Two overlapping, inconsistently-colored status systems** on one entity
   (§1.5, §2).
3. **No self-serve initial booking** — only reschedule-a-pending-session
   exists (§1.6).
4. **"Availability" today = coach describing a client's hours, not the
   client describing their own** — there's no concept of the client saying
   "I'm free these times," only the coach pre-authoring a weekly template
   per client (§1.7).
5. **`compute_available_slots` is reschedule-only** — the coach-wide busy
   check it already does would need to be reachable from an initial-booking
   flow too, if one gets built.
6. **Bulk cancel (`future`/`all`) has no per-row validation** — worth a look
   if that ever needs to skip, say, already-completed sessions in a series.

---

## 4. Design options for the gaps (not implemented — for discussion)

### 4.1 Preventing double-booking — the core scalability/race-condition question

Three standard approaches, from strongest to weakest guarantee:

**Option A — Postgres exclusion constraint (recommended as the backstop).**
Using the `btree_gist` extension, add a `GistIndex`/`ExcludeConstraint` on
`Activity` over `(coach_id, tstzrange(start_at, end_at))` filtered to
`status IN ('scheduled', 'rescheduled')`. The database itself rejects any
overlapping insert/update for the same coach, atomically, regardless of
which of the four+ current write paths (`create`, `update`,
`confirm_reschedule`, bulk cancel, public token views, portal respond) is
the one racing — nothing can bypass it because it's enforced below the ORM.
This is the single most important piece for correctness: it doesn't matter
how many *more* ways to write an Activity get added later, the DB guarantees
no overlap.

**Option B — `select_for_update()` + check-then-write in each view.**
Wrap each write path in a transaction that locks the coach's relevant rows
first, then checks for overlap before saving. Works, but every current and
future write path has to remember to do this correctly — it's a discipline
problem, not a guarantee, and this codebase already has at least five
separate places that can move a session's time.

**Option C — Optimistic concurrency (version/timestamp check, conflict
surfaced to the user).** Good fit for low-contention, user-facing retry
flows ("this slot was just taken, pick another") — but it only *detects*
the conflict after the fact; it doesn't prevent the double-write, and needs
UI to handle the rejection gracefully.

**Recommendation**: A as the non-negotiable backstop (cheap to add, can't be
forgotten), with a friendly application-level pre-check (reusing the same
overlap query `compute_available_slots` already has) so the common case
fails with a clear "that time was just booked" message instead of a raw
database error. Belt and suspenders, not either/or.

### 4.2 Scalability of the slot-computation algorithm

Current approach: discretize a 30-day window into 15-minute steps and
individually test each candidate against the rule set + busy set. At
CoachOS's actual scale (one coach's own calendar, computed on-demand per
reschedule request) this is fine — it's a few thousand candidate checks
against a handful of rule/activity rows, well within a single request's
budget.

**Where it would need to change**: if this ever runs on every page load
(not just when a reschedule link is opened) or against a much larger
per-coach activity volume, the fix isn't a smarter per-slot check — it's
**not recomputing from scratch every time**. Cache the computed slot list
keyed by `(coach_id, client_id, hash of that coach's rule set)`, invalidated
whenever a `CoachAvailabilityRule` changes or any of that coach's Activities
change. That's a cache-invalidation problem, not an algorithmic one, and
isn't worth building until there's an actual access pattern that calls for
it.

### 4.3 "Best algorithm for quick calendar updates"

Two different problems hide under this question — worth separating:

- **Conflict checking** (is this one candidate time free?): an interval
  overlap test is a single indexed range query — `start_at < candidate_end
  AND end_at > candidate_start` — effectively O(log n) given an index on
  `(coach_id, start_at, end_at)`. **Worth confirming that composite index
  actually exists** (not confirmed one way or the other in this review) —
  that's the single highest-leverage, lowest-risk change regardless of
  anything else here.
- **Generating a whole list of open slots** (the reschedule picker's actual
  job): the standard efficient approach once rule/busy-interval counts grow
  is a **sweep-line / interval-merge** — sort all "available" rule-blocks
  and "busy" activity-blocks by start time once, sweep across in a single
  O(n log n) pass subtracting busy from available, instead of testing every
  discretized 15-minute candidate individually (today's O(window ÷ step)
  approach). This is the textbook calendar-availability algorithm (the same
  shape as Google/Outlook's own free-busy computation) and is worth adopting
  if/when slot generation ever needs to cover multiple coaches or a much
  longer window at once — not urgent at today's per-request, per-coach
  scale, but the right direction to grow into rather than optimizing the
  discretized version further.

### 4.4 Unifying the status displays

Worth deciding, not just inheriting: should there be **one** status concept
a coach sees per activity, with the current pill + icon collapsed into a
single, consistently-colored indicator? The underlying data (`status`,
`requested_start_at`, `client_confirmed`, `client_rsvp_status`) doesn't need
to shrink — just the number of independent display functions deriving a
color from it.

---

## 5. Decisions worth making before writing any code

- ~~Is self-serve initial booking... in scope?~~ **ANSWERED, see §6.1.**
- ~~Should `CoachAvailabilityRule` become coach-wide by default...?~~
  **ANSWERED, see §6.3: per-client stays, confirmed intentional** — a coach
  wants genuinely different hours for different clients, not one shared
  template.
- Is "the client's own stated availability" (as opposed to coach-authored
  rules about a client) something you actually want, or is coach-authored
  availability the permanent design? *(still open)*
- Option A vs. B vs. C in §4.1 for race conditions — **refined by §6.2**, not
  fully replaced: the new pending-block mechanism handles the common case
  cheaply, but doesn't remove the case for Option A as a backstop.
- Whether to collapse the two status-display systems (§4.4). *(still open —
  separately, §6.1 confirms the "existing meeting shows a different color
  while a reschedule is pending" half of this is already built, see below.)*

Once the still-open items above are decided, the next step is turning
everything in §6 into an actual implementation plan — this document is
deliberately stopping short of that.

---

## 6. 2026-10-03 — decisions made, and what they newly surface

### 6.1 Scope is locked: reschedule-only, no self-serve initial booking

Confirmed: "coach schedules, client can request to move it" is the permanent
model. A client's only self-serve action is picking a slot *for an existing
session* on the token-link reschedule page (§1.3) — never creating a
brand-new booking from nothing. §1.6/§3 item 3 are no longer open questions,
they're the confirmed permanent shape of the feature.

Two things you described as missing are, worth confirming, **already
built** (§1.5, verified against the actual code, not re-implemented here):
- The existing session a client has asked to move already renders in a
  visually distinct way on the coach's calendar while unconfirmed — struck
  through, dimmed to ~65% opacity, with its own gold "⏳ Pending" indicator
  (`Calendar.tsx`'s `eventContent`, driven by `requested_start_at` being
  set) — not just a same-colored block with a small icon.
- `requested_start_at` already exists as the staging field for a client's
  proposed time, exactly as described — nothing applies to the real
  `start_at`/`end_at` until the coach's explicit confirm action.

### 6.2 New requirement: a pending request blocks the slot for every other client of that coach

This is a real, specific design decision — not just restating what
`compute_available_slots` already does. Today (§1.7), the function's
busy-check only excludes a candidate slot if it overlaps another
**confirmed** activity (`status in [scheduled, rescheduled]`, using that
row's real `start_at`/`end_at`). It does **not** currently look at other
clients' *pending* `requested_start_at` values at all — so right now, two
different clients of the same coach could independently request overlapping
times and both would see the slot as open, right up until the coach
confirms one of them.

**The fix, in plain terms** (no code — this is the shape of the change for
when §4.1's decisions are finalized): when computing slots for client A's
reschedule, the busy-set that candidates get checked against should be the
union of two things, both scoped to that coach:
1. Every other activity's **confirmed** `[start_at, end_at)` — what's
   already there today.
2. Every other activity's **pending** `[requested_start_at, requested_start_at + its own duration)`
   — new. The moment client B requests a time, it becomes unavailable to
   every other client of that same coach on their *next* slot fetch — the
   same "live, recomputed every time, nothing cached" model §1.7/§2 already
   describes, just fed a wider input.

This is cheap (one more `Activity` filter, same shape as the existing busy
query) and it's the right *first* layer of defense — it closes the realistic
case (two clients browsing the picker minutes apart) using the mechanism
that already exists, rather than only reaching for database-level locking.

**What this decision newly surfaces — a gap that didn't exist before this
rule was proposed**: there is currently no way to *decline* a pending
request, and no expiry on one. If a coach simply never acts on client B's
proposal (ignores it, the client changes their mind, etc.), `requested_start_at`
stays set indefinitely — and under the new rule above, that slot would stay
blocked for every other client **forever**, even though nobody is actually
going to use it. Two things worth deciding alongside §4.1:
- A **Decline** action (mirrors Confirm, but clears `requested_start_at`
  without touching `start_at`/`end_at`) — gives the coach a way to release a
  slot they don't intend to honor, instead of their only two options being
  "confirm it" or "manually edit the activity's time to anything, which
  happens to also clear it as a side effect" (today's only escape hatch,
  and not an obvious one).
- An optional **TTL on pending requests** (e.g., auto-clear
  `requested_start_at` if untouched for N days) as a safety net for the
  coach forgetting entirely — belt-and-suspenders with Decline, not a
  replacement for it.

**Net recommendation, combining this with §4.1**: three layers, cheapest
first — (1) pending-blocks-everyone as described above, handles the common
case for free; (2) a Decline action + TTL, so a forgotten request doesn't
permanently squat on a slot; (3) the Postgres exclusion constraint from
§4.1's Option A, kept as the hard backstop for genuine simultaneous
confirms (the one case (1) can't catch, since it's a read-time check, not a
write-time lock). None of these three are mutually exclusive, and none of
them require ripping up what's already coded — (1) extends an existing
query, (2) adds a sibling action to the existing Confirm one, (3) is a
pure-addition migration.

### 6.3 Per-client availability stays — confirmed intentional, plus a new confirm-time check

Confirmed: a coach genuinely wants different hours for different clients
(e.g. a VIP client gets more open slots than a standard one) — not one
shared weekly template with per-client overrides layered on. No change to
`CoachAvailabilityRule`'s existing `(coach, client)` scoping; §1.2's model is
already built the right way for this.

**New requirement on top of that**: when a reschedule is actually being
applied — i.e. at `confirm_reschedule` time, not just when the slot was
originally offered to the client — re-check that the proposed time still
falls inside *that client's* current `CoachAvailabilityRule` windows for
that coach, and only then apply it.

Why this matters as a distinct check from everything in §6.2: §6.2 is about
two *clients* colliding with each other. This is about *time passing*
between offer and confirm — a coach can edit or delete their availability
rules for a client at any point (§1.2, the "Coach Availability" tab), and a
request can sit pending for a while before the coach gets to it (more likely
now that there's no TTL yet, per §6.2). If the coach narrows or removes
Tuesday 2–4pm for this client after the client already proposed a Tuesday
2:30 slot, confirming it today would silently apply a time the coach no
longer actually offers — nothing currently re-checks the rule set at
confirm time, only at offer time.

**Mechanically**: `confirm_reschedule` already has everything needed to do
this check — `activity.requested_start_at`, `activity.client`, and the
client's current coach — it would just run the same per-client rule lookup
`compute_available_slots` already does (same `CoachAvailabilityRule` filter,
same weekday/time-window containment test) before writing anything, instead
of trusting that an offer made N days ago is still valid.

**Decision needed on what happens when it fails the check** — the proposed
time is no longer inside any current rule for that client:
- **Hard block**: refuse to confirm, coach has to either edit the rules back
  or manually set a different time via Edit. Safest, but can be friction for
  a coach who narrowed their *general* hours but is fine making a one-off
  exception for this specific client/session.
- **Warn, don't block**: surface it ("this time is outside your current
  availability for this client — confirm anyway?") but let the coach proceed
  if they choose to. Keeps the coach as the final authority (same principle
  already applied everywhere else in this design — Edit can always override
  a pending request regardless of what the picker offered), at the cost of
  the check being advisory rather than a guarantee.

No recommendation forced here — this is a real workflow-friction-vs-safety
tradeoff worth your call, not a technical one with an obviously-correct
answer.

---

## 7. 2026-10-03 (round 2) — every remaining §5/§6 question answered

### 7.1 §6.3's confirm-time check: **Block**

If the proposed time no longer falls inside any current `CoachAvailabilityRule`
for that client when the coach clicks Confirm, the confirm is refused with a
clear message ("this time is no longer in your available hours for this
client") rather than silently applied or merely warned about. The coach's
options at that point are the same two paths that already exist elsewhere in
this design: re-add that availability window, or use Edit to set a different
time directly (which bypasses this check entirely, same as it already
bypasses everything else — Edit has always been the coach's manual override).

### 7.2 Pending-request TTL: **configurable per workspace, default 5 days**

Not a hardcoded constant — a new workspace-level setting (same shape as the
existing `buffer_minutes`/`cancellation_hours` fields already on `Workspace`,
surfaced in Settings → Scheduling). Call it
`reschedule_request_ttl_days`, default `5`. A pending request
(`requested_start_at` set, not yet confirmed or declined) older than that
many days gets auto-cleared — the mechanism is the same shape as the existing
`dispatch_activity_reminders`/`mark_overdue_invoices` daily Celery Beat jobs
(§ — see `backend/tasks/reminders.py`, `backend/tasks/invoicing.py` for the
established pattern): a new daily task scans for stale pending requests and
clears `requested_start_at` on any past the workspace's TTL.

### 7.3 Decline button: **yes, additive — Edit stays**

Confirmed: add a **Decline** action (mirrors Confirm — a dedicated button
next to it) that clears `requested_start_at` without touching
`start_at`/`end_at`, immediately freeing the slot for other clients. This
does **not** replace Edit as a way to resolve a pending request — both
remain available: Decline for "no, don't do this, drop it entirely," Edit
for "let me just set the real time myself" (which, per the existing
`perform_update` fix from the earlier session, already clears the pending
flag as a side effect of changing `start_at`/`end_at`).

**Decline's notification behavior, resolved**: unlike Confirm (which always
sends a fixed, standard email to both parties — §7.3 below), clicking
Decline opens a **draft-email step** before anything actually happens. The
coach writes/edits the message themselves, then explicitly chooses whether
to send it to the client at all — declining doesn't imply an automatic
email the way confirming does. This reuses the existing draft-and-preview
pattern already in the codebase (`EmailEditModal`, already used for other
coach-composed emails in `Activities.tsx`/`ClientDetail.tsx`) rather than
inventing a new one. Net effect: Decline can be a silent internal action (no
email sent) or a communicated one, entirely the coach's choice each time —
there's no single fixed template for it the way there is for Confirm.

Also reconfirmed as already-correct, not a new requirement: **Confirm**
already sets status to the "Confirmed" display state and already emails
**both** the client and the coach — `send_activity_reschedule_email`
includes the "coach copy" block, and `confirm_reschedule` calls it via a
reliable Celery `.delay()` (not the bare-thread `_fire` pattern used
elsewhere). Nothing new to build here, see §1.3/§6.1.

### 7.4 Client's own stated availability: **yes, as a secondary option alongside the picker**

Reopened from "not now" — the decision is: the reschedule page keeps the
slot picker as the primary path (pick one of the coach's offered times), but
a client who can't find a fit among those offered slots should also be able
to describe their own availability instead. **This already exists, no new
build needed**: the public reschedule page (§1.3,
`SessionRescheduleView`) already shows a free-text "Add a note (optional)"
box alongside the slot picker whenever slots exist, and falls back to a
*required* free-text box when no `CoachAvailabilityRule`s exist for that
client at all (§1.3, §1.7). If what's wanted is something more structured
than free text — e.g. the client picks actual day/time ranges themselves,
not just a sentence — that would be new scope, not a confirmation of
existing behavior; flagging the distinction in case the free-text version
isn't what was actually meant, otherwise this is already shipped.

### 7.5 Database exclusion constraint: **yes, build it**

§4.1 Option A confirmed as wanted, not just recommended — the
`btree_gist`-backed Postgres exclusion constraint on `Activity` over
`(coach_id, tstzrange(start_at, end_at))` filtered to active statuses, as
the hard backstop beneath everything else in §6.2/§7.2/§7.3. This is schema
work (a migration enabling the extension + the constraint itself), separate
from and in addition to the application-level checks above, not a
replacement for any of them.

### 7.6 Status display: **one pill system, no separate icon badge, four clear colors**

Confirmed direction for §4.4: collapse down to a single status indicator —
remove the small corner icon-badge (`rsvpStatus()` in `Calendar.tsx`,
today's ✓/↻/⏳/⋯/✕ corner icons) entirely, so there's exactly one signal per
event instead of two independently-computed ones. "Coach cancelled" in your
message was confirmed as just completing the list, not a 5th distinct
state — four states, four colors:

| Display status | Meaning | Suggested color |
|---|---|---|
| **Confirmed** | `status=scheduled`, no pending request — settled, nothing outstanding | Green |
| **Pending** | `requested_start_at` is set — a specific proposed time awaiting the coach's Confirm/Decline | Gold/Amber |
| **Rescheduled** | `status=rescheduled` with *no* `requested_start_at` — flagged as needing a new time, but no specific proposal attached yet (the older free-text-only path, or the coach's own "Reschedule" button) | Blue |
| **Cancelled** | `status=cancelled` | Red |

Reasoning for picking blue (not a second gold/amber) for plain
"Rescheduled": it's meaningfully different from "Pending" — Pending has a
concrete time sitting there ready for a single click to confirm; plain
Rescheduled has nothing proposed yet and needs the coach to go find a new
time from scratch. Collapsing them into the same color would hide that
difference. `Completed`/`Missed`/`Late` aren't part of this 4-color
redesign (not mentioned in scope) and can keep their current colors
(green/red/gold respectively) unless you want those folded in too.

---

## 8. Consolidated suggestion — one coherent design, not six separate patches

Putting §7.1–§7.6 together, here's the shape of the whole thing as one
system rather than six isolated decisions:

1. **Offer** (client opens the reschedule link): slot picker built from that
   client's `CoachAvailabilityRule`s, busy-checked against the coach's
   confirmed sessions **and** every other pending `requested_start_at` for
   that coach (§6.2) — so two clients can no longer both see the same open
   slot. Free-text note always available alongside it (§7.4, already built).
2. **Propose**: client's pick is staged into `requested_start_at` — nothing
   real changes yet. From this moment, a daily job (§7.2) is watching: if
   nobody acts on it within the workspace's configured TTL (default 5
   days), it auto-clears and the slot quietly reopens to everyone.
3. **Coach reviews**: sees exactly one clear "Pending" pill (§7.6, gold),
   with the proposed time right there (already built in both
   `Activities.tsx` and `Calendar.tsx`'s modals) and now two explicit
   actions — **Confirm** or **Decline** (§7.3) — plus the existing
   always-available **Edit** as a manual override.
4. **Confirm**: re-validated against that client's *current* availability
   rules first (§7.1) — blocked with a clear message if it no longer fits.
   If it passes, `start_at`/`end_at` move, status becomes "Confirmed"
   (green), both client and coach are emailed (already built, §7.3), and
   the slot is now a real busy block for every other client's picker,
   immediately (§6.2's live-recompute model, no caching to go stale).
5. **Decline**: clears the proposal, slot reopens immediately. Opens a
   draft-email step first (§7.3) — the coach writes/edits the message
   themselves and chooses whether it actually gets sent to the client; no
   fixed automatic email the way Confirm has one.
6. **Underneath all of it**, the DB exclusion constraint (§7.5) guarantees
   that even if two of the above somehow race at the exact same instant,
   the database itself refuses the second write — the one scenario none of
   steps 1–5 can fully rule out on their own.

Every question raised in §5–§8 now has an answer. Nothing in this document
has been implemented yet — this is the full design to build against.

---

## 9. Implementation ToDo list

Living checklist — updated as each task is finished, not written once and
left stale. `[x]` + ~~strikethrough~~ = done and verified; `[ ]` = not
started. §9.1 is everything already built (across earlier sessions, before
this document's design review) — included so the full feature's shape is in
one place, not scattered across months of chat history. §9.2 is what §7's
decisions still require, broken into real, actionable steps.

### 9.1 Already built (reference — nothing to do here)

**Data model**
- [x] ~~`CoachAvailabilityRule` model — weekly open-hours block, scoped per
  (coach, client) pair~~ (`backend/apps/activities/models.py`)
- [x] ~~`Activity.requested_start_at` field — staged proposed time~~
- [x] ~~Migration for both~~

**Backend logic**
- [x] ~~`compute_available_slots` — per-client rule lookup, 30-day rolling
  window, 15-minute-step rounding (independent of session duration, so
  offered times are always clean, e.g. 9:00/9:15/9:30), coach-wide busy
  exclusion against *confirmed* activities~~ (`backend/apps/activities/availability.py`)
- [x] ~~Coach-reassignment handling — slots computed against the client's
  *current* coach, not whichever coach happened to be on the original
  activity~~
- [x] ~~`CoachAvailabilityRuleViewSet` — CRUD endpoint,
  `/api/clients/{id}/availability/`~~ (`backend/apps/clients/views.py`)
- [x] ~~Public reschedule page (`SessionRescheduleView`) — renders the real
  slot picker (grouped by day) when rules exist, falls back to free-text
  when they don't; POST re-validates the picked slot server-side before
  staging it~~ (`backend/apps/activities/public_views.py`)
- [x] ~~`confirm_reschedule` action — applies `requested_start_at` to
  `start_at`/`end_at`, clears it, sets status back to the scheduled/
  "Confirmed" state, resets both reminder-sent flags, re-syncs Google
  Calendar (handling the coach-reassignment case: clears a stale
  `google_cal_uid` and creates fresh instead of updating the wrong
  calendar), emails client **and** coach via reliable `.delay()`~~
  (`backend/apps/activities/views.py`)
- [x] ~~`perform_update` fixed so editing unrelated fields (title, notes, …)
  on a pending-reschedule activity no longer silently orphans the pending
  request~~ — only clears `requested_start_at` when `start_at`/`end_at` is
  actually part of the edit
- [x] ~~`ActivitySerializer.update`'s email gate fixed (`was_active` instead
  of `was_scheduled`) — directly editing a pending session's time (not just
  using the dedicated Confirm button) now also emails both parties and
  resets reminder flags~~
- [x] ~~`send_client_reschedule_request` switched from a bare background
  thread to reliable Celery `.delay()`~~

**Frontend**
- [x] ~~"Coach Availability" tab on `ClientDetail.tsx`~~ — add/remove weekly
  blocks
- [x] ~~Pending-request banner + "Confirm New Time" button~~ — built in
  **both** `Activities.tsx`'s and `Calendar.tsx`'s detail modals (two
  separate, unshared components — see §9.3 note)
- [x] ~~"Use This Time" button inside the Edit form~~ — also built in both
  `Activities.tsx`'s and `Calendar.tsx`'s edit modals
- [x] ~~`displayActivityStatus` shared helper~~ (`components/ui/index.tsx`) —
  shows "Pending" (keyed off `requested_start_at`, not raw status, so it
  survives the status drift `perform_update` used to cause) and "Confirmed"
  (relabeled from raw `scheduled`)
- [x] ~~Calendar grid visual treatment for a pending session~~ — struck
  through, dimmed to ~65% opacity, gold "⏳ Pending" icon (distinct from a
  true cancellation's grey fade)

### 9.2 Remaining work, per §7's decisions

**Task 1 — Postgres exclusion constraint (§7.5) — ✅ DONE 2026-10-03**
- [x] ~~Migration: enable the `btree_gist` extension~~ — `BtreeGistExtension()`,
      prepended by hand to the generated migration (not auto-added by
      `makemigrations` — expected, same as Django's own docs for this feature)
- [x] ~~Migration: add an `ExclusionConstraint` on `Activity` over
      `(coach_id, tstzrange(start_at, end_at))`, filtered to
      `status IN ('scheduled', 'rescheduled')`~~ — note the real class name is
      `ExclusionConstraint` (Django 5.1), not `ExcludeConstraint` as
      originally written in §4.1/§7.5 above; `apps/activities/models.py`,
      migration `0017_activity_activity_no_overlapping_coach_bookings`
- [x] ~~Catch the resulting `IntegrityError` in every write path that can move
      a session's time~~ — `ActivityViewSet.perform_create`,
      `perform_update`, and `confirm_reschedule` all catch it via a shared
      `_reraise_if_overlap` helper, converting it to a `ValidationError`
      (clean 400, e.g. "That time overlaps another session already on this
      coach's calendar") instead of a raw 500. (`SessionRescheduleView`'s
      POST and the portal respond endpoint don't write `start_at` directly —
      only `requested_start_at` — so they were never at risk here.)
- [x] ~~Verify: two overlapping writes... one succeeds, one is rejected~~ —
      verified three separate ways against the real API/ORM, not just
      reasoned about: (1) direct overlapping `Activity.objects.create()` →
      rejected by Postgres with the exact constraint-violation error; (2)
      through the actual `ActivityViewSet.create` DRF path → cleanly
      converted to the friendly `ValidationError`, and confirmed the DB
      connection stays healthy for subsequent queries afterward (no
      lingering aborted-transaction state, since neither `ATOMIC_REQUESTS`
      nor a manual `atomic()` block wraps these saves); (3) through
      `confirm_reschedule` specifically — confirming a pending request into
      a slot another activity already occupies is rejected, and the pending
      activity is left **completely untouched** (`requested_start_at` still
      set, `start_at` unchanged) rather than partially applied.

  **Real pre-existing data had to be cleaned up before this could even
  apply**: 8 pairs of overlapping bookings already existed in local dev data
  (confirmed by a direct query before migrating). Reviewed each one's
  client/coach names and durations — all 8 traced to either test fixtures
  (client/coach literally named "Test client Test" / "test coachOS") or
  bogus multi-hour artifact blocks (one was a 16-hour "call" session). With
  explicit confirmation this is test-phase data, deleted the 7 artifact rows
  (not the real ones they overlapped with), re-scanned to confirm zero
  overlaps remained, then applied the migration cleanly.

**Task 2 — Pending requests block the slot for every other client (§6.2) — ✅ DONE 2026-10-03**
- [x] ~~Extend `compute_available_slots`'s busy-set query to also pull every
      *other* activity for that coach where `requested_start_at` is set,
      turning each into a `[requested_start_at, requested_start_at + its own duration)`
      interval, unioned with the existing confirmed-activity busy set~~ —
      `backend/apps/activities/availability.py`
- [x] ~~Verify: client A requests a slot → client B's picker (fetched after)
      no longer offers that same time~~ — tested with two real clients of
      the same coach, each with their own `CoachAvailabilityRule`: client B
      was offered 20 slots including a specific time; after client A
      proposed that exact time (unconfirmed), client B's next fetch dropped
      to 16 and no longer included it
- [x] ~~(not originally listed, added while implementing) Defensive edge
      case: a cancelled activity's stale `requested_start_at` must not
      block anything~~ — nothing currently clears `requested_start_at` when
      a session gets cancelled via the normal Cancel action, so without
      this exclusion a dead session's leftover proposal would squat on a
      slot forever. Query explicitly excludes
      `status in (cancelled, completed, missed)`. Verified: cancelled a
      pending-request activity, confirmed the slot it had proposed is
      immediately offered to other clients again.

**Task 3 — Confirm-time re-validation, hard block (§7.1) — ✅ DONE 2026-10-03**
- [x] ~~Inside `confirm_reschedule`, before applying: re-run the same
      per-client `CoachAvailabilityRule` containment check... against
      `requested_start_at`~~ — new `is_within_availability(coach, client,
      workspace, start, end)` helper in `availability.py`, deliberately
      separate from `compute_available_slots` (answers a different
      question: "does this one specific time still fit?" vs. "what are all
      the open times?" — and doesn't duplicate Task 1's busy-conflict job,
      each check guards its own distinct failure reason)
- [x] ~~If it no longer fits any current rule for that client: return 400
      with a clear message..., don't touch `start_at`/`end_at`/
      `requested_start_at`~~ — checked and returned *before* any field on
      the activity is mutated, so a rejected confirm is a true no-op
- [x] ~~Frontend: surface that specific error message in both modals'
      "Confirm New Time" flow~~ — **turned out to need no new code**: both
      `Activities.tsx` and `Calendar.tsx`'s existing handlers already read
      `err?.response?.data?.detail` with a generic fallback, so the new
      backend message surfaces automatically through the path that was
      already there
- [x] ~~Verify: narrow/remove a client's availability window after they've
      already proposed a now-outside-the-window time → Confirm is
      refused~~ — tested both directions: (1) deleted the client's
      availability rule after a valid proposal was already staged →
      confirm correctly rejected with the new message, activity's
      `requested_start_at`/`start_at`/`status` all unchanged afterward; (2)
      regression check with rules left intact → confirm still succeeds
      exactly as before (status→scheduled, `requested_start_at` cleared,
      new time applied)

**Task 4 — Decline action (§7.3) — ✅ DONE 2026-10-03**
- [x] ~~New endpoint... clears `requested_start_at` only, no change to
      `start_at`/`end_at`/`status`~~ — `ActivityViewSet.decline_reschedule`,
      `POST /api/activities/{id}/decline-reschedule/`
- [x] ~~Frontend: "Decline" button next to "Confirm New Time" in both
      `Activities.tsx`'s and `Calendar.tsx`'s pending-request banners~~
- [x] ~~Draft-email step on click... coach edits the message, then
      explicitly chooses "send to client" or "don't send"~~ — **correction
      to this task's original plan, found while implementing**:
      `EmailEditModal` is actually a *template editor* for the workspace's
      default email templates (used in `ClientDetail.tsx` to edit the
      "confirmation" template), not a one-off compose dialog — reusing it
      would have been wrong. Built a new, small, purpose-built
      `DeclineRescheduleModal` instead (`frontend/src/components/`) —
      deliberately a single shared component imported by both
      `Activities.tsx` and `Calendar.tsx`, rather than adding a third copy
      to the existing duplication problem (§9.3). New backend email task
      `send_decline_reschedule_email` (plain coach-authored message, no
      fixed template, logged under `EmailLog.Category.CLIENT_MESSAGE` since
      it's the same kind of one-off message as the existing Client
      Communication feature) — only ever fires when the coach has written
      something *and* ticked "send," never automatically.
- [x] ~~Verify: declining frees the slot immediately... and that sending
      vs. not sending the email is genuinely optional~~ — tested three
      ways: (1) decline with no message/no send → `requested_start_at`
      cleared, `start_at`/`end_at`/`status` all unchanged, no email sent;
      (2) decline with a message and send opted in → email delivered to
      the client with the coach's exact wording, logged correctly; (3) the
      same two-client setup from Task 2 — client A's pending slot was
      blocked for client B, then declined, and was immediately offered to
      client B again on the next fetch

**Task 5 — Configurable TTL + daily auto-expiry (§7.2)** ✅ DONE
- [x] ~~New `Workspace.reschedule_request_ttl_days` field (default `5`) +
      migration~~ — nullable `PositiveIntegerField`, default `5`,
      `null=True`/`blank=True` ("blank = never expire," same convention as
      `PipelineStageConfig.alert_stop_after_days`). Migration
      `apps/accounts/migrations/0021_workspace_reschedule_request_ttl_days.py`,
      applied. Also added `Activity.requested_at` (migration `0018`) — a
      separate timestamp just for "when was this proposal last made,"
      since `updated_at` bumps on any unrelated edit and would make a
      genuinely stale request look artificially fresh
- [x] ~~Settings → Scheduling: expose it as an editable number field, same
      pattern as the existing `buffer_minutes`/`cancellation_hours`
      fields~~ — new "Reschedule Request Expiry" field in
      `Settings.tsx`'s Scheduling Defaults `.fgrid`, right next to
      Cancellation Window/Session Buffer; empty input → `null` ("never
      expire") on save, same blank-convention as the Pipeline stage form
- [x] ~~New Celery Beat daily task~~ —
      `tasks.reminders.expire_stale_reschedule_requests`: scans every
      activity with a pending `requested_start_at`, skips any whose
      workspace has `reschedule_request_ttl_days=None`, clears
      `requested_start_at`/`requested_at` once `now - requested_at >=
      TTL days`
- [x] ~~Decide: does auto-expiry notify the client?~~ — resolved: silent,
      no email (same as a plain Decline-with-no-message) — your explicit
      answer when asked
- [x] ~~Register the new task in `CELERY_BEAT_SCHEDULE`~~ — added as
      `expire-stale-reschedule-requests`, daily at 4am
- [x] ~~Verify: a pending request older than the configured TTL is cleared
      on the next run; one younger than it is left alone~~ — ran the real
      task function against three real `Activity` rows in local dev: a
      6-day-old request under a 5-day TTL was cleared
      (`requested_start_at`/`requested_at` both `None` after); a 2-day-old
      one under the same TTL was left completely untouched; a 100-day-old
      one under a workspace with `reschedule_request_ttl_days=None` was
      still pending after the run. Also round-tripped the Settings field
      itself through `WorkspaceSerializer` directly — saving `null` and
      saving `7` both persisted correctly. `api`, `celery_worker`, and
      `celery_beat` containers restarted to pick up the new task +
      schedule; `tsc --noEmit` clean. Test rows cleaned up afterward.

**Task 6 — Unify the status display (§7.6)** ✅ DONE
- [x] ~~Remove `rsvpStatus()`'s corner icon-badge rendering from
      `Calendar.tsx`'s `eventContent` — one indicator per event, not
      two~~ — the lettered corner badge is gone from the grid entirely,
      replaced by a plain 8px status-color dot driven by
      `displayActivityStatus`/`STATUS_HEX`. `rsvpStatus()` itself is now
      narrowed to only return genuine client-response states (declined/
      tentative/accepted/awaiting-response) — it returns `null` for
      cancelled, a pending proposal, or a bare reschedule, since the
      status pill already covers those; it's still used, unchanged in
      scope, for the labeled "Client Response" row inside the detail
      modal, which is a distinct, explicitly-labeled fact (not a second
      competing status signal)
- [x] ~~Finalize `STATUS_COLOURS` to the agreed four~~ — `cancelled`
      changed from grey to red in `components/ui/index.tsx`; confirmed
      (green)/pending (gold)/rescheduled (blue) were already correct from
      earlier work. Added an exported `STATUS_HEX` constant (hex
      equivalents of the same four colors) for the few spots that render
      inline styles instead of the `pill-*` CSS classes
- [x] ~~Apply consistently everywhere a status renders~~ — `Activities.tsx`
      and `Calendar.tsx`'s detail modal already used the shared
      `StatusBadge`/`displayActivityStatus`, no change needed there.
      `ClientDetail.tsx`'s Engagement History timeline had the exact bug
      this task was meant to catch: its dot color and its badge color were
      two separately-hardcoded maps, neither using
      `displayActivityStatus`, and `rescheduled` wasn't in either map — a
      rescheduled-but-unresolved session rendered visually identical to a
      cancelled one (both fell through to the same default grey). Fixed by
      deriving both the dot and the badge from one `displayActivityStatus`
      call per activity row; invoices in the same timeline keep their own
      separate, unaffected status-color map
- [x] ~~Remove/update any leftover legend or explanatory text~~ — searched
      the whole frontend; no activity-status legend exists anywhere
      (the only hit for "legend" is `Team.tsx`'s unrelated role legend) —
      nothing to remove
- [x] ~~Verify~~ — `tsc --noEmit` clean after all edits. This was a pure
      display/color change with no backend behavior touched, so
      verification here is code-level (traced every call site; confirmed
      no other status/badge/dot consumer still uses a raw, non-unified
      color map) rather than a backend data test like Tasks 1-5 — this
      environment has no browser automation tool, so the actual rendered
      page wasn't visually screenshotted; worth a quick manual look at
      the Calendar grid and a client's Engagement History panel next time
      you're in the app to confirm it looks right.

### 9.3 Noted but intentionally not a task here

The `Activities.tsx`/`Calendar.tsx` component duplication (every frontend
item in §9.1 and Task 4/6 above had to be built twice, in two unshared
modal implementations) is a real maintainability cost, flagged earlier in
this conversation — tracked here as a known fact shaping *why* each
frontend task above lists two files, not as a task to fix as part of this
feature. Worth its own cleanup pass later, separate from this checklist.

## Implementation
Task 1 done — Postgres exclusion constraint
Here's what happened and why, step by step:

What I built: a database-level constraint on Activity that makes it physically impossible to save two bookings for the same coach with overlapping times — enforced by Postgres itself, not application code. This is the hard backstop under everything else in the design (§7.5).

A real wrinkle hit along the way, worth knowing about: before I could even apply this, I had to check for pre-existing overlaps in the local database — and found 8 pairs. I didn't guess at which ones to remove; I pulled full details (client name, coach, duration, title) for all of them and found clear signals: some belonged to clients literally named "Test client Test," one was a 16-hour "call" session (not a real booking), and a couple were exact duplicates. You confirmed it's fine to delete test-phase data, so I removed the 7 artifact rows, re-confirmed zero overlaps remained, then applied the migration cleanly.

Then I verified it actually works — not just that the migration ran, but that the constraint does its job, in three separate real tests: a direct overlapping database write gets rejected by Postgres with the exact error expected; the same thing through the real API view (ActivityViewSet.create) now returns a clean "That time overlaps another session already on this coach's calendar" message instead of a raw server error; and — the scenario this constraint specifically exists for — confirming a pending reschedule into a slot another session already occupies gets rejected too, leaving the pending request completely untouched (not half-applied) so the coach can just try a different time.

One small correction while building it: the design doc called this class ExcludeConstraint, but in the actual Django version here (5.1) it's named ExclusionConstraint — fixed in the code and noted in the doc so there's no confusion later.

calendar.md §9.2 Task 1 is now checked off with the full verification record.

# Ready to move to Task 2 — making a pending request block the slot for every other client whenever you want to continue.

Task 2 done — pending requests now block the slot for every other client
What changed: compute_available_slots used to only treat a slot as "taken" if it overlapped a confirmed booking. Now the busy-check is the union of two things — confirmed bookings (as before) and every other activity for that coach with a still-open pending proposal, turned into its own [requested_start_at, requested_start_at + duration) interval. So the moment Client A proposes a time, it disappears from Client B's picker on their very next fetch — exactly the scenario you asked for.

One thing I caught while building this, not in the original task description: nothing in the codebase currently clears requested_start_at when a session gets cancelled through the normal Cancel button. Without an explicit guard, a cancelled session's leftover pending request would have permanently blocked that slot for everyone — a real bug this change would've introduced if I'd implemented it naively. Added an exclusion for cancelled/completed/missed sessions to the pending query.

Verified two ways, not just reasoned about: created two real clients of the same coach with their own availability rules — before Client A proposed anything, Client B was offered 20 slots including a specific time; after Client A proposed that exact time, Client B's count dropped and that specific time was gone. Then separately confirmed the cancelled-session edge case: cancelled a pending-request activity and confirmed its stale proposal no longer blocks anything.

calendar.md §9.2 Task 2 is checked off with the full record. Ready for Task 3 — confirm-time re-validation (hard block) whenever you want to continue.

##Task 3 done — confirm-time re-validation, hard block
What this closes: before today, a client's proposed time was only ever checked against the coach's availability rules once, at the moment they picked it. If the coach edited or deleted those rules afterward (while the request sat pending — more likely now that there's no TTL yet), clicking Confirm would have silently applied a time the coach no longer actually offers. Now confirm_reschedule re-runs that same check right before applying anything.

I deliberately built this as a separate, narrower function (is_within_availability) rather than reusing compute_available_slots directly — they answer different questions. compute_available_slots asks "what are all the open times?" (used for the picker); this new one only asks "does this one specific time still fit?" — and it doesn't touch the busy-conflict logic at all, since that's Task 1's job (the DB constraint) and Task 2's job (pending-blocks-everyone). Each guard covers its own distinct failure reason rather than one function trying to do everything.

Pleasant surprise on the frontend side: the task list called for surfacing this new error message in both modals, but it turned out both Activities.tsx and Calendar.tsx already read err?.response?.data?.detail generically — so the new backend message shows up automatically with zero new frontend code.

Verified both directions, not just the happy path: staged a valid proposal, then deleted the client's availability rule entirely, confirmed Confirm is now rejected with the clear message and that the activity comes back completely unchanged afterward (no partial state). Then separately re-ran the original valid-rules case to make sure I hadn't broken the normal path — confirm still applies correctly.

calendar.md §9.2 Task 3 is checked off. Ready for Task 4 — the Decline action whenever you want to continue.

##All green. Summary of what the client portal now has, matching the coach side:

Backend — PortalNotesView.post and PortalNoteDetailView.patch now accept topic and session_date (new _parse_session_date helper guards against bad input instead of erroring).

Portal Notes tab — now mirrors the coach's redesigned explorer:

Compose form gets Topic + Date fields alongside the textarea (optional, defaults date to today).
Notes render as a collapsed-by-default tree, grouped under Today / Yesterday / date headers, sorted latest-to-oldest by session date (falling back to when it was written) — same logic as the coach side, duplicated locally since the portal is a separate bundle.
Each row leads with its topic (or a text preview if none was set); click to expand.
Editing a client's own note now lets them change topic + date, not just the text — coach-shared notes stay view-only, as before.
Same "Search by topic" / "Search by date" bar as the coach side.
tsc --noEmit is clean, manage.py check is clean, and the backend test suite still passes 9/9.

##I ran the end-to-end verification I'd flagged as outstanding:

Created a real shared session note (topic + session date) against a seeded client with a real email, fired the notification task directly, and confirmed via Mailpit's API that the email arrived — correct subject, topic, a readable preview pulled out of the structured JSON body (not raw JSON), and the session date.
Confirmed the matching EmailLog(category=note_shared) row was written.
Confirmed the portal's _serialize_note returns topic/session_date correctly.
Cleaned up the test note and log row afterward — no leftover dev data.
Updated change_log_2026-10-03.md with all three rounds of work. Everything from your original ask is now implemented and verified: topic + session date on notes, search by both on coach and portal, a redesigned/collapsible writing screen, portal parity (collapsed tree, edit, search), the share-triggers-email flow, and the insert-template default.

Nothing is committed yet — the repo still has unrelated in-progress work mixed into the tree (the availability/overlap-booking feature). Let me know if you'd like me to commit just the session-notes files now, or if there's another feature to pick up next.

##Task 4 done — the Decline action
A real correction happened mid-build, worth knowing about: the original plan (written into the design doc earlier) was to reuse EmailEditModal for the draft-email step. While actually implementing it, I checked that component's real purpose and found it's not what I'd assumed — it's a template editor for the workspace's default email templates (the thing used in Settings-style flows to edit the standing "confirmation" email template), not a one-off "write and send this specific message" dialog. Reusing it would have been wrong — it would have let a coach edit the permanent confirmation template instead of just sending one message about this one decline.

So I built a new, small, purpose-built DeclineRescheduleModal instead — and deliberately made it a single shared component imported by both Activities.tsx and Calendar.tsx, rather than adding a third copy to the Activities/Calendar duplication problem already flagged in §9.3. On the backend, a new send_decline_reschedule_email task sends the coach's own plain-text message — no fixed template, and it only ever fires when the coach has actually written something and explicitly checked "send," matching the "not automatic the way Confirm is" requirement from §7.3.

Verified three ways: declining with nothing written leaves the activity completely untouched except clearing the pending flag; declining with a message and opting to send delivers the coach's exact wording to the client (confirmed via the actual sent email content); and re-ran the two-client setup from Task 2 to confirm declining immediately reopens the slot for other clients, not just eventually.

calendar.md §9.2 Task 4 is checked off, including the EmailEditModal correction so the reasoning is on record. Ready for Task 5 — the configurable TTL and daily auto-expiry job whenever you want to continue.

##Task 5 done — configurable TTL + daily auto-expiry

What this closes: once a client proposes a new time, that slot is blocked for every other client (Task 2) indefinitely — until today, there was no backstop if the coach just never got around to confirming or declining it. A client's chosen time could sit in limbo forever, silently holding a slot hostage.

What I built: a per-workspace setting, "Reschedule Request Expiry," in days. Every pending proposal now carries its own timestamp (`requested_at` — deliberately separate from the activity's general `updated_at`, which changes on any unrelated edit and would make a truly stale request look fresh again). A new daily background job compares that timestamp against the workspace's configured limit, and if it's been exceeded, quietly clears the proposal — the slot becomes available to everyone again, same end state as a manual Decline, just automatic. Leaving the field blank means "never expire," same convention this codebase already uses for the Pipeline stage follow-up settings, so there's nothing new to learn about how blank behaves here.

One decision I checked with you directly rather than assuming: whether the client should be told their time quietly expired. You said silent — no email — same as it works for Confirm/Decline when the coach writes no message, so I matched that exactly: this job never sends anything, it just cleans up.

Verified for real, not just by reading the code: I created three test sessions directly in the local database with handcrafted ages — one proposal 6 days old (past a 5-day limit), one 2 days old (within it), and one 100 days old sitting under a workspace configured with no limit at all. Running the actual job function: the 6-day-old one was cleared, the 2-day-old one was untouched, and the 100-day-old one was still pending afterward because that workspace has no TTL. I also directly exercised the Settings save path (not just the UI) to confirm both "set a number" and "clear it back to blank" persist correctly through the real serializer. All three backend containers (api, the Celery worker, and Celery beat) were restarted so the new daily job is actually registered and running — it wasn't before. Frontend type-checks clean.

calendar.md §9.2 Task 5 is checked off. Ready for Task 6 — unifying the status display (removing the leftover duplicate pending-indicator icon on the calendar grid and finalizing the four status colors) whenever you want to continue.

##Task 6 done — unified status display, four colors, one indicator

What this closes: the calendar grid was showing two independently-computed signals per session — a lettered corner badge (✓/↻/⏳/⋯/✕, from a function called `rsvpStatus`) that mixed together two genuinely different questions ("has the client responded to the invite" and "what state is this session in"), plus separate ad-hoc color logic scattered across three different files. The practical cost: in one place (`ClientDetail.tsx`'s "Engagement History" panel on a client's page), this had already produced a real bug — a session flagged "Rescheduled" and one that was actually "Cancelled" rendered with the exact same grey dot and grey badge, because "rescheduled" was simply missing from that file's own color map and silently fell back to the cancelled/default color.

What I did: settled on exactly one status indicator, driven by one function (`displayActivityStatus`) and one color table, used everywhere:
- Confirmed → green, Pending → gold, Rescheduled → blue, Cancelled → red (now matches your §7.6 decision exactly — Cancelled was still grey before this).
- The calendar grid no longer shows the lettered corner badge at all — it's a small plain color dot now, using those same four colors, so a coach can tell the four states apart at a glance without a legend.
- `rsvpStatus()` still exists, but now only for its real job — "did the client respond, and how" (declined/tentative/accepted/still waiting). It no longer tries to also describe cancelled/pending/rescheduled, since the status pill already owns that. It's still shown, clearly labeled "Client Response," inside the detail modal — that's genuinely different information, not a duplicate.
- Fixed the real bug in `ClientDetail.tsx`: the timeline's dot and its little status label now come from the exact same calculation, so "Rescheduled" can never again look identical to "Cancelled."

How I verified it, given there's no visual/backend state to test here (this was a pure display change, not new data or logic): I traced every place in the frontend that renders an activity's status or a client-response icon and confirmed each one now goes through the one shared function, re-ran a full `tsc --noEmit` after each file's edits (came back clean each time), and specifically grep'd for any leftover "legend" text describing the old two-icon system (there wasn't any to begin with). One honest caveat: this environment doesn't have a browser tool, so I haven't visually looked at the rendered calendar grid or the Engagement History panel — worth a quick glance next time you're in the app, though I'm confident in the logic given how directly it's wired.

calendar.md §9.2 Task 6 is checked off. That's every task in the original list — the coach availability / reschedule feature is now fully implemented and verified end to end (Tasks 1-6), aside from the known, explicitly-deferred Activities.tsx/Calendar.tsx component-duplication cleanup noted in §9.3.

##Task 5 is done. Here's the plain-English summary:

Once a client proposes a new time, that slot gets locked for everyone else (Task 2) — but until now, nothing cleaned it up if the coach never confirmed or declined. A request could sit in limbo forever, holding a slot hostage.

Now there's a per-workspace setting, "Reschedule Request Expiry" (in Settings → Scheduling Defaults, next to Cancellation Window and Session Buffer), where the coach sets how many days a pending request can sit before it auto-clears — leaving it blank means it never expires. A new daily background job (runs at 4am) checks every pending request's age and clears it silently (no email, per your earlier answer) once it's past the limit — same end result as a manual Decline, just automatic.

I verified this against real data in local dev, not just by reading the code: a 6-day-old request under a 5-day limit got cleared, a 2-day-old one was left alone, and a 100-day-old one under a workspace with no limit set was still untouched. Restarted the API, Celery worker, and Celery beat containers so the new job is actually running, and confirmed the frontend still compiles clean.

calendar.md is updated with the full record. Next up is Task 6 — unifying the status colors/icons across the calendar and activities list — whenever you're ready to continue.

##Task 6 is done — that completes the whole task list. Here's what changed and why:

The calendar grid used to show two separate signals per session: a lettered corner badge (✓/↻/⏳/⋯/✕) that mixed "did the client respond" with "what state is this session in," plus scattered, inconsistent color logic in three different files. That inconsistency had already produced a real bug on a client's page: in the Engagement History timeline, a "Rescheduled" session and a "Cancelled" one rendered as the exact same grey dot, because "rescheduled" was simply missing from that file's own color map.

I collapsed everything to one indicator, one function, one color table — green/gold/blue/red for Confirmed/Pending/Rescheduled/Cancelled, used consistently in the calendar grid (now a plain color dot, no more lettered icon), the detail modal, the activities list, and the client page's timeline. The genuine "did the client respond" info (declined/tentative/confirmed/awaiting) still exists, but only as its own clearly-labeled "Client Response" field — not competing with the main status indicator anymore. Fixed the real rescheduled-vs-cancelled bug on the client page as part of this.

Verification here was code-level rather than a live data test, since this was a pure display change: traced every call site, confirmed tsc --noEmit stays clean. One honest gap — this environment has no browser tool, so I haven't visually confirmed it renders correctly; worth a quick look next time you're in the app.

calendar.md now has the full record, and with Task 6 checked off, all six tasks from the original plan are implemented and verified — the only thing left on the list is the explicitly-deferred Activities.tsx/Calendar.tsx duplication cleanup noted in §9.3, which we agreed isn't part of this feature.

##final revoe 

Checked the whole doc end to end against what's actually built. Short answer: the planned 6-task list is fully done — but there are two things still open, one you already know about and one that slipped through unaddressed.

Already known, deliberately deferred (not an oversight):

§9.3 — Activities.tsx/Calendar.tsx still have two completely separate, unshared modal components, so every fix in this feature had to be built twice. You agreed this is a cleanup to tackle later, not now.
One real gap I should flag, not quietly skip — §3, item 6: bulk Cancel (scope: future/all) has no per-row validation. I just checked the actual code (ActivityViewSet.cancel, views.py:224-259): when a coach cancels a whole recurring series, it excludes rows that are already cancelled, but not rows that are already completed or missed. So cancelling "all" on a series retroactively flips a client's already-completed past sessions to "Cancelled," overwriting real history. This was named back in §3 of the design doc but never turned into a decision or a task — it just didn't make it onto the 6-item list.

Everything else named in §3/§5 either got built (double-booking prevention, unified status display) or was explicitly resolved as out-of-scope/already-shipped (no self-serve booking by design; client's-own-availability already covered by the existing free-text fallback).

Want me to add this bulk-cancel gap as a new task and fix it (exclude completed/missed from the bulk update, same pattern as the existing CANCELLED exclusion), or leave it as a known issue for now?

###Email edits

Every email except invoices now starts with only the header and logo switched on, and everything else is text you can edit. Emails you haven't customized send exactly that starter, so the preview, the editor and the sent email all match. Tests pass (23 of 23), the type check passes, and real sends to Mailpit match the starter in both the HTML and the plain-text versions. I haven't looked at the updated Settings screen in the browser.

The copy button: it saved a copy of that email into the Template library. It was confusing there, so I removed it. Each email row now has a single Edit button. Duplicating is still available in the Template library tab.

What every email starts with now:

On: the white header with your logo, plus any button the recipient actually needs. These can't be switched off: Confirm/Reschedule/Cancel, Accept invitation, Access portal, and Open in CoachOS for coach emails.
Editable text: the subject, the message and the closing. The details are written into the message (e.g. "What: … / When: …") and the closing ends with "Thanks, {workspace_name}", so you can rewrite or delete any of it.
Off, but can be switched back on: the heading, details card, "Add to calendar" box, separate sign-off and footer.
What I changed to make this stable:

One set of starter wording, kept on the server. The Settings editor and the Calendar popup both load it from there, so they can't drift apart.
Retired your old hidden templates. Your Rass consulting workspace had 8 older saved templates in a format the Settings page never showed. They were silently overriding what Settings called "Built-in", and they were mostly old default wording and test data like "RECEIPTMARK". The invoice one is kept.
Same layout for every email. The receipt, team invite, portal invite and pipeline alert now use the same layout and editable parts as the rest.
Fixed the pipeline alert's "View Pipeline" button, which would have been white on the new white header.
Plain-text versions (shown by mail apps that don't display HTML) are now built from the same text as the HTML, so they no longer show the old wording or an extra sign-off.
Things to know:

Your customized emails don't change. Saved templates like "Team Invite2" keep their own look. To switch one to the new starter, open it and click Reset to default. That button is in the Calendar popup only. In Settings there's no reset yet; clearing a customization means deleting its template in the Template library.
The Calendar popup shows "Loading…" for a moment the first time it opens, while it fetches the starter.

##pipeline email schedule
Weekly and monthly follow-ups now go out on a day you choose, instead of "every 7 / 30 days". Each recipient has their own setting. All 26 tests pass, the type check passes, and the migration has run locally. I haven't looked at the new pickers in the browser.

What you can choose for each recipient (You, Assigned coach, Client):

Frequency	Choose	Example
Daily	—	every day
Once a week	the weekday	Every Monday
Once a month	a date	15th of each month
Once a month	or the Nth weekday	First Monday of the month · Last Friday of the month
The stage list shows the same plain wording, e.g. "Coach · Every Monday", "Client · 15th of each month".

How it behaves:

First email: goes out on the first chosen day after the deal is overdue. For example, a deal that becomes overdue on a Wednesday with "Every Monday" gets its first email the following Monday.
Never twice a day: the same person never gets two emails on the same day.
Short months: a date after the 28th falls on the last day of shorter months (e.g. the 31st becomes 28 Feb).
Your timezone: "Monday" and "the 15th" use your workspace timezone (America/New_York), not UTC. Emails go out around 4 AM Eastern, when the daily job runs (08:00 UTC).
Defaults: recipients set to weekly or monthly before this change go out on Mondays / the 1st until you pick a day. Changes from earlier today (separate emails per person, the client check-in, etc.) still apply.
Suggestions:

Send time: emails currently arrive around 4 AM Eastern. Running the job in the morning of each workspace's own timezone (e.g. 8 AM local) would put them in the inbox at the start of the workday.
Skip weekends for Daily: a "weekdays only" option, so stuck-deal alerts don't arrive on Saturday and Sunday.
Same schedule for everyone: most stages will want the same day for all three recipients. A "Use the same schedule for everyone" checkbox would cut the clicks.
Preview the next send: show "Next follow-up: Mon, Oct 12" on each deal in the Pipeline view, so people can see when the next email will go out.
Merge the two migrations: I added two today (0012, 0013). Since neither has shipped, I can combine them into one before you commit.
I'd do 5 now, and 1 and 4 when convenient. Nothing is committed yet. I'll write the changelog before we commit.

## new feature added to add all reminder email notices in email communications
The Email Communication page now tracks every email the workspace sends: what went out, what's scheduled and what failed. Tests pass (29 of 29, including 2 new ones) and the type check passes. I checked the endpoints against your real data, but haven't looked at the new page in a browser.

What changed behind the scenes:

Nothing can skip the log any more. Every workspace email now goes through one send function that records it, whether it was sent or failed. That covers the emails that were missing before: pipeline follow-ups (to you, the coach and the client check-in), the coach copies and client-action notices, reschedule-request emails, payment failed, contract signed and team invites.
Failed sends are recorded with their error, instead of leaving no trace.
Left out on purpose: portal login codes and password resets, because they contain one-time codes or links that shouldn't be stored; platform admin and health emails also stay out.
Scheduled is a live forecast using the same rules the senders use:
session reminders (24h and 1h) plus the coach's copy
recurring invoices (voided ones are now excluded, matching the real job)
pipeline follow-ups for each recipient on their own schedule (e.g. "every Monday at 8:00 AM")
The page:

Tabs: Sent · Scheduled · Failed. Failed only appears when something failed, and it's shown in red.
Filters: recipient (All / Clients / Me & coaches / Team), email type (grouped by recipient), client and search.
Scheduled is grouped by day (Overdue, Today, Tomorrow, …). Each row shows the time, the type, who it's to and why, e.g. "Proposal Sent" stage · every Monday.
Click any row to see the email:
Sent shows the exact copy that went out.
Failed shows the error.
Scheduled shows a preview built from real data, made by running the actual send code without sending, logging or saving anything.
Your data right now:

The 63 emails already in the log are still there, now labelled by type. Older 1-hour reminders show as "24h Session Reminder", because the old log didn't record which reminder it was.
Scheduled still shows only the Nov 1 invoice. That's correct: you have no open deals past their follow-up date, and your two upcoming sessions are "rescheduled", which never get reminders.
Internal emails (to you and your coaches) start appearing from now on. Earlier ones were never logged, so they can't be recovered.