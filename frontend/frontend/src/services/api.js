import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Vehicles
export const getVehicles = () => api.get('/api/vehicles');
export const getVehicle = (id) => api.get(`/api/vehicles/${id}`);
export const createVehicle = (data) => api.post('/api/vehicles', data);
export const updateVehicle = (id, data) => api.put(`/api/vehicles/${id}`, data);
export const deleteVehicle = (id) => api.delete(`/api/vehicles/${id}`);

// Invoices
export const uploadInvoice = (vehicleId, file) => {
  const formData = new FormData();
  formData.append('file', file);
  
  return api.post(`/api/invoices/upload?vehicle_id=${vehicleId}`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
};

export const getInvoice = (id) => api.get(`/api/invoices/${id}`);
export const getVehicleInvoices = (vehicleId) => api.get(`/api/invoices/vehicle/${vehicleId}`);
export const confirmInvoice = (id, data) => api.post(`/api/invoices/${id}/confirm`, data);
export const deleteInvoice = (id) => api.delete(`/api/invoices/${id}`);

// Recommendations
export const getRecommendations = (data) => api.post('/api/recommendations', data);
export const addRecommendationsToHistory = (data) => api.post('/api/recommendations/add-to-history', data);

// Timeline
export const getTimeline = (vehicleId) => api.get(`/api/timeline/${vehicleId}`);

export default api;
