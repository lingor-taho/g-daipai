import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Alert, Button, Layout, Menu, Space, Typography, message } from 'antd';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { fetchAdminJson, isAdminLoggedIn } from '../utils/auth';

const { Header, Content, Sider } = Layout;

const menuItemsConfig = [
  { key: '/tasks', fullLabel: '任务报表', shortLabel: '任', mobileLabel: '任务' },
  { key: '/users', fullLabel: '用户账号管理', shortLabel: '用', mobileLabel: '用户' },
  { key: '/server-accounts', fullLabel: '服务器账号', shortLabel: '服', mobileLabel: '账号' },
  { key: '/multi-bid-settings', fullLabel: '系统配置', shortLabel: '系', mobileLabel: '配置' },
  { key: '/data-cleanup', fullLabel: '清理数据', shortLabel: '清', mobileLabel: '清理' },
  { key: '/data-batch', fullLabel: '数据批处理', shortLabel: '批', mobileLabel: '批量' },
  { key: '/special-user-settings', fullLabel: '特殊用户设置', shortLabel: '特', mobileLabel: '特殊' },
  { key: '/orders', fullLabel: '订单管理', shortLabel: '订', mobileLabel: '订单' }
];

function renderPaymentAlertMessage(messageText: string) {
  const text = String(messageText || '');
  const pattern = /([a-zA-Z]?\d{8,10})/g;
  const parts: any[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const productId = match[1];
    parts.push(
      <a
        key={`${productId}-${match.index}`}
        href={`https://auctions.yahoo.co.jp/jp/auction/${productId}`}
        target="_blank"
        rel="noreferrer"
        style={{ color: '#1677ff' }}
      >
        {productId}
      </a>
    );
    lastIndex = match.index + productId.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length ? parts : text;
}

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedKey = menuItemsConfig.find(item => location.pathname.startsWith(item.key))?.key || '/tasks';
  const username = localStorage.getItem('username') || 'admin';
  const [yahooLogin, setYahooLogin] = useState<any>({ status: 'unknown', message: '' });
  const [paymentAlert, setPaymentAlert] = useState('');
  const [confirmReceiptAlert, setConfirmReceiptAlert] = useState('');
  const [shipmentAlerts, setShipmentAlerts] = useState<any[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);

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
      try {
        const flags = await fetchAdminJson('/api/admin/idle-flags');
        if (active) {
          setPaymentAlert(flags.paymentAlertMessage || '');
          setConfirmReceiptAlert(flags.confirmReceiptAlertMessage || '');
          setShipmentAlerts(Array.isArray(flags.shipmentAlerts) ? flags.shipmentAlerts : []);
        }
      } catch {
        if (active) {
          setPaymentAlert('');
          setConfirmReceiptAlert('');
          setShipmentAlerts([]);
        }
      }
    }

    fetchYahooLoginStatus();
    const timer = window.setInterval(fetchYahooLoginStatus, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    function handleChange(event: MediaQueryListEvent | MediaQueryList) {
      setIsMobile(event.matches);
    }
    handleChange(media);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('role');
    navigate('/login');
  }

  async function clearPaymentAlertAndContinue() {
    try {
      await fetchAdminJson('/api/admin/payment/continue', { method: 'POST' });
      setPaymentAlert('');
      message.success('付款任务已继续');
    } catch (e: any) {
      message.error(e.message || '继续付款任务失败');
    }
  }

  async function closeShipmentAlert(alertId: string) {
    try {
      await fetchAdminJson(`/api/admin/shipment-alerts/${encodeURIComponent(alertId)}/close`, { method: 'POST' });
      setShipmentAlerts(items => items.filter(item => item.id !== alertId));
    } catch (e: any) {
      message.error(e.message || '关闭待发货提醒失败');
    }
  }

  return (
    <Layout className="admin-shell" style={{ minHeight: '100vh' }}>
      <Header className="admin-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingInline: 20 }}>
        <Space>
          {!isMobile ? (
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
              style={{ fontSize: 16, width: 40, height: 40, color: '#fff' }}
            />
          ) : null}
          <Typography.Text style={{ color: '#fff', fontSize: 16, fontWeight: 600 }}>g-daipai 后台</Typography.Text>
        </Space>
        <Space>
          {isMobile ? (
            <Typography.Text
              style={{
                color: yahooLogin?.status === 'ok' ? '#95de64' : '#ffccc7',
                fontSize: 12,
                fontWeight: 600
              }}
            >
              {yahooLogin?.status === 'ok' ? 'Yahoo正常' : 'Yahoo未确认'}
            </Typography.Text>
          ) : null}
          <Typography.Text style={{ color: '#fff' }}>{username}</Typography.Text>
          <Button size="small" onClick={logout}>退出</Button>
        </Space>
      </Header>
      <Layout>
        {!isMobile ? (
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
        ) : null}
        <Layout className="admin-main" style={{ marginLeft: isMobile ? 0 : (collapsed ? 50 : 210), transition: 'margin-left 0.2s' }}>
          <Content className="admin-content" style={{ padding: 20, background: '#f5f5f5', minHeight: 'calc(100vh - 64px)' }}>
            {paymentAlert ? (
              <Alert
                type="error"
                showIcon
                message={
                  <Space wrap>
                    <Typography.Text style={{ color: '#cf1322' }}>{renderPaymentAlertMessage(paymentAlert)}</Typography.Text>
                    <Button size="small" danger onClick={clearPaymentAlertAndContinue}>清除并继续任务</Button>
                  </Space>
                }
                style={{ marginBottom: 12 }}
              />
            ) : null}
            {confirmReceiptAlert ? (
              <Alert
                type="error"
                showIcon
                message={<Typography.Text style={{ color: '#cf1322' }}>{renderPaymentAlertMessage(confirmReceiptAlert)}</Typography.Text>}
                style={{ marginBottom: 12 }}
              />
            ) : null}
            {shipmentAlerts.map(alert => (
              <Alert
                key={alert.id}
                type="warning"
                showIcon
                message={
                  <Space wrap>
                    <Typography.Text>
                      <a
                        href={`https://auctions.yahoo.co.jp/jp/auction/${alert.productId}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#1677ff' }}
                      >
                        {alert.productId}
                      </a>
                      {alert.productTitle ? ` ${alert.productTitle}` : ' 商品'}，超过{alert.daysOverdue}天未发货！
                    </Typography.Text>
                    <Button size="small" onClick={() => closeShipmentAlert(alert.id)}>关闭</Button>
                  </Space>
                }
                style={{ marginBottom: 12 }}
              />
            ))}
            <Outlet />
          </Content>
        </Layout>
      </Layout>
      {isMobile ? (
        <nav className="admin-bottom-nav">
          {menuItemsConfig.map(item => {
            const active = item.key === selectedKey;
            return (
              <Link
                key={item.key}
                to={item.key}
                className={`admin-bottom-nav-link${active ? ' admin-bottom-nav-link-active' : ''}`}
              >
                <span className="admin-bottom-nav-full">{item.mobileLabel}</span>
              </Link>
            );
          })}
        </nav>
      ) : null}
    </Layout>
  );
}
