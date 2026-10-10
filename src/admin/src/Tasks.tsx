import { ProTable } from '@ant-design/pro-components';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Popconfirm, Row, Space, Statistic, Tag, Typography, message } from 'antd';
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
  preparation_pending: '等待补全商品信息',
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
  const [queueVisible, setQueueVisible] = useState(false);
  const [queuePage, setQueuePage] = useState(1);
  const [queueData, setQueueData] = useState<any>({ items: [], total: 0 });
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState('');
  const queueCount = (stats?.pending || 0) + (stats?.preparation?.pending || 0);

  useEffect(() => {
    if (stats && queueCount === 0) setQueueVisible(false);
  }, [queueCount, stats]);

  useEffect(() => {
    if (!queueVisible) return;
    let active = true;
    let inFlight = false;
    const controller = new AbortController();
    async function refreshQueue() {
      if (inFlight) return;
      inFlight = true;
      setQueueLoading(true);
      try {
        const result = await fetchAdminJson(`/api/admin/tasks/queue?current=${queuePage}&pageSize=10`, { signal: controller.signal });
        if (!active) return;
        setQueueData(result);
        setQueueError('');
        if (!result.total) setQueueVisible(false);
        else if (!result.items.length && queuePage > 1) setQueuePage(Math.ceil(result.total / 10));
      } catch (error: any) {
        if (active) setQueueError(error.message || '队列详情加载失败');
      } finally {
        inFlight = false;
        if (active) setQueueLoading(false);
      }
    }
    refreshQueue();
    const timer = window.setInterval(refreshQueue, 5000);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, [queueVisible, queuePage]);

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
    {title:'结果核对',search:false,render:(_:any,row:any)=>row.execution_unknown?<Popconfirm title="先关闭对应插件和原出价页面，并在 Yahoo 核实没有此商品的入札。确认后允许用户重新提交；已入札时不要解除，请同步原账号状态。" onConfirm={async()=>{try{await fetchAdminJson(`/api/admin/tasks/${row.id}/resolve-unknown`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true,resolution:'no_bid'})});message.success('已解除未知结果限制');}catch(e:any){message.error(e.message);}}}><Button size="small">已核实无入札</Button></Popconfirm>:null},
    {title:'执行 Yahoo',width:140,dataIndex:'execution_account_name',render:(_:any,row:any)=>row.execution_yahoo_id || row.execution_account_name || '-'},
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
    { title: '当前价', dataIndex: 'current_price', render: (_: any, row: any) => row.status === 'preparation_pending' ? '-' : formatJPY(row.current_price) },
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

  const preparation = stats?.preparation || { pending: 0, processing: 0, items: [] };
  const activePreparationItems = (preparation.items || []).filter((item: any) =>
    item.status === 'pending' || item.status === 'processing');
  const preparationColumns = [
    { title: '批次 / 行号', render: (_: any, row: any) => `#${row.batch_id} / 第 ${row.line_number} 行` },
    { title: '提交用户', dataIndex: 'username' },
    { title: '商品ID', dataIndex: 'product_id' },
    { title: '税前最高价', dataIndex: 'max_price', render: (_: any, row: any) => formatJPY(row.max_price) },
    { title: '状态', render: (_: any, row: any) => (
      <Tag color={row.status === 'processing' ? 'orange' : 'default'}>
        {row.status === 'processing' ? '正在补全商品信息' : '等待补全商品信息'}
      </Tag>
    ) },
    { title: '接收时间', dataIndex: 'created_at', render: (_: any, row: any) => formatDateTime(row.created_at) }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {statsError && <Alert type="error" showIcon message="队列统计加载失败" description={statsError} />}
      <Row gutter={[12, 12]}>
        <Col xs={12} md={8} xl={4}><Card><Statistic title="已建出价任务" value={stats?.total || 0} /></Card></Col>
        <Col xs={12} md={8} xl={4}><Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <Statistic style={{ flexShrink: 0 }} title="队列中" value={queueCount}
              formatter={value => <button type="button" disabled={queueCount === 0}
                aria-label={queueVisible ? '收起队列详情' : '展开队列详情'} aria-expanded={queueVisible}
                aria-controls="task-queue-details"
                onClick={() => { setQueuePage(1); setQueueVisible(visible => !visible); }}
                style={{ padding: 0, border: 0, background: 'transparent', font: 'inherit',
                  color: queueCount > 0 ? '#1677ff' : 'inherit', cursor: queueCount > 0 ? 'pointer' : 'default' }}>
                {Number(value || 0).toLocaleString('en-US')}
              </button>} />
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

      {queueVisible && <Card id="task-queue-details" title="队列任务详情">
        {queueError && <Alert type="error" showIcon message="队列详情加载失败" description={queueError} />}
        <ProTable columns={columns} dataSource={queueData.items} rowKey="queue_key"
          loading={queueLoading} search={false} options={false} scroll={{ x: 1100 }}
          pagination={{ current: queuePage, pageSize: 10, total: queueData.total,
            showSizeChanger: false, onChange: page => setQueuePage(page) }} />
      </Card>}

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

      {(activePreparationItems.length > 0) && <Card title="批量商品准备进度">
        <Typography.Paragraph type="secondary">
          待补全 {preparation.pending} 件，正在补全 {preparation.processing} 件。
          每件商品补全后立即进入下方出价任务列表，同时继续准备下一件；全部处理结束后自动隐藏此区域。
        </Typography.Paragraph>
        <ProTable columns={preparationColumns} dataSource={activePreparationItems} rowKey="id"
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
