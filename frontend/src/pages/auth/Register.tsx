import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authApi } from '../../api/client'
import { useAuthStore } from '../../store/auth'

interface PublicBranding { name: string; logo_url: string; primary_colour: string }

export default function Register() {
  const [form, setForm] = useState({ workspace_name: '', full_name: '', email: '', password: '' })
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const [branding, setBranding] = useState<PublicBranding | null>(null)
  const login    = useAuthStore((s) => s.login)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const registrationToken = searchParams.get('token') ?? ''

  useEffect(() => {
    fetch('/api/settings/public-branding/')
      .then(r => r.json())
      .then(d => setBranding(d))
      .catch(() => {})
  }, [])

  const update = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const { data } = await authApi.register({ ...form, registration_token: registrationToken || undefined })
      login({ access: data.access, refresh: data.refresh }, data.user, data.workspace)
      navigate('/dashboard')
    } catch (err: any) {
      const d = err.response?.data
      const msg = d?.email?.[0] || d?.password?.[0] || d?.workspace_name?.[0]
               || d?.full_name?.[0] || d?.non_field_errors?.[0] || d?.detail
               || 'Registration failed.'
      setError(msg)
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

          {/* Business owner note */}
          <div style={{
            marginTop: 32, padding: '12px 16px',
            background: 'rgba(201,168,76,.12)',
            borderLeft: '3px solid var(--gold)',
            borderRadius: '0 4px 4px 0',
          }}>
            <p style={{ margin: 0, fontSize: 12, color: 'rgba(248,245,240,.7)', lineHeight: 1.6 }}>
              This page is for <strong style={{ color: 'var(--gold-light)' }}>Business Owners</strong> creating a new workspace.<br />
              Coaches &amp; assistants join via their invite email.
            </p>
          </div>
        </div>
      </div>

      {/* Form Panel */}
      <div className="auth-form-area">
        <div className="auth-form-card">
          {/* Business owner badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 12px', borderRadius: 20,
            background: '#fff3cd', border: '1px solid #d9a800',
            fontSize: 11, fontWeight: 700, color: '#7a5c00',
            textTransform: 'uppercase', letterSpacing: '.08em',
            marginBottom: 16,
          }}>
            Business Owner Setup
          </div>

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
                onChange={update('workspace_name')}
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
                onChange={update('full_name')}
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
                onChange={update('email')}
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
                onChange={update('password')}
                placeholder="••••••••"
                required
              />
            </label>
            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? 'Creating workspace…' : 'Create Workspace'}
            </button>
          </form>

          <p className="auth-footer" style={{ marginTop: 20 }}>
            Already have an account?{' '}
            <a href="/login">Sign in</a>
          </p>
        </div>
      </div>
    </div>
  )
}
