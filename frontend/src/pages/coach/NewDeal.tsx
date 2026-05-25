import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { pipelineApi, clientsApi, settingsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { useToast } from '../../components/ui'

const DEAL_TYPES = [
  { value: '',                 label: 'Select type…' },
  { value: '1_1_coaching',    label: '1:1 Coaching' },
  { value: 'group_program',   label: 'Group Program' },
  { value: 'corporate_training', label: 'Corporate Training' },
  { value: 'workshop',        label: 'Workshop' },
  { value: 'retainer',        label: 'Retainer' },
  { value: 'other',           label: 'Other' },
]

const SOURCES = ['Referral', 'Website', 'LinkedIn', 'Conference', 'Cold Outreach', 'Social Media', 'Podcast', 'Speaking Event', 'Other']

const PRESET_TAGS = [
  'Hot Lead', 'Warm Lead', 'Cold', 'VIP', 'Corporate', 'Individual',
  'Referral', 'High Value', 'Needs Nurturing', 'Follow-up', 'At Risk',
]

// ── Client typeahead ──────────────────────────────────────────────────────────
function ClientTypeahead({ clients, value, onChange }: {
  clients: any[]; value: string; onChange: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)
  const [label, setLabel] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = query.length < 1 ? clients : clients.filter(c => {
    const q = query.toLowerCase()
    return c.first_name?.toLowerCase().includes(q) || c.last_name?.toLowerCase().includes(q) || c.company?.toLowerCase().includes(q)
  })

  const select = (c: any) => {
    const name = `${c.first_name} ${c.last_name}`
    setLabel(name); setQuery(''); setOpen(false); onChange(c.id)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        className="finput"
        style={{ fontSize: 14 }}
        placeholder="Search by name or company…"
        value={open ? query : label}
        onFocus={() => { setQuery(''); setOpen(true) }}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        autoComplete="off"
      />
      {value && !open && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
          Selected — <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{label}</span>
          <button
            type="button"
            onClick={() => { setLabel(''); onChange('') }}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 11, marginLeft: 6 }}
          >
            (change)
          </button>
        </div>
      )}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: '0 6px 24px rgba(0,0,0,.12)', maxHeight: 280, overflowY: 'auto', marginTop: 4,
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--muted)' }}>No clients match</div>
          ) : filtered.slice(0, 40).map((c: any) => (
            <div
              key={c.id}
              onMouseDown={() => select(c)}
              style={{ padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid #f5f3f0' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#faf9f7'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
            >
              <div style={{ fontWeight: 500, fontSize: 14 }}>{c.first_name} {c.last_name}</div>
              {c.company && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.company}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Probability slider ────────────────────────────────────────────────────────
function ProbabilitySlider({ value, onChange }: { value: number | ''; onChange: (v: number | '') => void }) {
  const pct = value === '' ? 0 : value
  const color = pct >= 70 ? '#16a34a' : pct >= 40 ? '#d97706' : '#dc2626'
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <label className="flabel" style={{ margin: 0 }}>Win Probability</label>
        <span style={{ fontSize: 18, fontWeight: 700, fontFamily: 'Cormorant Garamond, serif', color }}>
          {value === '' ? '—' : `${value}%`}
        </span>
      </div>
      <input
        type="range" min={0} max={100} step={5}
        value={value === '' ? 0 : value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: color, cursor: 'pointer' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
        <span>0% Unlikely</span><span>50% Even</span><span>100% Certain</span>
      </div>
    </div>
  )
}

export default function NewDeal() {
  const navigate   = useNavigate()
  const qc         = useQueryClient()
  const { show: showToast, el: toastEl } = useToast()

  const { data: clientsData } = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => clientsApi.list({ page_size: 500 }).then(r => r.data),
  })
  const clients: any[] = clientsData?.results || clientsData || []

  const { data: stagesData = [] } = useQuery({
    queryKey: ['pipeline-stage-configs'],
    queryFn: () => settingsApi.getPipelineStages().then(r => r.data),
  })
  const stages: any[] = stagesData as any[]

  const [form, setForm] = useState({
    client:              '',
    stage:               '',
    deal_value:          '',
    deal_type:           '',
    probability:         '' as number | '',
    expected_close_date: '',
    source:              '',
    next_action:         '',
    next_action_date:    '',
    notes:               '',
    tags:                [] as string[],
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  // Set default stage once loaded
  useEffect(() => {
    if (stages.length && !form.stage) setForm(f => ({ ...f, stage: stages[0].slug }))
  }, [stages]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))
  const toggleTag = (t: string) =>
    set('tags', form.tags.includes(t) ? form.tags.filter(x => x !== t) : [...form.tags, t])

  const [customTag, setCustomTag] = useState('')
  const addCustomTag = () => {
    const t = customTag.trim()
    if (t && !form.tags.includes(t)) set('tags', [...form.tags, t])
    setCustomTag('')
  }
  const customTags = form.tags.filter(t => !PRESET_TAGS.includes(t))

  const handleSave = async () => {
    if (!form.client) { setError('Please select a client.'); return }
    if (!form.stage)  { setError('Please select a starting stage.'); return }
    setSaving(true); setError('')
    try {
      const payload = {
        client:               form.client,
        stage:                form.stage,
        deal_value:           form.deal_value ? Number(form.deal_value) : null,
        deal_type:            form.deal_type || '',
        probability:          form.probability === '' ? null : form.probability,
        expected_close_date:  form.expected_close_date || null,
        source:               form.source,
        next_action:          form.next_action,
        next_action_date:     form.next_action_date || null,
        notes:                form.notes,
        tags:                 form.tags,
      }
      await pipelineApi.create(payload)
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      showToast('Deal created')
      navigate('/pipeline')
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to create deal.')
      setSaving(false)
    }
  }

  return (
    <AppShell>
      {toastEl}

      {/* ── Header ── */}
      <div style={{
        background: 'var(--white)', borderBottom: '1px solid var(--border)',
        padding: '22px 36px 20px', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button
          onClick={() => navigate('/pipeline')}
          style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 5, fontFamily: "'DM Sans', sans-serif" }}
        >
          ← Pipeline
        </button>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 30, fontWeight: 300, marginBottom: 4 }}>
              New Deal
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Add a prospect to your pipeline and track them to close
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" onClick={() => navigate('/pipeline')}>Cancel</button>
            <button className="btn btn-dark" onClick={handleSave} disabled={saving || !form.client}>
              {saving ? 'Creating…' : 'Create Deal'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ padding: '32px 36px', maxWidth: 1080 }}>
        {error && (
          <div style={{ background: '#fde8dc', color: '#a0400d', padding: '12px 16px', marginBottom: 24, fontSize: 13, border: '1px solid #f5c0a8', borderRadius: 6 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24, alignItems: 'start' }}>

          {/* ── LEFT COLUMN ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Client */}
            <div className="card">
              <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300 }}>Client *</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Who is this deal with?</div>
              </div>
              <div style={{ padding: '20px 24px' }}>
                <ClientTypeahead clients={clients} value={form.client} onChange={id => set('client', id)} />
              </div>
            </div>

            {/* Deal Details */}
            <div className="card">
              <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300 }}>Deal Details</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Value, type, and timeline</div>
              </div>
              <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div className="fgroup">
                    <label className="flabel">Deal Value ($)</label>
                    <input
                      className="finput" type="number" placeholder="e.g. 12000"
                      value={form.deal_value}
                      onChange={e => set('deal_value', e.target.value)}
                    />
                  </div>
                  <div className="fgroup">
                    <label className="flabel">Deal Type</label>
                    <select className="fselect" value={form.deal_type} onChange={e => set('deal_type', e.target.value)}>
                      {DEAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div className="fgroup">
                    <label className="flabel">Expected Close Date</label>
                    <input
                      className="finput" type="date"
                      value={form.expected_close_date}
                      onChange={e => set('expected_close_date', e.target.value)}
                    />
                  </div>
                  <div className="fgroup">
                    <label className="flabel">Lead Source</label>
                    <select className="fselect" value={form.source} onChange={e => set('source', e.target.value)}>
                      <option value="">Select source…</option>
                      {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                <ProbabilitySlider value={form.probability} onChange={v => set('probability', v)} />
              </div>
            </div>

            {/* Notes */}
            <div className="card">
              <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300 }}>Notes</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Background, context, key information</div>
              </div>
              <div style={{ padding: '20px 24px' }}>
                <textarea
                  className="ftextarea" rows={4}
                  placeholder="What do you know about this prospect? Key challenges, motivations, timeline…"
                  value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                />
              </div>
            </div>

            {/* Tags — inline in left column so it doesn't push right column down */}
            <div className="card">
              <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300 }}>Tags</div>
                {form.tags.length > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{form.tags.length} selected</span>
                )}
              </div>
              <div style={{ padding: '16px 24px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {PRESET_TAGS.map(t => {
                    const active = form.tags.includes(t)
                    return (
                      <button key={t} type="button" onClick={() => toggleTag(t)} style={{
                        padding: '4px 12px', borderRadius: 14, fontSize: 11, fontWeight: 500,
                        cursor: 'pointer', fontFamily: 'inherit',
                        border: active ? '1.5px solid #1B3A6B' : '1.5px solid #d5cfc9',
                        background: active ? '#1B3A6B' : '#faf9f7',
                        color: active ? '#fff' : '#555', transition: 'all .12s',
                      }}>{t}</button>
                    )
                  })}
                  {customTags.map(t => (
                    <button key={t} type="button" onClick={() => toggleTag(t)} style={{
                      padding: '4px 12px', borderRadius: 14, fontSize: 11, fontWeight: 500,
                      cursor: 'pointer', fontFamily: 'inherit',
                      border: '1.5px solid #1B3A6B', background: '#1B3A6B', color: '#fff',
                    }}>{t} ×</button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="finput" style={{ flex: 1, fontSize: 12 }}
                    placeholder="Add custom tag…"
                    value={customTag}
                    onChange={e => setCustomTag(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag() } }}
                  />
                  <button type="button" className="btn btn-outline btn-sm" onClick={addCustomTag}>Add</button>
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT COLUMN ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Pipeline Stage + Next Action combined */}
            <div className="card">
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300 }}>Starting Stage</div>
              </div>
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                {stages.map((s: any) => (
                  <label
                    key={s.slug}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                      borderRadius: 7, cursor: 'pointer',
                      border: form.stage === s.slug ? `1.5px solid ${s.color}` : '1.5px solid var(--border)',
                      background: form.stage === s.slug ? s.color + '10' : 'var(--paper)',
                      transition: 'all .12s',
                    }}
                  >
                    <input
                      type="radio" name="stage" value={s.slug}
                      checked={form.stage === s.slug}
                      onChange={() => set('stage', s.slug)}
                      style={{ accentColor: s.color }}
                    />
                    <span style={{
                      fontSize: 12, fontWeight: form.stage === s.slug ? 600 : 400,
                      color: form.stage === s.slug ? s.color : 'var(--ink)', flex: 1,
                    }}>
                      {s.label}
                    </span>
                    {s.follow_up_days && (
                      <span style={{ fontSize: 10, color: 'var(--muted)' }}>{s.follow_up_days}d</span>
                    )}
                  </label>
                ))}
              </div>

              {/* Next Action — compact section at bottom of stage card */}
              <div style={{ borderTop: '1px solid var(--border)', padding: '14px 20px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', color: 'var(--muted)', marginBottom: 10 }}>NEXT ACTION</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    className="finput" style={{ fontSize: 12 }}
                    placeholder="Send proposal, Schedule call…"
                    value={form.next_action}
                    onChange={e => set('next_action', e.target.value)}
                  />
                  <input
                    className="finput" type="date" style={{ fontSize: 12 }}
                    value={form.next_action_date}
                    onChange={e => set('next_action_date', e.target.value)}
                  />
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </AppShell>
  )
}
