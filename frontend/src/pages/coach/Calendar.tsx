import { useState, useRef } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { activitiesApi, clientsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { PageHeader, Modal, StatusBadge, useToast, ConfirmDialog } from '../../components/ui'

const TYPE_COLOURS: Record<string, string> = {
  session:     '#1a1714',
  appointment: '#c9a84c',
  call:        '#2d6a9f',
  task:        '#4a7c59',
  training:    '#7c4d9f',
  travel:      '#8c8279',
  custom:      '#a0522d',
}

const ACTIVITY_TYPES = ['appointment', 'task', 'call', 'session', 'training', 'travel', 'custom']

// ── New Activity Modal ─────────────────────────────────────────────────────────
function NewActivityModal({ defaultStart, onClose, onSaved }: any) {
  const qc = useQueryClient()
  const { data: clientsData } = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => clientsApi.list({ page_size: 200 }).then(r => r.data),
  })
  const clients: any[] = clientsData?.results || clientsData || []
  const [form, setForm] = useState({
    client: '', activity_type: 'session', title: '',
    start_at: defaultStart || '', end_at: '',
    location: '', notes: '',
  })
  const [sendConfirmation, setSendConfirmation] = useState(true)
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.client || !form.title || !form.start_at) return
    setSaving(true)
    try {
      await activitiesApi.create({ ...form, send_confirmation: sendConfirmation })
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
            {clients.map((c: any) => (
              <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
            ))}
          </select>
        </div>
        <div className="fgroup">
          <label className="flabel">Type</label>
          <select className="fselect" value={form.activity_type} onChange={e => set('activity_type', e.target.value)}>
            {ACTIVITY_TYPES.map(t => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
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

      {/* Notification toggle */}
      <div style={{
        marginTop: 16,
        padding: '12px 14px',
        background: 'var(--paper)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <input
          id="send_confirmation"
          type="checkbox"
          checked={sendConfirmation}
          onChange={e => setSendConfirmation(e.target.checked)}
          style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--gold)' }}
        />
        <label htmlFor="send_confirmation" style={{ fontSize: 13, cursor: 'pointer', lineHeight: 1.4 }}>
          <span style={{ fontWeight: 500, color: 'var(--ink)' }}>Send confirmation email to client</span>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
            Client will also receive automatic reminders 24 hours and 1 hour before the session.
          </span>
        </label>
      </div>
    </Modal>
  )
}

// ── Edit Activity Modal ────────────────────────────────────────────────────────
function EditActivityModal({ activity, onClose, onSaved }: any) {
  const qc = useQueryClient()
  const { data: clientsData } = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => clientsApi.list({ page_size: 200 }).then(r => r.data),
  })
  const clients: any[] = clientsData?.results || clientsData || []
  const [form, setForm] = useState({
    client: activity.client || '',
    activity_type: activity.activity_type || 'session',
    title: activity.title || '',
    start_at: activity.start_at ? activity.start_at.slice(0, 16) : '',
    end_at: activity.end_at ? activity.end_at.slice(0, 16) : '',
    location: activity.location || '',
    notes: activity.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    try {
      await activitiesApi.patch(activity.id, form)
      qc.invalidateQueries({ queryKey: ['activities'] })
      onSaved()
    } catch { } finally { setSaving(false) }
  }

  return (
    <Modal title="Edit Activity" onClose={onClose} footer={
      <>
        <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-dark btn-sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </>
    }>
      <div className="fgrid">
        <div className="fgroup">
          <label className="flabel">Client</label>
          <select className="fselect" value={form.client} onChange={e => set('client', e.target.value)}>
            {clients.map((c: any) => (
              <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
            ))}
          </select>
        </div>
        <div className="fgroup">
          <label className="flabel">Type</label>
          <select className="fselect" value={form.activity_type} onChange={e => set('activity_type', e.target.value)}>
            {ACTIVITY_TYPES.map(t => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="fgroup">
        <label className="flabel">Title</label>
        <input className="finput" value={form.title} onChange={e => set('title', e.target.value)} />
      </div>
      <div className="fgrid">
        <div className="fgroup">
          <label className="flabel">Start</label>
          <input className="finput" type="datetime-local" value={form.start_at} onChange={e => set('start_at', e.target.value)} />
        </div>
        <div className="fgroup">
          <label className="flabel">End</label>
          <input className="finput" type="datetime-local" value={form.end_at} onChange={e => set('end_at', e.target.value)} />
        </div>
      </div>
      <div className="fgroup">
        <label className="flabel">Location / Link</label>
        <input className="finput" value={form.location} onChange={e => set('location', e.target.value)} />
      </div>
      <div className="fgroup">
        <label className="flabel">Notes (internal)</label>
        <textarea className="ftextarea" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>
    </Modal>
  )
}

// ── Activity Detail Modal ──────────────────────────────────────────────────────
function ActivityDetailModal({ activity, onClose, onMissed, onCancel, onEdit }: any) {
  const canAct = activity.status === 'scheduled'

  return (
    <Modal
      title={activity.title}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          {canAct && (
            <button
              className="btn btn-sm btn-outline"
              onClick={() => onEdit(activity)}
              style={{ marginRight: 'auto' }}
            >
              Edit
            </button>
          )}
          <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
          {canAct && (
            <button
              className="btn btn-sm"
              style={{ background: 'var(--rust)', color: 'white', borderRadius: 'var(--radius-sm)' }}
              onClick={() => onMissed(activity.id)}
            >
              Mark Missed
            </button>
          )}
          {canAct && (
            <button className="btn btn-danger btn-sm" onClick={() => onCancel(activity)}>
              Cancel Session
            </button>
          )}
        </div>
      }
    >
      <div className="kv">
        <span className="kvl">Client</span>
        <span className="kvv">{activity.client_name || activity.client?.first_name}</span>
      </div>
      <div className="kv">
        <span className="kvl">Type</span>
        <span className="kvv" style={{ textTransform: 'capitalize' }}>{activity.activity_type}</span>
      </div>
      <div className="kv">
        <span className="kvl">Status</span>
        <span className="kvv"><StatusBadge status={activity.status} /></span>
      </div>
      <div className="kv">
        <span className="kvl">Start</span>
        <span className="kvv">{new Date(activity.start_at).toLocaleString()}</span>
      </div>
      {activity.end_at && (
        <div className="kv">
          <span className="kvl">End</span>
          <span className="kvv">{new Date(activity.end_at).toLocaleString()}</span>
        </div>
      )}
      {activity.location && (
        <div className="kv">
          <span className="kvl">Location</span>
          <span className="kvv">{activity.location}</span>
        </div>
      )}
      {activity.notes && (
        <div style={{
          marginTop: 12, fontSize: 13, color: '#555', lineHeight: 1.6,
          background: 'var(--paper)', padding: 12, borderRadius: 'var(--radius-sm)',
        }}>
          {activity.notes}
        </div>
      )}

      {/* Notification info for scheduled sessions */}
      {activity.status === 'scheduled' && (
        <div style={{
          marginTop: 14,
          padding: '10px 12px',
          background: 'rgba(201,168,76,0.07)',
          border: '1px solid rgba(201,168,76,0.2)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 12,
          color: 'var(--muted)',
          lineHeight: 1.5,
        }}>
          Client will receive automatic reminders <strong style={{ color: 'var(--ink)' }}>24 hours</strong> and{' '}
          <strong style={{ color: 'var(--ink)' }}>1 hour</strong> before this session.
        </div>
      )}
    </Modal>
  )
}

// ── Main Calendar Page ─────────────────────────────────────────────────────────
export default function Calendar() {
  const qc = useQueryClient()
  const { show: showToast, el: toastEl } = useToast()
  const calRef = useRef<any>(null)
  const [range, setRange] = useState<{ start: string; end: string }>({ start: '', end: '' })
  const [showNew, setShowNew] = useState(false)
  const [newStart, setNewStart] = useState('')
  const [selectedActivity, setSelectedActivity] = useState<any>(null)
  const [editingActivity, setEditingActivity] = useState<any>(null)
  const [cancelTarget, setCancelTarget] = useState<any>(null)

  const { data: activitiesData } = useQuery({
    queryKey: ['activities', range.start, range.end],
    queryFn: () => activitiesApi.list({ start: range.start, end: range.end, page_size: 300 }).then(r => r.data),
    enabled: !!range.start,
  })
  const activities: any[] = activitiesData?.results || activitiesData || []

  const events = activities.map((a: any) => ({
    id: a.id,
    title: `${a.client_name || ''} — ${a.title}`,
    start: a.start_at,
    end: a.end_at || a.start_at,
    backgroundColor: TYPE_COLOURS[a.activity_type] || '#8c8279',
    borderColor: 'transparent',
    extendedProps: a,
    opacity: a.status === 'cancelled' || a.status === 'missed' ? 0.4 : 1,
  }))

  const handleMarkMissed = async (id: string) => {
    try {
      await activitiesApi.markMissed(id)
      qc.invalidateQueries({ queryKey: ['activities'] })
      setSelectedActivity(null)
      showToast('Session marked as missed')
    } catch { showToast('Failed', 'error') }
  }

  const handleCancel = async () => {
    if (!cancelTarget) return
    try {
      await activitiesApi.cancel(cancelTarget.id)
      qc.invalidateQueries({ queryKey: ['activities'] })
      setSelectedActivity(null)
      setCancelTarget(null)
      showToast('Session cancelled — client notified by email')
    } catch { showToast('Cancellation failed', 'error') }
  }

  return (
    <AppShell>
      <PageHeader
        title="Calendar"
        subtitle="All scheduled activities"
        action={
          <button className="btn btn-dark" onClick={() => { setNewStart(''); setShowNew(true) }}>
            + Schedule
          </button>
        }
      />

      <div className="page-body">
        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          {Object.entries(TYPE_COLOURS).map(([type, colour]) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
              <div style={{ width: 9, height: 9, background: colour, borderRadius: '50%' }} />
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </div>
          ))}
        </div>

        <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, boxShadow: 'var(--shadow-sm)' }}>
          <FullCalendar
            ref={calRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'dayGridMonth,timeGridWeek,timeGridDay',
            }}
            events={events}
            height="auto"
            selectable
            selectMirror
            datesSet={(info: any) => setRange({ start: info.startStr, end: info.endStr })}
            select={(info: any) => { setNewStart(info.startStr.slice(0, 16)); setShowNew(true) }}
            eventClick={(info: any) => setSelectedActivity(info.event.extendedProps)}
            eventDisplay="block"
            slotMinTime="07:00:00"
            slotMaxTime="20:00:00"
            allDaySlot={false}
            eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
          />
        </div>
      </div>

      {showNew && (
        <NewActivityModal
          defaultStart={newStart}
          onClose={() => setShowNew(false)}
          onSaved={(emailSent: boolean) => {
            setShowNew(false)
            showToast(emailSent ? 'Activity scheduled — confirmation sent to client' : 'Activity scheduled')
          }}
        />
      )}

      {selectedActivity && !editingActivity && (
        <ActivityDetailModal
          activity={selectedActivity}
          onClose={() => setSelectedActivity(null)}
          onMissed={handleMarkMissed}
          onEdit={(a: any) => { setEditingActivity(a); setSelectedActivity(null) }}
          onCancel={(a: any) => { setCancelTarget(a); setSelectedActivity(null) }}
        />
      )}

      {editingActivity && (
        <EditActivityModal
          activity={editingActivity}
          onClose={() => setEditingActivity(null)}
          onSaved={() => {
            setEditingActivity(null)
            qc.invalidateQueries({ queryKey: ['activities'] })
            showToast('Activity updated')
          }}
        />
      )}

      {cancelTarget && (
        <ConfirmDialog
          message={`Cancel "${cancelTarget.title}" for ${cancelTarget.client_name}? The client will be notified by email.`}
          confirmLabel="Yes, Cancel Session"
          danger
          onConfirm={handleCancel}
          onCancel={() => setCancelTarget(null)}
        />
      )}

      {toastEl}
    </AppShell>
  )
}
