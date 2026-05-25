import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { MessageSquarePlus, ChevronRight, Plus } from 'lucide-react'
import AppShell from '../../components/layout/AppShell'
import FeedbackFormModal from '../../components/FeedbackFormModal'
import { feedbackApi } from '../../api/client'
import { useAuthStore } from '../../store/auth'

const STATUS_COLORS: Record<string, string> = {
  new:         '#6b7280',
  reviewing:   '#d97706',
  in_progress: '#2563eb',
  resolved:    '#16a34a',
  closed:      '#1B3A6B',
}

const STATUS_LABELS: Record<string, string> = {
  new:         'New',
  reviewing:   'Reviewing',
  in_progress: 'In Progress',
  resolved:    'Resolved',
  closed:      'Closed',
}

const CATEGORY_LABELS: Record<string, string> = {
  bug:         'Bug',
  feature:     'Feature Request',
  ui:          'UI / UX',
  performance: 'Performance',
  general:     'General',
}

const PRIORITY_COLORS: Record<string, string> = {
  low:      '#6b7280',
  medium:   '#d97706',
  high:     '#dc2626',
  critical: '#7c3aed',
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 20,
      fontSize: 11, fontWeight: 600, background: color + '18', color,
      border: `1px solid ${color}30`,
    }}>{label}</span>
  )
}

export default function FeedbackList() {
  const navigate = useNavigate()
  const user     = useAuthStore(s => s.user)
  const isOwner  = user?.role === 'business_owner'

  const [statusFilter, setStatusFilter]     = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [showForm, setShowForm]             = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['feedback', statusFilter, categoryFilter],
    queryFn: () => feedbackApi.list({ status: statusFilter || undefined, category: categoryFilter || undefined }),
  })

  const tickets = data?.data ?? []

  return (
    <AppShell>
      <FeedbackFormModal open={showForm} onClose={() => setShowForm(false)} />
      <div style={{ padding: '28px 32px', fontFamily: "'DM Sans', sans-serif" }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, fontSize: 28, color: '#1B3A6B', margin: 0 }}>
              Feedback
            </h1>
            <p style={{ color: '#8c8279', fontSize: 13, margin: '4px 0 0' }}>
              {isOwner ? 'All workspace feedback tickets' : 'Your submitted feedback'}
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', background: '#1B3A6B', color: '#fff',
              border: 'none', borderRadius: 6, cursor: 'pointer',
              fontSize: 13, fontFamily: 'inherit', fontWeight: 600,
            }}
          >
            <Plus size={14} strokeWidth={2} /> New Ticket
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{
              padding: '6px 10px', border: '1px solid #e8e4df', borderRadius: 6,
              fontSize: 13, background: '#faf9f7', color: '#333', fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            <option value="">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            style={{
              padding: '6px 10px', border: '1px solid #e8e4df', borderRadius: 6,
              fontSize: 13, background: '#faf9f7', color: '#333', fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            <option value="">All Categories</option>
            {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        {/* Table */}
        {isLoading ? (
          <div style={{ color: '#8c8279', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>Loading…</div>
        ) : tickets.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 60, color: '#8c8279' }}>
            <MessageSquarePlus size={32} style={{ marginBottom: 12, opacity: .4 }} />
            <div style={{ fontSize: 14 }}>No feedback tickets yet.</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Use the feedback button (bottom-right) to submit one.</div>
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #e8e4df', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e8e4df', background: '#faf9f7' }}>
                  {['Title', 'Category', 'Priority', 'Status', isOwner ? 'From' : '', 'Date', ''].map((h, i) =>
                    h ? (
                      <th key={i} style={{
                        padding: '10px 16px', textAlign: 'left', fontSize: 11,
                        color: '#8c8279', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase',
                      }}>{h}</th>
                    ) : <th key={i} />
                  )}
                </tr>
              </thead>
              <tbody>
                {tickets.map((t: any) => (
                  <tr
                    key={t.id}
                    onClick={() => navigate(`/feedback/${t.id}`)}
                    style={{
                      borderBottom: '1px solid #f0ece8', cursor: 'pointer',
                      transition: 'background .12s',
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#faf9f7'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                  >
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#1a1a1a', fontWeight: 500, maxWidth: 280 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                      {t.comment_count > 0 && (
                        <div style={{ fontSize: 11, color: '#8c8279', marginTop: 2 }}>
                          {t.comment_count} comment{t.comment_count !== 1 ? 's' : ''}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <Badge label={CATEGORY_LABELS[t.category] ?? t.category} color="#1B3A6B" />
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <Badge
                        label={t.priority.charAt(0).toUpperCase() + t.priority.slice(1)}
                        color={PRIORITY_COLORS[t.priority] ?? '#6b7280'}
                      />
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <Badge
                        label={STATUS_LABELS[t.status] ?? t.status}
                        color={STATUS_COLORS[t.status] ?? '#6b7280'}
                      />
                    </td>
                    {isOwner && (
                      <td style={{ padding: '12px 16px', fontSize: 13, color: '#555' }}>
                        {t.submitted_by_name}
                      </td>
                    )}
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#8c8279', whiteSpace: 'nowrap' }}>
                      {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#b5aea7' }}>
                      <ChevronRight size={14} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}
