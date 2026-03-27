/**
 * frontend/src/services/adminApi.js
 *
 * Separate axios instance for admin API calls.
 * Uses its own token key (mg_admin_token) — never touches mg_token.
 *
 * Phase 2 additions are at the bottom of this file.
 * All Phase 1 exports are preserved unchanged.
 */

import axios from 'axios'

const ADMIN_TOKEN_KEY = 'mg_admin_token'

const adminApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  headers: { 'Content-Type': 'application/json' },
})

// Attach admin token to every request
adminApi.interceptors.request.use((config) => {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Redirect to admin login on 401
adminApi.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem(ADMIN_TOKEN_KEY)
      window.location.href = '/index-admin.html'
    }
    return Promise.reject(err)
  }
)

// ── Auth ──────────────────────────────────────────────────────────────────────

export const adminLogin = (email, password) =>
  adminApi.post('/api/admin/auth/login', { email, password }).then((r) => r.data)

export const adminVerifyTotp = (preAuthToken, totpCode) =>
  adminApi.post('/api/admin/auth/verify-totp', {
    pre_auth_token: preAuthToken,
    totp_code: totpCode,
  }).then((r) => r.data)

export const adminGetMe = () =>
  adminApi.get('/api/admin/auth/me').then((r) => r.data)

export const adminSetupTotp = () =>
  adminApi.get('/api/admin/auth/setup-totp').then((r) => r.data)

// ── Phase 1: Metrics ─────────────────────────────────────────────────────────

export const getOverviewMetrics = () =>
  adminApi.get('/api/admin/metrics/overview').then((r) => r.data)

export const getCostMetrics = (period = '30d') =>
  adminApi.get(`/api/admin/metrics/costs?period=${period}`).then((r) => r.data)

// ── Phase 1: Users ────────────────────────────────────────────────────────────

export const listUsers = (params = {}) =>
  adminApi.get('/api/admin/users', { params }).then((r) => r.data)

export const getUser = (userId) =>
  adminApi.get(`/api/admin/users/${userId}`).then((r) => r.data)

export const disableUser = (userId, reason) =>
  adminApi.post(`/api/admin/users/${userId}/disable`, { reason }).then((r) => r.data)

export const enableUser = (userId, reason) =>
  adminApi.post(`/api/admin/users/${userId}/enable`, { reason }).then((r) => r.data)

export const deleteUser = (userId) =>
  adminApi.delete(`/api/admin/users/${userId}`, { data: { confirm_text: 'DELETE' } })
    .then((r) => r.data)

// ── Phase 1: Audit log ────────────────────────────────────────────────────────

export const getAuditLog = (page = 1, perPage = 50) =>
  adminApi.get('/api/admin/audit-log', { params: { page, per_page: perPage } })
    .then((r) => r.data)

// ── Phase 1: Admin account management ────────────────────────────────────────

export const listAdmins = () =>
  adminApi.get('/api/admin/admins').then((r) => r.data)

export const createAdmin = (email, password, role = 'support_admin') =>
  adminApi.post('/api/admin/admins', { email, password, role }).then((r) => r.data)

export const updateAdmin = (adminId, updates) =>
  adminApi.patch(`/api/admin/admins/${adminId}`, updates).then((r) => r.data)

export const deleteAdmin = (adminId) =>
  adminApi.delete(`/api/admin/admins/${adminId}`, { data: { confirm_text: 'DELETE' } })
    .then((r) => r.data)

// ── Phase 2: Activity metrics ─────────────────────────────────────────────────

export const getActivityMetrics = (period = '30d', dateFrom = null, dateTo = null) => {
  const params = { period }
  if (dateFrom) params.date_from = dateFrom
  if (dateTo)   params.date_to   = dateTo
  return adminApi.get('/api/admin/metrics/activity', { params }).then((r) => r.data)
}

// ── Phase 2: Token metrics ────────────────────────────────────────────────────

export const getTokenMetrics = (period = '30d', dateFrom = null, dateTo = null) => {
  const params = { period }
  if (dateFrom) params.date_from = dateFrom
  if (dateTo)   params.date_to   = dateTo
  return adminApi.get('/api/admin/metrics/tokens', { params }).then((r) => r.data)
}

export const getTopConsumers = (period = '30d', limit = 20) =>
  adminApi.get('/api/admin/metrics/top-consumers', { params: { period, limit } })
    .then((r) => r.data)

// ── Phase 2: Anomaly alerts ───────────────────────────────────────────────────

export const getAnomalies = () =>
  adminApi.get('/api/admin/metrics/anomalies').then((r) => r.data)

