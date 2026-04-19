import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { authApi } from '../../api/client'
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
} from 'lucide-react'

type NavItem =
  | { section: string; roles?: string[] }
  | { to: string; Icon: React.ElementType; label: string; roles?: string[] }

const NAV: NavItem[] = [
  { section: 'Workspace' },
  { to: '/dashboard',  Icon: LayoutDashboard, label: 'Dashboard'  },
  { to: '/clients',    Icon: Users,            label: 'Clients'    },
  { to: '/pipeline',   Icon: Kanban,           label: 'Pipeline'   },
  { section: 'Schedule' },
  { to: '/calendar',   Icon: CalendarDays,     label: 'Calendar'   },
  { to: '/activities', Icon: CheckSquare,      label: 'Activities' },
  { section: 'Finance', roles: ['business_owner', 'coach'] },
  { to: '/invoices',   Icon: Receipt,          label: 'Invoices',  roles: ['business_owner', 'coach'] },
  { section: 'Content' },
  { to: '/library',    Icon: BookOpen,         label: 'Library'    },
  { to: '/reports',    Icon: BarChart3,        label: 'Reports',   roles: ['business_owner', 'coach'] },
  { section: 'System' },
  { to: '/settings',   Icon: Settings,         label: 'Settings'   },
]

export default function Sidebar() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = async () => {
    try { await authApi.logout() } catch {}
    logout()
    navigate('/login')
  }

  const initials = user?.full_name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || '?'

  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-text">Coach<span>OS</span></div>
      </div>

      <div className="nav-section" style={{ flex: 1, overflowY: 'auto' }}>
        {NAV.map((item, i) => {
          if ('section' in item) {
            // Hide section header if user doesn't have access to any item in it
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
            >
              <span className="nav-icon"><Icon size={14} strokeWidth={1.75} /></span>
              {item.label}
            </NavLink>
          )
        })}
      </div>

      <div className="sidebar-bottom">
        <div className="sidebar-user">
          <div className="avatar">{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sidebar-user-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.full_name}
            </div>
            <div className="sidebar-user-role">{user?.role?.replace('_', ' ')}</div>
          </div>
          <button onClick={handleLogout} className="btn btn-ghost btn-sm" style={{ color: 'rgba(255,255,255,.35)', padding: '4px 6px' }} title="Sign out">
            <LogOut size={13} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  )
}
