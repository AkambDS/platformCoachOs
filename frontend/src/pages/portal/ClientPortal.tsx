/**
 * CoachOS — Client Portal
 * Standalone page — no AppShell. Uses CoachOS CSS design system.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import axios from 'axios'
import {
  LayoutDashboard, Target, CalendarDays, StickyNote, Folder, Receipt, LogOut,
  FileSpreadsheet, FileText, FileImage, Film, Link as LinkIcon, File as FileIcon, Download,
} from 'lucide-react'
import { useInactivityTimer } from '../../hooks/useInactivityTimer'
import InactivityWarningModal from '../../components/InactivityWarningModal'
import { InlineOfficeViewer } from '../../components/OfficeEditor'
import { useToast } from '../../components/ui'

const BASE = import.meta.env.VITE_API_BASE_URL || ''

const api = axios.create({ baseURL: BASE, headers: { 'Content-Type': 'application/json' } })
api.interceptors.request.use(cfg => {
  const tok = localStorage.getItem('portal_token')
  if (tok) cfg.headers['Authorization'] = `Bearer ${tok}`
  return cfg
})

// ── Types ─────────────────────────────────────────────────────────────────────
interface Session { token: string; client_name: string; workspace_name: string; coach_name: string }
interface Branding { name: string; logo_url: string; primary_colour: string }
interface GoalProgress { id: string; progress_text: string; created_at: string }
interface Goal { id: string; title: string; description: string; target_date: string | null; status: string; progress_count: number; progress_entries: GoalProgress[]; client_owned?: boolean; created_by_name?: string | null }
interface Commitment { id: string; text: string; created_at: string }
interface Activity { id: string; title: string; activity_type: string; status: string; start_at: string; end_at: string | null; location: string; meeting_link: string; coach_name: string }
interface InvoiceItem { description: string; quantity: string; unit_price: string; line_total: string }
interface Invoice { id: string; number: string; status: string; total: string; amount_paid: string; due_date: string | null; stripe_payment_link: string; created_at: string; items: InvoiceItem[] }
// content_type/presigned_url/inline_url/file_name match KnowledgeItemSerializer's actual
// field names exactly (apps/library/serializers.py) — this used to say item_type/file_url,
// which don't exist on that serializer at all, so the "download" link and real file-type
// badge silently never rendered (fell back to undefined → always "file"/nothing to click).
interface Material { id: string; title: string; content_type: string; file_name?: string; presigned_url?: string; inline_url?: string; url?: string; video_url?: string }
interface Note { id: string; text: string; note_type: string; topic?: string | null; session_date?: string | null; created_by_name: string | null; client_owned: boolean; created_at: string; updated_at: string }
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
function isUpcoming(iso: string) { return new Date(iso) > new Date() }

// ── Note date-key helpers — mirrors the coach side's Notes explorer (ClientDetail.tsx)
// so notes group/sort/display the same way here. Duplicated rather than imported since
// the portal is a standalone bundle with no other dependency on coach-only pages.
function todayISO(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
// The calendar day a note is grouped/sorted/searched under — session date if set,
// else the date it was written.
function noteDateKey(n: Note): string {
  return n.session_date || n.created_at?.slice(0, 10) || ''
}
function dayKeyToDate(key: string): Date {
  return new Date(`${key}T12:00:00`)
}
function fmtDayKey(key: string): string {
  if (!key) return '—'
  return dayKeyToDate(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function noteDateGroupLabel(key: string): string {
  if (key === todayISO()) return 'Today'
  const y = new Date(); y.setDate(y.getDate() - 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (key === `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`) return 'Yesterday'
  return fmtDayKey(key)
}
// Sorted newest-day-first, then grouped under Today/Yesterday/date headers.
function groupNotesByDate(notes: Note[]): { label: string; notes: Note[] }[] {
  const sorted = [...notes].sort((a, b) => {
    const ka = noteDateKey(a), kb = noteDateKey(b)
    return ka === kb ? 0 : ka < kb ? 1 : -1
  })
  const map = new Map<string, Note[]>()
  for (const n of sorted) {
    const label = noteDateGroupLabel(noteDateKey(n))
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(n)
  }
  return Array.from(map, ([label, notes]) => ({ label, notes }))
}

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
// Two-step: request-code (email only, always a generic ack) then login (email +
// the 6-digit code that was emailed) — a client can no longer get a session token
// from an email address alone, only by also proving they received that email.
function LoginScreen({ branding, onLogin }: { branding: Branding | null; onLogin: (d: Session) => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const { data } = await axios.post(`${BASE}/api/portal/request-code/`, { email })
      setInfo(data?.detail || 'If that email has portal access, a login code has been sent.')
      setStep('code')
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Something went wrong. Please try again.')
    } finally { setLoading(false) }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const { data } = await axios.post(`${BASE}/api/portal/login/`, { email, code })
      localStorage.setItem('portal_token', data.token)
      localStorage.setItem('portal_client_name', data.client_name)
      localStorage.setItem('portal_workspace_name', data.workspace_name)
      localStorage.setItem('portal_coach_name', data.coach_name)
      onLogin(data)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'That code is invalid or has expired.')
    } finally { setLoading(false) }
  }

  const wsName = branding?.name || 'CoachOS'
  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '13px 14px', fontSize: 14,
    fontFamily: "'DM Sans', sans-serif", border: '1px solid var(--border)', borderRadius: 6,
    background: '#fff', color: 'var(--ink)', marginBottom: 18,
  }
  const btnStyle: React.CSSProperties = {
    width: '100%', padding: 13, background: 'var(--navy)', color: 'var(--paper)', border: 'none',
    borderRadius: 6, fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8,
  }

  return (
    <div style={{ minHeight: '100vh', width: '100%', background: 'var(--paper)', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
      <style>{'@media (max-width: 900px) { .portal-login-divider { display: none; } .portal-login-left { text-align: center; align-items: center !important; } .portal-login-word { display: none; } }'}</style>

      {/* oversized background word — real texture, fills the page instead of leaving it bare */}
      <span aria-hidden="true" className="portal-login-word" style={{
        position: 'absolute', top: '50%', left: '38%', transform: 'translate(-50%, -54%)',
        fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, fontStyle: 'italic',
        fontSize: 'min(26vw, 400px)', lineHeight: 1, color: 'var(--navy)', opacity: 0.028,
        whiteSpace: 'nowrap', userSelect: 'none', pointerEvents: 'none', zIndex: 0,
      }}>progress</span>

      {/* masthead */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '40px 48px 0', position: 'relative', zIndex: 1 }}>
        {branding?.logo_url ? (
          <img src={branding.logo_url} alt={wsName} style={{ maxHeight: 72, maxWidth: 300, objectFit: 'contain' }} />
        ) : (
          <>
            <div style={{ width: 68, height: 68, borderRadius: 12, background: 'var(--navy)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, fontSize: 32, color: 'var(--gold-light)' }}>{wsName.charAt(0)}</span>
            </div>
            <span style={{ fontSize: 16, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 600 }}>{wsName}</span>
          </>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', width: '100%', maxWidth: 1180, margin: '0 auto', boxSizing: 'border-box', position: 'relative', zIndex: 1 }}>

        {/* LEFT — editorial column: what the portal actually gives the client */}
        <div className="portal-login-left" style={{ flex: '1 1 480px', minWidth: 320, padding: '64px 56px 64px 48px', boxSizing: 'border-box', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
          <span aria-hidden="true" style={{ position: 'absolute', top: -56, left: 28, fontFamily: "'Cormorant Garamond', serif", fontSize: 380, lineHeight: 1, color: 'var(--navy)', opacity: 0.07, userSelect: 'none', pointerEvents: 'none' }}>&ldquo;</span>

          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', maxWidth: 460 }}>
            <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 400, fontSize: 40, lineHeight: 1.22, color: 'var(--ink)', margin: '0 0 16px' }}>
              A quiet place to keep up with your own progress.
            </h1>
            <p style={{ fontSize: 14.5, color: 'var(--muted)', lineHeight: 1.65, margin: '0 0 28px', maxWidth: 400 }}>
              Everything from your coaching program — goals, notes, and what's next — stays in one workspace between sessions.
            </p>

            <div style={{ width: 36, height: 2, background: 'var(--gold)', marginBottom: 28 }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
                <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 15, color: 'var(--gold)', fontWeight: 600, flexShrink: 0, width: 20 }}>01</span>
                <span style={{ fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.5 }}>Goals you can actually see move, logged between sessions</span>
              </div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
                <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 15, color: 'var(--gold)', fontWeight: 600, flexShrink: 0, width: 20 }}>02</span>
                <span style={{ fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.5 }}>Every session's notes, kept in order and easy to find</span>
              </div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
                <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 15, color: 'var(--gold)', fontWeight: 600, flexShrink: 0, width: 20 }}>03</span>
                <span style={{ fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.5 }}>Resources your coach hands you, always on hand</span>
              </div>
            </div>
          </div>
        </div>

        <div className="portal-login-divider" style={{ width: 1, alignSelf: 'stretch', margin: '72px 0', background: 'var(--border)' }} />

        {/* RIGHT — the actual sign-in card */}
        <div style={{ flex: '1 1 380px', minWidth: 320, padding: '48px 48px 64px 56px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: 380 }}>

            <div style={{ background: '#fff', border: '1px solid var(--cream)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 2px rgba(26,23,20,0.04), 0 16px 40px rgba(26,23,20,0.07)' }}>
              <div style={{ height: 3, background: 'linear-gradient(90deg, var(--gold), var(--gold-light) 50%, var(--gold))' }} />
              <div style={{ padding: '40px 36px 36px' }}>
                <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 400, fontSize: 27, color: 'var(--ink)', margin: '0 0 8px' }}>Client Portal</h2>

                {step === 'email' ? (
                  <>
                    <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '0 0 28px', lineHeight: 1.6 }}>Enter your email and we'll send a one-time code to sign in.</p>
                    <form onSubmit={submitEmail}>
                      <label htmlFor="portal-email" style={labelStyle}>Email address</label>
                      <input id="portal-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus style={inputStyle} />
                      {error && <div style={{ fontSize: 12.5, color: '#b3261e', marginBottom: 12 }}>{error}</div>}
                      <button type="submit" disabled={loading} style={btnStyle}>
                        {loading ? 'Sending…' : 'Send login code'}
                      </button>
                    </form>
                    <p style={{ marginTop: 18, fontSize: 12, color: 'var(--muted-faint)', lineHeight: 1.6 }}>
                      You'll need an invitation from your coach to access this portal.
                    </p>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '0 0 28px', lineHeight: 1.6 }}>{info || `Enter the 6-digit code we emailed to ${email}`}</p>
                    <form onSubmit={submitCode}>
                      <label htmlFor="portal-code" style={labelStyle}>Login code</label>
                      <input
                        id="portal-code" type="text" inputMode="numeric" pattern="[0-9]*"
                        maxLength={6} value={code}
                        onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="123456" required autoFocus
                        style={{ ...inputStyle, letterSpacing: '0.3em', textAlign: 'center', fontSize: 20 }}
                      />
                      {error && <div style={{ fontSize: 12.5, color: '#b3261e', marginBottom: 12 }}>{error}</div>}
                      <button type="submit" disabled={loading || code.length !== 6} style={btnStyle}>
                        {loading ? 'Verifying…' : 'Access my portal'}
                      </button>
                    </form>
                    <p style={{ marginTop: 18, fontSize: 12, color: 'var(--muted-faint)', lineHeight: 1.6 }}>
                      Didn't get it? Check spam, or{' '}
                      <button
                        type="button"
                        onClick={() => { setStep('email'); setCode(''); setError('') }}
                        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--gold)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
                      >
                        use a different email
                      </button>.
                    </p>
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 24 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted-faint)" strokeWidth="2" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
              <span style={{ fontSize: 11.5, color: 'var(--muted-faint)' }}>Visible only to you and your coach</span>
            </div>
          </div>
        </div>

      </div>

      {/* footer — anchors the bottom of the page instead of leaving it bare */}
      <div style={{ textAlign: 'center', padding: '28px 24px 32px', position: 'relative', zIndex: 1 }}>
        <span style={{ fontSize: 11.5, color: 'var(--muted-faint)' }}>Powered by CoachOS</span>
      </div>
    </div>
  )
}

