import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || ''
export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,   // send httpOnly auth cookies on every request
})

api.interceptors.response.use((res) => res, async (error) => {
  const original = error.config
  if (error.response?.status === 401 && !original._retry) {
    original._retry = true
    try {
      // refresh_token cookie is sent automatically — no body needed
      await axios.post(`${BASE_URL}/api/auth/refresh/`, {}, { withCredentials: true })
      return api(original)
    } catch (refreshError: any) {
      // Only force logout if the refresh endpoint explicitly rejected the token (401/403).
      // Network errors or 5xx (server restart, throttle) should NOT log the user out.
      const status = refreshError?.response?.status
      if (!status || status === 401 || status === 403) {
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
  tokenInfo:             (token: string) => api.get('/api/auth/token-info/', { params: { token } }),
  team:               ()                   => api.get('/api/auth/team/'),
  addCoach:           (d: any)             => api.post('/api/auth/team/add-coach/', d),
  updateMember:       (id: string, d: any) => api.patch(`/api/auth/team/${id}/`, d),
  deleteMember:       (id: string)         => api.delete(`/api/auth/team/${id}/`),
}
export const settingsApi = {
  getWorkspace:    ()          => api.get('/api/settings/workspace/'),
  updateWorkspace: (d: any)    => api.patch('/api/settings/workspace/', d),
  emailPreview:    (type: string, extraParams?: Record<string, any>) =>
    api.get('/api/settings/email-preview/', { params: { type, ...extraParams } }),
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
  getZoomSettings:      ()                   => api.get('/api/settings/zoom/'),
  saveZoomSettings:     (d: any)             => api.post('/api/settings/zoom/', d),
  createZoomMeeting:    (d: any)             => api.post('/api/settings/zoom/create-meeting/', d),
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
  exportNotes:  (id: string)                    => api.get(`/api/clients/${id}/notes/export/`, { responseType: 'text' }),
  listFiles:    (id: string)           => api.get(`/api/clients/${id}/assessments/`),
  deleteFile:   (id: string, fid: string) => api.delete(`/api/clients/${id}/assessments/${fid}/`),
  uploadFile:   (id: string, fd: FormData) =>
    api.post(`/api/clients/${id}/assessments/upload/`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  fileEditConfig: (id: string, fid: string, mode: 'view' | 'edit' = 'view') =>
    api.get(`/api/clients/${id}/assessments/${fid}/edit-config/`, { params: { mode } }),
  convertFileToPdf: (id: string, fid: string, d?: { assessment_type?: string; visible_to_client?: boolean }) =>
    api.post(`/api/clients/${id}/assessments/${fid}/convert-to-pdf/`, d),
  invitePortal: (id: string) => api.post(`/api/clients/${id}/invite-portal/`),
  revokePortal: (id: string) => api.post(`/api/clients/${id}/revoke-portal/`),
  listMessageDrafts:   (id: string)              => api.get(`/api/clients/${id}/messages/`),
  createMessageDraft:  (id: string, d: any)      => api.post(`/api/clients/${id}/messages/`, d),
  updateMessageDraft:  (id: string, mid: string, d: any) => api.patch(`/api/clients/${id}/messages/${mid}/`, d),
  deleteMessageDraft:  (id: string, mid: string) => api.delete(`/api/clients/${id}/messages/${mid}/`),
  sendMessageDraft:    (id: string, mid: string) => api.post(`/api/clients/${id}/messages/${mid}/send/`),
  attachToMessageDraft: (id: string, mid: string, fd: FormData) =>
    api.post(`/api/clients/${id}/messages/${mid}/attach/`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  attachExistingFileToMessageDraft: (id: string, mid: string, assessmentId: string) =>
    api.post(`/api/clients/${id}/messages/${mid}/attach-existing/`, { assessment_id: assessmentId }),
  removeMessageAttachment: (id: string, mid: string, s3_key: string) =>
    api.post(`/api/clients/${id}/messages/${mid}/remove-attachment/`, { s3_key }),
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
  cancel: (id: string, scope: 'this' | 'future' | 'all' = 'this') =>
    api.post(`/api/activities/${id}/cancel/`, { scope }),
  emailPreview: (id: string, type: string) =>
    api.get(`/api/activities/${id}/email-preview/`, { params: { type } }),
}
export const invoicesApi = {
  list:          (p?: any)            => api.get('/api/invoices/', { params: p }),
  get:           (id: string)         => api.get(`/api/invoices/${id}/`),
  create:        (d: any)             => api.post('/api/invoices/', d),
  update:        (id: string, d: any) => api.put(`/api/invoices/${id}/`, d),
  patch:         (id: string, d: any) => api.patch(`/api/invoices/${id}/`, d),
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
export const systemApi = {
  banner: () => api.get('/api/system/banner/'),
}
export const adminApi = {
  dashboard:       ()                       => api.get('/api/superadmin/dashboard/'),
  workspaces:      ()                       => api.get('/api/superadmin/workspaces/'),
  workspace:       (id: string)             => api.get(`/api/superadmin/workspaces/${id}/`),
  patchWorkspace:  (id: string, d: any)     => api.patch(`/api/superadmin/workspaces/${id}/`, d),
  workspaceUsers:  (id: string)             => api.get(`/api/superadmin/workspaces/${id}/users/`),
  workspaceActivity: (id: string)           => api.get(`/api/superadmin/workspaces/${id}/activity/`),
  workspaceErrors:   (id: string)           => api.get(`/api/superadmin/workspaces/${id}/errors/`),
  workspaceAuditLog: (id: string)           => api.get(`/api/superadmin/workspaces/${id}/audit-log/`),
  pipelineStages:  (id: string)             => api.get(`/api/superadmin/workspaces/${id}/pipeline-stages/`),
  savePipelineStages: (id: string, d: any)  => api.put(`/api/superadmin/workspaces/${id}/pipeline-stages/`, d),
  tokens:          ()                       => api.get('/api/superadmin/registration-tokens/'),
  createToken:     (d: any)                 => api.post('/api/superadmin/registration-tokens/', d),
  deleteToken:     (id: string)             => api.delete(`/api/superadmin/registration-tokens/${id}/`),
  activateWorkspace: (id: string)           => api.patch(`/api/superadmin/workspaces/${id}/`, { is_active: true }),
  feedbackList:    (p?: any)               => api.get('/api/superadmin/feedback/', { params: p }),
  feedbackDetail:  (id: string)            => api.get(`/api/superadmin/feedback/${id}/`),
  feedbackPatch:   (id: string, d: any)    => api.patch(`/api/superadmin/feedback/${id}/`, d),
  feedbackComment:     (id: string, text: string) => api.post(`/api/superadmin/feedback/${id}/comment/`, { text }),
  listBanners:         ()                       => api.get('/api/superadmin/banners/'),
  createBanner:        (d: any)                 => api.post('/api/superadmin/banners/', d),
  patchBanner:         (id: number, d: any)     => api.patch(`/api/superadmin/banners/${id}/`, d),
  deleteBanner:        (id: number)             => api.delete(`/api/superadmin/banners/${id}/`),
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
  deleteClientTag:           (wsId: string, id: number)             => api.delete(`/api/superadmin/workspaces/${wsId}/client-tags/${id}/`),
  platformInvoices:              (params?: any)             => api.get('/api/superadmin/platform-invoices/', { params }),
  createPlatformInvoice:         (d: any)                  => api.post('/api/superadmin/platform-invoices/', d),
  patchPlatformInvoice:          (id: number, d: any)      => api.patch(`/api/superadmin/platform-invoices/${id}/`, d),
  deletePlatformInvoice:         (id: number)              => api.delete(`/api/superadmin/platform-invoices/${id}/`),
  sendPlatformInvoice:           (id: number)              => api.post(`/api/superadmin/platform-invoices/${id}/send/`),
  downloadPlatformInvoicePdf:    (id: number)              => api.get(`/api/superadmin/platform-invoices/${id}/pdf/`, { responseType: 'blob' }),
  listPlatformPayments:          (invId: number)           => api.get(`/api/superadmin/platform-invoices/${invId}/payments/`),
  createPlatformPayment:         (invId: number, d: any)   => api.post(`/api/superadmin/platform-invoices/${invId}/payments/`, d),
  deletePlatformPayment:         (invId: number, pid: number) => api.delete(`/api/superadmin/platform-invoices/${invId}/payments/${pid}/`),
}
export const libraryApi = {
  items:        (p?: any)            => api.get('/api/library/items/', { params: p }),
  getItem:      (id: string)         => api.get(`/api/library/items/${id}/`),
  updateItem:   (id: string, d: any) => api.patch(`/api/library/items/${id}/`, d),
  deleteItem:   (id: string)         => api.delete(`/api/library/items/${id}/`),
  upload:       (fd: FormData)       => api.post('/api/library/items/upload/', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  replaceFile:  (id: string, fd: FormData) => api.post(`/api/library/items/${id}/replace-file/`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  editConfig:   (id: string, mode: 'view' | 'edit' = 'view') => api.get(`/api/library/items/${id}/edit-config/`, { params: { mode } }),
  convertToPdf: (id: string, folder?: string | null) => api.post(`/api/library/items/${id}/convert-to-pdf/`, { folder: folder ?? 'root' }),
  folders:      ()                   => api.get('/api/library/folders/'),
  createFolder: (d: any)             => api.post('/api/library/folders/', d),
  deleteFolder: (id: string)         => api.delete(`/api/library/folders/${id}/`),
}
export const auditApi = {
  list: (p?: any) => api.get('/api/audit/', { params: p }),
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
