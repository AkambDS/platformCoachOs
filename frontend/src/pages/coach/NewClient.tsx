import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { clientsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { useToast } from '../../components/ui'

const LEAD_SOURCES = ['referral', 'website', 'linkedin', 'conference', 'cold outreach', 'other']
const TAGS_OPTIONS = ['VIP', 'New', 'Finance', 'Tech Sector', 'Referral', 'On Hold', 'Executive', 'Leadership', 'Career', 'Health', 'Strategy', 'Startup']

export default function NewClient() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { show: showToast, el: toastEl } = useToast()
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    company: '', job_title: '', lead_source: '', birth_date: '',
    notes: '', tags: [] as string[], create_deal: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))
  const toggleTag = (t: string) =>
    set('tags', form.tags.includes(t) ? form.tags.filter(x => x !== t) : [...form.tags, t])

  const handleSave = async () => {
    if (!form.first_name || !form.email) { setError('First name and email are required'); return }
    setSaving(true); setError('')
    try {
      const res = await clientsApi.create({ ...form })
      qc.invalidateQueries({ queryKey: ['clients'] })
      showToast('Client created')
      navigate(`/clients/${res.data.id}`)
    } catch (e: any) {
      setError(e.response?.data?.email?.[0] || e.response?.data?.detail || 'Failed to create client')
      setSaving(false)
    }
  }

  return (
    <AppShell>
      {/* Page header */}
      <div style={{ background: 'var(--white)', borderBottom: '1px solid var(--border)', padding: '22px 36px 20px' }}>
        <button
          onClick={() => navigate('/clients')}
          style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 5, fontFamily: "'DM Sans', sans-serif" }}
        >
          ← Clients
        </button>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 300, marginBottom: 4 }}>New Client</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>All required fields marked *</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" onClick={() => navigate('/clients')}>Cancel</button>
            <button className="btn btn-dark" onClick={handleSave} disabled={saving}>
              {saving ? 'Creating…' : 'Create Client'}
            </button>
          </div>
        </div>
      </div>

      <div className="page-body" style={{ maxWidth: 780 }}>
        {error && (
          <div style={{ background: '#fde8dc', color: '#a0400d', padding: '12px 16px', marginBottom: 20, fontSize: 13, border: '1px solid #f5c0a8' }}>
            {error}
          </div>
        )}

        <div className="card">
          {/* Card title */}
          <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 300 }}>Client Details</div>
          </div>

          {/* PERSONAL INFORMATION */}
          <div style={{ padding: '28px 28px 24px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.15em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 22 }}>
              Personal Information
            </div>
            <div className="fgrid">
              <div className="fgroup">
                <label className="flabel">First Name *</label>
                <input className="finput" value={form.first_name} onChange={e => set('first_name', e.target.value)} placeholder="Amara" />
              </div>
              <div className="fgroup">
                <label className="flabel">Last Name *</label>
                <input className="finput" value={form.last_name} onChange={e => set('last_name', e.target.value)} placeholder="Levi" />
              </div>
              <div className="fgroup">
                <label className="flabel">Email *</label>
                <input className="finput" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="amara.levi@company.com" />
              </div>
              <div className="fgroup">
                <label className="flabel">Phone</label>
                <input className="finput" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+1 646 555 0192" />
              </div>
              <div className="fgroup">
                <label className="flabel">Job Title</label>
                <input className="finput" value={form.job_title} onChange={e => set('job_title', e.target.value)} placeholder="Chief Executive Officer" />
              </div>
              <div className="fgroup">
                <label className="flabel">Company</label>
                <input className="finput" value={form.company} onChange={e => set('company', e.target.value)} placeholder="NovaBridge Capital" />
              </div>
              <div className="fgroup">
                <label className="flabel">Lead Source</label>
                <select className="fselect" value={form.lead_source} onChange={e => set('lead_source', e.target.value)}>
                  <option value="">Select source…</option>
                  {LEAD_SOURCES.map(s => (
                    <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div className="fgroup">
                <label className="flabel">Birth Date</label>
                <input className="finput" type="date" value={form.birth_date} onChange={e => set('birth_date', e.target.value)} />
              </div>
            </div>
          </div>

          {/* COACH & TAGS */}
          <div style={{ padding: '28px 28px 24px', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.15em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 22 }}>
              Coach & Tags
            </div>
            <div className="fgroup" style={{ marginBottom: 20 }}>
              <label className="flabel">Tags</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {TAGS_OPTIONS.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
                    style={{
                      padding: '7px 16px', fontSize: 12, cursor: 'pointer',
                      border: '1px solid var(--border)',
                      background: form.tags.includes(t) ? 'var(--ink)' : 'var(--white)',
                      color: form.tags.includes(t) ? 'var(--paper)' : 'var(--ink)',
                      fontFamily: "'DM Sans', sans-serif",
                      transition: 'all .15s',
                    }}
                  >{t}</button>
                ))}
              </div>
            </div>
            <div className="fgroup">
              <label className="flabel">Notes</label>
              <textarea
                className="ftextarea" rows={3}
                value={form.notes} onChange={e => set('notes', e.target.value)}
                placeholder="Initial context, referral source, coaching goals…"
              />
            </div>
          </div>

          {/* PIPELINE DEAL */}
          <div style={{ padding: '24px 28px 28px', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.15em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                Pipeline Deal — Optional
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox" checked={form.create_deal}
                  onChange={e => set('create_deal', e.target.checked)}
                  style={{ width: 14, height: 14, accentColor: 'var(--gold)' }}
                />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Create deal</span>
              </label>
            </div>
            {form.create_deal && (
              <div style={{ padding: '14px 18px', background: 'var(--paper)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
                A pipeline deal will be opened at the <strong style={{ color: 'var(--ink)' }}>Lead – New</strong> stage and tracked in the Pipeline board.
              </div>
            )}
          </div>
        </div>

        {/* Bottom actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
          <button className="btn btn-outline" onClick={() => navigate('/clients')}>Cancel</button>
          <button className="btn btn-dark" onClick={handleSave} disabled={saving}>
            {saving ? 'Creating…' : 'Create Client'}
          </button>
        </div>
      </div>
      {toastEl}
    </AppShell>
  )
}
