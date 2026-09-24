import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { demoApi } from '../api/client'
import { DEMO_EMAIL, DEMO_LEAD_EMAIL_KEY } from '../constants/demo'

interface TourStep {
  path: string
  element: string
  title: string
  description: string
  ownerOnly?: boolean
}

// Each step navigates to the real screen it describes, then highlights an element on it —
// a genuine screen-by-screen walkthrough, not just a static sidebar orientation. Anchored
// on the sidebar's `[data-tour="..."]` markers (see Sidebar.tsx's COACH_NAV) since those
// stay stable across every page's own markup; the Settings step also highlights real
// in-page content via `data-tour="settings-integrations"` (Settings.tsx).
const STEPS: TourStep[] = [
  {
    path: '/dashboard', element: '[data-tour="dashboard"]',
    title: 'Dashboard',
    description: 'Your practice at a glance — active clients, pipeline value, upcoming sessions, and outstanding invoices, updated in real time.',
  },
  {
    path: '/clients', element: '[data-tour="clients"]',
    title: 'Clients (CRM)',
    description: 'Every client record lives here — contact info, goals, commitments, notes, and full session history. Open any client and turn on "Client Portal Access" to give them their own self-serve login.',
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
    path: '/reports', element: '[data-tour="reports"]',
    title: 'Reports',
    description: 'Monthly revenue, outstanding balances, and client activity — export any report to CSV.',
  },
  {
    path: '/library', element: '[data-tour="library"]',
    title: 'Library',
    description: 'A shared document library for templates and resources. Organize into folders and choose exactly which clients can see each item.',
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
]

export function useTour() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const startTour = () => {
    const isOwner = user?.role === 'business_owner'
    const steps = STEPS.filter((s) => !s.ownerOnly || isOwner)
    if (!steps.length) return

    // Only the public demo login reports tour milestones — a real coach's own "Take a
    // Tour" click never touches the lead-tracking endpoint (see DemoGateModal.tsx /
    // apps.superadmin.views.demo_lead_event).
    const isDemoUser = user?.email === DEMO_EMAIL
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
        const el = document.querySelector(step.element)
        if (!el) { showStep(i + 1); return }

        driverObj.highlight({
          element: step.element,
          popover: {
            title: `${step.title} (${i + 1}/${steps.length})`,
            description: step.description,
            side: 'right',
            showButtons: ['next', 'previous', 'close'],
            disableButtons: i === 0 ? ['previous'] : [],
            nextBtnText: i === steps.length - 1 ? 'Finish' : 'Next →',
            prevBtnText: '← Back',
            onNextClick: () => {
              if (i === steps.length - 1) {
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
