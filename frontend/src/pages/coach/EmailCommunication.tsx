import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { emailCommApi, clientsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { EmptyState, Modal } from '../../components/ui'

// ── helpers ───────────────────────────────────────────────────────────────────

// Date-only fields ("YYYY-MM-DD") parse as UTC midnight under plain `new Date(...)`,
// which renders as the PREVIOUS day in any timezone behind UTC. Datetime fields
// (sent_at) already carry a timezone and pass through unchanged.
function parseDate(d: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00') : new Date(d)
}

function fmtDate(d: string) {
  if (!d) return '—'
  return parseDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(d: string) {
  if (!d) return '—'
  return parseDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const CATEGORY_COLORS: Record<string, string> = {
  invoice:                '#2d6a9f',
  payment_receipt:        '#3d6e4a',
  activity_confirmation:  '#8c8279',
  activity_reminder:      '#b8922e',
  activity_reschedule:    '#a0522d',
  activity_cancellation:  '#c0392b',
  client_message:         '#6e6560',
  portal_invite:          '#795548',
}

function CategoryPill({ category, label }: { category: string; label: string }) {
  const color = CATEGORY_COLORS[category] || '#8c8279'
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 20,
      background: color + '18', color, fontSize: 11, fontWeight: 700,
      letterSpacing: '.02em',
    }}>
      {label}
    </span>
  )
}

const SCHEDULED_EXPLAINER: Record<string, string> = {
  invoice: 'This invoice is set to auto-generate and email itself on this date, based on the subscription\'s billing cycle.',
  activity_reminder: 'A reminder email will go out automatically ahead of this session — 24 hours before by default, or 1 hour before if the 24-hour window has already passed.',
}

