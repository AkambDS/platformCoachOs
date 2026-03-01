import { ReactNode, useEffect, useState } from 'react'

// ── Toast ──────────────────────────────────────────────────────────────────────
interface ToastProps { message: string; type?: 'success' | 'error' | 'info'; onDone: () => void }

export function Toast({ message, type = 'info', onDone }: ToastProps) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t) }, [onDone])
  return <div className={`toast ${type}`}>{message}</div>
}

// ── useToast ───────────────────────────────────────────────────────────────────
export function useToast() {
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null)
  const show = (msg: string, type: 'success' | 'error' | 'info' = 'success') => setToast({ msg, type })
  const el = toast ? <Toast message={toast.msg} type={toast.type} onDone={() => setToast(null)} /> : null
  return { show, el }
}

// ── Modal ──────────────────────────────────────────────────────────────────────
interface ModalProps { title: string; onClose: () => void; children: ReactNode; size?: 'md' | 'lg'; footer?: ReactNode }

export function Modal({ title, onClose, children, size = 'md', footer }: ModalProps) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal ${size === 'lg' ? 'modal-lg' : ''}`}>
        <div className="modal-hdr">
          <div className="modal-title">{title}</div>
          <button onClick={onClose} className="btn btn-ghost btn-sm" style={{ fontSize: 18, padding: '2px 8px' }}>×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

// ── Spinner ────────────────────────────────────────────────────────────────────
export function Spinner({ dark }: { dark?: boolean }) {
  return <span className={`spinner ${dark ? 'spinner-dark' : ''}`} />
}

// ── EmptyState ─────────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, message, action }: {
  icon?: string; title: string; message?: string; action?: ReactNode
}) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {message && <p style={{ marginBottom: 16 }}>{message}</p>}
      {action}
    </div>
  )
}

// ── ConfirmDialog ──────────────────────────────────────────────────────────────
export function ConfirmDialog({ message, onConfirm, onCancel, confirmLabel = 'Confirm', danger = false }: {
  message: string; onConfirm: () => void; onCancel: () => void; confirmLabel?: string; danger?: boolean
}) {
  return (
    <Modal title="Confirm" onClose={onCancel} footer={
      <>
        <button className="btn btn-outline btn-sm" onClick={onCancel}>Cancel</button>
        <button className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-dark'}`} onClick={onConfirm}>{confirmLabel}</button>
      </>
    }>
      <p style={{ fontSize: 14, color: '#333' }}>{message}</p>
    </Modal>
  )
}

// ── StatusBadge ────────────────────────────────────────────────────────────────
const STATUS_COLOURS: Record<string, string> = {
  draft: 'pill-grey', sent: 'pill-blue', paid: 'pill-green',
  overdue: 'pill-red', void: 'pill-grey', refunded: 'pill-grey', partially_paid: 'pill-gold',
  active: 'pill-green', completed: 'pill-grey', paused: 'pill-gold',
  scheduled: 'pill-blue', missed: 'pill-red', cancelled: 'pill-grey',
  active_client: 'pill-green', lead_new: 'pill-grey', proposal_sent: 'pill-gold',
  verbal_yes: 'pill-green', closed_lost: 'pill-red', on_hold: 'pill-grey',
}
export function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLOURS[status] || 'pill-grey'
  return <span className={`pill ${cls}`}>{status.replace(/_/g, ' ')}</span>
}

// ── PageHeader ─────────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <div className="page-title">{title}</div>
        {subtitle && <div className="page-subtitle">{subtitle}</div>}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}
