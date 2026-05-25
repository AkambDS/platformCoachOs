import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Paperclip, Trash2 } from 'lucide-react'
import { feedbackApi } from '../api/client'
import { useQueryClient } from '@tanstack/react-query'

type Category = 'bug' | 'feature' | 'ui' | 'performance' | 'general'
type Priority  = 'low' | 'medium' | 'high' | 'critical'

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'bug',         label: 'Bug' },
  { value: 'feature',     label: 'Feature Request' },
  { value: 'ui',          label: 'UI / UX' },
  { value: 'performance', label: 'Performance' },
  { value: 'general',     label: 'General' },
]

const PRIORITIES: { value: Priority; label: string; color: string }[] = [
  { value: 'low',      label: 'Low',      color: '#6b7280' },
  { value: 'medium',   label: 'Medium',   color: '#d97706' },
  { value: 'high',     label: 'High',     color: '#dc2626' },
  { value: 'critical', label: 'Critical', color: '#7c3aed' },
]

interface Props {
  open:       boolean
  onClose:    () => void
  onSuccess?: () => void
  /** Pass when editing an existing ticket */
  editTicket?: {
    id:              string
    title:           string
    description:     string
    category:        Category
    priority:        Priority
    screenshot_data: string
  }
}

export default function FeedbackFormModal({ open, onClose, onSuccess, editTicket }: Props) {
  const qc       = useQueryClient()
  const isEdit   = !!editTicket
  const pageUrl  = window.location.href

  const [title, setTitle]         = useState(editTicket?.title ?? '')
  const [description, setDesc]    = useState(editTicket?.description ?? '')
  const [category, setCategory]   = useState<Category>(editTicket?.category ?? 'bug')
  const [priority, setPriority]   = useState<Priority>(editTicket?.priority ?? 'medium')
  const [screenshot, setShot]     = useState<string>(editTicket?.screenshot_data ?? '')
  const [screenshotName, setShotName] = useState<string>(editTicket?.screenshot_data ? 'existing-screenshot' : '')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone]           = useState(false)
  const [error, setError]         = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Sync initial values when editTicket changes (re-open with new data)
  useEffect(() => {
    if (open) {
      setTitle(editTicket?.title ?? '')
      setDesc(editTicket?.description ?? '')
      setCategory(editTicket?.category ?? 'bug')
      setPriority(editTicket?.priority ?? 'medium')
      setShot(editTicket?.screenshot_data ?? '')
      setShotName(editTicket?.screenshot_data ? 'existing-screenshot' : '')
      setError(''); setDone(false)
    }
  }, [open, editTicket?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadImage = (file: File) => {
    if (!file.type.startsWith('image/')) { setError('Please attach an image file.'); return }
    if (file.size > 5 * 1024 * 1024)    { setError('Screenshot must be under 5 MB.'); return }
    setError('')
    const reader = new FileReader()
    reader.onload = (e) => { setShot(e.target?.result as string); setShotName(file.name) }
    reader.readAsDataURL(file)
  }

  const handlePaste = useCallback((e: ClipboardEvent) => {
    if (!open) return
    const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'))
    if (item) { const f = item.getAsFile(); if (f) { loadImage(f); setShotName('pasted-screenshot.png') } }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [handlePaste])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]; if (f) loadImage(f)
  }

  const handleSubmit = async () => {
    if (!title.trim())       { setError('Please enter a title.'); return }
    if (!description.trim()) { setError('Please describe the issue.'); return }
    setSubmitting(true); setError('')
    const payload = {
      title: title.trim(), description: description.trim(),
      category, priority, screenshot_data: screenshot,
      ...(!isEdit ? { page_url: pageUrl } : {}),
    }
    try {
      if (isEdit) {
        await feedbackApi.update(editTicket!.id, payload)
        qc.invalidateQueries({ queryKey: ['feedback', editTicket!.id] })
        qc.invalidateQueries({ queryKey: ['feedback'] })
      } else {
        await feedbackApi.create(payload)
        qc.invalidateQueries({ queryKey: ['feedback'] })
      }
      setDone(true)
      setTimeout(() => { onSuccess?.(); onClose() }, 1600)
    } catch {
      setError('Failed to submit. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)',
          zIndex: 1200, backdropFilter: 'blur(2px)',
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 1201,
          width: 460, maxHeight: '88vh', overflowY: 'auto',
          background: '#fff', borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,.24)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid #e8e4df',
          position: 'sticky', top: 0, background: '#fff', zIndex: 1,
        }}>
          <div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: '#1B3A6B', fontWeight: 600 }}>
              {isEdit ? 'Edit Ticket' : 'New Feedback Ticket'}
            </div>
            <div style={{ fontSize: 11, color: '#8c8279', marginTop: 2 }}>
              {isEdit ? 'Update the details below' : 'Report a bug or suggest an improvement'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8c8279', padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {done ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 15, color: '#1B3A6B', fontWeight: 600, marginBottom: 6 }}>
              {isEdit ? 'Ticket updated!' : 'Feedback submitted!'}
            </div>
          </div>
        ) : (
          <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Category */}
            <div>
              <label style={{ fontSize: 12, color: '#8c8279', display: 'block', marginBottom: 7 }}>Category</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {CATEGORIES.map(c => (
                  <button key={c.value} onClick={() => setCategory(c.value)} style={{
                    padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                    border: category === c.value ? '1.5px solid #1B3A6B' : '1.5px solid #e8e4df',
                    background: category === c.value ? '#1B3A6B' : '#faf9f7',
                    color: category === c.value ? '#fff' : '#555',
                  }}>{c.label}</button>
                ))}
              </div>
            </div>

            {/* Priority */}
            <div>
              <label style={{ fontSize: 12, color: '#8c8279', display: 'block', marginBottom: 7 }}>Priority</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {PRIORITIES.map(p => (
                  <button key={p.value} onClick={() => setPriority(p.value)} style={{
                    padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                    border: priority === p.value ? `1.5px solid ${p.color}` : '1.5px solid #e8e4df',
                    background: priority === p.value ? p.color : '#faf9f7',
                    color: priority === p.value ? '#fff' : '#555',
                  }}>{p.label}</button>
                ))}
              </div>
            </div>

            {/* Title */}
            <div>
              <label style={{ fontSize: 12, color: '#8c8279', display: 'block', marginBottom: 7 }}>Title *</label>
              <input
                value={title} onChange={e => setTitle(e.target.value)}
                placeholder="Brief summary of the issue or request…"
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '9px 11px',
                  border: '1px solid #e8e4df', borderRadius: 6, fontSize: 13,
                  fontFamily: 'inherit', outline: 'none', background: '#faf9f7',
                }}
              />
            </div>

            {/* Description */}
            <div>
              <label style={{ fontSize: 12, color: '#8c8279', display: 'block', marginBottom: 7 }}>Description *</label>
              <textarea
                value={description} onChange={e => setDesc(e.target.value)}
                placeholder="Steps to reproduce, expected vs actual behaviour, context…"
                rows={5}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '9px 11px',
                  border: '1px solid #e8e4df', borderRadius: 6, fontSize: 13,
                  fontFamily: 'inherit', resize: 'vertical', outline: 'none', background: '#faf9f7',
                }}
              />
            </div>

            {/* Screenshot */}
            <div>
              <label style={{ fontSize: 12, color: '#8c8279', display: 'block', marginBottom: 7 }}>
                Screenshot <span style={{ color: '#b5aea7' }}>(optional — paste Ctrl+V or upload)</span>
              </label>
              {screenshot ? (
                <div style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', border: '1px solid #e8e4df' }}>
                  <img src={screenshot} alt="screenshot" style={{ width: '100%', display: 'block', maxHeight: 180, objectFit: 'cover' }} />
                  <button
                    onClick={() => { setShot(''); setShotName('') }}
                    style={{
                      position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.6)',
                      border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer',
                      padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11,
                    }}
                  >
                    <Trash2 size={11} /> Remove
                  </button>
                  <div style={{ padding: '4px 8px', fontSize: 11, color: '#8c8279', background: '#f5f5f0' }}>
                    {screenshotName}
                  </div>
                </div>
              ) : (
                <div
                  onDrop={handleDrop} onDragOver={e => e.preventDefault()}
                  onClick={() => fileRef.current?.click()}
                  style={{
                    border: '1.5px dashed #d5cfc9', borderRadius: 6, padding: '20px',
                    textAlign: 'center', cursor: 'pointer', background: '#faf9f7',
                    color: '#8c8279', fontSize: 12, transition: 'border-color .15s, background .15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1B3A6B'; (e.currentTarget as HTMLElement).style.background = '#f0f4fa' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#d5cfc9'; (e.currentTarget as HTMLElement).style.background = '#faf9f7' }}
                >
                  <Paperclip size={14} style={{ marginBottom: 6 }} />
                  <div>Click to upload or drag & drop</div>
                  <div style={{ color: '#b5aea7', marginTop: 3, fontSize: 11 }}>PNG, JPG up to 5 MB · or Ctrl+V to paste</div>
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) loadImage(f); e.target.value = '' }}
              />
            </div>

            {!isEdit && (
              <div style={{ fontSize: 11, color: '#b5aea7' }}>
                Page: <span style={{ fontFamily: 'monospace' }}>{pageUrl.replace(/^https?:\/\/[^/]+/, '')}</span>
              </div>
            )}

            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#dc2626' }}>
                {error}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
              <button
                onClick={onClose}
                style={{
                  padding: '9px 18px', borderRadius: 6, border: '1px solid #e8e4df',
                  background: '#fff', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', color: '#555',
                }}
              >Cancel</button>
              <button
                onClick={handleSubmit} disabled={submitting}
                style={{
                  padding: '9px 22px', borderRadius: 6, border: 'none',
                  background: submitting ? '#8ca5c8' : '#1B3A6B',
                  color: '#fff', cursor: submitting ? 'not-allowed' : 'pointer',
                  fontSize: 13, fontFamily: 'inherit', fontWeight: 600,
                }}
              >
                {submitting ? (isEdit ? 'Saving…' : 'Submitting…') : (isEdit ? 'Save Changes' : 'Submit Ticket')}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
