import { useState, useEffect } from 'react'

const STORAGE_KEY = 'coachos_welcome_seen'

const slides = [
  {
    title: 'Welcome to CoachOS',
    body: 'Your all-in-one coaching management platform. Manage clients, sessions, pipeline, and invoices — all in one place.',
  },
  {
    title: 'Manage Your Clients',
    body: 'Add client profiles, track session history, set goals, and monitor progress. Use the Pipeline to move prospects through to active clients.',
  },
  {
    title: 'Schedule & Remind',
    body: 'Log sessions and activities. CoachOS automatically sends confirmation emails and reminders to your clients before each session.',
  },
  {
    title: 'Invoicing & Reports',
    body: 'Create professional invoices, record payments, and generate revenue reports. Send invoices directly to clients via email.',
  },
  {
    title: "You're All Set",
    body: 'Start by adding your first client. Use the top navigation to move between Clients, Pipeline, Schedule, and Invoices.',
  },
]

interface Props {
  onStartTour: () => void
}

export default function WelcomeModal({ onStartTour }: Props) {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)
  const [dontShow, setDontShow] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setVisible(true)
  }, [])

  const dismiss = () => {
    // Only persist if user explicitly checked "don't show again"
    if (dontShow) localStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
  }

  const handleNext = () => {
    setStep(s => s + 1)
    // Never auto-persist on Next — only the checkbox controls this
  }

  const handleStartTour = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
    onStartTour()
  }

  if (!visible) return null

  const slide = slides[step]
  const isLast = step === slides.length - 1

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(26,23,20,.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--white)',
        border: '1px solid var(--border)',
        maxWidth: 500, width: '90%',
        boxShadow: 'var(--shadow-lg)',
        position: 'relative',
      }}>
        {/* Header bar */}
        <div style={{
          background: 'var(--ink)',
          padding: '28px 32px 24px',
        }}>
          <div style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 11, fontWeight: 600,
            letterSpacing: '.18em', textTransform: 'uppercase',
            color: 'var(--gold)', marginBottom: 10,
          }}>
            CoachOS
          </div>
          <div style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 30, fontWeight: 300,
            color: 'var(--paper)', lineHeight: 1.2,
          }}>
            {slide.title}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '24px 32px 20px' }}>
          {/* Progress dots */}
          <div style={{ display: 'flex', gap: 5, marginBottom: 20 }}>
            {slides.map((_, i) => (
              <div key={i} onClick={() => setStep(i)} style={{
                width: i === step ? 24 : 6, height: 4,
                background: i === step ? 'var(--gold)' : 'var(--border)',
                transition: 'all .3s', cursor: 'pointer',
              }} />
            ))}
          </div>

          <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.75, marginBottom: 28 }}>
            {slide.body}
          </p>

          {/* Don't show again */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', marginBottom: 24 }}>
            <input
              type="checkbox"
              checked={dontShow}
              onChange={e => setDontShow(e.target.checked)}
              style={{ width: 14, height: 14, accentColor: 'var(--gold)', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Don't show this again</span>
          </label>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={dismiss} style={{
              background: 'none', border: 'none',
              color: 'var(--muted)', fontSize: 12,
              cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
            }}>
              Skip
            </button>

            <div style={{ display: 'flex', gap: 8 }}>
              {step > 0 && (
                <button onClick={() => setStep(s => s - 1)} className="btn btn-outline btn-sm">
                  Back
                </button>
              )}
              {isLast ? (
                <button onClick={handleStartTour} className="btn btn-dark btn-sm">
                  Take a Tour →
                </button>
              ) : (
                <button onClick={handleNext} className="btn btn-dark btn-sm">
                  Next →
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
