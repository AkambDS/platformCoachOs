import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { clientsApi, activitiesApi, invoicesApi, settingsApi, pipelineApi, authApi, libraryApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { Modal, StatusBadge, useToast, EmptyState } from '../../components/ui'
import { EmailEditModal } from '../../components/EmailEditModal'
import { InvoiceTables, parseDate as parseInvoiceDate } from '../../components/InvoiceTables'
import { EDITABLE_OFFICE_EXTS, OfficeEditorModal, InlineOfficeViewer } from '../../components/OfficeEditor'
import SignaturePad from '../../components/SignaturePad'
import { useAuthStore } from '../../store/auth'

const GOAL_STATUSES  = ['active','completed','paused']
const PHONE_TYPES = ['Mobile', 'Work', 'Home', 'Other']

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

// ── Zoom meeting generator ────────────────────────────────────────────────────
function ZoomButton({ topic, startTime, durationMinutes, onGenerated }: {
  topic: string
  startTime: string
  durationMinutes: number
  onGenerated: (url: string) => void
}) {
  const [loading, setLoading] = useState(false)

  async function generate() {
    setLoading(true)
    try {
      const { data } = await settingsApi.createZoomMeeting({ topic, start_time: startTime, duration_minutes: durationMinutes })
      onGenerated(data.join_url)
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'Failed to create Zoom meeting'
      alert(msg)
    } finally { setLoading(false) }
  }

  return (
    <button type="button" className="btn btn-outline btn-sm" onClick={generate} disabled={loading}
      style={{ whiteSpace: 'nowrap', flexShrink: 0 }} title="Auto-generate Zoom meeting link">
      {loading ? '…' : '📹 Zoom'}
    </button>
  )
}

function PhoneButton({ phone, onGenerated }: { phone: string; onGenerated: (val: string) => void }) {
  return (
    <button type="button" className="btn btn-outline btn-sm" onClick={() => onGenerated(`Call: ${phone}`)}
      style={{ whiteSpace: 'nowrap', flexShrink: 0 }} title="Use your phone number as the meeting location">
      📞 Phone
    </button>
  )
}

// ── Confirmation email preview — read-only render using the actual values being scheduled ──
function ConfirmationPreviewModal({ clientName, coachName, sessionTitle, sessionTime, location, onClose }: {
  clientName: string; coachName: string; sessionTitle: string; sessionTime: string; location: string
  onClose: () => void
}) {
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    settingsApi.emailPreview('confirmation', {
      client_name: clientName || undefined,
      coach_name: coachName || undefined,
      session_title: sessionTitle || undefined,
      session_time: sessionTime || undefined,
      location: location || undefined,
    })
      .then(r => setHtml(r.data.html || ''))
      .catch(() => setHtml(''))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal title="Confirmation Email Preview" size="lg" onClose={onClose}>
      <div style={{ height: 480, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', position: 'relative', background: '#eeebe5' }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--muted)' }}>
            Loading preview…
          </div>
        )}
        {!loading && (
          <iframe srcDoc={html} title="Confirmation email preview" sandbox="allow-same-origin"
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }} />
        )}
      </div>
    </Modal>
  )
}

