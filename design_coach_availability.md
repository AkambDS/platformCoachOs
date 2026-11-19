# Design — Coach Availability v2 (date-wise availability + Calendly-style reschedule picker)

**Status:** design approved, not built. **Date:** 2026-11-11 (rev. 4: pick date + time; "suggest your time" built but hidden; old weekly model deleted).
**Related:** `calendar.md`, which holds the existing reschedule, pending-request and
confirm flow that this builds on.

---

## 1. Scope

**In this build**
- **Coach side:** for each client, the coach (or the workspace owner) adds availability
  **date by date**: **pick a date (or several), pick a start and end time, Add.** The
  added times show on a **3-month calendar**. There are no weekly or repeating patterns;
  a date is open only if the coach added times on it.
- **Client side:** the reschedule page (opened from the email) and the portal show the
  **coach's available dates for the next 3 months**, highlighted. The client picks a
  date, then a time, and the coach confirms.
- **"Suggest your time" is built but hidden.** It lets a client who can't find a time
  send a comment while their current session stays booked. It is built in the backend
  and UI but switched off by a flag, so clients don't see it yet (§2.3).
- **Conflicts:** a time is never offered if the coach already has something then:
  - a session with **any** client;
  - a pending request from **any** client.

  Clients only ever see times the coach marked as available. CoachOS does **not** read
  the coach's Google Calendar: the coach is responsible for marking only times they're
  free.
- **Everything is per workspace.** The workspace owner can also be a coach.
- **The old weekly model is deleted.** `CoachAvailabilityRule` and its rows are removed;
  they are test data only.

**Not in this build**
- Clients booking brand-new sessions; only rescheduling is supported.
- Weekly or repeating availability, and quick-time preset buttons.
- A coach-wide default schedule.
- A coach time-off feature.
- Reading the coach's Google Calendar for conflicts (decided 2026-11-16: clients see only
  times the coach marked available).
- Copy from another client, and "Preview as client".
- Shareable calendar links.
- Dashboards.
- Coach reassignment (what happens to a client's availability when they move to a new
  coach). This is a separate requirement, handled on its own later.

**Clients have no calendar in CoachOS.** CoachOS never reads a client's own calendar.
There is only the coach's calendar.

**Architecture:** this stays inside the existing Django monolith (`apps/activities`). No
new service.

---

## 2. How it works

### 2.1 Coach / owner: add availability

On **Clients → client → Coach Availability**:

1. **Pick the dates.** Click dates on the 3-month calendar. Each click selects or
   unselects a date, and the selected dates appear as chips in the form's Dates field.
2. **Pick the start and end time,** e.g. 6:00 pm – 7:00 pm, in 15-minute steps.
3. **Press + Add.** The time is saved on each selected date, and those dates turn green
   on the calendar with the time shown.

- **More than one range on a day:** add again for the same date (e.g. 9–10 am and
  2–4 pm).
- **Remove:** each added time has a ✕ in the list ("Upcoming availability") and in the
  day panel opened by clicking a green date.
- **Running out:** the summary line shows "8 open dates · until Feb 10". Dates don't
  repeat, so this tells the coach when to add more.
- **Conflicts:** the calendar shows the coach's existing sessions and pending requests.
  An overlap is never blocked. The time still saves; the overlapping part just isn't
  offered to the client. The warning appears at three points:
  1. **While filling the form, before pressing Add.** As soon as a date, start and end
     are all filled, the form checks them against the sessions already loaded for the
     calendar view. No extra server call is needed. The yellow warning shows under the
     form and updates whenever the dates or times change, so the coach can adjust before
     adding.
  2. **On Add.** The server re-checks, since a session may have been booked since the
     page loaded. The time saves either way, and the response lists any overlaps; the
     confirmation reads "Added 2 dates · 1 overlaps a session — that part won't be
     offered."
  3. **Afterwards, in the list.** An entry that overlaps a session, including one booked
     later, shows a small "partly booked" tag in Upcoming availability and on the day
     panel. This stays accurate without any notification.

  **Who sees the other client's name** (coach-side screen only): the client's coach and
  the workspace owner see "overlaps a session with John". Other team members with Coach
  Availability access, such as an assistant, see "overlaps another session" with no
  name or link.

  **Clients never see any overlap warning.** The warning exists only on the coach's
  Coach Availability tab. On the client's reschedule page, as in Calendly, an
  overlapping time simply isn't listed. The client sees only open dates and times
  (§5.3), never a reason why a time is missing. The server
  decides this. The `overlaps` list only includes `client_name` for the coach and the
  owner, so the name never reaches the browser of someone not allowed to see it.
