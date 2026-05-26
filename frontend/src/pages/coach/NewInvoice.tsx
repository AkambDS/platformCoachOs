import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { invoicesApi, clientsApi, settingsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { useToast } from '../../components/ui'
import { useAuthStore } from '../../store/auth'

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

// ── Mini PDF preview rendered inline ─────────────────────────────────────────

function PdfPreview({ client, items, subtotal, discount, tax, total, dueDate, notes, workspaceName, logoUrl }: {
  client: any
  items: { description: string; quantity: string; unit_price: string }[]
  subtotal: number; discount: number; tax: number; total: number
  dueDate: string; notes: string
  workspaceName: string; logoUrl: string
}) {
  const due = dueDate ? new Date(dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
  const clientName = client ? `${client.first_name} ${client.last_name}` : '—'
  const clientEmail = client?.email || ''
  const clientCompany = client?.company || ''

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e4dfd6',
      borderRadius: 6,
      padding: '14px 16px',
      fontSize: 10,
      fontFamily: 'Inter, sans-serif',
      color: '#1a1714',
      lineHeight: 1.4,
      minHeight: 220,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          {logoUrl
            ? <img src={logoUrl} alt={workspaceName} style={{ maxHeight: 24, maxWidth: 80, objectFit: 'contain' }} />
            : <span style={{ fontFamily: 'Georgia, serif', fontSize: 13, fontWeight: 600, color: '#1a1714' }}>{workspaceName}</span>
          }
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.12em', color: '#9e9890' }}>Invoice</div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 14, fontWeight: 600 }}>INV-XXXX</div>
          {dueDate && <div style={{ color: '#9e9890', fontSize: 9, marginTop: 2 }}>Due: {due}</div>}
        </div>
      </div>

      {/* Divider */}
      <div style={{ borderTop: '1.5px solid #1a2f4e', marginBottom: 8 }} />

      {/* Bill To */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: '.1em', color: '#9e9890', marginBottom: 2 }}>Bill To</div>
        <div style={{ fontWeight: 600, fontSize: 10 }}>{clientName}{clientCompany ? ` · ${clientCompany}` : ''}</div>
        {clientEmail && <div style={{ color: '#6e6560', fontSize: 9 }}>{clientEmail}</div>}
      </div>

      {/* Line items */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 6, fontSize: 9 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #ede9e1' }}>
            <th style={{ textAlign: 'left', padding: '2px 0', color: '#9e9890', fontWeight: 500 }}>Description</th>
            <th style={{ textAlign: 'right', padding: '2px 0', color: '#9e9890', fontWeight: 500 }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.filter(it => it.description).map((it, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f5f1ec' }}>
              <td style={{ padding: '3px 0' }}>{it.description}</td>
              <td style={{ padding: '3px 0', textAlign: 'right', fontFamily: 'Georgia, serif' }}>
                ${fmt$(Number(it.quantity || 1) * Number(it.unit_price || 0))}
              </td>
            </tr>
          ))}
          {items.filter(it => it.description).length === 0 && (
            <tr><td colSpan={2} style={{ color: '#c8c2ba', padding: '4px 0', fontStyle: 'italic' }}>No line items yet</td></tr>
          )}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ borderTop: '1px solid #ede9e1', paddingTop: 4 }}>
        {discount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6e6560', marginBottom: 1 }}>
            <span>Discount</span><span>-${fmt$(discount)}</span>
          </div>
        )}
        {tax > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6e6560', marginBottom: 1 }}>
            <span>Tax</span><span>${fmt$(tax)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'Georgia, serif', fontSize: 12, fontWeight: 600, marginTop: 2 }}>
          <span>Total</span><span>${fmt$(total)}</span>
        </div>
      </div>

      {notes && (
        <div style={{ marginTop: 8, padding: '4px 6px', background: '#faf8f4', borderLeft: '2px solid #b8922e', fontSize: 9, color: '#6e6560' }}>
          {notes}
        </div>
      )}
    </div>
  )
}

