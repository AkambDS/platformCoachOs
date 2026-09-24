import { useState } from 'react'
import { DEMO_LEAD_LOCALSTORAGE_KEY } from '../constants/demo'

function loadSaved(): { firstName: string; email: string } {
  try {
    const raw = localStorage.getItem(DEMO_LEAD_LOCALSTORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { firstName: '', email: '' }
}

interface Props {
  onSubmit: (firstName: string, email: string) => void
  onClose: () => void
  loading: boolean
  error: string
}

export default function DemoGateModal({ onSubmit, onClose, loading, error }: Props) {
  const saved = loadSaved()
  const [firstName, setFirstName] = useState(saved.firstName)
  const [email, setEmail] = useState(saved.email)
  const [touched, setTouched] = useState(false)

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const canSubmit = firstName.trim().length > 0 && emailValid

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!canSubmit || loading) return
    try {
      localStorage.setItem(DEMO_LEAD_LOCALSTORAGE_KEY, JSON.stringify({ firstName: firstName.trim(), email: email.trim() }))
    } catch { /* ignore */ }
    onSubmit(firstName.trim(), email.trim().toLowerCase())
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(26,23,20,.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: '#fff', border: '1px solid #ede9e1', maxWidth: 420, width: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,.25)', position: 'relative',
      }}>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute', top: 12, right: 14, background: 'none', border: 'none',
            fontSize: 20, color: 'var(--muted, #8c8279)', cursor: 'pointer', lineHeight: 1,
          }}
        >×</button>

        <div style={{ background: '#1a2f4e', padding: '26px 28px 22px' }}>
          <div style={{
            fontFamily: "'Cormorant Garamond', serif", fontSize: 11, fontWeight: 600,
            letterSpacing: '.18em', textTransform: 'uppercase', color: '#d9b96a', marginBottom: 8,
          }}>Live Demo</div>
          <div style={{
            fontFamily: "'Cormorant Garamond', serif", fontSize: 26, fontWeight: 300,
            color: '#f7f4ef', lineHeight: 1.25,
          }}>Before you dive in…</div>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '22px 28px 26px' }}>
          <p style={{ fontSize: 13, color: 'var(--muted, #6e6560)', lineHeight: 1.6, margin: '0 0 20px' }}>
            Tell us who's exploring — we'll take you straight into a sample workspace and
            walk you through every feature. (This is a shared, read-only demo: nothing
            you do here is saved.)
          </p>

          {error && (
            <div style={{
              background: '#fdecec', color: '#a33', fontSize: 12.5, padding: '10px 12px',
              marginBottom: 16, border: '1px solid #f3caca',
            }}>{error}</div>
          )}

          <label className="auth-label">
            <span className="auth-label-text">First name</span>
            <input
              className="auth-input"
              type="text"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              placeholder="Jordan"
              autoFocus
            />
          </label>
          {touched && !firstName.trim() && (
            <div style={{ fontSize: 11.5, color: '#a33', margin: '-10px 0 12px' }}>First name is required.</div>
          )}

          <label className="auth-label">
            <span className="auth-label-text">Email</span>
            <input
              className="auth-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          {touched && !emailValid && (
            <div style={{ fontSize: 11.5, color: '#a33', margin: '-10px 0 12px' }}>Enter a valid email address.</div>
          )}

          <button type="submit" className="auth-btn" disabled={loading} style={{ marginTop: 8 }}>
            {loading ? 'Loading demo…' : 'Continue to Demo →'}
          </button>
        </form>
      </div>
    </div>
  )
}
