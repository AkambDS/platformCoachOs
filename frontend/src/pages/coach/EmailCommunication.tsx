import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { emailCommApi, clientsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { EmptyState, Modal } from '../../components/ui'

// Every email CoachOS sends for the workspace — to clients, to the coach/owner and to
// new team members. "Sent" and "Failed" come from EmailLog (written centrally by
// backend/tasks/email_log.send_logged); "Scheduled" is a live forecast computed from the
// same rules the senders use (backend/tasks/email_forecast.py).

type Audience = 'client' | 'coach' | 'team'
const AUDIENCE: Record<Audience, { label: string; short: string; color: string }> = {
  client: { label: 'Clients',        short: 'Client', color: '#2d6a9f' },
  coach:  { label: 'Me & coaches',   short: 'You / coach', color: '#a0761c' },
  team:   { label: 'Team members',   short: 'Team', color: '#7c4d9f' },
}

const fmtDateTime = (d: string) => d
  ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  : '—'
const fmtTime = (d: string) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

function dayGroup(iso: string) {
  const d = new Date(iso)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000)
  const date = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
  if (diff < 0) return { key: 'overdue', label: 'Overdue' }
  if (diff === 0) return { key: day.toISOString(), label: `Today · ${date}` }
  if (diff === 1) return { key: day.toISOString(), label: `Tomorrow · ${date}` }
  return { key: day.toISOString(), label: date }
}

function TypePill({ label, audience }: { label: string; audience: Audience }) {
  const color = AUDIENCE[audience]?.color || '#8c8279'
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 20, whiteSpace: 'nowrap',
      background: color + '16', color, fontSize: 11, fontWeight: 700, letterSpacing: '.02em',
    }}>{label}</span>
  )
}

function AudienceTag({ audience }: { audience: Audience }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>
      {AUDIENCE[audience]?.short || audience}
    </span>
  )
}

const metaLabel = { fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: 'var(--muted)', marginRight: 10 } as const

function EmailFrame({ html }: { html: string }) {
  return (
    <div style={{ height: 460, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', background: '#eeebe5' }}>
      <iframe srcDoc={html} title="Email content" sandbox="allow-same-origin"
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }} />
    </div>
  )
}

// ── Sent / failed email — the exact snapshot captured at send time.
function SentDetailModal({ id, onClose, onViewClient }: {
  id: string; onClose: () => void; onViewClient: (clientId: string) => void
}) {
  const { data: e, isLoading } = useQuery({
    queryKey: ['email-log-detail', id],
    queryFn: () => emailCommApi.detail(id).then(r => r.data),
  })
  return (
    <Modal title={e?.status === 'failed' ? 'Failed email' : 'Sent email'} size="lg" onClose={onClose}>
      {isLoading || !e ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <TypePill label={e.label} audience={e.audience} />
            <span style={{ fontSize: 12, color: e.status === 'failed' ? '#c0392b' : 'var(--muted)', fontWeight: e.status === 'failed' ? 600 : 400 }}>
              {e.status === 'failed' ? 'Failed' : 'Sent'} {fmtDateTime(e.sent_at)}
            </span>
          </div>
          {e.status === 'failed' && (
            <div style={{ padding: '10px 14px', background: '#fdf0ee', border: '1px solid #f3c9c2', borderRadius: 6, fontSize: 12.5, color: '#8b2a1a' }}>
              This email did not go out. Error: <code style={{ fontSize: 12 }}>{e.error || 'unknown'}</code>
            </div>
          )}
          <div style={{ padding: '10px 14px', background: '#f7f5f2', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}>
            <div><span style={metaLabel}>TO</span>{e.recipient_email || '—'} <span style={{ marginLeft: 6 }}><AudienceTag audience={e.audience} /></span></div>
            {e.client_id && (
              <div style={{ marginTop: 6 }}><span style={metaLabel}>CLIENT</span>
                <a onClick={() => onViewClient(e.client_id)} style={{ cursor: 'pointer', color: 'var(--ink)', fontWeight: 600 }}>{e.client_name}</a>
              </div>
            )}
            <div style={{ marginTop: 6 }}><span style={metaLabel}>SUBJECT</span>{e.subject || '—'}</div>
          </div>
          {e.body_html ? <EmailFrame html={e.body_html} /> : (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No content snapshot was captured for this email.</div>
          )}
        </div>
      )}
    </Modal>
  )
}

