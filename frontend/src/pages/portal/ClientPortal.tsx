import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

const BASE = import.meta.env.VITE_API_BASE_URL || ''

const portalHttp = axios.create({ baseURL: BASE, headers: { 'Content-Type': 'application/json' } })
portalHttp.interceptors.request.use(cfg => {
  const tok = sessionStorage.getItem('portal_token')
  if (tok) cfg.headers?.set('Authorization', `Bearer ${tok}`)
  return cfg
})

// ── helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtDateTime(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
function StatusPill({ s }: { s: string }) {
  const cfg: Record<string, { bg: string; color: string }> = {
    scheduled:   { bg: '#e0f0ff', color: '#1d5a8a' },
    completed:   { bg: '#e6f4ea', color: '#2e7d32' },
    cancelled:   { bg: '#fdecea', color: '#c0392b' },
    rescheduled: { bg: '#e8eaf6', color: '#3949ab' },
    missed:      { bg: '#fff3e0', color: '#e65100' },
    late:        { bg: '#fff8e1', color: '#f57f17' },
  }
  const { bg, color } = cfg[s] || { bg: '#f5f5f5', color: '#555' }
  return (
    <span style={{ fontSize: 11, fontWeight: 700, background: bg, color, padding: '2px 8px', borderRadius: 20, textTransform: 'capitalize', letterSpacing: '.04em' }}>
      {s}
    </span>
  )
}

