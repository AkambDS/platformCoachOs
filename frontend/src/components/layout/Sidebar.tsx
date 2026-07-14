import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore, User } from '../../store/auth'
import { authApi } from '../../api/client'
import { queryClient } from '../../lib/queryClient'
import {
  LayoutDashboard, Users, Kanban, CalendarDays, CheckSquare,
  Receipt, BookOpen, BarChart3, Settings, LogOut,
  MessageSquarePlus, Building2, KeyRound, Bell,
} from 'lucide-react'

type NavItem =
  | { section: string; roles?: string[] }
  | { to: string; Icon: React.ElementType; label: string; roles?: string[]; tour?: string }

const COACH_NAV: NavItem[] = [
  { section: 'Workspace' },
  { to: '/dashboard',  Icon: LayoutDashboard,  label: 'Dashboard',  tour: 'dashboard'  },
  { to: '/clients',    Icon: Users,             label: 'Clients',    tour: 'clients'    },
  { to: '/pipeline',   Icon: Kanban,            label: 'Pipeline',   roles: ['business_owner'], tour: 'pipeline' },
  { section: 'Schedule' },
  { to: '/calendar',   Icon: CalendarDays,      label: 'Calendar'   },
  { to: '/activities', Icon: CheckSquare,       label: 'Activities', tour: 'activities' },
  { section: 'Finance' },
  { to: '/invoices',   Icon: Receipt,           label: 'Invoices',   tour: 'invoices'   },
  { section: 'Content' },
  { to: '/library',    Icon: BookOpen,          label: 'Library'    },
  { to: '/reports',    Icon: BarChart3,         label: 'Reports',    roles: ['business_owner'], tour: 'reports' },
  { section: 'System' },
  { to: '/feedback',   Icon: MessageSquarePlus, label: 'Feedback'   },
  { to: '/settings',   Icon: Settings,          label: 'Settings',   tour: 'settings'  },
]

const ADMIN_NAV: NavItem[] = [
  { to: '/admin',            Icon: LayoutDashboard,  label: 'Overview'          },
  { to: '/admin#workspaces', Icon: Building2,        label: 'Workspaces'        },
  { to: '/admin#invoices',   Icon: Receipt,          label: 'Invoices'          },
  { to: '/admin#tokens',     Icon: KeyRound,         label: 'Workspace Invites' },
  { to: '/admin#feedback',   Icon: MessageSquarePlus,label: 'Feedback'          },
  { to: '/admin#banner',     Icon: Bell,             label: 'Maintenance Banner'},
]

export default function Sidebar() {
  const { user, logout } = useAuthStore() as { user: User | null; logout: () => void }
  const navigate = useNavigate()
  const location = useLocation()
  const isAdmin = user?.role === 'platform_admin'
  const NAV = isAdmin ? ADMIN_NAV : COACH_NAV

  const handleLogout = async () => {
    try { await authApi.logout() } catch {}
    logout()
    queryClient.clear()
    navigate('/login')
  }

  const initials = user?.full_name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || '?'

  return (
    <div className={isAdmin ? 'sidebar admin-sidebar' : 'sidebar'}>
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-text">
          Coach<span>OS</span>
        </div>
        {isAdmin && (
          <div style={{
            marginTop: 5, fontSize: 10, fontFamily: "'DM Sans', sans-serif",
            fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase',
            color: 'rgba(212,176,106,.7)',
          }}>
            Admin Console
          </div>
        )}
      </div>

      {/* Nav items */}
      <div className="nav-section" style={{ flex: 1, overflowY: 'auto', paddingTop: isAdmin ? 12 : 0 }}>
        {NAV.map((item, i) => {
          if ('section' in item) {
            if (item.roles && !item.roles.includes(user?.role || '')) return null
            return <div key={i} className="nav-label">{item.section}</div>
          }
          if (item.roles && !item.roles.includes(user?.role || '')) return null
          const { Icon } = item
          const itemHash = item.to.includes('#') ? '#' + item.to.split('#')[1] : ''
          const hashActive = itemHash === ''
            ? (location.hash === '' || location.hash === '#overview')
            : location.hash === itemHash

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={isAdmin
                ? () => `nav-item${hashActive ? ' active' : ''}`
                : ({ isActive }) => `nav-item${isActive ? ' active' : ''}`
              }
              {...(item.tour ? { 'data-tour': item.tour } : {})}
            >
              <span className="nav-icon"><Icon size={14} strokeWidth={1.75} /></span>
              {item.label}
            </NavLink>
          )
        })}
      </div>

      {/* User section — single clean row */}
      <div className="sidebar-bottom">
        <div className="sidebar-user">
          <div className="avatar">{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sidebar-user-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.full_name}
            </div>
            <div className="sidebar-user-role">
              {isAdmin ? 'Admin Console' : user?.role?.replace(/_/g, ' ')}
            </div>
          </div>
          <button onClick={handleLogout} className="btn btn-ghost btn-sm"
            style={{ color: 'rgba(255,255,255,.4)', padding: '4px 6px' }} title="Sign out">
            <LogOut size={13} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  )
}
