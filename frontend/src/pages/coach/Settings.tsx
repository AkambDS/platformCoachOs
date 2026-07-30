import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, authApi, settingsApi, invoicesApi, auditApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { PageHeader, Modal, useToast } from '../../components/ui'
import { useAuthStore } from '../../store/auth'
import { User, Shield, Building2, Mail, Plus, Pencil, Trash2, Kanban, CalendarDays, ClipboardList } from 'lucide-react'

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
    address:            (workspace as any)?.address    || '',
    city:               (workspace as any)?.city       || '',
    state:              (workspace as any)?.state      || '',
    zip_code:           (workspace as any)?.zip_code   || '',
    phone:              (workspace as any)?.phone      || '',
  })
  const [saving, setSaving] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoData, setLogoData] = useState<string>((workspace as any)?.logo_data || '')
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))
  const isOwner = user?.role === 'business_owner'

  const handleSave = async () => {
    setSaving(true)
    try {
      const { data } = await settingsApi.updateWorkspace(form)
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
    <div style={{ maxWidth: 620 }}>
      <div className="card">
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
          <div className="fgrid">
            <div className="fgroup" style={{ maxWidth: 200 }}>
              <label className="flabel">ZIP / Postal Code</label>
              <input className="finput" value={form.zip_code} onChange={e => set('zip_code', e.target.value)} placeholder="10001" />
            </div>
            <div className="fgroup">
              <label className="flabel">Phone Number</label>
              <input className="finput" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="(555) 123-4567" />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>Offered as a dial-in option when scheduling meetings.</div>
            </div>
          </div>

          {/* ── Scheduling Defaults ── */}
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
          </div>

          <div style={{ borderTop: '1px solid var(--border)', marginTop: 24, paddingTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-dark" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
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
    <div style={{ maxWidth: 620 }}>
      <div className="card">
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

          {/* ── Security ── */}
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

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-dark" onClick={handleChangePassword} disabled={savingPw}>
              {savingPw ? 'Updating…' : 'Change Password'}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}

// ── Team Tab ───────────────────────────────────────────────────────────────────
function TeamTab() {
  const { user: currentUser } = useAuthStore()
  const { show } = useToast()
  const qc = useQueryClient()
  const [showInvite, setShowInvite] = useState(false)
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'coach' })
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [showEmailPreview, setShowEmailPreview] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)

  const [editTarget, setEditTarget] = useState<any | null>(null)
  const [editRole, setEditRole] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleEditSave = async () => {
    if (!editTarget) return
    setEditSaving(true)
    try {
      await authApi.updateMember(editTarget.id, { role: editRole })
      qc.invalidateQueries({ queryKey: ['team'] })
      setEditTarget(null)
      show(`${editTarget.full_name}'s role updated to ${ROLE_LABELS[editRole]}`)
    } catch (err: any) {
      show(err.response?.data?.detail || 'Failed to update role', 'error')
    } finally { setEditSaving(false) }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await authApi.deleteMember(deleteTarget.id)
      qc.invalidateQueries({ queryKey: ['team'] })
      setDeleteTarget(null)
      show(`${deleteTarget.full_name} removed from team`)
    } catch (err: any) {
      show(err.response?.data?.detail || 'Failed to remove member', 'error')
    } finally { setDeleting(false) }
  }

  const { data, isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: () => authApi.team().then(r => r.data),
  })
  const members: any[] = data?.results || data || []

  const handleInvite = async () => {
    setInviteError('')
    if (!inviteForm.email) return
    setInviting(true)
    try {
      await authApi.invite(inviteForm)
      qc.invalidateQueries({ queryKey: ['team'] })
      setShowInvite(false)
      setInviteForm({ email: '', role: 'coach' })
      show(`Invitation sent to ${inviteForm.email}`)
    } catch (err: any) {
      setInviteError(err.response?.data?.email?.[0] || err.response?.data?.detail || 'Failed to send invite')
    } finally { setInviting(false) }
  }

  const isOwner = currentUser?.role === 'business_owner'

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="card">
        <div className="card-hdr" style={{ justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Mail size={14} /> Team Members</span>
          {isOwner && (
            <button className="btn btn-dark btn-sm" onClick={() => setShowInvite(true)}>
              <Plus size={12} /> Invite Member
            </button>
          )}
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {isLoading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
          ) : members.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No team members yet.</div>
          ) : members.map((m: any) => {
            const isPending = m.is_active === false
            return (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px',
              borderBottom: '1px solid var(--border)',
              background: isPending ? '#fafaf8' : 'transparent',
            }}>
              {/* Avatar circle */}
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: isPending ? '#f0ede8' : (ROLE_COLORS[m.role] + '22'),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 600,
                color: isPending ? '#b5afa6' : (ROLE_COLORS[m.role] || 'var(--muted)'),
                flexShrink: 0, opacity: isPending ? 0.7 : 1,
              }}>
                {m.full_name?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: isPending ? 'var(--muted)' : 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {m.full_name}
                  {m.id === currentUser?.id && (
                    <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>(you)</span>
                  )}
                  {isPending && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase',
                      padding: '1px 7px', borderRadius: 10,
                      background: '#fff3cd', color: '#856404', border: '1px solid #ffc10740',
                    }}>
                      Pending Login
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{m.email}</div>
              </div>
              <span style={{
                padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, flexShrink: 0,
                background: isPending ? '#f0ede8' : ((ROLE_COLORS[m.role] || '#8c8279') + '18'),
                color: isPending ? '#8c8279' : (ROLE_COLORS[m.role] || 'var(--muted)'),
              }}>
                {ROLE_LABELS[m.role] || m.role}
              </span>
              {isOwner && m.id !== currentUser?.id && m.role !== 'business_owner' && (
                <div style={{ display: 'flex', gap: 4, marginLeft: 4, alignItems: 'center' }}>
                  {isPending ? (
                    <button
                      onClick={async () => {
                        try {
                          await authApi.updateMember(m.id, { is_active: true })
                          qc.invalidateQueries({ queryKey: ['team'] })
                          show(`${m.full_name} activated`)
                        } catch { show('Failed to activate', 'error') }
                      }}
                      title="Activate coach portal access"
                      style={{
                        padding: '4px 10px', borderRadius: 5, border: '1px solid #c9a84c',
                        background: '#fffbf0', color: '#856404', fontSize: 10, fontWeight: 700,
                        letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer',
                      }}
                    >
                      Activate
                    </button>
                  ) : (
                    <button
                      onClick={() => { setEditTarget(m); setEditRole(m.role) }}
                      title="Change role"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--muted)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center' }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--ink)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  <button
                    onClick={() => setDeleteTarget(m)}
                    title="Remove from team"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--muted)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#b91c1c')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
            )
          })}
        </div>
      </div>

      {/* Role legend */}
      <div style={{ marginTop: 16, padding: '14px 16px', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>Role Permissions</div>
        {[
          { role: 'business_owner', label: 'Business Owner', desc: 'Full access — clients, sessions, invoices, reports, billing, team invites.' },
          { role: 'coach',          label: 'Coach',          desc: 'Manage clients, schedule sessions, create invoices. No billing or team settings.' },
          { role: 'assistant',      label: 'Assistant',      desc: 'Schedule sessions and view data. Cannot create invoices or access reports.' },
        ].map(r => (
          <div key={r.role} style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
            <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, flexShrink: 0, alignSelf: 'flex-start', background: ROLE_COLORS[r.role] + '18', color: ROLE_COLORS[r.role] }}>
              {r.label}
            </span>
            <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{r.desc}</span>
          </div>
        ))}
      </div>

      {/* Edit Role Modal */}
      {editTarget && (
        <Modal
          title="Change Role"
          onClose={() => setEditTarget(null)}
          footer={
            <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={() => setEditTarget(null)}>Cancel</button>
              <button className="btn btn-dark btn-sm" onClick={handleEditSave} disabled={editSaving}>
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          }
        >
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
            Updating role for <strong style={{ color: 'var(--ink)' }}>{editTarget.full_name}</strong>
          </p>
          <div className="fgroup">
            <label className="flabel">Role</label>
            <select className="fselect" value={editRole} onChange={e => setEditRole(e.target.value)}>
              <option value="coach">Coach — manage clients &amp; sessions</option>
              <option value="assistant">Assistant — scheduling &amp; view only</option>
            </select>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <Modal
          title="Remove Team Member"
          onClose={() => setDeleteTarget(null)}
          footer={
            <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button
                className="btn btn-sm"
                onClick={handleDelete}
                disabled={deleting}
                style={{ background: '#b91c1c', color: '#fff', border: 'none' }}
              >
                {deleting ? 'Removing…' : 'Remove'}
              </button>
            </div>
          }
        >
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
            Remove <strong style={{ color: 'var(--ink)' }}>{deleteTarget.full_name}</strong> ({deleteTarget.email}) from the workspace?
            They will lose access immediately.
          </p>
        </Modal>
      )}

      {/* Invite Modal */}
      {showInvite && (
        <Modal
          title="Invite Team Member"
          onClose={() => { setShowInvite(false); setInviteError(''); setShowEmailPreview(false) }}
          size="lg"
          footer={
            <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={() => setShowInvite(false)}>Cancel</button>
              <button className="btn btn-dark btn-sm" onClick={handleInvite} disabled={inviting}>
                {inviting ? 'Sending…' : 'Send Invite'}
              </button>
            </div>
          }
        >
          {inviteError && (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 'var(--radius-sm)', fontSize: 12, color: '#b91c1c' }}>
              {inviteError}
            </div>
          )}

          {/* Tabs: Form / Email Preview */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
            {(['form', 'email'] as const).map(t => (
              <button key={t} onClick={() => {
                setShowEmailPreview(t === 'email')
                if (t === 'email' && !previewLoading) {
                  setPreviewLoading(true)
                  authApi.inviteEmailPreview(inviteForm.email || 'colleague@example.com', inviteForm.role)
                    .then(r => setPreviewHtml(r.data.html || ''))
                    .catch(() => setPreviewHtml(''))
                    .finally(() => setPreviewLoading(false))
                }
              }}
                style={{ padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer',
                         borderBottom: (t === 'email' ? showEmailPreview : !showEmailPreview) ? '2px solid var(--ink)' : '2px solid transparent',
                         fontWeight: (t === 'email' ? showEmailPreview : !showEmailPreview) ? 600 : 400,
                         fontSize: 13, color: (t === 'email' ? showEmailPreview : !showEmailPreview) ? 'var(--ink)' : 'var(--muted)' }}>
                {t === 'email' ? 'Email Preview' : 'Invite Details'}
              </button>
            ))}
          </div>

          {!showEmailPreview ? (
            <>
              <div className="fgroup">
                <label className="flabel">Email Address</label>
                <input
                  className="finput"
                  type="email"
                  value={inviteForm.email}
                  onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="colleague@example.com"
                  autoFocus
                />
              </div>
              <div className="fgroup">
                <label className="flabel">Role</label>
                <select className="fselect" value={inviteForm.role} onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="coach">Coach — manage clients &amp; sessions</option>
                  <option value="assistant">Assistant — scheduling &amp; view only</option>
                </select>
              </div>
              <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--muted)' }}>
                They will receive an email with a link to set their password and join your workspace.
              </div>
            </>
          ) : (
            previewLoading ? (
              <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading preview…</div>
            ) : previewHtml ? (
              <iframe srcDoc={previewHtml} title="Invite Email Preview"
                style={{ width: '100%', height: 560, border: '1px solid var(--border)', borderRadius: 4 }}
                sandbox="allow-same-origin" />
            ) : (
              <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Preview not available</div>
            )
          )}
        </Modal>
      )}
    </div>
  )
}

