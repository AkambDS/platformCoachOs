import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { clientsApi, activitiesApi, invoicesApi, settingsApi, pipelineApi, authApi, libraryApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { Modal, StatusBadge, useToast, EmptyState } from '../../components/ui'
import { useAuthStore } from '../../store/auth'

const GOAL_STATUSES  = ['active','completed','paused']

type Client = {
  id?: string
  first_name: string
  last_name: string
  job_title?: string
  company?: string
  email: string
  phone?: string
  active_flag: boolean
  portal_access: boolean
  lead_source?: string
  birth_date?: string
  notes?: string
  tags?: string[]
  [key: string]: any
}

function initials(name: string) {
  return name?.split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase() || '?'
}

function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtDatetime(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ── New Activity Modal ────────────────────────────────────────────────────────
function NewActivityModal({ clientId, defaultCoachId, onClose, onSaved }: any) {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const { data: activityTypes = [] } = useQuery({
    queryKey: ['activity-type-configs'],
    queryFn: () => settingsApi.getActivityTypes().then(r => r.data),
    select: (d: any[]) => d.filter((t: any) => t.is_active),
  })
  const { data: teamData } = useQuery({
    queryKey: ['team'],
    queryFn: () => authApi.team().then(r => r.data),
  })
  const teamMembers: any[] = teamData?.results || teamData || []
  const coaches = teamMembers.filter((m: any) => ['coach', 'business_owner'].includes(m.role))

  const [coachId, setCoachId] = useState(defaultCoachId || user?.id || '')
  const [form, setForm] = useState({ activity_type: 'session', title: '', location: '', notes: '' })
  const [date, setDate]           = useState('')
  const [startTime, setStartTime] = useState('')
  const [endDate, setEndDate]     = useState('')
  const [endTime, setEndTime]     = useState('')
  const [repeat, setRepeat]       = useState<'none'|'daily'|'weekly'|'biweekly'|'monthly'|'yearly'>('none')
  const [repeatEnd, setRepeatEnd] = useState<'never'|'date'>('never')
  const [repeatUntil, setRepeatUntil] = useState('')
  const [sendConfirmation, setSendConfirmation] = useState(true)
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const toUTC = (local: string) => local ? new Date(local).toISOString() : local

  const addOneHour = (time: string) => {
    const [h, m] = time.split(':').map(Number)
    const next = new Date(2000, 0, 1, h + 1, m)
    return `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`
  }

  const handleSave = async () => {
    const start_at = date && startTime ? `${date}T${startTime}` : ''
    const resolvedEnd = endTime || (startTime ? addOneHour(startTime) : '')
    const resolvedEndDate = endDate || date
    const end_at = resolvedEndDate && resolvedEnd ? `${resolvedEndDate}T${resolvedEnd}` : ''
    if (!form.title || !start_at) return
    setSaving(true)
    const payload: any = { ...form, client: clientId, coach: coachId || undefined, start_at: toUTC(start_at), end_at: toUTC(end_at), send_confirmation: sendConfirmation }
    if (repeat !== 'none') {
      payload.repeat = repeat
      payload.repeat_until = (repeatEnd === 'date' && repeatUntil) ? repeatUntil : null
    }
    try {
      await activitiesApi.create(payload)
      qc.invalidateQueries({ queryKey: ['client-activities', clientId] })
      qc.invalidateQueries({ queryKey: ['activities'] })
      onSaved(sendConfirmation)
    } catch (err: any) {
      const detail = err?.response?.data
      alert(typeof detail === 'string' ? detail : detail ? Object.values(detail).flat().join(' ') : 'Failed to save')
    } finally { setSaving(false) }
  }

  return (
    <Modal title="Schedule Activity" onClose={onClose} footer={
      <>
        <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-dark btn-sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Schedule'}</button>
      </>
    }>
      {/* Type + Coach */}
      <div className="fgrid">
        <div className="fgroup">
          <label className="flabel">Type</label>
          <select className="fselect" value={form.activity_type} onChange={e => set('activity_type', e.target.value)}>
            {(activityTypes as any[]).map((t: any) => (
              <option key={t.name} value={t.name}>{t.name.charAt(0).toUpperCase() + t.name.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="fgroup">
          <label className="flabel">Coach</label>
          <select className="fselect" value={coachId} onChange={e => setCoachId(e.target.value)}>
            <option value="">— Auto (from client) —</option>
            {coaches.map((c: any) => (
              <option key={c.id} value={c.id}>{c.full_name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Title */}
      <div className="fgroup">
        <label className="flabel">Title *</label>
        <input className="finput" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Weekly coaching session" />
      </div>

      {/* Start date + time */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
        <div className="fgroup" style={{ flex: 1, marginBottom: 0 }}>
          <label className="flabel">Start Date *</label>
          <input className="finput" type="date" value={date}
            onChange={e => { setDate(e.target.value); if (!endDate || endDate < e.target.value) setEndDate(e.target.value) }} />
        </div>
        <div className="fgroup" style={{ flex: 1, marginBottom: 0 }}>
          <label className="flabel">Start Time *</label>
          <input className="finput" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
        </div>
      </div>

      {/* End date + time */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 10 }}>
        <div className="fgroup" style={{ flex: 1, marginBottom: 0 }}>
          <label className="flabel">End Date</label>
          <input className="finput" type="date" value={endDate} min={date} onChange={e => setEndDate(e.target.value)} />
        </div>
        <div className="fgroup" style={{ flex: 1, marginBottom: 0 }}>
          <label className="flabel">End Time</label>
          <input className="finput" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
        </div>
      </div>

      {/* Location */}
      <div className="fgroup" style={{ marginTop: 10 }}>
        <label className="flabel">Location / Link</label>
        <input className="finput" value={form.location} onChange={e => set('location', e.target.value)} placeholder="Zoom link, office address…" />
      </div>

      {/* Notes */}
      <div className="fgroup">
        <label className="flabel">Notes (internal)</label>
        <textarea className="ftextarea" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>

      {/* Repeat */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label className="flabel" style={{ marginBottom: 0, minWidth: 90 }}>REPEAT</label>
          <select className="fselect" value={repeat}
            onChange={e => { setRepeat(e.target.value as any); setRepeatEnd('never'); setRepeatUntil('') }}
            style={{ marginBottom: 0, flex: 1 }}>
            <option value="none">Does not repeat</option>
            <option value="daily">Every Day</option>
            <option value="weekly">Every Week</option>
            <option value="biweekly">Every Two Weeks</option>
            <option value="monthly">Every Month</option>
            <option value="yearly">Every Year</option>
          </select>
        </div>
        {repeat !== 'none' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label className="flabel" style={{ marginBottom: 0, minWidth: 90 }}>END REPEAT</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1 }}>
              {(['never', 'date'] as const).map(opt => (
                <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--ink)' }}>
                  <input type="radio" name="cd_repeat_end" checked={repeatEnd === opt} onChange={() => setRepeatEnd(opt)}
                    style={{ accentColor: 'var(--gold)', width: 14, height: 14 }} />
                  {opt === 'never' ? 'Never' : 'On Date'}
                </label>
              ))}
              {repeatEnd === 'date' && (
                <input className="finput" type="date" value={repeatUntil}
                  onChange={e => setRepeatUntil(e.target.value)}
                  min={date || undefined}
                  style={{ marginBottom: 0, flex: 1 }} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Confirmation */}
      <div style={{ marginTop: 4, padding: '12px 14px', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input id="cd_send_conf" type="checkbox" checked={sendConfirmation}
            onChange={e => setSendConfirmation(e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--gold)', flexShrink: 0 }} />
          <label htmlFor="cd_send_conf" style={{ fontSize: 13, cursor: 'pointer', lineHeight: 1.4 }}>
            <span style={{ fontWeight: 500, color: 'var(--ink)' }}>Send booking confirmation email now</span>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>Includes a calendar invite (.ics) for the client.</span>
          </label>
        </div>
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
          <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 14, lineHeight: 1 }}>✓</span>
          <span>Automatic reminders will be sent to the client <strong style={{ color: 'var(--ink)' }}>24 hours</strong> and <strong style={{ color: 'var(--ink)' }}>1 hour</strong> before the session.</span>
        </div>
      </div>
    </Modal>
  )
}

// ── Goal Modal (create + edit) ─────────────────────────────────────────────────
function GoalModal({ clientId, goal, onClose, onSaved }: any) {
  const qc = useQueryClient()
  const isEdit = !!goal
  const [form, setForm] = useState({
    title:       goal?.title       || '',
    description: goal?.description || '',
    target_date: goal?.target_date ? goal.target_date.slice(0, 10) : '',
    status:      goal?.status      || 'active',
  })
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.title) return
    setSaving(true)
    try {
      if (isEdit) {
        await clientsApi.updateGoal(clientId, goal.id, form)
      } else {
        await clientsApi.createGoal(clientId, form)
      }
      qc.invalidateQueries({ queryKey: ['client-goals', clientId] })
      onSaved()
    } catch { } finally { setSaving(false) }
  }

  return (
    <Modal title={isEdit ? 'Edit Goal' : 'New Goal'} onClose={onClose} footer={
      <>
        <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-dark btn-sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Goal'}
        </button>
      </>
    }>
      <div className="fgroup">
        <label className="flabel">Goal Title</label>
        <input className="finput" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Improve executive presence" />
      </div>
      <div className="fgroup">
        <label className="flabel">Description</label>
        <textarea className="ftextarea" rows={3} value={form.description} onChange={e => set('description', e.target.value)} />
      </div>
      <div className="fgrid">
        <div className="fgroup">
          <label className="flabel">Target Date</label>
          <input className="finput" type="date" value={form.target_date} onChange={e => set('target_date', e.target.value)} />
        </div>
        <div className="fgroup">
          <label className="flabel">Status</label>
          <select className="fselect" value={form.status} onChange={e => set('status', e.target.value)}>
            {GOAL_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  )
}

// ── NoteTypeSelector — defined outside NoteLog so its reference is stable ────
function NoteTypeSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {NOTE_TYPES.map(nt => (
        <button key={nt.value} onClick={() => onChange(nt.value)} style={{
          padding: '5px 14px', fontSize: 12, fontWeight: 400, cursor: 'pointer',
          border: '1px solid var(--border)',
          background: value === nt.value ? 'var(--ink)' : 'var(--white)',
          color: value === nt.value ? 'var(--paper)' : 'var(--ink)',
          fontFamily: "'DM Sans', sans-serif",
        }}>{nt.label}</button>
      ))}
    </div>
  )
}

// ── NoteLog ───────────────────────────────────────────────────────────────────
const COLLAPSE_CHARS = 220

function fmtNoteDate(iso: string, tz?: string): string {
  if (!iso) return '—'
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    ...(tz ? { timeZone: tz } : {}),
  }
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffH  = diffMs / 3_600_000
  const diffD  = diffMs / 86_400_000

  if (diffH < 1)  return 'Just now'
  if (diffH < 24) return `Today at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', ...(tz ? { timeZone: tz } : {}) })}`
  if (diffD < 2)  return `Yesterday at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', ...(tz ? { timeZone: tz } : {}) })}`
  return d.toLocaleString('en-US', opts)
}

function wasEdited(created: string, updated: string): boolean {
  return Math.abs(new Date(updated).getTime() - new Date(created).getTime()) > 60_000
}

const STRUCTURED_PREFIX = '##STRUCTURED##'
const emptyStruct = () => ({ notes: '', reflection: '', commitment: '' })

function parseStructured(text: string): { notes: string; reflection: string; commitment: string } | null {
  if (!text.startsWith(STRUCTURED_PREFIX)) return null
  try { return JSON.parse(text.slice(STRUCTURED_PREFIX.length)) } catch { return null }
}

function StructuredForm({ value, onChange }: { value: { notes: string; reflection: string; commitment: string }; onChange: (v: any) => void }) {
  const s = (k: string, v: string) => onChange({ ...value, [k]: v })
  const sections = [
    { key: 'notes',      label: 'Session Notes',     placeholder: 'What happened in this session…' },
    { key: 'reflection', label: 'Coach Reflection',  placeholder: 'Your observations and reflections…' },
    { key: 'commitment', label: 'Commitment',        placeholder: 'What did the client commit to…' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
      {sections.map(sec => (
        <div key={sec.key}>
          <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
            {sec.label}
          </label>
          <textarea className="ftextarea" rows={3} style={{ fontSize: 13, lineHeight: 1.7 }}
            value={(value as any)[sec.key]} placeholder={sec.placeholder}
            onChange={e => s(sec.key, e.target.value)} />
        </div>
      ))}
    </div>
  )
}

function StructuredDisplay({ data }: { data: { notes: string; reflection: string; commitment: string } }) {
  const sections = [
    { key: 'notes',      label: 'Session Notes' },
    { key: 'reflection', label: 'Coach Reflection' },
    { key: 'commitment', label: 'Commitment' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {sections.map(sec => {
        const text = (data as any)[sec.key]
        if (!text?.trim()) return null
        return (
          <div key={sec.key}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>
              {sec.label}
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--ink)', whiteSpace: 'pre-wrap', margin: 0 }}>{text}</p>
          </div>
        )
      })}
    </div>
  )
}

function NoteLog({ clientId, clientName, noteList, refetch, showToast, tz }: { clientId: string; clientName?: string; noteList: any[]; refetch: () => Promise<any>; showToast: any; tz?: string }) {
  const [adding, setAdding]     = useState(false)
  const [saving, setSaving]     = useState(false)
  const [noteType, setNoteType] = useState('session')
  const [noteText, setNoteText] = useState('')
  const [struct, setStruct]     = useState(emptyStruct())

  const [expanded, setExpanded]     = useState<Set<string>>(new Set())
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [editType, setEditType]     = useState('session')
  const [editText, setEditText]     = useState('')
  const [editStruct, setEditStruct] = useState(emptyStruct())
  const [editSaving, setEditSaving] = useState(false)
  const [exporting, setExporting]   = useState(false)

  const toggle = (id: string) =>
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  const startEdit = (n: any) => {
    setEditingId(n.id); setEditType(n.note_type)
    const parsed = parseStructured(n.text)
    if (parsed) { setEditStruct(parsed); setEditText('') }
    else { setEditText(n.text); setEditStruct(emptyStruct()) }
  }
  const cancelEdit = () => { setEditingId(null); setEditText(''); setEditType('session'); setEditStruct(emptyStruct()) }

  const buildText = (type: string, text: string, s: typeof struct) =>
    type === 'session' ? STRUCTURED_PREFIX + JSON.stringify(s) : text

  const handleAdd = async () => {
    const text = buildText(noteType, noteText, struct)
    if (noteType === 'session' && !struct.notes.trim() && !struct.reflection.trim() && !struct.commitment.trim()) return
    if (noteType !== 'session' && !noteText.trim()) return
    setSaving(true)
    try {
      await clientsApi.createNote(clientId, { text, note_type: noteType })
      await refetch()
      setNoteText(''); setStruct(emptyStruct()); setNoteType('session'); setAdding(false)
      showToast('Note added')
    } catch { showToast('Failed to save note', 'error') }
    finally { setSaving(false) }
  }

  const handleSaveEdit = async (nid: string) => {
    const text = buildText(editType, editText, editStruct)
    setEditSaving(true)
    try {
      await clientsApi.updateNote(clientId, nid, { text, note_type: editType })
      await refetch(); cancelEdit()
      showToast('Note updated')
    } catch { showToast('Failed to update', 'error') }
    finally { setEditSaving(false) }
  }

  const handleDelete = async (nid: string) => {
    try {
      await clientsApi.deleteNote(clientId, nid); await refetch()
      showToast('Note deleted')
    } catch { showToast('Failed to delete', 'error') }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const res = await clientsApi.exportNotes(clientId)
      const blob = new Blob([res.data], { type: 'text/plain' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = `notes_${(clientName || clientId).replace(/\s+/g, '_')}.txt`
      a.click(); URL.revokeObjectURL(url)
    } catch { showToast('Export failed', 'error') }
    finally { setExporting(false) }
  }

  const typePill  = (t: string) => t === 'session' ? 'pill-blue' : t === 'observation' ? 'pill-gold' : t === 'commitment' ? 'pill-green' : 'pill-grey'
  const typeLabel = (t: string) => NOTE_TYPES.find(n => n.value === t)?.label || t

  return (
    <div style={{ maxWidth: 800 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 400 }}>
          Session Notes
          {noteList.length > 0 && (
            <span style={{ fontSize: 13, fontFamily: "'DM Sans', sans-serif", fontWeight: 400, color: 'var(--muted)', marginLeft: 10 }}>
              {noteList.length}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {noteList.length > 0 && (
            <button className="btn btn-outline btn-sm" onClick={handleExport} disabled={exporting}>
              {exporting ? 'Exporting…' : '↓ Export'}
            </button>
          )}
          <button className="btn btn-dark btn-sm" onClick={() => { setAdding(a => !a); setNoteText(''); setStruct(emptyStruct()); setNoteType('session') }}>
            {adding ? 'Cancel' : '+ Add Note'}
          </button>
        </div>
      </div>

      {/* Add note form */}
      {adding && (
        <div className="card" style={{ marginBottom: 18, border: '2px solid var(--gold)' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>New Note</span>
          </div>
          <div style={{ padding: '16px 20px' }}>
            <NoteTypeSelector value={noteType} onChange={setNoteType} />
            {noteType === 'session'
              ? <StructuredForm value={struct} onChange={setStruct} />
              : <textarea className="ftextarea" rows={5} autoFocus style={{ marginTop: 14, fontSize: 14, lineHeight: 1.7 }}
                  value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Write your note here…" />
            }
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn btn-outline btn-sm" onClick={() => { setAdding(false); setNoteText(''); setStruct(emptyStruct()) }}>Cancel</button>
              <button className="btn btn-dark btn-sm" onClick={handleAdd} disabled={saving}>
                {saving ? 'Saving…' : 'Save Note'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {noteList.length === 0 && !adding && (
        <EmptyState icon="✎" title="No notes yet" message="Add date-stamped notes — session observations, commitments, and context." action={
          <button className="btn btn-dark" onClick={() => setAdding(true)}>+ Add First Note</button>
        } />
      )}

      {/* Note cards */}
      {noteList.map((n: any) => {
        const isExpanded    = expanded.has(n.id)
        const isEditing     = editingId === n.id
        const structured    = parseStructured(n.text)
        const needsCollapse = !structured && n.text.length > COLLAPSE_CHARS
        const displayText   = needsCollapse && !isExpanded ? n.text.slice(0, COLLAPSE_CHARS).trimEnd() + '…' : n.text

        return (
          <div key={n.id} className="card" style={{ marginBottom: 14 }}>
            {/* Card header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '13px 20px', borderBottom: '1px solid var(--border)',
              background: 'var(--paper)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span className={`pill ${typePill(n.note_type)}`} style={{ fontSize: 11 }}>
                  {typeLabel(n.note_type)}
                </span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {fmtNoteDate(n.created_at, tz)}
                </span>
                {n.created_by_name && (
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>by {n.created_by_name}</span>
                )}
                {wasEdited(n.created_at, n.updated_at) && (
                  <span style={{
                    fontSize: 10, color: 'var(--muted)', fontStyle: 'italic',
                    background: 'var(--paper)', padding: '1px 6px', borderRadius: 10,
                    border: '1px solid var(--border)',
                  }}>
                    edited {fmtNoteDate(n.updated_at, tz)}
                  </span>
                )}
              </div>
              {/* Actions */}
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {!isEditing && (
                  <button onClick={() => startEdit(n)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '3px 6px', fontSize: 12, fontFamily: "'DM Sans', sans-serif" }}
                    title="Edit note">Edit</button>
                )}
                <button onClick={() => handleDelete(n.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 19, lineHeight: 1, padding: '0 4px' }}
                  title="Delete note">×</button>
              </div>
            </div>

            {/* Card body */}
            {isEditing ? (
              <div style={{ padding: '16px 20px' }}>
                <NoteTypeSelector value={editType} onChange={setEditType} />
                {editType === 'session'
                  ? <StructuredForm value={editStruct} onChange={setEditStruct} />
                  : <textarea className="ftextarea" rows={5} autoFocus style={{ marginTop: 14, fontSize: 14, lineHeight: 1.7 }}
                      value={editText} onChange={e => setEditText(e.target.value)} />
                }
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                  <button className="btn btn-outline btn-sm" onClick={cancelEdit}>Cancel</button>
                  <button className="btn btn-dark btn-sm" onClick={() => handleSaveEdit(n.id)} disabled={editSaving}>
                    {editSaving ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ padding: '16px 20px' }}>
                {structured
                  ? <StructuredDisplay data={structured} />
                  : <>
                      <p style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--ink)', whiteSpace: 'pre-wrap', margin: 0 }}>
                        {displayText}
                      </p>
                      {needsCollapse && (
                        <button onClick={() => toggle(n.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 0 0', fontSize: 12, color: 'var(--gold)', fontFamily: "'DM Sans', sans-serif" }}>
                          {isExpanded ? '↑ Collapse' : '↓ Read more'}
                        </button>
                      )}
                    </>
                }
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── File type SVG icons ───────────────────────────────────────────────────────
function IconPdf() {
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
      <rect x="11" y="4" width="24" height="32" rx="2" fill="#d4cfc8"/>
      <path d="M35 4l6 6h-6V4z" fill="#b8b2ab"/>
      <rect x="8" y="28" width="30" height="16" rx="2" fill="#c0392b" opacity=".85"/>
      <text x="14" y="40" fontSize="8" fontWeight="700" fill="white" fontFamily="sans-serif">PDF</text>
      <line x1="15" y1="16" x2="33" y2="16" stroke="white" strokeWidth="1.5" opacity=".6"/>
      <line x1="15" y1="21" x2="33" y2="21" stroke="white" strokeWidth="1.5" opacity=".6"/>
    </svg>
  )
}
function IconVideo() {
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
      <rect x="4" y="12" width="36" height="26" rx="3" fill="#1e2d42" opacity=".85"/>
      <rect x="4" y="12" width="36" height="9" rx="3" fill="#1a2638"/>
      <line x1="14" y1="12" x2="10" y2="21" stroke="white" strokeWidth="2" opacity=".7"/>
      <line x1="22" y1="12" x2="18" y2="21" stroke="white" strokeWidth="2" opacity=".7"/>
      <line x1="30" y1="12" x2="26" y2="21" stroke="white" strokeWidth="2" opacity=".7"/>
      <polygon points="20,23 20,36 34,29.5" fill="white" opacity=".85"/>
      <path d="M42 19l6-4v22l-6-4V19z" fill="#1e2d42" opacity=".85"/>
    </svg>
  )
}
function IconDoc() {
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
      <rect x="10" y="4" width="24" height="34" rx="2" fill="#d4cfc8"/>
      <path d="M34 4l7 7h-7V4z" fill="#b8b2ab"/>
      <line x1="15" y1="16" x2="33" y2="16" stroke="white" strokeWidth="1.5"/>
      <line x1="15" y1="21" x2="33" y2="21" stroke="white" strokeWidth="1.5"/>
      <line x1="15" y1="26" x2="27" y2="26" stroke="white" strokeWidth="1.5"/>
      <rect x="28" y="30" width="14" height="5" rx="1.5" fill="#c8a028" transform="rotate(-42 28 30)"/>
      <circle cx="40" cy="43" r="3" fill="#c8a028"/>
    </svg>
  )
}
function IconLink() {
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
      <path d="M22 30a9 9 0 0 0 12.73 0l4.77-4.77a9 9 0 0 0-12.73-12.73L24.5 14.77" stroke="#b8921e" strokeWidth="3.5" strokeLinecap="round"/>
      <path d="M30 22a9 9 0 0 0-12.73 0l-4.77 4.77a9 9 0 0 0 12.73 12.73L27.5 37.23" stroke="#b8921e" strokeWidth="3.5" strokeLinecap="round"/>
    </svg>
  )
}
function IconImage() {
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
      <rect x="6" y="10" width="40" height="30" rx="3" fill="#d4cfc8"/>
      <circle cx="17" cy="20" r="4" fill="#b8921e" opacity=".7"/>
      <path d="M6 32l12-10 8 8 7-6 13 10H6z" fill="#b8b2ab" opacity=".8"/>
    </svg>
  )
}
function IconFile() {
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
      <rect x="10" y="4" width="24" height="34" rx="2" fill="#d4cfc8"/>
      <path d="M34 4l7 7h-7V4z" fill="#b8b2ab"/>
      <line x1="15" y1="16" x2="33" y2="16" stroke="white" strokeWidth="1.5"/>
      <line x1="15" y1="21" x2="33" y2="21" stroke="white" strokeWidth="1.5"/>
      <line x1="15" y1="26" x2="27" y2="26" stroke="white" strokeWidth="1.5"/>
    </svg>
  )
}

// ── FileVault ─────────────────────────────────────────────────────────────────
type FileCategory = 'pdf' | 'video' | 'document' | 'image' | 'link'

function fileCategory(name: string): FileCategory {
  const ext = name?.split('.').pop()?.toLowerCase() || ''
  if (ext === 'pdf') return 'pdf'
  if (['mp4','mov','avi','mkv','webm','m4v'].includes(ext)) return 'video'
  if (['png','jpg','jpeg','gif','webp','svg'].includes(ext)) return 'image'
  return 'document'
}

const CAT_CONFIG: Record<FileCategory, { bg: string; icon: JSX.Element; action: string }> = {
  pdf:      { bg: '#fdf0ef', icon: <IconPdf />,   action: 'Download PDF' },
  video:    { bg: '#edf4fc', icon: <IconVideo />,  action: 'Watch Now' },
  document: { bg: '#fdf0ef', icon: <IconDoc />,    action: 'Open Document' },
  image:    { bg: '#f0f4ef', icon: <IconImage />,  action: 'View Image' },
  link:     { bg: '#fdf9ed', icon: <IconLink />,   action: 'Open Link' },
}

function FileVault({ clientId, fileList, refetch, showToast, canDelete }: { clientId: string; fileList: any[]; refetch: () => Promise<any>; showToast: any; canDelete: boolean }) {
  const [uploading, setUploading]   = useState(false)
  const [fileType, setFileType]     = useState('other')
  const [dragOver, setDragOver]     = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [search, setSearch]         = useState('')
  const [filterCat, setFilterCat]   = useState<'all' | FileCategory>('all')
  const [confirmFile, setConfirmFile] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting]     = useState(false)

  const handleUpload = async (file: File) => {
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('assessment_type', fileType)
    fd.append('date', new Date().toISOString().slice(0, 10))
    try {
      await clientsApi.uploadFile(clientId, fd)
      await refetch()
      showToast(`${file.name} uploaded`)
      setShowUpload(false)
    } catch { showToast('Upload failed', 'error') }
    finally { setUploading(false) }
  }

  const handleDelete = async () => {
    if (!confirmFile) return
    setDeleting(true)
    try {
      await clientsApi.deleteFile(clientId, confirmFile.id)
      await refetch()
      showToast('File deleted')
      setConfirmFile(null)
    } catch { showToast('Failed to delete', 'error') }
    finally { setDeleting(false) }
  }

  const isNew = (dateStr: string) =>
    (Date.now() - new Date(dateStr).getTime()) < 7 * 24 * 60 * 60 * 1000

  const filtered = fileList.filter(f => {
    const cat = fileCategory(f.file_name)
    if (filterCat !== 'all' && cat !== filterCat) return false
    if (search && !f.file_name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const FILTERS: Array<{ value: 'all' | FileCategory; label: string }> = [
    { value: 'all',      label: 'All' },
    { value: 'pdf',      label: 'PDF' },
    { value: 'video',    label: 'Video' },
    { value: 'document', label: 'Document' },
    { value: 'image',    label: 'Image' },
  ]

  return (
    <div style={{ maxWidth: 980 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 24, fontWeight: 300 }}>Files & Documents</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
            {fileList.length} item{fileList.length !== 1 ? 's' : ''} · Available immediately after upload
          </div>
        </div>
        <button className="btn btn-dark btn-sm" onClick={() => setShowUpload(s => !s)}>
          {showUpload ? 'Cancel' : '+ Upload File'}
        </button>
      </div>

      {/* Upload panel */}
      {showUpload && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>Upload File</span>
          </div>
          <div style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {FILE_TYPES.map(ft => (
                <button key={ft.value} onClick={() => setFileType(ft.value)}
                  style={{
                    padding: '5px 12px', fontSize: 11, cursor: 'pointer',
                    border: '1px solid var(--border)',
                    background: fileType === ft.value ? 'var(--ink)' : 'var(--white)',
                    color: fileType === ft.value ? 'var(--paper)' : 'var(--ink)',
                    fontFamily: "'DM Sans', sans-serif",
                  }}>{ft.label}</button>
              ))}
            </div>
            <label
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f) }}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                border: `2px dashed ${dragOver ? 'var(--gold)' : 'var(--border)'}`,
                background: dragOver ? 'var(--gold-faint)' : 'var(--paper)',
                padding: '32px 20px', cursor: 'pointer', transition: 'all .2s',
                borderRadius: 'var(--radius-sm)',
              }}>
              <input type="file" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = '' }} />
              {uploading ? (
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>Uploading…</span>
              ) : (
                <>
                  <IconFile />
                  <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500, marginTop: 10, marginBottom: 4 }}>Drop file here or click to browse</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>PDF, Word, Excel, images — max 50 MB</span>
                </>
              )}
            </label>
          </div>
        </div>
      )}

      {/* Search + filters */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 22 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search files…"
            style={{
              width: '100%', paddingLeft: 36, paddingRight: 12, height: 38, boxSizing: 'border-box',
              border: '1px solid var(--border)', background: 'var(--white)',
              fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: 'none',
            }}/>
        </div>
        {FILTERS.map(f => (
          <button key={f.value} onClick={() => setFilterCat(f.value)}
            style={{
              padding: '8px 16px', fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
              border: '1px solid var(--border)', whiteSpace: 'nowrap',
              background: filterCat === f.value ? 'var(--ink)' : 'var(--white)',
              color: filterCat === f.value ? 'var(--paper)' : 'var(--ink)',
            }}>{f.label}</button>
        ))}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <EmptyState icon="📁" title="No files yet" message="Upload signed contracts, assessments, and reports." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {filtered.map((f: any) => {
            const cat = fileCategory(f.file_name)
            const { bg, icon, action } = CAT_CONFIG[cat]
            const typeLabel = FILE_TYPES.find(t => t.value === f.assessment_type)?.label || f.assessment_type
            return (
              <div key={f.id} className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {/* Thumbnail */}
                <div style={{ position: 'relative', height: 118, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {icon}
                  {isNew(f.created_at) && (
                    <div style={{
                      position: 'absolute', top: 10, right: 10,
                      background: 'var(--gold)', color: 'var(--ink)',
                      fontSize: 9, fontWeight: 700, letterSpacing: '.1em',
                      padding: '3px 8px',
                    }}>NEW</div>
                  )}
                </div>
                {/* Body */}
                <div style={{ padding: '13px 15px 15px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                    {cat} · {typeLabel}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', lineHeight: 1.4, flex: 1, wordBreak: 'break-word' }}>
                    {f.file_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, marginBottom: 12 }}>
                    Added {fmtDate(f.date || f.created_at)}
                    {f.uploaded_by_name && <> · {f.uploaded_by_name}</>}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {f.presigned_url ? (
                      <a href={f.presigned_url} target="_blank" rel="noreferrer"
                        style={{ fontSize: 12, fontWeight: 500, color: 'var(--gold)', textDecoration: 'none' }}>
                        {action} →
                      </a>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--muted-faint)' }}>No preview</span>
                    )}
                    {canDelete && (
                      <button onClick={() => setConfirmFile({ id: f.id, name: f.file_name })}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 18, padding: '0 2px', lineHeight: 1 }}
                        title="Delete file">×</button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmFile && (
        <Modal title="Delete File" onClose={() => setConfirmFile(null)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setConfirmFile(null)}>Cancel</button>
            <button className="btn btn-sm" style={{ background: 'var(--rust)', color: '#fff', border: 'none' }}
              onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }>
          <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            Are you sure you want to permanently delete <strong>"{confirmFile.name}"</strong>?
            This action cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = ['Overview', 'Goals', 'Activities', 'Notes', 'Files', 'Invoices']

const NOTE_TYPES = [
  { value: 'session', label: 'Session Note' },
  { value: 'general', label: 'General' },
]

const FILE_TYPES = [
  { value: 'contract',   label: 'Contract' },
  { value: 'disc',       label: 'DISC Assessment' },
  { value: 'motivators', label: 'Motivators' },
  { value: 'behavioral', label: 'Behavioral Assessment' },
  { value: 'other',      label: 'Other' },
]


export default function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { show: showToast, el: toastEl } = useToast()
  const { user, workspace } = useAuthStore()
  const isOwner = user?.role === 'business_owner'
  const tz: string | undefined = (workspace as any)?.workspace_timezone || undefined
  const [tab, setTab] = useState('Overview')
  const [showActivity, setShowActivity] = useState(false)
  const [showGoal, setShowGoal]       = useState(false)
  const [editingGoal, setEditingGoal] = useState<any>(null)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState<Client | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const { data: client, isLoading } = useQuery<Client, Error>({
    queryKey: ['client', id],
    queryFn: () => clientsApi.get(id!).then(r => r.data),
  })

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => authApi.me().then((r: any) => r.data),
    staleTime: 5 * 60 * 1000,
  })
  const canDelete = me?.role === 'business_owner' || !!me?.is_superuser

  useEffect(() => {
    if (client && !editForm) {
      setEditForm(client)
    }
  }, [client, editForm])

  const { data: activities } = useQuery<any, Error>({
    queryKey: ['client-activities', id],
    queryFn: () => activitiesApi.list({ client: id, page_size: 50 }).then(r => r.data),
    enabled: tab === 'Activities' || tab === 'Overview',
  })

  const { data: goals } = useQuery<any, Error>({
    queryKey: ['client-goals', id],
    queryFn: () => clientsApi.listGoals(id!).then(r => r.data),
    enabled: tab === 'Goals' || tab === 'Overview',
  })

  const { data: invoices } = useQuery<any, Error>({
    queryKey: ['client-invoices', id],
    queryFn: () => invoicesApi.list({ client: id }).then(r => r.data),
    enabled: tab === 'Invoices' || tab === 'Overview',
  })

  const { data: notesData, refetch: refetchNotes } = useQuery<any, Error>({
    queryKey: ['client-notes', id],
    queryFn: () => clientsApi.listNotes(id!).then(r => r.data),
    enabled: tab === 'Notes',
  })

  const { data: filesData, refetch: refetchFiles } = useQuery<any, Error>({
    queryKey: ['client-files', id],
    queryFn: () => clientsApi.listFiles(id!).then(r => r.data),
    enabled: tab === 'Files',
  })

  const { data: dealData } = useQuery<any, Error>({
    queryKey: ['client-deal', id],
    queryFn: () => pipelineApi.deals({ client: id }).then(r => r.data),
  })

  const { data: stagesData = [] } = useQuery({
    queryKey: ['pipeline-stage-configs'],
    queryFn: () => settingsApi.getPipelineStages().then(r => r.data),
  })
  const stageMap: Record<string, any> = {}
  ;(stagesData as any[]).forEach((s: any) => { stageMap[s.slug] = s })

  const { data: statusConfigs = [] } = useQuery({
    queryKey: ['client-status-configs'],
    queryFn: () => settingsApi.getClientStatuses().then(r => r.data),
    staleTime: 0,
  })
  const statusMap = useMemo(() => {
    const m: Record<string, any> = {}
    ;(statusConfigs as any[]).forEach((s: any) => { m[s.label] = s })
    return m
  }, [statusConfigs])

  const { data: tagConfigs = [], refetch: refetchTags } = useQuery({
    queryKey: ['client-tag-configs'],
    queryFn: () => settingsApi.getClientTags().then(r => r.data),
    staleTime: 0,
  })
  const tagMap = useMemo(() => {
    const m: Record<string, string> = {}
    ;(tagConfigs as any[]).forEach((t: any) => { m[t.name] = t.color })
    return m
  }, [tagConfigs])

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['team'],
    queryFn: () => authApi.team().then(r => r.data),
    staleTime: 60_000,
  })
  const coaches = (teamMembers as any[]).filter((m: any) => m.role === 'coach')

  const [newTagName, setNewTagName] = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const handleAddTag = async () => {
    const name = newTagName.trim()
    if (!name) return
    setAddingTag(true)
    try {
      await settingsApi.createClientTag({ name, color: '#1B3A6B' })
      await refetchTags()
      setEditForm((f: any) => ({ ...f, tags: [...(f?.tags || []), name] }))
      setNewTagName('')
    } finally { setAddingTag(false) }
  }

  const handleSave = async () => {
    try {
      await clientsApi.update(id!, editForm)
      qc.invalidateQueries({ queryKey: ['client', id] })
      qc.invalidateQueries({ queryKey: ['clients'] })
      setEditMode(false)
      showToast('Client updated')
    } catch { showToast('Failed to save', 'error') }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await clientsApi.delete(id!)
      qc.invalidateQueries({ queryKey: ['clients'] })
      navigate('/clients')
    } catch {
      showToast('Failed to delete client', 'error')
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  const handleMarkMissed = async (actId: string) => {
    try {
      await activitiesApi.markMissed(actId)
      qc.invalidateQueries({ queryKey: ['client-activities', id] })
      showToast('Session marked as missed')
    } catch { showToast('Failed', 'error') }
  }

  // Derived lists — safe before early returns because they default to []
  const actList: any[]  = activities?.results || activities || []
  const goalList: any[] = goals?.results || goals || []
  const invList: any[]  = invoices?.results || invoices || []
  const noteList: any[] = notesData?.results || notesData || []
  const fileList: any[] = filesData?.results || filesData || []
  const deal: any = dealData?.results?.[0] || dealData?.[0] || null

  const actDotColor = (status: string) => {
    if (status === 'completed') return '#4a9e6b'
    if (status === 'missed' || status === 'cancelled') return '#c0392b'
    return 'var(--gold)'
  }

  // useMemo must be called before any conditional returns (Rules of Hooks)
  const timeline = useMemo(() => {
    const items: any[] = [
      ...actList.map(a => ({ ...a, _type: 'activity', _date: a.start_at })),
      ...invList.map(inv => ({ ...inv, _type: 'invoice', _date: inv.issue_date || inv.created_at })),
    ]
    return items
      .filter(i => i._date)
      .sort((a, b) => new Date(b._date).getTime() - new Date(a._date).getTime())
      .slice(0, 8)
  }, [actList, invList])

  if (isLoading) return <AppShell><div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div></AppShell>
  if (!client) return <AppShell><div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>Client not found</div></AppShell>

  const ef: Client = editForm || client!

  return (
    <AppShell>
      {/* Profile Header */}
      <div style={{ background: 'var(--white)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ padding: '22px 36px 0' }}>
          <button onClick={() => navigate('/clients')} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 5, fontFamily: "'DM Sans', sans-serif" }}>
            ← Clients
          </button>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, marginBottom: 18 }}>
            {/* Avatar */}
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 300, color: 'var(--ink)', flexShrink: 0 }}>
              {initials(client.first_name + ' ' + client.last_name)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 5 }}>
                <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 300 }}>
                  {client.first_name} {client.last_name}
                </span>
                {(() => {
                  const cfg = statusMap[(client as any).status]
                  const color = cfg?.color || '#b8b2ab'
                  return (
                    <span style={{
                      fontSize: 12, fontWeight: 600, padding: '3px 12px', borderRadius: 12,
                      background: color + '20', color, border: `1px solid ${color}40`,
                    }}>{(client as any).status || 'Lead'}</span>
                  )
                })()}
                {client.portal_access && <span className="pill pill-blue">Portal</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {(client.job_title || client.company) && (
                  <span>{[client.job_title, client.company].filter(Boolean).join(', ')}</span>
                )}
                {client.email && <><span>·</span><span>{client.email}</span></>}
                {(client as any).coach_name && <><span>·</span><span>Coach: {(client as any).coach_name}</span></>}
                {(client.tags || []).length > 0 && (
                  <><span>·</span>{(client.tags || []).map((t: string) => {
                    const color = tagMap[t]
                    return color ? (
                      <span key={t} style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                        background: color + '20', color, border: `1px solid ${color}40`,
                      }}>{t}</span>
                    ) : <span key={t} className="tag">{t}</span>
                  })}</>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              {editMode ? (
                <>
                  <button className="btn btn-outline btn-sm" onClick={() => setEditMode(false)}>Cancel</button>
                  <button className="btn btn-dark btn-sm" onClick={handleSave}>Save</button>
                </>
              ) : (
                <>
                  <button className="btn btn-outline btn-sm" onClick={async () => {
                    await clientsApi.patch(id!, { portal_access: !client.portal_access })
                    qc.invalidateQueries({ queryKey: ['client', id] })
                    showToast(client.portal_access ? 'Portal access removed' : 'Portal invite sent')
                  }}>
                    {client.portal_access ? 'Revoke Portal' : 'Invite to Portal'}
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => { setEditForm(client); setEditMode(true) }}>Edit</button>
                  {isOwner && (
                    <button
                      className="btn btn-sm"
                      onClick={() => setShowDeleteConfirm(true)}
                      style={{ border: '1px solid #e5b4b4', color: '#c0392b', background: '#fdf4f4' }}
                    >Delete</button>
                  )}
                </>
              )}
              <button className="btn btn-dark btn-sm" onClick={() => setShowActivity(true)}>+ Schedule Session</button>
            </div>
          </div>

          {/* Profile Tabs */}
          <div style={{ display: 'flex', borderTop: '1px solid var(--border)' }}>
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '11px 18px', fontSize: 12, fontWeight: 500,
                color: tab === t ? 'var(--ink)' : 'var(--muted)',
                background: 'none', border: 'none',
                borderBottom: `2px solid ${tab === t ? 'var(--gold)' : 'transparent'}`,
                cursor: 'pointer', transition: 'all .15s',
                fontFamily: "'DM Sans', sans-serif",
              }}>{t}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="page-body">

        {/* ── Overview ── */}
        {tab === 'Overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>

            {/* ── Left column — Client Details + Invoices ── */}
            <div>

              {/* CLIENT DETAILS */}
              <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>Client Details</span>
                  {!editMode ? (
                    <button onClick={() => { setEditForm(client); setEditMode(true) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--muted)', fontFamily: "'DM Sans', sans-serif" }}>
                      Edit
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-outline btn-sm" onClick={() => setEditMode(false)}>Cancel</button>
                      <button className="btn btn-dark btn-sm" onClick={handleSave}>Save</button>
                    </div>
                  )}
                </div>

                {editMode ? (
                  <div style={{ padding: '20px 24px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                      <div className="fgroup" style={{ marginBottom: 14 }}>
                        <label className="flabel">Status</label>
                        <select className="fselect" value={(ef as any).status || 'Lead'} onChange={e => setEditForm((f: any) => ({ ...f, status: e.target.value }))}>
                          {(statusConfigs as any[]).map((s: any) => <option key={s.label} value={s.label}>{s.label}</option>)}
                          {(statusConfigs as any[]).length === 0 && <option value="Lead">Lead</option>}
                        </select>
                      </div>
                      <div className="fgroup" style={{ marginBottom: 14 }}>
                        <label className="flabel">Email</label>
                        <input className="finput" value={ef.email || ''} onChange={e => setEditForm((f: any) => ({ ...f, email: e.target.value }))} />
                      </div>
                      <div className="fgroup" style={{ marginBottom: 14 }}>
                        <label className="flabel">Phone</label>
                        <input className="finput" value={ef.phone || ''} onChange={e => setEditForm((f: any) => ({ ...f, phone: e.target.value }))} />
                      </div>
                      <div className="fgroup" style={{ marginBottom: 14 }}>
                        <label className="flabel">Company</label>
                        <input className="finput" value={ef.company || ''} onChange={e => setEditForm((f: any) => ({ ...f, company: e.target.value }))} />
                      </div>
                      <div className="fgroup" style={{ marginBottom: 14 }}>
                        <label className="flabel">Job Title</label>
                        <input className="finput" value={ef.job_title || ''} onChange={e => setEditForm((f: any) => ({ ...f, job_title: e.target.value }))} />
                      </div>
                      {(() => {
                        const KNOWN = ['referral', 'website', 'linkedin', 'conference', 'cold outreach', 'other', '']
                        const cur = (ef as any).lead_source || ''
                        const isCustom = cur !== '' && !KNOWN.includes(cur)
                        const dropVal = isCustom ? 'other' : cur
                        return (
                          <div className="fgroup" style={{ marginBottom: 14 }}>
                            <label className="flabel">Lead Source</label>
                            <select className="fselect" value={dropVal}
                              onChange={e => {
                                if (e.target.value === 'other') setEditForm((f: any) => ({ ...f, lead_source: '' }))
                                else setEditForm((f: any) => ({ ...f, lead_source: e.target.value }))
                              }}>
                              <option value="">Select source…</option>
                              {['referral', 'website', 'linkedin', 'conference', 'cold outreach', 'other'].map(s => (
                                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                              ))}
                            </select>
                            {dropVal === 'other' && (
                              <input className="finput" style={{ marginTop: 8 }} placeholder="Specify…"
                                value={isCustom ? cur : (ef as any).lead_source || ''}
                                onChange={e => setEditForm((f: any) => ({ ...f, lead_source: e.target.value }))} />
                            )}
                          </div>
                        )
                      })()}
                    </div>
                    {(() => {
                      const addr = (ef as any).primary_address || {}
                      const setAddr = (k: string, v: string) =>
                        setEditForm((f: any) => ({ ...f, primary_address: { ...(f.primary_address || {}), [k]: v } }))
                      return (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px' }}>
                          <div className="fgroup" style={{ marginBottom: 14, gridColumn: '1 / -1' }}>
                            <label className="flabel">Street Address</label>
                            <input className="finput" value={addr.street || ''} onChange={e => setAddr('street', e.target.value)} placeholder="123 Main St" />
                          </div>
                          <div className="fgroup" style={{ gridColumn: '1 / 2' }}>
                            <label className="flabel">State</label>
                            <input className="finput" value={addr.state || ''} onChange={e => setAddr('state', e.target.value)} placeholder="New York" />
                          </div>
                          <div className="fgroup">
                            <label className="flabel">Zip Code</label>
                            <input className="finput" value={addr.zip || ''} onChange={e => setAddr('zip', e.target.value)} placeholder="10001" />
                          </div>
                        </div>
                      )
                    })()}
                    <div className="fgroup">
                      <label className="flabel">Assign Coach</label>
                      <select className="fselect" value={(ef as any).coach || ''} onChange={e => setEditForm((f: any) => ({ ...f, coach: e.target.value }))}>
                        <option value="">— No coach assigned —</option>
                        {coaches.map((m: any) => (
                          <option key={m.id} value={m.id}>{m.full_name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="fgroup">
                      <label className="flabel">Tags</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                        {(tagConfigs as any[]).map((tc: any) => {
                          const selected = (ef.tags || []).includes(tc.name)
                          return (
                            <button key={tc.name} type="button"
                              onClick={() => setEditForm((f: any) => ({
                                ...f,
                                tags: selected ? f.tags.filter((t: string) => t !== tc.name) : [...(f.tags || []), tc.name]
                              }))}
                              style={{
                                padding: '4px 12px', fontSize: 12, cursor: 'pointer',
                                fontFamily: "'DM Sans', sans-serif",
                                border: `1px solid ${tc.color}60`,
                                background: selected ? tc.color : tc.color + '18',
                                color: selected ? '#fff' : tc.color,
                                fontWeight: selected ? 600 : 400,
                              }}>{tc.name}</button>
                          )
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <input
                          className="finput"
                          style={{ flex: 1, fontSize: 12, padding: '5px 10px' }}
                          placeholder="New tag name…"
                          value={newTagName}
                          onChange={e => setNewTagName(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                        />
                        <button type="button" className="btn btn-outline btn-sm" onClick={handleAddTag} disabled={addingTag || !newTagName.trim()}>
                          {addingTag ? '…' : '+ Add'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '16px 24px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 40px' }}>
                      {[
                        { label: 'Email',   value: client.email },
                        { label: 'Phone',   value: client.phone || '—' },
                        { label: 'Company', value: client.company || '—' },
                        { label: 'Title',   value: client.job_title || '—' },
                        { label: 'Status',  value: (client as any).status || 'Lead' },
                        { label: 'Source',  value: client.lead_source ? client.lead_source.charAt(0).toUpperCase() + client.lead_source.slice(1) : '—' },
                        { label: 'Coach',   value: (client as any).coach_name || '—' },
                        { label: 'Portal',  value: client.portal_access ? 'Enabled' : 'Not invited' },
                      ].map(({ label, value }) => (
                        <div key={label} style={{ display: 'flex', flexDirection: 'column', padding: '10px 0', borderBottom: '1px solid #f3f0eb' }}>
                          <span style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>{label}</span>
                          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{value}</span>
                        </div>
                      ))}
                    </div>
                    {(() => {
                      const addr = (client as any).primary_address || {}
                      const full = [[addr.street], [addr.state, addr.zip].filter(Boolean).join(', ')].filter(Boolean).join(', ')
                      return full ? (
                        <div style={{ display: 'flex', flexDirection: 'column', padding: '10px 0', borderBottom: '1px solid #f3f0eb' }}>
                          <span style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>Address</span>
                          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{full}</span>
                        </div>
                      ) : null
                    })()}
                    {(client.tags || []).length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', padding: '10px 0' }}>
                        <span style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Tags</span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {(client.tags || []).map((t: string) => {
                            const color = tagMap[t]
                            return color ? (
                              <span key={t} style={{ fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 10, background: color + '20', color, border: `1px solid ${color}40` }}>{t}</span>
                            ) : <span key={t} className="tag">{t}</span>
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* INVOICES */}
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>Invoices</span>
                  <button className="btn btn-dark btn-sm" onClick={() => navigate('/invoices')}>+ New</button>
                </div>
                {invList.length === 0 ? (
                  <div style={{ padding: '20px', fontSize: 13, color: 'var(--muted)' }}>No invoices yet.</div>
                ) : (
                  <table className="tbl">
                    <thead><tr><th>Invoice</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
                    <tbody>
                      {invList.map((inv: any) => (
                        <tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/invoices/${inv.id}`)}>
                          <td style={{ fontWeight: 500 }}>{inv.number}</td>
                          <td>{fmtDate(inv.issue_date || inv.created_at)}</td>
                          <td style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16 }}>
                            {inv.total ? `$${parseFloat(inv.total).toLocaleString()}` : '—'}
                          </td>
                          <td>
                            <span className={`pill ${inv.status === 'paid' ? 'pill-green' : inv.status === 'overdue' ? 'pill-red' : 'pill-grey'}`} style={{ fontSize: 10 }}>
                              {inv.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* ── Right sidebar — Engagement + Goals + Pipeline ── */}
            <div>

              {/* ENGAGEMENT HISTORY */}
              <div className="card" style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>Engagement History</span>
                  <button onClick={() => setTab('Activities')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--muted)', fontFamily: "'DM Sans', sans-serif" }}>
                    View all →
                  </button>
                </div>
                <div style={{ padding: '8px 20px 12px' }}>
                  {timeline.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--muted)', padding: '12px 0' }}>
                      No history yet.{' '}
                      <button onClick={() => setShowActivity(true)} style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans', sans-serif", padding: 0 }}>
                        Schedule a session →
                      </button>
                    </div>
                  ) : timeline.map((item: any) => (
                    <div key={`${item._type}-${item.id}`} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '10px 0' }}>
                      <div style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, marginTop: 3, background: item._type === 'invoice' ? '#3a6ea8' : actDotColor(item.status) }} />
                      <div style={{ flex: 1 }}>
                        {item._type === 'activity' ? (
                          <>
                            <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.4 }}>
                              <strong>{item.activity_type ? item.activity_type.charAt(0).toUpperCase() + item.activity_type.slice(1) : 'Session'}</strong>
                              {' — '}{item.title}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{fmtDatetime(item.start_at)}</div>
                          </>
                        ) : (
                          <>
                            <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.4 }}>
                              <strong>Invoice {item.number}</strong>{' sent — '}{item.total ? `$${parseFloat(item.total).toLocaleString()}` : ''} · {item.status}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{fmtDate(item.issue_date || item.created_at)}</div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* PIPELINE DEAL */}
              {deal && (() => {
                const stageConfig = stageMap[deal.stage]
                const stageLabel  = stageConfig?.label || (deal.stage || '').replace(/_/g, ' ')
                const stageColor  = stageConfig?.color || '#1B3A6B'
                const dealValue   = deal.deal_value ? parseFloat(deal.deal_value) : null
                return (
                  <div className="card">
                    <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>Pipeline Deal</span>
                    </div>
                    <div style={{ padding: '0 20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f3f0eb' }}>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Stage</span>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: stageColor + '18', color: stageColor, border: `1px solid ${stageColor}30` }}>{stageLabel}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Value</span>
                        <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300 }}>
                          {dealValue && dealValue > 0 ? `$${dealValue.toLocaleString()}` : '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })()}

            </div>
          </div>
        )}

        {/* ── Activities ── */}
        {tab === 'Activities' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300 }}>Activities</div>
              <button className="btn btn-dark btn-sm" onClick={() => setShowActivity(true)}>+ Schedule</button>
            </div>
            {actList.length === 0
              ? <EmptyState icon="◷" title="No activities yet" message="Schedule your first session" />
              : (
                <table className="tbl">
                  <thead><tr><th>Title</th><th>Type</th><th>Start</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {actList.map((a: any) => (
                      <tr key={a.id}>
                        <td style={{ fontWeight: 500 }}>{a.title}</td>
                        <td style={{ textTransform: 'capitalize' }}>{a.activity_type}</td>
                        <td>{fmtDatetime(a.start_at)}</td>
                        <td><StatusBadge status={a.status} /></td>
                        <td>
                          {a.status === 'scheduled' && (
                            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--rust)' }}
                              onClick={() => handleMarkMissed(a.id)}>Mark Missed</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </>
        )}

        {/* ── Goals ── */}
        {tab === 'Goals' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300 }}>Goals</div>
              <button className="btn btn-dark btn-sm" onClick={() => setShowGoal(true)}>+ Add Goal</button>
            </div>
            {goalList.length === 0
              ? <EmptyState icon="◎" title="No goals set" message="Set your client's first coaching goal" />
              : goalList.map((g: any) => (
                <div key={g.id} className="card" style={{ marginBottom: 12, padding: '16px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 4 }}>{g.title}</div>
                      {g.description && <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{g.description}</div>}
                      {g.target_date && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Target: {fmtDate(g.target_date)}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <StatusBadge status={g.status} />
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 11 }}
                        onClick={() => setEditingGoal(g)}
                      >Edit</button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 11, color: 'var(--danger, #c0392b)' }}
                        onClick={async () => {
                          if (!window.confirm('Delete this goal?')) return
                          await clientsApi.deleteGoal(id!, g.id)
                          qc.invalidateQueries({ queryKey: ['client-goals', id] })
                          showToast('Goal deleted')
                        }}
                      >Delete</button>
                    </div>
                  </div>
                </div>
              ))
            }
          </>
        )}

        {/* ── Notes (date-stamped log) ── */}
        {tab === 'Notes' && (
          <NoteLog clientId={id!} clientName={client ? `${client.first_name} ${client.last_name}` : ''} noteList={noteList} refetch={refetchNotes} showToast={showToast} tz={tz} />
        )}

        {/* ── Files ── */}
        {tab === 'Files' && (
          <FileVault clientId={id!} fileList={fileList} refetch={refetchFiles} showToast={showToast} canDelete={canDelete} />
        )}

        {/* ── Invoices ── */}
        {tab === 'Invoices' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300 }}>Invoices</div>
              <button className="btn btn-dark btn-sm" onClick={() => navigate('/invoices/new', { state: { clientId: id } })}>
                + Create Invoice
              </button>
            </div>
            {invList.length === 0
              ? <EmptyState icon="$" title="No invoices" message="Create the first invoice for this client" />
              : (
                <table className="tbl">
                  <thead><tr><th>Invoice</th><th>Status</th><th>Total</th><th>Due</th><th></th></tr></thead>
                  <tbody>
                    {invList.map((inv: any) => (
                      <tr key={inv.id} onClick={() => navigate(`/invoices/${inv.id}`)}>
                        <td style={{ fontWeight: 600 }}>{inv.number}</td>
                        <td><StatusBadge status={inv.status} /></td>
                        <td style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16 }}>${inv.total}</td>
                        <td style={{ color: inv.status === 'overdue' ? 'var(--warn)' : 'inherit' }}>{fmtDate(inv.due_date)}</td>
                        <td style={{ color: 'var(--gold)', fontSize: 12, fontWeight: 500 }}>View →</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </>
        )}
      </div>

      {showActivity && <NewActivityModal clientId={id} defaultCoachId={(client as any)?.coach} onClose={() => setShowActivity(false)} onSaved={(emailSent?: boolean) => { setShowActivity(false); showToast(emailSent ? 'Session scheduled — confirmation sent to client' : 'Session scheduled') }} />}
      {showGoal && <GoalModal clientId={id} onClose={() => setShowGoal(false)} onSaved={() => { setShowGoal(false); showToast('Goal created') }} />}
      {editingGoal && <GoalModal clientId={id} goal={editingGoal} onClose={() => setEditingGoal(null)} onSaved={() => { setEditingGoal(null); showToast('Goal updated') }} />}
      {showDeleteConfirm && (
        <Modal title="Delete Client" onClose={() => !deleting && setShowDeleteConfirm(false)}>
          <div style={{ padding: '4px 0 20px', fontSize: 14, color: 'var(--ink)', lineHeight: 1.6 }}>
            Permanently delete <strong>{client.first_name} {client.last_name}</strong>? This cannot be undone — all their sessions, notes, invoices, and files will be removed.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline btn-sm" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>Cancel</button>
            <button
              className="btn btn-sm"
              onClick={handleDelete}
              disabled={deleting}
              style={{ background: '#c0392b', color: '#fff', border: 'none' }}
            >{deleting ? 'Deleting…' : 'Delete Client'}</button>
          </div>
        </Modal>
      )}
      {toastEl}
    </AppShell>
  )
}
