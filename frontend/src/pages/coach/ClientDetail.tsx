import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clientsApi, activitiesApi, invoicesApi, pipelineApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { PageHeader, Modal, StatusBadge, useToast, EmptyState } from '../../components/ui'

const ACTIVITY_TYPES = ['appointment','task','call','session','training','travel','custom']
const GOAL_STATUSES  = ['active','completed','paused']

function initials(name: string) {
  return name?.split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase() || '?'
}

function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtDatetime(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ── New Activity Modal ────────────────────────────────────────────────────────
function NewActivityModal({ clientId, onClose, onSaved }: any) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    activity_type: 'session', title: '', start_at: '', end_at: '', location: '', notes: '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.title || !form.start_at) return
    setSaving(true)
    try {
      await activitiesApi.create({ ...form, client: clientId })
      qc.invalidateQueries({ queryKey: ['client-activities', clientId] })
      onSaved()
    } catch { } finally { setSaving(false) }
  }

  return (
    <Modal title="Schedule Activity" onClose={onClose} footer={
      <>
        <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-dark btn-sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Schedule'}</button>
      </>
    }>
      <div className="fgroup">
        <label className="flabel">Activity Type</label>
        <select className="fselect" value={form.activity_type} onChange={e => set('activity_type', e.target.value)}>
          {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select>
      </div>
      <div className="fgroup">
        <label className="flabel">Title</label>
        <input className="finput" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Q1 Coaching Session" />
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
        <input className="finput" value={form.location} onChange={e => set('location', e.target.value)} placeholder="Zoom link or office address" />
      </div>
      <div className="fgroup">
        <label className="flabel">Notes (internal)</label>
        <textarea className="ftextarea" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>
    </Modal>
  )
}

