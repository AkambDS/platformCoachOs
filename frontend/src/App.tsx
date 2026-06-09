import { useEffect, useState, useCallback } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { QueryClientProvider } from "@tanstack/react-query"
import { queryClient } from "./lib/queryClient"
import { useAuthStore } from "./store/auth"
import { authApi } from "./api/client"
import { useInactivityTimer } from "./hooks/useInactivityTimer"
import ClientPortal from "./pages/portal/ClientPortal"
import Login     from "./pages/auth/Login"
import Register  from "./pages/auth/Register"
import AcceptInvite    from "./pages/auth/AcceptInvite"
import ForgotPassword from "./pages/auth/ForgotPassword"
import ResetPassword  from "./pages/auth/ResetPassword"
import Dashboard from "./pages/coach/Dashboard"
import Clients   from "./pages/coach/Clients"
import ClientDetail from "./pages/coach/ClientDetail"
import NewClient   from "./pages/coach/NewClient"
import Pipeline  from "./pages/coach/Pipeline"
import NewDeal   from "./pages/coach/NewDeal"
import Calendar    from "./pages/coach/Calendar"
import Activities  from "./pages/coach/Activities"
import Invoices      from "./pages/coach/Invoices"
import NewInvoice    from "./pages/coach/NewInvoice"
import InvoiceDetail from "./pages/coach/InvoiceDetail"
import Reports        from "./pages/coach/Reports"
import Settings       from "./pages/coach/Settings"
import Library        from "./pages/coach/Library"
import FeedbackList   from "./pages/coach/FeedbackList"
import FeedbackDetail from "./pages/coach/FeedbackDetail"
import AdminDashboard  from "./pages/superadmin/AdminDashboard"
import AdminWorkspace  from "./pages/superadmin/AdminWorkspace"


function PrivateRoute({ children }: { children: JSX.Element }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return isAuthenticated ? children : <Navigate to="/login" replace />
}

/** Blocks assistant role from pages they can't access */
function RoleRoute({ children, allow }: { children: JSX.Element; allow: string[] }) {
  const user = useAuthStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  if (!allow.includes(user.role)) return <Navigate to="/dashboard" replace />
  return children
}

function AdminRoute({ children }: { children: JSX.Element }) {
  const user = useAuthStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'platform_admin') return <Navigate to="/dashboard" replace />
  return children
}

const Stub = ({ name }: { name: string }) => (
  <div style={{ padding: "2rem", fontFamily: "'DM Sans', sans-serif" }}>
    <h2 style={{ color: "#1B3A6B", fontFamily: "'Cormorant Garamond', serif", fontWeight: 300 }}>{name}</h2>
    <p style={{ color: "#8c8279", marginTop: 8 }}>Coming soon</p>
  </div>
)

export default function App() {
  const { isAuthenticated, user, rehydrate, logout } = useAuthStore()
  const [showWarning, setShowWarning] = useState(false)

  const handleLogout = useCallback(async () => {
    setShowWarning(false)
    try { await authApi.logout() } catch {}
    logout()
  }, [logout])

  const { stayActive } = useInactivityTimer({
    enabled: isAuthenticated,
    onWarn:   () => setShowWarning(true),
    onLogout: handleLogout,
  })

  useEffect(() => {
    // If we have a token but no user (e.g. after hard refresh), restore from /api/auth/me/
    if (isAuthenticated && !user) {
      authApi.me()
        .then(({ data }) => rehydrate(data.user, data.workspace))
        .catch(() => logout())
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <QueryClientProvider client={queryClient}>
      {showWarning && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#fff', borderRadius: 10, padding: '36px 32px',
            maxWidth: 400, width: '90%', textAlign: 'center',
            boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⏱</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 18, color: '#1a1714' }}>Still there?</h3>
            <p style={{ fontSize: 14, color: '#6b6b6b', margin: '0 0 24px', lineHeight: 1.5 }}>
              You've been inactive for 15 minutes.<br />
              You'll be logged out automatically in 15 minutes.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={() => { setShowWarning(false); stayActive() }}
                style={{
                  padding: '9px 22px', borderRadius: 6, border: 'none',
                  background: '#1a2f4e', color: '#fff', fontWeight: 600,
                  fontSize: 13, cursor: 'pointer',
                }}
              >
                Stay logged in
              </button>
              <button
                onClick={handleLogout}
                style={{
                  padding: '9px 22px', borderRadius: 6,
                  border: '1px solid #d0cbc4', background: '#fff',
                  color: '#6b6b6b', fontSize: 13, cursor: 'pointer',
                }}
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      )}
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/login"            element={<Login />} />
          <Route path="/register"         element={<Register />} />
          <Route path="/accept-invite"    element={<AcceptInvite />} />
          <Route path="/forgot-password"  element={<ForgotPassword />} />
          <Route path="/reset-password"   element={<ResetPassword />} />

          {/* Coach App */}
          <Route path="/dashboard"     element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/clients"        element={<PrivateRoute><Clients /></PrivateRoute>} />
          <Route path="/clients/new"   element={<PrivateRoute><RoleRoute allow={["business_owner"]}><NewClient /></RoleRoute></PrivateRoute>} />
          <Route path="/clients/:id"   element={<PrivateRoute><ClientDetail /></PrivateRoute>} />
          <Route path="/pipeline"      element={<PrivateRoute><RoleRoute allow={["business_owner"]}><Pipeline /></RoleRoute></PrivateRoute>} />
          <Route path="/pipeline/new"  element={<PrivateRoute><RoleRoute allow={["business_owner"]}><NewDeal /></RoleRoute></PrivateRoute>} />
          <Route path="/calendar"      element={<PrivateRoute><Calendar /></PrivateRoute>} />
          <Route path="/activities"    element={<PrivateRoute><Activities /></PrivateRoute>} />
          <Route path="/invoices"          element={<PrivateRoute><RoleRoute allow={["business_owner","coach"]}><Invoices /></RoleRoute></PrivateRoute>} />
          <Route path="/invoices/new"      element={<PrivateRoute><RoleRoute allow={["business_owner","coach"]}><NewInvoice /></RoleRoute></PrivateRoute>} />
          <Route path="/invoices/:id"      element={<PrivateRoute><RoleRoute allow={["business_owner","coach"]}><InvoiceDetail /></RoleRoute></PrivateRoute>} />
          <Route path="/invoices/:id/edit" element={<PrivateRoute><RoleRoute allow={["business_owner","coach"]}><NewInvoice /></RoleRoute></PrivateRoute>} />
          <Route path="/reports"       element={<PrivateRoute><RoleRoute allow={["business_owner"]}><Reports /></RoleRoute></PrivateRoute>} />
          <Route path="/library"         element={<PrivateRoute><Library /></PrivateRoute>} />
          <Route path="/settings"        element={<PrivateRoute><Settings /></PrivateRoute>} />
          <Route path="/portal"          element={<PrivateRoute><Stub name="Client Portal" /></PrivateRoute>} />
          <Route path="/client-portal"   element={<ClientPortal />} />
          <Route path="/feedback"        element={<PrivateRoute><FeedbackList /></PrivateRoute>} />
          <Route path="/feedback/:id"    element={<PrivateRoute><FeedbackDetail /></PrivateRoute>} />

          {/* Super Admin */}
          <Route path="/admin"                    element={<PrivateRoute><AdminRoute><AdminDashboard /></AdminRoute></PrivateRoute>} />
          <Route path="/admin/workspaces/:id"     element={<PrivateRoute><AdminRoute><AdminWorkspace /></AdminRoute></PrivateRoute>} />

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
