import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Send, CheckCircle, Pencil } from 'lucide-react'
import AppShell from '../../components/layout/AppShell'
import FeedbackFormModal from '../../components/FeedbackFormModal'
import { feedbackApi } from '../../api/client'
import { useAuthStore } from '../../store/auth'

const STATUS_OPTIONS = [
  { value: 'new',         label: 'New',         color: '#6b7280' },
  { value: 'reviewing',   label: 'Reviewing',   color: '#d97706' },
  { value: 'in_progress', label: 'In Progress', color: '#2563eb' },
  { value: 'resolved',    label: 'Resolved',    color: '#16a34a' },
  { value: 'closed',      label: 'Closed',      color: '#1B3A6B' },
]

const PRIORITY_COLORS: Record<string, string> = {
  low:      '#6b7280',
  medium:   '#d97706',
  high:     '#dc2626',
  critical: '#7c3aed',
}

const CATEGORY_LABELS: Record<string, string> = {
  bug:         'Bug',
  feature:     'Feature Request',
  ui:          'UI / UX',
  performance: 'Performance',
  general:     'General',
}

function StatusBadge({ status }: { status: string }) {
  const opt = STATUS_OPTIONS.find(s => s.value === status)
  const color = opt?.color ?? '#6b7280'
  const label = opt?.label ?? status
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 12,
      fontWeight: 600, background: color + '18', color, border: `1px solid ${color}30`,
    }}>{label}</span>
  )
}

