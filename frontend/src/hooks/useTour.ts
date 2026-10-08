import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { demoApi } from '../api/client'
import { DEMO_EMAIL, DEMO_LEAD_EMAIL_KEY } from '../constants/demo'

interface TourStep {
  path: string
  // Omitted for a centered, dialog-style step (driver.js's built-in "no element"
  // mode) — used for the intro and the closing portal-preview step, neither of
  // which highlights anything on the page itself.
  element?: string
  title: string
  description: string
  ownerOnly?: boolean
  // Only shown on the public demo login, never on a real coach's own "Take a Tour"
  // click — see isDemoUser below. Keeps the portal-preview step (which logs into
  // one specific fake client) from ever appearing for a real coach's real clients.
  demoOnly?: boolean
  // Replaces `description` for the demo user only — lets the intro promise the
  // portal-preview step without making that promise to real coaches, who never get it.
  demoDescription?: string
}

// Each step navigates to the real screen it describes, then highlights an element on it —
// a genuine screen-by-screen walkthrough, not just a static sidebar orientation. Anchored
// on the sidebar's `[data-tour="..."]` markers (see Sidebar.tsx's COACH_NAV) since those
// stay stable across every page's own markup; the Settings step also highlights real
// in-page content via `data-tour="settings-integrations"` (Settings.tsx).
const STEPS: TourStep[] = [
  {
    path: '/dashboard',
    title: 'One practice, three logins',
    description: "CoachOS has a login for you (the owner), one for any coaches you add, and a completely separate self-serve Client Portal for your clients. Let's walk through your side of the app.",
    demoDescription: "CoachOS has a login for you (the owner), one for any coaches you add, and a completely separate self-serve Client Portal for your clients. We'll walk through your side first, then show you the portal at the end.",
  },
  {
    path: '/dashboard', element: '[data-tour="dashboard"]',
    title: 'Dashboard',
    description: 'Your practice at a glance — active clients, pipeline value, upcoming sessions, and outstanding invoices, updated in real time.',
  },
  {
    path: '/clients', element: '[data-tour="clients"]',
    title: 'Clients (CRM)',
    description: 'Every client record lives here — contact info, goals, commitments, notes, and full session history. Open any client for a "Coach Availability" tab (set weekly hours so that client can self-serve a reschedule) and a "Client Portal Access" toggle to give them their own login.',
  },
  {
    path: '/pipeline', element: '[data-tour="pipeline"]',
    title: 'Pipeline',
    description: 'Track prospects from first contact to active client on a drag-and-drop kanban board, with a full audit trail of every stage change.',
  },
  {
    path: '/calendar', element: '[data-tour="activities"]',
    title: 'Calendar & Activities',
    description: 'Schedule sessions and calls, set up recurring series, and sync two-way with Google Calendar. Confirmation and reminder emails go out automatically.',
  },
  {
    path: '/invoices', element: '[data-tour="invoices"]',
    title: 'Invoices',
    description: 'Create one-time or recurring invoices and send them with a working Stripe pay link. Payments go straight to your own Stripe account — CoachOS never holds your funds.',
  },
  {
    path: '/email-communication', element: '[data-tour="email-communication"]',
    title: 'Email Communication',
    description: 'Every email CoachOS sends for your workspace in one place — to your clients, to you and your coaches, and to new team members — so you always know exactly what everyone has been told.',
    ownerOnly: true,
  },
  {
    path: '/email-communication', element: '[data-tour="email-tabs"]',
    title: 'Sent, Scheduled & Failed',
    description: "Sent shows the last 30 days, with the exact email as it went out. Scheduled looks ahead 30 days at what's about to go out automatically — session reminders, recurring invoices, pipeline follow-ups — and you can preview each one with real data before it sends. Any email that couldn't be delivered appears under Failed, with the reason.",
    ownerOnly: true,
  },
  {
    path: '/email-communication', element: '[data-tour="email-filters"]',
    title: 'Find any email fast',
    description: 'Filter by recipient (clients, you & your coaches, or team), by email type, or by client, or just search. Click any row to see the full email.',
    ownerOnly: true,
  },
  {
    path: '/library', element: '[data-tour="library"]',
    title: 'Library',
    description: 'A shared document library for templates and resources. Organize into folders and choose exactly which clients can see each item.',
  },
  {
    path: '/reports', element: '[data-tour="reports"]',
    title: 'Reports',
    description: 'Monthly revenue, outstanding balances, and client activity — export any report to CSV.',
  },
  {
    path: '/settings', element: '[data-tour="settings"]',
    title: 'Settings',
    description: "Configure your workspace's branding, taxonomies (statuses, tags, sources), and scheduling preferences.",
  },
  {
    path: '/settings', element: '[data-tour="settings-integrations"]',
    title: 'Integrations',
    description: 'Connect Google Calendar, Zoom, and your own Stripe account here — each with your own credentials, kept encrypted.',
  },
  {
    path: '/team', element: '[data-tour="team"]',
    title: 'Team Management',
    description: 'Invite coaches and assistants, and fine-tune exactly which sections each teammate can view, edit, or delete.',
    ownerOnly: true,
  },
  {
    path: '/team',
    title: "Now, your client's view",
    description: "Clicking Finish opens the Client Portal in a new tab, logged in as one of this workspace's clients — her own goals, invoices, sessions, and shared materials, nothing from your side of the app. It's read-only here, so feel free to click around.",
    ownerOnly: true,
    demoOnly: true,
  },
]