// ── Pipeline Stages Tab ────────────────────────────────────────────────────────
const STAGE_PRESET_COLORS = ['#8c8279','#2d6a9f','#2980b9','#c9a84c','#4a7c59','#1a1714','#7c4d9f','#c0392b','#16a085','#a0522d']

function PipelineTab() {
  const { show } = useToast()
  const qc = useQueryClient()
  const { data: stages = [], isLoading } = useQuery({
    queryKey: ['pipeline-stage-configs'],
    queryFn: () => settingsApi.getPipelineStages().then(r => r.data),
  })
  const [showAdd, setShowAdd] = useState(false)
  const [editTarget, setEditTarget] = useState<any>(null)
  const [newForm, setNewForm] = useState({ label: '', slug: '', color: '#2d6a9f', follow_up_days: '', notify_owner: true, notify_client: false, insertAfterSlug: '__end__' })
  const [editForm, setEditForm] = useState<any>({})
  const [saving, setSaving] = useState(false)

  const handleAdd = async () => {
    if (!newForm.label.trim()) return
    setSaving(true)
    const slug = newForm.slug.trim() || newForm.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    const stageList = stages as any[]
    let order: number
    if (newForm.insertAfterSlug === '__beginning__') {
      order = stageList.length > 0 ? stageList[0].order : 0
    } else if (newForm.insertAfterSlug === '__end__' || !newForm.insertAfterSlug) {
      order = stageList.length > 0 ? stageList[stageList.length - 1].order + 1 : 0
    } else {
      const after = stageList.find(s => s.slug === newForm.insertAfterSlug)
      order = after ? after.order + 1 : stageList.length
    }
    const payload = { ...newForm, slug, order, follow_up_days: newForm.follow_up_days ? Number(newForm.follow_up_days) : null }
    try {
      await settingsApi.createPipelineStage(payload)
      qc.invalidateQueries({ queryKey: ['pipeline-stage-configs'] })
      setShowAdd(false)
      setNewForm({ label: '', slug: '', color: '#2d6a9f', follow_up_days: '', notify_owner: true, notify_client: false, insertAfterSlug: '__end__' })
      show('Stage added')
    } catch (e: any) {
      show(e?.response?.data?.label?.[0] || e?.response?.data?.slug?.[0] || 'Failed to add stage', 'error')
    } finally { setSaving(false) }
  }

  const handleEdit = async () => {
    setSaving(true)
    const payload = { ...editForm, follow_up_days: editForm.follow_up_days ? Number(editForm.follow_up_days) : null }
    try {
      await settingsApi.updatePipelineStage(editTarget.id, payload)
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
    <div className="card" style={{ maxWidth: 700 }}>
      <div className="card-hdr">
        Pipeline Stages
        <button className="btn btn-dark btn-sm" onClick={() => setShowAdd(true)}><Plus size={13} /> Add Stage</button>
      </div>
      <div style={{ padding: '10px 18px', fontSize: 12, color: 'var(--muted)', borderBottom: '1px solid var(--border)', background: 'var(--paper)' }}>
        Set follow-up days per stage. A daily alert is sent to you when a deal exceeds that threshold.
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {(stages as any[]).map((s: any) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
            <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{s.label}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {s.follow_up_days ? `Alert after ${s.follow_up_days}d` : <span style={{ color: '#bbb' }}>No alert</span>}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditTarget(s); setEditForm({ label: s.label, color: s.color, follow_up_days: s.follow_up_days ?? '', notify_owner: s.notify_owner, notify_client: s.notify_client }) }} style={{ padding: '2px 6px' }}>
              <Pencil size={13} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(s)} style={{ color: '#c0392b', padding: '2px 6px' }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      {showAdd && (
        <Modal title="Add Pipeline Stage" onClose={() => setShowAdd(false)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn btn-dark btn-sm" onClick={handleAdd} disabled={saving}>{saving ? 'Adding…' : 'Add'}</button>
          </>
        }>
          <div className="fgroup">
            <label className="flabel">Stage Name *</label>
            <input className="finput" value={newForm.label} onChange={e => setNewForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Contract Sent" />
          </div>
          <div className="fgroup">
            <label className="flabel">Position in pipeline</label>
            <select className="fselect" value={newForm.insertAfterSlug} onChange={e => setNewForm(f => ({ ...f, insertAfterSlug: e.target.value }))}>
              <option value="__beginning__">At the beginning</option>
              {(stages as any[]).map((s: any) => (
                <option key={s.slug} value={s.slug}>After: {s.label}</option>
              ))}
            </select>
          </div>
          <div className="fgroup">
            <label className="flabel">Follow-up alert after (days) <span style={{ color: 'var(--muted)', fontWeight: 400 }}>— leave blank for no alert</span></label>
            <input className="finput" type="number" min={1} max={365} value={newForm.follow_up_days}
              onChange={e => setNewForm(f => ({ ...f, follow_up_days: e.target.value }))} placeholder="e.g. 14" />
          </div>
          <div style={{ display: 'flex', gap: 20, marginBottom: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={newForm.notify_owner} onChange={e => setNewForm(f => ({ ...f, notify_owner: e.target.checked }))}
                style={{ width: 14, height: 14, accentColor: 'var(--gold)' }} /> Notify me
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={newForm.notify_client} onChange={e => setNewForm(f => ({ ...f, notify_client: e.target.checked }))}
                style={{ width: 14, height: 14, accentColor: 'var(--gold)' }} /> Notify client
            </label>
          </div>
          <div className="fgroup">
            <label className="flabel">Color</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              {STAGE_PRESET_COLORS.map(c => (
                <div key={c} onClick={() => setNewForm(f => ({ ...f, color: c }))}
                  style={{ width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer',
                    border: newForm.color === c ? '3px solid var(--ink)' : '2px solid transparent' }} />
              ))}
            </div>
          </div>
        </Modal>
      )}

      {editTarget && (
        <Modal title={`Edit: ${editTarget.label}`} onClose={() => setEditTarget(null)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setEditTarget(null)}>Cancel</button>
            <button className="btn btn-dark btn-sm" onClick={handleEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </>
        }>
          <div className="fgroup">
            <label className="flabel">Stage Name *</label>
            <input className="finput" value={editForm.label} onChange={e => setEditForm((f: any) => ({ ...f, label: e.target.value }))} />
          </div>
          <div className="fgroup">
            <label className="flabel">Follow-up alert after (days) <span style={{ color: 'var(--muted)', fontWeight: 400 }}>— leave blank for no alert</span></label>
            <input className="finput" type="number" min={1} max={365} value={editForm.follow_up_days}
              onChange={e => setEditForm((f: any) => ({ ...f, follow_up_days: e.target.value }))} placeholder="No alert" />
          </div>
          <div style={{ display: 'flex', gap: 20, marginBottom: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={editForm.notify_owner} onChange={e => setEditForm((f: any) => ({ ...f, notify_owner: e.target.checked }))}
                style={{ width: 14, height: 14, accentColor: 'var(--gold)' }} /> Notify me
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={editForm.notify_client} onChange={e => setEditForm((f: any) => ({ ...f, notify_client: e.target.checked }))}
                style={{ width: 14, height: 14, accentColor: 'var(--gold)' }} /> Notify client
            </label>
          </div>
          <div className="fgroup">
            <label className="flabel">Color</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              {STAGE_PRESET_COLORS.map(c => (
                <div key={c} onClick={() => setEditForm((f: any) => ({ ...f, color: c }))}
                  style={{ width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer',
                    border: editForm.color === c ? '3px solid var(--ink)' : '2px solid transparent' }} />
              ))}
            </div>
          </div>
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
  '#1B3A6B', '#2d6a9f', '#4a7c59', '#16a085',
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
              {t.name}
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
              {s.label}
              {s.is_builtin && <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 6, fontWeight: 400 }}>built-in</span>}
            </div>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 12,
              background: s.color + '20', color: s.color, border: `1px solid ${s.color}40`,
            }}>{s.label}</span>
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
function TagsTab() {
  const { show, el: toastEl } = useToast()
  const qc = useQueryClient()
  const { data: tags = [], isLoading } = useQuery({
    queryKey: ['client-tag-configs'],
    queryFn: () => settingsApi.getClientTags().then(r => r.data),
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
      await settingsApi.createClientTag(newForm)
      qc.invalidateQueries({ queryKey: ['client-tag-configs'] })
      setShowAdd(false); setNewForm({ name: '', color: '#2d6a9f' })
      show('Tag added')
    } catch (e: any) { show(e?.response?.data?.name?.[0] || 'Failed to add', 'error') }
    finally { setSaving(false) }
  }

  const handleEdit = async () => {
    if (!editForm.name.trim()) return
    setSaving(true)
    try {
      await settingsApi.updateClientTag(editTarget.id, editForm)
      qc.invalidateQueries({ queryKey: ['client-tag-configs'] })
      setEditTarget(null); show('Tag updated')
    } catch (e: any) { show(e?.response?.data?.name?.[0] || 'Failed to update', 'error') }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setSaving(true)
    try {
      await settingsApi.deleteClientTag(deleteTarget.id)
      qc.invalidateQueries({ queryKey: ['client-tag-configs'] })
      setDeleteTarget(null); show('Tag deleted')
    } catch (e: any) { show(e?.response?.data?.detail || 'Failed to delete', 'error') }
    finally { setSaving(false) }
  }

  if (isLoading) return <div style={{ padding: 24, color: 'var(--muted)', fontSize: 13 }}>Loading…</div>

  return (
    <div className="card" style={{ maxWidth: 600 }}>
      <div className="card-hdr">
        Client Tags
        <button className="btn btn-dark btn-sm" onClick={() => setShowAdd(true)}>
          <Plus size={13} /> Add Tag
        </button>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {(tags as any[]).length === 0 && (
          <div style={{ padding: '16px 18px', fontSize: 13, color: 'var(--muted)' }}>
            No tags yet. Add tags to categorise clients with colors.
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
        <Modal title="Add Tag" onClose={() => setShowAdd(false)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn btn-dark btn-sm" onClick={handleAdd} disabled={saving}>{saving ? 'Adding…' : 'Add'}</button>
          </>
        }>
          <div className="fgroup">
            <label className="flabel">Tag Name *</label>
            <input className="finput" value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. VIP, Executive, On Hold" onKeyDown={e => { if (e.key === 'Enter') handleAdd() }} autoFocus />
          </div>
          <div className="fgroup">
            <label className="flabel">Color</label>
            <ColorPicker value={newForm.color} onChange={c => setNewForm(f => ({ ...f, color: c }))} />
          </div>
        </Modal>
      )}

      {editTarget && (
        <Modal title="Edit Tag" onClose={() => setEditTarget(null)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setEditTarget(null)}>Cancel</button>
            <button className="btn btn-dark btn-sm" onClick={handleEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </>
        }>
          <div className="fgroup">
            <label className="flabel">Tag Name *</label>
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
        <Modal title="Delete Tag" onClose={() => setDeleteTarget(null)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button className="btn btn-sm" onClick={handleDelete} disabled={saving}
              style={{ background: '#c0392b', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              {saving ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }>
          <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.6 }}>
            Delete tag <strong>"{deleteTarget.name}"</strong>? Clients will keep the tag text; only the color config is removed.
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
const GENERIC_USE_CASES = [
  { key: 'confirmation',         label: 'Booking Confirmation' },
  { key: 'reminder_24h',         label: '24h Reminder' },
  { key: 'reminder_1h',          label: '1h Reminder' },
  { key: 'invoice',              label: 'Invoice' },
  { key: 'portal_invite',        label: 'Portal Invite' },
  { key: 'client_communication', label: 'Client Communication' },
]

// Placeholders substituted at send time — differ per use case since each pulls from
// a different backend context (a session, an invoice, a portal link, …).
const PLACEHOLDER_HINTS: Record<string, string[]> = {
  confirmation:         ['{client_name}', '{coach_name}', '{workspace_name}', '{session_title}', '{session_time}'],
  reminder_24h:         ['{client_name}', '{coach_name}', '{workspace_name}', '{session_title}', '{session_time}', '{time_label}'],
  reminder_1h:          ['{client_name}', '{coach_name}', '{workspace_name}', '{session_title}', '{session_time}', '{time_label}'],
  invoice:              ['{client_name}', '{workspace_name}', '{invoice_number}', '{amount}', '{due_date}'],
  portal_invite:        ['{client_name}', '{coach_name}', '{workspace_name}', '{portal_url}'],
  client_communication: ['{client_name}', '{coach_name}', '{workspace_name}'],
}
const DEFAULT_PLACEHOLDER_HINT = ['{client_name}', '{workspace_name}', '{coach_name}']

// Ready-to-edit starting copy for each use case — lets a coach get a working, on-brand
// template in one click instead of starting from a blank editor.
const USE_CASE_SAMPLES: Record<string, { subject: string; intro: string; closing: string }> = {
  confirmation: {
    subject: 'Confirmed: your session with {coach_name}',
    intro:   'Hi {client_name}, your session with {coach_name} has been scheduled. We look forward to seeing you.',
    closing: 'Need to reschedule or have questions? Contact {coach_name} directly.',
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
    closing: 'Questions about this invoice? Just reply to this email.',
  },
  portal_invite: {
    subject: 'Your portal access is ready — {workspace_name}',
    intro:   'Hi {client_name}, {workspace_name} has set up a private portal for you where you can view your sessions, goals, and shared resources.',
    closing: 'If you have any questions, reply to this email or contact us.',
  },
  client_communication: {
    subject: 'A quick note from {coach_name}',
    intro:   'Hi {client_name}, ',
    closing: 'Talk soon,',
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

const blankGenericTemplate = () => ({
  id: `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name: '', subject: '', from_email: '', intro: '', closing: '',
  custom_html: '', disable_style: false, show_logo: true,
  style: { header_bg: '', accent_color: '', header_tagline: '', show_header: true, show_footer: true, footer_text: '' } as Record<string, any>,
  use_cases: [] as string[],
  include_client_signature_line: false,
})

function GenericTemplatesTab() {
  const { workspace, user, rehydrate } = useAuthStore()
  const { show } = useToast()
  const [templates, setTemplates] = useState<any[]>((workspace as any)?.generic_templates || [])
  const [useCaseMap, setUseCaseMap] = useState<Record<string, string>>((workspace as any)?.template_use_case_map || {})
  const [editing, setEditing] = useState<any>(null)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [assignChecks, setAssignChecks] = useState<Record<string, boolean>>({})
  const [addingSample, setAddingSample] = useState<string | null>(null)

  const persist = async (nextTemplates: any[], nextMap: Record<string, string>) => {
    const { data } = await api.patch('/api/settings/workspace/', {
      generic_templates: nextTemplates, template_use_case_map: nextMap,
    })
    if (user) rehydrate(user, { ...workspace, ...data })
    setTemplates(data.generic_templates || nextTemplates)
    setUseCaseMap(data.template_use_case_map || nextMap)
  }

  const missingUseCases = GENERIC_USE_CASES.filter(u => !useCaseMap[u.key])

  const handleAddSample = async (useCaseKey: string) => {
    const uc = GENERIC_USE_CASES.find(u => u.key === useCaseKey)
    const sample = USE_CASE_SAMPLES[useCaseKey]
    if (!uc || !sample) return
    setAddingSample(useCaseKey)
    try {
      const newTmpl = {
        ...blankGenericTemplate(),
        name: uc.label,
        subject: sample.subject, intro: sample.intro, closing: sample.closing,
        use_cases: [useCaseKey],
      }
      const nextTemplates = [...templates, newTmpl]
      const nextMap = { ...useCaseMap, [useCaseKey]: newTmpl.id }
      await persist(nextTemplates, nextMap)
      show(`${uc.label} sample added — edit it any time`)
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Failed to add sample', 'error')
    } finally { setAddingSample(null) }
  }

  const hasContractSample = templates.some(t => t.name === CONTRACT_SAMPLE.name)

  const handleAddContractSample = async () => {
    setAddingSample('contract')
    try {
      const newTmpl = {
        ...blankGenericTemplate(),
        name: CONTRACT_SAMPLE.name,
        subject: CONTRACT_SAMPLE.subject, intro: CONTRACT_SAMPLE.intro, closing: CONTRACT_SAMPLE.closing,
        include_client_signature_line: true,
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
      const params: Record<string, string> = {
        type: 'client_communication', client_name: 'Jane Smith',
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
      params.include_client_signature_line = t.include_client_signature_line ? '1' : '0'
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
      editing?.style?.show_footer, editing?.style?.footer_text, editing?.show_logo,
      editing?.include_client_signature_line])

  const openNew  = () => setEditing(blankGenericTemplate())
  const openEdit = (t: any) => setEditing({ ...t, style: { show_header: true, show_footer: true, footer_text: '', ...t.style } })
  const setStyle = (k: string, v: string | boolean) => setEditing((e: any) => ({ ...e, style: { ...e.style, [k]: v } }))

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template?')) return
    const nextTemplates = templates.filter(t => t.id !== id)
    const nextMap = { ...useCaseMap }
    Object.keys(nextMap).forEach(k => { if (nextMap[k] === id) delete nextMap[k] })
    await persist(nextTemplates, nextMap)
    show('Template deleted')
  }

  const handleSaveTemplate = async () => {
    if (!editing.name.trim()) { show('Give this template a name', 'error'); return }
    setSaving(true)
    try {
      const exists = templates.some(t => t.id === editing.id)
      const nextTemplates = exists ? templates.map(t => t.id === editing.id ? editing : t) : [...templates, editing]
      await persist(nextTemplates, useCaseMap)
      const checks: Record<string, boolean> = {}
      GENERIC_USE_CASES.forEach(u => { checks[u.key] = useCaseMap[u.key] === editing.id })
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
      GENERIC_USE_CASES.forEach(u => {
        if (assignChecks[u.key]) nextMap[u.key] = editing.id
        else if (nextMap[u.key] === editing.id) delete nextMap[u.key]
      })
      const nextTemplates = templates.map(t => t.id === editing.id ? editing : t).map(t => ({
        ...t, use_cases: GENERIC_USE_CASES.filter(u => nextMap[u.key] === t.id).map(u => u.key),
      }))
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
            {GENERIC_USE_CASES.map(u => {
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
    const assignedHints = (editing.use_cases || []).flatMap((uc: string) => PLACEHOLDER_HINTS[uc] || [])
    const activePlaceholders = Array.from(new Set(assignedHints.length ? assignedHints : DEFAULT_PLACEHOLDER_HINT))

    return (
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div className="card" style={{ flex: 1, minWidth: 0, maxWidth: 480 }}>
          <div className="card-body">
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)} style={{ marginBottom: 12 }}>← Back</button>
            <div className="fgroup">
              <label className="flabel">Template Name</label>
              <input className="finput" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Warm Welcome" />
            </div>
            <div className="fgroup">
              <label className="flabel">Subject</label>
              <input className="finput" value={editing.subject} onChange={e => setEditing({ ...editing, subject: e.target.value })} placeholder="e.g. A quick note from {workspace_name}" />
            </div>
            <div className="fgroup">
              <label className="flabel">From Email <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span></label>
              <input className="finput" value={editing.from_email} onChange={e => setEditing({ ...editing, from_email: e.target.value })} placeholder="hello@yourdomain.com" />
            </div>

            <div className="fgroup">
              <label className="flabel">Body — Opening</label>
              <textarea className="ftextarea" rows={3} value={editing.intro} onChange={e => setEditing({ ...editing, intro: e.target.value })} placeholder="Hi {client_name}, ..." />
            </div>
            <div className="fgroup">
              <label className="flabel">Body — Closing</label>
              <textarea className="ftextarea" rows={2} value={editing.closing} onChange={e => setEditing({ ...editing, closing: e.target.value })} placeholder="Talk soon, ..." />
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16 }}>
              Available: {activePlaceholders.join(' ')}
              {!(editing.use_cases || []).length && (
                <span> — more become available once you save and assign this to a specific email type.</span>
              )}
            </div>

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
                    <ColorPicker value={editing.style.header_bg || '#1a2f4e'} onChange={c => setStyle('header_bg', c)} />
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

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 480 }}>
          Build a branded template once, then choose which emails it powers — confirmations, reminders,
          invoices, portal invites, or one-off client messages.
        </div>
        <button className="btn btn-dark btn-sm" onClick={openNew}>+ New Template</button>
      </div>

      {(missingUseCases.length > 0 || !hasContractSample) && (
        <div className="card" style={{ padding: 14, marginBottom: 16, background: '#faf6ed', border: '1px solid #e8dcc0' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>Quick start — add an editable sample</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
            One click adds a ready-to-edit template pre-filled with sensible copy. Edit or delete it any time.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {missingUseCases.map(u => (
              <button key={u.key} className="btn btn-outline btn-sm" disabled={addingSample === u.key}
                onClick={() => handleAddSample(u.key)}>
                {addingSample === u.key ? 'Adding…' : `+ ${u.label}`}
              </button>
            ))}
            {!hasContractSample && (
              <button className="btn btn-outline btn-sm" disabled={addingSample === 'contract'}
                onClick={handleAddContractSample}>
                {addingSample === 'contract' ? 'Adding…' : '+ Contract Agreement'}
              </button>
            )}
          </div>
        </div>
      )}

      {templates.length === 0 ? (
        <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>
          No generic templates yet — add a sample above, or create one from scratch to reuse across invoices, reminders, and client messages.
        </div></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
          {templates.map(t => (
            <div key={t.id} className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{t.name || 'Untitled'}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, minHeight: 32 }}>
                {(t.use_cases || []).length
                  ? (t.use_cases || []).map((uc: string) => GENERIC_USE_CASES.find(u => u.key === uc)?.label || uc).join(', ')
                  : 'Not assigned to any use yet'}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-outline btn-sm" onClick={() => openEdit(t)} style={{ flex: 1, justifyContent: 'center' }}><Pencil size={12} /> Edit</button>
                <button className="btn btn-outline btn-sm" onClick={() => handleDelete(t.id)} style={{ color: '#c0392b', borderColor: '#f5c6c2' }}><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
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

// ── Integrations Tab ──────────────────────────────────────────────────────────
function IntegrationsTab() {
  const { show } = useToast()
  const [zoom, setZoom] = useState({ account_id: '', client_id: '', client_secret: '' })
  const [configured, setConfigured] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    settingsApi.getZoomSettings().then(r => {
      setZoom({ account_id: r.data.account_id, client_id: r.data.client_id, client_secret: r.data.client_secret })
      setConfigured(r.data.configured)
    }).catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    try {
      const r = await settingsApi.saveZoomSettings(zoom)
      setConfigured(r.data.configured)
      show('Zoom credentials saved', 'success')
    } catch { show('Failed to save', 'error') } finally { setSaving(false) }
  }

  async function test() {
    setTesting(true)
    try {
      await settingsApi.createZoomMeeting({ topic: 'Test Meeting', duration_minutes: 30 })
      show('Zoom connected ✓ Test meeting created successfully', 'success')
    } catch (err: any) {
      show(err?.response?.data?.detail || 'Zoom test failed', 'error')
    } finally { setTesting(false) }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24, fontWeight: 400, marginBottom: 6 }}>Integrations</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>Connect third-party services to enhance your workflow.</p>
      </div>

      <div className="card">
        <div className="card-hdr" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>📹 Zoom — Auto-generate Meeting Links</span>
          {configured && <span className="pill pill-green" style={{ fontSize: 10 }}>Connected</span>}
        </div>
        <div className="card-body">
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>
            Use a <strong>Server-to-Server OAuth</strong> app from{' '}
            <a href="https://marketplace.zoom.us/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)' }}>
              Zoom Marketplace
            </a>. Create an app of type "Server-to-Server OAuth", then copy the credentials below.
          </p>

          <div className="fgroup">
            <label className="flabel">Account ID</label>
            <input className="finput" value={zoom.account_id} onChange={e => setZoom(z => ({ ...z, account_id: e.target.value }))} placeholder="Your Zoom Account ID" />
          </div>
          <div className="fgroup">
            <label className="flabel">Client ID</label>
            <input className="finput" value={zoom.client_id} onChange={e => setZoom(z => ({ ...z, client_id: e.target.value }))} placeholder="OAuth Client ID" />
          </div>
          <div className="fgroup">
            <label className="flabel">Client Secret</label>
            <input className="finput" type="password" value={zoom.client_secret} onChange={e => setZoom(z => ({ ...z, client_secret: e.target.value }))} placeholder={configured ? '••••••••' : 'OAuth Client Secret'} />
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button className="btn btn-dark btn-sm" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save Credentials'}
            </button>
            {configured && (
              <button className="btn btn-outline btn-sm" onClick={test} disabled={testing}>
                {testing ? 'Testing…' : 'Test Connection'}
              </button>
            )}
          </div>
        </div>
      </div>
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
    { key: 'Team',             icon: <Mail size={13} />,         ownerOnly: true  },
    { key: 'Pipeline',         icon: <Kanban size={13} />,       ownerOnly: true  },
    { key: 'Activity Types',   icon: <CalendarDays size={13} />, ownerOnly: true  },
    { key: 'Client Statuses',  icon: <Plus size={13} />,         ownerOnly: true  },
    { key: 'Tags',             icon: <Plus size={13} />,         ownerOnly: true  },
    { key: 'Services',         icon: <Plus size={13} />,         ownerOnly: true  },
    { key: 'Generic Templates', icon: <Mail size={13} />,        ownerOnly: true  },
    { key: 'Integrations',    icon: <Plus size={13} />,          ownerOnly: true  },
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
        {tab === 'Team'           && isOwner && <TeamTab />}
        {tab === 'Pipeline'       && isOwner && <PipelineTab />}
        {tab === 'Activity Types'  && isOwner && <ActivityTypesTab />}
        {tab === 'Client Statuses' && isOwner && <ClientStatusesTab />}
        {tab === 'Tags'            && isOwner && <TagsTab />}
        {tab === 'Services'        && isOwner && <ServicesTab />}
        {tab === 'Generic Templates' && isOwner && <GenericTemplatesTab />}
        {tab === 'Integrations'    && isOwner && <IntegrationsTab />}
        {tab === 'Audit Log'       && isOwner && <AuditLogTab />}
      </div>
    </AppShell>
  )
}
