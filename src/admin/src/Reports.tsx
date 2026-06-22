import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, Row, Select, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import { fetchAdminJson } from './utils/auth';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const raw = String(value).trim();
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw);
  if (Number.isNaN(date.getTime())) return raw;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

function levelTag(level: string) {
  if (level === 'error') return <Tag color="red">失败</Tag>;
  if (level === 'warn') return <Tag color="orange">警告</Tag>;
  return <Tag color="blue">成功</Tag>;
}

function productLink(productId: string) {
  if (!productId) return '-';
  return (
    <a href={`https://auctions.yahoo.co.jp/jp/auction/${productId}`} target="_blank" rel="noreferrer">
      {productId}
    </a>
  );
}

export default function ReportsPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<any>({ summary: {}, byAction: [], byMethod: [], items: [], total: 0, current: 1, pageSize: 20 });
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [lastError, setLastError] = useState('');

  const queryValues = useMemo(() => form.getFieldsValue(), [form]);

  async function loadReport(next = pagination, filters = queryValues) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('current', String(next.current || 1));
      params.set('pageSize', String(next.pageSize || 20));
      ['level', 'action', 'method', 'productId'].forEach(key => {
        const value = String(filters?.[key] || '').trim();
        if (value) params.set(key, value);
      });
      const data = await fetchAdminJson(`/api/admin/reports/trusted-input?${params.toString()}`);
      setReport(data);
      setPagination({ current: Number(data.current || next.current || 1), pageSize: Number(data.pageSize || next.pageSize || 20) });
      setLastError('');
    } catch (e: any) {
      const text = e.message || '报表加载失败';
      setLastError(text);
      message.error(text);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport({ current: 1, pageSize: 20 }, {});
  }, []);

  const summary = report.summary || {};

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {lastError && <Alert type="error" showIcon message="报表加载失败" description={lastError} />}

      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><Card><Statistic title="真实鼠标总次数" value={summary.total || 0} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="兜底成功" value={summary.info || 0} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="兜底失败" value={summary.error || 0} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="最近使用" value={formatDateTime(summary.lastUsedAt)} /></Card></Col>
      </Row>

      <Card title="chrome.debugger 真实输入统计">
        <Form
          form={form}
          layout="inline"
          onFinish={values => loadReport({ ...pagination, current: 1 }, values)}
          style={{ marginBottom: 16, rowGap: 8 }}
        >
          <Form.Item name="level" label="状态">
            <Select
              allowClear
              style={{ width: 120 }}
              options={[
                { value: 'info', label: '成功' },
                { value: 'warn', label: '警告' },
                { value: 'error', label: '失败' }
              ]}
            />
          </Form.Item>
          <Form.Item name="action" label="动作">
            <Input allowClear placeholder="review / bundle:start" style={{ width: 190 }} />
          </Form.Item>
          <Form.Item name="method" label="方法">
            <Input allowClear placeholder="debuggerMouse" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="productId" label="商品ID">
            <Input allowClear placeholder="b123..." style={{ width: 150 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={loading}>查询</Button>
              <Button onClick={() => {
                form.resetFields();
                loadReport({ current: 1, pageSize: pagination.pageSize }, {});
              }}>重置</Button>
            </Space>
          </Form.Item>
        </Form>

        <Row gutter={[12, 12]}>
          <Col xs={24} xl={12}>
            <Table
              size="small"
              rowKey={row => `${row.action}-${row.method}`}
              loading={loading}
              dataSource={report.byAction || []}
              pagination={{ pageSize: 8 }}
              scroll={{ x: true }}
              columns={[
                { title: '动作', dataIndex: 'action', width: 180, render: value => value || '-' },
                { title: '方法', dataIndex: 'method', width: 160, render: value => value || '-' },
                { title: '次数', dataIndex: 'count', width: 90, sorter: (a: any, b: any) => Number(a.count || 0) - Number(b.count || 0) },
                { title: '失败', dataIndex: 'error_count', width: 90 },
                { title: '最近使用', dataIndex: 'last_used_at', width: 170, render: value => formatDateTime(value) }
              ]}
            />
          </Col>
          <Col xs={24} xl={12}>
            <Table
              size="small"
              rowKey={row => `${row.method}-${row.level}`}
              loading={loading}
              dataSource={report.byMethod || []}
              pagination={{ pageSize: 8 }}
              scroll={{ x: true }}
              columns={[
                { title: '方法', dataIndex: 'method', width: 170, render: value => value || '-' },
                { title: '状态', dataIndex: 'level', width: 100, render: value => levelTag(value) },
                { title: '次数', dataIndex: 'count', width: 90, sorter: (a: any, b: any) => Number(a.count || 0) - Number(b.count || 0) },
                { title: '最近使用', dataIndex: 'last_used_at', width: 170, render: value => formatDateTime(value) }
              ]}
            />
          </Col>
        </Row>
      </Card>

      <Card title="真实输入明细" extra={<Typography.Text type="secondary">按最新时间倒序</Typography.Text>}>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={report.items || []}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: Number(report.total || 0),
            showSizeChanger: true,
            showTotal: total => `共 ${total} 条`,
            onChange: (current, pageSize) => loadReport({ current, pageSize }, form.getFieldsValue())
          }}
          scroll={{ x: 1200 }}
          columns={[
            { title: '时间', dataIndex: 'created_at', width: 170, render: value => formatDateTime(value) },
            { title: '状态', dataIndex: 'level', width: 90, render: value => levelTag(value) },
            { title: '商品ID', dataIndex: 'product_id', width: 135, render: value => productLink(value) },
            { title: '订单ID', dataIndex: 'order_id', width: 90, render: value => value || '-' },
            { title: '动作', dataIndex: 'action', width: 190, render: value => value || '-' },
            { title: '方法', dataIndex: 'method', width: 170, render: value => value || '-' },
            { title: '说明', dataIndex: 'message', width: 260, ellipsis: true, render: value => value || '-' },
            { title: 'URL', dataIndex: 'url', width: 260, ellipsis: true, render: value => value ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : '-' },
            { title: '诊断', dataIndex: 'diagnostics', width: 360, ellipsis: true, render: value => value || '-' }
          ]}
        />
      </Card>
    </Space>
  );
}
