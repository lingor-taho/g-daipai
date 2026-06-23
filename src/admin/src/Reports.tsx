import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography, message } from 'antd';
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
  return <Tag color="blue">信息</Tag>;
}

function productLink(productId: string) {
  if (!productId) return '-';
  return (
    <a href={`https://auctions.yahoo.co.jp/jp/auction/${productId}`} target="_blank" rel="noreferrer">
      {productId}
    </a>
  );
}

const emptyTrustedReport = { summary: {}, byAction: [], byMethod: [], items: [], total: 0, current: 1, pageSize: 20 };
const emptyBidFailureReport = { summary: {}, byAction: [], byStage: [], items: [], total: 0, current: 1, pageSize: 20 };

export default function ReportsPage() {
  const [trustedForm] = Form.useForm();
  const [bidFailureForm] = Form.useForm();
  const [trustedLoading, setTrustedLoading] = useState(false);
  const [bidFailureLoading, setBidFailureLoading] = useState(false);
  const [trustedReport, setTrustedReport] = useState<any>(emptyTrustedReport);
  const [bidFailureReport, setBidFailureReport] = useState<any>(emptyBidFailureReport);
  const [failureUserStats, setFailureUserStats] = useState<any[]>([]);
  const [trustedPagination, setTrustedPagination] = useState({ current: 1, pageSize: 20 });
  const [bidFailurePagination, setBidFailurePagination] = useState({ current: 1, pageSize: 20 });
  const [trustedError, setTrustedError] = useState('');
  const [bidFailureError, setBidFailureError] = useState('');
  const [bidFailureLoaded, setBidFailureLoaded] = useState(false);

  const trustedQueryValues = useMemo(() => trustedForm.getFieldsValue(), [trustedForm]);
  const bidFailureQueryValues = useMemo(() => bidFailureForm.getFieldsValue(), [bidFailureForm]);

  async function loadTrustedReport(next = trustedPagination, filters = trustedQueryValues) {
    setTrustedLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('current', String(next.current || 1));
      params.set('pageSize', String(next.pageSize || 20));
      ['level', 'action', 'method', 'productId'].forEach(key => {
        const value = String(filters?.[key] || '').trim();
        if (value) params.set(key, value);
      });
      const data = await fetchAdminJson(`/api/admin/reports/trusted-input?${params.toString()}`);
      setTrustedReport(data);
      setTrustedPagination({ current: Number(data.current || next.current || 1), pageSize: Number(data.pageSize || next.pageSize || 20) });
      setTrustedError('');
    } catch (e: any) {
      const text = e.message || '真实输入报表加载失败';
      setTrustedError(text);
      message.error(text);
    } finally {
      setTrustedLoading(false);
    }
  }

  async function loadBidFailureReport(next = bidFailurePagination, filters = bidFailureQueryValues) {
    setBidFailureLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('current', String(next.current || 1));
      params.set('pageSize', String(next.pageSize || 20));
      ['level', 'action', 'method', 'productId', 'message'].forEach(key => {
        const value = String(filters?.[key] || '').trim();
        if (value) params.set(key, value);
      });
      const [data, userStats] = await Promise.all([
        fetchAdminJson(`/api/admin/reports/bid-failures?${params.toString()}`),
        fetchAdminJson('/api/admin/reports/task-failure-users?days=5')
      ]);
      setBidFailureReport(data);
      setFailureUserStats(userStats.items || []);
      setBidFailurePagination({ current: Number(data.current || next.current || 1), pageSize: Number(data.pageSize || next.pageSize || 20) });
      setBidFailureError('');
      setBidFailureLoaded(true);
    } catch (e: any) {
      const text = e.message || '出价失败报表加载失败';
      setBidFailureError(text);
      message.error(text);
    } finally {
      setBidFailureLoading(false);
    }
  }

  useEffect(() => {
    loadTrustedReport({ current: 1, pageSize: 20 }, {});
  }, []);

  const trustedSummary = trustedReport.summary || {};
  const bidFailureSummary = bidFailureReport.summary || {};

  const trustedInputTab = (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {trustedError && <Alert type="error" showIcon message="真实输入报表加载失败" description={trustedError} />}

      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><Card><Statistic title="真实输入总次数" value={trustedSummary.total || 0} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="成功" value={trustedSummary.info || 0} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="失败" value={trustedSummary.error || 0} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="最近使用" value={formatDateTime(trustedSummary.lastUsedAt)} /></Card></Col>
      </Row>

      <Card title="chrome.debugger 真实输入统计">
        <Form
          form={trustedForm}
          layout="inline"
          onFinish={values => loadTrustedReport({ ...trustedPagination, current: 1 }, values)}
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
              <Button type="primary" htmlType="submit" loading={trustedLoading}>查询</Button>
              <Button onClick={() => {
                trustedForm.resetFields();
                loadTrustedReport({ current: 1, pageSize: trustedPagination.pageSize }, {});
              }}>重置</Button>
            </Space>
          </Form.Item>
        </Form>

        <Row gutter={[12, 12]}>
          <Col xs={24} xl={12}>
            <Table
              size="small"
              rowKey={row => `${row.action}-${row.method}`}
              loading={trustedLoading}
              dataSource={trustedReport.byAction || []}
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
              loading={trustedLoading}
              dataSource={trustedReport.byMethod || []}
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
          loading={trustedLoading}
          dataSource={trustedReport.items || []}
          pagination={{
            current: trustedPagination.current,
            pageSize: trustedPagination.pageSize,
            total: Number(trustedReport.total || 0),
            showSizeChanger: true,
            showTotal: total => `共 ${total} 条`,
            onChange: (current, pageSize) => loadTrustedReport({ current, pageSize }, trustedForm.getFieldsValue())
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

  const bidFailureTab = (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {bidFailureError && <Alert type="error" showIcon message="出价失败报表加载失败" description={bidFailureError} />}

      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><Card><Statistic title="失败总数" value={bidFailureSummary.total || 0} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="响应超时" value={bidFailureSummary.timeout || 0} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="系统错误" value={bidFailureSummary.systemError || 0} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="最近失败" value={formatDateTime(bidFailureSummary.lastFailedAt)} /></Card></Col>
      </Row>

      <Card title="近5天按用户统计" extra={<Typography.Text type="secondary">失败：响应超时 / 失败：系统原因</Typography.Text>}>
        <Table
          size="small"
          rowKey={row => `${row.user_id || 'unknown'}-${row.username || ''}`}
          loading={bidFailureLoading}
          dataSource={failureUserStats}
          pagination={false}
          scroll={{ x: true }}
          columns={[
            { title: '用户', dataIndex: 'username', width: 160, render: value => value || '-' },
            { title: '响应超时', dataIndex: 'timeout_count', width: 110, sorter: (a: any, b: any) => Number(a.timeout_count || 0) - Number(b.timeout_count || 0) },
            { title: '系统原因', dataIndex: 'system_count', width: 110, sorter: (a: any, b: any) => Number(a.system_count || 0) - Number(b.system_count || 0) },
            { title: '合计', dataIndex: 'total_count', width: 90, sorter: (a: any, b: any) => Number(a.total_count || 0) - Number(b.total_count || 0) },
            {
              title: '最近失败',
              dataIndex: 'last_failed_at',
              width: 170,
              sorter: (a: any, b: any) => new Date(a.last_failed_at || 0).getTime() - new Date(b.last_failed_at || 0).getTime(),
              render: value => formatDateTime(value)
            }
          ]}
        />
      </Card>

      <Card title="出价失败统计">
        <Form
          form={bidFailureForm}
          layout="inline"
          onFinish={values => loadBidFailureReport({ ...bidFailurePagination, current: 1 }, values)}
          style={{ marginBottom: 16, rowGap: 8 }}
        >
          <Form.Item name="level" label="级别">
            <Select
              allowClear
              style={{ width: 120 }}
              options={[
                { value: 'error', label: '失败' },
                { value: 'warn', label: '警告' },
                { value: 'info', label: '信息' }
              ]}
            />
          </Form.Item>
          <Form.Item name="action" label="类型">
            <Input allowClear placeholder="bid_timeout / bid" style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="method" label="来源">
            <Input allowClear placeholder="background / content-script" style={{ width: 190 }} />
          </Form.Item>
          <Form.Item name="productId" label="商品ID">
            <Input allowClear placeholder="w123..." style={{ width: 150 }} />
          </Form.Item>
          <Form.Item name="message" label="错误">
            <Input allowClear placeholder="timeout / system" style={{ width: 180 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={bidFailureLoading}>查询</Button>
              <Button onClick={() => {
                bidFailureForm.resetFields();
                loadBidFailureReport({ current: 1, pageSize: bidFailurePagination.pageSize }, {});
              }}>重置</Button>
            </Space>
          </Form.Item>
        </Form>

        <Row gutter={[12, 12]}>
          <Col xs={24} xl={12}>
            <Table
              size="small"
              rowKey={row => `${row.action}-${row.message}`}
              loading={bidFailureLoading}
              dataSource={bidFailureReport.byAction || []}
              pagination={{ pageSize: 8 }}
              scroll={{ x: true }}
              columns={[
                { title: '类型', dataIndex: 'action', width: 150, render: value => value || '-' },
                { title: '错误说明', dataIndex: 'message', width: 320, ellipsis: true, render: value => value || '-' },
                { title: '次数', dataIndex: 'count', width: 90, sorter: (a: any, b: any) => Number(a.count || 0) - Number(b.count || 0) },
                { title: '最近失败', dataIndex: 'last_failed_at', width: 170, render: value => formatDateTime(value) }
              ]}
            />
          </Col>
          <Col xs={24} xl={12}>
            <Table
              size="small"
              rowKey={row => row.stage || 'unknown'}
              loading={bidFailureLoading}
              dataSource={bidFailureReport.byStage || []}
              pagination={{ pageSize: 8 }}
              scroll={{ x: true }}
              columns={[
                { title: '执行阶段', dataIndex: 'stage', width: 180, render: value => value || '-' },
                { title: '次数', dataIndex: 'count', width: 90, sorter: (a: any, b: any) => Number(a.count || 0) - Number(b.count || 0) },
                { title: '超时', dataIndex: 'timeout_count', width: 90 },
                { title: '最近失败', dataIndex: 'last_failed_at', width: 170, render: value => formatDateTime(value) }
              ]}
            />
          </Col>
        </Row>
      </Card>

      <Card title="出价失败明细" extra={<Typography.Text type="secondary">包含响应超时、Yahoo 系统错误和插件执行错误</Typography.Text>}>
        <Table
          rowKey="id"
          loading={bidFailureLoading}
          dataSource={bidFailureReport.items || []}
          pagination={{
            current: bidFailurePagination.current,
            pageSize: bidFailurePagination.pageSize,
            total: Number(bidFailureReport.total || 0),
            showSizeChanger: true,
            showTotal: total => `共 ${total} 条`,
            onChange: (current, pageSize) => loadBidFailureReport({ current, pageSize }, bidFailureForm.getFieldsValue())
          }}
          scroll={{ x: 1300 }}
          columns={[
            { title: '时间', dataIndex: 'created_at', width: 170, render: value => formatDateTime(value) },
            { title: '级别', dataIndex: 'level', width: 90, render: value => levelTag(value) },
            { title: '商品ID', dataIndex: 'product_id', width: 135, render: value => productLink(value) },
            { title: '类型', dataIndex: 'action', width: 150, render: value => value || '-' },
            { title: '来源', dataIndex: 'method', width: 150, render: value => value || '-' },
            { title: '错误说明', dataIndex: 'message', width: 260, ellipsis: true, render: value => value || '-' },
            { title: 'URL', dataIndex: 'url', width: 260, ellipsis: true, render: value => value ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : '-' },
            { title: '诊断信息', dataIndex: 'diagnostics', width: 430, ellipsis: true, render: value => value || '-' }
          ]}
        />
      </Card>
    </Space>
  );

  return (
    <Tabs
      defaultActiveKey="trusted-input"
      onChange={key => {
        if (key === 'bid-failures' && !bidFailureLoaded) {
          loadBidFailureReport({ current: 1, pageSize: 20 }, {});
        }
      }}
      items={[
        { key: 'trusted-input', label: '真实输入', children: trustedInputTab },
        { key: 'bid-failures', label: '出价失败', children: bidFailureTab }
      ]}
    />
  );
}
