import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { invoicesApi, clientsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { PageHeader, Modal, StatusBadge, EmptyState, useToast } from '../../components/ui'

function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function NewInvoiceModal({ onClose, onSaved }: any) {
  const qc = useQueryClient()
  const { data: clientsData } = useQuery({ queryKey: ['clients-all'], queryFn: () => clientsApi.list({ page_size: 200 }).then(r => r.data) })
  const clients: any[] = clientsData?.results || clientsData || []
  const [form, setForm] = useState({
    client: '', invoice_type: 'one_time', currency: 'USD',
    due_date: '', notes: '', discount_type: 'percent', discount_value: '0', tax_percent: '0',
  })
  const [items, setItems] = useState([{ description: '', quantity: '1', unit_price: '' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const setItem = (i: number, k: string, v: string) => setItems(arr => arr.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  const addItem = () => setItems(arr => [...arr, { description: '', quantity: '1', unit_price: '' }])
  const removeItem = (i: number) => setItems(arr => arr.filter((_, idx) => idx !== i))

  const subtotal = items.reduce((s, it) => s + (Number(it.quantity) * Number(it.unit_price) || 0), 0)
  const discount = form.discount_type === 'percent' ? subtotal * Number(form.discount_value) / 100 : Number(form.discount_value)
  const taxable = subtotal - discount
  const tax = taxable * Number(form.tax_percent) / 100
  const total = taxable + tax

  const handleSave = async () => {
    if (!form.client) { setError('Please select a client'); return }
    if (items.some(it => !it.description || !it.unit_price)) { setError('Fill in all line items'); return }
    setSaving(true); setError('')
    try {
      await invoicesApi.create({
        ...form,
        discount_value: Number(form.discount_value),
        tax_percent: Number(form.tax_percent),
        items: items.map(it => ({ ...it, quantity: Number(it.quantity), unit_price: Number(it.unit_price) })),
      })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      onSaved()
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to create invoice')
    } finally { setSaving(false) }
  }

  return (
    <Modal title="New Invoice" onClose={onClose} size="lg"
      footer={
        <>
          <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-dark btn-sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Create Invoice'}</button>
        </>
      }>
      {error && <div style={{ background: '#fde8dc', color: '#a0400d', padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>{error}</div>}

      <div className="fgrid">
        <div className="fgroup">
          <label className="flabel">Client *</label>
          <select className="fselect" value={form.client} onChange={e => set('client', e.target.value)}>
            <option value="">Select client…</option>
            {clients.map((c: any) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
          </select>
        </div>
        <div className="fgroup">
          <label className="flabel">Type</label>
          <select className="fselect" value={form.invoice_type} onChange={e => set('invoice_type', e.target.value)}>
            <option value="one_time">One-Time</option>
            <option value="subscription">Subscription</option>
          </select>
        </div>
        <div className="fgroup">
          <label className="flabel">Due Date</label>
          <input className="finput" type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} />
        </div>
        <div className="fgroup">
          <label className="flabel">Currency</label>
          <select className="fselect" value={form.currency} onChange={e => set('currency', e.target.value)}>
            {['USD','EUR','GBP','CAD','AUD'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="fsec">Line Items</div>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px auto', gap: 8, marginBottom: 8, alignItems: 'end' }}>
          <div className="fgroup" style={{ marginBottom: 0 }}>
            {i === 0 && <label className="flabel">Description</label>}
            <input className="finput" value={item.description} onChange={e => setItem(i, 'description', e.target.value)} placeholder="Coaching session" />
          </div>
          <div className="fgroup" style={{ marginBottom: 0 }}>
            {i === 0 && <label className="flabel">Qty</label>}
            <input className="finput" type="number" value={item.quantity} onChange={e => setItem(i, 'quantity', e.target.value)} />
          </div>
          <div className="fgroup" style={{ marginBottom: 0 }}>
            {i === 0 && <label className="flabel">Unit Price</label>}
            <input className="finput" type="number" value={item.unit_price} onChange={e => setItem(i, 'unit_price', e.target.value)} placeholder="0.00" />
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => removeItem(i)} style={{ marginTop: i === 0 ? 18 : 0 }}>×</button>
        </div>
      ))}
      <button className="btn btn-outline btn-sm" onClick={addItem} style={{ marginTop: 4 }}>+ Add Line</button>

      <div className="fsec">Adjustments</div>
      <div className="fgrid">
        <div className="fgroup">
          <label className="flabel">Discount Type</label>
          <select className="fselect" value={form.discount_type} onChange={e => set('discount_type', e.target.value)}>
            <option value="percent">Percent (%)</option>
            <option value="fixed">Fixed ($)</option>
          </select>
        </div>
        <div className="fgroup">
          <label className="flabel">Discount Value</label>
          <input className="finput" type="number" value={form.discount_value} onChange={e => set('discount_value', e.target.value)} />
        </div>
        <div className="fgroup">
          <label className="flabel">Tax (%)</label>
          <input className="finput" type="number" value={form.tax_percent} onChange={e => set('tax_percent', e.target.value)} />
        </div>
      </div>

      {/* Summary */}
      <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', padding: 16, marginTop: 8 }}>
        {[
          ['Subtotal', `$${subtotal.toFixed(2)}`],
          ['Discount', `-$${discount.toFixed(2)}`],
          ['Tax', `$${tax.toFixed(2)}`],
        ].map(([k, v]) => (
          <div key={k} className="kv"><span className="kvl">{k}</span><span>{v}</span></div>
        ))}
        <div className="kv" style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
          <span style={{ fontWeight: 600 }}>Total</span>
          <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600 }}>${total.toFixed(2)}</span>
        </div>
      </div>

      <div className="fgroup" style={{ marginTop: 16 }}>
        <label className="flabel">Notes</label>
        <textarea className="ftextarea" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Payment terms, bank details…" />
      </div>
    </Modal>
  )
}

function RecordPaymentModal({ invoiceId, onClose, onSaved }: any) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ amount: '', method: 'stripe', notes: '', paid_at: new Date().toISOString().slice(0, 16) })
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.amount) return
    setSaving(true)
    try {
      await invoicesApi.recordPayment(invoiceId, { ...form, amount: Number(form.amount) })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['invoice', invoiceId] })
      onSaved()
    } catch { } finally { setSaving(false) }
  }

  return (
    <Modal title="Record Payment" onClose={onClose} footer={
      <>
        <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-dark btn-sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Record Payment'}</button>
      </>
    }>
      <div className="fgroup">
        <label className="flabel">Amount</label>
        <input className="finput" type="number" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" />
      </div>
      <div className="fgroup">
        <label className="flabel">Method</label>
        <select className="fselect" value={form.method} onChange={e => set('method', e.target.value)}>
          {['stripe','cash','bank','cheque'].map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
        </select>
      </div>
      <div className="fgroup">
        <label className="flabel">Date</label>
        <input className="finput" type="datetime-local" value={form.paid_at} onChange={e => set('paid_at', e.target.value)} />
      </div>
      <div className="fgroup">
        <label className="flabel">Notes</label>
        <textarea className="ftextarea" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>
    </Modal>
  )
}

