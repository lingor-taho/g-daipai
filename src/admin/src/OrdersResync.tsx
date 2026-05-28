import { useState } from 'react';
import { Button, Card, Form, Input, Space, Table, Tag, Typography, message } from 'antd';
import { authHeaders } from './utils/auth';

type ResyncResult = {
  productId: string;
  success: boolean;
  taskId?: number;
  taskStatus?: string;
  hasExistingOrder?: boolean;
  markedCount?: number;
  error?: string;
};

async function runOrdersResync(productIdsText: string) {
  const res = await fetch('/api/admin/orders-resync/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ productIdsText })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '落札商品更新失败');
  return data;
}

export default function OrdersResyncPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ResyncResult[]>([]);

  async function handleRun() {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const data = await runOrdersResync(values.productIdsText);
      setResults(data.results || []);
      message.success(`已标记：成功 ${data.queued || 0} 个，失败 ${data.failed || 0} 个。下次 Yahoo 落札页同步时会刷新这些商品。`);
    } catch (e: any) {
      message.error(e.message || '落札商品更新失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="落札商品更新">
        <Form form={form} layout="vertical" onFinish={handleRun} style={{ maxWidth: 720 }}>
          <Form.Item
            name="productIdsText"
            label="商品 ID"
            rules={[{ required: true, message: '请输入商品 ID' }]}
          >
            <Input.TextArea
              rows={8}
              placeholder={'一行一个商品 ID，例如：\nl1230196918\nk1230839207'}
            />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            将这些商品 ID 标记为"强制刷新落札数据"。下次插件同步 Yahoo 落札页时，
            即使该商品已经有订单数据，也会重新覆盖（落札价、运费、落札时间等）。
            标记会在更新成功后自动清除。
          </Typography.Paragraph>
          <Button type="primary" htmlType="submit" loading={loading}>批量标记</Button>
        </Form>
      </Card>

      <Card title="标记结果">
        <Table
          rowKey="productId"
          dataSource={results}
          pagination={false}
          columns={[
            { title: '商品 ID', dataIndex: 'productId' },
            {
              title: '状态',
              dataIndex: 'success',
              render: (success: boolean) => success ? <Tag color="success">已标记</Tag> : <Tag color="error">失败</Tag>
            },
            { title: '任务 ID', dataIndex: 'taskId', render: (value: number) => value ?? '-' },
            { title: '任务状态', dataIndex: 'taskStatus', render: (value: string) => value || '-' },
            {
              title: '已有订单',
              dataIndex: 'hasExistingOrder',
              render: (value: boolean) => value === undefined ? '-' : (value ? <Tag>是</Tag> : <Tag color="blue">否</Tag>)
            },
            { title: '说明', dataIndex: 'error', render: (value: string) => value || '-' }
          ]}
        />
      </Card>
    </Space>
  );
}
