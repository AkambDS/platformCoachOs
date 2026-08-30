import { useState, Fragment } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../../api/client'
import AdminShell from '../../components/layout/AdminShell'

type Tab = 'overview' | 'errors' | 'audit' | 'email'

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

// Shared by the Audit Log table and the Error Log tab's "recent actions" list — both
// render the same AccessLog shape, just scoped differently (last 20 for the workspace
// vs. one user's last 5 before a specific error).
function fmtDT(s: string | null | undefined): string | null {
  if (!s) return null
  return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatAuditDetail(meta: Record<string, any> | null | undefined): string {
  const m = meta || {}
  return m.file_name
    || m.note_preview
    || (Object.keys(m).length > 0
        ? Object.entries(m).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ')
        : '')
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

  const { data: errors = [] } = useQuery({
    queryKey: ['admin', 'workspace', id, 'errors'],
    queryFn: () => adminApi.workspaceErrors(id!).then(r => r.data),
    enabled: !!id,
  })

  const { data: auditLogs = [] } = useQuery({
    queryKey: ['admin', 'workspace', id, 'audit'],
    queryFn: () => adminApi.workspaceAuditLog(id!).then(r => r.data),
    enabled: !!id && tab === 'audit',
  })

  const { data: emailDiag } = useQuery({
    queryKey: ['admin', 'workspace', id, 'email-diagnostics'],
    queryFn: () => adminApi.workspaceEmailDiagnostics(id!).then(r => r.data),
    enabled: !!id,
  })
  const emailActivities: any[] = emailDiag?.activities || []
  // Flags a session as worth a look: the client has an email on file, the session
  // wasn't cancelled, but no confirmation email ever recorded as sent.
  const emailIssueCount = emailActivities.filter(
    (a) => a.client_email && a.status !== 'cancelled' && !a.confirmation_sent_at
  ).length

  const [expandedError, setExpandedError] = useState<number | null>(null)
  const [expandedEmailRow, setExpandedEmailRow] = useState<string | null>(null)
  const [resendCategory, setResendCategory] = useState<Record<string, string>>({})

  const resendEmail = useMutation({
    mutationFn: ({ activityId, category }: { activityId: string; category: string }) =>
      adminApi.resendActivityEmail(id!, activityId, category),
    onSuccess: () => {
      // Dispatched through Celery, not instant — give the worker a moment to actually
      // send before pulling fresh EmailLog rows.
      setTimeout(() => qc.invalidateQueries({ queryKey: ['admin', 'workspace', id, 'email-diagnostics'] }), 2500)
    },
  })

  const patchWs = useMutation({
    mutationFn: (d: any) => adminApi.patchWorkspace(id!, d),
    onSuccess: (res) => {
      qc.setQueryData(['admin', 'workspace', id], res.data)
      qc.invalidateQueries({ queryKey: ['admin', 'workspaces'] })
      setEditPlan(false)
    },
  })

  if (isLoading) {
    return (
      <AdminShell>
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
      </AdminShell>
    )
  }

  if (!ws) {
    return (
      <AdminShell>
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>Workspace not found.</div>
      </AdminShell>
    )
  }

  return (
    <AdminShell>
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
              className={`pill ${ws.is_active ? 'pill-green' : ws.pending_activation ? 'pill-gold' : 'pill-grey'}`}
              style={{ cursor: 'pointer', border: 'none' }}
              title={ws.is_active ? 'Click to suspend' : 'Click to activate'}
              onClick={() => {
                const msg = ws.is_active
                  ? 'Suspend this workspace?'
                  : ws.pending_activation
                    ? 'Activate this workspace? The owner will be able to log in.'
                    : 'Activate this workspace?'
                if (window.confirm(msg)) {
                  patchWs.mutate({ is_active: !ws.is_active })
                }
              }}
            >
              {ws.is_active ? 'Active' : ws.pending_activation ? 'Pending Activation' : 'Suspended'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderTop: '1px solid var(--border)', marginLeft: -36, marginRight: -36, paddingLeft: 36 }}>
          {(['overview', 'errors', 'audit', 'email'] as Tab[]).map(t => (
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
                : t === 'errors'
                  ? <>Error Log{ws.stats?.error_count > 0 && <span style={{ marginLeft: 6, background: '#dc2626', color: '#fff', borderRadius: 10, fontSize: 10, padding: '1px 6px', fontWeight: 700 }}>{ws.stats.error_count}</span>}</>
                  : t === 'audit'
                    ? 'Audit Log'
                    : <>Email Diagnostics{emailIssueCount > 0 && <span style={{ marginLeft: 6, background: '#dc2626', color: '#fff', borderRadius: 10, fontSize: 10, padding: '1px 6px', fontWeight: 700 }}>{emailIssueCount}</span>}</>}
            </button>
          ))}
        </div>
      </div>

      <div className="page-body">
        {/* ── Overview tab ──────────────────────────────────── */}
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ── Owner section ───────────────────── */}
            <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderTop: '3px solid var(--ink)', padding: '20px 24px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, marginBottom: 16 }}>Owner Activity</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                {[
                  { label: 'Owner name',      value: ws.owner_name || '—' },
                  { label: 'Owner email',     value: ws.owner_email || '—' },
                  { label: 'Last login',      value: timeAgo(ws.owner_last_login), highlight: true },
                  { label: 'Last activity',   value: timeAgo(ws.last_activity), highlight: true },
                ].map(({ label, value, highlight }) => (
                  <div key={label} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 24 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: highlight ? 600 : 500, color: highlight ? 'var(--ink)' : undefined }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Workspace settings ──────────────── */}
            <div style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600 }}>Workspace Settings</div>
                {ws.is_active ? (
                  <button className="btn btn-outline btn-sm" style={{ fontSize: 12, color: '#c0392b', borderColor: '#f5c6c2' }}
                    onClick={() => { if (window.confirm('Suspend this workspace? The owner will not be able to log in.')) patchWs.mutate({ is_active: false }) }}
                    disabled={patchWs.isPending}>Suspend Access</button>
                ) : (
                  <button className="btn btn-dark btn-sm" style={{ fontSize: 12 }}
                    onClick={() => { if (window.confirm('Restore access for this workspace?')) patchWs.mutate({ is_active: true }) }}
                    disabled={patchWs.isPending}>Restore Access</button>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                {[
                  { label: 'Plan',    value: ws.plan },
                  { label: 'Status',  value: ws.is_active ? 'Active' : ws.pending_activation ? 'Pending Activation' : 'Suspended' },
                  { label: 'Created', value: new Date(ws.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) },
                  { label: 'Slug',    value: ws.slug },
                ].map(({ label, value }) => (
                  <div key={label} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 24 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Last 10 errors ──────────────────── */}
            <div style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600 }}>
                  Last 10 Errors
                </div>
                {ws.stats?.error_count > 0 && (
                  <span className="pill pill-red" style={{ fontSize: 11 }}>{ws.stats.error_count} total</span>
                )}
              </div>
              {(errors as any[]).length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--muted)', padding: '12px 0' }}>No errors recorded — looking good.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(errors as any[]).slice(0, 10).map((e: any) => (
                    <div key={e.id} style={{
                      padding: '10px 14px', borderRadius: 4,
                      borderLeft: `3px solid ${e.severity === 'critical' ? '#7c3aed' : e.severity === 'warning' ? '#d97706' : '#dc2626'}`,
                      background: 'var(--paper)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span className={`pill ${e.severity === 'critical' ? 'pill-red' : e.severity === 'warning' ? 'pill-gold' : 'pill-red'}`} style={{ fontSize: 10 }}>{e.severity}</span>
                        <code style={{ fontSize: 12, fontWeight: 600 }}>{e.error_type}</code>
                        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>{timeAgo(e.created_at)}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}


        {/* ── Error log tab ─────────────────────────────────── */}
        {tab === 'errors' && (
          (errors as any[]).length === 0 ? (
            <div style={{ color: 'var(--muted)', padding: 60, textAlign: 'center', fontSize: 14 }}>
              No errors recorded — looking good.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
                Showing latest {(errors as any[]).length} error{(errors as any[]).length !== 1 ? 's' : ''} (most recent first, max 10)
              </div>
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
                      {/* What this user was doing right before the error — same
                          AccessLog rows the Audit Log tab shows, scoped to this one
                          user and capped to just-before this error's timestamp. */}
                      {(e.recent_actions || []).length > 0 && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>
                            User's actions leading up to this
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {e.recent_actions.map((a: any, ai: number) => {
                              const detail = formatAuditDetail(a.metadata)
                              return (
                                <div key={ai} style={{ fontSize: 11.5, color: 'var(--ink)', display: 'flex', gap: 8 }}>
                                  <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{timeAgo(a.created_at)}</span>
                                  <span style={{ fontWeight: 600 }}>{a.action.replace(/_/g, ' ')}</span>
                                  {a.client_name && <span style={{ color: 'var(--muted)' }}>· {a.client_name}</span>}
                                  {detail && <span style={{ color: 'var(--muted)' }}>· {detail}</span>}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
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

        {/* ── Audit Log tab ──────────────────────────────────── */}
        {tab === 'audit' && (
          <div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              Last 20 access events — clients, team, notes, files, goals
            </div>
            {(auditLogs as any[]).length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>No access events recorded yet.</div>
            ) : (
              <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600 }}>When</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600 }}>User</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600 }}>Client</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600 }}>Action</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600 }}>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(auditLogs as any[]).map((log: any, i: number) => {
                      const detail = formatAuditDetail(log.metadata)
                      return (
                        <tr key={log.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--white)' : 'var(--surface)' }}>
                          <td style={{ padding: '9px 16px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{timeAgo(log.created_at)}</td>
                          <td style={{ padding: '9px 16px' }}>{log.user_name || '—'}</td>
                          <td style={{ padding: '9px 16px' }}>{log.client_name || '—'}</td>
                          <td style={{ padding: '9px 16px' }}>
                            <span style={{
                              padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                              background: log.action.includes('deleted') ? '#fde8e8' : log.action.includes('downloaded') || log.action.includes('uploaded') ? '#e8f0ff' : '#f0f0f0',
                              color: log.action.includes('deleted') ? '#c0392b' : log.action.includes('downloaded') || log.action.includes('uploaded') ? '#2563eb' : 'var(--ink)',
                            }}>
                              {log.action.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td style={{ padding: '9px 16px', color: 'var(--muted)', fontSize: 12, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {detail || '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Email diagnostics tab ─────────────────────────────
             Reconstructs, per session: scheduled → confirmation email sent →
             how/when the client responded (tokenized link vs native Google
             Calendar RSVP) → reminders sent. Lets support trace a "client
             never got the email" report without SSHing into the box. */}
        {tab === 'email' && (
          <div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              Latest {emailActivities.length} scheduled session{emailActivities.length !== 1 ? 's' : ''} in this workspace.
              {emailIssueCount > 0 && (
                <strong style={{ color: '#c0392b' }}> {emailIssueCount} have a client email on file but no confirmation ever recorded as sent.</strong>
              )}
            </div>
            {emailActivities.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>No sessions scheduled yet.</div>
            ) : (
              <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Session</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Client</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Scheduled</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Confirmation Sent</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Client Response</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Reminders</th>
                      <th style={{ padding: '10px 14px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {emailActivities.map((a: any, i: number) => {
                      const noConfirmation = a.client_email && a.status !== 'cancelled' && !a.confirmation_sent_at
                      const responseLabel =
                        a.rsvp_method === 'google_calendar'
                          ? `${a.client_rsvp_status === 'accepted' ? 'Accepted' : a.client_rsvp_status === 'declined' ? 'Declined' : a.client_rsvp_status === 'tentative' ? 'Tentative' : 'Needs action'} · Google Calendar`
                          : a.rsvp_method === 'confirm_link'
                            ? 'Confirmed · email link'
                            : null
                      const responseAt = a.rsvp_method === 'google_calendar' ? a.client_rsvp_synced_at : a.client_confirmed_at
                      return (
                        <Fragment key={a.id}>
                          <tr style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--white)' : 'var(--surface)' }}>
                            <td style={{ padding: '9px 14px' }}>
                              <div style={{ fontWeight: 500 }}>{a.title}</div>
                              <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span>{a.activity_type} · {a.status}</span>
                                <span className={`pill ${a.google_calendar_synced ? 'pill-blue' : 'pill-grey'}`} style={{ fontSize: 9 }} title={a.google_calendar_synced ? 'This session is synced to Google Calendar — the client\'s RSVP path is the native invite, not the email link.' : 'Not synced to Google Calendar — the client confirms via the link in the email.'}>
                                  {a.google_calendar_synced ? 'GCal synced' : 'no GCal'}
                                </span>
                              </div>
                            </td>
                            <td style={{ padding: '9px 14px' }}>
                              <div>{a.client_name || '—'}</div>
                              {a.client_email && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{a.client_email}</div>}
                            </td>
                            <td style={{ padding: '9px 14px', whiteSpace: 'nowrap' }}>
                              <div>{fmtDT(a.start_at)}</div>
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>booked {timeAgo(a.created_at)}</div>
                            </td>
                            <td style={{ padding: '9px 14px', whiteSpace: 'nowrap' }}>
                              {a.confirmation_sent_at ? (
                                <span style={{ color: '#2e7d4f' }}>{fmtDT(a.confirmation_sent_at)}</span>
                              ) : a.status === 'cancelled' ? (
                                <span style={{ color: 'var(--muted)' }}>— cancelled</span>
                              ) : a.client_email ? (
                                <span className="pill pill-red" style={{ fontSize: 11 }}>Not sent</span>
                              ) : (
                                <span style={{ color: 'var(--muted)' }}>no client email</span>
                              )}
                            </td>
                            <td style={{ padding: '9px 14px', whiteSpace: 'nowrap' }}>
                              {responseLabel ? (
                                <>
                                  <div>{responseLabel}</div>
                                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtDT(responseAt)}</div>
                                </>
                              ) : (
                                <span style={{ color: 'var(--muted)' }}>No response yet</span>
                              )}
                            </td>
                            <td style={{ padding: '9px 14px', whiteSpace: 'nowrap', fontSize: 12 }}>
                              <div style={{ color: a.reminder_24h_sent_at ? 'var(--ink)' : 'var(--muted)' }}>24h: {fmtDT(a.reminder_24h_sent_at) || '—'}</div>
                              <div style={{ color: a.reminder_1h_sent_at ? 'var(--ink)' : 'var(--muted)' }}>1h: {fmtDT(a.reminder_1h_sent_at) || '—'}</div>
                            </td>
                            <td style={{ padding: '9px 14px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                                {a.emails.length > 0 && (
                                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, whiteSpace: 'nowrap' }}
                                    onClick={() => setExpandedEmailRow(expandedEmailRow === a.id ? null : a.id)}>
                                    {expandedEmailRow === a.id ? 'Hide log' : `Email log (${a.emails.length})`}
                                  </button>
                                )}
                                {a.client_email && (
                                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                    <select
                                      value={resendCategory[a.id] || 'confirmation'}
                                      onChange={(e) => setResendCategory({ ...resendCategory, [a.id]: e.target.value })}
                                      style={{ fontSize: 11, padding: '3px 4px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--white)' }}
                                    >
                                      <option value="confirmation">Confirmation</option>
                                      <option value="reminder_24h">24h reminder</option>
                                      <option value="reminder_1h">1h reminder</option>
                                      <option value="reschedule">Reschedule</option>
                                      <option value="cancellation">Cancellation</option>
                                    </select>
                                    <button
                                      className="btn btn-outline btn-sm" style={{ fontSize: 11, whiteSpace: 'nowrap' }}
                                      disabled={resendEmail.isPending}
                                      onClick={() => {
                                        const category = resendCategory[a.id] || 'confirmation'
                                        const label = category.replace(/_/g, ' ')
                                        if (window.confirm(`Send a real "${label}" email to ${a.client_email} right now?`)) {
                                          resendEmail.mutate({ activityId: a.id, category })
                                        }
                                      }}
                                    >
                                      Resend
                                    </button>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                          {expandedEmailRow === a.id && (
                            <tr style={{ background: 'var(--paper)' }}>
                              <td colSpan={7} style={{ padding: '10px 14px 14px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {a.emails.map((e: any, ei: number) => (
                                    <div key={ei} style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                                      <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap', minWidth: 130 }}>{fmtDT(e.sent_at)}</span>
                                      <span className="pill pill-grey" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{e.category.replace(/_/g, ' ')}</span>
                                      <span style={{ color: 'var(--muted)' }}>&rarr; {e.recipient_email}</span>
                                      <span style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.subject}</span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </AdminShell>
  )
}
