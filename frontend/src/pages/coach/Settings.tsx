import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, authApi, settingsApi, invoicesApi, auditApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { PageHeader, Modal, useToast } from '../../components/ui'
import { useAuthStore } from '../../store/auth'
import { BUILTIN_TEXT } from '../../constants/emailStarters'
import { useEmailUseCases, type EmailStarter } from '../../hooks/useEmailUseCases'
import { User, Shield, Building2, Mail, Plus, Pencil, Trash2, Kanban, CalendarDays, ClipboardList, Copy } from 'lucide-react'

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Toronto', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney',
]

const ROLE_LABELS: Record<string, string> = {
  business_owner: 'Business Owner',
  coach:          'Coach',
  assistant:      'Assistant',
}
const ROLE_COLORS: Record<string, string> = {
  business_owner: '#c9a84c',
  coach:          '#2d6a9f',
  assistant:      '#4a7c59',
}

// ── Workspace Tab ──────────────────────────────────────────────────────────────
function WorkspaceTab() {
  const { workspace, rehydrate, user } = useAuthStore()
  const { show } = useToast()
  const [form, setForm] = useState({
    name:               workspace?.name                || '',
    workspace_timezone: workspace?.workspace_timezone  || 'America/New_York',
    cancellation_hours: workspace?.cancellation_hours  ?? 48,
    buffer_minutes:     workspace?.buffer_minutes      ?? 15,
    reschedule_request_ttl_days: (workspace as any)?.reschedule_request_ttl_days ?? '',
    address:            (workspace as any)?.address    || '',
    city:               (workspace as any)?.city       || '',
    state:              (workspace as any)?.state      || '',
    zip_code:           (workspace as any)?.zip_code   || '',
  })
  const [saving, setSaving] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoData, setLogoData] = useState<string>((workspace as any)?.logo_data || '')
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))
  const isOwner = user?.role === 'business_owner'

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        ...form,
        reschedule_request_ttl_days: form.reschedule_request_ttl_days === '' ? null : Number(form.reschedule_request_ttl_days),
      }
      const { data } = await settingsApi.updateWorkspace(payload)
      if (user) rehydrate(user, { ...workspace, ...data })
      show('Workspace settings saved')
    } catch { show('Failed to save', 'error') }
    finally { setSaving(false) }
  }

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { show('Logo must be under 2 MB', 'error'); return }
    setLogoUploading(true)
    try {
      const { data } = await settingsApi.uploadLogo(file)
      setLogoData(data.logo_data)
      if (user && workspace) rehydrate(user, { ...workspace, logo_data: data.logo_data })
      show('Logo updated')
    } catch { show('Failed to upload logo', 'error') }
    finally { setLogoUploading(false); e.target.value = '' }
  }

  const handleRemoveLogo = async () => {
    setLogoUploading(true)
    try {
      await settingsApi.removeLogo()
      setLogoData('')
      if (user && workspace) rehydrate(user, { ...workspace, logo_data: '' })
      show('Logo removed')
    } catch { show('Failed to remove logo', 'error') }
    finally { setLogoUploading(false) }
  }

  const secHdr = (label: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '24px 0 18px' }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  )

  return (
    <div style={{ maxWidth: 1040 }}>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      <div className="card" style={{ flex: 1, minWidth: 0 }}>
        <div className="card-body" style={{ paddingTop: 8 }}>

          {/* ── Business Identity ── */}
          {secHdr('Business Identity')}
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 16 }}>
            {/* Logo preview */}
            <div style={{
              width: 80, height: 56, border: '1px solid var(--border)', borderRadius: 6,
              background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', flexShrink: 0,
            }}>
              {logoData
                ? <img src={logoData} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                : <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 15, color: '#1a1714', letterSpacing: '.04em' }}>
                    {form.name?.charAt(0) || '?'}
                  </span>
              }
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{form.name}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
                {logoData ? 'Logo uploaded · ' : 'No logo · '}PNG or SVG, max 2 MB. Appears in client emails.
              </div>
              {isOwner && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <label style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '5px 12px', background: 'var(--ink)', color: 'var(--paper)',
                    fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase',
                    borderRadius: 'var(--radius-sm)', cursor: logoUploading ? 'not-allowed' : 'pointer',
                    opacity: logoUploading ? 0.6 : 1,
                  }}>
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoChange} disabled={logoUploading} />
                    {logoUploading ? 'Uploading…' : logoData ? 'Replace Logo' : 'Upload Logo'}
                  </label>
                  {logoData && (
                    <button className="btn btn-outline btn-sm" onClick={handleRemoveLogo} disabled={logoUploading}>Remove</button>
                  )}
                </div>
              )}
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', padding: '8px 12px', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 4 }}>
            Workspace name appears on invoices and client emails. Contact your administrator to rename it.
          </div>

          {/* ── Business Address ── */}
          {secHdr('Business Address')}
          <div className="fgroup">
            <label className="flabel">Street Address</label>
            <input className="finput" value={form.address} onChange={e => set('address', e.target.value)} placeholder="123 Main St" />
          </div>
          <div className="fgrid">
            <div className="fgroup">
              <label className="flabel">City</label>
              <input className="finput" value={form.city} onChange={e => set('city', e.target.value)} placeholder="New York" />
            </div>
            <div className="fgroup">
              <label className="flabel">State / Province</label>
              <input className="finput" value={form.state} onChange={e => set('state', e.target.value)} placeholder="NY" />
            </div>
          </div>
          <div className="fgroup" style={{ maxWidth: 200 }}>
            <label className="flabel">ZIP / Postal Code</label>
            <input className="finput" value={form.zip_code} onChange={e => set('zip_code', e.target.value)} placeholder="10001" />
          </div>

        </div>
      </div>

      {/* ── Scheduling Defaults ── */}
      <div className="card" style={{ flex: 1, minWidth: 0 }}>
        <div className="card-body" style={{ paddingTop: 8 }}>
          {secHdr('Scheduling Defaults')}
          <div className="fgroup">
            <label className="flabel">Default Timezone</label>
            <select className="fselect" value={form.workspace_timezone} onChange={e => set('workspace_timezone', e.target.value)}>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Used for scheduling and reminder times.</div>
          </div>
          <div className="fgrid">
            <div className="fgroup">
              <label className="flabel">Cancellation Window</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input className="finput" type="number" min={0} value={form.cancellation_hours}
                  onChange={e => set('cancellation_hours', Number(e.target.value))} style={{ marginBottom: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>hours</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Clients must cancel at least this far in advance.</div>
            </div>
            <div className="fgroup">
              <label className="flabel">Session Buffer</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input className="finput" type="number" min={0} value={form.buffer_minutes}
                  onChange={e => set('buffer_minutes', Number(e.target.value))} style={{ marginBottom: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>min</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Gap auto-blocked after each session ends.</div>
            </div>
            <div className="fgroup">
              <label className="flabel">Reschedule Request Expiry <span style={{ color: 'var(--muted)', fontWeight: 400 }}>— leave blank to never expire</span></label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input className="finput" type="number" min={1} value={form.reschedule_request_ttl_days}
                  onChange={e => set('reschedule_request_ttl_days', e.target.value)} placeholder="e.g. 5" style={{ marginBottom: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>days</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>A client's pending reschedule request auto-clears if left unconfirmed this long.</div>
            </div>
          </div>

          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-dark" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>

        </div>
      </div>
      </div>
    </div>
  )
}

// ── Profile Tab ────────────────────────────────────────────────────────────────
function ProfileTab() {
  const { user, rehydrate, workspace } = useAuthStore()
  const { show } = useToast()

  const { data: teamData } = useQuery({
    queryKey: ['team'],
    queryFn: () => authApi.team().then(r => r.data),
    enabled: user?.role !== 'business_owner',
  })
  const teamMembers: any[] = teamData?.results || teamData || []
  const workspaceOwner = teamMembers.find((m: any) => m.role === 'business_owner')

  const [form, setForm] = useState({
    full_name:     user?.full_name     || '',
    user_timezone: (user as any)?.user_timezone || 'America/New_York',
    phone:         (user as any)?.phone || '',
  })
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm: '' })
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPw, setSavingPw] = useState(false)
  const [pwError, setPwError] = useState('')
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const setPw = (k: string, v: string) => setPwForm(f => ({ ...f, [k]: v }))

  const handleSaveProfile = async () => {
    setSavingProfile(true)
    try {
      const { data } = await authApi.updateMe({ full_name: form.full_name, user_timezone: form.user_timezone, phone: form.phone })
      if (workspace) rehydrate(data, workspace)
      show('Profile updated')
    } catch { show('Failed to save', 'error') }
    finally { setSavingProfile(false) }
  }

  const handleChangePassword = async () => {
    setPwError('')
    if (pwForm.new_password !== pwForm.confirm) { setPwError('Passwords do not match'); return }
    if (pwForm.new_password.length < 8) { setPwError('Password must be at least 8 characters'); return }
    setSavingPw(true)
    try {
      await authApi.updateMe({ current_password: pwForm.current_password, password: pwForm.new_password })
      setPwForm({ current_password: '', new_password: '', confirm: '' })
      show('Password changed')
    } catch (err: any) {
      setPwError(err.response?.data?.current_password?.[0] || err.response?.data?.detail || 'Failed to change password')
    } finally { setSavingPw(false) }
  }

  const secHdr = (icon: React.ReactNode, label: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '24px 0 18px' }}>
      <span style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  )

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', maxWidth: 1040 }}>
      <div className="card" style={{ flex: 1, minWidth: 0 }}>
        <div className="card-body" style={{ paddingTop: 8 }}>

          {/* ── Personal Information ── */}
          {secHdr(<User size={13} />, 'Personal Information')}

          {/* Avatar + name row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
              background: (ROLE_COLORS[user?.role || ''] || '#8c8279') + '22',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 700, color: ROLE_COLORS[user?.role || ''] || 'var(--muted)',
            }}>
              {form.full_name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{form.full_name || '—'}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{user?.email}</div>
            </div>
            <span style={{
              marginLeft: 'auto', padding: '3px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
              background: (ROLE_COLORS[user?.role || ''] || '#8c8279') + '18',
              color: ROLE_COLORS[user?.role || ''] || 'var(--muted)',
            }}>
              {ROLE_LABELS[user?.role || ''] || user?.role}
            </span>
          </div>

          <div className="fgrid">
            <div className="fgroup">
              <label className="flabel">Full Name</label>
              <input className="finput" value={form.full_name} onChange={e => set('full_name', e.target.value)} />
            </div>
            <div className="fgroup">
              <label className="flabel">Email Address</label>
              <input className="finput" value={user?.email || ''} disabled
                style={{ background: 'var(--paper)', color: 'var(--muted)', cursor: 'not-allowed' }} />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>Cannot be changed.</div>
            </div>
          </div>
          <div className="fgrid">
            <div className="fgroup">
              <label className="flabel">Your Timezone</label>
              <select className="fselect" value={form.user_timezone} onChange={e => set('user_timezone', e.target.value)}>
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                Used for your personal calendar and session reminders.
                {user?.role !== 'business_owner' && workspaceOwner && (
                  <> Role is managed by <strong>{workspaceOwner.full_name}</strong>.</>
                )}
              </div>
            </div>
            <div className="fgroup">
              <label className="flabel">Phone Number</label>
              <input className="finput" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="(555) 123-4567" />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>Offered as a dial-in option when scheduling meetings.</div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-dark" onClick={handleSaveProfile} disabled={savingProfile}>
              {savingProfile ? 'Saving…' : 'Save Profile'}
            </button>
          </div>

        </div>
      </div>

      {/* ── Security ── */}
      <div className="card" style={{ flex: 1, minWidth: 0 }}>
        <div className="card-body" style={{ paddingTop: 8 }}>
          {secHdr(<Shield size={13} />, 'Security')}

          {pwError && (
            <div style={{ marginBottom: 14, padding: '9px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>
              {pwError}
            </div>
          )}
          <div className="fgroup">
            <label className="flabel">Current Password</label>
            <input className="finput" type="password" value={pwForm.current_password}
              onChange={e => setPw('current_password', e.target.value)}
              style={{ maxWidth: 320 }} />
          </div>
          <div className="fgrid">
            <div className="fgroup">
              <label className="flabel">New Password</label>
              <input className="finput" type="password" value={pwForm.new_password}
                onChange={e => setPw('new_password', e.target.value)} />
            </div>
            <div className="fgroup">
              <label className="flabel">Confirm New Password</label>
              <input className="finput" type="password" value={pwForm.confirm}
                onChange={e => setPw('confirm', e.target.value)} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: -8, marginBottom: 16 }}>Minimum 8 characters.</div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-dark" onClick={handleChangePassword} disabled={savingPw}>
              {savingPw ? 'Updating…' : 'Change Password'}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}

// ── Pipeline Stages Tab ────────────────────────────────────────────────────────
const STAGE_PRESET_COLORS = ['#8c8279','#2d6a9f','#2980b9','#c9a84c','#4a7c59','#1a1714','#7c4d9f','#c0392b','#16a085','#a0522d']

