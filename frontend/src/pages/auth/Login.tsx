import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { authApi, systemApi } from '../../api/client'
import { useAuthStore } from '../../store/auth'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [banner, setBanner]     = useState<{ message: string; is_active: boolean } | null>(null)
  const login    = useAuthStore((s) => s.login)
  const navigate = useNavigate()

  useEffect(() => {
    systemApi.banner().then(r => { if (r.data?.is_active) setBanner(r.data) }).catch(() => {})
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const { data } = await authApi.login({ email, password })
      login(data.user, data.workspace)
      navigate(data.user?.role === 'platform_admin' ? '/admin' : '/dashboard')
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Login failed. Check your credentials.')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {banner?.is_active && (
        <div style={{
          background: '#0d1829', color: '#fff',
          padding: '14px 24px', fontSize: 13, lineHeight: 1.6,
          textAlign: 'center', letterSpacing: '.01em',
          borderBottom: '2px solid #d4b06a',
        }}>
          <strong style={{ marginRight: 8 }}>Scheduled Maintenance Notice:</strong>
          {banner.message}
        </div>
      )}
    <div className="auth-split">
      {/* Brand Panel */}
      <div className="auth-brand">
        {/* Logo */}
        <div className="auth-brand-logo">
          <>Coach<span>OS</span></>
        </div>
        <div className="auth-brand-logo-sub">Coaching Management Platform</div>

        <div className="auth-brand-content">
          <div className="auth-brand-headline">
            <>Your coaching<br />practice, <em>elevated</em></>
          </div>
          <p className="auth-brand-sub">
            Everything you need to run a world-class coaching business — clients, sessions, pipeline, and revenue in one place.
          </p>
          <ul className="auth-brand-features">
            <li>Client management &amp; progress tracking</li>
            <li>Session scheduling &amp; automated reminders</li>
            <li>Pipeline &amp; deal flow management</li>
            <li>Professional invoicing &amp; revenue reports</li>
          </ul>
        </div>
      </div>

      {/* Form Panel */}
      <div className="auth-form-area">
        <div className="auth-form-card">
          <div className="auth-form-title">Welcome back</div>
          <p className="auth-form-sub">Sign in to your workspace</p>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <label className="auth-label">
              <span className="auth-label-text">Email</span>
              <input
                className="auth-input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>
            <label className="auth-label">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span className="auth-label-text">Password</span>
                <Link to="/forgot-password" style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 500 }}>
                  Forgot password?
                </Link>
              </div>
              <input
                className="auth-input"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </label>
            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <p className="auth-footer" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 24 }}>
            Coaches &amp; assistants — use the invite link sent to your email.
          </p>
        </div>
      </div>
    </div>
    </div>
  )
}
