import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || ''
export const api = axios.create({ baseURL: BASE_URL, headers: { 'Content-Type': 'application/json' } })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use((res) => res, async (error) => {
  const original = error.config
  if (error.response?.status === 401 && !original._retry) {
    original._retry = true
    try {
      const refresh = localStorage.getItem('refresh_token')
      if (!refresh) throw new Error('No refresh token')
      const { data } = await axios.post(`${BASE_URL}/api/auth/refresh/`, { refresh })
      localStorage.setItem('access_token', data.access)
      localStorage.setItem('refresh_token', data.refresh)
      original.headers.Authorization = `Bearer ${data.access}`
      return api(original)
    } catch { localStorage.clear(); window.location.href = '/login' }
  }
  return Promise.reject(error)
})

export const authApi = {
  login:    (d: any) => api.post('/api/auth/login/', d),
  register: (d: any) => api.post('/api/auth/register/', d),
  logout:   ()       => api.post('/api/auth/logout/'),
  me:       ()       => api.get('/api/auth/me/'),
  invite:   (d: any) => api.post('/api/auth/invite/', d),
}
export const clientsApi = {
  list:       (p?: any)              => api.get('/api/clients/', { params: p }),
  get:        (id: string)           => api.get(`/api/clients/${id}/`),
  create:     (d: any)               => api.post('/api/clients/', d),
  update:     (id: string, d: any)   => api.put(`/api/clients/${id}/`, d),
  patch:      (id: string, d: any)   => api.patch(`/api/clients/${id}/`, d),
  delete:     (id: string)           => api.delete(`/api/clients/${id}/`),
  listGoals:  (id: string)           => api.get(`/api/clients/${id}/goals/`),
  createGoal: (id: string, d: any)   => api.post(`/api/clients/${id}/goals/`, d),
}
export const activitiesApi = {
  list:       (p?: any)            => api.get('/api/activities/', { params: p }),
  create:     (d: any)             => api.post('/api/activities/', d),
  update:     (id: string, d: any) => api.put(`/api/activities/${id}/`, d),
  delete:     (id: string)         => api.delete(`/api/activities/${id}/`),
  markMissed: (id: string)         => api.post(`/api/activities/${id}/missed/`),
}
export const invoicesApi = {
  list:          (p?: any)            => api.get('/api/invoices/', { params: p }),
  get:           (id: string)         => api.get(`/api/invoices/${id}/`),
  create:        (d: any)             => api.post('/api/invoices/', d),
  send:          (id: string)         => api.post(`/api/invoices/${id}/send/`),
  recordPayment: (id: string, d: any) => api.post(`/api/invoices/${id}/record-payment/`, d),
  void:          (id: string)         => api.post(`/api/invoices/${id}/void/`),
}
export const pipelineApi = {
  deals:   (p?: any)               => api.get('/api/pipeline/deals/', { params: p }),
  create:  (d: any)                => api.post('/api/pipeline/deals/', d),
  advance: (id: string, s: string) => api.post(`/api/pipeline/deals/${id}/advance/`, { stage: s }),
}
export const reportsApi = {
  revenue:     (year: number) => api.get('/api/reports/revenue/', { params: { year } }),
  outstanding: ()             => api.get('/api/reports/outstanding/'),
}
export const libraryApi = {
  items:   (p?: any) => api.get('/api/library/items/', { params: p }),
  folders: ()        => api.get('/api/library/folders/'),
}
