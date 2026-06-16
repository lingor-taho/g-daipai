import { useEffect, useState } from 'react';
import { Button, Card, Form, InputNumber, Space, Table, Tag, Typography, message } from 'antd';
import { authHeaders, fetchAdminJson } from './utils/auth';

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
  pageTitle: '待收货补表格',
  failed: '待收货补表格失败',
  limitLabel: '本次最多处理订单数',
  limitRequired: '请输入处理数量',
  start: '开始补写',
  resultTitle: '补写结果',
  success: '成功',
  skipped: '跳过',
  error: '失败',
  orderId: '订单 ID',
  productId: '商品 ID',
  status: '状态',
  appendedRows: '追加行数',
  updatedRange: '表格范围',
  note: '说明',
  description: (sheetName: string) =>
    `将订单状态已经是“待收货”且尚未写入 Google 表格的订单批量追加到“${sheetName || '-代拍表-'}”。字段为：落札日期、用户名、商品链接、商品标题、落札价、运费、同捆运费、总价、物流、单号。系统内通过 google_sheet_appended_at 防止重复追加；如果表格外部已有手工行，当前不会读取表格做二次去重。表头为空时会自动写入表头。`
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
  const [sheetName, setSheetName] = useState('-代拍表-');

  useEffect(() => {
    fetchAdminJson('/api/admin/multi-bid-config')
      .then(data => setSheetName(data.googleSheetName || '-代拍表-'))
      .catch(() => {});
  }, []);

  async function handleRun() {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const data = await runReceiptSheetBackfill(Number(values.limit || 100));
      setResults(data.results || []);
      message.success(
        `补写完成：追加 ${data.appended || 0} 条，跳过 ${data.skipped || 0} 条，失败 ${data.failed || 0} 条`
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
          <Typography.Paragraph type="secondary">{text.description(sheetName)}</Typography.Paragraph>
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
