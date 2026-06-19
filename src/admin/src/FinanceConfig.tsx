import { useEffect, useState } from 'react';
import { Button, Card, Form, InputNumber, Typography, message } from 'antd';
import { authHeaders, fetchAdminJson } from './utils/auth';

async function saveFinanceConfig(values: any) {
  const res = await fetch('/api/admin/finance-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(values)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '保存失败');
  return data;
}

export default function FinanceConfig() {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  async function loadFinanceConfig() {
    const data = await fetchAdminJson('/api/admin/finance-config');
    form.setFieldsValue({
      bankFeeJpy: data.bankFeeJpy,
      handlingFeeCny: data.handlingFeeCny,
      largeAmountFeeCny: data.largeAmountFeeCny
    });
  }

  useEffect(() => {
    loadFinanceConfig().catch(() => {});
  }, []);

  async function handleSaveConfig() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await saveFinanceConfig(values);
      message.success('参数已保存');
    } catch (e: any) {
      message.error(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <Form form={form} layout="inline" className="admin-mobile-form" onFinish={handleSaveConfig}>
        <Form.Item name="bankFeeJpy" label="银行手续费(日元)" rules={[{ required: true, message: '请输入银行手续费' }]}>
          <InputNumber min={0} step={1} precision={0} />
        </Form.Item>
        <Form.Item name="handlingFeeCny" label="手续费(RMB)" rules={[{ required: true, message: '请输入手续费' }]}>
          <InputNumber min={0} step={0.01} precision={2} />
        </Form.Item>
        <Form.Item name="largeAmountFeeCny" label="大金额费用(RMB)" className="admin-finance-large-fee-item" rules={[{ required: true, message: '请输入大金额费用' }]}>
          <InputNumber min={0} step={0.01} precision={2} />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>保存参数</Button>
        </Form.Item>
        <Typography.Text type="secondary">
          应付款在点击结算后写入订单；汇率使用本次结算输入值，特殊用户设置会覆盖对应费用参数。
        </Typography.Text>
      </Form>
    </Card>
  );
}