export default function Invoices() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { show: showToast, el: toastEl } = useToast()
  const [statusFilter, setStatusFilter] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [payingId, setPayingId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', statusFilter],
    queryFn: () => invoicesApi.list({ status: statusFilter || undefined }).then(r => r.data),
  })
  const invoices: any[] = data?.results || data || []

  const handleSend = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await invoicesApi.send(id)
      qc.invalidateQueries({ queryKey: ['invoices'] })
      showToast('Invoice sent to client')
    } catch { showToast('Failed to send', 'error') }
  }

  const totalOutstanding = invoices.filter(i => ['sent','overdue','partially_paid'].includes(i.status)).reduce((s, i) => s + Number(i.total || 0), 0)
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.total || 0), 0)

  return (
    <AppShell>
      <PageHeader
        title="Invoices"
        subtitle={`${invoices.length} invoices`}
        action={<button className="btn btn-dark" onClick={() => setShowNew(true)}>+ New Invoice</button>}
      />

      <div className="page-body">
        {/* Summary */}
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 24 }}>
          {[
            { lbl: 'Outstanding', val: `$${totalOutstanding.toLocaleString()}`, colour: 'var(--rust)' },
            { lbl: 'Paid (All Time)', val: `$${totalPaid.toLocaleString()}`, colour: 'var(--success)' },
            { lbl: 'Total Invoices', val: invoices.length, colour: 'var(--ink)' },
          ].map(s => (
            <div key={s.lbl} className="stat-card">
              <div className="stat-val" style={{ color: s.colour }}>{s.val}</div>
              <div className="stat-lbl">{s.lbl}</div>
            </div>
          ))}
        </div>

        <div className="toolbar">
          {['', 'draft','sent','paid','overdue','void'].map(s => (
            <button key={s} className={`filter-pill${statusFilter === s ? ' active' : ''}`} onClick={() => setStatusFilter(s)}>
              {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading…</div>
        ) : invoices.length === 0 ? (
          <EmptyState icon="$" title="No invoices" message="Create your first invoice" action={
            <button className="btn btn-dark" onClick={() => setShowNew(true)}>+ New Invoice</button>
          } />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Client</th>
                <th>Type</th>
                <th>Status</th>
                <th>Total</th>
                <th>Due Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv: any) => (
                <tr key={inv.id} onClick={() => navigate(`/invoices/${inv.id}`)}>
                  <td style={{ fontWeight: 600, fontFamily: 'Cormorant Garamond, serif', fontSize: 15 }}>{inv.number}</td>
                  <td>{inv.client_name || inv.client}</td>
                  <td style={{ fontSize: 12, textTransform: 'capitalize' }}>{inv.invoice_type?.replace('_', '-')}</td>
                  <td><StatusBadge status={inv.status} /></td>
                  <td style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 17, fontWeight: 600 }}>${Number(inv.total).toFixed(2)}</td>
                  <td style={{ color: inv.status === 'overdue' ? 'var(--warn)' : 'inherit', fontSize: 13 }}>{fmtDate(inv.due_date)}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {inv.status === 'draft' && (
                        <button className="btn btn-gold btn-sm" onClick={e => handleSend(inv.id, e)}>Send</button>
                      )}
                      {['sent','overdue','partially_paid'].includes(inv.status) && (
                        <button className="btn btn-dark btn-sm" onClick={e => { e.stopPropagation(); setPayingId(inv.id) }}>Record Payment</button>
                      )}
                      {inv.stripe_payment_link && (
                        <a href={inv.stripe_payment_link} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm" onClick={e => e.stopPropagation()}>
                          Pay Link ↗
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNew && <NewInvoiceModal onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); showToast('Invoice created') }} />}
      {payingId && <RecordPaymentModal invoiceId={payingId} onClose={() => setPayingId(null)} onSaved={() => { setPayingId(null); showToast('Payment recorded') }} />}
      {toastEl}
    </AppShell>
  )
}
