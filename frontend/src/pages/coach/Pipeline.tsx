import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { pipelineApi, clientsApi, settingsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { PageHeader, Modal, useToast } from '../../components/ui'

function daysSince(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  return Math.floor(diff / 86400000)
}

function DealCard({ deal, stages, onAdvance, onClick }: {
  deal: any; stages: any[]; onAdvance: (id: string, stage: string) => void; onClick: () => void
}) {
  const currentIdx = stages.findIndex((s: any) => s.slug === deal.stage)
  const next = currentIdx >= 0 && currentIdx < stages.length - 1 ? stages[currentIdx + 1] : null
  return (
    <div
      className={`deal-card ${deal.stage === 'lead_new' ? 'new' : deal.stage === 'active_client' ? 'won' : ''}`}
      onClick={onClick}
    >
      <div className="deal-name">{deal.client_name || deal.client?.first_name + ' ' + deal.client?.last_name}</div>
      <div className="deal-co">{deal.client?.company || deal.source || ''}</div>
      <div className="deal-foot">
        <div className="deal-val">{deal.deal_value ? `$${Number(deal.deal_value).toLocaleString()}` : '—'}</div>
        <div className="deal-age">{daysSince(deal.created_at)}d</div>
      </div>
      {next && (
        <button
          onClick={e => { e.stopPropagation(); onAdvance(deal.id, next.slug) }}
          className="btn btn-outline btn-sm"
          style={{
            width: '100%', marginTop: 10, fontSize: 10,
            textTransform: 'none', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          → {next.label}
        </button>
      )}
    </div>
  )
}

function NewDealModal({ stages, onClose, onSaved }: any) {
  const qc = useQueryClient()
  const { data: clientsData } = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => clientsApi.list({ page_size: 200 }).then(r => r.data),
  })
  const clients: any[] = clientsData?.results || clientsData || []
  const [form, setForm] = useState({ client: '', deal_value: '', source: '', notes: '', stage: stages[0]?.slug || 'lead_new' })
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.client) return
    setSaving(true)
    try {
      await pipelineApi.create({ ...form, deal_value: form.deal_value || null })
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      onSaved()
    } catch { } finally { setSaving(false) }
  }

  return (
    <Modal title="New Deal" onClose={onClose} footer={
      <>
        <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-dark btn-sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Create Deal'}
        </button>
      </>
    }>
      <div className="fgroup">
        <label className="flabel">Client *</label>
        <select className="fselect" value={form.client} onChange={e => set('client', e.target.value)}>
          <option value="">Select client…</option>
          {clients.map((c: any) => (
            <option key={c.id} value={c.id}>{c.first_name} {c.last_name} {c.company ? `— ${c.company}` : ''}</option>
          ))}
        </select>
      </div>
      <div className="fgroup">
        <label className="flabel">Starting Stage</label>
        <select className="fselect" value={form.stage} onChange={e => set('stage', e.target.value)}>
          {stages.map((s: any) => <option key={s.slug} value={s.slug}>{s.label}</option>)}
        </select>
      </div>
      <div className="fgroup">
        <label className="flabel">Deal Value ($)</label>
        <input className="finput" type="number" value={form.deal_value} onChange={e => set('deal_value', e.target.value)} placeholder="0.00" />
      </div>
      <div className="fgroup">
        <label className="flabel">Source</label>
        <input className="finput" value={form.source} onChange={e => set('source', e.target.value)} placeholder="Referral, LinkedIn…" />
      </div>
      <div className="fgroup">
        <label className="flabel">Notes</label>
        <textarea className="ftextarea" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>
    </Modal>
  )
}