- **Client requests:** when a client picks a time, the coach is emailed and the session
  shows as **Pending** (existing). The coach presses **Confirm** or **Decline** (existing).

### 2.2 Client

1. **Email:** the client gets a session email (one of the four in §5.2) with
   **Reschedule**, plus the next 3 open dates as buttons.
2. **Reschedule page:** clicking opens it (or the portal's Sessions page). They see a
   3-month calendar with available dates highlighted. It opens on the first open date,
   already selected.
3. **Pick a time:** the client picks a date, then a time, then presses **Request**,
   confirms, and the request is sent. Their current session stays booked until the coach
   confirms.
4. **No open times at all:** the page shows a box where the client writes when they're
   available, plus a **Request reschedule** button. The coach is emailed with the note,
   and the current session stays booked. This is today's free-text request and is
   **always shown when there are no open times**, whatever the flag says.

```
Sanvi hasn't shared open times yet.
Tell Sanvi when you're available and they'll confirm a new time.
[ e.g. I'm free Mon–Wed after 3pm, or anytime Friday            ]
[                                                               ]
[ Request reschedule ]
```

### 2.3 "Suggest your time" (built, hidden)

- **What it does:** a link under the picker, "None of these work? Suggest your time",
  opens a comment box. Sending it creates today's free-text reschedule request (status
  `rescheduled`, no proposed time) and emails the coach. **The current session stays
  booked**; nothing is cancelled.
- **Flag:** `allow_client_suggest_time` per workspace, **default off**. The flag only
  matters when the coach **has** open times. Off means:
  - the "None of these work?" link is not shown, so the client picks from the coach's
    times;
  - the backend rejects a note-only request (a `message` without a `slot`) with 400
    "Please pick one of the available times" **if open times exist**.
  - When there are **no** open times, a note-only request is always accepted (§2.2
    step 4).
- **Turning it on later:** a superadmin or Django-admin toggle per workspace. No Settings
  UI in this build.

---

## 3. Core logic

### 3.1 Which hours are offered to a client on a date

```
offered_hours(workspace, coach, client, date):
    return [(b.start_time, b.end_time)
            for b in CoachAvailabilityBlock(workspace, coach, client, date)]   # none = not available
```

- **Coach:** always `client.coach`, the client's current coach. What happens to blocks
  when a client is reassigned is out of scope here and handled separately.
- **Time zone:** times are entered in the workspace time zone, and all results are
  stored and returned in UTC.

### 3.2 Removing conflicts (busy times)

The busy times are **for the coach, across all of the coach's clients**:

| Source | Counts as busy | Why |
|---|---|---|
| CoachOS sessions | Every session for this coach with status `scheduled`/`rescheduled` (any client), except the session being moved | The coach can't be in two sessions |
| Pending requests | Every other session's open `requested_start_at` with its length (any client), unless that session is cancelled, completed or missed | Stops two clients requesting the same time |
| Buffer | Workspace `buffer_minutes` added around each busy block (default 0) | Gap between sessions |
| Minimum notice | Nothing earlier than now + `min_notice_hours` (default 24) | No last-minute requests |

### 3.3 Turning hours into start times

```
open_slots(workspace, coach, client, duration, month, exclude_activity):
    for each date in month ∩ [today, today + horizon_days(90)]:
        for (start, end) in offered_hours(workspace, coach, client, date):
            t = start
            while t + duration <= end:                          # step every 15 min
                if t >= now + min_notice and no busy block overlaps [t, t + duration):
                    yield t (UTC)
                t += slot_step (15 min)
```

- **Length:** `duration` is the length of the session being moved.
- **On demand:** results are worked out one month at a time when the page asks for them.
  Nothing is stored.

### 3.4 Where conflicts are enforced

| Moment | Check | If it fails |
|---|---|---|
| Coach fills the Add form | Overlap with the sessions and pending requests loaded for the calendar | **Live warning** under the form, before Add |
| Coach presses Add | Server re-checks overlap (§3.2) | **Warning only.** The time saves, and the overlapping part is just not offered |
| Client loads the picker | `open_slots` | Busy times never shown. Days with no times are greyed |
| Client sends a request | Re-run `open_slots`; the chosen time must still be in it (existing) | "That time was just taken", then the times refresh |
| Coach confirms | Still inside an offered block (`is_within_availability`, rewritten for blocks) **and** the database overlap rule (existing) | Blocked, with the reason shown |

**Same times offered to several clients is not a conflict.** The first client to request
a time gets it. Their pending request removes that time from every other client's picker immediately, with no message; the time just no longer appears.

