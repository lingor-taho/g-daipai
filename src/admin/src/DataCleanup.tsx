import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Form,
  InputNumber,
  Modal,
  Space,
  Switch,
  Table,
  Tabs,
  Typography,
  message
} from 'antd';
import type { Dayjs } from 'dayjs';
import { authHeaders, fetchAdminJson, getAdminHttpErrorMessage } from './utils/auth';
import DatabaseBackupPage from './DatabaseBackup';

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

async function previewWonDateCleanup(cleanupDate: string) {
  const res = await fetch('/api/admin/data-cleanup/won-date/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ cleanupDate })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(getAdminHttpErrorMessage(res.status, data, '预览失败'));
  return data;
}

async function runWonDateCleanup(cleanupDate: string) {
  const res = await fetch('/api/admin/data-cleanup/won-date/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ cleanupDate, confirm: true })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(getAdminHttpErrorMessage(res.status, data, '执行失败'));
  return data;
}

function countText(value: unknown) {
  return `${Number(value || 0)} 条`;
}

function ForceCleanupSummary({ summary }: { summary: any }) {
  if (!summary) return null;
  return (
    <Descriptions size="small" bordered column={2}>
      <Descriptions.Item label="截止落札日期">{summary.cutoffDate}</Descriptions.Item>
      <Descriptions.Item label="合计">{countText(summary.totalCount)}</Descriptions.Item>
      <Descriptions.Item label="商品信息">{countText(summary.productCount)}</Descriptions.Item>
      <Descriptions.Item label="任务">{countText(summary.taskCount)}</Descriptions.Item>
      <Descriptions.Item label="落札订单">{countText(summary.orderCount)}</Descriptions.Item>
      <Descriptions.Item label="出价日志">{countText(summary.bidLogCount)}</Descriptions.Item>
      <Descriptions.Item label="订单状态日志">{countText(summary.orderStatusLogCount)}</Descriptions.Item>
      <Descriptions.Item label="入札缓存">{countText(summary.biddingItemCount)}</Descriptions.Item>
    </Descriptions>
  );
}

export default function DataCleanupPage() {
  const [form] = Form.useForm();
  const [forceForm] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [forceRunning, setForceRunning] = useState(false);
  const [forcePreview, setForcePreview] = useState<any>(null);
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

  async function handleForcePreview() {
    const values = await forceForm.validateFields();
    const cleanupDate = (values.cleanupDate as Dayjs).format('YYYY-MM-DD');
    setPreviewing(true);
    try {
      const result = await previewWonDateCleanup(cleanupDate);
      setForcePreview(result);
      if (Number(result.totalCount || 0) === 0) {
        message.info('没有符合条件的数据');
      }
    } catch (e: any) {
      message.error(e.message || '预览失败');
    } finally {
      setPreviewing(false);
    }
  }

  async function executeForceCleanup(cleanupDate: string) {
    setForceRunning(true);
    try {
      const result = await runWonDateCleanup(cleanupDate);
      setForcePreview(result);
      if (Number(result.totalCount || 0) > 0) {
        message.success(`强制清理完成，共清理 ${result.totalCount} 条关联数据`);
      } else {
        message.info('强制清理完成：没有符合条件的数据');
      }
      await fetchLogs(1);
    } catch (e: any) {
      message.error(e.message || '执行失败');
    } finally {
      setForceRunning(false);
    }
  }

  async function handleForceRun() {
    const values = await forceForm.validateFields();
    const cleanupDate = (values.cleanupDate as Dayjs).format('YYYY-MM-DD');
    const preview = forcePreview?.cutoffDate === cleanupDate ? forcePreview : await previewWonDateCleanup(cleanupDate);
    setForcePreview(preview);
    Modal.confirm({
      title: '确认按落札日期强制清理？',
      content: `将删除 ${cleanupDate} 及之前落札订单关联的任务、订单、商品信息和日志，共 ${Number(preview.totalCount || 0)} 条关联数据。执行前请确认已经备份数据库。`,
      okText: '确认清理',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => executeForceCleanup(cleanupDate)
    });
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

  const regularCleanup = (
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

  const forceCleanup = (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="warning"
        showIcon
        message="按日期强制清理会删除成功落札订单"
        description="清理依据为落札日期 won_at。选择某一天后，会清理这一天及之前落札订单关联的任务、落札订单、商品信息、出价日志、订单状态日志和入札缓存。执行前请先备份 SQLite 数据库。"
      />
      <Card title="按日期强制清理">
        <Form form={forceForm} layout="vertical" style={{ maxWidth: 560 }}>
          <Form.Item
            name="cleanupDate"
            label="清理到哪个落札日期"
            rules={[{ required: true, message: '请选择落札日期' }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Space>
            <Button onClick={handleForcePreview} loading={previewing}>预览数量</Button>
            <Button danger type="primary" onClick={handleForceRun} loading={forceRunning}>确认清理</Button>
          </Space>
        </Form>
      </Card>
      {forcePreview && (
        <Card title="预览结果">
          <ForceCleanupSummary summary={forcePreview} />
        </Card>
      )}
    </Space>
  );

  return (
    <Tabs
      items={[
        { key: 'regular', label: '日常清理', children: regularCleanup },
        { key: 'force-date', label: '按日期强制清理', children: forceCleanup },
        { key: 'db-backup', label: '服务器DB下载', children: <DatabaseBackupPage /> }
      ]}
    />
  );
}
