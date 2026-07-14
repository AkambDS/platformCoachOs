import { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import {
  LayoutDashboard, Building2, Receipt, KeyRound, MessageSquarePlus, Bell,
} from 'lucide-react'
import { useAuthStore } from '../../store/auth'

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
      background: '#ece5d8',
      borderBottom: '1px solid #d4c9b4',
      padding: '0 28px',
      display: 'flex',
      alignItems: 'center',
      overflowX: 'auto',
      position: 'sticky' as const,
      top: 0,
      zIndex: 10,
      flexShrink: 0,
      boxShadow: '0 1px 4px rgba(26,23,20,.08)',
    }}>
      {ADMIN_TABS.map(({ to, hash: h, Icon, label }) => {
        const isActive = h === '' ? hash === '' || hash === '#overview' : hash === h
        return (
          <NavLink
            key={to}
            to={to}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '13px 16px',
              fontSize: 13,
              fontWeight: 500,
              color: isActive ? '#1a1714' : '#7a6e64',
              borderBottom: isActive ? '2px solid #b8922e' : '2px solid transparent',
              marginBottom: -1,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              transition: 'color .15s',
              fontFamily: "'DM Sans', sans-serif",
              letterSpacing: '.01em',
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

function AdminFooter() {
  const { user } = useAuthStore() as any
  const year = new Date().getFullYear()
  const wsName = user?.workspace_name || 'Rass Consulting'
  return (
    <div style={{
      background: '#ece5d8',
      borderTop: '1px solid #d4c9b4',
      padding: '13px 28px',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flexWrap: 'wrap' as const,
      flexShrink: 0,
    }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: '#7a6e64', fontFamily: "'DM Sans', sans-serif" }}>
        © {year} {wsName}
      </span>
      {['·', 'Privacy', '·', 'Terms', '·', 'Cookie Preferences'].map((item, i) =>
        item === '·'
          ? <span key={i} style={{ color: '#c4b9ab', fontSize: 13 }}>·</span>
          : <a key={i} href="#" onClick={e => e.preventDefault()} style={{
              fontSize: 13, fontWeight: 500, color: '#7a6e64', textDecoration: 'none',
              fontFamily: "'DM Sans', sans-serif", transition: 'color .15s',
            }}
              onMouseEnter={e => (e.currentTarget.style.color = '#1a1714')}
              onMouseLeave={e => (e.currentTarget.style.color = '#7a6e64')}
            >{item}</a>
      )}
    </div>
  )
}

export default function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <div className="main-offset" style={{
        flex: 1, minWidth: 0,
        display: 'flex', flexDirection: 'column',
        height: '100vh', overflow: 'hidden',
        background: '#f7f4ef',
      }}>
        <AdminTopNav />
        <div style={{ flex: 1, overflowY: 'auto', background: '#f7f4ef' }}>
          {children}
        </div>
        <AdminFooter />
      </div>
    </div>
  )
}
