import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { authApi } from "../../api/client"
import { useAuthStore } from "../../store/auth"

export default function Register() {
  const [form, setForm] = useState({ workspace_name: "", full_name: "", email: "", password: "" })
  const [error, setError]   = useState("")
  const [loading, setLoading] = useState(false)
  const login    = useAuthStore((s) => s.login)
  const navigate = useNavigate()

  const update = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError("")
    try {
      const { data } = await authApi.register(form)
      login({ access: data.access, refresh: data.refresh }, data.user, data.workspace)
      navigate("/dashboard")
    } catch (err: any) {
      const d = err.response?.data
      const msg = d?.email?.[0] || d?.password?.[0] || d?.workspace_name?.[0]
               || d?.full_name?.[0] || d?.non_field_errors?.[0] || d?.detail
               || "Registration failed."
      setError(msg)
    } finally { setLoading(false) }
  }

  return (
    <div className="auth-split">
      {/* Brand Panel */}
      <div className="auth-brand">
        <div className="auth-brand-logo">Coach<span>OS</span></div>
        <div className="auth-brand-content">
          <div className="auth-brand-headline">
            Built for coaches<br />who <em>mean business</em>
          </div>
          <p className="auth-brand-sub">
            Set up your workspace in minutes. Bring your clients, your workflow, and your goals — we'll handle the rest.
          </p>
          <ul className="auth-brand-features">
            <li>Dedicated workspace for your practice</li>
            <li>Unlimited client profiles &amp; session history</li>
            <li>Smart pipeline to track prospects to clients</li>
            <li>Professional invoicing &amp; payment tracking</li>
          </ul>
        </div>
      </div>

      {/* Form Panel */}
      <div className="auth-form-area">
        <div className="auth-form-card">
          <div className="auth-form-title">Create workspace</div>
          <p className="auth-form-sub">Start your free coaching workspace today</p>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <label className="auth-label">
              <span className="auth-label-text">Workspace Name</span>
              <input
                className="auth-input"
                type="text"
                value={form.workspace_name}
                onChange={update("workspace_name")}
                placeholder="e.g. Sarah Chen Coaching"
                required
              />
            </label>
            <label className="auth-label">
              <span className="auth-label-text">Your Full Name</span>
              <input
                className="auth-input"
                type="text"
                value={form.full_name}
                onChange={update("full_name")}
                placeholder="Sarah Chen"
                required
              />
            </label>
            <label className="auth-label">
              <span className="auth-label-text">Email</span>
              <input
                className="auth-input"
                type="email"
                value={form.email}
                onChange={update("email")}
                placeholder="sarah@example.com"
                required
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
            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? "Creating workspace…" : "Create Workspace"}
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
