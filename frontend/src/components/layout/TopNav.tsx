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
      background: '#ece5d8',
      borderBottom: '1px solid #d4c9b4',
      padding: '0 28px',
      overflowX: 'auto',
      flexShrink: 0,
      position: 'sticky' as const,
      top: 0,
      zIndex: 10,
      boxShadow: '0 1px 4px rgba(26,23,20,.08)',
    }}>
      {TABS.map(tab => (
        <NavLink
          key={tab.to}
          to={tab.to}
          style={({ isActive }) => ({
            display: 'flex',
            alignItems: 'center',
            padding: '13px 16px',
            fontSize: 13,
            fontWeight: 500,
            color: isActive ? '#1a1714' : '#7a6e64',
            borderBottom: `2px solid ${isActive ? '#b8922e' : 'transparent'}`,
            marginBottom: -1,
            whiteSpace: 'nowrap',
            textDecoration: 'none',
            transition: 'color .15s',
            letterSpacing: '.01em',
            fontFamily: "'DM Sans', sans-serif",
          })}
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  )
}
