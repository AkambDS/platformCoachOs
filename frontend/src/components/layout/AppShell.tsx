import { ReactNode } from 'react'
import Sidebar from './Sidebar'

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <div className="main-offset" style={{ flex: 1, minWidth: 0 }}>
        {children}
      </div>
    </div>
  )
}
