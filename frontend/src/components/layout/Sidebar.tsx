import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore, User } from '../../store/auth'
import { authApi } from '../../api/client'
import { queryClient } from '../../lib/queryClient'
import {
  LayoutDashboard,
  Users,
  Kanban,
  CalendarDays,
  CheckSquare,
  Receipt,
  BookOpen,
  BarChart3,
  Settings,
  LogOut,
  MessageSquarePlus,
  Building2,
  KeyRound,
  ShieldCheck,
} from 'lucide-react'

type NavItem =
  | { section: string; roles?: string[] }
  | { to: string; Icon: React.ElementType; label: string; roles?: string[]; tour?: string }

const COACH_NAV: NavItem[] = [
  { section: 'Workspace' },
  { to: '/dashboard',  Icon: LayoutDashboard,  label: 'Dashboard',  tour: 'dashboard'  },
  { to: '/clients',    Icon: Users,             label: 'Clients',    tour: 'clients'    },
  { to: '/pipeline',   Icon: Kanban,            label: 'Pipeline',   tour: 'pipeline'   },
  { section: 'Schedule' },
  { to: '/calendar',   Icon: CalendarDays,      label: 'Calendar'                       },
  { to: '/activities', Icon: CheckSquare,       label: 'Activities', tour: 'activities' },
  { section: 'Finance', roles: ['business_owner', 'coach'] },
  { to: '/invoices',   Icon: Receipt,           label: 'Invoices',   roles: ['business_owner', 'coach'], tour: 'invoices' },
  { section: 'Content' },
  { to: '/library',    Icon: BookOpen,          label: 'Library'                        },
  { to: '/reports',    Icon: BarChart3,         label: 'Reports',    roles: ['business_owner', 'coach'], tour: 'reports' },
  { section: 'System' },
  { to: '/feedback',   Icon: MessageSquarePlus, label: 'Feedback'                       },
  { to: '/settings',   Icon: Settings,          label: 'Settings',   tour: 'settings'  },
]

const ADMIN_NAV: NavItem[] = [
  { section: 'Platform Admin' },
  { to: '/admin',            Icon: LayoutDashboard,  label: 'Overview'    },
  { to: '/admin#workspaces', Icon: Building2,        label: 'Workspaces'  },
  { to: '/admin#feedback',   Icon: MessageSquarePlus,label: 'Feedback'    },
  { to: '/admin#tokens',     Icon: KeyRound,         label: 'Invites'     },
]

export default function Sidebar() {
  const { user, logout } = useAuthStore() as { user: User | null; logout: () => void }
  const navigate = useNavigate()

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
    <div className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-text">
          Coach<span>OS</span>
          {isAdmin && <span style={{ fontSize: 9, marginLeft: 6, opacity: 0.5, fontFamily: "'DM Sans', sans-serif", fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.1em', verticalAlign: 'middle' }}>Admin</span>}
        </div>
      </div>

      <div className="nav-section" style={{ flex: 1, overflowY: 'auto' }}>
        {NAV.map((item, i) => {
          if ('section' in item) {
            if (item.roles && !item.roles.includes(user?.role || '')) return null
            return <div key={i} className="nav-label">{item.section}</div>
          }
          if (item.roles && !item.roles.includes(user?.role || '')) return null
          const { Icon } = item
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              {...(item.tour ? { 'data-tour': item.tour } : {})}
            >
              <span className="nav-icon"><Icon size={14} strokeWidth={1.75} /></span>
              {item.label}
            </NavLink>
          )
        })}
      </div>

      <div className="sidebar-bottom">
        {isAdmin && (
          <div style={{ padding: '8px 16px', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={12} strokeWidth={1.75} style={{ color: 'rgba(255,255,255,.35)' }} />
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,.35)' }}>Platform Admin</span>
          </div>
        )}
        <div className="sidebar-user">
          <div className="avatar">{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sidebar-user-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.full_name}
            </div>
            <div className="sidebar-user-role">{user?.role?.replace(/_/g, ' ')}</div>
          </div>
          <button onClick={handleLogout} className="btn btn-ghost btn-sm" style={{ color: 'rgba(255,255,255,.35)', padding: '4px 6px' }} title="Sign out">
            <LogOut size={13} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  )
}
