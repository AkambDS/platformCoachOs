import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || ''
export const api = axios.create({ baseURL: BASE_URL, headers: { 'Content-Type': 'application/json' } })

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use((res) => res, async (error) => {
  const original = error.config
  if (error.response?.status === 401 && !original._retry) {
    original._retry = true
    try {
      const refresh = sessionStorage.getItem('refresh_token')
      if (!refresh) throw new Error('No refresh token')
      const { data } = await axios.post(`${BASE_URL}/api/auth/refresh/`, { refresh })
      sessionStorage.setItem('access_token', data.access)
      sessionStorage.setItem('refresh_token', data.refresh)
      original.headers.Authorization = `Bearer ${data.access}`
      return api(original)
    } catch (refreshError: any) {
      // Only force logout if the refresh endpoint explicitly rejected the token (401/403).
      // Network errors or 5xx (server restart, throttle) should NOT log the user out —
      // their token is still valid and will work once the server recovers.
      const status = refreshError?.response?.status
      if (!status || status === 401 || status === 403) {
        sessionStorage.removeItem('access_token')
        sessionStorage.removeItem('refresh_token')
        import('../lib/queryClient').then(({ queryClient }) => queryClient.clear())
        window.location.href = '/login'
      }
    }
  }
  return Promise.reject(error)
})

