import { useState } from 'react';
import { Button, Card, Form, Input, Space, Table, Tag, Typography, message } from 'antd';
import { authHeaders } from './utils/auth';

type RefreshResult = {
  productId: string;
  success: boolean;
  orderIds?: number[];
  updatedCount?: number;
  orderStatusText?: string;
  error?: string;
};

async function runOrderStatusRefresh(productIdsText: string) {
  const res = await fetch('/api/admin/order-status-refresh/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ productIdsText })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '订单状态更新失败');
  return data;
}

export default function OrderStatusRefreshPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RefreshResult[]>([]);

  async function handleRun() {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const data = await runOrderStatusRefresh(values.productIdsText);
      setResults(data.results || []);
      message.success(`更新完成：成功 ${data.updated || 0} 个，失败 ${data.failed || 0} 个`);
    } catch (e: any) {
      message.error(e.message || '订单状态更新失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="订单状态更新">
        <Form form={form} layout="vertical" onFinish={handleRun} style={{ maxWidth: 720 }}>
          <Form.Item
            name="productIdsText"
            label="商品 ID"
            rules={[{ required: true, message: '请输入商品 ID' }]}
          >
            <Input.TextArea
              rows={8}
              placeholder={'一行一个商品 ID，例如：\nu1231519486\nm1114324624'}
            />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            将输入商品 ID 对应的订单状态批量更新为“完了”。
          </Typography.Paragraph>
          <Button type="primary" htmlType="submit" loading={loading}>批量更新</Button>
        </Form>
      </Card>

      <Card title="更新结果">
        <Table
          rowKey="productId"
          dataSource={results}
          pagination={false}
          columns={[
            { title: '商品 ID', dataIndex: 'productId' },
            {
              title: '状态',
              dataIndex: 'success',
              render: (success: boolean) => success ? <Tag color="success">成功</Tag> : <Tag color="error">失败</Tag>
            },
            {
              title: '订单 ID',
              dataIndex: 'orderIds',
              render: (value: number[]) => value?.length ? value.join(', ') : '-'
            },
            { title: '订单状态', dataIndex: 'orderStatusText', render: (value: string) => value || '-' },
            { title: '更新订单数', dataIndex: 'updatedCount', render: (value: number) => value ?? '-' },
            { title: '说明', dataIndex: 'error', render: (value: string) => value || '-' }
          ]}
        />
      </Card>
    </Space>
  );
}
