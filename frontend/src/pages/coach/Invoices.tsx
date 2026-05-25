import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { invoicesApi, clientsApi, activitiesApi, pipelineApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { StatusBadge, EmptyState } from '../../components/ui'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function fmt$(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function exportCSV(invoices: any[]) {
  const headers = ['Invoice #', 'Issue Date', 'Client', 'Company', 'Amount', 'Paid', 'Status', 'Due Date']
  const rows = invoices.map(inv => [
    inv.number,
    inv.created_at?.slice(0, 10) || '',
    inv.client_name || '',
    '',
    Number(inv.total).toFixed(2),
    Number(inv.amount_paid || 0).toFixed(2),
    inv.status,
    inv.due_date || '',
  ])
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = 'invoices.csv'
  a.click()
}

// ── Payment progress bar ──────────────────────────────────────────────────────

function PaymentBar({ paid, total, status }: { paid: number; total: number; status: string }) {
  const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0
  const isOverdue = status === 'overdue'
  const isPaid = status === 'paid'
  const isRefunded = ['refunded', 'partially_refunded'].includes(status)

  if (isRefunded) {
    return <span style={{ fontSize: 12, color: 'var(--rust)', fontWeight: 500 }}>Refunded</span>
  }

  const barColor = isPaid ? '#3d6e4a' : isOverdue ? '#c0392b' : '#b8922e'

  return (
    <div>
      <div style={{ fontSize: 12, color: isPaid ? 'var(--success)' : isOverdue ? 'var(--rust)' : 'var(--ink)', fontWeight: 500, marginBottom: 3 }}>
        {isPaid ? `$${fmt$(paid)} via bank` : `$${fmt$(paid)} of $${fmt$(total)}`}
      </div>
      <div style={{ height: 4, background: 'var(--cream)', borderRadius: 2, width: 120 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 2, transition: 'width .3s' }} />
      </div>
    </div>
  )
}

// ── Client hub (shown when a client is selected) ──────────────────────────────

const STAGE_COLOURS: Record<string, string> = {
  lead: '#6e6560', prospect: '#2d6a9f', proposal: '#b8922e',
  negotiation: '#a0522d', closed_won: '#3d6e4a', closed_lost: '#c0392b',
}

function ClientHub({ client, statusFilter, search }: { client: any; statusFilter: string; search: string }) {
  const navigate = useNavigate()

  const { data: invData } = useQuery({
    queryKey: ['invoices-client', client.id, statusFilter],
    queryFn: () => invoicesApi.list({ client: client.id, status: statusFilter || undefined }).then(r => r.data),
  })
  const allInvoices: any[] = invData?.results || invData || []
  const invoices = search
    ? allInvoices.filter(inv => {
        const q = search.toLowerCase()
        return inv.number?.toLowerCase().includes(q) || String(inv.total).includes(q)
      })
    : allInvoices

  const { data: dealsData } = useQuery({
    queryKey: ['pipeline-client', client.id],
    queryFn: () => pipelineApi.dealsByClient(client.id).then(r => r.data),
  })
  const deals: any[] = dealsData?.results || dealsData || []
  const activeDeal = deals[0] || null

  const { data: actData } = useQuery({
    queryKey: ['activities-client', client.id],
    queryFn: () => activitiesApi.list({ client: client.id, status: 'scheduled' }).then(r => r.data),
  })
  const sessions: any[] = (actData?.results || actData || [])
    .filter((a: any) => new Date(a.start_at) >= new Date())
    .sort((a: any, b: any) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    .slice(0, 3)

  const totalInvoiced = allInvoices.reduce((s: number, i: any) => s + Number(i.total || 0), 0)
  const totalPaid = allInvoices.filter((i: any) => i.status === 'paid').reduce((s: number, i: any) => s + Number(i.amount_paid || i.total || 0), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Client banner */}
      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '18px 24px', display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 400 }}>{client.first_name} {client.last_name}</div>
          {client.company && <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>{client.company}</div>}
        </div>
        {client.email && (
          <div>
            <div style={{ fontSize: 10, letterSpacing: '.1em', color: 'var(--muted)', fontWeight: 600, marginBottom: 2 }}>EMAIL</div>
            <a href={`mailto:${client.email}`} style={{ color: 'var(--blue)', fontSize: 13, textDecoration: 'none' }}>{client.email}</a>
          </div>
        )}
        {client.phone && (
          <div>
            <div style={{ fontSize: 10, letterSpacing: '.1em', color: 'var(--muted)', fontWeight: 600, marginBottom: 2 }}>PHONE</div>
            <span style={{ fontSize: 13 }}>{client.phone}</span>
          </div>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 24 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600 }}>${fmt$(totalInvoiced)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '.06em' }}>TOTAL INVOICED</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600, color: 'var(--success)' }}>${fmt$(totalPaid)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '.06em' }}>COLLECTED</div>
          </div>
        </div>
      </div>

      {/* Pipeline + Schedule */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '18px 20px' }}>
          <div style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--muted)', fontWeight: 600, marginBottom: 14 }}>PIPELINE</div>
          {activeDeal ? (
            <div>
              <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 20, background: (STAGE_COLOURS[activeDeal.stage] || '#6e6560') + '18', color: STAGE_COLOURS[activeDeal.stage] || '#6e6560', fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                {activeDeal.stage?.replace(/_/g, ' ')}
              </span>
              {activeDeal.deal_value && <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600, marginBottom: 4 }}>${Number(activeDeal.deal_value).toLocaleString()}</div>}
              {activeDeal.stage_changed_at && <div style={{ fontSize: 12, color: 'var(--muted)' }}>In stage since {fmtDate(activeDeal.stage_changed_at)}</div>}
            </div>
          ) : <div style={{ color: 'var(--muted)', fontSize: 13 }}>No active pipeline deal</div>}
        </div>
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '18px 20px' }}>
          <div style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--muted)', fontWeight: 600, marginBottom: 14 }}>UPCOMING SESSIONS</div>
          {sessions.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sessions.map((s: any) => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{s.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, textTransform: 'capitalize' }}>{s.activity_type}</div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 500 }}>{fmtDateTime(s.start_at)}</div>
                </div>
              ))}
            </div>
          ) : <div style={{ color: 'var(--muted)', fontSize: 13 }}>No upcoming sessions</div>}
        </div>
      </div>

      {/* Invoices table */}
      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '14px 24px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--muted)', fontWeight: 600 }}>INVOICES ({invoices.length})</div>
          <button className="btn btn-dark btn-sm" onClick={() => navigate('/invoices/new')} style={{ fontSize: 11 }}>+ New Invoice</button>
        </div>
        {invoices.length === 0 ? (
          <div style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No invoices for this client</div>
        ) : (
          <table className="tbl" style={{ margin: 0 }}>
            <thead><tr><th>INVOICE</th><th>STATUS</th><th>AMOUNT</th><th>PAYMENT</th><th>DUE DATE</th></tr></thead>
            <tbody>
              {invoices.map((inv: any) => (
                <tr key={inv.id} onClick={() => navigate(`/invoices/${inv.id}`)} style={{ cursor: 'pointer' }}>
                  <td>
                    <div style={{ fontWeight: 600, fontFamily: 'Cormorant Garamond, serif', fontSize: 15 }}>{inv.number}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{fmtDate(inv.created_at)}</div>
                  </td>
                  <td><StatusBadge status={inv.status} /></td>
                  <td style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, fontWeight: 600 }}>${Number(inv.total).toFixed(2)}</td>
                  <td><PaymentBar paid={Number(inv.amount_paid || 0)} total={Number(inv.total)} status={inv.status} /></td>
                  <td style={{ fontSize: 13, color: inv.status === 'overdue' ? 'var(--warn)' : 'inherit', fontWeight: inv.status === 'overdue' ? 600 : 400 }}>
                    {fmtDate(inv.due_date)}{inv.status === 'overdue' ? ' ⚠' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Invoices() {
  const navigate = useNavigate()
  const [selectedClientId, setSelectedClientId] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

  const { data: clientsData } = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => clientsApi.list({ page_size: 200 }).then(r => r.data),
  })
  const clients: any[] = clientsData?.results || clientsData || []
  const selectedClient = clients.find((c: any) => String(c.id) === selectedClientId) || null

  const { data: allData, isLoading } = useQuery({
    queryKey: ['invoices', statusFilter],
    queryFn: () => invoicesApi.list({ status: statusFilter || undefined }).then(r => r.data),
    enabled: !selectedClientId,
  })
  const allInvoices: any[] = allData?.results || allData || []

  const filtered = useMemo(() => {
    if (!search.trim()) return allInvoices
    const q = search.toLowerCase()
    return allInvoices.filter(inv =>
      inv.number?.toLowerCase().includes(q) ||
      (inv.client_name || '').toLowerCase().includes(q) ||
      String(inv.total).includes(q)
    )
  }, [allInvoices, search])

  // Stats
  const totalInvoiced = allInvoices.reduce((s, i) => s + Number(i.total || 0), 0)
  const totalCollected = allInvoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.amount_paid || i.total || 0), 0)
  const outstanding = allInvoices.filter(i => ['sent', 'overdue', 'partially_paid'].includes(i.status)).reduce((s, i) => s + (Number(i.total) - Number(i.amount_paid || 0)), 0)
  const overdueCount = allInvoices.filter(i => i.status === 'overdue').length
  const totalRefunded = allInvoices.reduce((s, i) => s + Number(i.refund_amount || 0), 0)
  const collectionRate = totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 100) : 0

  const STATUS_PILLS = ['', 'paid', 'partially_paid', 'sent', 'overdue', 'refunded']
  const STATUS_LABELS: Record<string, string> = { '': 'All', paid: 'Paid', partially_paid: 'Partial', sent: 'Unpaid', overdue: 'Overdue', refunded: 'Refunded' }

  return (
    <AppShell>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '24px 32px 20px', borderBottom: '1px solid var(--border)', background: 'var(--paper)' }}>
        <div>
          <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 400, color: 'var(--ink)' }}>Invoices</h1>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>
            {allInvoices.length} invoices · ${fmt$(totalInvoiced)} total · ${fmt$(outstanding)} outstanding
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={() => exportCSV(allInvoices)} style={{ fontSize: 12, letterSpacing: '.05em', fontWeight: 600 }}>
            EXPORT CSV
          </button>
          <button className="btn btn-dark" onClick={() => navigate('/invoices/new')} style={{ fontSize: 12, letterSpacing: '.05em', fontWeight: 600 }}>
            + NEW INVOICE
          </button>
        </div>
      </div>

      <div className="page-body">
        {/* ── Stat cards (all-client view only) ── */}
        {!selectedClientId && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
            {[
              { label: 'TOTAL INVOICED (YTD)', value: `$${fmt$(totalInvoiced)}`, sub: `Across ${allInvoices.length} invoices`, color: 'var(--ink)' },
              { label: 'COLLECTED', value: `$${fmt$(totalCollected)}`, sub: `${collectionRate}% collection rate`, color: 'var(--success)' },
              { label: 'OUTSTANDING', value: `$${fmt$(outstanding)}`, sub: `${overdueCount > 0 ? overdueCount + ' invoices overdue' : 'All current'}`, color: 'var(--rust)' },
              { label: 'REFUNDED', value: `$${fmt$(totalRefunded)}`, sub: 'Excluded from revenue', color: '#c0392b' },
            ].map(card => (
              <div key={card.label} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '18px 20px' }}>
                <div style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--muted)', fontWeight: 600, marginBottom: 10 }}>{card.label}</div>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 400, color: card.color, marginBottom: 4 }}>{card.value}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{card.sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Filters bar ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          {/* Search */}
          <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 420 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 14 }}>🔍</span>
            <input
              className="finput"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by client, invoice #, amount…"
              style={{ marginBottom: 0, paddingLeft: 30 }}
            />
          </div>

          {/* Client selector */}
          <select
            className="fselect"
            value={selectedClientId}
            onChange={e => { setSelectedClientId(e.target.value); setStatusFilter(''); setSearch('') }}
            style={{ width: 220, marginBottom: 0 }}
          >
            <option value="">All clients</option>
            {clients.map((c: any) => (
              <option key={c.id} value={c.id}>{c.first_name} {c.last_name}{c.company ? ` — ${c.company}` : ''}</option>
            ))}
          </select>

          {/* Status pills */}
          <div style={{ display: 'flex', gap: 4 }}>
            {STATUS_PILLS.map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  padding: '6px 14px', borderRadius: 20, border: '1px solid var(--border)',
                  background: statusFilter === s ? 'var(--ink)' : '#fff',
                  color: statusFilter === s ? '#fff' : 'var(--muted)',
                  cursor: 'pointer', fontSize: 12, fontWeight: statusFilter === s ? 600 : 400,
                  transition: 'all .15s',
                }}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* ── Client hub OR all-invoices table ── */}
        {selectedClient ? (
          <ClientHub client={selectedClient} statusFilter={statusFilter} search={search} />
        ) : isLoading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="$" title="No invoices" message={search || statusFilter ? 'No invoices match your filters' : 'Create your first invoice'} />
        ) : (
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <table className="tbl" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>INVOICE</th>
                  <th>CLIENT</th>
                  <th>AMOUNT</th>
                  <th>STATUS</th>
                  <th>PAYMENT</th>
                  <th>DUE DATE</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv: any) => {
                  const isOverdue = inv.status === 'overdue'
                  const client = clients.find((c: any) => `${c.first_name} ${c.last_name}` === inv.client_name)
                  return (
                    <tr key={inv.id} onClick={() => navigate(`/invoices/${inv.id}`)} style={{ cursor: 'pointer' }}>
                      <td>
                        <div style={{ fontWeight: 600, fontFamily: 'Cormorant Garamond, serif', fontSize: 15 }}>{inv.number}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{fmtDate(inv.created_at)}</div>
                      </td>
                      <td>
                        <div
                          style={{ fontWeight: 500, color: 'var(--ink)', cursor: 'pointer' }}
                          onClick={e => { e.stopPropagation(); if (client) setSelectedClientId(String(client.id)) }}
                        >
                          {inv.client_name || '—'}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{inv.client_company || ''}</div>
                      </td>
                      <td style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, fontWeight: 600 }}>${Number(inv.total).toFixed(2)}</td>
                      <td><StatusBadge status={inv.status} /></td>
                      <td><PaymentBar paid={Number(inv.amount_paid || 0)} total={Number(inv.total)} status={inv.status} /></td>
                      <td style={{ fontSize: 13, color: isOverdue ? 'var(--warn)' : 'inherit', fontWeight: isOverdue ? 600 : 400, whiteSpace: 'nowrap' }}>
                        {fmtDate(inv.due_date)}{isOverdue ? ' ⚠' : ''}
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        {isOverdue ? (
                          <span style={{ color: 'var(--gold)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} onClick={() => navigate(`/invoices/${inv.id}`)}>
                            Send Reminder →
                          </span>
                        ) : (
                          <span style={{ color: 'var(--gold)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} onClick={() => navigate(`/invoices/${inv.id}`)}>
                            View →
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}
