import { useEffect, useState, type ReactNode } from 'react';
import { isAdminLoggedIn, redirectToLogin } from './utils/auth';

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

  return allowed ? <>{children}</> : null;
}

export function rootContainer(container: ReactNode) {
  return <AdminAuthGuard>{container}</AdminAuthGuard>;
}
