import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Search, Download, Trash2, ExternalLink } from 'lucide-react'
import { libraryApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { PageHeader, Modal, useToast } from '../../components/ui'
import { EDITABLE_OFFICE_EXTS, OfficeEditorModal } from '../../components/OfficeEditor'
import { useAuthStore } from '../../store/auth'
import { apiErrorMessage } from '../../lib/apiError'

// Every file clients uploaded from their portal, workspace-wide — kept apart from the
// coach's own Library (Library → All Files never lists these; see the backend's
// KnowledgeItemViewSet.get_queryset). Owner sees all clients' files; a coach only their
// own clients'. Each client's Files tab shows the same files for just that client.
export default function ClientFiles() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const { show: showToast, el: toastEl } = useToast()
  const [search, setSearch] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [editing, setEditing] = useState<any>(null)
  const [deleting, setDeleting] = useState<any>(null)

  const isOwner = user?.role === 'business_owner'
  const tabs = (user as any)?.tab_permissions || {}
  const canEdit = isOwner || !!tabs.library?.edit
  const canDelete = isOwner || !!tabs.library?.delete

  const { data, isLoading } = useQuery({
    queryKey: ['client-files'],
    queryFn: () => libraryApi.items({ client_uploads: 1, page_size: 500 }).then(r => r.data),
  })
  const all: any[] = data?.results || data || []

  const clients = useMemo(() => {
    const m = new Map<string, string>()
    all.forEach(f => f.uploaded_by_client && m.set(f.uploaded_by_client, f.uploaded_by_client_name || 'Client'))
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [all])

  const q = search.trim().toLowerCase()
  const files = all.filter(f =>
    (!clientFilter || f.uploaded_by_client === clientFilter) &&
    (!q || `${f.title} ${f.file_name} ${f.uploaded_by_client_name}`.toLowerCase().includes(q)))

  const ext = (f: any) => (f.file_name || '').split('.').pop()?.toLowerCase() || ''
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const confirmDelete = async () => {
    try {
      await libraryApi.deleteItem(deleting.id)
      qc.invalidateQueries({ queryKey: ['client-files'] })
      showToast('File deleted')
    } catch (e) { showToast(apiErrorMessage(e, 'Failed to delete'), 'error') }
    setDeleting(null)
  }

  return (
    <AppShell>
      <PageHeader title="Client Files" subtitle={isOwner ? 'Files your clients shared from their portal' : 'Files your clients shared with you from their portal'} />
      <div style={{ padding: '24px 36px' }}>
        <div className="toolbar">
          <div className="search-box">
            <span className="search-icon"><Search size={13} /></span>
            <input placeholder="Search by file or client…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="fselect" style={{ width: 'auto', minWidth: 180, marginBottom: 0 }}
            value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
            <option value="">All clients</option>
            {clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading…</div>
        ) : files.length === 0 ? (
          <div className="empty">
            <div className="empty-icon"><FileText size={36} strokeWidth={1} /></div>
            <h3>{all.length ? 'No matching files' : 'No client files yet'}</h3>
            <p>Files appear here once a client uploads them in their portal and presses “Share with coach”. Upload limits are set per client under Portal Permissions.</p>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>File</th>
                <th style={{ width: 220 }}>Client</th>
                <th style={{ width: 130 }}>Shared</th>
                <th style={{ width: 70 }}>Version</th>
                <th style={{ width: 170 }}></th>
              </tr>
            </thead>
            <tbody>
              {files.map(f => (
                <tr key={f.id} style={{ cursor: 'default' }}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <FileText size={16} color="var(--muted)" />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, overflowWrap: 'anywhere' }}>{f.title}</div>
                        {f.file_name && f.file_name !== f.title && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{f.file_name}</div>}
                      </div>
                    </div>
                  </td>
                  <td>
                    <Link to={`/clients/${f.uploaded_by_client}`} style={{ color: 'var(--navy)', fontSize: 13 }}>
                      {f.uploaded_by_client_name || '—'}
                    </Link>
                  </td>
                  <td style={{ fontSize: 13 }}>{fmt(f.shared_with_coach_at || f.created_at)}</td>
                  <td style={{ fontSize: 13, color: 'var(--muted)' }}>v{f.version}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {canEdit && EDITABLE_OFFICE_EXTS.includes(ext(f)) && (
                        <button className="btn btn-outline btn-sm" onClick={() => setEditing(f)}>✎ Edit</button>
                      )}
                      {f.inline_url && (
                        <a className="btn btn-ghost btn-sm" href={f.inline_url} target="_blank" rel="noreferrer" title="Open"><ExternalLink size={14} /></a>
                      )}
                      {f.presigned_url && (
                        <a className="btn btn-ghost btn-sm" href={f.presigned_url} target="_blank" rel="noreferrer" title="Download"><Download size={14} /></a>
                      )}
                      {canDelete && (
                        <button className="btn btn-ghost btn-sm" title="Delete" style={{ color: '#c0392b' }} onClick={() => setDeleting(f)}><Trash2 size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <OfficeEditorModal
          title={editing.title}
          getEditConfig={mode => libraryApi.editConfig(editing.id, mode).then(r => r.data)}
          onClose={() => setEditing(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['client-files'] })}
        />
      )}
      {deleting && (
        <Modal title="Delete File" onClose={() => setDeleting(null)} footer={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => setDeleting(null)}>Cancel</button>
            <button className="btn btn-danger btn-sm" onClick={confirmDelete}>Delete</button>
          </>
        }>
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>
            Delete <strong>"{deleting.title}"</strong> uploaded by {deleting.uploaded_by_client_name}? It's removed from their portal too, and frees one of their upload slots.
          </div>
        </Modal>
      )}
      {toastEl}
    </AppShell>
  )
}
