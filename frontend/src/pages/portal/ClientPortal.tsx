/**
 * CoachOS — Client Portal
 * Standalone page — no AppShell. Uses CoachOS CSS design system.
 */
import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

const BASE = import.meta.env.VITE_API_BASE_URL || ''

const api = axios.create({ baseURL: BASE, headers: { 'Content-Type': 'application/json' } })
api.interceptors.request.use(cfg => {
  const tok = sessionStorage.getItem('portal_token')
  if (tok) cfg.headers['Authorization'] = `Bearer ${tok}`
  return cfg
})

// ── Types ─────────────────────────────────────────────────────────────────────
interface Session { token: string; client_name: string; workspace_name: string; coach_name: string }
interface Branding { name: string; logo_url: string; primary_colour: string }
interface GoalProgress { id: string; progress_text: string; created_at: string }
interface Goal { id: string; title: string; description: string; target_date: string | null; status: string; progress_count: number; progress_entries: GoalProgress[] }
interface Commitment { id: string; text: string; created_at: string }
interface Activity { id: string; title: string; activity_type: string; status: string; start_at: string; end_at: string | null; location: string; meeting_link: string; coach_name: string }
interface InvoiceItem { description: string; quantity: string; unit_price: string; line_total: string }
interface Invoice { id: string; number: string; status: string; total: string; amount_paid: string; due_date: string | null; stripe_payment_link: string; created_at: string; items: InvoiceItem[] }
interface Material { id: string; title: string; item_type: string; file_url?: string; url?: string }
interface Note { id: string; text: string; note_type: string; created_by_name: string | null; client_owned: boolean; created_at: string; updated_at: string }
interface MeData { id: string; name: string; email: string; coach_name: string; workspace_name: string; portal_access: boolean }

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtDT(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
function fmtTime(iso: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function isPast(iso: string) { return new Date(iso) < new Date() }
function isUpcoming(iso: string) { return new Date(iso) > new Date() }

function Pill({ status }: { status: string }) {
  const map: Record<string, string> = {
    scheduled: 'pill-blue', completed: 'pill-green', rescheduled: 'pill-gold',
    cancelled: 'pill-red', late: 'pill-red', missed: 'pill-purple',
    sent: 'pill-blue', paid: 'pill-green', overdue: 'pill-red',
    partially_paid: 'pill-gold', draft: 'pill-grey', active: 'pill-green',
  }
  return <span className={`pill ${map[status] || 'pill-grey'}`}>{status.replace(/_/g, ' ')}</span>
}

// ── Login ─────────────────────────────────────────────────────────────────────
function LoginScreen({ branding, onLogin }: { branding: Branding | null; onLogin: (d: Session) => void }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const { data } = await axios.post(`${BASE}/api/portal/login/`, { email })
      sessionStorage.setItem('portal_token', data.token)
      sessionStorage.setItem('portal_client_name', data.client_name)
      sessionStorage.setItem('portal_workspace_name', data.workspace_name)
      sessionStorage.setItem('portal_coach_name', data.coach_name)
      onLogin(data)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No portal account found for this email.')
    } finally { setLoading(false) }
  }

  const wsName = branding?.name || 'CoachOS'
  return (
    <div className="auth-split" style={{ minHeight: '100vh' }}>
      <div className="auth-brand">
        <div>
          <div className="auth-brand-logo">{wsName}</div>
          <h1 className="auth-brand-headline" style={{ marginTop: 48 }}>Your coaching<br /><em>portal</em></h1>
          <p className="auth-brand-sub" style={{ marginTop: 24 }}>Access your goals, sessions, files, and invoices — all in one place.</p>
          <ul className="auth-brand-features" style={{ marginTop: 32 }}>
            <li>Track your coaching goals &amp; progress</li>
            <li>View upcoming &amp; past sessions</li>
            <li>Download shared resources</li>
            <li>Review and pay invoices</li>
          </ul>
        </div>
      </div>
      <div className="auth-form-area">
        <div className="auth-form-card">
          {branding?.logo_url && <img src={branding.logo_url} alt={wsName} style={{ maxHeight: 48, maxWidth: 180, objectFit: 'contain', marginBottom: 24, display: 'block' }} />}
          <h2 className="auth-form-title">Client Portal</h2>
          <p className="auth-form-sub">Enter your email address to access your portal</p>
          <form onSubmit={submit}>
            <div className="fgroup">
              <label className="flabel">Email Address</label>
              <input className="auth-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
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

// ── Overview ──────────────────────────────────────────────────────────────────
function OverviewTab({ me, goals, activities, invoices }: { me: MeData | null; goals: Goal[]; activities: Activity[]; invoices: Invoice[] }) {
  const upcoming = activities.filter(a => a.status === 'scheduled' && isUpcoming(a.start_at)).slice(0, 3)
  const activeGoals = goals.filter(g => g.status === 'active')
  const unpaidInvoices = invoices.filter(i => ['sent', 'overdue', 'partially_paid'].includes(i.status))
  const totalOwed = unpaidInvoices.reduce((s, i) => s + parseFloat(i.total) - parseFloat(i.amount_paid), 0)

  return (
    <div>
      <div style={{ padding: '24px 0 20px' }}>
        <h1 className="page-title">Welcome back, {me?.name || ''}</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
          Your coach: <strong style={{ color: 'var(--ink)' }}>{me?.coach_name}</strong>
          &nbsp;·&nbsp;{me?.workspace_name}
        </p>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
        {[
          { label: 'Upcoming Sessions', value: upcoming.length, color: 'var(--navy)' },
          { label: 'Active Goals',      value: activeGoals.length, color: 'var(--success)' },
          { label: 'Amount Due',        value: totalOwed > 0 ? `$${totalOwed.toFixed(2)}` : '—', color: totalOwed > 0 ? 'var(--warn)' : 'var(--muted)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '20px 24px', borderTop: `3px solid ${s.color}` }}>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 36, fontWeight: 400, color: s.color, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 6 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Upcoming sessions */}
      {upcoming.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-hdr">Upcoming Sessions</div>
          <table className="tbl">
            <tbody>
              {upcoming.map(a => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.title}</td>
                  <td style={{ color: 'var(--muted)' }}>{fmtDT(a.start_at)}</td>
                  <td>{a.meeting_link && <a href={a.meeting_link} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">Join</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Unpaid invoices */}
      {unpaidInvoices.length > 0 && (
        <div className="card">
          <div className="card-hdr">Outstanding Invoices</div>
          <table className="tbl">
            <tbody>
              {unpaidInvoices.map(inv => (
                <tr key={inv.id}>
                  <td style={{ fontWeight: 600 }}>#{inv.number}</td>
                  <td><Pill status={inv.status} /></td>
                  <td style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 16 }}>${parseFloat(inv.total).toFixed(2)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {inv.stripe_payment_link && <a href={inv.stripe_payment_link} target="_blank" rel="noopener noreferrer" className="btn btn-dark btn-sm">Pay Now</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {upcoming.length === 0 && unpaidInvoices.length === 0 && (
        <div className="empty" style={{ paddingTop: 40 }}>
          <div className="empty-icon">✨</div>
          <h3>You're all caught up</h3>
          <p>No upcoming sessions or outstanding invoices.</p>
        </div>
      )}
    </div>
  )
}

// ── Goals ─────────────────────────────────────────────────────────────────────
function GoalsTab({ goals, commitments, onProgressSaved }: { goals: Goal[]; commitments: Commitment[]; onProgressSaved: (goalId: string, entry: GoalProgress) => void }) {
  const [openGoal, setOpenGoal] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  async function saveProgress(goalId: string) {
    if (!text.trim()) return
    setSaving(true)
    try {
      const { data } = await api.post(`/api/portal/goals/${goalId}/progress/`, { progress_text: text })
      onProgressSaved(goalId, data); setText(''); setOpenGoal(null)
    } catch { } finally { setSaving(false) }
  }

  if (!goals.length && !commitments.length) return (
    <div className="empty"><div className="empty-icon">🎯</div><h3>No goals yet</h3><p>Your coach will add goals here.</p></div>
  )

  return (
    <div>
      <div style={{ padding: '24px 0 20px' }}><h1 className="page-title">Your Goals</h1></div>
      {goals.map(g => (
        <div key={g.id} className="card" style={{ marginBottom: 16 }}>
          <div className="card-hdr" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>{g.title}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                <Pill status={g.status} />
                {g.target_date && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Target: {fmtDate(g.target_date)}</span>}
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{g.progress_count} updates</span>
              </div>
            </div>
            <button className={`btn btn-sm ${openGoal === g.id ? 'btn-outline' : 'btn-dark'}`}
              onClick={() => { setOpenGoal(openGoal === g.id ? null : g.id); setText('') }}>
              {openGoal === g.id ? 'Cancel' : '+ Progress'}
            </button>
          </div>
          <div className="card-body">
            {g.description && <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 16 }}>{g.description}</p>}
            {openGoal === g.id && (
              <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 4, padding: 16, marginBottom: 16 }}>
                <div className="fgroup">
                  <label className="flabel">Progress Update</label>
                  <textarea className="finput" value={text} onChange={e => setText(e.target.value)} rows={3} autoFocus placeholder="Describe your progress…" style={{ resize: 'vertical' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn btn-dark btn-sm" onClick={() => saveProgress(g.id)} disabled={saving || !text.trim()}>{saving ? 'Saving…' : 'Save'}</button>
                </div>
              </div>
            )}
            {g.progress_entries?.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>History</div>
                {g.progress_entries.map(e => (
                  <div key={e.id} style={{ padding: '10px 14px', background: 'var(--paper)', borderRadius: 4, marginBottom: 8, border: '1px solid var(--cream)' }}>
                    <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6 }}>{e.progress_text}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted-faint)', marginTop: 4 }}>{fmtDate(e.created_at)}</div>
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
          <table className="tbl"><tbody>
            {commitments.map(c => (
              <tr key={c.id}><td>{c.text}</td><td style={{ color: 'var(--muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtDate(c.created_at)}</td></tr>
            ))}
          </tbody></table>
        </div>
      )}
    </div>
  )
}

// ── Activities ────────────────────────────────────────────────────────────────
function ActivitiesTab({ activities, onUpdate }: { activities: Activity[]; onUpdate: (id: string, p: Partial<Activity>) => void }) {
  const [reschedId, setReschedId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  async function sendReschedule(id: string) {
    setSaving(true)
    try {
      await api.post(`/api/portal/activities/${id}/respond/`, { action: 'reschedule_request', message: msg })
      onUpdate(id, { status: 'rescheduled' }); setReschedId(null); setMsg('')
    } catch { } finally { setSaving(false) }
  }

  if (!activities.length) return (
    <div className="empty"><div className="empty-icon">📅</div><h3>No sessions yet</h3><p>Your scheduled sessions will appear here.</p></div>
  )

  const upcoming = activities.filter(a => isUpcoming(a.start_at) && a.status !== 'cancelled')
  const past     = activities.filter(a => isPast(a.start_at) || a.status === 'cancelled')

  function ActivityCard({ a }: { a: Activity }) {
    const canReschedule = (a.status === 'scheduled' || a.status === 'rescheduled') && isUpcoming(a.start_at)
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-hdr" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>{a.activity_type}</span>
              <Pill status={a.status} />
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{fmtDT(a.start_at)}{a.end_at ? ` — ${fmtTime(a.end_at)}` : ''}</div>
            {a.title && a.title.toLowerCase() !== a.activity_type.toLowerCase() && (
              <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500, marginTop: 4 }}>{a.title}</div>
            )}
          </div>
          {canReschedule && (
            <button className="btn btn-outline btn-sm" onClick={() => { setReschedId(reschedId === a.id ? null : a.id); setMsg('') }}>
              {reschedId === a.id ? 'Cancel' : 'Reschedule'}
            </button>
          )}
        </div>
        {(a.location || a.meeting_link || a.coach_name) && (
          <div style={{ padding: '8px 20px 14px', borderTop: '1px solid var(--cream)', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {a.coach_name && <span style={{ fontSize: 12, color: 'var(--muted)' }}>👤 {a.coach_name}</span>}
            {a.location   && <span style={{ fontSize: 12, color: 'var(--muted)' }}>📍 {a.location}</span>}
            {a.meeting_link && <a href={a.meeting_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none' }}>🔗 Join Meeting</a>}
          </div>
        )}
        {reschedId === a.id && (
          <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="fgroup">
              <label className="flabel">Message to your coach (optional)</label>
              <textarea className="finput" value={msg} onChange={e => setMsg(e.target.value)} rows={3} autoFocus placeholder="e.g. Available Mon–Wed after 3pm…" style={{ resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={() => { setReschedId(null); setMsg('') }}>Cancel</button>
              <button className="btn btn-dark btn-sm" onClick={() => sendReschedule(a.id)} disabled={saving}>{saving ? 'Sending…' : 'Send Request'}</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ padding: '24px 0 20px' }}><h1 className="page-title">Sessions &amp; Activities</h1></div>
      {upcoming.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Upcoming</div>
          {upcoming.map(a => <ActivityCard key={a.id} a={a} />)}
          <div style={{ height: 12 }} />
        </>
      )}
      {past.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12, marginTop: 4 }}>Past</div>
          {past.map(a => <ActivityCard key={a.id} a={a} />)}
        </>
      )}
    </div>
  )
}

// ── Notes helpers ─────────────────────────────────────────────────────────────
const STRUCTURED_PREFIX = '##STRUCTURED##'

function parseStructured(text: string): { notes: string; reflection: string; commitment: string } | null {
  if (!text?.startsWith(STRUCTURED_PREFIX)) return null
  try { return JSON.parse(text.slice(STRUCTURED_PREFIX.length)) } catch { return null }
}

function StructuredDisplay({ data }: { data: { notes: string; reflection: string; commitment: string } }) {
  const sections = [
    { key: 'notes',      label: 'Session Notes' },
    { key: 'reflection', label: 'Coach Reflection' },
    { key: 'commitment', label: 'Commitment' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {sections.map(sec => {
        const val = (data as any)[sec.key]
        if (!val?.trim()) return null
        return (
          <div key={sec.key}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>{sec.label}</div>
            <p style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--ink)', whiteSpace: 'pre-wrap', margin: 0 }}>{val}</p>
          </div>
        )
      })}
    </div>
  )
}

function fmtRelative(iso: string) {
  const d = new Date(iso), now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `Today at ${fmtTime(iso)}`
  if (diff < 172800000) return `Yesterday at ${fmtTime(iso)}`
  return fmtDate(iso)
}

const NOTE_TYPE_PILL: Record<string, string> = { session: 'pill-blue', observation: 'pill-gold', commitment: 'pill-green', general: 'pill-grey' }
const NOTE_TYPE_LABEL: Record<string, string> = { session: 'Session Note', observation: 'Observation', commitment: 'Commitment', general: 'General' }

// ── Notes Tab ─────────────────────────────────────────────────────────────────
function NotesTab({ notes, setNotes }: { notes: Note[]; setNotes: React.Dispatch<React.SetStateAction<Note[]>> }) {
  const [draft, setDraft]   = useState('')
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  async function createNote() {
    if (!draft.trim()) return
    setSaving(true)
    try {
      const { data } = await api.post('/api/portal/notes/', { text: draft })
      setNotes(prev => [data, ...prev]); setDraft('')
    } catch { } finally { setSaving(false) }
  }

  async function updateNote(id: string) {
    if (!editText.trim()) return
    try {
      const { data } = await api.patch(`/api/portal/notes/${id}/`, { text: editText })
      setNotes(prev => prev.map(n => n.id === id ? data : n)); setEditId(null)
    } catch { }
  }

  async function deleteNote(id: string) {
    if (!confirm('Delete this note?')) return
    try {
      await api.delete(`/api/portal/notes/${id}/`)
      setNotes(prev => prev.filter(n => n.id !== id))
    } catch { }
  }

  return (
    <div>
      <div style={{ padding: '24px 0 16px' }}>
        <h1 className="page-title">Session Notes</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Shared between you and your coach only.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 24, alignItems: 'start' }}>

        {/* Left — new note form */}
        <div className="card" style={{ position: 'sticky', top: 80 }}>
          <div className="card-hdr" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>NEW NOTE</span>
          </div>
          <div className="card-body">
            <textarea
              className="finput"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="Write your note here…"
              rows={6}
              style={{ resize: 'vertical', marginBottom: 12 }}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) createNote() }}
            />
            <button className="btn btn-dark" style={{ width: '100%' }} onClick={createNote} disabled={saving || !draft.trim()}>
              {saving ? 'SAVING…' : 'SAVE NOTE'}
            </button>
            <p style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 8 }}>⌘ + Enter to save</p>
          </div>
        </div>

        {/* Right — notes list */}
        <div>
          {notes.length === 0 ? (
            <div className="empty" style={{ paddingTop: 40 }}>
              <div className="empty-icon">📝</div>
              <h3>No notes yet</h3>
              <p>Write your first note on the left.</p>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 18, fontFamily: "'Cormorant Garamond', serif", fontWeight: 400, color: 'var(--ink)', marginBottom: 16 }}>
                Session Notes <span style={{ color: 'var(--muted)', fontSize: 14 }}>{notes.length}</span>
              </div>
              {notes.map(note => {
                const structured = parseStructured(note.text)
                const typeLabel  = NOTE_TYPE_LABEL[note.note_type] || note.note_type
                const typePill   = NOTE_TYPE_PILL[note.note_type]  || 'pill-grey'

                return (
                  <div key={note.id} className="card" style={{ marginBottom: 12, overflow: 'hidden' }}>
                    {/* Note header */}
                    <div style={{ padding: '10px 16px', background: 'var(--paper)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className={`pill ${typePill}`} style={{ fontSize: 10 }}>{typeLabel}</span>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtRelative(note.created_at)}</span>
                        {note.created_by_name && (
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>by {note.created_by_name}</span>
                        )}
                      </div>
                      {note.client_owned && editId !== note.id && (
                        <div style={{ display: 'flex', gap: 12 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => { setEditId(note.id); setEditText(note.text) }}>Edit</button>
                          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--muted)' }} onClick={() => deleteNote(note.id)}>✕</button>
                        </div>
                      )}
                    </div>

                    {/* Note body */}
                    <div className="card-body">
                      {editId === note.id ? (
                        <>
                          <textarea className="finput" value={editText} onChange={e => setEditText(e.target.value)} rows={4} autoFocus style={{ resize: 'vertical', marginBottom: 12 }} />
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button className="btn btn-outline btn-sm" onClick={() => setEditId(null)}>Cancel</button>
                            <button className="btn btn-dark btn-sm" onClick={() => updateNote(note.id)} disabled={!editText.trim()}>Save</button>
                          </div>
                        </>
                      ) : structured ? (
                        <StructuredDisplay data={structured} />
                      ) : (
                        <p style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.8, whiteSpace: 'pre-wrap', margin: 0 }}>{note.text}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Files ─────────────────────────────────────────────────────────────────────
function FilesTab({ materials }: { materials: Material[] }) {
  if (!materials.length) return (
    <div className="empty"><div className="empty-icon">📁</div><h3>No files shared yet</h3><p>Resources shared by your coach will appear here.</p></div>
  )
  const typeMap: Record<string, string> = { article: 'pill-blue', pdf: 'pill-red', video: 'pill-purple', template: 'pill-green', worksheet: 'pill-gold', link: 'pill-grey' }
  return (
    <div>
      <div style={{ padding: '24px 0 20px' }}><h1 className="page-title">Shared Files</h1></div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Title</th><th>Type</th><th></th></tr></thead>
          <tbody>
            {materials.map(item => (
              <tr key={item.id}>
                <td style={{ fontWeight: 500 }}>{item.title}</td>
                <td><span className={`pill ${typeMap[item.item_type] || 'pill-grey'}`}>{item.item_type || 'file'}</span></td>
                <td style={{ textAlign: 'right' }}>
                  {(item.file_url || item.url) && (
                    <a href={item.file_url || item.url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">Download</a>
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

// ── Invoices ──────────────────────────────────────────────────────────────────
function InvoicesTab({ invoices }: { invoices: Invoice[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (!invoices.length) return (
    <div className="empty"><div className="empty-icon">🧾</div><h3>No invoices yet</h3><p>Your invoices will appear here once your coach sends them.</p></div>
  )

  return (
    <div>
      <div style={{ padding: '24px 0 20px' }}><h1 className="page-title">Invoices</h1></div>
      {invoices.map(inv => (
        <div key={inv.id} className="card" style={{ marginBottom: 12 }}>
          {/* Invoice header row */}
          <div
            className="card-hdr"
            style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none' }}
            onClick={() => setExpanded(expanded === inv.id ? null : inv.id)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: 'var(--ink)' }}>#{inv.number}</span>
              <Pill status={inv.status} />
              {inv.due_date && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Due {fmtDate(inv.due_date)}</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, fontWeight: 400, color: 'var(--ink)' }}>
                ${parseFloat(inv.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted)', transition: 'transform .15s', display: 'inline-block', transform: expanded === inv.id ? 'rotate(180deg)' : 'none' }}>▾</span>
            </div>
          </div>

          {/* Expanded detail */}
          {expanded === inv.id && (
            <div className="card-body">
              {inv.items.length > 0 && (
                <table className="tbl" style={{ marginBottom: 16 }}>
                  <thead>
                    <tr><th>Description</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Unit Price</th><th style={{ textAlign: 'right' }}>Total</th></tr>
                  </thead>
                  <tbody>
                    {inv.items.map((item, i) => (
                      <tr key={i}>
                        <td>{item.description}</td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{item.quantity}</td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>${parseFloat(item.unit_price).toFixed(2)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>${parseFloat(item.line_total).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {parseFloat(inv.amount_paid) > 0 && (
                    <span>Paid: <strong style={{ color: 'var(--success)' }}>${parseFloat(inv.amount_paid).toFixed(2)}</strong> &nbsp;·&nbsp; </span>
                  )}
                  Issued: {fmtDate(inv.created_at)}
                </div>
                {inv.stripe_payment_link && inv.status !== 'paid' && (
                  <a href={inv.stripe_payment_link} target="_blank" rel="noopener noreferrer" className="btn btn-dark btn-sm">Pay Now</a>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main Portal ────────────────────────────────────────────────────────────────
const TABS = ['Overview', 'Goals', 'Activities', 'Notes', 'Files', 'Invoices'] as const
type Tab = typeof TABS[number]

export default function ClientPortal() {
  const [session, setSession]         = useState<Session | null>(null)
  const [branding, setBranding]       = useState<Branding | null>(null)
  const [activeTab, setActiveTab]     = useState<Tab>('Overview')
  const [loading, setLoading]         = useState(false)
  const [me, setMe]                   = useState<MeData | null>(null)
  const [goals, setGoals]             = useState<Goal[]>([])
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [activities, setActivities]   = useState<Activity[]>([])
  const [materials, setMaterials]     = useState<Material[]>([])
  const [invoices, setInvoices]       = useState<Invoice[]>([])
  const [notes, setNotes]             = useState<Note[]>([])

  useEffect(() => { axios.get(`${BASE}/api/settings/public-branding/`).then(r => setBranding(r.data)).catch(() => {}) }, [])

  useEffect(() => {
    const token = sessionStorage.getItem('portal_token')
    if (token) setSession({ token, client_name: sessionStorage.getItem('portal_client_name') || '', workspace_name: sessionStorage.getItem('portal_workspace_name') || '', coach_name: sessionStorage.getItem('portal_coach_name') || '' })
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [meR, goalsR, actR, matR, invR, notesR] = await Promise.all([
        api.get('/api/portal/me/'),
        api.get('/api/portal/goals/'),
        api.get('/api/portal/activities/'),
        api.get('/api/portal/materials/'),
        api.get('/api/portal/invoices/'),
        api.get('/api/portal/notes/'),
      ])
      setMe(meR.data)
      setGoals(goalsR.data.goals || [])
      setCommitments(goalsR.data.commitments || [])
      setActivities(actR.data || [])
      setMaterials(matR.data || [])
      setInvoices(invR.data || [])
      setNotes(notesR.data || [])
    } catch { logout() } finally { setLoading(false) }
  }, []) // eslint-disable-line

  useEffect(() => { if (session) loadData() }, [session, loadData])

  function logout() {
    ['portal_token', 'portal_client_name', 'portal_workspace_name', 'portal_coach_name'].forEach(k => sessionStorage.removeItem(k))
    setSession(null); setMe(null); setGoals([]); setCommitments([])
    setActivities([]); setMaterials([]); setInvoices([]); setNotes([]); setActiveTab('Overview')
  }

  if (!session) return <LoginScreen branding={branding} onLogin={d => setSession(d)} />

  const wsName = session.workspace_name || branding?.name || 'CoachOS'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{ background: 'var(--ink)', padding: '0 32px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50, boxShadow: 'var(--shadow-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {branding?.logo_url
            ? <img src={branding.logo_url} alt={wsName} style={{ maxHeight: 32, maxWidth: 120, objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
            : <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, fontWeight: 400, letterSpacing: '0.04em', color: 'var(--paper)' }}>{wsName}</span>
          }
          <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.10em', borderLeft: '1px solid rgba(255,255,255,0.15)', paddingLeft: 14 }}>
            Client Portal
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, color: 'rgba(248,245,240,0.65)' }}>{session.client_name}</span>
          <button className="btn btn-outline btn-sm" onClick={logout} style={{ color: 'rgba(248,245,240,0.65)', borderColor: 'rgba(255,255,255,0.18)', background: 'transparent' }}>Log out</button>
        </div>
      </header>

      {/* Tab bar */}
      <div style={{ background: '#fff', borderBottom: '1px solid var(--border)', padding: '0 32px', display: 'flex', overflowX: 'auto', boxShadow: 'var(--shadow-sm)' }}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '14px 18px', border: 'none', background: 'none',
            fontSize: 13, fontWeight: activeTab === tab ? 600 : 400,
            color: activeTab === tab ? 'var(--ink)' : 'var(--muted)',
            cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
            borderBottom: activeTab === tab ? '2px solid var(--gold)' : '2px solid transparent',
            marginBottom: -1, transition: 'color .15s',
          }}>{tab}</button>
        ))}
      </div>

      {/* Content */}
      <main style={{ flex: 1, maxWidth: 920, width: '100%', margin: '0 auto', padding: '0 32px 48px', boxSizing: 'border-box' }}>
        {loading ? (
          <div className="empty"><div className="empty-icon">⏳</div><h3>Loading your portal…</h3></div>
        ) : (
          <>
            {activeTab === 'Overview'    && <OverviewTab me={me} goals={goals} activities={activities} invoices={invoices} />}
            {activeTab === 'Goals'       && <GoalsTab goals={goals} commitments={commitments} onProgressSaved={(goalId, entry) => setGoals(prev => prev.map(g => g.id === goalId ? { ...g, progress_entries: [entry, ...g.progress_entries], progress_count: g.progress_count + 1 } : g))} />}
            {activeTab === 'Activities'  && <ActivitiesTab activities={activities} onUpdate={(id, p) => setActivities(prev => prev.map(a => a.id === id ? { ...a, ...p } : a))} />}
            {activeTab === 'Notes'       && <NotesTab notes={notes} setNotes={setNotes} />}
            {activeTab === 'Files'       && <FilesTab materials={materials} />}
            {activeTab === 'Invoices'    && <InvoicesTab invoices={invoices} />}
          </>
        )}
      </main>

      <footer style={{ textAlign: 'center', padding: '20px 24px', color: 'var(--muted-faint)', fontSize: 11, borderTop: '1px solid var(--border)' }}>
        Powered by CoachOS
      </footer>
    </div>
  )
}
