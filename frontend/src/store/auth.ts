import { create } from 'zustand'

interface User { id: string; email: string; full_name: string; role: string }

interface AuthState {
  user: User | null
  workspace: any | null
  isAuthenticated: boolean
  login: (tokens: { access: string; refresh: string }, user: User, workspace: any) => void
  rehydrate: (user: User, workspace: any) => void
  logout: () => void
}

function loadUser(): User | null {
  try { return JSON.parse(localStorage.getItem('user') || 'null') } catch { return null }
}
function loadWorkspace(): any | null {
  try { return JSON.parse(localStorage.getItem('workspace') || 'null') } catch { return null }
}

export const useAuthStore = create<AuthState>((set) => ({
  user:            loadUser(),
  workspace:       loadWorkspace(),
  isAuthenticated: !!localStorage.getItem('access_token'),

  login: (tokens, user, workspace) => {
    localStorage.setItem('access_token',  tokens.access)
    localStorage.setItem('refresh_token', tokens.refresh)
    localStorage.setItem('user',          JSON.stringify(user))
    localStorage.setItem('workspace',     JSON.stringify(workspace))
    set({ user, workspace, isAuthenticated: true })
  },

  rehydrate: (user, workspace) => {
    localStorage.setItem('user',      JSON.stringify(user))
    localStorage.setItem('workspace', JSON.stringify(workspace))
    set({ user, workspace, isAuthenticated: true })
  },

  logout: () => {
    localStorage.clear()
    set({ user: null, workspace: null, isAuthenticated: false })
  },
}))
