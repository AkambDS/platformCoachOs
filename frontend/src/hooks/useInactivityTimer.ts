import { useEffect, useRef, useCallback } from 'react'

const WARN_MS   = 15 * 60 * 1000  // 15 minutes → show warning
const LOGOUT_MS = 30 * 60 * 1000  // 30 minutes → auto logout

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']

export function useInactivityTimer({
  enabled,
  onWarn,
  onLogout,
}: {
  enabled: boolean
  onWarn: () => void
  onLogout: () => void
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
      logoutTimer.current = setTimeout(onLogout, LOGOUT_MS - WARN_MS)
    }, WARN_MS)
  }, [enabled, clear, onWarn, onLogout])

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
