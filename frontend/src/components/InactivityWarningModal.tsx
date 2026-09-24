/**
 * Shared "Still there?" idle warning modal — used by both the coach app (App.tsx)
 * and the client portal (ClientPortal.tsx) so the two auth scopes present the same
 * idle-timeout UX instead of drifting apart. Copy assumes the default
 * useInactivityTimer() thresholds (15 min warn / 30 min total) — pass warnMinutes /
 * logoutMinutes if a caller ever overrides them.
 */
export default function InactivityWarningModal({
  onStay,
  onLogout,
  warnMinutes = 15,
  logoutMinutes = 30,
}: {
  onStay: () => void
  onLogout: () => void
  warnMinutes?: number
  logoutMinutes?: number
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff', borderRadius: 10, padding: '36px 32px',
        maxWidth: 400, width: '90%', textAlign: 'center',
        boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
      }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>⏱</div>
        <h3 style={{ margin: '0 0 8px', fontSize: 18, color: '#1a1714' }}>Still there?</h3>
        <p style={{ fontSize: 14, color: '#6b6b6b', margin: '0 0 24px', lineHeight: 1.5 }}>
          You've been inactive for {warnMinutes} minutes.<br />
          You'll be logged out automatically in {logoutMinutes - warnMinutes} minutes.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button
            onClick={onStay}
            style={{
              padding: '9px 22px', borderRadius: 6, border: 'none',
              background: '#1a2f4e', color: '#fff', fontWeight: 600,
              fontSize: 13, cursor: 'pointer',
            }}
          >
            Stay logged in
          </button>
          <button
            onClick={onLogout}
            style={{
              padding: '9px 22px', borderRadius: 6,
              border: '1px solid #d0cbc4', background: '#fff',
              color: '#6b6b6b', fontSize: 13, cursor: 'pointer',
            }}
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  )
}
