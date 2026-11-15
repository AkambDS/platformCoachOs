// Turn a DRF error response into one readable line, naming the field each message
// belongs to — "LinkedIn: Enter a valid URL." instead of a bare "Enter a valid URL."
// that leaves the user guessing which of 20 inputs is wrong.

const FIELD_LABELS: Record<string, string> = {
  linkedin_url: 'LinkedIn',
  website: 'Website',
  email: 'Email',
  email_2: 'Email 2',
  phone: 'Phone',
  phone_2: 'Phone 2',
  first_name: 'First name',
  last_name: 'Last name',
  birth_date: 'Birthday',
  primary_address: 'Address',
  billing_address: 'Billing address',
  start_at: 'Start time',
  end_at: 'End time',
  non_field_errors: '',
}

function label(key: string): string {
  if (key in FIELD_LABELS) return FIELD_LABELS[key]
  const s = key.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function flatten(v: unknown): string {
  if (v == null) return ''
  if (Array.isArray(v)) return v.map(flatten).filter(Boolean).join(' ')
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, sub]) => { const m = flatten(sub); const l = label(k); return m && (l ? `${l}: ${m}` : m) })
      .filter(Boolean).join(' · ')
  }
  return String(v)
}

export function apiErrorMessage(err: any, fallback = 'Something went wrong — please try again.'): string {
  const res = err?.response
  if (!res) return err?.message === 'Network Error' ? 'Could not reach the server — check your connection.' : fallback
  const data = res.data
  // A Django HTML error page (500) — never show raw HTML to the user.
  if (typeof data === 'string') return res.status >= 500 ? 'Server error — please try again, or contact support if it keeps happening.' : fallback
  if (data && typeof data === 'object') {
    const { detail, ...fields } = data as Record<string, unknown>
    return flatten(fields) || (detail ? String(detail) : fallback)
  }
  return fallback
}
