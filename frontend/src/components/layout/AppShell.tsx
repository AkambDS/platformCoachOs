import { ReactNode } from 'react'
import Sidebar from './Sidebar'
import TopNav from './TopNav'
import FeedbackButton from '../FeedbackButton'

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <div className="main-offset" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopNav />
        <div style={{ flex: 1 }}>
          {children}
        </div>
      </div>
      <FeedbackButton />
    </div>
  )
}