export default function FeedbackDetail() {
  const { id }       = useParams<{ id: string }>()
  const navigate     = useNavigate()
  const qc           = useQueryClient()
  const user         = useAuthStore(s => s.user)
  const isOwner      = user?.role === 'business_owner'

  const [comment, setComment]   = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [showEdit, setShowEdit]   = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['feedback', id],
    queryFn:  () => feedbackApi.get(id!),
    enabled:  !!id,
  })
  const ticket = data?.data

  const commentMutation = useMutation({
    mutationFn: () => feedbackApi.comment(id!, { text: comment.trim() }),
    onSuccess:  () => { setComment(''); qc.invalidateQueries({ queryKey: ['feedback', id] }) },
  })

  const statusMutation = useMutation({
    mutationFn: (s: string) => feedbackApi.updateStatus(id!, { status: s }),
    onSuccess:  () => {
      setStatusMsg('Status updated.')
      setTimeout(() => setStatusMsg(''), 2500)
      qc.invalidateQueries({ queryKey: ['feedback', id] })
      qc.invalidateQueries({ queryKey: ['feedback'] })
    },
  })

  const closeMutation = useMutation({
    mutationFn: () => feedbackApi.close(id!),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['feedback', id] })
      qc.invalidateQueries({ queryKey: ['feedback'] })
    },
  })

  if (isLoading) {
    return <AppShell><div style={{ padding: 40, color: '#8c8279', fontSize: 13 }}>Loading…</div></AppShell>
  }
  if (!ticket) {
    return <AppShell><div style={{ padding: 40, color: '#8c8279', fontSize: 13 }}>Ticket not found.</div></AppShell>
  }

  const isClosed = ticket.status === 'closed'

  const canEdit = isOwner || (ticket?.submitted_by_name === user?.full_name && ticket?.status === 'new')

  return (
    <AppShell>
      {showEdit && ticket && (
        <FeedbackFormModal
          open={showEdit}
          onClose={() => setShowEdit(false)}
          editTicket={{
            id:              ticket.id,
            title:           ticket.title,
            description:     ticket.description,
            category:        ticket.category,
            priority:        ticket.priority,
            screenshot_data: ticket.screenshot_data ?? '',
          }}
        />
      )}
      <div style={{ padding: '28px 32px', fontFamily: "'DM Sans', sans-serif", maxWidth: 760 }}>
        {/* Back */}
        <button
          onClick={() => navigate('/feedback')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
            color: '#8c8279', fontSize: 13, padding: 0, marginBottom: 20, fontFamily: 'inherit',
          }}
        >
          <ArrowLeft size={14} /> Back to Feedback
        </button>

        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{
              fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, fontSize: 26,
              color: '#1B3A6B', margin: 0, lineHeight: 1.2,
            }}>{ticket.title}</h1>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <StatusBadge status={ticket.status} />
              <span style={{
                display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 12,
                fontWeight: 600, background: '#1B3A6B18', color: '#1B3A6B', border: '1px solid #1B3A6B30',
              }}>{CATEGORY_LABELS[ticket.category] ?? ticket.category}</span>
              <span style={{
                display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 12,
                fontWeight: 600,
                background: (PRIORITY_COLORS[ticket.priority] ?? '#6b7280') + '18',
                color: PRIORITY_COLORS[ticket.priority] ?? '#6b7280',
                border: `1px solid ${(PRIORITY_COLORS[ticket.priority] ?? '#6b7280')}30`,
              }}>{ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}</span>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            {canEdit && !isClosed && (
              <button
                onClick={() => setShowEdit(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                  background: '#fff', border: '1px solid #e8e4df', borderRadius: 6,
                  color: '#555', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <Pencil size={13} /> Edit
              </button>
            )}
            {isOwner && !isClosed && (
              <button
                onClick={() => closeMutation.mutate()}
                disabled={closeMutation.isPending}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                  background: '#f0f4fa', border: '1px solid #c7d5ec', borderRadius: 6,
                  color: '#1B3A6B', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <CheckCircle size={13} /> Close Ticket
              </button>
            )}
          </div>
        </div>

        {/* Meta */}
        <div style={{
          background: '#faf9f7', border: '1px solid #e8e4df', borderRadius: 8,
          padding: '14px 18px', marginBottom: 24,
          display: 'grid', gridTemplateColumns: 'auto auto auto', gap: '8px 32px',
        }}>
          <div><div style={{ fontSize: 11, color: '#8c8279', marginBottom: 2 }}>Submitted by</div>
            <div style={{ fontSize: 13, color: '#1a1a1a' }}>{ticket.submitted_by_name}</div></div>
          <div><div style={{ fontSize: 11, color: '#8c8279', marginBottom: 2 }}>Submitted on</div>
            <div style={{ fontSize: 13, color: '#1a1a1a' }}>
              {new Date(ticket.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </div></div>
          {ticket.page_url && (
            <div><div style={{ fontSize: 11, color: '#8c8279', marginBottom: 2 }}>Page</div>
              <div style={{ fontSize: 12, color: '#555', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                {ticket.page_url.replace(/^https?:\/\/[^/]+/, '')}
              </div>
            </div>
          )}
          {ticket.closed_at && (
            <div><div style={{ fontSize: 11, color: '#8c8279', marginBottom: 2 }}>Closed on</div>
              <div style={{ fontSize: 13, color: '#1a1a1a' }}>
                {new Date(ticket.closed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </div></div>
          )}
        </div>

        {/* Description */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: '#8c8279', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Description
          </div>
          <div style={{
            fontSize: 14, color: '#333', lineHeight: 1.6,
            whiteSpace: 'pre-wrap', background: '#faf9f7',
            border: '1px solid #e8e4df', borderRadius: 8, padding: '14px 18px',
          }}>{ticket.description}</div>
        </div>

        {/* Screenshot */}
        {ticket.screenshot_data && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 12, color: '#8c8279', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Screenshot
            </div>
            <img
              src={ticket.screenshot_data}
              alt="screenshot"
              style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #e8e4df', display: 'block' }}
            />
          </div>
        )}

        {/* Owner: Update Status */}
        {isOwner && (
          <div style={{ marginBottom: 28, background: '#f0f4fa', border: '1px solid #c7d5ec', borderRadius: 8, padding: '16px 18px' }}>
            <div style={{ fontSize: 12, color: '#1B3A6B', fontWeight: 600, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Update Status
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => statusMutation.mutate(opt.value)}
                  disabled={ticket.status === opt.value || statusMutation.isPending}
                  style={{
                    padding: '5px 12px', borderRadius: 20, fontSize: 12, fontFamily: 'inherit',
                    cursor: ticket.status === opt.value ? 'default' : 'pointer',
                    border: ticket.status === opt.value ? `1.5px solid ${opt.color}` : '1.5px solid #e8e4df',
                    background: ticket.status === opt.value ? opt.color : '#fff',
                    color: ticket.status === opt.value ? '#fff' : '#555',
                    fontWeight: ticket.status === opt.value ? 600 : 400,
                    opacity: statusMutation.isPending ? .6 : 1,
                  }}
                >{opt.label}</button>
              ))}
              {statusMsg && <span style={{ fontSize: 12, color: '#16a34a', marginLeft: 8 }}>{statusMsg}</span>}
            </div>
          </div>
        )}

        {/* Comments */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: '#8c8279', fontWeight: 600, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Comments ({ticket.comments?.length ?? 0})
          </div>

          {ticket.comments?.length === 0 && (
            <div style={{ fontSize: 13, color: '#b5aea7', marginBottom: 16 }}>No comments yet.</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {ticket.comments?.map((c: any) => (
              <div key={c.id} style={{
                background: '#faf9f7', border: '1px solid #e8e4df', borderRadius: 8, padding: '12px 16px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#1B3A6B' }}>{c.created_by_name}</span>
                  <span style={{ fontSize: 11, color: '#b5aea7' }}>
                    {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: '#333', whiteSpace: 'pre-wrap' }}>{c.text}</div>
              </div>
            ))}
          </div>

          {/* Add comment */}
          {!isClosed && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Add a comment…"
                rows={3}
                style={{
                  flex: 1, padding: '10px 12px', border: '1px solid #e8e4df', borderRadius: 8,
                  fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                  background: '#faf9f7',
                }}
              />
              <button
                onClick={() => commentMutation.mutate()}
                disabled={!comment.trim() || commentMutation.isPending}
                style={{
                  padding: '10px 16px', borderRadius: 8, border: 'none',
                  background: !comment.trim() || commentMutation.isPending ? '#b5aea7' : '#1B3A6B',
                  color: '#fff', cursor: !comment.trim() || commentMutation.isPending ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 13, fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap',
                }}
              >
                <Send size={13} /> {commentMutation.isPending ? 'Sending…' : 'Comment'}
              </button>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
