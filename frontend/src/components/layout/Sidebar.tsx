import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { authApi } from '../../api/client'

const NAV = [
  { section: 'Workspace' },
  { to: '/dashboard',  icon: '⬛', label: 'Dashboard'  },
  { to: '/clients',    icon: '◉',  label: 'Clients'    },
  { to: '/pipeline',   icon: '▦',  label: 'Pipeline'   },
  { section: 'Schedule' },
  { to: '/calendar',   icon: '◷',  label: 'Calendar'   },
  { to: '/activities', icon: '✓',  label: 'Activities' },
  { section: 'Finance' },
  { to: '/invoices',   icon: '$',  label: 'Invoices'   },
  { section: 'Content' },
  { to: '/library',    icon: '▤',  label: 'Library'    },
  { to: '/reports',    icon: '▣',  label: 'Reports'    },
  { section: 'System' },
  { to: '/settings',   icon: '⚙',  label: 'Settings'   },
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
            return <div key={i} className="nav-label">{item.section}</div>
          }
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
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
          <button onClick={handleLogout} className="btn btn-ghost btn-sm" style={{ color: 'rgba(255,255,255,.4)', padding: '4px 6px' }} title="Sign out">
            ⏻
          </button>
        </div>
      </div>
    </div>
  )
}
