import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { authApi, settingsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { PageHeader, Modal, useToast } from '../../components/ui'
import { useAuthStore } from '../../store/auth'
import { User, Shield, Building2, Mail, Plus } from 'lucide-react'

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
      if (user) rehydrate(user, data)
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

  return (
    <div style={{ maxWidth: 600, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Logo */}
      <div className="card">
        <div className="card-hdr"><Building2 size={14} /> Workspace Logo</div>
        <div className="card-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {/* Preview */}
            <div style={{
              width: 96, height: 64, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              background: '#1a1714', display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', flexShrink: 0,
            }}>
              {logoData
                ? <img src={logoData} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                : <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 16, color: '#f7f4ef', letterSpacing: '.04em' }}>
                    {form.name || 'Logo'}
                  </span>
              }
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 4 }}>
                {logoData ? 'Logo uploaded' : 'No logo uploaded'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5 }}>
                PNG or SVG recommended. Max 2 MB. Appears in emails sent to clients.
              </div>
              {isOwner && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <label style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 14px', background: 'var(--ink)', color: 'var(--paper)',
                    fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase',
                    borderRadius: 'var(--radius-sm)', cursor: logoUploading ? 'not-allowed' : 'pointer',
                    opacity: logoUploading ? 0.6 : 1,
                  }}>
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoChange} disabled={logoUploading} />
                    {logoUploading ? 'Uploading…' : logoData ? 'Replace' : 'Upload Logo'}
                  </label>
                  {logoData && (
                    <button className="btn btn-outline btn-sm" onClick={handleRemoveLogo} disabled={logoUploading}>
                      Remove
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Settings */}
      <div className="card">
        <div className="card-hdr"><Building2 size={14} /> Workspace Settings</div>
        <div className="card-body">
          <div className="fgroup">
            <label className="flabel">Workspace Name</label>
            <input className="finput" value={form.name} onChange={e => set('name', e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              Appears on invoices and client emails.
            </div>
          </div>
          <div className="fgroup">
            <label className="flabel">Default Timezone</label>
            <select className="fselect" value={form.workspace_timezone} onChange={e => set('workspace_timezone', e.target.value)}>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              Used for scheduling and reminder times.
            </div>
          </div>
          <div className="fgrid">
            <div className="fgroup">
              <label className="flabel">Cancellation Window (hours)</label>
              <input className="finput" type="number" min={0} value={form.cancellation_hours}
                onChange={e => set('cancellation_hours', Number(e.target.value))} />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                e.g. 48 = clients must cancel 48h before.
              </div>
            </div>
            <div className="fgroup">
              <label className="flabel">Session Buffer (minutes)</label>
              <input className="finput" type="number" min={0} value={form.buffer_minutes}
                onChange={e => set('buffer_minutes', Number(e.target.value))} />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                Gap auto-blocked after each session.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
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

  return (
    <div style={{ maxWidth: 600, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Profile info */}
      <div className="card">
        <div className="card-hdr"><User size={14} /> Your Profile</div>
        <div className="card-body">
          <div className="fgroup">
            <label className="flabel">Full Name</label>
            <input className="finput" value={form.full_name} onChange={e => set('full_name', e.target.value)} />
          </div>
          <div className="fgroup">
            <label className="flabel">Email</label>
            <input className="finput" value={user?.email || ''} disabled
              style={{ background: 'var(--paper)', color: 'var(--muted)', cursor: 'not-allowed' }} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Email cannot be changed.</div>
          </div>
          <div className="fgroup">
            <label className="flabel">Your Timezone</label>
            <select className="fselect" value={form.user_timezone} onChange={e => set('user_timezone', e.target.value)}>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div className="fgroup">
            <label className="flabel">Role</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                background: ROLE_COLORS[user?.role || ''] + '18',
                color: ROLE_COLORS[user?.role || ''] || 'var(--muted)',
              }}>
                {ROLE_LABELS[user?.role || ''] || user?.role}
              </span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Role is set by your workspace owner.</span>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn-dark" onClick={handleSaveProfile} disabled={savingProfile}>
              {savingProfile ? 'Saving…' : 'Save Profile'}
            </button>
          </div>
        </div>
      </div>

      {/* Change password */}
      <div className="card">
        <div className="card-hdr"><Shield size={14} /> Change Password</div>
        <div className="card-body">
          {pwError && (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 'var(--radius-sm)', fontSize: 12, color: '#b91c1c' }}>
              {pwError}
            </div>
          )}
          <div className="fgroup">
            <label className="flabel">Current Password</label>
            <input className="finput" type="password" value={pwForm.current_password}
              onChange={e => setPw('current_password', e.target.value)} />
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
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
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
          ) : members.map((m: any) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
              {/* Avatar circle */}
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: ROLE_COLORS[m.role] + '22',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 600, color: ROLE_COLORS[m.role] || 'var(--muted)',
                flexShrink: 0,
              }}>
                {m.full_name?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {m.full_name}
                  {m.id === currentUser?.id && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>(you)</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{m.email}</div>
              </div>
              <span style={{
                padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, flexShrink: 0,
                background: (ROLE_COLORS[m.role] || '#8c8279') + '18',
                color: ROLE_COLORS[m.role] || 'var(--muted)',
              }}>
                {ROLE_LABELS[m.role] || m.role}
              </span>
            </div>
          ))}
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

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function Settings() {
  const { user } = useAuthStore()
  const isOwner = user?.role === 'business_owner'

  const ALL_TABS = [
    { key: 'Workspace', icon: <Building2 size={13} />, ownerOnly: true },
    { key: 'Profile',   icon: <User size={13} />,      ownerOnly: false },
    { key: 'Team',      icon: <Mail size={13} />,      ownerOnly: true },
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
        {tab === 'Workspace' && isOwner && <WorkspaceTab />}
        {tab === 'Profile'   && <ProfileTab />}
        {tab === 'Team'      && isOwner && <TeamTab />}
      </div>
    </AppShell>
  )
}
