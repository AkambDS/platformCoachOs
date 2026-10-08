import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { authApi, systemApi, demoApi } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_START_TOUR_KEY, DEMO_LEAD_EMAIL_KEY } from '../../constants/demo'
import DemoGateModal from '../../components/DemoGateModal'
import NorthStarFlow, { FlowStar } from '../../components/NorthStarFlow'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [showDemoGate, setShowDemoGate] = useState(false)
  const [demoLoading, setDemoLoading] = useState(false)
  const [demoGateError, setDemoGateError] = useState('')
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

  const handleDemoGateSubmit = async (firstName: string, leadEmail: string) => {
    setDemoLoading(true); setDemoGateError('')
    try {
      // Capture the lead first — if this fails we still let them into the demo rather
      // than blocking a prospect over an analytics write, but we do try first so a
      // transient failure doesn't silently lose the lead.
      try { await demoApi.captureLead({ email: leadEmail, first_name: firstName }) } catch { /* non-fatal */ }

      const { data } = await authApi.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
      login(data.user, data.workspace)
      sessionStorage.setItem(DEMO_START_TOUR_KEY, '1')
      sessionStorage.setItem(DEMO_LEAD_EMAIL_KEY, leadEmail)
      navigate('/dashboard')
    } catch {
      setDemoGateError('The live demo is temporarily unavailable — please try again shortly.')
    } finally { setDemoLoading(false) }
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
    <div className="login-page auth-ombre">
      {/* Background: streams fan in from the bottom-left corner to each feature bullet, then flow on into the card's North Star */}
      <div aria-hidden="true" className="login-flow">
        <NorthStarFlow className="auth-flow-canvas" />
      </div>

      {/* masthead */}
      <div className="login-masthead">
        <div className="auth-brand-logo">Coach<span>OS</span></div>
        <div className="auth-brand-logo-sub">Coaching Management Platform</div>
      </div>

      <div className="login-row">
        {/* LEFT — editorial column */}
        <div className="login-left">
          <span aria-hidden="true" className="login-quote">&ldquo;</span>
          <div className="login-left-inner">
            <h1 className="login-headline">Your coaching practice, <em>elevated</em></h1>
            <p className="login-sub">
              Everything you need to run a world-class coaching business — clients, sessions, pipeline, invoicing and a client portal, in one place.
            </p>
            <div className="login-rule" />
            <div className="login-points">
              {[
                'Client CRM — goals, commitments & session notes',
                'Scheduling with Google Calendar, Zoom & reminders',
                'A branded portal where clients track goals & pay',
                'Pipeline with automated, scheduled follow-ups',
                'Stripe invoicing, payments & revenue reports',
              ].map((text, i) => (
                <div key={text} className="login-point">
                  <span className="login-point-num" data-flow-in>{String(i + 1).padStart(2, '0')}</span>
                  <span className="login-point-text" data-flow-source>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="login-divider" />

        {/* RIGHT — sign-in card */}
        <div className="login-right">
        <div className="auth-form-card auth-form-card--boxed" data-flow-target>
          <div className="auth-form-title"><FlowStar />Welcome back</div>
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

          <div style={{
            marginTop: 28, paddingTop: 22, borderTop: '1px solid var(--border, #ede9e1)',
            textAlign: 'center' as const,
          }}>
            <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 4px', fontWeight: 600 }}>
              New here?
            </p>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px', lineHeight: 1.6 }}>
              Explore a live sample workspace — no signup required. Test login:{' '}
              <code style={{ fontSize: 11.5 }}>{DEMO_EMAIL}</code>
            </p>
            <button
              type="button"
              className="auth-btn"
              onClick={() => { setDemoGateError(''); setShowDemoGate(true) }}
              style={{ background: 'transparent', color: 'var(--gold, #a97e1f)', border: '1px solid var(--gold, #a97e1f)' }}
            >
              ▶ Log In as Demo User & Take the Tour
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
    {showDemoGate && (
      <DemoGateModal
        loading={demoLoading}
        error={demoGateError}
        onClose={() => setShowDemoGate(false)}
        onSubmit={handleDemoGateSubmit}
      />
    )}
    </div>
  )
}
