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

  const preparation = stats?.preparation || { pending: 0, processing: 0, failed: 0, items: [] };
  const preparationColumns = [
    { title: '批次 / 行号', render: (_: any, row: any) => `#${row.batch_id} / 第 ${row.line_number} 行` },
    { title: '提交用户', dataIndex: 'username' },
    { title: '商品ID', dataIndex: 'product_id' },
    { title: '税前最高价', dataIndex: 'max_price', render: (_: any, row: any) => formatJPY(row.max_price) },
    { title: '状态', render: (_: any, row: any) => (
      <Tag color={row.status === 'failed' ? 'red' : row.status === 'processing' ? 'orange' : 'default'}>
        {row.status === 'failed' ? '商品准备失败' : row.status === 'processing' ? '正在补全商品信息' : '等待补全商品信息'}
      </Tag>
    ) },
    { title: '错误信息', dataIndex: 'error_msg', render: (_: any, row: any) => row.error_msg || '-' },
    { title: '接收时间', dataIndex: 'created_at', render: (_: any, row: any) => formatDateTime(row.created_at) }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {statsError && <Alert type="error" showIcon message="队列统计加载失败" description={statsError} />}
      <Row gutter={[12, 12]}>
        <Col xs={12} md={8} xl={4}><Card><Statistic title="已建出价任务" value={stats?.total || 0} /></Card></Col>
        <Col xs={12} md={8} xl={4}><Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <Statistic style={{ flexShrink: 0 }} title="队列中" value={(stats?.pending || 0) + preparation.pending} />
            <div style={{ fontSize: 12, lineHeight: '20px', whiteSpace: 'nowrap' }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>待补全 {preparation.pending}</Typography.Text><br />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>待出价 {stats?.pending || 0}</Typography.Text>
            </div>
          </div>
        </Card></Col>
        <Col xs={12} md={8} xl={4}><Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <Statistic style={{ flexShrink: 0 }} title="执行中" value={(stats?.processing || 0) + preparation.processing} />
            <div style={{ fontSize: 12, lineHeight: '20px', whiteSpace: 'nowrap' }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>补全中 {preparation.processing}</Typography.Text><br />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>出价中 {stats?.processing || 0}</Typography.Text>
            </div>
          </div>
        </Card></Col>
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
            <Typography.Text>{preparation.pending + preparation.processing > 0
              ? `还有 ${preparation.pending + preparation.processing} 件正在排队补全商品信息，每件补全后立即加入出价队列`
              : '暂无队列任务'}</Typography.Text>
          )}
        </div>
      </Card>

      {(preparation.items?.length > 0) && <Card title="批量商品准备进度">
        <Typography.Paragraph type="secondary">
          待补全 {preparation.pending} 件，正在补全 {preparation.processing} 件，准备失败 {preparation.failed} 件。
          每件商品补全后立即进入下方出价任务列表，同时继续准备下一件。准备失败可在错误信息中查看原因。
        </Typography.Paragraph>
        <ProTable columns={preparationColumns} dataSource={preparation.items} rowKey="id"
          search={false} options={false} pagination={{ pageSize: 10 }} scroll={{ x: 900 }} />
      </Card>}

      <ProTable
        columns={columns}
        request={async (params: any) => {
          try {
            const data = await fetchAdminJson('/api/admin/tasks?' + new URLSearchParams(params));
            setStats((previous: any) => data.queue ? { ...previous, ...data.queue } : previous);
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
