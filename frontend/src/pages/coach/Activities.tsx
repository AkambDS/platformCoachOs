import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { activitiesApi, clientsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { PageHeader, Modal, StatusBadge, useToast, ConfirmDialog } from '../../components/ui'
import {
  CalendarDays, MapPin, User, Clock, ChevronRight,
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
const ACTIVITY_TYPES = ['appointment', 'task', 'call', 'session', 'training', 'travel', 'custom']

const STATUS_TABS = [
  { label: 'All',       value: '' },
  { label: 'Scheduled', value: 'scheduled' },
  { label: 'Completed', value: 'completed' },
  { label: 'Missed',    value: 'missed' },
  { label: 'Cancelled', value: 'cancelled' },
]

function fmt(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
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
  const clients: any[] = clientsData?.results || clientsData || []
  const isEdit = !!initial?.id

  const [form, setForm] = useState({
    client:        initial?.client        || '',
    activity_type: initial?.activity_type || 'session',
    title:         initial?.title         || '',
    start_at:      initial?.start_at ? initial.start_at.slice(0, 16) : '',
    end_at:        initial?.end_at   ? initial.end_at.slice(0, 16)   : '',
    location:      initial?.location      || '',
    notes:         initial?.notes         || '',
  })
  const [sendConfirmation, setSendConfirmation] = useState(!isEdit)
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.client || !form.title || !form.start_at) return
    setSaving(true)
    try {
      if (isEdit) {
        await activitiesApi.patch(initial.id, form)
        onSaved()
      } else {
        await activitiesApi.create({ ...form, send_confirmation: sendConfirmation })
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

// ── Activity Detail Side Panel ─────────────────────────────────────────────────
function ActivityDetailModal({ activity, onClose, onMissed, onCancel, onEdit }: any) {
  const canAct = activity.status === 'scheduled'
  return (
    <Modal
      title={activity.title}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          {canAct && (
            <button className="btn btn-sm btn-outline" onClick={() => onEdit(activity)} style={{ marginRight: 'auto' }}>
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
      {activity.status === 'scheduled' && (
        <div style={{ marginTop: 14, padding: '10px 12px', background: 'rgba(201,168,76,0.07)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          Client will receive automatic reminders <strong style={{ color: 'var(--ink)' }}>24 hours</strong> and{' '}
          <strong style={{ color: 'var(--ink)' }}>1 hour</strong> before this session.
        </div>
      )}
    </Modal>
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
            {ACTIVITY_TYPES.map(t => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
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
                <th>Date &amp; Time</th>
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
                      <Clock size={12} color="var(--muted)" />
                      <span style={{ fontSize: 12 }}>{fmt(a.start_at)}</span>
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
