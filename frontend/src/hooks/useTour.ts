import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'

export function useTour() {
  const startTour = () => {
    const driverObj = driver({
      showProgress: true,
      animate: true,
      overlayColor: 'rgba(10,20,40,.5)',
      nextBtnText: 'Next →',
      prevBtnText: '← Back',
      doneBtnText: 'Done',
      steps: [
        {
          element: '[data-tour="dashboard"]',
          popover: {
            title: 'Dashboard',
            description: 'Your overview — active clients, upcoming sessions, revenue, and outstanding invoices at a glance.',
            side: 'right',
          },
        },
        {
          element: '[data-tour="clients"]',
          popover: {
            title: 'Clients',
            description: 'Manage all your client profiles, session history, goals, and notes here.',
            side: 'right',
          },
        },
        {
          element: '[data-tour="pipeline"]',
          popover: {
            title: 'Pipeline',
            description: 'Track prospects through stages — from Lead to Active Client. Drag and drop to move them forward.',
            side: 'right',
          },
        },
        {
          element: '[data-tour="activities"]',
          popover: {
            title: 'Activities',
            description: 'Schedule sessions, log calls, and set reminders. Automated emails go out before each session.',
            side: 'right',
          },
        },
        {
          element: '[data-tour="invoices"]',
          popover: {
            title: 'Invoices',
            description: 'Create and send professional invoices. Record payments and track outstanding balances.',
            side: 'right',
          },
        },
        {
          element: '[data-tour="reports"]',
          popover: {
            title: 'Reports',
            description: 'View revenue trends, outstanding payments, and client activity reports.',
            side: 'right',
          },
        },
        {
          element: '[data-tour="settings"]',
          popover: {
            title: 'Settings',
            description: 'Configure your workspace, invite team members, and customise branding.',
            side: 'right',
          },
        },
      ],
    })
    driverObj.drive()
  }

  return { startTour }
}
