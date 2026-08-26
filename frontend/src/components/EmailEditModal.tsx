import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, settingsApi } from '../api/client'
import { Modal, useToast } from './ui'
import { useAuthStore } from '../store/auth'

export type EmailUseCase = 'invoice' | 'confirmation'

// Mirrors backend/tasks/email.py's plain-text defaults for each use case — shown here
// must match what actually sends when the Body field is left untouched, so the left
// (editable) and right (preview) panels never show different content.
const DEFAULT_BODY: Record<EmailUseCase, string> = {
  invoice:
    'Hi {client_name},\n' +
    '\n' +
    'Please find your invoice attached.\n' +
    '\n' +
    "You've received an invoice for ${amount} with payment due on {due_date}.\n" +
    '\n' +
    '{view_instructions}',
  confirmation:
    'Hi {client_name},\n' +
    '\n' +
    'Your session with {coach_name} has been scheduled. We look forward to seeing you.\n' +
    '\n' +
    'Need to reschedule or have questions? Contact {coach_name} directly.',
}

const VARIABLE_HINTS: Record<EmailUseCase, string[]> = {
  invoice: ['{client_name}', '{invoice_number}', '{amount}', '{due_date}', '{view_instructions}'],
  confirmation: ['{client_name}', '{coach_name}', '{session_title}', '{session_time}'],
}

// Every Layout checkbox starts unchecked for every use case — nothing changes for real
// emails until a coach deliberately opts in and saves. Keyed by use case (rather than a
// single flat default) in case a future use case ever needs a different starting point.
const DEFAULT_LAYOUT_CHECKED: Record<EmailUseCase, boolean> = {
  invoice: false,
  confirmation: false,
}