type Freq = 'daily' | 'weekly' | 'monthly'
const FREQ_OPTIONS: { key: Freq; label: string }[] = [
  { key: 'daily', label: 'Daily' }, { key: 'weekly', label: 'Once a week' }, { key: 'monthly', label: 'Once a month' },
]
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const NTH = [{ v: 1, l: 'First' }, { v: 2, l: 'Second' }, { v: 3, l: 'Third' }, { v: 4, l: 'Fourth' }, { v: -1, l: 'Last' }]
const ordinal = (n: number) => {
  if (n >= 11 && n <= 13) return `${n}th`
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`
}

// Which day a weekly / monthly follow-up goes out (PipelineStageConfig.alert_schedule,
// read by tasks.pipeline._scheduled_today). Defaults match the backend: Monday / the 1st.
type Sched = { weekday?: number; month_mode?: 'day' | 'nth'; month_day?: number; month_week?: number; month_weekday?: number }
const scheduleText = (freq: string, o: Sched = {}) => {
  if (freq === 'weekly') return `Every ${WEEKDAYS[o.weekday ?? 0]}`
  if (freq === 'monthly') {
    if (o.month_mode === 'nth') {
      const nth = NTH.find(n => n.v === (o.month_week ?? 1))?.l || 'First'
      return `${nth} ${WEEKDAYS[o.month_weekday ?? 0]} of the month`
    }
    return `${ordinal(o.month_day ?? 1)} of each month`
  }
  return 'Daily'
}

// Who can receive follow-ups for a stuck deal — each with its own on/off + frequency
// (PipelineStageConfig.notify_* / *_frequency; sent by tasks.pipeline.dispatch_pipeline_alerts).
const RECIPIENTS = [
  { key: 'owner',  label: 'You',            hint: 'Workspace owner — the internal follow-up alert' },
  { key: 'coach',  label: 'Assigned coach', hint: 'The coach on the deal — same alert, skipped if that’s you' },
  { key: 'client', label: 'Client',         hint: 'A friendly check-in, not the internal alert — edit it in Settings → Emails' },
] as const

const emptyStageForm = () => ({
  label: '', color: '#2d6a9f', insertAfterSlug: '__end__',
  alerts_on: false, follow_up_days: '7', alert_stop_after_days: '',
  notify_owner: true,  owner_frequency: 'daily' as Freq,
  notify_coach: false, coach_frequency: 'daily' as Freq,
  notify_client: false, client_frequency: 'weekly' as Freq,
  schedule: {} as Record<string, Sched>,
})

const stageToForm = (s: any) => ({
  label: s.label, color: s.color, insertAfterSlug: '',
  alerts_on: !!s.follow_up_days, follow_up_days: s.follow_up_days ? String(s.follow_up_days) : '7',
  alert_stop_after_days: s.alert_stop_after_days ? String(s.alert_stop_after_days) : '',
  notify_owner: !!s.notify_owner,   owner_frequency: (s.owner_frequency || 'daily') as Freq,
  notify_coach: !!s.notify_coach,   coach_frequency: (s.coach_frequency || 'daily') as Freq,
  notify_client: !!s.notify_client, client_frequency: (s.client_frequency || 'weekly') as Freq,
  schedule: (s.alert_schedule || {}) as Record<string, Sched>,
})

const formToPayload = (f: ReturnType<typeof emptyStageForm>) => ({
  label: f.label.trim(), color: f.color,
  follow_up_days: f.alerts_on && f.follow_up_days ? Number(f.follow_up_days) : null,
  alert_stop_after_days: f.alerts_on && f.alert_stop_after_days ? Number(f.alert_stop_after_days) : null,
  notify_owner: f.notify_owner,   owner_frequency: f.owner_frequency,
  notify_coach: f.notify_coach,   coach_frequency: f.coach_frequency,
  notify_client: f.notify_client, client_frequency: f.client_frequency,
  alert_schedule: f.schedule,
  // The old "max reminders to client" cap is replaced by the client's own frequency.
  client_alert_max_count: null,
})

const sectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', margin: '4px 0 10px',
}

function StageForm({ form, setForm, stages, isNew }: {
  form: ReturnType<typeof emptyStageForm>
  setForm: (fn: (f: ReturnType<typeof emptyStageForm>) => ReturnType<typeof emptyStageForm>) => void
  stages: any[]; isNew: boolean
}) {
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))
  const noneSelected = form.alerts_on && !form.notify_owner && !form.notify_coach && !form.notify_client
  return (
    <div>
      <div style={sectionTitle}>Stage</div>
      <div className="fgroup">
        <label className="flabel">Name *</label>
        <input className="finput" value={form.label} onChange={e => set('label', e.target.value)} placeholder="e.g. Contract Sent" />
      </div>
      {isNew && (
        <div className="fgroup">
          <label className="flabel">Position</label>
          <select className="fselect" value={form.insertAfterSlug} onChange={e => set('insertAfterSlug', e.target.value)}>
            <option value="__beginning__">At the beginning</option>
            {stages.map((s: any) => <option key={s.slug} value={s.slug}>After: {s.label}</option>)}
            <option value="__end__">At the end</option>
          </select>
        </div>
      )}
      <div className="fgroup">
        <label className="flabel">Color</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          {STAGE_PRESET_COLORS.map(c => (
            <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => set('color', c)}
              style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
                border: form.color === c ? '3px solid var(--ink)' : '2px solid transparent' }} />
          ))}
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0 14px' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ ...sectionTitle, margin: 0 }}>Follow-up emails</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.alerts_on} onChange={e => set('alerts_on', e.target.checked)} />
          Send follow-ups for this stage
        </label>
      </div>

      {!form.alerts_on ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
          No emails when a deal sits in this stage.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="fgroup">
              <label className="flabel">Start after</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input className="finput" type="number" min={1} max={365} value={form.follow_up_days}
                  onChange={e => set('follow_up_days', e.target.value)} style={{ width: 80 }} />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>days in stage</span>
              </div>
            </div>
            <div className="fgroup">
              <label className="flabel">Stop after</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input className="finput" type="number" min={1} max={365} value={form.alert_stop_after_days}
                  onChange={e => set('alert_stop_after_days', e.target.value)} placeholder="—" style={{ width: 80 }} />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>days in stage</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>Blank = until the deal moves stage</div>
            </div>
          </div>

          <label className="flabel" style={{ marginBottom: 6 }}>Who gets them, and how often</label>
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {RECIPIENTS.map((r, i) => {
              const on = (form as any)[`notify_${r.key}`] as boolean
              const freq = (form as any)[`${r.key}_frequency`] as Freq
              return (
                <div key={r.key} style={{
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 12px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--border)', background: on ? '#fff' : 'var(--paper)',
                }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flex: '1 1 200px', cursor: 'pointer', minWidth: 0 }}>
                    <input type="checkbox" checked={on} onChange={e => set(`notify_${r.key}`, e.target.checked)} style={{ marginTop: 2 }} />
                    <span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{r.label}</span>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{r.hint}</span>
                    </span>
                  </label>
                  <div role="radiogroup" aria-label={`${r.label} frequency`} style={{
                    display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden',
                    opacity: on ? 1 : 0.4, pointerEvents: on ? 'auto' : 'none',
                  }}>
                    {FREQ_OPTIONS.map(o => (
                      <button key={o.key} type="button" role="radio" aria-checked={freq === o.key}
                        onClick={() => set(`${r.key}_frequency`, o.key)}
                        style={{
                          border: 'none', padding: '5px 10px', fontSize: 12, cursor: 'pointer',
                          background: freq === o.key ? 'var(--ink)' : '#fff', color: freq === o.key ? '#fff' : 'var(--ink)',
                        }}>{o.label}</button>
                    ))}
                  </div>
                  {on && freq !== 'daily' && (
                    <SchedulePicker freq={freq} value={form.schedule[r.key] || {}}
                      onChange={v => setForm(f => ({ ...f, schedule: { ...f.schedule, [r.key]: v } }))} />
                  )}
                </div>
              )
            })}
          </div>
          {noneSelected && (
            <div style={{ fontSize: 11, color: '#b45309', marginTop: 6 }}>Pick at least one recipient, or switch follow-ups off.</div>
          )}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
            Emails go out on the chosen day once a deal has been in this stage long enough — e.g. a deal that
            becomes overdue on a Wednesday gets its first “every Monday” email the following Monday.
            Everything stops as soon as the deal moves to another stage.
          </div>
        </>
      )}
    </div>
  )
}

function SchedulePicker({ freq, value, onChange }: { freq: Freq; value: Sched; onChange: (v: Sched) => void }) {
  const sel = { padding: '4px 6px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6, background: '#fff' } as const
  if (freq === 'weekly') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexBasis: '100%', paddingLeft: 24, fontSize: 12, color: 'var(--muted)' }}>
        Every
        <select style={sel} value={value.weekday ?? 0} onChange={e => onChange({ ...value, weekday: Number(e.target.value) })}>
          {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
      </div>
    )
  }
  const mode = value.month_mode || 'day'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexBasis: '100%', paddingLeft: 24, fontSize: 12, color: 'var(--muted)' }}>
      On the
      <select style={sel} value={mode === 'day' ? 'day' : String(value.month_week ?? 1)}
        onChange={e => e.target.value === 'day'
          ? onChange({ ...value, month_mode: 'day' })
          : onChange({ ...value, month_mode: 'nth', month_week: Number(e.target.value) })}>
        <option value="day">date…</option>
        {NTH.map(n => <option key={n.v} value={n.v}>{n.l}</option>)}
      </select>
      {mode === 'day' ? (
        <>
          <select style={sel} value={value.month_day ?? 1} onChange={e => onChange({ ...value, month_day: Number(e.target.value) })}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{ordinal(d)}</option>)}
          </select>
          of each month{(value.month_day ?? 1) > 28 ? ' (last day in shorter months)' : ''}
        </>
      ) : (
        <>
          <select style={sel} value={value.month_weekday ?? 0} onChange={e => onChange({ ...value, month_weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
          of the month
        </>
      )}
    </div>
  )
}

function stageSummary(s: any) {
  if (!s.follow_up_days) return null
  const who = RECIPIENTS
    .filter(r => s[`notify_${r.key}`])
    .map(r => `${r.label} · ${scheduleText(s[`${r.key}_frequency`], (s.alert_schedule || {})[r.key])}`)
  return {
    when: `After ${s.follow_up_days} day${s.follow_up_days === 1 ? '' : 's'}` +
      (s.alert_stop_after_days ? ` · stops at ${s.alert_stop_after_days} days` : ' · until it moves stage'),
    who,
  }
}

function PipelineTab() {
  const { show } = useToast()
  const qc = useQueryClient()
  const { data: stages = [], isLoading } = useQuery({
    queryKey: ['pipeline-stage-configs'],
    queryFn: () => settingsApi.getPipelineStages().then(r => r.data),
  })
  const [showAdd, setShowAdd] = useState(false)
  const [editTarget, setEditTarget] = useState<any>(null)
  const [form, setForm] = useState(emptyStageForm)
  const [saving, setSaving] = useState(false)

  const stageList = stages as any[]
  const invalid = !form.label.trim() || (form.alerts_on && (!Number(form.follow_up_days) ||
    (!form.notify_owner && !form.notify_coach && !form.notify_client)))

  const openAdd = () => { setForm(emptyStageForm()); setShowAdd(true) }
  const openEdit = (s: any) => { setForm(stageToForm(s)); setEditTarget(s) }

  const handleAdd = async () => {
    if (invalid) return
    setSaving(true)
    const slug = form.label.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    let order: number
    if (form.insertAfterSlug === '__beginning__') {
      order = stageList.length > 0 ? stageList[0].order : 0
    } else if (form.insertAfterSlug === '__end__' || !form.insertAfterSlug) {
      order = stageList.length > 0 ? stageList[stageList.length - 1].order + 1 : 0
    } else {
      const after = stageList.find(s => s.slug === form.insertAfterSlug)
      order = after ? after.order + 1 : stageList.length
    }
    try {
      await settingsApi.createPipelineStage({ ...formToPayload(form), slug, order })
      qc.invalidateQueries({ queryKey: ['pipeline-stage-configs'] })
      setShowAdd(false)
      show('Stage added')
    } catch (e: any) {
      show(e?.response?.data?.label?.[0] || e?.response?.data?.slug?.[0] || 'Failed to add stage', 'error')
    } finally { setSaving(false) }
  }

  const handleEdit = async () => {
    if (invalid) return
    setSaving(true)
    try {
      await settingsApi.updatePipelineStage(editTarget.id, formToPayload(form))
      qc.invalidateQueries({ queryKey: ['pipeline-stage-configs'] })
      setEditTarget(null)
      show('Stage updated')
    } catch { show('Failed to update', 'error') }
    finally { setSaving(false) }
  }

  const handleDelete = async (s: any) => {
    if (!confirm(`Delete stage "${s.label}"?`)) return
    try {
      await settingsApi.deletePipelineStage(s.id)
      qc.invalidateQueries({ queryKey: ['pipeline-stage-configs'] })
      show('Deleted')
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Built-in stages cannot be deleted', 'error')
    }
  }

  if (isLoading) return <div style={{ padding: 24, color: 'var(--muted)', fontSize: 13 }}>Loading…</div>

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 24, color: 'var(--ink)', lineHeight: 1.2 }}>Pipeline stages</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4, maxWidth: 520 }}>
            The stages a deal moves through. For any stage, choose when follow-up emails start when a deal
            sits there too long, who gets them, and how often.
          </div>
        </div>
        <button className="btn btn-dark btn-sm" onClick={openAdd}><Plus size={13} /> Add Stage</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {stageList.map((s: any, i: number) => {
          const sum = stageSummary(s)
          return (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
              padding: '14px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 220px', minWidth: 0 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', width: 16, textAlign: 'right' }}>{i + 1}</span>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{s.label}</span>
              </div>
              <div style={{ flex: '2 1 300px', minWidth: 0 }}>
                {sum ? (
                  <>
                    <div style={{ fontSize: 12, color: 'var(--ink)' }}>{sum.when}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
                      {sum.who.length ? sum.who.map(w => (
                        <span key={w} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#eef3ec', color: '#2a5c35', fontWeight: 600 }}>{w}</span>
                      )) : <span style={{ fontSize: 11, color: '#b45309' }}>No recipients selected</span>}
                    </div>
                  </>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>No follow-ups</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
                <button className="btn btn-outline btn-sm" onClick={() => openEdit(s)}><Pencil size={12} /> Edit</button>
                {!s.is_builtin && (
                  <button className="btn btn-outline btn-sm" onClick={() => handleDelete(s)} aria-label={`Delete ${s.label}`}
                    style={{ color: '#c0392b', borderColor: '#f5c6c2' }}><Trash2 size={12} /></button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {(showAdd || editTarget) && (
        <Modal title={showAdd ? 'Add pipeline stage' : `Edit stage: ${editTarget.label}`}
          onClose={() => { setShowAdd(false); setEditTarget(null) }} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => { setShowAdd(false); setEditTarget(null) }}>Cancel</button>
            <button className="btn btn-dark btn-sm" onClick={showAdd ? handleAdd : handleEdit} disabled={saving || invalid}>
              {saving ? 'Saving…' : showAdd ? 'Add stage' : 'Save'}
            </button>
          </>
        }>
          <StageForm form={form} setForm={setForm} stages={stageList} isNew={showAdd} />
        </Modal>
      )}
    </div>
  )
}

// ── Activity Types Tab ─────────────────────────────────────────────────────────
// Trimmed to one representative shade per hue — a full 30-swatch grid ate too much
// vertical space when two pickers sit side by side (e.g. Generic Templates' Header).
// The native color input + hex field below still allow picking any exact color.
const PRESET_COLORS = [
  '#ffffff', '#1B3A6B', '#2d6a9f', '#4a7c59', '#16a085',
  '#7c4d9f', '#c2185b', '#c9a84c', '#e67e22',
  '#c0392b', '#607d8b', '#4a4540', '#1a1714',
]

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
        {PRESET_COLORS.map(c => (
          <button
            key={c} type="button"
            onClick={() => onChange(c)}
            title={c}
            style={{
              width: 18, height: 18, borderRadius: '50%', background: c, cursor: 'pointer',
              border: value === c ? '2px solid var(--ink)' : '1px solid rgba(0,0,0,.08)',
              boxShadow: value === c ? `0 0 0 2px white, 0 0 0 3px ${c}` : 'none',
              transition: 'all .1s', padding: 0,
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <input
          type="color" value={value} onChange={e => onChange(e.target.value)}
          style={{ width: 30, height: 22, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 4, padding: 2 }}
        />
        <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{value}</span>
      </div>
    </div>
  )
}

function ActivityTypesTab() {
  const { show, el: toastEl } = useToast()
  const qc = useQueryClient()
  const { data: types = [], isLoading } = useQuery({
    queryKey: ['activity-type-configs'],
    queryFn: () => settingsApi.getActivityTypes().then(r => r.data),
  })
  const [showAdd, setShowAdd]       = useState(false)
  const [editTarget, setEditTarget] = useState<any>(null)
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const [newForm, setNewForm]       = useState({ name: '', color: '#2d6a9f' })
  const [editForm, setEditForm]     = useState({ name: '', color: '#2d6a9f' })
  const [saving, setSaving]         = useState(false)

  const handleAdd = async () => {
    if (!newForm.name.trim()) return
    setSaving(true)
    try {
      await settingsApi.createActivityType(newForm)
      qc.invalidateQueries({ queryKey: ['activity-type-configs'] })
      setShowAdd(false)
      setNewForm({ name: '', color: '#2d6a9f' })
      show('Activity type added')
    } catch (e: any) {
      show(e?.response?.data?.name?.[0] || 'Failed to add type', 'error')
    } finally { setSaving(false) }
  }

  const handleEdit = async () => {
    if (!editForm.name.trim()) return
    setSaving(true)
    try {
      await settingsApi.updateActivityType(editTarget.id, editForm)
      qc.invalidateQueries({ queryKey: ['activity-type-configs'] })
      setEditTarget(null)
      show('Activity type updated')
    } catch (e: any) {
      show(e?.response?.data?.name?.[0] || 'Failed to update', 'error')
    } finally { setSaving(false) }
  }

  const handleToggle = async (t: any) => {
    try {
      await settingsApi.updateActivityType(t.id, { is_active: !t.is_active })
      qc.invalidateQueries({ queryKey: ['activity-type-configs'] })
    } catch { show('Failed to update', 'error') }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setSaving(true)
    try {
      await settingsApi.deleteActivityType(deleteTarget.id)
      qc.invalidateQueries({ queryKey: ['activity-type-configs'] })
      setDeleteTarget(null)
      show('Activity type deleted')
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Failed to delete', 'error')
    } finally { setSaving(false) }
  }

  if (isLoading) return <div style={{ padding: 24, color: 'var(--muted)', fontSize: 13 }}>Loading…</div>

  return (
    <div className="card" style={{ maxWidth: 600 }}>
      <div className="card-hdr">
        Activity Types
        <button className="btn btn-dark btn-sm" onClick={() => setShowAdd(true)}>
          <Plus size={13} /> Add Type
        </button>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {types.map((t: any) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
            <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: t.is_active ? 'var(--ink)' : 'var(--muted)' }}>
              {t.name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
              {t.is_builtin && (
                <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 6, fontWeight: 400, letterSpacing: '.04em' }}>built-in</span>
              )}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={t.is_active} onChange={() => handleToggle(t)}
                style={{ width: 14, height: 14, accentColor: 'var(--gold)' }} />
              Active
            </label>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditTarget(t); setEditForm({ name: t.name, color: t.color }) }} style={{ padding: '2px 6px' }}>
              <Pencil size={13} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setDeleteTarget(t)} style={{ color: '#c0392b', padding: '2px 6px' }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      {showAdd && (
        <Modal title="Add Activity Type" onClose={() => setShowAdd(false)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn btn-dark btn-sm" onClick={handleAdd} disabled={saving}>{saving ? 'Adding…' : 'Add'}</button>
          </>
        }>
          <div className="fgroup">
            <label className="flabel">Name *</label>
            <input className="finput" value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Strategy Session"
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }} autoFocus />
          </div>
          <div className="fgroup">
            <label className="flabel">Color</label>
            <ColorPicker value={newForm.color} onChange={c => setNewForm(f => ({ ...f, color: c }))} />
          </div>
        </Modal>
      )}

      {editTarget && (
        <Modal title="Edit Activity Type" onClose={() => setEditTarget(null)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setEditTarget(null)}>Cancel</button>
            <button className="btn btn-dark btn-sm" onClick={handleEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </>
        }>
          <div className="fgroup">
            <label className="flabel">Name *</label>
            <input className="finput" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') handleEdit() }} autoFocus />
          </div>
          <div className="fgroup">
            <label className="flabel">Color</label>
            <ColorPicker value={editForm.color} onChange={c => setEditForm(f => ({ ...f, color: c }))} />
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Delete Activity Type" onClose={() => setDeleteTarget(null)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button className="btn btn-sm" onClick={handleDelete} disabled={saving}
              style={{ background: '#c0392b', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              {saving ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }>
          <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.6 }}>
            Delete <strong>"{deleteTarget.name}"</strong>? Activities already logged with this type will keep their label.
            {deleteTarget.is_builtin && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)', background: '#faf9f7', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
                This is a built-in type. If you ever need it back, use "+ Add Type" to recreate it.
              </div>
            )}
          </div>
        </Modal>
      )}

      {toastEl}
    </div>
  )
}

function AffiliationsTab() {
  const { show, el: toastEl } = useToast()
  const qc = useQueryClient()
  const { data: affiliations = [], isLoading } = useQuery({
    queryKey: ['affiliation-configs'],
    queryFn: () => settingsApi.getAffiliations().then(r => r.data),
  })
  const [showAdd, setShowAdd]       = useState(false)
  const [editTarget, setEditTarget] = useState<any>(null)
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const [newForm, setNewForm]       = useState({ name: '', color: '#2d6a9f' })
  const [editForm, setEditForm]     = useState({ name: '', color: '#2d6a9f' })
  const [saving, setSaving]         = useState(false)

  const handleAdd = async () => {
    if (!newForm.name.trim()) return
    setSaving(true)
    try {
      await settingsApi.createAffiliation(newForm)
      qc.invalidateQueries({ queryKey: ['affiliation-configs'] })
      setShowAdd(false)
      setNewForm({ name: '', color: '#2d6a9f' })
      show('Affiliation added')
    } catch (e: any) {
      show(e?.response?.data?.name?.[0] || 'Failed to add affiliation', 'error')
    } finally { setSaving(false) }
  }

  const handleEdit = async () => {
    if (!editForm.name.trim()) return
    setSaving(true)
    try {
      await settingsApi.updateAffiliation(editTarget.id, editForm)
      qc.invalidateQueries({ queryKey: ['affiliation-configs'] })
      setEditTarget(null)
      show('Affiliation updated')
    } catch (e: any) {
      show(e?.response?.data?.name?.[0] || 'Failed to update', 'error')
    } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setSaving(true)
    try {
      await settingsApi.deleteAffiliation(deleteTarget.id)
      qc.invalidateQueries({ queryKey: ['affiliation-configs'] })
      setDeleteTarget(null)
      show('Affiliation deleted')
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Failed to delete', 'error')
    } finally { setSaving(false) }
  }

  if (isLoading) return <div style={{ padding: 24, color: 'var(--muted)', fontSize: 13 }}>Loading…</div>

  return (
    <div className="card" style={{ maxWidth: 600 }}>
      <div className="card-hdr">
        Affiliation
        <button className="btn btn-dark btn-sm" onClick={() => setShowAdd(true)}>
          <Plus size={13} /> Add Affiliation
        </button>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {affiliations.length === 0 && (
          <div style={{ padding: '14px 18px', fontSize: 13, color: 'var(--muted)' }}>
            No affiliations yet — add the businesses sessions can be booked under (e.g. "Rass Consulting", "LMT Consulting").
          </div>
        )}
        {affiliations.map((a: any) => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: a.color, flexShrink: 0 }} />
            <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{a.name}</div>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditTarget(a); setEditForm({ name: a.name, color: a.color }) }} style={{ padding: '2px 6px' }}>
              <Pencil size={13} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setDeleteTarget(a)} style={{ color: '#c0392b', padding: '2px 6px' }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      {showAdd && (
        <Modal title="Add Affiliation" onClose={() => setShowAdd(false)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn btn-dark btn-sm" onClick={handleAdd} disabled={saving}>{saving ? 'Adding…' : 'Add'}</button>
          </>
        }>
          <div className="fgroup">
            <label className="flabel">Name *</label>
            <input className="finput" value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Rass Consulting"
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }} autoFocus />
          </div>
          <div className="fgroup">
            <label className="flabel">Color</label>
            <ColorPicker value={newForm.color} onChange={c => setNewForm(f => ({ ...f, color: c }))} />
          </div>
        </Modal>
      )}

      {editTarget && (
        <Modal title="Edit Affiliation" onClose={() => setEditTarget(null)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setEditTarget(null)}>Cancel</button>
            <button className="btn btn-dark btn-sm" onClick={handleEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </>
        }>
          <div className="fgroup">
            <label className="flabel">Name *</label>
            <input className="finput" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') handleEdit() }} autoFocus />
          </div>
          <div className="fgroup">
            <label className="flabel">Color</label>
            <ColorPicker value={editForm.color} onChange={c => setEditForm(f => ({ ...f, color: c }))} />
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Delete Affiliation" onClose={() => setDeleteTarget(null)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button className="btn btn-sm" onClick={handleDelete} disabled={saving}
              style={{ background: '#c0392b', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              {saving ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }>
          <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.6 }}>
            Delete <strong>"{deleteTarget.name}"</strong>? Activities already booked under this affiliation will keep their label.
          </div>
        </Modal>
      )}

      {toastEl}
    </div>
  )
}

// ── Client Statuses Tab ────────────────────────────────────────────────────────
function ClientStatusesTab() {
  const { show, el: toastEl } = useToast()
  const qc = useQueryClient()
  const { data: statuses = [], isLoading } = useQuery({
    queryKey: ['client-status-configs'],
    queryFn: () => settingsApi.getClientStatuses().then(r => r.data),
  })
  const [showAdd, setShowAdd]           = useState(false)
  const [editTarget, setEditTarget]     = useState<any>(null)
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const [newForm, setNewForm]           = useState({ label: '', color: '#2d6a9f' })
  const [editForm, setEditForm]         = useState({ label: '', color: '#2d6a9f' })
  const [saving, setSaving]             = useState(false)

  const handleAdd = async () => {
    if (!newForm.label.trim()) return
    setSaving(true)
    try {
      await settingsApi.createClientStatus(newForm)
      qc.invalidateQueries({ queryKey: ['client-status-configs'] })
      setShowAdd(false); setNewForm({ label: '', color: '#2d6a9f' })
      show('Status added')
    } catch (e: any) { show(e?.response?.data?.label?.[0] || 'Failed to add', 'error') }
    finally { setSaving(false) }
  }

  const handleEdit = async () => {
    if (!editForm.label.trim()) return
    setSaving(true)
    try {
      await settingsApi.updateClientStatus(editTarget.id, editForm)
      qc.invalidateQueries({ queryKey: ['client-status-configs'] })
      setEditTarget(null); show('Status updated')
    } catch (e: any) { show(e?.response?.data?.label?.[0] || 'Failed to update', 'error') }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setSaving(true)
    try {
      await settingsApi.deleteClientStatus(deleteTarget.id)
      qc.invalidateQueries({ queryKey: ['client-status-configs'] })
      setDeleteTarget(null); show('Status deleted')
    } catch (e: any) { show(e?.response?.data?.detail || 'Failed to delete', 'error') }
    finally { setSaving(false) }
  }

  if (isLoading) return <div style={{ padding: 24, color: 'var(--muted)', fontSize: 13 }}>Loading…</div>

  return (
    <div className="card" style={{ maxWidth: 600 }}>
      <div className="card-hdr">
        Client Statuses
        <button className="btn btn-dark btn-sm" onClick={() => setShowAdd(true)}>
          <Plus size={13} /> Add Status
        </button>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {(statuses as any[]).map((s: any) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
            <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>
              {s.label.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
              {s.is_builtin && <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 6, fontWeight: 400 }}>built-in</span>}
            </div>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 12,
              background: s.color + '20', color: s.color, border: `1px solid ${s.color}40`,
            }}>{s.label.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditTarget(s); setEditForm({ label: s.label, color: s.color }) }} style={{ padding: '2px 6px' }}>
              <Pencil size={13} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setDeleteTarget(s)} style={{ color: '#c0392b', padding: '2px 6px' }} disabled={s.is_builtin}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      {showAdd && (
        <Modal title="Add Client Status" onClose={() => setShowAdd(false)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn btn-dark btn-sm" onClick={handleAdd} disabled={saving}>{saving ? 'Adding…' : 'Add'}</button>
          </>
        }>
          <div className="fgroup">
            <label className="flabel">Label *</label>
            <input className="finput" value={newForm.label} onChange={e => setNewForm(f => ({ ...f, label: e.target.value }))}
              placeholder="e.g. On Hold" onKeyDown={e => { if (e.key === 'Enter') handleAdd() }} autoFocus />
          </div>
          <div className="fgroup">
            <label className="flabel">Color</label>
            <ColorPicker value={newForm.color} onChange={c => setNewForm(f => ({ ...f, color: c }))} />
          </div>
        </Modal>
      )}

      {editTarget && (
        <Modal title="Edit Status" onClose={() => setEditTarget(null)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setEditTarget(null)}>Cancel</button>
            <button className="btn btn-dark btn-sm" onClick={handleEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </>
        }>
          <div className="fgroup">
            <label className="flabel">Label *</label>
            <input className="finput" value={editForm.label} onChange={e => setEditForm(f => ({ ...f, label: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') handleEdit() }} autoFocus />
          </div>
          <div className="fgroup">
            <label className="flabel">Color</label>
            <ColorPicker value={editForm.color} onChange={c => setEditForm(f => ({ ...f, color: c }))} />
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Delete Status" onClose={() => setDeleteTarget(null)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button className="btn btn-sm" onClick={handleDelete} disabled={saving}
              style={{ background: '#c0392b', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              {saving ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }>
          <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.6 }}>
            Delete <strong>"{deleteTarget.label}"</strong>? Clients with this status will keep the label text.
          </div>
        </Modal>
      )}
      {toastEl}
    </div>
  )
}

// ── Tags Tab ───────────────────────────────────────────────────────────────────
// Generic CRUD card for a workspace's tag-config list (name + color) — used for both
// Client Tags (Client.tags) and Communication Tags (Client.communication_tags), which
// are separate config lists in the DB but identical in shape and behavior.
function TagConfigCard({ title, queryKey, placeholder, itemNoun, api: tagApi }: {
  title: string
  queryKey: string
  placeholder: string
  itemNoun: string
  api: {
    list:   () => Promise<{ data: any }>
    create: (d: any) => Promise<{ data: any }>
    update: (id: number, d: any) => Promise<{ data: any }>
    remove: (id: number) => Promise<any>
  }
}) {
  const { show, el: toastEl } = useToast()
  const qc = useQueryClient()
  const { data: tags = [], isLoading } = useQuery({
    queryKey: [queryKey],
    queryFn: () => tagApi.list().then(r => r.data),
    staleTime: 0,
  })
  const [showAdd, setShowAdd]           = useState(false)
  const [editTarget, setEditTarget]     = useState<any>(null)
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const [newForm, setNewForm]           = useState({ name: '', color: '#2d6a9f' })
  const [editForm, setEditForm]         = useState({ name: '', color: '#2d6a9f' })
  const [saving, setSaving]             = useState(false)

  const handleAdd = async () => {
    if (!newForm.name.trim()) return
    setSaving(true)
    try {
      await tagApi.create(newForm)
      qc.invalidateQueries({ queryKey: [queryKey] })
      setShowAdd(false); setNewForm({ name: '', color: '#2d6a9f' })
      show(`${itemNoun} added`)
    } catch (e: any) { show(e?.response?.data?.name?.[0] || 'Failed to add', 'error') }
    finally { setSaving(false) }
  }

  const handleEdit = async () => {
    if (!editForm.name.trim()) return
    setSaving(true)
    try {
      await tagApi.update(editTarget.id, editForm)
      qc.invalidateQueries({ queryKey: [queryKey] })
      setEditTarget(null); show(`${itemNoun} updated`)
    } catch (e: any) { show(e?.response?.data?.name?.[0] || 'Failed to update', 'error') }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setSaving(true)
    try {
      await tagApi.remove(deleteTarget.id)
      qc.invalidateQueries({ queryKey: [queryKey] })
      setDeleteTarget(null); show(`${itemNoun} deleted`)
    } catch (e: any) { show(e?.response?.data?.detail || 'Failed to delete', 'error') }
    finally { setSaving(false) }
  }

  if (isLoading) return <div style={{ padding: 24, color: 'var(--muted)', fontSize: 13 }}>Loading…</div>

  return (
    <div className="card" style={{ maxWidth: 600, marginBottom: 24 }}>
      <div className="card-hdr">
        {title}
        <button className="btn btn-dark btn-sm" onClick={() => setShowAdd(true)}>
          <Plus size={13} /> Add {itemNoun}
        </button>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {(tags as any[]).length === 0 && (
          <div style={{ padding: '16px 18px', fontSize: 13, color: 'var(--muted)' }}>
            No {itemNoun.toLowerCase()}s yet. {placeholder}
          </div>
        )}
        {(tags as any[]).map((t: any) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
            <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{t.name}</div>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 10,
              background: t.color + '20', color: t.color, border: `1px solid ${t.color}40`,
            }}>{t.name}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditTarget(t); setEditForm({ name: t.name, color: t.color }) }} style={{ padding: '2px 6px' }}>
              <Pencil size={13} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setDeleteTarget(t)} style={{ color: '#c0392b', padding: '2px 6px' }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      {showAdd && (
        <Modal title={`Add ${itemNoun}`} onClose={() => setShowAdd(false)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn btn-dark btn-sm" onClick={handleAdd} disabled={saving}>{saving ? 'Adding…' : 'Add'}</button>
          </>
        }>
          <div className="fgroup">
            <label className="flabel">{itemNoun} Name *</label>
            <input className="finput" value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
              placeholder={placeholder} onKeyDown={e => { if (e.key === 'Enter') handleAdd() }} autoFocus />
          </div>
          <div className="fgroup">
            <label className="flabel">Color</label>
            <ColorPicker value={newForm.color} onChange={c => setNewForm(f => ({ ...f, color: c }))} />
          </div>
        </Modal>
      )}

      {editTarget && (
        <Modal title={`Edit ${itemNoun}`} onClose={() => setEditTarget(null)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setEditTarget(null)}>Cancel</button>
            <button className="btn btn-dark btn-sm" onClick={handleEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </>
        }>
          <div className="fgroup">
            <label className="flabel">{itemNoun} Name *</label>
            <input className="finput" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') handleEdit() }} autoFocus />
          </div>
          <div className="fgroup">
            <label className="flabel">Color</label>
            <ColorPicker value={editForm.color} onChange={c => setEditForm(f => ({ ...f, color: c }))} />
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title={`Delete ${itemNoun}`} onClose={() => setDeleteTarget(null)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button className="btn btn-sm" onClick={handleDelete} disabled={saving}
              style={{ background: '#c0392b', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              {saving ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }>
          <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.6 }}>
            Delete {itemNoun.toLowerCase()} <strong>"{deleteTarget.name}"</strong>? Clients will keep the {itemNoun.toLowerCase()} text; only the color config is removed.
          </div>
        </Modal>
      )}
      {toastEl}
    </div>
  )
}

function TagsTab() {
  return (
    <div>
      <TagConfigCard
        title="Client Tags"
        queryKey="client-tag-configs"
        itemNoun="Tag"
        placeholder="e.g. VIP, Executive, On Hold"
        api={{
          list:   settingsApi.getClientTags,
          create: settingsApi.createClientTag,
          update: settingsApi.updateClientTag,
          remove: settingsApi.deleteClientTag,
        }}
      />
      <TagConfigCard
        title="Communication Tags"
        queryKey="communication-tag-configs"
        itemNoun="Tag"
        placeholder="e.g. Check-in, Billing, Re-engagement"
        api={{
          list:   settingsApi.getCommunicationTags,
          create: settingsApi.createCommunicationTag,
          update: settingsApi.updateCommunicationTag,
          remove: settingsApi.deleteCommunicationTag,
        }}
      />
    </div>
  )
}

// ── Lead Sources Tab ───────────────────────────────────────────────────────────
function LeadSourcesTab() {
  const { show, el: toastEl } = useToast()
  const qc = useQueryClient()
  const { data: sources = [], isLoading } = useQuery({
    queryKey: ['lead-source-configs'],
    queryFn: () => settingsApi.getLeadSources().then(r => r.data),
  })
  const [showAdd, setShowAdd]           = useState(false)
  const [editTarget, setEditTarget]     = useState<any>(null)
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const [newLabel, setNewLabel]         = useState('')
  const [editLabel, setEditLabel]       = useState('')
  const [saving, setSaving]             = useState(false)

  const handleAdd = async () => {
    if (!newLabel.trim()) return
    setSaving(true)
    try {
      await settingsApi.createLeadSource({ label: newLabel.trim() })
      qc.invalidateQueries({ queryKey: ['lead-source-configs'] })
      setShowAdd(false); setNewLabel('')
      show('Lead source added')
    } catch (e: any) { show(e?.response?.data?.label?.[0] || 'Failed to add', 'error') }
    finally { setSaving(false) }
  }

  const handleEdit = async () => {
    if (!editLabel.trim()) return
    setSaving(true)
    try {
      await settingsApi.updateLeadSource(editTarget.id, { label: editLabel.trim() })
      qc.invalidateQueries({ queryKey: ['lead-source-configs'] })
      setEditTarget(null); show('Lead source updated')
    } catch (e: any) { show(e?.response?.data?.label?.[0] || 'Failed to update', 'error') }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setSaving(true)
    try {
      await settingsApi.deleteLeadSource(deleteTarget.id)
      qc.invalidateQueries({ queryKey: ['lead-source-configs'] })
      setDeleteTarget(null); show('Lead source deleted')
    } catch (e: any) { show(e?.response?.data?.detail || 'Failed to delete', 'error') }
    finally { setSaving(false) }
  }

  if (isLoading) return <div style={{ padding: 24, color: 'var(--muted)', fontSize: 13 }}>Loading…</div>

  return (
    <div className="card" style={{ maxWidth: 600 }}>
      <div className="card-hdr">
        Lead Sources
        <button className="btn btn-dark btn-sm" onClick={() => setShowAdd(true)}>
          <Plus size={13} /> Add Source
        </button>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {(sources as any[]).map((s: any) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>
              {s.label}
              {s.is_builtin && <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 6, fontWeight: 400 }}>built-in</span>}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditTarget(s); setEditLabel(s.label) }} style={{ padding: '2px 6px' }}>
              <Pencil size={13} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setDeleteTarget(s)} style={{ color: '#c0392b', padding: '2px 6px' }} disabled={s.is_builtin}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      {showAdd && (
        <Modal title="Add Lead Source" onClose={() => setShowAdd(false)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn btn-dark btn-sm" onClick={handleAdd} disabled={saving}>{saving ? 'Adding…' : 'Add'}</button>
          </>
        }>
          <div className="fgroup">
            <label className="flabel">Label *</label>
            <input className="finput" value={newLabel} onChange={e => setNewLabel(e.target.value)}
              placeholder="e.g. Podcast, Partner Agency" onKeyDown={e => { if (e.key === 'Enter') handleAdd() }} autoFocus />
          </div>
        </Modal>
      )}

      {editTarget && (
        <Modal title="Edit Lead Source" onClose={() => setEditTarget(null)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setEditTarget(null)}>Cancel</button>
            <button className="btn btn-dark btn-sm" onClick={handleEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </>
        }>
          <div className="fgroup">
            <label className="flabel">Label *</label>
            <input className="finput" value={editLabel} onChange={e => setEditLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleEdit() }} autoFocus />
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Delete Lead Source" onClose={() => setDeleteTarget(null)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button className="btn btn-sm" onClick={handleDelete} disabled={saving}
              style={{ background: '#c0392b', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              {saving ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }>
          <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.6 }}>
            Delete <strong>"{deleteTarget.label}"</strong>? Clients with this lead source will keep the label text.
          </div>
        </Modal>
      )}
      {toastEl}
    </div>
  )
}

// ── Services Tab ───────────────────────────────────────────────────────────────
function ServicesTab() {
  const { show } = useToast()
  const qc = useQueryClient()
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['service-catalog'],
    queryFn: () => invoicesApi.catalogItems().then(r => r.data),
  })
  const [editTarget, setEditTarget] = useState<any>(null)
  const [editForm, setEditForm] = useState({ name: '', description: '', unit_price: '' })
  const [showAdd, setShowAdd] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', description: '', unit_price: '' })
  const [saving, setSaving] = useState(false)

  const openEdit = (item: any) => {
    setEditTarget(item)
    setEditForm({ name: item.name, description: item.description, unit_price: item.unit_price })
  }

  const handleAdd = async () => {
    if (!newForm.name.trim() || !newForm.unit_price) return
    setSaving(true)
    try {
      await invoicesApi.catalogCreate({ ...newForm, unit_price: Number(newForm.unit_price) })
      qc.invalidateQueries({ queryKey: ['service-catalog'] })
      setShowAdd(false)
      setNewForm({ name: '', description: '', unit_price: '' })
      show('Service added')
    } catch { show('Failed to add', 'error') } finally { setSaving(false) }
  }

  const handleEdit = async () => {
    if (!editForm.name.trim() || !editForm.unit_price) return
    setSaving(true)
    try {
      await invoicesApi.catalogUpdate(editTarget.id, { ...editForm, unit_price: Number(editForm.unit_price) })
      qc.invalidateQueries({ queryKey: ['service-catalog'] })
      setEditTarget(null)
      show('Service updated')
    } catch { show('Failed to update', 'error') } finally { setSaving(false) }
  }

  const handleDelete = async (item: any) => {
    if (!confirm(`Delete "${item.name}"?`)) return
    try {
      await invoicesApi.catalogDelete(item.id)
      qc.invalidateQueries({ queryKey: ['service-catalog'] })
      show('Deleted')
    } catch { show('Failed to delete', 'error') }
  }

  if (isLoading) return <div style={{ padding: 24, color: 'var(--muted)', fontSize: 13 }}>Loading…</div>

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div className="card-hdr">
        Service Catalog
        <button className="btn btn-dark btn-sm" onClick={() => setShowAdd(true)}>
          <Plus size={13} /> Add Service
        </button>
      </div>
      <div style={{ padding: '10px 18px 6px', fontSize: 12, color: 'var(--muted)' }}>
        Saved services appear as autocomplete suggestions when adding line items to invoices.
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {items.length === 0 && (
          <div style={{ padding: '24px 18px', color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
            No services yet — add your first one to speed up invoicing.
          </div>
        )}
        {items.map((item: any) => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{item.name}</div>
              {item.description && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{item.description}</div>}
            </div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, fontWeight: 600, color: 'var(--ink)', flexShrink: 0 }}>
              ${Number(item.unit_price).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => openEdit(item)} style={{ padding: '2px 6px' }}>
              <Pencil size={13} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(item)} style={{ color: '#c0392b', padding: '2px 6px' }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      {showAdd && (
        <Modal title="Add Service" onClose={() => setShowAdd(false)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn btn-dark btn-sm" onClick={handleAdd} disabled={saving}>{saving ? 'Adding…' : 'Add'}</button>
          </>
        }>
          <div className="fgroup">
            <label className="flabel">Service Name *</label>
            <input className="finput" value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Monthly Coaching Session" autoFocus />
          </div>
          <div className="fgroup">
            <label className="flabel">Short Description</label>
            <input className="finput" value={newForm.description} onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))} placeholder="Appears on the invoice line item" />
          </div>
          <div className="fgroup">
            <label className="flabel">Unit Price *</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--muted)', fontSize: 14 }}>$</span>
              <input className="finput" type="number" min="0" step="0.01" value={newForm.unit_price} onChange={e => setNewForm(f => ({ ...f, unit_price: e.target.value }))} placeholder="0.00" style={{ marginBottom: 0 }} />
            </div>
          </div>
        </Modal>
      )}

      {editTarget && (
        <Modal title="Edit Service" onClose={() => setEditTarget(null)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setEditTarget(null)}>Cancel</button>
            <button className="btn btn-dark btn-sm" onClick={handleEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </>
        }>
          <div className="fgroup">
            <label className="flabel">Service Name *</label>
            <input className="finput" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} autoFocus />
          </div>
          <div className="fgroup">
            <label className="flabel">Short Description</label>
            <input className="finput" value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="fgroup">
            <label className="flabel">Unit Price *</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--muted)', fontSize: 14 }}>$</span>
              <input className="finput" type="number" min="0" step="0.01" value={editForm.unit_price} onChange={e => setEditForm(f => ({ ...f, unit_price: e.target.value }))} style={{ marginBottom: 0 }} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Sample HTML template generator ─────────────────────────────────────────────
function generateSampleHtml(key: string): string {
  const isInvoice = key === 'invoice'
  const headerRow = (label: string, value: string) =>
    `<tr><td style="padding:10px 4px;color:#9e9890;font-size:12px;text-transform:uppercase;letter-spacing:.1em;width:110px;border-bottom:1px solid #f0ede8;">${label}</td><td style="padding:10px 4px;font-size:14px;font-weight:600;color:#1a1714;border-bottom:1px solid #f0ede8;">${value}</td></tr>`

  const rows = isInvoice
    ? [headerRow('Invoice #', '{invoice_number}'), headerRow('Amount', '{amount}'), headerRow('Due', '{due_date}')]
    : [headerRow('Session', '{session_title}'), headerRow('When', '{session_time}'), headerRow('Coach', '{coach_name}')]

  const intro = isInvoice
    ? `Hi {client_name}, your session with {coach_name} has been confirmed.`
    : `Hi {client_name}, your session with {coach_name} has been confirmed.`

  if (isInvoice) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{workspace_name}</title>
</head>
<body style="margin:0;padding:0;background:#f0ede8;font-family:{body_font_css};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">

      <!-- Header -->
      <tr>
        <td style="background:{header_bg};padding:24px 40px;border-radius:8px 8px 0 0;">
          {logo_img}
          <span style="font-family:Georgia,serif;font-size:22px;color:#f7f4ef;">{workspace_name}</span>
        </td>
      </tr>
      <tr><td style="height:3px;background:{accent_color};"></td></tr>

      <!-- Body -->
      <tr>
        <td style="background:#fff;padding:40px;border-radius:0 0 8px 8px;">
          <h1 style="margin:0 0 24px;font-family:{heading_font_css};font-size:26px;font-weight:400;color:#16130f;line-height:1.3;">
            {workspace_name} sent you an invoice.
          </h1>

          <p style="margin:0 0 16px;font-size:15px;color:#3a3530;line-height:1.7;">
            You've received an invoice for <strong>\${amount}</strong> with payment due on <strong>{due_date}</strong>.
          </p>
          <p style="margin:0 0 28px;font-size:15px;color:#3a3530;line-height:1.7;">
            {view_instructions}
          </p>
          {pay_button}
          <p style="margin:0 0 24px;font-size:15px;color:#3a3530;line-height:1.7;">
            Please email us at <a href="mailto:{owner_email}" style="color:{accent_color};">{owner_email}</a> with any questions.
          </p>
          <p style="margin:0 0 4px;font-size:15px;color:#3a3530;">Thanks!</p>
          <p style="margin:0;font-size:15px;color:#3a3530;font-weight:600;">{workspace_name}</p>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="padding:20px;text-align:center;font-size:11px;color:#b5afa6;">
          Sent by {workspace_name} &middot; Invoice #{invoice_number}
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{workspace_name}</title>
</head>
<body style="margin:0;padding:0;background:#f0ede8;font-family:{body_font_css};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">

      <!-- HEADER -->
      <tr>
        <td style="background:#1a2f4e;padding:24px 40px;border-radius:8px 8px 0 0;">
          <span style="font-family:Georgia,serif;font-size:22px;color:#f7f4ef;font-weight:400;letter-spacing:.04em;">{workspace_name}</span>
        </td>
      </tr>
      <tr><td style="height:3px;background:#b8922e;"></td></tr>

      <!-- BODY -->
      <tr>
        <td style="background:#ffffff;padding:40px;border-radius:0 0 8px 8px;">
          <p style="margin:0 0 24px;font-size:15px;color:#6e6560;line-height:1.7;">${intro}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="border-top:2px solid #1a2f4e;margin-bottom:28px;">
            ${rows.join('\n            ')}
          </table>
          <p style="margin:0 0 16px;font-size:13px;color:#6e6560;line-height:1.7;">
            If you have any questions, please reply to this email.
          </p>
          <p style="margin:24px 0 0;font-family:Georgia,serif;font-size:15px;color:#9e9890;">
            &mdash; {workspace_name}
          </p>
        </td>
      </tr>

      <!-- FOOTER -->
      <tr>
        <td style="padding:20px;text-align:center;font-size:11px;color:#b5afa6;">
          Sent by {workspace_name}
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
}

// ── Generic Email Templates ───────────────────────────────────────────────────
// Named, reusable templates you build once and then assign to one or more
// use-cases (invoice, reminders, client communication, …) — the single place
// to define and edit every outbound email in the product.
// `audience` groups the list in the UI — who actually receives this email. The rest of
// the use cases (coach copies, client-action notices, goal/note shared, …) come from
// the backend's notice registry (GET /api/settings/email-use-cases/, tasks/email_notices.py)
// and are appended at runtime — see useAllUseCases below.
type UseCase = { key: string; label: string; audience: 'client' | 'coach' | 'team' }
const GENERIC_USE_CASES: UseCase[] = [
  { key: 'confirmation',         label: 'Booking Confirmation',     audience: 'client' },
  { key: 'reschedule',           label: 'Reschedule Notice',        audience: 'client' },
  { key: 'reminder_24h',         label: '24h Reminder',             audience: 'client' },
  { key: 'reminder_1h',          label: '1h Reminder',              audience: 'client' },
  { key: 'invoice',              label: 'Invoice',                  audience: 'client' },
  { key: 'payment_receipt',      label: 'Payment Receipt',          audience: 'client' },
  { key: 'portal_invite',        label: 'Portal Invite',            audience: 'client' },
  { key: 'client_communication', label: 'Client Communication',     audience: 'client' },
  { key: 'team_invite',          label: 'Team Invite',              audience: 'team' },
  { key: 'pipeline',             label: 'Pipeline Follow-up Alert', audience: 'coach' },
]

// Built-in eyebrow / heading per use case — shown as the placeholder in the editor's
// Heading fields so a coach can see what they're overriding (blank = keep built-in).
const BUILTIN_HEADINGS: Record<string, { eyebrow: string; heading: string }> = {
  confirmation:    { eyebrow: 'Session Confirmed',     heading: 'Your session is confirmed' },
  reschedule:      { eyebrow: 'Session Updated',       heading: 'Your session has been updated' },
  reminder_24h:    { eyebrow: 'Reminder · 24 hours away', heading: 'Session reminder' },
  reminder_1h:     { eyebrow: 'Upcoming in 1 hour',    heading: 'Session reminder' },
  payment_receipt: { eyebrow: 'Payment Received',      heading: '$ amount paid' },
  portal_invite:   { eyebrow: 'Portal Access',         heading: 'Your portal is ready' },
  team_invite:     { eyebrow: 'Team Invitation',       heading: "You've been invited" },
  pipeline:        { eyebrow: 'Follow-up required',    heading: '{client_name} needs attention' },
}
// One line on when each email goes out — shown under its name in the email list.
const USE_CASE_WHEN: Record<string, string> = {
  confirmation:            'When you book a session with "send confirmation" on',
  reschedule:              'When a session time changes or a new time is confirmed',
  reminder_24h:            'Automatically, 24 hours before a session',
  reminder_1h:             'Automatically, 1 hour before a session',
  invoice:                 'When you send an invoice',
  payment_receipt:         'When a client pays an invoice',
  portal_invite:           'When you give a client portal access',
  client_communication:    'One-off messages you write from a client’s page',
  cancellation:            'When a session is cancelled',
  reschedule_ack:          'When a client requests a new time',
  decline_reschedule:      'When you decline a client’s proposed time with a note',
  goal_shared:             'When you share a goal with a client',
  note_shared:             'When you share a session note with a client',
  pipeline:                'When a deal sits in a stage past its follow-up threshold',
  pipeline_client:         'When a client’s deal sits in a stage (if the stage notifies the client)',
  coach_session_booked:    'Your copy when a session is booked',
  coach_session_reminder:  'Your copy of the session reminder',
  coach_session_updated:   'Your copy when a session is rescheduled',
  coach_session_cancelled: 'Your copy when a session is cancelled',
  client_confirmed_notice: 'When a client confirms from their email',
  client_cancelled_notice: 'When a client cancels from their email',
  client_rsvp_notice:      'When a client responds to the Google Calendar invite',
  reschedule_request:      'When a client asks to reschedule',
  payment_failed:          'When a client’s card payment fails',
  contract_signed:         'When a client signs a contract',
  team_invite:             'When you invite someone to your workspace',
}

// Which optional blocks a use case actually has — the editor only offers toggles for
// blocks that exist in that email. Notices from the backend registry all have a
// details card and a sign-off.
const HAS_ACTIONS = new Set(['confirmation', 'reschedule', 'reminder_24h', 'reminder_1h'])
const NO_DETAILS  = new Set(['team_invite', 'portal_invite', 'pipeline', 'decline_reschedule'])
const NO_SIGNOFF  = new Set(['team_invite'])

// Merges the backend notice registry into the static lists above.
function useAllUseCases() {
  const { notices, starters } = useEmailUseCases()
  const useCases: UseCase[] = [...GENERIC_USE_CASES, ...notices.map(n => ({ key: n.key, label: n.label, audience: n.audience }))]
  const samples: Record<string, { subject: string; intro: string; closing: string }> = { ...USE_CASE_SAMPLES }
  const hints: Record<string, string[]> = { ...PLACEHOLDER_HINTS }
  const headings: Record<string, { eyebrow: string; heading: string }> = { ...BUILTIN_HEADINGS }
  notices.forEach(n => {
    samples[n.key]  = { subject: n.subject, intro: n.intro, closing: n.closing }
    hints[n.key]    = n.placeholders
    headings[n.key] = { eyebrow: n.eyebrow, heading: n.heading }
  })
  // Starter subject/message/closing win over the older samples — they're what an
  // un-customized email actually sends now (backend/tasks/email_starters.py).
  Object.entries(starters).forEach(([k, st]) => { samples[k] = { subject: st.subject, intro: st.intro, closing: st.closing } })
  return { useCases, samples, hints, headings, starters }
}

// Placeholders substituted at send time — differ per use case since each pulls from
// a different backend context (a session, an invoice, a portal link, …).
// {client_first_name}/{client_email}/{client_address} are now available on every use
// case that has a client at all (see the matching tmpl_vars additions in
// tasks/email.py and the DUMMY/preview_vars additions in settings_app/views.py) —
// team_invite is the one exception, since that email goes to an invited coach, not
// a client, so there's no client context to offer there.
const PLACEHOLDER_HINTS: Record<string, string[]> = {
  confirmation:         ['{client_name}', '{client_first_name}', '{client_email}', '{client_address}', '{coach_name}', '{workspace_name}', '{session_title}', '{session_time}'],
  reschedule:           ['{client_name}', '{client_first_name}', '{client_email}', '{client_address}', '{coach_name}', '{workspace_name}', '{session_title}', '{session_time}'],
  reminder_24h:         ['{client_name}', '{client_first_name}', '{client_email}', '{client_address}', '{coach_name}', '{workspace_name}', '{session_title}', '{session_time}', '{time_label}'],
  reminder_1h:          ['{client_name}', '{client_first_name}', '{client_email}', '{client_address}', '{coach_name}', '{workspace_name}', '{session_title}', '{session_time}', '{time_label}'],
  invoice:              ['{client_name}', '{client_first_name}', '{client_email}', '{client_address}', '{workspace_name}', '{invoice_number}', '{amount}', '{due_date}'],
  payment_receipt:      ['{client_name}', '{client_first_name}', '{client_email}', '{client_address}', '{workspace_name}', '{invoice_number}', '{amount}', '{payment_date}', '{owner_name}', '{owner_email}'],
  client_communication: ['{client_name}', '{client_first_name}', '{coach_name}', '{workspace_name}', '{workspace_owner}', '{client_email}', '{client_address}'],
  team_invite:          ['{invited_by_name}', '{workspace_name}', '{role}', '{accept_url}', '{owner_name}', '{owner_email}'],
  pipeline:             ['{owner_name}', '{client_name}', '{client_first_name}', '{client_email}', '{client_address}', '{workspace_name}', '{stage_label}', '{days_in_stage}', '{follow_up_days}', '{deal_value}', '{stage_entered}'],
  portal_invite:        ['{client_name}', '{client_first_name}', '{client_email}', '{client_address}', '{coach_name}', '{workspace_name}', '{portal_url}'],
}
const DEFAULT_PLACEHOLDER_HINT = ['{client_name}', '{client_first_name}', '{client_email}', '{client_address}', '{workspace_name}', '{coach_name}']

// Ready-to-edit starting copy for each use case — lets a coach get a working, on-brand
// template in one click instead of starting from a blank editor.
const USE_CASE_SAMPLES: Record<string, { subject: string; intro: string; closing: string }> = {
  confirmation: {
    subject: 'Confirmed: your session with {coach_name}',
    intro:   'Hi {client_name}, your session with {coach_name} has been scheduled. We look forward to seeing you.',
    closing: 'Need to reschedule or have questions? Contact {coach_name} directly.',
  },
  reschedule: {
    subject: 'Updated: your session with {coach_name}',
    intro:   'Hi {client_name}, your session with {coach_name} has been updated. Here are your new session details.',
    closing: 'Need to reschedule again or have questions? Contact {coach_name} directly.',
  },
  reminder_24h: {
    subject: 'Reminder: your session is in 24 hours',
    intro:   'Hi {client_name}, this is a friendly reminder about your upcoming session with {coach_name}.',
    closing: 'Need to reschedule? Please contact {coach_name} as soon as possible.',
  },
  reminder_1h: {
    subject: 'Reminder: your session starts in 1 hour',
    intro:   'Hi {client_name}, this is a friendly reminder that your session with {coach_name} starts in 1 hour.',
    closing: 'Need to reschedule? Please contact {coach_name} as soon as possible.',
  },
  invoice: {
    subject: 'Invoice from {workspace_name}',
    intro:   "You've received a new invoice from {workspace_name}. Please see the attached details.",
    // "Thanks! / {workspace_name}" — see the matching comment in EmailEditModal.tsx's
    // own USE_CASE_SAMPLE.invoice for why this is now part of the editable text instead
    // of a separate hardcoded sign-off block.
    closing: "Questions about this invoice? Just reply to this email.\n\nThanks!\n{workspace_name}",
  },
  payment_receipt: {
    subject: 'Receipt: Invoice {invoice_number} — Payment Received',
    intro:   "Hi {client_name}, thank you — we've received your payment of ${amount} for invoice {invoice_number}. A copy of your receipt is attached.",
    closing: 'Questions about this payment? Just reply to this email.',
  },
  team_invite: {
    subject: "You're invited to join {workspace_name}",
    intro:   'Hi, {invited_by_name} has invited you to join {workspace_name} on CoachOS as a {role}.',
    closing: 'Accept the invitation below to get started.',
  },
  client_communication: {
    subject: 'Welcome to LMT Consulting Coaching!',
    intro: `Welcome to LMT Consulting Coaching! I am honored to be working with you.<br><br>Let's get started - all coaching sessions begin with our DISC and Driving Forces assessment debrief.<br><br>What are DISC and Driving Forces?  The DISC is an assessment that measures observable behavior to create self-awareness around our actions.  Basically, it helps explain how we behave and how that behavior impacts our communication with others.  The Driving Forces Assessment shows us what motivates our decisions, essentially why we do what we do.  It is important to know when taking these assessments there are no right or wrong answers and one behavioral style or motivator is NOT better than another.  Each one of us is born with intrinsic gifts and when we use our natural talents, we find greater success and increased happiness.  Our use of these assessments is to help you understand your natural talents and how to capitalize on them in business and in life.  So relax, have fun and answer the questions based on the first thought that comes to your mind; try not to over-think or over-analyze your answers.  The assessments are simple to take, but be sure to set aside 15-20 minutes in a quiet place to complete the assessments.<br><br><a href="https://www.ttisurvey.com/465190CWY?locale=en_US" style="color:#b8922e;text-decoration:none;font-weight:600;">Click here to take your assessment now!</a>`,
    closing: 'The report will be sent directly to LMT Consulting. Upon receipt of your results, we will contact you via email to schedule your debrief.  Please know the session will run approximately 1 hour.  It will be important to set aside the appropriate time to review your results.  I look forward to speaking to you!',
  },
  portal_invite: {
    subject: 'Your portal access is ready — {workspace_name}',
    intro:   'Hi {client_first_name}, {workspace_name} has given you access to your client portal, where you can see your sessions, goals, invoices and shared materials.',
    closing: 'If you have any questions, reply to this email or contact {coach_name}.',
  },
  pipeline: {
    subject: 'Follow-up needed: {client_name} — {stage_label} ({days_in_stage} days)',
    intro:   'Hi {owner_name}, this deal has been sitting in {stage_label} for {days_in_stage} days — past your follow-up threshold of {follow_up_days} days.',
    closing: 'Once the deal moves to a new stage, this alert resets automatically.',
  },
}

