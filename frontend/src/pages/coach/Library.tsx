import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { libraryApi } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import AppShell from '../../components/layout/AppShell'
import { PageHeader, Modal, useToast } from '../../components/ui'
import { Folder, FolderOpen, FileText, Film, Link as LinkIcon, File, Upload, Plus, Trash2, Search, Eye, Download, ChevronRight } from 'lucide-react'

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
  { value: 'owner_only',     label: 'Owner only',       desc: 'Only you can see this file' },
  { value: 'internal',       label: 'All coaches',      desc: 'All coaches and assistants in your workspace' },
  { value: 'client_visible', label: 'Share with clients', desc: 'Clients can view this in their portal' },
]
const COACH_VISIBILITY_OPTIONS = [
  { value: 'private',        label: 'Just me',          desc: 'Only you and the owner can see this' },
  { value: 'internal',       label: 'All coaches',      desc: 'All coaches and assistants in your workspace' },
  { value: 'client_visible', label: 'Share with clients', desc: 'Clients can view this in their portal' },
]
const TYPE_ICONS: Record<string, any> = {
  pdf:      <FileText size={20} color="#c0392b" />,
  video:    <Film     size={20} color="#7c4d9f" />,
  link:     <LinkIcon size={20} color="#2d6a9f" />,
  document: <FileText size={20} color="#2d6a9f" />,
  playbook: <FileText size={20} color="#c9a84c" />,
}

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

function ItemCard({ item, onDelete }: { item: any; onDelete: () => void }) {
  const icon = TYPE_ICONS[item.content_type] || <File size={20} color="#8c8279" />
  const hasFile = !!item.presigned_url

  const handleDownload = async () => {
    if (!hasFile) return
    window.open(item.presigned_url, '_blank')
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: 0, overflow: 'hidden' }}>
      {/* Top colour strip by type */}
      <div style={{ height: 3, background: item.content_type === 'pdf' ? '#c0392b' : item.content_type === 'video' ? '#7c4d9f' : '#2d6a9f' }} />
      <div style={{ padding: '16px 18px', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flexShrink: 0, marginTop: 2 }}>{icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.title}
            </div>
            {item.file_name && item.file_name !== item.title && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{item.file_name}</div>
            )}
          </div>
        </div>
        {item.description && (
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {item.description}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase',
            color: VISIBILITY_COLORS[item.visibility] || '#8c8279',
            background: `${VISIBILITY_COLORS[item.visibility]}18`,
            padding: '2px 8px', borderRadius: 20,
          }}>
            {VISIBILITY_LABELS[item.visibility] || item.visibility}
          </span>
          {item.uploaded_by_name && (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              by {item.uploaded_by_name}
            </span>
          )}
          <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
            {item.view_count} views
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', borderTop: '1px solid var(--border)' }}>
        {hasFile && (
          <button onClick={handleDownload}
            className="btn btn-ghost btn-sm"
            style={{ flex: 1, borderRadius: 0, gap: 5, fontSize: 12 }}>
            <Download size={13} /> Download
          </button>
        )}
        {item.url && (
          <button onClick={() => window.open(item.url, '_blank')}
            className="btn btn-ghost btn-sm"
            style={{ flex: 1, borderRadius: 0, gap: 5, fontSize: 12 }}>
            <Eye size={13} /> Open
          </button>
        )}
        <button onClick={onDelete}
          className="btn btn-ghost btn-sm"
          style={{ borderRadius: 0, color: '#c0392b', padding: '6px 12px' }}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
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
  const [form, setForm] = useState({ title: '', description: '', visibility: defaultVisibility, folder: '' })
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
      </div>
    </Modal>
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
  const { show, el: toastEl } = useToast()
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [showNewFolder, setShowNewFolder] = useState(false)

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

      <div style={{ display: 'flex', padding: '0 28px 36px', gap: 24, alignItems: 'flex-start' }}>

        {/* Sidebar */}
        <div className="card" style={{ width: 220, flexShrink: 0, padding: '12px 8px' }}>
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

        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>
              {folderLabel}
              {items.length > 0 && <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 13, marginLeft: 8 }}>{items.length} file{items.length !== 1 ? 's' : ''}</span>}
            </div>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
              <input
                className="finput"
                style={{ paddingLeft: 32, width: 220, height: 34, fontSize: 13 }}
                placeholder="Search files…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {isLoading ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
          ) : items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <Upload size={32} color="var(--muted)" style={{ margin: '0 auto 12px' }} />
              <div style={{ fontSize: 14, color: 'var(--muted)' }}>
                {search ? 'No files match your search' : 'No files yet — upload one to get started'}
              </div>
              {!search && (
                <button className="btn btn-dark btn-sm" style={{ marginTop: 16 }} onClick={() => setShowUpload(true)}>
                  <Upload size={13} /> Upload File
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
              {items.map((item: any) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  onDelete={() => handleDeleteItem(item.id, item.title)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

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
      {toastEl}
    </AppShell>
  )
}
