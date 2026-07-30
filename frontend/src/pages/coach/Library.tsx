import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { libraryApi, authApi, clientsApi } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import AppShell from '../../components/layout/AppShell'
import { PageHeader, Modal, useToast } from '../../components/ui'
import { EDITABLE_OFFICE_EXTS, InlineOfficeViewer, OfficeEditorModal } from '../../components/OfficeEditor'
import { Folder, FolderOpen, FileText, Film, Link as LinkIcon, File, Upload, Plus, Trash2, Search, Download, ChevronRight, Pencil, FileSpreadsheet, FileImage, X, RotateCcw, PencilLine } from 'lucide-react'

const VISIBILITY_LABELS: Record<string, string> = {
  private:        'Just Me',
  owner_only:     'Owner Only',
  internal:       'All Coaches',
  client_visible: 'Client Visible',
}
const VISIBILITY_COLORS: Record<string, string> = {
  private:        '#7c4d9f',
  owner_only:     '#b91c1c',
  internal:       '#2d6a9f',
  client_visible: '#4a7c59',
}

const OWNER_VISIBILITY_OPTIONS = [
  { value: 'owner_only',     label: 'Owner only',         desc: 'Only you can see this file' },
  { value: 'internal',       label: 'All coaches',        desc: 'All coaches and assistants in your workspace' },
  { value: 'client_visible', label: 'All clients',        desc: 'All clients can view this in their portal' },
  { value: 'specific',       label: 'Specific people',    desc: 'Choose individual clients and/or coaches' },
]
const COACH_VISIBILITY_OPTIONS = [
  { value: 'private',        label: 'Just me',            desc: 'Only you and the owner can see this' },
  { value: 'internal',       label: 'All coaches',        desc: 'All coaches and assistants in your workspace' },
  { value: 'client_visible', label: 'All clients',        desc: 'All clients can view this in their portal' },
  { value: 'specific',       label: 'Specific people',    desc: 'Choose individual clients and/or coaches' },
]

