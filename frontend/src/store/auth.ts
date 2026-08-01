import { create } from 'zustand'

export type TabPermissions = Record<string, { view: boolean; edit: boolean; delete: boolean }>
export interface User {
  id: string; email: string; full_name: string; role: string; is_superuser?: boolean; phone?: string
  tab_permissions?: TabPermissions
}

interface AuthState {
  user: User | null
  workspace: any | null
  isAuthenticated: boolean
  login: (user: User, workspace: any) => void
  rehydrate: (user: User, workspace: any) => void
  logout: () => void
}

function loadUser(): User | null {
  try { return JSON.parse(sessionStorage.getItem('user') || 'null') } catch { return null }
}
function loadWorkspace(): any | null {
  try { return JSON.parse(sessionStorage.getItem('workspace') || 'null') } catch { return null }
}

const _user = loadUser()

export const useAuthStore = create<AuthState>((set) => ({
  user:            _user,
  workspace:       loadWorkspace(),
  isAuthenticated: !!_user,   // presence of cached user = was logged in; cookie validates actual session

  login: (user, workspace) => {
    sessionStorage.setItem('user',      JSON.stringify(user))
    sessionStorage.setItem('workspace', JSON.stringify(workspace))
    set({ user, workspace, isAuthenticated: true })
  },

  rehydrate: (user, workspace) => {
    sessionStorage.setItem('user',      JSON.stringify(user))
    sessionStorage.setItem('workspace', JSON.stringify(workspace))
    set({ user, workspace, isAuthenticated: true })
  },

  logout: () => {
    sessionStorage.removeItem('user')
    sessionStorage.removeItem('workspace')
    set({ user: null, workspace: null, isAuthenticated: false })
  },
}))