export const authApi = {
  login:              (d: any) => api.post('/api/auth/login/', d),
  register:           (d: any) => api.post('/api/auth/register/', d),
  logout:             ()       => api.post('/api/auth/logout/'),
  me:                 ()       => api.get('/api/auth/me/'),
  updateMe:           (d: any) => api.patch('/api/auth/me/', d),
  invite:             (d: any) => api.post('/api/auth/invite/', d),
  inviteEmailPreview: (email: string, role: string) =>
    api.get('/api/auth/invite-email-preview/', { params: { email, role } }),
  acceptInvite:          (d: any) => api.post('/api/auth/accept-invite/', d),
  passwordResetRequest:  (d: any) => api.post('/api/auth/password-reset/', d),
  passwordResetConfirm:  (d: any) => api.post('/api/auth/password-reset/confirm/', d),
  team:               ()                   => api.get('/api/auth/team/'),
  updateMember:       (id: string, d: any) => api.patch(`/api/auth/team/${id}/`, d),
  deleteMember:       (id: string)         => api.delete(`/api/auth/team/${id}/`),
}
export const settingsApi = {
  getWorkspace:    ()          => api.get('/api/settings/workspace/'),
  updateWorkspace: (d: any)    => api.patch('/api/settings/workspace/', d),
  emailPreview:    (type: string) => api.get('/api/settings/email-preview/', { params: { type } }),
  uploadLogo:      (file: File) => {
    const fd = new FormData(); fd.append('logo', file)
    return api.post('/api/settings/logo/', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  removeLogo:         ()              => api.delete('/api/settings/logo/'),
  getPipelineStages:    ()              => api.get('/api/settings/pipeline-stages/'),
  createPipelineStage:  (d: any)       => api.post('/api/settings/pipeline-stages/', d),
  updatePipelineStage:  (id: number, d: any) => api.patch(`/api/settings/pipeline-stages/${id}/`, d),
  deletePipelineStage:  (id: number)   => api.delete(`/api/settings/pipeline-stages/${id}/`),
  getActivityTypes:   ()              => api.get('/api/settings/activity-types/'),
  createActivityType: (d: any)        => api.post('/api/settings/activity-types/', d),
  updateActivityType: (id: number, d: any) => api.patch(`/api/settings/activity-types/${id}/`, d),
  deleteActivityType: (id: number)    => api.delete(`/api/settings/activity-types/${id}/`),
  getClientStatuses:    ()                   => api.get('/api/settings/client-statuses/'),
  createClientStatus:   (d: any)             => api.post('/api/settings/client-statuses/', d),
  updateClientStatus:   (id: number, d: any) => api.patch(`/api/settings/client-statuses/${id}/`, d),
  deleteClientStatus:   (id: number)         => api.delete(`/api/settings/client-statuses/${id}/`),
  getClientTags:        ()                   => api.get('/api/settings/client-tags/'),
  createClientTag:      (d: any)             => api.post('/api/settings/client-tags/', d),
  updateClientTag:      (id: number, d: any) => api.patch(`/api/settings/client-tags/${id}/`, d),
  deleteClientTag:      (id: number)         => api.delete(`/api/settings/client-tags/${id}/`),
}
export const clientsApi = {
  list:         (p?: any)              => api.get('/api/clients/', { params: p }),
  get:          (id: string)           => api.get(`/api/clients/${id}/`),
  create:       (d: any)               => api.post('/api/clients/', d),
  update:       (id: string, d: any)   => api.put(`/api/clients/${id}/`, d),
  patch:        (id: string, d: any)   => api.patch(`/api/clients/${id}/`, d),
  delete:       (id: string)           => api.delete(`/api/clients/${id}/`),
  exportCsv:    ()                     => api.get('/api/clients/export/', { responseType: 'blob' }),
  importCsv:    (fd: FormData)         => api.post('/api/clients/import/', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  listGoals:    (id: string)           => api.get(`/api/clients/${id}/goals/`),
  createGoal:   (id: string, d: any)   => api.post(`/api/clients/${id}/goals/`, d),
  updateGoal:   (id: string, gid: string, d: any) => api.patch(`/api/clients/${id}/goals/${gid}/`, d),
  deleteGoal:   (id: string, gid: string)         => api.delete(`/api/clients/${id}/goals/${gid}/`),
  listNotes:    (id: string)                    => api.get(`/api/clients/${id}/notes/`),
  createNote:   (id: string, d: any)            => api.post(`/api/clients/${id}/notes/`, d),
  updateNote:   (id: string, nid: string, d: any) => api.patch(`/api/clients/${id}/notes/${nid}/`, d),
  deleteNote:   (id: string, nid: string)       => api.delete(`/api/clients/${id}/notes/${nid}/`),
  listFiles:    (id: string)           => api.get(`/api/clients/${id}/assessments/`),
  deleteFile:   (id: string, fid: string) => api.delete(`/api/clients/${id}/assessments/${fid}/`),
  uploadFile:   (id: string, fd: FormData) =>
    api.post(`/api/clients/${id}/assessments/upload/`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
}
export const activitiesApi = {
  list:         (p?: any)            => api.get('/api/activities/', { params: p }),
  create:       (d: any)             => api.post('/api/activities/', d),
  update:       (id: string, d: any) => api.put(`/api/activities/${id}/`, d),
  patch:        (id: string, d: any) => api.patch(`/api/activities/${id}/`, d),
  delete:       (id: string)         => api.delete(`/api/activities/${id}/`),
  markMissed:      (id: string) => api.post(`/api/activities/${id}/missed/`),
  markComplete:    (id: string) => api.patch(`/api/activities/${id}/`, { status: 'completed' }),
  markLate:        (id: string) => api.patch(`/api/activities/${id}/`, { status: 'late' }),
  markRescheduled: (id: string) => api.patch(`/api/activities/${id}/`, { status: 'rescheduled' }),
  cancel:          (id: string) => api.post(`/api/activities/${id}/cancel/`),
  emailPreview: (id: string, type: string) =>
    api.get(`/api/activities/${id}/email-preview/`, { params: { type } }),
}
export const invoicesApi = {
  list:          (p?: any)            => api.get('/api/invoices/', { params: p }),
  get:           (id: string)         => api.get(`/api/invoices/${id}/`),
  create:        (d: any)             => api.post('/api/invoices/', d),
  update:        (id: string, d: any) => api.put(`/api/invoices/${id}/`, d),
  send:          (id: string)         => api.post(`/api/invoices/${id}/send/`),
  recordPayment: (id: string, d: any) => api.post(`/api/invoices/${id}/record-payment/`, d),
  void:          (id: string)         => api.post(`/api/invoices/${id}/void/`),
  refund:        (id: string, d: any) => api.post(`/api/invoices/${id}/refund/`, d),
  remind:        (id: string)         => api.post(`/api/invoices/${id}/remind/`),
  catalogItems:  ()                   => api.get('/api/invoices/service-catalog/'),
  catalogCreate: (d: any)             => api.post('/api/invoices/service-catalog/', d),
  catalogUpdate: (id: string, d: any) => api.patch(`/api/invoices/service-catalog/${id}/`, d),
  catalogDelete: (id: string)         => api.delete(`/api/invoices/service-catalog/${id}/`),
}
export const pipelineApi = {
  deals:   (p?: any)               => api.get('/api/pipeline/deals/', { params: p }),
  dealsByClient: (clientId: string) => api.get('/api/pipeline/deals/', { params: { client: clientId } }),
  create:  (d: any)                => api.post('/api/pipeline/deals/', d),
  patch:   (id: string, d: any)    => api.patch(`/api/pipeline/deals/${id}/`, d),
  advance: (id: string, s: string) => api.post(`/api/pipeline/deals/${id}/advance/`, { stage: s }),
}
export const reportsApi = {
  revenue:     (year: number) => api.get('/api/reports/revenue/', { params: { year } }),
  outstanding: ()             => api.get('/api/reports/outstanding/'),
  exportCsv:   ()             => api.get('/api/reports/export.csv', { responseType: 'blob' }),
}
export const adminApi = {
  dashboard:       ()                       => api.get('/api/superadmin/dashboard/'),
  workspaces:      ()                       => api.get('/api/superadmin/workspaces/'),
  workspace:       (id: string)             => api.get(`/api/superadmin/workspaces/${id}/`),
  patchWorkspace:  (id: string, d: any)     => api.patch(`/api/superadmin/workspaces/${id}/`, d),
  workspaceUsers:  (id: string)             => api.get(`/api/superadmin/workspaces/${id}/users/`),
  workspaceActivity: (id: string)           => api.get(`/api/superadmin/workspaces/${id}/activity/`),
  workspaceErrors:   (id: string)           => api.get(`/api/superadmin/workspaces/${id}/errors/`),
  pipelineStages:  (id: string)             => api.get(`/api/superadmin/workspaces/${id}/pipeline-stages/`),
  savePipelineStages: (id: string, d: any)  => api.put(`/api/superadmin/workspaces/${id}/pipeline-stages/`, d),
  tokens:          ()                       => api.get('/api/superadmin/registration-tokens/'),
  createToken:     (d: any)                 => api.post('/api/superadmin/registration-tokens/', d),
  deleteToken:     (id: string)             => api.delete(`/api/superadmin/registration-tokens/${id}/`),
  feedbackList:    (p?: any)               => api.get('/api/superadmin/feedback/', { params: p }),
  feedbackDetail:  (id: string)            => api.get(`/api/superadmin/feedback/${id}/`),
  feedbackPatch:   (id: string, d: any)    => api.patch(`/api/superadmin/feedback/${id}/`, d),
  feedbackComment:     (id: string, text: string) => api.post(`/api/superadmin/feedback/${id}/comment/`, { text }),
  resetUserPassword:   (wsId: string, userId: string) => api.post(`/api/superadmin/workspaces/${wsId}/reset-password/`, { user_id: userId }),
  setUserPassword:     (wsId: string, userId: string, password: string) => api.post(`/api/superadmin/workspaces/${wsId}/users/${userId}/set-password/`, { password }),
  workspaceInvoices:    (id: string)             => api.get(`/api/superadmin/workspaces/${id}/invoices/`),
  activityTypes:        (wsId: string)             => api.get(`/api/superadmin/workspaces/${wsId}/activity-types/`),
  createActivityType:   (wsId: string, d: any)     => api.post(`/api/superadmin/workspaces/${wsId}/activity-types/`, d),
  updateActivityType:   (wsId: string, typeId: number, d: any) => api.patch(`/api/superadmin/workspaces/${wsId}/activity-types/${typeId}/`, d),
  deleteActivityType:   (wsId: string, typeId: number)         => api.delete(`/api/superadmin/workspaces/${wsId}/activity-types/${typeId}/`),
  clientStatuses:       (wsId: string)                         => api.get(`/api/superadmin/workspaces/${wsId}/client-statuses/`),
  createClientStatus:   (wsId: string, d: any)                 => api.post(`/api/superadmin/workspaces/${wsId}/client-statuses/`, d),
  updateClientStatus:   (wsId: string, id: number, d: any)     => api.patch(`/api/superadmin/workspaces/${wsId}/client-statuses/${id}/`, d),
  deleteClientStatus:   (wsId: string, id: number)             => api.delete(`/api/superadmin/workspaces/${wsId}/client-statuses/${id}/`),
  clientTags:           (wsId: string)                         => api.get(`/api/superadmin/workspaces/${wsId}/client-tags/`),
  createClientTag:      (wsId: string, d: any)                 => api.post(`/api/superadmin/workspaces/${wsId}/client-tags/`, d),
  updateClientTag:      (wsId: string, id: number, d: any)     => api.patch(`/api/superadmin/workspaces/${wsId}/client-tags/${id}/`, d),
  deleteClientTag:      (wsId: string, id: number)             => api.delete(`/api/superadmin/workspaces/${wsId}/client-tags/${id}/`),
}
export const libraryApi = {
  items:        (p?: any)            => api.get('/api/library/items/', { params: p }),
  getItem:      (id: string)         => api.get(`/api/library/items/${id}/`),
  updateItem:   (id: string, d: any) => api.patch(`/api/library/items/${id}/`, d),
  deleteItem:   (id: string)         => api.delete(`/api/library/items/${id}/`),
  upload:       (fd: FormData)       => api.post('/api/library/items/upload/', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  folders:      ()                   => api.get('/api/library/folders/'),
  createFolder: (d: any)             => api.post('/api/library/folders/', d),
  deleteFolder: (id: string)         => api.delete(`/api/library/folders/${id}/`),
}
export const feedbackApi = {
  list:         (p?: any)            => api.get('/api/feedback/', { params: p }),
  get:          (id: string)         => api.get(`/api/feedback/${id}/`),
  create:       (d: any)             => api.post('/api/feedback/', d),
  update:       (id: string, d: any) => api.patch(`/api/feedback/${id}/`, d),
  comment:      (id: string, d: any) => api.post(`/api/feedback/${id}/comment/`, d),
  updateStatus: (id: string, d: any) => api.post(`/api/feedback/${id}/update-status/`, d),
  close:        (id: string)         => api.post(`/api/feedback/${id}/close/`),
}
