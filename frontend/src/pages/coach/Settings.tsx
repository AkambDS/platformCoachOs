import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, authApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { PageHeader, useToast } from '../../components/ui'
import { useAuthStore } from '../../store/auth'

export default function Settings() {
  const { user, workspace } = useAuthStore()
  const { show: showToast, el: toastEl } = useToast()
  const [tab, setTab] = useState('Workspace')
  const [form, setForm] = useState({ name: workspace?.name || '', timezone: workspace?.workspace_timezone || 'America/New_York', cancellation_hours: workspace?.cancellation_hours || 48, buffer_minutes: workspace?.buffer_minutes || 15 })
  const [saving, setSaving] = useState(false)

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.patch('/api/settings/workspace/', form)
      showToast('Settings saved')
    } catch { showToast('Failed to save', 'error') }
    finally { setSaving(false) }
  }

  const TABS = ['Workspace', 'Profile', 'Team']

  return (
    <AppShell>
      <PageHeader title="Settings" />

      <div style={{ background: 'var(--white)', borderBottom: '1px solid var(--border)', padding: '0 36px', display: 'flex' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '12px 18px', fontSize: 13, fontWeight: 500, background: 'none', border: 'none',
            color: tab === t ? 'var(--ink)' : 'var(--muted)',
            borderBottom: `2px solid ${tab === t ? 'var(--gold)' : 'transparent'}`,
            cursor: 'pointer',
          }}>{t}</button>
        ))}
      </div>

      <div className="page-body">
        {tab === 'Workspace' && (
          <div style={{ maxWidth: 600 }}>
            <div className="card">
              <div className="card-hdr">Workspace Settings</div>
              <div className="card-body">
                <div className="fgroup">
                  <label className="flabel">Workspace Name</label>
                  <input className="finput" value={form.name} onChange={e => set('name', e.target.value)} />
                </div>
                <div className="fgroup">
                  <label className="flabel">Timezone</label>
                  <select className="fselect" value={form.timezone} onChange={e => set('timezone', e.target.value)}>
                    {['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','Europe/Paris','Asia/Tokyo','Australia/Sydney'].map(tz => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                </div>
                <div className="fgrid">
                  <div className="fgroup">
                    <label className="flabel">Cancellation Window (hours)</label>
                    <input className="finput" type="number" value={form.cancellation_hours} onChange={e => set('cancellation_hours', Number(e.target.value))} />
                  </div>
                  <div className="fgroup">
                    <label className="flabel">Session Buffer (minutes)</label>
                    <input className="finput" type="number" value={form.buffer_minutes} onChange={e => set('buffer_minutes', Number(e.target.value))} />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="btn btn-dark" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'Profile' && (
          <div style={{ maxWidth: 600 }}>
            <div className="card">
              <div className="card-hdr">Your Profile</div>
              <div className="card-body">
                <div className="kv"><span className="kvl">Name</span><span className="kvv">{user?.full_name}</span></div>
                <div className="kv"><span className="kvl">Email</span><span className="kvv">{user?.email}</span></div>
                <div className="kv"><span className="kvl">Role</span><span className="kvv" style={{ textTransform: 'capitalize' }}>{user?.role?.replace('_', ' ')}</span></div>
              </div>
            </div>
          </div>
        )}

        {tab === 'Team' && (
          <div style={{ maxWidth: 600 }}>
            <div className="card">
              <div className="card-hdr" style={{ justifyContent: 'space-between' }}>
                <span>Team Members</span>
                <button className="btn btn-dark btn-sm">Invite Member</button>
              </div>
              <div className="card-body">
                <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: 20 }}>
                  Team management coming soon. Use the invite API to add coaches and assistants.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {toastEl}
    </AppShell>
  )
}
