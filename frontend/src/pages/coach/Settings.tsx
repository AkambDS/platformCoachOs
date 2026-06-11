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
              background: '#1a1714', display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', flexShrink: 0,
            }}>
              {logoData
                ? <img src={logoData} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                : <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 15, color: '#f7f4ef', letterSpacing: '.04em' }}>
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
      const { data } = await authApi.updateMe({ full_name: form.full_name, user_timezone: form.user_timezone })
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
const PRESET_COLORS = [
  // Blues
  '#1B3A6B','#2d6a9f','#2980b9','#1a6fa8','#0e4d8a','#5b9bd5',
  // Greens
  '#4a7c59','#16a085','#27ae60','#2e7d32','#388e3c','#6ab187',
  // Purples & pinks
  '#7c4d9f','#9b59b6','#8e24aa','#c2185b','#e91e7a','#7b1fa2',
  // Warm tones
  '#c9a84c','#e67e22','#f39c12','#d97706','#a0522d','#8d4e1f',
  // Reds
  '#c0392b','#e53935','#b71c1c','#cc4125',
  // Neutrals
  '#1a1714','#4a4540','#8c8279','#607d8b',
]

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 4 }}>
        {PRESET_COLORS.map(c => (
          <button
            key={c} type="button"
            onClick={() => onChange(c)}
            style={{
              width: 26, height: 26, borderRadius: '50%', background: c, cursor: 'pointer',
              border: value === c ? '3px solid var(--ink)' : '2px solid rgba(0,0,0,.08)',
              boxShadow: value === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : 'none',
              transition: 'all .1s', padding: 0,
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', background: value, border: '2px solid rgba(0,0,0,.12)', flexShrink: 0 }} />
        <input
          type="color" value={value} onChange={e => onChange(e.target.value)}
          style={{ width: 36, height: 26, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 4, padding: 2 }}
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
    ? `Hi {client_name}, please find your invoice from {workspace_name} below.`
    : `Hi {client_name}, your session with {coach_name} has been confirmed.`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{workspace_name}</title>
</head>
<body style="margin:0;padding:0;background:#f0ede8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">

      <!-- HEADER: replace text below with an <img> tag for your logo -->
      <tr>
        <td style="background:#1a2f4e;padding:24px 40px;border-radius:8px 8px 0 0;">
          <span style="font-family:Georgia,serif;font-size:22px;color:#f7f4ef;font-weight:400;letter-spacing:.04em;">{workspace_name}</span>
        </td>
      </tr>
      <!-- Gold accent bar -->
      <tr><td style="height:3px;background:#b8922e;"></td></tr>

      <!-- BODY -->
      <tr>
        <td style="background:#ffffff;padding:40px;border-radius:0 0 8px 8px;">

          <!-- Greeting -->
          <p style="margin:0 0 24px;font-size:15px;color:#6e6560;line-height:1.7;">${intro}</p>

          <!-- Detail table -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="border-top:2px solid #1a2f4e;margin-bottom:28px;">
            ${rows.join('\n            ')}
          </table>

          <!-- Custom message — edit this section freely -->
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

// ── Email Templates Tab ────────────────────────────────────────────────────────
const BODY_FONTS = [
  { label: 'Helvetica / Arial (default)', value: "'Helvetica Neue',Helvetica,Arial,sans-serif" },
  { label: 'Georgia',                     value: "Georgia,'Times New Roman',serif" },
  { label: 'Verdana',                     value: "Verdana,Geneva,sans-serif" },
  { label: 'Trebuchet MS',                value: "'Trebuchet MS',Helvetica,sans-serif" },
]
const HEADING_FONTS = [
  { label: 'Georgia (default)',   value: "Georgia,'Times New Roman',serif" },
  { label: 'Helvetica / Arial',  value: "'Helvetica Neue',Helvetica,Arial,sans-serif" },
  { label: 'Verdana',            value: "Verdana,Geneva,sans-serif" },
]

const EMAIL_TEMPLATE_DEFS = [
  {
    key: 'confirmation',
    label: 'Confirmation',
    hint: 'Sent when a session is first scheduled.',
    defaultSubject: 'Confirmed: {session_title} with {coach_name}',
    vars: ['{client_name}', '{coach_name}', '{session_title}', '{session_time}', '{workspace_name}'],
  },
  {
    key: 'reminder_24h',
    label: '24h Reminder',
    hint: 'Sent 24 hours before the session.',
    defaultSubject: 'Reminder: {session_title} in 24 hours',
    vars: ['{client_name}', '{coach_name}', '{session_title}', '{session_time}', '{workspace_name}', '{time_label}'],
  },
  {
    key: 'reminder_1h',
    label: '1h Reminder',
    hint: 'Sent 1 hour before the session.',
    defaultSubject: 'Reminder: {session_title} in 1 hour',
    vars: ['{client_name}', '{coach_name}', '{session_title}', '{session_time}', '{workspace_name}', '{time_label}'],
  },
  {
    key: 'invoice',
    label: 'Invoice',
    hint: 'Sent when an invoice is delivered to a client.',
    defaultSubject: 'Invoice #{invoice_number} from {workspace_name}',
    vars: ['{client_name}', '{workspace_name}', '{invoice_number}', '{amount}', '{due_date}'],
  },
  {
    key: 'portal_invite',
    label: 'Portal Invite',
    hint: 'Sent when you grant a client access to their portal.',
    defaultSubject: 'Your portal access is ready — {workspace_name}',
    vars: ['{client_name}', '{workspace_name}', '{coach_name}', '{portal_url}'],
  },
]

function EmailTemplatesTab() {
  const { workspace, user, rehydrate } = useAuthStore()
  const { show } = useToast()

  const [activeKey, setActiveKey] = useState('confirmation')
  const [leftTab, setLeftTab]     = useState<'content' | 'style' | 'custom'>('content')
  const [saving, setSaving]       = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [htmlMode, setHtmlMode] = useState<'upload' | 'paste'>('upload')
  const [pasteBuffer, setPasteBuffer] = useState('')

  const saved = (workspace as any)?.email_templates || {}
  const initField = (key: string) => ({
    subject:        saved[key]?.subject        || '',
    from_email:     saved[key]?.from_email     || '',
    intro:          saved[key]?.intro          || '',
    closing:        saved[key]?.closing        || '',
    custom_html:    saved[key]?.custom_html    || '',
    header_bg:      saved[key]?.style?.header_bg      || '',
    accent_color:   saved[key]?.style?.accent_color   || '',
    header_tagline: saved[key]?.style?.header_tagline !== undefined
                      ? saved[key].style.header_tagline
                      : 'Coaching Platform',
    body_font:      saved[key]?.style?.body_font    || '',
    heading_font:   saved[key]?.style?.heading_font || '',
    value_color:    saved[key]?.style?.value_color  || '#1a1714',
  })
  const [fields, setFields]         = useState(initField(activeKey))
  const [htmlUploading, setHtmlUploading] = useState(false)
  const logoData = (workspace as any)?.logo_data || ''

  const def = EMAIL_TEMPLATE_DEFS.find(d => d.key === activeKey)!

  const renderPreview = async (key: string, f: ReturnType<typeof initField>) => {
    if (f.custom_html) { setPreviewHtml(f.custom_html); return }
    setPreviewLoading(true)
    try {
      const params: Record<string, string> = {
        type: key, intro: f.intro, closing: f.closing, _t: String(Date.now()),
        header_tagline: f.header_tagline,
      }
      if (f.header_bg)    params.header_bg    = f.header_bg
      if (f.accent_color) params.accent_color = f.accent_color
      if (f.body_font)    params.body_font    = f.body_font
      if (f.heading_font) params.heading_font = f.heading_font
      if (f.value_color)  params.value_color  = f.value_color
      const { data } = await api.get('/api/settings/email-preview/', { params })
      setPreviewHtml(data.html)
    } catch { setPreviewHtml('') }
    finally { setPreviewLoading(false) }
  }

  const switchTab = (key: string) => {
    const f = initField(key)
    setActiveKey(key)
    setFields(f)
    renderPreview(key, f)
  }

  const handleHtmlUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setHtmlUploading(true)
    try {
      const text = await file.text()
      setFields(f => { const nf = { ...f, custom_html: text }; setPreviewHtml(text); return nf })
    } finally { setHtmlUploading(false); e.target.value = '' }
  }

  // Initial preview on mount
  useEffect(() => { renderPreview(activeKey, fields) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh preview 700ms after user stops typing or changing style fields
  useEffect(() => {
    if (fields.custom_html) return
    const t = setTimeout(() => renderPreview(activeKey, fields), 700)
    return () => clearTimeout(t)
  }, [fields.intro, fields.closing, fields.header_bg, fields.accent_color, fields.header_tagline, fields.body_font, fields.heading_font, fields.value_color]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true)
    try {
      const { header_bg, accent_color, header_tagline, body_font, heading_font, value_color, from_email, ...rest } = fields
      const templateToSave = {
        ...rest,
        from_email,
        style: { header_bg, accent_color, header_tagline, body_font, heading_font, value_color },
      }
      const newEmailTemplates = { ...saved, [activeKey]: templateToSave }
      const { data } = await settingsApi.updateWorkspace({ email_templates: newEmailTemplates })
      if (user) rehydrate(user, { ...workspace, ...data, email_templates: newEmailTemplates })
      show('Template saved')
      await renderPreview(activeKey, fields)
    } catch { show('Failed to save', 'error') }
    finally { setSaving(false) }
  }

  const colorRow = (label: string, key: 'header_bg' | 'accent_color' | 'value_color', defaultVal: string) => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.1em', color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="color" value={fields[key] || defaultVal}
          onChange={e => setFields(f => ({ ...f, [key]: e.target.value }))}
          style={{ width: 36, height: 28, padding: 2, borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer' }} />
        <input className="finput" value={fields[key] || defaultVal}
          onChange={e => setFields(f => ({ ...f, [key]: e.target.value }))}
          style={{ margin: 0, fontFamily: 'monospace', fontSize: 12, flex: 1 }} />
        <div style={{ width: 24, height: 24, borderRadius: 4, background: fields[key] || defaultVal, border: '1px solid var(--border)', flexShrink: 0 }} />
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, height: 'calc(100vh - 180px)', minHeight: 560 }}>

      {/* Template type pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexShrink: 0 }}>
        {EMAIL_TEMPLATE_DEFS.map(d => (
          <button key={d.key} onClick={() => switchTab(d.key)} style={{
            padding: '6px 16px', borderRadius: 20, fontSize: 12, fontWeight: 500,
            border: '1px solid var(--border)', cursor: 'pointer',
            background: activeKey === d.key ? 'var(--ink)' : 'var(--white)',
            color:      activeKey === d.key ? 'var(--white)' : 'var(--ink)',
          }}>{d.label}</button>
        ))}
      </div>

      {/* Split layout */}
      <div style={{ display: 'flex', gap: 16, flex: 1, overflow: 'hidden' }}>

        {/* Left — edit fields */}
        <div style={{
          width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 0,
          background: 'var(--white)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '20px 20px 16px', overflow: 'auto',
        }}>
          {/* ── Tab bar ── */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 16, flexShrink: 0, gap: 0 }}>
            {(['content', 'style', 'custom'] as const).map(t => (
              <button key={t} onClick={() => setLeftTab(t)} style={{
                flex: 1, padding: '9px 4px', border: 'none', cursor: 'pointer',
                background: leftTab === t ? 'var(--white)' : 'var(--paper)',
                borderBottom: leftTab === t ? '2px solid var(--ink)' : '2px solid transparent',
                fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase',
                color: leftTab === t ? 'var(--ink)' : 'var(--muted)',
              }}>
                {t === 'content' ? 'Content' : t === 'style' ? 'Style' : 'Custom HTML'}
              </button>
            ))}
          </div>

          {/* ── CONTENT tab ── */}
          {leftTab === 'content' && (
            <>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5 }}>{def.hint}</div>
              <div className="fgroup">
                <label className="flabel">Subject line</label>
                <input className="finput" placeholder={`Default: ${def.defaultSubject}`}
                  value={fields.subject}
                  onChange={e => setFields(f => ({ ...f, subject: e.target.value }))} />
              </div>
              <div className="fgroup">
                <label className="flabel">From email <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
                <input className="finput" type="email" placeholder="Default sender"
                  value={fields.from_email}
                  onChange={e => setFields(f => ({ ...f, from_email: e.target.value }))} />
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>Must be an address @rass-consulting.com or @lauratreonze.com.</div>
              </div>
              <div className="fgroup">
                <label className="flabel">Opening paragraph</label>
                <textarea className="finput" rows={3} placeholder="Leave blank for default"
                  value={fields.intro} style={{ resize: 'vertical' }}
                  onChange={e => setFields(f => ({ ...f, intro: e.target.value }))} />
              </div>
              <div className="fgroup">
                <label className="flabel">Closing paragraph</label>
                <textarea className="finput" rows={3} placeholder="Leave blank for default"
                  value={fields.closing} style={{ resize: 'vertical' }}
                  onChange={e => setFields(f => ({ ...f, closing: e.target.value }))} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Available placeholders</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {def.vars.map(v => (
                    <span key={v} onClick={() => navigator.clipboard?.writeText(v)} style={{
                      background: '#f0f4ff', color: '#2d6a9f', borderRadius: 4,
                      padding: '2px 7px', fontSize: 10, fontFamily: 'monospace',
                      cursor: 'pointer', userSelect: 'all',
                    }} title="Click to copy">{v}</span>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── STYLE tab ── */}
          {leftTab === 'style' && (
            <>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.1em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>Header</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 10 }}>
                  <div style={{ width: 40, height: 28, borderRadius: 4, border: '1px solid var(--border)', background: '#1a1714', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                    {logoData
                      ? <img src={logoData} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                      : <span style={{ fontFamily: 'serif', fontSize: 10, color: '#f7f4ef' }}>{(workspace as any)?.name?.charAt(0) || '?'}</span>
                    }
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', flex: 1 }}>
                    {logoData ? 'Logo uploaded' : 'No logo'} · <span style={{ color: '#2d6a9f', cursor: 'pointer' }}>Change in Workspace tab</span>
                  </div>
                </div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 8 }}>
                  <input type="checkbox" checked={fields.header_tagline === ''}
                    onChange={e => setFields(f => ({ ...f, header_tagline: e.target.checked ? '' : 'Coaching Platform' }))}
                    style={{ width: 13, height: 13, accentColor: 'var(--gold)' }} />
                  Show logo only — hide tagline text
                </label>
                {fields.header_tagline !== '' && (
                  <input className="finput" placeholder="Coaching Platform"
                    value={fields.header_tagline}
                    onChange={e => setFields(f => ({ ...f, header_tagline: e.target.value }))}
                    style={{ margin: 0 }} />
                )}
              </div>
              {colorRow('Header background', 'header_bg', '#1a2f4e')}
              {colorRow('Accent / highlight', 'accent_color', '#b8922e')}
              {colorRow('Detail values (amount, date, "When")', 'value_color', '#1a1714')}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.1em', color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>Body font</label>
                <select className="fselect" style={{ margin: 0 }} value={fields.body_font}
                  onChange={e => setFields(f => ({ ...f, body_font: e.target.value }))}>
                  <option value="">Default</option>
                  {BODY_FONTS.map(fn => <option key={fn.value} value={fn.value}>{fn.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.1em', color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>Heading font</label>
                <select className="fselect" style={{ margin: 0 }} value={fields.heading_font}
                  onChange={e => setFields(f => ({ ...f, heading_font: e.target.value }))}>
                  <option value="">Default</option>
                  {HEADING_FONTS.map(fn => <option key={fn.value} value={fn.value}>{fn.label}</option>)}
                </select>
              </div>
            </>
          )}

          {/* ── CUSTOM HTML tab ── */}
          {leftTab === 'custom' && (
            <>
              {fields.custom_html ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 11, color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '8px 12px' }}>
                    ✓ Custom template active — overrides Content tab
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <label style={{ flex: 1, textAlign: 'center', fontSize: 11, cursor: 'pointer', padding: '6px 0', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--white)', color: 'var(--ink)' }}>
                      {htmlUploading ? 'Reading…' : '↑ Replace file'}
                      <input type="file" accept=".html,.htm" style={{ display: 'none' }} onChange={handleHtmlUpload} />
                    </label>
                    <button onClick={() => { setPasteBuffer(fields.custom_html); setHtmlMode('paste'); setFields(f => ({ ...f, custom_html: '' })); renderPreview(activeKey, { ...fields, custom_html: '' }) }}
                      style={{ flex: 1, fontSize: 11, padding: '6px 0', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--white)', color: 'var(--ink)', cursor: 'pointer' }}>
                      ✎ Edit
                    </button>
                    <button onClick={() => { setFields(f => ({ ...f, custom_html: '' })); setPasteBuffer(''); renderPreview(activeKey, { ...fields, custom_html: '' }) }}
                      style={{ flex: 1, fontSize: 11, padding: '6px 0', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--white)', color: '#b91c1c', cursor: 'pointer' }}>
                      ✕ Remove
                    </button>
                  </div>
                  <button onClick={() => { const b = new Blob([fields.custom_html], { type: 'text/html' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `${activeKey}-template.html`; a.click(); URL.revokeObjectURL(u) }}
                    style={{ fontSize: 11, padding: '6px 0', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--white)', color: 'var(--ink)', cursor: 'pointer' }}>
                    ↓ Download current template
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                    <label style={{ flex: 1, textAlign: 'center', fontSize: 11, cursor: 'pointer', padding: '7px 0', borderRadius: 6, border: '1.5px dashed var(--border)', color: 'var(--muted)', background: 'var(--paper)' }}>
                      {htmlUploading ? 'Reading…' : '↑ Upload .html file'}
                      <input type="file" accept=".html,.htm" style={{ display: 'none' }} onChange={handleHtmlUpload} />
                    </label>
                    <button onClick={() => { setHtmlMode('paste'); setPasteBuffer('') }}
                      style={{ flex: 1, fontSize: 11, padding: '7px 0', borderRadius: 6, border: '1.5px dashed var(--border)', background: 'var(--paper)', color: 'var(--muted)', cursor: 'pointer' }}>
                      ✎ Paste HTML
                    </button>
                  </div>
                  {htmlMode === 'paste' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                      <textarea rows={8} placeholder="Paste your HTML here…" value={pasteBuffer}
                        onChange={e => { setPasteBuffer(e.target.value); if (e.target.value) setPreviewHtml(e.target.value) }}
                        style={{ width: '100%', resize: 'vertical', fontSize: 11, fontFamily: 'monospace', padding: '8px', border: '1px solid var(--border)', borderRadius: 6, background: '#fafafa', lineHeight: 1.5 }} />
                      <button disabled={!pasteBuffer.trim()}
                        onClick={() => { setFields(f => ({ ...f, custom_html: pasteBuffer.trim() })); setPreviewHtml(pasteBuffer.trim()) }}
                        style={{ fontSize: 11, padding: '7px 0', borderRadius: 6, border: 'none', cursor: pasteBuffer.trim() ? 'pointer' : 'not-allowed', background: pasteBuffer.trim() ? 'var(--ink)' : 'var(--border)', color: '#fff', fontWeight: 600 }}>
                        Apply Template
                      </button>
                    </div>
                  )}
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>Start with a sample template pre-filled with all placeholders:</div>
                    <button onClick={() => {
                      const html = generateSampleHtml(activeKey)
                      const blob = new Blob([html], { type: 'text/html' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a'); a.href = url; a.download = `${activeKey}-sample.html`; a.click()
                      URL.revokeObjectURL(url)
                    }} style={{ width: '100%', padding: '8px 0', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid #2d6a9f', background: '#f0f4ff', color: '#2d6a9f', cursor: 'pointer', letterSpacing: '.04em' }}>
                      ↓ Download Sample Template
                    </button>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
                      Edit the file, then upload it back or paste it above.
                      Placeholders: {def.vars.map(v => <code key={v} style={{ background: '#f5f3ef', padding: '0 3px', borderRadius: 3, fontFamily: 'monospace', marginRight: 3 }}>{v}</code>)}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 14 }}>
            <button className="btn-primary" style={{ width: '100%' }} disabled={saving} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {/* Right — email preview */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Subject bar */}
          <div style={{
            background: 'var(--white)', border: '1px solid var(--border)', borderRadius: '8px 8px 0 0',
            borderBottom: 'none', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em', flexShrink: 0 }}>Subject</span>
            <span style={{ fontSize: 13, color: fields.subject ? 'var(--ink)' : 'var(--muted)', fontStyle: fields.subject ? 'normal' : 'italic' }}>
              {fields.subject || def.defaultSubject}
            </span>
            {!fields.subject && (
              <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 4, background: '#f5f3ef', borderRadius: 4, padding: '1px 6px' }}>default</span>
            )}
          </div>
          <div style={{
            flex: 1, border: '1px solid var(--border)', borderRadius: '0 0 8px 8px',
            overflow: 'hidden', background: '#f5f3ef', position: 'relative',
          }}>
            {previewLoading && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                justifyContent: 'center', background: 'rgba(255,255,255,0.7)', zIndex: 1,
                fontSize: 13, color: 'var(--muted)',
              }}>Loading preview…</div>
            )}
            <iframe
              srcDoc={previewHtml}
              title="Email preview"
              sandbox="allow-same-origin"
              style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            />
          </div>
        </div>
      </div>
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
    { key: 'Email Templates',  icon: <Mail size={13} />,          ownerOnly: true  },
    { key: 'Integrations',    icon: <Plus size={13} />,          ownerOnly: true  },
    { key: 'Audit Log',       icon: <ClipboardList size={13} />, ownerOnly: true  },
  ]
  const TABS = ALL_TABS.filter(t => !t.ownerOnly || isOwner)

  const [tab, setTab] = useState(isOwner ? 'Workspace' : 'Profile')

  return (
    <AppShell>
      <PageHeader title="Settings" subtitle="Manage your workspace, profile, and team" />

      <div style={{ background: 'var(--white)', borderBottom: '1px solid var(--border)', padding: '0 36px', display: 'flex' }}>
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
        {tab === 'Email Templates' && isOwner && <EmailTemplatesTab />}
        {tab === 'Integrations'    && isOwner && <IntegrationsTab />}
        {tab === 'Audit Log'       && isOwner && <AuditLogTab />}
      </div>
    </AppShell>
  )
}
