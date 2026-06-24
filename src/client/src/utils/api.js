import axios from 'axios';

export const REQUEST_TIMEOUT_MS = 10000;

export const api = axios.create({
  baseURL: '/api',
  timeout: REQUEST_TIMEOUT_MS
});

export function getApiErrorMessage(error, fallback = '操作失败') {
  if (error?.code === 'ECONNABORTED' || /timeout/i.test(error?.message || '')) {
    return '网络请求超时，请稍后重试';
  }
  if (!error?.response && error?.request) {
    return '网络连接异常，请稍后重试';
  }
  return error?.response?.data?.error || fallback;
}

export function isRecoverableNetworkError(error) {
  if (error?.response) return false;
  return error?.code === 'ECONNABORTED' ||
    error?.code === 'ERR_NETWORK' ||
    /timeout|network/i.test(error?.message || '') ||
    Boolean(error?.request);
}

export function shouldRetryRequest(config = {}, error) {
  if (!isRecoverableNetworkError(error)) return false;
  if (config.__retryCount >= 1) return false;
  const method = String(config.method || 'get').toLowerCase();
  return ['get', 'head', 'options'].includes(method) || config.__allowRetry === true;
}

function createClientRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  async err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    if (shouldRetryRequest(err.config, err)) {
      const nextConfig = {
        ...err.config,
        __retryCount: (err.config.__retryCount || 0) + 1,
        headers: { ...(err.config.headers || {}) }
      };
      await new Promise(resolve => setTimeout(resolve, 300));
      return api(nextConfig);
    }
    return Promise.reject(err);
  }
);

export const login = (username, password) => api.post('/auth/login', { username, password });
export const getActingUsers = () => api.get('/auth/acting-users');
export const submitTask = (data) => api.post('/task/submit', {
  ...data,
  client_request_id: data?.client_request_id || createClientRequestId()
}, { __allowRetry: true });
export const getTaskList = (params) => api.get('/task/list', { params });
export const getActiveBiddingTaskList = (params) => api.get('/task/bidding', { params });
export const getWonTaskList = (params) => api.get('/task/won', { params });
export const getWonTaskDetail = (id) => api.get(`/task/won/${id}`);
export const getWonStats = (params) => api.get('/task/won-stats', { params });
export const getTaskDetail = (id) => api.get(`/task/${id}`);
export const cancelTask = (id) => api.patch(`/task/${id}/cancel`);
export const getTaskStats = () => api.get('/task/stats');
export const getManualVerificationAlert = () => api.get('/task/manual-verification-alert');
export const getWebsiteRate = () => api.get('/task/website-rate');
export const getClientSiteConfig = () => api.get('/task/site-config');
export const getPluginConfig = () => api.get('/plugin/config');

export function createGetProductInfo({ apiClient = api } = {}) {
  return async function getProductInfo(input) {
    const value = String(input || '').trim();
    const match = value.match(/[a-zA-Z]?\d{8,10}/);
    if (match) return apiClient.get('/proxy/fetch', { params: { url: value } });
    return apiClient.get('/proxy/fetch', { params: { keyword: value } });
  };
}

// Product details are resolved by the server so user browsers do not need Yahoo access.
export const getProductInfo = createGetProductInfo();

