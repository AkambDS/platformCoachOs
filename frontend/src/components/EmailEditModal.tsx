import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, settingsApi } from '../api/client'
import { Modal, useToast } from './ui'
import { useAuthStore } from '../store/auth'

export type EmailUseCase = 'invoice' | 'confirmation'

const USE_CASE_LABEL: Record<EmailUseCase, string> = {
  invoice: 'Invoice',
  confirmation: 'Booking Confirmation',
}

// Same starting copy as Settings → Generic Templates' USE_CASE_SAMPLES for these two use
// cases — used only when nothing has ever been assigned to this slot yet.
const USE_CASE_SAMPLE: Record<EmailUseCase, { subject: string; intro: string; closing: string }> = {
  confirmation: {
    subject: 'Confirmed: your session with {coach_name}',
    intro:   'Hi {client_name}, your session with {coach_name} has been scheduled. We look forward to seeing you.',
    closing: 'Need to reschedule or have questions? Contact {coach_name} directly.',
  },
  invoice: {
    subject: 'Invoice from {workspace_name}',
    intro:   "You've received a new invoice from {workspace_name}. Please see the attached details.",
    // "Thanks! / {workspace_name}" used to be a separate hardcoded sign-off block
    // (_invoice_signature_block, tasks/email.py) appended after whatever the coach
    // wrote — now it's just the tail of this same editable text, like every other
    // email type already works, so a coach can edit or remove it like anything else.
    closing: "Questions about this invoice? Just reply to this email.\n\nThanks!\n{workspace_name}",
  },
}

const HEADER_COLOR_PRESETS = [
  '#ffffff', '#1a2f4e', '#2d6a9f', '#4a7c59', '#7c4d9f', '#c0392b', '#1a1714',
]

const PLACEHOLDER_HINTS: Record<EmailUseCase, string[]> = {
  confirmation: ['{client_name}', '{client_first_name}', '{client_email}', '{client_address}', '{coach_name}', '{workspace_name}', '{session_title}', '{session_time}'],
  invoice:      ['{client_name}', '{client_first_name}', '{client_email}', '{client_address}', '{workspace_name}', '{invoice_number}', '{amount}', '{due_date}'],
}

