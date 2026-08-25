import { useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { clientsApi, settingsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { EmptyState, useToast, Modal } from '../../components/ui'
import { useAuthStore } from '../../store/auth'

const AVATAR_COLS = ['c1', 'c2', 'c3', 'c4', 'c5']

function initials(first: string, last: string) {
  return ((first?.[0] || '') + (last?.[0] || '')).toUpperCase()
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff < 0) return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  const weeks = Math.floor(days / 7)
  if (mins  < 60)  return `${mins}m ago`
  if (hours < 24)  return `${hours}h ago`
  if (days  < 7)   return `${days}d ago`
  if (weeks < 5)   return `${weeks}w ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function lastActivityLabel(c: any): { label: string; when: string } | null {
  if (c.last_activity_type && c.last_activity_at) {
    const type = c.last_activity_type.charAt(0).toUpperCase() + c.last_activity_type.slice(1)
    return { label: type, when: timeAgo(c.last_activity_at) }
  }
  if (c.created_at) {
    return { label: 'Created', when: timeAgo(c.created_at) }
  }
  return null
}

export default function Clients() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const isOwner = user?.role === 'business_owner'
  // Creating clients only needs the "Clients" edit permission (matches the backend's
  // require_tab("clients", "edit") check on POST /api/clients/) — so a coach/assistant
  // the owner has granted Edit for via Team > Permissions can add clients too, not just
  // the owner. CSV import stays owner/coach-only (backend gates it with IsCoachOrAbove
  // regardless of the edit flag), and deleting a client stays owner-only (cascades
  // invoices/deals/files, backend hard-requires IsBusinessOwnerOrSuperuser for it).
  const canAddClients = isOwner || !!user?.tab_permissions?.clients?.edit
  const isCoachOrAbove = isOwner || user?.role === 'coach'
  const queryClient = useQueryClient()
  const { show: toast, el: toastEl } = useToast()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedTag, setSelectedTag] = useState<string>('')
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showFormatHelp, setShowFormatHelp] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [importResult, setImportResult] = useState<{ created: number; errors: { row: number; error: string }[] } | null>(null)
  const [importFatalError, setImportFatalError] = useState<string | null>(null)

  const { data: statusConfigs = [] } = useQuery({
    queryKey: ['client-status-configs'],
    queryFn: () => settingsApi.getClientStatuses().then(r => r.data),
    staleTime: 0,
  })

  const { data: tagConfigs = [] } = useQuery({
    queryKey: ['client-tag-configs'],
    queryFn: () => settingsApi.getClientTags().then(r => r.data),
    staleTime: 0,
  })
  const statusMap = useMemo(() => {
    const m: Record<string, any> = {}
    ;(statusConfigs as any[]).forEach(s => { m[s.label] = s })
    return m
  }, [statusConfigs])

  const tagMap = useMemo(() => {
    const m: Record<string, string> = {}
    ;(tagConfigs as any[]).forEach(t => { m[t.name] = t.color })
    return m
  }, [tagConfigs])

  async function handleExport() {
    const { data } = await clientsApi.exportCsv()
    const url = URL.createObjectURL(new Blob([data], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'clients.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImporting(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const { data } = await clientsApi.importCsv(fd)
      if (data.errors.length > 0) {
        // Errors (e.g. duplicate name/email already in this workspace) need their
        // per-row description visible, not just a count — a toast isn't enough room
        // and disappears too fast to read a list of rows.
        setImportResult({ created: data.created, errors: data.errors })
      } else {
        toast(`Imported ${data.created} client${data.created !== 1 ? 's' : ''}`, 'success')
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] })
    } catch (e: any) {
      // Surface the backend's actual reason (e.g. "File must be UTF-8 encoded.") in a
      // popup instead of a generic toast — a vague "check the file format" message
      // doesn't tell you what's actually wrong or give you time to read it.
      const detail = e?.response?.data?.detail
      setImportFatalError(detail || 'Failed to import file. Please check that it\'s a valid CSV and try again.')
    } finally {
      setImporting(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await clientsApi.delete(deleteTarget.id)
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      toast('Client deleted')
      setDeleteTarget(null)
    } catch {
      toast('Failed to delete client', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const { data, isLoading } = useQuery({
    queryKey: ['clients', search, statusFilter, selectedTag],
    queryFn: () => clientsApi.list({
      search: search || undefined,
      status: statusFilter !== 'all' ? statusFilter : undefined,
      tag: selectedTag || undefined,
    }).then(r => r.data),
  })

  const clients: any[] = data?.results || data || []

  // Collect all unique tags from loaded clients for the tag dropdown
  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    clients.forEach((c: any) => (c.tags || []).forEach((t: string) => tagSet.add(t)))
    return Array.from(tagSet).sort()
  }, [clients])

  return (
    <AppShell>
      {/* Header */}
      <div style={{ background: '#f7f4ef', borderBottom: '1px solid var(--border)', padding: '22px 36px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 300, marginBottom: 4 }}>Clients</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {clients.length} {statusFilter === 'all' ? 'total' : statusFilter}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={handleExport}>↓ Export CSV</button>
            {isCoachOrAbove && (
              <div style={{ position: 'relative', display: 'flex' }}>
                <button className="btn btn-ghost" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                  {importing ? 'Importing…' : '↑ Import CSV'}
                </button>
                <button
                  type="button"
                  title="CSV format guide"
                  onClick={() => setShowFormatHelp(v => !v)}
                  style={{
                    background: 'none', border: '1px solid var(--border)', borderRadius: '50%',
                    width: 20, height: 20, marginLeft: 6, alignSelf: 'center', cursor: 'pointer',
                    fontSize: 11, color: 'var(--muted)', lineHeight: 1, padding: 0,
                  }}
                >ⓘ</button>
                <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleImport} />
                {showFormatHelp && (
                  <div style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: 8, width: 300, zIndex: 20,
                    background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
                    boxShadow: '0 4px 16px rgba(0,0,0,.12)', padding: 16, fontSize: 12.5, lineHeight: 1.7,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <strong style={{ fontSize: 12 }}>CSV format guide</strong>
                      <button type="button" onClick={() => setShowFormatHelp(false)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, padding: 0 }}>×</button>
                    </div>
                    <div><strong>Required:</strong> first_name, last_name, email_1</div>
                    <div><strong>Everything else is optional:</strong> email_2, phone_1 (+ _ext/_type), phone_2 (+ _ext/_type), street_address_1/2, city, state, zip, and more</div>
                    <div><strong>birth_date:</strong> YYYY-MM-DD preferred (MM/DD/YYYY and a few other common formats are also accepted)</div>
                    <div><strong>tags:</strong> separate multiple with | or ,</div>
                    <div><strong>coach_email:</strong> must match a coach's email already in this workspace, else it's assigned to you</div>
                    <div style={{ marginTop: 8, color: 'var(--muted)' }}>
                      Easiest: click <strong>↓ Export CSV</strong> first to get a file with the right columns and see the exact format.
                    </div>
                  </div>
                )}
              </div>
            )}
            {canAddClients && (
              <button className="btn btn-dark" onClick={() => navigate('/clients/new')}>+ New Client</button>
            )}
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* Toolbar */}
        <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="search-box" style={{ flex: '1 1 220px', minWidth: 180 }}>
            <span className="search-icon">⌕</span>
            <input
              placeholder="Search by name, email, company…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Status filters */}
          <button
            className={`filter-pill${statusFilter === 'all' ? ' active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >All</button>
          {(statusConfigs as any[]).map((s: any) => (
            <button
              key={s.label}
              className={`filter-pill${statusFilter === s.label ? ' active' : ''}`}
              onClick={() => setStatusFilter(s.label)}
              style={statusFilter === s.label
                ? { background: s.color + '18', borderColor: s.color, color: s.color }
                : {}}
            >
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: s.color, marginRight: 5, verticalAlign: 'middle' }} />
              {s.label}
            </button>
          ))}

          {/* Tag filter dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              className={`filter-pill${selectedTag ? ' active' : ''}`}
              onClick={() => setTagDropdownOpen(o => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}
            >
              {selectedTag ? selectedTag : 'All Tags'}
              {selectedTag
                ? <span onClick={e => { e.stopPropagation(); setSelectedTag(''); setTagDropdownOpen(false) }}
                    style={{ fontWeight: 700, fontSize: 14, lineHeight: 1, marginLeft: 2 }}>×</span>
                : <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
              }
            </button>
            {tagDropdownOpen && (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                  onClick={() => setTagDropdownOpen(false)}
                />
                <div style={{
                  position: 'absolute', top: '100%', left: 0, zIndex: 100,
                  background: 'var(--white)', border: '1px solid var(--border)',
                  boxShadow: 'var(--shadow-lg)', minWidth: 160, marginTop: 4,
                  maxHeight: 240, overflowY: 'auto',
                }}>
                  <button
                    onClick={() => { setSelectedTag(''); setTagDropdownOpen(false) }}
                    style={{
                      width: '100%', padding: '9px 14px', textAlign: 'left', background: !selectedTag ? 'var(--paper)' : 'none',
                      border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: "'DM Sans', sans-serif",
                      color: 'var(--ink)', borderBottom: '1px solid var(--border)',
                    }}
                  >All Tags</button>
                  {allTags.length === 0 && (
                    <div style={{ padding: '9px 14px', fontSize: 12, color: 'var(--muted)' }}>No tags</div>
                  )}
                  {allTags.map(tag => (
                    <button
                      key={tag}
                      onClick={() => { setSelectedTag(tag); setTagDropdownOpen(false) }}
                      style={{
                        width: '100%', padding: '9px 14px', textAlign: 'left',
                        background: selectedTag === tag ? 'var(--paper)' : 'none',
                        border: 'none', cursor: 'pointer', fontSize: 12,
                        fontFamily: "'DM Sans', sans-serif", color: 'var(--ink)',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >{tag}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Active tag badge */}
        {selectedTag && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Filtered by tag:</span>
            <span className="tag" style={{ cursor: 'pointer' }} onClick={() => setSelectedTag('')}>
              {selectedTag} ×
            </span>
          </div>
        )}

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading clients…</div>
        ) : clients.length === 0 ? (
          <EmptyState icon="◉" title="No clients found" message={
            selectedTag || search ? 'Try adjusting your search or filters' : 'Add your first client to get started'
          } action={
            canAddClients && !selectedTag && !search
              ? <button className="btn btn-dark" onClick={() => navigate('/clients/new')}>+ New Client</button>
              : undefined
          } />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Client</th>
                <th>Status</th>
                <th>Tags</th>
                <th>Coach</th>
                <th>Last Activity</th>
                <th></th>
                {isOwner && <th></th>}
              </tr>
            </thead>
            <tbody>
              {clients.map((c: any, i: number) => (
                <tr key={c.id} onClick={() => navigate(`/clients/${c.id}`)}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div className={`avatar ${AVATAR_COLS[i % 5]}`}>
                        {initials(c.first_name, c.last_name)}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{c.first_name} {c.last_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {c.company
                            ? `${c.company}${c.job_title ? ' · ' + c.job_title : ''}`
                            : c.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {(() => {
                      const cfg = statusMap[c.status] || null
                      const color = cfg?.color || '#b8b2ab'
                      return (
                        <span style={{
                          display: 'inline-block', fontSize: 11, fontWeight: 600,
                          padding: '2px 10px', borderRadius: 12,
                          background: color + '20', color, border: `1px solid ${color}40`,
                        }}>{c.status || 'Lead'}</span>
                      )
                    })()}
                    {c.portal_access && (
                      <span className="pill pill-blue" style={{ marginLeft: 4 }}>Portal</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {(c.tags || []).map((t: string) => {
                        const color = tagMap[t]
                        return color ? (
                          <span
                            key={t}
                            onClick={e => { e.stopPropagation(); setSelectedTag(selectedTag === t ? '' : t) }}
                            style={{
                              cursor: 'pointer', fontSize: 11, fontWeight: 600,
                              padding: '2px 8px', borderRadius: 10,
                              background: color + '20', color,
                              border: `1px solid ${color}${selectedTag === t ? 'cc' : '40'}`,
                              outline: selectedTag === t ? `2px solid ${color}60` : 'none',
                            }}
                          >{t}</span>
                        ) : (
                          <span
                            key={t}
                            className={`tag${selectedTag === t ? ' active' : ''}`}
                            style={{ cursor: 'pointer' }}
                            onClick={e => { e.stopPropagation(); setSelectedTag(selectedTag === t ? '' : t) }}
                          >{t}</span>
                        )
                      })}
                    </div>
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--muted)' }}>
                    {c.coach_name || '—'}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {(() => {
                      const la = lastActivityLabel(c)
                      return la
                        ? <><span style={{ color: 'var(--ink)', fontWeight: 500 }}>{la.label}</span> · {la.when}</>
                        : '—'
                    })()}
                  </td>
                  <td style={{ color: 'var(--gold)', fontSize: 12, fontWeight: 500 }}>View →</td>
                  {isOwner && (
                    <td onClick={e => e.stopPropagation()}>
                      <button
                        title="Delete client"
                        onClick={() => setDeleteTarget({ id: c.id, name: `${c.first_name} ${c.last_name}` })}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b5afa6', fontSize: 14, padding: 4 }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#c0392b')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#b5afa6')}
                      >✕</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {deleteTarget && (
        <Modal title="Delete Client" onClose={() => !deleting && setDeleteTarget(null)}>
          <div style={{ padding: '4px 0 20px', fontSize: 14, color: 'var(--ink)', lineHeight: 1.6 }}>
            Permanently delete <strong>{deleteTarget.name}</strong>? This cannot be undone — all their sessions, notes, invoices, pipeline deals, and files will be removed.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline btn-sm" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
            <button
              className="btn btn-sm"
              onClick={handleDelete}
              disabled={deleting}
              style={{ background: '#c0392b', color: '#fff', border: 'none' }}
            >{deleting ? 'Deleting…' : 'Delete Client'}</button>
          </div>
        </Modal>
      )}

      {importResult && (
        <Modal title="Import Results" onClose={() => setImportResult(null)}>
          <div style={{ padding: '4px 0 16px', fontSize: 14, color: 'var(--ink)', lineHeight: 1.6 }}>
            Imported <strong>{importResult.created}</strong> new client{importResult.created !== 1 ? 's' : ''}.
            {' '}<strong style={{ color: '#c0392b' }}>{importResult.errors.length}</strong> row{importResult.errors.length !== 1 ? 's' : ''} skipped:
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            {importResult.errors.map((e, i) => (
              <div key={i} style={{
                padding: '8px 12px', fontSize: 13, color: 'var(--ink)',
                borderBottom: i < importResult.errors.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <span style={{ color: 'var(--muted)', fontWeight: 600, marginRight: 6 }}>Row {e.row}:</span>
                {e.error}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-dark btn-sm" onClick={() => setImportResult(null)}>Done</button>
          </div>
        </Modal>
      )}

      {importFatalError && (
        <Modal title="Import Failed" onClose={() => setImportFatalError(null)}>
          <div style={{ padding: '4px 0 20px', fontSize: 14, color: 'var(--ink)', lineHeight: 1.6 }}>
            {importFatalError}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-dark btn-sm" onClick={() => setImportFatalError(null)}>Close</button>
          </div>
        </Modal>
      )}

      {toastEl}
    </AppShell>
  )
}