// ── New Goal Modal ─────────────────────────────────────────────────────────────
function NewGoalModal({ clientId, onClose, onSaved }: any) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ title: '', description: '', target_date: '', status: 'active' })
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.title) return
    setSaving(true)
    try {
      await clientsApi.createGoal(clientId, form)
      qc.invalidateQueries({ queryKey: ['client-goals', clientId] })
      onSaved()
    } catch { } finally { setSaving(false) }
  }

  return (
    <Modal title="New Goal" onClose={onClose} footer={
      <>
        <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-dark btn-sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Create Goal'}</button>
      </>
    }>
      <div className="fgroup">
        <label className="flabel">Goal Title</label>
        <input className="finput" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Improve executive presence" />
      </div>
      <div className="fgroup">
        <label className="flabel">Description</label>
        <textarea className="ftextarea" rows={3} value={form.description} onChange={e => set('description', e.target.value)} />
      </div>
      <div className="fgrid">
        <div className="fgroup">
          <label className="flabel">Target Date</label>
          <input className="finput" type="date" value={form.target_date} onChange={e => set('target_date', e.target.value)} />
        </div>
        <div className="fgroup">
          <label className="flabel">Status</label>
          <select className="fselect" value={form.status} onChange={e => set('status', e.target.value)}>
            {GOAL_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = ['Overview', 'Activities', 'Goals', 'Invoices']

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { show: showToast, el: toastEl } = useToast()
  const [tab, setTab] = useState('Overview')
  const [showActivity, setShowActivity] = useState(false)
  const [showGoal, setShowGoal] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState<any>(null)

  const { data: client, isLoading } = useQuery({
    queryKey: ['client', id],
    queryFn: () => clientsApi.get(id!).then(r => r.data),
    onSuccess: (d: any) => { if (!editForm) setEditForm(d) },
  })

  const { data: activities } = useQuery({
    queryKey: ['client-activities', id],
    queryFn: () => activitiesApi.list({ client: id, page_size: 50 }).then(r => r.data),
    enabled: tab === 'Activities',
  })

  const { data: goals } = useQuery({
    queryKey: ['client-goals', id],
    queryFn: () => clientsApi.listGoals(id!).then(r => r.data),
    enabled: tab === 'Goals',
  })

  const { data: invoices } = useQuery({
    queryKey: ['client-invoices', id],
    queryFn: () => invoicesApi.list({ client: id }).then(r => r.data),
    enabled: tab === 'Invoices',
  })

  const handleSave = async () => {
    try {
      await clientsApi.update(id!, editForm)
      qc.invalidateQueries({ queryKey: ['client', id] })
      qc.invalidateQueries({ queryKey: ['clients'] })
      setEditMode(false)
      showToast('Client updated')
    } catch { showToast('Failed to save', 'error') }
  }

  const handleMarkMissed = async (actId: string) => {
    try {
      await activitiesApi.markMissed(actId)
      qc.invalidateQueries({ queryKey: ['client-activities', id] })
      showToast('Session marked as missed')
    } catch { showToast('Failed', 'error') }
  }

  if (isLoading) return <AppShell><div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div></AppShell>
  if (!client) return <AppShell><div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>Client not found</div></AppShell>

  const ef = editForm || client
  const actList: any[] = activities?.results || activities || []
  const goalList: any[] = goals?.results || goals || []
  const invList: any[] = invoices?.results || invoices || []

  return (
    <AppShell>
      {/* Profile Header */}
      <div style={{ background: 'var(--white)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ padding: '24px 36px 0' }}>
          <button onClick={() => navigate('/clients')} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
            ← Back to Clients
          </button>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, marginBottom: 18 }}>
            <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Cormorant Garamond, serif', fontSize: 24, fontWeight: 300, flexShrink: 0 }}>
              {initials(client.first_name + ' ' + client.last_name)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 300, marginBottom: 4 }}>
                {client.first_name} {client.last_name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                {client.job_title && <span>{client.job_title}</span>}
                {client.company && <span>at {client.company}</span>}
                {client.email && <span style={{ color: 'var(--blue)' }}>{client.email}</span>}
                <span className={`pill ${client.active_flag ? 'pill-green' : 'pill-grey'}`}>{client.active_flag ? 'Active' : 'Inactive'}</span>
                {client.portal_access && <span className="pill pill-blue">Portal</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {editMode ? (
                <>
                  <button className="btn btn-outline btn-sm" onClick={() => setEditMode(false)}>Cancel</button>
                  <button className="btn btn-dark btn-sm" onClick={handleSave}>Save</button>
                </>
              ) : (
                <button className="btn btn-outline btn-sm" onClick={() => { setEditForm(client); setEditMode(true) }}>Edit</button>
              )}
              <button className="btn btn-gold btn-sm" onClick={() => setShowActivity(true)}>+ Schedule</button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderTop: '1px solid var(--border)' }}>
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '11px 18px', fontSize: 12, fontWeight: 500,
                color: tab === t ? 'var(--ink)' : 'var(--muted)',
                background: 'none', border: 'none',
                borderBottom: `2px solid ${tab === t ? 'var(--gold)' : 'transparent'}`,
                cursor: 'pointer', transition: 'all .15s',
              }}>{t}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="page-body">
        {/* ── Overview ── */}
        {tab === 'Overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20 }}>
            <div>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-hdr">Contact Details</div>
                <div className="card-body">
                  {editMode ? (
                    <div className="fgrid">
                      {['first_name','last_name','email','phone','company','job_title'].map(k => (
                        <div key={k} className="fgroup">
                          <label className="flabel">{k.replace('_', ' ')}</label>
                          <input className="finput" value={ef[k] || ''} onChange={e => setEditForm((f: any) => ({ ...f, [k]: e.target.value }))} />
                        </div>
                      ))}
                      <div className="fgroup full">
                        <label className="flabel">Notes</label>
                        <textarea className="ftextarea" rows={3} value={ef.notes || ''} onChange={e => setEditForm((f: any) => ({ ...f, notes: e.target.value }))} />
                      </div>
                    </div>
                  ) : (
                    <>
                      {[
                        ['Email', client.email], ['Phone', client.phone || '—'],
                        ['Company', client.company || '—'], ['Job Title', client.job_title || '—'],
                        ['Lead Source', client.lead_source || '—'], ['Birthday', client.birth_date ? fmtDate(client.birth_date) : '—'],
                      ].map(([k, v]) => (
                        <div key={k} className="kv"><span className="kvl">{k}</span><span className="kvv">{v}</span></div>
                      ))}
                      {client.notes && <div style={{ marginTop: 12, fontSize: 13, color: '#555', lineHeight: 1.6 }}>{client.notes}</div>}
                    </>
                  )}
                </div>
              </div>

              {/* Tags */}
              <div className="card">
                <div className="card-hdr">Tags</div>
                <div className="card-body">
                  {(client.tags || []).length === 0
                    ? <span style={{ fontSize: 13, color: 'var(--muted)' }}>No tags</span>
                    : (client.tags || []).map((t: string) => <span key={t} className="tag" style={{ marginRight: 6 }}>{t}</span>)
                  }
                </div>
              </div>
            </div>

            {/* Right panel */}
            <div>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-hdr">Quick Actions</div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button className="btn btn-dark" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setShowActivity(true)}>Schedule Session</button>
                  <button className="btn btn-outline" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setTab('Goals')}>Add Goal</button>
                  <button className="btn btn-outline" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setTab('Invoices')}>Create Invoice</button>
                </div>
              </div>
              <div className="card">
                <div className="card-hdr">Settings</div>
                <div className="card-body">
                  <div className="kv">
                    <span className="kvl">Active Flag</span>
                    <input type="checkbox" checked={editMode ? ef.active_flag : client.active_flag}
                      onChange={e => editMode && setEditForm((f: any) => ({ ...f, active_flag: e.target.checked }))}
                      disabled={!editMode} style={{ accentColor: 'var(--gold)' }} />
                  </div>
                  <div className="kv">
                    <span className="kvl">Portal Access</span>
                    <input type="checkbox" checked={editMode ? ef.portal_access : client.portal_access}
                      onChange={e => editMode && setEditForm((f: any) => ({ ...f, portal_access: e.target.checked }))}
                      disabled={!editMode} style={{ accentColor: 'var(--gold)' }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Activities ── */}
        {tab === 'Activities' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300 }}>Activities</div>
              <button className="btn btn-dark btn-sm" onClick={() => setShowActivity(true)}>+ Schedule</button>
            </div>
            {actList.length === 0
              ? <EmptyState icon="◷" title="No activities yet" message="Schedule your first session" />
              : (
                <table className="tbl">
                  <thead><tr><th>Title</th><th>Type</th><th>Start</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {actList.map((a: any) => (
                      <tr key={a.id}>
                        <td style={{ fontWeight: 500 }}>{a.title}</td>
                        <td style={{ textTransform: 'capitalize' }}>{a.activity_type}</td>
                        <td>{fmtDatetime(a.start_at)}</td>
                        <td><StatusBadge status={a.status} /></td>
                        <td>
                          {a.status === 'scheduled' && (
                            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--rust)' }}
                              onClick={() => handleMarkMissed(a.id)}>Mark Missed</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </>
        )}

        {/* ── Goals ── */}
        {tab === 'Goals' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300 }}>Goals</div>
              <button className="btn btn-dark btn-sm" onClick={() => setShowGoal(true)}>+ Add Goal</button>
            </div>
            {goalList.length === 0
              ? <EmptyState icon="◎" title="No goals set" message="Set your client's first coaching goal" />
              : goalList.map((g: any) => (
                <div key={g.id} className="card" style={{ marginBottom: 12, padding: '16px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 4 }}>{g.title}</div>
                      {g.description && <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{g.description}</div>}
                    </div>
                    <StatusBadge status={g.status} />
                  </div>
                  {g.target_date && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>Target: {fmtDate(g.target_date)}</div>}
                </div>
              ))
            }
          </>
        )}

        {/* ── Invoices ── */}
        {tab === 'Invoices' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300 }}>Invoices</div>
            </div>
            {invList.length === 0
              ? <EmptyState icon="$" title="No invoices" message="Create the first invoice for this client" />
              : (
                <table className="tbl">
                  <thead><tr><th>Invoice</th><th>Status</th><th>Total</th><th>Due</th><th></th></tr></thead>
                  <tbody>
                    {invList.map((inv: any) => (
                      <tr key={inv.id} onClick={() => navigate(`/invoices/${inv.id}`)}>
                        <td style={{ fontWeight: 600 }}>{inv.number}</td>
                        <td><StatusBadge status={inv.status} /></td>
                        <td style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16 }}>${inv.total}</td>
                        <td style={{ color: inv.status === 'overdue' ? 'var(--warn)' : 'inherit' }}>{fmtDate(inv.due_date)}</td>
                        <td style={{ color: 'var(--blue)', fontSize: 12 }}>View →</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </>
        )}
      </div>

      {showActivity && <NewActivityModal clientId={id} onClose={() => setShowActivity(false)} onSaved={() => { setShowActivity(false); showToast('Activity scheduled') }} />}
      {showGoal && <NewGoalModal clientId={id} onClose={() => setShowGoal(false)} onSaved={() => { setShowGoal(false); showToast('Goal created') }} />}
      {toastEl}
    </AppShell>
  )
}
