import { useEffect, useRef, useCallback } from 'react'

const DEFAULT_WARN_MS   = 15 * 60 * 1000  // 15 minutes → show warning
const DEFAULT_LOGOUT_MS = 30 * 60 * 1000  // 30 minutes → auto logout

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']

export function useInactivityTimer({
  enabled,
  onWarn,
  onLogout,
  warnMs   = DEFAULT_WARN_MS,
  logoutMs = DEFAULT_LOGOUT_MS,
}: {
  enabled: boolean
  onWarn: () => void
  onLogout: () => void
  // Overridable per caller — e.g. the client portal uses a longer window than the
  // coach app's default 15/30 min (see ClientPortal.tsx for why).
  warnMs?: number
  logoutMs?: number
}) {
  const warnTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warned      = useRef(false)

  const clear = useCallback(() => {
    if (warnTimer.current)   clearTimeout(warnTimer.current)
    if (logoutTimer.current) clearTimeout(logoutTimer.current)
  }, [])

  const reset = useCallback(() => {
    if (!enabled) return
    clear()
    warned.current = false
    warnTimer.current = setTimeout(() => {
      warned.current = true
      onWarn()
      logoutTimer.current = setTimeout(onLogout, logoutMs - warnMs)
    }, warnMs)
  }, [enabled, clear, onWarn, onLogout, warnMs, logoutMs])

  // Call from warning modal "Stay logged in" button
  const stayActive = useCallback(() => {
    reset()
  }, [reset])

  useEffect(() => {
    if (!enabled) { clear(); return }

    const handler = () => { if (!warned.current) reset() }
    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, handler, { passive: true }))
    reset()

    return () => {
      clear()
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, handler))
    }
  }, [enabled, reset, clear])

  return { stayActive }
}