function DealDetailModal({ deal, stages, onClose, onAdvanced }: any) {
  const qc = useQueryClient()
  const [targetStage, setTargetStage] = useState(deal.stage)
  const [saving, setSaving] = useState(false)

  const handleAdvance = async () => {
    if (targetStage === deal.stage) { onClose(); return }
    setSaving(true)
    try {
      await pipelineApi.advance(deal.id, targetStage)
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      onAdvanced()
    } catch { } finally { setSaving(false) }
  }

  return (
    <Modal
      title={`Deal: ${deal.client_name || deal.client?.first_name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
          <button className="btn btn-dark btn-sm" onClick={handleAdvance} disabled={saving}>
            {saving ? 'Saving…' : 'Update Stage'}
          </button>
        </>
      }
    >
      <div className="kv"><span className="kvl">Client</span><span className="kvv">{deal.client_name || deal.client?.first_name + ' ' + deal.client?.last_name}</span></div>
      <div className="kv">
        <span className="kvl">Value</span>
        <span className="kvv" style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18 }}>
          {deal.deal_value ? `$${Number(deal.deal_value).toLocaleString()}` : '—'}
        </span>
      </div>
      <div className="kv">
        <span className="kvl">Current Stage</span>
        <span className="kvv">{stages.find((s: any) => s.slug === deal.stage)?.label || deal.stage.replace(/_/g, ' ')}</span>
      </div>
      <div className="kv"><span className="kvl">Age</span><span className="kvv">{daysSince(deal.created_at)} days</span></div>
      {deal.notes && <div style={{ marginTop: 12, fontSize: 13, color: '#555', lineHeight: 1.6 }}>{deal.notes}</div>}

      <div style={{ marginTop: 20 }}>
        <label className="flabel">Move to Stage</label>
        <select className="fselect" value={targetStage} onChange={e => setTargetStage(e.target.value)}>
          {stages.map((s: any) => <option key={s.slug} value={s.slug}>{s.label}</option>)}
        </select>
      </div>
    </Modal>
  )
}

export default function Pipeline() {
  const qc = useQueryClient()
  const { show: showToast, el: toastEl } = useToast()
  const [showNew, setShowNew] = useState(false)
  const [selectedDeal, setSelectedDeal] = useState<any>(null)

  const { data: stagesData = [] } = useQuery({
    queryKey: ['pipeline-stage-configs'],
    queryFn: () => settingsApi.getPipelineStages().then(r => r.data),
  })
  const stages: any[] = stagesData as any[]

  const { data: dealsData, isLoading } = useQuery({
    queryKey: ['pipeline'],
    queryFn: () => pipelineApi.deals({ page_size: 200 }).then(r => r.data),
  })
  const deals: any[] = dealsData?.results || dealsData || []

  const handleAdvance = async (id: string, stage: string) => {
    try {
      await pipelineApi.advance(id, stage)
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      const label = stages.find(s => s.slug === stage)?.label || stage
      showToast('Deal moved to ' + label)
    } catch { showToast('Failed to advance deal', 'error') }
  }

  const totalValue = deals
    .filter(d => !['closed_lost', 'on_hold'].includes(d.stage))
    .reduce((s, d) => s + Number(d.deal_value || 0), 0)

  return (
    <AppShell>
      <PageHeader
        title="Pipeline"
        subtitle={`${deals.length} deals · $${totalValue.toLocaleString()} pipeline value`}
        action={<button className="btn btn-dark" onClick={() => setShowNew(true)}>+ New Deal</button>}
      />

      <div style={{ padding: '20px 28px 36px' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading…</div>
        ) : (
          <div className="pipeline-board">
            {stages.map((stage: any) => {
              const stageDeals = deals.filter(d => d.stage === stage.slug)
              return (
                <div key={stage.slug} className="pcol">
                  <div className="pcol-hdr">
                    <span
                      className="pcol-title"
                      style={{ borderBottom: `2px solid ${stage.color}` }}
                    >
                      {stage.label}
                    </span>
                    <span className="pcol-count">{stageDeals.length}</span>
                  </div>
                  {stageDeals.map(deal => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      stages={stages}
                      onAdvance={handleAdvance}
                      onClick={() => setSelectedDeal(deal)}
                    />
                  ))}
                  {stageDeals.length === 0 && (
                    <div style={{
                      padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--muted-faint)',
                      borderTop: '1px dashed var(--border)', letterSpacing: '.06em',
                      textTransform: 'uppercase', fontWeight: 500,
                    }}>
                      No deals
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showNew && (
        <NewDealModal
          stages={stages}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); showToast('Deal created') }}
        />
      )}
      {selectedDeal && (
        <DealDetailModal
          deal={selectedDeal}
          stages={stages}
          onClose={() => setSelectedDeal(null)}
          onAdvanced={() => { setSelectedDeal(null); showToast('Stage updated') }}
        />
      )}
      {toastEl}
    </AppShell>
  )
}
