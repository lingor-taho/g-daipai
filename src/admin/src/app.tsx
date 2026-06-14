import { useEffect, useState, type ReactNode } from 'react';
import { isAdminLoggedIn, redirectToLogin } from './utils/auth';
import './global.css';

const CHUNK_RELOAD_FLAG = 'g-daipai-admin-chunk-reload';

function isChunkLoadError(error: unknown) {
  const text = [
    error instanceof Error ? error.name : '',
    error instanceof Error ? error.message : '',
    typeof error === 'string' ? error : '',
    String((error as any)?.message || ''),
    String((error as any)?.type || '')
  ].join(' ');
  return /ChunkLoadError|Loading chunk .* failed|importing a module script failed|Failed to fetch dynamically imported module/i.test(text);
}

function reloadOnceForChunkLoadError(error: unknown) {
  if (!isChunkLoadError(error)) return;
  if (sessionStorage.getItem(CHUNK_RELOAD_FLAG) === '1') return;
  sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
  window.location.reload();
}

function AdminAuthGuard({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState(() => {
    return window.location.hash === '#/login' || isAdminLoggedIn();
  });

  useEffect(() => {
    function checkAuth() {
      const onLoginPage = window.location.hash === '#/login';
      if (onLoginPage || isAdminLoggedIn()) {
        setAllowed(true);
        return;
      }
      setAllowed(false);
      redirectToLogin();
    }

    checkAuth();
    window.addEventListener('hashchange', checkAuth);
    window.addEventListener('storage', checkAuth);
    return () => {
      window.removeEventListener('hashchange', checkAuth);
      window.removeEventListener('storage', checkAuth);
    };
  }, []);

  useEffect(() => {
    const clearReloadFlag = window.setTimeout(() => {
      sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
    }, 5000);
    const handleError = (event: ErrorEvent) => reloadOnceForChunkLoadError(event.error || event.message);
    const handleRejection = (event: PromiseRejectionEvent) => reloadOnceForChunkLoadError(event.reason);
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.clearTimeout(clearReloadFlag);
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return allowed ? <>{children}</> : null;
}

export function rootContainer(container: ReactNode) {
  return <AdminAuthGuard>{container}</AdminAuthGuard>;
}
