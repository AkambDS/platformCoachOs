import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clientsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { PageHeader, Modal, EmptyState, StatusBadge, useToast } from '../../components/ui'

const AVATAR_COLS = ['c1','c2','c3','c4','c5']
const LEAD_SOURCES = ['referral','website','linkedin','conference','other']
const TAGS_OPTIONS = ['Executive','Leadership','Career','Health','Team','Strategy','Startup']

function initials(first: string, last: string) {
  return ((first?.[0] || '') + (last?.[0] || '')).toUpperCase()
}

function NewClientModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    company: '', job_title: '', lead_source: '', notes: '',
    tags: [] as string[], create_deal: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))
  const toggleTag = (t: string) => set('tags', form.tags.includes(t) ? form.tags.filter(x => x !== t) : [...form.tags, t])

  const handleSave = async () => {
    if (!form.first_name || !form.email) { setError('First name and email are required'); return }
    setSaving(true); setError('')
    try {
      await clientsApi.create(form)
      qc.invalidateQueries({ queryKey: ['clients'] })
      onSaved()
    } catch (e: any) {
      setError(e.response?.data?.email?.[0] || e.response?.data?.detail || 'Failed to create client')
    } finally { setSaving(false) }
  }

  return (
    <Modal title="New Client" onClose={onClose} size="lg"
      footer={
        <>
          <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-dark btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Create Client'}
          </button>
        </>
      }>
      {error && <div style={{ background: '#fde8dc', color: '#a0400d', padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>{error}</div>}
      <div className="fsec" style={{ marginTop: 0 }}>Contact Information</div>
      <div className="fgrid">
        <div className="fgroup">
          <label className="flabel">First Name *</label>
          <input className="finput" value={form.first_name} onChange={e => set('first_name', e.target.value)} placeholder="Sarah" />
        </div>
        <div className="fgroup">
          <label className="flabel">Last Name</label>
          <input className="finput" value={form.last_name} onChange={e => set('last_name', e.target.value)} placeholder="Mitchell" />
        </div>
        <div className="fgroup">
          <label className="flabel">Email *</label>
          <input className="finput" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="sarah@company.com" />
        </div>
        <div className="fgroup">
          <label className="flabel">Phone</label>
          <input className="finput" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+1 555 000 0000" />
        </div>
        <div className="fgroup">
          <label className="flabel">Company</label>
          <input className="finput" value={form.company} onChange={e => set('company', e.target.value)} placeholder="Acme Corp" />
        </div>
        <div className="fgroup">
          <label className="flabel">Job Title</label>
          <input className="finput" value={form.job_title} onChange={e => set('job_title', e.target.value)} placeholder="VP of Sales" />
        </div>
        <div className="fgroup">
          <label className="flabel">Lead Source</label>
          <select className="fselect" value={form.lead_source} onChange={e => set('lead_source', e.target.value)}>
            <option value="">Select source…</option>
            {LEAD_SOURCES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>

      <div className="fsec">Tags</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {TAGS_OPTIONS.map(t => (
          <button key={t} className={`filter-pill${form.tags.includes(t) ? ' active' : ''}`} onClick={() => toggleTag(t)}>{t}</button>
        ))}
      </div>

      <div className="fsec">Notes</div>
      <textarea className="ftextarea" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Initial context, referral source, coaching goals…" />

      <div style={{ marginTop: 16, padding: '14px 16px', background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,.3)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <input type="checkbox" id="create_deal" checked={form.create_deal} onChange={e => set('create_deal', e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--gold)' }} />
        <label htmlFor="create_deal" style={{ fontSize: 13, cursor: 'pointer' }}>
          <strong>Create pipeline deal</strong> — add this client to the pipeline at Lead – New stage
        </label>
      </div>
    </Modal>
  )
}

export default function Clients() {
  const navigate = useNavigate()
  const { show: showToast, el: toastEl } = useToast()
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['clients', search, activeFilter],
    queryFn: () => clientsApi.list({
      search: search || undefined,
      active_flag: activeFilter === 'active' ? true : activeFilter === 'inactive' ? false : undefined,
    }).then(r => r.data),
  })

  const clients: any[] = data?.results || data || []

  return (
    <AppShell>
      <PageHeader
        title="Clients"
        subtitle={`${clients.length} total`}
        action={
          <button className="btn btn-dark" onClick={() => setShowNew(true)}>
            + New Client
          </button>
        }
      />

      <div className="page-body">
        <div className="toolbar">
          <div className="search-box">
            <span className="search-icon">⌕</span>
            <input
              placeholder="Search by name, email, company…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button className={`filter-pill${activeFilter === null ? ' active' : ''}`} onClick={() => setActiveFilter(null)}>All</button>
          <button className={`filter-pill${activeFilter === 'active' ? ' active' : ''}`} onClick={() => setActiveFilter('active')}>Active</button>
          <button className={`filter-pill${activeFilter === 'inactive' ? ' active' : ''}`} onClick={() => setActiveFilter('inactive')}>Inactive</button>
        </div>

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading clients…</div>
        ) : clients.length === 0 ? (
          <EmptyState icon="◉" title="No clients yet" message="Add your first client to get started" action={
            <button className="btn btn-dark" onClick={() => setShowNew(true)}>+ New Client</button>
          } />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Client</th>
                <th>Company</th>
                <th>Email</th>
                <th>Tags</th>
                <th>Status</th>
                <th>Lead Source</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c: any, i: number) => (
                <tr key={c.id} onClick={() => navigate(`/clients/${c.id}`)}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div className={`avatar ${AVATAR_COLS[i % 5]}`} style={{ background: undefined }}>
                        {initials(c.first_name, c.last_name)}
                      </div>
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{c.first_name} {c.last_name}</div>
                        {c.job_title && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.job_title}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={{ fontSize: 13 }}>{c.company || '—'}</td>
                  <td style={{ fontSize: 13, color: 'var(--blue)' }}>{c.email}</td>
                  <td>
                    {(c.tags || []).map((t: string) => <span key={t} className="tag">{t}</span>)}
                  </td>
                  <td>
                    <span className={`pill ${c.active_flag ? 'pill-green' : 'pill-grey'}`}>
                      {c.active_flag ? 'Active' : 'Inactive'}
                    </span>
                    {c.portal_access && <span className="pill pill-blue" style={{ marginLeft: 4 }}>Portal</span>}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'capitalize' }}>{c.lead_source || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <NewClientModal
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); showToast('Client created successfully') }}
        />
      )}
      {toastEl}
    </AppShell>
  )
}
