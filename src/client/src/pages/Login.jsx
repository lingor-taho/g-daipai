import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Button, Toast } from 'antd-mobile';
import { login } from '../utils/api';
import { colors, primaryButtonStyle } from '../styles';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  async function handleLogin() {
    if (!username || !password) return Toast.show({ content: '请输入用户名和密码' });
    try {
      const res = await login(username, password);
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('username', res.data.username);
      localStorage.setItem('userLevel', String(res.data.userLevel || 1));
      localStorage.removeItem('actingUserId');
      localStorage.removeItem('actingUsername');
      localStorage.removeItem('actingUserBidStrategyScope');
      navigate('/submit');
    } catch (e) {
      Toast.show({ content: '用户名或密码错误，请联系管理员！' });
    }
  }

  const inputWrapStyle = {
    height: 44,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: 8,
    padding: '0 12px',
    display: 'flex',
    alignItems: 'center',
    background: '#fff',
    boxSizing: 'border-box'
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        boxSizing: 'border-box',
        padding: '44px 20px 22px',
        background: '#ffffff',
        color: colors.text,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div style={{ maxWidth: 420, width: '100%', margin: '0 auto', flex: 1 }}>
        <div style={{ textAlign: 'center', marginTop: 24, marginBottom: 34 }}>
          <div style={{ fontSize: 12, color: colors.accent, fontWeight: 700, marginBottom: 8 }}>
            Kumohiro Auction Service
          </div>
          <h2 style={{ margin: 0, fontSize: 24, letterSpacing: 0, fontWeight: 800 }}>
            日本Yahoo代拍系统
          </h2>
          <div style={{ width: 46, height: 3, borderRadius: 999, background: colors.accent, margin: '14px auto 0' }} />
        </div>

        <div
          style={{
            background: 'rgba(255, 255, 255, 0.88)',
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            padding: 18,
            boxShadow: '0 14px 32px rgba(37, 99, 235, 0.08)'
          }}
        >
          <div style={inputWrapStyle}>
            <Input placeholder="用户名" value={username} onChange={setUsername} />
          </div>
          <div style={{ height: 12 }} />
          <div style={inputWrapStyle}>
            <Input placeholder="密码" type="password" value={password} onChange={setPassword} />
          </div>
          <div style={{ height: 26 }} />
          <Button
            block
            color="primary"
            onClick={handleLogin}
            style={primaryButtonStyle}
          >
            登录
          </Button>
        </div>
      </div>

      <div style={{ textAlign: 'center', color: colors.faint, fontSize: 12, paddingTop: 24 }}>
        © 2026 Kumohiro Co., Ltd.
      </div>
    </div>
  );
}
