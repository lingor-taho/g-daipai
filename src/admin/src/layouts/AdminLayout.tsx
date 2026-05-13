import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button, Layout, Menu, Space, Typography } from 'antd';

const { Header, Content, Sider } = Layout;

const menuItems = [
  { key: '/tasks', label: <Link to="/tasks">任务报表</Link> },
  { key: '/users', label: <Link to="/users">用户账号管理</Link> },
  { key: '/server-accounts', label: <Link to="/server-accounts">服务器账号</Link> },
  { key: '/orders', label: <Link to="/orders">订单管理</Link> }
];

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedKey = menuItems.find(item => location.pathname.startsWith(item.key))?.key || '/tasks';
  const username = localStorage.getItem('username') || 'admin';

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
