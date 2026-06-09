import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Select, Space, Table, Tag, Typography, message } from 'antd';
import { authHeaders, fetchAdminJson } from './utils/auth';

function formatLocalDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function statusTag(status?: string) {
  if (status === 'requested') return <Tag color="blue">等待插件读取</Tag>;
  if (status === 'scanning') return <Tag color="gold">插件读取中</Tag>;
  if (status === 'ready') return <Tag color="green">待分配用户</Tag>;
  if (status === 'confirmed') return <Tag color="purple">已导入</Tag>;
  if (status === 'failed') return <Tag color="red">读取失败</Tag>;
  return <Tag>{status || '-'}</Tag>;
}

export default function ManualOrderImportPage() {
  const [form] = Form.useForm();
  const [batchId, setBatchId] = useState<number | null>(null);
  const [batch, setBatch] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [assignments, setAssignments] = useState<Record<number, number>>({});

  async function loadUsers() {
    const data = await fetchAdminJson('/api/admin/users/options');
    setUsers(Array.isArray(data.items) ? data.items : []);
  }

  async function loadLatestBatch() {
    const data = await fetchAdminJson('/api/admin/manual-order-import/batches');
    const latest = Array.isArray(data.items) ? data.items[0] : null;
    if (latest?.id) setBatchId(latest.id);
  }

  async function loadBatch(id = batchId) {
    if (!id) return;
    setLoading(true);
    try {
      const data = await fetchAdminJson(`/api/admin/manual-order-import/batches/${id}`);
      setBatch(data.batch || null);
      const nextItems = Array.isArray(data.items) ? data.items : [];
      setItems(nextItems);
      setAssignments(current => {
        const next = { ...current };
        for (const item of nextItems) {
          if (item.assigned_user_id) next[item.id] = item.assigned_user_id;
        }
        return next;
      });
    } catch (e: any) {
      message.error(e.message || '加载导入批次失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers().catch(() => null);
    loadLatestBatch().catch(() => null);
  }, []);

  useEffect(() => {
    if (!batchId) return;
    loadBatch(batchId);
    const timer = window.setInterval(() => loadBatch(batchId), 5000);
    return () => window.clearInterval(timer);
  }, [batchId]);

  async function requestImport(values: any) {
    setRequesting(true);
    try {
      const res = await fetch('/api/admin/manual-order-import/request', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: values.startDate,
          endDate: values.endDate,
          maxPages: values.maxPages
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '创建导入任务失败');
      message.success('已创建导入读取任务，插件会在扫描阶段优先执行');
      setBatchId(data.id);
      setAssignments({});
    } catch (e: any) {
      message.error(e.message || '创建导入任务失败');
    } finally {
      setRequesting(false);
    }
  }

  async function confirmImport() {
    const pending = items.filter(item => item.status === 'pending_user');
    const missing = pending.filter(item => !assignments[item.id]);
    if (!pending.length) {
      message.warning('没有可确认导入的候选订单');
      return;
    }
    if (missing.length) {
      message.warning('请先给所有候选订单选择归属用户');
      return;
    }
    setConfirming(true);
    try {
      const res = await fetch(`/api/admin/manual-order-import/batches/${batchId}/confirm`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignments: pending.map(item => ({ itemId: item.id, userId: assignments[item.id] }))
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '确认导入失败');
      message.success(`已导入 ${data.imported || 0} 条，跳过已存在 ${data.skippedExisting || 0} 条`);
      await loadBatch();
    } catch (e: any) {
      message.error(e.message || '确认导入失败');
    } finally {
      setConfirming(false);
    }
  }

  const userOptions = useMemo(() => users.map(user => ({
    value: user.id,
    label: `${user.username}（等级${user.user_level || 1}）`
  })), [users]);

  const columns = [
    {
      title: '商品',
      dataIndex: 'product_title',
      width: 280,
      render: (_: any, row: any) => (
        <Space direction="vertical" size={2}>
          <a href={row.product_url} target="_blank" rel="noreferrer">{row.product_id}</a>
          <Typography.Text ellipsis style={{ maxWidth: 260 }}>{row.product_title || '-'}</Typography.Text>
        </Space>
      )
    },
    { title: '落札价', dataIndex: 'final_price', width: 90, render: (v: any) => v ? `${Number(v).toLocaleString()}円` : '-' },
    { title: '落札时间', dataIndex: 'won_time_text', width: 120 },
    { title: '运费', dataIndex: 'shipping_fee_text', width: 110, render: (v: any) => v || '-' },
    { title: '类型', dataIndex: 'product_type', width: 80, render: (v: any) => v === 'store' ? <Tag color="red">商城</Tag> : <Tag color="green">普通</Tag> },
    {
      title: '归属用户',
      dataIndex: 'assigned_user_id',
      width: 220,
      render: (_: any, row: any) => row.status === 'pending_user' ? (
        <Select
          showSearch
          style={{ width: 200 }}
          placeholder="选择用户"
          optionFilterProp="label"
          value={assignments[row.id]}
          options={userOptions}
          onChange={value => setAssignments(prev => ({ ...prev, [row.id]: value }))}
        />
      ) : (row.assigned_username || row.assigned_user_id || '-')
    },
    { title: '状态', dataIndex: 'status', width: 110, render: (v: any) => v === 'pending_user' ? <Tag color="blue">待分配</Tag> : v === 'imported' ? <Tag color="green">已导入</Tag> : <Tag>{v || '-'}</Tag> }
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Card title="导入订单">
        <Form
          form={form}
          layout="inline"
          initialValues={{ startDate: formatLocalDate(-1), endDate: formatLocalDate(0), maxPages: 10 }}
          onFinish={requestImport}
        >
          <Form.Item label="开始日期" name="startDate" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item label="结束日期" name="endDate" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item label="最多翻页" name="maxPages" rules={[{ required: true }]}>
            <InputNumber min={1} max={50} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={requesting}>读取落札商品</Button>
          </Form.Item>
          {batchId ? (
            <Form.Item>
              <Button onClick={() => loadBatch()} loading={loading}>刷新</Button>
            </Form.Item>
          ) : null}
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          插件会在空闲 D 扫描阶段优先执行导入读取；正式导入后的订单状态为空，会从现有“交易开始”流程继续。
        </Typography.Paragraph>
      </Card>

      {batch ? (
        <Card
          title={<Space>当前批次 #{batch.id} {statusTag(batch.status)}</Space>}
          extra={<Button type="primary" onClick={confirmImport} loading={confirming} disabled={batch.status !== 'ready'}>确认导入</Button>}
        >
          <Space wrap style={{ marginBottom: 12 }}>
            <Typography.Text>日期：{batch.start_date} 至 {batch.end_date}</Typography.Text>
            <Typography.Text>最多翻页：{batch.max_pages}</Typography.Text>
            <Typography.Text>已翻页：{batch.scanned_pages || 0}</Typography.Text>
            <Typography.Text>候选：{batch.candidate_count || 0}</Typography.Text>
            <Typography.Text>跳过已存在：{batch.skipped_existing_count || 0}</Typography.Text>
          </Space>
          {batch.error_msg ? <Typography.Paragraph type="danger">错误：{batch.error_msg}</Typography.Paragraph> : null}
          <Table
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={items}
            pagination={{ pageSize: 20 }}
            scroll={{ x: 980 }}
          />
        </Card>
      ) : null}
    </Space>
  );
}
