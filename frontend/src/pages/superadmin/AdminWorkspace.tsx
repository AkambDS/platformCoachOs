import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'

type Tab = 'overview' | 'clients' | 'invoices' | 'users' | 'activity_types' | 'errors' | 'pipeline' | 'statuses' | 'tags'

const PLAN_OPTIONS = ['trial', 'starter', 'growth', 'enterprise']
const PLAN_COLORS: Record<string, string> = {
  trial: 'pill-grey',
  starter: 'pill-blue',
  growth: 'pill-green',
  enterprise: 'pill-gold',
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86_400_000)
  const hours = Math.floor(diff / 3_600_000)
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AdminWorkspace() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [editPlan, setEditPlan] = useState(false)
  const [planDraft, setPlanDraft] = useState('')

  const { data: ws, isLoading } = useQuery({
    queryKey: ['admin', 'workspace', id],
    queryFn: () => adminApi.workspace(id!).then(r => r.data),
    enabled: !!id,
  })

  const { data: users = [] } = useQuery({
    queryKey: ['admin', 'workspace', id, 'users'],
    queryFn: () => adminApi.workspaceUsers(id!).then(r => r.data),
    enabled: !!id && tab === 'users',
  })

  // Activity types
  const { data: activityTypes = [], isLoading: typesLoading } = useQuery({
    queryKey: ['admin', 'workspace', id, 'activity_types'],
    queryFn: () => adminApi.activityTypes(id!).then(r => r.data),
    enabled: !!id && tab === 'activity_types',
  })
  const [editingTypeId, setEditingTypeId] = useState<number | null>(null)
  const [typeDraft, setTypeDraft] = useState<{ name: string; color: string; is_active: boolean; sort_order: number }>({ name: '', color: '#1a1714', is_active: true, sort_order: 0 })
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeColor, setNewTypeColor] = useState('#1a1714')

  const updateType = useMutation({
    mutationFn: (typeId: number) => adminApi.updateActivityType(id!, typeId, typeDraft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'workspace', id, 'activity_types'] })
      setEditingTypeId(null)
    },
  })

  const deleteType = useMutation({
    mutationFn: (typeId: number) => adminApi.deleteActivityType(id!, typeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'workspace', id, 'activity_types'] }),
  })

  const createType = useMutation({
    mutationFn: () => adminApi.createActivityType(id!, { name: newTypeName, color: newTypeColor }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'workspace', id, 'activity_types'] })
      setNewTypeName('')
      setNewTypeColor('#1a1714')
    },
  })

  const { data: errors = [] } = useQuery({
    queryKey: ['admin', 'workspace', id, 'errors'],
    queryFn: () => adminApi.workspaceErrors(id!).then(r => r.data),
    enabled: !!id && tab === 'errors',
  })

  const [expandedError, setExpandedError] = useState<number | null>(null)
  const [resetingId, setResetingId]       = useState<string | null>(null)
  const [resetFeedback, setResetFeedback] = useState<Record<string, string>>({})
  const [setPwdUserId, setSetPwdUserId]   = useState<string | null>(null)
  const [setPwdValue, setSetPwdValue]     = useState('')
  const [setPwdLoading, setSetPwdLoading] = useState(false)

  const handleResetPassword = async (userId: string, email: string) => {
    if (!window.confirm(`Send a password reset email to ${email}?`)) return
    setResetingId(userId)
    try {
      await adminApi.resetUserPassword(id!, userId)
      setResetFeedback(prev => ({ ...prev, [userId]: '✓ Reset email sent' }))
      setTimeout(() => setResetFeedback(prev => { const n = { ...prev }; delete n[userId]; return n }), 4000)
    } catch {
      setResetFeedback(prev => ({ ...prev, [userId]: '✗ Failed' }))
      setTimeout(() => setResetFeedback(prev => { const n = { ...prev }; delete n[userId]; return n }), 4000)
    } finally { setResetingId(null) }
  }

  const handleSetPassword = async (userId: string) => {
    if (setPwdValue.length < 8) return
    setSetPwdLoading(true)
    try {
      await adminApi.setUserPassword(id!, userId, setPwdValue)
      setResetFeedback(prev => ({ ...prev, [userId]: '✓ Password updated' }))
      setTimeout(() => setResetFeedback(prev => { const n = { ...prev }; delete n[userId]; return n }), 4000)
      setSetPwdUserId(null)
      setSetPwdValue('')
    } catch {
      setResetFeedback(prev => ({ ...prev, [userId]: '✗ Failed' }))
      setTimeout(() => setResetFeedback(prev => { const n = { ...prev }; delete n[userId]; return n }), 4000)
    } finally { setSetPwdLoading(false) }
  }

  const { data: invoices = [] } = useQuery({
    queryKey: ['admin', 'workspace', id, 'invoices'],
    queryFn: () => adminApi.workspaceInvoices(id!).then(r => r.data),
    enabled: !!id && tab === 'invoices',
  })

  const { data: stages = [], isLoading: stagesLoading } = useQuery({
    queryKey: ['admin', 'workspace', id, 'pipeline'],
    queryFn: () => adminApi.pipelineStages(id!).then(r => r.data),
    enabled: !!id && tab === 'pipeline',
  })

  const [stagesDraft, setStagesDraft] = useState<any[] | null>(null)
  const currentStages = stagesDraft ?? (stages as any[])

  // Client statuses
  const { data: clientStatuses = [] } = useQuery({
    queryKey: ['admin', 'workspace', id, 'client_statuses'],
    queryFn: () => adminApi.clientStatuses(id!).then(r => r.data),
    enabled: !!id && tab === 'statuses',
  })
  const [newStatusLabel, setNewStatusLabel] = useState('')
  const [newStatusColor, setNewStatusColor] = useState('#1a1714')
  const createStatus = useMutation({
    mutationFn: () => adminApi.createClientStatus(id!, { label: newStatusLabel, color: newStatusColor }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'workspace', id, 'client_statuses'] }); setNewStatusLabel(''); setNewStatusColor('#1a1714') },
  })
  const deleteStatus = useMutation({
    mutationFn: (sid: number) => adminApi.deleteClientStatus(id!, sid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'workspace', id, 'client_statuses'] }),
  })

  // Client tags
  const { data: clientTags = [] } = useQuery({
    queryKey: ['admin', 'workspace', id, 'client_tags'],
    queryFn: () => adminApi.clientTags(id!).then(r => r.data),
    enabled: !!id && tab === 'tags',
  })
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#1a1714')
  const createTag = useMutation({
    mutationFn: () => adminApi.createClientTag(id!, { name: newTagName, color: newTagColor }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'workspace', id, 'client_tags'] }); setNewTagName(''); setNewTagColor('#1a1714') },
  })
  const deleteTag = useMutation({
    mutationFn: (tid: number) => adminApi.deleteClientTag(id!, tid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'workspace', id, 'client_tags'] }),
  })

  const patchWs = useMutation({
    mutationFn: (d: any) => adminApi.patchWorkspace(id!, d),
    onSuccess: (res) => {
      qc.setQueryData(['admin', 'workspace', id], res.data)
      qc.invalidateQueries({ queryKey: ['admin', 'workspaces'] })
      setEditPlan(false)
    },
  })

  const saveStages = useMutation({
    mutationFn: () => adminApi.savePipelineStages(id!, currentStages),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'workspace', id, 'pipeline'] })
      setStagesDraft(null)
    },
  })

  if (isLoading) {
    return (
      <AppShell>
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
      </AppShell>
    )
  }

  if (!ws) {
    return (
      <AppShell>
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>Workspace not found.</div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      {/* Header */}
      <div style={{ background: 'var(--white)', borderBottom: '1px solid var(--border)', padding: '22px 36px 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <button
              onClick={() => navigate('/admin')}
              style={{ fontSize: 13, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 6 }}
            >
              ← Super Admin
            </button>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 32, fontWeight: 300 }}>{ws.name}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{ws.slug}</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 24 }}>
            {/* Plan badge / editor */}
            {editPlan ? (
              <>
                <select
                  className="form-input"
                  style={{ padding: '4px 10px', fontSize: 12 }}
                  value={planDraft}
                  onChange={e => setPlanDraft(e.target.value)}
                >
                  {PLAN_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <button className="btn btn-dark btn-sm" onClick={() => patchWs.mutate({ plan: planDraft })} disabled={patchWs.isPending}>
                  Save
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditPlan(false)}>Cancel</button>
              </>
            ) : (
              <button
                className={`pill ${PLAN_COLORS[ws.plan] || 'pill-grey'}`}
                style={{ cursor: 'pointer', border: 'none' }}
                title="Click to change plan"
                onClick={() => { setPlanDraft(ws.plan); setEditPlan(true) }}
              >
                {ws.plan}
              </button>
            )}

            {/* Active toggle */}
            <button
              className={`pill ${ws.is_active ? 'pill-green' : 'pill-grey'}`}
              style={{ cursor: 'pointer', border: 'none' }}
              title={ws.is_active ? 'Click to suspend' : 'Click to activate'}
              onClick={() => {
                if (window.confirm(ws.is_active ? 'Suspend this workspace?' : 'Activate this workspace?')) {
                  patchWs.mutate({ is_active: !ws.is_active })
                }
              }}
            >
              {ws.is_active ? 'Active' : 'Suspended'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderTop: '1px solid var(--border)', marginLeft: -36, marginRight: -36, paddingLeft: 36 }}>
          {(['overview', 'clients', 'invoices', 'users', 'activity_types', 'statuses', 'tags', 'errors', 'pipeline'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '11px 20px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                fontFamily: "'DM Sans', sans-serif",
                background: 'none', borderBottom: tab === t ? '2px solid var(--ink)' : '2px solid transparent',
                color: tab === t ? 'var(--ink)' : 'var(--muted)', transition: 'color .15s',
                position: 'relative',
              }}
            >
              {t === 'overview' ? 'Overview'
                : t === 'clients' ? 'Client'
                : t === 'invoices' ? 'Invoices'
                : t === 'users' ? 'Users'
                : t === 'activity_types' ? 'Activity Types'
                : t === 'statuses' ? 'Client Statuses'
                : t === 'tags' ? 'Client Tags'
                : t === 'errors'
                  ? <>Error log{ws.stats?.error_count > 0 && <span style={{ marginLeft: 6, background: '#dc2626', color: '#fff', borderRadius: 10, fontSize: 10, padding: '1px 6px', fontWeight: 700 }}>{ws.stats.error_count}</span>}</>
                  : 'Pipeline Stages'}
            </button>
          ))}
        </div>
      </div>

      <div className="page-body">
        {/* ── Overview tab ──────────────────────────────────── */}
        {tab === 'overview' && (
          <div>
            {/* Stat cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
              {[
                { label: 'Clients',     value: ws.stats?.clients   ?? '—', color: '#2d6a9f' },
                { label: 'Deals',       value: ws.stats?.deals     ?? '—', color: '#c8a96a' },
                { label: 'Invoices',    value: ws.stats?.invoices  ?? '—', color: '#1a1714' },
                { label: 'Activities',  value: ws.stats?.activities ?? '—', color: '#7c4d9f' },
              ].map(s => (
                <div key={s.label} style={{ background: 'var(--white)', border: '1px solid var(--border)', borderTop: `3px solid ${s.color}`, padding: '18px 22px' }}>
                  <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 36, fontWeight: 300 }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 24 }}>
              {/* Revenue */}
              <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderTop: '3px solid #4a7c59', padding: '18px 22px' }}>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 36, fontWeight: 300, color: '#4a7c59' }}>
                  {ws.stats ? `$${Number(ws.stats.revenue).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 4 }}>Revenue Collected</div>
              </div>
              {/* Outstanding */}
              <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderTop: `3px solid ${(ws.stats?.overdue ?? 0) > 0 ? '#e67e22' : '#94a3b8'}`, padding: '18px 22px' }}>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 36, fontWeight: 300, color: (ws.stats?.overdue ?? 0) > 0 ? '#e67e22' : 'var(--ink)' }}>
                  {ws.stats?.outstanding ?? '—'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 4 }}>
                  Outstanding invoices{(ws.stats?.overdue ?? 0) > 0 ? ` · ${ws.stats!.overdue} overdue` : ''}
                </div>
              </div>
              {/* Errors */}
              <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderTop: `3px solid ${(ws.stats?.error_count ?? 0) > 0 ? '#dc2626' : '#4a7c59'}`, padding: '18px 22px' }}>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 36, fontWeight: 300, color: (ws.stats?.error_count ?? 0) > 0 ? '#dc2626' : '#4a7c59' }}>
                  {ws.stats?.error_count ?? '—'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 4 }}>
                  {(ws.stats?.error_count ?? 0) > 0 ? 'Errors — check error log' : 'Errors — all clear'}
                </div>
              </div>
            </div>

            {/* Workspace info */}
            <div style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '20px 24px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 14, fontWeight: 600 }}>Workspace details</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Owner', value: ws.owner_name || '—' },
                  { label: 'Owner email', value: ws.owner_email || '—' },
                  { label: 'Created', value: new Date(ws.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) },
                  { label: 'Last activity', value: timeAgo(ws.last_activity) },
                  { label: 'Plan', value: ws.plan },
                  { label: 'Slug', value: ws.slug },
                  { label: 'Status', value: ws.is_active ? 'Active' : 'Suspended' },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Client tab (workspace owner profile) ──────────── */}
        {tab === 'clients' && (
          <div style={{ maxWidth: 640 }}>
            <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderTop: '3px solid var(--gold, #c8a96a)', padding: '24px 28px', marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, marginBottom: 16 }}>Account Owner</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: '50%', background: 'var(--ink)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--paper)', fontSize: 18, fontFamily: 'Cormorant Garamond, serif', flexShrink: 0,
                }}>
                  {(ws.owner_name || ws.owner_email || '?')[0].toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: 18, fontFamily: 'Cormorant Garamond, serif', fontWeight: 400 }}>{ws.owner_name || '—'}</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>{ws.owner_email || '—'}</div>
                </div>
              </div>
              {[
                { label: 'Plan', value: <span className={`pill ${({ trial:'pill-grey', starter:'pill-blue', growth:'pill-green', enterprise:'pill-gold' } as any)[ws.plan] || 'pill-grey'}`}>{ws.plan}</span> },
                { label: 'Status', value: <span className={`pill ${ws.is_active ? 'pill-green' : 'pill-grey'}`}>{ws.is_active ? 'Active' : 'Suspended'}</span> },
                { label: 'Workspace', value: ws.name },
                { label: 'Member since', value: ws.owner_joined ? new Date(ws.owner_joined).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—' },
                { label: 'Last login', value: timeAgo(ws.owner_last_login) },
                { label: 'Last activity', value: timeAgo(ws.last_activity) },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
                  <span style={{ fontSize: 13 }}>{value}</span>
                </div>
              ))}
            </div>
            <div style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '18px 28px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, marginBottom: 14 }}>Usage Summary</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {[
                  { label: 'Clients', value: ws.stats?.clients ?? '—' },
                  { label: 'Invoices', value: ws.stats?.invoices ?? '—' },
                  { label: 'Revenue', value: ws.stats ? `$${Number(ws.stats.revenue).toLocaleString()}` : '—' },
                  { label: 'Deals', value: ws.stats?.deals ?? '—' },
                  { label: 'Activities', value: ws.stats?.activities ?? '—' },
                  { label: 'Overdue', value: ws.stats?.overdue ?? '—' },
                ].map(s => (
                  <div key={s.label} style={{ textAlign: 'center', padding: '12px 8px', border: '1px solid var(--border)' }}>
                    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 300 }}>{s.value}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Invoices tab ──────────────────────────────────── */}
        {tab === 'invoices' && (
          (invoices as any[]).length === 0 ? (
            <div style={{ color: 'var(--muted)', padding: 60, textAlign: 'center', fontSize: 14 }}>No invoices yet.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>Paid</th>
                  <th>Issue date</th>
                  <th>Due date</th>
                </tr>
              </thead>
              <tbody>
                {(invoices as any[]).map((inv: any) => {
                  const statusColor: Record<string, string> = {
                    paid: 'pill-green', draft: 'pill-grey', sent: 'pill-blue',
                    overdue: 'pill-red', void: 'pill-grey', partially_paid: 'pill-gold',
                  }
                  const balance = inv.total - inv.amount_paid
                  return (
                    <tr key={inv.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{inv.number}</td>
                      <td style={{ fontWeight: 500 }}>{inv.client_name}</td>
                      <td><span className={`pill ${statusColor[inv.status] || 'pill-grey'}`} style={{ textTransform: 'capitalize' }}>{inv.status.replace('_', ' ')}</span></td>
                      <td style={{ textAlign: 'right', fontWeight: 500 }}>{inv.currency} {Number(inv.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                      <td style={{ textAlign: 'right', color: balance > 0 ? '#c0392b' : '#4a7c59' }}>
                        {inv.currency} {Number(inv.amount_paid).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ fontSize: 13, color: 'var(--muted)' }}>{inv.issue_date ? new Date(inv.issue_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                      <td style={{ fontSize: 13, color: inv.due_date && new Date(inv.due_date) < new Date() && inv.status !== 'paid' ? '#c0392b' : 'var(--muted)' }}>
                        {inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        )}

        {/* ── Users tab ─────────────────────────────────────── */}
        {tab === 'users' && (
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
                <th>Last login</th>
                <th>Activity (30d)</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(users as any[]).map((u: any) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600, fontSize: 14 }}>{u.full_name || '—'}</td>
                  <td style={{ fontSize: 13, color: 'var(--muted)' }}>{u.email}</td>
                  <td>
                    <span className="pill pill-grey" style={{ textTransform: 'capitalize' }}>
                      {u.role?.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--muted)' }}>
                    {new Date(u.date_joined).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--muted)' }}>{timeAgo(u.last_login)}</td>
                  <td style={{ fontSize: 14 }}>{u.activity_30d}</td>
                  <td>
                    <span className={`pill ${u.is_active ? 'pill-green' : 'pill-grey'}`}>
                      {u.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td>
                    {resetFeedback[u.id] ? (
                      <span style={{ fontSize: 12, color: resetFeedback[u.id].startsWith('✓') ? '#4a7c59' : '#c0392b' }}>
                        {resetFeedback[u.id]}
                      </span>
                    ) : setPwdUserId === u.id ? (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input
                          className="form-input"
                          type="password"
                          placeholder="New password (8+ chars)"
                          style={{ padding: '3px 7px', fontSize: 12, width: 170 }}
                          value={setPwdValue}
                          onChange={e => setSetPwdValue(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSetPassword(u.id); if (e.key === 'Escape') { setSetPwdUserId(null); setSetPwdValue('') } }}
                          autoFocus
                        />
                        <button
                          className="btn btn-dark btn-sm"
                          style={{ fontSize: 11 }}
                          disabled={setPwdLoading || setPwdValue.length < 8}
                          onClick={() => handleSetPassword(u.id)}
                        >
                          {setPwdLoading ? '…' : 'Save'}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 11 }}
                          onClick={() => { setSetPwdUserId(null); setSetPwdValue('') }}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-outline btn-sm"
                          style={{ fontSize: 11, whiteSpace: 'nowrap' }}
                          disabled={resetingId === u.id}
                          onClick={() => handleResetPassword(u.id, u.email)}
                        >
                          {resetingId === u.id ? 'Sending…' : 'Email reset'}
                        </button>
                        <button
                          className="btn btn-outline btn-sm"
                          style={{ fontSize: 11, whiteSpace: 'nowrap' }}
                          onClick={() => { setSetPwdUserId(u.id); setSetPwdValue('') }}
                        >
                          Set pwd
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {(users as any[]).length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 40 }}>No users</td></tr>
              )}
            </tbody>
          </table>
        )}

        {/* ── Activity Types tab ────────────────────────────── */}
        {tab === 'activity_types' && (
          <>
            {typesLoading ? (
              <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Loading…</div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Color</th>
                    <th>Name</th>
                    <th>Sort</th>
                    <th>Active</th>
                    <th>Type</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(activityTypes as any[]).map((t: any) => {
                    const isEditing = editingTypeId === t.id
                    return (
                      <tr key={t.id}>
                        <td>
                          {isEditing ? (
                            <input
                              type="color"
                              value={typeDraft.color}
                              onChange={e => setTypeDraft(d => ({ ...d, color: e.target.value }))}
                              style={{ width: 32, height: 28, border: '1px solid var(--border)', cursor: 'pointer', padding: 2 }}
                            />
                          ) : (
                            <div style={{ width: 24, height: 24, borderRadius: 4, background: t.color, border: '1px solid var(--border)' }} />
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <input
                              className="form-input"
                              style={{ padding: '4px 8px', fontSize: 13 }}
                              value={typeDraft.name}
                              onChange={e => setTypeDraft(d => ({ ...d, name: e.target.value }))}
                            />
                          ) : (
                            <span style={{ fontSize: 14, fontWeight: 500 }}>{t.name}</span>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <input
                              className="form-input"
                              type="number"
                              min={0}
                              style={{ padding: '4px 8px', fontSize: 13, width: 70 }}
                              value={typeDraft.sort_order}
                              onChange={e => setTypeDraft(d => ({ ...d, sort_order: Number(e.target.value) }))}
                            />
                          ) : (
                            <span style={{ fontSize: 13, color: 'var(--muted)' }}>{t.sort_order}</span>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <input
                              type="checkbox"
                              checked={typeDraft.is_active}
                              onChange={e => setTypeDraft(d => ({ ...d, is_active: e.target.checked }))}
                            />
                          ) : (
                            <span className={`pill ${t.is_active ? 'pill-green' : 'pill-grey'}`}>
                              {t.is_active ? 'Active' : 'Inactive'}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`pill ${t.is_builtin ? 'pill-blue' : 'pill-grey'}`} style={{ fontSize: 11 }}>
                            {t.is_builtin ? 'built-in' : 'custom'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            {isEditing ? (
                              <>
                                <button
                                  className="btn btn-dark btn-sm"
                                  disabled={updateType.isPending}
                                  onClick={() => updateType.mutate(t.id)}
                                >
                                  {updateType.isPending ? 'Saving…' : 'Save'}
                                </button>
                                <button className="btn btn-ghost btn-sm" onClick={() => setEditingTypeId(null)}>
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => {
                                    setEditingTypeId(t.id)
                                    setTypeDraft({ name: t.name, color: t.color, is_active: t.is_active, sort_order: t.sort_order })
                                  }}
                                >
                                  Edit
                                </button>
                                {!t.is_builtin && (
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    style={{ color: 'var(--danger, #c0392b)' }}
                                    onClick={() => {
                                      if (window.confirm(`Delete "${t.name}"?`)) deleteType.mutate(t.id)
                                    }}
                                  >
                                    Delete
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}

                  {/* Add new type row */}
                  <tr style={{ background: 'var(--paper)' }}>
                    <td>
                      <input
                        type="color"
                        value={newTypeColor}
                        onChange={e => setNewTypeColor(e.target.value)}
                        style={{ width: 32, height: 28, border: '1px solid var(--border)', cursor: 'pointer', padding: 2 }}
                      />
                    </td>
                    <td colSpan={3}>
                      <input
                        className="form-input"
                        placeholder="New activity type name…"
                        style={{ padding: '4px 8px', fontSize: 13, width: '100%' }}
                        value={newTypeName}
                        onChange={e => setNewTypeName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && newTypeName.trim()) createType.mutate() }}
                      />
                    </td>
                    <td></td>
                    <td>
                      <button
                        className="btn btn-dark btn-sm"
                        disabled={!newTypeName.trim() || createType.isPending}
                        onClick={() => createType.mutate()}
                      >
                        {createType.isPending ? 'Adding…' : '+ Add'}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </>
        )}

        {/* ── Error log tab ─────────────────────────────────── */}
        {tab === 'errors' && (
          (errors as any[]).length === 0 ? (
            <div style={{ color: 'var(--muted)', padding: 60, textAlign: 'center', fontSize: 14 }}>
              No errors recorded — looking good.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(errors as any[]).map((e: any) => (
                <div key={e.id} style={{
                  background: 'var(--white)', border: '1px solid var(--border)',
                  borderLeft: `4px solid ${e.severity === 'critical' ? '#7c3aed' : e.severity === 'warning' ? '#d97706' : '#dc2626'}`,
                  padding: '14px 18px',
                }}>
                  {/* Header row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                        <span className={`pill ${e.severity === 'critical' ? 'pill-red' : e.severity === 'warning' ? 'pill-gold' : 'pill-red'}`}
                          style={{ fontSize: 10, textTransform: 'uppercase' }}>
                          {e.severity}
                        </span>
                        <span className="pill pill-grey" style={{ fontSize: 10 }}>{e.source}</span>
                        <code style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 600 }}>{e.error_type}</code>
                        {e.endpoint && (
                          <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{e.endpoint}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 6, wordBreak: 'break-word' }}>{e.message}</div>
                      {/* Suggestion */}
                      <div style={{
                        fontSize: 12, color: '#1B3A6B', background: '#f0f4fa',
                        border: '1px solid #c7d5ec', padding: '6px 10px', marginBottom: 4,
                      }}>
                        <strong>Suggestion:</strong> {e.suggestion}
                      </div>
                      {/* Meta */}
                      <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 16 }}>
                        <span>{timeAgo(e.created_at)}</span>
                        {e.user && <span>by {e.user} ({e.user_email})</span>}
                      </div>
                    </div>
                    {/* Traceback toggle */}
                    {e.traceback && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ whiteSpace: 'nowrap', fontSize: 11 }}
                        onClick={() => setExpandedError(expandedError === e.id ? null : e.id)}
                      >
                        {expandedError === e.id ? 'Hide trace' : 'Show trace'}
                      </button>
                    )}
                  </div>
                  {/* Traceback */}
                  {expandedError === e.id && e.traceback && (
                    <pre style={{
                      marginTop: 12, padding: '10px 14px', background: '#1a1a2e',
                      color: '#e2e8f0', fontSize: 11, lineHeight: 1.5,
                      overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                      maxHeight: 320, overflowY: 'auto',
                    }}>{e.traceback}</pre>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {/* ── Pipeline stages tab ───────────────────────────── */}
        {tab === 'pipeline' && (
          <>
            {stagesLoading ? (
              <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Loading…</div>
            ) : (
              <>
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  {stagesDraft && (
                    <>
                      <button className="btn btn-ghost btn-sm" onClick={() => setStagesDraft(null)}>Discard</button>
                      <button className="btn btn-dark btn-sm" onClick={() => saveStages.mutate()} disabled={saveStages.isPending}>
                        {saveStages.isPending ? 'Saving…' : 'Save stages'}
                      </button>
                    </>
                  )}
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setStagesDraft(d => [...(d ?? (stages as any[])), {
                      slug: `stage_${Date.now()}`, label: 'New Stage', color: '#1e3a5f', order: (d ?? (stages as any[])).length, follow_up_days: null, notify_owner: true,
                    }])}
                  >
                    + Add stage
                  </button>
                </div>

                <table className="tbl">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Slug</th>
                      <th>Label</th>
                      <th>Color</th>
                      <th>Follow-up days</th>
                      <th>Notify owner</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentStages.map((s: any, i: number) => {
                      const update = (field: string, val: any) => {
                        setStagesDraft(prev => {
                          const arr = [...(prev ?? (stages as any[]))]
                          arr[i] = { ...arr[i], [field]: val }
                          return arr
                        })
                      }
                      return (
                        <tr key={s.slug}>
                          <td style={{ fontSize: 13, color: 'var(--muted)' }}>{i + 1}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{s.slug}</td>
                          <td>
                            <input
                              className="form-input"
                              style={{ padding: '4px 8px', fontSize: 13 }}
                              value={s.label}
                              onChange={e => update('label', e.target.value)}
                            />
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <input type="color" value={s.color} onChange={e => update('color', e.target.value)}
                                style={{ width: 32, height: 28, border: '1px solid var(--border)', cursor: 'pointer', padding: 2 }} />
                              <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--muted)' }}>{s.color}</span>
                            </div>
                          </td>
                          <td>
                            <input
                              className="form-input"
                              style={{ padding: '4px 8px', fontSize: 13, width: 80 }}
                              type="number"
                              min={0}
                              placeholder="—"
                              value={s.follow_up_days ?? ''}
                              onChange={e => update('follow_up_days', e.target.value ? Number(e.target.value) : null)}
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={s.notify_owner}
                              onChange={e => update('notify_owner', e.target.checked)}
                            />
                          </td>
                          <td>
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ color: 'var(--danger, #c0392b)', fontSize: 12 }}
                              onClick={() => setStagesDraft(prev => {
                                const arr = [...(prev ?? (stages as any[]))]
                                arr.splice(i, 1)
                                return arr.map((x, j) => ({ ...x, order: j }))
                              })}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                    {currentStages.length === 0 && (
                      <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 40 }}>No stages configured</td></tr>
                    )}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}

        {/* ── Client Statuses tab ───────────────────────────── */}
        {tab === 'statuses' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Add new */}
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px' }}>
              <div style={{ fontSize: 10, letterSpacing: '.12em', fontWeight: 600, color: 'var(--muted)', marginBottom: 12 }}>ADD STATUS</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input className="finput" style={{ margin: 0, flex: 1 }} placeholder="Status label…"
                  value={newStatusLabel} onChange={e => setNewStatusLabel(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && newStatusLabel.trim() && createStatus.mutate()} />
                <input type="color" value={newStatusColor} onChange={e => setNewStatusColor(e.target.value)}
                  style={{ width: 36, height: 36, border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', padding: 2 }} />
                <button className="btn btn-dark btn-sm" onClick={() => newStatusLabel.trim() && createStatus.mutate()}
                  disabled={createStatus.isPending || !newStatusLabel.trim()}>
                  {createStatus.isPending ? 'Adding…' : '+ Add'}
                </button>
              </div>
            </div>

            {/* List */}
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <table className="tbl" style={{ margin: 0 }}>
                <thead><tr><th>Label</th><th>Color</th><th>Built-in</th><th></th></tr></thead>
                <tbody>
                  {(clientStatuses as any[]).length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: 32 }}>No statuses yet</td></tr>
                  )}
                  {(clientStatuses as any[]).map((s: any) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 500 }}>{s.label}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 14, height: 14, borderRadius: '50%', background: s.color, display: 'inline-block', border: '1px solid var(--border)' }} />
                          <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>{s.color}</span>
                        </span>
                      </td>
                      <td><span style={{ fontSize: 11, color: s.is_builtin ? 'var(--muted)' : 'var(--success)' }}>{s.is_builtin ? 'Yes' : 'Custom'}</span></td>
                      <td>
                        {!s.is_builtin && (
                          <button className="btn btn-ghost btn-sm" style={{ color: '#c0392b' }}
                            onClick={() => window.confirm(`Delete "${s.label}"?`) && deleteStatus.mutate(s.id)}>
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Client Tags tab ───────────────────────────────── */}
        {tab === 'tags' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Add new */}
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px' }}>
              <div style={{ fontSize: 10, letterSpacing: '.12em', fontWeight: 600, color: 'var(--muted)', marginBottom: 12 }}>ADD TAG</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input className="finput" style={{ margin: 0, flex: 1 }} placeholder="Tag name…"
                  value={newTagName} onChange={e => setNewTagName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && newTagName.trim() && createTag.mutate()} />
                <input type="color" value={newTagColor} onChange={e => setNewTagColor(e.target.value)}
                  style={{ width: 36, height: 36, border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', padding: 2 }} />
                <button className="btn btn-dark btn-sm" onClick={() => newTagName.trim() && createTag.mutate()}
                  disabled={createTag.isPending || !newTagName.trim()}>
                  {createTag.isPending ? 'Adding…' : '+ Add'}
                </button>
              </div>
            </div>

            {/* List */}
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <table className="tbl" style={{ margin: 0 }}>
                <thead><tr><th>Name</th><th>Color</th><th>Preview</th><th></th></tr></thead>
                <tbody>
                  {(clientTags as any[]).length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: 32 }}>No tags yet</td></tr>
                  )}
                  {(clientTags as any[]).map((t: any) => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 500 }}>{t.name}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 14, height: 14, borderRadius: '50%', background: t.color, display: 'inline-block', border: '1px solid var(--border)' }} />
                          <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>{t.color}</span>
                        </span>
                      </td>
                      <td>
                        <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: t.color + '22', color: t.color }}>
                          {t.name}
                        </span>
                      </td>
                      <td>
                        <button className="btn btn-ghost btn-sm" style={{ color: '#c0392b' }}
                          onClick={() => window.confirm(`Delete tag "${t.name}"?`) && deleteTag.mutate(t.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