function fmtSize(bytes: number) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Edits the workspace's shared default email template for a given use case
// (workspace.email_templates[useCase]) — currently "invoice" and "confirmation"
// (the session-scheduled email). Style/font/color editing was removed — sends always
// use the fixed default look that the backend falls back to when no style is saved.
// Header/footer/heading/sign-off visibility and attachments are the knobs kept, since
// they change what's actually delivered rather than just how it looks.
//
// Used two ways: inline as a tab (no onClose — it's not dismissible, so nothing is
// lost by an accidental outside click) and inside a Modal (onClose provided, renders
// a Cancel button).
export function EmailTemplateEditor({ onClose, title, useCase = 'invoice' }: {
  onClose?: () => void; title?: string; useCase?: EmailUseCase
}) {
  const { workspace, user, rehydrate } = useAuthStore()
  const { show, el: toastEl } = useToast()
  const qc = useQueryClient()

  const saved      = (workspace as any)?.email_templates?.[useCase] || {}
  const savedStyle = saved.style || {}
  const defaultChecked = DEFAULT_LAYOUT_CHECKED[useCase]

  const [subject,    setSubject]    = useState<string>(saved.subject || '')
  const [body,       setBody]       = useState<string>(saved.intro   || DEFAULT_BODY[useCase])
  const [showHeader,    setShowHeader]    = useState<boolean>(savedStyle.show_header ?? defaultChecked)
  const [showFooter,    setShowFooter]    = useState<boolean>(savedStyle.show_footer ?? defaultChecked)
  const [showHeading,   setShowHeading]   = useState<boolean>(savedStyle.show_heading ?? defaultChecked)
  const [showSignature, setShowSignature] = useState<boolean>(savedStyle.show_signature ?? defaultChecked)
  const [attachments,   setAttachments]   = useState<any[]>(saved.attachments || [])
  const [uploadingFile, setUploadingFile] = useState(false)
  const [previewHtml,    setPreviewHtml]    = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [saving,         setSaving]         = useState(false)

  const renderPreview = async () => {
    setPreviewLoading(true)
    try {
      const { data } = await api.get('/api/settings/email-preview/', {
        params: {
          type: useCase, _t: Date.now(), intro: body, closing: '',
          show_header: showHeader, show_footer: showFooter,
          show_heading: showHeading, show_signature: showSignature,
        },
      })
      setPreviewHtml(data.html || '')
    } catch { setPreviewHtml('') }
    finally { setPreviewLoading(false) }
  }

  useEffect(() => { renderPreview() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => renderPreview(), 700)
    return () => clearTimeout(t)
  }, [body, showHeader, showFooter, showHeading, showSignature]) // eslint-disable-line react-hooks/exhaustive-deps

  // Merges a partial update into the saved template and pushes it into the auth store
  // so every other open view (Review-before-sending, New/Edit Invoice, Schedule Activity)
  // reflects it immediately instead of showing whatever was cached before this edit.
  const patchStoreTemplate = (patch: any) => {
    const existing = (workspace as any)?.email_templates || {}
    const updated  = { ...existing, [useCase]: { ...existing[useCase], ...patch } }
    if (user) rehydrate(user, { ...(workspace as any), email_templates: updated })
    qc.invalidateQueries({ queryKey: ['invoice'] })
    qc.invalidateQueries({ queryKey: ['invoices'] })
    qc.invalidateQueries({ queryKey: ['activities'] })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const existing = (workspace as any)?.email_templates || {}
      const updated  = {
        ...existing,
        [useCase]: {
          ...saved, subject, intro: body, closing: '',
          style: { ...savedStyle, show_header: showHeader, show_footer: showFooter, show_heading: showHeading, show_signature: showSignature },
        },
      }
      const { data } = await settingsApi.updateWorkspace({ email_templates: updated })
      if (user) rehydrate(user, { ...(workspace as any), ...data, email_templates: updated })
      qc.invalidateQueries({ queryKey: ['invoice'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['activities'] })
      show('Email template saved')
    } catch { show('Failed to save', 'error') }
    finally { setSaving(false) }
  }

  // Clears the editor back to the meaningful, fully-editable standard template — only
  // in local state, so nothing actually changes until Save is clicked. Exists because
  // early testing/typos can leave a real template looking like "Hi Xyz, Pls fin d..."
  // with no easy way back to something presentable short of retyping it from scratch.
  const handleResetToDefault = () => {
    setSubject('')
    setBody(DEFAULT_BODY[useCase])
    setShowHeader(defaultChecked)
    setShowFooter(defaultChecked)
    setShowHeading(defaultChecked)
    setShowSignature(defaultChecked)
  }

  const handleUploadAttachment = async (file: File) => {
    setUploadingFile(true)
    try {
      const { data } = await settingsApi.uploadEmailTemplateAttachment(useCase, file)
      setAttachments(data.attachments)
      patchStoreTemplate({ attachments: data.attachments })
    } catch { show('Failed to upload attachment', 'error') }
    finally { setUploadingFile(false) }
  }

  const handleRemoveAttachment = async (s3Key: string) => {
    try {
      const { data } = await settingsApi.removeEmailTemplateAttachment(useCase, s3Key)
      setAttachments(data.attachments)
      patchStoreTemplate({ attachments: data.attachments })
    } catch { show('Failed to remove attachment', 'error') }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: title ? 'space-between' : 'flex-end',
        paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        {title && (
          <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 400, color: 'var(--ink)', margin: 0 }}>
            {title}
          </h3>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button type="button" onClick={handleResetToDefault}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 12, textDecoration: 'underline', padding: 0 }}>
            Reset to default
          </button>
          {onClose && <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>}
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '9px 22px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#1a2f4e', color: '#fff', fontSize: 12, fontWeight: 700, letterSpacing: '.06em' }}>
            {saving ? 'Saving…' : 'SAVE TEMPLATE'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 0, flex: 1, minHeight: 0 }}>

        {/* Left panel — every editable field lives here */}
        <div style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '0 20px 8px 0' }}>
          <div className="fgroup">
            <label className="flabel">Subject line</label>
            <input className="finput" placeholder="Leave blank for default"
              value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
          <div className="fgroup">
            <label className="flabel">Body</label>
            <textarea className="finput" rows={9} style={{ resize: 'vertical' }}
              value={body} onChange={e => setBody(e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              This is the entire email body, exactly as shown in the preview — edit or delete any of it freely.
              Variables: {VARIABLE_HINTS[useCase].map(v => (
                <code key={v} style={{ background: '#f0f4ff', padding: '1px 4px', borderRadius: 3, fontSize: 10, marginRight: 4 }}>{v}</code>
              ))}
            </div>
          </div>

          <div className="fgroup">
            <label className="flabel">Layout</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: 'var(--ink)' }}>
                <input type="checkbox" checked={showHeader} onChange={e => setShowHeader(e.target.checked)}
                  style={{ width: 14, height: 14, accentColor: 'var(--gold)' }} />
                Show header (brand bar)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: 'var(--ink)' }}>
                <input type="checkbox" checked={showFooter} onChange={e => setShowFooter(e.target.checked)}
                  style={{ width: 14, height: 14, accentColor: 'var(--gold)' }} />
                Show footer (contact line)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: 'var(--ink)' }}>
                <input type="checkbox" checked={showHeading} onChange={e => setShowHeading(e.target.checked)}
                  style={{ width: 14, height: 14, accentColor: 'var(--gold)' }} />
                Show heading ({useCase === 'invoice' ? '"sent you an invoice"' : '"your session is confirmed"'})
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: 'var(--ink)' }}>
                <input type="checkbox" checked={showSignature} onChange={e => setShowSignature(e.target.checked)}
                  style={{ width: 14, height: 14, accentColor: 'var(--gold)' }} />
                Show sign-off ("Thanks! / business name")
              </label>
            </div>
          </div>

          <div className="fgroup" style={{ flex: 1 }}>
            <label className="flabel">Attachments</label>
            {attachments.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                {attachments.map((a: any) => (
                  <div key={a.s3_key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '5px 8px', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 5 }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink)' }} title={a.file_name}>
                      {a.file_name}
                    </span>
                    <span style={{ color: 'var(--muted)', fontSize: 11, flexShrink: 0 }}>{fmtSize(a.size)}</span>
                    <button type="button" onClick={() => handleRemoveAttachment(a.s3_key)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', fontSize: 13, padding: 0, lineHeight: 1, flexShrink: 0 }}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <label style={{
              display: 'inline-block', fontSize: 12, cursor: uploadingFile ? 'default' : 'pointer',
              padding: '7px 14px', borderRadius: 6, border: '1px dashed var(--border)',
              color: 'var(--muted)', background: 'var(--paper)',
            }}>
              {uploadingFile ? 'Uploading…' : '+ Add attachment'}
              <input type="file" disabled={uploadingFile} style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadAttachment(f); e.target.value = '' }} />
            </label>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
              Any file type (doc, PDF, etc.) — sent with every email using this template. Max 10 MB each.
            </div>
          </div>
        </div>

        {/* Right — live preview */}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', position: 'relative' }}>
          <div style={{ padding: '8px 14px', background: '#f5f3ef', border: '1px solid var(--border)', borderBottom: 'none', borderRadius: '6px 6px 0 0', fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', flexShrink: 0 }}>
            Live Preview
          </div>
          {previewLoading && (
            <div style={{ position: 'absolute', top: 36, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,.75)', zIndex: 1, fontSize: 12, color: 'var(--muted)' }}>
              Updating preview…
            </div>
          )}
          <iframe srcDoc={previewHtml} title="Email preview" sandbox="allow-same-origin"
            style={{ flex: 1, border: '1px solid var(--border)', display: 'block', width: '100%', height: '100%', borderRadius: '0 0 6px 6px' }} />
        </div>
      </div>
      {toastEl}
    </div>
  )
}

export function EmailEditModal({ onClose, useCase = 'invoice', title }: {
  onClose: () => void; useCase?: EmailUseCase; title?: string
}) {
  return (
    <Modal title={title || (useCase === 'confirmation' ? 'Session Confirmation Email Template' : 'Invoice Email Template')} size="lg" onClose={onClose}>
      <div style={{ height: 620 }}>
        <EmailTemplateEditor onClose={onClose} useCase={useCase} />
      </div>
    </Modal>
  )
}