---

## 4. Data model

```
CoachAvailabilityBlock(WorkspaceModel)       # NEW — the only availability table
  coach       FK User                        # the client's coach when added
  client      FK Client
  date        Date                           # workspace time zone
  start_time  Time
  end_time    Time
  created_by  FK User, created_at
  index (workspace, client, date), (workspace, coach, date)

Workspace fields (defaults):  availability_horizon_days=90, slot_step_minutes=15,
                              min_notice_hours=24, buffer_minutes=0,
                              allow_client_suggest_time=False
```

- **One row per time range on one date.** Adding one range to 3 dates creates 3 rows.
- **Validation:**
  - start must be before end;
  - the date can't be in the past or beyond the horizon;
  - overlapping ranges on the same client and date are merged when saved;
  - the coach, the client and the row must all belong to the same workspace.
- **Old model removed:** `CoachAvailabilityRule` (model, table, serializer, viewset and
  the weekly UI) is deleted in this build. Its rows are test data and are not converted.
- **Workspace scoping:** every query filters by `workspace`, and Redis cache keys start
  with `ws:{id}:`.
- **Who can view, add or remove:** controlled by a new **Coach Availability**
  permission in Team management (§4.1).

### 4.1 Permission: "Coach Availability" in Team management

- **New permission area** `availability` (label "Coach Availability"), added alongside
  Clients, Pipeline, Activities, Invoices, Reports and Library. It uses the same
  View / Edit / Delete checkboxes the owner already sets per team member on the Team page.

| Checkbox | What it allows |
|---|---|
| **View** | See the Coach Availability tab on a client: calendar, upcoming list, busy times |
| **Edit** | Add availability (the Add form is shown) |
| **Delete** | Remove availability (the ✕ buttons are shown) |

- **Role defaults** (the owner can change them per person):

