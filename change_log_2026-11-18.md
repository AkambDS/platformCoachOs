# Change Log — 2026-11-18

Work from 2026-11-15 to 2026-11-18, after the 2026-11-15 log. One commit per part, in this
order. **Nothing here is deployed yet** — see **Deploy** at the end (2 migrations).

| Part | Change |
|---|---|
| **A** | Site-health job runs in production only (no more false "Site unreachable" alerts from a laptop) |

---

# Part A — Site-health job: production only

## What was wrong
`tasks.health.check_site_health` (Celery beat, every 30 min) always checks the **production**
URL. Run from a laptop, it emailed "Site unreachable" (to Mailpit locally) whenever the machine
slept or lost its network — the alerts seen on 2026-11-10.

## Fix
- New setting `SITE_HEALTH_CHECK_ENABLED`: off in `base.py` (local/dev), on in `production.py`.
  The task returns straight away when it's off.
- Checked inside the task, not by removing the beat entry, because beat's
  `DatabaseScheduler` keeps running a job it has already saved.
- Prod is unchanged (on by default); `SITE_HEALTH_CHECK_ENABLED=False` in `.env` would stop it.
