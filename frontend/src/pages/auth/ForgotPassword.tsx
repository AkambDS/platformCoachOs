import { useState } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '../../api/client'

export default function ForgotPassword() {
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      await authApi.passwordResetRequest({ email })
      setSent(true)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Something went wrong. Please try again.')
    } finally { setLoading(false) }
  }

  return (
    <div className="auth-split">
      <div className="auth-brand">
        <div className="auth-brand-logo"><>Coach<span>OS</span></></div>
        <div className="auth-brand-logo-sub">Coaching Management Platform</div>
        <div className="auth-brand-content">
          <div className="auth-brand-headline"><>Secure account<br /><em>recovery</em></></div>
          <p className="auth-brand-sub">
            Enter your email and we'll send you a link to reset your password.
            The link expires after 24 hours.
          </p>
        </div>
      </div>

      <div className="auth-form-area">
        <div className="auth-form-card">
          {sent ? (
            <>
              <div style={{ fontSize: 40, marginBottom: 16, textAlign: 'center' }}>✉️</div>
              <div className="auth-form-title" style={{ textAlign: 'center' }}>Check your email</div>
              <p className="auth-form-sub" style={{ textAlign: 'center' }}>
                If <strong>{email}</strong> is registered, a reset link is on its way.
                Check your spam folder if you don't see it within a minute.
              </p>
              <Link to="/login" style={{
                display: 'block', textAlign: 'center', marginTop: 24,
                color: 'var(--gold)', fontSize: 14, fontWeight: 500,
              }}>← Back to sign in</Link>
            </>
          ) : (
            <>
              <div className="auth-form-title">Forgot password?</div>
              <p className="auth-form-sub">Enter your email and we'll send you a reset link.</p>

              {error && <div className="auth-error">{error}</div>}

              <form onSubmit={handleSubmit}>
                <label className="auth-label">
                  <span className="auth-label-text">Email address</span>
                  <input
                    className="auth-input"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoFocus
                  />
                </label>
                <button type="submit" className="auth-btn" disabled={loading}>
                  {loading ? 'Sending…' : 'Send Reset Link'}
                </button>
              </form>

              <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--muted)' }}>
                Remember your password?{' '}
                <Link to="/login" style={{ color: 'var(--gold)', fontWeight: 500 }}>Sign in</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
