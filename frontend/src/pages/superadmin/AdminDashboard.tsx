import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'

type Tab = 'overview' | 'workspaces' | 'tokens' | 'feedback' | 'banner'

function hashToTab(hash: string): Tab {
  if (hash === '#workspaces') return 'workspaces'
  if (hash === '#tokens') return 'tokens'
  if (hash === '#feedback') return 'feedback'
  if (hash === '#banner') return 'banner'
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
    <AppShell>
      {/* Header */}
      <div style={{ background: 'var(--white)', borderBottom: '1px solid var(--border)', padding: '22px 36px 0' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 32, fontWeight: 300, marginBottom: 4 }}>
            Super Admin
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Platform management — staff only</div>
        </div>
        <div style={{ display: 'flex', gap: 0, borderTop: '1px solid var(--border)', marginLeft: -36, marginRight: -36, paddingLeft: 36 }}>
          {(['overview', 'workspaces', 'tokens', 'feedback', 'banner'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { navigate('/admin' + (t === 'overview' ? '' : `#${t}`)); setSelectedTicket(null) }}
              style={{
                padding: '11px 20px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                fontFamily: "'DM Sans', sans-serif",
                background: 'none', borderBottom: tab === t ? '2px solid var(--ink)' : '2px solid transparent',
                color: tab === t ? 'var(--ink)' : 'var(--muted)', transition: 'color .15s',
              }}
            >
              {t === 'overview' ? 'Overview'
                : t === 'workspaces' ? `Workspaces${stats ? ` (${stats.workspaces})` : ''}`
                : t === 'tokens' ? 'Workspace Invites'
                : t === 'feedback' ? 'Feedback'
                : 'Maintenance Banner'}
            </button>
          ))}
        </div>
      </div>

      <div className="page-body">
        {/* ── Overview tab ─────────────────────────────────── */}
        {tab === 'overview' && (
          <>
            {statsLoading ? (
              <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Loading…</div>
            ) : stats ? (
              <>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
                  <StatCard label="Workspaces" value={stats.workspaces} sub={`${stats.workspaces_active} active · ${stats.new_workspaces_7d} new this week`} />
                  <StatCard label="Users" value={stats.users} />
                  <StatCard label="Clients" value={stats.clients} />
                  <StatCard label="Deals" value={stats.deals} />
                  <StatCard label="Invoices" value={stats.invoices} sub={`${stats.overdue_count} overdue`} />
                  <StatCard label="Revenue Collected" value={`$${Number(stats.revenue_total || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />
                  <StatCard label="Errors Logged" value={stats.total_errors} sub={stats.total_errors > 0 ? 'check error logs' : 'all clear'} />
                </div>

                <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  Plan breakdown
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 32 }}>
                  {Object.entries(stats.plans as Record<string, number>).map(([plan, count]) => (
                    <div key={plan} style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span className={`pill ${PLAN_COLORS[plan] || 'pill-grey'}`}>{plan}</span>
                      <span style={{ fontSize: 22, fontFamily: 'Cormorant Garamond, serif', fontWeight: 300 }}>{count}</span>
                    </div>
                  ))}
                </div>

                <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  Recent workspaces
                </div>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Workspace</th>
                      <th>Plan</th>
                      <th>Owner</th>
                      <th>Clients</th>
                      <th>Revenue</th>
                      <th>Errors</th>
                      <th>Last activity</th>
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
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{(ws.owner_role || '').replace(/_/g, ' ')}</div>
                          {ws.owner_last_login && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Last login: {timeAgo(ws.owner_last_login)}</div>}
                        </td>
                        <td style={{ fontSize: 14 }}>{ws.clients}</td>
                        <td style={{ fontSize: 13, color: '#4a7c59', fontWeight: 600 }}>
                          {ws.revenue > 0 ? `$${Number(ws.revenue).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
                        </td>
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
                    <th>Users</th>
                    <th>Clients</th>
                    <th>Deals</th>
                    <th>Invoices</th>
                    <th>Revenue</th>
                    <th>Errors</th>
                    <th>Last activity</th>
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
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{(ws.owner_role || '').replace(/_/g, ' ')}</div>
                        {ws.owner_last_login && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Last login: {timeAgo(ws.owner_last_login)}</div>}
                      </td>
                      <td style={{ fontSize: 14 }}>{ws.users}</td>
                      <td style={{ fontSize: 14 }}>{ws.clients}</td>
                      <td style={{ fontSize: 14 }}>{ws.deals}</td>
                      <td style={{ fontSize: 14 }}>
                        {ws.invoices}
                        {ws.overdue > 0 && <span style={{ marginLeft: 4, fontSize: 10, color: '#e67e22' }}>({ws.overdue} overdue)</span>}
                      </td>
                      <td style={{ fontSize: 13, color: '#4a7c59', fontWeight: 600 }}>
                        {ws.revenue > 0 ? `$${Number(ws.revenue).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
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
      </div>
    </AppShell>
  )
}
