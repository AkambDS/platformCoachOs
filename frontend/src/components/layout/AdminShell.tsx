import { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import {
  LayoutDashboard, Building2, Receipt, KeyRound, MessageSquarePlus, Bell,
} from 'lucide-react'

const ADMIN_TABS = [
  { to: '/admin',            hash: '',             Icon: LayoutDashboard,  label: 'Overview'          },
  { to: '/admin#workspaces', hash: '#workspaces',  Icon: Building2,        label: 'Workspaces'        },
  { to: '/admin#invoices',   hash: '#invoices',    Icon: Receipt,          label: 'Invoices'          },
  { to: '/admin#tokens',     hash: '#tokens',      Icon: KeyRound,         label: 'Workspace Invites' },
  { to: '/admin#feedback',   hash: '#feedback',    Icon: MessageSquarePlus,label: 'Feedback'          },
  { to: '/admin#banner',     hash: '#banner',      Icon: Bell,             label: 'Maintenance Banner'},
]

function AdminTopNav() {
  const { hash } = useLocation()

  return (
    <div style={{
      background: 'var(--white)',
      borderBottom: '1px solid var(--border)',
      padding: '0 32px',
      display: 'flex',
      alignItems: 'center',
      gap: 0,
      overflowX: 'auto',
      boxShadow: 'var(--shadow-sm)',
      position: 'sticky',
      top: 0,
      zIndex: 10,
    }}>
      {ADMIN_TABS.map(({ to, hash: h, Icon, label }) => {
        const isActive = h === '' ? hash === '' || hash === '#overview' : hash === h
        return (
          <NavLink
            key={to}
            to={to}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '14px 18px',
              fontSize: 13, fontWeight: isActive ? 600 : 400,
              color: isActive ? 'var(--ink)' : 'var(--muted)',
              borderBottom: isActive ? '2px solid var(--gold)' : '2px solid transparent',
              marginBottom: -1,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              transition: 'color .15s',
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            <Icon size={13} strokeWidth={1.75} />
            {label}
          </NavLink>
        )
      })}
    </div>
  )
}

export default function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <div className="main-offset" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <AdminTopNav />
        <div style={{ flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  )
}