export function useTour() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const startTour = () => {
    const isOwner = user?.role === 'business_owner'
    // Only the public demo login reports tour milestones — a real coach's own "Take a
    // Tour" click never touches the lead-tracking endpoint (see DemoGateModal.tsx /
    // apps.superadmin.views.demo_lead_event). Also gates the portal-preview step,
    // which only ever makes sense against the demo's own fake client.
    const isDemoUser = user?.email === DEMO_EMAIL
    const steps = STEPS.filter((s) => (!s.ownerOnly || isOwner) && (!s.demoOnly || isDemoUser))
    if (!steps.length) return

    const leadEmail = isDemoUser ? sessionStorage.getItem(DEMO_LEAD_EMAIL_KEY) : null
    if (leadEmail) demoApi.reportEvent(leadEmail, 'tour_started').catch(() => {})

    const driverObj = driver({
      animate: true,
      overlayColor: 'rgba(10,20,40,.5)',
      progressText: '{{current}} of {{total}}',
    })

    const showStep = (i: number) => {
      const step = steps[i]
      if (!step) { driverObj.destroy(); return }

      navigate(step.path)
      // AppShell (and its Sidebar) remounts on every route change, so give React a tick
      // to commit before locating the anchor element.
      window.setTimeout(() => {
        // Centered, dialog-style step (intro / portal-preview) — no element to find.
        const el = step.element ? document.querySelector(step.element) : null
        if (step.element && !el) { showStep(i + 1); return }

        driverObj.highlight({
          ...(step.element ? { element: step.element } : {}),
          popover: {
            title: step.title,
            description: (isDemoUser && step.demoDescription) || step.description,
            side: 'right',
            showButtons: ['next', 'previous', 'close'],
            showProgress: true,   // driver.js hides .driver-popover-progress-text (inline display:none) without this
            disableButtons: i === 0 ? ['previous'] : [],
            nextBtnText: i === steps.length - 1 ? 'Finish' : 'Next →',
            prevBtnText: '← Back',
            onPopoverRender: (popover) => {
              const pct = Math.round(((i + 1) / steps.length) * 100)
              popover.progress.innerHTML = `
                <div class="tour-progress-label">Step ${i + 1} of ${steps.length}</div>
                <div class="tour-progress-track">
                  <div class="tour-progress-fill" style="width:${pct}%"></div>
                </div>
              `
            },
            onNextClick: () => {
              if (i === steps.length - 1) {
                if (isDemoUser) window.open('/client-portal?demo=1', '_blank')
                if (leadEmail) demoApi.reportEvent(leadEmail, 'tour_completed').catch(() => {})
                driverObj.destroy()
                return
              }
              showStep(i + 1)
            },
            onPrevClick: () => { if (i > 0) showStep(i - 1) },
            onCloseClick: () => driverObj.destroy(),
          },
        })
      }, 200)
    }

    showStep(0)
  }

  return { startTour }
}
