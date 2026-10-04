import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export type EmailStarter = { subject: string; intro: string; closing: string; show_logo?: boolean; style: Record<string, any> }

// GET /api/settings/email-use-cases/ — the backend's notice registry plus the starter
// content for every email except invoice / client communication (tasks/email_starters.py).
// The starter is both what an un-customized email sends and what the editors open with,
// so it lives only on the server.
export function useEmailUseCases() {
  const { data, isLoading } = useQuery({
    queryKey: ['email-use-cases'],
    queryFn: () => api.get('/api/settings/email-use-cases/').then(r => r.data as {
      notices: any[]; starters: Record<string, EmailStarter>
    }),
    staleTime: Infinity,
  })
  return { notices: data?.notices || [], starters: data?.starters || {}, isLoading }
}
