import { useEffect } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useAuthStore } from "./store/auth"
import { authApi } from "./api/client"
import Login     from "./pages/auth/Login"
import Register  from "./pages/auth/Register"
import AcceptInvite from "./pages/auth/AcceptInvite"
import Dashboard from "./pages/coach/Dashboard"
import Clients   from "./pages/coach/Clients"
import ClientDetail from "./pages/coach/ClientDetail"
import Pipeline  from "./pages/coach/Pipeline"
import Calendar    from "./pages/coach/Calendar"
import Activities  from "./pages/coach/Activities"
import Invoices  from "./pages/coach/Invoices"
import Reports   from "./pages/coach/Reports"
import Settings  from "./pages/coach/Settings"

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } }
})

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

const Stub = ({ name }: { name: string }) => (
  <div style={{ padding: "2rem", fontFamily: "'DM Sans', sans-serif" }}>
    <h2 style={{ color: "#1B3A6B", fontFamily: "'Cormorant Garamond', serif", fontWeight: 300 }}>{name}</h2>
    <p style={{ color: "#8c8279", marginTop: 8 }}>Coming soon</p>
  </div>
)

export default function App() {
  const { isAuthenticated, user, rehydrate, logout } = useAuthStore()

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
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/login"         element={<Login />} />
          <Route path="/register"      element={<Register />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />

          {/* Coach App */}
          <Route path="/dashboard"     element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/clients"       element={<PrivateRoute><Clients /></PrivateRoute>} />
          <Route path="/clients/:id"   element={<PrivateRoute><ClientDetail /></PrivateRoute>} />
          <Route path="/pipeline"      element={<PrivateRoute><Pipeline /></PrivateRoute>} />
          <Route path="/calendar"      element={<PrivateRoute><Calendar /></PrivateRoute>} />
          <Route path="/activities"    element={<PrivateRoute><Activities /></PrivateRoute>} />
          <Route path="/invoices"      element={<PrivateRoute><RoleRoute allow={["business_owner","coach"]}><Invoices /></RoleRoute></PrivateRoute>} />
          <Route path="/invoices/:id"  element={<PrivateRoute><RoleRoute allow={["business_owner","coach"]}><Invoices /></RoleRoute></PrivateRoute>} />
          <Route path="/reports"       element={<PrivateRoute><RoleRoute allow={["business_owner","coach"]}><Reports /></RoleRoute></PrivateRoute>} />
          <Route path="/library"       element={<PrivateRoute><Stub name="Library" /></PrivateRoute>} />
          <Route path="/settings"      element={<PrivateRoute><Settings /></PrivateRoute>} />
          <Route path="/portal"        element={<PrivateRoute><Stub name="Client Portal" /></PrivateRoute>} />

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
