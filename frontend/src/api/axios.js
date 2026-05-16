import axios from 'axios';

// All backend URLs flow through one env var so deploying to a different host
// is a single-line change. Default points at local dev backend.
export const API_BASE_URL =
  (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, '');

/**
 * Build a fully-qualified URL for a backend-served asset (image, file, etc).
 * Accepts a relative path returned by the API (e.g. "storage/123/image.png")
 * or an absolute URL (returned as-is).
 */
export const assetUrl = (path) => {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const trimmed = String(path).replace(/^\/+/, '');
  return `${API_BASE_URL}/${trimmed}`;
};

/**
 * Build an API endpoint URL (for cases where you need a download link rather
 * than an axios call — e.g. <a href="..."> exports).
 */
export const apiUrl = (path) => {
  if (!path) return API_BASE_URL;
  const trimmed = String(path).replace(/^\/+/, '');
  return `${API_BASE_URL}/${trimmed}`;
};

const api = axios.create({
  baseURL: API_BASE_URL,
  // 10 minutes — AI extraction on big spreadsheets routinely takes 60–120s, and
  // Gemini retries on 503 can stack another 30s on top.
  timeout: 600000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add a request interceptor to include the JWT token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Add a response interceptor to handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      // Optional: redirect to login
    }
    return Promise.reject(error);
  }
);

export default api;
