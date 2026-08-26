import { useState, useRef, useEffect } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { activitiesApi, clientsApi, settingsApi, authApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { Modal, StatusBadge, useToast } from '../../components/ui'
import { EmailEditModal } from '../../components/EmailEditModal'
import { useAuthStore } from '../../store/auth'

// ── Type config ───────────────────────────────────────────────────────────────
const TYPE_CONFIG: Record<string, { bg: string; border: string; text: string; label: string }> = {
  session:     { bg: '#dff0d8', border: '#4a7c59', text: '#2d5227', label: 'Session' },
  call:        { bg: '#d6e9f8', border: '#2d6a9f', text: '#1a4a7a', label: 'Call' },
  task:        { bg: '#fce4d6', border: '#a0522d', text: '#7a3010', label: 'Task' },
  appointment: { bg: '#fef9e0', border: '#c9a84c', text: '#7a6010', label: 'Appointment' },
  training:    { bg: '#ede0f5', border: '#7c4d9f', text: '#4a2a7a', label: 'Training' },
  travel:      { bg: '#f0ece8', border: '#8c8279', text: '#5a4a40', label: 'Travel' },
  custom:      { bg: '#fdebd0', border: '#c9874c', text: '#7a4a10', label: 'Custom' },
}
function typeConfig(type: string) {
  return TYPE_CONFIG[type] || TYPE_CONFIG.custom
}

// Status shown alongside an activity — status takes priority (cancelled/rescheduled),
// otherwise the client's RSVP response (confirmed via either the tokenized link or
// Google Calendar accept/decline). Shared between the calendar cell and detail modal.
function rsvpStatus(a: any): { label: string; color: string } | null {
  if (a.status === 'cancelled')   return { label: 'Cancelled',   color: '#b91c1c' }
  if (a.status === 'rescheduled') return { label: 'Rescheduled', color: '#2d6a9f' }
  if (a.client_rsvp_status === 'declined')  return { label: 'Declined',  color: '#b91c1c' }
  if (a.client_rsvp_status === 'tentative') return { label: 'Tentative', color: '#b8922e' }
  if (a.client_confirmed || a.client_rsvp_status === 'accepted') return { label: 'Confirmed', color: '#2d6a2d' }
  return null
}

function toLocalInput(utc: string) {
  if (!utc) return ''
  const d = new Date(utc)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Mini calendar ─────────────────────────────────────────────────────────────
function MiniCalendar({ currentDate, onNavigate }: { currentDate: Date; onNavigate: (d: Date) => void }) {
  const [view, setView] = useState(() => new Date(currentDate.getFullYear(), currentDate.getMonth(), 1))
  const today = new Date()

  useEffect(() => {
    setView(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1))
  }, [currentDate.getFullYear(), currentDate.getMonth()])

  const year  = view.getFullYear()
  const month = view.getMonth()
  const first = new Date(year, month, 1).getDay()
  const total = new Date(year, month + 1, 0).getDate()
  const offset = (first + 6) % 7

  const cells: (number | null)[] = Array(offset).fill(null)
  for (let d = 1; d <= total; d++) cells.push(d)
  while (cells.length % 7) cells.push(null)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>
          {view.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </span>
        <div style={{ display: 'flex', gap: 2 }}>
          {['‹', '›'].map((ch, i) => (
            <button key={ch} onClick={() => setView(new Date(year, month + (i === 0 ? -1 : 1), 1))}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 15, padding: '0 5px', lineHeight: 1 }}>
              {ch}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, textAlign: 'center' }}>
        {['M','T','W','T','F','S','S'].map((d, i) => (
          <div key={i} style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.05em', padding: '2px 0' }}>{d}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />
          const isToday    = d === today.getDate()    && month === today.getMonth()    && year === today.getFullYear()
          const isSelected = d === currentDate.getDate() && month === currentDate.getMonth() && year === currentDate.getFullYear()
          return (
            <div key={i} onClick={() => onNavigate(new Date(year, month, d))}
              style={{
                fontSize: 11, padding: '4px 0', borderRadius: '50%', cursor: 'pointer',
                background: isSelected ? 'var(--ink)' : isToday ? 'var(--gold)' : 'transparent',
                color: (isSelected || isToday) ? '#fff' : 'var(--ink)',
                fontWeight: isToday ? 700 : 400,
                transition: 'background .15s',
              }}>
              {d}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── New Activity Modal ────────────────────────────────────────────────────────
// ── Zoom meeting generator ────────────────────────────────────────────────────
function ZoomButton({ topic, startTime, durationMinutes, onGenerated }: {
  topic: string
  startTime: string
  durationMinutes: number
  onGenerated: (url: string) => void
}) {
  const [loading, setLoading] = useState(false)

  async function generate() {
    setLoading(true)
    try {
      const { data } = await settingsApi.createZoomMeeting({ topic, start_time: startTime, duration_minutes: durationMinutes })
      onGenerated(data.join_url)
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'Failed to create Zoom meeting'
      alert(msg)
    } finally { setLoading(false) }
  }

  return (
    <button type="button" className="btn btn-outline btn-sm" onClick={generate} disabled={loading}
      style={{ whiteSpace: 'nowrap', flexShrink: 0 }} title="Auto-generate Zoom meeting link">
      {loading ? '…' : '📹 Zoom'}
    </button>
  )
}

function PhoneButton({ phone, onGenerated }: { phone: string; onGenerated: (val: string) => void }) {
  return (
    <button type="button" className="btn btn-outline btn-sm" onClick={() => onGenerated(`Call: ${phone}`)}
      style={{ whiteSpace: 'nowrap', flexShrink: 0 }} title="Use your phone number as the meeting location">
      📞 Phone
    </button>
  )
}

// ── Confirmation email preview — read-only render using the actual values being scheduled ──
function ConfirmationPreviewModal({ clientName, coachName, sessionTitle, sessionTime, location, onClose }: {
  clientName: string; coachName: string; sessionTitle: string; sessionTime: string; location: string
  onClose: () => void
}) {
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    settingsApi.emailPreview('confirmation', {
      client_name: clientName || undefined,
      coach_name: coachName || undefined,
      session_title: sessionTitle || undefined,
      session_time: sessionTime || undefined,
      location: location || undefined,
    })
      .then(r => setHtml(r.data.html || ''))
      .catch(() => setHtml(''))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal title="Confirmation Email Preview" size="lg" onClose={onClose}>
      <div style={{ height: 480, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', position: 'relative', background: '#eeebe5' }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--muted)' }}>
            Loading preview…
          </div>
        )}
        {!loading && (
          <iframe srcDoc={html} title="Confirmation email preview" sandbox="allow-same-origin"
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }} />
        )}
      </div>
    </Modal>
  )
}

// ── Client combobox — searchable client picker for the Schedule/Edit modals ────
function ClientCombobox({ clients, value, onChange }: {
  clients: any[]; value: string; onChange: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = clients.find((c: any) => String(c.id) === String(value))

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = query.trim()
    ? clients.filter((c: any) => `${c.first_name} ${c.last_name}`.toLowerCase().includes(query.trim().toLowerCase()))
    : clients

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        className="finput"
        style={{ marginBottom: 0 }}
        placeholder="Search clients…"
        value={open ? query : selected ? `${selected.first_name} ${selected.last_name}` : ''}
        onFocus={() => { setOpen(true); setQuery('') }}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        autoComplete="off"
      />
      {open && (
        <div style={{
          position: 'absolute', zIndex: 50, top: '100%', left: 0, right: 0,
          background: '#fff', border: '1px solid var(--border)', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,.1)', maxHeight: 180, overflowY: 'auto', marginTop: 2,
        }}>
          {filtered.length === 0 && (
            <div style={{ padding: '9px 14px', fontSize: 13, color: 'var(--muted)' }}>No clients found</div>
          )}
          {filtered.map((c: any) => (
            <div
              key={c.id}
              onMouseDown={() => { onChange(String(c.id)); setOpen(false); setQuery('') }}
              style={{
                padding: '8px 14px', fontSize: 13, cursor: 'pointer',
                background: String(c.id) === String(value) ? 'var(--paper)' : '#fff',
                fontWeight: String(c.id) === String(value) ? 600 : 400,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--paper)')}
              onMouseLeave={e => (e.currentTarget.style.background = String(c.id) === String(value) ? 'var(--paper)' : '#fff')}
            >
              {c.first_name} {c.last_name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


function NewActivityModal({ defaultStart, onClose, onSaved }: any) {
  const qc = useQueryClient()
  const { user, workspace } = useAuthStore()
  const dialInPhone = (user as any)?.phone || ''
  const { data: clientsData } = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => clientsApi.list({ page_size: 200 }).then(r => r.data),
  })
  const { data: activityTypes = [] } = useQuery({
    queryKey: ['activity-type-configs'],
    queryFn: () => settingsApi.getActivityTypes().then(r => r.data),
    select: (d: any[]) => d.filter(t => t.is_active),
  })
  const { data: affiliations = [] } = useQuery({
    queryKey: ['affiliation-configs'],
    queryFn: () => settingsApi.getAffiliations().then(r => r.data),
  })
  const { data: teamData } = useQuery({
    queryKey: ['team'],
    queryFn: () => authApi.team().then(r => r.data),
  })
  const clients: any[] = clientsData?.results || clientsData || []
  const teamMembers: any[] = teamData?.results || teamData || []
  const coaches = teamMembers.filter((m: any) => ['coach', 'business_owner'].includes(m.role))

  const [form, setForm] = useState({
    client: '', activity_type: 'session', title: '',
    location: '', notes: '',
  })
  const [coachId, setCoachId] = useState(user?.id || '')
  const [affiliationId, setAffiliationId] = useState('')

  // Auto-populate coach from the selected client's assigned coach
  useEffect(() => {
    const selected = clients.find((c: any) => c.id === form.client)
    if (selected?.coach) setCoachId(selected.coach)
    else if (!form.client) setCoachId(user?.id || '')
  }, [form.client]) // eslint-disable-line react-hooks/exhaustive-deps
  const [date, setDate]           = useState(defaultStart ? defaultStart.slice(0, 10) : '')
  const [startTime, setStartTime] = useState(defaultStart ? defaultStart.slice(11, 16) : '')
  const [endDate, setEndDate]     = useState(defaultStart ? defaultStart.slice(0, 10) : '')
  const [endTime, setEndTime]     = useState('')
  const [sendConfirmation, setSendConfirmation] = useState(true)
  const [emailTemplateId, setEmailTemplateId] = useState('')
  const [showEmailEdit, setShowEmailEdit] = useState(false)
  const [showEmailPreview, setShowEmailPreview] = useState(false)
  const genericTemplates: any[] = (workspace as any)?.generic_templates || []
  // Only templates assigned to the Booking Confirmation slot — other use cases use a
  // different placeholder set, so picking one here leaves those placeholders literal.
  const confirmationTemplates = genericTemplates.filter((t: any) => t.use_cases?.includes('confirmation'))
  const [repeat, setRepeat]         = useState<'none'|'daily'|'weekly'|'biweekly'|'monthly'|'yearly'>('none')
  const [repeatEnd, setRepeatEnd]   = useState<'never'|'date'>('never')
  const [repeatUntil, setRepeatUntil] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const toUTC = (local: string) => local ? new Date(local).toISOString() : local

  const addOneHour = (time: string) => {
    const [h, m] = time.split(':').map(Number)
    const next = new Date(2000, 0, 1, h + 1, m)
    return `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`
  }

  const handleSave = async () => {
    const start_at    = date && startTime ? `${date}T${startTime}` : ''
    const resolvedEnd = endTime || (startTime ? addOneHour(startTime) : '')
    const resolvedEndDate = endDate || date
    const end_at      = resolvedEndDate && resolvedEnd ? `${resolvedEndDate}T${resolvedEnd}` : ''
    if (!form.client || !form.title || !start_at || !end_at) return
    setSaving(true)
    const payload: any = { ...form, coach: coachId || undefined, affiliation: affiliationId || undefined, start_at: toUTC(start_at), end_at: toUTC(end_at) }
    if (repeat !== 'none') {
      payload.repeat = repeat
      payload.repeat_until = (repeatEnd === 'date' && repeatUntil) ? repeatUntil : null
    }
    try {
      await activitiesApi.create({ ...payload, send_confirmation: sendConfirmation, email_template_id: emailTemplateId })
      qc.invalidateQueries({ queryKey: ['activities'] })
      onSaved(sendConfirmation)
    } catch (err: any) {
      const detail = err?.response?.data
      const msg = typeof detail === 'string' ? detail
        : detail ? Object.values(detail).flat().join(' ')
        : 'Failed to save. Please try again.'
      alert(msg)
    } finally { setSaving(false) }
  }

  return (
    <>
    <Modal title="Schedule Activity" onClose={onClose} footer={
      <>
        <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-dark btn-sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Schedule'}
        </button>
      </>
    }>
      <div className="fgrid">
        <div className="fgroup">
          <label className="flabel">Client *</label>
          <ClientCombobox clients={clients} value={form.client} onChange={v => set('client', v)} />
        </div>
        <div className="fgroup">
          <label className="flabel">Type</label>
          <select className="fselect" value={form.activity_type} onChange={e => set('activity_type', e.target.value)}>
            {(activityTypes as any[]).map((t: any) => (
              <option key={t.name} value={t.name}>{t.name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</option>
            ))}
          </select>
        </div>
      </div>
      <CoachField coaches={coaches} coachId={coachId} setCoachId={setCoachId}
        onCoachAdded={() => qc.invalidateQueries({ queryKey: ['team'] })} />
      {affiliations.length > 0 && (
        <div className="fgroup">
          <label className="flabel">Affiliation</label>
          <select className="fselect" value={affiliationId} onChange={e => setAffiliationId(e.target.value)}>
            <option value="">— None —</option>
            {affiliations.map((a: any) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="fgroup">
        <label className="flabel">Title *</label>
        <input className="finput" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Weekly coaching session" />
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
        <div className="fgroup" style={{ flex: 1, marginBottom: 0 }}>
          <label className="flabel">Start date *</label>
          <input className="finput" type="date" value={date} onChange={e => { setDate(e.target.value); if (!endDate || endDate < e.target.value) setEndDate(e.target.value) }} />
        </div>
        <div className="fgroup" style={{ flex: 1, marginBottom: 0 }}>
          <label className="flabel">Start time *</label>
          <input className="finput" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 10 }}>
        <div className="fgroup" style={{ flex: 1, marginBottom: 0 }}>
          <label className="flabel">End date</label>
          <input className="finput" type="date" value={endDate} min={date} onChange={e => setEndDate(e.target.value)} />
        </div>
        <div className="fgroup" style={{ flex: 1, marginBottom: 0 }}>
          <label className="flabel">End time</label>
          <input className="finput" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
        </div>
      </div>
      <div className="fgroup">
        <label className="flabel">Location / Link</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="finput" value={form.location} onChange={e => set('location', e.target.value)} placeholder="Zoom link, office address…" style={{ flex: 1 }} />
          <ZoomButton
            topic={form.title || 'Coaching Session'}
            startTime={date && startTime ? `${date}T${startTime}` : ''}
            durationMinutes={endTime && startTime ? Math.round((new Date(`2000-01-01T${endTime}`).getTime() - new Date(`2000-01-01T${startTime}`).getTime()) / 60000) : 60}
            onGenerated={url => set('location', url)}
          />
          {dialInPhone && (
            <PhoneButton phone={dialInPhone} onGenerated={val => set('location', val)} />
          )}
        </div>
      </div>
      <div className="fgroup">
        <label className="flabel">Notes (internal)</label>
        <textarea className="ftextarea" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>

      {/* ── Repeat ── */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label className="flabel" style={{ marginBottom: 0, minWidth: 90 }}>REPEAT</label>
          <select
            className="fselect"
            value={repeat}
            onChange={e => { setRepeat(e.target.value as any); setRepeatEnd('never'); setRepeatUntil('') }}
            style={{ marginBottom: 0, flex: 1 }}
          >
            <option value="none">Does not repeat</option>
            <option value="daily">Every Day</option>
            <option value="weekly">Every Week</option>
            <option value="biweekly">Every Two Weeks</option>
            <option value="monthly">Every Month</option>
            <option value="yearly">Every Year</option>
          </select>
        </div>

        {repeat !== 'none' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label className="flabel" style={{ marginBottom: 0, minWidth: 90 }}>END REPEAT</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1 }}>
              {(['never', 'date'] as const).map(opt => (
                <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--ink)' }}>
                  <input
                    type="radio"
                    name="repeat_end"
                    checked={repeatEnd === opt}
                    onChange={() => setRepeatEnd(opt)}
                    style={{ accentColor: 'var(--gold)', width: 14, height: 14 }}
                  />
                  {opt === 'never' ? 'Never' : 'On Date'}
                </label>
              ))}
              {repeatEnd === 'date' && (
                <input
                  className="finput"
                  type="date"
                  value={repeatUntil}
                  onChange={e => setRepeatUntil(e.target.value)}
                  min={date || undefined}
                  style={{ marginBottom: 0, flex: 1 }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 4, padding: '12px 14px', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input id="send_confirmation" type="checkbox" checked={sendConfirmation}
            onChange={e => setSendConfirmation(e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--gold)', flexShrink: 0 }} />
          <label htmlFor="send_confirmation" style={{ fontSize: 13, cursor: 'pointer', lineHeight: 1.4 }}>
            <span style={{ fontWeight: 500, color: 'var(--ink)' }}>Send booking confirmation email now</span>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
              Includes a calendar invite (.ics) for the client.
            </span>
          </label>
        </div>
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
          <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 14, lineHeight: 1 }}>✓</span>
          <span>Automatic reminders will be sent to the client <strong style={{ color: 'var(--ink)' }}>24 hours</strong> and <strong style={{ color: 'var(--ink)' }}>1 hour</strong> before the session.</span>
        </div>
      </div>
      {sendConfirmation && genericTemplates.length > 0 && confirmationTemplates.length === 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
          No saved template is assigned to Booking Confirmation yet — open Settings → Generic Templates,
          edit (or create) one, and assign it to "Booking Confirmation" to make it selectable here.
        </div>
      )}
      {sendConfirmation && confirmationTemplates.length > 0 && (
        <div className="fgroup" style={{ marginTop: 10 }}>
          <label className="flabel">Email template</label>
          <select className="fselect" value={emailTemplateId} onChange={e => setEmailTemplateId(e.target.value)}>
            <option value="">Default (Settings → Generic Templates → Booking Confirmation)</option>
            {confirmationTemplates.map((t: any) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}
      {sendConfirmation && (
        <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
          <button type="button" onClick={() => setShowEmailPreview(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2d6a9f', fontSize: 12, fontWeight: 600, padding: 0 }}>
            Preview email →
          </button>
          <button type="button" onClick={() => setShowEmailEdit(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2d6a9f', fontSize: 12, fontWeight: 600, padding: 0 }}>
            Edit Default Template →
          </button>
        </div>
      )}
    </Modal>

    {showEmailEdit && (
      <EmailEditModal useCase="confirmation" onClose={() => setShowEmailEdit(false)} />
    )}
    {showEmailPreview && (
      <ConfirmationPreviewModal
        clientName={(() => { const c = clients.find((c: any) => c.id === form.client); return c ? `${c.first_name} ${c.last_name}` : '' })()}
        coachName={coaches.find((c: any) => c.id === coachId)?.full_name || ''}
        sessionTitle={form.title}
        sessionTime={date && startTime ? new Date(`${date}T${startTime}`).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
        location={form.location}
        onClose={() => setShowEmailPreview(false)}
      />
    )}
    </>
  )
}

// ── Coach Field — shared by Schedule + Edit modals ────────────────────────────
function CoachField({ coaches, coachId, setCoachId, onCoachAdded }: {
  coaches: any[]; coachId: string; setCoachId: (id: string) => void; onCoachAdded: () => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ full_name: '', email: '' })
  const [adding, setAdding]   = useState(false)
  const [addError, setAddError] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleAdd = async () => {
    setAddError('')
    if (!addForm.full_name.trim() || !addForm.email.trim()) { setAddError('Name and email are required'); return }
    setAdding(true)
    try {
      const { data } = await authApi.addCoach({ ...addForm, role: 'coach' })
      onCoachAdded()
      setCoachId(data.id)
      setShowAdd(false)
      setAddForm({ full_name: '', email: '' })
    } catch (err: any) {
      setAddError(err?.response?.data?.detail || 'Failed to add coach')
    } finally { setAdding(false) }
  }

  const selected = coaches.find((c: any) => String(c.id) === String(coachId))
  const selectedLabel = selected ? `${selected.full_name}${!selected.is_active ? ' (pending)' : ''}` : '— Auto (from client) —'
  const filtered = query.trim()
    ? coaches.filter((c: any) => c.full_name?.toLowerCase().includes(query.trim().toLowerCase()))
    : coaches

  const pick = (id: string) => { setCoachId(id); setShowAdd(false); setOpen(false); setQuery('') }

  return (
    <div className="fgroup">
      <label className="flabel">Coach</label>
      <div ref={ref} style={{ position: 'relative' }}>
        <input
          className="finput"
          style={{ marginBottom: 0 }}
          placeholder="Search coaches…"
          value={open ? query : selectedLabel}
          onFocus={() => { setOpen(true); setQuery('') }}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          autoComplete="off"
        />
        {open && (
          <div style={{
            position: 'absolute', zIndex: 50, top: '100%', left: 0, right: 0,
            background: '#fff', border: '1px solid var(--border)', borderRadius: 6,
            boxShadow: '0 4px 16px rgba(0,0,0,.1)', maxHeight: 180, overflowY: 'auto', marginTop: 2,
          }}>
            {!query.trim() && (
              <div
                onMouseDown={() => pick('')}
                style={{ padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: 'var(--muted)', fontStyle: 'italic' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--paper)')}
                onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
              >
                — Auto (from client) —
              </div>
            )}
            {filtered.length === 0 && (
              <div style={{ padding: '9px 14px', fontSize: 13, color: 'var(--muted)' }}>No coaches found</div>
            )}
            {filtered.map((c: any) => (
              <div
                key={c.id}
                onMouseDown={() => pick(String(c.id))}
                style={{
                  padding: '8px 14px', fontSize: 13, cursor: 'pointer',
                  background: String(c.id) === String(coachId) ? 'var(--paper)' : '#fff',
                  fontWeight: String(c.id) === String(coachId) ? 600 : 400,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--paper)')}
                onMouseLeave={e => (e.currentTarget.style.background = String(c.id) === String(coachId) ? 'var(--paper)' : '#fff')}
              >
                {c.full_name}{!c.is_active ? ' (pending)' : ''}
              </div>
            ))}
            <div
              onMouseDown={() => { setShowAdd(true); setOpen(false); setQuery('') }}
              style={{ padding: '8px 14px', fontSize: 13, cursor: 'pointer', borderTop: '1px solid var(--border)', color: 'var(--ink)', fontWeight: 500 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--paper)')}
              onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
            >
              + Add new coach…
            </div>
          </div>
        )}
      </div>

      {showAdd && (
        <div style={{ marginTop: 10, padding: '12px 14px', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 10 }}>
            Add Coach — Portal Login Pending
          </div>
          {addError && (
            <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }}>{addError}</div>
          )}
          <div className="fgrid" style={{ marginBottom: 8 }}>
            <input className="finput" placeholder="Full name *" value={addForm.full_name}
              onChange={e => setAddForm(f => ({ ...f, full_name: e.target.value }))}
              style={{ margin: 0 }} />
            <input className="finput" type="email" placeholder="Email address *" value={addForm.email}
              onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
              style={{ margin: 0 }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
            Coach will be created as inactive. Send them a login invite from Settings → Team when ready.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleAdd} disabled={adding}
              style={{ padding: '7px 16px', background: 'var(--ink)', color: '#fff', border: 'none', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: adding ? .7 : 1 }}
            >
              {adding ? 'Adding…' : 'Add Coach'}
            </button>
            <button
              onClick={() => { setShowAdd(false); setAddError(''); setAddForm({ full_name: '', email: '' }) }}
              style={{ padding: '7px 14px', background: 'none', border: '1px solid var(--border)', borderRadius: 5, fontSize: 12, cursor: 'pointer', color: 'var(--muted)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Edit Activity Modal ───────────────────────────────────────────────────────
function parseRrule(rrule: string): 'none'|'daily'|'weekly'|'biweekly'|'monthly'|'yearly' {
  if (!rrule) return 'none'
  if (rrule.includes('INTERVAL=2')) return 'biweekly'
  if (rrule.includes('FREQ=DAILY'))   return 'daily'
  if (rrule.includes('FREQ=WEEKLY'))  return 'weekly'
  if (rrule.includes('FREQ=MONTHLY')) return 'monthly'
  if (rrule.includes('FREQ=YEARLY'))  return 'yearly'
  return 'none'
}

function EditActivityModal({ activity, onClose, onSaved }: any) {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const dialInPhone = (user as any)?.phone || ''
  const { data: clientsData } = useQuery({ queryKey: ['clients-all'], queryFn: () => clientsApi.list({ page_size: 200 }).then(r => r.data) })
  const { data: activityTypes = [] } = useQuery({
    queryKey: ['activity-type-configs'],
    queryFn: () => settingsApi.getActivityTypes().then(r => r.data),
    select: (d: any[]) => d.filter(t => t.is_active),
  })
  const { data: affiliations = [] } = useQuery({
    queryKey: ['affiliation-configs'],
    queryFn: () => settingsApi.getAffiliations().then(r => r.data),
  })
  const { data: teamData } = useQuery({
    queryKey: ['team'],
    queryFn: () => authApi.team().then(r => r.data),
  })
  const clients: any[] = clientsData?.results || clientsData || []
  const teamMembers: any[] = teamData?.results || teamData || []
  const coaches = teamMembers.filter((m: any) => ['coach', 'business_owner'].includes(m.role))

  const localStart = activity.start_at ? toLocalInput(activity.start_at) : ''
  const localEnd   = activity.end_at   ? toLocalInput(activity.end_at)   : ''
  const [coachId, setCoachId] = useState(activity.coach || '')
  const [affiliationId, setAffiliationId] = useState(activity.affiliation || '')
  const [form, setForm] = useState({
    client: activity.client || '',
    activity_type: activity.activity_type || 'session',
    title: activity.title || '',
    location: activity.location || '',
    notes: activity.notes || '',
  })

  // When client changes, auto-populate coach from client's assignment
  useEffect(() => {
    const selected = clients.find((c: any) => c.id === form.client)
    if (selected?.coach) setCoachId(selected.coach)
  }, [form.client]) // eslint-disable-line react-hooks/exhaustive-deps
  const [date, setDate]           = useState(localStart.slice(0, 10))
  const [startTime, setStartTime] = useState(localStart.slice(11, 16))
  const [endDate, setEndDate]     = useState(localEnd.slice(0, 10) || localStart.slice(0, 10))
  const [endTime, setEndTime]     = useState(localEnd.slice(11, 16))
  const isInSeries = !!activity.recurrence_id
  const [repeat, setRepeat]           = useState<'none'|'daily'|'weekly'|'biweekly'|'monthly'|'yearly'>(parseRrule(activity.rrule || ''))
  const [repeatEnd, setRepeatEnd]     = useState<'never'|'date'>(activity.repeat_until ? 'date' : 'never')
  const [repeatUntil, setRepeatUntil] = useState(activity.repeat_until ? activity.repeat_until.slice(0, 10) : '')
  const [editScope, setEditScope]     = useState<'this'|'all'>(isInSeries ? 'this' : 'this')
  const [saving, setSaving]   = useState(false)
  const [saveError, setSaveError] = useState('')
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const toUTC = (local: string) => local ? new Date(local).toISOString() : local

  const addOneHour = (time: string) => {
    const [h, m] = time.split(':').map(Number)
    const next = new Date(2000, 0, 1, h + 1, m)
    return `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`
  }

  const handleSave = async () => {
    const start_at        = date && startTime ? `${date}T${startTime}` : ''
    const resolvedEnd     = endTime || (startTime ? addOneHour(startTime) : '')
    const resolvedEndDate = endDate || date
    const end_at          = resolvedEndDate && resolvedEnd ? `${resolvedEndDate}T${resolvedEnd}` : ''
    setSaving(true); setSaveError('')
    const payload: any = {
      ...form,
      coach: coachId || undefined,
      affiliation: affiliationId || undefined,
      start_at: toUTC(start_at),
      end_at: toUTC(end_at),
      repeat,
      repeat_until: (repeatEnd === 'date' && repeatUntil) ? repeatUntil : null,
      edit_scope: isInSeries ? editScope : 'this',
    }
    try {
      await activitiesApi.patch(activity.id, payload)
      qc.invalidateQueries({ queryKey: ['activities'] })
      onSaved()
    } catch (err: any) {
      const detail = err?.response?.data
      if (typeof detail === 'string') setSaveError(detail)
      else if (detail && typeof detail === 'object') setSaveError(Object.values(detail).flat().join(' '))
      else setSaveError('Failed to save. Please try again.')
    } finally { setSaving(false) }
  }

  return (
    <Modal title="Edit Activity" onClose={onClose} footer={
      <>
        {saveError && <span style={{ color: '#c0392b', fontSize: 13, flex: 1, textAlign: 'left' }}>{saveError}</span>}
        <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-dark btn-sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
      </>
    }>
      <div className="fgrid">
        <div className="fgroup">
          <label className="flabel">Client</label>
          <ClientCombobox clients={clients} value={form.client} onChange={v => set('client', v)} />
        </div>
        <div className="fgroup">
          <label className="flabel">Type</label>
          <select className="fselect" value={form.activity_type} onChange={e => set('activity_type', e.target.value)}>
            {(activityTypes as any[]).map((t: any) => (
              <option key={t.name} value={t.name}>{t.name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</option>
            ))}
          </select>
        </div>
      </div>
      <CoachField coaches={coaches} coachId={coachId} setCoachId={setCoachId}
        onCoachAdded={() => qc.invalidateQueries({ queryKey: ['team'] })} />
      {affiliations.length > 0 && (
        <div className="fgroup">
          <label className="flabel">Affiliation</label>
          <select className="fselect" value={affiliationId} onChange={e => setAffiliationId(e.target.value)}>
            <option value="">— None —</option>
            {affiliations.map((a: any) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="fgroup"><label className="flabel">Title</label><input className="finput" value={form.title} onChange={e => set('title', e.target.value)} /></div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
        <div className="fgroup" style={{ flex: 1, marginBottom: 0 }}>
          <label className="flabel">Start date</label>
          <input className="finput" type="date" value={date} onChange={e => { setDate(e.target.value); if (!endDate || endDate < e.target.value) setEndDate(e.target.value) }} />
        </div>
        <div className="fgroup" style={{ flex: 1, marginBottom: 0 }}>
          <label className="flabel">Start time</label>
          <input className="finput" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 10 }}>
        <div className="fgroup" style={{ flex: 1, marginBottom: 0 }}>
          <label className="flabel">End date</label>
          <input className="finput" type="date" value={endDate} min={date} onChange={e => setEndDate(e.target.value)} />
        </div>
        <div className="fgroup" style={{ flex: 1, marginBottom: 0 }}>
          <label className="flabel">End time</label>
          <input className="finput" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
        </div>
      </div>
      <div className="fgroup">
        <label className="flabel">Location / Link</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="finput" value={form.location} onChange={e => set('location', e.target.value)} style={{ flex: 1 }} />
          {dialInPhone && (
            <PhoneButton phone={dialInPhone} onGenerated={val => set('location', val)} />
          )}
        </div>
      </div>
      <div className="fgroup"><label className="flabel">Notes (internal)</label><textarea className="ftextarea" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></div>

      {/* ── Repeat ── */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label className="flabel" style={{ marginBottom: 0, minWidth: 90 }}>REPEAT</label>
          <select
            className="fselect"
            value={repeat}
            onChange={e => { setRepeat(e.target.value as any); setRepeatEnd('never'); setRepeatUntil('') }}
            style={{ marginBottom: 0, flex: 1 }}
          >
            <option value="none">Does not repeat</option>
            <option value="daily">Every Day</option>
            <option value="weekly">Every Week</option>
            <option value="biweekly">Every Two Weeks</option>
            <option value="monthly">Every Month</option>
            <option value="yearly">Every Year</option>
          </select>
        </div>

        {repeat !== 'none' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label className="flabel" style={{ marginBottom: 0, minWidth: 90 }}>END REPEAT</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1 }}>
              {(['never', 'date'] as const).map(opt => (
                <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--ink)' }}>
                  <input type="radio" name="edit_repeat_end" checked={repeatEnd === opt} onChange={() => setRepeatEnd(opt)}
                    style={{ accentColor: 'var(--gold)', width: 14, height: 14 }} />
                  {opt === 'never' ? 'Never' : 'On Date'}
                </label>
              ))}
              {repeatEnd === 'date' && (
                <input className="finput" type="date" value={repeatUntil}
                  onChange={e => setRepeatUntil(e.target.value)}
                  min={date || undefined}
                  style={{ marginBottom: 0, flex: 1 }} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Apply to (only shown for series events) ── */}
      {isInSeries && (
        <div style={{ marginTop: 10, padding: '12px 14px', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 6 }}>
          <div style={{ fontSize: 11, letterSpacing: '.1em', color: 'var(--muted)', fontWeight: 600, marginBottom: 10 }}>APPLY CHANGES TO</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {([
              { value: 'this', label: 'This event only', desc: 'Only updates this single occurrence' },
              { value: 'all',  label: 'All events in series', desc: 'Updates title, type, location & notes across all; changes repeat pattern if modified' },
            ] as const).map(opt => (
              <label key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input type="radio" name="edit_scope" checked={editScope === opt.value} onChange={() => setEditScope(opt.value)}
                  style={{ accentColor: 'var(--gold)', width: 14, height: 14, marginTop: 2, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Activity Detail Modal ─────────────────────────────────────────────────────
function ActivityDetailModal({ activity, onClose, onMissed, onCancel, onEdit }: any) {
  const canAct = ['scheduled', 'rescheduled', 'late'].includes(activity.status)
  const cfg = typeConfig(activity.activity_type)
  const rsvp = rsvpStatus(activity)
  return (
    <Modal title={activity.title} onClose={onClose} footer={
      <div style={{ display: 'flex', gap: 8, width: '100%' }}>
        {canAct && <button className="btn btn-sm btn-outline" onClick={() => onEdit(activity)} style={{ marginRight: 'auto' }}>Edit</button>}
        <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
        {canAct && <button className="btn btn-sm" style={{ background: 'var(--rust)', color: 'white', borderRadius: 6 }} onClick={() => onMissed(activity.id)}>Mark Missed</button>}
        {canAct && <button className="btn btn-danger btn-sm" onClick={() => onCancel(activity)}>Cancel</button>}
      </div>
    }>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: cfg.border, flexShrink: 0 }} />
        <span style={{ fontSize: 12, textTransform: 'capitalize', color: cfg.text, fontWeight: 600 }}>{activity.activity_type}</span>
        <StatusBadge status={activity.status} />
      </div>
      {rsvp && (
        <div className="kv">
          <span className="kvl">Response</span>
          <span className="kvv">
            <span style={{
              padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
              background: rsvp.color + '18', color: rsvp.color,
            }}>
              {rsvp.label}
            </span>
          </span>
        </div>
      )}
      {[
        { label: 'Client', value: activity.client_name || activity.client?.first_name },
        { label: 'Start',  value: new Date(activity.start_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) },
        activity.end_at && { label: 'End', value: new Date(activity.end_at).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' }) },
        activity.location && { label: 'Location', value: activity.location },
        activity.rrule && { label: 'Repeat', value: ({ none: '', daily: 'Every Day', weekly: 'Every Week', biweekly: 'Every Two Weeks', monthly: 'Every Month', yearly: 'Every Year' } as Record<string, string>)[parseRrule(activity.rrule)] || '' },
      ].filter(Boolean).map((row: any) => (
        <div key={row.label} className="kv"><span className="kvl">{row.label}</span><span className="kvv">{row.value}</span></div>
      ))}
      {activity.notes && (
        <div style={{ marginTop: 12, fontSize: 13, color: '#555', lineHeight: 1.6, background: 'var(--paper)', padding: 12, borderRadius: 6 }}>
          {activity.notes}
        </div>
      )}
      {activity.status === 'scheduled' && (
        <div style={{ marginTop: 14, padding: '10px 12px', background: 'rgba(201,168,76,.07)', border: '1px solid rgba(201,168,76,.2)', borderRadius: 6, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          Client will receive automatic reminders <strong style={{ color: 'var(--ink)' }}>24h</strong> and <strong style={{ color: 'var(--ink)' }}>1h</strong> before this session.
        </div>
      )}
    </Modal>
  )
}

// ── Main Calendar Page ────────────────────────────────────────────────────────
export default function Calendar() {
  const qc = useQueryClient()
  const { show: showToast, el: toastEl } = useToast()
  const calRef = useRef<any>(null)

  const [currentDate, setCurrentDate] = useState(new Date())
  const [calView, setCalView]         = useState<'timeGridWeek' | 'timeGridDay' | 'dayGridMonth'>('timeGridWeek')
  const [calTitle, setCalTitle]       = useState('')
  const [range, setRange]             = useState<{ start: string; end: string }>({ start: '', end: '' })

  const [showNew,       setShowNew]       = useState(false)
  const [newStart,      setNewStart]      = useState('')
  const [selectedAct,   setSelectedAct]   = useState<any>(null)
  const [editingAct,    setEditingAct]    = useState<any>(null)
  const [cancelTarget,  setCancelTarget]  = useState<any>(null)
  const [cancelScope,   setCancelScope]   = useState<'this'|'future'|'all'>('this')

  const { data: activitiesData } = useQuery({
    queryKey: ['activities', range.start, range.end],
    queryFn: () => activitiesApi.list({ start: range.start, end: range.end, page_size: 300 }).then(r => r.data),
    enabled: !!range.start,
  })
  // Exclude one-off Client Communication sends logged as Activities (see
  // ClientMessageDraftViewSet.send) — they're zero-duration log entries, not
  // schedulable sessions, so they don't belong on the calendar grid. The title-prefix
  // check is a fallback for logs created before activity_type gained a dedicated value.
  const activities: any[] = (activitiesData?.results || activitiesData || [])
    .filter((a: any) => a.activity_type !== 'client_communication'
      && !(a.activity_type === 'custom' && (a.title || '').startsWith('Email: ')))

  const { data: activityTypes = [] } = useQuery({
    queryKey: ['activity-type-configs'],
    queryFn: () => settingsApi.getActivityTypes().then(r => r.data),
    select: (d: any[]) => d.filter(t => t.is_active),
  })

  // Upcoming = future activities sorted by start
  const now = new Date()
  const upcoming = [...activities]
    .filter(a => new Date(a.start_at) >= now && a.status === 'scheduled')
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    .slice(0, 5)

  const calEvents = activities.map((a: any) => {
    const faded = a.status === 'cancelled' || a.status === 'missed'
    const cfg   = typeConfig(a.activity_type)
    return {
      id: a.id,
      title: a.title,
      start: a.start_at,
      end: a.end_at || a.start_at,
      backgroundColor: faded ? '#f0f0f0' : cfg.bg,
      borderColor: faded ? '#ccc' : cfg.border,
      textColor: faded ? '#aaa' : cfg.text,
      extendedProps: a,
    }
  })

  const navigate = (dir: 'prev' | 'next' | 'today') => {
    const api = calRef.current?.getApi()
    if (!api) return
    api[dir]()
    setCurrentDate(new Date(api.getDate()))
    setCalTitle(api.view.title)
  }

  const changeView = (v: typeof calView) => {
    const api = calRef.current?.getApi()
    if (api) api.changeView(v)
    setCalView(v)
  }

  const handleMiniNav = (d: Date) => {
    const api = calRef.current?.getApi()
    if (!api) return
    api.gotoDate(d)
    setCurrentDate(d)
    setCalTitle(api.view.title)
  }

  const handleMarkMissed = async (id: string) => {
    try {
      await activitiesApi.markMissed(id)
      qc.invalidateQueries({ queryKey: ['activities'] })
      setSelectedAct(null)
      showToast('Session marked as missed')
    } catch { showToast('Failed', 'error') }
  }

  const handleCancel = async () => {
    if (!cancelTarget) return
    const inSeries = !!(cancelTarget.recurrence_id || cancelTarget.rrule)
    const scope = inSeries ? cancelScope : 'this'
    try {
      await activitiesApi.cancel(cancelTarget.id, scope)
      qc.invalidateQueries({ queryKey: ['activities'] })
      setSelectedAct(null); setCancelTarget(null); setCancelScope('this')
      const msg = scope === 'all' ? 'All sessions cancelled' : scope === 'future' ? 'This and future sessions cancelled' : 'Session cancelled — client notified by email'
      showToast(msg)
    } catch { showToast('Cancellation failed', 'error') }
  }

  const VIEW_LABELS: Record<string, string> = { timeGridDay: 'Day', timeGridWeek: 'Week', dayGridMonth: 'Month' }

  return (
    <AppShell>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

        {/* ── Custom Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 28px', borderBottom: '1px solid var(--border)',
          background: '#f7f4ef', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Prev / Next */}
            {(['‹', '›'] as const).map((ch, i) => (
              <button key={ch} onClick={() => navigate(i === 0 ? 'prev' : 'next')}
                style={{
                  width: 30, height: 30, borderRadius: 6, border: '1px solid var(--border)',
                  background: '#fff', cursor: 'pointer', fontSize: 16, color: 'var(--ink)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                {ch}
              </button>
            ))}
            {/* Title */}
            <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 24, fontWeight: 400, color: 'var(--ink)', margin: 0 }}>
              {calTitle || currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </h2>
            <button onClick={() => navigate('today')}
              style={{
                fontSize: 11, padding: '4px 12px', borderRadius: 4,
                border: '1px solid var(--border)', background: '#fff',
                cursor: 'pointer', color: 'var(--muted)', fontWeight: 500, letterSpacing: '.04em',
              }}>
              TODAY
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* View tabs */}
            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              {(['timeGridDay', 'timeGridWeek', 'dayGridMonth'] as const).map(v => (
                <button key={v} onClick={() => changeView(v)}
                  style={{
                    padding: '6px 14px', fontSize: 12, fontWeight: 500,
                    border: 'none', borderRight: v !== 'dayGridMonth' ? '1px solid var(--border)' : 'none',
                    background: calView === v ? 'var(--ink)' : '#fff',
                    color: calView === v ? '#fff' : 'var(--muted)',
                    cursor: 'pointer', letterSpacing: '.03em',
                  }}>
                  {VIEW_LABELS[v]}
                </button>
              ))}
            </div>
            {/* + Activity */}
            <button
              onClick={() => { setNewStart(''); setShowNew(true) }}
              style={{
                padding: '7px 18px', borderRadius: 6, background: 'var(--ink)',
                color: '#fff', border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 700, letterSpacing: '.06em',
              }}>
              + ACTIVITY
            </button>
          </div>
        </div>

        {/* ── Body: calendar + sidebar ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', flex: 1, minHeight: 0, overflow: 'hidden' }}>

          {/* ── Calendar ── */}
          <div style={{ overflowY: 'auto', borderRight: '1px solid var(--border)', background: '#fff' }}>
            <style>{`
              /* Slot rows */
              .fc .fc-timegrid-slot         { height: 52px; border-color: #f0ece8; }
              .fc .fc-timegrid-slot-minor   { border-top-color: #f7f5f2; border-top-style: dashed; }

              /* Time labels on left */
              .fc .fc-timegrid-slot-label-cushion {
                font-size: 10px; font-weight: 600; letter-spacing: .06em;
                color: #9e9890; text-transform: uppercase; padding-right: 12px;
              }
              .fc .fc-timegrid-axis-cushion { font-size: 10px; color: #9e9890; }

              /* Column headers */
              .fc .fc-col-header-cell {
                border: none !important;
                border-bottom: 2px solid #e8e4de !important;
                padding: 14px 0 12px;
                background: #fff;
              }
              .fc .fc-col-header-cell-cushion {
                display: block; text-decoration: none; cursor: default;
              }

              /* Today column highlight */
              .fc .fc-timegrid-col.fc-day-today { background: #fffdf5 !important; }
              .fc .fc-col-header-cell.fc-day-today .fc-day-abbr { color: #c9a84c !important; }
              .fc .fc-col-header-cell.fc-day-today .fc-day-num  { color: #c9a84c !important; }

              /* Event blocks */
              .fc-timegrid-event {
                border-radius: 6px !important;
                border-left-width: 3px !important;
                border-top: none !important;
                border-right: none !important;
                border-bottom: none !important;
                box-shadow: 0 1px 4px rgba(0,0,0,.07) !important;
                margin: 0 2px !important;
              }
              .fc-timegrid-event-harness { margin-top: 1px !important; }

              /* Remove outer grid border */
              .fc .fc-scrollgrid         { border: none !important; }
              .fc .fc-scrollgrid-sync-table { border-bottom: none; }
              .fc-theme-standard td, .fc-theme-standard th { border-color: #f0ece8; }
              .fc .fc-scrollgrid-section-header > td { border-bottom: none !important; }

              /* Day grid (month view) events */
              .fc-daygrid-event { border-radius: 4px !important; border-left-width: 3px !important; }

              /* Hover */
              .fc-timegrid-event:hover { filter: brightness(.97); }

              /* Current time indicator */
              .fc .fc-timegrid-now-indicator-line { border-color: #c9a84c; border-width: 2px; }
              .fc .fc-timegrid-now-indicator-arrow { border-top-color: #c9a84c; border-bottom-color: #c9a84c; }
            `}</style>
            <FullCalendar
              ref={calRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView={calView}
              headerToolbar={false}
              events={calEvents}
              height="auto"
              selectable
              selectMirror
              nowIndicator
              datesSet={(info: any) => {
                setRange({ start: info.startStr, end: info.endStr })
                setCalTitle(info.view.title)
                setCurrentDate(new Date(info.view.currentStart))
              }}
              select={(info: any) => { setNewStart(info.startStr.slice(0, 16)); setShowNew(true) }}
              eventClick={(info: any) => setSelectedAct(info.event.extendedProps)}
              eventDisplay="block"
              slotMinTime="07:00:00"
              slotMaxTime="21:00:00"
              slotDuration="01:00:00"
              slotLabelInterval="01:00:00"
              allDaySlot={false}
              eventMinHeight={36}
              dayHeaderContent={(arg: any) => {
                const isToday = arg.isToday
                const dayAbbr = arg.date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
                const dayNum  = arg.date.getDate()
                return (
                  <div style={{ textAlign: 'center', lineHeight: 1.2 }}>
                    <div className={isToday ? 'fc-day-abbr' : ''} style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '.1em',
                      color: isToday ? '#c9a84c' : '#9e9890',
                    }}>
                      {dayAbbr}
                    </div>
                    <div className={isToday ? 'fc-day-num' : ''} style={{
                      fontSize: 20, fontWeight: isToday ? 700 : 400,
                      color: isToday ? '#c9a84c' : '#1a1714',
                      fontFamily: 'Cormorant Garamond, Georgia, serif',
                      marginTop: 4,
                    }}>
                      {dayNum}
                    </div>
                  </div>
                )
              }}
              eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
              eventContent={(arg: any) => {
                const a     = arg.event.extendedProps
                const cfg   = typeConfig(a.activity_type)
                const faded = a.status === 'cancelled' || a.status === 'missed'
                const clientFirst = (a.client_name || '').split(' ')[0]
                const startTime   = new Date(a.start_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                const endTime     = a.end_at ? new Date(a.end_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''
                const rsvp = rsvpStatus(a)
                return (
                  <div style={{
                    padding: '5px 8px', height: '100%', overflow: 'hidden',
                    opacity: faded ? .5 : 1, cursor: 'pointer',
                  }}>
                    <div style={{
                      fontSize: 12, fontWeight: 700, color: faded ? '#aaa' : cfg.text,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {a.title}
                    </div>
                    <div style={{
                      fontSize: 11, color: faded ? '#bbb' : cfg.text, opacity: .8,
                      marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {clientFirst} · {startTime}{endTime ? `–${endTime}` : ''}
                    </div>
                    {rsvp && (
                      <div style={{
                        fontSize: 10, fontWeight: 700, color: faded ? '#bbb' : rsvp.color,
                        marginTop: 2, textTransform: 'uppercase', letterSpacing: '.04em',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {rsvp.label}
                      </div>
                    )}
                  </div>
                )
              }}
            />
          </div>

          {/* ── Right Sidebar ── */}
          <div style={{ overflowY: 'auto', background: '#f7f5f2', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Mini calendar */}
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 14px' }}>
              <MiniCalendar currentDate={currentDate} onNavigate={handleMiniNav} />
            </div>

            {/* Activity Types */}
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px' }}>
              <div style={{ fontSize: 10, letterSpacing: '.12em', fontWeight: 700, color: 'var(--muted)', marginBottom: 12 }}>ACTIVITY TYPES</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(activityTypes as any[]).map((t: any) => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: t.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: 'var(--ink)', textTransform: 'capitalize' }}>{t.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Upcoming */}
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px' }}>
              <div style={{ fontSize: 10, letterSpacing: '.12em', fontWeight: 700, color: 'var(--muted)', marginBottom: 12 }}>UPCOMING</div>
              {upcoming.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>No upcoming sessions</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {upcoming.map((a: any) => {
                    const cfg = typeConfig(a.activity_type)
                    const dt  = new Date(a.start_at)
                    const dayStr = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                    const timeStr = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                    return (
                      <div key={a.id}
                        onClick={() => setSelectedAct(a)}
                        style={{
                          background: cfg.bg, borderRadius: 6, padding: '10px 12px',
                          borderLeft: `3px solid ${cfg.border}`, cursor: 'pointer',
                        }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: cfg.text, marginBottom: 3 }}>
                          {a.activity_type}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{a.client_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{dayStr} · {timeStr}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showNew && (
        <NewActivityModal
          defaultStart={newStart}
          onClose={() => setShowNew(false)}
          onSaved={(sent: boolean) => { setShowNew(false); showToast(sent ? 'Activity scheduled — confirmation sent to client' : 'Activity scheduled') }}
        />
      )}
      {selectedAct && !editingAct && (
        <ActivityDetailModal
          activity={selectedAct}
          onClose={() => setSelectedAct(null)}
          onMissed={handleMarkMissed}
          onEdit={(a: any) => { setEditingAct(a); setSelectedAct(null) }}
          onCancel={(a: any) => { setCancelTarget(a); setSelectedAct(null) }}
        />
      )}
      {editingAct && (
        <EditActivityModal
          activity={editingAct}
          onClose={() => setEditingAct(null)}
          onSaved={() => { setEditingAct(null); qc.invalidateQueries({ queryKey: ['activities'] }); showToast('Activity updated') }}
        />
      )}
      {cancelTarget && (() => {
        const inSeries = !!(cancelTarget.recurrence_id || cancelTarget.rrule)
        return (
          <Modal title="Cancel Session" onClose={() => { setCancelTarget(null); setCancelScope('this') }}
            footer={
              <>
                <button className="btn btn-outline btn-sm" onClick={() => { setCancelTarget(null); setCancelScope('this') }}>Keep</button>
                <button className="btn btn-danger btn-sm" onClick={handleCancel}>Yes, Cancel</button>
              </>
            }>
            <p style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 16 }}>
              Cancel <strong>"{cancelTarget.title}"</strong> for {cancelTarget.client_name}?
              The client will be notified by email.
            </p>
            {inSeries && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {([
                  { value: 'this',   label: 'This session only' },
                  { value: 'future', label: 'This and all future sessions in the series' },
                  { value: 'all',    label: 'All sessions in the series' },
                ] as const).map(opt => (
                  <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer',
                    padding: '10px 12px', borderRadius: 6, border: `1px solid ${cancelScope === opt.value ? 'var(--ink)' : 'var(--border)'}`,
                    background: cancelScope === opt.value ? 'var(--paper)' : 'var(--white)' }}>
                    <input type="radio" name="cal_cancel_scope" value={opt.value}
                      checked={cancelScope === opt.value}
                      onChange={() => setCancelScope(opt.value)}
                      style={{ accentColor: 'var(--ink)' }} />
                    {opt.label}
                  </label>
                ))}
              </div>
            )}
          </Modal>
        )
      })()}
      {toastEl}
    </AppShell>
  )
}