// ── Overview ──────────────────────────────────────────────────────────────────
function OverviewTab({ me, goals, activities, invoices }: { me: MeData | null; goals: Goal[]; activities: Activity[]; invoices: Invoice[] }) {
  const now = new Date()
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  // Next 5 upcoming sessions, soonest first.
  const upcoming = activities
    .filter(a => (a.status === 'scheduled' || a.status === 'rescheduled') && isUpcoming(a.start_at))
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    .slice(0, 5)

  // Active goals with a due date, soonest (or most overdue) first — plain string
  // comparison on the 'YYYY-MM-DD' value, no Date() parsing (see the overdue check
  // below for why that matters for a date-only string).
  const goalsDue = goals
    .filter(g => g.status === 'active' && g.target_date)
    .sort((a, b) => (a.target_date! < b.target_date! ? -1 : a.target_date! > b.target_date! ? 1 : 0))

  // Outstanding invoices due within the next 30 days — always includes anything
  // already overdue, regardless of how long ago it was due.
  const unpaidInvoices = invoices.filter(i => i.status !== 'paid')
  const outstandingThisMonth = unpaidInvoices
    .filter(i => !i.due_date || new Date(i.due_date) <= in30Days)
    .sort((a, b) => {
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
    })
  const totalOwedThisMonth = outstandingThisMonth.reduce((s, i) => s + parseFloat(i.total) - parseFloat(i.amount_paid), 0)

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
          { label: 'Goals Due',         value: goalsDue.length, color: 'var(--success)' },
          { label: 'Due This Month',    value: totalOwedThisMonth > 0 ? `$${totalOwedThisMonth.toFixed(2)}` : '—', color: totalOwedThisMonth > 0 ? 'var(--warn)' : 'var(--muted)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '20px 24px', borderTop: `3px solid ${s.color}` }}>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 36, fontWeight: 400, color: s.color, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 6 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Three parallel columns — upcoming sessions, goals due, outstanding invoices — all visible at once */}
      {(upcoming.length > 0 || goalsDue.length > 0 || outstandingThisMonth.length > 0) && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, alignItems: 'start' }}>

        {/* Upcoming sessions */}
        <div className="card">
          <div className="card-hdr">Upcoming Sessions</div>
          {upcoming.length === 0 ? (
            <div style={{ padding: '24px 20px', fontSize: 12.5, color: 'var(--muted)' }}>Nothing scheduled.</div>
          ) : (
            <div>
              {upcoming.map((a, i) => (
                <div key={a.id} style={{ padding: '14px 20px', borderBottom: i < upcoming.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>{a.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{fmtDT(a.start_at)}</div>
                  {a.meeting_link && (
                    <a href={a.meeting_link} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm" style={{ marginTop: 10, display: 'inline-block' }}>Join</a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Goals due */}
        <div className="card">
          <div className="card-hdr">Goals Due</div>
          {goalsDue.length === 0 ? (
            <div style={{ padding: '24px 20px', fontSize: 12.5, color: 'var(--muted)' }}>No goals with a due date.</div>
          ) : (
            <div>
              {goalsDue.map((g, i) => {
                // Plain string comparison on 'YYYY-MM-DD' keys — avoids the timezone
                // bug of parsing a date-only string through `new Date(...)`, which
                // reads it as UTC midnight and can roll it back a day in negative-UTC
                // timezones (so a goal due "today" would wrongly show as overdue).
                const overdue = g.target_date! < todayISO()
                return (
                  <div key={g.id} style={{ padding: '14px 20px', borderBottom: i < goalsDue.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>{g.title}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                      <Pill status={overdue ? 'overdue' : 'scheduled'} />
                      <span style={{ fontSize: 12, color: overdue ? '#b3261e' : 'var(--muted)', fontWeight: overdue ? 600 : 400 }}>
                        {overdue ? 'Was due' : 'Due'} {fmtDayKey(g.target_date!)}
                      </span>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
                      {g.progress_count} update{g.progress_count === 1 ? '' : 's'}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Outstanding invoices (next 30 days) */}
        <div className="card">
          <div className="card-hdr">Outstanding This Month</div>
          {outstandingThisMonth.length === 0 ? (
            <div style={{ padding: '24px 20px', fontSize: 12.5, color: 'var(--muted)' }}>Nothing outstanding.</div>
          ) : (
            <div>
              {outstandingThisMonth.map((inv, i) => {
                const status = clientStatus(inv)
                const dueLabel = inv.due_date ? `${status === 'overdue' ? 'Was due' : 'Due'} ${fmtDate(inv.due_date)}` : null
                return (
                  <div key={inv.id} style={{ padding: '14px 20px', borderBottom: i < outstandingThisMonth.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>#{inv.number}</span>
                      <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 17, color: 'var(--ink)' }}>${parseFloat(inv.total).toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                      <Pill status={status} />
                      {dueLabel && (
                        <span style={{ fontSize: 12, color: status === 'overdue' ? '#b3261e' : 'var(--muted)', fontWeight: status === 'overdue' ? 600 : 400 }}>{dueLabel}</span>
                      )}
                    </div>
                    {inv.stripe_payment_link && (
                      <a href={inv.stripe_payment_link} target="_blank" rel="noopener noreferrer" className="btn btn-dark btn-sm" style={{ marginTop: 10, display: 'inline-block' }}>Pay Now</a>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>
      )}

      {upcoming.length === 0 && goalsDue.length === 0 && outstandingThisMonth.length === 0 && (
        <div className="empty" style={{ paddingTop: 40 }}>
          <div className="empty-icon">✨</div>
          <h3>You're all caught up</h3>
          <p>No upcoming sessions, goals due, or outstanding invoices.</p>
        </div>
      )}
    </div>
  )
}

// ── Goals ─────────────────────────────────────────────────────────────────────
// Date-grouping for the goals explorer — same structural pattern as the Notes
// explorer's groupNotesByDate, but keyed on target_date (every goal requires one,
// so no created_at fallback needed) and sorted soonest-first (ascending) since a
// goal is a forward-looking deadline, not a backward-looking log entry.
function goalDateKey(g: Goal): string {
  return g.target_date || ''
}
function goalDateGroupLabel(key: string): string {
  if (!key) return 'No target date'
  const today = todayISO()
  if (key === today) return 'Today'
  const d = new Date(); d.setDate(d.getDate() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  const tomorrow = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (key === tomorrow) return 'Tomorrow'
  if (key < today) return `Overdue — ${fmtDayKey(key)}`
  return fmtDayKey(key)
}
function groupGoalsByDate(goals: Goal[]): { label: string; goals: Goal[] }[] {
  const sorted = [...goals].sort((a, b) => {
    const ka = goalDateKey(a), kb = goalDateKey(b)
    return ka === kb ? 0 : ka < kb ? -1 : 1
  })
  const map = new Map<string, Goal[]>()
  for (const g of sorted) {
    const label = goalDateGroupLabel(goalDateKey(g))
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(g)
  }
  return Array.from(map, ([label, goals]) => ({ label, goals }))
}

function GoalsTab({ goals, setGoals, commitments, showToast, onProgressSaved }: {
  goals: Goal[]; setGoals: React.Dispatch<React.SetStateAction<Goal[]>>; commitments: Commitment[]
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
  onProgressSaved: (goalId: string, entry: GoalProgress) => void
}) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  // New-goal compose form
  const [newTitle, setNewTitle]             = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newTargetDate, setNewTargetDate]   = useState('')
  const [creating, setCreating]             = useState(false)

  // Collapsed by default — same as the Notes explorer; a click expands a row,
  // nothing auto-opens.
  const [expandedId, setExpandedId]         = useState<string | null>(null)
  const [openProgressId, setOpenProgressId] = useState<string | null>(null)

  // Editing one of the client's own goals
  const [editId, setEditId]                 = useState<string | null>(null)
  const [editTitle, setEditTitle]           = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editTargetDate, setEditTargetDate] = useState('')
  const [editSaving, setEditSaving]         = useState(false)

  const [searchTitle, setSearchTitle] = useState('')
  const [searchDate, setSearchDate]   = useState('')

  const hasSearch = !!(searchTitle.trim() || searchDate)
  const filteredGoals = useMemo(() => {
    if (!hasSearch) return goals
    const q = searchTitle.trim().toLowerCase()
    return goals.filter(g => {
      if (q && !g.title.toLowerCase().includes(q)) return false
      if (searchDate && goalDateKey(g) !== searchDate) return false
      return true
    })
  }, [goals, searchTitle, searchDate, hasSearch])

  useEffect(() => {
    if (expandedId && !goals.some(g => g.id === expandedId)) setExpandedId(null)
  }, [goals, expandedId])

  async function saveProgress(goalId: string) {
    if (!text.trim()) return
    setSaving(true)
    try {
      const { data } = await api.post(`/api/portal/goals/${goalId}/progress/`, { progress_text: text })
      onProgressSaved(goalId, data); setText(''); setOpenProgressId(null)
      showToast('Progress saved')
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to save progress', 'error')
    } finally { setSaving(false) }
  }

  async function createGoal() {
    if (!newTitle.trim() || !newTargetDate) return
    setCreating(true)
    try {
      const { data } = await api.post('/api/portal/goals/', {
        title: newTitle, description: newDescription, target_date: newTargetDate,
      })
      setGoals(prev => [data, ...prev])
      setNewTitle(''); setNewDescription(''); setNewTargetDate('')
      showToast('Goal added')
    } catch (err: any) {
      showToast(err?.response?.data?.detail || err?.response?.data?.target_date?.[0] || 'Failed to save goal', 'error')
    } finally { setCreating(false) }
  }

  function startEdit(g: Goal) {
    setEditId(g.id); setEditTitle(g.title); setEditDescription(g.description || ''); setEditTargetDate(g.target_date || '')
  }
  function cancelEdit() {
    setEditId(null); setEditTitle(''); setEditDescription(''); setEditTargetDate('')
  }

  async function saveEdit(goalId: string) {
    if (!editTitle.trim() || !editTargetDate) return
    setEditSaving(true)
    try {
      const { data } = await api.patch(`/api/portal/goals/${goalId}/`, {
        title: editTitle, description: editDescription, target_date: editTargetDate,
      })
      setGoals(prev => prev.map(g => g.id === goalId ? { ...g, ...data } : g))
      cancelEdit()
      showToast('Goal updated')
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to update goal', 'error')
    } finally { setEditSaving(false) }
  }

  async function deleteGoal(goalId: string) {
    if (!confirm('Delete this goal?')) return
    try {
      await api.delete(`/api/portal/goals/${goalId}/`)
      setGoals(prev => prev.filter(g => g.id !== goalId))
      showToast('Goal deleted')
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to delete goal', 'error')
    }
  }

  return (
    <div>
      <div style={{ padding: '24px 0 20px' }}>
        <h1 className="page-title">Your Goals</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Goals your coach set with you, plus any you set for yourself.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24, alignItems: 'start' }}>

        {/* Left — set your own goal */}
        <div className="card" style={{ position: 'sticky', top: 80 }}>
          <div className="card-hdr"><span>NEW GOAL</span></div>
          <div className="card-body">
            <label style={microLabelStyle}>Title</label>
            <input type="text" className="finput" value={newTitle} onChange={e => setNewTitle(e.target.value)}
              placeholder="e.g. Run a 10k" style={{ marginBottom: 10 }} />
            <label style={microLabelStyle}>Target date</label>
            <input type="date" className="finput" value={newTargetDate} onChange={e => setNewTargetDate(e.target.value)}
              style={{ marginBottom: 10 }} />
            <label style={microLabelStyle}>Notes (optional)</label>
            <textarea className="finput" value={newDescription} onChange={e => setNewDescription(e.target.value)}
              rows={4} placeholder="Any detail you want to add…" style={{ resize: 'vertical', marginBottom: 12 }} />
            <button className="btn btn-dark" style={{ width: '100%' }} onClick={createGoal}
              disabled={creating || !newTitle.trim() || !newTargetDate}>
              {creating ? 'SAVING…' : 'SAVE GOAL'}
            </button>
          </div>
        </div>

        {/* Right — goals explorer: searchable by title/date, grouped by target
            date, collapsed by default — mirrors the Notes explorer. */}
        <div>
          {goals.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: '1 1 auto' }}>
                  <label style={microLabelStyle}>Search by title</label>
                  <input type="text" className="finput" placeholder="e.g. 10k" value={searchTitle}
                    onChange={e => setSearchTitle(e.target.value)} style={{ width: '100%' }} />
                </div>
                <div style={{ flexShrink: 0, width: 160 }}>
                  <label style={microLabelStyle}>Search by target date</label>
                  <input type="date" className="finput" value={searchDate}
                    onChange={e => setSearchDate(e.target.value)} style={{ width: '100%' }} />
                </div>
              </div>
              {hasSearch && (
                <button className="btn btn-outline btn-sm" style={{ marginTop: 6 }}
                  onClick={() => { setSearchTitle(''); setSearchDate('') }}>
                  Clear search
                </button>
              )}
            </div>
          )}

          {!goals.length && !commitments.length ? (
            <div className="empty"><div className="empty-icon">🎯</div><h3>No goals yet</h3><p>Write your first goal on the left, or your coach will add one here.</p></div>
          ) : goals.length > 0 && filteredGoals.length === 0 ? (
            <div className="empty"><div className="empty-icon">🎯</div><h3>No matching goals</h3><p>Try a different title or date.</p></div>
          ) : (
            <>
              <div style={{ fontSize: 18, fontFamily: "'Cormorant Garamond', serif", fontWeight: 400, color: 'var(--ink)', marginBottom: 16 }}>
                Your Goals <span style={{ color: 'var(--muted)', fontSize: 14 }}>{filteredGoals.length}</span>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--white)', marginBottom: 16 }}>
                {groupGoalsByDate(filteredGoals).map(group => (
                  <div key={group.label}>
                    <div style={{
                      padding: '6px 16px', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                      color: 'var(--muted)', background: 'var(--paper)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
                    }}>
                      {group.label}
                    </div>
                    {group.goals.map(g => {
                      const isExpanded = expandedId === g.id
                      const isEditing  = editId === g.id
                      const isLoggingProgress = openProgressId === g.id

                      return (
                        <div key={g.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          {/* Row header — click to expand/collapse */}
                          <div onClick={() => setExpandedId(isExpanded ? null : g.id)}
                            style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', gap: 8, background: isExpanded ? 'var(--paper)' : 'transparent' }}>
                            <span style={{
                              fontSize: 9, color: 'var(--muted)', marginTop: 3, flexShrink: 0,
                              display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s',
                            }}>▸</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {g.title}
                                </span>
                                <Pill status={g.status} />
                              </div>
                              {!isExpanded && (
                                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                                  {g.client_owned ? 'Your goal' : `From ${g.created_by_name || 'your coach'}`} · {g.progress_count} update{g.progress_count === 1 ? '' : 's'}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Expanded preview / edit / progress */}
                          {isExpanded && (
                            <div style={{ padding: '0 16px 16px 32px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span className="pill" style={{ fontSize: 9 }}>
                                    {g.client_owned ? 'Your goal' : `From ${g.created_by_name || 'your coach'}`}
                                  </span>
                                  {g.target_date && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Target: {fmtDayKey(g.target_date)}</span>}
                                </div>
                                {g.client_owned && !isEditing && (
                                  <div style={{ display: 'flex', gap: 2 }}>
                                    <button onClick={() => startEdit(g)}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '3px 8px', fontSize: 12 }}>
                                      Edit
                                    </button>
                                    <button onClick={() => deleteGoal(g.id)}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 6px', color: 'var(--muted)', fontSize: 17, lineHeight: 1 }}>
                                      ×
                                    </button>
                                  </div>
                                )}
                              </div>

                              {isEditing ? (
                                <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 14px', marginBottom: 12 }}>
                                  <label style={microLabelStyle}>Title</label>
                                  <input type="text" className="finput" value={editTitle} onChange={e => setEditTitle(e.target.value)} style={{ marginBottom: 10 }} />
                                  <label style={microLabelStyle}>Target date</label>
                                  <input type="date" className="finput" value={editTargetDate} onChange={e => setEditTargetDate(e.target.value)} style={{ marginBottom: 10 }} />
                                  <label style={microLabelStyle}>Notes</label>
                                  <textarea className="finput" value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={3} style={{ resize: 'vertical', marginBottom: 12 }} />
                                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                    <button className="btn btn-outline btn-sm" onClick={cancelEdit}>Cancel</button>
                                    <button className="btn btn-dark btn-sm" onClick={() => saveEdit(g.id)} disabled={editSaving || !editTitle.trim() || !editTargetDate}>
                                      {editSaving ? 'Saving…' : 'Save'}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                g.description && <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 12 }}>{g.description}</p>
                              )}

                              <button className={`btn btn-sm ${isLoggingProgress ? 'btn-outline' : 'btn-dark'}`}
                                onClick={() => { setOpenProgressId(isLoggingProgress ? null : g.id); setText('') }}
                                style={{ marginBottom: 12 }}>
                                {isLoggingProgress ? 'Cancel' : '+ Progress'}
                              </button>

                              {isLoggingProgress && (
                                <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 14px', marginBottom: 12 }}>
                                  <label style={microLabelStyle}>Progress Update</label>
                                  <textarea className="finput" value={text} onChange={e => setText(e.target.value)} rows={3} autoFocus placeholder="Describe your progress…" style={{ resize: 'vertical', marginBottom: 10 }} />
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
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </>
          )}

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
      </div>
    </div>
  )
}

// ── Activities ────────────────────────────────────────────────────────────────
type ActivityFilter = 'Upcoming' | 'Scheduled' | 'Completed' | 'Cancelled' | 'Missed'
const ACTIVITY_FILTERS: ActivityFilter[] = ['Upcoming', 'Scheduled', 'Completed', 'Cancelled', 'Missed']

// Hoisted to module scope (not nested inside ActivitiesTab) so its component identity
// stays stable across re-renders — when it was defined inline, every keystroke in the
// reschedule textarea re-created this function, forcing React to unmount/remount the
// whole card (and its textarea) on every character, which reset the cursor to the start
// and made typed text appear to build up backwards.
function ActivityCard({ a, reschedId, setReschedId, msg, setMsg, saving, sendReschedule }: {
  a: Activity; reschedId: string | null; setReschedId: (id: string | null) => void
  msg: string; setMsg: (m: string) => void; saving: boolean; sendReschedule: (id: string) => void
}) {
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
            {reschedId === a.id ? 'Close' : 'Reschedule'}
          </button>
        )}
      </div>
      {(a.location || a.meeting_link || a.coach_name) && (
        <div style={{ padding: '8px 20px 14px', borderTop: '1px solid var(--cream)', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {a.coach_name  && <span style={{ fontSize: 12, color: 'var(--muted)' }}>👤 {a.coach_name}</span>}
          {a.location    && <span style={{ fontSize: 12, color: 'var(--muted)' }}>📍 {a.location}</span>}
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

function ActivitiesTab({ activities, onUpdate, onRefresh }: { activities: Activity[]; onUpdate: (id: string, p: Partial<Activity>) => void; onRefresh: () => void }) {
  const [filter, setFilter]     = useState<ActivityFilter>('Upcoming')
  const [reschedId, setReschedId] = useState<string | null>(null)
  const [msg, setMsg]           = useState('')
  const [saving, setSaving]     = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => { onRefresh() }, []) // eslint-disable-line

  async function sendReschedule(id: string) {
    setSaving(true)
    try {
      await api.post(`/api/portal/activities/${id}/respond/`, { action: 'reschedule_request', message: msg })
      onUpdate(id, { status: 'rescheduled' }); setReschedId(null); setMsg('')
    } catch { } finally { setSaving(false) }
  }

  async function handleRefresh() {
    setRefreshing(true)
    try { onRefresh() } finally { setRefreshing(false) }
  }

  const filtered = activities.filter(a => {
    if (filter === 'Upcoming')   return isUpcoming(a.start_at) && !['cancelled', 'missed'].includes(a.status)
    if (filter === 'Scheduled')  return a.status === 'scheduled' || a.status === 'rescheduled'
    if (filter === 'Completed')  return a.status === 'completed'
    if (filter === 'Cancelled')  return a.status === 'cancelled'
    if (filter === 'Missed')     return a.status === 'missed'
    return true
  })

  return (
    <div>
      <div style={{ padding: '24px 0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 className="page-title">Sessions &amp; Activities</h1>
        <button onClick={handleRefresh} disabled={refreshing} className="btn btn-outline btn-sm" style={{ fontSize: 11 }}>
          {refreshing ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {ACTIVITY_FILTERS.map(f => {
          const count = activities.filter(a => {
            if (f === 'Upcoming')  return isUpcoming(a.start_at) && !['cancelled', 'missed'].includes(a.status)
            if (f === 'Scheduled') return a.status === 'scheduled' || a.status === 'rescheduled'
            if (f === 'Completed') return a.status === 'completed'
            if (f === 'Cancelled') return a.status === 'cancelled'
            if (f === 'Missed')    return a.status === 'missed'
            return true
          }).length
          return (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '5px 14px', borderRadius: 20, border: '1px solid',
              borderColor: filter === f ? 'var(--ink)' : 'var(--border)',
              background: filter === f ? 'var(--ink)' : '#fff',
              color: filter === f ? '#fff' : 'var(--muted)',
              fontSize: 12, fontWeight: filter === f ? 600 : 400,
              cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
            }}>
              {f} {count > 0 && <span style={{ opacity: 0.7 }}>({count})</span>}
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="empty"><div className="empty-icon">📅</div><h3>No {filter.toLowerCase()} sessions</h3></div>
      ) : (
        filtered.map(a => (
          <ActivityCard
            key={a.id}
            a={a}
            reschedId={reschedId}
            setReschedId={setReschedId}
            msg={msg}
            setMsg={setMsg}
            saving={saving}
            sendReschedule={sendReschedule}
          />
        ))
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

// ── Notes Tab ─────────────────────────────────────────────────────────────────
const microLabelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
  color: 'var(--muted)', display: 'block', marginBottom: 4,
}

function NotesTab({ notes, setNotes, showToast }: {
  notes: Note[]; setNotes: React.Dispatch<React.SetStateAction<Note[]>>
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
}) {
  const [draft, setDraft]             = useState('')
  const [topic, setTopic]             = useState('')
  const [sessionDate, setSessionDate] = useState(todayISO())
  const [saving, setSaving]           = useState(false)

  // Collapsed by default — same as the coach side's Notes explorer; nothing
  // auto-opens, a click expands a row.
  const [expandedId, setExpandedId]       = useState<string | null>(null)
  const [editId, setEditId]               = useState<string | null>(null)
  const [editText, setEditText]           = useState('')
  const [editTopic, setEditTopic]         = useState('')
  const [editSessionDate, setEditSessionDate] = useState('')

  const [searchTopic, setSearchTopic] = useState('')
  const [searchDate, setSearchDate]   = useState('')

  const hasSearch = !!(searchTopic.trim() || searchDate)
  const filteredNotes = useMemo(() => {
    if (!hasSearch) return notes
    const q = searchTopic.trim().toLowerCase()
    return notes.filter(n => {
      if (q && !(n.topic || '').toLowerCase().includes(q)) return false
      if (searchDate && noteDateKey(n) !== searchDate) return false
      return true
    })
  }, [notes, searchTopic, searchDate, hasSearch])

  useEffect(() => {
    if (expandedId && !notes.some(n => n.id === expandedId)) setExpandedId(null)
  }, [notes, expandedId])

  async function createNote() {
    if (!draft.trim()) return
    setSaving(true)
    try {
      const { data } = await api.post('/api/portal/notes/', { text: draft, topic, session_date: sessionDate || null })
      setNotes(prev => [data, ...prev])
      setDraft(''); setTopic(''); setSessionDate(todayISO())
      showToast('Note added')
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to save note', 'error')
    } finally { setSaving(false) }
  }

  function startEdit(n: Note) {
    setEditId(n.id); setEditText(n.text)
    setEditTopic(n.topic || ''); setEditSessionDate(n.session_date || '')
  }
  function cancelEdit() {
    setEditId(null); setEditText(''); setEditTopic(''); setEditSessionDate('')
  }

  async function updateNote(id: string) {
    if (!editText.trim()) return
    try {
      const { data } = await api.patch(`/api/portal/notes/${id}/`, {
        text: editText, topic: editTopic, session_date: editSessionDate || null,
      })
      setNotes(prev => prev.map(n => n.id === id ? data : n))
      cancelEdit()
      showToast('Note updated')
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to update note', 'error')
    }
  }

  async function deleteNote(id: string) {
    if (!confirm('Delete this note?')) return
    try {
      await api.delete(`/api/portal/notes/${id}/`)
      setNotes(prev => prev.filter(n => n.id !== id))
      showToast('Note deleted')
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to delete note', 'error')
    }
  }

  const notePreview = (n: Note) => {
    const parsed = parseStructured(n.text)
    if (parsed) return parsed.notes?.trim() || parsed.reflection?.trim() || 'Note'
    return n.text.slice(0, 80)
  }

  return (
    <div>
      <div style={{ padding: '24px 0 20px' }}>
        <h1 className="page-title">Session Notes</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Shared between you and your coach only.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24, alignItems: 'start' }}>

        {/* Left — new note form */}
        <div className="card" style={{ position: 'sticky', top: 80 }}>
          <div className="card-hdr"><span>NEW NOTE</span></div>
          <div className="card-body">
            <label style={microLabelStyle}>Topic</label>
            <input type="text" className="finput" value={topic} onChange={e => setTopic(e.target.value)}
              placeholder="What's this about? (optional)" style={{ marginBottom: 10 }} />
            <label style={microLabelStyle}>Date</label>
            <input type="date" className="finput" value={sessionDate} onChange={e => setSessionDate(e.target.value)}
              style={{ marginBottom: 10 }} />
            <label style={microLabelStyle}>Notes</label>
            <textarea
              className="finput"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="Write your note here…"
              rows={8}
              style={{ resize: 'vertical', marginBottom: 12 }}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) createNote() }}
            />
            <button className="btn btn-dark" style={{ width: '100%' }} onClick={createNote} disabled={saving || !draft.trim()}>
              {saving ? 'SAVING…' : 'SAVE NOTE'}
            </button>
            <p style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 8 }}>⌘ + Enter to save</p>
          </div>
        </div>

        {/* Right — notes explorer: searchable by topic/date, grouped by date,
            collapsed by default — mirrors the coach side's Notes explorer. */}
        <div>
          {notes.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: '1 1 auto' }}>
                  <label style={microLabelStyle}>Search by topic</label>
                  <input type="text" className="finput" placeholder="e.g. Weekly check-in" value={searchTopic}
                    onChange={e => setSearchTopic(e.target.value)} style={{ width: '100%' }} />
                </div>
                <div style={{ flexShrink: 0, width: 160 }}>
                  <label style={microLabelStyle}>Search by date</label>
                  <input type="date" className="finput" value={searchDate}
                    onChange={e => setSearchDate(e.target.value)} style={{ width: '100%' }} />
                </div>
              </div>
              {hasSearch && (
                <button className="btn btn-outline btn-sm" style={{ marginTop: 6 }}
                  onClick={() => { setSearchTopic(''); setSearchDate('') }}>
                  Clear search
                </button>
              )}
            </div>
          )}
          {notes.length === 0 ? (
            <div className="empty" style={{ paddingTop: 40 }}>
              <div className="empty-icon">📝</div>
              <h3>No notes yet</h3>
              <p>Write your first note on the left.</p>
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="empty" style={{ paddingTop: 40 }}>
              <div className="empty-icon">📝</div>
              <h3>No matching notes</h3>
              <p>Try a different topic or date.</p>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 18, fontFamily: "'Cormorant Garamond', serif", fontWeight: 400, color: 'var(--ink)', marginBottom: 16 }}>
                Session Notes <span style={{ color: 'var(--muted)', fontSize: 14 }}>{filteredNotes.length}</span>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--white)' }}>
                {groupNotesByDate(filteredNotes).map(group => (
                  <div key={group.label}>
                    <div style={{
                      padding: '6px 16px', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                      color: 'var(--muted)', background: 'var(--paper)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
                    }}>
                      {group.label}
                    </div>
                    {group.notes.map(note => {
                      const isExpanded = expandedId === note.id
                      const isEditing  = editId === note.id
                      const structured = parseStructured(note.text)

                      return (
                        <div key={note.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          {/* Row header — click to expand/collapse */}
                          <div onClick={() => setExpandedId(isExpanded ? null : note.id)}
                            style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', gap: 8, background: isExpanded ? 'var(--paper)' : 'transparent' }}>
                            <span style={{
                              fontSize: 9, color: 'var(--muted)', marginTop: 3, flexShrink: 0,
                              display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s',
                            }}>▸</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {note.topic || notePreview(note)}
                                </span>
                                <span style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtTime(note.created_at)}</span>
                              </div>
                              {!isExpanded && note.topic && (
                                <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.4, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {notePreview(note)}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Expanded preview / edit */}
                          {isExpanded && (
                            <div style={{ padding: '0 16px 16px 32px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  {note.session_date && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Session: {fmtDayKey(note.session_date)}</span>}
                                  <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{note.created_by_name ? `by ${note.created_by_name}` : 'By you'}</span>
                                </div>
                                {note.client_owned && !isEditing && (
                                  <div style={{ display: 'flex', gap: 2 }}>
                                    <button onClick={() => startEdit(note)}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '3px 8px', fontSize: 12 }}>
                                      Edit
                                    </button>
                                    <button onClick={() => deleteNote(note.id)}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 6px', color: 'var(--muted)', fontSize: 17, lineHeight: 1 }}>
                                      ×
                                    </button>
                                  </div>
                                )}
                              </div>

                              {isEditing ? (
                                <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 14px' }}>
                                  <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                                    <input type="text" className="finput" placeholder="Topic" value={editTopic}
                                      onChange={e => setEditTopic(e.target.value)} style={{ flex: '1 1 auto', fontSize: 12.5 }} />
                                    <input type="date" className="finput" value={editSessionDate}
                                      onChange={e => setEditSessionDate(e.target.value)} style={{ flexShrink: 0, width: 150, fontSize: 12.5 }} />
                                  </div>
                                  <textarea className="finput" value={editText} onChange={e => setEditText(e.target.value)}
                                    rows={5} autoFocus style={{ resize: 'vertical' }} />
                                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                                    <button className="btn btn-outline btn-sm" onClick={cancelEdit}>Cancel</button>
                                    <button className="btn btn-dark btn-sm" onClick={() => updateNote(note.id)} disabled={!editText.trim()}>Save</button>
                                  </div>
                                </div>
                              ) : (
                                <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 14px', maxHeight: 320, overflowY: 'auto' }}>
                                  {structured
                                    ? <StructuredDisplay data={structured} />
                                    : <p style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.8, whiteSpace: 'pre-wrap', margin: 0 }}>{note.text}</p>
                                  }
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Files ─────────────────────────────────────────────────────────────────────
// Same icon-by-extension/type logic as the coach-side Library (pages/coach/Library.tsx's
// getFileIcon/getFileBg) — kept as a local copy rather than a shared import since the
// portal is a standalone bundle with no other dependency on coach-only pages.
function materialIcon(item: Material, size = 20) {
  const ext = (item.file_name || '').split('.').pop()?.toLowerCase() || ''
  if (['xls', 'xlsx', 'csv'].includes(ext))                        return <FileSpreadsheet size={size} color="#1a7a3f" />
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext))                 return <FileText size={size} color="#2b5fad" />
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext))  return <FileImage size={size} color="#c9a84c" />
  if (item.content_type === 'pdf')   return <FileText size={size} color="#c0392b" />
  if (item.content_type === 'video') return <Film size={size} color="#7c4d9f" />
  if (item.content_type === 'link')  return <LinkIcon size={size} color="#2d6a9f" />
  return <FileIcon size={size} color="#8c8279" />
}
function materialBg(item: Material) {
  const ext = (item.file_name || '').split('.').pop()?.toLowerCase() || ''
  if (['xls', 'xlsx', 'csv'].includes(ext))                return '#e8f5ec'
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext))         return '#e8eef7'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return '#faf3e0'
  if (item.content_type === 'pdf')   return '#fdecea'
  if (item.content_type === 'video') return '#f3eafa'
  return '#f0eeec'
}

// Same list+preview split as the coach-side Library (pages/coach/Library.tsx), but
// view/download only — no "Edit live in browser" anywhere, and the OnlyOffice config
// this calls (GET /api/portal/materials/{id}/view-config/) is hard-coded to mode=view
// server-side (apps/portal/views.py), not just a UI omission, so a client genuinely
// cannot write back into a coach's shared file even by hand-crafting a request.
function MaterialPreviewPanel({ item }: { item: Material }) {
  const ext = (item.file_name || '').split('.').pop()?.toLowerCase() || ''
  const isImage  = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)
  const isPdf    = item.content_type === 'pdf' || ext === 'pdf'
  const isVideo  = item.content_type === 'video'
  const isOffice = ['xls', 'xlsx', 'csv', 'doc', 'docx', 'odt', 'rtf', 'ppt', 'pptx'].includes(ext)
  const hasFile  = !!item.presigned_url
  const openUrl  = item.presigned_url || item.url || item.video_url

  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ background: materialBg(item), borderRadius: 8, padding: 8, display: 'flex' }}>
          {materialIcon(item, 18)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
          {item.file_name && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{item.file_name}</div>}
        </div>
      </div>

      <div>
        {hasFile && isPdf && item.inline_url && (
          <iframe src={item.inline_url} style={{ width: '100%', height: 'max(560px, calc(100vh - 380px))', border: 'none', display: 'block' }} title={item.title} />
        )}
        {hasFile && isImage && item.inline_url && (
          <img src={item.inline_url} alt={item.title} style={{ width: '100%', maxHeight: 'max(460px, calc(100vh - 420px))', objectFit: 'contain', display: 'block', background: '#f8f8f8' }} />
        )}
        {hasFile && isVideo && item.inline_url && (
          <video src={item.inline_url} controls style={{ width: '100%', maxHeight: 'max(400px, calc(100vh - 420px))', display: 'block', background: '#000' }} />
        )}
        {hasFile && isOffice && (
          <InlineOfficeViewer
            key={`${item.id}-${item.title}`}
            itemKey={`portal-${item.id}`}
            getEditConfig={() => api.get(`/api/portal/materials/${item.id}/view-config/`).then(r => r.data)}
          />
        )}
        {item.video_url && !isVideo && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <a href={item.video_url} target="_blank" rel="noopener noreferrer" className="btn btn-dark btn-sm" style={{ width: '100%', justifyContent: 'center' }}>
              ▶ Watch Video
            </a>
          </div>
        )}
        {item.url && item.content_type === 'link' && (
          <div style={{ padding: '12px 16px' }}>
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm" style={{ width: '100%', justifyContent: 'center' }}>
              Open Link
            </a>
          </div>
        )}
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
        {hasFile && (
          <a href={item.presigned_url} target="_blank" rel="noopener noreferrer" className="btn btn-dark btn-sm" style={{ width: '100%', justifyContent: 'center', gap: 6, display: 'flex', alignItems: 'center' }}>
            <Download size={13} /> Download
          </a>
        )}
        {!hasFile && openUrl && item.content_type !== 'link' && !item.video_url && (
          <a href={openUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm" style={{ width: '100%', justifyContent: 'center' }}>Open</a>
        )}
      </div>
    </div>
  )
}

function FilesTab({ materials }: { materials: Material[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(materials[0]?.id ?? null)
  const selected = materials.find(m => m.id === selectedId) || null

  if (!materials.length) return (
    <div className="empty"><div className="empty-icon">📁</div><h3>No files shared yet</h3><p>Resources shared by your coach will appear here.</p></div>
  )
  return (
    <div>
      <div style={{ padding: '24px 0 20px' }}><h1 className="page-title">Shared Files</h1></div>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <div className="card" style={{ width: 300, flexShrink: 0 }}>
          <div className="card-body" style={{ padding: 8 }}>
            {materials.map(item => (
              <div key={item.id} onClick={() => setSelectedId(item.id)} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 10px',
                borderRadius: 6, cursor: 'pointer',
                background: selectedId === item.id ? 'var(--paper)' : 'transparent',
              }}>
                <div style={{ background: materialBg(item), borderRadius: 6, padding: 6, display: 'flex', flexShrink: 0 }}>
                  {materialIcon(item, 15)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: selectedId === item.id ? 600 : 500, fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'capitalize' }}>{item.content_type || 'file'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {selected && <MaterialPreviewPanel key={`${selected.id}-${selected.title}`} item={selected} />}
        </div>
      </div>
    </div>
  )
}

// ── Invoices ──────────────────────────────────────────────────────────────────
// Collapses the backend's finer-grained statuses (draft/sent/partially_paid/…)
// into the three states a client actually needs to see.
function clientStatus(inv: Invoice): 'paid' | 'overdue' | 'scheduled' {
  if (inv.status === 'paid') return 'paid'
  if (inv.due_date && new Date(inv.due_date) < new Date(new Date().toDateString())) return 'overdue'
  return 'scheduled'
}

function InvoiceCard({ inv, expanded, onToggle }: { inv: Invoice; expanded: boolean; onToggle: () => void }) {
  const status = clientStatus(inv)
  const dueLabel =
    status === 'paid' ? null :
    status === 'overdue' ? `Was due ${fmtDate(inv.due_date!)}` :
    inv.due_date ? `Due ${fmtDate(inv.due_date)}` : null

  return (
    <div className="card" style={{ marginBottom: 12, overflow: 'hidden' }}>
      {/* Invoice header row */}
      <div
        style={{
          padding: '18px 22px', cursor: 'pointer', userSelect: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap',
        }}
        onClick={onToggle}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Invoice #{inv.number}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>Issued {fmtDate(inv.created_at)}</div>
          </div>
          <div>
            <Pill status={status} />
            {dueLabel && (
              <div style={{
                fontSize: 12, marginTop: 5,
                fontWeight: status === 'overdue' ? 600 : 500,
                color: status === 'overdue' ? '#b3261e' : 'var(--muted)',
              }}>
                {dueLabel}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, fontWeight: 500, color: 'var(--ink)' }}>
            ${parseFloat(inv.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)', transition: 'transform .15s', display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'none' }}>▾</span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
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
                <span>Paid: <strong style={{ color: 'var(--success)' }}>${parseFloat(inv.amount_paid).toFixed(2)}</strong></span>
              )}
            </div>
            {inv.stripe_payment_link && inv.status !== 'paid' && (
              <a href={inv.stripe_payment_link} target="_blank" rel="noopener noreferrer" className="btn btn-dark btn-sm">Pay Now</a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function InvoicesTab({ invoices }: { invoices: Invoice[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [subTab, setSubTab] = useState<'pending' | 'paid'>('pending')

  if (!invoices.length) return (
    <div className="empty"><div className="empty-icon">🧾</div><h3>No invoices yet</h3><p>Your invoices will appear here once your coach sends them.</p></div>
  )

  const pending = invoices
    .filter(inv => inv.status !== 'paid')
    .sort((a, b) => {
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
    })
  const paid = invoices.filter(inv => inv.status === 'paid')
  const shown = subTab === 'pending' ? pending : paid

  return (
    <div>
      <div style={{ padding: '24px 0 20px' }}><h1 className="page-title">Invoices</h1></div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button
          className={`btn btn-sm ${subTab === 'pending' ? 'btn-dark' : 'btn-outline'}`}
          onClick={() => setSubTab('pending')}
        >
          Pending{pending.length > 0 ? ` (${pending.length})` : ''}
        </button>
        <button
          className={`btn btn-sm ${subTab === 'paid' ? 'btn-dark' : 'btn-outline'}`}
          onClick={() => setSubTab('paid')}
        >
          Paid{paid.length > 0 ? ` (${paid.length})` : ''}
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="empty" style={{ paddingTop: 40 }}>
          <div className="empty-icon">🧾</div>
          <h3>{subTab === 'pending' ? 'Nothing pending' : 'No paid invoices yet'}</h3>
          <p>{subTab === 'pending' ? "You're all caught up." : 'Paid invoices will show up here.'}</p>
        </div>
      ) : (
        shown.map(inv => (
          <InvoiceCard
            key={inv.id}
            inv={inv}
            expanded={expanded === inv.id}
            onToggle={() => setExpanded(expanded === inv.id ? null : inv.id)}
          />
        ))
      )}
    </div>
  )
}

// ── Main Portal ────────────────────────────────────────────────────────────────
const TABS = ['Overview', 'Goals', 'Activities', 'Notes', 'Files', 'Invoices'] as const
type Tab = typeof TABS[number]
const TAB_ICONS: Record<Tab, React.ElementType> = {
  Overview: LayoutDashboard, Goals: Target, Activities: CalendarDays,
  Notes: StickyNote, Files: Folder, Invoices: Receipt,
}

// Mirrors coachos/frontend/src/components/layout/Sidebar.tsx's visual style exactly
// (same .sidebar/.nav-item/.sidebar-bottom CSS classes, index.css) — the portal is a
// standalone page with its own session (portal_client JWT, not the coach auth store),
// so this is a small local component rather than reusing Sidebar.tsx directly, which is
// wired to coach-only queries (team, tab_permissions) that don't apply here.
function PortalSidebar({ activeTab, setActiveTab, wsName, logoUrl, clientName, onLogout }: {
  activeTab: Tab; setActiveTab: (t: Tab) => void; wsName: string; logoUrl: string
  clientName: string; onLogout: () => void
}) {
  const initials = clientName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?'
  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        {logoUrl
          // A white card behind the logo — same treatment used everywhere else this logo
          // is shown on a dark background (emails: _email_shell, tasks/email.py). The
          // previous brightness(0)/invert(1) filter only works for a transparent-background
          // logo; this one has an opaque white background, so inverting it just produced
          // a solid white box (its own artwork included) instead of a visible logo.
          ? (
            <div style={{ background: '#fff', display: 'inline-flex', padding: '6px 10px', borderRadius: 5 }}>
              <img src={logoUrl} alt={wsName} style={{ maxHeight: 28, maxWidth: 150, objectFit: 'contain', display: 'block' }} />
            </div>
          )
          : <div className="sidebar-logo-text">{wsName}</div>
        }
        <div style={{
          marginTop: 6, fontSize: 10, fontWeight: 700, letterSpacing: '.10em',
          textTransform: 'uppercase', color: 'rgba(255,255,255,.45)',
        }}>
          Client Portal
        </div>
      </div>
      <div className="nav-section" style={{ flex: 1, overflowY: 'auto' }}>
        <div className="nav-label">My Coaching</div>
        {TABS.map(tab => {
          const Icon = TAB_ICONS[tab]
          return (
            <div key={tab} onClick={() => setActiveTab(tab)}
              className={`nav-item${activeTab === tab ? ' active' : ''}`}>
              <span className="nav-icon"><Icon size={14} strokeWidth={1.75} /></span>
              {tab}
            </div>
          )
        })}
      </div>
      <div className="sidebar-bottom">
        <div className="sidebar-user">
          <div className="avatar">{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sidebar-user-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {clientName}
            </div>
            <div className="sidebar-user-role">Client</div>
          </div>
          <button onClick={onLogout} className="btn btn-ghost btn-sm"
            style={{ color: 'rgba(255,255,255,.4)', padding: '4px 6px' }} title="Log out">
            <LogOut size={13} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  )
}

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
  const [showIdleWarning, setShowIdleWarning] = useState(false)
  const { show: showToast, el: toastEl } = useToast()

  useEffect(() => { axios.get(`${BASE}/api/settings/public-branding/`).then(r => setBranding(r.data)).catch(() => {}) }, [])

  useEffect(() => {
    const token = localStorage.getItem('portal_token')
    if (token) setSession({ token, client_name: localStorage.getItem('portal_client_name') || '', workspace_name: localStorage.getItem('portal_workspace_name') || '', coach_name: localStorage.getItem('portal_coach_name') || '' })
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

  const refetchActivities = useCallback(async () => {
    try {
      const r = await api.get('/api/portal/activities/')
      setActivities(r.data || [])
    } catch {}
  }, []) // eslint-disable-line

  useEffect(() => { if (session) loadData() }, [session, loadData])

  function logout() {
    ['portal_token', 'portal_client_name', 'portal_workspace_name', 'portal_coach_name'].forEach(k => localStorage.removeItem(k))
    setSession(null); setMe(null); setGoals([]); setCommitments([])
    setActivities([]); setMaterials([]); setInvoices([]); setNotes([]); setActiveTab('Overview')
  }

  const handleIdleLogout = useCallback(() => { setShowIdleWarning(false); logout() }, []) // eslint-disable-line

  // The portal session token is valid for PORTAL_SESSION_LIFETIME_HOURS (24h, see
  // PortalLoginView) specifically so a client doesn't have to re-request/re-enter their
  // login code every time they come back the same day — but the coach app's 15/30 min
  // idle thresholds are too aggressive for that same reason (would log an open-but-idle
  // tab out long before the 24h ceiling). Widened to warn at 2h45m / log out at 3h: long
  // enough that normal same-session use never hits it, short enough that a session left
  // open on a shared/public device doesn't sit logged in for the full 24h unattended.
  const IDLE_WARN_MS   = 165 * 60 * 1000  // 2h45m
  const IDLE_LOGOUT_MS = 180 * 60 * 1000  // 3h
  const { stayActive } = useInactivityTimer({
    enabled:  !!session,
    onWarn:   () => setShowIdleWarning(true),
    onLogout: handleIdleLogout,
    warnMs:   IDLE_WARN_MS,
    logoutMs: IDLE_LOGOUT_MS,
  })

  if (!session) return <LoginScreen branding={branding} onLogin={d => setSession(d)} />

  const wsName = session.workspace_name || branding?.name || 'CoachOS'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)', display: 'flex' }}>
      {toastEl}
      {showIdleWarning && (
        <InactivityWarningModal
          onStay={() => { setShowIdleWarning(false); stayActive() }}
          onLogout={handleIdleLogout}
          warnMinutes={IDLE_WARN_MS / 60000}
          logoutMinutes={IDLE_LOGOUT_MS / 60000}
        />
      )}

      {/* Left nav — mirrors the coach app's Sidebar (same CSS classes/visual style) */}
      <PortalSidebar
        activeTab={activeTab} setActiveTab={setActiveTab}
        wsName={wsName} logoUrl={branding?.logo_url || ''}
        clientName={session.client_name} onLogout={logout}
      />

      <div className="main-offset" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        {/* Top nav — mirrors the coach app's TopNav (same tan background/gold-underline
            style), same tabs as the sidebar — matches how the coach app itself repeats
            its core sections in both places rather than duplicating a second, different set. */}
        <div style={{
          display: 'flex', background: '#ece5d8', borderBottom: '1px solid #d4c9b4',
          padding: '0 32px', overflowX: 'auto', flexShrink: 0,
          position: 'sticky', top: 0, zIndex: 10, boxShadow: '0 1px 4px rgba(26,23,20,.08)',
        }}>
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              display: 'flex', alignItems: 'center', padding: '13px 16px', border: 'none',
              background: 'none', fontSize: 13, fontWeight: 500, fontFamily: "'DM Sans', sans-serif",
              color: activeTab === tab ? '#1a1714' : '#7a6e64', cursor: 'pointer', whiteSpace: 'nowrap',
              borderBottom: `2px solid ${activeTab === tab ? '#b8922e' : 'transparent'}`,
              marginBottom: -1, transition: 'color .15s', letterSpacing: '.01em',
            }}>{tab}</button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', fontSize: 12, color: '#7a6e64' }}>
            {session.client_name}
          </div>
        </div>

        {/* Content — full width now (was capped at 920px, mostly empty space either side) */}
        <main style={{ flex: 1, width: '100%', maxWidth: 1400, margin: '0 auto', padding: '0 40px 48px', boxSizing: 'border-box' }}>
          {loading ? (
            <div className="empty"><div className="empty-icon">⏳</div><h3>Loading your portal…</h3></div>
          ) : (
            <>
              {activeTab === 'Overview'    && <OverviewTab me={me} goals={goals} activities={activities} invoices={invoices} />}
              {activeTab === 'Goals'       && <GoalsTab goals={goals} setGoals={setGoals} commitments={commitments} showToast={showToast} onProgressSaved={(goalId, entry) => setGoals(prev => prev.map(g => g.id === goalId ? { ...g, progress_entries: [entry, ...g.progress_entries], progress_count: g.progress_count + 1 } : g))} />}
              {activeTab === 'Activities'  && <ActivitiesTab activities={activities} onUpdate={(id, p) => setActivities(prev => prev.map(a => a.id === id ? { ...a, ...p } : a))} onRefresh={refetchActivities} />}
              {activeTab === 'Notes'       && <NotesTab notes={notes} setNotes={setNotes} showToast={showToast} />}
              {activeTab === 'Files'       && <FilesTab materials={materials} />}
              {activeTab === 'Invoices'    && <InvoicesTab invoices={invoices} />}
            </>
          )}
        </main>

        <footer style={{ textAlign: 'center', padding: '20px 24px', color: 'var(--muted-faint)', fontSize: 11, borderTop: '1px solid var(--border)' }}>
          Powered by CoachOS
        </footer>
      </div>
    </div>
  )
}
