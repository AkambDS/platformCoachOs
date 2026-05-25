import { create } from 'zustand'

export interface User { id: string; email: string; full_name: string; role: string; is_superuser?: boolean }

interface AuthState {
  user: User | null
  workspace: any | null
  isAuthenticated: boolean
  login: (tokens: { access: string; refresh: string }, user: User, workspace: any) => void
  rehydrate: (user: User, workspace: any) => void
  logout: () => void
}

function loadUser(): User | null {
  try { return JSON.parse(sessionStorage.getItem('user') || 'null') } catch { return null }
}
function loadWorkspace(): any | null {
  try { return JSON.parse(sessionStorage.getItem('workspace') || 'null') } catch { return null }
}

export const useAuthStore = create<AuthState>((set) => ({
  user:            loadUser(),
  workspace:       loadWorkspace(),
  isAuthenticated: !!sessionStorage.getItem('access_token'),

  login: (tokens, user, workspace) => {
    sessionStorage.setItem('access_token',  tokens.access)
    sessionStorage.setItem('refresh_token', tokens.refresh)
    sessionStorage.setItem('user',          JSON.stringify(user))
    sessionStorage.setItem('workspace',     JSON.stringify(workspace))
    set({ user, workspace, isAuthenticated: true })
  },

  rehydrate: (user, workspace) => {
    sessionStorage.setItem('user',      JSON.stringify(user))
    sessionStorage.setItem('workspace', JSON.stringify(workspace))
    set({ user, workspace, isAuthenticated: true })
  },

  logout: () => {
    sessionStorage.removeItem('access_token')
    sessionStorage.removeItem('refresh_token')
    set({ user: null, workspace: null, isAuthenticated: false })
  },
}))
