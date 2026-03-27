import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});


// ── Auth token interceptor ──────────────────────────────────────────────────
// During a normal session:     uses mg_token
// During admin impersonation:  uses mg_impersonation_token (takes priority)
api.interceptors.request.use((config) => {
  const impToken = localStorage.getItem('mg_impersonation_token');
  const token    = impToken || localStorage.getItem('mg_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── 401 response interceptor ─────────────────────────────────────────────────
// If a token expires mid-session, clear it and redirect to login.
// During impersonation a 401 clears the impersonation token only —
// it never touches mg_token (the admin's original session is unaffected).
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const impToken = localStorage.getItem('mg_impersonation_token');
      if (impToken) {
        // Impersonation token expired — clear it and redirect to admin console
        localStorage.removeItem('mg_impersonation_token');
        localStorage.removeItem('mg_impersonation_meta');
        window.location.href = '/index-admin.html';
      } else {
        const token = localStorage.getItem('mg_token');
        if (token) {
          localStorage.removeItem('mg_token');
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

// ── Auth API ─────────────────────────────────────────────────────────────────
export const authSignup = (data) => api.post('/api/auth/signup', data);
export const authLogin  = (data) => api.post('/api/auth/login', data);
export const authGetMe  = ()     => api.get('/api/auth/me');

// Vehicles
export const getVehicles = () => api.get('/api/vehicles');
export const getVehicle = (id) => api.get(`/api/vehicles/${id}`);
export const createVehicle = (data) => api.post('/api/vehicles', data);
export const updateVehicle = (id, data) => api.put(`/api/vehicles/${id}`, data);
export const deleteVehicle = (id, force = false) => api.delete(`/api/vehicles/${id}`, { params: { force } });

// Invoices
export const uploadInvoice = (vehicleId, file) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post(`/api/invoices/upload?vehicle_id=${vehicleId}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const getInvoice = (id) => api.get(`/api/invoices/${id}`);
export const getVehicleInvoices = (vehicleId, includeArchived = false) =>
  api.get(`/api/invoices/vehicle/${vehicleId}`, { params: { include_archived: includeArchived } });

export const getFleetSummary = () => api.get('/api/vehicles/fleet-summary');
export const getServicesDue = () => api.get('/api/recommendations/services-due');
export const confirmInvoice = (id, data) => api.post(`/api/invoices/${id}/confirm`, data);
export const deleteInvoice = (id) => api.delete(`/api/invoices/${id}`);

// ── Dispute Resolution ──────────────────────────────────────────────────────
// Step 1: Raise a dispute
export const raiseDispute = (invoiceId, data) =>
  api.post(`/api/invoices/${invoiceId}/dispute`, data);

// Step 1 (batch): Raise a dispute for specific selected line items
export const batchDisputeInvoice = (invoiceId, data) =>
  api.post(`/api/invoices/${invoiceId}/dispute/batch`, data);

// Step 2: Resolve the dispute (archive when proven, dismiss otherwise)
export const resolveDispute = (invoiceId, data) =>
  api.post(`/api/invoices/${invoiceId}/dispute/resolve`, data);

// Get full audit history for an invoice's disputes
export const getDisputeHistory = (invoiceId) =>
  api.get(`/api/invoices/${invoiceId}/disputes`);

// Recommendations
export const getRecommendations = (data) => api.post('/api/recommendations', data);
export const addRecommendationsToHistory = (data) => api.post('/api/recommendations/add-to-history', data);

// Timeline
export const getTimeline = (vehicleId, includeArchived = false) =>
  api.get(`/api/timeline/${vehicleId}`, { params: { include_archived: includeArchived } });

// Service History Search
export const searchServiceHistory = (vehicleId, keyword) =>
  api.get(`/api/service-history/${vehicleId}/search`, { params: { keyword } });

// ── History Page Redesign ──────────────────────────────────────────────────────

// Get invoices with service type tags — lightweight list for the History page
export const getVehicleInvoicesWithTags = (vehicleId, includeArchived = false) =>
  api.get(`/api/invoices/vehicle/${vehicleId}/invoices-with-tags`, {
    params: { include_archived: includeArchived }
  });

// Get line items for one invoice — called lazily on accordion expand
export const getInvoiceLineItems = (invoiceId) =>
  api.get(`/api/invoices/${invoiceId}/line-items`);

// Raise a dispute with specific line item PKs (new line-item level dispute flow)
export const raiseDisputeWithLineItems = (invoiceId, data) =>
  api.post(`/api/invoices/${invoiceId}/dispute/line-items`, data);

// Search / filter invoices by service type or shop keyword
export const searchVehicleInvoices = (vehicleId, params) =>
  api.get(`/api/vehicles/${vehicleId}/invoice-search`, { params });

// ── ARIA Chat ─────────────────────────────────────────────────────────────────
// POST /api/chat/ask
// Params: { vehicle_id, question, current_mileage, conversation_history }
export const askAria = (data) => api.post('/api/chat/ask', data);

export default api;
