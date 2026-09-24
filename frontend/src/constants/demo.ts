// Credentials for the public "try the live demo" flow on the Login page.
// Must match apps/accounts/management/commands/seed_demo_workspace.py on the backend —
// that command provisions this workspace/user and is idempotent, so it's safe to re-run.
export const DEMO_EMAIL = "demo@coachos.rass-consulting.com"
export const DEMO_PASSWORD = "CoachOSDemo!2026"

// Must match DEMO_WORKSPACE_SLUG in backend/config/middleware.py, which uses this to
// block all writes/deletes/notifications for this workspace — read-only by design.
export const DEMO_WORKSPACE_SLUG = "coachos-demo"

// Consumed once by Dashboard on mount to auto-launch the guided tour right after a
// demo login, then cleared — a real login never sets this.
export const DEMO_START_TOUR_KEY = "coachos_start_tour"

// The email the visitor entered in DemoGateModal — read by useTour.ts to report
// tour_started/tour_completed against that lead. Set alongside DEMO_START_TOUR_KEY.
export const DEMO_LEAD_EMAIL_KEY = "coachos_demo_lead_email"

// Remembered so a returning visitor doesn't have to retype the gate form — still shown
// every time (pre-filled), since we want every demo session captured, not just the first.
export const DEMO_LEAD_LOCALSTORAGE_KEY = "coachos_demo_lead"
