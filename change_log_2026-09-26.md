# Change Log — 2026-09-26

High-level summary of everything currently sitting in the working tree, not yet
committed. Grouped by feature. Written before commit per team convention (see
bottom of file for the process note).

---

## 1. Client portal — Overview tab redesign

- `frontend/src/pages/portal/ClientPortal.tsx` (`OverviewTab`) — rebuilt to
  show what a client actually needs at a glance, not a raw dump of every
  record:
  - **Outstanding invoices** now scoped to the next 30 days (always still
    includes anything already overdue, however old) instead of listing every
    unpaid invoice ever sent. The "Amount Due" stat card reflects this same
    scoped total.
  - **Upcoming sessions** bumped from 3 to 5, sorted soonest-first, and now
    also picks up `rescheduled` sessions (previously only `scheduled` showed,
    so a rescheduled session silently disappeared from Overview).
  - New **"Goals Due"** section — active goals with a target date, soonest/
    most-overdue first, each showing an Overdue/Scheduled pill and a progress
    count. Stat card changed from "Active Goals" (a count with no urgency
    signal) to "Goals Due" to match.
  - All three sections (Upcoming Sessions / Goals Due / Outstanding This
    Month) now render as **three parallel columns** in a grid instead of
    stacked full-width sections, so all three are visible together without
    scrolling through one to reach the next. Each column shows a light empty
    state if it has no items; the full-page "You're all caught up" message
    only appears when all three are genuinely empty.
- Frontend-only. No backend/API changes.

## 2. Client portal — Invoices tab redesign

- `frontend/src/pages/portal/ClientPortal.tsx` (`InvoicesTab`, new
  `InvoiceCard` + `clientStatus()` helper):
  - Invoices split into **Pending / Paid sub-tabs** (with live counts)
    instead of one flat mixed list.
  - Pending tab sorted by due date, soonest first (no-due-date invoices
    pushed to the end).
  - Backend's finer-grained statuses (`draft`/`sent`/`partially_paid`/…)
    collapsed into **3 client-facing states: Paid, Overdue, Scheduled** —
    computed client-side from `due_date` so "Overdue" is accurate even before
    the backend's own status catches up (see §6 below).
  - Fixed a real layout bug: the card header was reusing the `.card-hdr` CSS
    class (meant for small uppercase section labels like "NEW NOTE"), which
    force-centered and shrank the invoice number/amount. Replaced with a
    purpose-built row: invoice number + issued date on the left, status pill
    + due date next to it, amount + chevron on the right.
  - `frontend/src/index.css` — `.pill` class updated to render uppercase/bold
    everywhere (previously only looked that way by accident inside
    `.card-hdr`); made deliberate and applied consistently across Activities,
    Goals, and Invoices.

## 3. Client portal — visual consistency pass (logo + spacing)

- `frontend/src/pages/portal/ClientPortal.tsx` (`PortalSidebar`) — sidebar
  logo was rendering as a blank white box (`filter: brightness(0) invert(1)`
  only works for a transparent-background logo). Replaced with a white
  rounded card behind the logo image, matching how it's shown elsewhere in
  the app against a dark background.
- Spacing aligned across tabs: `ActivitiesTab`/`NotesTab` title-block padding
  (`24px 0 16px` → `24px 0 20px`, matching Overview/Goals/Files/Invoices);
  `FilesTab`'s file-list column width/gap (`280px`/`20px` → `300px`/`24px`,
  matching Notes tab's equivalent two-column layout).

## 4. Client portal — Activities/reschedule textarea typing bug (real fix)

- `frontend/src/pages/portal/ClientPortal.tsx` — the "Message to your coach"
  textarea on the Reschedule form appeared to type backwards/scrambled.
  **Root cause:** `ActivityCard` was defined as a nested function *inside*
  `ActivitiesTab`'s render body, so it was recreated as a brand-new component
  on every keystroke (every `setMsg` call re-renders `ActivitiesTab`, which
  redefines `ActivityCard`), forcing React to fully unmount/remount the card
  — including the textarea's DOM node — on every character. The freshly
  mounted textarea's `autoFocus` then reset the cursor to the start each
  time, so new characters kept getting inserted before the previous ones.
  **Fix:** hoisted `ActivityCard` to module scope (a sibling of
  `ActivitiesTab`, not nested inside it), passing `reschedId`/`setReschedId`/
  `msg`/`setMsg`/`saving`/`sendReschedule` in as props. Component identity is
  now stable across renders, so React updates the textarea in place instead
  of remounting it.
