import { useState } from 'react';
import { Button, Card, Form, Input, Space, Table, Tag, Typography, message } from 'antd';
import { authHeaders } from './utils/auth';

type RefreshResult = {
  productId: string;
  success: boolean;
  productType?: 'normal' | 'store';
  productTypeText?: string;
  updatedCount?: number;
  error?: string;
};

async function runProductTypeRefresh(productIdsText: string) {
  const res = await fetch('/api/admin/product-type-refresh/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ productIdsText })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '商品类型更新失败');
  return data;
}

export default function ProductTypeRefreshPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RefreshResult[]>([]);

  async function handleRun() {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const data = await runProductTypeRefresh(values.productIdsText);
      setResults(data.results || []);
      message.success(`更新完成：成功 ${data.updated || 0} 个，失败 ${data.failed || 0} 个`);
    } catch (e: any) {
      message.error(e.message || '商品类型更新失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="商品类型更新">
        <Form form={form} layout="vertical" onFinish={handleRun} style={{ maxWidth: 720 }}>
          <Form.Item
            name="productIdsText"
            label="商品 ID"
            rules={[{ required: true, message: '请输入商品 ID' }]}
          >
            <Input.TextArea
              rows={8}
              placeholder={'一行一个商品 ID，例如：\n1230841006\nb1227905707\nj1231001710'}
            />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            该功能使用服务端商品信息解析更新商品类型。价格后显示“（税0円）”会标记为普通商品，显示“（税込）”会标记为商城商品。
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
            { title: '商品类型', dataIndex: 'productTypeText', render: (value: string) => value || '-' },
            { title: '更新任务数', dataIndex: 'updatedCount', render: (value: number) => value ?? '-' },
            { title: '说明', dataIndex: 'error', render: (value: string) => value || '-' }
          ]}
        />
      </Card>
    </Space>
  );
}
