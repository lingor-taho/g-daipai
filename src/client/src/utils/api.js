import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const login = (username, password) => api.post('/auth/login', { username, password });
export const submitTask = (data) => api.post('/task/submit', data);
export const getTaskList = (params) => api.get('/task/list', { params });
export const getTaskDetail = (id) => api.get(`/task/${id}`);
export const cancelTask = (id) => api.patch(`/task/${id}/cancel`);
export const getTaskStats = () => api.get('/admin/tasks/stats');
export const getPluginConfig = () => api.get('/plugin/config');

export function createGetProductInfo({ apiClient = api } = {}) {
  return async function getProductInfo(url) {
    const match = url.match(/[a-zA-Z]?\d{8,10}/);
    if (!match) throw new Error('invalid product url');
    return apiClient.get('/proxy/fetch', { params: { url } });
  };
}

// Product details are resolved by the server so user browsers do not need Yahoo access.
export const getProductInfo = createGetProductInfo();

