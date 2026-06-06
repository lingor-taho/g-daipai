import { useState } from 'react';
import { Button, Card, Form, InputNumber, Space, Table, Tag, Typography, message } from 'antd';
import { authHeaders } from './utils/auth';

type BackfillResult = {
  orderId: number;
  productId: string;
  success: boolean;
  skipped?: boolean;
  reason?: string;
  appendedRows?: number;
  updatedRange?: string;
  error?: string;
};

const text = {
  pageTitle: '\u5f85\u6536\u8d27\u8865\u8868\u683c',
  failed: '\u5f85\u6536\u8d27\u8865\u8868\u683c\u5931\u8d25',
  limitLabel: '\u672c\u6b21\u6700\u591a\u5904\u7406\u8ba2\u5355\u6570',
  limitRequired: '\u8bf7\u8f93\u5165\u5904\u7406\u6570\u91cf',
  start: '\u5f00\u59cb\u8865\u5199',
  resultTitle: '\u8865\u5199\u7ed3\u679c',
  success: '\u6210\u529f',
  skipped: '\u8df3\u8fc7',
  error: '\u5931\u8d25',
  orderId: '\u8ba2\u5355 ID',
  productId: '\u5546\u54c1 ID',
  status: '\u72b6\u6001',
  appendedRows: '\u8ffd\u52a0\u884c\u6570',
  updatedRange: '\u8868\u683c\u8303\u56f4',
  note: '\u8bf4\u660e',
  description:
    '\u5c06\u8ba2\u5355\u72b6\u6001\u5df2\u7ecf\u662f\u201c\u5f85\u6536\u8d27\u201d\u4e14\u5c1a\u672a\u5199\u5165 Google \u8868\u683c\u7684\u8ba2\u5355\u6279\u91cf\u8ffd\u52a0\u5230\u201c-\u4ee3\u62cd\u8868-\u201d\u3002\u7cfb\u7edf\u5185\u901a\u8fc7 google_sheet_appended_at \u9632\u6b62\u91cd\u590d\u8ffd\u52a0\uff1b\u5982\u679c\u8868\u683c\u5916\u90e8\u5df2\u6709\u624b\u5de5\u884c\uff0c\u5f53\u524d\u4e0d\u4f1a\u8bfb\u53d6\u8868\u683c\u505a\u4e8c\u6b21\u53bb\u91cd\u3002\u8868\u5934\u4e3a\u7a7a\u65f6\u4f1a\u81ea\u52a8\u5199\u5165\u8868\u5934\u3002'
};

async function runReceiptSheetBackfill(limit: number) {
  const res = await fetch('/api/admin/receipt-sheet-backfill/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ limit })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || text.failed);
  return data;
}

export default function ReceiptSheetBackfillPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BackfillResult[]>([]);

  async function handleRun() {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const data = await runReceiptSheetBackfill(Number(values.limit || 100));
      setResults(data.results || []);
      message.success(
        `\u8865\u5199\u5b8c\u6210\uff1a\u8ffd\u52a0 ${data.appended || 0} \u6761\uff0c\u8df3\u8fc7 ${data.skipped || 0} \u6761\uff0c\u5931\u8d25 ${data.failed || 0} \u6761`
      );
    } catch (e: any) {
      message.error(e.message || text.failed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title={text.pageTitle}>
        <Form form={form} layout="vertical" onFinish={handleRun} initialValues={{ limit: 100 }} style={{ maxWidth: 520 }}>
          <Form.Item
            name="limit"
            label={text.limitLabel}
            rules={[{ required: true, message: text.limitRequired }]}
          >
            <InputNumber min={1} max={500} style={{ width: 180 }} />
          </Form.Item>
          <Typography.Paragraph type="secondary">{text.description}</Typography.Paragraph>
          <Button type="primary" htmlType="submit" loading={loading}>{text.start}</Button>
        </Form>
      </Card>

      <Card title={text.resultTitle}>
        <Table
          rowKey={(row) => `${row.orderId}-${row.productId}`}
          dataSource={results}
          pagination={false}
          columns={[
            { title: text.orderId, dataIndex: 'orderId', width: 90 },
            { title: text.productId, dataIndex: 'productId', width: 140 },
            {
              title: text.status,
              dataIndex: 'success',
              width: 120,
              render: (_: boolean, row: BackfillResult) => {
                if (row.skipped) return <Tag>{text.skipped}</Tag>;
                return row.success ? <Tag color="success">{text.success}</Tag> : <Tag color="error">{text.error}</Tag>;
              }
            },
            { title: text.appendedRows, dataIndex: 'appendedRows', width: 100, render: (value: number) => value ?? '-' },
            { title: text.updatedRange, dataIndex: 'updatedRange', width: 180, render: (value: string) => value || '-' },
            { title: text.note, dataIndex: 'reason', render: (_: string, row: BackfillResult) => row.error || row.reason || '-' }
          ]}
        />
      </Card>
    </Space>
  );
}
