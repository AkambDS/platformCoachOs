import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { authApi } from '../../api/client'

export default function ResetPassword() {
  const [params]      = useSearchParams()
  const navigate      = useNavigate()
  const uid           = params.get('uid')   || ''
  const token         = params.get('token') || ''

  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [loading, setLoading]     = useState(false)
  const [done, setDone]           = useState(false)
  const [error, setError]         = useState('')

  const invalid = !uid || !token

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm)  { setError('Passwords do not match.'); return }

    setLoading(true)
    try {
      await authApi.passwordResetConfirm({ uid, token, password })
      setDone(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Reset failed. The link may have expired.')
    } finally { setLoading(false) }
  }

  return (
    <div className="auth-split">
      <div className="auth-brand">
        <div className="auth-brand-logo"><>Coach<span>OS</span></></div>
        <div className="auth-brand-logo-sub">Coaching Management Platform</div>
        <div className="auth-brand-content">
          <div className="auth-brand-headline"><>Choose a new<br /><em>password</em></></div>
          <p className="auth-brand-sub">
            Pick something strong — at least 8 characters. You'll use it every time you sign in.
          </p>
        </div>
      </div>

      <div className="auth-form-area">
        <div className="auth-form-card">
          {done ? (
            <>
              <div style={{ fontSize: 40, marginBottom: 16, textAlign: 'center' }}>✅</div>
              <div className="auth-form-title" style={{ textAlign: 'center' }}>Password updated</div>
              <p className="auth-form-sub" style={{ textAlign: 'center' }}>
                Your password has been reset. Redirecting you to sign in…
              </p>
              <Link to="/login" style={{
                display: 'block', textAlign: 'center', marginTop: 16,
                color: 'var(--gold)', fontSize: 14, fontWeight: 500,
              }}>Sign in now →</Link>
            </>
          ) : invalid ? (
            <>
              <div className="auth-form-title">Invalid link</div>
              <p className="auth-form-sub">
                This reset link is missing required parameters. Please request a new one.
              </p>
              <Link to="/forgot-password" style={{
                display: 'block', marginTop: 16,
                color: 'var(--gold)', fontSize: 14, fontWeight: 500,
              }}>Request a new reset link →</Link>
            </>
          ) : (
            <>
              <div className="auth-form-title">Set new password</div>
              <p className="auth-form-sub">Choose a password for your CoachOS account.</p>

              {error && <div className="auth-error">{error}</div>}

              <form onSubmit={handleSubmit}>
                <label className="auth-label">
                  <span className="auth-label-text">New password</span>
                  <input
                    className="auth-input"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                    autoFocus
                  />
                </label>
                <label className="auth-label">
                  <span className="auth-label-text">Confirm password</span>
                  <input
                    className="auth-input"
                    type="password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="Repeat your new password"
                    required
                  />
                </label>
                <button type="submit" className="auth-btn" disabled={loading}>
                  {loading ? 'Saving…' : 'Set New Password'}
                </button>
              </form>

              <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--muted)' }}>
                <Link to="/login" style={{ color: 'var(--gold)', fontWeight: 500 }}>← Back to sign in</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