// ── New Activity Modal ────────────────────────────────────────────────────────
function NewActivityModal({ clientId, defaultCoachId, clientName, onClose, onSaved }: any) {
  const qc = useQueryClient()
  const { user, workspace } = useAuthStore()
  const dialInPhone = (user as any)?.phone || ''
  const genericTemplates: any[] = (workspace as any)?.generic_templates || []
  // Only templates assigned to the Booking Confirmation slot — other use cases use a
  // different placeholder set, so picking one here leaves those placeholders literal.
  const confirmationTemplates = genericTemplates.filter((t: any) => t.use_cases?.includes('confirmation'))
  const { data: activityTypes = [] } = useQuery({
    queryKey: ['activity-type-configs'],
    queryFn: () => settingsApi.getActivityTypes().then(r => r.data),
    select: (d: any[]) => d.filter((t: any) => t.is_active),
  })
  const { data: affiliations = [] } = useQuery({
    queryKey: ['affiliation-configs'],
    queryFn: () => settingsApi.getAffiliations().then(r => r.data),
  })
  const { data: teamData } = useQuery({
    queryKey: ['team'],
    queryFn: () => authApi.team().then(r => r.data),
  })
  const teamMembers: any[] = teamData?.results || teamData || []
  const coaches = teamMembers.filter((m: any) => ['coach', 'business_owner'].includes(m.role))

  const [coachId, setCoachId] = useState(defaultCoachId || user?.id || '')
  const [affiliationId, setAffiliationId] = useState('')
  const [form, setForm] = useState({ activity_type: 'session', title: '', location: '', notes: '' })
  const [date, setDate]           = useState('')
  const [startTime, setStartTime] = useState('')
  const [endDate, setEndDate]     = useState('')
  const [endTime, setEndTime]     = useState('')
  const [repeat, setRepeat]       = useState<'none'|'daily'|'weekly'|'biweekly'|'monthly'|'yearly'>('none')
  const [repeatEnd, setRepeatEnd] = useState<'never'|'date'>('never')
  const [repeatUntil, setRepeatUntil] = useState('')
  const [sendConfirmation, setSendConfirmation] = useState(true)
  const [emailTemplateId, setEmailTemplateId] = useState('')
  const [showEmailEdit, setShowEmailEdit] = useState(false)
  const [showEmailPreview, setShowEmailPreview] = useState(false)
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
    const payload: any = { ...form, client: clientId, coach: coachId || undefined, affiliation: affiliationId || undefined, start_at: toUTC(start_at), end_at: toUTC(end_at), send_confirmation: sendConfirmation, email_template_id: emailTemplateId }
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
    <>
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
              <option key={t.name} value={t.name}>{t.name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</option>
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

      {/* Affiliation */}
      {affiliations.length > 0 && (
        <div className="fgroup">
          <label className="flabel">Affiliation</label>
          <select className="fselect" value={affiliationId} onChange={e => setAffiliationId(e.target.value)}>
            <option value="">— None —</option>
            {affiliations.map((a: any) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      )}

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
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="finput" value={form.location} onChange={e => set('location', e.target.value)} placeholder="Zoom link, office address…" style={{ flex: 1 }} />
          <ZoomButton
            topic={form.title || 'Coaching Session'}
            startTime={date && startTime ? `${date}T${startTime}` : ''}
            durationMinutes={endTime && startTime ? Math.round((new Date(`2000-01-01T${endTime}`).getTime() - new Date(`2000-01-01T${startTime}`).getTime()) / 60000) : 60}
            onGenerated={url => set('location', url)}
          />
          {dialInPhone && (
            <PhoneButton phone={dialInPhone} onGenerated={val => set('location', val)} />
          )}
        </div>
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
      {sendConfirmation && genericTemplates.length > 0 && confirmationTemplates.length === 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
          No saved template is assigned to Booking Confirmation yet — open Settings → Generic Templates,
          edit (or create) one, and assign it to "Booking Confirmation" to make it selectable here.
        </div>
      )}
      {sendConfirmation && confirmationTemplates.length > 0 && (
        <div className="fgroup" style={{ marginTop: 10 }}>
          <label className="flabel">Email template</label>
          <select className="fselect" value={emailTemplateId} onChange={e => setEmailTemplateId(e.target.value)}>
            <option value="">Default (Settings → Generic Templates → Booking Confirmation)</option>
            {confirmationTemplates.map((t: any) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}
      {sendConfirmation && (
        <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
          <button type="button" onClick={() => setShowEmailPreview(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2d6a9f', fontSize: 12, fontWeight: 600, padding: 0 }}>
            Preview email →
          </button>
          <button type="button" onClick={() => setShowEmailEdit(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2d6a9f', fontSize: 12, fontWeight: 600, padding: 0 }}>
            Edit Default Template →
          </button>
        </div>
      )}
    </Modal>

    {showEmailEdit && (
      <EmailEditModal useCase="confirmation" onClose={() => setShowEmailEdit(false)} />
    )}
    {showEmailPreview && (
      <ConfirmationPreviewModal
        clientName={clientName || ''}
        coachName={coaches.find((c: any) => c.id === coachId)?.full_name || ''}
        sessionTitle={form.title}
        sessionTime={date && startTime ? new Date(`${date}T${startTime}`).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
        location={form.location}
        onClose={() => setShowEmailPreview(false)}
      />
    )}
    </>
  )
}

// ── Goal Modal (create + edit) ─────────────────────────────────────────────────
function GoalModal({ clientId, goal, onClose, onSaved }: any) {
  const qc = useQueryClient()
  const isEdit = !!goal
  const [form, setForm] = useState({
    title:            goal?.title            || '',
    description:      goal?.description      || '',
    target_date:      goal?.target_date ? goal.target_date.slice(0, 10) : '',
    status:           goal?.status           || 'active',
    visible_to_client: goal?.visible_to_client ?? false,
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0 4px', borderTop: '1px solid var(--border)', marginTop: 4 }}>
        <input type="checkbox" id="goal-visible" checked={form.visible_to_client}
          onChange={e => setForm(f => ({ ...f, visible_to_client: e.target.checked }))}
          style={{ width: 15, height: 15, accentColor: 'var(--gold)', cursor: 'pointer' }} />
        <label htmlFor="goal-visible" style={{ fontSize: 13, color: 'var(--ink)', cursor: 'pointer', userSelect: 'none' }}>
          Share with client <span style={{ fontSize: 12, color: 'var(--muted)' }}>(visible in client portal)</span>
        </label>
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
  const [saving, setSaving]         = useState(false)
  const [noteType, setNoteType]     = useState('session')
  const [noteText, setNoteText]     = useState('')
  const [struct, setStruct]         = useState(emptyStruct())
  const [noteVisible, setNoteVisible] = useState(false)

  const [expanded, setExpanded]           = useState<Set<string>>(new Set())
  const [editingId, setEditingId]         = useState<string | null>(null)
  const [editType, setEditType]           = useState('session')
  const [editText, setEditText]           = useState('')
  const [editStruct, setEditStruct]       = useState(emptyStruct())
  const [editVisible, setEditVisible]     = useState(false)
  const [editSaving, setEditSaving]       = useState(false)
  const [exporting, setExporting]       = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; preview: string } | null>(null)
  const [deleting, setDeleting]         = useState(false)

  const toggle = (id: string) =>
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  const startEdit = (n: any) => {
    setEditingId(n.id); setEditType(n.note_type); setEditVisible(!!n.visible_to_client)
    const parsed = parseStructured(n.text)
    if (parsed) { setEditStruct(parsed); setEditText('') }
    else { setEditText(n.text); setEditStruct(emptyStruct()) }
  }
  const cancelEdit = () => { setEditingId(null); setEditText(''); setEditType('session'); setEditStruct(emptyStruct()); setEditVisible(false) }

  const buildText = (type: string, text: string, s: typeof struct) =>
    type === 'session' ? STRUCTURED_PREFIX + JSON.stringify(s) : text

  const handleAdd = async () => {
    const text = buildText(noteType, noteText, struct)
    if (noteType === 'session' && !struct.notes.trim() && !struct.reflection.trim() && !struct.commitment.trim()) return
    if (noteType !== 'session' && !noteText.trim()) return
    setSaving(true)
    try {
      await clientsApi.createNote(clientId, { text, note_type: noteType, visible_to_client: noteVisible })
      await refetch()
      setNoteText(''); setStruct(emptyStruct()); setNoteType('session'); setNoteVisible(false)
      showToast('Note added')
    } catch { showToast('Failed to save note', 'error') }
    finally { setSaving(false) }
  }

  const handleSaveEdit = async (nid: string) => {
    const text = buildText(editType, editText, editStruct)
    setEditSaving(true)
    try {
      await clientsApi.updateNote(clientId, nid, { text, note_type: editType, visible_to_client: editVisible })
      await refetch(); cancelEdit()
      showToast('Note updated')
    } catch { showToast('Failed to update', 'error') }
    finally { setEditSaving(false) }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await clientsApi.deleteNote(clientId, deleteTarget.id); await refetch()
      showToast('Note deleted')
      setDeleteTarget(null)
    } catch { showToast('Failed to delete', 'error') }
    finally { setDeleting(false) }
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
  const notePreview = (n: any) => {
    const parsed = parseStructured(n.text)
    if (parsed) return parsed.notes?.trim() || parsed.reflection?.trim() || 'Session note'
    return n.text.slice(0, 60)
  }

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', maxWidth: 1100 }}>

      {/* ── LEFT: New Note Form ── */}
      <div style={{ width: 320, flexShrink: 0, position: 'sticky', top: 20 }}>
        <div className="card" style={{ border: '1.5px solid var(--gold)' }}>
          <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>New Note</span>
            {noteList.length > 0 && (
              <button className="btn btn-outline btn-sm" onClick={handleExport} disabled={exporting} style={{ fontSize: 10 }}>
                {exporting ? 'Exporting…' : '↓ Export'}
              </button>
            )}
          </div>
          <div style={{ padding: '14px 18px' }}>
            <NoteTypeSelector value={noteType} onChange={setNoteType} />
            {noteType === 'session'
              ? <StructuredForm value={struct} onChange={setStruct} />
              : <textarea className="ftextarea" rows={6} style={{ marginTop: 12, fontSize: 13, lineHeight: 1.7 }}
                  value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Write your note here…" />
            }
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 4 }}>
              <input type="checkbox" id="note-visible" checked={noteVisible}
                onChange={e => setNoteVisible(e.target.checked)}
                style={{ width: 14, height: 14, accentColor: 'var(--gold)', cursor: 'pointer' }} />
              <label htmlFor="note-visible" style={{ fontSize: 12, color: 'var(--muted)', cursor: 'pointer', userSelect: 'none' }}>
                Share with client
              </label>
            </div>
            <button className="btn btn-dark btn-sm" onClick={handleAdd} disabled={saving}
              style={{ width: '100%', marginTop: 6, justifyContent: 'center' }}>
              {saving ? 'Saving…' : 'Save Note'}
            </button>
          </div>
        </div>
      </div>

      {/* ── RIGHT: Note List ── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 400 }}>
            Session Notes{noteList.length > 0 && <span style={{ fontSize: 13, fontFamily: 'sans-serif', fontWeight: 400, color: 'var(--muted)', marginLeft: 8 }}>{noteList.length}</span>}
          </span>
        </div>

        {noteList.length === 0 ? (
          <EmptyState icon="✎" title="No notes yet" message="Use the form on the left to add your first note." />
        ) : noteList.map((n: any) => {
          const isExpanded    = expanded.has(n.id)
          const isEditing     = editingId === n.id
          const structured    = parseStructured(n.text)
          const needsCollapse = !structured && n.text.length > COLLAPSE_CHARS
          const displayText   = needsCollapse && !isExpanded ? n.text.slice(0, COLLAPSE_CHARS).trimEnd() + '…' : n.text

          return (
            <div key={n.id} className="card" style={{ marginBottom: 12 }}>
              {/* Card header */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '11px 18px', borderBottom: '1px solid var(--border)', background: 'var(--paper)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={`pill ${typePill(n.note_type)}`} style={{ fontSize: 10 }}>
                    {typeLabel(n.note_type)}
                  </span>
                  {n.visible_to_client && (
                    <span className="pill pill-green" style={{ fontSize: 10 }}>Shared with client</span>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtNoteDate(n.created_at, tz)}</span>
                  {n.created_by_name && <span style={{ fontSize: 11, color: 'var(--muted)' }}>by {n.created_by_name}</span>}
                  {wasEdited(n.created_at, n.updated_at) && (
                    <span style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'italic', background: 'var(--paper)', padding: '1px 6px', borderRadius: 10, border: '1px solid var(--border)' }}>
                      edited {fmtNoteDate(n.updated_at, tz)}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                  {!isEditing && (
                    <button onClick={() => startEdit(n)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '3px 8px', fontSize: 11 }}
                      title="Edit note">Edit</button>
                  )}
                  <button
                    onClick={() => setDeleteTarget({ id: n.id, preview: notePreview(n) })}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 6px', color: 'var(--muted)', fontSize: 17, lineHeight: 1 }}
                    title="Delete note">×</button>
                </div>
              </div>

              {/* Card body */}
              {isEditing ? (
                <div style={{ padding: '14px 18px' }}>
                  <NoteTypeSelector value={editType} onChange={setEditType} />
                  {editType === 'session'
                    ? <StructuredForm value={editStruct} onChange={setEditStruct} />
                    : <textarea className="ftextarea" rows={5} autoFocus style={{ marginTop: 12, fontSize: 13, lineHeight: 1.7 }}
                        value={editText} onChange={e => setEditText(e.target.value)} />
                  }
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                    <input type="checkbox" id={`edit-visible-${n.id}`} checked={editVisible}
                      onChange={e => setEditVisible(e.target.checked)}
                      style={{ width: 14, height: 14, accentColor: 'var(--gold)', cursor: 'pointer' }} />
                    <label htmlFor={`edit-visible-${n.id}`} style={{ fontSize: 12, color: 'var(--muted)', cursor: 'pointer', userSelect: 'none', flex: 1 }}>
                      Share with client
                    </label>
                    <button className="btn btn-outline btn-sm" onClick={cancelEdit}>Cancel</button>
                    <button className="btn btn-dark btn-sm" onClick={() => handleSaveEdit(n.id)} disabled={editSaving}>
                      {editSaving ? 'Saving…' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '14px 18px' }}>
                  {structured
                    ? <StructuredDisplay data={structured} />
                    : <>
                        <p style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--ink)', whiteSpace: 'pre-wrap', margin: 0 }}>{displayText}</p>
                        {needsCollapse && (
                          <button onClick={() => toggle(n.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0 0', fontSize: 12, color: 'var(--gold)' }}>
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

      {/* ── Delete confirmation modal ── */}
      {deleteTarget && (
        <Modal title="Delete Note" onClose={() => setDeleteTarget(null)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button className="btn btn-sm" style={{ background: '#b91c1c', color: '#fff', border: 'none' }}
              onClick={handleDeleteConfirm} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete Note'}
            </button>
          </>
        }>
          <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
            Are you sure you want to permanently delete this note?
          </p>
          {deleteTarget.preview && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }}>
              "{deleteTarget.preview}{deleteTarget.preview.length >= 60 ? '…' : ''}"
            </div>
          )}
          <p style={{ fontSize: 12, color: '#b91c1c', marginTop: 10, margin: '10px 0 0' }}>This action cannot be undone.</p>
        </Modal>
      )}
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

const CAT_CONFIG: Record<FileCategory, { bg: string; bar: string; icon: JSX.Element; action: string }> = {
  pdf:      { bg: '#fdf0ef', bar: '#c0392b', icon: <IconPdf />,   action: 'Download PDF' },
  video:    { bg: '#edf4fc', bar: '#7c4d9f', icon: <IconVideo />,  action: 'Watch Now' },
  document: { bg: '#f0f4f8', bar: '#2d6a9f', icon: <IconDoc />,    action: 'Open Document' },
  image:    { bg: '#f0f4ef', bar: '#4a7c59', icon: <IconImage />,  action: 'View Image' },
  link:     { bg: '#fdf9ed', bar: '#c9a84c', icon: <IconLink />,   action: 'Open Link' },
}
const LIB_VIS_C: Record<string, string> = {
  private: '#7c4d9f', owner_only: '#b91c1c', internal: '#2d6a9f', client_visible: '#4a7c59',
}
const LIB_VIS_L: Record<string, string> = {
  private: 'Just Me', owner_only: 'Owner Only', internal: 'All Coaches', client_visible: 'Client Visible',
}

type SelectedFile = { kind: 'client' | 'shared'; data: any }

function FileRow({ icon, bar, title, subtitle, badge, isSelected, onClick }: {
  icon: JSX.Element; bar: string; title: string; subtitle: string; badge?: JSX.Element
  isSelected: boolean; onClick: () => void
}) {
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer',
      borderBottom: '1px solid var(--border)', background: isSelected ? 'var(--gold-faint, #faf6ed)' : undefined,
    }}>
      <div style={{ width: 3, height: 30, background: bar, borderRadius: 2, flexShrink: 0 }} />
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
          <span style={{ whiteSpace: 'nowrap' }}>{subtitle}</span>
          {badge}
        </div>
      </div>
    </div>
  )
}

function FileVaultPreviewPanel({ selected, clientId, currentUser, canDelete, onClose, onRequestDelete, onEditInBrowser, onConvertToPdf, converting }: {
  selected: SelectedFile; clientId: string; currentUser: any; canDelete: boolean
  onClose: () => void; onRequestDelete: () => void; onEditInBrowser: () => void
  onConvertToPdf: () => void; converting: boolean
}) {
  const { data } = selected
  const isClient = selected.kind === 'client'
  const name  = isClient ? data.file_name : (data.file_name || data.title || '')
  const ext   = name.split('.').pop()?.toLowerCase() || ''
  const isPdf   = ext === 'pdf' || data.content_type === 'pdf'
  const isImage = ['jpg','jpeg','png','gif','webp'].includes(ext)
  const isVideo = ['mp4','mov','avi','mkv','webm','m4v'].includes(ext) || data.content_type === 'video'
  const isOfficeEditable = EDITABLE_OFFICE_EXTS.includes(ext)
  const isConvertible = isOfficeEditable && !isPdf
  const inlineUrl   = data.inline_url
  const downloadUrl = data.presigned_url || data.url
  const isOwner    = currentUser?.role === 'business_owner'
  const canEditFile = isClient && isOfficeEditable && (isOwner || data.uploaded_by === currentUser?.id)

  return (
    <div style={{
      width: '100%', display: 'flex', flexDirection: 'column',
      background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius, 8px)',
      overflow: 'hidden', position: 'sticky', top: 80, maxHeight: 'calc(100vh - 120px)',
    }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isClient ? data.file_name : (data.title || data.file_name)}
          </div>
          {!isClient && data.file_name && data.file_name !== data.title && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{data.file_name}</div>
          )}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, fontSize: 16 }}>×</button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {downloadUrl && isPdf && inlineUrl && (
          <iframe src={inlineUrl} style={{ width: '100%', height: 'max(560px, calc(100vh - 380px))', border: 'none', display: 'block' }} title={name} />
        )}
        {downloadUrl && isImage && inlineUrl && (
          <img src={inlineUrl} alt={name} style={{ width: '100%', maxHeight: 'max(460px, calc(100vh - 420px))', objectFit: 'contain', display: 'block', background: '#f8f8f8' }} />
        )}
        {downloadUrl && isVideo && inlineUrl && (
          <video src={inlineUrl} controls style={{ width: '100%', maxHeight: 'max(400px, calc(100vh - 420px))', display: 'block', background: '#000' }} />
        )}
        {downloadUrl && isOfficeEditable && !isPdf && (
          <InlineOfficeViewer
            itemKey={`${isClient ? 'client' : 'shared'}-${data.id}-${data.version}`}
            getEditConfig={(mode) => (isClient
              ? clientsApi.fileEditConfig(clientId, data.id, mode).then(r => r.data)
              : libraryApi.editConfig(data.id, mode).then(r => r.data))}
          />
        )}
        {!isClient && data.url && data.content_type === 'link' && (
          <div style={{ padding: '12px 16px' }}>
            <a href={data.url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm" style={{ width: '100%', justifyContent: 'center' }}>
              Open Link
            </a>
          </div>
        )}

        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            isClient ? { label: 'Type', value: FILE_TYPES.find(t => t.value === data.assessment_type)?.label || data.assessment_type } : null,
            { label: 'Version', value: `v${data.version || 1}` },
            isClient ? { label: 'Date', value: fmtDate(data.date || data.created_at) } : null,
            !isClient ? { label: 'Access', value: LIB_VIS_L[data.visibility] || data.visibility } : null,
            { label: 'Uploaded by', value: data.uploaded_by_name || '—' },
          ].filter(Boolean).map((row: any) => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: 'var(--muted)' }}>{row.label}</span>
              <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{row.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {canEditFile && (
          <button onClick={onEditInBrowser} className="btn btn-dark btn-sm" style={{ width: '100%', justifyContent: 'center', gap: 6, background: 'var(--gold)', borderColor: 'var(--gold)' }}>
            ✎ Edit live in browser
          </button>
        )}
        {isClient && isConvertible && (
          <button onClick={onConvertToPdf} disabled={converting} className="btn btn-outline btn-sm" style={{ width: '100%', justifyContent: 'center', gap: 6 }}>
            {converting ? 'Saving as PDF…' : '⇩ Save as PDF'}
          </button>
        )}
        {downloadUrl && (
          <a href={downloadUrl} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm" style={{ width: '100%', justifyContent: 'center', gap: 6, textDecoration: 'none' }}>
            ↓ Download
          </a>
        )}
        {isClient && canDelete && (
          <button onClick={onRequestDelete} className="btn btn-outline btn-sm" style={{ width: '100%', justifyContent: 'center', gap: 6, color: '#c0392b', borderColor: '#f5c6c2' }}>
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

function FileVault({ clientId, fileList, refetch, showToast, canDelete, currentUser }: { clientId: string; fileList: any[]; refetch: () => Promise<any>; showToast: any; canDelete: boolean; currentUser: any }) {
  const [section, setSection]       = useState<'client' | 'shared'>('client')
  const [uploading, setUploading]   = useState(false)
  const [fileType, setFileType]     = useState('other')
  const [dragOver, setDragOver]     = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [search, setSearch]         = useState('')
  const [confirmFile, setConfirmFile] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting]     = useState(false)
  const [editingFile, setEditingFile] = useState<any>(null)
  const [selected, setSelected]     = useState<SelectedFile | null>(null)
  const [converting, setConverting] = useState(false)
  const [showConvertPicker, setShowConvertPicker] = useState(false)

  const { data: libData } = useQuery({
    queryKey: ['library-shared-with-client', clientId],
    queryFn: () => libraryApi.items({ shared_with_client: clientId, page_size: 200 }).then(r => r.data),
  })
  const libItems: any[] = libData?.results || libData || []

  // Keep the selected preview pointed at up-to-date data (e.g. after edit-in-browser
  // bumps the version, or a delete/refetch removes the item entirely).
  useEffect(() => {
    if (!selected) return
    if (selected.kind === 'client') {
      const fresh = fileList.find(f => f.id === selected.data.id)
      if (!fresh) setSelected(null)
      else if (fresh !== selected.data) setSelected({ kind: 'client', data: fresh })
    } else {
      const fresh = libItems.find(f => f.id === selected.data.id)
      if (fresh && fresh !== selected.data) setSelected({ kind: 'shared', data: fresh })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileList, libItems])

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
      if (selected?.kind === 'client' && selected.data.id === confirmFile.id) setSelected(null)
      showToast('File deleted')
      setConfirmFile(null)
    } catch { showToast('Failed to delete', 'error') }
    finally { setDeleting(false) }
  }

  const handleConvertToPdf = async (assessmentType: string, visibleToClient: boolean) => {
    if (!selected || selected.kind !== 'client') return
    setConverting(true)
    try {
      const { data } = await clientsApi.convertFileToPdf(clientId, selected.data.id, {
        assessment_type: assessmentType, visible_to_client: visibleToClient,
      })
      await refetch()
      showToast(`Saved as ${data.file_name} — attach it from Client Communication`)
      setSelected({ kind: 'client', data })
      setShowConvertPicker(false)
    } catch (e: any) {
      showToast(e?.response?.data?.detail || 'Conversion failed', 'error')
    } finally { setConverting(false) }
  }

  const isNew = (d: string) => (Date.now() - new Date(d).getTime()) < 7 * 24 * 60 * 60 * 1000

  const filteredClient = fileList.filter(f =>
    !search || f.file_name?.toLowerCase().includes(search.toLowerCase()))
  const filteredLib = libItems.filter(f =>
    !search || f.title?.toLowerCase().includes(search.toLowerCase()) || f.file_name?.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      {/* Left column — folder-less explorer, mirrors Library's layout */}
      <div style={{ width: 360, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {(['client', 'shared'] as const).map(s => (
            <button key={s} onClick={() => { setSection(s); setSearch('') }} style={{
              flex: 1, padding: '8px 10px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: section === s ? 'var(--ink)' : 'var(--white)',
              color: section === s ? '#fff' : 'var(--muted)',
            }}>
              {s === 'client' ? `Client Files (${fileList.length})` : `Shared Files (${libItems.length})`}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
            <svg style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}
              width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={section === 'client' ? 'Search client files…' : 'Search shared files…'}
              className="finput" style={{ paddingLeft: 30, width: '100%', height: 32, fontSize: 12 }} />
          </div>
          {section === 'client' && (
            <button className="btn btn-outline btn-sm" onClick={() => setShowUpload(s => !s)} style={{ fontSize: 12, flexShrink: 0 }}>
              {showUpload ? 'Cancel' : '+ Upload'}
            </button>
          )}
        </div>

        {section === 'client' && showUpload && (
          <div className="card" style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              {FILE_TYPES.map(ft => (
                <button key={ft.value} onClick={() => setFileType(ft.value)} style={{
                  padding: '4px 10px', fontSize: 11, cursor: 'pointer', borderRadius: 4,
                  border: '1px solid var(--border)',
                  background: fileType === ft.value ? 'var(--ink)' : 'var(--white)',
                  color: fileType === ft.value ? 'var(--paper)' : 'var(--ink)',
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
                padding: '20px 14px', cursor: 'pointer', transition: '.2s', borderRadius: 6,
              }}>
              <input type="file" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = '' }} />
              {uploading ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>Uploading…</span> : (
                <>
                  <IconFile />
                  <span style={{ fontSize: 12, fontWeight: 500, marginTop: 6 }}>Drop or click to upload</span>
                  <span style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>Any file type — max 50 MB</span>
                </>
              )}
            </label>
          </div>
        )}

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
            {section === 'client' ? 'Client Files' : 'Shared with this client'}
          </div>
          {section === 'client' ? (
            filteredClient.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {search ? 'No files match your search' : 'No files yet — upload contracts, assessments, and reports.'}
                </div>
              </div>
            ) : (
              <div style={{ maxHeight: 'calc(100vh - 420px)', minHeight: 160, overflowY: 'auto' }}>
                {filteredClient.map((f: any) => {
                  const cat = fileCategory(f.file_name)
                  const { bar, icon } = CAT_CONFIG[cat]
                  const typeLabel = FILE_TYPES.find(t => t.value === f.assessment_type)?.label || f.assessment_type || cat
                  return (
                    <FileRow key={f.id}
                      icon={icon} bar={bar} title={f.file_name}
                      subtitle={`${typeLabel} · ${fmtDate(f.date || f.created_at)}`}
                      badge={isNew(f.created_at) ? (
                        <span style={{ fontWeight: 700, background: 'var(--gold)', color: 'var(--ink)', padding: '1px 5px', borderRadius: 3, fontSize: 9 }}>NEW</span>
                      ) : undefined}
                      isSelected={selected?.kind === 'client' && selected.data.id === f.id}
                      onClick={() => setSelected(prev => prev?.kind === 'client' && prev.data.id === f.id ? null : { kind: 'client', data: f })}
                    />
                  )
                })}
              </div>
            )
          ) : (
            filteredLib.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {search ? 'No files match your search' : "Nothing shared with this client yet — mark a Library file 'Client Visible' or share it specifically with them."}
                </div>
              </div>
            ) : (
              <div style={{ maxHeight: 'calc(100vh - 420px)', minHeight: 160, overflowY: 'auto' }}>
                {filteredLib.map((item: any) => {
                  const name = item.file_name || item.title || ''
                  const cat = item.content_type === 'link' ? 'link' as FileCategory : fileCategory(name)
                  const { bar, icon } = CAT_CONFIG[cat]
                  const vc = LIB_VIS_C[item.visibility] || '#8c8279'
                  const vl = LIB_VIS_L[item.visibility] || item.visibility
                  return (
                    <FileRow key={item.id}
                      icon={icon} bar={bar} title={item.title || name}
                      subtitle={item.uploaded_by_name || ''}
                      badge={<span style={{ fontWeight: 600, letterSpacing: '.02em', color: vc, background: `${vc}18`, padding: '1px 6px', borderRadius: 10, fontSize: 9.5 }}>{vl}</span>}
                      isSelected={selected?.kind === 'shared' && selected.data.id === item.id}
                      onClick={() => setSelected(prev => prev?.kind === 'shared' && prev.data.id === item.id ? null : { kind: 'shared', data: item })}
                    />
                  )
                })}
              </div>
            )
          )}
        </div>
      </div>

      {/* Right column — preview panel */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {selected ? (
          <FileVaultPreviewPanel
            selected={selected}
            clientId={clientId}
            currentUser={currentUser}
            canDelete={canDelete}
            converting={converting}
            onClose={() => setSelected(null)}
            onRequestDelete={() => selected.kind === 'client' && setConfirmFile({ id: selected.data.id, name: selected.data.file_name })}
            onEditInBrowser={() => selected.kind === 'client' && setEditingFile(selected.data)}
            onConvertToPdf={() => setShowConvertPicker(true)}
          />
        ) : (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 10, minHeight: 420, border: '1px dashed var(--border)', borderRadius: 8,
            background: '#fff', color: 'var(--muted)',
          }}>
            <IconFile />
            <div style={{ fontSize: 13 }}>Select a file to preview</div>
          </div>
        )}
      </div>

      {/* Live document editor */}
      {editingFile && (
        <OfficeEditorModal
          title={editingFile.file_name}
          getEditConfig={(mode) => clientsApi.fileEditConfig(clientId, editingFile.id, mode).then(r => r.data)}
          onClose={() => setEditingFile(null)}
          onSaved={() => refetch()}
        />
      )}

      {/* Delete confirmation */}
      {confirmFile && (
        <Modal title="Delete File" onClose={() => setConfirmFile(null)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setConfirmFile(null)}>Cancel</button>
            <button className="btn btn-sm" style={{ background: '#b91c1c', color: '#fff', border: 'none' }}
              onClick={handleDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button>
          </>
        }>
          <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            Delete <strong>"{confirmFile.name}"</strong>? This cannot be undone.
          </p>
        </Modal>
      )}

      {/* Save-as-PDF destination picker */}
      {showConvertPicker && selected?.kind === 'client' && (
        <SaveClientPdfModal
          defaultType={selected.data.assessment_type || 'other'}
          converting={converting}
          onClose={() => !converting && setShowConvertPicker(false)}
          onConvert={handleConvertToPdf}
        />
      )}
    </div>
  )
}

function SaveClientPdfModal({ defaultType, converting, onClose, onConvert }: {
  defaultType: string; converting: boolean; onClose: () => void
  onConvert: (assessmentType: string, visibleToClient: boolean) => void
}) {
  const [assessmentType, setAssessmentType] = useState(defaultType)
  const [visibleToClient, setVisibleToClient] = useState(false)

  return (
    <Modal title="Save as PDF" onClose={onClose} footer={
      <>
        <button className="btn btn-outline btn-sm" onClick={onClose} disabled={converting}>Cancel</button>
        <button className="btn btn-dark btn-sm" disabled={converting} onClick={() => onConvert(assessmentType, visibleToClient)}>
          {converting ? 'Converting…' : 'Save PDF'}
        </button>
      </>
    }>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
        Creates a new PDF file alongside the original — the original file is not changed.
      </div>
      <div className="fgroup">
        <label className="flabel">File type</label>
        <select className="fselect" value={assessmentType} onChange={e => setAssessmentType(e.target.value)}>
          {FILE_TYPES.map(ft => (
            <option key={ft.value} value={ft.value}>{ft.label}</option>
          ))}
        </select>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 10, cursor: 'pointer' }}>
        <input type="checkbox" checked={visibleToClient} onChange={e => setVisibleToClient(e.target.checked)} />
        Visible to client in portal
      </label>
    </Modal>
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = ['Overview', 'Goals', 'Activities', 'Notes', 'Files', 'Invoices', 'Client Communication']

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


// ── Client Communication ─────────────────────────────────────────────────────
// Draft/preview only — no send pipeline yet. Compose using a generic template
// tagged for 'client_communication' (Settings → Generic Templates), or start blank.
function ClientCommunicationPanel({ clientId, clientName, coachName }: { clientId: string; clientName: string; coachName: string }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const { workspace } = useAuthStore()
  const [editing, setEditing]   = useState<any>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [showFilePicker, setShowFilePicker] = useState(false)
  const [sending, setSending] = useState(false)
  const [showSendConfirm, setShowSendConfirm] = useState(false)
  const [showSigPad, setShowSigPad] = useState(false)
  const [viewingSignedPdf, setViewingSignedPdf] = useState<{ url: string; name: string } | null>(null)

  const { data: draftsData, isLoading } = useQuery({
    queryKey: ['client-message-drafts', clientId],
    queryFn: () => clientsApi.listMessageDrafts(clientId).then(r => r.data),
  })
  const drafts: any[] = draftsData?.results || draftsData || []
  const signedContracts = drafts.filter((d: any) => d.status === 'signed')
  const activeDrafts    = drafts.filter((d: any) => d.status !== 'signed')

  const { data: clientFilesData } = useQuery({
    queryKey: ['client-files', clientId],
    queryFn: () => clientsApi.listFiles(clientId).then(r => r.data),
  })
  const clientFiles: any[] = clientFilesData?.results || clientFilesData || []

  const genericTemplates: any[] = (workspace as any)?.generic_templates || []
  // Show every template assigned to Client Communication as a starting point here, not
  // just whichever one is currently "live" for the slot — template_use_case_map only
  // holds one active template per use case, but a coach may have several saved
  // (e.g. a friendly note AND a contract) they'd reasonably want to start from. Also
  // include unassigned templates (like a fresh Contract Agreement draft) since those
  // don't know their use case yet — but exclude templates tagged for a different,
  // incompatible use case (Booking Confirmation, Invoice, etc.), whose placeholders
  // wouldn't resolve in a free-form client message anyway.
  const commTemplates = genericTemplates.filter((t: any) =>
    !t.use_cases || t.use_cases.length === 0 || t.use_cases.includes('client_communication')
  )

  const renderPreview = async (d: any) => {
    setPreviewLoading(true)
    try {
      const { data } = await settingsApi.emailPreview('client_communication', {
        client_name: clientName, subject: d.subject, intro: d.intro, closing: d.closing,
        header_bg: d.style?.header_bg, accent_color: d.style?.accent_color,
        header_tagline: d.style?.header_tagline, hide_logo: d.show_logo ? undefined : '1',
        show_header: d.style?.show_header === false ? '0' : '1',
        show_footer: d.style?.show_footer === false ? '0' : '1',
        footer_text: d.style?.footer_text,
        // coach_signature is a data URL (can be tens of KB) — too large for a GET query
        // string, so the live preview doesn't render it; the compose form shows the
        // drawn signature directly instead, and the real send always includes it.
        include_client_signature_line: d.include_client_signature_line ? '1' : '0',
        coach_name: (d.signature_name || '').trim() || coachName || undefined,
        _t: Date.now(),
      })
      setPreviewHtml(data.html)
    } catch { setPreviewHtml('') }
    finally { setPreviewLoading(false) }
  }

  useEffect(() => {
    if (!editing) return
    const t = setTimeout(() => renderPreview(editing), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.subject, editing?.intro, editing?.closing, editing?.style?.header_bg, editing?.style?.accent_color,
      editing?.style?.header_tagline, editing?.style?.show_header,
      editing?.style?.show_footer, editing?.style?.footer_text, editing?.show_logo,
      editing?.include_client_signature_line, editing?.signature_name])

  const startBlank = () => {
    setEditing({
      subject: '', intro: '', closing: '', custom_html: '', disable_style: false, show_logo: true,
      style: {}, source_template_id: '', source_template_name: '', attachments: [],
      coach_signature: '', include_client_signature_line: false, signature_name: '',
    })
    setShowSigPad(false)
    setShowPicker(false)
  }

  const startFromTemplate = (t: any) => {
    setEditing({
      subject: t.subject || '', intro: t.intro || '', closing: t.closing || '',
      custom_html: t.custom_html || '', disable_style: t.disable_style || false, show_logo: t.show_logo ?? true,
      style: { ...(t.style || {}) }, source_template_id: t.id, source_template_name: t.name, attachments: [],
      coach_signature: '', include_client_signature_line: t.include_client_signature_line || false, signature_name: '',
    })
    setShowSigPad(false)
    setShowPicker(false)
  }

  const openNew  = () => { if (commTemplates.length > 0) setShowPicker(true); else startBlank() }
  const openEdit = (d: any) => {
    setEditing({ ...d, style: { ...(d.style || {}) } })
    setShowSigPad(!!d.coach_signature)
  }

  const saveDraft = async () => {
    const payload = {
      subject: editing.subject, intro: editing.intro, closing: editing.closing,
      custom_html: editing.custom_html, disable_style: editing.disable_style, show_logo: editing.show_logo,
      style: editing.style, source_template_id: editing.source_template_id || '',
      source_template_name: editing.source_template_name || '',
      coach_signature: editing.coach_signature || '',
      include_client_signature_line: !!editing.include_client_signature_line,
      signature_name: editing.signature_name || '',
    }
    const { data } = editing.id
      ? await clientsApi.updateMessageDraft(clientId, editing.id, payload)
      : await clientsApi.createMessageDraft(clientId, payload)
    setEditing(data)
    qc.invalidateQueries({ queryKey: ['client-message-drafts', clientId] })
    return data
  }

  const handleSaveDraft = async () => {
    setSaving(true)
    try {
      await saveDraft()
      show('Draft saved')
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Failed to save draft', 'error')
    } finally { setSaving(false) }
  }

  const handleSend = async () => {
    setSending(true)
    try {
      const saved = await saveDraft()
      await clientsApi.sendMessageDraft(clientId, saved.id)
      qc.invalidateQueries({ queryKey: ['client-message-drafts', clientId] })
      qc.invalidateQueries({ queryKey: ['client-activities', clientId] })
      show(`Email sent to ${clientName}`)
      setShowSendConfirm(false)
      setEditing(null)
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Failed to send email', 'error')
    } finally { setSending(false) }
  }

  const handleDeleteDraft = async (id: string) => {
    if (!confirm('Delete this draft?')) return
    await clientsApi.deleteMessageDraft(clientId, id)
    qc.invalidateQueries({ queryKey: ['client-message-drafts', clientId] })
    if (editing?.id === id) setEditing(null)
    show('Draft deleted')
  }

  const handleAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !editing?.id) { e.target.value = ''; return }
    setAttaching(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const { data } = await clientsApi.attachToMessageDraft(clientId, editing.id, fd)
      setEditing(data)
      qc.invalidateQueries({ queryKey: ['client-message-drafts', clientId] })
    } catch (err: any) {
      show(err?.response?.data?.detail || 'Failed to attach file', 'error')
    } finally { setAttaching(false); e.target.value = '' }
  }

  const handleRemoveAttachment = async (s3_key: string) => {
    if (!editing?.id) return
    const { data } = await clientsApi.removeMessageAttachment(clientId, editing.id, s3_key)
    setEditing(data)
    qc.invalidateQueries({ queryKey: ['client-message-drafts', clientId] })
  }

  const handleAttachExisting = async (assessmentId: string) => {
    if (!editing?.id) return
    setAttaching(true)
    try {
      const { data } = await clientsApi.attachExistingFileToMessageDraft(clientId, editing.id, assessmentId)
      setEditing(data)
      qc.invalidateQueries({ queryKey: ['client-message-drafts', clientId] })
      setShowFilePicker(false)
    } catch (err: any) {
      show(err?.response?.data?.detail || 'Failed to attach file', 'error')
    } finally { setAttaching(false) }
  }

  if (editing) {
    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300 }}>
            {editing.id ? 'Edit Draft' : 'New Message'}
            {editing.source_template_name && (
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 10, fontFamily: "'DM Sans', sans-serif" }}>
                from "{editing.source_template_name}"
              </span>
            )}
            {editing.status === 'sent' && editing.sent_at && (
              <span style={{ fontSize: 11, color: '#4a7c59', marginLeft: 10, fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>
                ✓ Sent {new Date(editing.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            )}
            {editing.status === 'signed' && editing.client_signed_at && (
              <span style={{ fontSize: 11, color: '#4a7c59', marginLeft: 10, fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>
                ✓ Signed by client {new Date(editing.client_signed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                {editing.signed_pdf_url && (
                  <>
                    {' · '}
                    <a
                      href={editing.signed_pdf_url}
                      onClick={e => { e.preventDefault(); setViewingSignedPdf({ url: editing.signed_pdf_url, name: editing.signed_pdf_name || 'Signed contract' }) }}
                      style={{ color: '#4a7c59', cursor: 'pointer' }}
                    >
                      View signed PDF
                    </a>
                  </>
                )}
              </span>
            )}
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => setEditing(null)}>← Back to drafts</button>
        </div>

        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          <div className="card" style={{ flex: 1, minWidth: 0, maxWidth: 480 }}>
            <div className="card-body">
              <div className="fgroup">
                <label className="flabel">Subject</label>
                <input className="finput" value={editing.subject} onChange={e => setEditing({ ...editing, subject: e.target.value })} placeholder="e.g. Following up on our session" />
              </div>
              <div className="fgroup">
                <label className="flabel">Message</label>
                <textarea className="ftextarea" rows={6} value={editing.intro} onChange={e => setEditing({ ...editing, intro: e.target.value })} placeholder={`Hi ${clientName.split(' ')[0] || ''}, ...`} />
              </div>
              <div className="fgroup">
                <label className="flabel">Closing <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span></label>
                <textarea className="ftextarea" rows={2} value={editing.closing} onChange={e => setEditing({ ...editing, closing: e.target.value })} placeholder="Talk soon," />
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>
                  Attachments
                </div>
                {(editing.attachments || []).length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                    {editing.attachments.map((a: any) => (
                      <div key={a.s3_key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '6px 10px', background: 'var(--paper)', borderRadius: 4 }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.file_name}</span>
                        <button onClick={() => handleRemoveAttachment(a.s3_key)} style={{ background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer', fontSize: 11 }}>Remove</button>
                      </div>
                    ))}
                  </div>
                )}
                {editing.id ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <label className="btn btn-outline btn-sm" style={{ display: 'inline-flex', cursor: attaching ? 'not-allowed' : 'pointer' }}>
                      <input type="file" style={{ display: 'none' }} onChange={handleAttach} disabled={attaching} />
                      {attaching ? 'Uploading…' : '+ From Computer'}
                    </label>
                    <button className="btn btn-outline btn-sm" disabled={attaching} onClick={() => setShowFilePicker(true)}>
                      + From Client Files
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Save the draft first to attach files.</div>
                )}
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>
                  Signature
                </div>
                <div className="fgroup">
                  <label className="flabel">Sign as <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span></label>
                  <input className="finput" value={editing.signature_name || ''}
                    onChange={e => setEditing({ ...editing, signature_name: e.target.value })}
                    placeholder={coachName || 'Coach name'} />
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                    Appears as "— {editing.signature_name || coachName || 'name'}" at the close of the email. Leave blank to use your account name.
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink)', cursor: 'pointer', marginBottom: showSigPad ? 10 : 0 }}>
                  <input type="checkbox" checked={showSigPad}
                    onChange={e => {
                      setShowSigPad(e.target.checked)
                      if (!e.target.checked) setEditing({ ...editing, coach_signature: '' })
                    }} />
                  Include your signature
                </label>
                {showSigPad && (
                  <div className="fgroup">
                    <label className="flabel">Draw your signature</label>
                    <SignaturePad value={editing.coach_signature || ''} onChange={v => setEditing({ ...editing, coach_signature: v })} />
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                      Drawn here, not a legally binding e-signature — just an image included in the email.
                    </div>
                  </div>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink)', cursor: 'pointer', marginTop: 10 }}>
                  <input type="checkbox" checked={!!editing.include_client_signature_line}
                    onChange={e => setEditing({ ...editing, include_client_signature_line: e.target.checked })} />
                  Include a signature line for {clientName.split(' ')[0] || 'the client'}
                </label>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, marginLeft: 22 }}>
                  Prints a blank "Client Signature: ____  Date: ____" line — useful for contracts sent to print and sign.
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
                <button className="btn btn-outline" onClick={handleSaveDraft} disabled={saving || sending}>{saving ? 'Saving…' : 'Save Draft'}</button>
                <button className="btn btn-dark" onClick={() => setShowSendConfirm(true)} disabled={saving || sending}>
                  {sending ? 'Sending…' : 'Send Email'}
                </button>
              </div>
            </div>
          </div>

          <div className="card" style={{ flex: 1, minWidth: 0, position: 'sticky', top: 80, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Preview {previewLoading && '· updating…'}
            </div>
            <iframe title="preview" srcDoc={previewHtml} style={{ width: '100%', height: 560, border: 'none', display: 'block' }} />
          </div>
        </div>

        {showFilePicker && (
          <Modal title="Attach a Client File" onClose={() => setShowFilePicker(false)}>
            {clientFiles.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>No files uploaded for this client yet — see the Files tab.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
                {clientFiles.map((f: any) => {
                  const already = (editing.attachments || []).some((a: any) => a.file_name === f.file_name)
                  return (
                    <button key={f.id} disabled={attaching || already}
                      onClick={() => handleAttachExisting(f.id)}
                      className="btn btn-outline btn-sm"
                      style={{ justifyContent: 'space-between', width: '100%', opacity: already ? 0.5 : 1 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0, marginLeft: 8 }}>{already ? 'Attached' : 'Attach'}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </Modal>
        )}

        {showSendConfirm && (
          <Modal title="Send Email" onClose={() => !sending && setShowSendConfirm(false)} footer={
            <>
              <button className="btn btn-outline btn-sm" onClick={() => setShowSendConfirm(false)} disabled={sending}>Cancel</button>
              <button className="btn btn-dark btn-sm" onClick={handleSend} disabled={sending}>{sending ? 'Sending…' : 'Send Now'}</button>
            </>
          }>
            <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>
              Send this email to <strong>{clientName}</strong>
              {(editing.subject || '').trim() && <> — subject "<strong>{editing.subject}</strong>"</>}?
              This will save the draft and email it right away.
            </p>
          </Modal>
        )}

        {viewingSignedPdf && (
          <Modal title={viewingSignedPdf.name} onClose={() => setViewingSignedPdf(null)} size="lg" footer={
            <a href={viewingSignedPdf.url} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">Open in new tab</a>
          }>
            <iframe src={viewingSignedPdf.url} title={viewingSignedPdf.name} style={{ width: '100%', height: '75vh', border: 'none', display: 'block' }} />
          </Modal>
        )}
      </>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300 }}>Client Communication</div>
        <button className="btn btn-dark btn-sm" onClick={openNew}>+ New Message</button>
      </div>
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
      ) : drafts.length === 0 ? (
        <EmptyState icon="✉" title="No drafts yet" message="Compose a message for this client — save it as a draft to send later" />
      ) : (
        <>
          {signedContracts.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>
                Signed Contracts
              </div>
              <table className="tbl">
                <thead><tr><th>Subject</th><th>File</th><th>Signed</th><th></th></tr></thead>
                <tbody>
                  {signedContracts.map((d: any) => (
                    <tr key={d.id} onClick={() => d.signed_pdf_url && setViewingSignedPdf({ url: d.signed_pdf_url, name: d.signed_pdf_name || d.subject || 'Signed contract' })} style={{ cursor: d.signed_pdf_url ? 'pointer' : 'default' }}>
                      <td style={{ fontWeight: 600 }}>{d.subject || '(no subject)'}</td>
                      <td style={{ color: 'var(--muted)', fontSize: 12 }}>{d.signed_pdf_name || '—'}</td>
                      <td style={{ fontSize: 12, color: '#4a7c59', fontWeight: 600 }}>
                        ✓ {d.client_signed_at ? new Date(d.client_signed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                      </td>
                      <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => handleDeleteDraft(d.id)} style={{ background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer', fontSize: 12 }}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeDrafts.length > 0 && (
            <div>
              {signedContracts.length > 0 && (
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>
                  Drafts
                </div>
              )}
              <table className="tbl">
                <thead><tr><th>Subject</th><th>Status</th><th>Source Template</th><th>Last Updated</th><th></th></tr></thead>
                <tbody>
                  {activeDrafts.map((d: any) => (
                    <tr key={d.id} onClick={() => openEdit(d)} style={{ cursor: 'pointer' }}>
                      <td style={{ fontWeight: 600 }}>{d.subject || '(no subject)'}</td>
                      <td>
                        {d.status === 'sent'
                          ? <span style={{ fontSize: 11, fontWeight: 600, color: '#4a7c59' }}>✓ Sent</span>
                          : <span style={{ fontSize: 11, color: 'var(--muted)' }}>Draft</span>}
                      </td>
                      <td style={{ color: 'var(--muted)', fontSize: 12 }}>{d.source_template_name || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(d.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => handleDeleteDraft(d.id)} style={{ background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer', fontSize: 12 }}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {showPicker && (
        <Modal title="Start from a template?" onClose={() => setShowPicker(false)}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
            Pick a saved template to pre-fill the subject and message below — you can still edit
            everything before sending. Or start with a blank message instead.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {commTemplates.map((t: any) => (
              <button key={t.id} onClick={() => startFromTemplate(t)} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                padding: '10px 14px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                border: '1px solid var(--border)', background: 'var(--white)',
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{t.name}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>Pre-fills subject, message, and styling from this template</span>
              </button>
            ))}
            <button onClick={startBlank} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
              padding: '10px 14px', borderRadius: 6, cursor: 'pointer', textAlign: 'left', marginTop: 4,
              border: '1px dashed var(--border)', background: 'var(--paper)',
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Start blank</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Empty subject and message — write it from scratch</span>
            </button>
          </div>
        </Modal>
      )}

      {viewingSignedPdf && (
        <Modal title={viewingSignedPdf.name} onClose={() => setViewingSignedPdf(null)} size="lg" footer={
          <a href={viewingSignedPdf.url} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">Open in new tab</a>
        }>
          <iframe src={viewingSignedPdf.url} title={viewingSignedPdf.name} style={{ width: '100%', height: '75vh', border: 'none', display: 'block' }} />
        </Modal>
      )}
    </>
  )
}

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { show: showToast, el: toastEl } = useToast()
  const { user, workspace } = useAuthStore()
  const isOwner = user?.role === 'business_owner'
  // Invoices sub-tab follows the same per-tab RBAC grant as the standalone Invoices
  // page — a coach without it granted shouldn't see client invoices or be able to
  // create one from inside the Clients tab either. Client Communication has no
  // dedicated tab permission yet, so it's owner-only for now (same call made for the
  // Email Communication page).
  const canViewInvoices = isOwner || !!user?.tab_permissions?.invoices?.view
  const canEditInvoices = isOwner || !!user?.tab_permissions?.invoices?.edit
  const canViewClientComm = isOwner
  const visibleTabs = TABS.filter(t =>
    (t !== 'Invoices' || canViewInvoices) && (t !== 'Client Communication' || canViewClientComm)
  )
  const tz: string | undefined = (workspace as any)?.workspace_timezone || undefined
  const [tab, setTab] = useState('Overview')
  const [showActivity, setShowActivity] = useState(false)
  const [showGoal, setShowGoal]       = useState(false)
  const [editingGoal, setEditingGoal] = useState<any>(null)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState<Client | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showInviteConfirm, setShowInviteConfirm] = useState(false)
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const [reminding, setReminding] = useState<string | null>(null)

  const handleRemind = async (e: React.MouseEvent, invId: string) => {
    e.stopPropagation()
    setReminding(invId)
    try {
      await invoicesApi.remind(invId)
      showToast('Reminder sent')
    } catch { showToast('Failed to send reminder', 'error') }
    finally { setReminding(null) }
  }

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
    enabled: (tab === 'Invoices' || tab === 'Overview') && canViewInvoices,
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
      // A cleared date input sends '' — the model's birth_date is a nullable DateField,
      // and DRF rejects '' as "wrong format" for a date, so normalize to null.
      const payload = { ...editForm, birth_date: (editForm as any)?.birth_date || null }
      await clientsApi.update(id!, payload)
      qc.invalidateQueries({ queryKey: ['client', id] })
      qc.invalidateQueries({ queryKey: ['clients'] })
      setEditMode(false)
      showToast('Client updated')
    } catch (err: any) {
      const data = err.response?.data
      if (data) {
        const msg = Object.entries(data)
          .filter(([k]) => k !== 'detail')
          .map(([, v]) => (Array.isArray(v) ? v[0] : v))
          .join(' ') || data.detail || 'Failed to save'
        showToast(String(msg), 'error')
      } else {
        showToast('Failed to save', 'error')
      }
    }
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
  // Overview widget is a compact summary card, not the full ledger — show only the
  // 5 most recently created invoices (mixed statuses), with a link to the full list.
  const top5Invoices: any[] = [...invList]
    .sort((a, b) => parseInvoiceDate(b.created_at).getTime() - parseInvoiceDate(a.created_at).getTime())
    .slice(0, 5)
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
      .filter(i => i._date && !(i._type === 'activity' && i.activity_type === 'call'))
      .sort((a, b) => new Date(b._date).getTime() - new Date(a._date).getTime())
      .slice(0, 6)
  }, [actList, invList])

  if (isLoading) return <AppShell><div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div></AppShell>
  if (!client) return <AppShell><div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>Client not found</div></AppShell>

  const ef: Client = editForm || client!

  return (
    <AppShell>
      {/* Profile Header */}
      <div style={{ background: '#f7f4ef', borderBottom: '1px solid var(--border)' }}>
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
                  <button className="btn btn-outline btn-sm" onClick={() => {
                    if (client.portal_access) setShowRevokeConfirm(true)
                    else setShowInviteConfirm(true)
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
            {visibleTabs.map(t => (
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>

              {/* CLIENT DETAILS — row 1, col 1 */}
              <div className="card" style={{ gridColumn: 1, gridRow: 1 }}>
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
                        <label className="flabel">Email 1</label>
                        <input className="finput" value={ef.email || ''} onChange={e => setEditForm((f: any) => ({ ...f, email: e.target.value }))} />
                      </div>
                      <div className="fgroup" style={{ marginBottom: 14 }}>
                        <label className="flabel">Email 2</label>
                        <input className="finput" value={(ef as any).email_2 || ''} onChange={e => setEditForm((f: any) => ({ ...f, email_2: e.target.value }))} />
                      </div>
                    </div>
                    {/* Phone 1 / Phone 2 — each number+ext+type grouped on its own row
                        (same pattern as the address street/city/state/zip rows below)
                        instead of interleaved through the 2-col grid, which scattered
                        each phone's 3 fields across 2 separate rows out of order. */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 92px 1fr', gap: '0 16px' }}>
                      <div className="fgroup" style={{ marginBottom: 14 }}>
                        <label className="flabel">Phone 1</label>
                        <input className="finput" value={ef.phone || ''} onChange={e => setEditForm((f: any) => ({ ...f, phone: e.target.value }))} />
                      </div>
                      <div className="fgroup" style={{ marginBottom: 14 }}>
                        <label className="flabel">Phone 1 Ext</label>
                        <input className="finput" value={(ef as any).phone_ext || ''} onChange={e => setEditForm((f: any) => ({ ...f, phone_ext: e.target.value }))} />
                      </div>
                      <div className="fgroup" style={{ marginBottom: 14 }}>
                        <label className="flabel">Phone 1 Type</label>
                        <select className="fselect" value={(ef as any).phone_type || ''} onChange={e => setEditForm((f: any) => ({ ...f, phone_type: e.target.value }))}>
                          <option value="">Select type…</option>
                          {PHONE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="fgroup" style={{ marginBottom: 14 }}>
                        <label className="flabel">Phone 2</label>
                        <input className="finput" value={(ef as any).phone_2 || ''} onChange={e => setEditForm((f: any) => ({ ...f, phone_2: e.target.value }))} />
                      </div>
                      <div className="fgroup" style={{ marginBottom: 14 }}>
                        <label className="flabel">Phone 2 Ext</label>
                        <input className="finput" value={(ef as any).phone_2_ext || ''} onChange={e => setEditForm((f: any) => ({ ...f, phone_2_ext: e.target.value }))} />
                      </div>
                      <div className="fgroup" style={{ marginBottom: 14 }}>
                        <label className="flabel">Phone 2 Type</label>
                        <select className="fselect" value={(ef as any).phone_2_type || ''} onChange={e => setEditForm((f: any) => ({ ...f, phone_2_type: e.target.value }))}>
                          <option value="">Select type…</option>
                          {PHONE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                      <div className="fgroup" style={{ marginBottom: 14 }}>
                        <label className="flabel">Status</label>
                        <select className="fselect" value={(ef as any).status || 'Lead'} onChange={e => setEditForm((f: any) => ({ ...f, status: e.target.value }))}>
                          {(statusConfigs as any[]).map((s: any) => <option key={s.label} value={s.label}>{s.label}</option>)}
                          {(statusConfigs as any[]).length === 0 && <option value="Lead">Lead</option>}
                        </select>
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
                      <div className="fgroup" style={{ marginBottom: 14 }}>
                        <label className="flabel">Birth Date</label>
                        <input className="finput" type="date" value={(ef as any).birth_date || ''} onChange={e => setEditForm((f: any) => ({ ...f, birth_date: e.target.value }))} />
                      </div>
                    </div>
                    {(() => {
                      const addr = (ef as any).primary_address || {}
                      const setAddr = (k: string, v: string) =>
                        setEditForm((f: any) => ({ ...f, primary_address: { ...(f.primary_address || {}), [k]: v } }))
                      return (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px' }}>
                          <div className="fgroup" style={{ marginBottom: 14, gridColumn: '1 / -1' }}>
                            <label className="flabel">Street Address 1</label>
                            <input className="finput" value={addr.street || ''} onChange={e => setAddr('street', e.target.value)} placeholder="123 Main St" />
                          </div>
                          <div className="fgroup" style={{ marginBottom: 14, gridColumn: '1 / -1' }}>
                            <label className="flabel">Street Address 2</label>
                            <input className="finput" value={addr.street2 || ''} onChange={e => setAddr('street2', e.target.value)} placeholder="Apt, suite, unit, etc. (optional)" />
                          </div>
                          <div className="fgroup" style={{ marginBottom: 14 }}>
                            <label className="flabel">City</label>
                            <input className="finput" value={addr.city || ''} onChange={e => setAddr('city', e.target.value)} placeholder="New York" />
                          </div>
                          <div className="fgroup" style={{ marginBottom: 14 }}>
                            <label className="flabel">State</label>
                            <input className="finput" value={addr.state || ''} onChange={e => setAddr('state', e.target.value)} placeholder="New York" />
                          </div>
                          <div className="fgroup" style={{ marginBottom: 14 }}>
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
                      {(() => {
                        const fmtPhone = (num: string, ext: string, type: string) => {
                          if (!num) return '—'
                          // Some imported numbers already carry their type inline, e.g.
                          // "(801) 815-7599   (Work)" — appending the phone_type field
                          // on top of that duplicates it as "...(Work) (Work)".
                          const typeAlreadyInNumber = !!type && num.toLowerCase().includes(type.toLowerCase())
                          return [num, ext ? `x${ext}` : '', (type && !typeAlreadyInNumber) ? `(${type})` : ''].filter(Boolean).join(' ')
                        }
                        const rows = [
                          { label: 'Email 1', value: client.email },
                          ...((client as any).email_2 ? [{ label: 'Email 2', value: (client as any).email_2 }] : []),
                          { label: 'Phone 1', value: fmtPhone(client.phone || '', (client as any).phone_ext || '', (client as any).phone_type || '') },
                          ...((client as any).phone_2 ? [{ label: 'Phone 2', value: fmtPhone((client as any).phone_2, (client as any).phone_2_ext || '', (client as any).phone_2_type || '') }] : []),
                          { label: 'Company', value: client.company || '—' },
                          { label: 'Title',   value: client.job_title || '—' },
                          { label: 'Status',  value: (client as any).status || 'Lead' },
                          { label: 'Source',  value: client.lead_source ? client.lead_source.charAt(0).toUpperCase() + client.lead_source.slice(1) : '—' },
                          { label: 'Birth Date', value: client.birth_date ? fmtDate(client.birth_date) : '—' },
                          { label: 'Coach',   value: (client as any).coach_name || '—' },
                          { label: 'Portal',  value: client.portal_access ? 'Enabled' : 'Not invited' },
                        ]
                        return rows.map(({ label, value }) => (
                          <div key={label} style={{ display: 'flex', flexDirection: 'column', padding: '10px 0', borderBottom: '1px solid #f3f0eb' }}>
                            <span style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>{label}</span>
                            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{value}</span>
                          </div>
                        ))
                      })()}
                    </div>
                    {(() => {
                      const addr = (client as any).primary_address || {}
                      const full = [addr.street, addr.street2, [addr.city, addr.state, addr.zip].filter(Boolean).join(', ')].filter(Boolean).join(', ')
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

              {/* ENGAGEMENT HISTORY — row 1, col 2 */}
              <div className="card" style={{ gridColumn: 2, gridRow: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>Engagement History</span>
                  <button onClick={() => setTab('Activities')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--muted)', fontFamily: "'DM Sans', sans-serif" }}>
                    View all →
                  </button>
                </div>
                <div>
                  {timeline.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--muted)', padding: '16px 20px' }}>
                      No history yet.{' '}
                      <button onClick={() => setShowActivity(true)} style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans', sans-serif", padding: 0 }}>
                        Schedule a session →
                      </button>
                    </div>
                  ) : timeline.map((item: any, idx: number) => {
                    const dotColor = item._type === 'invoice' ? '#3a6ea8' : actDotColor(item.status)
                    const statusLabel = item.status || ''
                    const statusColor: Record<string, string> = {
                      completed: '#2d6a4a', scheduled: '#b8922e', missed: '#c0392b',
                      cancelled: '#8c8279', paid: '#2d6a4a', sent: '#2d6a9f', overdue: '#c0392b', draft: '#8c8279',
                    }
                    const sc = statusColor[statusLabel] || '#8c8279'
                    const label = item._type === 'activity'
                      ? (item.activity_type || 'session').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
                      : `Invoice ${item.number}`
                    const sub = item._type === 'activity'
                      ? fmtDatetime(item.start_at)
                      : `${item.total ? `$${parseFloat(item.total).toLocaleString()}` : '—'} · ${fmtDate(item.issue_date || item.created_at)}`
                    return (
                      <div key={`${item._type}-${item.id}`} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 20px',
                        borderBottom: idx < timeline.length - 1 ? '1px solid #f3f0eb' : 'none',
                      }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: dotColor }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                            <span style={{ fontSize: 9.5, fontWeight: 700, color: sc, background: sc + '15', border: `1px solid ${sc}28`, borderRadius: 10, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', flexShrink: 0 }}>
                              {statusLabel}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{sub}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* INVOICES — row 2, col 1 */}
              {canViewInvoices && (
              <div className="card" style={{ gridColumn: 1, gridRow: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                    Invoices{invList.length > 5 ? ` (${top5Invoices.length} of ${invList.length})` : ''}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {invList.length > 5 && (
                      <button onClick={() => setTab('Invoices')}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--muted)', fontFamily: "'DM Sans', sans-serif" }}>
                        View all →
                      </button>
                    )}
                    {canEditInvoices && (
                      <button className="btn btn-dark btn-sm" onClick={() => navigate('/invoices/new', { state: { clientId: id } })}>+ New</button>
                    )}
                  </div>
                </div>
                {invList.length === 0 ? (
                  <div style={{ padding: '20px', fontSize: 13, color: 'var(--muted)' }}>No invoices yet.</div>
                ) : (
                  <div style={{ padding: 16, overflowX: 'auto' }}>
                    <InvoiceTables
                      invoices={top5Invoices} clients={[]} navigate={navigate}
                      handleRemind={handleRemind} reminding={reminding}
                      showClientColumn={false}
                    />
                  </div>
                )}
              </div>
              )}

              {/* PIPELINE DEAL — row 2, col 2 */}
              {deal && (() => {
                const stageConfig = stageMap[deal.stage]
                const stageLabel  = stageConfig?.label || (deal.stage || '').replace(/_/g, ' ')
                const stageColor  = stageConfig?.color || '#1B3A6B'
                const dealValue   = deal.deal_value ? parseFloat(deal.deal_value) : null
                return (
                  <div className="card" style={{ gridColumn: 2, gridRow: 2 }}>
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
                      {g.visible_to_client && <span className="pill pill-green" style={{ fontSize: 10 }}>Shared</span>}
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
          <FileVault clientId={id!} fileList={fileList} refetch={refetchFiles} showToast={showToast} canDelete={canDelete} currentUser={me} />
        )}

        {/* ── Invoices ── */}
        {tab === 'Invoices' && canViewInvoices && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 300 }}>Invoices</div>
              {canEditInvoices && (
                <button className="btn btn-dark btn-sm" onClick={() => navigate('/invoices/new', { state: { clientId: id } })}>
                  + Create Invoice
                </button>
              )}
            </div>
            {invList.length === 0
              ? <EmptyState icon="$" title="No invoices" message="Create the first invoice for this client" />
              : (
                <InvoiceTables
                  invoices={invList} clients={[]} navigate={navigate}
                  handleRemind={handleRemind} reminding={reminding}
                  showClientColumn={false}
                />
              )
            }
          </>
        )}

        {tab === 'Client Communication' && canViewClientComm && (
          <ClientCommunicationPanel clientId={id!} clientName={`${client.first_name} ${client.last_name}`} coachName={(client as any).coach_name || ''} />
        )}
      </div>

      {showActivity && <NewActivityModal clientId={id} defaultCoachId={(client as any)?.coach} clientName={client ? `${client.first_name} ${client.last_name}` : ''} onClose={() => setShowActivity(false)} onSaved={(emailSent?: boolean) => { setShowActivity(false); showToast(emailSent ? 'Session scheduled — confirmation sent to client' : 'Session scheduled') }} />}
      {showGoal && <GoalModal clientId={id} onClose={() => setShowGoal(false)} onSaved={() => { setShowGoal(false); showToast('Goal created') }} />}
      {editingGoal && <GoalModal clientId={id} goal={editingGoal} onClose={() => setEditingGoal(null)} onSaved={() => { setEditingGoal(null); showToast('Goal updated') }} />}
      {showDeleteConfirm && (
        <Modal title="Delete Client" onClose={() => !deleting && setShowDeleteConfirm(false)}>
          <div style={{ padding: '4px 0 20px', fontSize: 14, color: 'var(--ink)', lineHeight: 1.6 }}>
            Permanently delete <strong>{client.first_name} {client.last_name}</strong>? This cannot be undone — all their sessions, notes, invoices, pipeline deals, and files will be removed.
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
      {showInviteConfirm && (
        <Modal title="Invite to Portal" onClose={() => !portalLoading && setShowInviteConfirm(false)}>
          <div style={{ padding: '4px 0 20px', fontSize: 14, color: 'var(--ink)', lineHeight: 1.6 }}>
            Send a portal invite to <strong>{client.first_name} {client.last_name}</strong> at <strong>{client.email}</strong>? They will receive an email with a link to access their client portal.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline btn-sm" onClick={() => setShowInviteConfirm(false)} disabled={portalLoading}>Cancel</button>
            <button
              className="btn btn-dark btn-sm"
              disabled={portalLoading}
              onClick={async () => {
                setPortalLoading(true)
                try {
                  await clientsApi.invitePortal(id!)
                  await qc.invalidateQueries({ queryKey: ['client', id] })
                  showToast('Portal invite sent')
                  setShowInviteConfirm(false)
                } finally {
                  setPortalLoading(false)
                }
              }}
            >{portalLoading ? 'Sending…' : 'Send Invite'}</button>
          </div>
        </Modal>
      )}
      {showRevokeConfirm && (
        <Modal title="Revoke Portal Access" onClose={() => !portalLoading && setShowRevokeConfirm(false)}>
          <div style={{ padding: '4px 0 20px', fontSize: 14, color: 'var(--ink)', lineHeight: 1.6 }}>
            Remove portal access for <strong>{client.first_name} {client.last_name}</strong>? They will no longer be able to log in to the client portal.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline btn-sm" onClick={() => setShowRevokeConfirm(false)} disabled={portalLoading}>Cancel</button>
            <button
              className="btn btn-sm"
              disabled={portalLoading}
              onClick={async () => {
                setPortalLoading(true)
                try {
                  await clientsApi.revokePortal(id!)
                  await qc.invalidateQueries({ queryKey: ['client', id] })
                  showToast('Portal access removed')
                  setShowRevokeConfirm(false)
                } finally {
                  setPortalLoading(false)
                }
              }}
              style={{ background: '#c0392b', color: '#fff', border: 'none' }}
            >{portalLoading ? 'Revoking…' : 'Revoke Access'}</button>
          </div>
        </Modal>
      )}
      {toastEl}
    </AppShell>
  )
}