function FolderTree({ folders, selected, onSelect }: {
  folders: any[]; selected: string | null; onSelect: (id: string | null) => void
}) {
  return (
    <>
      <div
        onClick={() => onSelect(null)}
        style={{
          padding: '7px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 13,
          fontWeight: selected === null ? 600 : 400,
          background: selected === null ? 'var(--gold-faint, #faf6ed)' : 'transparent',
          color: selected === null ? 'var(--gold)' : 'var(--ink)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        <Folder size={14} /> All Files
      </div>
      <div
        onClick={() => onSelect('root')}
        style={{
          padding: '7px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 13,
          fontWeight: selected === 'root' ? 600 : 400,
          background: selected === 'root' ? 'var(--gold-faint, #faf6ed)' : 'transparent',
          color: selected === 'root' ? 'var(--gold)' : 'var(--ink)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        <Folder size={14} /> Unfiled
      </div>
      {folders.map(f => (
        <FolderNode key={f.id} folder={f} selected={selected} onSelect={onSelect} depth={0} />
      ))}
    </>
  )
}

function FolderNode({ folder, selected, onSelect, depth }: any) {
  const [open, setOpen] = useState(false)
  const hasChildren = folder.children?.length > 0
  const isSelected = selected === folder.id
  return (
    <div>
      <div
        style={{
          padding: `7px 12px 7px ${12 + depth * 16}px`,
          borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 13,
          fontWeight: isSelected ? 600 : 400,
          background: isSelected ? 'var(--gold-faint, #faf6ed)' : 'transparent',
          color: isSelected ? 'var(--gold)' : 'var(--ink)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}
        onClick={() => { onSelect(folder.id); if (hasChildren) setOpen(o => !o) }}
      >
        {hasChildren && (
          <ChevronRight size={12} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: '.15s' }} />
        )}
        {isSelected ? <FolderOpen size={14} /> : <Folder size={14} />}
        {folder.name}
      </div>
      {open && hasChildren && folder.children.map((c: any) => (
        <FolderNode key={c.id} folder={c} selected={selected} onSelect={onSelect} depth={depth + 1} />
      ))}
    </div>
  )
}

// ── Specific people selector ──────────────────────────────────────────────────
function SpecificPeopleSelector({
  selectedClientIds, selectedUserIds, onChangeClients, onChangeUsers,
}: {
  selectedClientIds: string[]; selectedUserIds: string[]
  onChangeClients: (ids: string[]) => void; onChangeUsers: (ids: string[]) => void
}) {
  const { data: clientsData } = useQuery({ queryKey: ['clients-all'], queryFn: () => clientsApi.list({ page_size: 200 }).then(r => r.data?.results ?? r.data ?? []) })
  const { data: teamData }    = useQuery({ queryKey: ['team'],         queryFn: () => authApi.team().then(r => r.data?.results ?? r.data ?? []) })

  const clients: any[] = Array.isArray(clientsData) ? clientsData : (clientsData?.results ?? [])
  const team: any[]    = Array.isArray(teamData)    ? teamData    : (teamData?.results ?? [])

  function toggle(id: string, list: string[], onChange: (ids: string[]) => void) {
    onChange(list.includes(id) ? list.filter(x => x !== id) : [...list, id])
  }

  const pill = (label: string, onRemove: () => void) => (
    <span key={label} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px 2px 10px',
      background: 'var(--ink)', color: '#fff', borderRadius: 20, fontSize: 11, fontWeight: 500,
    }}>
      {label}
      <button onClick={onRemove} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: 13 }}>×</button>
    </span>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 4 }}>
      {/* Clients */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>Clients</div>
        <select
          className="fselect"
          style={{ margin: 0 }}
          value=""
          onChange={e => { if (e.target.value) toggle(e.target.value, selectedClientIds, onChangeClients) }}
        >
          <option value="">— add a client —</option>
          {clients.filter((c: any) => !selectedClientIds.includes(c.id)).map((c: any) => (
            <option key={c.id} value={c.id}>{c.first_name} {c.last_name} {c.email ? `(${c.email})` : ''}</option>
          ))}
        </select>
        {selectedClientIds.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {selectedClientIds.map(id => {
              const c = clients.find((x: any) => x.id === id)
              return c ? pill(`${c.first_name} ${c.last_name}`, () => toggle(id, selectedClientIds, onChangeClients)) : null
            })}
          </div>
        )}
      </div>

      {/* Coaches / team */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>Coaches / Team</div>
        <select
          className="fselect"
          style={{ margin: 0 }}
          value=""
          onChange={e => { if (e.target.value) toggle(e.target.value, selectedUserIds, onChangeUsers) }}
        >
          <option value="">— add a coach —</option>
          {team.filter((u: any) => !selectedUserIds.includes(u.id)).map((u: any) => (
            <option key={u.id} value={u.id}>{u.full_name || u.email} ({u.role})</option>
          ))}
        </select>
        {selectedUserIds.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {selectedUserIds.map(id => {
              const u = team.find((x: any) => x.id === id)
              return u ? pill(u.full_name || u.email, () => toggle(id, selectedUserIds, onChangeUsers)) : null
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function EditAccessModal({ item, currentUser, onClose, onSaved }: any) {
  const { show } = useToast()
  const isOwner = (currentUser as any)?.role === 'business_owner'
  const isUploader = item.uploaded_by === (currentUser as any)?.id
  const canEdit = isOwner || isUploader
  const visibilityOptions = isOwner ? OWNER_VISIBILITY_OPTIONS : COACH_VISIBILITY_OPTIONS
  const [visibility, setVisibility] = useState(item.visibility)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await libraryApi.updateItem(item.id, { visibility })
      onSaved()
      show('Access updated')
    } catch { show('Failed to update access', 'error') }
    finally { setSaving(false) }
  }

  return (
    <Modal title="Edit File Access" onClose={onClose} footer={
      <>
        <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-dark btn-sm" onClick={handleSave} disabled={saving || !canEdit}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </>
    }>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{item.title}</div>
        {item.uploaded_by_name && (
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Uploaded by {item.uploaded_by_name}</div>
        )}
      </div>
      {!canEdit ? (
        <div style={{ padding: '12px 14px', background: 'var(--paper)', borderRadius: 6, fontSize: 13, color: 'var(--muted)' }}>
          Only the uploader or workspace owner can change access rights.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>
            Who can access this file?
          </div>
          {visibilityOptions.map((opt: any) => (
            <label key={opt.value} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer',
              padding: '12px 14px', borderRadius: 6,
              border: `1px solid ${visibility === opt.value ? 'var(--ink)' : 'var(--border)'}`,
              background: visibility === opt.value ? 'var(--paper)' : 'var(--white)',
            }}>
              <input type="radio" name="edit_visibility" value={opt.value}
                checked={visibility === opt.value}
                onChange={() => setVisibility(opt.value)}
                style={{ marginTop: 2, accentColor: 'var(--ink)', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
      )}
    </Modal>
  )
}

function EditItemModal({ item, folders, onClose, onSaved }: any) {
  const { show } = useToast()
  const { user } = useAuthStore()
  const isOwner = (user as any)?.role === 'business_owner'
  const isUploader = item.uploaded_by === (user as any)?.id
  const canEdit = isOwner || isUploader
  const visibilityOptions = isOwner ? OWNER_VISIBILITY_OPTIONS : COACH_VISIBILITY_OPTIONS

  const [form, setForm] = useState({
    title:             item.title || '',
    description:       item.description || '',
    video_url:         item.video_url || '',
    visibility:        item.visibility || 'internal',
  })
  const [sharedClientIds, setSharedClientIds] = useState<string[]>(item.shared_client_ids || [])
  const [sharedUserIds,   setSharedUserIds]   = useState<string[]>(item.shared_user_ids   || [])
  const [replaceFile, setReplaceFile] = useState<File | null>(null)
  const [saving, setSaving]   = useState(false)
  const [replacing, setReplacing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const allFolders: any[] = []
  const flattenFolders = (fs: any[], depth = 0) => {
    fs.forEach(f => { allFolders.push({ ...f, depth }); if (f.children?.length) flattenFolders(f.children, depth + 1) })
  }
  flattenFolders(folders || [])

  const handleSave = async () => {
    if (!canEdit) return
    setSaving(true)
    try {
      await libraryApi.updateItem(item.id, {
        ...form,
        shared_client_ids: form.visibility === 'specific' ? sharedClientIds : [],
        shared_user_ids:   form.visibility === 'specific' ? sharedUserIds   : [],
      })
      onSaved()
      show('File updated')
    } catch { show('Failed to update', 'error') }
    finally { setSaving(false) }
  }

  const handleReplaceFile = async () => {
    if (!replaceFile) return
    setReplacing(true)
    try {
      const fd = new FormData()
      fd.append('file', replaceFile)
      await libraryApi.replaceFile(item.id, fd)
      onSaved()
      show(`File replaced — now version ${item.version + 1}`)
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Replace failed', 'error')
    } finally { setReplacing(false) }
  }

  return (
    <Modal title="Edit File" onClose={onClose} footer={
      <>
        <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-dark btn-sm" onClick={handleSave} disabled={saving || !canEdit}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </>
    }>
      {!canEdit && (
        <div style={{ padding: '10px 14px', background: 'var(--paper)', borderRadius: 6, fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
          Only the uploader or workspace owner can edit this file.
        </div>
      )}
      <div className="fgroup">
        <label className="flabel">Title *</label>
        <input className="finput" value={form.title} onChange={e => set('title', e.target.value)} disabled={!canEdit} />
      </div>
      <div className="fgroup">
        <label className="flabel">Description</label>
        <textarea className="ftextarea" rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional…" disabled={!canEdit} />
      </div>
      <div className="fgroup">
        <label className="flabel">Video link <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
        <input className="finput" type="url" value={form.video_url} onChange={e => set('video_url', e.target.value)} placeholder="https://youtube.com/watch?v=…" disabled={!canEdit} />
      </div>
      <div className="fgroup">
        <label className="flabel">Who can access</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {visibilityOptions.map((opt: any) => (
            <label key={opt.value} style={{
              display: 'flex', flexDirection: 'column', gap: 4, cursor: canEdit ? 'pointer' : 'default',
              padding: '10px 12px', borderRadius: 6,
              border: `1px solid ${form.visibility === opt.value ? 'var(--ink)' : 'var(--border)'}`,
              background: form.visibility === opt.value ? 'var(--paper)' : 'var(--white)',
              opacity: canEdit ? 1 : 0.6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="radio" name="edit_vis" value={opt.value} checked={form.visibility === opt.value}
                  onChange={() => canEdit && set('visibility', opt.value)}
                  style={{ accentColor: 'var(--ink)', flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{opt.label}</span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4, paddingLeft: 18 }}>{opt.desc}</span>
            </label>
          ))}
        </div>
      </div>
      {form.visibility === 'specific' && canEdit && (
        <div className="fgroup">
          <SpecificPeopleSelector
            selectedClientIds={sharedClientIds}
            selectedUserIds={sharedUserIds}
            onChangeClients={setSharedClientIds}
            onChangeUsers={setSharedUserIds}
          />
        </div>
      )}
      {canEdit && item.s3_key && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
            Replace File <span style={{ fontWeight: 400, fontSize: 11 }}>— current: v{item.version} · {item.file_name}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => setReplaceFile(e.target.files?.[0] || null)} />
            <button className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>
              {replaceFile ? replaceFile.name : 'Choose new file'}
            </button>
            {replaceFile && (
              <button className="btn btn-dark btn-sm" onClick={handleReplaceFile} disabled={replacing}>
                {replacing ? 'Replacing…' : `Upload as v${item.version + 1}`}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}


function UploadModal({ folders, onClose, onUploaded }: any) {
  const { show } = useToast()
  const { user } = useAuthStore()
  const isOwner = (user as any)?.role === 'business_owner'
  const visibilityOptions = isOwner ? OWNER_VISIBILITY_OPTIONS : COACH_VISIBILITY_OPTIONS
  const defaultVisibility = isOwner ? 'internal' : 'internal'

  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [form, setForm] = useState({ title: '', description: '', visibility: defaultVisibility, folder: '', video_url: '' })
  const [sharedClientIds, setSharedClientIds] = useState<string[]>([])
  const [sharedUserIds,   setSharedUserIds]   = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const pickFile = (f: File) => {
    setFile(f)
    if (!form.title) setForm(prev => ({ ...prev, title: f.name.replace(/\.[^.]+$/, '') }))
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) pickFile(f)
  }

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('title', form.title || file.name)
      fd.append('description', form.description)
      fd.append('visibility', form.visibility)
      if (form.folder) fd.append('folder', form.folder)
      if (form.video_url) fd.append('video_url', form.video_url)
      if (form.visibility === 'specific') {
        fd.append('shared_client_ids', JSON.stringify(sharedClientIds))
        fd.append('shared_user_ids',   JSON.stringify(sharedUserIds))
      }
      await libraryApi.upload(fd)
      onUploaded()
      show('File uploaded')
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Upload failed', 'error')
    } finally { setUploading(false) }
  }

  const allFolders: any[] = []
  const flattenFolders = (fs: any[], depth = 0) => {
    fs.forEach(f => {
      allFolders.push({ ...f, depth })
      if (f.children?.length) flattenFolders(f.children, depth + 1)
    })
  }
  flattenFolders(folders)

  return (
    <Modal title="Upload File" onClose={onClose} footer={
      <>
        <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-dark btn-sm" onClick={handleUpload} disabled={!file || uploading}>
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </>
    }>
      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--gold)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-sm)', padding: '28px 20px', textAlign: 'center',
          cursor: 'pointer', marginBottom: 16, background: dragOver ? 'var(--gold-faint, #faf6ed)' : 'var(--paper)',
          transition: '.15s',
        }}
      >
        <Upload size={24} color={dragOver ? 'var(--gold)' : 'var(--muted)'} style={{ margin: '0 auto 8px' }} />
        {file
          ? <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{file.name}</div>
          : <div style={{ fontSize: 13, color: 'var(--muted)' }}>Drag & drop or <strong style={{ color: 'var(--gold)' }}>click to browse</strong></div>
        }
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>PDF, Word, video, images — up to 100 MB</div>
        <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f) }} />
      </div>

      <div className="fgroup">
        <label className="flabel">Title *</label>
        <input className="finput" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Week 1 Nutrition Guide" />
      </div>
      <div className="fgroup">
        <label className="flabel">Description</label>
        <textarea className="ftextarea" rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional description…" />
      </div>
      <div className="fgroup">
        <label className="flabel">Video link <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
        <input className="finput" type="url" value={form.video_url} onChange={e => set('video_url', e.target.value)} placeholder="https://youtube.com/watch?v=…" />
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>Attach a video alongside the file, or use instead of a file.</div>
      </div>
      <div className="fgroup">
        <label className="flabel">Folder</label>
        <select className="fselect" value={form.folder} onChange={e => set('folder', e.target.value)}>
          <option value="">No folder</option>
          {allFolders.map(f => (
            <option key={f.id} value={f.id}>{' '.repeat(f.depth * 2)}{f.name}</option>
          ))}
        </select>
      </div>
      <div className="fgroup">
        <label className="flabel">Who can access this file?</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {visibilityOptions.map((opt: any) => (
            <label key={opt.value} style={{
              display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer',
              padding: '10px 12px', borderRadius: 6,
              border: `1px solid ${form.visibility === opt.value ? 'var(--ink)' : 'var(--border)'}`,
              background: form.visibility === opt.value ? 'var(--paper)' : 'var(--white)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="radio" name="visibility" value={opt.value}
                  checked={form.visibility === opt.value}
                  onChange={() => set('visibility', opt.value)}
                  style={{ accentColor: 'var(--ink)', flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{opt.label}</span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4, paddingLeft: 18 }}>{opt.desc}</span>
            </label>
          ))}
        </div>
        {form.visibility === 'specific' && (
          <SpecificPeopleSelector
            selectedClientIds={sharedClientIds}
            selectedUserIds={sharedUserIds}
            onChangeClients={setSharedClientIds}
            onChangeUsers={setSharedUserIds}
          />
        )}
      </div>
    </Modal>
  )
}

// ── File type helpers ─────────────────────────────────────────────────────────
function getFileIcon(item: any, size = 18) {
  const ext = (item.file_name || '').split('.').pop()?.toLowerCase() || ''
  if (['xls', 'xlsx', 'csv'].includes(ext))       return <FileSpreadsheet size={size} color="#1a7a3f" />
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return <FileText size={size} color="#2b5fad" />
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return <FileImage size={size} color="#c9a84c" />
  if (item.content_type === 'pdf')   return <FileText size={size} color="#c0392b" />
  if (item.content_type === 'video') return <Film size={size} color="#7c4d9f" />
  if (item.content_type === 'link')  return <LinkIcon size={size} color="#2d6a9f" />
  return <File size={size} color="#8c8279" />
}

function getFileBg(item: any) {
  const ext = (item.file_name || '').split('.').pop()?.toLowerCase() || ''
  if (['xls', 'xlsx', 'csv'].includes(ext))        return '#e8f5ec'
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return '#e8eef7'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return '#faf3e0'
  if (item.content_type === 'pdf')   return '#fdecea'
  if (item.content_type === 'video') return '#f3eafa'
  return '#f0eeec'
}

// ── Preview panel ─────────────────────────────────────────────────────────────
function SavePdfModal({ folders, currentFolder, onClose, onConvert }: {
  folders: any[]; currentFolder: string | null; onClose: () => void
  onConvert: (folder: string) => Promise<void>
}) {
  const [folder, setFolder] = useState(currentFolder || '')
  const [saving, setSaving] = useState(false)
  const allFolders: any[] = []
  const flatten = (fs: any[], depth = 0) => {
    fs.forEach(f => { allFolders.push({ ...f, depth }); if (f.children?.length) flatten(f.children, depth + 1) })
  }
  flatten(folders || [])

  return (
    <Modal title="Save as PDF" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-outline btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn btn-dark btn-sm" disabled={saving} onClick={async () => { setSaving(true); await onConvert(folder || 'root') }}>
          {saving ? 'Converting…' : 'Save PDF'}
        </button>
      </>
    }>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
        Creates a new PDF file alongside the original — the original file is not changed.
      </div>
      <div className="fgroup">
        <label className="flabel">Save into folder</label>
        <select className="fselect" value={folder} onChange={e => setFolder(e.target.value)}>
          <option value="root">No folder</option>
          {allFolders.map(f => (
            <option key={f.id} value={f.id}>{' '.repeat(f.depth * 2)}{f.name}</option>
          ))}
        </select>
      </div>
    </Modal>
  )
}

function FilePreviewPanel({ item, currentUser, folders, onClose, onEdit, onDelete, onReplaced, onEditInBrowser, onConverted }: {
  item: any; currentUser: any; folders: any[]; onClose: () => void; onEdit: () => void
  onDelete: () => void; onReplaced: () => void; onEditInBrowser: () => void; onConverted: (item: any) => void
}) {
  const { show } = useToast()
  const [replacing, setReplacing] = useState(false)
  const [showSavePdf, setShowSavePdf] = useState(false)
  const replaceRef = useRef<HTMLInputElement>(null)
  const ext = (item.file_name || '').split('.').pop()?.toLowerCase() || ''
  const isImage  = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)
  const isPdf    = item.content_type === 'pdf' || ext === 'pdf'
  const isVideo  = item.content_type === 'video'
  const isOffice = ['xls', 'xlsx', 'csv', 'doc', 'docx', 'odt', 'rtf', 'ppt', 'pptx'].includes(ext)
  const isEditableOffice = EDITABLE_OFFICE_EXTS.includes(ext)
  const hasFile  = !!item.presigned_url
  const isOwner    = currentUser?.role === 'business_owner'
  const isUploader = item.uploaded_by === currentUser?.id
  const canEdit    = isOwner || isUploader

  const handleReplaceFile = async (file: File) => {
    setReplacing(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      await libraryApi.replaceFile(item.id, fd)
      show(`Replaced — now v${item.version + 1}`)
      onReplaced()
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Replace failed', 'error')
    } finally { setReplacing(false) }
  }

  const handleConvertToPdf = async (folder: string) => {
    try {
      const res = await libraryApi.convertToPdf(item.id, folder)
      show('Saved as PDF')
      setShowSavePdf(false)
      onConverted(res.data)
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Conversion failed', 'error')
      setShowSavePdf(false)
    }
  }

  return (
    <div style={{
      width: '100%', display: 'flex', flexDirection: 'column',
      background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      overflow: 'hidden', position: 'sticky', top: 80, maxHeight: 'calc(100vh - 120px)',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ background: getFileBg(item), borderRadius: 8, padding: 8, display: 'flex' }}>
          {getFileIcon(item, 20)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
          {item.file_name && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{item.file_name}</div>}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}>
          <X size={16} />
        </button>
      </div>

      {/* Preview area */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {hasFile && isPdf && item.inline_url && (
          <iframe src={item.inline_url} style={{ width: '100%', height: 'max(600px, calc(100vh - 340px))', border: 'none', display: 'block' }} title={item.title} />
        )}
        {hasFile && isImage && item.inline_url && (
          <img src={item.inline_url} alt={item.title} style={{ width: '100%', maxHeight: 'max(500px, calc(100vh - 380px))', objectFit: 'contain', display: 'block', background: '#f8f8f8' }} />
        )}
        {hasFile && isVideo && item.inline_url && (
          <video src={item.inline_url} controls style={{ width: '100%', maxHeight: 'max(420px, calc(100vh - 380px))', display: 'block', background: '#000' }} />
        )}
        {item.video_url && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>Video Link</div>
            <a href={item.video_url} target="_blank" rel="noopener noreferrer" className="btn btn-dark btn-sm" style={{ width: '100%', justifyContent: 'center' }}>
              ▶ Watch Video
            </a>
          </div>
        )}
        {hasFile && isOffice && (
          <InlineOfficeViewer
            itemKey={`${item.id}-${item.version}`}
            getEditConfig={(mode) => libraryApi.editConfig(item.id, mode).then(r => r.data)}
          />
        )}
        {item.url && item.content_type === 'link' && (
          <div style={{ padding: '12px 16px' }}>
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm" style={{ width: '100%', justifyContent: 'center' }}>
              Open Link
            </a>
          </div>
        )}

        {/* Meta */}
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { label: 'Version',    value: `v${item.version}${item.version > 1 ? ` (${item.version} revisions)` : ''}` },
            { label: 'Views',      value: `${item.view_count}` },
            { label: 'Access',     value: VISIBILITY_LABELS[item.visibility] || item.visibility },
            { label: 'Uploaded',   value: new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) },
            item.uploaded_by_name ? { label: 'By', value: item.uploaded_by_name } : null,
          ].filter(Boolean).map((row: any) => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: 'var(--muted)' }}>{row.label}</span>
              <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{row.value}</span>
            </div>
          ))}
          {item.description && (
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              {item.description}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {hasFile && isEditableOffice && canEdit && (
          <button onClick={onEditInBrowser} className="btn btn-dark btn-sm" style={{ width: '100%', justifyContent: 'center', gap: 6, background: 'var(--gold)', borderColor: 'var(--gold)' }}>
            <PencilLine size={13} /> Edit live in browser
          </button>
        )}
        {hasFile && (
          <button onClick={() => window.open(item.presigned_url, '_blank')} className="btn btn-dark btn-sm" style={{ width: '100%', justifyContent: 'center', gap: 6 }}>
            <Download size={13} /> Download
          </button>
        )}
        {hasFile && (
          <>
            <input ref={replaceRef} type="file" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleReplaceFile(f) }} />
            <button onClick={() => replaceRef.current?.click()} disabled={replacing} className="btn btn-outline btn-sm" style={{ width: '100%', justifyContent: 'center', gap: 6 }}>
              <RotateCcw size={13} /> {replacing ? 'Replacing…' : 'Replace file (edit & re-upload)'}
            </button>
          </>
        )}
        {hasFile && !isPdf && isOffice && (
          <button onClick={() => setShowSavePdf(true)} className="btn btn-outline btn-sm" style={{ width: '100%', justifyContent: 'center', gap: 6 }}>
            <Download size={13} /> Save as PDF…
          </button>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onEdit} className="btn btn-outline btn-sm" style={{ flex: 1, justifyContent: 'center', gap: 5 }}>
            <Pencil size={12} /> Edit
          </button>
          <button onClick={onDelete} className="btn btn-outline btn-sm" style={{ flex: 1, justifyContent: 'center', gap: 5, color: '#c0392b', borderColor: '#f5c6c2' }}>
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </div>

      {showSavePdf && (
        <SavePdfModal
          folders={folders}
          currentFolder={item.folder || null}
          onClose={() => setShowSavePdf(false)}
          onConvert={handleConvertToPdf}
        />
      )}
    </div>
  )
}

