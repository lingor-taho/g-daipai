import { useState } from 'react';
import { Button, Card, Form, Input, Popconfirm, Space, Table, Tag, Typography, message } from 'antd';
import { authHeaders } from './utils/auth';

type RollbackResult = {
  productId: string;
  success: boolean;
  orderIds?: number[];
  updatedCount?: number;
  orderStatusText?: string;
  error?: string;
};

async function runSettlementRollback(productIdsText: string) {
  const res = await fetch('/api/admin/settlement-rollback/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ productIdsText })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '撤销结算失败');
  return data;
}

export default function SettlementRollbackPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RollbackResult[]>([]);

  async function handleRun() {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const data = await runSettlementRollback(values.productIdsText);
      setResults(data.results || []);
      const resumeText = data.paymentResumed ? '；已清除对应付款失败提示并继续其他付款任务' : '';
      if ((data.rolledBack || 0) > 0) {
        message.success(`撤销完成：成功 ${data.rolledBack || 0} 个，失败 ${data.failed || 0} 个${resumeText}`);
      } else {
        message.error(`撤销失败：${data.failed || 0} 个商品未更新，请查看结果说明`);
      }
    } catch (e: any) {
      message.error(e.message || '撤销结算失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="撤销结算">
        <Form form={form} layout="vertical" style={{ maxWidth: 720 }}>
          <Form.Item
            name="productIdsText"
            label="商品 ID"
            rules={[{ required: true, message: '请输入商品 ID' }]}
          >
            <Input.TextArea
              rows={8}
              placeholder={'一行一个商品 ID，例如：\nj1239623383'}
            />
          </Form.Item>
          <Typography.Paragraph type="warning">
            仅支持尚未付款完成的“待支付”或“待结算”订单。操作会清空汇率、应付款、结算时间及相关费用，订单恢复为“待支付”。
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary">
            如果页面顶部的付款失败提示属于本次撤销成功的商品，系统会清除该提示并继续处理其他待付款订单。
          </Typography.Paragraph>
          <Popconfirm
            title="确认撤销这些订单的结算吗？"
            description="撤销后需要重新结算，才能再次发起付款。"
            okText="确认撤销"
            cancelText="取消"
            onConfirm={handleRun}
          >
            <Button danger type="primary" loading={loading}>撤销结算</Button>
          </Popconfirm>
        </Form>
      </Card>

      <Card title="撤销结果">
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