// ── Client combobox ───────────────────────────────────────────────────────────

function ClientCombobox({ clients, value, onChange }: {
  clients: any[]
  value: string
  onChange: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = clients.find(c => String(c.id) === value)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = query.trim()
    ? clients.filter(c =>
        `${c.first_name} ${c.last_name} ${c.company || ''}`.toLowerCase().includes(query.toLowerCase())
      )
    : clients

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        className="finput"
        style={{ marginBottom: 0 }}
        placeholder="Type to search clients…"
        value={open ? query : selected ? `${selected.first_name} ${selected.last_name}${selected.company ? ` — ${selected.company}` : ''}` : ''}
        onFocus={() => { setOpen(true); setQuery('') }}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
      />
      {selected && !open && (
        <button
          onClick={() => { onChange(''); setQuery(''); setOpen(false) }}
          style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 16, lineHeight: 1, padding: 0 }}
        >×</button>
      )}
      {open && (
        <div style={{
          position: 'absolute', zIndex: 50, top: '100%', left: 0, right: 0,
          background: '#fff', border: '1px solid var(--border)', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,.1)', maxHeight: 220, overflowY: 'auto', marginTop: 2,
        }}>
          {filtered.length === 0 && (
            <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--muted)' }}>No clients found</div>
          )}
          {filtered.map(c => (
            <div
              key={c.id}
              onMouseDown={() => { onChange(String(c.id)); setOpen(false); setQuery('') }}
              style={{
                padding: '9px 14px', fontSize: 13, cursor: 'pointer',
                background: String(c.id) === value ? 'var(--paper)' : '#fff',
                fontWeight: String(c.id) === value ? 600 : 400,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--paper)')}
              onMouseLeave={e => (e.currentTarget.style.background = String(c.id) === value ? 'var(--paper)' : '#fff')}
            >
              {c.first_name} {c.last_name}
              {c.company && <span style={{ color: 'var(--muted)', marginLeft: 6 }}>— {c.company}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Catalog autocomplete for description field ────────────────────────────────

function CatalogDescInput({ value, onChange, onSelectCatalog, catalog }: {
  value: string
  onChange: (v: string) => void
  onSelectCatalog: (item: any) => void
  catalog: any[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const matches = value.trim()
    ? catalog.filter(i => i.name.toLowerCase().includes(value.toLowerCase()) || i.description?.toLowerCase().includes(value.toLowerCase()))
    : catalog

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        className="finput"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Description"
        style={{ marginBottom: 0 }}
      />
      {open && matches.length > 0 && (
        <div style={{
          position: 'absolute', zIndex: 50, top: '100%', left: 0, right: 0,
          background: '#fff', border: '1px solid var(--border)', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,.1)', maxHeight: 200, overflowY: 'auto', marginTop: 2,
        }}>
          {matches.map((item: any) => (
            <div
              key={item.id}
              onMouseDown={() => { onSelectCatalog(item); setOpen(false) }}
              style={{ padding: '8px 14px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--paper)')}
              onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
            >
              <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{item.name}</div>
              {item.description && <div style={{ color: 'var(--muted)', fontSize: 12 }}>{item.description}</div>}
              <div style={{ color: 'var(--gold)', fontSize: 12, fontFamily: 'Cormorant Garamond, serif', marginTop: 1 }}>
                ${Number(item.unit_price).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NewInvoice() {
  const navigate = useNavigate()
  const { id: editId } = useParams<{ id: string }>()
  const isEdit = !!editId
  const qc = useQueryClient()
  const { show: showToast, el: toastEl } = useToast()
  const workspace = useAuthStore(s => s.workspace)

  const [tab, setTab] = useState<'one_time' | 'subscription'>('one_time')
  const [form, setForm] = useState({
    client: '',
    currency: 'USD',
    issue_date: today(),
    due_date: '',
    notes: '',
    discount_type: 'percent',
    discount_value: '0',
    tax_percent: '0',
    billing_cycle: 'monthly',
    billing_day: '1',
    subscription_start: today(),
    subscription_auto_send: true,
  })
  const [items, setItems] = useState([{ description: '', quantity: '1', unit_price: '' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Load existing invoice when editing
  const { data: existingInv } = useQuery({
    queryKey: ['invoice', editId],
    queryFn: () => invoicesApi.get(editId!).then(r => r.data),
    enabled: isEdit,
  })

  useEffect(() => {
    if (!existingInv) return
    setTab(existingInv.invoice_type === 'subscription' ? 'subscription' : 'one_time')
    setForm({
      client: String(existingInv.client),
      currency: existingInv.currency || 'USD',
      issue_date: existingInv.issue_date || today(),
      due_date: existingInv.due_date || '',
      notes: existingInv.notes || '',
      discount_type: existingInv.discount_type || 'percent',
      discount_value: String(existingInv.discount_value ?? '0'),
      tax_percent: String(existingInv.tax_percent ?? '0'),
      billing_cycle: existingInv.billing_cycle || 'monthly',
      billing_day: String(existingInv.billing_day ?? '1'),
      subscription_start: existingInv.subscription_start || today(),
      subscription_auto_send: existingInv.subscription_auto_send ?? true,
    })
    if (existingInv.items?.length) {
      setItems(existingInv.items.map((it: any) => ({
        description: it.description,
        quantity: String(it.quantity),
        unit_price: String(it.unit_price),
      })))
    }
  }, [existingInv])

  const { data: clientsData } = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => clientsApi.list({ page_size: 200 }).then(r => r.data),
  })
  const clients: any[] = clientsData?.results || clientsData || []
  const selectedClient = clients.find((c: any) => String(c.id) === String(form.client))

  const { data: wsSettings } = useQuery({
    queryKey: ['workspace-settings'],
    queryFn: () => settingsApi.getWorkspace().then(r => r.data),
  })

  const { data: catalogData = [] } = useQuery({
    queryKey: ['service-catalog'],
    queryFn: () => invoicesApi.catalogItems().then(r => r.data),
  })
  const workspaceName = wsSettings?.name || workspace?.name || ''
  const logoUrl = wsSettings?.logo_data || ''

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))
  const setItem = (i: number, k: string, v: string) =>
    setItems(arr => arr.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  const addItem = () => setItems(arr => [...arr, { description: '', quantity: '1', unit_price: '' }])
  const removeItem = (i: number) => setItems(arr => arr.filter((_, idx) => idx !== i))

  const subtotal = items.reduce((s, it) => s + (Number(it.quantity) * Number(it.unit_price) || 0), 0)
  const discountAmt = form.discount_type === 'percent'
    ? subtotal * Number(form.discount_value) / 100
    : Number(form.discount_value)
  const taxable = subtotal - discountAmt
  const taxAmt = taxable * Number(form.tax_percent) / 100
  const total = taxable + taxAmt

  const clientFirstName = selectedClient?.first_name || 'Client'

  const payload = useMemo(() => ({
    client: form.client,
    invoice_type: tab === 'subscription' ? 'subscription' : 'one_time',
    currency: form.currency,
    issue_date: form.issue_date || null,
    due_date: form.due_date || null,
    notes: form.notes,
    discount_type: form.discount_type,
    discount_value: Number(form.discount_value),
    tax_percent: Number(form.tax_percent),
    items: items.map(it => ({
      description: it.description,
      quantity: Number(it.quantity),
      unit_price: Number(it.unit_price),
    })),
    ...(tab === 'subscription' ? {
      billing_cycle: form.billing_cycle,
      billing_day: Number(form.billing_day),
      subscription_start: form.subscription_start || null,
      subscription_auto_send: form.subscription_auto_send,
    } : {}),
  }), [form, items, tab])

  const parseError = (e: any) => {
    const d = e.response?.data
    return d?.detail || Object.entries(d || {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v[0] : v}`).join('; ') || 'Failed to save'
  }

  const validate = () => {
    if (!form.client) { setError('Please select a client'); return false }
    if (items.some(it => !it.description || !it.unit_price)) { setError('Fill in all line items'); return false }
    return true
  }

  const handleSaveDraft = async () => {
    if (!validate()) return
    setSaving(true); setError('')
    try {
      if (isEdit) {
        await invoicesApi.update(editId!, { ...payload })
        qc.invalidateQueries({ queryKey: ['invoice', editId] })
      } else {
        await invoicesApi.create({ ...payload })
      }
      qc.invalidateQueries({ queryKey: ['invoices'] })
      showToast(isEdit ? 'Invoice updated' : 'Draft saved')
      navigate(isEdit ? `/invoices/${editId}` : '/invoices')
    } catch (e: any) {
      setError(parseError(e))
    } finally { setSaving(false) }
  }

  const handleSend = async () => {
    if (!validate()) return
    setSaving(true); setError('')
    try {
      let id: string
      if (isEdit) {
        await invoicesApi.update(editId!, { ...payload })
        id = editId!
      } else {
        const res = await invoicesApi.create({ ...payload })
        id = res.data.id
      }
      await invoicesApi.send(id)
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['invoice', id] })
      showToast(`Invoice sent to ${clientFirstName}`)
      navigate(`/invoices/${id}`)
    } catch (e: any) {
      setError(parseError(e))
    } finally { setSaving(false) }
  }

  const backHref = isEdit ? `/invoices/${editId}` : '/invoices'

  return (
    <AppShell>
      {/* ── Page Header ── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        padding: '24px 32px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--paper)',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => navigate(backHref)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 18, padding: 0, lineHeight: 1 }}
            >←</button>
            <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 26, fontWeight: 400, color: 'var(--ink)' }}>
              {isEdit ? `Edit Invoice ${existingInv?.number || ''}` : 'New Invoice'}
            </h1>
          </div>
          {selectedClient && (
            <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2, paddingLeft: 28 }}>
              {selectedClient.first_name} {selectedClient.last_name}
              {selectedClient.company ? ` · ${selectedClient.company}` : ''}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button
            className="btn btn-outline"
            onClick={handleSaveDraft}
            disabled={saving}
            style={{ letterSpacing: '.06em', fontSize: 12, fontWeight: 600 }}
          >
            SAVE DRAFT
          </button>
          <button
            className="btn btn-dark"
            onClick={handleSend}
            disabled={saving}
            style={{ letterSpacing: '.06em', fontSize: 12, fontWeight: 600 }}
          >
            SEND INVOICE →
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ padding: '24px 32px', display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>

        {/* ── Left column ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Error banner */}
          {error && (
            <div style={{ background: '#fde8dc', color: '#a0400d', padding: '10px 14px', fontSize: 13, borderRadius: 4 }}>
              {error}
            </div>
          )}

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
            {[
              { key: 'one_time', label: 'One-Time Invoice' },
              { key: 'subscription', label: 'Monthly Subscription' },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key as any)}
                style={{
                  padding: '9px 18px',
                  background: tab === t.key ? 'var(--ink)' : 'transparent',
                  color: tab === t.key ? '#fff' : 'var(--muted)',
                  border: '1px solid var(--border)',
                  borderBottom: tab === t.key ? '1px solid var(--ink)' : '1px solid var(--border)',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: tab === t.key ? 600 : 400,
                  borderRadius: tab === t.key ? '4px 4px 0 0' : '4px 4px 0 0',
                  marginBottom: -1,
                  letterSpacing: '.01em',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Invoice Details card */}
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '24px 24px 20px' }}>
            <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 400, marginBottom: 18, color: 'var(--ink)' }}>
              Invoice Details
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' }}>
              {/* Client */}
              <div className="fgroup" style={{ marginBottom: 0 }}>
                <label className="flabel">CLIENT</label>
                <ClientCombobox clients={clients} value={form.client} onChange={v => set('client', v)} />
              </div>

              {/* Currency */}
              <div className="fgroup" style={{ marginBottom: 0 }}>
                <label className="flabel">CURRENCY</label>
                <select className="fselect" value={form.currency} onChange={e => set('currency', e.target.value)}>
                  {['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* Issue Date */}
              <div className="fgroup" style={{ marginBottom: 0 }}>
                <label className="flabel">ISSUE DATE</label>
                <input className="finput" type="date" value={form.issue_date} onChange={e => set('issue_date', e.target.value)} />
              </div>

              {/* Due Date */}
              <div className="fgroup" style={{ marginBottom: 0 }}>
                <label className="flabel">DUE DATE</label>
                <input className="finput" type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} />
              </div>
            </div>

            {/* Notes */}
            <div className="fgroup" style={{ marginTop: 12, marginBottom: 0 }}>
              <label className="flabel">NOTES (VISIBLE ON INVOICE)</label>
              <textarea
                className="ftextarea"
                rows={2}
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Payment terms, bank details, or a personal note…"
              />
            </div>
          </div>

          {/* Subscription settings card */}
          {tab === 'subscription' && (
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '24px 24px 20px' }}>
              <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 400, marginBottom: 18, color: 'var(--ink)' }}>
                Subscription Settings
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 16px' }}>
                <div className="fgroup" style={{ marginBottom: 0 }}>
                  <label className="flabel">BILLING CYCLE</label>
                  <select className="fselect" value={form.billing_cycle} onChange={e => set('billing_cycle', e.target.value)}>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
                <div className="fgroup" style={{ marginBottom: 0 }}>
                  <label className="flabel">BILLING DAY</label>
                  <select className="fselect" value={form.billing_day} onChange={e => set('billing_day', e.target.value)}>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                      <option key={d} value={d}>{d}{d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'} of the month</option>
                    ))}
                  </select>
                </div>
                <div className="fgroup" style={{ marginBottom: 0 }}>
                  <label className="flabel">START DATE</label>
                  <input className="finput" type="date" value={form.subscription_start} onChange={e => set('subscription_start', e.target.value)} />
                </div>
              </div>

              {/* Auto-send toggle */}
              <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, flexShrink: 0 }}>
                  <input
                    type="checkbox"
                    checked={form.subscription_auto_send}
                    onChange={e => set('subscription_auto_send', e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute', cursor: 'pointer', inset: 0,
                    background: form.subscription_auto_send ? 'var(--ink)' : 'var(--border)',
                    borderRadius: 11,
                    transition: 'background .2s',
                  }}>
                    <span style={{
                      position: 'absolute', top: 3, left: form.subscription_auto_send ? 21 : 3,
                      width: 16, height: 16, background: '#fff', borderRadius: '50%',
                      transition: 'left .2s',
                    }} />
                  </span>
                </label>
                <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                  Automatically send invoice email each billing period
                </span>
              </div>
            </div>
          )}

          {/* Line Items card */}
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '24px 24px 20px' }}>
            <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 400, marginBottom: 18, color: 'var(--ink)' }}>
              Line Items
            </h3>

            {/* Table header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 64px 120px 100px 28px',
              gap: 8, paddingBottom: 6, borderBottom: '1px solid var(--border)', marginBottom: 4,
            }}>
              {['DESCRIPTION', 'QTY', 'UNIT PRICE', 'TOTAL', ''].map(h => (
                <div key={h} style={{ fontSize: 10, letterSpacing: '.1em', color: 'var(--muted)', fontWeight: 600 }}>{h}</div>
              ))}
            </div>

            {items.map((item, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '1fr 64px 120px 100px 28px',
                gap: 8, alignItems: 'center', marginBottom: 6,
              }}>
                <CatalogDescInput
                  value={item.description}
                  onChange={v => setItem(i, 'description', v)}
                  onSelectCatalog={cat => setItems(arr => arr.map((it, idx) =>
                    idx === i ? { ...it, description: cat.name, unit_price: String(cat.unit_price) } : it
                  ))}
                  catalog={catalogData}
                />
                <input
                  className="finput"
                  type="number"
                  value={item.quantity}
                  onChange={e => setItem(i, 'quantity', e.target.value)}
                  style={{ marginBottom: 0, textAlign: 'center' }}
                />
                <input
                  className="finput"
                  type="number"
                  value={item.unit_price}
                  onChange={e => setItem(i, 'unit_price', e.target.value)}
                  placeholder="0.00"
                  style={{ marginBottom: 0 }}
                />
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
                  ${fmt$(Number(item.quantity || 1) * Number(item.unit_price || 0))}
                </div>
                <button
                  onClick={() => removeItem(i)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--muted)', fontSize: 16, lineHeight: 1, padding: 0,
                  }}
                  title="Remove"
                >×</button>
              </div>
            ))}

            <button
              onClick={addItem}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--gold)', fontSize: 13, fontWeight: 600, padding: '6px 0', marginTop: 2,
              }}
            >
              + Add Line Item
            </button>

            {/* Discount + Tax */}
            <div style={{ display: 'flex', gap: 16, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)', alignItems: 'flex-end' }}>
              <div className="fgroup" style={{ marginBottom: 0 }}>
                <label className="flabel">DISCOUNT</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select
                    className="fselect"
                    value={form.discount_type}
                    onChange={e => set('discount_type', e.target.value)}
                    style={{ width: 100 }}
                  >
                    <option value="percent">None</option>
                    <option value="percent">%</option>
                    <option value="fixed">$</option>
                  </select>
                  <input
                    className="finput"
                    type="number"
                    value={form.discount_value}
                    onChange={e => set('discount_value', e.target.value)}
                    placeholder="0"
                    style={{ width: 80, marginBottom: 0 }}
                  />
                </div>
              </div>
              <div className="fgroup" style={{ marginBottom: 0 }}>
                <label className="flabel">TAX</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    className="finput"
                    type="number"
                    value={form.tax_percent}
                    onChange={e => set('tax_percent', e.target.value)}
                    placeholder="0%"
                    style={{ width: 80, marginBottom: 0 }}
                  />
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right column ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 24 }}>

          {/* Summary card */}
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '18px 20px' }}>
            <div style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--muted)', fontWeight: 600, marginBottom: 14 }}>SUMMARY</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'Subtotal', value: `$${fmt$(subtotal)}` },
                { label: 'Discount', value: discountAmt > 0 ? `-$${fmt$(discountAmt)}` : '—' },
                { label: 'Tax', value: `$${fmt$(taxAmt)}` },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--muted)' }}>
                  <span>{label}</span><span>{value}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 2 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Total Due</span>
                <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 600, color: 'var(--ink)' }}>
                  ${fmt$(total)}
                </span>
              </div>
            </div>
          </div>

          {/* Delivery card */}
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '18px 20px' }}>
            <div style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--muted)', fontWeight: 600, marginBottom: 12 }}>DELIVERY</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {[
                'PDF attached to email',
                'Manual payment also supported',
              ].map(line => (
                <div key={line} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)' }}>
                  <span style={{ color: 'var(--success)', fontWeight: 700, fontSize: 14 }}>✓</span>
                  {line}
                </div>
              ))}
            </div>
            <button
              className="btn btn-dark"
              onClick={handleSend}
              disabled={saving || !form.client}
              style={{
                width: '100%', textAlign: 'center', letterSpacing: '.06em',
                fontSize: 12, fontWeight: 600, opacity: form.client ? 1 : 0.5,
              }}
            >
              SEND TO {clientFirstName.toUpperCase()} →
            </button>
          </div>

          {/* PDF Preview card */}
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--muted)', fontWeight: 600, marginBottom: 10 }}>PDF PREVIEW</div>
            <PdfPreview
              client={selectedClient}
              items={items}
              subtotal={subtotal}
              discount={discountAmt}
              tax={taxAmt}
              total={total}
              dueDate={form.due_date}
              notes={form.notes}
              workspaceName={workspaceName}
              logoUrl={logoUrl}
            />
          </div>
        </div>
      </div>

      {toastEl}
    </AppShell>
  )
}
