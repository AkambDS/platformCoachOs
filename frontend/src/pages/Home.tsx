import { Link } from 'react-router-dom'

// Public landing page at "/" — required by Google's OAuth verification review, which
// needs to see basic information about the app without signing in. Previously there was
// no route for "/" at all, so it fell through to the catch-all and redirected straight to
// /login, which Google's reviewer flagged as "home page is behind a login page."
function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #ede9e1', borderRadius: 10,
      padding: '24px 26px', flex: '1 1 260px', minWidth: 240,
    }}>
      <h3 style={{
        fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, fontSize: 19,
        color: '#16130f', margin: '0 0 8px',
      }}>{title}</h3>
      <p style={{ fontSize: 13.5, lineHeight: 1.65, color: '#6e6560', margin: 0 }}>{children}</p>
    </div>
  )
}

export default function Home() {
  return (
    <div style={{ minHeight: '100vh', background: '#faf8f4' }}>
      <header style={{
        background: '#1a2f4e', padding: '20px 24px', display: 'flex',
        alignItems: 'center', justifyContent: 'space-between', maxWidth: 960, margin: '0 auto',
      }}>
        <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: '#f7f4ef', letterSpacing: '.04em' }}>
          Coach<span style={{ color: '#d9b96a' }}>OS</span>
        </span>
        <Link to="/login" style={{
          fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
          color: '#f7f4ef', textDecoration: 'none', border: '1px solid rgba(247,244,239,.4)',
          borderRadius: 6, padding: '8px 16px',
        }}>Sign In</Link>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '64px 24px 88px' }}>
        <div style={{
          fontSize: 12, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
          color: '#a97e1f', marginBottom: 12,
        }}>Practice Management for Coaches</div>
        <h1 style={{
          fontFamily: "'Cormorant Garamond', serif", fontWeight: 500, fontSize: 44,
          lineHeight: 1.15, margin: '0 0 18px', color: '#16130f',
        }}>Run your coaching business from one place.</h1>
        <p style={{ fontSize: 15.5, lineHeight: 1.7, color: '#3a3530', margin: '0 0 40px', maxWidth: 560 }}>
          CoachOS is a practice-management platform for independent coaches and consulting
          businesses — client records, scheduling, session notes, invoicing, and payments,
          all in one workspace.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 48 }}>
          <Feature title="Scheduling">
            Book sessions, sync with Google Calendar, and automatically collect client
            confirmations and RSVPs.
          </Feature>
          <Feature title="Client Management">
            Track client details, pipeline stage, communication history, and goals in one
            record per client.
          </Feature>
          <Feature title="Invoicing & Payments">
            Send branded invoices and accept online card payments directly through your
            own Stripe account.
          </Feature>
        </div>

        <div style={{
          background: '#fff', border: '1px solid #ede9e1', borderRadius: 10,
          padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 12,
        }}>
          <span style={{ fontSize: 13.5, color: '#3a3530' }}>Already a CoachOS user?</span>
          <Link to="/login" style={{
            fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
            color: '#fff', background: '#1a2f4e', textDecoration: 'none', borderRadius: 6,
            padding: '10px 20px',
          }}>Sign In →</Link>
        </div>

        <div style={{ marginTop: 56, fontSize: 12.5, color: '#a89f93', display: 'flex', gap: 20 }}>
          <Link to="/privacy-policy" style={{ color: 'inherit' }}>Privacy Policy</Link>
          <Link to="/terms-of-service" style={{ color: 'inherit' }}>Terms of Service</Link>
        </div>
      </main>
    </div>
  )
}
