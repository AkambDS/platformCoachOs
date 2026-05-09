import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../../api/client'
import { useAuthStore } from '../../store/auth'

interface PublicBranding { name: string; logo_url: string; primary_colour: string }

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [branding, setBranding] = useState<PublicBranding | null>(null)
  const login    = useAuthStore((s) => s.login)
  const navigate = useNavigate()

  useEffect(() => {
    fetch('/api/settings/public-branding/')
      .then(r => r.json())
      .then(d => setBranding(d))
      .catch(() => {})
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const { data } = await authApi.login({ email, password })
      login({ access: data.access, refresh: data.refresh }, data.user, data.workspace)
      navigate('/dashboard')
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Login failed. Check your credentials.')
    } finally { setLoading(false) }
  }

  return (
    <div className="auth-split">
      {/* Brand Panel */}
      <div className="auth-brand">
        {/* Logo */}
        <div className="auth-brand-logo">
          {branding?.logo_url ? (
            <img src={branding.logo_url} alt={branding.name}
              style={{ maxHeight: 52, maxWidth: 180, objectFit: 'contain', display: 'block' }} />
          ) : (
            <>Coach<span>OS</span></>
          )}
        </div>
        <div className="auth-brand-logo-sub">Coaching Management Platform</div>

        <div className="auth-brand-content">
          <div className="auth-brand-headline">
            {branding?.name ? (
              <>{branding.name}<br /><em>coaching platform</em></>
            ) : (
              <>Your coaching<br />practice, <em>elevated</em></>
            )}
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
              <span className="auth-label-text">Password</span>
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
  )
}