function EmptyPreviewState() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 10, minHeight: 480, border: '1px dashed var(--border)', borderRadius: 'var(--radius)',
      background: '#fff', color: 'var(--muted)',
    }}>
      <FileText size={28} color="var(--muted)" />
      <div style={{ fontSize: 13 }}>Select a file to preview</div>
    </div>
  )
}

function NewFolderModal({ onClose, onCreated }: any) {
  const { show } = useToast()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const handleCreate = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await libraryApi.createFolder({ name })
      onCreated()
      show('Folder created')
    } catch { show('Failed to create folder', 'error') }
    finally { setSaving(false) }
  }

  return (
    <Modal title="New Folder" onClose={onClose} footer={
      <>
        <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-dark btn-sm" onClick={handleCreate} disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
      </>
    }>
      <div className="fgroup">
        <label className="flabel">Folder Name *</label>
        <input className="finput" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Nutrition Plans" autoFocus
          onKeyDown={e => e.key === 'Enter' && handleCreate()} />
      </div>
    </Modal>
  )
}

export default function Library() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const { show, el: toastEl } = useToast()
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [editAccessTarget, setEditAccessTarget] = useState<any>(null)
  const [editTarget, setEditTarget] = useState<any>(null)
  const [previewItem, setPreviewItem] = useState<any>(null)
  const [editingItem, setEditingItem] = useState<any>(null)

  const { data: foldersData = [] } = useQuery({
    queryKey: ['library-folders'],
    queryFn: () => libraryApi.folders().then(r => r.data?.results ?? r.data),
  })
  const folders: any[] = foldersData as any[]

  const params: any = {}
  if (search) params.q = search
  if (selectedFolder === 'root') params.folder = 'root'
  else if (selectedFolder) params.folder = selectedFolder

  const { data: itemsData = [], isLoading } = useQuery({
    queryKey: ['library-items', selectedFolder, search],
    queryFn: () => libraryApi.items(params).then(r => r.data?.results ?? r.data),
  })
  const items: any[] = itemsData as any[]

  const handleDeleteItem = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"?`)) return
    try {
      await libraryApi.deleteItem(id)
      qc.invalidateQueries({ queryKey: ['library-items'] })
      show('Deleted')
    } catch { show('Failed to delete', 'error') }
  }

  const folderLabel = selectedFolder === null
    ? 'All Files'
    : selectedFolder === 'root'
      ? 'Unfiled'
      : (() => {
          const find = (fs: any[]): string => {
            for (const f of fs) {
              if (f.id === selectedFolder) return f.name
              if (f.children?.length) { const r = find(f.children); if (r) return r }
            }
            return ''
          }
          return find(folders)
        })()

  return (
    <AppShell>
      <PageHeader
        title="Library"
        subtitle="Coaching materials, resources and files"
        action={
          <button className="btn btn-dark" onClick={() => setShowUpload(true)}>
            <Upload size={15} /> Upload File
          </button>
        }
      />

      <div style={{ display: 'flex', padding: '0 28px 36px', gap: 20, alignItems: 'flex-start' }}>

        {/* Explorer column: folders + file list */}
        <div style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Folders */}
          <div className="card" style={{ padding: '10px 8px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                          color: 'var(--muted)', padding: '4px 12px 8px' }}>Folders</div>
            <FolderTree folders={folders} selected={selectedFolder} onSelect={setSelectedFolder} />
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowNewFolder(true)}
                style={{ width: '100%', justifyContent: 'flex-start', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
                <Plus size={13} /> New folder
              </button>
            </div>
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
              <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
              <input className="finput" style={{ paddingLeft: 30, width: '100%', height: 32, fontSize: 12 }}
                placeholder="Search files…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => setShowUpload(true)} style={{ gap: 5, fontSize: 12, flexShrink: 0 }}>
              <Upload size={13} /> Upload
            </button>
          </div>

          {/* File list */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
              {folderLabel}
              {items.length > 0 && <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 6 }}>· {items.length} item{items.length !== 1 ? 's' : ''}</span>}
            </div>

            {isLoading ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
            ) : items.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <Upload size={26} color="var(--muted)" style={{ margin: '0 auto 10px' }} />
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {search ? 'No files match your search' : 'No files yet'}
                </div>
                {!search && (
                  <button className="btn btn-dark btn-sm" style={{ marginTop: 14 }} onClick={() => setShowUpload(true)}>
                    <Upload size={13} /> Upload File
                  </button>
                )}
              </div>
            ) : (
              <div style={{ maxHeight: 'calc(100vh - 420px)', minHeight: 160, overflowY: 'auto' }}>
                {items.map((item: any) => {
                  const isSelected = previewItem?.id === item.id
                  const ext = (item.file_name || '').split('.').pop()?.toLowerCase() || ''
                  const typeLabel = ['xlsx','xls','csv'].includes(ext) ? 'Spreadsheet'
                    : ['docx','doc','rtf','odt'].includes(ext) ? 'Document'
                    : ['jpg','jpeg','png','gif','webp'].includes(ext) ? 'Image'
                    : item.content_type ? item.content_type.charAt(0).toUpperCase() + item.content_type.slice(1)
                    : 'File'
                  return (
                    <div key={item.id}
                      onClick={() => setPreviewItem(isSelected ? null : item)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                        cursor: 'pointer', borderBottom: '1px solid var(--border)',
                        background: isSelected ? 'var(--gold-faint, #faf6ed)' : undefined,
                        transition: 'background .1s',
                      }}>
                      <div style={{ background: getFileBg(item), borderRadius: 6, padding: 5, display: 'inline-flex', flexShrink: 0 }}>
                        {getFileIcon(item, 15)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: 12.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.title}
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                          <span style={{ whiteSpace: 'nowrap' }}>{typeLabel}</span>
                          <span>·</span>
                          <span style={{ whiteSpace: 'nowrap' }}>{new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</span>
                          <span
                            style={{
                              fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase',
                              color: VISIBILITY_COLORS[item.visibility] || '#8c8279',
                              background: `${VISIBILITY_COLORS[item.visibility] || '#8c8279'}18`,
                              padding: '1px 6px', borderRadius: 20, whiteSpace: 'nowrap',
                            }}>
                            {VISIBILITY_LABELS[item.visibility] || item.visibility}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                        {(item.presigned_url || item.url) && (
                          <button onClick={() => window.open(item.presigned_url || item.url, '_blank')}
                            className="btn btn-ghost btn-sm" style={{ padding: '4px 6px' }} title="Download / Open">
                            <Download size={12} />
                          </button>
                        )}
                        <button onClick={() => handleDeleteItem(item.id, item.title)}
                          className="btn btn-ghost btn-sm" style={{ padding: '4px 6px', color: '#c0392b' }} title="Delete">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Preview panel — wide, so files can be read/edited comfortably */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {previewItem ? (
            <FilePreviewPanel
              item={previewItem}
              currentUser={user}
              folders={folders}
              onClose={() => setPreviewItem(null)}
              onEdit={() => setEditTarget(previewItem)}
              onDelete={() => { handleDeleteItem(previewItem.id, previewItem.title); setPreviewItem(null) }}
              onReplaced={() => { qc.invalidateQueries({ queryKey: ['library-items'] }); setPreviewItem(null) }}
              onEditInBrowser={() => setEditingItem(previewItem)}
              onConverted={(newItem) => { qc.invalidateQueries({ queryKey: ['library-items'] }); setPreviewItem(newItem) }}
            />
          ) : (
            <EmptyPreviewState />
          )}
        </div>
      </div>

      {editingItem && (
        <OfficeEditorModal
          title={editingItem.title}
          getEditConfig={(mode) => libraryApi.editConfig(editingItem.id, mode).then(r => r.data)}
          onClose={() => setEditingItem(null)}
          onSaved={async () => {
            qc.invalidateQueries({ queryKey: ['library-items'] })
            try {
              const res = await libraryApi.getItem(editingItem.id)
              setPreviewItem(res.data)
            } catch { /* keep stale preview if refetch fails */ }
          }}
        />
      )}

      {showUpload && (
        <UploadModal
          folders={folders}
          onClose={() => setShowUpload(false)}
          onUploaded={() => { setShowUpload(false); qc.invalidateQueries({ queryKey: ['library-items'] }) }}
        />
      )}
      {showNewFolder && (
        <NewFolderModal
          onClose={() => setShowNewFolder(false)}
          onCreated={() => { setShowNewFolder(false); qc.invalidateQueries({ queryKey: ['library-folders'] }) }}
        />
      )}
      {editAccessTarget && (
        <EditAccessModal
          item={editAccessTarget}
          currentUser={user}
          onClose={() => setEditAccessTarget(null)}
          onSaved={() => { setEditAccessTarget(null); qc.invalidateQueries({ queryKey: ['library-items'] }) }}
        />
      )}
      {editTarget && (
        <EditItemModal
          item={editTarget}
          folders={folders}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); qc.invalidateQueries({ queryKey: ['library-items'] }) }}
        />
      )}
      {toastEl}
    </AppShell>
  )
}
