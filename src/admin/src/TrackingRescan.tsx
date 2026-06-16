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
  if (!res.ok) throw new Error(data.error || '\u5355\u53f7\u91cd\u626b\u6807\u8bb0\u5931\u8d25');
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
      message.success(`\u5df2\u6807\u8bb0\uff1a\u6210\u529f ${data.marked || 0} \u4e2a\uff0c\u5931\u8d25 ${data.failed || 0} \u4e2a\u3002\u63d2\u4ef6\u4e0b\u6b21\u626b\u63cf\u4f1a\u91cd\u65b0\u6293\u53d6\u5355\u53f7\u5e76\u4fee\u6b63 Google \u8868\u683c\u3002`);
    } catch (e: any) {
      message.error(e.message || '\u5355\u53f7\u91cd\u626b\u6807\u8bb0\u5931\u8d25');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="\u5355\u53f7\u91cd\u626b">
        <Form form={form} layout="vertical" onFinish={handleRun} style={{ maxWidth: 720 }}>
          <Form.Item
            name="productIdsText"
            label="\u5546\u54c1 ID"
            rules={[{ required: true, message: '\u8bf7\u8f93\u5165\u5546\u54c1 ID' }]}
          >
            <Input.TextArea
              rows={8}
              placeholder={'\u4e00\u884c\u4e00\u4e2a\u5546\u54c1 ID\uff0c\u4f8b\u5982\uff1a\nm123456789\nx123456789'}
            />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            {'\u5c06\u5df2\u662f\u201c\u5f85\u6536\u8d27\u201d\u7684\u8ba2\u5355\u6807\u8bb0\u4e3a\u5355\u53f7\u91cd\u626b\u3002\u63d2\u4ef6\u4f1a\u7528\u6700\u65b0\u9875\u9762\u89e3\u6790\u903b\u8f91\u91cd\u65b0\u6293\u53d6\u7269\u6d41\u548c\u5355\u53f7\uff0c\u66f4\u65b0\u6570\u636e\u5e93\uff0c\u5e76\u6309\u5546\u54c1 ID \u8986\u76d6 Google \u8868\u683c\u5df2\u6709\u884c\u3002'}
          </Typography.Paragraph>
          <Button type="primary" htmlType="submit" loading={loading}>
            {'\u6279\u91cf\u6807\u8bb0'}
          </Button>
        </Form>
      </Card>

      <Card title="\u6807\u8bb0\u7ed3\u679c">
        <Table
          rowKey="productId"
          dataSource={results}
          pagination={false}
          columns={[
            { title: '\u5546\u54c1 ID', dataIndex: 'productId' },
            {
              title: '\u72b6\u6001',
              dataIndex: 'success',
              render: (success: boolean) => success ? <Tag color="success">{'\u5df2\u6807\u8bb0'}</Tag> : <Tag color="error">{'\u5931\u8d25'}</Tag>
            },
            {
              title: '\u8ba2\u5355 ID',
              dataIndex: 'orderIds',
              render: (value: number[]) => value?.length ? value.join(', ') : '-'
            },
            { title: '\u6807\u8bb0\u8ba2\u5355\u6570', dataIndex: 'markedCount', render: (value: number) => value ?? '-' },
            { title: '\u8bf4\u660e', dataIndex: 'error', render: (value: string) => value || '-' }
          ]}
        />
      </Card>
    </Space>
  );
}
