import { useState } from 'react';
import { Button, Card, Form, Input, Modal, Space, Table, Tag, Typography, message } from 'antd';
import { authHeaders } from './utils/auth';

type DeleteResult = {
  productId: string;
  success: boolean;
  taskIds?: number[];
  orderIds?: number[];
  taskCount?: number;
  orderCount?: number;
  bidLogCount?: number;
  biddingItemCount?: number;
  orderStatusLogCount?: number;
  totalCount?: number;
  error?: string;
};

async function runProductDataDelete(productIdsText: string) {
  const res = await fetch('/api/admin/product-data-delete/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ productIdsText })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '删除商品数据失败');
  return data;
}

export default function ProductDataDeletePage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<DeleteResult[]>([]);

  async function handleRun() {
    const values = await form.validateFields();
    Modal.confirm({
      title: '确认删除商品数据？',
      content: '会删除输入商品 ID 对应的任务、订单、出价日志、订单状态日志和入札中缓存。删除后不可恢复。',
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      async onOk() {
        setLoading(true);
        try {
          const data = await runProductDataDelete(values.productIdsText);
          setResults(data.results || []);
          message.success(`删除完成：成功 ${data.deleted || 0} 个，失败 ${data.failed || 0} 个，共删除 ${data.totalDeletedRows || 0} 条数据`);
        } catch (e: any) {
          message.error(e.message || '删除商品数据失败');
        } finally {
          setLoading(false);
        }
      }
    });
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="删除商品数据">
        <Form form={form} layout="vertical" style={{ maxWidth: 720 }}>
          <Form.Item
            name="productIdsText"
            label="商品 ID"
            rules={[{ required: true, message: '请输入商品 ID' }]}
          >
            <Input.TextArea
              rows={8}
              placeholder={'一行一个商品 ID，例：\nv1231866422\nhttps://auctions.yahoo.co.jp/jp/auction/u1231861029'}
            />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            用于清理误同步、误生成订单等异常数据。会删除该商品 ID 下所有任务、订单、出价日志、订单状态日志和入札中缓存。
          </Typography.Paragraph>
          <Button danger type="primary" loading={loading} onClick={handleRun}>批量删除</Button>
        </Form>
      </Card>

      <Card title="删除结果">
        <Table
          rowKey="productId"
          dataSource={results}
          pagination={false}
          scroll={{ x: true }}
          columns={[
            { title: '商品 ID', dataIndex: 'productId', fixed: 'left' },
            {
              title: '状态',
              dataIndex: 'success',
              render: (success: boolean) => success ? <Tag color="success">已删除</Tag> : <Tag color="error">失败</Tag>
            },
            { title: '任务', dataIndex: 'taskCount', render: (value: number) => value ?? 0 },
            { title: '订单', dataIndex: 'orderCount', render: (value: number) => value ?? 0 },
            { title: '出价日志', dataIndex: 'bidLogCount', render: (value: number) => value ?? 0 },
            { title: '订单状态日志', dataIndex: 'orderStatusLogCount', render: (value: number) => value ?? 0 },
            { title: '入札中缓存', dataIndex: 'biddingItemCount', render: (value: number) => value ?? 0 },
            { title: '总计', dataIndex: 'totalCount', render: (value: number) => value ?? 0 },
            {
              title: '订单 ID',
              dataIndex: 'orderIds',
              render: (value: number[]) => value?.length ? value.join(', ') : '-'
            },
            { title: '说明', dataIndex: 'error', render: (value: string) => value || '-' }
          ]}
        />
      </Card>
    </Space>
  );
}
