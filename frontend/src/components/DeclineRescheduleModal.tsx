import { useState } from 'react'
import { Modal } from './ui'

// Shared by both Activities.tsx and Calendar.tsx's pending-request banners — unlike
// the detail/edit modals those two files each duplicate (see calendar.md §9.3), this
// is a new piece of UI, so it's built once here instead of adding a second copy of
// the duplication problem. Backend: ActivityViewSet.decline_reschedule
// (calendar.md §7.3/§9.2 Task 4) — clears requested_start_at only, no fixed email;
// the message/send choice here is entirely optional and off by default.
export function DeclineRescheduleModal({ onClose, onDecline }: {
  onClose: () => void
  onDecline: (message: string, sendEmail: boolean) => Promise<void>
}) {
  const [message, setMessage]   = useState('')
  const [sendEmail, setSendEmail] = useState(false)
  const [saving, setSaving]     = useState(false)

  const handleDecline = async () => {
    setSaving(true)
    try {
      await onDecline(message.trim(), sendEmail && !!message.trim())
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Decline Proposed Time"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-danger btn-sm" onClick={handleDecline} disabled={saving}>
            {saving ? 'Declining…' : 'Decline'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
        This clears the client's proposed time — nothing on the calendar changes, and
        the slot becomes available to your other clients again immediately.
      </p>
      <div className="fgroup">
        <label className="flabel">Message to client (optional)</label>
        <textarea
          className="finput"
          rows={4}
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="e.g. That time doesn't work for me — could you pick another from my availability?"
        />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: message.trim() ? 'pointer' : 'not-allowed', color: message.trim() ? 'var(--ink)' : 'var(--muted)' }}>
        <input
          type="checkbox"
          checked={sendEmail}
          disabled={!message.trim()}
          onChange={e => setSendEmail(e.target.checked)}
          style={{ width: 16, height: 16, cursor: 'inherit', accentColor: 'var(--gold)' }}
        />
        Send this message to the client
      </label>
    </Modal>
  )
}