// ── Upcoming email — rendered live with real data by running the real send code in
// preview mode on the server (nothing is sent).
function ScheduledDetailModal({ item, onClose, onViewClient }: {
  item: any; onClose: () => void; onViewClient: (clientId: string) => void
}) {
  const { data: p, isLoading, isError } = useQuery({
    queryKey: ['email-scheduled-preview', item.id],
    queryFn: () => emailCommApi.scheduledPreview(item.preview).then(r => r.data),
    retry: false,
  })
  const overdue = item.status === 'overdue'
  return (
    <Modal title="Scheduled email" size="lg" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <TypePill label={item.label} audience={item.audience} />
          <span style={{ fontSize: 12, color: overdue ? '#c0392b' : 'var(--gold)', fontWeight: 600 }}>
            {overdue ? 'Was due' : 'Goes out'} {fmtDateTime(item.scheduled_for)}
          </span>
        </div>
        <div style={{ padding: '10px 14px', background: '#f7f5f2', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}>
          <div><span style={metaLabel}>TO</span>{item.recipient_name}{item.recipient_email && <span style={{ color: 'var(--muted)' }}> · {item.recipient_email}</span>}</div>
          {item.client_id && (
            <div style={{ marginTop: 6 }}><span style={metaLabel}>CLIENT</span>
              <a onClick={() => onViewClient(item.client_id)} style={{ cursor: 'pointer', color: 'var(--ink)', fontWeight: 600 }}>{item.client_name}</a>
            </div>
          )}
          <div style={{ marginTop: 6 }}><span style={metaLabel}>WHY</span>{item.reason}</div>
          {p?.subject && <div style={{ marginTop: 6 }}><span style={metaLabel}>SUBJECT</span>{p.subject}</div>}
        </div>
        {overdue && (
          <div style={{ fontSize: 12.5, color: '#8b2a1a' }}>
            This should already have gone out — it'll be picked up on the next automated run. If it stays overdue, the scheduled job may not be running.
          </div>
        )}
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Rendering preview…</div>
        ) : isError || !p?.html ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Preview isn't available for this email right now.</div>
        ) : (
          <>
            <EmailFrame html={p.html} />
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              Preview with today's details{item.use_case === 'invoice' ? ' — the real invoice gets its own number when it\'s generated' : ''}.
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EmailCommunication() {
  const navigate = useNavigate()
  const [view, setView] = useState<'sent' | 'scheduled' | 'failed'>('sent')
  const [audience, setAudience] = useState<'' | Audience>('')
  const [typeFilter, setTypeFilter] = useState('')
  const [clientId, setClientId] = useState('')
  const [search, setSearch] = useState('')
  const [openSentId, setOpenSentId] = useState<string | null>(null)
  const [openScheduled, setOpenScheduled] = useState<any | null>(null)

  const goToClient = (id: string) => { setOpenSentId(null); setOpenScheduled(null); navigate(`/clients/${id}`) }

  const { data: clientsData } = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => clientsApi.list({ page_size: 200 }).then(r => r.data),
  })
  const clients: any[] = clientsData?.results || clientsData || []

  const { data: logData, isLoading: logLoading } = useQuery({
    queryKey: ['email-log-sent'],
    queryFn: () => emailCommApi.sent({ days: 30 }).then(r => r.data),
  })
  const { data: schedData, isLoading: schedLoading } = useQuery({
    queryKey: ['email-log-scheduled'],
    queryFn: () => emailCommApi.scheduled({ days: 30 }).then(r => r.data),
  })
  const log: any[] = logData || []
  const sentAll = log.filter(e => e.status !== 'failed')
  const failedAll = log.filter(e => e.status === 'failed')
  const scheduledAll: any[] = schedData || []
  const base = view === 'sent' ? sentAll : view === 'failed' ? failedAll : scheduledAll

  // Type options = the types actually present in the current tab, grouped by recipient.
  const typeOptions = useMemo(() => {
    const seen = new Map<string, { label: string; audience: Audience }>()
    base.forEach(e => { if (!seen.has(e.use_case)) seen.set(e.use_case, { label: e.label, audience: e.audience }) })
    return Array.from(seen.entries()).sort((a, b) => a[1].label.localeCompare(b[1].label))
  }, [base])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return base.filter(e =>
      (!audience || e.audience === audience) &&
      (!typeFilter || e.use_case === typeFilter) &&
      (!clientId || e.client_id === clientId) &&
      (!q || [e.subject, e.client_name, e.recipient_email, e.recipient_name, e.label, e.reason]
        .some((v: string) => v?.toLowerCase().includes(q))))
  }, [base, audience, typeFilter, clientId, search])

  const loading = view === 'scheduled' ? schedLoading : logLoading
  const tabs = [
    { key: 'sent', label: 'Sent', sub: 'last 30 days', count: sentAll.length },
    { key: 'scheduled', label: 'Scheduled', sub: 'next 30 days', count: scheduledAll.length },
    ...(failedAll.length ? [{ key: 'failed', label: 'Failed', sub: 'last 30 days', count: failedAll.length }] : []),
  ] as const

  // Scheduled: grouped by day (overdue first).
  const groups = useMemo(() => {
    if (view !== 'scheduled') return []
    const out: { key: string; label: string; items: any[] }[] = []
    rows.forEach(i => {
      const g = i.status === 'overdue' ? { key: 'overdue', label: 'Overdue' } : dayGroup(i.scheduled_for)
      let grp = out.find(x => x.key === g.key)
      if (!grp) { grp = { ...g, items: [] }; out.push(grp) }
      grp.items.push(i)
    })
    return out.sort((a, b) => (a.key === 'overdue' ? -1 : b.key === 'overdue' ? 1 : a.key.localeCompare(b.key)))
  }, [rows, view])

  const resetFilters = () => { setAudience(''); setTypeFilter(''); setClientId(''); setSearch('') }
  const filtersOn = !!(audience || typeFilter || clientId || search)

  return (
    <AppShell>
      <div style={{ padding: '24px 32px 20px', borderBottom: '1px solid var(--border)', background: '#f7f4ef' }}>
        <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 400, color: 'var(--ink)' }}>Email Communication</h1>
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>
          Every email CoachOS sends for your workspace — to clients, to you and your coaches, and to new team members.
        </div>
      </div>

      <div className="page-body">
        {/* Tabs */}
        <div role="tablist" data-tour="email-tabs" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 18, overflowX: 'auto' }}>
          {tabs.map(t => {
            const active = view === t.key
            const danger = t.key === 'failed'
            return (
              <button key={t.key} role="tab" aria-selected={active}
                onClick={() => { setView(t.key as any); setTypeFilter('') }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', padding: '10px 14px', marginBottom: -1,
                  fontSize: 13, fontWeight: active ? 600 : 500, color: danger ? '#c0392b' : active ? 'var(--ink)' : 'var(--muted)',
                  borderBottom: `2px solid ${active ? (danger ? '#c0392b' : 'var(--ink)') : 'transparent'}`,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                {t.label}
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 10,
                  background: active ? (danger ? '#c0392b' : 'var(--ink)') : danger ? '#fbe3df' : '#efebe5',
                  color: active ? '#fff' : danger ? '#c0392b' : 'var(--muted)',
                }}>{t.count}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>{t.sub}</span>
              </button>
            )
          })}
        </div>

        {/* Filters */}
        <div data-tour="email-filters" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
          <div role="radiogroup" aria-label="Recipient" style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', background: '#fff' }}>
            {([['', 'All'], ['client', 'Clients'], ['coach', 'Me & coaches'], ['team', 'Team']] as const).map(([k, l]) => (
              <button key={k} role="radio" aria-checked={audience === k} onClick={() => setAudience(k as any)}
                style={{ border: 'none', padding: '7px 12px', fontSize: 12, cursor: 'pointer',
                  background: audience === k ? 'var(--ink)' : '#fff', color: audience === k ? '#fff' : 'var(--ink)' }}>{l}</button>
            ))}
          </div>
          <select className="fselect" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ width: 210, marginBottom: 0 }}>
            <option value="">All email types</option>
            {(['client', 'coach', 'team'] as Audience[]).map(aud => {
              const opts = typeOptions.filter(([, v]) => v.audience === aud)
              return opts.length ? (
                <optgroup key={aud} label={AUDIENCE[aud].label}>
                  {opts.map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </optgroup>
              ) : null
            })}
          </select>
          <select className="fselect" value={clientId} onChange={e => setClientId(e.target.value)} style={{ width: 200, marginBottom: 0 }}>
            <option value="">All clients</option>
            {clients.map((c: any) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
          </select>
          <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 180, maxWidth: 340 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 13 }}>🔍</span>
            <input className="finput" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ marginBottom: 0, paddingLeft: 30 }} />
          </div>
          {filtersOn && (
            <button onClick={resetFilters} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--muted)', textDecoration: 'underline' }}>Clear filters</button>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState icon="✉"
            title={filtersOn ? 'No emails match these filters'
              : view === 'sent' ? 'No emails sent in the last 30 days'
              : view === 'failed' ? 'No failed emails'
              : 'Nothing scheduled in the next 30 days'}
            message={view === 'scheduled' && !filtersOn
              ? 'Session reminders, recurring invoices and pipeline follow-ups will appear here before they go out.'
              : undefined} />
        ) : view === 'scheduled' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {groups.map(g => (
              <div key={g.key}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                  color: g.key === 'overdue' ? '#c0392b' : 'var(--muted)', margin: '0 2px 8px' }}>
                  {g.label} <span style={{ fontWeight: 500 }}>· {g.items.length}</span>
                </div>
                <div style={{ background: '#fff', border: `1px solid ${g.key === 'overdue' ? '#f3c9c2' : 'var(--border)'}`, borderRadius: 8, overflow: 'hidden' }}>
                  {g.items.map((i, idx) => (
                    <div key={i.id} onClick={() => setOpenScheduled(i)}
                      style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '12px 16px', cursor: 'pointer',
                        borderTop: idx === 0 ? 'none' : '1px solid var(--border)' }}>
                      <div style={{ width: 70, fontSize: 13, fontWeight: 600, color: i.status === 'overdue' ? '#c0392b' : 'var(--ink)' }}>
                        {fmtTime(i.scheduled_for)}
                      </div>
                      <div style={{ flex: '0 0 200px' }}><TypePill label={i.label} audience={i.audience} /></div>
                      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{i.recipient_name}</div>
                        <AudienceTag audience={i.audience} />
                      </div>
                      <div style={{ flex: '2 1 240px', minWidth: 0, fontSize: 12.5, color: 'var(--muted)' }}>{i.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <table className="tbl" style={{ margin: 0 }}>
              <thead>
                <tr><th>EMAIL</th><th>TO</th><th>CLIENT</th><th>{view === 'failed' ? 'FAILED' : 'SENT'}</th></tr>
              </thead>
              <tbody>
                {rows.map((e: any) => (
                  <tr key={e.id} onClick={() => setOpenSentId(e.id)} style={{ cursor: 'pointer' }}>
                    <td>
                      <TypePill label={e.label} audience={e.audience} />
                      <div style={{ fontSize: 13, marginTop: 5, color: 'var(--ink)' }}>{e.subject || '—'}</div>
                      {e.status === 'failed' && <div style={{ fontSize: 11.5, color: '#c0392b', marginTop: 3 }}>{e.error}</div>}
                    </td>
                    <td>
                      <div style={{ fontSize: 12.5, color: 'var(--ink)' }}>{e.recipient_email || '—'}</div>
                      <AudienceTag audience={e.audience} />
                    </td>
                    <td style={{ fontSize: 13 }}>{e.client_name || '—'}</td>
                    <td style={{ fontSize: 12.5, whiteSpace: 'nowrap', color: e.status === 'failed' ? '#c0392b' : undefined }}>{fmtDateTime(e.sent_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openSentId && <SentDetailModal id={openSentId} onClose={() => setOpenSentId(null)} onViewClient={goToClient} />}
      {openScheduled && <ScheduledDetailModal item={openScheduled} onClose={() => setOpenScheduled(null)} onViewClient={goToClient} />}
    </AppShell>
  )
}