| Role | View | Edit | Delete |
|---|---|---|---|
| `business_owner` | ✓ | ✓ | ✓ (always; can't be restricted) |
| `coach` | ✓ | ✓ | ✓ |
| `assistant` | ✓ | — | — (the owner ticks Edit/Delete to let an assistant manage calendars) |
| `limited` | — | — | — |

- **Rules:**
  - **Which clients:** the permission works on top of which clients the person can
    already see (existing client scoping). An assistant can only manage availability for
    clients they can open.
  - **Times are always added for the client's coach.** When an assistant or the owner
    adds a time, it is saved under `client.coach`; the person who added it goes in
    `created_by` and is written to the audit log.
  - **Needs client access:** the tab lives on the client page, so it also requires
    **Clients → View**.
- **Code touch points:**
  - `TabPermission.Tab.AVAILABILITY`, plus a migration for the new choice;
  - `ALL_TABS` and `ROLE_TAB_DEFAULTS` in `apps/accounts/permissions.py`;
  - the API uses `require_tab("availability", "view" | "edit" | "delete")`;
  - the `TABS` list in `frontend/src/pages/coach/Team.tsx`;
  - `ClientDetail.tsx` hides the tab, the Add form or the ✕ buttons based on effective
    permissions.

---

## 5. Mockups

### 5.1 Coach: Client → Coach Availability tab (refined 2026-11-17)

**Clickable mockup:** https://claude.ai/artifact/AW1Hy5BeUD1UgE5Wh1x3Nd (private; share it
from the page's Share menu before sending it to anyone). It has four frames:
- **Coach / owner:** clickable. Select dates, change times, Add, remove, Undo, and page
  through the months.
- **First visit:** no availability yet.
- **Assistant:** the same screen with other clients' names hidden.
- **Mobile:** 390px wide.

#### Layout (top to bottom, one column, max width 1184px)

```
← Clients
(SB) shreya B Bhatla  [Lead] [PORTAL]
     shreyab1500@gmail.com · Coach: Sanvi Bhatlapenumarti
Overview  Goals  Activities  Notes  Files  Invoices  Client Communication  [Coach Availability]  Portal Permissions
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
Coach Availability                                                          (Cormorant 30px)
Add the dates and times shreya can pick from when she requests a reschedule, up to 3 months
ahead. Times when Sanvi is already booked are never offered.

┌ 📅  5 open dates · until Tue, Jan 12     Next open: Tue, Nov 24, 6:00 pm ───────────────────┐   ① SUMMARY

┌ ADD AVAILABILITY ──────────────────────────────────────────────────────────────────────────┐   ② ADD FORM
│ DATES                                             START          END                       │
│ [ Thu, Dec 3 ✕ ] [ Tue, Dec 22 ✕ ]                [10:00 am ▾]   [11:00 am ▾]  [+ ADD TO 2 DATES] │
│ ⚠ Thu, Dec 3 · 10:00–10:50 am overlaps a session with Maya Chen — that time won’t be      │
│   offered to shreya. You can still add it.                                                 │
│ ⓘ Tue, Dec 15 already has 6:00–7:00 pm. The new time is added alongside it.               │
└────────────────────────────────────────────────────────────────────────────────────────────┘

┌ NEXT 3 MONTHS                                        Clear selection   [‹] [›] ───────────┐   ③ CALENDAR
│      November 2026              December 2026               January 2027                  │
│ SUN MON TUE WED THU FRI SAT   SUN MON TUE WED THU FRI SAT   SUN MON TUE ...               │
│  1   2   3 … 16  17  18 …          ┌1┐  2  [3]  4   5               …                      │
│  (past: grey, disabled) TODAY      │6–7p     ●                                            │
│  ┌24┐                              ┌10┐ ┌15┐ [22]                                         │
│  │6–7p                             │2–4p│6–7p                                              │
│                                       ○   ●                                               │
│ ▢ open (time shown)  ■ selected  ● Sanvi has a session (any client)  ○ pending request     │
│ ▓ Added 10:00–11:00 am to 2 dates · 1 overlaps a booked time — that part won’t be offered. Undo │
└────────────────────────────────────────────────────────────────────────────────────────────┘

┌ UPCOMING AVAILABILITY ─────────────────────────────────────────────────────────────────────┐   ④ LIST
│ Tue, Nov 24     6:00 pm – 7:00 pm                                                     ✕   │
│ Tue, Dec 1      6:00 pm – 7:00 pm                                                     ✕   │
│ Thu, Dec 10     2:00 pm – 4:00 pm    ⚠ Partly booked · 2:30–3:20 pm (pending request…) ✕   │
│ Tue, Dec 15     6:00 pm – 7:00 pm    ⚠ Partly booked · 6:00–6:50 pm (session with John) ✕   │
│ Tue, Jan 12     9:00 am – 11:00 am                                                    ✕   │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### ① Summary line

| State | Text |
|---|---|
| Has dates | "**N open dates · until <last date>**  Next open: <first date>, <time>" |
| None | "**No open dates yet**  shreya can’t pick a new time until you add some." |

#### ② Add form

| Element | Behaviour |
|---|---|
| **Dates** field | Shows the selected dates as navy chips, sorted, each with ✕ to unselect. When empty it reads "Click dates on the calendar below". It's filled only by clicking the calendar; there's no separate date picker. |
| **Start / End** | Dropdowns, 6:00 am – 10:00 pm in 15-minute steps, in the workspace time zone. Default 10:00 am – 11:00 am, then whatever the coach last used. |
| **Add button** | "+ ADD" for one date, "+ ADD TO N DATES" for several. Disabled (greyed) when no date is selected or when End isn't after Start. |
| **Range error** | Red text "End time must be after start time." (only shown when dates are selected) |
| **Overlap warning** (amber, ⚠) | One line per overlapping booking, updated live as dates or times change. Coach and owner see "overlaps a session with Maya Chen" or "a pending request from Alex Rivera"; others see "another session" or "a pending request". Ends with "You can still add it." It never blocks Add. |
| **Already has times** (blue, ⓘ) | When a selected date already has times: "Tue, Dec 15 already has 6:00–7:00 pm. The new time is added alongside it (overlapping times are merged)." |
| **No Edit permission** | The whole card is replaced by the grey note "You have view-only access to Coach Availability. Ask the workspace owner for Edit access to add times." |

#### ③ Calendar (3 months)

- **Visible months:** the current month plus the next two; **›** pages forward one
  month, at most once (90-day limit), and **‹** pages back. On narrower screens the
  months wrap (two side by side, then one).
- **Clicking a day** selects or unselects it. This works for open days too: select one
  and add another time to it. Past days and days beyond 90 days can't be clicked.
- **Day cell states:**

| State | Look | Clickable |
|---|---|---|
| Past / beyond 90 days | Grey number, no box | No |
| Available to set (no times yet) | White box, thin border; "TODAY" label on today | Yes |
| **Open** (has times) | Light green box, bold green number, time under it ("6–7p", or "2 times" when there are several) | Yes |
| **Selected** | Solid navy box, white number (keeps its time label) | Yes (click again to unselect) |
| Marker: Sanvi has a session (any client) | Small solid blue dot at the bottom of the cell | — |
| Marker: pending reschedule request | Small hollow gold ring at the bottom of the cell | — |

- **Screen readers:** each day is a real `<button>` with an `aria-label`, e.g.
  "Thursday, December 3, open 10:00 am to 11:00 am, Sanvi has a session, selected", and
  `aria-pressed` for selection.
- **Legend:** shown under the grid.
- **"Clear selection"** appears in the header when anything is selected.
- **Undo message:** after Add or remove, a dark bar shows inside the card, e.g. "Added
  10:00–11:00 am to 2 dates · 1 overlaps a booked time — that part won’t be offered." or
  "Removed Tue, Dec 1 · 6:00–7:00 pm.", with **Undo**. It stays until the next action
  (or 10 seconds).

#### ④ Upcoming availability list

- **Rows:** one per time range, today onward, sorted by date then time:
  date · time range · optional amber "Partly booked · <time> (<who>)" tag · ✕.
  The ✕ button only shows with Delete permission.
- **"Partly booked":** shown whenever a session or pending request overlaps the range,
  including ones booked after the time was added. Names follow the same rule as the
  warning.
- **Empty state:** a gold calendar icon, "No availability yet", and "Click dates on the
  calendar, pick a start and end time, and press Add. shreya can only choose from the
  times you add here."

#### Mobile (under 768px)

- **Order:** header → tabs (scroll sideways) → summary → Add form, stacked (date chips,
  Start/End side by side, full-width Add button) → **one month** with ‹ › → list.
- **Day cells:** at least 44px wide, 52px tall.

#### Who sees what (from the Coach Availability permission, §4.1)

| Permission | Summary + calendar + list | Add form | ✕ remove | Other clients' names |
|---|---|---|---|---|
| Owner, or the client's coach | ✓ | ✓ | ✓ | ✓ |
| Assistant with View + Edit + Delete | ✓ | ✓ | ✓ | — ("another session") |
| Assistant with View only | ✓ | view-only note | — | — |
| No View | Tab hidden | | | |

#### Visual tokens (existing `index.css`)

- **Fonts:** Cormorant Garamond for headings; DM Sans for body.
- **Colors:**
  - navy `#1a2f4e`: buttons and selected days;
  - gold `#b8922e`: tab underline and accents;
  - cream `#f7f4ef`: page background;
  - border `#d4ccbf`;
  - open-day green `#e8f0e9` / `#2f5a3b`;
  - session dot `#2d6a9f`;
  - pending ring `#8a6a17`;
  - warning `#fbf1e6` / `#8a4512`;
  - info `#eef3f8` / `#1f4e78`.
- **Card headers:** uppercase 13px, letter-spacing .12em, matching today's "ADD A WEEKLY
  BLOCK" header.

#### Components (frontend)

- **`CoachAvailabilityPanel`** (rewrite of today's one in `ClientDetail.tsx`). It
  composes `AvailabilitySummary`, `AvailabilityAddForm`, `AvailabilityCalendar` and
  `AvailabilityList`, and holds `selectedDates`, `start`, `end` and `monthOffset`.
- **Data:** React Query keys `['client-availability', clientId]` for the blocks and
  `['client-availability-calendar', clientId, month]` for the busy times and pending
  markers.
- **Live warnings** are computed in the browser from the loaded calendar data. The
  server's `overlaps` result from Add is shown in the Undo message.

### 5.2 Client: session emails

The "next open times" block is added to these **four** client emails (all in
`tasks/email.py`):

| Email | When the client gets it | Today |
|---|---|---|
| **Session confirmation** (`send_activity_confirmation_email`) | Coach books a session | Has Confirm / Reschedule / Cancel buttons |
| **Session reminder** (`send_activity_reminder_email`) | Before the session (reminder schedule) | Has Reschedule / Cancel buttons |
| **Session rescheduled** (`send_activity_reschedule_email`) | Coach moves the session or confirms a new time | Has Reschedule / Cancel buttons |
| **Reschedule request declined** (`send_decline_reschedule_email`) | Coach declines the client's requested time | **No buttons today.** Add a Reschedule button plus the open times, so the client can pick another time straight away |

Not added to the cancellation email: the session is gone, and new bookings are out of
scope.

Example (confirmation email):

```
┌────────────────────────────────────────────────────────┐
│ [workspace logo]                                       │
│ Hi shreya,                                             │
│ Your session with Sanvi is confirmed.                  │
│                                                        │
│  What   One-on-One Coaching                            │
│  When   Tuesday, December 2 · 4:00–4:50 pm (ET)        │
│  Coach  Sanvi Bhatlapenumarti                          │
│                                                        │
│  [✓ CONFIRM]   [↻ RESCHEDULE]   [✕ CANCEL]             │  ← existing buttons
│                                                        │
│  Need a different time? Sanvi's next open times:       │  ← NEW
│  [ Tue Dec 9 ]  [ Thu Dec 11 ]  [ Tue Dec 16 ]         │
│  See all times →                                       │
└────────────────────────────────────────────────────────┘
```

- **Date buttons** link to `/session/reschedule/<token>/?date=2026-12-09`, which opens
  the picker with that date selected.
- **When the dates are worked out:** when the email is sent. The picker re-checks live.
- **No open times:** the "next open times" block is hidden.

### 5.3 Client: reschedule page (public link and portal)

```
┌───────────────────────┬────────────────────────────────────┬──────────────────────┐
│ [logo]                │  Select a Date & Time              │  Tuesday, Dec 9      │
│ Sanvi Bhatlapenumarti │                                    │  4 times available   │
│ One-on-One Coaching   │   ‹    December 2026    ›          │                      │
│ ⏱ 50 min              │  Sun Mon Tue Wed Thu Fri Sat       │  Afternoon           │
│                       │        1  (2)  3   4   5   6       │  [    2:00 pm    ]   │
│ Currently booked:     │   7  8 [(9)] 10  11  12  13        │  [ 2:30 pm |Request] │ ← picked time
│ Tue Dec 2, 4:00 pm    │  14 15 (16) 17  18  19  20         │  Evening             │
│ (stays booked until   │  21 22 (23) 24  25  26  27         │  [    6:00 pm    ]   │
│  your coach confirms) │  28 29 (30) 31                     │  [    6:15 pm    ]   │
│                       │                                    │                      │
│                       │  🌐 Central Time (auto) ▾  12h|24h │                      │
│                       │  Next available: Tue Dec 2 →       │                      │
├───────────────────────┴────────────────────────────────────┴──────────────────────┤
│  (hidden until allow_client_suggest_time is on)                                    │
│  None of these work?  Suggest your time — your current session stays booked.       │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**How days look**

| Day | Look |
|---|---|
| Available | Bold number on a light brand-colored filled circle, with a pointer cursor and a hover tooltip like "4 times" |
| Selected | Solid brand-colored circle with a white number |
| Today | Small dot under the number |
| Not available, past, or beyond 90 days | Plain grey number; can't be clicked |

Days also have `aria-label`s ("Tuesday December 9, 4 times available"), so color isn't
the only signal.

**Behaviour**
- **Opening:** the page opens on the month of the first open date, with that date
  selected, or on the `?date=` from the email.
- **Month arrows:** "›" skips empty months, and arrows stop at today and at 90 days.
- **Times:** grouped Morning / Afternoon / Evening. Clicking a time turns it into
  **Request**, and clicking Request opens a confirmation:

  ```
  Move your session to Tue Dec 9, 2:30–3:20 pm (Central)?
  Add a note (optional) [________________]
  [Back]  [Send request]
  ```

- **Time zone:** taken from the browser and can be changed. A note appears when it
  differs from the coach's time zone.
- **Taken in the meantime:** "That time was just taken — here are the latest times."
- **No open times at all:** the calendar is replaced by the "tell Sanvi when you're
  available" box and the **Request reschedule** button (§2.2 step 4). This is always
  shown, whatever the flag says.
- **Mobile:** one column, day circles at least 44px tall, and a "Request 2:30 pm" button
  fixed at the bottom of the screen.

**After sending**

```
✓ Request sent
Tue Dec 9, 2:30 pm (Central) — waiting for Sanvi to confirm.
Your current session (Tue Dec 2, 4:00 pm) stays booked until then.
You'll get an email when it's confirmed.
```

### 5.4 Coach: request email (existing notice, small additions)

```
Subject: shreya B Bhatla requested a new time
shreya asked to move "One-on-One Coaching" (Tue Dec 2, 4:00 pm)
  → Requested: Tue Dec 9, 2:30 pm
  Note: "Works better with my new schedule"
[Review in CoachOS]   → Confirm / Decline on the session (existing)

(When "Suggest your time" is on and used:  → No time picked — "I'm free mornings after Dec 15")
```

---

## 6. API

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/clients/<id>/availability/?from=&to=` | Coach JWT | The client's blocks (replaces the weekly-rule list at the same URL) |
| `POST /api/clients/<id>/availability/` | Coach JWT | `{dates:[…], start_time, end_time}` creates one block per date and returns the blocks plus an `overlaps` list per block (the server re-check; `client_name` included only for the client's coach and the owner) |
| `DELETE /api/clients/<id>/availability/<block_id>/` | Coach JWT | Removes one block |
| `GET /api/clients/<id>/availability/calendar/?month=` | Coach JWT | Per day: blocks, busy times, pending requests (other clients' names only for the client's coach and the owner); plus `open_dates_count`, `last_open_date`, `next_open` |
| `GET /session/reschedule/<token>/slots/?month=` | Signed token | Client picker: `{days:{date:[utc…]}, first_open, horizon_end, coach_tz, suggest_enabled}` |
| `GET /api/portal/activities/<id>/slots/?month=` | Portal JWT | Same response as above, for the portal |
| `POST /session/reschedule/<token>/` and portal respond | Existing | `slot` (re-checked on the server), **or** `message` alone when the coach has no open times or `allow_client_suggest_time` is on |

---

## 7. Implementation TODO

**Backend: model and logic**
- [ ] New model `CoachAvailabilityBlock` and its migration
- [ ] Delete `CoachAvailabilityRule`: model, migration that drops the table, serializer, viewset, admin, and the references in `seed_demo_workspace`, `test_tenant_isolation`, `test_delete_workspace`
- [ ] Workspace fields: `availability_horizon_days`, `slot_step_minutes`, `min_notice_hours`, `buffer_minutes`, `allow_client_suggest_time` (default off)
- [ ] Validation:
  - [ ] start before end; merge overlapping ranges on the same date
  - [ ] dates not in the past and not beyond the horizon
  - [ ] coach, client and row in the same workspace
- [ ] `availability.py`:
  - [ ] `offered_hours` (§3.1)
  - [ ] busy sources: sessions, pending requests, buffer, minimum notice (§3.2)
  - [ ] `open_slots(month)` (§3.3)
  - [ ] `first_open_date` and `last_open_date`
- [ ] Keep `compute_available_slots(activity)` as a wrapper around `open_slots`; rewrite `is_within_availability` for blocks

**Backend: endpoints (§6)**
- [ ] Blocks list, add (many dates), delete
- [ ] Coach calendar month summary
- [ ] Public `/slots/?month=` endpoint and portal `/slots/` endpoint
- [ ] Reschedule page: read `?date=`; return a "just taken" message when the re-check fails
- [ ] Note-only requests (`message` without a `slot`): accept when there are no open times or the flag is on; otherwise return 400. Applies to the public view and the portal respond view
- [ ] New `availability` permission (§4.1):
  - [ ] `TabPermission.Tab.AVAILABILITY` and its migration
  - [ ] `ALL_TABS` and `ROLE_TAB_DEFAULTS` (coach V/E/D, assistant V, limited none)
  - [ ] `require_tab("availability", …)` on list/calendar (view), add (edit), delete (delete)
- [ ] Times always saved under `client.coach`, with `created_by` set and an audit log entry; the demo workspace stays read-only (existing middleware)
- [ ] Superadmin or Django-admin toggle for `allow_client_suggest_time`

**Frontend: coach** (spec and mockup: §5.1)
- [ ] Team page: add "Coach Availability" to the `TABS` list in `Team.tsx`, giving View/Edit/Delete checkboxes per member
- [ ] Rewrite `CoachAvailabilityPanel` in `ClientDetail.tsx` as summary + add form + calendar + list (§5.1 Components)
- [ ] `AvailabilitySummary`: open-date count, last date, next open; empty wording
- [ ] `AvailabilityAddForm`:
  - [ ] date chips filled from calendar selection (✕ to unselect)
  - [ ] Start/End dropdowns (15-min, 6am–10pm), defaulting to the last-used times
  - [ ] "+ ADD" / "+ ADD TO N DATES", disabled when nothing is selected or the range is invalid
  - [ ] range error
  - [ ] live amber overlap warnings and blue "already has times" notes
  - [ ] view-only note without Edit
- [ ] `AvailabilityCalendar`:
  - [ ] 3 months, with ‹ › limited to 90 days; months wrap on narrow screens
  - [ ] day states: past/beyond, available, open with time label, selected, today
  - [ ] session dot and pending ring
  - [ ] real buttons with `aria-label` / `aria-pressed`
  - [ ] legend, Clear selection, Undo message
- [ ] `AvailabilityList`: rows sorted, "Partly booked" tag, ✕ only with Delete, empty state
- [ ] Names in warnings and tags only when the API returns `client_name` (coach/owner); otherwise "another session"
- [ ] Mobile (<768px): stacked form, one month, 44×52 day cells
- [ ] Remove the old weekly form, `createAvailability({weekday…})` usage and its API client methods

**Client: reschedule page and portal**
- [ ] Public reschedule page (Django + small plain JS):
  - [ ] month grid with highlighted days, Morning/Afternoon/Evening times
  - [ ] two-step Request, confirmation step
  - [ ] time zone and 12h/24h
  - [ ] opens on the first open date, "›" skips empty months
  - [ ] no-times state: "tell your coach when you're available" box + Request reschedule (always shown)
  - [ ] "Suggest your time" box rendered only when `suggest_enabled`
  - [ ] mobile layout
- [ ] Portal `SlotPicker` (React) with the same states, replacing the free-text box; suggest box behind the same flag
- [ ] Remove the Cancel action from the reschedule page; the email's Cancel link stays

**Email**
- [ ] "Next open times" block (3 date buttons + See all times) in the four emails in §5.2; hidden when there are none
- [ ] Decline email: add a Reschedule button (a new signed token) and the open-times block
- [ ] Coach request notice: show the requested time and the note (plus the "No time picked" variant for when the flag is on)

**Tests**
- [ ] Blocks:
  - [ ] add to many dates; merge overlapping ranges
  - [ ] past or beyond-horizon dates rejected
  - [ ] delete
- [ ] Time handling:
  - [ ] `offered_hours` across a daylight-saving change
  - [ ] a client with no blocks gets no times
- [ ] Busy handling:
  - [ ] a session or pending request with another client blocks the time
  - [ ] a cancelled session doesn't block
  - [ ] buffer and minimum notice
- [ ] Reschedule:
  - [ ] the re-check rejects a time that was just taken
  - [ ] confirm is blocked outside the offered blocks
- [ ] Overlap names: the coach and owner get `client_name` in `overlaps` and the calendar summary; an assistant gets no `client_name`
- [ ] Note-only requests:
  - [ ] no open times: accepted with the flag off, and the session stays booked
  - [ ] open times and flag off: 400, and no "None of these work" link shown
  - [ ] flag on: accepted
- [ ] Permissions:
  - [ ] assistant by default: can view, but adding or removing returns 403
  - [ ] after the owner grants Edit/Delete, the assistant can add or remove
  - [ ] `limited` gets 403 on view
  - [ ] a time added by an assistant is saved under `client.coach`
- [ ] `test_tenant_isolation.py`: no cross-workspace access to blocks, the calendar summary or the slots endpoints
- [ ] Local click-through: coach adds dates → client email → pick a time → coach confirms

---

## 8. Decisions and remaining questions

**Decided (2026-11-16 – 2026-11-17)**
- **Overlap warning wording:**
  - the client's coach and the workspace owner see the other client's name, e.g.
    "overlaps a session with John";
  - other team members, such as an assistant, see "overlaps another session".
  - **Clients never see overlap warnings.** The client's page only lists open dates and
    times; booked times just don't appear.

  This applies to the live warning, the Add confirmation and the "partly booked" tag
  (§2.1).
- **No open times:** the client sees a box to write when they're available, plus a
  **Request reschedule** button (§2.2 step 4).
- **Coach reassignment:** out of scope. It's a separate requirement, handled later.
- **Assistants:** controlled by the new Coach Availability permission in Team
  management (§4.1).
- **Google Calendar:** not read. Clients see only the times the coach marked as
  available, minus times already booked or requested in CoachOS.
- **Emails:** the open-times block goes in the confirmation, reminder, rescheduled and
  reschedule-declined emails (§5.2).

**Still to confirm** (each has a recommendation; plain-language explanation first)

1. **Booking rules.** Three fixed rules decide which start times a client is offered:
   - **Minimum notice, 24 hours:** a client can't request a time less than 24 hours
     away. At 3pm Monday, the earliest time shown is 3pm Tuesday. This gives the coach
     time to see and confirm the request.
   - **Gap between sessions, 0 minutes:** no extra space is kept around the coach's other
     sessions. With 15 minutes, a session ending at 2:00 means the next offered time
     starts at 2:15.
   - **Start-time steps, 15 minutes:** within an open block, start times are offered every
     15 minutes. A 2–4pm block with 50-minute sessions offers 2:00, 2:15, 2:30, 2:45 and
     3:00 (3:15 would run past 4pm). With 30-minute steps, it would offer 2:00, 2:30 and
     3:00.

   **Recommendation:** keep these three as fixed values for now, with no Settings
   screen. Confirm the numbers, or give different ones.
