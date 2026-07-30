import { useEffect, useRef, useState } from 'react'

// Office file types OnlyOffice can open for real-time in-browser editing
export const EDITABLE_OFFICE_EXTS = ['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp', 'pdf']

let onlyofficeScriptPromise: Promise<void> | null = null
export function loadOnlyOfficeScript(serverUrl: string): Promise<void> {
  if ((window as any).DocsAPI) return Promise.resolve()
  if (onlyofficeScriptPromise) return onlyofficeScriptPromise
  onlyofficeScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `${serverUrl}/web-apps/apps/api/documents/api.js`
    script.onload = () => resolve()
    script.onerror = () => { onlyofficeScriptPromise = null; reject(new Error('Could not reach the document editor server')) }
    document.body.appendChild(script)
  })
  return onlyofficeScriptPromise
}

type EditConfigFetcher = (mode: 'view' | 'edit') => Promise<{ config: any; server_url: string }>

/** Full-screen live editor modal — used both by Library (KnowledgeItem) and by
 * client Files (Assessment) to edit Office/PDF documents in-browser via OnlyOffice.
 * `getEditConfig` fetches the backend-built OnlyOffice config for the item being edited;
 * saving happens automatically through OnlyOffice's own callback to the backend. */
export function OfficeEditorModal({ title, getEditConfig, onClose, onSaved }: {
  title: string
  getEditConfig: EditConfigFetcher
  onClose: () => void
  onSaved: () => void
}) {
  const editorRef = useRef<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const { config, server_url } = await getEditConfig('edit')
        await loadOnlyOfficeScript(server_url)
        if (cancelled) return
        editorRef.current = new (window as any).DocsAPI.DocEditor('onlyoffice-editor-root', {
          ...config,
          width: '100%',
          height: '100%',
        })
        setLoading(false)
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.response?.data?.detail || e?.message || 'Could not open the editor')
          setLoading(false)
        }
      }
    }
    init()
    return () => {
      cancelled = true
      try { editorRef.current?.destroyEditor?.() } catch { /* noop */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,14,.6)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid var(--border)', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        {!error && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Editing live — changes save automatically. Use File → Download as… in the editor to save a PDF copy.</span>}
        <button className="btn btn-dark btn-sm" onClick={() => { onSaved(); onClose() }}>Done</button>
      </div>
      <div style={{ flex: 1, position: 'relative', background: '#f4f2ee' }}>
        {loading && !error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>
            Loading editor…
          </div>
        )}
        {error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', color: '#c0392b', fontSize: 13, padding: 20, textAlign: 'center' }}>
            {error}
            <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
          </div>
        )}
        <div id="onlyoffice-editor-root" style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  )
}

/** Read-only inline preview, embedded within a panel (e.g. Library's file preview). */
export function InlineOfficeViewer({ itemKey, getEditConfig }: { itemKey: string; getEditConfig: EditConfigFetcher }) {
  const editorRef = useRef<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const containerId = `onlyoffice-preview-${itemKey}`

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    async function init() {
      try {
        const { config, server_url } = await getEditConfig('view')
        await loadOnlyOfficeScript(server_url)
        if (cancelled) return
        editorRef.current = new (window as any).DocsAPI.DocEditor(containerId, {
          ...config,
          width: '100%',
          height: '100%',
        })
        setLoading(false)
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.response?.data?.detail || 'Preview unavailable')
          setLoading(false)
        }
      }
    }
    init()
    return () => {
      cancelled = true
      try { editorRef.current?.destroyEditor?.() } catch { /* noop */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey])

  return (
    <div style={{ position: 'relative', width: '100%', height: 'max(600px, calc(100vh - 340px))', background: '#f4f2ee' }}>
      {loading && !error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Loading preview…
        </div>
      )}
      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13, padding: 20, textAlign: 'center' }}>
          {error}
        </div>
      )}
      <div id={containerId} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
