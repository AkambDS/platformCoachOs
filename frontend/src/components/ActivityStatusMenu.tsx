import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { STATUS_HEX } from './ui'

// One "Mark as ▾" menu for a session's status, used by the Calendar and Activities
// detail pop-ups instead of a row of per-status buttons. Same wording as the Calendar's
// Session Status legend. Not listed here:
//  - Pending  — not a status you set; it shows while a client-proposed time awaits review.
//  - Cancelled — has its own button: it emails the client and frees the slot.
// Changing status here sends no email (ActivitySerializer.update only emails on time/
// title/location changes or cancellation).
export const SETTABLE_STATUSES: { value: string; display: string; label: string; hint: string; afterStart?: boolean }[] = [
  { value: 'scheduled',   display: 'confirmed',   label: 'Confirmed',   hint: 'Booked, nothing outstanding' },
  { value: 'late',        display: 'late',        label: 'Late',        hint: 'Client running late' },
  { value: 'completed',   display: 'completed',   label: 'Completed',   hint: 'Session took place',  afterStart: true },
  { value: 'missed',      display: 'missed',      label: 'Missed',      hint: 'Client didn’t show', afterStart: true },
  { value: 'rescheduled', display: 'rescheduled', label: 'Rescheduled', hint: 'Needs a new time, none proposed yet' },
]

export function ActivityStatusMenu({ activity, onChange }: { activity: any; onChange: (status: string) => void }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const started = new Date(activity.start_at).getTime() <= Date.now()

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc, true) }
  }, [open])

  const toggle = () => {
    // Fixed position from the button — the modal scrolls (overflow-y: auto), which would
    // clip an absolutely positioned menu. Opens upward: the button sits in the footer.
    const r = btn.current?.getBoundingClientRect()
    if (r) setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 288)), bottom: window.innerHeight - r.top + 6 })
    setOpen(o => !o)
  }

  return (
    <>
      <button ref={btn} type="button" className="btn btn-sm btn-outline" onClick={toggle}
        style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        Mark as <ChevronDown size={13} />
      </button>
      {open && pos && (
        <div ref={menu} role="menu" style={{
          position: 'fixed', left: pos.left, bottom: pos.bottom, width: 280, zIndex: 2500,
          background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,.18)', padding: 6,
        }}>
          {SETTABLE_STATUSES.map(s => {
            const current = activity.status === s.value
            const blocked = !!s.afterStart && !started
            return (
              <button key={s.value} type="button" role="menuitem" disabled={current || blocked}
                title={blocked ? 'Available once the session has started' : undefined}
                onClick={() => { setOpen(false); onChange(s.value) }}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left',
                  padding: '8px 10px', border: 'none', borderRadius: 6, background: current ? '#f5f2ec' : 'transparent',
                  cursor: current || blocked ? 'default' : 'pointer', opacity: blocked ? 0.45 : 1,
                }}
                onMouseEnter={e => { if (!current && !blocked) e.currentTarget.style.background = '#faf8f4' }}
                onMouseLeave={e => { e.currentTarget.style.background = current ? '#f5f2ec' : 'transparent' }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, marginTop: 4, flexShrink: 0, background: STATUS_HEX[s.display] || '#8c8279' }} />
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{s.label}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)' }}>
                    {blocked ? 'After the session starts' : s.hint}
                  </span>
                </span>
                {current && <Check size={14} style={{ marginTop: 3, color: 'var(--muted)' }} />}
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}

// Toast text for a status change — "Marked as Completed".
export function statusChangedLabel(status: string) {
  const s = SETTABLE_STATUSES.find(x => x.value === status)
  return s ? `Marked as ${s.label}` : 'Status updated'
}
