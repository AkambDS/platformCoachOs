import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, invoicesApi, settingsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { Modal, StatusBadge, useToast } from '../../components/ui'
import { useAuthStore } from '../../store/auth'

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
const METHOD_LABELS: Record<string, string> = {
  bank: 'Bank Transfer', cash: 'Cash', cheque: 'Cheque', stripe: 'Stripe (card)',
}
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
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 26, fontWeight: 600, letterSpacing: '-.02em', marginBottom: 4 }}>
            {workspace?.name || '—'}
          </div>
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
          {/* Status stamp — hidden in PDF/print */}
          <div className="invoice-status-stamp" style={{
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
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#1a1714', marginBottom: 6 }}>
              <span>{paidLabel}</span>
              <span style={{ fontWeight: 600 }}>-${fmt$(paid)}</span>
            </div>
          )}

          {balance > 0 && (
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              borderTop: '1px solid #e4dfd6', paddingTop: 8, marginTop: 4,
            }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Balance Due</span>
              <span style={{ fontWeight: 700, fontSize: 16, fontFamily: 'Cormorant Garamond, serif' }}>
                ${fmt$(balance)}
              </span>
            </div>
          )}

          {balance === 0 && paid > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e4dfd6', paddingTop: 8, marginTop: 4 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Paid in Full</span>
              <span style={{ fontWeight: 700, fontSize: 16, fontFamily: 'Cormorant Garamond, serif' }}>
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

  const [payType, setPayType] = useState<'full' | 'partial'>(remaining > 0 ? 'full' : 'partial')
  const [form, setForm] = useState({
    amount: remaining.toFixed(2),
    method: 'bank',
    notes: '',
    paid_at: new Date().toISOString().slice(0, 10),
  })
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const enteredAmt = payType === 'full' ? remaining : (Number(form.amount) || 0)
  const willSettle = enteredAmt >= remaining && remaining > 0

  const handleSave = async () => {
    if (enteredAmt <= 0) return
    setSaving(true)
    try {
      await invoicesApi.recordPayment(inv.id, { ...form, amount: enteredAmt })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['invoice', inv.id] })
      onSaved()
    } catch { } finally { setSaving(false) }
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
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, marginTop: -4 }}>
        {inv.number} · {inv.client_name} · Total: ${fmt$(total)} · Already paid: ${fmt$(paid)} · Remaining: ${fmt$(remaining)}
      </div>

      {/* Full / Partial toggle */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        {(['full', 'partial'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setPayType(t)
              if (t === 'full') set('amount', remaining.toFixed(2))
            }}
            style={{
              padding: '10px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
              border: payType === t ? '2px solid #1a2f4e' : '1px solid var(--border)',
              background: payType === t ? '#1a2f4e' : '#fff',
              color: payType === t ? '#fff' : 'var(--ink)',
            }}
          >
            {t === 'full' ? `Full Payment — $${fmt$(remaining)}` : 'Partial Payment'}
          </button>
        ))}
      </div>

      {/* Progress box */}
      <div style={{
        background: '#faf9f7', border: '1px solid var(--border)', borderRadius: 8,
        padding: '16px 20px', marginBottom: 16,
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
            value={payType === 'full' ? remaining.toFixed(2) : form.amount}
            onChange={e => set('amount', e.target.value)}
            disabled={payType === 'full'}
            placeholder="0.00"
            style={{ margin: 0, background: payType === 'full' ? '#f5f5f5' : '#fff' }} />
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

// ── Email Edit Modal ─────────────────────────────────────────────────────────
const BODY_FONTS = [
  { label: 'Helvetica / Arial (default)', value: "'Helvetica Neue',Helvetica,Arial,sans-serif" },
  { label: 'Georgia', value: "Georgia,'Times New Roman',serif" },
  { label: 'Verdana', value: "Verdana,Geneva,sans-serif" },
  { label: 'Trebuchet MS', value: "'Trebuchet MS',Helvetica,sans-serif" },
]
const HEADING_FONTS = [
  { label: 'Georgia (default)', value: "Georgia,'Times New Roman',serif" },
  { label: 'Helvetica / Arial', value: "'Helvetica Neue',Helvetica,Arial,sans-serif" },
  { label: 'Verdana', value: "Verdana,Geneva,sans-serif" },
]

function EmailEditModal({ onClose }: { onClose: () => void }) {
  const { workspace, user, rehydrate } = useAuthStore()
  const { show, el: toastEl } = useToast()

  const saved      = (workspace as any)?.email_templates?.invoice || {}
  const savedStyle = saved.style || {}

  const [tab,     setTab]     = useState<'content' | 'style'>('content')
  const [intro,   setIntro]   = useState<string>(saved.intro   || '')
  const [closing, setClosing] = useState<string>(saved.closing || '')
  const [subject, setSubject] = useState<string>(saved.subject || '')
  const [fromEmail, setFromEmail] = useState<string>(saved.from_email || '')

  const [headerBg,      setHeaderBg]      = useState(savedStyle.header_bg      || '#1a2f4e')
  const [accentColor,   setAccentColor]   = useState(savedStyle.accent_color   || '#b8922e')
  const [headerTagline, setHeaderTagline] = useState(savedStyle.header_tagline ?? 'Coaching Platform')
  const [bodyFont,      setBodyFont]      = useState(savedStyle.body_font      || BODY_FONTS[0].value)
  const [headingFont,   setHeadingFont]   = useState(savedStyle.heading_font   || HEADING_FONTS[0].value)
  const [valueColor,    setValueColor]    = useState(savedStyle.value_color    || '#1a1714')

  const [previewHtml,    setPreviewHtml]    = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [saving,         setSaving]         = useState(false)
  const [logoUploading,  setLogoUploading]  = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const renderPreview = async (overrides?: Record<string, string>) => {
    setPreviewLoading(true)
    try {
      const { data } = await api.get('/api/settings/email-preview/', {
        params: {
          type: 'invoice', _t: Date.now(),
          intro, closing,
          header_bg: headerBg, accent_color: accentColor,
          header_tagline: headerTagline,
          body_font: bodyFont, heading_font: headingFont,
          value_color: valueColor,
          ...overrides,
        },
      })
      setPreviewHtml(data.html || '')
    } catch { setPreviewHtml('') }
    finally { setPreviewLoading(false) }
  }

  useEffect(() => { renderPreview() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce on any field change
  useEffect(() => {
    const t = setTimeout(() => renderPreview(), 700)
    return () => clearTimeout(t)
  }, [intro, closing, headerBg, accentColor, headerTagline, bodyFont, headingFont, valueColor]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true)
    try {
      const existing = (workspace as any)?.email_templates || {}
      const updated  = {
        ...existing,
        invoice: {
          ...saved,
          subject, intro, closing, from_email: fromEmail,
          style: { header_bg: headerBg, accent_color: accentColor, header_tagline: headerTagline, body_font: bodyFont, heading_font: headingFont, value_color: valueColor },
        },
      }
      const { data } = await settingsApi.updateWorkspace({ email_templates: updated })
      if (user) rehydrate(user, { ...(workspace as any), ...data, email_templates: updated })
      show('Email template saved')
    } catch { show('Failed to save', 'error') }
    finally { setSaving(false) }
  }

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (file.size > 2 * 1024 * 1024) { show('Logo must be under 2 MB', 'error'); return }
    setLogoUploading(true)
    try {
      const { data } = await settingsApi.uploadLogo(file)
      if (user) rehydrate(user, { ...(workspace as any), logo_data: data.logo_data })
      show('Logo updated')
      setTimeout(() => renderPreview(), 400)
    } catch { show('Failed to upload logo', 'error') }
    finally { setLogoUploading(false) }
  }

  const logoData = (workspace as any)?.logo_data || ''

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, letterSpacing: '.12em',
    color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6,
  }
  const colorRow = (label: string, value: string, onChange: (v: string) => void) => (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input type="color" value={value} onChange={e => onChange(e.target.value)}
          style={{ width: 40, height: 32, padding: 2, borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer', background: 'none' }} />
        <input className="finput" value={value} onChange={e => onChange(e.target.value)}
          style={{ margin: 0, fontFamily: 'monospace', fontSize: 12, flex: 1 }} />
        <div style={{ width: 28, height: 28, borderRadius: 4, background: value, border: '1px solid var(--border)', flexShrink: 0 }} />
      </div>
    </div>
  )

  return (
    <Modal title="Invoice Email Template" size="lg" onClose={onClose} footer={
      <>
        <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
        <button onClick={handleSave} disabled={saving}
          style={{ padding: '10px 24px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#1a2f4e', color: '#fff', fontSize: 12, fontWeight: 700, letterSpacing: '.06em' }}>
          {saving ? 'Saving…' : 'SAVE TEMPLATE'}
        </button>
      </>
    }>
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 0, height: 560 }}>

        {/* Left panel */}
        <div style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {(['content', 'style', 'custom'] as const).map(t => (
              <button key={t} onClick={() => setTab(t as any)} style={{
                flex: 1, padding: '9px 4px', border: 'none', cursor: 'pointer',
                background: tab === t ? 'var(--white)' : 'var(--paper)',
                borderBottom: tab === t ? '2px solid #1a2f4e' : '2px solid transparent',
                fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase',
                color: tab === t ? '#1a2f4e' : 'var(--muted)',
              }}>{t === 'content' ? 'Content' : t === 'style' ? 'Style' : 'HTML'}</button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px' }}>

            {tab === 'content' && (
              <>
                <div className="fgroup">
                  <label className="flabel">Subject line</label>
                  <input className="finput" placeholder="Leave blank for default"
                    value={subject} onChange={e => setSubject(e.target.value)} />
                </div>
                <div className="fgroup">
                  <label className="flabel">From email address</label>
                  <input className="finput" type="email" placeholder="laura@yourbusiness.com"
                    value={fromEmail} onChange={e => setFromEmail(e.target.value)} />
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    Overrides the default sender. Must be a verified address in your email provider (AWS SES).
                  </div>
                </div>
                <div className="fgroup">
                  <label className="flabel">Opening paragraph</label>
                  <textarea className="finput" rows={4} style={{ resize: 'vertical' }}
                    placeholder="Leave blank for default"
                    value={intro} onChange={e => setIntro(e.target.value)} />
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    Variables: <code style={{ background: '#f0f4ff', padding: '1px 4px', borderRadius: 3, fontSize: 10 }}>{'{client_name}'}</code>{' '}
                    <code style={{ background: '#f0f4ff', padding: '1px 4px', borderRadius: 3, fontSize: 10 }}>{'{invoice_number}'}</code>{' '}
                    <code style={{ background: '#f0f4ff', padding: '1px 4px', borderRadius: 3, fontSize: 10 }}>{'{amount}'}</code>
                  </div>
                </div>
                <div className="fgroup">
                  <label className="flabel">Closing paragraph</label>
                  <textarea className="finput" rows={3} style={{ resize: 'vertical' }}
                    placeholder="Leave blank for default"
                    value={closing} onChange={e => setClosing(e.target.value)} />
                </div>
              </>
            )}

            {tab === 'style' && (
              <>
                {/* Logo */}
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Logo</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 48, height: 48, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f4f1', flexShrink: 0 }}>
                      {logoData
                        ? <img src={logoData} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                        : <span style={{ fontSize: 9, color: 'var(--muted)' }}>No logo</span>}
                    </div>
                    <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={handleLogoChange} disabled={logoUploading} />
                    <button className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()} disabled={logoUploading} style={{ flex: 1 }}>
                      {logoUploading ? 'Uploading…' : logoData ? 'Replace Logo' : 'Upload Logo'}
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>PNG or SVG, max 2 MB. Appears in the header.</div>
                </div>

                <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />

                {colorRow('Header background', headerBg, setHeaderBg)}
                {colorRow('Accent / highlight color', accentColor, setAccentColor)}
                {colorRow('Detail values (amount, due date)', valueColor, setValueColor)}

                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Header tagline</label>
                  <input className="finput" style={{ margin: 0 }}
                    placeholder="e.g. Coaching Platform"
                    value={headerTagline} onChange={e => setHeaderTagline(e.target.value)} />
                </div>

                <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />

                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Body font</label>
                  <select className="fselect" style={{ margin: 0 }} value={bodyFont} onChange={e => setBodyFont(e.target.value)}>
                    {BODY_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Heading font</label>
                  <select className="fselect" style={{ margin: 0 }} value={headingFont} onChange={e => setHeadingFont(e.target.value)}>
                    {HEADING_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
              </>
            )}

            {(tab as any) === 'custom' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                  Replace the entire email with your own HTML. When active, the Content and Style tabs are ignored.
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => {
                    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>{workspace_name}</title></head>
<body style="margin:0;padding:0;background:#f0ede8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">
      <tr><td style="background:#1a2f4e;padding:24px 40px;border-radius:8px 8px 0 0;">
        <span style="font-family:Georgia,serif;font-size:22px;color:#f7f4ef;">{workspace_name}</span>
      </td></tr>
      <tr><td style="height:3px;background:#b8922e;"></td></tr>
      <tr><td style="background:#fff;padding:40px;border-radius:0 0 8px 8px;">
        <p style="margin:0 0 8px;font-size:11px;color:#b8922e;text-transform:uppercase;letter-spacing:.14em;font-weight:600;">Invoice</p>
        <h1 style="margin:0 0 24px;font-family:Georgia,serif;font-size:28px;font-weight:400;color:#16130f;">Invoice #{invoice_number}</h1>
        <p style="margin:0 0 28px;font-size:15px;color:#6e6560;">Hi {client_name}, please find your invoice below.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #1a2f4e;margin-bottom:28px;">
          <tr>
            <td style="padding:10px 4px;color:#9e9890;font-size:12px;text-transform:uppercase;letter-spacing:.1em;width:110px;border-bottom:1px solid #f0ede8;">Invoice #</td>
            <td style="padding:10px 4px;font-size:14px;font-weight:600;color:#1a1714;border-bottom:1px solid #f0ede8;">{invoice_number}</td>
          </tr>
          <tr>
            <td style="padding:10px 4px;color:#9e9890;font-size:12px;text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid #f0ede8;">Amount</td>
            <td style="padding:10px 4px;font-size:14px;font-weight:600;color:#1a1714;border-bottom:1px solid #f0ede8;">{amount}</td>
          </tr>
          <tr>
            <td style="padding:10px 4px;color:#9e9890;font-size:12px;text-transform:uppercase;letter-spacing:.1em;">Due</td>
            <td style="padding:10px 4px;font-size:14px;font-weight:600;color:#b8922e;">{due_date}</td>
          </tr>
        </table>
        <p style="margin:24px 0 0;font-family:Georgia,serif;font-size:15px;color:#9e9890;">&mdash; {workspace_name}</p>
      </td></tr>
      <tr><td style="padding:20px;text-align:center;font-size:11px;color:#b5afa6;">Sent by {workspace_name}</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
                    const blob = new Blob([html], { type: 'text/html' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a'); a.href = url; a.download = 'invoice-sample.html'; a.click()
                    URL.revokeObjectURL(url)
                  }} style={{ flex: 1, padding: '8px 0', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid #2d6a9f', background: '#f0f4ff', color: '#2d6a9f', cursor: 'pointer' }}>
                    ↓ Download Sample
                  </button>
                  {previewHtml && (
                    <button onClick={() => {
                      const blob = new Blob([previewHtml], { type: 'text/html' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a'); a.href = url; a.download = 'invoice-template.html'; a.click()
                      URL.revokeObjectURL(url)
                    }} style={{ flex: 1, padding: '8px 0', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--white)', color: 'var(--ink)', cursor: 'pointer' }}>
                      ↓ Save Preview HTML
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>
                  Placeholders: <code style={{ background: '#f5f3ef', padding: '0 3px', borderRadius: 3 }}>{'{client_name}'}</code>{' '}
                  <code style={{ background: '#f5f3ef', padding: '0 3px', borderRadius: 3 }}>{'{invoice_number}'}</code>{' '}
                  <code style={{ background: '#f5f3ef', padding: '0 3px', borderRadius: 3 }}>{'{amount}'}</code>{' '}
                  <code style={{ background: '#f5f3ef', padding: '0 3px', borderRadius: 3 }}>{'{due_date}'}</code>{' '}
                  <code style={{ background: '#f5f3ef', padding: '0 3px', borderRadius: 3 }}>{'{workspace_name}'}</code>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right — live preview */}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', position: 'relative' }}>
          <div style={{ padding: '8px 14px', background: '#f5f3ef', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', flexShrink: 0 }}>
            Live Preview
          </div>
          {previewLoading && (
            <div style={{ position: 'absolute', top: 36, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,.75)', zIndex: 1, fontSize: 12, color: 'var(--muted)' }}>
              Updating preview…
            </div>
          )}
          <iframe srcDoc={previewHtml} title="Email preview" sandbox="allow-same-origin"
            style={{ flex: 1, border: 'none', display: 'block', width: '100%', height: '100%' }} />
        </div>
      </div>
      {toastEl}
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
  const [showEmailEdit,  setShowEmailEdit]  = useState(false)
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

  const handlePrint = () => {
    const el = document.getElementById('invoice-print-area')
    if (!el) return
    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) return
    const businessName  = workspace?.name  || ''
    const businessEmail = workspace?.email || ''
    const footer = [businessName, businessEmail].filter(Boolean).join(' · ')

    win.document.documentElement.innerHTML = `
<head>
  <meta charset="utf-8">
  <title>${inv.number}</title>
  <base href="${window.location.origin}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    @page { margin: 0; size: A4 portrait; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 1.2cm 1.4cm 0;
      font-family: Inter, system-ui, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }
    .invoice-status-stamp { display: none !important; }
    .print-footer {
      margin-top: auto;
      padding: 10px 0 14px;
      border-top: 1px solid #e4dfd6;
      text-align: center;
      font-size: 10px;
      color: #9e9890;
      letter-spacing: .06em;
    }
  </style>
</head>
<body>
${el.innerHTML}
<div class="print-footer">${footer}</div>
</body>`
    win.onload = () => { win.print() }
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', height: 'calc(100vh - 145px)', overflow: 'hidden' }}>

        {/* ── Left: invoice document ── */}
        <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: '#f7f5f2', overflow: 'hidden' }}>
          {/* Toolbar */}
          <div style={{ flexShrink: 0, display: 'flex', gap: 8, padding: '10px 20px', borderBottom: '1px solid var(--border)', background: '#f0ede8', alignItems: 'center' }}>
            <button onClick={handlePrint} style={{
              padding: '7px 16px', borderRadius: 6, border: '1px solid var(--border)',
              background: '#fff', color: 'var(--ink)', fontSize: 11, fontWeight: 600,
              cursor: 'pointer', letterSpacing: '.04em',
            }}>↓ Download PDF</button>
            {canSend && (
              <button onClick={handleSend} disabled={sending} style={{
                padding: '7px 16px', borderRadius: 6, border: 'none',
                background: '#1a2f4e', color: '#fff', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', letterSpacing: '.04em',
              }}>
                {sending ? 'Sending…' : `✉ Send to ${(inv.client_name || '').split(' ')[0]}`}
              </button>
            )}
            {canRemind && (
              <button onClick={handleRemind} style={{
                padding: '7px 16px', borderRadius: 6, border: `1px solid ${isOverdue ? '#e67e22' : 'var(--border)'}`,
                background: isOverdue ? '#fff8f0' : '#fff', color: isOverdue ? '#e67e22' : 'var(--muted)',
                fontSize: 11, fontWeight: 600, cursor: 'pointer', letterSpacing: '.04em',
              }}>Send Reminder</button>
            )}
            <button onClick={() => setShowEmailEdit(true)} style={{
              marginLeft: 'auto', padding: '7px 14px', borderRadius: 6,
              border: '1px solid var(--border)', background: '#fff',
              color: 'var(--muted)', fontSize: 11, fontWeight: 600,
              cursor: 'pointer', letterSpacing: '.04em',
            }}>✎ Edit Email Template</button>
          </div>
          <div id="invoice-print-area" style={{ flex: 1, overflowY: 'auto', padding: '32px 40px' }}>
            <InvoiceDoc inv={inv} workspace={workspace} />
          </div>
        </div>

        {/* ── Right: sidebar ── */}
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#f5f4f1' }}>

          {/* Top cards — scroll if content overflows */}
          <div style={{ flexShrink: 0, overflowY: 'auto', padding: '14px 14px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Invoice Status + Payment summary — compact single card */}
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--muted)', fontWeight: 600 }}>INVOICE STATUS</span>
                <StatusBadge status={inv.status} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {[
                  { label: 'Total',    value: `$${fmt$(total)}`,     bold: true,  color: 'var(--ink)' },
                  { label: 'Paid',     value: `$${fmt$(paid)}`,      bold: false, color: paid > 0 ? '#22c55e' : 'var(--muted)' },
                  { label: 'Balance',  value: `$${fmt$(remaining)}`, bold: true,  color: remaining > 0 ? (isOverdue ? '#e67e22' : '#e67e22') : 'var(--muted)' },
                  { label: 'Due Date', value: fmtDate(inv.due_date), bold: false, color: isOverdue ? '#e67e22' : 'var(--ink)' },
                  ...(inv.invoice_type === 'subscription' ? [
                    { label: 'Billing', value: inv.billing_cycle ? inv.billing_cycle.charAt(0).toUpperCase() + inv.billing_cycle.slice(1) : '—', bold: false, color: 'var(--ink)' },
                    { label: 'Ends', value: inv.subscription_end ? fmtDate(inv.subscription_end) : 'Until stopped', bold: false, color: inv.subscription_end ? 'var(--ink)' : 'var(--muted)' },
                  ] : []),
                ].map(({ label, value, bold, color }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--muted)' }}>{label}</span>
                    <span style={{ color, fontWeight: bold ? 600 : 400 }}>{value}</span>
                  </div>
                ))}
                {Number(inv.refund_amount) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--muted)' }}>Refunded</span>
                    <span style={{ color: '#b91c1c', fontWeight: 600 }}>-${fmt$(inv.refund_amount)}</span>
                  </div>
                )}
                {inv.sent_at && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: 'var(--muted)' }}>Sent</span>
                    <span style={{ color: 'var(--muted)' }}>{fmtDate(inv.sent_at)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Payment History — compact */}
            {(inv.payments || []).length > 0 && (
              <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px' }}>
                <div style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--muted)', fontWeight: 600, marginBottom: 10 }}>
                  PAYMENT HISTORY
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(inv.payments || []).map((p: any) => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: 12 }}>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--ink)' }}>
                          {METHOD_LABELS[p.method] || p.method}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                          {fmtDate(p.paid_at)}{p.notes ? ` · ${p.notes}` : ''}
                        </div>
                      </div>
                      <span style={{ fontWeight: 600, color: '#22c55e', flexShrink: 0, marginLeft: 10, paddingTop: 1 }}>+${fmt$(p.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions — horizontal row */}
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--muted)', fontWeight: 600, marginBottom: 10 }}>ACTIONS</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {canPay && (
                  <button onClick={() => setShowPayment(true)} style={{
                    flex: 1, minWidth: 120, padding: '8px 10px', borderRadius: 6,
                    background: '#1a2f4e', color: '#fff', border: 'none',
                    fontSize: 11, fontWeight: 600, letterSpacing: '.04em', cursor: 'pointer',
                  }}>Record Payment</button>
                )}
                {canRefund && (
                  <button onClick={() => setShowRefund(true)} style={{
                    flex: 1, minWidth: 100, padding: '8px 10px', borderRadius: 6,
                    background: '#b91c1c', color: '#fff', border: 'none',
                    fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  }}>Issue Refund</button>
                )}
                {canVoid && (
                  <button onClick={handleVoid} style={{
                    flex: 1, minWidth: 80, padding: '7px 10px', borderRadius: 6,
                    background: 'none', color: 'var(--muted)', border: '1px solid var(--border)',
                    fontSize: 11, cursor: 'pointer',
                  }}>Void</button>
                )}
              </div>
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
      {showEmailEdit && (
        <EmailEditModal onClose={() => setShowEmailEdit(false)} />
      )}
      {toastEl}
    </AppShell>
  )
}
