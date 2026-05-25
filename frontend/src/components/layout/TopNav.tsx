import { NavLink } from 'react-router-dom'

const TABS = [
  { to: '/clients',    label: 'Clients'   },
  { to: '/pipeline',   label: 'Pipeline'  },
  { to: '/calendar',   label: 'Schedule'  },
  { to: '/activities', label: 'Activities'},
  { to: '/invoices',   label: 'Invoices'  },
  { to: '/library',    label: 'Library'   },
]

export default function TopNav() {
  return (
    <div style={{
      display: 'flex',
      background: '#f0ece5',
      borderBottom: '1px solid var(--border)',
      padding: '0 36px',
      overflowX: 'auto',
      flexShrink: 0,
    }}>
      {TABS.map(tab => (
        <NavLink
          key={tab.to}
          to={tab.to}
          style={({ isActive }) => ({
            padding: '12px 18px',
            fontSize: 12,
            fontWeight: 500,
            color: isActive ? 'var(--ink)' : 'var(--muted)',
            borderBottom: `2px solid ${isActive ? 'var(--gold)' : 'transparent'}`,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            textDecoration: 'none',
            transition: 'all .15s',
            letterSpacing: '.02em',
            fontFamily: "'DM Sans', sans-serif",
          })}
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  )
}
