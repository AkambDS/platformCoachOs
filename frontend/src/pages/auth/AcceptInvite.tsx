import { useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { authApi } from "../../api/client"
import { useAuthStore } from "../../store/auth"

export default function AcceptInvite() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get("token") || ""
  const navigate = useNavigate()
  const { login } = useAuthStore()

  const [form, setForm] = useState({ full_name: "", password: "", confirm: "" })
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const update = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (form.password.length < 8) { setError("Password must be at least 8 characters."); return }
    if (form.password !== form.confirm) { setError("Passwords do not match."); return }
    if (!token) { setError("Invalid invite link — token is missing."); return }

    setLoading(true)
    try {
      const { data } = await authApi.acceptInvite({ token, full_name: form.full_name, password: form.password })
      // Store tokens then fetch workspace via /me/
      localStorage.setItem("access_token", data.access)
      localStorage.setItem("refresh_token", data.refresh)
      const me = await authApi.me()
      login({ access: data.access, refresh: data.refresh }, me.data.user, me.data.workspace)
      navigate("/dashboard")
    } catch (err: any) {
      const d = err.response?.data
      if (!d) { setError("Network error — please try again."); return }
      const msg = d?.detail
               || d?.token?.[0]
               || d?.password?.[0]
               || d?.full_name?.[0]
               || d?.non_field_errors?.[0]
               || (typeof d === 'string' ? d : null)
               || "Failed to accept invite. The link may have expired — ask the workspace owner to resend it."
      setError(msg)
    } finally { setLoading(false) }
  }

  if (!token) {
    return (
      <div className="auth-split">
        <div className="auth-brand">
          <div className="auth-brand-logo">Coach<span>OS</span></div>
        </div>
        <div className="auth-form-area">
          <div className="auth-form-card">
            <div className="auth-form-title">Invalid Link</div>
            <p className="auth-form-sub">This invite link is missing a token. Please check your email for the correct link.</p>
            <a href="/login" className="auth-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 16 }}>Back to Login</a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-split">
      {/* Brand Panel */}
      <div className="auth-brand">
        <div className="auth-brand-logo">Coach<span>OS</span></div>
        <div className="auth-brand-content">
          <div className="auth-brand-headline">
            You've been invited<br />to join a <em>workspace</em>
          </div>
          <p className="auth-brand-sub">
            Set up your account and start collaborating with your team on CoachOS.
          </p>
          <ul className="auth-brand-features">
            <li>Access clients, sessions &amp; your schedule</li>
            <li>Collaborate with your team in real time</li>
            <li>Your data is secure and workspace-scoped</li>
          </ul>
        </div>
      </div>

      {/* Form Panel */}
      <div className="auth-form-area">
        <div className="auth-form-card">
          <div className="auth-form-title">Set up your account</div>
          <p className="auth-form-sub">Create your password to join the workspace</p>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <label className="auth-label">
              <span className="auth-label-text">Your Full Name</span>
              <input
                className="auth-input"
                type="text"
                value={form.full_name}
                onChange={update("full_name")}
                placeholder="Jane Smith"
                required
                autoFocus
              />
            </label>
            <label className="auth-label">
              <span className="auth-label-text">Password (min 8 chars)</span>
              <input
                className="auth-input"
                type="password"
                value={form.password}
                onChange={update("password")}
                placeholder="••••••••"
                required
              />
            </label>
            <label className="auth-label">
              <span className="auth-label-text">Confirm Password</span>
              <input
                className="auth-input"
                type="password"
                value={form.confirm}
                onChange={update("confirm")}
                placeholder="••••••••"
                required
              />
            </label>
            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? "Joining workspace…" : "Join Workspace"}
            </button>
          </form>

          <p className="auth-footer">
            Already have an account?{' '}
            <a href="/login">Sign in</a>
          </p>
        </div>
      </div>
    </div>
  )
}
