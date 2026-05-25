import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { invoicesApi, settingsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { Modal, StatusBadge, useToast } from '../../components/ui'

function fmtDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtDateShort(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmt$(n: number | string) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const METHODS = ['bank', 'cash', 'cheque', 'stripe']
const REFUND_REASONS = [
  'Client dissatisfied',
  'Duplicate charge',
  'Service not delivered',
  'Other',
]

const STATUS_STAMP_COLOR: Record<string, { border: string; color: string }> = {
  draft:              { border: '#94a3b8', color: '#94a3b8' },
  sent:               { border: '#3b82f6', color: '#3b82f6' },
  partially_paid:     { border: '#e67e22', color: '#e67e22' },
  paid:               { border: '#22c55e', color: '#22c55e' },
  overdue:            { border: '#ef4444', color: '#ef4444' },
  void:               { border: '#94a3b8', color: '#94a3b8' },
  refunded:           { border: '#8b5cf6', color: '#8b5cf6' },
  partially_refunded: { border: '#8b5cf6', color: '#8b5cf6' },
}

const STATUS_LABEL: Record<string, string> = {
  draft:              'Draft',
  sent:               'Sent',
  partially_paid:     'Partial Payment',
  paid:               'Paid',
  overdue:            'Overdue',
  void:               'Void',
  refunded:           'Refunded',
  partially_refunded: 'Partially Refunded',
}

// ── Invoice Document Renderer ─────────────────────────────────────────────────
function InvoiceDoc({ inv, workspace }: { inv: any; workspace: any }) {
  const subtotal    = Number(inv.subtotal)
  const paid        = Number(inv.amount_paid)
  const total       = Number(inv.total)
  const discountAmt = inv.discount_type === 'percent'
    ? subtotal * Number(inv.discount_value) / 100
    : Number(inv.discount_value || 0)
  const taxAmt      = (subtotal - discountAmt) * Number(inv.tax_percent || 0) / 100
  const balance     = Math.max(0, total - paid)
  const stamp       = STATUS_STAMP_COLOR[inv.status] || STATUS_STAMP_COLOR.draft

  const logoUrl = workspace?.logo_data
    ? `/api/settings/logo/${workspace.id}/`
    : null

  const firstPayment = (inv.payments || [])[0]
  const paidLabel    = firstPayment
    ? `Paid (${new Date(firstPayment.paid_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
    : 'Paid'

  return (
    <div style={{
      background: '#fff',
      borderRadius: 8,
      padding: '40px 48px',
      maxWidth: 680,
      margin: '0 auto',
      fontFamily: 'Inter, system-ui, sans-serif',
      color: '#1a1714',
      fontSize: 13,
      lineHeight: 1.5,
    }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          {logoUrl
            ? <img src={logoUrl} alt={workspace?.name} style={{ maxHeight: 36, maxWidth: 120, objectFit: 'contain', marginBottom: 6 }} />
            : <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 26, fontWeight: 600, letterSpacing: '-.02em', marginBottom: 4 }}>
                {workspace?.name || '—'}
              </div>
          }
          {workspace?.name && logoUrl && (
            <div style={{ fontSize: 12, color: '#6e6560' }}>{workspace.name}</div>
          )}
          {workspace?.email && (
            <div style={{ fontSize: 12, color: '#6e6560' }}>{workspace.email}</div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.12em', color: '#9e9890', marginBottom: 4 }}>Invoice</div>
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 28, fontWeight: 700, letterSpacing: '-.01em' }}>
            {inv.number}
          </div>
          {inv.issue_date && (
            <div style={{ fontSize: 12, color: '#6e6560', marginTop: 4 }}>Issued: {fmtDateShort(inv.issue_date)}</div>
          )}
          {inv.due_date && (
            <div style={{ fontSize: 12, color: '#6e6560' }}>Due: {fmtDateShort(inv.due_date)}</div>
          )}
          {/* Status stamp */}
          <div style={{
            display: 'inline-block',
            marginTop: 10,
            padding: '5px 14px',
            border: `2px solid ${stamp.border}`,
            borderRadius: 4,
            color: stamp.color,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
          }}>
            {STATUS_LABEL[inv.status] || inv.status}
          </div>
        </div>
      </div>

      {/* ── Divider ── */}
      <div style={{ borderTop: '2px solid #1a2f4e', marginBottom: 24 }} />

      {/* ── Bill To + Payment ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32 }}>
        <div>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', color: '#9e9890', fontWeight: 600, marginBottom: 8 }}>
            Bill To
          </div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{inv.client_name}</div>
          {inv.client_company && <div style={{ color: '#6e6560', fontSize: 12, marginTop: 1 }}>{inv.client_company}</div>}
          {inv.client_email   && <div style={{ color: '#6e6560', fontSize: 12 }}>{inv.client_email}</div>}
          {inv.client_phone   && <div style={{ color: '#6e6560', fontSize: 12 }}>{inv.client_phone}</div>}
        </div>
        <div>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', color: '#9e9890', fontWeight: 600, marginBottom: 8 }}>
            Payment
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#1a1714' }}>
            <div>✓ Bank transfer</div>
            <div>✓ Cash / Cheque</div>
          </div>
        </div>
      </div>

      {/* ── Line Items ── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e4dfd6' }}>
            {['Description', 'QTY', 'Unit Price', 'Total'].map((h, i) => (
              <th key={h} style={{
                textAlign: i === 0 ? 'left' : 'right',
                padding: '6px 4px',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '.12em',
                color: '#9e9890',
                fontWeight: 600,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(inv.items || []).map((item: any) => (
            <tr key={item.id} style={{ borderBottom: '1px solid #f5f1ec' }}>
              <td style={{ padding: '12px 4px', fontSize: 13 }}>{item.description}</td>
              <td style={{ padding: '12px 4px', textAlign: 'right', color: '#6e6560', fontSize: 12 }}>{item.quantity}</td>
              <td style={{ padding: '12px 4px', textAlign: 'right', fontSize: 13 }}>${fmt$(Number(item.unit_price))}</td>
              <td style={{ padding: '12px 4px', textAlign: 'right', fontWeight: 700, fontSize: 14 }}>
                ${fmt$(Number(item.line_total))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Totals ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ width: 260, borderTop: '1px solid #e4dfd6', paddingTop: 14 }}>
          {[
            { label: 'Subtotal', value: `$${fmt$(subtotal)}` },
            { label: 'Discount', value: discountAmt > 0 ? `-$${fmt$(discountAmt)}` : '—' },
            { label: 'Tax',      value: `$${fmt$(taxAmt)}` },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6e6560', marginBottom: 6 }}>
              <span>{label}</span><span>{value}</span>
            </div>
          ))}

          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1.5px solid #1a2f4e', paddingTop: 10, marginTop: 6, marginBottom: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Total</span>
            <span style={{ fontWeight: 700, fontSize: 16, fontFamily: 'Cormorant Garamond, serif' }}>
              ${fmt$(total)}
            </span>
          </div>

          {paid > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#4caf50', marginBottom: 6 }}>
              <span>{paidLabel}</span>
              <span style={{ fontWeight: 600 }}>-${fmt$(paid)}</span>
            </div>
          )}

          {balance > 0 && (
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              borderTop: '1px solid #e4dfd6', paddingTop: 8, marginTop: 4,
            }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#e67e22' }}>Balance Due</span>
              <span style={{ fontWeight: 700, fontSize: 16, color: '#e67e22', fontFamily: 'Cormorant Garamond, serif' }}>
                ${fmt$(balance)}
              </span>
            </div>
          )}

          {balance === 0 && paid > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e4dfd6', paddingTop: 8, marginTop: 4 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#22c55e' }}>Paid in Full</span>
              <span style={{ fontWeight: 700, fontSize: 16, color: '#22c55e', fontFamily: 'Cormorant Garamond, serif' }}>
                ${fmt$(total)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Notes ── */}
      {inv.notes && (
        <div style={{ marginTop: 36, borderTop: '1px solid #e4dfd6', paddingTop: 20 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.12em', color: '#9e9890', fontWeight: 600, marginBottom: 8 }}>
            Notes
          </div>
          <p style={{ fontSize: 12, color: '#6e6560', lineHeight: 1.6, margin: 0 }}>{inv.notes}</p>
        </div>
      )}
    </div>
  )
}

// ── Record Payment Modal ─────────────────────────────────────────────────────
function RecordPaymentModal({ inv, onClose, onSaved }: {
  inv: any; onClose: () => void; onSaved: () => void
}) {
  const qc = useQueryClient()
  const total     = Number(inv.total)
  const paid      = Number(inv.amount_paid)
  const remaining = Math.max(0, total - paid)
  const pct       = total > 0 ? Math.min(100, (paid / total) * 100) : 0

  const [form, setForm] = useState({
    amount: remaining.toFixed(2),
    method: 'bank',
    notes: '',
    paid_at: new Date().toISOString().slice(0, 10),
  })
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const enteredAmt = Number(form.amount) || 0
  const willSettle = enteredAmt >= remaining && remaining > 0

  const handleSave = async () => {
    if (!form.amount || Number(form.amount) <= 0) return
    setSaving(true)
    try {
      await invoicesApi.recordPayment(inv.id, { ...form, amount: Number(form.amount) })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['invoice', inv.id] })
      onSaved()
    } catch { } finally { setSaving(false) }
  }

  const METHOD_LABELS: Record<string, string> = {
    bank: 'Bank Transfer', cash: 'Cash', cheque: 'Cheque', stripe: 'Stripe (card)',
  }

  return (
    <Modal
      title="Record Payment"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline btn-sm" onClick={onClose} style={{ letterSpacing: '.06em' }}>CANCEL</button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '10px 24px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: willSettle ? '#2d5a27' : '#1a2f4e', color: '#fff',
              fontSize: 12, fontWeight: 700, letterSpacing: '.06em',
            }}
          >
            {saving ? 'Saving…' : willSettle ? 'RECORD PAYMENT → SEND RECEIPT' : 'RECORD PAYMENT'}
          </button>
        </>
      }
    >
      {/* Subtitle */}
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20, marginTop: -4 }}>
        {inv.number} · {inv.client_name} · Total: ${fmt$(total)} · Already paid: ${fmt$(paid)} · Remaining: ${fmt$(remaining)}
      </div>

      {/* Progress box */}
      <div style={{
        background: '#faf9f7', border: '1px solid var(--border)', borderRadius: 8,
        padding: '16px 20px', marginBottom: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>${fmt$(paid)} paid</span>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>${fmt$(remaining)} remaining</span>
        </div>
        <div style={{ background: '#e9e5df', borderRadius: 4, height: 6, overflow: 'hidden', marginBottom: 8 }}>
          <div style={{ width: `${pct}%`, height: '100%', background: '#c8a96a', borderRadius: 4 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
          <span>{pct.toFixed(0)}% collected</span>
          <span>Invoice total: ${fmt$(total)}</span>
        </div>
      </div>

      {/* Amount + Method row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 10, letterSpacing: '.1em', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
            PAYMENT AMOUNT *
          </label>
          <input className="finput" type="number" step="0.01" min="0"
            value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00"
            style={{ margin: 0 }} />
        </div>
        <div>
          <label style={{ fontSize: 10, letterSpacing: '.1em', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
            PAYMENT METHOD
          </label>
          <select className="fselect" value={form.method} onChange={e => set('method', e.target.value)} style={{ margin: 0 }}>
            {METHODS.map(m => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
          </select>
        </div>
      </div>

      {/* Payment Date */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 10, letterSpacing: '.1em', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
          PAYMENT DATE
        </label>
        <input className="finput" type="date" value={form.paid_at} onChange={e => set('paid_at', e.target.value)} style={{ margin: 0 }} />
      </div>

      {/* Reference / Note */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 10, letterSpacing: '.1em', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
          REFERENCE / NOTE (OPTIONAL)
        </label>
        <input className="finput" type="text" value={form.notes} onChange={e => set('notes', e.target.value)}
          placeholder="e.g. Stripe charge ID, bank ref…" style={{ margin: 0 }} />
      </div>

      {/* Settlement notice */}
      {willSettle && (
        <div style={{
          background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8,
          padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 18, lineHeight: 1.2 }}>✅</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#166534', marginBottom: 4 }}>
              This payment will settle the invoice in full
            </div>
            <div style={{ fontSize: 13, color: '#15803d', lineHeight: 1.5 }}>
              Recording ${fmt$(enteredAmt)} will bring total payments to ${fmt$(total)}. Invoice status will update to{' '}
              <strong>Paid</strong> and a receipt email will be sent automatically.
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Issue Refund Modal ───────────────────────────────────────────────────────
function IssueRefundModal({ inv, onClose, onSaved }: {
  inv: any; onClose: () => void; onSaved: () => void
}) {
  const qc = useQueryClient()
  const totalPaid       = Number(inv.amount_paid)
  const alreadyRefunded = Number(inv.refund_amount || 0)
  const refundable      = Math.max(0, totalPaid - alreadyRefunded)

  const [type,   setType]   = useState<'Full Refund' | 'Partial Refund'>('Partial Refund')
  const [amount, setAmount] = useState(refundable.toFixed(2))
  const [reason, setReason] = useState(REFUND_REASONS[0])
  const [saving, setSaving] = useState(false)

  const refundAmt    = type === 'Full Refund' ? refundable : (Number(amount) || 0)
  const netCollected = Math.max(0, totalPaid - alreadyRefunded - refundAmt)

  const handleConfirm = async () => {
    if (refundAmt <= 0) return
    setSaving(true)
    try {
      await invoicesApi.refund(inv.id, { amount: refundAmt, reason })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['invoice', inv.id] })
      onSaved()
    } catch { } finally { setSaving(false) }
  }

  const newStatus = refundAmt >= refundable ? 'Refunded' : 'Partially Refunded'

  return (
    <Modal
      title="Issue Refund"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline btn-sm" onClick={onClose} style={{ letterSpacing: '.06em' }}>CANCEL</button>
          <button
            onClick={handleConfirm}
            disabled={saving || refundAmt <= 0}
            style={{
              padding: '10px 24px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: '#8b1c1c', color: '#fff',
              fontSize: 12, fontWeight: 700, letterSpacing: '.06em',
              opacity: (saving || refundAmt <= 0) ? .5 : 1,
            }}
          >
            {saving ? 'Processing…' : 'CONFIRM REFUND →'}
          </button>
        </>
      }
    >
      {/* Subtitle */}
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20, marginTop: -4 }}>
        {inv.number} · {inv.client_name}
        {inv.client_company ? ` · ${inv.client_company}` : ''}
        {` · Paid: $${fmt$(totalPaid)}`}
      </div>

      {/* Type + Amount row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 10, letterSpacing: '.1em', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
            REFUND TYPE
          </label>
          <select
            className="fselect"
            value={type}
            onChange={e => {
              const v = e.target.value as typeof type
              setType(v)
              if (v === 'Full Refund') setAmount(refundable.toFixed(2))
            }}
            style={{ margin: 0 }}
          >
            <option value="Full Refund">Full Refund</option>
            <option value="Partial Refund">Partial Refund</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: 10, letterSpacing: '.1em', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
            REFUND AMOUNT *
          </label>
          <input
            className="finput"
            type="number" step="0.01" min="0" max={refundable}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            disabled={type === 'Full Refund'}
            style={{ margin: 0, background: type === 'Full Refund' ? '#f5f5f5' : '#fff' }}
          />
          {alreadyRefunded > 0 && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              Max: ${fmt$(refundable)}
            </div>
          )}
        </div>
      </div>

      {/* Reason */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 10, letterSpacing: '.1em', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
          REASON (INTERNAL NOTE)
        </label>
        <select className="fselect" value={reason} onChange={e => setReason(e.target.value)} style={{ margin: 0 }}>
          {REFUND_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* Refund Summary box */}
      <div style={{
        background: '#faf9f7', border: '1px solid var(--border)',
        borderRadius: 8, padding: '18px 20px',
      }}>
        <div style={{ fontSize: 10, letterSpacing: '.12em', fontWeight: 600, color: 'var(--muted)', marginBottom: 14 }}>
          REFUND SUMMARY
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 10 }}>
          <span style={{ color: 'var(--muted)' }}>Original payment</span>
          <span style={{ color: '#22c55e', fontWeight: 600 }}>+${fmt$(totalPaid)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 14 }}>
          <span style={{ color: 'var(--muted)' }}>Refund amount</span>
          <span style={{ color: '#b91c1c', fontWeight: 600 }}>−${fmt$(refundAmt)}</span>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Net collected</span>
          <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 700, color: netCollected > 0 ? '#22c55e' : 'var(--muted)' }}>
            ${fmt$(netCollected)}
          </span>
        </div>

        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12, lineHeight: 1.5 }}>
          Invoice will be marked <strong>{newStatus}</strong>. Revenue report will exclude the ${fmt$(refundAmt)} refunded amount.
        </div>
      </div>
    </Modal>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { show: showToast, el: toastEl } = useToast()

  const [showPayment,    setShowPayment]    = useState(false)
  const [showRefund,     setShowRefund]     = useState(false)
  const [showEmailPreview, setShowEmailPreview] = useState(false)
  const [sending,        setSending]        = useState(false)

  const { data: inv, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => invoicesApi.get(id!).then(r => r.data),
    enabled: !!id,
  })

  const { data: workspace } = useQuery({
    queryKey: ['workspace'],
    queryFn: () => settingsApi.getWorkspace().then(r => r.data),
  })

  const handleSend = async () => {
    setSending(true)
    try {
      await invoicesApi.send(id!)
      qc.invalidateQueries({ queryKey: ['invoice', id] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      showToast('Invoice sent to client')
    } catch { showToast('Failed to send', 'error') }
    finally { setSending(false) }
  }

  const handleVoid = async () => {
    if (!confirm('Void this invoice? This cannot be undone.')) return
    try {
      await invoicesApi.void(id!)
      qc.invalidateQueries({ queryKey: ['invoice', id] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      showToast('Invoice voided')
    } catch { showToast('Failed to void', 'error') }
  }

  const handleRemind = async () => {
    try {
      await invoicesApi.remind(id!)
      showToast('Reminder sent to client')
    } catch { showToast('Failed to send reminder', 'error') }
  }

  if (isLoading) return (
    <AppShell>
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
    </AppShell>
  )
  if (!inv) return (
    <AppShell>
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>Invoice not found</div>
    </AppShell>
  )

  const total     = Number(inv.total)
  const paid      = Number(inv.amount_paid)
  const remaining = Math.max(0, total - paid)
  const pct       = total > 0 ? Math.min(100, (paid / total) * 100) : 0
  const isOverdue = inv.status === 'overdue'

  const canSend   = ['draft', 'sent'].includes(inv.status)
  const canPay    = ['sent', 'overdue', 'partially_paid'].includes(inv.status)
  const canVoid   = !['paid', 'void', 'refunded'].includes(inv.status)
  const canRefund = ['paid', 'partially_paid', 'partially_refunded'].includes(inv.status)
  const canEdit   = inv.status === 'draft'
  const canRemind = ['sent', 'overdue', 'partially_paid'].includes(inv.status)

  return (
    <AppShell>
      {/* ── Header bar ── */}
      <div style={{
        padding: '16px 32px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--paper)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => navigate('/invoices')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 18, padding: 0, lineHeight: 1 }}
            >←</button>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 24, fontWeight: 400 }}>{inv.number}</span>
                <StatusBadge status={inv.status} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>
                {inv.client_name}{inv.client_company ? ` · ${inv.client_company}` : ''}
              </div>
            </div>
          </div>

          {/* Header quick actions */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {canEdit && (
              <button className="btn btn-outline" onClick={() => navigate(`/invoices/${id}/edit`)}
                style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.04em' }}>
                EDIT INVOICE
              </button>
            )}
            {canSend && (
              <button className="btn btn-dark" onClick={handleSend} disabled={sending}
                style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em' }}>
                {sending ? 'SENDING…' : `SEND TO ${(inv.client_name || '').split(' ')[0].toUpperCase()} →`}
              </button>
            )}
          </div>
        </div>

        {/* Payment progress bar */}
        {total > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 16 }}>
                <span>
                  <strong style={{ color: '#22c55e' }}>${fmt$(paid)}</strong>
                  <span style={{ color: 'var(--muted)' }}> paid</span>
                </span>
                <span>
                  <strong style={{ color: isOverdue ? '#e67e22' : 'var(--ink)' }}>${fmt$(remaining)}</strong>
                  <span style={{ color: 'var(--muted)' }}> remaining</span>
                </span>
                <span style={{ color: 'var(--muted)' }}>{pct.toFixed(0)}% of ${fmt$(total)}</span>
              </div>
              {inv.due_date && (
                <span style={{ color: isOverdue ? '#e67e22' : 'var(--muted)', fontWeight: isOverdue ? 600 : 400 }}>
                  {isOverdue ? '⚠ Overdue · ' : ''}{fmtDate(inv.due_date)}
                </span>
              )}
            </div>
            <div style={{ background: '#e9e5df', borderRadius: 4, height: 6, overflow: 'hidden' }}>
              <div style={{
                width: `${pct}%`, height: '100%', borderRadius: 4, transition: 'width .4s',
                background: pct >= 100 ? '#22c55e' : isOverdue ? '#e67e22' : '#c8a96a',
              }} />
            </div>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', minHeight: 'calc(100vh - 145px)' }}>

        {/* ── Left: invoice document ── */}
        <div style={{ overflowY: 'auto', padding: '32px 40px', borderRight: '1px solid var(--border)', background: '#f7f5f2' }}>
          <InvoiceDoc inv={inv} workspace={workspace} />
        </div>

        {/* ── Right: sidebar ── */}
        <div style={{ overflowY: 'auto', background: '#f5f4f1', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Payment History */}
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '18px 16px' }}>
            <div style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--muted)', fontWeight: 600, marginBottom: 14 }}>
              PAYMENT HISTORY
            </div>
            {(inv.payments || []).length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>No payments recorded</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {(inv.payments || []).map((p: any) => (
                  <div key={p.id} style={{
                    display: 'flex', gap: 12, alignItems: 'flex-start',
                    background: '#fafaf9', borderRadius: 8, padding: '12px 14px',
                    border: '1px solid var(--border)',
                  }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: '#e8f5e9', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, flexShrink: 0,
                    }}>
                      💳
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          {p.notes || `${p.method.charAt(0).toUpperCase() + p.method.slice(1)} payment`}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#22c55e', flexShrink: 0, marginLeft: 8 }}>
                          +${fmt$(p.amount)}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {fmtDate(p.paid_at)}
                        {p.stripe_payment_id && (
                          <span style={{ marginLeft: 6, fontFamily: 'monospace', fontSize: 10 }}>
                            · {p.stripe_payment_id.slice(0, 12)}…
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Invoice Status */}
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '18px 16px' }}>
            <div style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--muted)', fontWeight: 600, marginBottom: 14 }}>
              INVOICE STATUS
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Status</span>
                <StatusBadge status={inv.status} />
              </div>
              {[
                { label: 'Total',   value: `$${fmt$(total)}`,     color: 'var(--ink)' },
                { label: 'Paid',    value: `$${fmt$(paid)}`,      color: paid > 0 ? '#22c55e' : 'var(--muted)' },
                { label: 'Balance', value: `$${fmt$(remaining)}`, color: remaining > 0 && isOverdue ? '#e67e22' : remaining > 0 ? '#e67e22' : 'var(--muted)' },
                { label: 'Due Date', value: fmtDate(inv.due_date), color: isOverdue ? '#e67e22' : 'var(--ink)' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--muted)' }}>{label}</span>
                  <span style={{ color, fontWeight: label === 'Balance' || label === 'Total' ? 600 : 400 }}>{value}</span>
                </div>
              ))}
              {Number(inv.refund_amount) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--muted)' }}>Refunded</span>
                  <span style={{ color: '#b91c1c', fontWeight: 600 }}>-${fmt$(inv.refund_amount)}</span>
                </div>
              )}
              {inv.sent_at && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--muted)' }}>Sent</span>
                  <span style={{ color: 'var(--muted)' }}>{fmtDate(inv.sent_at)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Email Preview (collapsible) */}
          {inv.email_html && (
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <button
                onClick={() => setShowEmailPreview(v => !v)}
                style={{
                  width: '100%', padding: '16px 20px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  fontSize: 10, letterSpacing: '.12em', color: 'var(--muted)', fontWeight: 600,
                }}
              >
                <span>EMAIL PREVIEW</span>
                <span style={{ fontSize: 14 }}>{showEmailPreview ? '▲' : '▼'}</span>
              </button>
              {showEmailPreview && (
                <iframe
                  srcDoc={inv.email_html}
                  title="Email Preview"
                  style={{ width: '100%', height: 420, border: 'none', borderTop: '1px solid var(--border)', display: 'block' }}
                  sandbox="allow-same-origin"
                />
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '18px 16px' }}>
            <div style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--muted)', fontWeight: 600, marginBottom: 14 }}>
              ACTIONS
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {canPay && (
                <button
                  onClick={() => setShowPayment(true)}
                  style={{
                    width: '100%', padding: '11px 16px', borderRadius: 6,
                    background: '#1a2f4e', color: '#fff', border: '1.5px solid #1a2f4e',
                    fontSize: 12, fontWeight: 700, letterSpacing: '.06em', cursor: 'pointer',
                  }}
                >
                  RECORD ADDITIONAL PAYMENT
                </button>
              )}
              {canRemind && (
                <button
                  onClick={handleRemind}
                  style={{
                    width: '100%', padding: '11px 16px', borderRadius: 6,
                    background: '#fff', color: 'var(--ink)', border: '1.5px solid var(--border)',
                    fontSize: 12, fontWeight: 600, letterSpacing: '.05em', cursor: 'pointer',
                  }}
                >
                  SEND PAYMENT REMINDER
                </button>
              )}
              <button
                onClick={() => window.print()}
                style={{
                  width: '100%', padding: '11px 16px', borderRadius: 6,
                  background: '#fff', color: 'var(--ink)', border: '1.5px solid var(--border)',
                  fontSize: 12, fontWeight: 600, letterSpacing: '.05em', cursor: 'pointer',
                }}
              >
                DOWNLOAD PDF
              </button>
              {canRefund && (
                <button
                  onClick={() => setShowRefund(true)}
                  style={{
                    width: '100%', padding: '11px 16px', borderRadius: 6,
                    background: '#b91c1c', color: '#fff', border: '1.5px solid #b91c1c',
                    fontSize: 12, fontWeight: 700, letterSpacing: '.06em', cursor: 'pointer',
                  }}
                >
                  ISSUE REFUND
                </button>
              )}
              {canVoid && (
                <button
                  onClick={handleVoid}
                  style={{
                    width: '100%', padding: '9px 16px', borderRadius: 6,
                    background: 'none', color: 'var(--muted)', border: '1px solid var(--border)',
                    fontSize: 11, fontWeight: 500, letterSpacing: '.04em', cursor: 'pointer',
                  }}
                >
                  Void Invoice
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {showPayment && (
        <RecordPaymentModal
          inv={inv}
          onClose={() => setShowPayment(false)}
          onSaved={() => { setShowPayment(false); showToast('Payment recorded') }}
        />
      )}
      {showRefund && (
        <IssueRefundModal
          inv={inv}
          onClose={() => setShowRefund(false)}
          onSaved={() => { setShowRefund(false); showToast('Refund issued') }}
        />
      )}
      {toastEl}
    </AppShell>
  )
}
