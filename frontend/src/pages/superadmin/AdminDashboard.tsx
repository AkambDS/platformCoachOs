import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../../api/client'
import AdminShell from '../../components/layout/AdminShell'

type Tab = 'overview' | 'workspaces' | 'invoices' | 'tokens' | 'feedback' | 'banner'

function hashToTab(hash: string): Tab {
  if (hash === '#workspaces') return 'workspaces'
  if (hash === '#tokens') return 'tokens'
  if (hash === '#feedback') return 'feedback'
  if (hash === '#banner') return 'banner'
  if (hash === '#invoices') return 'invoices'
  return 'overview'
}

const STATUS_COLORS: Record<string, string> = {
  new: 'pill-blue',
  reviewing: 'pill-gold',
  in_progress: 'pill-blue',
  resolved: 'pill-green',
  closed: 'pill-grey',
}
const PRIORITY_COLORS: Record<string, string> = {
  low: 'pill-grey',
  medium: 'pill-blue',
  high: 'pill-gold',
  critical: 'pill-red',
}
const STATUSES = ['new','reviewing','in_progress','resolved','closed']
const PRIORITIES = ['low','medium','high','critical']
const CATEGORIES = ['bug','feature','ui','performance','general']

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div style={{
      background: 'var(--white)', border: '1px solid var(--border)', padding: '22px 28px',
      flex: '1 1 160px', minWidth: 140,
    }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 32, fontFamily: 'Cormorant Garamond, serif', fontWeight: 300, color: 'var(--ink)' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
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

const PLAN_COLORS: Record<string, string> = {
  trial: 'pill-grey',
  starter: 'pill-blue',
  growth: 'pill-green',
  enterprise: 'pill-gold',
}

export default function AdminDashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>(() => hashToTab(location.hash))

  useEffect(() => {
    setTab(hashToTab(location.hash))
  }, [location.hash])

  const [tokenName, setTokenName] = useState('')
  const [tokenEmail, setTokenEmail] = useState('')
  const [tokenDays, setTokenDays] = useState(7)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Feedback state
  const [fbWorkspace, setFbWorkspace] = useState('')
  const [fbStatus, setFbStatus] = useState('')
  const [fbCategory, setFbCategory] = useState('')
  const [selectedTicket, setSelectedTicket] = useState<any | null>(null)
  const [editDraft, setEditDraft] = useState<any | null>(null)
  const [commentText, setCommentText] = useState('')

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => adminApi.dashboard().then(r => r.data),
  })

  const { data: workspaces = [], isLoading: wsLoading } = useQuery({
    queryKey: ['admin', 'workspaces'],
    queryFn: () => adminApi.workspaces().then(r => r.data),
    enabled: tab === 'workspaces' || tab === 'overview',
  })

  const { data: platformInvoices = [], isLoading: invoicesLoading, refetch: refetchBilling } = useQuery({
    queryKey: ['admin', 'platform-invoices'],
    queryFn: () => adminApi.platformInvoices().then(r => r.data),
    enabled: tab === 'invoices',
  })

  const { data: tokens = [], isLoading: tokensLoading } = useQuery({
    queryKey: ['admin', 'tokens'],
    queryFn: () => adminApi.tokens().then(r => r.data),
    enabled: tab === 'tokens',
  })

  const { data: feedbackTickets = [], isLoading: fbLoading } = useQuery({
    queryKey: ['admin', 'feedback', fbWorkspace, fbStatus, fbCategory],
    queryFn: () => adminApi.feedbackList({
      workspace: fbWorkspace || undefined,
      status:    fbStatus   || undefined,
      category:  fbCategory || undefined,
    }).then(r => r.data),
    enabled: tab === 'feedback',
  })

  const { data: ticketDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['admin', 'feedback', 'detail', selectedTicket?.id],
    queryFn: () => adminApi.feedbackDetail(selectedTicket!.id).then(r => r.data),
    enabled: !!selectedTicket,
  })

  const patchTicket = useMutation({
    mutationFn: (d: any) => adminApi.feedbackPatch(selectedTicket!.id, d),
    onSuccess: (res) => {
      qc.setQueryData(['admin', 'feedback', 'detail', selectedTicket!.id], res.data)
      qc.invalidateQueries({ queryKey: ['admin', 'feedback', fbWorkspace, fbStatus, fbCategory] })
      setEditDraft(null)
    },
  })

  const addComment = useMutation({
    mutationFn: () => adminApi.feedbackComment(selectedTicket!.id, commentText),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'feedback', 'detail', selectedTicket!.id] })
      setCommentText('')
    },
  })

  const [tokenError, setTokenError] = useState('')
  const createToken = useMutation({
    mutationFn: () => adminApi.createToken({ recipient_name: tokenName, recipient_email: tokenEmail, days: tokenDays }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'tokens'] })
      setTokenName('')
      setTokenEmail('')
      setTokenDays(7)
      setTokenError('')
    },
    onError: (err: any) => {
      setTokenError(err?.response?.data?.detail || 'Failed to generate invite link.')
    },
  })

  const deleteToken = useMutation({
    mutationFn: (id: string) => adminApi.deleteToken(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tokens'] }),
  })

  const activateWorkspace = useMutation({
    mutationFn: (wsId: string) => adminApi.activateWorkspace(wsId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tokens'] }),
  })

  const copyUrl = (url: string, id: string) => {
    navigator.clipboard.writeText(url)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Banner state
  const [newBannerMsg, setNewBannerMsg] = useState('')

  const { data: banners = [], refetch: refetchBanners } = useQuery({
    queryKey: ['admin', 'banners'],
    queryFn: () => adminApi.listBanners().then(r => r.data),
    enabled: tab === 'banner',
    staleTime: 0,
    refetchOnWindowFocus: false,
  })

  const createBanner = useMutation({
    mutationFn: (d: any) => adminApi.createBanner(d),
    onSuccess: () => { refetchBanners(); setNewBannerMsg('') },
  })

  const toggleBanner = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      adminApi.patchBanner(id, { is_active }),
    onSuccess: () => refetchBanners(),
  })

  const deleteBanner = useMutation({
    mutationFn: (id: number) => adminApi.deleteBanner(id),
    onSuccess: () => refetchBanners(),
  })

  return (
    <AdminShell>
      <div style={{ padding: '28px 32px', minHeight: '100vh' }}>
        {/* ── Overview tab ─────────────────────────────────── */}
        {tab === 'overview' && (
          <>
            {statsLoading ? (
              <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Loading…</div>
            ) : stats ? (
              <>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
                  <StatCard label="Workspaces" value={stats.workspaces} sub={`${stats.workspaces_active} active · ${stats.new_workspaces_7d} new this week`} />
                  <StatCard label="Platform Invoices" value={stats.invoices} sub={`${stats.overdue_count} overdue`} />
                  <StatCard label="Errors Logged" value={stats.total_errors} sub={stats.total_errors > 0 ? 'check error logs' : 'all clear'} />
                </div>

                {stats.audit_logs?.length > 0 && (
                  <>
                    <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                      Recent activity
                    </div>
                    <div style={{
                      background: 'var(--white)', border: '1px solid var(--border)',
                      marginBottom: 24, overflow: 'hidden',
                    }}>
                      {(stats.audit_logs as any[]).map((log: any, i: number) => (
                        <div key={log.id} style={{
                          display: 'flex', alignItems: 'baseline', gap: 12,
                          padding: '9px 16px',
                          borderBottom: i < stats.audit_logs.length - 1 ? '1px solid var(--border)' : undefined,
                        }}>
                          <span style={{
                            fontSize: 11, fontFamily: 'monospace', background: 'var(--paper)',
                            padding: '1px 6px', borderRadius: 3, color: 'var(--ink)',
                            textTransform: 'uppercase', letterSpacing: '.04em', flexShrink: 0,
                          }}>{log.action}</span>
                          <span style={{ fontSize: 13, color: 'var(--ink)', flex: 1, minWidth: 0 }}>
                            <span style={{ color: 'var(--muted)', textTransform: 'capitalize' }}>{log.table.replace(/_/g, ' ')}</span>
                            {log.user && log.user !== '—' && (
                              <> · <span style={{ fontWeight: 500 }}>{log.user}</span></>
                            )}
                            {log.workspace_name && (
                              <> · <span style={{ color: 'var(--muted)', fontSize: 12 }}>{log.workspace_name}</span></>
                            )}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{timeAgo(log.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  Recent workspaces
                </div>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Workspace</th>
                      <th>Plan</th>
                      <th>Owner</th>
                      <th>Last Login</th>
                      <th>Errors</th>
                      <th>Last Activity</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(workspaces as any[]).slice(0, 10).map((ws: any) => (
                      <tr key={ws.id} onClick={() => navigate(`/admin/workspaces/${ws.id}`)} style={{ cursor: 'pointer' }}>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{ws.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{ws.slug}</div>
                        </td>
                        <td><span className={`pill ${PLAN_COLORS[ws.plan] || 'pill-grey'}`}>{ws.plan}</span></td>
                        <td>
                          <div style={{ fontSize: 13 }}>{ws.owner_email || '—'}</div>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--muted)' }}>{ws.owner_last_login ? timeAgo(ws.owner_last_login) : '—'}</td>
                        <td>
                          {ws.error_count > 0
                            ? <span className="pill pill-red" style={{ fontSize: 11 }}>{ws.error_count} errors</span>
                            : <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>}
                        </td>
                        <td style={{ fontSize: 13, color: 'var(--muted)' }}>{timeAgo(ws.last_activity)}</td>
                        <td>
                          <span className={`pill ${ws.is_active ? 'pill-green' : ws.pending_activation ? 'pill-gold' : 'pill-grey'}`}>
                            {ws.is_active ? 'Active' : ws.pending_activation ? 'Pending' : 'Suspended'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </>
        )}

        {/* ── Workspaces tab ────────────────────────────────── */}
        {tab === 'workspaces' && (
          <>
            {wsLoading ? (
              <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Loading…</div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Workspace</th>
                    <th>Plan</th>
                    <th>Owner</th>
                    <th>Last Login</th>
                    <th>Users</th>
                    <th>Invoices</th>
                    <th>Errors</th>
                    <th>Last Activity</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(workspaces as any[]).map((ws: any) => (
                    <tr key={ws.id} onClick={() => navigate(`/admin/workspaces/${ws.id}`)} style={{ cursor: 'pointer' }}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{ws.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{ws.slug}</div>
                      </td>
                      <td><span className={`pill ${PLAN_COLORS[ws.plan] || 'pill-grey'}`}>{ws.plan}</span></td>
                      <td>
                        <div style={{ fontSize: 13 }}>{ws.owner_email || '—'}</div>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{ws.owner_last_login ? timeAgo(ws.owner_last_login) : '—'}</td>
                      <td style={{ fontSize: 14 }}>{ws.users}</td>
                      <td style={{ fontSize: 14 }}>
                        {ws.invoices}
                        {ws.overdue > 0 && <span style={{ marginLeft: 4, fontSize: 10, color: '#e67e22' }}>({ws.overdue} overdue)</span>}
                      </td>
                      <td>
                        {ws.error_count > 0
                          ? <span className="pill pill-red" style={{ fontSize: 11 }}>{ws.error_count}</span>
                          : <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ fontSize: 13, color: 'var(--muted)' }}>{timeAgo(ws.last_activity)}</td>
                      <td>
                        <span className={`pill ${ws.is_active ? 'pill-green' : 'pill-grey'}`}>
                          {ws.is_active ? 'Active' : 'Suspended'}
                        </span>
                      </td>
                      <td style={{ color: 'var(--gold)', fontSize: 13, fontWeight: 500 }}>View →</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {/* ── Tokens tab ────────────────────────────────────── */}
        {tab === 'tokens' && (
          <>
            {/* Explainer + create form */}
            <div style={{
              background: 'var(--white)', border: '1px solid var(--border)', padding: '24px 28px', marginBottom: 24,
            }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>New workspace invite link</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, maxWidth: 560 }}>
                Generate a one-time sign-up link for a new coach. When they open the link, they can register their own workspace on CoachOS. The link expires automatically and can only be used once.
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: '1 1 200px' }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 5 }}>Owner Name *</label>
                  <input
                    className="form-input"
                    placeholder="e.g. Sarah Johnson"
                    value={tokenName}
                    onChange={e => setTokenName(e.target.value)}
                  />
                </div>
                <div style={{ flex: '1 1 220px' }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 5 }}>Owner Email *</label>
                  <input
                    className="form-input"
                    type="email"
                    placeholder="sarah@example.com"
                    value={tokenEmail}
                    onChange={e => setTokenEmail(e.target.value)}
                  />
                </div>
                <div style={{ flex: '0 0 120px' }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 5 }}>Valid for (days)</label>
                  <input
                    className="form-input"
                    type="number"
                    min={1}
                    max={90}
                    value={tokenDays}
                    onChange={e => setTokenDays(Number(e.target.value))}
                  />
                </div>
                <button
                  className="btn btn-dark"
                  onClick={() => createToken.mutate()}
                  disabled={createToken.isPending || !tokenName || !tokenEmail}
                >
                  {createToken.isPending ? 'Generating…' : 'Generate invite link'}
                </button>
              </div>
              {tokenError && (
                <div style={{ marginTop: 12, fontSize: 13, color: '#c0392b', background: '#fdf4f4', border: '1px solid #e5b4b4', padding: '8px 14px', borderRadius: 4 }}>
                  {tokenError}
                </div>
              )}
            </div>

            {tokensLoading ? (
              <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Loading…</div>
            ) : (tokens as any[]).length === 0 ? (
              <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center', fontSize: 14 }}>No invite links yet</div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Sign-up link</th>
                    <th>Expires</th>
                    <th>Workspace registered</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(tokens as any[]).map((t: any) => (
                    <tr key={t.id}>
                      <td style={{ fontSize: 13, fontWeight: 500 }}>{t.recipient_name || <em style={{ color: 'var(--muted)', fontWeight: 400 }}>—</em>}</td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{t.recipient_email || '—'}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {t.url}
                          </span>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => copyUrl(t.url, t.id)}
                            style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                          >
                            {copiedId === t.id ? '✓ Copied' : 'Copy link'}
                          </button>
                        </div>
                      </td>
                      <td style={{ fontSize: 13, color: 'var(--muted)' }}>
                        {new Date(t.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td style={{ fontSize: 13, color: t.used_by ? 'var(--ink)' : 'var(--muted)' }}>
                        {t.used_by || '—'}
                        {t.used_by_pending && (
                          <div style={{ fontSize: 11, color: '#b8922e', fontWeight: 600, marginTop: 2 }}>
                            ⚠ Awaiting activation
                          </div>
                        )}
                      </td>
                      <td>
                        {t.used_by_pending ? (
                          <span className="pill pill-gold">Pending</span>
                        ) : (
                          <span className={`pill ${t.used ? 'pill-grey' : new Date(t.expires_at) < new Date() ? 'pill-red' : 'pill-green'}`}>
                            {t.used ? 'Used' : new Date(t.expires_at) < new Date() ? 'Expired' : 'Active'}
                          </span>
                        )}
                      </td>
                      <td>
                        {t.used_by_pending && t.used_by_id ? (
                          <button
                            className="btn btn-dark btn-sm"
                            style={{ fontSize: 12 }}
                            disabled={activateWorkspace.isPending}
                            onClick={() => {
                              if (window.confirm(`Activate workspace "${t.used_by}"? The owner will be able to log in.`)) {
                                activateWorkspace.mutate(t.used_by_id)
                              }
                            }}
                          >
                            Activate
                          </button>
                        ) : !t.used ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ color: 'var(--danger, #c0392b)', fontSize: 12 }}
                            onClick={() => {
                              if (window.confirm('Revoke this invite link?')) deleteToken.mutate(t.id)
                            }}
                          >
                            Revoke
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {/* ── Feedback tab ──────────────────────────────────── */}
        {tab === 'feedback' && (
          <div style={{ display: 'flex', gap: 0, minHeight: 0 }}>
            {/* List panel */}
            <div style={{ flex: selectedTicket ? '0 0 55%' : '1', minWidth: 0 }}>
              {/* Filters */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                <select
                  className="form-input"
                  style={{ fontSize: 12, padding: '5px 10px', flex: '1 1 180px' }}
                  value={fbWorkspace}
                  onChange={e => { setFbWorkspace(e.target.value); setSelectedTicket(null) }}
                >
                  <option value="">All workspaces</option>
                  {(workspaces as any[]).map((ws: any) => (
                    <option key={ws.id} value={ws.id}>{ws.name}</option>
                  ))}
                </select>
                <select
                  className="form-input"
                  style={{ fontSize: 12, padding: '5px 10px', flex: '0 0 140px' }}
                  value={fbStatus}
                  onChange={e => setFbStatus(e.target.value)}
                >
                  <option value="">All statuses</option>
                  {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
                <select
                  className="form-input"
                  style={{ fontSize: 12, padding: '5px 10px', flex: '0 0 140px' }}
                  value={fbCategory}
                  onChange={e => setFbCategory(e.target.value)}
                >
                  <option value="">All categories</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {fbLoading ? (
                <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Loading…</div>
              ) : (feedbackTickets as any[]).length === 0 ? (
                <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center', fontSize: 14 }}>No feedback tickets</div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Workspace</th>
                      <th>Category</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Submitted by</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(feedbackTickets as any[]).map((t: any) => (
                      <tr
                        key={t.id}
                        onClick={() => { setSelectedTicket(t); setEditDraft(null); setCommentText('') }}
                        style={{ cursor: 'pointer', background: selectedTicket?.id === t.id ? 'var(--paper)' : undefined }}
                      >
                        <td style={{ fontWeight: 600, fontSize: 13, maxWidth: 220 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--muted)' }}>{t.workspace_name}</td>
                        <td><span className="pill pill-grey" style={{ textTransform: 'capitalize', fontSize: 11 }}>{t.category}</span></td>
                        <td><span className={`pill ${PRIORITY_COLORS[t.priority] || 'pill-grey'}`} style={{ fontSize: 11 }}>{t.priority}</span></td>
                        <td><span className={`pill ${STATUS_COLORS[t.status] || 'pill-grey'}`} style={{ fontSize: 11, textTransform: 'capitalize' }}>{t.status.replace('_', ' ')}</span></td>
                        <td style={{ fontSize: 12, color: 'var(--muted)' }}>{t.submitted_by}</td>
                        <td style={{ fontSize: 12, color: 'var(--muted)' }}>{timeAgo(t.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Detail / edit panel */}
            {selectedTicket && (
              <div style={{
                flex: '0 0 45%', borderLeft: '1px solid var(--border)', paddingLeft: 24, minWidth: 0,
                overflowY: 'auto', maxHeight: 'calc(100vh - 160px)',
              }}>
                {detailLoading || !ticketDetail ? (
                  <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Loading…</div>
                ) : (
                  <>
                    {/* Close panel */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{ticketDetail.workspace_name}</span>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => { setSelectedTicket(null); setEditDraft(null) }}
                        style={{ fontSize: 11 }}
                      >
                        ✕ Close
                      </button>
                    </div>

                    {/* Title */}
                    {editDraft ? (
                      <input
                        className="form-input"
                        style={{ fontSize: 15, fontWeight: 600, marginBottom: 10, width: '100%' }}
                        value={editDraft.title}
                        onChange={e => setEditDraft((d: any) => ({ ...d, title: e.target.value }))}
                      />
                    ) : (
                      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>{ticketDetail.title}</div>
                    )}

                    {/* Meta row */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                      {/* Status */}
                      <select
                        className="form-input"
                        style={{ fontSize: 12, padding: '4px 8px' }}
                        value={editDraft?.status ?? ticketDetail.status}
                        onChange={e => setEditDraft((d: any) => ({ ...(d ?? ticketDetail), status: e.target.value }))}
                      >
                        {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                      </select>
                      {/* Priority */}
                      <select
                        className="form-input"
                        style={{ fontSize: 12, padding: '4px 8px' }}
                        value={editDraft?.priority ?? ticketDetail.priority}
                        onChange={e => setEditDraft((d: any) => ({ ...(d ?? ticketDetail), priority: e.target.value }))}
                      >
                        {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                      {/* Category */}
                      <select
                        className="form-input"
                        style={{ fontSize: 12, padding: '4px 8px' }}
                        value={editDraft?.category ?? ticketDetail.category}
                        onChange={e => setEditDraft((d: any) => ({ ...(d ?? ticketDetail), category: e.target.value }))}
                      >
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>

                    {/* Submitted by */}
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                      Submitted by <strong>{ticketDetail.submitted_by}</strong>
                      {ticketDetail.submitted_by_email && <> · {ticketDetail.submitted_by_email}</>}
                      {ticketDetail.page_url && <> · <span style={{ fontFamily: 'monospace' }}>{ticketDetail.page_url}</span></>}
                    </div>

                    {/* Description */}
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>Description</div>
                    {editDraft ? (
                      <textarea
                        className="form-input"
                        rows={5}
                        style={{ width: '100%', fontSize: 13, marginBottom: 12, resize: 'vertical' }}
                        value={editDraft.description}
                        onChange={e => setEditDraft((d: any) => ({ ...d, description: e.target.value }))}
                      />
                    ) : (
                      <div style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 16, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                        {ticketDetail.description}
                      </div>
                    )}

                    {/* Screenshot */}
                    {ticketDetail.screenshot_data && (
                      <details style={{ marginBottom: 16 }}>
                        <summary style={{ fontSize: 12, color: 'var(--muted)', cursor: 'pointer', marginBottom: 8 }}>Screenshot</summary>
                        <img src={ticketDetail.screenshot_data} alt="screenshot" style={{ maxWidth: '100%', border: '1px solid var(--border)' }} />
                      </details>
                    )}

                    {/* Save / Edit buttons */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                      {editDraft ? (
                        <>
                          <button
                            className="btn btn-dark btn-sm"
                            disabled={patchTicket.isPending}
                            onClick={() => patchTicket.mutate(editDraft)}
                          >
                            {patchTicket.isPending ? 'Saving…' : 'Save changes'}
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditDraft(null)}>Discard</button>
                        </>
                      ) : (
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditDraft({ ...ticketDetail })}>Edit</button>
                      )}
                    </div>

                    {/* Comments */}
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>
                      Comments ({(ticketDetail.comments || []).length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                      {(ticketDetail.comments || []).map((c: any) => (
                        <div key={c.id} style={{
                          background: c.is_admin ? 'var(--paper)' : 'var(--white)',
                          border: '1px solid var(--border)', padding: '10px 14px',
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>
                              {c.created_by}
                              {c.is_admin && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>admin</span>}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{timeAgo(c.created_at)}</span>
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{c.text}</div>
                        </div>
                      ))}
                    </div>

                    {/* Add comment */}
                    <textarea
                      className="form-input"
                      rows={3}
                      placeholder="Add an internal admin note…"
                      style={{ width: '100%', fontSize: 13, marginBottom: 8, resize: 'vertical' }}
                      value={commentText}
                      onChange={e => setCommentText(e.target.value)}
                    />
                    <button
                      className="btn btn-dark btn-sm"
                      disabled={!commentText.trim() || addComment.isPending}
                      onClick={() => addComment.mutate()}
                    >
                      {addComment.isPending ? 'Posting…' : 'Post comment'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Banner tab ────────────────────────────────────── */}
        {tab === 'banner' && (
          <div style={{ maxWidth: 660 }}>

            {/* Existing banners */}
            {(banners as any[]).map((b: any) => (
              <div key={b.id} className="card" style={{ marginBottom: 14 }}>
                <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    {b.is_active && (
                      <div style={{
                        background: '#7a4e1e', color: '#fff', padding: '10px 14px',
                        fontSize: 13, lineHeight: 1.6, marginBottom: 10,
                        borderLeft: '4px solid #f0a854',
                      }}>
                        <strong style={{ marginRight: 6 }}>Scheduled Maintenance Notice:</strong>
                        {b.message}
                      </div>
                    )}
                    <div style={{ fontSize: 13, color: b.is_active ? 'var(--ink)' : 'var(--muted)', lineHeight: 1.5 }}>
                      {b.is_active ? null : b.message}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                      Created {new Date(b.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    {/* Toggle */}
                    <div
                      onClick={() => toggleBanner.mutate({ id: b.id, is_active: !b.is_active })}
                      style={{
                        width: 40, height: 22, borderRadius: 11, cursor: 'pointer', transition: 'background .2s',
                        background: b.is_active ? '#2d6a4f' : '#ccc', position: 'relative',
                      }}
                      title={b.is_active ? 'Disable' : 'Enable'}
                    >
                      <div style={{
                        position: 'absolute', top: 3, left: b.is_active ? 20 : 3,
                        width: 16, height: 16, borderRadius: '50%', background: '#fff',
                        transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.25)',
                      }} />
                    </div>
                    <span style={{ fontSize: 11, color: b.is_active ? '#2d6a4f' : 'var(--muted)', fontWeight: 600, minWidth: 46 }}>
                      {b.is_active ? 'Active' : 'Inactive'}
                    </span>
                    {/* Delete */}
                    <button
                      onClick={() => deleteBanner.mutate(b.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 18, lineHeight: 1, padding: '2px 4px' }}
                      title="Delete"
                    >×</button>
                  </div>
                </div>
              </div>
            ))}

            {/* New banner form */}
            <div className="card">
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 300 }}>New Maintenance Notice</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Shown at the top of the login screen when active</div>
              </div>
              <div style={{ padding: '20px' }}>
                <div className="fgroup" style={{ marginBottom: 16 }}>
                  <label className="flabel">Message</label>
                  <textarea
                    className="ftextarea"
                    rows={4}
                    value={newBannerMsg}
                    onChange={e => setNewBannerMsg(e.target.value)}
                    placeholder="Production rollout is planned from June 10 to June 11. Please avoid using the system to prevent data loss. The system will be back up by 9:00 AM on June 11."
                  />
                </div>
                <button
                  className="btn btn-dark btn-sm"
                  disabled={!newBannerMsg.trim() || createBanner.isPending}
                  onClick={() => createBanner.mutate({ message: newBannerMsg.trim(), is_active: true })}
                >
                  {createBanner.isPending ? 'Creating…' : '+ Add & Activate'}
                </button>
              </div>
            </div>
          </div>
        )}
        {/* ── Invoices tab ─────────────────────────────────── */}
        {tab === 'invoices' && (
          <InvoicesTab
            invoices={platformInvoices as any[]}
            workspaces={workspaces as any[]}
            loading={invoicesLoading}
            onRefresh={() => refetchBilling()}
          />
        )}
      </div>
    </AdminShell>
  )
}


// ── Platform Invoice System ───────────────────────────────────────────────────
const INV_STATUS_COLORS: Record<string, string> = {
  draft: 'pill-grey', sent: 'pill-blue', paid: 'pill-green', overdue: 'pill-red',
}
const PAYMENT_METHODS = ['bank_transfer', 'cash', 'card', 'other']

function calcTotal(lineItems: any[]) {
  if (!lineItems?.length) return 0
  return lineItems.reduce((s, li) => s + Number(li.quantity || 1) * Number(li.unit_price || 0), 0)
}

// Defined at module scope so React never unmounts it mid-keystroke
function LineItemsEditor({ items, onChange }: { items: any[]; onChange: (items: any[]) => void }) {
  function updateItem(i: number, k: string, v: string) {
    onChange(items.map((li, idx) => idx === i ? { ...li, [k]: v } : li))
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="flabel" style={{ margin: 0 }}>Line Items</div>
        <button type="button" className="btn btn-outline btn-sm" style={{ fontSize: 11 }}
          onClick={() => onChange([...items, { description: '', quantity: '1', unit_price: '0' }])}>
          + Add item
        </button>
      </div>
      {items.map((li, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <input className="finput" style={{ margin: 0, flex: 3 }} placeholder="Description" value={li.description}
            onChange={e => updateItem(i, 'description', e.target.value)} />
          <input className="finput" style={{ margin: 0, width: 52 }} placeholder="Qty" type="number" value={li.quantity}
            onChange={e => updateItem(i, 'quantity', e.target.value)} />
          <input className="finput" style={{ margin: 0, width: 80 }} placeholder="Price" type="number" value={li.unit_price}
            onChange={e => updateItem(i, 'unit_price', e.target.value)} />
          <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 58, textAlign: 'right' }}>
            ${(Number(li.quantity || 1) * Number(li.unit_price || 0)).toFixed(2)}
          </span>
          <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      ))}
      {items.length > 0 && (
        <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
          Total: ${calcTotal(items).toFixed(2)}
        </div>
      )}
    </div>
  )
}

function InvoicePDF({ inv }: { inv: any }) {
  const lineItems: any[] = inv.line_items || []
  const computedTotal = lineItems.length > 0 ? calcTotal(lineItems) : Number(inv.amount)
  const logoSrc      = inv.logo_data || inv.workspace_logo || ''
  const billedName   = inv.billed_to_name  || inv.workspace_name
  const billedEmail  = inv.billed_to_email || inv.owner_email
  const billedExtra  = inv.billed_to_extra || ''
  const showBranding = inv.show_platform_text !== false
  return (
    <div style={{ fontFamily: 'Helvetica,Arial,sans-serif', color: '#1a1714', padding: '32px 28px', background: '#fff', minHeight: 420 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28, paddingBottom: 20, borderBottom: '2px solid #1a1714' }}>
        <div>
          {logoSrc && (
            <img src={logoSrc} alt="" style={{ maxHeight: 44, maxWidth: 140, objectFit: 'contain', display: 'block', marginBottom: 8 }} />
          )}
          {showBranding && (
            <>
              <div style={{ fontFamily: 'Georgia,serif', fontSize: 20, fontWeight: 300 }}>CoachOS</div>
              <div style={{ fontSize: 11, color: '#8c8279' }}>Coaching Management Platform</div>
            </>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'Georgia,serif', fontSize: 28, fontWeight: 300, color: '#1a1714' }}>INVOICE</div>
          <div style={{ fontSize: 12, color: '#8c8279', marginTop: 4 }}>#{inv.id}</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#8c8279', marginBottom: 6 }}>Billed to</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{billedName}</div>
          {billedEmail && <div style={{ fontSize: 13, color: '#8c8279' }}>{billedEmail}</div>}
          {billedExtra && billedExtra.split('\n').map((line: string, i: number) => (
            <div key={i} style={{ fontSize: 12, color: '#8c8279', marginTop: i === 0 ? 4 : 1 }}>{line}</div>
          ))}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#8c8279', marginBottom: 6 }}>Details</div>
          <div style={{ fontSize: 13 }}>Period: {inv.period_start} – {inv.period_end}</div>
          <div style={{ fontSize: 13, color: '#8c8279' }}>Issued: {new Date(inv.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
          {inv.status !== 'draft' && (
            <div style={{ marginTop: 6 }}>
              <span className={'pill ' + (INV_STATUS_COLORS[inv.status] || 'pill-grey')} style={{ fontSize: 10 }}>{inv.status}</span>
            </div>
          )}
        </div>
      </div>

      {lineItems.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
          <thead>
            <tr style={{ background: '#f8f6f2' }}>
              <th style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8c8279', padding: '8px 10px', textAlign: 'left' }}>Description</th>
              <th style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8c8279', padding: '8px 10px', textAlign: 'center', width: 60 }}>Qty</th>
              <th style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8c8279', padding: '8px 10px', textAlign: 'right', width: 90 }}>Unit</th>
              <th style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8c8279', padding: '8px 10px', textAlign: 'right', width: 90 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((li: any, i: number) => (
              <tr key={i} style={{ borderBottom: '1px solid #ede9e1' }}>
                <td style={{ padding: '10px 10px', fontSize: 13 }}>{li.description}</td>
                <td style={{ padding: '10px 10px', fontSize: 13, textAlign: 'center' }}>{li.quantity}</td>
                <td style={{ padding: '10px 10px', fontSize: 13, textAlign: 'right' }}>${Number(li.unit_price).toFixed(2)}</td>
                <td style={{ padding: '10px 10px', fontSize: 13, fontWeight: 600, textAlign: 'right' }}>${(Number(li.quantity) * Number(li.unit_price)).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ borderTop: '1px solid #ede9e1', marginBottom: 20 }} />
      )}

      <div style={{ borderTop: '2px solid #1a1714', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>Total Due</span>
        <span style={{ fontFamily: 'Georgia,serif', fontSize: 32, fontWeight: 300 }}>${computedTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      </div>

      {inv.notes && (
        <div style={{ marginTop: 20, fontSize: 12, color: '#8c8279', borderLeft: '3px solid #b8922e', paddingLeft: 12 }}>{inv.notes}</div>
      )}

      <div style={{ marginTop: 28, paddingTop: 16, borderTop: '1px solid #ede9e1', fontSize: 11, color: '#8c8279', textAlign: 'center' }}>
        CoachOS · Generated {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
      </div>
    </div>
  )
}

function printInvoice(inv: any) {
  const w = window.open('', '_blank')
  if (!w) return
  const lineItems: any[] = inv.line_items || []
  const computedTotal = lineItems.length > 0 ? calcTotal(lineItems) : Number(inv.amount)
  const logoSrc = inv.logo_data || inv.workspace_logo || ''
  const rows = lineItems.map((li: any) =>
    `<tr><td style="padding:10px;border-bottom:1px solid #ede9e1">${li.description}</td>
     <td style="padding:10px;border-bottom:1px solid #ede9e1;text-align:center">${li.quantity}</td>
     <td style="padding:10px;border-bottom:1px solid #ede9e1;text-align:right">$${Number(li.unit_price).toFixed(2)}</td>
     <td style="padding:10px;border-bottom:1px solid #ede9e1;font-weight:600;text-align:right">$${(Number(li.quantity) * Number(li.unit_price)).toFixed(2)}</td></tr>`
  ).join('')
  const lineTable = lineItems.length > 0 ? `
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <thead><tr style="background:#f8f6f2">
        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#8c8279;text-transform:uppercase">Description</th>
        <th style="padding:8px 10px;text-align:center;font-size:11px;color:#8c8279;width:60px">Qty</th>
        <th style="padding:8px 10px;text-align:right;font-size:11px;color:#8c8279;width:90px">Unit</th>
        <th style="padding:8px 10px;text-align:right;font-size:11px;color:#8c8279;width:90px">Total</th>
      </tr></thead><tbody>${rows}</tbody>
    </table>` : '<div style="border-top:1px solid #ede9e1;margin-bottom:20px"></div>'
  const showBranding  = inv.show_platform_text !== false
  const billedName    = inv.billed_to_name  || inv.workspace_name
  const billedEmail   = inv.billed_to_email || inv.owner_email
  const billedExtra   = inv.billed_to_extra || ''
  const logoHtml      = logoSrc ? `<img src="${logoSrc}" style="max-height:44px;max-width:140px;object-fit:contain;display:block;margin-bottom:8px">` : ''
  const brandingHtml  = showBranding ? `<div style="font-family:Georgia,serif;font-size:20px;font-weight:300">CoachOS</div><div style="font-size:11px;color:#8c8279">Coaching Management Platform</div>` : ''
  const extraHtml     = billedExtra ? billedExtra.split('\n').map((l: string) => `<div style="font-size:12px;color:#8c8279;margin-top:2px">${l}</div>`).join('') : ''
  w.document.write(`<!doctype html><html><head><title>Invoice #${inv.id}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Helvetica,Arial,sans-serif;color:#1a1714;padding:40px;max-width:700px;margin:0 auto}@media print{body{padding:20px}}</style>
  </head><body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:2px solid #1a1714;margin-bottom:28px">
    <div>${logoHtml}${brandingHtml}</div>
    <div style="text-align:right"><div style="font-family:Georgia,serif;font-size:28px;font-weight:300">INVOICE</div><div style="font-size:12px;color:#8c8279">#${inv.id}</div></div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-bottom:28px">
    <div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#8c8279;margin-bottom:6px">Billed to</div>
      <div style="font-size:14px;font-weight:600">${billedName}</div>
      ${billedEmail ? `<div style="font-size:13px;color:#8c8279">${billedEmail}</div>` : ''}
      ${extraHtml}
    </div>
    <div style="text-align:right">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#8c8279;margin-bottom:6px">Details</div>
      <div style="font-size:13px">Period: ${inv.period_start} – ${inv.period_end}</div>
      <div style="font-size:13px;color:#8c8279">Issued: ${new Date(inv.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
    </div>
  </div>
  ${lineTable}
  <div style="border-top:2px solid #1a1714;padding-top:12px;display:flex;justify-content:space-between;align-items:baseline">
    <span style="font-size:15px;font-weight:700">Total Due</span>
    <span style="font-family:Georgia,serif;font-size:32px;font-weight:300">$${computedTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
  </div>
  ${inv.notes ? `<div style="margin-top:20px;font-size:12px;color:#8c8279;border-left:3px solid #b8922e;padding-left:12px">${inv.notes}</div>` : ''}
  <div style="margin-top:28px;padding-top:16px;border-top:1px solid #ede9e1;font-size:11px;color:#8c8279;text-align:center">CoachOS · Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
  <script>window.onload=function(){window.print()}<\/script>
  </body></html>`)
  w.document.close()
}

const BLANK_CREATE = {
  workspace_id: '', plan: 'starter', amount: '29',
  period_start: '', period_end: '', notes: '', status: 'draft',
  line_items: [] as any[], is_recurring: false, recurrence_months: 1,
  logo_data: '', show_platform_text: true,
  billed_to_name: '', billed_to_email: '', billed_to_extra: '',
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function LogoUpload({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {value && (
        <img src={value} alt="logo" style={{ maxHeight: 36, maxWidth: 120, objectFit: 'contain', border: '1px solid var(--border)', padding: 4 }} />
      )}
      <label style={{ cursor: 'pointer' }}>
        <span className="btn btn-outline btn-sm" style={{ fontSize: 11 }}>
          {value ? 'Change logo' : '+ Upload logo'}
        </span>
        <input type="file" accept="image/*" style={{ display: 'none' }}
          onChange={async e => {
            const file = e.target.files?.[0]
            if (!file) return
            const b64 = await readFileAsBase64(file)
            onChange(b64)
            e.target.value = ''
          }} />
      </label>
      {value && (
        <button type="button" onClick={() => onChange('')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 12 }}>
          Remove
        </button>
      )}
    </div>
  )
}

function InvoicesTab({ invoices, workspaces, loading, onRefresh }: {
  invoices: any[]; workspaces: any[]; loading: boolean; onRefresh: () => void
}) {
  const [searchText, setSearchText]     = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [showForm, setShowForm]       = useState(false)
  const [selectedInv, setSelectedInv] = useState<any | null>(null)
  const [detailTab, setDetailTab]     = useState<'preview' | 'edit' | 'payments'>('preview')
  const [saving, setSaving]           = useState(false)
  const [sending, setSending]         = useState<number | null>(null)
  const [editForm, setEditForm]       = useState<any>({})
  const [createForm, setCreateForm]   = useState({ ...BLANK_CREATE })
  const [paymentForm, setPaymentForm] = useState({ amount: '', payment_date: new Date().toISOString().slice(0, 10), method: 'bank_transfer', notes: '' })
  const [savingPayment, setSavingPayment] = useState(false)

  const setC = (k: string, v: any) => setCreateForm(f => ({ ...f, [k]: v }))
  const setE = (k: string, v: any) => setEditForm((f: any) => ({ ...f, [k]: v }))
  const setP = (k: string, v: any) => setPaymentForm(f => ({ ...f, [k]: v }))

  const filtered = invoices.filter((i: any) => {
    if (searchText && !i.workspace_name.toLowerCase().includes(searchText.toLowerCase())) return false
    if (filterStatus && i.status !== filterStatus) return false
    return true
  })

  const totals = {
    draft:   invoices.filter(i => i.status === 'draft').length,
    sent:    invoices.filter(i => i.status === 'sent').length,
    overdue: invoices.filter(i => i.status === 'overdue').length,
    paid:    invoices.filter(i => i.status === 'paid').reduce((s: number, i: any) => s + Number(i.amount), 0),
  }

  function selectInv(inv: any) {
    setSelectedInv((p: any) => p?.id === inv.id ? null : inv)
    setDetailTab('preview')
    setEditForm({})
  }

  function openEdit(inv: any) {
    setEditForm({
      amount: inv.amount, plan: inv.plan,
      period_start: inv.period_start, period_end: inv.period_end,
      notes: inv.notes || '', status: inv.status,
      line_items: JSON.parse(JSON.stringify(inv.line_items || [])),
      is_recurring: inv.is_recurring || false,
      recurrence_months: inv.recurrence_months || 1,
      logo_data: inv.logo_data || '',
      show_platform_text: inv.show_platform_text !== false,
      billed_to_name: inv.billed_to_name || '',
      billed_to_email: inv.billed_to_email || '',
      billed_to_extra: inv.billed_to_extra || '',
    })
    setDetailTab('edit')
  }

  async function handleCreate() {
    setSaving(true)
    const items = createForm.line_items
    const total = items.length > 0 ? calcTotal(items) : Number(createForm.amount)
    try {
      const res = await adminApi.createPlatformInvoice({ ...createForm, amount: String(total), line_items: items })
      onRefresh()
      setShowForm(false)
      setCreateForm({ ...BLANK_CREATE })
      setSelectedInv(res.data)
      setDetailTab('preview')
    } catch { } finally { setSaving(false) }
  }

  async function handleSaveEdit() {
    if (!selectedInv) return
    setSaving(true)
    const items = editForm.line_items || []
    const total = items.length > 0 ? calcTotal(items) : Number(editForm.amount)
    try {
      const res = await adminApi.patchPlatformInvoice(selectedInv.id, { ...editForm, amount: String(total), line_items: items })
      onRefresh()
      setSelectedInv(res.data)
      setDetailTab('preview')
    } catch { } finally { setSaving(false) }
  }

  async function handleSend(inv: any) {
    if (!window.confirm('Send invoice to ' + inv.owner_email + '?')) return
    setSending(inv.id)
    try { await adminApi.sendPlatformInvoice(inv.id); onRefresh() }
    catch { } finally { setSending(null) }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this invoice?')) return
    await adminApi.deletePlatformInvoice(id)
    onRefresh()
    if (selectedInv?.id === id) setSelectedInv(null)
  }

  async function handleRecordPayment() {
    if (!selectedInv || !paymentForm.amount || !paymentForm.payment_date) return
    setSavingPayment(true)
    try {
      const res = await adminApi.createPlatformPayment(selectedInv.id, paymentForm)
      onRefresh()
      // update selectedInv payments locally
      const newPayment = { id: res.data.id, amount: paymentForm.amount, payment_date: paymentForm.payment_date, method: paymentForm.method, notes: paymentForm.notes, created_at: new Date().toISOString() }
      setSelectedInv((prev: any) => ({
        ...prev,
        status: res.data.invoice_status,
        payments: [...(prev.payments || []), newPayment],
        paid_total: String(Number(prev.paid_total || 0) + Number(paymentForm.amount)),
      }))
      setPaymentForm({ amount: '', payment_date: new Date().toISOString().slice(0, 10), method: 'bank_transfer', notes: '' })
    } catch { } finally { setSavingPayment(false) }
  }

  async function handleDeletePayment(paymentId: number) {
    if (!selectedInv) return
    if (!confirm('Remove this payment?')) return
    await adminApi.deletePlatformPayment(selectedInv.id, paymentId)
    onRefresh()
    setSelectedInv((prev: any) => {
      const removed = prev.payments.find((p: any) => p.id === paymentId)
      return {
        ...prev,
        payments: prev.payments.filter((p: any) => p.id !== paymentId),
        paid_total: String(Math.max(0, Number(prev.paid_total || 0) - Number(removed?.amount || 0))),
      }
    })
  }

  const statusTabStyle = (active: boolean) => ({
    padding: '6px 14px', fontSize: 12, fontWeight: active ? 600 : 400,
    color: active ? 'var(--ink)' : 'var(--muted)',
    borderBottom: active ? '2px solid var(--gold)' : '2px solid transparent',
    cursor: 'pointer', background: 'none', border: 'none',
    borderBottomStyle: 'solid' as const,
  })

  return (
    <div style={{ display: 'flex', gap: 0, alignItems: 'flex-start', minHeight: 0 }}>

      {/* ── Left: list panel ─────────────────────── */}
      <div style={{ flex: '0 0 320px', borderRight: '1px solid var(--border)', paddingRight: 20, marginRight: 20 }}>
        {/* Summary chips */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {([
            { label: 'Draft',     value: String(totals.draft),               color: '#8c8279', status: 'draft'   },
            { label: 'Sent',      value: String(totals.sent),                color: '#2d6a9f', status: 'sent'    },
            { label: 'Overdue',   value: String(totals.overdue),             color: '#c0392b', status: 'overdue' },
            { label: 'Collected', value: '$' + totals.paid.toLocaleString(), color: '#4a7c59', status: 'paid'    },
          ] as any[]).map((s: any) => (
            <div key={s.label}
              onClick={() => setFilterStatus(fs => fs === s.status ? '' : s.status)}
              style={{
                background: filterStatus === s.status ? '#f8f6f2' : 'var(--white)',
                border: '1px solid ' + (filterStatus === s.status ? 'var(--ink)' : 'var(--border)'),
                padding: '7px 8px', flex: 1, cursor: 'pointer',
              }}>
              <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 }}>{s.label}</div>
              <div style={{ fontSize: 16, fontFamily: 'Cormorant Garamond, serif', fontWeight: 300, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Search row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 13, pointerEvents: 'none' }}>⌕</span>
            <input
              className="finput"
              style={{ margin: 0, width: '100%', paddingLeft: 28 }}
              placeholder="Search workspace…"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
            />
          </div>
          <button
            className={showForm ? 'btn btn-outline btn-sm' : 'btn btn-dark btn-sm'}
            style={{ whiteSpace: 'nowrap' }}
            onClick={() => {
              const next = !showForm
              setShowForm(next)
              if (next) {
                setSelectedInv(null)
                const match = workspaces.find((w: any) =>
                  searchText && w.name.toLowerCase().includes(searchText.toLowerCase())
                )
                if (match) { setC('workspace_id', match.id); setC('plan', match.plan) }
                else { setC('workspace_id', ''); setC('plan', 'starter') }
              }
            }}>
            {showForm ? '✕ Cancel' : '+ New'}
          </button>
        </div>

        {/* Invoice cards */}
        {loading ? (
          <div style={{ color: 'var(--muted)', padding: 32, textAlign: 'center' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: 'var(--muted)', padding: 32, textAlign: 'center', fontSize: 13 }}>No invoices found.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {filtered.map((inv: any) => {
              const paidAmt     = Number(inv.paid_total || 0)
              const totalAmt    = Number(inv.amount)
              const outstanding = Math.max(0, totalAmt - paidAmt)
              const isActive    = selectedInv?.id === inv.id && !showForm
              return (
                <div key={inv.id}
                  onClick={() => { selectInv(inv); setShowForm(false) }}
                  style={{
                    background: 'var(--white)',
                    border: '1px solid ' + (isActive ? 'var(--ink)' : 'var(--border)'),
                    borderLeft: '4px solid ' + (inv.status === 'paid' ? '#4a7c59' : inv.status === 'overdue' ? '#c0392b' : inv.status === 'sent' ? '#2d6a9f' : '#ccc'),
                    padding: '10px 12px', cursor: 'pointer',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.workspace_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{inv.period_start} → {inv.period_end}</div>
                      {inv.is_recurring && (
                        <div style={{ fontSize: 10, color: '#2d6a9f', marginTop: 2 }}>↻ every {inv.recurrence_months}mo</div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, fontWeight: 300 }}>${totalAmt.toLocaleString()}</div>
                      {paidAmt > 0 && paidAmt < totalAmt && (
                        <div style={{ fontSize: 10, color: '#b8922e' }}>${outstanding.toLocaleString()} out</div>
                      )}
                      <span className={'pill ' + (INV_STATUS_COLORS[inv.status] || 'pill-grey')} style={{ fontSize: 10 }}>{inv.status}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Right panel: create form or invoice detail ── */}
      <div style={{ flex: 1, minWidth: 0 }}>

        {/* CREATE FORM */}
        {showForm && (
          <div style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: 24 }}>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300, marginBottom: 20 }}>New Invoice</div>

            <div className="fgroup">
              <div className="flabel">Workspace *</div>
              <select className="fselect" style={{ margin: 0 }} value={createForm.workspace_id}
                onChange={e => {
                  const ws = workspaces.find((w: any) => w.id === e.target.value)
                  setC('workspace_id', e.target.value)
                  if (ws) setC('plan', ws.plan)
                }}>
                <option value="">— select workspace —</option>
                {workspaces.map((ws: any) => (
                  <option key={ws.id} value={ws.id}>{ws.name} · {ws.plan}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div className="fgroup" style={{ flex: 1 }}>
                <div className="flabel">Period start *</div>
                <input className="finput" style={{ margin: 0 }} type="date" value={createForm.period_start}
                  onChange={e => setC('period_start', e.target.value)} />
              </div>
              <div className="fgroup" style={{ flex: 1 }}>
                <div className="flabel">Period end *</div>
                <input className="finput" style={{ margin: 0 }} type="date" value={createForm.period_end}
                  onChange={e => setC('period_end', e.target.value)} />
              </div>
            </div>

            <div className="fgroup">
              <LineItemsEditor items={createForm.line_items} onChange={v => setC('line_items', v)} />
            </div>

            {createForm.line_items.length === 0 && (
              <div className="fgroup">
                <div className="flabel">Amount ($)</div>
                <input className="finput" style={{ margin: 0 }} type="number" value={createForm.amount}
                  onChange={e => setC('amount', e.target.value)} />
              </div>
            )}

            <div className="fgroup">
              <div className="flabel">Notes</div>
              <input className="finput" style={{ margin: 0 }} value={createForm.notes}
                onChange={e => setC('notes', e.target.value)} placeholder="Optional…" />
            </div>

            <div className="fgroup">
              <div className="flabel">Invoice Logo</div>
              <LogoUpload value={createForm.logo_data} onChange={v => setC('logo_data', v)} />
            </div>

            {/* Billed To overrides */}
            <div style={{ background: '#f8f6f2', border: '1px solid var(--border)', padding: '10px 12px', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Billed To (optional overrides)</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <div style={{ flex: 1 }}>
                  <div className="flabel" style={{ marginBottom: 3 }}>Name</div>
                  <input className="finput" style={{ margin: 0 }} placeholder="Company name (defaults to workspace)"
                    value={createForm.billed_to_name} onChange={e => setC('billed_to_name', e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="flabel" style={{ marginBottom: 3 }}>Email</div>
                  <input className="finput" style={{ margin: 0 }} placeholder="email (defaults to owner)"
                    value={createForm.billed_to_email} onChange={e => setC('billed_to_email', e.target.value)} />
                </div>
              </div>
              <div className="flabel" style={{ marginBottom: 3 }}>Address / extra lines</div>
              <textarea className="finput" style={{ margin: 0 }} rows={2} placeholder={'123 Main St\nCity, State'}
                value={createForm.billed_to_extra} onChange={e => setC('billed_to_extra', e.target.value)} />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={createForm.show_platform_text}
                  onChange={e => setC('show_platform_text', e.target.checked)} />
                Show "CoachOS · Coaching Management Platform" text
              </label>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={createForm.is_recurring}
                  onChange={e => setC('is_recurring', e.target.checked)} />
                Recurring invoice
              </label>
              {createForm.is_recurring && (
                <select className="fselect" style={{ margin: 0 }} value={createForm.recurrence_months}
                  onChange={e => setC('recurrence_months', Number(e.target.value))}>
                  {[1, 2, 3, 6, 12].map(m => <option key={m} value={m}>Every {m} month{m > 1 ? 's' : ''}</option>)}
                </select>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-dark btn-sm"
                onClick={handleCreate}
                disabled={saving || !createForm.workspace_id || !createForm.period_start || !createForm.period_end}>
                {saving ? 'Creating…' : 'Create Invoice'}
              </button>
              <button className="btn btn-outline btn-sm"
                onClick={() => { setShowForm(false); setCreateForm({ ...BLANK_CREATE }) }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* INVOICE DETAIL */}
        {!showForm && selectedInv && (
          <>
            {/* Action bar */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--white)', border: '1px solid var(--border)', borderBottom: 'none', padding: '10px 14px' }}>
              <button className="btn btn-outline btn-sm" onClick={() => openEdit(selectedInv)}>✏ Edit</button>
              <button className="btn btn-dark btn-sm" onClick={() => handleSend(selectedInv)} disabled={sending === selectedInv.id}>
                {sending === selectedInv.id ? 'Sending…' : '✉ Send to owner'}
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => printInvoice(selectedInv)}>🖨 Print / PDF</button>
              <button className="btn btn-outline btn-sm" style={{ color: '#c0392b', borderColor: '#f5c6c2' }}
                onClick={() => handleDelete(selectedInv.id)}>Delete</button>
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setSelectedInv(null)}>✕</button>
            </div>

            {/* Sub-tabs */}
            <div style={{ display: 'flex', background: 'var(--white)', borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
              {(['preview', 'edit', 'payments'] as const).map(t => (
                <button key={t} style={statusTabStyle(detailTab === t)} onClick={() => {
                  if (t === 'edit') openEdit(selectedInv)
                  else setDetailTab(t)
                }}>
                  {t === 'preview' ? 'Preview' : t === 'edit' ? '✏ Edit' : `Payments (${(selectedInv.payments || []).length})`}
                </button>
              ))}
              {selectedInv.is_recurring && (
                <span style={{ marginLeft: 'auto', padding: '6px 14px', fontSize: 11, color: '#2d6a9f', alignSelf: 'center' }}>
                  ↻ Recurring · every {selectedInv.recurrence_months}mo
                </span>
              )}
            </div>

            {/* Preview */}
            {detailTab === 'preview' && (
              <div style={{ border: '1px solid var(--border)', borderTop: 'none', boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
                <InvoicePDF inv={selectedInv} />
              </div>
            )}

            {/* Edit */}
            {detailTab === 'edit' && (
              <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderTop: 'none', padding: 20 }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div className="fgroup" style={{ flex: 1, minWidth: 140 }}>
                    <div className="flabel">Period start</div>
                    <input className="finput" style={{ margin: 0 }} type="date" value={editForm.period_start}
                      onChange={e => setE('period_start', e.target.value)} />
                  </div>
                  <div className="fgroup" style={{ flex: 1, minWidth: 140 }}>
                    <div className="flabel">Period end</div>
                    <input className="finput" style={{ margin: 0 }} type="date" value={editForm.period_end}
                      onChange={e => setE('period_end', e.target.value)} />
                  </div>
                  <div className="fgroup" style={{ flex: 1, minWidth: 120 }}>
                    <div className="flabel">Status</div>
                    <select className="fselect" style={{ margin: 0 }} value={editForm.status}
                      onChange={e => setE('status', e.target.value)}>
                      {['draft', 'sent', 'paid', 'overdue'].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <div className="fgroup">
                  <LineItemsEditor items={editForm.line_items || []} onChange={v => setE('line_items', v)} />
                </div>
                {(!editForm.line_items || editForm.line_items.length === 0) && (
                  <div className="fgroup">
                    <div className="flabel">Amount ($)</div>
                    <input className="finput" style={{ margin: 0 }} type="number" value={editForm.amount}
                      onChange={e => setE('amount', e.target.value)} />
                  </div>
                )}
                <div className="fgroup">
                  <div className="flabel">Notes</div>
                  <textarea className="finput" style={{ margin: 0 }} rows={2} value={editForm.notes}
                    onChange={e => setE('notes', e.target.value)} placeholder="Optional…" />
                </div>
                <div className="fgroup">
                  <div className="flabel">Invoice Logo</div>
                  <LogoUpload value={editForm.logo_data || ''} onChange={v => setE('logo_data', v)} />
                </div>

                {/* Billed To overrides */}
                <div style={{ background: '#f8f6f2', border: '1px solid var(--border)', borderRadius: 2, padding: '12px 14px', marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Billed To</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div className="flabel" style={{ marginBottom: 3 }}>Name</div>
                      <input className="finput" style={{ margin: 0 }} placeholder={selectedInv?.workspace_name || 'Company name'}
                        value={editForm.billed_to_name || ''}
                        onChange={e => setE('billed_to_name', e.target.value)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="flabel" style={{ marginBottom: 3 }}>Email</div>
                      <input className="finput" style={{ margin: 0 }} placeholder={selectedInv?.owner_email || 'email@example.com'}
                        value={editForm.billed_to_email || ''}
                        onChange={e => setE('billed_to_email', e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <div className="flabel" style={{ marginBottom: 3 }}>Address / extra lines</div>
                    <textarea className="finput" style={{ margin: 0 }} rows={2}
                      placeholder={'123 Main St\nCity, State 00000'}
                      value={editForm.billed_to_extra || ''}
                      onChange={e => setE('billed_to_extra', e.target.value)} />
                  </div>
                </div>

                {/* Branding toggle */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={editForm.show_platform_text !== false}
                      onChange={e => setE('show_platform_text', e.target.checked)} />
                    Show "CoachOS · Coaching Management Platform" text on invoice
                  </label>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!editForm.is_recurring}
                      onChange={e => setE('is_recurring', e.target.checked)} />
                    Recurring
                  </label>
                  {editForm.is_recurring && (
                    <select className="fselect" style={{ margin: 0 }} value={editForm.recurrence_months}
                      onChange={e => setE('recurrence_months', Number(e.target.value))}>
                      {[1, 2, 3, 6, 12].map(m => <option key={m} value={m}>Every {m} month{m > 1 ? 's' : ''}</option>)}
                    </select>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-dark btn-sm" onClick={handleSaveEdit} disabled={saving}>
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => setDetailTab('preview')}>Cancel</button>
                </div>
              </div>
            )}

            {/* Payments */}
            {detailTab === 'payments' && (
              <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderTop: 'none', padding: 20 }}>
                {(() => {
                  const total       = Number(selectedInv.amount)
                  const paidTotal   = Number(selectedInv.paid_total || 0)
                  const outstanding = Math.max(0, total - paidTotal)
                  return (
                    <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                      {[
                        { label: 'Invoice Total', val: total,       color: 'var(--ink)' },
                        { label: 'Paid',          val: paidTotal,   color: '#4a7c59'    },
                        { label: 'Outstanding',   val: outstanding, color: outstanding > 0 ? '#c0392b' : '#4a7c59' },
                      ].map(r => (
                        <div key={r.label} style={{ flex: 1, background: 'var(--paper)', border: '1px solid var(--border)', padding: '10px 14px' }}>
                          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 }}>{r.label}</div>
                          <div style={{ fontSize: 20, fontFamily: 'Cormorant Garamond, serif', fontWeight: 300, color: r.color }}>
                            ${r.val.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })()}
                <div style={{ background: '#f8f6f2', border: '1px solid var(--border)', padding: 14, marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Record Payment</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div style={{ flex: '0 0 100px' }}>
                      <div className="flabel" style={{ marginBottom: 4 }}>Amount ($)</div>
                      <input className="finput" style={{ margin: 0 }} type="number" placeholder="0.00"
                        value={paymentForm.amount} onChange={e => setP('amount', e.target.value)} />
                    </div>
                    <div style={{ flex: '0 0 150px' }}>
                      <div className="flabel" style={{ marginBottom: 4 }}>Date</div>
                      <input className="finput" style={{ margin: 0 }} type="date"
                        value={paymentForm.payment_date} onChange={e => setP('payment_date', e.target.value)} />
                    </div>
                    <div style={{ flex: '0 0 130px' }}>
                      <div className="flabel" style={{ marginBottom: 4 }}>Method</div>
                      <select className="fselect" style={{ margin: 0 }} value={paymentForm.method}
                        onChange={e => setP('method', e.target.value)}>
                        {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                      </select>
                    </div>
                    <div style={{ flex: 1, minWidth: 100 }}>
                      <div className="flabel" style={{ marginBottom: 4 }}>Notes</div>
                      <input className="finput" style={{ margin: 0 }} placeholder="Optional"
                        value={paymentForm.notes} onChange={e => setP('notes', e.target.value)} />
                    </div>
                    <button className="btn btn-dark btn-sm"
                      disabled={savingPayment || !paymentForm.amount || !paymentForm.payment_date}
                      onClick={handleRecordPayment}>
                      {savingPayment ? 'Recording…' : 'Record'}
                    </button>
                  </div>
                </div>
                {(selectedInv.payments || []).length === 0 ? (
                  <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No payments recorded yet.</div>
                ) : (
                  <table className="tbl">
                    <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Notes</th><th></th></tr></thead>
                    <tbody>
                      {[...(selectedInv.payments || [])].sort((a: any, b: any) => b.payment_date.localeCompare(a.payment_date)).map((p: any) => (
                        <tr key={p.id}>
                          <td style={{ fontSize: 13 }}>{p.payment_date}</td>
                          <td style={{ fontSize: 13, fontWeight: 600, color: '#4a7c59' }}>${Number(p.amount).toFixed(2)}</td>
                          <td style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'capitalize' }}>{p.method.replace('_', ' ')}</td>
                          <td style={{ fontSize: 12, color: 'var(--muted)' }}>{p.notes || '—'}</td>
                          <td>
                            <button onClick={() => handleDeletePayment(p.id)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, lineHeight: 1 }}>×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {!showForm && !selectedInv && (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: '60px 20px', textAlign: 'center' }}>
            Select an invoice to preview, or click <strong>+ New</strong> to create one.
          </div>
        )}
      </div>
    </div>
  )
}
