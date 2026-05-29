import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Button, Layout, Menu, Space, Typography } from 'antd';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { fetchAdminJson, isAdminLoggedIn } from '../utils/auth';

const { Header, Content, Sider } = Layout;

const menuItemsConfig = [
  { key: '/tasks', fullLabel: '任务报表', shortLabel: '任' },
  { key: '/users', fullLabel: '用户账号管理', shortLabel: '用' },
  { key: '/server-accounts', fullLabel: '服务器账号', shortLabel: '服' },
  { key: '/multi-bid-settings', fullLabel: '系统配置', shortLabel: '系' },
  { key: '/data-cleanup', fullLabel: '清理数据', shortLabel: '清' },
  { key: '/shipping-refresh', fullLabel: '运费更新', shortLabel: '运' },
  { key: '/orders-resync', fullLabel: '落札商品更新', shortLabel: '落' },
  { key: '/special-user-settings', fullLabel: '特殊用户设置', shortLabel: '特' },
  { key: '/orders', fullLabel: '订单管理', shortLabel: '订' }
];

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedKey = menuItemsConfig.find(item => location.pathname.startsWith(item.key))?.key || '/tasks';
  const username = localStorage.getItem('username') || 'admin';
  const [yahooLogin, setYahooLogin] = useState<any>({ status: 'unknown', message: '' });
  const [collapsed, setCollapsed] = useState(false);

  // 根据折叠状态生成菜单项
  const menuItems = menuItemsConfig.map(item => ({
    key: item.key,
    label: <Link to={item.key}>{collapsed ? item.shortLabel : item.fullLabel}</Link>
  }));

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
        <Space>
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            style={{ fontSize: 16, width: 40, height: 40, color: '#fff' }}
          />
          <Typography.Text style={{ color: '#fff', fontSize: 16, fontWeight: 600 }}>g-daipai 后台</Typography.Text>
        </Space>
        <Space>
          <Typography.Text style={{ color: '#fff' }}>{username}</Typography.Text>
          <Button size="small" onClick={logout}>退出</Button>
        </Space>
      </Header>
      <Layout>
        <Sider 
          width={210} 
          collapsedWidth={50}
          theme="light" 
          collapsible 
          collapsed={collapsed} 
          trigger={null}
          style={{ 
            overflow: 'hidden',
            height: '100vh',
            position: 'fixed',
            left: 0,
            top: 64,
            bottom: 0
          }}
        >
          {!collapsed && (
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
          )}
          <Menu 
            mode="inline" 
            selectedKeys={[selectedKey]} 
            items={menuItems} 
            style={{ 
              height: '100%', 
              borderRight: 0,
              paddingLeft: collapsed ? 0 : undefined
            }} 
            inlineCollapsed={collapsed}
          />
        </Sider>
        <Layout style={{ marginLeft: collapsed ? 50 : 210, transition: 'margin-left 0.2s' }}>
          <Content style={{ padding: 20, background: '#f5f5f5', minHeight: 'calc(100vh - 64px)' }}>
            <Outlet />
          </Content>
        </Layout>
      </Layout>
    </Layout>
  );
}
