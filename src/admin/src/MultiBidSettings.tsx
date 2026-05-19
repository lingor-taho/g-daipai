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

export default function MultiBidSettingsPage() {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchAdminJson('/api/admin/multi-bid-config')
      .then(data => {
        form.setFieldsValue({
          startHours: data.startHours ?? 0.5,
          intervalMinutes: data.intervalMinutes ?? 5
        });
      })
      .catch(() => {});
  }, []);

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

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="多次加价设置">
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          initialValues={{ startHours: 0.5, intervalMinutes: 5 }}
          style={{ maxWidth: 520 }}
        >
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
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={saving}>保存参数</Button>
          </Form.Item>
          <Typography.Text type="secondary">
            多次出价会在开始时间后反复执行，每次尝试在最高价范围内超过对方。
          </Typography.Text>
        </Form>
      </Card>
    </Space>
  );
}
