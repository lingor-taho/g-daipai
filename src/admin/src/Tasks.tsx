import { ProTable } from '@ant-design/pro-components';
import { useEffect, useState } from 'react';
import { Alert, Card, Col, Row, Space, Statistic, Tag, Typography } from 'antd';
import { fetchAdminJson, isAdminLoggedIn, redirectToLogin } from './utils/auth';
import { getTaskFailureLabel as getSharedTaskFailureLabel } from '../../shared/taskFailureReason';

const statusColors: Record<string, string> = {
  pending: 'default',
  processing: 'orange',
  ready: 'blue',
  polling: 'orange',
  bidding: 'processing',
  success: 'green',
  failed: 'red'
};

const statusLabels: Record<string, string> = {
  pending: '队列中',
  processing: '执行中',
  bidding: '已出价',
  success: '成功',
  failed: '出价失败'
};

const strategyLabels: Record<string, string> = {
  direct: '即时拍',
  multi_bid: '多次出价',
  manual_import: '导入',
  '1min': '结束前 1 分钟',
  '2min': '结束前 2 分钟',
  '5min': '结束前 5 分钟',
  '10min': '结束前 10 分钟'
};

function formatJPY(value: number | string | null | undefined) {
  return `${Number(value || 0).toLocaleString('ja-JP')}円`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const raw = String(value).trim();
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw);
  if (Number.isNaN(date.getTime())) return value;
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

export default function TasksPage() {
  const [stats, setStats] = useState<any>(null);
  const [statsError, setStatsError] = useState('');

  async function fetchStats() {
    try {
      if (!isAdminLoggedIn()) {
        setStatsError('请先登录后台：/login');
        redirectToLogin();
        return;
      }
      setStats(await fetchAdminJson('/api/admin/tasks/stats'));
      setStatsError('');
    } catch (e: any) {
      setStatsError(e.message || '统计加载失败');
    }
  }

  useEffect(() => {
    fetchStats();
    const timer = window.setInterval(fetchStats, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const columns = [
    { title: '提交用户', dataIndex: 'username', render: (_: any, row: any) => row.username || '-' },
    {
      title: '商品ID',
      dataIndex: 'product_id',
      render: (_: any, row: any) => (
        <a href={row.product_url || `https://auctions.yahoo.co.jp/jp/auction/${row.product_id}`} target="_blank" rel="noreferrer">
          {row.product_id}
        </a>
      )
    },
    { title: '当前价', dataIndex: 'current_price', render: (_: any, row: any) => formatJPY(row.current_price) },
    { title: '最高价', dataIndex: 'max_price', render: (_: any, row: any) => formatJPY(row.max_price) },
    { title: '策略', dataIndex: 'strategy', render: (_: any, row: any) => strategyLabels[row.strategy] || row.strategy || '即时拍' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (_: any, row: any) => (
        <Tag color={statusColors[row.status] || 'default'}>{row.status === 'failed' ? getSharedTaskFailureLabel(row.error_msg) : (statusLabels[row.status] || row.status)}</Tag>
      )
    },
    { title: '提交时间', dataIndex: 'created_at', render: (_: any, row: any) => formatDateTime(row.created_at) },
    { title: '下次执行时间', dataIndex: 'next_execute_at', render: (_: any, row: any) => formatDateTime(row.next_execute_at) },
    { title: '商品结束时间', dataIndex: 'end_time', render: (_: any, row: any) => formatDateTime(row.end_time) }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {statsError && <Alert type="error" showIcon message="队列统计加载失败" description={statsError} />}
      <Row gutter={[12, 12]}>
        <Col xs={12} md={8} xl={4}><Card><Statistic title="总任务" value={stats?.total || 0} /></Card></Col>
        <Col xs={12} md={8} xl={4}><Card><Statistic title="队列中" value={stats?.pending || 0} /></Card></Col>
        <Col xs={12} md={8} xl={4}><Card><Statistic title="执行中" value={stats?.processing || 0} /></Card></Col>
        <Col xs={12} md={8} xl={4}><Card><Statistic title="已出价" value={stats?.bidding || 0} /></Card></Col>
        <Col xs={12} md={8} xl={4}><Card><Statistic title="成功" value={stats?.success || 0} /></Card></Col>
        <Col xs={12} md={8} xl={4}><Card><Statistic title="出价失败" value={stats?.failed || 0} /></Card></Col>
      </Row>

      <Card>
        <Typography.Text type="secondary">下一条待执行</Typography.Text>
        <div style={{ marginTop: 8 }}>
          {stats?.nextTask ? (
            <Space wrap>
              <Typography.Text strong>#{stats.nextTask.id}</Typography.Text>
              <Typography.Text>
                <a
                  href={`https://auctions.yahoo.co.jp/jp/auction/${stats.nextTask.product_id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {stats.nextTask.product_id}
                </a>
                {stats.nextTask.product_title ? `, ${stats.nextTask.product_title}` : ''}
              </Typography.Text>
              <Tag>{strategyLabels[stats.nextTask.strategy] || stats.nextTask.strategy || '即时拍'}</Tag>
              <Typography.Text>{formatJPY(stats.nextTask.max_price)}</Typography.Text>
            </Space>
          ) : (
            <Typography.Text>暂无队列任务</Typography.Text>
          )}
        </div>
      </Card>

      <ProTable
        columns={columns}
        request={async (params: any) => {
          try {
            const data = await fetchAdminJson('/api/admin/tasks?' + new URLSearchParams(params));
            setStats(data.queue || stats);
            return { data: data.items || [], total: data.total || 0 };
          } catch {
            return { data: [], total: 0 };
          }
        }}
        rowKey="id"
        search={false}
        pagination={{ pageSize: 10 }}
      />
    </Space>
  );
}
