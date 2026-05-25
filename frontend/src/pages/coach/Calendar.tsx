import { useState, useRef, useEffect } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { activitiesApi, clientsApi, settingsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { Modal, StatusBadge, useToast, ConfirmDialog } from '../../components/ui'

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
function NewActivityModal({ defaultStart, onClose, onSaved }: any) {
  const qc = useQueryClient()
  const { data: clientsData } = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => clientsApi.list({ page_size: 200 }).then(r => r.data),
  })
  const { data: activityTypes = [] } = useQuery({
    queryKey: ['activity-type-configs'],
    queryFn: () => settingsApi.getActivityTypes().then(r => r.data),
    select: (d: any[]) => d.filter(t => t.is_active),
  })
  const clients: any[] = clientsData?.results || clientsData || []
  const [form, setForm] = useState({
    client: '', activity_type: 'session', title: '',
    start_at: defaultStart || '', end_at: '',
    location: '', notes: '',
  })
  const [sendConfirmation, setSendConfirmation] = useState(true)
  const [repeat, setRepeat]         = useState<'none'|'daily'|'weekly'|'biweekly'|'monthly'|'yearly'>('none')
  const [repeatEnd, setRepeatEnd]   = useState<'never'|'date'>('never')
  const [repeatUntil, setRepeatUntil] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const toUTC = (local: string) => local ? new Date(local).toISOString() : local

  const handleSave = async () => {
    if (!form.client || !form.title || !form.start_at) return
    setSaving(true)
    const payload: any = { ...form, start_at: toUTC(form.start_at), end_at: form.end_at ? toUTC(form.end_at) : form.end_at }
    if (repeat !== 'none') {
      payload.repeat = repeat
      payload.repeat_until = (repeatEnd === 'date' && repeatUntil) ? repeatUntil : null
    }
    try {
      await activitiesApi.create({ ...payload, send_confirmation: sendConfirmation })
      qc.invalidateQueries({ queryKey: ['activities'] })
      onSaved(sendConfirmation)
    } catch { } finally { setSaving(false) }
  }

  return (
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
          <select className="fselect" value={form.client} onChange={e => set('client', e.target.value)}>
            <option value="">Select client…</option>
            {clients.map((c: any) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
          </select>
        </div>
        <div className="fgroup">
          <label className="flabel">Type</label>
          <select className="fselect" value={form.activity_type} onChange={e => set('activity_type', e.target.value)}>
            {(activityTypes as any[]).map((t: any) => (
              <option key={t.name} value={t.name}>{t.name.charAt(0).toUpperCase() + t.name.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="fgroup">
        <label className="flabel">Title *</label>
        <input className="finput" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Weekly coaching session" />
      </div>
      <div className="fgrid">
        <div className="fgroup">
          <label className="flabel">Start *</label>
          <input className="finput" type="datetime-local" value={form.start_at} onChange={e => set('start_at', e.target.value)} />
        </div>
        <div className="fgroup">
          <label className="flabel">End</label>
          <input className="finput" type="datetime-local" value={form.end_at} onChange={e => set('end_at', e.target.value)} />
        </div>
      </div>
      <div className="fgroup">
        <label className="flabel">Location / Link</label>
        <input className="finput" value={form.location} onChange={e => set('location', e.target.value)} placeholder="Zoom link, office address…" />
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
                  min={form.start_at ? form.start_at.slice(0, 10) : undefined}
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
    </Modal>
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
  const { data: clientsData } = useQuery({ queryKey: ['clients-all'], queryFn: () => clientsApi.list({ page_size: 200 }).then(r => r.data) })
  const { data: activityTypes = [] } = useQuery({
    queryKey: ['activity-type-configs'],
    queryFn: () => settingsApi.getActivityTypes().then(r => r.data),
    select: (d: any[]) => d.filter(t => t.is_active),
  })
  const clients: any[] = clientsData?.results || clientsData || []
  const [form, setForm] = useState({
    client: activity.client || '',
    activity_type: activity.activity_type || 'session',
    title: activity.title || '',
    start_at: activity.start_at ? toLocalInput(activity.start_at) : '',
    end_at: activity.end_at ? toLocalInput(activity.end_at) : '',
    location: activity.location || '',
    notes: activity.notes || '',
  })
  const isInSeries = !!activity.recurrence_id
  const [repeat, setRepeat]           = useState<'none'|'daily'|'weekly'|'biweekly'|'monthly'|'yearly'>(parseRrule(activity.rrule || ''))
  const [repeatEnd, setRepeatEnd]     = useState<'never'|'date'>('never')
  const [repeatUntil, setRepeatUntil] = useState('')
  const [editScope, setEditScope]     = useState<'this'|'all'>(isInSeries ? 'this' : 'this')
  const [saving, setSaving]   = useState(false)
  const [saveError, setSaveError] = useState('')
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const toUTC = (local: string) => local ? new Date(local).toISOString() : local

  const handleSave = async () => {
    setSaving(true); setSaveError('')
    const payload: any = {
      ...form,
      start_at: toUTC(form.start_at),
      end_at: form.end_at ? toUTC(form.end_at) : form.end_at,
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
          <select className="fselect" value={form.client} onChange={e => set('client', e.target.value)}>
            {clients.map((c: any) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
          </select>
        </div>
        <div className="fgroup">
          <label className="flabel">Type</label>
          <select className="fselect" value={form.activity_type} onChange={e => set('activity_type', e.target.value)}>
            {(activityTypes as any[]).map((t: any) => (
              <option key={t.name} value={t.name}>{t.name.charAt(0).toUpperCase() + t.name.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="fgroup"><label className="flabel">Title</label><input className="finput" value={form.title} onChange={e => set('title', e.target.value)} /></div>
      <div className="fgrid">
        <div className="fgroup"><label className="flabel">Start</label><input className="finput" type="datetime-local" value={form.start_at} onChange={e => set('start_at', e.target.value)} /></div>
        <div className="fgroup"><label className="flabel">End</label><input className="finput" type="datetime-local" value={form.end_at} onChange={e => set('end_at', e.target.value)} /></div>
      </div>
      <div className="fgroup"><label className="flabel">Location / Link</label><input className="finput" value={form.location} onChange={e => set('location', e.target.value)} /></div>
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
                  min={form.start_at ? form.start_at.slice(0, 10) : undefined}
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
  const canAct = activity.status === 'scheduled'
  const cfg = typeConfig(activity.activity_type)
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

  const { data: activitiesData } = useQuery({
    queryKey: ['activities', range.start, range.end],
    queryFn: () => activitiesApi.list({ start: range.start, end: range.end, page_size: 300 }).then(r => r.data),
    enabled: !!range.start,
  })
  const activities: any[] = activitiesData?.results || activitiesData || []

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
    try {
      await activitiesApi.cancel(cancelTarget.id)
      qc.invalidateQueries({ queryKey: ['activities'] })
      setSelectedAct(null); setCancelTarget(null)
      showToast('Session cancelled — client notified by email')
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
          background: 'var(--paper)', flexShrink: 0,
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
                {Object.entries(TYPE_CONFIG).slice(0, 5).map(([type, cfg]) => (
                  <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: cfg.border, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: 'var(--ink)' }}>{cfg.label}</span>
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
      {cancelTarget && (
        <ConfirmDialog
          message={`Cancel "${cancelTarget.title}" for ${cancelTarget.client_name}? The client will be notified by email.`}
          confirmLabel="Yes, Cancel Session" danger
          onConfirm={handleCancel}
          onCancel={() => setCancelTarget(null)}
        />
      )}
      {toastEl}
    </AppShell>
  )
}
