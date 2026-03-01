import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pipelineApi, clientsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { PageHeader, Modal, useToast } from '../../components/ui'

const STAGES = [
  { key: 'lead_new',             label: 'Lead – New',             cls: '' },
  { key: 'discovery_scheduled',  label: 'Discovery Scheduled',    cls: '' },
  { key: 'discovery_completed',  label: 'Discovery Completed',    cls: '' },
  { key: 'proposal_sent',        label: 'Proposal Sent',          cls: 'hl' },
  { key: 'verbal_yes',           label: 'Verbal Yes',             cls: 'hl' },
  { key: 'active_client',        label: 'Active Client',          cls: 'win' },
  { key: 'on_hold',              label: 'On Hold',                cls: '' },
  { key: 'closed_lost',          label: 'Closed – Lost',          cls: '' },
]

const NEXT_STAGE: Record<string, string> = {
  lead_new: 'discovery_scheduled', discovery_scheduled: 'discovery_completed',
  discovery_completed: 'proposal_sent', proposal_sent: 'verbal_yes',
  verbal_yes: 'active_client',
}

function daysSince(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  return Math.floor(diff / 86400000)
}

function DealCard({ deal, onAdvance, onClick }: { deal: any; onAdvance: (id: string, stage: string) => void; onClick: () => void }) {
  const next = NEXT_STAGE[deal.stage]
  return (
    <div className={`deal-card ${deal.stage === 'lead_new' ? 'new' : deal.stage === 'active_client' ? 'won' : ''}`} onClick={onClick}>
      <div className="deal-name">{deal.client_name || deal.client?.first_name + ' ' + deal.client?.last_name}</div>
      <div className="deal-co">{deal.client?.company || deal.source || ''}</div>
      <div className="deal-foot">
        <div className="deal-val">{deal.deal_value ? `$${Number(deal.deal_value).toLocaleString()}` : '—'}</div>
        <div className="deal-age">{daysSince(deal.created_at)}d</div>
      </div>
      {next && (
        <button
          onClick={e => { e.stopPropagation(); onAdvance(deal.id, next) }}
          className="btn btn-outline btn-sm"
          style={{ width: '100%', marginTop: 10, fontSize: 10 }}
        >
          → Move to {STAGES.find(s => s.key === next)?.label}
        </button>
      )}
    </div>
  )
}

function NewDealModal({ onClose, onSaved }: any) {
  const qc = useQueryClient()
  const { data: clientsData } = useQuery({ queryKey: ['clients-all'], queryFn: () => clientsApi.list({ page_size: 200 }).then(r => r.data) })
  const clients: any[] = clientsData?.results || clientsData || []
  const [form, setForm] = useState({ client: '', deal_value: '', source: '', notes: '' })
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
        <button className="btn btn-dark btn-sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Create Deal'}</button>
      </>
    }>
      <div className="fgroup">
        <label className="flabel">Client *</label>
        <select className="fselect" value={form.client} onChange={e => set('client', e.target.value)}>
          <option value="">Select client…</option>
          {clients.map((c: any) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name} {c.company ? `— ${c.company}` : ''}</option>)}
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

function DealDetailModal({ deal, onClose, onAdvanced }: any) {
  const qc = useQueryClient()
  const { show: showToast } = useToast()
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
    <Modal title={`Deal: ${deal.client_name || deal.client?.first_name}`} onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
          <button className="btn btn-dark btn-sm" onClick={handleAdvance} disabled={saving}>{saving ? 'Saving…' : 'Update Stage'}</button>
        </>
      }>
      <div className="kv"><span className="kvl">Client</span><span className="kvv">{deal.client_name || deal.client?.first_name + ' ' + deal.client?.last_name}</span></div>
      <div className="kv"><span className="kvl">Value</span><span className="kvv" style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18 }}>{deal.deal_value ? `$${Number(deal.deal_value).toLocaleString()}` : '—'}</span></div>
      <div className="kv"><span className="kvl">Current Stage</span><span className="kvv" style={{ textTransform: 'capitalize' }}>{deal.stage.replace(/_/g, ' ')}</span></div>
      <div className="kv"><span className="kvl">Age</span><span className="kvv">{daysSince(deal.created_at)} days</span></div>
      {deal.notes && <div style={{ marginTop: 12, fontSize: 13, color: '#555', lineHeight: 1.6 }}>{deal.notes}</div>}

      <div style={{ marginTop: 20 }}>
        <label className="flabel">Move to Stage</label>
        <select className="fselect" value={targetStage} onChange={e => setTargetStage(e.target.value)}>
          {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
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

  const { data: dealsData, isLoading } = useQuery({
    queryKey: ['pipeline'],
    queryFn: () => pipelineApi.deals({ page_size: 200 }).then(r => r.data),
  })
  const deals: any[] = dealsData?.results || dealsData || []

  const handleAdvance = async (id: string, stage: string) => {
    try {
      await pipelineApi.advance(id, stage)
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      showToast('Deal moved to ' + STAGES.find(s => s.key === stage)?.label)
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

      <div style={{ overflowX: 'auto', padding: '20px 36px 36px' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading…</div>
        ) : (
          <div className="pipeline-board">
            {STAGES.map(stage => {
              const stageDeals = deals.filter(d => d.stage === stage.key)
              return (
                <div key={stage.key} className={`pcol ${stage.cls}`}>
                  <div className="pcol-hdr">
                    <span className="pcol-title">{stage.label}</span>
                    <span className="pcol-count">{stageDeals.length}</span>
                  </div>
                  {stageDeals.map(deal => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      onAdvance={handleAdvance}
                      onClick={() => setSelectedDeal(deal)}
                    />
                  ))}
                  {stageDeals.length === 0 && (
                    <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: 'var(--border)', borderTop: '1px dashed var(--border)' }}>
                      empty
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showNew && <NewDealModal onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); showToast('Deal created') }} />}
      {selectedDeal && <DealDetailModal deal={selectedDeal} onClose={() => setSelectedDeal(null)} onAdvanced={() => { setSelectedDeal(null); showToast('Stage updated') }} />}
      {toastEl}
    </AppShell>
  )
}
