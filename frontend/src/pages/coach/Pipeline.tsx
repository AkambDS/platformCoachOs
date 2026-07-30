import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { pipelineApi, settingsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { Modal, useToast } from '../../components/ui'

function daysSince(d: string) {
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
}
function fmt$(n: number | string | null) {
  if (!n || Number(n) === 0) return '—'
  return '$' + Number(n).toLocaleString('en-US')
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const FIELD_LABELS: Record<string, string> = {
  deal_value: 'Deal Value',
  source:     'Source',
  notes:      'Notes',
  tags:       'Tags',
}

// ── Tag chip ──────────────────────────────────────────────────────────────────
function TagChip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
      background: '#e8f0fe', color: '#1B3A6B', border: '1px solid #c7d5ec',
    }}>
      {label}
      {onRemove && (
        <span onClick={onRemove} style={{ cursor: 'pointer', opacity: .6, lineHeight: 1 }}>×</span>
      )}
    </span>
  )
}


const PRESET_TAGS = [
  'Hot Lead', 'Warm Lead', 'Cold', 'VIP', 'Corporate', 'Individual',
  'Referral', 'High Value', 'Needs Nurturing', 'Follow-up', 'At Risk',
]

// ── Tag selector ─────────────────────────────────────────────────────────────
function TagInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [custom, setCustom] = useState('')

  const toggle = (t: string) =>
    tags.includes(t) ? onChange(tags.filter(x => x !== t)) : onChange([...tags, t])

  const addCustom = () => {
    const t = custom.trim()
    if (t && !tags.includes(t)) onChange([...tags, t])
    setCustom('')
  }

  // All tags to show as chips = presets + any custom ones already added
  const customAdded = tags.filter(t => !PRESET_TAGS.includes(t))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {PRESET_TAGS.map(t => {
          const active = tags.includes(t)
          return (
            <button key={t} type="button" onClick={() => toggle(t)} style={{
              padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
              border: active ? '1.5px solid #1B3A6B' : '1.5px solid #d5cfc9',
              background: active ? '#1B3A6B' : '#faf9f7',
              color: active ? '#fff' : '#555', transition: 'all .12s',
            }}>{t}</button>
          )
        })}
        {customAdded.map(t => (
          <button key={t} type="button" onClick={() => toggle(t)} style={{
            padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
            border: '1.5px solid #1B3A6B', background: '#1B3A6B', color: '#fff',
          }}>{t} ×</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          className="finput" style={{ flex: 1, fontSize: 12 }}
          placeholder="Add custom tag…"
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
        />
        <button type="button" className="btn btn-outline btn-sm" onClick={addCustom}>Add</button>
      </div>
    </div>
  )
}

// ── Deal Card ─────────────────────────────────────────────────────────────────
function DealCard({ deal, stageColor, followUpDays, isActive, onClick }: {
  deal: any; stageColor: string; followUpDays: number; isActive: boolean; onClick: () => void
}) {
  const daysInStage = daysSince(deal.stage_changed_at || deal.created_at)
  const isOverdue   = !isActive && daysInStage >= followUpDays && followUpDays > 0
  const tags: string[] = deal.tags || []

  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff', border: '1px solid #e8e5df', borderLeft: `3px solid ${stageColor}`,
        borderRadius: 8, padding: '14px 16px', cursor: 'pointer',
        transition: 'box-shadow .15s, transform .1s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 3px 12px rgba(0,0,0,.1)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = ''; (e.currentTarget as HTMLElement).style.transform = '' }}
    >
      <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 17, fontWeight: 600, color: '#1a1714', lineHeight: 1.2, marginBottom: 4 }}>
        {deal.client_name}
      </div>
      {deal.client_company && (
        <div style={{ fontSize: 12, color: '#9e9890', marginBottom: 8 }}>{deal.client_company}</div>
      )}
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {tags.map(t => <TagChip key={t} label={t} />)}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 18, fontWeight: 700, color: '#1a1714' }}>
          {fmt$(deal.deal_value)}
        </span>
        {isActive ? (
          <span style={{ fontSize: 11, color: '#9e9890', fontWeight: 500 }}>Active</span>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span title={followUpDays > 0 ? `${daysInStage}d in stage · follow-up after ${followUpDays}d` : `${daysInStage}d in stage`}
              style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
                background: isOverdue ? '#fef3cd' : '#f0ece8', color: isOverdue ? '#92400e' : '#9e9890' }}>
              {daysInStage}d
            </span>
            {deal.source && <span style={{ fontSize: 11, color: '#9e9890' }}>· {deal.source}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Deal Detail Modal ─────────────────────────────────────────────────────────
function DealDetailModal({ deal: initialDeal, stages, onClose, onAdvanced }: any) {
  const qc = useQueryClient()

  const { data: freshData } = useQuery({
    queryKey: ['pipeline-deal', initialDeal.id],
    queryFn: () => pipelineApi.deals({ page_size: 500 }).then(r => {
      const list = r.data?.results || r.data || []
      return list.find((d: any) => d.id === initialDeal.id) || initialDeal
    }),
    initialData: initialDeal,
  })
  const deal = freshData || initialDeal

  const [editing, setEditing]         = useState(false)
  const [targetStage, setTargetStage] = useState(deal.stage)
  const [saving, setSaving]           = useState(false)
  const [draft, setDraft]             = useState({
    deal_value: deal.deal_value ? String(deal.deal_value) : '',
    source:     deal.source || '',
    notes:      deal.notes  || '',
    tags:       (deal.tags  || []) as string[],
  })

  const currentStage = stages.find((s: any) => s.slug === deal.stage)
  const targetStageObj = stages.find((s: any) => s.slug === targetStage)
  const daysInStage  = daysSince(deal.stage_changed_at || deal.created_at)
  const stageColor   = currentStage?.color || '#1B3A6B'
  const isMoving     = targetStage !== deal.stage

  const handleAdvance = async () => {
    if (!isMoving) { onClose(); return }
    setSaving(true)
    try {
      await pipelineApi.advance(deal.id, targetStage)
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      qc.invalidateQueries({ queryKey: ['pipeline-deal', deal.id] })
      onAdvanced()
    } catch { } finally { setSaving(false) }
  }

  const handleSaveEdit = async () => {
    setSaving(true)
    try {
      await pipelineApi.patch(deal.id, {
        deal_value: draft.deal_value ? Number(draft.deal_value) : null,
        source:     draft.source,
        notes:      draft.notes,
        tags:       draft.tags,
      })
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      qc.invalidateQueries({ queryKey: ['pipeline-deal', deal.id] })
      setEditing(false)
    } catch { } finally { setSaving(false) }
  }

  const progressLog: any[]  = deal.progress_log || []
  const stageHistory: any[] = deal.stage_history || []
  const timeline = [
    ...stageHistory.map((h: any) => ({ ...h, _type: 'stage' })),
    ...progressLog.map((p: any) => ({ ...p, _type: 'edit' })),
  ].sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime())

  return (
    <Modal
      title=""
      size="lg"
      onClose={onClose}
      footer={
        editing ? (
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn btn-dark btn-sm" onClick={handleSaveEdit} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit</button>
            <button
              className="btn btn-sm"
              onClick={handleAdvance}
              disabled={saving}
              style={{
                background: isMoving ? (targetStageObj?.color || 'var(--ink)') : '#e8e5df',
                color: isMoving ? '#fff' : 'var(--muted)',
                border: 'none', borderRadius: 6, padding: '7px 18px',
                fontWeight: 700, fontSize: 12, letterSpacing: '.06em', cursor: isMoving ? 'pointer' : 'default',
                transition: 'all .15s',
              }}
            >
              {saving ? 'Moving…' : isMoving ? `Move to ${targetStageObj?.label} →` : 'No Stage Change'}
            </button>
          </>
        )
      }
    >
      {/* ── Coloured identity header ── */}
      <div style={{
        margin: '-24px -24px 20px',
        background: `linear-gradient(135deg, ${stageColor}18 0%, ${stageColor}08 100%)`,
        borderBottom: `3px solid ${stageColor}`,
        padding: '20px 24px 18px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 26, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.1 }}>
              {deal.client_name}
            </div>
            {deal.client_company && (
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{deal.client_company}</div>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 32, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>
              {editing
                ? <input className="finput" type="number" value={draft.deal_value}
                    onChange={e => setDraft(d => ({ ...d, deal_value: e.target.value }))}
                    placeholder="0.00" style={{ width: 140, textAlign: 'right', fontSize: 18 }} />
                : fmt$(deal.deal_value)
              }
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, letterSpacing: '.06em' }}>DEAL VALUE</div>
          </div>
        </div>

        {/* Stage + days pills */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: stageColor, color: '#fff',
            padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: '.06em',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,.6)', display: 'inline-block' }} />
            {currentStage?.label || deal.stage}
          </span>
          <span style={{
            display: 'inline-flex', alignItems: 'center',
            background: '#fff', border: '1px solid var(--border)',
            padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, color: 'var(--muted)',
          }}>
            {daysInStage}d in stage
          </span>
          {deal.source && (
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              background: '#fff', border: '1px solid var(--border)',
              padding: '4px 12px', borderRadius: 20, fontSize: 11, color: 'var(--muted)',
            }}>
              via {deal.source}
            </span>
          )}
        </div>
      </div>

      {/* ── Two-column body ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 24, alignItems: 'start' }}>

        {/* LEFT: tags + source (edit) + notes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Tags */}
          <div>
            <div style={{ fontSize: 10, letterSpacing: '.1em', fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>TAGS</div>
            {editing ? (
              <TagInput tags={draft.tags} onChange={t => setDraft(d => ({ ...d, tags: t }))} />
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(deal.tags || []).length === 0
                  ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>No tags</span>
                  : (deal.tags || []).map((t: string) => <TagChip key={t} label={t} />)
                }
              </div>
            )}
          </div>

          {/* Source (edit only) */}
          {editing && (
            <div>
              <div style={{ fontSize: 10, letterSpacing: '.1em', fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>SOURCE</div>
              <input className="finput" value={draft.source}
                onChange={e => setDraft(d => ({ ...d, source: e.target.value }))}
                placeholder="Referral, LinkedIn, Website…" />
            </div>
          )}

          {/* Notes */}
          <div>
            <div style={{ fontSize: 10, letterSpacing: '.1em', fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>NOTES</div>
            {editing ? (
              <textarea className="ftextarea" rows={4} value={draft.notes}
                onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} />
            ) : deal.notes ? (
              <div style={{
                fontSize: 13, color: 'var(--ink)', lineHeight: 1.7,
                background: '#faf9f7', border: '1px solid var(--border)',
                padding: '12px 16px', borderRadius: 8, whiteSpace: 'pre-wrap',
              }}>
                {deal.notes}
              </div>
            ) : (
              <div style={{
                fontSize: 12, color: 'var(--muted)', fontStyle: 'italic',
                padding: '10px 14px', background: '#faf9f7', borderRadius: 6,
                border: '1px dashed var(--border)',
              }}>
                No notes — click Edit to add context.
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: stage mover */}
        {!editing && (
          <div>
            <div style={{ fontSize: 10, letterSpacing: '.1em', fontWeight: 700, color: 'var(--muted)', marginBottom: 10 }}>MOVE TO STAGE</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {stages.map((s: any) => {
                const isCurrent  = s.slug === deal.stage
                const isSelected = s.slug === targetStage
                return (
                  <button
                    key={s.slug}
                    type="button"
                    onClick={() => setTargetStage(s.slug)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 10px', borderRadius: 7, cursor: 'pointer',
                      fontFamily: 'inherit', fontSize: 12, textAlign: 'left',
                      border: isSelected ? `1.5px solid ${s.color}` : '1.5px solid var(--border)',
                      background: isSelected ? s.color + '12' : 'var(--paper)',
                      color: isSelected ? s.color : isCurrent ? 'var(--ink)' : 'var(--muted)',
                      fontWeight: isSelected || isCurrent ? 600 : 400,
                      transition: 'all .12s',
                    }}
                  >
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                      background: isSelected ? s.color : isCurrent ? s.color + '80' : '#d8d4ce',
                    }} />
                    {s.label}
                    {isCurrent && !isSelected && (
                      <span style={{ marginLeft: 'auto', fontSize: 9, letterSpacing: '.05em', color: 'var(--muted)', fontWeight: 400 }}>NOW</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Timeline ── */}
      {timeline.length > 0 && (
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, letterSpacing: '.1em', fontWeight: 700, color: 'var(--muted)', marginBottom: 14 }}>DEAL HISTORY</div>
          <div style={{ position: 'relative', paddingLeft: 20 }}>
            {/* vertical line */}
            <div style={{
              position: 'absolute', left: 3, top: 6, bottom: 6,
              width: 1, background: 'linear-gradient(to bottom, var(--border), transparent)',
            }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {timeline.map((entry: any, i: number) => {
                const isStage = entry._type === 'stage'
                const dotColor = isStage ? (stageColor) : '#d97706'
                return (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', position: 'relative' }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%', marginTop: 3, flexShrink: 0,
                      background: dotColor, marginLeft: -20,
                      boxShadow: `0 0 0 2px white, 0 0 0 3px ${dotColor}44`,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {isStage ? (
                        <div style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 500 }}>
                          {entry.from_stage
                            ? <><span style={{ color: 'var(--muted)', fontWeight: 400 }}>{entry.from_stage.replace(/_/g, ' ')}</span>{' → '}<span style={{ color: stageColor }}>{entry.to_stage.replace(/_/g, ' ')}</span></>
                            : <>Created in <span style={{ color: stageColor }}>{entry.to_stage.replace(/_/g, ' ')}</span></>
                          }
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: 'var(--ink)' }}>
                          <span style={{ fontWeight: 600, color: '#d97706' }}>{FIELD_LABELS[entry.field_name] || entry.field_name}</span>
                          {' '}updated
                          {entry.old_value && entry.old_value !== '[]' && entry.old_value !== 'None' && (
                            <span style={{ color: 'var(--muted)' }}> from "{entry.old_value}"</span>
                          )}
                          {entry.new_value && entry.new_value !== '[]' && entry.new_value !== 'None' && (
                            <span style={{ color: 'var(--ink)' }}> → "{entry.new_value}"</span>
                          )}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {entry.changed_by_name && <span style={{ fontWeight: 500 }}>{entry.changed_by_name}</span>}
                        {entry.changed_by_name && ' · '}
                        {fmtDate(entry.changed_at)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function Pipeline() {
  const navigate = useNavigate()
  const { show: showToast, el: toastEl } = useToast()
  const [selectedDeal, setSelectedDeal] = useState<any>(null)
  const [viewMode,     setViewMode]     = useState<'board' | 'list'>('board')
  const [sortField,    setSortField]    = useState<string>('client_name')
  const [sortDir,      setSortDir]      = useState<'asc' | 'desc'>('asc')

  const { data: stagesData = [] } = useQuery({
    queryKey: ['pipeline-stage-configs'],
    queryFn: () => settingsApi.getPipelineStages().then(r => r.data),
  })
  const stages: any[] = stagesData as any[]

  const { data: dealsData, isLoading } = useQuery({
    queryKey: ['pipeline'],
    queryFn: () => pipelineApi.deals({ page_size: 500 }).then(r => r.data),
  })
  const deals: any[] = dealsData?.results || dealsData || []

  const totalValue = deals.reduce((s, d) => s + Number(d.deal_value || 0), 0)
  const stageMap: Record<string, any> = {}
  stages.forEach(s => { stageMap[s.slug] = s })

  const sortedDeals = [...deals].sort((a, b) => {
    let av: any = a[sortField] ?? ''
    let bv: any = b[sortField] ?? ''
    if (sortField === 'deal_value') { av = Number(av); bv = Number(bv) }
    if (sortField === 'days') {
      av = daysSince(a.stage_changed_at || a.created_at)
      bv = daysSince(b.stage_changed_at || b.created_at)
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })
  const toggleSort = (f: string) => {
    if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(f); setSortDir('asc') }
  }
  const sortIcon = (f: string) => sortField === f ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  return (
    <AppShell>
      <style>{`
        .pipeline-board::-webkit-scrollbar { height: 8px; }
        .pipeline-board::-webkit-scrollbar-track { background: #ede9e3; border-radius: 4px; }
        .pipeline-board::-webkit-scrollbar-thumb { background: #c5bfb5; border-radius: 4px; }
        .pipeline-board::-webkit-scrollbar-thumb:hover { background: #a09890; }
        .pl-th { cursor: pointer; user-select: none; white-space: nowrap; padding: 10px 14px; font-size: 11px; font-weight: 700; letter-spacing: .07em; color: var(--muted); text-align: left; border-bottom: 1px solid var(--border); }
        .pl-th:hover { color: var(--ink); }
        .pl-td { padding: 12px 14px; font-size: 13px; color: var(--ink); border-bottom: 1px solid #f0ece8; vertical-align: middle; }
        .pl-tr:hover td { background: #faf9f7; cursor: pointer; }
      `}</style>

      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        padding: '24px 32px 20px', borderBottom: '1px solid var(--border)', background: '#f7f4ef',
      }}>
        <div>
          <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 400, margin: 0, color: 'var(--ink)' }}>
            Pipeline
          </h1>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            {stages.length} stages · {deals.length} deal{deals.length !== 1 ? 's' : ''} · {fmt$(totalValue)} total pipeline
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', fontSize: 12, fontWeight: 600 }}>
            {(['board', 'list'] as const).map(v => (
              <button key={v} onClick={() => setViewMode(v)} style={{
                padding: '7px 14px', border: 'none', cursor: 'pointer',
                background: viewMode === v ? 'var(--ink)' : 'var(--paper)',
                color: viewMode === v ? '#fff' : 'var(--muted)', letterSpacing: '.06em',
              }}>
                {v === 'board' ? '⊞ BOARD' : '≡ LIST'}
              </button>
            ))}
          </div>
          <button onClick={() => navigate('/pipeline/new')} style={{
            padding: '9px 20px', background: 'var(--ink)', color: '#fff',
            border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: '.08em',
          }}>
            + ADD CONTRACT
          </button>
        </div>
      </div>

      {/* Board View */}
      {isLoading ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
      ) : viewMode === 'board' ? (
        <div className="pipeline-board" style={{
          overflowX: 'auto', overflowY: 'visible', padding: '24px 28px 32px',
          background: '#f5f4f1', minHeight: 'calc(100vh - 120px)',
        }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', minWidth: 'max-content' }}>
            {stages.map((stage: any) => {
              const stageDeals   = deals.filter(d => d.stage === stage.slug)
              const stageColor   = stage.color || '#1a2f4e'
              const followUpDays = stage.follow_up_days || 0
              const isActive     = stage.slug === 'active_client'
              const colValue     = stageDeals.reduce((s, d) => s + Number(d.deal_value || 0), 0)
              return (
                <div key={stage.slug} style={{ width: 240, flexShrink: 0 }}>
                  <div style={{ paddingBottom: 10, marginBottom: 12, borderBottom: `2.5px solid ${stageColor}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'var(--ink)', textTransform: 'uppercase' }}>
                        {stage.label}
                      </span>
                      <span style={{
                        fontSize: 11, fontWeight: 700, borderRadius: 10, padding: '2px 8px',
                        background: stageDeals.length > 0 ? '#e8e5df' : '#f0ece8',
                        color: stageDeals.length > 0 ? 'var(--ink)' : 'var(--muted)',
                      }}>
                        {stageDeals.length}
                      </span>
                    </div>
                    {colValue > 0 && (
                      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 15, fontWeight: 600, color: '#5a5248', marginTop: 4 }}>
                        {fmt$(colValue)}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {stageDeals.map(deal => (
                      <DealCard key={deal.id} deal={deal} stageColor={stageColor}
                        followUpDays={followUpDays} isActive={isActive} onClick={() => setSelectedDeal(deal)} />
                    ))}
                    {stageDeals.length === 0 && (
                      <div style={{ height: 80, border: '1.5px dashed #d8d4ce', borderRadius: 8,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, color: '#c8c4be', letterSpacing: '.04em' }}>
                        0 deals
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /* List View */
        <div style={{ padding: '24px 32px', background: '#f5f4f1', minHeight: 'calc(100vh - 120px)' }}>
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th className="pl-th" onClick={() => toggleSort('client_name')}>CLIENT{sortIcon('client_name')}</th>
                  <th className="pl-th" onClick={() => toggleSort('client_company')}>COMPANY{sortIcon('client_company')}</th>
                  <th className="pl-th" onClick={() => toggleSort('stage')}>STAGE{sortIcon('stage')}</th>
                  <th className="pl-th">TAGS</th>
                  <th className="pl-th" onClick={() => toggleSort('deal_value')} style={{ textAlign: 'right' }}>VALUE{sortIcon('deal_value')}</th>
                  <th className="pl-th" onClick={() => toggleSort('days')} style={{ textAlign: 'center' }}>DAYS{sortIcon('days')}</th>
                  <th className="pl-th" onClick={() => toggleSort('source')}>SOURCE{sortIcon('source')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedDeals.map(deal => {
                  const st = stageMap[deal.stage]
                  const daysInStage = daysSince(deal.stage_changed_at || deal.created_at)
                  const followUpDays = st?.follow_up_days || 0
                  const isOverdue = daysInStage >= followUpDays && followUpDays > 0
                  const tags: string[] = deal.tags || []
                  return (
                    <tr key={deal.id} className="pl-tr" onClick={() => setSelectedDeal(deal)}>
                      <td className="pl-td">
                        <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 15, fontWeight: 600 }}>{deal.client_name}</span>
                      </td>
                      <td className="pl-td" style={{ color: 'var(--muted)', fontSize: 12 }}>{deal.client_company || '—'}</td>
                      <td className="pl-td">
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 10,
                          background: st?.color ? st.color + '22' : '#e8e5df', color: st?.color || 'var(--ink)',
                          border: `1px solid ${st?.color || '#d8d4ce'}44` }}>
                          {st?.label || deal.stage}
                        </span>
                      </td>
                      <td className="pl-td">
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {tags.map(t => <TagChip key={t} label={t} />)}
                        </div>
                      </td>
                      <td className="pl-td" style={{ textAlign: 'right', fontFamily: 'Cormorant Garamond, serif', fontSize: 15, fontWeight: 700 }}>
                        {fmt$(deal.deal_value)}
                      </td>
                      <td className="pl-td" style={{ textAlign: 'center' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
                          background: isOverdue ? '#fef3cd' : '#f0ece8', color: isOverdue ? '#92400e' : '#9e9890' }}>
                          {daysInStage}d
                        </span>
                      </td>
                      <td className="pl-td" style={{ color: 'var(--muted)', fontSize: 12 }}>{deal.source || '—'}</td>
                    </tr>
                  )
                })}
                {sortedDeals.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No deals yet</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr style={{ background: '#faf9f7' }}>
                  <td className="pl-td" colSpan={4} style={{ fontWeight: 700, fontSize: 12, letterSpacing: '.06em', color: 'var(--muted)' }}>
                    TOTAL · {deals.length} deals
                  </td>
                  <td className="pl-td" style={{ textAlign: 'right', fontFamily: 'Cormorant Garamond, serif', fontSize: 16, fontWeight: 700 }}>
                    {fmt$(totalValue)}
                  </td>
                  <td className="pl-td" colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {!isLoading && viewMode === 'board' && (
        <div style={{ padding: '10px 32px', fontSize: 12, color: 'var(--muted)', borderTop: '1px solid var(--border)', background: 'var(--paper)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--gold)' }}>⚑</span>
          Click a card to view details, edit fields, or move to a different stage.
        </div>
      )}

      {selectedDeal && (
        <DealDetailModal deal={selectedDeal} stages={stages}
          onClose={() => setSelectedDeal(null)}
          onAdvanced={() => { setSelectedDeal(null); showToast('Stage updated') }} />
      )}
      {toastEl}
    </AppShell>
  )
}
