import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Form, Input, message } from 'antd';

export default function AdminLogin() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  async function handleLogin() {
    if (!username || !password) {
      message.warning('请输入管理员账号和密码');
      return;
    }

    try {
      const res = await fetch('/api/auth/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '登录失败');
      localStorage.setItem('token', data.token);
      localStorage.setItem('username', data.username);
      localStorage.setItem('role', data.role);
      navigate('/tasks');
    } catch (e) {
      message.error(e.message || '登录失败');
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '80px auto', padding: 20 }}>
      <Card title="管理员登录">
        <Form layout="vertical" onFinish={handleLogin}>
          <Form.Item label="账号" required>
            <Input value={username} onChange={e => setUsername(e.target.value)} />
          </Form.Item>
          <Form.Item label="密码" required>
            <Input.Password value={password} onChange={e => setPassword(e.target.value)} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>登录</Button>
        </Form>
      </Card>
    </div>
  );
}
