import { useEffect, useState } from 'react';
import { Card, Table, Tag, Typography, message } from 'antd';
import { fetchAdminJson } from './utils/auth';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const raw = String(value).trim();
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw);
  if (Number.isNaN(date.getTime())) return raw;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

function getUserTypeText(levelValue: any) {
  const level = Number(levelValue || 1);
  return level === 2 ? '代理用户' : '普通用户';
}

export default function OnlineUsersPage() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  async function loadOnlineUsers() {
    setLoading(true);
    try {
      const data = await fetchAdminJson('/api/admin/online-users');
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total || 0));
    } catch (e: any) {
      message.error(e.message || '读取在线用户失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOnlineUsers();
    const timer = window.setInterval(loadOnlineUsers, 30000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <Card
      title="在线用户"
      extra={<Typography.Text type="secondary">未失效前台用户：{total}</Typography.Text>}
    >
      <Table
        rowKey="user_id"
        loading={loading}
        dataSource={items}
        pagination={false}
        scroll={{ x: true }}
        columns={[
          { title: '用户名', dataIndex: 'username', width: 160 },
          {
            title: '用户类型',
            dataIndex: 'user_level',
            width: 110,
            render: value => <Tag color={Number(value || 1) === 2 ? 'blue' : 'green'}>{getUserTypeText(value)}</Tag>
          },
          { title: '有效会话数', dataIndex: 'session_count', width: 110 },
          { title: '最近登录', dataIndex: 'latest_login_at', width: 170, render: value => formatDateTime(value) },
          { title: '最后访问', dataIndex: 'latest_seen_at', width: 170, render: value => formatDateTime(value) },
          { title: '失效时间', dataIndex: 'latest_expires_at', width: 170, render: value => formatDateTime(value) }
        ]}
      />
    </Card>
  );
}
