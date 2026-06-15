import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Select, Space, Table, Tag, Typography, message } from 'antd';
import { authHeaders, fetchAdminJson } from './utils/auth';
import {
  getManualOrderImportStatusView,
  canClearManualOrderImportBatch,
  shouldEditManualImportShippingFee,
  shouldAutoRefreshManualOrderImportBatch
} from './manualOrderImportState';

function formatLocalDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function statusTag(batch?: any) {
  const view = getManualOrderImportStatusView(batch);
  return <Tag color={view.color}>{view.label}</Tag>;
}

function getAssignableUserTypeText(levelValue: any) {
  const level = Number(levelValue || 1);
  return level === 2 ? '代理用户' : '普通用户';
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
  const [clearing, setClearing] = useState(false);
  const [assignments, setAssignments] = useState<Record<number, number>>({});
  const [shippingEdits, setShippingEdits] = useState<Record<number, string>>({});

  async function loadUsers() {
    const data = await fetchAdminJson('/api/admin/users/options');
    setUsers(Array.isArray(data.items) ? data.items : []);
  }

  async function loadLatestBatch() {
    const data = await fetchAdminJson('/api/admin/manual-order-import/batches');
    const latest = Array.isArray(data.items) ? data.items[0] : null;
    if (latest?.id) setBatchId(latest.id);
  }

  async function loadBatch(id = batchId, options: { silent?: boolean } = {}) {
    if (!id) return;
    if (!options.silent) setLoading(true);
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
      setShippingEdits(current => {
        const next = { ...current };
        for (const item of nextItems) {
          if (next[item.id] === undefined) next[item.id] = item.shipping_fee_text || '';
        }
        return next;
      });
      return data.batch || null;
    } catch (e: any) {
      message.error(e.message || '加载导入批次失败');
      return null;
    } finally {
      if (!options.silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers().catch(() => null);
    loadLatestBatch().catch(() => null);
  }, []);

  useEffect(() => {
    if (!batchId) return;
    let cancelled = false;
    let timer: number | undefined;

    async function refreshBatch(silent = false) {
      const nextBatch = await loadBatch(batchId, { silent });
      if (cancelled || !shouldAutoRefreshManualOrderImportBatch(nextBatch)) return;
      timer = window.setTimeout(() => refreshBatch(true), 5000);
    }

    refreshBatch();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
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
      setShippingEdits({});
    } catch (e: any) {
      message.error(e.message || '创建导入任务失败');
    } finally {
      setRequesting(false);
    }
  }

  async function confirmImport() {
    const pending = items.filter(item => item.status === 'pending_user');
    if (!pending.length) {
      message.warning('没有可确认导入的候选订单');
      return;
    }
    setConfirming(true);
    try {
      const res = await fetch(`/api/admin/manual-order-import/batches/${batchId}/confirm`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignments: pending.map(item => ({
            itemId: item.id,
            userId: assignments[item.id],
            shippingFeeText: shippingEdits[item.id] ?? item.shipping_fee_text ?? ''
          }))
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '确认导入失败');
      message.success(`已导入 ${data.imported || 0} 条，未分配跳过 ${data.skippedUnassigned || 0} 条，已存在跳过 ${data.skippedExisting || 0} 条`);
      await loadBatch();
    } catch (e: any) {
      message.error(e.message || '确认导入失败');
    } finally {
      setConfirming(false);
    }
  }

  async function clearCurrentBatch() {
    if (!batchId) return;
    setClearing(true);
    try {
      const res = await fetch(`/api/admin/manual-order-import/batches/${batchId}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '清空当前批次失败');
      message.success('已清空当前批次');
      setBatchId(null);
      setBatch(null);
      setItems([]);
      setAssignments({});
      setShippingEdits({});
    } catch (e: any) {
      message.error(e.message || '清空当前批次失败');
    } finally {
      setClearing(false);
    }
  }

  const userOptions = useMemo(() => users
    .filter(user => Number(user.user_level || 1) < 3)
    .map(user => {
      const userTypeText = getAssignableUserTypeText(user.user_level);
      return {
        value: user.id,
        label: user.username,
        userTypeText,
        searchText: `${user.username} ${userTypeText}`
      };
    }), [users]);

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
    {
      title: '运费',
      dataIndex: 'shipping_fee_text',
      width: 160,
      render: (v: any, row: any) => row.status === 'pending_user' && shouldEditManualImportShippingFee(v) ? (
        <Input
          style={{ width: 140 }}
          placeholder="运费"
          value={shippingEdits[row.id] ?? v ?? ''}
          onChange={event => setShippingEdits(prev => ({ ...prev, [row.id]: event.target.value }))}
        />
      ) : (v || '-')
    },
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
          optionFilterProp="searchText"
          value={assignments[row.id]}
          options={userOptions}
          optionRender={(option: any) => (
            <Space direction="vertical" size={0}>
              <span>{option.data.label}</span>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{option.data.userTypeText}</Typography.Text>
            </Space>
          )}
          onChange={value => setAssignments(prev => ({ ...prev, [row.id]: value }))}
        />
      ) : (row.assigned_username || row.assigned_user_id || '-')
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (v: any) => {
        if (v === 'pending_user') return <Tag color="blue">待分配</Tag>;
        if (v === 'imported') return <Tag color="green">已导入</Tag>;
        if (v === 'skipped_unassigned') return <Tag>未分配跳过</Tag>;
        return <Tag>{v || '-'}</Tag>;
      }
    }
  ];
  const batchStatusView = getManualOrderImportStatusView(batch);

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Card title="导入订单">
        <Form
          className="admin-mobile-form"
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
              <Button onClick={() => loadBatch()} loading={loading}>刷新当前列表</Button>
            </Form.Item>
          ) : null}
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          插件会在空闲 D 扫描阶段优先执行导入读取；正式导入后不会自动触发交易开始。确认导入成功后，可清空当前批次。
        </Typography.Paragraph>
      </Card>

      {batch ? (
        <Card
          className="admin-manual-import-batch-card"
          title={<Space>当前批次 #{batch.id} {statusTag(batch)}</Space>}
          extra={(
            <Space className="admin-manual-import-batch-actions">
              <Button
                danger
                onClick={clearCurrentBatch}
                loading={clearing}
                disabled={!canClearManualOrderImportBatch(batch)}
              >
                清空当前批次
              </Button>
              <Button type="primary" onClick={confirmImport} loading={confirming} disabled={!batchStatusView.canConfirm}>确认导入</Button>
            </Space>
          )}
        >
          <Space wrap style={{ marginBottom: 12 }}>
            <Typography.Text>日期：{batch.start_date} 至 {batch.end_date}</Typography.Text>
            <Typography.Text>最多翻页：{batch.max_pages}</Typography.Text>
            <Typography.Text>已翻页：{batch.scanned_pages || 0}</Typography.Text>
            <Typography.Text>候选：{batch.candidate_count || 0}</Typography.Text>
            <Typography.Text>跳过已存在：{batch.skipped_existing_count || 0}</Typography.Text>
          </Space>
          {batchStatusView.isCompleteWithoutCandidates ? (
            <Typography.Paragraph type="secondary">
              读取已完成，本次没有新的待分配订单；已存在订单跳过 {batch.skipped_existing_count || 0} 条。
            </Typography.Paragraph>
          ) : null}
          {batch.error_msg ? <Typography.Paragraph type="danger">错误：{batch.error_msg}</Typography.Paragraph> : null}
          <Table
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={items}
            locale={{ emptyText: batchStatusView.emptyText || undefined }}
            pagination={{ pageSize: 20 }}
            scroll={{ x: 980 }}
          />
        </Card>
      ) : null}
    </Space>
  );
}
