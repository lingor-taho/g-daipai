import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Button, Toast } from 'antd-mobile';
import { login } from '../utils/api';

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
      navigate('/submit');
    } catch (e) {
      Toast.show({ content: e.response?.data?.error || '登录失败' });
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h2 style={{ textAlign: 'center', marginTop: 60 }}>代拍登录</h2>
      <div style={{ height: 40 }} />
      <Input placeholder="用户名" value={username} onChange={setUsername} />
      <div style={{ height: 10 }} />
      <Input placeholder="密码" type="password" value={password} onChange={setPassword} />
      <div style={{ height: 30 }} />
      <Button block color="primary" onClick={handleLogin}>登录</Button>
    </div>
  );
}