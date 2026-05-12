import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000',
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
