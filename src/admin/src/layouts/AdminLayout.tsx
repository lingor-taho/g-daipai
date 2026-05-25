import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Button, Layout, Menu, Space, Typography } from 'antd';
import { fetchAdminJson, isAdminLoggedIn } from '../utils/auth';

const { Header, Content, Sider } = Layout;

const menuItems = [
  { key: '/tasks', label: <Link to="/tasks">任务报表</Link> },
  { key: '/users', label: <Link to="/users">用户账号管理</Link> },
  { key: '/server-accounts', label: <Link to="/server-accounts">服务器账号</Link> },
  { key: '/multi-bid-settings', label: <Link to="/multi-bid-settings">系统配置</Link> },
  { key: '/data-cleanup', label: <Link to="/data-cleanup">清理数据</Link> },
  { key: '/orders', label: <Link to="/orders">订单管理</Link> }
];

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedKey = menuItems.find(item => location.pathname.startsWith(item.key))?.key || '/tasks';
  const username = localStorage.getItem('username') || 'admin';
  const [yahooLogin, setYahooLogin] = useState<any>({ status: 'unknown', message: '' });

  useEffect(() => {
    let active = true;

    async function fetchYahooLoginStatus() {
      if (!isAdminLoggedIn()) return;
      try {
        const stats = await fetchAdminJson('/api/admin/tasks/stats');
        if (active) setYahooLogin(stats.yahooLogin || { status: 'unknown', message: '' });
      } catch {
        if (active) setYahooLogin({ status: 'unknown', message: '' });
      }
    }

    fetchYahooLoginStatus();
    const timer = window.setInterval(fetchYahooLoginStatus, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('role');
    navigate('/login');
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingInline: 20 }}>
        <Typography.Text style={{ color: '#fff', fontSize: 16, fontWeight: 600 }}>g-daipai 后台</Typography.Text>
        <Space>
          <Typography.Text style={{ color: '#fff' }}>{username}</Typography.Text>
          <Button size="small" onClick={logout}>退出</Button>
        </Space>
      </Header>
      <Layout>
        <Sider width={210} theme="light">
          <div style={{ padding: '14px 16px', borderBottom: '1px dashed #d9d9d9' }}>
            <Typography.Text
              strong
              style={{ color: yahooLogin?.status === 'ok' ? '#389e0d' : '#cf1322' }}
            >
              {yahooLogin?.status === 'ok' ? 'yahoo正常登录中' : 'yahoo未登录/未确认'}
            </Typography.Text>
            {yahooLogin?.status !== 'ok' && yahooLogin?.message ? (
              <div style={{ marginTop: 4 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {yahooLogin.message}
                </Typography.Text>
              </div>
            ) : null}
          </div>
          <Menu mode="inline" selectedKeys={[selectedKey]} items={menuItems} style={{ height: '100%', borderRight: 0 }} />
        </Sider>
        <Layout>
          <Content style={{ padding: 20, background: '#f5f5f5' }}>
            <Outlet />
          </Content>
        </Layout>
      </Layout>
    </Layout>
  );
}
