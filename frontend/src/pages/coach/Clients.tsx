import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { clientsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { EmptyState, useToast } from '../../components/ui'

const AVATAR_COLS = ['c1', 'c2', 'c3', 'c4', 'c5']

function initials(first: string, last: string) {
  return ((first?.[0] || '') + (last?.[0] || '')).toUpperCase()
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
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
  const { el: toastEl } = useToast()
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<string>('all')
  const [selectedTag, setSelectedTag] = useState<string>('')
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['clients', search, activeFilter, selectedTag],
    queryFn: () => clientsApi.list({
      search: search || undefined,
      active_flag:
        activeFilter === 'active' ? true :
        activeFilter === 'inactive' ? false :
        undefined,
      tag: selectedTag || undefined,
    }).then(r => r.data),
  })

  const clients: any[] = data?.results || data || []
  const activeCount = clients.filter((c: any) => c.active_flag).length
  const inactiveCount = clients.filter((c: any) => !c.active_flag).length

  // Collect all unique tags from loaded clients for the tag dropdown
  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    clients.forEach((c: any) => (c.tags || []).forEach((t: string) => tagSet.add(t)))
    return Array.from(tagSet).sort()
  }, [clients])

  return (
    <AppShell>
      {/* Header */}
      <div style={{ background: 'var(--white)', borderBottom: '1px solid var(--border)', padding: '22px 36px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28, fontWeight: 300, marginBottom: 4 }}>Clients</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {clients.length} total · {activeCount} active · {inactiveCount} inactive
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-dark" onClick={() => navigate('/clients/new')}>+ New Client</button>
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
          {[
            { key: 'all',      label: 'All' },
            { key: 'active',   label: 'Active' },
            { key: 'inactive', label: 'Inactive' },
          ].map(f => (
            <button
              key={f.key}
              className={`filter-pill${activeFilter === f.key ? ' active' : ''}`}
              onClick={() => setActiveFilter(f.key)}
            >
              {f.label}
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
            !selectedTag && !search
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
                    <span className={`pill ${c.active_flag ? 'pill-green' : 'pill-grey'}`}>
                      {c.active_flag ? 'Active' : 'Inactive'}
                    </span>
                    {c.portal_access && (
                      <span className="pill pill-blue" style={{ marginLeft: 4 }}>Portal</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {(c.tags || []).map((t: string) => (
                        <span
                          key={t}
                          className={`tag${selectedTag === t ? ' active' : ''}`}
                          style={{ cursor: 'pointer' }}
                          onClick={e => { e.stopPropagation(); setSelectedTag(selectedTag === t ? '' : t) }}
                        >{t}</span>
                      ))}
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {toastEl}
    </AppShell>
  )
}
