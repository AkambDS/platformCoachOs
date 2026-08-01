import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { authApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { PageHeader, Modal, useToast } from '../../components/ui'
import { useAuthStore } from '../../store/auth'
import { Mail, Plus, Pencil, Trash2, ShieldCheck, Phone } from 'lucide-react'

const ROLE_LABELS: Record<string, string> = {
  business_owner: 'Business Owner',
  coach:          'Coach',
  assistant:      'Assistant',
  limited:        'Limited',
}
const ROLE_COLORS: Record<string, string> = {
  business_owner: '#c9a84c',
  coach:          '#2d6a9f',
  assistant:      '#4a7c59',
  limited:        '#8c8279',
}

const TABS: { key: string; label: string }[] = [
  { key: 'clients',    label: 'Clients' },
  { key: 'pipeline',   label: 'Pipeline' },
  { key: 'activities', label: 'Activities' },
  { key: 'invoices',   label: 'Invoices' },
  { key: 'reports',    label: 'Reports' },
  { key: 'library',    label: 'Library' },
]
type TabPerms = Record<string, { view: boolean; edit: boolean; delete: boolean }>
const blankTabPerms = (): TabPerms =>
  TABS.reduce((acc, t) => ({ ...acc, [t.key]: { view: false, edit: false, delete: false } }), {})

// ── Permissions Matrix Modal ────────────────────────────────────────────────────
function PermissionsModal({ member, onClose }: { member: any; onClose: () => void }) {
  const { show } = useToast()
  const [perms, setPerms] = useState<TabPerms>(blankTabPerms())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useState(() => {
    authApi.getMemberPermissions(member.id)
      .then(r => setPerms(r.data))
      .catch(() => show('Failed to load permissions', 'error'))
      .finally(() => setLoading(false))
  })

  const setCell = (tab: string, field: 'view' | 'edit' | 'delete', value: boolean) => {
    setPerms(p => {
      const next = { ...p[tab], [field]: value }
      // Edit/delete without view doesn't make sense — granting edit/delete implies view.
      if ((field === 'edit' || field === 'delete') && value) next.view = true
      // Removing view revokes edit/delete too.
      if (field === 'view' && !value) { next.edit = false; next.delete = false }
      return { ...p, [tab]: next }
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await authApi.setMemberPermissions(member.id, perms)
      show(`Permissions updated for ${member.full_name}`)
      onClose()
    } catch { show('Failed to save permissions', 'error') }
    finally { setSaving(false) }
  }

  return (
    <Modal title={`Permissions — ${member.full_name}`} onClose={onClose} size="lg" footer={
      <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'flex-end' }}>
        <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-dark btn-sm" onClick={handleSave} disabled={saving || loading}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    }>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.6 }}>
            Control exactly which sections <strong style={{ color: 'var(--ink)' }}>{member.full_name}</strong> can
            see and act on. Unchecked sections are completely hidden from them.
          </p>
          <table className="tbl">
            <thead>
              <tr>
                <th>Section</th>
                <th style={{ textAlign: 'center' }}>View</th>
                <th style={{ textAlign: 'center' }}>Edit</th>
                <th style={{ textAlign: 'center' }}>Delete</th>
              </tr>
            </thead>
            <tbody>
              {TABS.map(t => (
                <tr key={t.key}>
                  <td style={{ fontWeight: 500 }}>{t.label}</td>
                  {(['view', 'edit', 'delete'] as const).map(field => (
                    <td key={field} style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={!!perms[t.key]?.[field]}
                        onChange={e => setCell(t.key, field, e.target.checked)}
                        style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--gold)' }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  )
}

// ── Team Page ────────────────────────────────────────────────────────────────
export default function Team() {
  const { user: currentUser, workspace } = useAuthStore()
  const { show } = useToast()
  const qc = useQueryClient()
  const genericTemplates: any[] = (workspace as any)?.generic_templates || []
  // Only templates assigned to the Team Invite slot — other templates (Portal Invite,
  // Booking Confirmation, etc.) use a completely different placeholder set
  // ({client_name}, {session_time}, …) that doesn't exist in the invite context, so
  // picking one leaves those placeholders literally unsubstituted in the sent email.
  const teamInviteTemplates = genericTemplates.filter((t: any) => t.use_cases?.includes('team_invite'))

  const [showInvite, setShowInvite] = useState(false)
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'coach', email_template_id: '' })
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [showEmailPreview, setShowEmailPreview] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)

  const [editTarget, setEditTarget] = useState<any | null>(null)
  const [editForm, setEditForm] = useState({ role: '', phone: '', address: '', city: '', state: '', zip_code: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [permsTarget, setPermsTarget] = useState<any | null>(null)
  const [accessBusyId, setAccessBusyId] = useState<string | null>(null)

  const handleEditSave = async () => {
    if (!editTarget) return
    setEditSaving(true)
    try {
      await authApi.updateMember(editTarget.id, editForm)
      qc.invalidateQueries({ queryKey: ['team'] })
      setEditTarget(null)
      show(`${editTarget.full_name}'s details updated`)
    } catch (err: any) {
      show(err.response?.data?.detail || 'Failed to update member', 'error')
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

  const handleToggleAccess = async (member: any, grant: boolean) => {
    setAccessBusyId(member.id)
    try {
      await authApi.updateMember(member.id, { is_active: grant })
      qc.invalidateQueries({ queryKey: ['team'] })
      show(grant ? `${member.full_name} granted access` : `${member.full_name}'s access revoked`)
    } catch { show(`Failed to ${grant ? 'grant' : 'revoke'} access`, 'error') }
    finally { setAccessBusyId(null) }
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
      setInviteForm({ email: '', role: 'coach', email_template_id: '' })
      show(`Invitation sent to ${inviteForm.email}`)
    } catch (err: any) {
      setInviteError(err.response?.data?.email?.[0] || err.response?.data?.detail || 'Failed to send invite')
    } finally { setInviting(false) }
  }

  const loadPreview = (templateId: string) => {
    setPreviewLoading(true)
    authApi.inviteEmailPreview(inviteForm.email || 'colleague@example.com', inviteForm.role, templateId)
      .then(r => setPreviewHtml(r.data.html || ''))
      .catch(() => setPreviewHtml(''))
      .finally(() => setPreviewLoading(false))
  }

  // Re-fetch whenever the template (or email/role, which the template can reference)
  // changes while the preview tab is open — picking a different template alone
  // wouldn't otherwise trigger a reload, since that dropdown only fires on tab switch.
  useEffect(() => {
    if (!showEmailPreview) return
    loadPreview(inviteForm.email_template_id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEmailPreview, inviteForm.email_template_id, inviteForm.role, inviteForm.email])

  const isOwner = currentUser?.role === 'business_owner'

  return (
    <AppShell>
      <PageHeader
        title="Team Management"
        subtitle="Invite team members, grant portal access, and control what each person can see"
        action={isOwner && (
          <button className="btn btn-dark btn-sm" onClick={() => setShowInvite(true)}>
            <Plus size={12} /> Invite Member
          </button>
        )}
      />

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '2 1 560px', minWidth: 0 }}>
        <div className="card">
          <div className="card-hdr" style={{ justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Mail size={14} /> Team Members</span>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>{members.length} {members.length === 1 ? 'member' : 'members'}</span>
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
                        Access Pending
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Mail size={10} />{m.email}</span>
                    {m.phone && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={10} />{m.phone}</span>}
                  </div>
                </div>
                <span style={{
                  padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, flexShrink: 0,
                  background: isPending ? '#f0ede8' : ((ROLE_COLORS[m.role] || '#8c8279') + '18'),
                  color: isPending ? '#8c8279' : (ROLE_COLORS[m.role] || 'var(--muted)'),
                }}>
                  {ROLE_LABELS[m.role] || m.role}
                </span>
                {isOwner && m.id !== currentUser?.id && m.role !== 'business_owner' && (
                  <div style={{ display: 'flex', gap: 6, marginLeft: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => handleToggleAccess(m, isPending)}
                      disabled={accessBusyId === m.id}
                      title={isPending ? 'Grant access — lets them log in' : 'Revoke access — blocks login immediately'}
                      style={{
                        padding: '4px 10px', borderRadius: 5,
                        border: `1px solid ${isPending ? '#c9a84c' : '#e0dcd4'}`,
                        background: isPending ? '#fffbf0' : '#fff',
                        color: isPending ? '#856404' : 'var(--muted)',
                        fontSize: 10, fontWeight: 700,
                        letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer',
                      }}
                    >
                      {accessBusyId === m.id ? '…' : isPending ? 'Grant Access' : 'Revoke Access'}
                    </button>
                    <button
                      onClick={() => setPermsTarget(m)}
                      title="Choose exactly which sections this person can view, edit, or delete"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 5,
                        border: '1px solid #e0dcd4', background: '#fff', color: 'var(--muted)',
                        fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--ink)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
                    >
                      <ShieldCheck size={11} /> Permissions
                    </button>
                    <button
                      onClick={() => { setEditTarget(m); setEditForm({
                        role: m.role, phone: m.phone || '', address: m.address || '',
                        city: m.city || '', state: m.state || '', zip_code: m.zip_code || '',
                      }) }}
                      title="Edit role and contact details"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 5,
                        border: '1px solid #e0dcd4', background: '#fff', color: 'var(--muted)',
                        fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--ink)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
                    >
                      <Pencil size={11} /> Edit
                    </button>
                    <button
                      onClick={() => setDeleteTarget(m)}
                      title="Remove from workspace"
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                        padding: 6, color: 'var(--muted)', background: 'none', border: 'none', borderRadius: 'var(--radius-sm)',
                      }}
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
      </div>

        {/* Role legend */}
        <div style={{ flex: '1 1 280px', minWidth: 260, position: 'sticky', top: 16, padding: '14px 16px', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>Role Permissions</div>
          {[
            { role: 'business_owner', label: 'Business Owner', desc: 'Full access — clients, sessions, invoices, reports, billing, team invites.' },
            { role: 'coach',          label: 'Coach',          desc: 'Manage clients, schedule sessions, create invoices by default. No reports or billing.' },
            { role: 'assistant',      label: 'Assistant',      desc: 'Schedule sessions and view clients by default. No invoices or reports.' },
            { role: 'limited',        label: 'Limited',        desc: 'No access by default — the owner grants exactly what this person needs, section by section.' },
          ].map(r => (
            <div key={r.role} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
              <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, flexShrink: 0, alignSelf: 'flex-start', background: ROLE_COLORS[r.role] + '18', color: ROLE_COLORS[r.role] }}>
                {r.label}
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{r.desc}</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 5 }}>
            <ShieldCheck size={12} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Use the <strong style={{ color: 'var(--ink)' }}>Permissions</strong> button next to any member to override these defaults per section (view/edit/delete).</span>
          </div>
        </div>
      </div>

        {/* Edit Team Member Modal */}
        {editTarget && (
          <Modal
            title="Edit Team Member"
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
              Editing <strong style={{ color: 'var(--ink)' }}>{editTarget.full_name}</strong> ({editTarget.email})
            </p>
            <div className="fgroup">
              <label className="flabel">Role</label>
              <select className="fselect" value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}>
                <option value="coach">Coach</option>
                <option value="assistant">Assistant</option>
                <option value="limited">Limited</option>
              </select>
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', margin: '20px 0 10px' }}>Contact Details</div>
            <div className="fgroup">
              <label className="flabel">Phone Number</label>
              <input className="finput" type="tel" value={editForm.phone}
                onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 123-4567" />
            </div>
            <div className="fgroup">
              <label className="flabel">Street Address</label>
              <input className="finput" value={editForm.address}
                onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Main St" />
            </div>
            <div className="fgrid">
              <div className="fgroup">
                <label className="flabel">City</label>
                <input className="finput" value={editForm.city}
                  onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))} placeholder="New York" />
              </div>
              <div className="fgroup">
                <label className="flabel">State / Province</label>
                <input className="finput" value={editForm.state}
                  onChange={e => setEditForm(f => ({ ...f, state: e.target.value }))} placeholder="NY" />
              </div>
            </div>
            <div className="fgroup" style={{ maxWidth: 200 }}>
              <label className="flabel">ZIP / Postal Code</label>
              <input className="finput" value={editForm.zip_code}
                onChange={e => setEditForm(f => ({ ...f, zip_code: e.target.value }))} placeholder="10001" />
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

        {/* Permissions Matrix Modal */}
        {permsTarget && (
          <PermissionsModal member={permsTarget} onClose={() => setPermsTarget(null)} />
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
                <button key={t} onClick={() => setShowEmailPreview(t === 'email')}
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
                    <option value="coach">Coach</option>
                    <option value="assistant">Assistant</option>
                    <option value="limited">Limited</option>
                  </select>
                </div>
                {genericTemplates.length > 0 && teamInviteTemplates.length === 0 && (
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
                    No saved template is assigned to Team Invite yet — open Settings → Generic Templates,
                    edit (or create) one, and assign it to "Team Invite" to make it selectable here.
                  </div>
                )}
                {teamInviteTemplates.length > 0 && (
                  <div className="fgroup">
                    <label className="flabel">Email template</label>
                    <select className="fselect" value={inviteForm.email_template_id}
                      onChange={e => setInviteForm(f => ({ ...f, email_template_id: e.target.value }))}>
                      <option value="">Default (Settings → Generic Templates → Team Invite)</option>
                      {teamInviteTemplates.map((t: any) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--muted)' }}>
                  They will receive an email with a link to set their password — after that, you'll grant them
                  access (and choose exactly which sections they can see) from this Team page.
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
    </AppShell>
  )
}
