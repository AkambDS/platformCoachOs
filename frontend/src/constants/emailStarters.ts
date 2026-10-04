// Built-in wording the backend uses for a session template's heading when a saved
// template leaves it blank. Starter content itself is served by the backend — see
// hooks/useEmailUseCases.ts and backend/tasks/email_starters.py.
export const BUILTIN_TEXT: Record<string, { eyebrow: string; heading: string }> = {
  confirmation: { eyebrow: 'Session Confirmed', heading: 'Your session is confirmed' },
  reschedule:   { eyebrow: 'Session Updated',   heading: 'Your session has been updated' },
  reminder_24h: { eyebrow: 'Reminder · 24 hours away', heading: 'Session reminder' },
  reminder_1h:  { eyebrow: 'Upcoming in 1 hour', heading: 'Session reminder' },
}

export const SESSION_PLACEHOLDERS = [
  '{client_name}', '{client_first_name}', '{client_email}', '{client_address}',
  '{coach_name}', '{workspace_name}', '{session_title}', '{session_time}',
]
