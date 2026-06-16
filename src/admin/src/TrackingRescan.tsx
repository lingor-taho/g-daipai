import { useState } from 'react';
import { Button, Card, Form, Input, Space, Table, Tag, Typography, message } from 'antd';
import { authHeaders } from './utils/auth';

type TrackingRescanResult = {
  productId: string;
  success: boolean;
  orderIds?: number[];
  markedCount?: number;
  error?: string;
};

async function runTrackingRescan(productIdsText: string) {
  const res = await fetch('/api/admin/tracking-rescan/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ productIdsText })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '单号重扫标记失败');
  return data;
}

export default function TrackingRescanPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<TrackingRescanResult[]>([]);

  async function handleRun() {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const data = await runTrackingRescan(values.productIdsText);
      setResults(data.results || []);
      message.success(`已标记：成功 ${data.marked || 0} 个，失败 ${data.failed || 0} 个。插件下次扫描会重新抓取单号并修正 Google 表格。`);
    } catch (e: any) {
      message.error(e.message || '单号重扫标记失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="单号重扫">
        <Form form={form} layout="vertical" onFinish={handleRun} style={{ maxWidth: 720 }}>
          <Form.Item
            name="productIdsText"
            label="商品 ID"
            rules={[{ required: true, message: '请输入商品 ID' }]}
          >
            <Input.TextArea
              rows={8}
              placeholder={'一行一个商品 ID，例如：\nm123456789\nx123456789'}
            />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            将已是“待收货”的订单标记为单号重扫。插件会用最新页面解析逻辑重新抓取物流和单号，更新数据库，并按商品 ID 覆盖 Google 表格已有行。
          </Typography.Paragraph>
          <Button type="primary" htmlType="submit" loading={loading}>
            批量标记
          </Button>
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
            {
              title: '订单 ID',
              dataIndex: 'orderIds',
              render: (value: number[]) => value?.length ? value.join(', ') : '-'
            },
            { title: '标记订单数', dataIndex: 'markedCount', render: (value: number) => value ?? '-' },
            { title: '说明', dataIndex: 'error', render: (value: string) => value || '-' }
          ]}
        />
      </Card>
    </Space>
  );
}
