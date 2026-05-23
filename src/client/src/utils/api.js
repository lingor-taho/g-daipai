import axios from 'axios';

export const REQUEST_TIMEOUT_MS = 15000;

export const api = axios.create({
  baseURL: '/api',
  timeout: REQUEST_TIMEOUT_MS
});

export function getApiErrorMessage(error, fallback = '操作失败') {
  if (error?.code === 'ECONNABORTED' || /timeout/i.test(error?.message || '')) {
    return '网络请求超时，请刷新页面后重试';
  }
  if (!error?.response && error?.request) {
    return '网络连接异常，请刷新页面后重试';
  }
  return error?.response?.data?.error || fallback;
}

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  const actingUserId = localStorage.getItem('actingUserId');
  if (actingUserId) cfg.headers['X-Acting-User-Id'] = actingUserId;
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
export const getActingUsers = () => api.get('/auth/acting-users');
export const submitTask = (data) => api.post('/task/submit', data);
export const getTaskList = (params) => api.get('/task/list', { params });
export const getActiveBiddingTaskList = (params) => api.get('/task/bidding', { params });
export const getWonTaskList = (params) => api.get('/task/won', { params });
export const getTaskDetail = (id) => api.get(`/task/${id}`);
export const cancelTask = (id) => api.patch(`/task/${id}/cancel`);
export const getTaskStats = () => api.get('/task/stats');
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

