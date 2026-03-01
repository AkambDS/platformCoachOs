import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../../api/client'
import { useAuthStore } from '../../store/auth'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const login    = useAuthStore((s) => s.login)
  const navigate = useNavigate()

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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8F6F1' }}>
      <div style={{ background: '#fff', padding: '2.5rem', borderRadius: '12px', width: '400px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <h1 style={{ color: '#1B3A6B', marginBottom: '0.25rem', fontSize: '1.75rem', fontWeight: 700 }}>CoachOS</h1>
        <p style={{ color: '#6B6976', marginBottom: '2rem' }}>Sign in to your workspace</p>
        {error && <div style={{ background: '#FAF0EC', color: '#C04E28', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', marginBottom: '1rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1B3A6B' }}>Email</span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.65rem 0.85rem', border: '1.5px solid #D8D4CC', borderRadius: '8px', fontSize: '0.95rem', boxSizing: 'border-box' }} />
          </label>
          <label style={{ display: 'block', marginBottom: '1.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1B3A6B' }}>Password</span>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.65rem 0.85rem', border: '1.5px solid #D8D4CC', borderRadius: '8px', fontSize: '0.95rem', boxSizing: 'border-box' }} />
          </label>
          <button type="submit" disabled={loading}
            style={{ width: '100%', padding: '0.75rem', background: '#1B3A6B', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '1rem', cursor: 'pointer' }}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.85rem', color: '#6B6976' }}>
          No account? <a href="/register" style={{ color: '#C04E28' }}>Create workspace</a>
        </p>
      </div>
    </div>
  )
}
