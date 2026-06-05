import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { activitiesApi, clientsApi, settingsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { PageHeader, Modal, StatusBadge, useToast, ConfirmDialog } from '../../components/ui'
import {
  CalendarDays, MapPin, User, Clock, ChevronRight, Mail, CheckCircle2, Circle, XCircle,
} from 'lucide-react'

const TYPE_COLOURS: Record<string, string> = {
  session:     '#1a1714',
  appointment: '#c9a84c',
  call:        '#2d6a9f',
  task:        '#4a7c59',
  training:    '#7c4d9f',
  travel:      '#8c8279',
  custom:      '#a0522d',
}
const STATUS_TABS = [
  { label: 'All',         value: '' },
  { label: 'Scheduled',   value: 'scheduled' },
  { label: 'Completed',   value: 'completed' },
  { label: 'Late',        value: 'late' },
  { label: 'Rescheduled', value: 'rescheduled' },
  { label: 'Missed',      value: 'missed' },
  { label: 'Cancelled',   value: 'cancelled' },
]

const EDITABLE_STATUSES = [
  { value: 'scheduled',   label: 'Scheduled' },
  { value: 'completed',   label: 'Completed' },
  { value: 'late',        label: 'Late' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'missed',      label: 'Missed' },
  { value: 'cancelled',   label: 'Cancelled' },
]

function toLocalInput(utc: string) {
  if (!utc) return ''
  const d = new Date(utc)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtDate(d: string, tz?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    ...(tz ? { timeZone: tz } : {}),
  })
}

function fmtTime(d: string, tz?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    ...(tz ? { timeZone: tz } : {}),
  })
}

