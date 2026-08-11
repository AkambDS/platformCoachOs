import { StatusBadge } from './ui'

// ── helpers ───────────────────────────────────────────────────────────────────

// Date-only fields (due_date, next_invoice_date, etc.) come back as "YYYY-MM-DD" with
// no time/timezone — `new Date(...)` parses that as UTC midnight, which renders as the
// PREVIOUS day in any timezone behind UTC (e.g. US). Appending a local-time suffix makes
// JS parse it as local midnight instead. Datetime fields (sent_at, created_at, etc.)
// already carry a timezone and pass through unchanged.
export function parseDate(d: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00') : new Date(d)
}

export function fmtDate(d: string) {
  if (!d) return '—'
  return parseDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtDateTime(d: string) {
  if (!d) return '—'
  return parseDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function fmt$(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export const isPastDueUnpaid = (inv: any) =>
  !!inv.due_date && parseDate(inv.due_date) < new Date() && !['paid', 'void', 'refunded', 'draft'].includes(inv.status)

// Action priority: past-due-and-unpaid first (most urgent), then anything still
// outstanding, then settled/void invoices last — soonest due date wins within each tier.
export function sortActionableInvoices(invoices: any[]) {
  const actionable = invoices.filter(inv => inv.status !== 'draft')
  const priority = (inv: any) => {
    if (isPastDueUnpaid(inv)) return 0
    if (['sent', 'partially_paid', 'overdue'].includes(inv.status)) return 1
    return 2
  }
  return [...actionable].sort((a, b) => {
    const pDiff = priority(a) - priority(b)
    if (pDiff !== 0) return pDiff
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return parseDate(a.due_date).getTime() - parseDate(b.due_date).getTime()
  })
}

// ── Payment progress bar ──────────────────────────────────────────────────────

export function PaymentBar({ paid, total, status }: { paid: number; total: number; status: string }) {
  const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0
  const isOverdue   = status === 'overdue'
  const isPaid      = status === 'paid'
  const isPartial   = status === 'partially_paid'
  const isRefunded  = ['refunded', 'partially_refunded'].includes(status)
  const isDraft     = status === 'draft'

  const textColor = isPaid ? '#3d6e4a'
    : isOverdue   ? '#c0392b'
    : isPartial   ? '#b8922e'
    : isRefunded  ? '#8b5cf6'
    : 'var(--muted)'

  const barColor = isPaid ? '#3d6e4a'
    : isOverdue   ? '#c0392b'
    : isPartial   ? '#b8922e'
    : '#d1ccc4'

  const label = isPaid     ? `$${fmt$(paid)} paid`
    : isRefunded            ? `−$${fmt$(paid)} refunded`
    : isDraft               ? '—'
    : `$${fmt$(paid)} of $${fmt$(total)}`

  return (
    <div>
      <div style={{ fontSize: 12, color: textColor, fontWeight: 500, marginBottom: 3 }}>{label}</div>
      {!isDraft && (
        <div style={{ height: 4, background: '#e9e5df', borderRadius: 2, width: 120 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 2, transition: 'width .3s' }} />
        </div>
      )}
    </div>
  )
}

// ── Invoice tables (drafts + actionable) — shared across every place invoices are
// listed (all-clients view, a single client's hub, a client's profile widget), so they
// all look and behave identically. ──────────────────────────────────────────────
export function InvoiceTables({
  invoices, clients, navigate, handleRemind, reminding, showClientColumn, onClientClick,
}: {
  invoices: any[]; clients: any[]; navigate: (path: string) => void
  handleRemind: (e: React.MouseEvent, invId: string) => void; reminding: string | null
  showClientColumn: boolean; onClientClick?: (clientId: string) => void
}) {
  const draftInvoices = invoices.filter(inv => inv.status === 'draft')
  const sortedInvoices = sortActionableInvoices(invoices)

  return (
    <>
      {draftInvoices.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#b8860b', marginBottom: 8 }}>
            ⚠ Drafts — Need to Send ({draftInvoices.length})
          </div>
          <div style={{ background: '#fffbf0', border: '1px solid #f0dca0', borderRadius: 8, overflow: 'hidden' }}>
            <table className="tbl" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>INVOICE</th>
                  {showClientColumn && <th>CLIENT</th>}
                  <th>AMOUNT</th>
                  <th>STATUS</th>
                  <th>DUE DATE</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {draftInvoices.map((inv: any) => {
                  const client = clients.find((c: any) => `${c.first_name} ${c.last_name}` === inv.client_name)
                  return (
                    <tr key={inv.id} onClick={() => navigate(`/invoices/${inv.id}`)} style={{ cursor: 'pointer' }}>
                      <td>
                        <div style={{ fontWeight: 600, fontFamily: 'Cormorant Garamond, serif', fontSize: 15 }}>{inv.number}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                          {fmtDate(inv.created_at)}
                          <span style={{
                            fontSize: 9.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
                            padding: '1px 6px', borderRadius: 8,
                            background: inv.invoice_type === 'subscription' ? '#2d6a9f18' : '#8c827918',
                            color: inv.invoice_type === 'subscription' ? '#2d6a9f' : '#8c8279',
                          }}>
                            {inv.invoice_type === 'subscription'
                              ? (inv.billing_cycle ? inv.billing_cycle.charAt(0).toUpperCase() + inv.billing_cycle.slice(1) : 'Subscription')
                              : 'One-Time'}
                          </span>
                        </div>
                      </td>
                      {showClientColumn && (
                        <td>
                          <div
                            style={{ fontWeight: 500, color: 'var(--ink)', cursor: 'pointer' }}
                            onClick={e => { e.stopPropagation(); if (client) onClientClick?.(String(client.id)) }}
                          >
                            {inv.client_name || '—'}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{inv.client_company || ''}</div>
                        </td>
                      )}
                      <td style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, fontWeight: 600 }}>${Number(inv.total).toFixed(2)}</td>
                      <td><StatusBadge status={inv.status} /></td>
                      <td style={{ fontSize: 13 }}>{fmtDate(inv.due_date)}</td>
                      <td onClick={e => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                        <span style={{ color: '#b8860b', fontSize: 13, fontWeight: 700, cursor: 'pointer' }} onClick={() => navigate(`/invoices/${inv.id}`)}>
                          Send Invoice →
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sortedInvoices.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ maxHeight: 'max(420px, calc(100vh - 480px))', overflowY: 'auto' }}>
          <table className="tbl" style={{ margin: 0 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
              <tr>
                <th style={{ background: '#fff' }}>INVOICE</th>
                {showClientColumn && <th style={{ background: '#fff' }}>CLIENT</th>}
                <th style={{ background: '#fff' }}>AMOUNT</th>
                <th style={{ background: '#fff' }}>STATUS</th>
                <th style={{ background: '#fff' }}>PAYMENT</th>
                <th style={{ background: '#fff' }}>DUE / NEXT BILL</th>
                <th style={{ background: '#fff' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {sortedInvoices.map((inv: any) => {
                const pastDueUnpaid = isPastDueUnpaid(inv)
                const isOverdue = inv.status === 'overdue' || pastDueUnpaid
                const client = clients.find((c: any) => `${c.first_name} ${c.last_name}` === inv.client_name)
                return (
                  <tr key={inv.id} onClick={() => navigate(`/invoices/${inv.id}`)}
                    style={{ cursor: 'pointer', background: pastDueUnpaid ? '#fef2f2' : undefined }}>
                    <td>
                      <div style={{ fontWeight: 600, fontFamily: 'Cormorant Garamond, serif', fontSize: 15 }}>{inv.number}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                        {fmtDate(inv.created_at)}
                        <span style={{
                          fontSize: 9.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
                          padding: '1px 6px', borderRadius: 8,
                          background: inv.invoice_type === 'subscription' ? '#2d6a9f18' : '#8c827918',
                          color: inv.invoice_type === 'subscription' ? '#2d6a9f' : '#8c8279',
                        }}>
                          {inv.invoice_type === 'subscription'
                            ? (inv.billing_cycle ? inv.billing_cycle.charAt(0).toUpperCase() + inv.billing_cycle.slice(1) : 'Subscription')
                            : 'One-Time'}
                        </span>
                      </div>
                    </td>
                    {showClientColumn && (
                      <td>
                        <div
                          style={{ fontWeight: 500, color: 'var(--ink)', cursor: 'pointer' }}
                          onClick={e => { e.stopPropagation(); if (client) onClientClick?.(String(client.id)) }}
                        >
                          {inv.client_name || '—'}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{inv.client_company || ''}</div>
                      </td>
                    )}
                    <td style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, fontWeight: 600 }}>${Number(inv.total).toFixed(2)}</td>
                    <td>
                      <StatusBadge status={inv.status} />
                      {inv.sent_at && (
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                          ✓ Emailed {fmtDate(inv.sent_at)}
                        </div>
                      )}
                    </td>
                    <td><PaymentBar paid={Number(inv.amount_paid || 0)} total={Number(inv.total)} status={inv.status} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {inv.invoice_type === 'subscription' ? (
                        inv.next_invoice_date ? (
                          <div>
                            <div style={{ fontSize: 9.5, letterSpacing: '.06em', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' }}>Next Bill</div>
                            <span style={{ fontSize: 13 }}>{fmtDate(inv.next_invoice_date)}</span>
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                            {inv.subscription_auto_send ? '—' : 'Recurring stopped'}
                          </span>
                        )
                      ) : (() => {
                        const daysLeft = inv.due_date ? Math.ceil((parseDate(inv.due_date).getTime() - Date.now()) / 86400000) : null
                        const isDueSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7 && !isOverdue
                        const color = isOverdue ? '#c0392b' : isDueSoon ? '#e67e22' : 'inherit'
                        const suffix = isOverdue ? ' ✕' : isDueSoon ? ' ⚠' : ''
                        return (
                          <span style={{ fontSize: 13, color, fontWeight: isOverdue || isDueSoon ? 600 : 400 }}>
                            {fmtDate(inv.due_date)}{suffix}
                          </span>
                        )
                      })()}
                    </td>
                    <td onClick={e => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {['sent', 'overdue', 'partially_paid'].includes(inv.status) && (() => {
                          const daysLeft = inv.due_date ? Math.ceil((parseDate(inv.due_date).getTime() - Date.now()) / 86400000) : null
                          const isDueSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7 && !isOverdue
                          const reminderColor = isOverdue ? '#c0392b' : isDueSoon ? '#e67e22' : 'var(--muted)'
                          return (
                            <span
                              onClick={e => handleRemind(e, String(inv.id))}
                              style={{
                                color: reminderColor,
                                fontSize: 13, fontWeight: 600, cursor: reminding === String(inv.id) ? 'default' : 'pointer',
                                opacity: reminding === String(inv.id) ? 0.5 : 1,
                              }}
                            >
                              {reminding === String(inv.id) ? 'Sending…' : 'Send Reminder →'}
                            </span>
                          )
                        })()}
                        <span style={{ color: 'var(--gold)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} onClick={() => navigate(`/invoices/${inv.id}`)}>
                          View →
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </>
  )
}
