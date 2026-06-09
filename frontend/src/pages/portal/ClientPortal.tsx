/**
 * CoachOS — Client Portal
 * Standalone page — no AppShell, no coach sidebar.
 * Uses CoachOS design system CSS classes from index.css.
 */
import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

const BASE = import.meta.env.VITE_API_BASE_URL || ''

const portalHttp = axios.create({ baseURL: BASE, headers: { 'Content-Type': 'application/json' } })
portalHttp.interceptors.request.use(cfg => {
  const tok = sessionStorage.getItem('portal_token')
  if (tok) cfg.headers['Authorization'] = `Bearer ${tok}`
  return cfg
})

// ── Types ─────────────────────────────────────────────────────────────────────
interface Session { token: string; client_name: string; workspace_name: string; coach_name: string }
interface Branding { name: string; logo_url: string; primary_colour: string }
interface Goal { id: string; title: string; description: string; target_date: string | null; status: string; progress_count: number; progress_entries: { id: string; progress_text: string; created_at: string }[] }
interface Commitment { id: string; text: string; created_at: string }
interface Activity { id: string; title: string; activity_type: string; status: string; start_at: string; end_at: string | null; location: string; meeting_link: string; coach_name: string }
interface Material { id: string; title: string; item_type: string; file_url?: string; url?: string }
interface Invoice { id: string; number: string; status: string; total: string; amount_paid: string; due_date: string | null; stripe_payment_link: string; created_at: string }

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtDateTime(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    scheduled: 'pill-blue', completed: 'pill-green', rescheduled: 'pill-gold',
    cancelled: 'pill-red', late: 'pill-red', missed: 'pill-purple',
    sent: 'pill-blue', paid: 'pill-green', overdue: 'pill-red',
    partially_paid: 'pill-gold', draft: 'pill-grey',
  }
  return (
    <span className={`pill ${map[status] || 'pill-grey'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

// ── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen({ branding, onLogin }: { branding: Branding | null; onLogin: (data: Session) => void }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await axios.post(`${BASE}/api/portal/login/`, { email })
      sessionStorage.setItem('portal_token', data.token)
      sessionStorage.setItem('portal_client_name', data.client_name)
      sessionStorage.setItem('portal_workspace_name', data.workspace_name)
      sessionStorage.setItem('portal_coach_name', data.coach_name)
      onLogin(data)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No portal account found for this email.')
    } finally {
      setLoading(false)
    }
  }

  const wsName = branding?.name || 'CoachOS'

  return (
    <div className="auth-split" style={{ minHeight: '100vh' }}>
      {/* Brand panel */}
      <div className="auth-brand">
        <div>
          <div className="auth-brand-logo">{wsName}</div>
          <h1 className="auth-brand-headline" style={{ marginTop: 48 }}>
            Your coaching<br /><em>portal</em>
          </h1>
          <p className="auth-brand-sub" style={{ marginTop: 24 }}>
            Access your goals, sessions, files, and invoices — all in one place.
          </p>
          <ul className="auth-brand-features" style={{ marginTop: 32 }}>
            <li>Track your coaching goals &amp; progress</li>
            <li>View upcoming &amp; past sessions</li>
            <li>Download shared resources</li>
            <li>Review and pay invoices</li>
          </ul>
        </div>
      </div>

      {/* Form panel */}
      <div className="auth-form-area">
        <div className="auth-form-card">
          {branding?.logo_url && (
            <img src={branding.logo_url} alt={wsName}
              style={{ maxHeight: 48, maxWidth: 180, objectFit: 'contain', marginBottom: 24, display: 'block' }} />
          )}
          <h2 className="auth-form-title">Client Portal</h2>
          <p className="auth-form-sub">Enter your email address to access your portal</p>

          <form onSubmit={handleSubmit}>
            <div className="fgroup">
              <label className="flabel">Email Address</label>
              <input
                className="auth-input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
              />
            </div>

            {error && <div className="auth-error">{error}</div>}

            <button type="submit" className="auth-btn" disabled={loading} style={{ marginTop: 8 }}>
              {loading ? 'Checking…' : 'Access My Portal'}
            </button>
          </form>

          <p style={{ marginTop: 24, fontSize: 12, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.6 }}>
            You'll need an invitation from your coach to access this portal.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = ['Overview', 'Goals', 'Activities', 'Files', 'Invoices'] as const
type Tab = typeof TABS[number]

// ── Overview Tab ──────────────────────────────────────────────────────────────
function OverviewTab({ session, meData }: { session: Session; meData: any }) {
  const stats = [
    { label: 'Your Name',    value: meData?.name            || session.client_name },
    { label: 'Email',        value: meData?.email           || '—' },
    { label: 'Coach',        value: meData?.coach_name      || session.coach_name     || '—' },
    { label: 'Workspace',    value: meData?.workspace_name  || session.workspace_name || '—' },
    { label: 'Portal Access',value: meData?.portal_access   ? 'Active' : '—' },
  ]
  return (
    <div>
      <div style={{ padding: '22px 0 18px' }}>
        <h1 className="page-title">Welcome, {session.client_name}</h1>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
        {stats.map(({ label, value }) => (
          <div key={label} className="card" style={{ padding: '20px 22px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              {label}
            </div>
            <div style={{ fontSize: 15, color: 'var(--ink)', fontWeight: 500 }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Goals Tab ─────────────────────────────────────────────────────────────────
function GoalsTab({ goals, commitments, onProgressSaved }: {
  goals: Goal[]
  commitments: Commitment[]
  onProgressSaved: (goalId: string, entry: any) => void
}) {
  const [progressGoalId, setProgressGoalId] = useState<string | null>(null)
  const [progressText, setProgressText] = useState('')
  const [saving, setSaving] = useState(false)

  async function saveProgress(goalId: string) {
    if (!progressText.trim()) return
    setSaving(true)
    try {
      const { data } = await portalHttp.post(`/api/portal/goals/${goalId}/progress/`, { progress_text: progressText })
      onProgressSaved(goalId, data)
      setProgressText('')
      setProgressGoalId(null)
    } catch { /* keep form open */ } finally { setSaving(false) }
  }

  if (goals.length === 0 && commitments.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">🎯</div>
        <h3>No goals yet</h3>
        <p>Your coach will add goals here once your sessions begin.</p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ padding: '22px 0 18px' }}>
        <h1 className="page-title">Your Goals</h1>
      </div>

      {goals.map(goal => (
        <div key={goal.id} className="card" style={{ marginBottom: 16 }}>
          <div className="card-hdr" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{goal.title}</div>
              {goal.target_date && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  Target: {fmtDate(goal.target_date)}
                </div>
              )}
            </div>
            <button
              className={`btn ${progressGoalId === goal.id ? 'btn-outline' : 'btn-dark'} btn-sm`}
              onClick={() => { setProgressGoalId(progressGoalId === goal.id ? null : goal.id); setProgressText('') }}
            >
              {progressGoalId === goal.id ? 'Cancel' : '+ Add Progress'}
            </button>
          </div>

          <div className="card-body">
            {goal.description && (
              <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 16 }}>{goal.description}</p>
            )}

            {progressGoalId === goal.id && (
              <div style={{ marginBottom: 20, padding: 16, background: 'var(--paper)', borderRadius: 4, border: '1px solid var(--border)' }}>
                <div className="fgroup">
                  <label className="flabel">Progress Update</label>
                  <textarea
                    className="finput"
                    value={progressText}
                    onChange={e => setProgressText(e.target.value)}
                    placeholder="Describe your progress on this goal…"
                    rows={3}
                    autoFocus
                    style={{ resize: 'vertical' }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-dark btn-sm"
                    onClick={() => saveProgress(goal.id)}
                    disabled={saving || !progressText.trim()}
                  >
                    {saving ? 'Saving…' : 'Save Progress'}
                  </button>
                </div>
              </div>
            )}

            {goal.progress_entries?.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                  Progress History
                </div>
                {goal.progress_entries.map(entry => (
                  <div key={entry.id} style={{ padding: '10px 14px', background: 'var(--paper)', borderRadius: 4, marginBottom: 8, border: '1px solid var(--cream)' }}>
                    <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6 }}>{entry.progress_text}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted-faint)', marginTop: 4 }}>{fmtDate(entry.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}

      {commitments.length > 0 && (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="card-hdr">Commitments</div>
          <table className="tbl">
            <tbody>
              {commitments.map(c => (
                <tr key={c.id}>
                  <td>{c.text}</td>
                  <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap', width: 120, textAlign: 'right' }}>{fmtDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Activities Tab ────────────────────────────────────────────────────────────
function ActivitiesTab({ activities, onActivityUpdated }: {
  activities: Activity[]
  onActivityUpdated: (id: string, patch: Partial<Activity>) => void
}) {
  const [rescheduleId, setRescheduleId] = useState<string | null>(null)
  const [rescheduleMsg, setRescheduleMsg] = useState('')
  const [saving, setSaving] = useState(false)

  async function sendReschedule(id: string) {
    setSaving(true)
    try {
      await portalHttp.post(`/api/portal/activities/${id}/respond/`, { action: 'reschedule_request', message: rescheduleMsg })
      onActivityUpdated(id, { status: 'rescheduled' })
      setRescheduleId(null)
      setRescheduleMsg('')
    } catch { /* keep open */ } finally { setSaving(false) }
  }

  if (activities.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">📅</div>
        <h3>No sessions yet</h3>
        <p>Your scheduled sessions with your coach will appear here.</p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ padding: '22px 0 18px' }}>
        <h1 className="page-title">Sessions &amp; Activities</h1>
      </div>

      {activities.map(act => (
        <div key={act.id} className="card" style={{ marginBottom: 12 }}>
          <div className="card-hdr" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{act.title}</span>
                <StatusPill status={act.status} />
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{fmtDateTime(act.start_at)}</div>
            </div>
            {(act.status === 'scheduled' || act.status === 'rescheduled') && (
              <button
                className="btn btn-outline btn-sm"
                onClick={() => { setRescheduleId(rescheduleId === act.id ? null : act.id); setRescheduleMsg('') }}
              >
                {rescheduleId === act.id ? 'Cancel' : 'Request Reschedule'}
              </button>
            )}
          </div>

          {(act.location || act.meeting_link) && (
            <div style={{ padding: '0 20px 12px', borderTop: 'none' }}>
              {act.location && <div style={{ fontSize: 13, color: 'var(--muted)' }}>📍 {act.location}</div>}
              {act.meeting_link && (
                <a href={act.meeting_link} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 13, color: 'var(--blue)', textDecoration: 'none', display: 'inline-block', marginTop: 4 }}>
                  🔗 Join Meeting
                </a>
              )}
            </div>
          )}

          {rescheduleId === act.id && (
            <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="fgroup">
                <label className="flabel">Message to your coach (optional)</label>
                <textarea
                  className="finput"
                  value={rescheduleMsg}
                  onChange={e => setRescheduleMsg(e.target.value)}
                  placeholder="e.g. I'm available Monday–Wednesday after 3pm, or anytime Friday."
                  rows={3}
                  autoFocus
                  style={{ resize: 'vertical' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-outline btn-sm" onClick={() => { setRescheduleId(null); setRescheduleMsg('') }}>
                  Cancel
                </button>
                <button className="btn btn-dark btn-sm" onClick={() => sendReschedule(act.id)} disabled={saving}>
                  {saving ? 'Sending…' : 'Send Request'}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Files Tab ─────────────────────────────────────────────────────────────────
function FilesTab({ materials }: { materials: Material[] }) {
  if (materials.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">📁</div>
        <h3>No files shared yet</h3>
        <p>Resources shared by your coach will appear here.</p>
      </div>
    )
  }
  const typeMap: Record<string, string> = {
    article: 'pill-blue', pdf: 'pill-red', video: 'pill-purple',
    template: 'pill-green', worksheet: 'pill-gold', link: 'pill-grey',
  }
  return (
    <div>
      <div style={{ padding: '22px 0 18px' }}>
        <h1 className="page-title">Shared Files</h1>
      </div>
      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {materials.map(item => {
              const href = item.file_url || item.url || ''
              return (
                <tr key={item.id}>
                  <td style={{ fontWeight: 500 }}>{item.title}</td>
                  <td><span className={`pill ${typeMap[item.item_type] || 'pill-grey'}`}>{item.item_type || 'file'}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    {href && (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
                        Download
                      </a>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Invoices Tab ──────────────────────────────────────────────────────────────
function InvoicesTab({ invoices }: { invoices: Invoice[] }) {
  if (invoices.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">🧾</div>
        <h3>No invoices yet</h3>
        <p>Your invoices will appear here once your coach sends them.</p>
      </div>
    )
  }
  return (
    <div>
      <div style={{ padding: '22px 0 18px' }}>
        <h1 className="page-title">Invoices</h1>
      </div>
      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Due Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map(inv => (
              <tr key={inv.id}>
                <td style={{ fontWeight: 600 }}>#{inv.number}</td>
                <td style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 16 }}>
                  ${parseFloat(inv.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </td>
                <td><StatusPill status={inv.status} /></td>
                <td style={{ color: 'var(--muted)' }}>{inv.due_date ? fmtDate(inv.due_date) : '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {inv.stripe_payment_link && inv.status !== 'paid' && (
                    <a href={inv.stripe_payment_link} target="_blank" rel="noopener noreferrer" className="btn btn-dark btn-sm">
                      Pay Now
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main Portal ────────────────────────────────────────────────────────────────
export default function ClientPortal() {
  const [session, setSession]         = useState<Session | null>(null)
  const [branding, setBranding]       = useState<Branding | null>(null)
  const [activeTab, setActiveTab]     = useState<Tab>('Overview')
  const [loading, setLoading]         = useState(false)
  const [meData, setMeData]           = useState<any>(null)
  const [goals, setGoals]             = useState<Goal[]>([])
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [activities, setActivities]   = useState<Activity[]>([])
  const [materials, setMaterials]     = useState<Material[]>([])
  const [invoices, setInvoices]       = useState<Invoice[]>([])

  useEffect(() => {
    axios.get(`${BASE}/api/settings/public-branding/`).then(r => setBranding(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    const token = sessionStorage.getItem('portal_token')
    if (token) {
      setSession({
        token,
        client_name:    sessionStorage.getItem('portal_client_name')    || '',
        workspace_name: sessionStorage.getItem('portal_workspace_name') || '',
        coach_name:     sessionStorage.getItem('portal_coach_name')     || '',
      })
    }
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [meRes, goalsRes, activitiesRes, materialsRes, invoicesRes] = await Promise.all([
        portalHttp.get('/api/portal/me/'),
        portalHttp.get('/api/portal/goals/'),
        portalHttp.get('/api/portal/activities/'),
        portalHttp.get('/api/portal/materials/'),
        portalHttp.get('/api/portal/invoices/'),
      ])
      setMeData(meRes.data)
      setGoals(goalsRes.data.goals || [])
      setCommitments(goalsRes.data.commitments || [])
      setActivities(activitiesRes.data || [])
      setMaterials(materialsRes.data || [])
      setInvoices(invoicesRes.data || [])
    } catch { logout() } finally { setLoading(false) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (session) loadData() }, [session, loadData])

  function logout() {
    ['portal_token', 'portal_client_name', 'portal_workspace_name', 'portal_coach_name']
      .forEach(k => sessionStorage.removeItem(k))
    setSession(null); setMeData(null); setGoals([]); setCommitments([])
    setActivities([]); setMaterials([]); setInvoices([]); setActiveTab('Overview')
  }

  if (!session) return <LoginScreen branding={branding} onLogin={data => setSession(data)} />

  const wsName = session.workspace_name || branding?.name || 'CoachOS'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{
        background: 'var(--ink)', color: 'var(--paper)',
        padding: '0 32px', height: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
        boxShadow: 'var(--shadow-md)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {branding?.logo_url
            ? <img src={branding.logo_url} alt={wsName}
                style={{ maxHeight: 32, maxWidth: 120, objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
            : <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, fontWeight: 400, letterSpacing: '0.04em', color: 'var(--paper)' }}>
                {wsName}
              </span>
          }
          <span style={{
            fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.45)',
            textTransform: 'uppercase', letterSpacing: '0.10em',
            borderLeft: '1px solid rgba(255,255,255,0.18)', paddingLeft: 14,
          }}>
            Client Portal
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, color: 'rgba(248,245,240,0.7)' }}>{session.client_name}</span>
          <button
            className="btn btn-outline btn-sm"
            onClick={logout}
            style={{ color: 'rgba(248,245,240,0.7)', borderColor: 'rgba(255,255,255,0.2)', background: 'transparent' }}
          >
            Log out
          </button>
        </div>
      </header>

      {/* Tab bar */}
      <div style={{
        background: '#fff', borderBottom: '1px solid var(--border)',
        padding: '0 32px', display: 'flex', overflowX: 'auto',
        boxShadow: 'var(--shadow-sm)',
      }}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '14px 20px', border: 'none', background: 'none',
            fontSize: 13, fontWeight: activeTab === tab ? 600 : 400,
            color: activeTab === tab ? 'var(--ink)' : 'var(--muted)',
            cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
            borderBottom: activeTab === tab ? '2px solid var(--gold)' : '2px solid transparent',
            marginBottom: -1, transition: 'color .15s',
          }}>
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <main style={{ flex: 1, maxWidth: 900, width: '100%', margin: '0 auto', padding: '0 32px 48px', boxSizing: 'border-box' }}>
        {loading ? (
          <div className="empty">
            <div className="empty-icon">⏳</div>
            <h3>Loading your portal…</h3>
          </div>
        ) : (
          <>
            {activeTab === 'Overview'   && <OverviewTab session={session} meData={meData} />}
            {activeTab === 'Goals'      && (
              <GoalsTab
                goals={goals}
                commitments={commitments}
                onProgressSaved={(goalId, entry) =>
                  setGoals(prev => prev.map(g => g.id === goalId
                    ? { ...g, progress_entries: [entry, ...g.progress_entries], progress_count: g.progress_count + 1 }
                    : g))
                }
              />
            )}
            {activeTab === 'Activities' && (
              <ActivitiesTab
                activities={activities}
                onActivityUpdated={(id, patch) =>
                  setActivities(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a))
                }
              />
            )}
            {activeTab === 'Files'      && <FilesTab materials={materials} />}
            {activeTab === 'Invoices'   && <InvoicesTab invoices={invoices} />}
          </>
        )}
      </main>

      <footer style={{ textAlign: 'center', padding: '20px 24px', color: 'var(--muted-faint)', fontSize: 11, borderTop: '1px solid var(--border)' }}>
        Powered by CoachOS
      </footer>
    </div>
  )
}
