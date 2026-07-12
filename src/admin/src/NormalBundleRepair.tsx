import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Space, Table, Tag, Typography, message } from 'antd';
import { authHeaders } from './utils/auth';

type RepairResult = {
  mainProductId: string;
  productIds: string[];
  orderIds: number[];
  bundleGroupId: string;
  updated: number;
};

export default function NormalBundleRepairPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RepairResult | null>(null);

  async function handleRun() {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const res = await fetch('/api/admin/normal-bundle-repair/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ productIdsText: values.productIdsText })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '普通商品同捆修复失败');
      setResult(data);
      message.success(`同捆组修复完成，共更新 ${data.updated || 0} 个订单`);
    } catch (error: any) {
      setResult(null);
      message.error(error.message || '普通商品同捆修复失败');
    } finally {
      setLoading(false);
    }
  }

  const rows = result?.productIds.map((productId, index) => ({
    productId,
    orderId: result.orderIds[index],
    role: index === 0 ? '主商品' : '子商品'
  })) || [];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="普通商品同捆修复">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="仅用于 Yahoo 端已经成功申请同捆、但系统订单状态不一致的情况"
            description="系统不会重新向 Yahoo 申请同捆。请先确认输入的全部商品在 Yahoo 页面已经处于同一同捆申请中。"
          />
          <Form form={form} layout="vertical" onFinish={handleRun} style={{ maxWidth: 720 }}>
            <Form.Item
              name="productIdsText"
              label="同捆商品 ID"
              rules={[{ required: true, message: '请输入至少两个商品 ID' }]}
            >
              <Input.TextArea rows={8} placeholder={'一行一个商品 ID\n第一行是主商品，后续行是子商品'} />
            </Form.Item>
            <Typography.Paragraph type="secondary">
              处理成功后，全部订单会写入同一个新同捆组并改为“待同捆”。已结算、已付款、待发货及之后状态的订单不会被处理。
            </Typography.Paragraph>
            <Button type="primary" danger htmlType="submit" loading={loading}>确认修复</Button>
          </Form>
        </Space>
      </Card>

      {result ? (
        <Card title="修复结果">
          <Typography.Paragraph>同捆组：{result.bundleGroupId}</Typography.Paragraph>
          <Table
            rowKey="productId"
            dataSource={rows}
            pagination={false}
            columns={[
              { title: '商品 ID', dataIndex: 'productId' },
              { title: '订单 ID', dataIndex: 'orderId' },
              { title: '组内角色', dataIndex: 'role' },
              { title: '订单状态', render: () => <Tag color="purple">待同捆</Tag> }
            ]}
          />
        </Card>
      ) : null}
    </Space>
  );
}
