import { useState, useEffect } from 'react'

const STORAGE_KEY = 'coachos_welcome_seen'

const slides = [
  {
    icon: '🎯',
    title: 'Welcome to CoachOS',
    body: 'Your all-in-one coaching management platform. Manage clients, sessions, pipeline, and invoices — all in one place.',
  },
  {
    icon: '👥',
    title: 'Manage Your Clients',
    body: 'Add client profiles, track session history, set goals, and monitor progress. Use the Pipeline to move prospects to active clients.',
  },
  {
    icon: '📅',
    title: 'Schedule & Remind',
    body: 'Log activities and sessions. CoachOS automatically sends reminders to your clients before each session.',
  },
  {
    icon: '💰',
    title: 'Invoicing & Reports',
    body: 'Create professional invoices, record payments, and generate revenue reports. Send invoices directly to clients via email.',
  },
  {
    icon: '🚀',
    title: "You're All Set!",
    body: 'Start by adding your first client. Click "Take a Tour" anytime from the dashboard to see a guided walkthrough.',
  },
]

interface Props {
  onStartTour: () => void
}

export default function WelcomeModal({ onStartTour }: Props) {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true)
    }
  }, [])

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
  }

  const handleStartTour = () => {
    dismiss()
    onStartTour()
  }

  if (!visible) return null

  const slide = slides[step]
  const isLast = step === slides.length - 1

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(10,20,40,.55)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '40px 44px',
        maxWidth: 480, width: '90%', boxShadow: '0 24px 80px rgba(0,0,0,.18)',
        position: 'relative',
      }}>
        {/* Close */}
        <button onClick={dismiss} style={{
          position: 'absolute', top: 16, right: 20,
          background: 'none', border: 'none', fontSize: 20,
          color: '#aaa', cursor: 'pointer', lineHeight: 1,
        }}>×</button>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 28 }}>
          {slides.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 20 : 6, height: 6, borderRadius: 3,
              background: i === step ? '#1e3a5f' : '#ddd',
              transition: 'all .3s',
            }} />
          ))}
        </div>

        {/* Icon */}
        <div style={{ fontSize: 42, marginBottom: 16 }}>{slide.icon}</div>

        {/* Content */}
        <div style={{
          fontFamily: 'Cormorant Garamond, serif',
          fontSize: 26, fontWeight: 500, color: '#1e3a5f',
          marginBottom: 12, lineHeight: 1.25,
        }}>{slide.title}</div>
        <p style={{ fontSize: 15, color: '#555', lineHeight: 1.7, marginBottom: 32 }}>
          {slide.body}
        </p>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={dismiss} style={{
            background: 'none', border: 'none', color: '#999',
            fontSize: 13, cursor: 'pointer',
          }}>Skip</button>

          <div style={{ display: 'flex', gap: 10 }}>
            {step > 0 && (
              <button onClick={() => setStep(s => s - 1)} style={{
                padding: '10px 20px', borderRadius: 8,
                border: '1.5px solid #ddd', background: '#fff',
                fontSize: 14, cursor: 'pointer', color: '#555',
              }}>Back</button>
            )}
            {isLast ? (
              <button onClick={handleStartTour} style={{
                padding: '10px 24px', borderRadius: 8,
                background: '#1e3a5f', color: '#fff',
                border: 'none', fontSize: 14, fontWeight: 600,
                cursor: 'pointer',
              }}>Take a Tour</button>
            ) : (
              <button onClick={() => setStep(s => s + 1)} style={{
                padding: '10px 24px', borderRadius: 8,
                background: '#1e3a5f', color: '#fff',
                border: 'none', fontSize: 14, fontWeight: 600,
                cursor: 'pointer',
              }}>Next →</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
