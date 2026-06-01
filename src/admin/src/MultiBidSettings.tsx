import { useEffect, useState } from 'react';
import { Button, Card, Form, InputNumber, Space, Typography, message } from 'antd';
import { authHeaders, fetchAdminJson } from './utils/auth';

async function saveMultiBidConfig(values: any) {
  const res = await fetch('/api/admin/multi-bid-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(values)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '保存失败');
  return data;
}

async function requestTransactionStart() {
  const res = await fetch('/api/admin/transaction-start/request', {
    method: 'POST',
    headers: authHeaders()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '执行失败');
  return data;
}

async function resetTransactionStartOrders() {
  const res = await fetch('/api/admin/transaction-start/reset-orders', {
    method: 'POST',
    headers: authHeaders()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '初始化失败');
  return data;
}

export default function MultiBidSettingsPage() {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    fetchAdminJson('/api/admin/multi-bid-config')
      .then(data => {
        form.setFieldsValue({
          startHours: data.startHours ?? 0.5,
          intervalMinutes: data.intervalMinutes ?? 5,
          multiBidMinPrice: data.multiBidMinPrice ?? 5000,
          idleSyncIntervalMinutes: data.idleSyncIntervalMinutes ?? 5,
          idleBidGuardMinutes: data.idleBidGuardMinutes ?? 15,
          transactionStartHour: data.transactionStartHour ?? 1,
          scanStartHour: data.scanStartHour ?? 1,
          scanEndHour: data.scanEndHour ?? 20,
          scanEveryIdleRuns: data.scanEveryIdleRuns ?? 5
        });
      })
      .catch(() => {});
  }, [form]);

  async function handleSave() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await saveMultiBidConfig(values);
      message.success('参数已保存');
    } catch (e: any) {
      message.error(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleRequestTransactionStart() {
    setRequesting(true);
    try {
      await requestTransactionStart();
      message.success('交易开始已加入空闲执行队列');
    } catch (e: any) {
      message.error(e.message || '执行失败');
    } finally {
      setRequesting(false);
    }
  }

  async function handleResetTransactionStartOrders() {
    setResetting(true);
    try {
      const data = await resetTransactionStartOrders();
      message.success(`已初始化 ${data.reset || 0} 条订单状态`);
    } catch (e: any) {
      message.error(e.message || '初始化失败');
    } finally {
      setResetting(false);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSave}
        initialValues={{
          startHours: 0.5,
          intervalMinutes: 5,
          multiBidMinPrice: 5000,
          idleSyncIntervalMinutes: 5,
          idleBidGuardMinutes: 15,
          transactionStartHour: 1,
          scanStartHour: 1,
          scanEndHour: 20,
          scanEveryIdleRuns: 5
        }}
        style={{ maxWidth: 640 }}
      >
        <Card title="多次出价配置">
          <Form.Item
            name="multiBidMinPrice"
            label="多次出价最低最高价"
            rules={[{ required: true, message: '请输入最低最高价' }]}
          >
            <InputNumber min={1} step={100} precision={0} addonAfter="日元" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="startHours"
            label="结束前 X 小时开始拍"
            rules={[{ required: true, message: '请输入开始时间' }]}
          >
            <InputNumber min={0.01} step={0.5} precision={2} addonAfter="小时" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="intervalMinutes"
            label="每 X 分钟自动加价"
            rules={[{ required: true, message: '请输入加价间隔' }]}
          >
            <InputNumber min={1} step={1} precision={0} addonAfter="分钟" style={{ width: '100%' }} />
          </Form.Item>
          <Typography.Text type="secondary">
            多次出价会在开始时间后按加价间隔重复执行，在最高价范围内继续尝试超过对方。
          </Typography.Text>
        </Card>

        <Card title="入札、落札、交易开始、扫描、付款、收货配置" style={{ marginTop: 16 }}>
          <Form.Item
            name="idleSyncIntervalMinutes"
            label="空闲同步间隔"
            rules={[{ required: true, message: '请输入空闲同步间隔' }]}
          >
            <InputNumber min={1} step={1} precision={0} addonAfter="分钟" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="idleBidGuardMinutes"
            label="出价保护窗口"
            rules={[{ required: true, message: '请输入出价保护窗口' }]}
          >
            <InputNumber min={1} step={1} precision={0} addonAfter="分钟" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="transactionStartHour"
            label="交易开始执行整点"
            rules={[{ required: true, message: '请输入交易开始执行整点' }]}
          >
            <InputNumber min={0} max={23} step={1} precision={0} addonAfter="点" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="手动执行交易开始">
            <Space wrap>
              <Button loading={requesting} onClick={handleRequestTransactionStart}>加入执行队列</Button>
              <Button danger loading={resetting} onClick={handleResetTransactionStartOrders}>初始化订单状态</Button>
            </Space>
          </Form.Item>
          <Form.Item
            name="scanStartHour"
            label="扫描开始整点"
            rules={[{ required: true, message: '请输入扫描开始整点' }]}
          >
            <InputNumber min={0} max={23} step={1} precision={0} addonAfter="点" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="scanEndHour"
            label="扫描结束整点"
            rules={[{ required: true, message: '请输入扫描结束整点' }]}
          >
            <InputNumber min={0} max={23} step={1} precision={0} addonAfter="点" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="scanEveryIdleRuns"
            label="每 X 次空闲同步执行扫描"
            rules={[{ required: true, message: '请输入扫描间隔次数' }]}
          >
            <InputNumber min={1} step={1} precision={0} addonAfter="次" style={{ width: '100%' }} />
          </Form.Item>
          <Typography.Text type="secondary">
            插件没有可执行出价任务，并且保护窗口内没有即将出价的任务时，才会执行这些空闲操作。
          </Typography.Text>
        </Card>

        <Form.Item style={{ marginTop: 16 }}>
          <Button type="primary" htmlType="submit" loading={saving}>保存参数</Button>
        </Form.Item>
      </Form>
    </Space>
  );
}