// A second, alternate sample for Client Communication — formal contract copy with a
// client signature line turned on by default. Not tied to a use-case slot (only one
// template can be "the" assigned Client Communication template at a time), so it's
// added as a separate saved template a coach picks from the "Start from a template?"
// list alongside the friendly note sample.
const CONTRACT_SAMPLE = {
  name: 'Contract Agreement',
  subject: 'Coaching Services Agreement — {workspace_name}',
  intro: [
    'This Coaching Services Agreement ("Agreement") is entered into between {workspace_name} ("Coach") and {client_name} ("Client"), effective as of the date signed below.',
    '',
    'Scope of Services: {workspace_name} agrees to provide coaching services as outlined during our engagement discussions, including scheduled sessions, progress tracking, and related support.',
    '',
    'Fees & Payment: Fees for services will be invoiced separately and are due according to the agreed payment schedule.',
    '',
    'Confidentiality: Both parties agree to keep shared information confidential and use it solely for the purpose of this engagement.',
    '',
    'Termination: Either party may terminate this agreement with 14 days written notice.',
  ].join('\n'),
  closing: 'By signing below, both parties agree to the terms of this Agreement.',
}

// Client Communication and Invoice templates both edit as a single free-form "Message"
// box (matching the compose experience at Client Communication > New Message > Start
// Blank), not the separate Opening/Closing split every other use case still uses. This
// merges a legacy intro+closing pair into one block the same way ClientDetail.tsx's
// startFromTemplate() does, plus converts stray literal "<br>" tags (pre-dating the
// paragraph-splitting renderer) into real blank lines so old content regains proper
// paragraph spacing instead of showing raw tags. Safe to reapply on every open — a no-op
// once closing is already ''. (Invoice's "Body — Closing" already had no effect on the
// real send before this — see _invoice_closing_block in tasks/email.py — so merging it
// into the message here isn't losing anything that used to work.)
const SIMPLE_MESSAGE_USE_CASES = new Set(['client_communication', 'invoice'])
const brToNewlines = (s: string) => (s || '').replace(/<br\s*\/?>/gi, '\n')
const mergeSimpleMessageContent = (t: any) => {
  const effectiveUseCase = (t.use_cases && t.use_cases.length > 0) ? t.use_cases[0] : 'client_communication'
  if (!SIMPLE_MESSAGE_USE_CASES.has(effectiveUseCase)) return t
  const merged = [brToNewlines(t.intro), brToNewlines(t.closing)].map((s: string) => s.trim()).filter(Boolean).join('\n\n')
  return { ...t, intro: merged, closing: '' }
}
// Same starting look as Start Blank — plain white header (logo only), footer off. Only
// for genuinely new/never-configured content (openNew, a use case's built-in sample) —
// NOT applied when reopening an already-saved template, which would silently overwrite
// a coach's own header/footer customization every time they reopen the editor.
//
// Invoice specifically starts with "Show header" AND "Show footer" both unchecked
// (header_bg/accent_color stay white as the fallback look if a coach later re-enables
// the header) — a plain invoice email, no logo/banner/footer, unless a coach opts back
// in. Client Communication keeps the header on (just styled white/logo-only), matching
// its own dedicated composer's default in ClientDetail.tsx's startBlank().
const simpleMessageStartStyle = (ucKey: string) => ({
  show_header: ucKey !== 'invoice', header_bg: '#ffffff', accent_color: '#ffffff', show_footer: false,
})

