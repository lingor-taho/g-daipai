export function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function isAdminLoggedIn() {
  return Boolean(localStorage.getItem('token') && localStorage.getItem('role') === 'admin');
}

export function redirectToLogin() {
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  localStorage.removeItem('role');
  if (window.location.hash !== '#/login') {
    window.location.hash = '#/login';
  }
}

export function getAdminHttpErrorMessage(status: number, data: any, fallback = '请求失败') {
  if (data?.error) return data.error;
  if (status === 404) return '接口不存在，请确认服务器已拉取最新代码并重启 API';
  if (status === 500) return '服务器内部错误，请查看 API 日志';
  return `${fallback}（HTTP ${status}）`;
}

export async function fetchAdminJson(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = {
    ...authHeaders(),
    ...(init.headers || {})
  };
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401 || res.status === 403) {
    redirectToLogin();
    throw new Error('请先登录后台');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(getAdminHttpErrorMessage(res.status, data));
  }
  return res.json();
}
