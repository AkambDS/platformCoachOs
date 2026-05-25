import { useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import FeedbackFormModal from './FeedbackFormModal'

export default function FeedbackButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Send Feedback"
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
          width: 44, height: 44, borderRadius: '50%',
          background: '#1B3A6B', color: '#fff', border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,.25)', cursor: 'pointer',
          transition: 'transform .15s, box-shadow .15s',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.transform = 'scale(1.08)'
          ;(e.currentTarget as HTMLElement).style.boxShadow = '0 6px 16px rgba(0,0,0,.32)'
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.transform = 'scale(1)'
          ;(e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,.25)'
        }}
      >
        <MessageSquarePlus size={20} strokeWidth={1.75} />
      </button>

      <FeedbackFormModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}