// Shows a saved session template's blank subject/heading/sign-off as the built-in words
// they stand for (same email either way), so the editor never hides text that the
// preview shows — see the matching comment in EmailEditModal.tsx.
const withBuiltinText = (t: any, starters: Record<string, EmailStarter>) => {
  const uc = (t.use_cases && t.use_cases[0]) || ''
  const builtin = BUILTIN_TEXT[uc]
  if (!builtin) return t
  const style = { ...t.style }
  if (!style.eyebrow_text) style.eyebrow_text = builtin.eyebrow
  if (!style.heading_text) style.heading_text = builtin.heading
  if (!style.signoff_text) style.signoff_text = '— {workspace_name}'
  return { ...t, subject: t.subject || starters[uc]?.subject || '', style }
}

const blankGenericTemplate = () => ({
  id: `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name: '', subject: '', intro: '', closing: '',
  custom_html: '', disable_style: false, show_logo: true,
  style: { header_bg: '', accent_color: '', header_tagline: '', show_header: true, show_footer: true, footer_text: '', show_contact_line: true } as Record<string, any>,
  use_cases: [] as string[],
  include_client_signature_line: false,
})

function GenericTemplatesTab() {
  const { useCases, samples, hints, headings, starters } = useAllUseCases()
  const { workspace, user, rehydrate } = useAuthStore()
  const { show } = useToast()
  const [templates, setTemplates] = useState<any[]>((workspace as any)?.generic_templates || [])
  const [useCaseMap, setUseCaseMap] = useState<Record<string, string>>((workspace as any)?.template_use_case_map || {})
  const [editing, setEditing] = useState<any>(null)
  // Set only when the editor was opened via a specific use case's "Default" card — the
  // purpose is already known then, so saving assigns it immediately instead of asking
  // "where should this be used?" a second time. Cleared for openNew/openEdit, where the
  // purpose genuinely is ambiguous (a from-scratch template, or an existing one that
  // might be getting repurposed).
  const [directAssignUseCase, setDirectAssignUseCase] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [assignChecks, setAssignChecks] = useState<Record<string, boolean>>({})
  const [addingSample, setAddingSample] = useState<string | null>(null)
  const [emailTab, setEmailTab] = useState<'client' | 'coach' | 'team' | 'library'>('client')

  const persist = async (nextTemplates: any[], nextMap: Record<string, string>) => {
    const { data } = await api.patch('/api/settings/workspace/', {
      generic_templates: nextTemplates, template_use_case_map: nextMap,
    })
    if (user) rehydrate(user, { ...workspace, ...data })
    setTemplates(data.generic_templates || nextTemplates)
    setUseCaseMap(data.template_use_case_map || nextMap)
  }



  const hasContractSample = templates.some(t => t.name === CONTRACT_SAMPLE.name)

  const handleAddContractSample = async () => {
    setAddingSample('contract')
    try {
      const blank = blankGenericTemplate()
      const newTmpl = {
        ...blank,
        name: CONTRACT_SAMPLE.name,
        subject: CONTRACT_SAMPLE.subject, intro: CONTRACT_SAMPLE.intro, closing: CONTRACT_SAMPLE.closing,
        include_client_signature_line: true,
        // Footer off by default for this one — a contract reads cleaner without the
        // "automated notification" disclaimer under the signature line. Still a normal
        // checkbox in the editor below, so a coach can turn it back on per-template.
        style: { ...blank.style, show_footer: false },
        // Not auto-assigned to the Client Communication slot — it's an alternate
        // starting point a coach picks explicitly, not the default for that use case.
      }
      await persist([...templates, newTmpl], useCaseMap)
      show('Contract Agreement sample added — edit it any time')
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Failed to add sample', 'error')
    } finally { setAddingSample(null) }
  }

  const renderPreview = async (t: any) => {
    setPreviewLoading(true)
    try {
      // Preview using whichever use case this template is actually assigned to — not
      // always client_communication — so the preview matches what will really be sent
      // (correct fixed heading, correct footer, correct available placeholders).
      // Unassigned templates (e.g. a fresh draft, or Contract Agreement) have no way to
      // know their eventual use case, so client_communication remains a sane fallback.
      const previewType = (t.use_cases && t.use_cases.length > 0) ? t.use_cases[0] : 'client_communication'
      const params: Record<string, string> = {
        type: previewType, client_name: 'Jane Smith',
        subject: t.subject || 'Your subject line',
        intro: t.intro, closing: t.closing, _t: String(Date.now()),
      }
      if (t.style.header_bg)    params.header_bg = t.style.header_bg
      if (t.style.accent_color) params.accent_color = t.style.accent_color
      if (t.style.header_tagline !== undefined) params.header_tagline = t.style.header_tagline
      if (t.style.footer_text !== undefined) params.footer_text = t.style.footer_text
      if (!t.show_logo) params.hide_logo = '1'
      params.show_header = t.style.show_header === false ? '0' : '1'
      params.show_footer = t.style.show_footer === false ? '0' : '1'
      params.show_contact_line = t.style.show_contact_line === false ? '0' : '1'
      params.include_client_signature_line = t.include_client_signature_line ? '1' : '0'
      // Content blocks: only sent once set, so each use case's own default (e.g. invoice's
      // heading off) applies until the coach actually changes it.
      for (const k of ['show_heading', 'show_signature', 'show_details', 'show_actions', 'show_calendar']) {
        if (t.style[k] !== undefined) params[k] = t.style[k] === false ? '0' : '1'
      }
      for (const k of ['heading_text', 'eyebrow_text', 'signoff_text']) {
        if (t.style[k]) params[k] = t.style[k]
      }
      const { data } = await api.get('/api/settings/email-preview/', { params })
      setPreviewHtml(data.html)
    } catch { setPreviewHtml('') }
    finally { setPreviewLoading(false) }
  }

  useEffect(() => {
    if (!editing) return
    const t = setTimeout(() => renderPreview(editing), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.subject, editing?.intro, editing?.closing, editing?.style?.header_bg,
      editing?.style?.accent_color, editing?.style?.header_tagline, editing?.style?.show_header,
      editing?.style?.show_footer, editing?.style?.footer_text, editing?.style?.show_contact_line,
      editing?.show_logo, editing?.include_client_signature_line,
      editing?.style?.show_heading, editing?.style?.show_signature, editing?.style?.show_details,
      editing?.style?.show_actions, editing?.style?.show_calendar, editing?.style?.heading_text, editing?.style?.eyebrow_text,
      editing?.style?.signoff_text])

  const openNew  = () => {
    setDirectAssignUseCase(null)
    const blank = blankGenericTemplate()
    // No use case chosen yet here (that happens at save/assign time) — 'client_communication'
    // just picks the non-invoice ("header on, styled white/logo-only") starting look as the
    // generic default, same as before this became use-case-aware.
    setEditing(mergeSimpleMessageContent({ ...blank, style: { ...blank.style, ...simpleMessageStartStyle('client_communication') } }))
  }
  const openEdit = (t: any) => { setDirectAssignUseCase(null); setEditing(withBuiltinText(mergeSimpleMessageContent({ ...t, style: { show_header: true, show_footer: true, footer_text: '', show_contact_line: true, ...t.style } }), starters)) }
  const setStyle = (k: string, v: string | boolean) => setEditing((e: any) => ({ ...e, style: { ...e.style, [k]: v } }))

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template?')) return
    const nextTemplates = templates.filter(t => t.id !== id)
    const nextMap = { ...useCaseMap }
    Object.keys(nextMap).forEach(k => { if (nextMap[k] === id) delete nextMap[k] })
    await persist(nextTemplates, nextMap)
    show('Template deleted')
  }

  // Clone a template's current content into a new, independently-editable copy — the
  // original stays exactly as-is (including remaining "the" active default, since
  // useCaseMap isn't touched here), so a coach can freely experiment on the copy
  // without losing the original. The copy keeps the same use case(s) as its source, so
  // it's immediately selectable as an alternative in that use case's picker (e.g. next
  // to "Invoice" in the invoice send screen) — not just sitting unused until manually
  // re-assigned.
  const handleDuplicate = async (t: any) => {
    const copy = {
      ...t,
      id: `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: `${t.name || 'Untitled'} (Copy)`,
      use_cases: [...(t.use_cases || [])],
    }
    await persist([...templates, copy], useCaseMap)
    show(`Duplicated "${t.name}" — edit the copy any time`)
  }

  // "Edit" on a Default card — if something's already assigned to this slot, edit that
  // template directly (editing it is what changes the default). If nothing's assigned
  // yet, open a new editor pre-filled with the built-in starter content, pre-assigned to
  // this use case — saving it is what actually creates and activates the default.
  const openDefaultEditor = (ucKey: string) => {
    setDirectAssignUseCase(ucKey)
    const assignedId = useCaseMap[ucKey]
    const assigned = assignedId ? templates.find(t => t.id === assignedId) : null
    if (assigned) {
      setEditing(withBuiltinText(mergeSimpleMessageContent({ ...assigned, style: { show_header: true, show_footer: true, footer_text: '', show_contact_line: true, ...assigned.style } }), starters))
      return
    }
    const starter = starters[ucKey]
    if (starter) {
      const blank = blankGenericTemplate()
      setEditing({
        ...blank, name: useCases.find(u => u.key === ucKey)?.label || ucKey,
        subject: starter.subject, intro: starter.intro, closing: starter.closing,
        use_cases: [ucKey], style: { ...blank.style, ...starter.style },
      })
      return
    }
    const sample = samples[ucKey]
    const uc = useCases.find(u => u.key === ucKey)
    const blank = blankGenericTemplate()
    setEditing(mergeSimpleMessageContent({
      ...blank,
      name: uc?.label || ucKey,
      subject: sample?.subject || '', intro: sample?.intro || '', closing: sample?.closing || '',
      use_cases: [ucKey],
      // White/logo-only header (or, for invoice, no header at all — see
      // simpleMessageStartStyle) and footer off, for every use case's fresh default now,
      // not just Client Communication/Invoice — a coach opts back into the full branded
      // banner look via the Header/Footer checkboxes below if they want it.
      style: { ...blank.style, ...simpleMessageStartStyle(ucKey) },
    }))
  }

  const handleSaveTemplate = async () => {
    if (!editing.name.trim()) { show('Give this template a name', 'error'); return }
    setSaving(true)
    try {
      const exists = templates.some(t => t.id === editing.id)
      const nextTemplates = exists ? templates.map(t => t.id === editing.id ? editing : t) : [...templates, editing]

      if (directAssignUseCase) {
        // Opened via a specific use case's "Default" card — the purpose was never
        // ambiguous, so save + assign happen together instead of behind a second
        // "where should this be used?" screen. This is exactly the step that was
        // previously easy to stop short of: saving the template content alone (this
        // block used to end here) left template_use_case_map untouched, so the
        // edit — however correct it looked in the live preview — never actually
        // became what any send path resolves to.
        const nextMap = { ...useCaseMap, [directAssignUseCase]: editing.id }
        const taggedTemplates = nextTemplates.map(t => t.id === editing.id
          ? { ...t, use_cases: Array.from(new Set([...(t.use_cases || []), directAssignUseCase])) }
          : t
        )
        await persist(taggedTemplates, nextMap)
        show(`Saved — now the default for ${useCases.find(u => u.key === directAssignUseCase)?.label || directAssignUseCase}`)
        setDirectAssignUseCase(null)
        setEditing(null)
        return
      }

      await persist(nextTemplates, useCaseMap)
      // Pre-check based on this template's own use_cases tags, not just whichever one
      // happens to be "the" active default — otherwise a template that's tagged as a
      // selectable alternative (but not currently active) would show every box
      // unchecked here, and saving would wipe its tags right back out.
      const checks: Record<string, boolean> = {}
      useCases.forEach(u => { checks[u.key] = (editing.use_cases || []).includes(u.key) })
      setAssignChecks(checks)
      setAssigning(true)
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Failed to save template', 'error')
    } finally { setSaving(false) }
  }

  const handleSaveAssignment = async () => {
    setSaving(true)
    try {
      const nextMap = { ...useCaseMap }
      useCases.forEach(u => {
        if (assignChecks[u.key]) nextMap[u.key] = editing.id
        else if (nextMap[u.key] === editing.id) delete nextMap[u.key]
      })
      // Only update THIS template's own use_cases (from its checked boxes) — don't
      // touch any other template's use_cases. Checking a box here makes this template
      // "the" active default for that slot (nextMap), but other templates already
      // tagged for the same use case (e.g. a duplicate kept as a selectable
      // alternative) must keep their own tags; recomputing everyone's use_cases from
      // nextMap would silently strip every non-active template back to unassigned.
      const nextTemplates = templates.map(t => t.id === editing.id
        ? { ...t, use_cases: useCases.filter(u => assignChecks[u.key]).map(u => u.key) }
        : t
      )
      await persist(nextTemplates, nextMap)
      show('Saved')
      setAssigning(false)
      setEditing(null)
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Failed to save assignment', 'error')
    } finally { setSaving(false) }
  }

  if (assigning && editing) {
    return (
      <div style={{ maxWidth: 480 }}>
        <div className="card"><div className="card-body">
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Where should "{editing.name}" be used?</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
            Assigning it to a slot replaces whatever template was driving that email before.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {useCases.map(u => {
              const takenBy = useCaseMap[u.key] && useCaseMap[u.key] !== editing.id
                ? templates.find(t => t.id === useCaseMap[u.key])?.name : null
              return (
                <label key={u.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!assignChecks[u.key]}
                    onChange={e => setAssignChecks(c => ({ ...c, [u.key]: e.target.checked }))} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{u.label}</div>
                    {takenBy && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Currently: {takenBy} — will be replaced</div>}
                  </div>
                </label>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline btn-sm" onClick={() => { setAssigning(false); setEditing(null) }}>Skip for now</button>
            <button className="btn btn-dark btn-sm" onClick={handleSaveAssignment} disabled={saving}>{saving ? 'Saving…' : 'Save Assignment'}</button>
          </div>
        </div></div>
      </div>
    )
  }

  if (editing) {
    // Union of placeholders for whichever use cases this template is already assigned
    // to; falls back to the common baseline for a brand-new, not-yet-assigned template.
    const assignedHints = (editing.use_cases || []).flatMap((uc: string) => hints[uc] || [])
    const activePlaceholders = Array.from(new Set(assignedHints.length ? assignedHints : DEFAULT_PLACEHOLDER_HINT))
    // Client Communication and Invoice templates get the same single-"Message"-box editing
    // experience as Client Communication > New Message > Start Blank, instead of the
    // Opening/Closing split every other use case still uses — see mergeSimpleMessageContent
    // above.
    const effectiveUseCase = (editing.use_cases && editing.use_cases.length > 0) ? editing.use_cases[0] : 'client_communication'
    const isSimpleMessage = SIMPLE_MESSAGE_USE_CASES.has(effectiveUseCase)
    const simpleMessagePlaceholders = hints[effectiveUseCase] || DEFAULT_PLACEHOLDER_HINT
    const builtinHeading = headings[effectiveUseCase] || { eyebrow: '', heading: '' }

    return (
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div className="card" style={{ flex: 1, minWidth: 0, maxWidth: 480 }}>
          <div className="card-body">
            <button className="btn btn-outline btn-sm" onClick={() => setEditing(null)} style={{ marginBottom: 12 }}>← Back</button>
            <div className="fgroup">
              <label className="flabel">Template Name</label>
              <input className="finput" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Warm Welcome" />
            </div>
            <div className="fgroup">
              <label className="flabel">Subject</label>
              <input className="finput" value={editing.subject} onChange={e => setEditing({ ...editing, subject: e.target.value })} placeholder="e.g. A quick note from {workspace_name}" />
            </div>
            {!isSimpleMessage && (
              <div className="fgroup">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label className="flabel">Heading</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={editing.style.show_heading !== false}
                      onChange={e => setStyle('show_heading', e.target.checked)} />
                    Show
                  </label>
                </div>
                <fieldset disabled={editing.style.show_heading === false} style={{ border: 'none', padding: 0, margin: 0, opacity: editing.style.show_heading === false ? 0.5 : 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input className="finput" value={editing.style.eyebrow_text ?? ''} onChange={e => setStyle('eyebrow_text', e.target.value)}
                    placeholder={`Small label above — default: ${builtinHeading.eyebrow || 'none'}`} />
                  <input className="finput" value={editing.style.heading_text ?? ''} onChange={e => setStyle('heading_text', e.target.value)}
                    placeholder={`Heading — default: ${builtinHeading.heading || 'none'}`} />
                </fieldset>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>Leave blank to keep the default wording.</div>
              </div>
            )}
            <div className="fgroup">
              <label className="flabel">Message</label>
              <textarea className="ftextarea" rows={isSimpleMessage ? 12 : 5} value={editing.intro} onChange={e => setEditing({ ...editing, intro: e.target.value })} placeholder="Hi {client_name}, ..." />
            </div>
            {!isSimpleMessage && (
              <div className="fgroup">
                <label className="flabel">Closing</label>
                <textarea className="ftextarea" rows={3} value={editing.closing} onChange={e => setEditing({ ...editing, closing: e.target.value })} placeholder="Talk soon, ..." />
              </div>
            )}
            {!isSimpleMessage && (
              <div className="fgroup">
                <label className="flabel">What else to include</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {!NO_DETAILS.has(effectiveUseCase) && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={editing.style.show_details !== false}
                        onChange={e => setStyle('show_details', e.target.checked)} />
                      Details card (what / when / where)
                    </label>
                  )}
                  {HAS_ACTIONS.has(effectiveUseCase) && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)' }}
                      title="Always included — this is how clients confirm, reschedule or cancel">
                      <input type="checkbox" checked disabled />
                      Confirm / Reschedule / Cancel buttons <span style={{ fontSize: 11 }}>(always included)</span>
                    </label>
                  )}
                  {(effectiveUseCase === 'confirmation' || effectiveUseCase === 'reschedule') && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={editing.style.show_calendar !== false}
                        onChange={e => setStyle('show_calendar', e.target.checked)} />
                      "Add to calendar" box
                    </label>
                  )}
                  {!NO_SIGNOFF.has(effectiveUseCase) && (
                    <>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={editing.style.show_signature !== false}
                          onChange={e => setStyle('show_signature', e.target.checked)} />
                        Sign-off
                      </label>
                      {editing.style.show_signature !== false && (
                        <input className="finput" style={{ marginLeft: 22, width: 'calc(100% - 22px)' }}
                          value={editing.style.signoff_text ?? ''} onChange={e => setStyle('signoff_text', e.target.value)}
                          placeholder="— {workspace_name}" />
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
            {isSimpleMessage ? (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                Insert:
                {simpleMessagePlaceholders.map(token => (
                  <button
                    key={token}
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ padding: '2px 8px', fontSize: 11, fontFamily: 'monospace' }}
                    onClick={() => setEditing({ ...editing, intro: `${editing.intro}${editing.intro && !editing.intro.endsWith(' ') ? ' ' : ''}${token}` })}
                  >
                    {token}
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16 }}>
                Available: {activePlaceholders.join(' ')}
                {!(editing.use_cases || []).length && (
                  <span> — more become available once you save and assign this to a specific email type.</span>
                )}
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>Header</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={editing.style.show_header !== false}
                    onChange={e => setStyle('show_header', e.target.checked)} />
                  Show header
                </label>
              </div>
              <fieldset disabled={editing.style.show_header === false} style={{ border: 'none', padding: 0, margin: 0, opacity: editing.style.show_header === false ? 0.5 : 1 }}>
                <div className="fgrid">
                  <div className="fgroup">
                    <label className="flabel">Header Color</label>
                    <ColorPicker value={editing.style.header_bg || '#ffffff'} onChange={c => setStyle('header_bg', c)} />
                  </div>
                  <div className="fgroup">
                    <label className="flabel">Accent Color</label>
                    <ColorPicker value={editing.style.accent_color || '#b8922e'} onChange={c => setStyle('accent_color', c)} />
                  </div>
                </div>
                <div className="fgroup">
                  <label className="flabel">Header Tagline</label>
                  <input className="finput" value={editing.style.header_tagline ?? ''} onChange={e => setStyle('header_tagline', e.target.value)} placeholder="Coaching Platform" />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={editing.show_logo} onChange={e => setEditing({ ...editing, show_logo: e.target.checked })} />
                  Show workspace logo
                </label>
              </fieldset>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>Footer</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={editing.style.show_footer !== false}
                    onChange={e => setStyle('show_footer', e.target.checked)} />
                  Show footer
                </label>
              </div>
              <fieldset disabled={editing.style.show_footer === false} style={{ border: 'none', padding: 0, margin: 0, opacity: editing.style.show_footer === false ? 0.5 : 1 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink)', cursor: 'pointer', marginBottom: 12 }}>
                  <input type="checkbox" checked={editing.style.show_contact_line !== false}
                    onChange={e => setStyle('show_contact_line', e.target.checked)} />
                  Show "Questions? Contact us at…" line
                </label>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: -8, marginBottom: 12 }}>
                  Shows your workspace owner's name and email as the reply contact. Turn off if you'd
                  rather not surface a personal email address in this email.
                </div>
                <div className="fgroup">
                  <label className="flabel">Footer Text</label>
                  <textarea className="ftextarea" rows={2} value={editing.style.footer_text ?? ''}
                    onChange={e => setStyle('footer_text', e.target.value)}
                    placeholder="This is an automated notification — please do not reply directly to this email." />
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                    Shown below your contact line and workspace name. Leave blank to use the default disclaimer above.
                  </div>
                </div>
              </fieldset>
            </div>

            {/* Signature line only makes sense for contract-style content — show it for the
                Contract Agreement sample (by name), brand-new unassigned templates (someone
                might be building their own contract from scratch), or a template that already
                has it enabled. NOT for every Client Communication template — most of those
                (e.g. an assessment invite) have nothing to do with a signed agreement. */}
            {(editing.use_cases.length === 0 || editing.name === CONTRACT_SAMPLE.name || editing.include_client_signature_line) && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>Signature</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!editing.include_client_signature_line}
                    onChange={e => setEditing({ ...editing, include_client_signature_line: e.target.checked })} />
                  Include a client signature line
                </label>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, marginLeft: 22 }}>
                  Prints a blank "Client Signature: ____  Date: ____" line at the bottom — useful for
                  contracts. The coach's own signature is drawn per-message in Client Communication, not
                  set here.
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn btn-dark" onClick={handleSaveTemplate} disabled={saving}>{saving ? 'Saving…' : 'Save & Choose Where to Use'}</button>
            </div>
          </div>
        </div>

        <div className="card" style={{ flex: 1, minWidth: 0, position: 'sticky', top: 80, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
            Preview {previewLoading && '· updating…'}
          </div>
          <iframe title="preview" srcDoc={previewHtml} style={{ width: '100%', height: 600, border: 'none', display: 'block' }} />
        </div>
      </div>
    )
  }

  const tabs: { key: typeof emailTab; label: string; count: number }[] = [
    { key: 'client',  label: 'To clients',          count: useCases.filter(u => u.audience === 'client').length },
    { key: 'coach',   label: 'To you & coaches',    count: useCases.filter(u => u.audience === 'coach').length },
    { key: 'team',    label: 'To team members',     count: useCases.filter(u => u.audience === 'team').length },
    { key: 'library', label: 'Template library',    count: templates.length },
  ]
  const customizedCount = useCases.filter(u => useCaseMap[u.key] && templates.some(t => t.id === useCaseMap[u.key])).length

  return (
    <div style={{ maxWidth: 960 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 24, fontWeight: 400, color: 'var(--ink)', lineHeight: 1.2 }}>Emails</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            Every email CoachOS sends on your behalf. {customizedCount} of {useCases.length} customized — the rest use the built-in wording.
          </div>
        </div>
        <button className="btn btn-dark btn-sm" onClick={openNew}>+ New Template</button>
      </div>

      {/* Audience tabs */}
      <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16, overflowX: 'auto' }}>
        {tabs.map(t => {
          const active = emailTab === t.key
          return (
            <button key={t.key} role="tab" aria-selected={active} onClick={() => setEmailTab(t.key)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                padding: '10px 14px', marginBottom: -1, fontSize: 13,
                fontWeight: active ? 600 : 500, color: active ? 'var(--ink)' : 'var(--muted)',
                borderBottom: `2px solid ${active ? 'var(--ink)' : 'transparent'}`,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
              {t.label}
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 10,
                background: active ? 'var(--ink)' : '#efebe5', color: active ? '#fff' : 'var(--muted)',
              }}>{t.count}</span>
            </button>
          )
        })}
      </div>

      {emailTab !== 'library' ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {useCases.filter(u => u.audience === emailTab).map((uc, i) => {
            const assigned = useCaseMap[uc.key] ? templates.find(t => t.id === useCaseMap[uc.key]) : null
            const subject = assigned?.subject || samples[uc.key]?.subject || ''
            return (
              <div key={uc.key} style={{
                display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
                padding: '14px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--border)',
              }}>
                <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{uc.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{USE_CASE_WHEN[uc.key] || ''}</div>
                  {subject && (
                    <div title={subject} style={{
                      fontSize: 12, color: '#6e6560', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      <span style={{ color: 'var(--muted)', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', marginRight: 6 }}>Subject</span>
                      {subject}
                    </div>
                  )}
                </div>
                <div style={{ flex: '0 0 auto' }}>
                  {assigned ? (
                    <span title={`Using template "${assigned.name}"`} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600,
                      padding: '3px 10px', borderRadius: 12, background: '#e6f0e4', color: '#2a5c35', maxWidth: 220,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2a5c35', flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Customized · {assigned.name}</span>
                    </span>
                  ) : (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600,
                      padding: '3px 10px', borderRadius: 12, background: '#f1eee9', color: '#8c8279',
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#b8b2ab' }} />
                      Built-in
                    </span>
                  )}
                </div>
                <button className="btn btn-outline btn-sm" style={{ flex: '0 0 auto' }} onClick={() => openDefaultEditor(uc.key)}>
                  <Pencil size={12} /> Edit
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span>Reusable templates you can assign to one or more emails, or pick when writing a client message.</span>
            {!hasContractSample && (
              <button className="btn btn-outline btn-sm" disabled={addingSample === 'contract'} onClick={handleAddContractSample}>
                {addingSample === 'contract' ? 'Adding…' : '+ Add Contract Agreement sample'}
              </button>
            )}
          </div>
          {templates.length === 0 ? (
            <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>
              No saved templates yet. Customize any email, or create one from scratch with + New Template.
            </div></div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {templates.map((t, i) => {
                const activeFor = useCases.filter(uc => useCaseMap[uc.key] === t.id).map(uc => uc.label)
                const taggedFor = (t.use_cases || []).map((uc: string) => useCases.find(u => u.key === uc)?.label || uc)
                return (
                  <div key={t.id} style={{
                    display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
                    padding: '14px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                  }}>
                    <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{t.name || 'Untitled'}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                        {activeFor.length
                          ? <>Active for <span style={{ color: '#2a5c35', fontWeight: 600 }}>{activeFor.join(', ')}</span></>
                          : taggedFor.length ? `Available for ${taggedFor.join(', ')}` : 'Not assigned to any email yet'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
                      <button className="btn btn-outline btn-sm" onClick={() => openEdit(t)}><Pencil size={12} /> Edit</button>
                      <button className="btn btn-outline btn-sm" onClick={() => handleDuplicate(t)} title="Duplicate" aria-label={`Duplicate ${t.name}`}><Copy size={12} /></button>
                      <button className="btn btn-outline btn-sm" onClick={() => handleDelete(t.id)} title="Delete" aria-label={`Delete ${t.name}`}
                        style={{ color: '#c0392b', borderColor: '#f5c6c2' }}><Trash2 size={12} /></button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Audit Log Tab ───────────────────────────────────────────────────────────────
const ACTION_LABELS: Record<string, string> = {
  viewed_notes:       'Viewed notes',
  created_note:       'Created note',
  updated_note:       'Updated note',
  deleted_note:       'Deleted note',
  viewed_assessments: 'Viewed files',
  downloaded_file:    'Downloaded file',
  uploaded_file:      'Uploaded file',
  deleted_file:       'Deleted file',
  viewed_goals:       'Viewed goals',
  viewed_feedback:    'Viewed feedback',
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function AuditLogTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => auditApi.list({ page_size: 10 }).then(r => r.data),
    staleTime: 0,
  })

  const logs: any[] = (data?.results || data || []).slice(0, 10)

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="card">
        <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 300 }}>Audit Log</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Last 100 actions across your workspace</div>
          </div>
        </div>

        {isLoading ? (
          <div style={{ padding: '40px 28px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
        ) : logs.length === 0 ? (
          <div style={{ padding: '40px 28px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No activity recorded yet.</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>User</th>
                <th>Action</th>
                <th>Client</th>
                <th>Detail</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l: any) => (
                <tr key={l.id}>
                  <td style={{ fontSize: 13, fontWeight: 500 }}>{l.user_name || '—'}</td>
                  <td>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                      background: 'var(--gold)18', color: 'var(--gold)', border: '1px solid var(--gold)40',
                    }}>
                      {ACTION_LABELS[l.action] || l.action}
                    </span>
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--muted)' }}>{l.client_name || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {l.metadata?.file_name || ''}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtDate(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Integration tile icons — small brand-colored marks, no icon library needed ─────
function GoogleCalendarIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24">
      <rect x="6" y="1" width="2" height="5" rx="1" fill="#1a73e8" />
      <rect x="16" y="1" width="2" height="5" rx="1" fill="#1a73e8" />
      <rect x="2" y="4" width="20" height="18" rx="3" fill="#fff" stroke="#e0e0e0" />
      <rect x="2" y="4" width="20" height="5" rx="2" fill="#4285F4" />
      <rect x="5" y="12" width="4" height="4" fill="#34A853" />
      <rect x="10" y="12" width="4" height="4" fill="#FBBC05" />
      <rect x="15" y="12" width="4" height="4" fill="#EA4335" />
    </svg>
  )
}
function ZoomIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24">
      <rect width="24" height="24" rx="6" fill="#2D8CFF" />
      <rect x="4" y="8" width="11" height="8" rx="2" fill="#fff" />
      <path d="M16 10.3L20 8v8l-4-2.3v-3.4z" fill="#fff" />
    </svg>
  )
}
function StripeIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24">
      <rect width="24" height="24" rx="6" fill="#635BFF" />
      <text x="12" y="17" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontWeight="700" fontSize="15" fill="#fff">S</text>
    </svg>
  )
}

// ── Integration tile — icon + name + status, description lives in the native
// hover tooltip (title attr) instead of always-visible body copy, matching how
// hints are done elsewhere in this app (see ClientDetail.tsx's title= usage).
function IntegrationTile({ icon, name, connected, hint, active, onClick, href, onDisconnect }: {
  icon: React.ReactNode; name: string; connected: boolean; hint: string
  active?: boolean; onClick?: () => void; href?: string; onDisconnect?: () => void
}) {
  const Tag: any = href ? 'a' : 'div'
  return (
    // href is same-tab on purpose (Google Calendar's OAuth connect redirects back into
    // this app) — unlike the Zoom Marketplace/Stripe Dashboard links inside the expanded
    // panels below, which do open in a new tab since those are just reference docs.
    <Tag
      {...(href ? { href } : { onClick })}
      title={hint}
      style={{
        // flex-grow 0 on purpose — a non-owner only sees the Google Calendar tile (Zoom/
        // Stripe are owner-only below), and without a cap that lone tile would stretch to
        // fill the whole row instead of staying a compact icon tile like its siblings.
        flex: '0 1 180px', minWidth: 140, cursor: (href || onClick) ? 'pointer' : 'default', textAlign: 'center',
        padding: '20px 12px', borderRadius: 10, textDecoration: 'none',
        border: active ? '2px solid var(--ink)' : '1px solid var(--border)',
        background: '#fff', display: 'block',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>{name}</div>
      <span className={`pill ${connected ? 'pill-green' : 'pill-grey'}`} style={{ fontSize: 10 }}>
        {connected ? 'Connected' : 'Not connected'}
      </span>
      {connected && onDisconnect && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDisconnect() }}
            style={{
              background: 'none', border: 'none', padding: 0, font: 'inherit',
              fontSize: 11, color: 'var(--muted)', textDecoration: 'underline', cursor: 'pointer',
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </Tag>
  )
}

// ── Stripe panel — each workspace connects its OWN account, "bring your own key".
// Status is owned by the parent (IntegrationsTab) so the tile row's "Connected"
// pill and this expanded panel always agree and share one fetch.
type StripeStatus = { connected: boolean; mode: string; last4: string; webhook_configured: boolean; webhook_url: string }
function StripePaymentsCard({ status, setStatus }: { status: StripeStatus; setStatus: React.Dispatch<React.SetStateAction<StripeStatus>> }) {
  const { show } = useToast()
  const [secretKey, setSecretKey] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [saving, setSaving] = useState(false)

  async function saveKey() {
    if (!secretKey.trim()) return
    setSaving(true)
    try {
      const r = await settingsApi.saveStripeSettings({ secret_key: secretKey.trim() })
      setStatus(s => ({ ...s, ...r.data }))
      setSecretKey('')
      show('Stripe key saved', 'success')
    } catch (err: any) {
      show(err?.response?.data?.detail || 'Failed to save Stripe key', 'error')
    } finally { setSaving(false) }
  }

  async function saveWebhookSecret() {
    if (!webhookSecret.trim()) return
    setSaving(true)
    try {
      const r = await settingsApi.saveStripeSettings({ webhook_secret: webhookSecret.trim() })
      setStatus(s => ({ ...s, ...r.data }))
      setWebhookSecret('')
      show('Webhook secret saved', 'success')
    } catch { show('Failed to save webhook secret', 'error') } finally { setSaving(false) }
  }

  async function disconnect() {
    if (!confirm('Disconnect Stripe? Clients will no longer be able to pay invoices online until you reconnect.')) return
    setSaving(true)
    try {
      const r = await settingsApi.saveStripeSettings({ disconnect: true })
      setStatus(s => ({ ...s, ...r.data, webhook_url: s.webhook_url }))
      show('Stripe disconnected', 'success')
    } catch { show('Failed to disconnect', 'error') } finally { setSaving(false) }
  }

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(status.webhook_url)
    show('Webhook URL copied', 'success')
  }

  return (
    <>
      {status.connected && (
        <div style={{ marginBottom: 16 }}>
          <span className="pill pill-green" style={{ fontSize: 10 }}>
            Connected {status.mode && `(${status.mode} mode, ••${status.last4})`}
          </span>
        </div>
      )}
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>
          Get your Secret Key from{' '}
          <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)' }}>
            Stripe Dashboard → Developers → API keys
          </a>.
        </p>

        <div className="fgroup">
          <label className="flabel">Stripe Secret Key</label>
          <input className="finput" type="password" value={secretKey} onChange={e => setSecretKey(e.target.value)}
            placeholder={status.connected ? `sk_${status.mode}_••••${status.last4}` : 'sk_test_… or sk_live_…'} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <button className="btn btn-dark btn-sm" onClick={saveKey} disabled={saving || !secretKey.trim()}>
            {saving ? 'Saving…' : status.connected ? 'Update Key' : 'Connect Stripe'}
          </button>
          {status.connected && (
            <button className="btn btn-outline btn-sm" onClick={disconnect} disabled={saving} style={{ color: '#b91c1c' }}>
              Disconnect
            </button>
          )}
        </div>

        {status.connected && (
          <>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 10 }}>
                Step 2 — Webhook (so payments update this app automatically)
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.6 }}>
                In your Stripe Dashboard, add a webhook endpoint pointing to the URL below (or run{' '}
                <code style={{ background: '#f5f3ef', padding: '1px 4px', borderRadius: 3 }}>stripe listen --forward-to &lt;url&gt;</code>{' '}
                for local testing), selecting the <code style={{ background: '#f5f3ef', padding: '1px 4px', borderRadius: 3 }}>checkout.session.completed</code> and{' '}
                <code style={{ background: '#f5f3ef', padding: '1px 4px', borderRadius: 3 }}>charge.refunded</code> events (the second keeps invoices in sync if
                you ever issue a refund directly from Stripe instead of from here). Then paste the signing secret it gives you below.
              </p>
              <div className="fgroup">
                <label className="flabel">Your Webhook URL</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="finput" readOnly value={status.webhook_url} style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
                  <button className="btn btn-outline btn-sm" onClick={copyWebhookUrl} type="button">Copy</button>
                </div>
              </div>
              <div className="fgroup">
                <label className="flabel">Webhook Signing Secret</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="finput" type="password" value={webhookSecret} onChange={e => setWebhookSecret(e.target.value)}
                    placeholder={status.webhook_configured ? 'whsec_•••••••• (configured)' : 'whsec_…'} style={{ flex: 1 }} />
                  <button className="btn btn-outline btn-sm" onClick={saveWebhookSecret} disabled={saving || !webhookSecret.trim()}>
                    Save
                  </button>
                </div>
                {status.webhook_configured && (
                  <div style={{ fontSize: 11, color: '#2d6a2d', marginTop: 6 }}>✓ Webhook configured — payments will mark invoices paid automatically.</div>
                )}
              </div>
            </div>
          </>
        )}
    </>
  )
}

// ── Integrations Tab ──────────────────────────────────────────────────────────
function IntegrationsTab() {
  const { user } = useAuthStore()
  const isOwner = user?.role === 'business_owner'
  const { show } = useToast()
  const [stripeStatus, setStripeStatus] = useState({ connected: false, mode: '', last4: '', webhook_configured: false, webhook_url: '' })
  const [zoomTesting, setZoomTesting] = useState(false)
  // Accordion: which tile's credentials panel is open below the row. Only Stripe has
  // one — Google Calendar and Zoom both connect via a plain OAuth link (Zoom's old
  // Server-to-Server path, while ZOOM_OAUTH_ENABLED=False, is platform-wide/env-set
  // now, not a per-workspace form — see config/settings/base.py — so there's nothing
  // left for either to configure here).
  const [expanded, setExpanded] = useState<'stripe' | null>(null)

  const qc = useQueryClient()
  const { data: meData } = useQuery({
    queryKey: ['me-integrations'],
    queryFn: () => authApi.me().then(r => r.data),
  })
  const googleCalendarConnected = !!meData?.google_calendar_connected
  const zoomOAuthEnabled = !!meData?.zoom_oauth_enabled
  // meData.zoom_connected already means different things server-side depending on
  // zoomOAuthEnabled (a SocialToken vs. the old workspace credentials being filled
  // in) — see MeView — so this one value is correct to use either way.
  const zoomConnected = !!meData?.zoom_connected

  async function disconnectGoogleCalendar() {
    if (!window.confirm('Disconnect Google Calendar? Sessions will stop syncing and client RSVP tracking will stop until you reconnect.')) return
    try {
      await authApi.disconnectGoogleCalendar()
      qc.invalidateQueries({ queryKey: ['me-integrations'] })
      show('Google Calendar disconnected')
    } catch (err: any) {
      show(err?.response?.data?.detail || 'Failed to disconnect Google Calendar', 'error')
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('google_calendar') === 'connected') {
      show('Google Calendar connected')
      window.history.replaceState({}, '', window.location.pathname)
    }
    if (params.get('zoom') === 'connected') {
      show('Zoom connected')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  useEffect(() => {
    if (!isOwner) return
    settingsApi.getStripeSettings().then(r => setStripeStatus(r.data)).catch(() => {})
  }, [isOwner])

  async function testZoom() {
    setZoomTesting(true)
    try {
      await settingsApi.createZoomMeeting({ topic: 'Test Meeting', duration_minutes: 30 })
      show('Zoom connected ✓ Test meeting created successfully', 'success')
    } catch (err: any) {
      show(err?.response?.data?.detail || 'Zoom test failed', 'error')
    } finally { setZoomTesting(false) }
  }

  const toggle = (key: 'stripe') => setExpanded(e => (e === key ? null : key))

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 data-tour="settings-integrations" style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24, fontWeight: 400, marginBottom: 6 }}>Integrations</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>Connect third-party services to enhance your workflow. Hover a tile for details.</p>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <IntegrationTile
          icon={<GoogleCalendarIcon />}
          name="Google Calendar"
          connected={googleCalendarConnected}
          hint={googleCalendarConnected
            ? 'Connected — sessions sync to your calendar and client RSVPs update automatically.'
            : 'Connect your own Google Calendar to sync scheduled sessions and track client accept/decline responses.'}
          href={googleCalendarConnected ? undefined : '/api/auth/google-calendar/connect/'}
          onDisconnect={googleCalendarConnected ? disconnectGoogleCalendar : undefined}
        />
        {zoomOAuthEnabled ? (
          <IntegrationTile
            icon={<ZoomIcon />}
            name="Zoom"
            connected={zoomConnected}
            hint={zoomConnected
              ? 'Connected — scheduling a session with Zoom as the location auto-creates the meeting under your own Zoom account.'
              : 'Connect your own Zoom account — no API keys needed. Each person schedules under their own Zoom identity, same as Calendly.'}
            href={zoomConnected ? undefined : '/api/auth/zoom/connect/'}
          />
        ) : (
          // Old path: one Server-to-Server Zoom app, shared by every workspace,
          // configured server-side via env vars — nothing for any coach or owner to
          // set up here. Click just runs a test meeting-creation call to confirm
          // it's working; there's no credentials form anymore (see
          // config/settings/base.py's ZOOM_OAUTH_ENABLED comment for why).
          <IntegrationTile
            icon={<ZoomIcon />}
            name="Zoom"
            connected={zoomConnected}
            hint={zoomConnected
              ? (zoomTesting ? 'Sending a test meeting request…' : 'Connected — scheduling a session with Zoom as the location auto-creates the meeting link. Click to send a test.')
              : 'Zoom is not configured on this server yet — contact your admin.'}
            onClick={zoomConnected && !zoomTesting ? testZoom : undefined}
          />
        )}
        {isOwner && (
          <IntegrationTile
            icon={<StripeIcon />}
            name="Stripe"
            connected={stripeStatus.connected}
            hint="Connect your own Stripe account so client invoice payments go straight to you, not through CoachOS."
            active={expanded === 'stripe'}
            onClick={() => toggle('stripe')}
          />
        )}
      </div>

      {isOwner && expanded === 'stripe' && (
        <div className="card">
          <div className="card-hdr">Stripe — Accept Online Card Payments</div>
          <div className="card-body">
            <StripePaymentsCard status={stripeStatus} setStatus={setStripeStatus} />
          </div>
        </div>
      )}
    </div>
  )
}


// ── Main Page ──────────────────────────────────────────────────────────────────
export default function Settings() {
  const { user } = useAuthStore()
  const isOwner = user?.role === 'business_owner'

  const ALL_TABS = [
    { key: 'Workspace',        icon: <Building2 size={13} />,    ownerOnly: true  },
    { key: 'Profile',          icon: <User size={13} />,         ownerOnly: false },
    { key: 'Pipeline',         icon: <Kanban size={13} />,       ownerOnly: true  },
    { key: 'Activity Types',   icon: <CalendarDays size={13} />, ownerOnly: true  },
    { key: 'Affiliation',      icon: <Building2 size={13} />,    ownerOnly: true  },
    { key: 'Client Statuses',  icon: <Plus size={13} />,         ownerOnly: true  },
    { key: 'Lead Sources',     icon: <Plus size={13} />,         ownerOnly: true  },
    { key: 'Tags',             icon: <Plus size={13} />,         ownerOnly: true  },
    { key: 'Services',         icon: <Plus size={13} />,         ownerOnly: true  },
    { key: 'Generic Templates', icon: <Mail size={13} />,        ownerOnly: true  },
    { key: 'Integrations',    icon: <Plus size={13} />,          ownerOnly: false },
    { key: 'Audit Log',       icon: <ClipboardList size={13} />, ownerOnly: true  },
  ]
  const TABS = ALL_TABS.filter(t => !t.ownerOnly || isOwner)

  const [tab, setTab] = useState(isOwner ? 'Workspace' : 'Profile')

  return (
    <AppShell>
      <PageHeader title="Settings" subtitle="Manage your workspace, profile, and team" />

      <div style={{ background: '#f7f4ef', borderBottom: '1px solid var(--border)', padding: '0 36px', display: 'flex', position: 'sticky', top: 0, zIndex: 10 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '12px 18px', fontSize: 13, fontWeight: 500,
            background: 'none', border: 'none', cursor: 'pointer',
            color: tab === t.key ? 'var(--ink)' : 'var(--muted)',
            borderBottom: `2px solid ${tab === t.key ? 'var(--gold)' : 'transparent'}`,
          }}>
            {t.icon} {t.key}
          </button>
        ))}
      </div>

      <div className="page-body">
        {tab === 'Workspace'      && isOwner && <WorkspaceTab />}
        {tab === 'Profile'        && <ProfileTab />}
        {tab === 'Pipeline'       && isOwner && <PipelineTab />}
        {tab === 'Activity Types'  && isOwner && <ActivityTypesTab />}
        {tab === 'Affiliation'     && isOwner && <AffiliationsTab />}
        {tab === 'Client Statuses' && isOwner && <ClientStatusesTab />}
        {tab === 'Lead Sources'    && isOwner && <LeadSourcesTab />}
        {tab === 'Tags'            && isOwner && <TagsTab />}
        {tab === 'Services'        && isOwner && <ServicesTab />}
        {tab === 'Generic Templates' && isOwner && <GenericTemplatesTab />}
        {tab === 'Integrations'    && <IntegrationsTab />}
        {tab === 'Audit Log'       && isOwner && <AuditLogTab />}
      </div>
    </AppShell>
  )
}
