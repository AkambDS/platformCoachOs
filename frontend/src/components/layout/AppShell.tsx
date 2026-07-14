import { ReactNode } from 'react'
import Sidebar from './Sidebar'
import TopNav from './TopNav'
import FeedbackButton from '../FeedbackButton'
import { useAuthStore } from '../../store/auth'

function CoachFooter() {
  const { user } = useAuthStore() as any
  const year = new Date().getFullYear()
  const wsName = user?.workspace_name || user?.full_name || 'CoachOS'
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

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <div className="main-offset" style={{
        flex: 1, minWidth: 0,
        display: 'flex', flexDirection: 'column',
        height: '100vh', overflow: 'hidden',
        background: '#f7f4ef',
      }}>
        <TopNav />
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', background: '#f7f4ef' }}>
          {children}
        </div>
        <CoachFooter />
      </div>
      <FeedbackButton />
    </div>
  )
}
