import { useEffect, useState } from 'react';
import { getManualVerificationAlert } from '../utils/api';
import { buildManualVerificationAlert } from '../utils/manualVerificationAlert';

export default function ManualVerificationAlert() {
  const [alert, setAlert] = useState({ show: false, message: '' });
  const userLevel = Number(localStorage.getItem('userLevel') || 1);

  useEffect(() => {
    if (userLevel < 3) {
      setAlert({ show: false, message: '' });
      return undefined;
    }

    let active = true;
    async function loadAlert() {
      try {
        const res = await getManualVerificationAlert();
        const next = buildManualVerificationAlert(userLevel, res.data?.show ? { type: res.data.type || 'pin' } : null);
        if (active) setAlert(next.show ? { show: true, message: res.data?.message || next.message } : next);
      } catch {
        if (active) setAlert({ show: false, message: '' });
      }
    }

    loadAlert();
    const timer = window.setInterval(loadAlert, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [userLevel]);

  if (!alert.show) return null;

  return (
    <div
      style={{
        marginBottom: 10,
        padding: '10px 12px',
        borderRadius: 8,
        background: '#fff7e6',
        border: '1px solid #ffd591',
        color: '#ad4e00',
        fontSize: 14,
        fontWeight: 700
      }}
    >
      {alert.message}
    </div>
  );
}