- Frontend-only. No backend/API changes.

## 5. Coach invoicing — auto-Overdue status + auto-archive Void

- **Overdue was silently broken:** `Invoice.Status.OVERDUE` existed as a
  choice and both the standalone Invoices page and `ClientDetail`'s invoice
  tables already had filters/stats built for it, but nothing in the codebase
  ever actually set an invoice's status to `overdue` (confirmed via grep —
  the only place that value was ever assigned was the demo-seed script).
  Verified locally: 8 real invoices were sitting `Sent` with due dates months
  in the past, and the "Overdue" filter had been empty this whole time.
- `backend/tasks/invoicing.py` — new daily task
  `tasks.invoicing.mark_overdue_invoices`: flips `Sent` invoices with a past
  due date and zero payment recorded to `Overdue`. Partially-paid invoices
  are deliberately left alone (kept as their own "Partial" bucket per
  product decision — an overdue-but-partially-paid invoice does not get
  reclassified out of Partial).
- `backend/config/settings/base.py` — registered in `CELERY_BEAT_SCHEDULE`,
  daily at 6am, ahead of the existing `dispatch-subscription-invoices` job so
  a freshly-cloned period invoice is never swept up by the same run.
- `backend/apps/invoicing/views.py` (`InvoiceViewSet.void_invoice`) — voiding
  an invoice now also sets `archived=True`/`archived_at` immediately, so it
  drops out of the default "All" list into Archive right away instead of
  lingering until someone manually archives it (3 pre-existing void invoices
  found sitting un-archived in local data).
- No model/migration changes — reuses the existing `status` and
  `archived`/`archived_at` fields.
- **Client portal needed no changes** — `PortalInvoicesView` already
  excludes Void/Refunded/Draft from what a client can see, and the portal's
  own `clientStatus()` helper (§2 above) already computes "Overdue" live
  from the due date; it will simply agree with the real backend status once
  this ships.
- **Verified locally**: restarted `celery_worker`/`celery_beat`, confirmed
  `tasks.invoicing.mark_overdue_invoices` registers
  (`celery -A config inspect registered`), ran it once and it correctly
  flagged 8 stale `Sent` invoices as `Overdue`, and backfilled the 3
  pre-existing `Void`-but-not-archived invoices by hand.

## 6. Celery worker — `tasks.health.check_site_health` KeyError fix

- Production/local logs showed `KeyError: 'tasks.health.check_site_health'`
  every time Celery Beat tried to dispatch the `check-site-health` job.
  **Root cause:** `tasks/health.py` (site reachability + SSL cert expiry
  check, added in an earlier session) was never added to the explicit
  `app.conf.include` list in `backend/config/celery.py` — Celery's
  `autodiscover_tasks()` only scans Django apps' own `tasks.py` files, not
  the standalone `tasks/` package's individual modules, so the worker had
  never imported `tasks/health.py` and had no strategy registered for that
  task name.
- `backend/config/celery.py` — added `'tasks.health'` to `app.conf.include`.
- **Verified locally**: restarted `celery_worker`/`celery_beat`, confirmed
  `tasks.health.check_site_health` now appears under
  `celery -A config inspect registered`, no further `KeyError` in worker
  logs.

---

## Production deploy notes

- **No new env vars, no new migrations** in today's work — everything above
  is either frontend-only or reuses existing backend fields/settings.
- **Celery worker + beat must be restarted** after this deploy for two
  independent reasons — §5's new `mark-overdue-invoices` beat schedule entry
  and §6's `tasks.health` include fix will not take effect until they are:
  ```
  docker compose -f docker-compose.prod.yml restart celery_worker celery_beat
  ```
- Optional one-off backfill for prod, mirroring what was done locally in
  §5 (safe to run any time, idempotent):
  ```
  docker compose -f docker-compose.prod.yml exec backend python manage.py shell -c "
  from apps.invoicing.models import Invoice
  from django.utils import timezone
  print(Invoice.objects.filter(status=Invoice.Status.VOID, archived=False).update(archived=True, archived_at=timezone.now()))
  "
  ```

---

## Process note

Per team convention: a `change_log_<YYYY-MM-DD>.md` file like this one is
added/updated before every commit, summarizing what that commit contains at
a high level.
