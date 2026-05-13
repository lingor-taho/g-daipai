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
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}