// ── Sent email detail — fetches the full record (incl. the body_html snapshot
// captured at send time) since the list view only carries lightweight summary fields.
function SentDetailModal({ id, onClose, onViewClient }: {
  id: string; onClose: () => void; onViewClient: (clientId: string) => void
}) {
  const { data: e, isLoading } = useQuery({
    queryKey: ['email-log-detail', id],
    queryFn: () => emailCommApi.detail(id).then(r => r.data),
  })

  return (
    <Modal title="Email Details" size="lg" onClose={onClose}>
      {isLoading || !e ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CategoryPill category={e.category} label={e.category_label} />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Sent {fmtDateTime(e.sent_at)}</span>
          </div>
          <div style={{ padding: '10px 14px', background: '#f7f5f2', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}>
            <div><span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: 'var(--muted)', marginRight: 10 }}>TO</span>
              {e.client_id ? (
                <a onClick={() => onViewClient(e.client_id)} style={{ cursor: 'pointer', color: 'var(--ink)', fontWeight: 600 }}>{e.client_name}</a>
              ) : <strong>{e.client_name || '—'}</strong>}
              {e.recipient_email && <span style={{ color: 'var(--muted)', marginLeft: 8 }}>· {e.recipient_email}</span>}
            </div>
            <div style={{ marginTop: 6 }}><span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: 'var(--muted)', marginRight: 10 }}>SUBJECT</span>{e.subject || '—'}</div>
          </div>
          {e.body_html ? (
            <div style={{ height: 440, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', background: '#eeebe5' }}>
              <iframe srcDoc={e.body_html} title="Email content" sandbox="allow-same-origin"
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }} />
            </div>
          ) : (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              No content snapshot was captured for this email.
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

// ── Scheduled item detail — everything needed is already in the row (it's a computed
// projection, not a stored record), so no fetch is needed.
function ScheduledDetailModal({ item, onClose, onViewClient }: {
  item: any; onClose: () => void; onViewClient: (clientId: string) => void
}) {
  return (
    <Modal title="Scheduled Email" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CategoryPill category={item.category} label={item.category_label} />
          <span style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 600 }}>Scheduled for {fmtDate(item.scheduled_for)}</span>
        </div>
        <div style={{ padding: '10px 14px', background: '#f7f5f2', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}>
          <div><span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: 'var(--muted)', marginRight: 10 }}>TO</span>
            {item.client_id ? (
              <a onClick={() => onViewClient(item.client_id)} style={{ cursor: 'pointer', color: 'var(--ink)', fontWeight: 600 }}>{item.client_name}</a>
            ) : <strong>{item.client_name || '—'}</strong>}
          </div>
          <div style={{ marginTop: 6 }}><span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: 'var(--muted)', marginRight: 10 }}>SUBJECT</span>{item.subject || '—'}</div>
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
          {SCHEDULED_EXPLAINER[item.category] || 'This email has not been sent yet — nothing to preview.'}
        </div>
      </div>
    </Modal>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EmailCommunication() {
  const navigate = useNavigate()
  const [view, setView] = useState<'sent' | 'scheduled'>('sent')
  const [selectedClientId, setSelectedClientId] = useState('')
  const [search, setSearch] = useState('')
  const [openSentId, setOpenSentId] = useState<string | null>(null)
  const [openScheduled, setOpenScheduled] = useState<any | null>(null)

  const goToClient = (clientId: string) => {
    setOpenSentId(null); setOpenScheduled(null)
    navigate(`/clients/${clientId}`)
  }

  const { data: clientsData } = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => clientsApi.list({ page_size: 200 }).then(r => r.data),
  })
  const clients: any[] = clientsData?.results || clientsData || []

  const { data: sentData, isLoading: sentLoading } = useQuery({
    queryKey: ['email-log-sent', selectedClientId],
    queryFn: () => emailCommApi.sent({ days: 30, client: selectedClientId || undefined }).then(r => r.data),
  })
  const sent: any[] = sentData || []

  const { data: scheduledData, isLoading: scheduledLoading } = useQuery({
    queryKey: ['email-log-scheduled', selectedClientId],
    queryFn: () => emailCommApi.scheduled({ days: 30 }).then(r => r.data),
  })
  const scheduledAll: any[] = scheduledData || []
  const scheduled = selectedClientId
    ? scheduledAll.filter(i => i.client_id === selectedClientId)
    : scheduledAll

  const filteredSent = useMemo(() => {
    if (!search.trim()) return sent
    const q = search.toLowerCase()
    return sent.filter(e => e.subject?.toLowerCase().includes(q) || e.client_name?.toLowerCase().includes(q) || e.recipient_email?.toLowerCase().includes(q))
  }, [sent, search])

  const filteredScheduled = useMemo(() => {
    if (!search.trim()) return scheduled
    const q = search.toLowerCase()
    return scheduled.filter(e => e.subject?.toLowerCase().includes(q) || e.client_name?.toLowerCase().includes(q))
  }, [scheduled, search])

  const rows = view === 'sent' ? filteredSent : filteredScheduled
  const loading = view === 'sent' ? sentLoading : scheduledLoading

  return (
    <AppShell>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '24px 32px 20px', borderBottom: '1px solid var(--border)', background: '#f7f4ef' }}>
        <div>
          <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 400, color: 'var(--ink)' }}>Email Communication</h1>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>
            Every client-facing email sent in the last 30 days, and what's scheduled to go out in the next 30
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* ── Sent / Scheduled toggle ── */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
          {[
            { key: 'sent', label: `Sent — Past 30 Days (${sent.length})` },
            { key: 'scheduled', label: `Scheduled — Next 30 Days (${scheduledAll.length})` },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setView(t.key as any)}
              style={{
                padding: '10px 20px',
                background: view === t.key ? 'var(--ink)' : 'transparent',
                color: view === t.key ? '#fff' : 'var(--muted)',
                border: '1px solid var(--border)',
                borderBottom: view === t.key ? '1px solid var(--ink)' : '1px solid var(--border)',
                cursor: 'pointer', fontSize: 13, fontWeight: view === t.key ? 600 : 400,
                borderRadius: '4px 4px 0 0', marginBottom: -1, letterSpacing: '.01em',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Filters ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 420 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 14 }}>🔍</span>
            <input
              className="finput"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by client, subject…"
              style={{ marginBottom: 0, paddingLeft: 30 }}
            />
          </div>
          <select
            className="fselect"
            value={selectedClientId}
            onChange={e => setSelectedClientId(e.target.value)}
            style={{ width: 220, marginBottom: 0 }}
          >
            <option value="">All clients</option>
            {clients.map((c: any) => (
              <option key={c.id} value={c.id}>{c.first_name} {c.last_name}{c.company ? ` — ${c.company}` : ''}</option>
            ))}
          </select>
        </div>

        {/* ── Table ── */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="✉"
            title={view === 'sent' ? 'No emails sent in the last 30 days' : 'Nothing scheduled in the next 30 days'}
            message={view === 'sent'
              ? 'Invoice, receipt, session, and client-message emails will show up here once sent.'
              : 'Upcoming subscription invoices and pending session reminders will show up here.'}
          />
        ) : (
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <table className="tbl" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>TYPE</th>
                  <th>SUBJECT</th>
                  <th>CLIENT</th>
                  <th>{view === 'sent' ? 'SENT' : 'SCHEDULED FOR'}</th>
                </tr>
              </thead>
              <tbody>
                {view === 'sent' ? filteredSent.map((e: any) => (
                  <tr
                    key={e.id}
                    onClick={() => setOpenSentId(e.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td><CategoryPill category={e.category} label={e.category_label} /></td>
                    <td style={{ fontSize: 13 }}>{e.subject || '—'}</td>
                    <td>
                      <div style={{ fontWeight: 500, color: 'var(--ink)' }}>{e.client_name || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{e.recipient_email}</div>
                    </td>
                    <td style={{ fontSize: 13 }}>{fmtDateTime(e.sent_at)}</td>
                  </tr>
                )) : filteredScheduled.map((e: any) => (
                  <tr
                    key={e.id}
                    onClick={() => setOpenScheduled(e)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td><CategoryPill category={e.category} label={e.category_label} /></td>
                    <td style={{ fontSize: 13 }}>{e.subject || '—'}</td>
                    <td>
                      <div style={{ fontWeight: 500, color: 'var(--ink)' }}>{e.client_name || '—'}</div>
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 600 }}>{fmtDate(e.scheduled_for)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openSentId && (
        <SentDetailModal id={openSentId} onClose={() => setOpenSentId(null)} onViewClient={goToClient} />
      )}
      {openScheduled && (
        <ScheduledDetailModal item={openScheduled} onClose={() => setOpenScheduled(null)} onViewClient={goToClient} />
      )}
    </AppShell>
  )
}
