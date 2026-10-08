import { useState } from 'react';
import { Button, Card, Form, Input, Space, Table, Tag, Typography, message } from 'antd';
import { authHeaders } from './utils/auth';

type ClearResult = { productId: string; success: boolean; error?: string };

export default function AuctionHistoryClearPage() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ClearResult[]>([]);

  async function handleRun(values: { productIdsText: string }) {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/auction-history/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(values)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '清空失败');
      setResults(data.results || []);
      const summary = `清空完成：成功 ${data.cleared || 0} 个，失败 ${data.failed || 0} 个`;
      if (data.failed) message.warning(summary);
      else message.success(summary);
    } catch (error: any) {
      message.error(error.message || '清空失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="拍卖采集">
        <Form layout="vertical" onFinish={handleRun} style={{ maxWidth: 720 }}>
          <Form.Item name="productIdsText" label="商品 ID" rules={[{ required: true, whitespace: true, message: '请输入商品 ID' }]}>
            <Input.TextArea rows={8} disabled={loading} placeholder={'一行一个商品 ID，例如：\nn1245643469\nw1247063065'} />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            清空所填商品的拍卖记录 HTML 和数组，方便重新采集。清空后，符合条件的商品会在下次定时采集时加入队列，也可到系统配置手动加入执行队列。
          </Typography.Paragraph>
          <Button type="primary" htmlType="submit" loading={loading}>批量清空拍卖记录</Button>
        </Form>
      </Card>
      <Card title="清空结果">
        <Table rowKey="productId" dataSource={results} pagination={{ pageSize: 20 }} scroll={{ x: true }} columns={[
          { title: '商品 ID', dataIndex: 'productId' },
          { title: '状态', dataIndex: 'success', render: (success: boolean) => success ? <Tag color="success">已清空</Tag> : <Tag color="error">失败</Tag> },
          { title: '说明', dataIndex: 'error', render: (value: string) => value || '等待重新采集' }
        ]} />
      </Card>
    </Space>
  );
}