function fmtSize(bytes: number) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Invoice edits as a single free-form "Message" box (matching Client Communication >
// New Message > Start Blank) instead of the Opening/Closing split confirmation still
// uses — see mergeInvoiceMessage below. Unlike Start Blank, invoice keeps a Footer
// section rather than a signature one (a signed invoice email doesn't make sense) —
// white header + logo is just this use case's starting look, same as Start Blank's.
const brToNewlines = (s: string) => (s || '').replace(/<br\s*\/?>/gi, '\n')
const mergeInvoiceMessage = (t: any, useCase: EmailUseCase) => {
  if (useCase !== 'invoice') return t
  const merged = [brToNewlines(t.intro), brToNewlines(t.closing)].map((s: string) => s.trim()).filter(Boolean).join('\n\n')
  return { ...t, intro: merged, closing: '' }
}

const blankTemplate = (useCase: EmailUseCase) => {
  const sample = USE_CASE_SAMPLE[useCase]
  return {
    id: `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: USE_CASE_LABEL[useCase],
    subject: sample.subject, intro: sample.intro, closing: sample.closing,
    custom_html: '', disable_style: false, show_logo: true,
    style: (useCase === 'invoice'
      // Same starting look as Client Communication > Start Blank — plain white header
      // (logo only, no color bar) and footer off until a coach opts in via "Customize".
      ? { header_bg: '#ffffff', accent_color: '#ffffff', header_tagline: '', show_header: true, show_footer: false, footer_text: '', show_contact_line: true }
      : { header_bg: '', accent_color: '', header_tagline: '', show_header: true, show_footer: true, footer_text: '', show_contact_line: true }) as Record<string, any>,
    use_cases: [useCase] as string[],
    include_client_signature_line: false,
  }
}

// The template that will actually be used to send this use case right now — whatever is
// assigned in template_use_case_map, or (if nothing is assigned yet) built-in starter
// content. Mirrors Settings' GenericTemplatesTab.getEffectiveDefault exactly, since this
// modal edits the same underlying data, just entered from the schedule/invoice screens
// instead of from Settings.
function getEffectiveTemplate(workspace: any, useCase: EmailUseCase) {
  const templates  = (workspace?.generic_templates as any[]) || []
  const useCaseMap = (workspace?.template_use_case_map as Record<string, string>) || {}
  const assignedId = useCaseMap[useCase]
  const assigned = assignedId ? templates.find(t => t.id === assignedId) : null
  if (assigned) {
    return mergeInvoiceMessage(
      { ...assigned, style: { header_bg: '', accent_color: '', header_tagline: '', show_header: true, show_footer: true, footer_text: '', show_contact_line: true, ...assigned.style } },
      useCase,
    )
  }
  return mergeInvoiceMessage(blankTemplate(useCase), useCase)
}

// Edits the workspace's default email template for a given use case. Reads from and
// saves into the SAME storage Settings → Generic Templates uses (workspace.generic_templates
// + workspace.template_use_case_map) — the two used to be separate systems (this modal wrote
// into the older, now-unused workspace.email_templates dict), which meant an edit made here
// could look correct in this modal's own preview yet never be what a real send resolves to,
// the moment any generic-template default existed for the same use case. Saving here now
// updates the exact same record that the send path (_resolve_generic_template) reads, and
// the initial content this modal loads is that same resolved record, so the live preview
// always reflects what would actually go out if nothing further changes.
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

  const [editing, setEditing] = useState<any>(() => getEffectiveTemplate(workspace, useCase))
  const [previewHtml,    setPreviewHtml]    = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [saving,         setSaving]         = useState(false)
  const [uploadingFile,  setUploadingFile]  = useState(false)
  // Collapsed behind a "+ Customize" link by default for invoice, matching Client
  // Communication > Start Blank (plain white/logo header, no footer, nothing to
  // configure up front) — but auto-expanded if the loaded template already has
  // non-default header/footer settings, so an existing customization is never hidden.
  const [showHeaderOptions, setShowHeaderOptions] = useState(() => {
    if (useCase !== 'invoice') return true
    const s = editing.style
    return s.show_header === false || !!s.header_tagline || (!!s.header_bg && s.header_bg.toLowerCase() !== '#ffffff')
  })
  const [showFooterOptions, setShowFooterOptions] = useState(() => useCase !== 'invoice' || editing.style.show_footer !== false)

  const setStyle = (k: string, v: string | boolean) => setEditing((e: any) => ({ ...e, style: { ...e.style, [k]: v } }))

  const renderPreview = async (t: any) => {
    setPreviewLoading(true)
    try {
      const params: Record<string, string> = {
        type: useCase, client_name: 'Jane Smith',
        subject: t.subject || 'Your subject line',
        intro: t.intro, closing: t.closing, _t: String(Date.now()),
      }
      if (t.style.header_bg)    params.header_bg = t.style.header_bg
      if (t.style.accent_color) params.accent_color = t.style.accent_color
      if (t.style.header_tagline !== undefined) params.header_tagline = t.style.header_tagline
      if (t.style.footer_text !== undefined) params.footer_text = t.style.footer_text
      if (!t.show_logo) params.hide_logo = '1'
      params.show_header = t.style.show_header === false ? '0' : '1'
      params.show_footer = t.style.show_footer === false ? '0' : '1'
      params.show_contact_line = t.style.show_contact_line === false ? '0' : '1'
      const { data } = await api.get('/api/settings/email-preview/', { params })
      setPreviewHtml(data.html || '')
    } catch { setPreviewHtml('') }
    finally { setPreviewLoading(false) }
  }

  useEffect(() => {
    const t = setTimeout(() => renderPreview(editing), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing.subject, editing.intro, editing.closing, editing.style.header_bg,
      editing.style.accent_color, editing.style.header_tagline, editing.style.show_header,
      editing.style.show_footer, editing.style.footer_text, editing.style.show_contact_line,
      editing.show_logo])

  const handleSave = async () => {
    setSaving(true)
    try {
      const templates  = ((workspace as any)?.generic_templates as any[]) || []
      const useCaseMap = ((workspace as any)?.template_use_case_map as Record<string, string>) || {}
      const tagged = { ...editing, use_cases: Array.from(new Set([...(editing.use_cases || []), useCase])) }
      const exists = templates.some(t => t.id === tagged.id)
      const nextTemplates = exists ? templates.map(t => t.id === tagged.id ? tagged : t) : [...templates, tagged]
      const nextMap = { ...useCaseMap, [useCase]: tagged.id }
      const { data } = await settingsApi.updateWorkspace({ generic_templates: nextTemplates, template_use_case_map: nextMap })
      if (user) rehydrate(user, { ...(workspace as any), ...data })
      setEditing(tagged)
      qc.invalidateQueries({ queryKey: ['invoice'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['activities'] })
      show(`Saved — now the default for ${USE_CASE_LABEL[useCase]}`)
    } catch { show('Failed to save', 'error') }
    finally { setSaving(false) }
  }

  // Clears the editor back to the meaningful, fully-editable standard template — only
  // in local state, so nothing actually changes until Save is clicked. Exists because
  // early testing/typos can leave a real template looking like "Hi Xyz, Pls fin d..."
  // with no easy way back to something presentable short of retyping it from scratch.
  const handleResetToDefault = () => {
    const blank = mergeInvoiceMessage(blankTemplate(useCase), useCase)
    setEditing((e: any) => ({ ...blank, id: e.id }))
  }

  // Attachments live on the template record itself. If this template hasn't been saved
  // yet (a brand-new, not-yet-assigned use case), save it first so the attachment has a
  // real template to attach to — otherwise the upload would have nowhere durable to land.
  const ensurePersisted = async (): Promise<any> => {
    const templates = ((workspace as any)?.generic_templates as any[]) || []
    if (templates.some(t => t.id === editing.id)) return editing
    const useCaseMap = ((workspace as any)?.template_use_case_map as Record<string, string>) || {}
    const tagged = { ...editing, use_cases: Array.from(new Set([...(editing.use_cases || []), useCase])) }
    const nextMap = { ...useCaseMap, [useCase]: tagged.id }
    const { data } = await settingsApi.updateWorkspace({ generic_templates: [...templates, tagged], template_use_case_map: nextMap })
    if (user) rehydrate(user, { ...(workspace as any), ...data })
    setEditing(tagged)
    return tagged
  }

  const handleUploadAttachment = async (file: File) => {
    setUploadingFile(true)
    try {
      const persisted = await ensurePersisted()
      const { data } = await settingsApi.uploadEmailTemplateAttachment(useCase, file, persisted.id)
      setEditing((e: any) => ({ ...e, attachments: data.attachments }))
    } catch { show('Failed to upload attachment', 'error') }
    finally { setUploadingFile(false) }
  }

  const handleRemoveAttachment = async (s3Key: string) => {
    try {
      const { data } = await settingsApi.removeEmailTemplateAttachment(useCase, s3Key, editing.id)
      setEditing((e: any) => ({ ...e, attachments: data.attachments }))
    } catch { show('Failed to remove attachment', 'error') }
  }

  const attachments: any[] = editing.attachments || []

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
              value={editing.subject} onChange={e => setEditing((ed: any) => ({ ...ed, subject: e.target.value }))} />
          </div>
          <div className="fgroup">
            <label className="flabel">{useCase === 'invoice' ? 'Message' : 'Body — Opening'}</label>
            <textarea className="finput" rows={useCase === 'invoice' ? 16 : 5} style={{ resize: 'vertical' }}
              value={editing.intro} onChange={e => setEditing((ed: any) => ({ ...ed, intro: e.target.value }))} />
          </div>
          {useCase !== 'invoice' && (
            <div className="fgroup">
              <label className="flabel">Body — Closing</label>
              <textarea className="finput" rows={3} style={{ resize: 'vertical' }}
                value={editing.closing} onChange={e => setEditing((ed: any) => ({ ...ed, closing: e.target.value }))} />
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: -6, marginBottom: 14, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {useCase === 'invoice' ? (
              <>
                Insert:
                {PLACEHOLDER_HINTS[useCase].map(v => (
                  <button
                    key={v}
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ padding: '2px 8px', fontSize: 11, fontFamily: 'monospace' }}
                    onClick={() => setEditing((ed: any) => ({ ...ed, intro: `${ed.intro}${ed.intro && !ed.intro.endsWith(' ') ? ' ' : ''}${v}` }))}
                  >
                    {v}
                  </button>
                ))}
              </>
            ) : (
              <>
                Variables: {PLACEHOLDER_HINTS[useCase].map(v => (
                  <code key={v} style={{ background: '#f0f4ff', padding: '1px 4px', borderRadius: 3, fontSize: 10, marginRight: 4 }}>{v}</code>
                ))}
              </>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: useCase === 'invoice' && !showHeaderOptions ? 0 : 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>Header</div>
              {useCase === 'invoice' ? (
                <button type="button" onClick={() => setShowHeaderOptions(s => !s)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 12, textDecoration: 'underline', padding: 0 }}>
                  {showHeaderOptions ? 'Hide options' : '+ Customize header'}
                </button>
              ) : (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={editing.style.show_header !== false} onChange={e => setStyle('show_header', e.target.checked)} />
                  Show header
                </label>
              )}
            </div>
            {useCase === 'invoice' && !showHeaderOptions && (
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Plain white header with your logo.</div>
            )}
            {(useCase !== 'invoice' || showHeaderOptions) && (
              <fieldset disabled={editing.style.show_header === false} style={{ border: 'none', padding: 0, margin: 0, opacity: editing.style.show_header === false ? 0.5 : 1 }}>
                {useCase === 'invoice' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink)', cursor: 'pointer', marginBottom: 10 }}>
                    <input type="checkbox" checked={editing.style.show_header !== false} onChange={e => setStyle('show_header', e.target.checked)} />
                    Show header
                  </label>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink)', cursor: 'pointer', marginBottom: 10 }}>
                  <input type="checkbox" checked={editing.show_logo} onChange={e => setEditing((ed: any) => ({ ...ed, show_logo: e.target.checked }))} />
                  Show workspace logo
                </label>
                <div className="fgroup" style={{ marginBottom: 0 }}>
                  <label className="flabel">Header Color</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
                    {HEADER_COLOR_PRESETS.map(c => (
                      <button
                        key={c} type="button"
                        onClick={() => setStyle('header_bg', c)}
                        title={c === '#ffffff' ? 'White' : c}
                        style={{
                          width: 18, height: 18, borderRadius: '50%', background: c, cursor: 'pointer',
                          border: (editing.style.header_bg || '#1a2f4e') === c ? '2px solid var(--ink)' : '1px solid rgba(0,0,0,.15)',
                          boxShadow: (editing.style.header_bg || '#1a2f4e') === c ? `0 0 0 2px white, 0 0 0 3px ${c}` : 'none',
                          padding: 0,
                        }}
                      />
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                    <input
                      type="color" value={editing.style.header_bg || '#1a2f4e'}
                      onChange={e => setStyle('header_bg', e.target.value)}
                      style={{ width: 30, height: 22, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 4, padding: 2 }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{editing.style.header_bg || '#1a2f4e'}</span>
                  </div>
                </div>
              </fieldset>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: useCase === 'invoice' && !showFooterOptions ? 0 : 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>Footer</div>
              {useCase === 'invoice' ? (
                <button type="button" onClick={() => setShowFooterOptions(s => !s)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 12, textDecoration: 'underline', padding: 0 }}>
                  {showFooterOptions ? 'Hide options' : '+ Customize footer'}
                </button>
              ) : (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={editing.style.show_footer !== false} onChange={e => setStyle('show_footer', e.target.checked)} />
                  Show footer
                </label>
              )}
            </div>
            {useCase === 'invoice' && !showFooterOptions && (
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Off by default — no footer sent.</div>
            )}
            {(useCase !== 'invoice' || showFooterOptions) && (
              <>
                {useCase === 'invoice' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink)', cursor: 'pointer', marginBottom: 10 }}>
                    <input type="checkbox" checked={editing.style.show_footer !== false} onChange={e => setStyle('show_footer', e.target.checked)} />
                    Show footer
                  </label>
                )}
                <fieldset disabled={editing.style.show_footer === false} style={{ border: 'none', padding: 0, margin: 0, opacity: editing.style.show_footer === false ? 0.5 : 1 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink)', cursor: 'pointer', marginBottom: 10 }}>
                    <input type="checkbox" checked={editing.style.show_contact_line !== false} onChange={e => setStyle('show_contact_line', e.target.checked)} />
                    Show "Questions? Contact us at…" line
                  </label>
                  <div className="fgroup" style={{ marginBottom: 0 }}>
                    <label className="flabel">Footer Text</label>
                    <textarea className="finput" rows={2} style={{ resize: 'vertical' }}
                      value={editing.style.footer_text ?? ''} onChange={e => setStyle('footer_text', e.target.value)}
                      placeholder="This is an automated notification — please do not reply directly to this email." />
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                      Leave blank to use the default disclaimer above.
                    </div>
                  </div>
                </fieldset>
              </>
            )}
          </div>

          <div className="fgroup" style={{ flex: 1, marginTop: 14 }}>
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

        {/* Right — live preview, rendered from the exact content that Save would persist */}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', position: 'relative' }}>
          <div style={{ padding: '8px 14px', background: '#f5f3ef', border: '1px solid var(--border)', borderBottom: 'none', borderRadius: '6px 6px 0 0', fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', flexShrink: 0 }}>
            Live Preview — this is what will actually send
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
