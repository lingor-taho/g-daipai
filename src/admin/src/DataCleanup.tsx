import { useEffect, useState } from 'react';
import { Button, Card, Form, InputNumber, Space, Switch, Table, Typography, message } from 'antd';
import { authHeaders, fetchAdminJson, getAdminHttpErrorMessage } from './utils/auth';

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

async function saveCleanupConfig(values: any) {
  const res = await fetch('/api/admin/data-cleanup/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(values)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(getAdminHttpErrorMessage(res.status, data, '保存失败'));
  return data;
}

async function runCleanup(retentionDays: number) {
  const res = await fetch('/api/admin/data-cleanup/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ retentionDays })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(getAdminHttpErrorMessage(res.status, data, '执行失败'));
  return data;
}

export default function DataCleanupPage() {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingLogs, setLoadingLogs] = useState(false);

  async function fetchLogs(nextPage = page) {
    setLoadingLogs(true);
    try {
      const data = await fetchAdminJson(`/api/admin/data-cleanup/logs?current=${nextPage}&pageSize=10`);
      setLogs(data.items || []);
      setTotal(data.total || 0);
      setPage(nextPage);
    } catch (e: any) {
      message.error(e.message || '日志加载失败');
    } finally {
      setLoadingLogs(false);
    }
  }

  useEffect(() => {
    fetchAdminJson('/api/admin/data-cleanup/config')
      .then(data => {
        form.setFieldsValue({
          enabled: Boolean(data.enabled),
          cleanupHour: data.cleanupHour ?? 3,
          retentionDays: data.retentionDays ?? 30
        });
      })
      .catch((e: any) => {
        message.error(e.message || '清理配置加载失败');
      });
    fetchLogs(1);
  }, []);

  async function handleSave() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await saveCleanupConfig(values);
      message.success('清理配置已保存');
    } catch (e: any) {
      message.error(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleRun() {
    const values = await form.validateFields();
    setRunning(true);
    try {
      const result = await runCleanup(values.retentionDays);
      const totalCount = Number(result.totalCount || 0);
      if (totalCount > 0) {
        message.success(`清理完成，共清理 ${totalCount} 条关联数据`);
      } else {
        message.info('清理完成：没有符合条件的数据');
      }
      await fetchLogs(1);
    } catch (e: any) {
      message.error(e.message || '执行失败');
    } finally {
      setRunning(false);
    }
  }

  const columns = [
    { title: '操作时间', dataIndex: 'created_at', render: (_: any, row: any) => formatDateTime(row.created_at) },
    { title: '类型', dataIndex: 'run_type', render: (_: any, row: any) => row.run_type === 'auto' ? '自动' : '手动' },
    { title: '保留天数', dataIndex: 'retention_days' },
    { title: '任务', dataIndex: 'task_count' },
    { title: '出价日志', dataIndex: 'bid_log_count' },
    { title: '订单', dataIndex: 'order_count' },
    { title: '入札缓存', dataIndex: 'bidding_item_count' },
    {
      title: '合计',
      render: (_: any, row: any) => Number(row.task_count || 0) +
        Number(row.bid_log_count || 0) +
        Number(row.order_count || 0) +
        Number(row.bidding_item_count || 0)
    }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ enabled: false, cleanupHour: 3, retentionDays: 30 }}
        style={{ maxWidth: 560 }}
      >
        <Card title="清理数据">
          <Form.Item name="enabled" label="自动清理" valuePropName="checked">
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>
          <Form.Item
            name="cleanupHour"
            label="每天执行时间"
            rules={[{ required: true, message: '请输入执行时间' }]}
          >
            <InputNumber min={0} max={23} step={1} precision={0} addonAfter="点" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="retentionDays"
            label="清理多少天以前的数据"
            rules={[{ required: true, message: '请输入保留天数' }]}
          >
            <InputNumber min={1} step={1} precision={0} addonAfter="天" style={{ width: '100%' }} />
          </Form.Item>
          <Typography.Text type="secondary">
            清理范围：超过保留天数的失败、中止、已出价任务，并删除对应出价日志、订单和入札缓存；成功订单不会清理。
          </Typography.Text>
          <div style={{ marginTop: 16 }}>
            <Space>
              <Button type="primary" onClick={handleSave} loading={saving}>保存配置</Button>
              <Button danger onClick={handleRun} loading={running}>手动执行</Button>
            </Space>
          </div>
        </Card>
      </Form>

      <Card title="清理日志">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={logs}
          loading={loadingLogs}
          pagination={{
            current: page,
            pageSize: 10,
            total,
            showSizeChanger: false,
            onChange: fetchLogs
          }}
        />
      </Card>
    </Space>
  );
}