// ── New / Edit Activity Modal ──────────────────────────────────────────────────
function ActivityFormModal({
  initial, onClose, onSaved,
}: {
  initial?: any; onClose: () => void; onSaved: (emailSent?: boolean) => void
}) {
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
  const isEdit = !!initial?.id

  const [form, setForm] = useState({
    client:        initial?.client        || '',
    activity_type: initial?.activity_type || 'session',
    status:        initial?.status        || 'scheduled',
    title:         initial?.title         || '',
    start_at:      initial?.start_at ? toLocalInput(initial.start_at) : '',
    end_at:        initial?.end_at   ? toLocalInput(initial.end_at)   : '',
    location:      initial?.location      || '',
    notes:         initial?.notes         || '',
  })
  const [sendConfirmation, setSendConfirmation] = useState(!isEdit)
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const toUTC = (local: string) => local ? new Date(local).toISOString() : local

  const handleSave = async () => {
    if (!form.client || !form.title || !form.start_at) return
    setSaving(true)
    const payload = { ...form, start_at: toUTC(form.start_at), end_at: form.end_at ? toUTC(form.end_at) : form.end_at }
    try {
      if (isEdit) {
        await activitiesApi.patch(initial.id, payload)
        onSaved()
      } else {
        await activitiesApi.create({ ...payload, send_confirmation: sendConfirmation })
        onSaved(sendConfirmation)
      }
    } catch { } finally { setSaving(false) }
  }

  return (
    <Modal
      title={isEdit ? 'Edit Activity' : 'Schedule Activity'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-dark btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Schedule'}
          </button>
        </>
      }
    >
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
            {(activityTypes as any[]).map((t: any) => (
              <option key={t.name} value={t.name}>{t.name.charAt(0).toUpperCase() + t.name.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>
      {isEdit && (
        <div className="fgroup">
          <label className="flabel">Status</label>
          <select className="fselect" value={form.status} onChange={e => set('status', e.target.value)}>
            {EDITABLE_STATUSES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      )}
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

      {!isEdit && (
        <div style={{
          marginTop: 16, padding: '12px 14px',
          background: 'var(--paper)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <input
            id="send_confirmation"
            type="checkbox"
            checked={sendConfirmation}
            onChange={e => setSendConfirmation(e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--gold)' }}
          />
          <label htmlFor="send_confirmation" style={{ fontSize: 13, cursor: 'pointer', lineHeight: 1.4 }}>
            <span style={{ fontWeight: 500, color: 'var(--ink)' }}>Send confirmation email + calendar invite</span>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
              Client gets a .ics file to add to their calendar, plus 24h and 1h reminders.
            </span>
          </label>
        </div>
      )}
    </Modal>
  )
}

// ── Notification Status Panel ─────────────────────────────────────────────────
function fmtShort(d: string | null) {
  if (!d) return null
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function NRow({ sent, sentAt, label, pending }: { sent: boolean; sentAt: string | null; label: string; pending?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
      {sent
        ? <CheckCircle2 size={14} color="var(--gold)" strokeWidth={2} />
        : pending
          ? <Circle size={14} color="var(--muted)" strokeWidth={1.5} />
          : <XCircle size={14} color="var(--muted)" strokeWidth={1.5} />}
      <span style={{ flex: 1, fontSize: 12, color: sent ? 'var(--ink)' : 'var(--muted)' }}>{label}</span>
      {sent && sentAt && (
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtShort(sentAt)}</span>
      )}
      {!sent && pending && (
        <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>pending</span>
      )}
    </div>
  )
}

function NotificationStatus({ activity }: { activity: any }) {
  const isScheduled = activity.status === 'scheduled'
  const isCancelled = activity.status === 'cancelled'
  return (
    <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Mail size={13} color="var(--muted)" />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>Client Notifications</span>
      </div>
      <NRow
        sent={!!activity.confirmation_sent_at}
        sentAt={activity.confirmation_sent_at}
        label="Confirmation + calendar invite"
      />
      <NRow
        sent={activity.reminder_24h_sent}
        sentAt={activity.reminder_24h_sent_at}
        label="24-hour reminder"
        pending={isScheduled}
      />
      <NRow
        sent={activity.reminder_1h_sent}
        sentAt={activity.reminder_1h_sent_at}
        label="1-hour reminder"
        pending={isScheduled}
      />
      {isCancelled && (
        <NRow
          sent={!!activity.cancellation_sent_at}
          sentAt={activity.cancellation_sent_at}
          label="Cancellation email"
        />
      )}
    </div>
  )
}

// ── Email Preview Modal ────────────────────────────────────────────────────────
function EmailPreviewModal({ activityId, defaultType = 'confirmation', onClose }: any) {
  const [type, setType] = useState<string>(defaultType)
  const [html, setHtml] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const loadPreview = async (t: string) => {
    setLoading(true)
    try {
      const { data } = await activitiesApi.emailPreview(activityId, t)
      setHtml(data.html || '')
    } catch { setHtml('') }
    finally { setLoading(false) }
  }

  useEffect(() => { loadPreview(type) }, [activityId, type])

  const EMAIL_TYPES = [
    { value: 'confirmation', label: 'Confirmation' },
    { value: 'reminder',     label: 'Reminder (24h)' },
    { value: 'cancellation', label: 'Cancellation' },
  ]

  return (
    <Modal title="Email Preview" onClose={onClose} size="lg"
      footer={<button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {EMAIL_TYPES.map(t => (
          <button key={t.value}
            className={`filter-pill${type === t.value ? ' active' : ''}`}
            onClick={() => setType(t.value)}>
            {t.label}
          </button>
        ))}
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading preview…</div>
      ) : html ? (
        <iframe srcDoc={html} title="Email Preview"
          style={{ width: '100%', height: 580, border: '1px solid var(--border)', borderRadius: 4 }}
          sandbox="allow-same-origin" />
      ) : (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Preview not available</div>
      )}
    </Modal>
  )
}

// ── Activity Detail Side Panel ─────────────────────────────────────────────────
function ActivityDetailModal({ activity, onClose, onMissed, onCancel, onEdit, onStatusChange }: any) {
  const isActive = ['scheduled', 'late', 'rescheduled'].includes(activity.status)
  const [showEmailPreview, setShowEmailPreview] = useState(false)

  return (
    <>
    <Modal
      title={activity.title}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: 8, width: '100%', flexWrap: 'wrap' }}>
          {isActive && (
            <button className="btn btn-sm btn-outline" onClick={() => onEdit(activity)} style={{ marginRight: 'auto' }}>
              Edit
            </button>
          )}
          <button className="btn btn-outline btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => setShowEmailPreview(true)}>
            <Mail size={12} /> Emails
          </button>
          <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
          {isActive && activity.status !== 'completed' && (
            <button className="btn btn-sm"
              style={{ background: '#16a085', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontWeight: 600 }}
              onClick={() => onStatusChange(activity.id, 'completed')}>
              Complete
            </button>
          )}
          {isActive && activity.status !== 'late' && (
            <button className="btn btn-sm"
              style={{ background: '#d97706', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontWeight: 600 }}
              onClick={() => onStatusChange(activity.id, 'late')}>
              Late
            </button>
          )}
          {isActive && activity.status !== 'rescheduled' && (
            <button className="btn btn-sm"
              style={{ background: '#2d6a9f', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontWeight: 600 }}
              onClick={() => onStatusChange(activity.id, 'rescheduled')}>
              Reschedule
            </button>
          )}
          {isActive && (
            <button
              className="btn btn-sm"
              style={{ background: 'var(--rust)', color: 'white', borderRadius: 'var(--radius-sm)' }}
              onClick={() => onMissed(activity.id)}
            >
              Missed
            </button>
          )}
          {isActive && (
            <button className="btn btn-danger btn-sm" onClick={() => onCancel(activity)}>
              Cancel
            </button>
          )}
        </div>
      }
    >
      <div className="kv"><span className="kvl">Client</span><span className="kvv">{activity.client_name}</span></div>
      <div className="kv"><span className="kvl">Type</span><span className="kvv" style={{ textTransform: 'capitalize' }}>{activity.activity_type}</span></div>
      <div className="kv"><span className="kvl">Status</span><span className="kvv"><StatusBadge status={activity.status} /></span></div>
      <div className="kv"><span className="kvl">Start</span><span className="kvv">{new Date(activity.start_at).toLocaleString()}</span></div>
      {activity.end_at && <div className="kv"><span className="kvl">End</span><span className="kvv">{new Date(activity.end_at).toLocaleString()}</span></div>}
      {activity.location && <div className="kv"><span className="kvl">Location</span><span className="kvv">{activity.location}</span></div>}
      {activity.notes && (
        <div style={{ marginTop: 12, fontSize: 13, color: '#555', lineHeight: 1.6, background: 'var(--paper)', padding: 12, borderRadius: 'var(--radius-sm)' }}>
          {activity.notes}
        </div>
      )}
      <NotificationStatus activity={activity} />
    </Modal>
    {showEmailPreview && (
      <EmailPreviewModal activityId={activity.id} onClose={() => setShowEmailPreview(false)} />
    )}
    </>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function Activities() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { show: showToast, el: toastEl } = useToast()

  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<any>(null)
  const [detailTarget, setDetailTarget] = useState<any>(null)
  const [cancelTarget, setCancelTarget] = useState<any>(null)

  const params: any = { page_size: 200 }
  if (statusFilter) params.status = statusFilter
  if (typeFilter)   params.activity_type = typeFilter

  const { data: workspace } = useQuery({
    queryKey: ['workspace'],
    queryFn: () => settingsApi.getWorkspace().then(r => r.data),
  })
  const tz: string | undefined = (workspace as any)?.workspace_timezone || undefined

  const { data: activityTypesList = [] } = useQuery({
    queryKey: ['activity-type-configs'],
    queryFn: () => settingsApi.getActivityTypes().then(r => r.data),
    select: (d: any[]) => d.filter(t => t.is_active),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['activities-list', statusFilter, typeFilter],
    queryFn: () => activitiesApi.list(params).then(r => r.data),
  })
  const activities: any[] = (data?.results || data || []).filter((a: any) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      a.title?.toLowerCase().includes(q) ||
      a.client_name?.toLowerCase().includes(q) ||
      a.location?.toLowerCase().includes(q)
    )
  })

  const handleMarkMissed = async (id: string) => {
    try {
      await activitiesApi.markMissed(id)
      qc.invalidateQueries({ queryKey: ['activities-list'] })
      setDetailTarget(null)
      showToast('Session marked as missed')
    } catch { showToast('Failed', 'error') }
  }

  const handleCancel = async () => {
    if (!cancelTarget) return
    try {
      await activitiesApi.cancel(cancelTarget.id)
      qc.invalidateQueries({ queryKey: ['activities-list'] })
      setDetailTarget(null)
      setCancelTarget(null)
      showToast('Session cancelled — client notified by email')
    } catch { showToast('Cancellation failed', 'error') }
  }

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      await activitiesApi.patch(id, { status: newStatus })
      qc.invalidateQueries({ queryKey: ['activities-list'] })
      setDetailTarget(null)
      const labels: Record<string, string> = { completed: 'Marked complete', late: 'Marked late', rescheduled: 'Marked rescheduled' }
      showToast(labels[newStatus] || 'Status updated')
    } catch { showToast('Failed to update status', 'error') }
  }

  return (
    <AppShell>
      <PageHeader
        title="Activities"
        subtitle="All scheduled and past sessions"
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline" onClick={() => navigate('/calendar')}>
              <CalendarDays size={13} /> Calendar view
            </button>
            <button className="btn btn-dark" onClick={() => setShowForm(true)}>
              + Schedule
            </button>
          </div>
        }
      />

      <div className="page-body">
        {/* Status tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
          {STATUS_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              style={{
                padding: '9px 18px',
                fontSize: 12, fontWeight: 600,
                background: 'none', border: 'none',
                cursor: 'pointer',
                color: statusFilter === tab.value ? 'var(--ink)' : 'var(--muted)',
                borderBottom: statusFilter === tab.value ? '2px solid var(--ink)' : '2px solid transparent',
                marginBottom: -1,
                transition: 'color .15s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div className="toolbar">
          <div className="search-box">
            <span className="search-icon"><User size={13} /></span>
            <input
              placeholder="Search by client, title, location…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            className="fselect"
            style={{ width: 'auto', minWidth: 130 }}
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
          >
            <option value="">All types</option>
            {(activityTypesList as any[]).map((t: any) => (
              <option key={t.name} value={t.name}>{t.name.charAt(0).toUpperCase() + t.name.slice(1)}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading…</div>
        ) : activities.length === 0 ? (
          <div className="empty">
            <div className="empty-icon"><CalendarDays size={36} strokeWidth={1} /></div>
            <h3>No activities found</h3>
            <p style={{ marginBottom: 16 }}>
              {statusFilter ? `No ${statusFilter} activities` : 'Schedule your first session to get started'}
            </p>
            <button className="btn btn-dark" onClick={() => setShowForm(true)}>+ Schedule Activity</button>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Client</th>
                <th>Type</th>
                <th>Title</th>
                <th>Location</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {activities.map((a: any) => (
                <tr key={a.id} onClick={() => setDetailTarget(a)}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CalendarDays size={12} color="var(--muted)" />
                      <span style={{ fontSize: 12 }}>{fmtDate(a.start_at, tz)}</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Clock size={12} color="var(--muted)" />
                      <span style={{ fontSize: 12 }}>{fmtTime(a.start_at, tz)}</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                      <User size={12} color="var(--muted)" />
                      {a.client_name}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: TYPE_COLOURS[a.activity_type] || '#8c8279', flexShrink: 0 }} />
                      <span style={{ textTransform: 'capitalize', fontSize: 12 }}>{a.activity_type}</span>
                    </div>
                  </td>
                  <td style={{ fontWeight: 500 }}>{a.title}</td>
                  <td>
                    {a.location ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--muted)' }}>
                        <MapPin size={11} />
                        <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {a.location}
                        </span>
                      </div>
                    ) : <span style={{ color: 'var(--border)' }}>—</span>}
                  </td>
                  <td><StatusBadge status={a.status} /></td>
                  <td style={{ textAlign: 'right' }}>
                    <ChevronRight size={14} color="var(--border)" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Schedule / Edit Form */}
      {(showForm || editTarget) && (
        <ActivityFormModal
          initial={editTarget}
          onClose={() => { setShowForm(false); setEditTarget(null) }}
          onSaved={(emailSent?: boolean) => {
            setShowForm(false)
            setEditTarget(null)
            qc.invalidateQueries({ queryKey: ['activities-list'] })
            if (editTarget) {
              showToast('Activity updated')
            } else {
              showToast(emailSent ? 'Activity scheduled — confirmation + calendar invite sent' : 'Activity scheduled')
            }
          }}
        />
      )}

      {/* Detail Modal */}
      {detailTarget && !editTarget && !cancelTarget && (
        <ActivityDetailModal
          activity={detailTarget}
          onClose={() => setDetailTarget(null)}
          onMissed={handleMarkMissed}
          onEdit={(a: any) => { setEditTarget(a); setDetailTarget(null) }}
          onCancel={(a: any) => { setCancelTarget(a); setDetailTarget(null) }}
          onStatusChange={handleStatusChange}
        />
      )}

      {/* Cancel Confirm */}
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