// ── Login screen ─────────────────────────────────────────────────────────────
function LoginScreen({ branding, onLogin }: { branding: any; onLogin: (data: any) => void }) {
  const [email, setEmail]   = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const { data } = await portalHttp.post('/api/portal/login/', { email })
      sessionStorage.setItem('portal_token', data.token)
      onLogin(data)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Login failed. Please check your email.')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f2ec', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Logo / brand */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          {branding?.logo_url
            ? <img src={branding.logo_url} alt={branding.name} style={{ maxHeight: 48, maxWidth: 200, objectFit: 'contain', marginBottom: 12 }} />
            : <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 400, color: '#1a2f4e', marginBottom: 12 }}>{branding?.name || 'CoachOS'}</div>
          }
          <div style={{ fontSize: 13, color: '#8c8279' }}>Client Portal</div>
        </div>

        <div style={{ background: '#fff', borderRadius: 10, padding: '36px 32px', boxShadow: '0 2px 16px rgba(0,0,0,.08)', border: '1px solid #e8e3db' }}>
          <h2 style={{ margin: '0 0 6px', fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 400, color: '#1a1714' }}>Welcome back</h2>
          <p style={{ margin: '0 0 24px', fontSize: 13, color: '#8c8279' }}>Enter your email address to access your portal.</p>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8c8279', marginBottom: 6 }}>Email address</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="your@email.com" autoFocus
                style={{ width: '100%', padding: '10px 14px', border: '1px solid #d8d3cc', borderRadius: 6, fontSize: 14, outline: 'none', boxSizing: 'border-box', background: '#faf9f7' }}
              />
            </div>
            {error && <div style={{ fontSize: 13, color: '#c0392b', background: '#fdecea', padding: '8px 12px', borderRadius: 6, marginBottom: 14 }}>{error}</div>}
            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '12px', background: '#1a2f4e', color: '#fff', border: 'none',
              borderRadius: 6, fontSize: 13, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? .7 : 1,
            }}>
              {loading ? 'Checking…' : 'Access My Portal'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

// ── Goals tab ─────────────────────────────────────────────────────────────────
function GoalsTab() {
  const [data, setData]       = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [progressText, setProgressText] = useState('')
  const [saving, setSaving]   = useState(false)

  const load = useCallback(async () => {
    try { const r = await portalHttp.get('/api/portal/goals/'); setData(r.data) }
    catch { } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleAddProgress = async (goalId: string) => {
    if (!progressText.trim()) return
    setSaving(true)
    try {
      await portalHttp.post(`/api/portal/goals/${goalId}/progress/`, { progress_text: progressText })
      setProgressText(''); setAddingTo(null); load()
    } catch { } finally { setSaving(false) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#8c8279' }}>Loading…</div>
  const goals: any[] = data?.goals || []

  if (goals.length === 0) return (
    <div style={{ padding: 60, textAlign: 'center', color: '#8c8279' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>🎯</div>
      <div style={{ fontSize: 15 }}>No active goals yet.</div>
      <div style={{ fontSize: 13, marginTop: 6 }}>Your coach will set goals that appear here.</div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {goals.map((g: any) => (
        <div key={g.id} style={{ background: '#fff', border: '1px solid #e8e3db', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0ece4' }}>
            <div style={{ fontWeight: 600, fontSize: 15, color: '#1a1714', marginBottom: 4 }}>{g.title}</div>
            {g.description && <div style={{ fontSize: 13, color: '#8c8279', lineHeight: 1.5 }}>{g.description}</div>}
            {g.target_date && <div style={{ fontSize: 12, color: '#b8922e', marginTop: 6 }}>Target: {fmtDate(g.target_date)}</div>}
          </div>

          {/* Progress history */}
          {g.progress_entries?.length > 0 && (
            <div style={{ padding: '12px 20px', background: '#faf9f7', borderBottom: '1px solid #f0ece4' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8c8279', marginBottom: 10 }}>Progress Updates</div>
              {g.progress_entries.slice(0, 3).map((p: any) => (
                <div key={p.id} style={{ fontSize: 13, color: '#555', lineHeight: 1.6, paddingBottom: 8, borderBottom: '1px solid #ede9e1', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#b5afa6', marginRight: 8 }}>{fmtDate(p.created_at)}</span>
                  {p.progress_text}
                </div>
              ))}
            </div>
          )}

          {/* Add progress */}
          <div style={{ padding: '12px 20px' }}>
            {addingTo === g.id ? (
              <>
                <textarea
                  rows={3} autoFocus value={progressText} onChange={e => setProgressText(e.target.value)}
                  placeholder="Describe your progress on this goal…"
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid #d8d3cc', borderRadius: 6, fontSize: 13, lineHeight: 1.6, resize: 'vertical', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => { setAddingTo(null); setProgressText('') }}
                    style={{ padding: '7px 16px', border: '1px solid #d8d3cc', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
                  <button onClick={() => handleAddProgress(g.id)} disabled={saving || !progressText.trim()}
                    style={{ padding: '7px 16px', background: '#1a2f4e', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                    {saving ? 'Saving…' : 'Save Update'}
                  </button>
                </div>
              </>
            ) : (
              <button onClick={() => setAddingTo(g.id)}
                style={{ fontSize: 12, color: '#b8922e', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}>
                + Add Progress Update
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Activities tab ────────────────────────────────────────────────────────────
function ActivitiesTab() {
  const [activities, setActivities] = useState<any[]>([])
  const [loading, setLoading]       = useState(true)
  const [rescheduleId, setRescheduleId] = useState<string | null>(null)
  const [message, setMessage]       = useState('')
  const [sending, setSending]       = useState(false)
  const [toast, setToast]           = useState('')

  useEffect(() => {
    portalHttp.get('/api/portal/activities/')
      .then(r => setActivities(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleReschedule = async (id: string) => {
    setSending(true)
    try {
      await portalHttp.post(`/api/portal/activities/${id}/respond/`, { action: 'reschedule_request', message })
      setActivities(prev => prev.map(a => a.id === id ? { ...a, status: 'rescheduled' } : a))
      setRescheduleId(null); setMessage('')
      setToast('Reschedule request sent to your coach.')
      setTimeout(() => setToast(''), 4000)
    } catch { } finally { setSending(false) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#8c8279' }}>Loading…</div>
  if (activities.length === 0) return (
    <div style={{ padding: 60, textAlign: 'center', color: '#8c8279' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>📅</div>
      <div style={{ fontSize: 15 }}>No sessions scheduled yet.</div>
    </div>
  )

  const upcoming = activities.filter(a => !['cancelled', 'completed', 'missed'].includes(a.status))
  const past     = activities.filter(a =>  ['cancelled', 'completed', 'missed'].includes(a.status))

  const SessionRow = ({ a }: { a: any }) => {
    const canRequest = ['scheduled', 'late'].includes(a.status)
    return (
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0ece4' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#1a1714', marginBottom: 4 }}>{a.title}</div>
            <div style={{ fontSize: 12, color: '#8c8279' }}>{fmtDateTime(a.start_at)}{a.coach_name ? ` · ${a.coach_name}` : ''}</div>
            {a.location && <div style={{ fontSize: 12, color: '#8c8279', marginTop: 2 }}>📍 {a.location}</div>}
            {a.meeting_link && (
              <a href={a.meeting_link} target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: '#b8922e', display: 'inline-block', marginTop: 4, fontWeight: 600 }}>
                🔗 Join Meeting
              </a>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
            <StatusPill s={a.status} />
            {canRequest && rescheduleId !== a.id && (
              <button onClick={() => setRescheduleId(a.id)}
                style={{ fontSize: 11, color: '#1a2f4e', border: '1px solid #d8d3cc', background: '#fff', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' }}>
                Request Reschedule
              </button>
            )}
          </div>
        </div>
        {rescheduleId === a.id && (
          <div style={{ marginTop: 12, padding: 14, background: '#faf9f7', border: '1px solid #e8e3db', borderRadius: 6 }}>
            <div style={{ fontSize: 12, color: '#8c8279', marginBottom: 8 }}>Let your coach know your availability:</div>
            <textarea rows={3} value={message} onChange={e => setMessage(e.target.value)}
              placeholder="e.g. I'm available Mon–Wed after 3pm, or any time Friday."
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #d8d3cc', borderRadius: 5, fontSize: 13, lineHeight: 1.6, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setRescheduleId(null); setMessage('') }}
                style={{ padding: '6px 14px', border: '1px solid #d8d3cc', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
              <button onClick={() => handleReschedule(a.id)} disabled={sending}
                style={{ padding: '6px 14px', background: '#1a2f4e', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                {sending ? 'Sending…' : 'Send Request'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {toast && (
        <div style={{ background: '#e6f4ea', border: '1px solid #b5dfbc', color: '#2e7d32', padding: '10px 16px', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
          {toast}
        </div>
      )}
      {upcoming.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8c8279', marginBottom: 12 }}>Upcoming</div>
          <div style={{ background: '#fff', border: '1px solid #e8e3db', borderRadius: 8, overflow: 'hidden' }}>
            {upcoming.map(a => <SessionRow key={a.id} a={a} />)}
          </div>
        </div>
      )}
      {past.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8c8279', marginBottom: 12 }}>Past Sessions</div>
          <div style={{ background: '#fff', border: '1px solid #e8e3db', borderRadius: 8, overflow: 'hidden' }}>
            {past.map(a => <SessionRow key={a.id} a={a} />)}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Files tab ─────────────────────────────────────────────────────────────────
function FilesTab() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    portalHttp.get('/api/portal/materials/').then(r => setItems(r.data)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#8c8279' }}>Loading…</div>
  if (items.length === 0) return (
    <div style={{ padding: 60, textAlign: 'center', color: '#8c8279' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
      <div style={{ fontSize: 15 }}>No files shared yet.</div>
    </div>
  )

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e3db', borderRadius: 8, overflow: 'hidden' }}>
      {items.map((item: any, i: number) => (
        <div key={item.id} style={{ padding: '14px 20px', borderBottom: i < items.length - 1 ? '1px solid #f0ece4' : 'none', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 22, flexShrink: 0 }}>
            {item.content_type === 'pdf' ? '📄' : item.content_type === 'video' ? '🎬' : item.content_type === 'link' ? '🔗' : '📁'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#1a1714' }}>{item.title}</div>
            {item.description && <div style={{ fontSize: 12, color: '#8c8279', marginTop: 2 }}>{item.description}</div>}
          </div>
          {item.presigned_url && (
            <a href={item.presigned_url} target="_blank" rel="noreferrer"
              style={{ fontSize: 12, fontWeight: 600, color: '#1a2f4e', border: '1px solid #d8d3cc', padding: '6px 12px', borderRadius: 5, textDecoration: 'none', whiteSpace: 'nowrap' }}>
              ↓ Download
            </a>
          )}
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer"
              style={{ fontSize: 12, fontWeight: 600, color: '#1a2f4e', border: '1px solid #d8d3cc', padding: '6px 12px', borderRadius: 5, textDecoration: 'none', whiteSpace: 'nowrap' }}>
              ↗ Open
            </a>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Invoices tab ──────────────────────────────────────────────────────────────
function InvoicesTab() {
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    portalHttp.get('/api/portal/invoices/').then(r => setInvoices(r.data)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#8c8279' }}>Loading…</div>
  if (invoices.length === 0) return (
    <div style={{ padding: 60, textAlign: 'center', color: '#8c8279' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>💳</div>
      <div style={{ fontSize: 15 }}>No invoices yet.</div>
    </div>
  )

  const statusColor: Record<string, string> = { sent: '#2d6a9f', paid: '#4a7c59', overdue: '#c0392b', partially_paid: '#c9a84c' }

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e3db', borderRadius: 8, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#faf9f7' }}>
            {['Invoice', 'Amount', 'Due', 'Status', ''].map(h => (
              <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#8c8279', letterSpacing: '.08em', textTransform: 'uppercase', borderBottom: '1px solid #e8e3db' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv: any) => (
            <tr key={inv.id} style={{ borderBottom: '1px solid #f0ece4' }}>
              <td style={{ padding: '12px 16px', fontWeight: 600, fontSize: 14, color: '#1a1714' }}>{inv.number}</td>
              <td style={{ padding: '12px 16px', fontSize: 15, fontFamily: 'Cormorant Garamond, serif' }}>${Number(inv.total).toFixed(2)}</td>
              <td style={{ padding: '12px 16px', fontSize: 13, color: inv.status === 'overdue' ? '#c0392b' : '#8c8279' }}>{fmtDate(inv.due_date)}</td>
              <td style={{ padding: '12px 16px' }}>
                <span style={{ fontSize: 11, fontWeight: 700, background: `${statusColor[inv.status] || '#8c8279'}18`, color: statusColor[inv.status] || '#8c8279', padding: '2px 8px', borderRadius: 20, textTransform: 'capitalize' }}>
                  {inv.status.replace('_', ' ')}
                </span>
              </td>
              <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                {inv.stripe_payment_link && inv.status !== 'paid' && (
                  <a href={inv.stripe_payment_link} target="_blank" rel="noreferrer"
                    style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: '#4a7c59', padding: '6px 14px', borderRadius: 5, textDecoration: 'none' }}>
                    Pay Now
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Overview tab ──────────────────────────────────────────────────────────────
function OverviewTab({ session }: { session: any }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: '#fff', border: '1px solid #e8e3db', borderRadius: 8, padding: '20px 24px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8c8279', marginBottom: 14 }}>Your Details</div>
        {[
          { label: 'Name',      value: session.client_name },
          { label: 'Coach',     value: session.coach_name },
          { label: 'Workspace', value: session.workspace_name },
        ].map(row => (
          <div key={row.label} style={{ display: 'flex', padding: '10px 0', borderBottom: '1px solid #f0ece4', gap: 12 }}>
            <span style={{ fontSize: 12, color: '#8c8279', minWidth: 90 }}>{row.label}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#1a1714' }}>{row.value}</span>
          </div>
        ))}
      </div>
      <div style={{ background: '#fdf9ed', border: '1px solid #e8d98a', borderRadius: 8, padding: '16px 20px', fontSize: 13, color: '#7a6400', lineHeight: 1.6 }}>
        Welcome to your client portal. Here you can view your goals, upcoming sessions, shared files, and invoices. Use the tabs above to navigate.
      </div>
    </div>
  )
}

// ── Main portal ───────────────────────────────────────────────────────────────
const TABS = ['Overview', 'Goals', 'Activities', 'Files', 'Invoices'] as const

export default function ClientPortal() {
  const [session, setSession] = useState<any>(null)
  const [tab, setTab]         = useState<typeof TABS[number]>('Overview')
  const [branding, setBranding] = useState<any>(null)

  useEffect(() => {
    axios.get(`${BASE}/api/settings/public-branding/`).then(r => setBranding(r.data)).catch(() => {})
    const tok = sessionStorage.getItem('portal_token')
    if (tok) {
      portalHttp.get('/api/portal/me/')
        .then(r => setSession({ client_name: r.data.name, coach_name: r.data.coach_name, workspace_name: r.data.workspace_name }))
        .catch(() => { sessionStorage.removeItem('portal_token') })
    }
  }, [])

  const handleLogout = () => { sessionStorage.removeItem('portal_token'); setSession(null) }

  if (!session) return <LoginScreen branding={branding} onLogin={data => setSession(data)} />

  return (
    <div style={{ minHeight: '100vh', background: '#f5f2ec', fontFamily: "'DM Sans', Helvetica, Arial, sans-serif" }}>
      {/* Header */}
      <header style={{ background: '#1a2f4e', padding: '0 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {branding?.logo_url
              ? <img src={branding.logo_url} alt={branding.name} style={{ maxHeight: 32, objectFit: 'contain' }} />
              : <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, color: '#f5f0e8' }}>{session.workspace_name}</span>
            }
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 13, color: '#a09888' }}>Hi, {session.client_name.split(' ')[0]}</span>
            <button onClick={handleLogout}
              style={{ fontSize: 12, color: '#a09888', background: 'none', border: '1px solid #3a4f6a', borderRadius: 4, padding: '5px 12px', cursor: 'pointer' }}>
              Log out
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e8e3db' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', padding: '0 24px' }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '14px 18px', fontSize: 13, fontWeight: tab === t ? 600 : 400,
              color: tab === t ? '#1a1714' : '#8c8279',
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: `2px solid ${tab === t ? '#b8922e' : 'transparent'}`,
              marginBottom: -1,
            }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '28px 24px' }}>
        {tab === 'Overview'    && <OverviewTab session={session} />}
        {tab === 'Goals'       && <GoalsTab />}
        {tab === 'Activities'  && <ActivitiesTab />}
        {tab === 'Files'       && <FilesTab />}
        {tab === 'Invoices'    && <InvoicesTab />}
      </main>
    </div>
  )
}
