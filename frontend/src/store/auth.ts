import { create } from 'zustand'

interface User { id: string; email: string; full_name: string; role: string }

interface AuthState {
  user: User | null
  workspace: any | null
  isAuthenticated: boolean
  login: (tokens: { access: string; refresh: string }, user: User, workspace: any) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  workspace: null,
  isAuthenticated: !!localStorage.getItem('access_token'),
  login: (tokens, user, workspace) => {
    localStorage.setItem('access_token', tokens.access)
    localStorage.setItem('refresh_token', tokens.refresh)
    set({ user, workspace, isAuthenticated: true })
  },
  logout: () => {
    localStorage.clear()
    set({ user: null, workspace: null, isAuthenticated: false })
  },
}))
