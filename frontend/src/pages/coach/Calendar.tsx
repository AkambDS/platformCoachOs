import { useState, useRef } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { activitiesApi, clientsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { PageHeader, Modal, StatusBadge, useToast } from '../../components/ui'

const TYPE_COLOURS: Record<string, string> = {
  session:     '#1a1714',
  appointment: '#c9a84c',
  call:        '#2d6a9f',
  task:        '#4a7c59',
  training:    '#7c4d9f',
  travel:      '#8c8279',
  custom:      '#a0522d',
}

const ACTIVITY_TYPES = ['appointment','task','call','session','training','travel','custom']

function NewActivityModal({ defaultStart, onClose, onSaved }: any) {
  const qc = useQueryClient()
  const { data: clientsData } = useQuery({ queryKey: ['clients-all'], queryFn: () => clientsApi.list({ page_size: 200 }).then(r => r.data) })
  const clients: any[] = clientsData?.results || clientsData || []
  const [form, setForm] = useState({
    client: '', activity_type: 'session', title: '',
    start_at: defaultStart || '', end_at: '',
    location: '', notes: '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.client || !form.title || !form.start_at) return
    setSaving(true)
    try {
      await activitiesApi.create(form)
      qc.invalidateQueries({ queryKey: ['activities'] })
      onSaved()
    } catch { } finally { setSaving(false) }
  }

  return (
    <Modal title="New Activity" onClose={onClose} footer={
      <>
        <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-dark btn-sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Schedule'}</button>
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
            {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
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
        <textarea className="ftextarea" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>
    </Modal>
  )
}

function ActivityDetailModal({ activity, onClose, onMissed }: any) {
  return (
    <Modal title={activity.title} onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
          {activity.status === 'scheduled' && (
            <button className="btn btn-sm" style={{ background: 'var(--rust)', color: 'white' }} onClick={() => onMissed(activity.id)}>
              Mark Missed
            </button>
          )}
        </>
      }>
      <div className="kv"><span className="kvl">Client</span><span className="kvv">{activity.client_name || activity.client?.first_name}</span></div>
      <div className="kv"><span className="kvl">Type</span><span className="kvv" style={{ textTransform: 'capitalize' }}>{activity.activity_type}</span></div>
      <div className="kv"><span className="kvl">Status</span><span className="kvv"><StatusBadge status={activity.status} /></span></div>
      <div className="kv"><span className="kvl">Start</span><span className="kvv">{new Date(activity.start_at).toLocaleString()}</span></div>
      {activity.end_at && <div className="kv"><span className="kvl">End</span><span className="kvv">{new Date(activity.end_at).toLocaleString()}</span></div>}
      {activity.location && <div className="kv"><span className="kvl">Location</span><span className="kvv">{activity.location}</span></div>}
      {activity.notes && <div style={{ marginTop: 12, fontSize: 13, color: '#555', lineHeight: 1.6, background: 'var(--paper)', padding: 12 }}>{activity.notes}</div>}
    </Modal>
  )
}

export default function Calendar() {
  const qc = useQueryClient()
  const { show: showToast, el: toastEl } = useToast()
  const calRef = useRef<any>(null)
  const [range, setRange] = useState<{ start: string; end: string }>({ start: '', end: '' })
  const [showNew, setShowNew] = useState(false)
  const [newStart, setNewStart] = useState('')
  const [selectedActivity, setSelectedActivity] = useState<any>(null)

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

  return (
    <AppShell>
      <PageHeader
        title="Calendar"
        subtitle="All scheduled activities"
        action={<button className="btn btn-dark" onClick={() => { setNewStart(''); setShowNew(true) }}>+ Schedule</button>}
      />

      <div className="page-body">
        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          {Object.entries(TYPE_COLOURS).map(([type, colour]) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
              <div style={{ width: 10, height: 10, background: colour, borderRadius: 2 }} />
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </div>
          ))}
        </div>

        <div style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: 20 }}>
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
            datesSet={info => setRange({ start: info.startStr, end: info.endStr })}
            select={info => { setNewStart(info.startStr.slice(0, 16)); setShowNew(true) }}
            eventClick={info => setSelectedActivity(info.event.extendedProps)}
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
          onSaved={() => { setShowNew(false); showToast('Activity scheduled') }}
        />
      )}
      {selectedActivity && (
        <ActivityDetailModal
          activity={selectedActivity}
          onClose={() => setSelectedActivity(null)}
          onMissed={handleMarkMissed}
        />
      )}
      {toastEl}
    </AppShell>
  )
}