export const resolveAnomaly = (alertId) =>
  adminApi.post(`/api/admin/metrics/anomalies/${alertId}/resolve`).then((r) => r.data)

// ── Phase 2: Conversion tracking ─────────────────────────────────────────────

export const getConversions = (period = '30d', dateFrom = null, dateTo = null) => {
  const params = { period }
  if (dateFrom) params.date_from = dateFrom
  if (dateTo)   params.date_to   = dateTo
  return adminApi.get('/api/admin/metrics/conversions', { params }).then((r) => r.data)
}

export const createConversion = (userId, eventType, fromTier, toTier, triggeredBy = 'admin_manual') =>
  adminApi.post('/api/admin/metrics/conversions', {
    user_id: userId,
    event_type: eventType,
    from_tier: fromTier,
    to_tier: toTier,
    triggered_by: triggeredBy,
  }).then((r) => r.data)

// ── Phase 2: User notes ───────────────────────────────────────────────────────

// ── ARIA Quality metrics ─────────────────────────────────────────────────────

export const getAriaQualityMetrics = (period = '30d') =>
  adminApi.get('/api/admin/metrics/aria-quality', { params: { period } })
    .then((r) => r.data)

export const getUserNotes = (userId) =>
  adminApi.get(`/api/admin/users/${userId}/notes`).then((r) => r.data)

export const addUserNote = (userId, note) =>
  adminApi.post(`/api/admin/users/${userId}/notes`, { note }).then((r) => r.data)

// ── Phase 2: Impersonation ────────────────────────────────────────────────────

export const startImpersonation = (userId) =>
  adminApi.post(`/api/admin/users/${userId}/impersonate`).then((r) => r.data)

export const endImpersonation = (userId) =>
  adminApi.post(`/api/admin/users/${userId}/impersonate/end`).then((r) => r.data)

// ── Token helpers ────────────────────────────────────────────────────────────

export const saveAdminToken   = (token) => localStorage.setItem(ADMIN_TOKEN_KEY, token)
export const clearAdminToken  = ()      => localStorage.removeItem(ADMIN_TOKEN_KEY)
export const getAdminToken    = ()      => localStorage.getItem(ADMIN_TOKEN_KEY)

// ── OEM Maintenance Schedules ─────────────────────────────────────────────────
export const listOemSchedules = (params = {}) =>
  adminApi.get('/api/admin/oem-schedules', { params }).then((r) => r.data)

export const createOemSchedule = (data) =>
  adminApi.post('/api/admin/oem-schedules', data).then((r) => r.data)

export const updateOemSchedule = (id, data) =>
  adminApi.patch(`/api/admin/oem-schedules/${id}`, data).then((r) => r.data)

export const deleteOemSchedule = (id) =>
  adminApi.delete(`/api/admin/oem-schedules/${id}`).then((r) => r.data)

export const embedOemSchedule = (id) =>
  adminApi.post(`/api/admin/oem-schedules/${id}/embed`).then((r) => r.data)

export default adminApi

// ── Upsell Thresholds (Dynamic Asset-Based Tolerance System) ─────────────────

export const listThresholds = (params = {}) =>
  adminApi.get('/api/admin/thresholds', { params }).then((r) => r.data)

export const createThreshold = (data) =>
  adminApi.post('/api/admin/thresholds', data).then((r) => r.data)

export const updateThreshold = (id, data) =>
  adminApi.patch(`/api/admin/thresholds/${id}`, data).then((r) => r.data)

export const deleteThreshold = (id) =>
  adminApi.delete(`/api/admin/thresholds/${id}`).then((r) => r.data)

export const seedThresholds = () =>
  adminApi.post('/api/admin/thresholds/seed').then((r) => r.data)

// ── AI-Generated OEM Review Workflow ─────────────────────────────────────────

export const getPendingOemCount = () =>
  adminApi.get('/api/admin/oem-schedules/pending/count').then((r) => r.data)

export const listPendingOemSchedules = () =>
  adminApi.get('/api/admin/oem-schedules/pending').then((r) => r.data)

export const approveOemSchedule = (id) =>
  adminApi.post(`/api/admin/oem-schedules/${id}/approve`).then((r) => r.data)

export const rejectOemSchedule = (id) =>
  adminApi.post(`/api/admin/oem-schedules/${id}/reject`).then((r) => r.data)

export const approveAllOemForMake = (make) =>
  adminApi.post(`/api/admin/oem-schedules/approve-all/${encodeURIComponent(make)}`).then((r) => r.data)
