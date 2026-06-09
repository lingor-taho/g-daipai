import { ProTable } from '@ant-design/pro-components';
import type { Key } from 'react';
import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Modal, Space, Switch, Tag, Typography, message } from 'antd';
import { Link } from 'react-router-dom';
import { authHeaders, fetchAdminJson } from './utils/auth';

function formatJPY(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return '';
  return `${Number(value || 0).toLocaleString('ja-JP')}円`;
}

function formatCNY(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return '';
  return `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

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

function truncateText(value: string | null | undefined, maxLength = 20) {
  const text = String(value || '').trim();
  if (!text) return '-';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function renderShippingText(row: any) {
  const shipping = row.shipping_fee_text || '-';
  const bundleShipping = String(row.bundle_shipping_fee_text || '').trim();
  if (!bundleShipping) return shipping;
  return `${shipping}->${bundleShipping}`;
}

function renderTransactionStartLastRun(log: any) {
  if (!log) return '最近执行：-';
  const source = log.source === 'manual' ? '手动' : '自动';
  const time = formatDateTime(log.createdAt);
  const total = Number(log.total || 0);
  const storeUpdated = Number(log.storeUpdated || 0);
  const jobs = Array.isArray(log.jobs) ? log.jobs.length : 0;
  const results = Array.isArray(log.results) ? log.results : [];
  const successResults = results.filter((item: any) => item?.status && Number(item?.updated || 0) > 0).length;
  const failedResults = results.filter((item: any) => item?.error).length;
  const noUpdateResults = results.filter((item: any) => !item?.error && Number(item?.updated || 0) === 0).length;
  const errors = Array.from(new Set(results
    .map((item: any) => String(item?.error || '').trim())
    .filter(Boolean)))
    .slice(0, 2);
  const errorText = errors.length ? `，错误：${errors.join('；')}` : '';
  return `最近执行：${source} ${time}，取到 ${total} 单，商城直接待支付 ${storeUpdated} 单，插件任务 ${jobs} 单，回写 ${results.length} 次（成功 ${successResults}，失败 ${failedResults}，未更新 ${noUpdateResults}）${errorText}`;
}

function renderStatusChangeSource(row: any) {
  const sourceMap: Record<string, string> = {
    transaction_start_jobs_store: '交易开始-商城',
    transaction_start_status: '交易开始',
    scan_bundle_rejected: '扫描-同捆拒绝',
    scan_bundle_shipping: '扫描-同捆运费',
    scan_waiting_shipping_pending: '扫描-等待运费',
    scan_waiting_shipping_resolved: '扫描-运费确认',
    payment_status: '付款',
    admin_settle: '后台结算',
    admin_store_bundle_backfill: '商城同捆补录',
    admin_transaction_start_reset: '后台初始化',
    admin_order_status_refresh: '后台状态刷新',
    unlogged_existing_status: '未记录状态'
  };
  const source = row.latest_status_change_source;
  if (!source) return '-';
  let metadata: any = {};
  try {
    metadata = row.latest_status_change_metadata ? JSON.parse(row.latest_status_change_metadata) : {};
  } catch {
    metadata = {};
  }
  const snapshot = metadata.auditSnapshot || {};
  const label = sourceMap[source] || source;
  const time = row.latest_status_change_at ? formatDateTime(row.latest_status_change_at) : '';
  const oldStatus = row.latest_status_old_status || '空';
  const newStatus = row.latest_status_new_status || '空';
  const details = [
    snapshot.productType ? `类型:${snapshot.productType}` : '',
    snapshot.shippingFeeText ? `运费:${snapshot.shippingFeeText}` : '',
    snapshot.bundleShippingFeeText ? `同捆:${snapshot.bundleShippingFeeText}` : '',
    metadata.payloadStatus ? `payload:${metadata.payloadStatus}` : '',
    metadata.includeAfterCutoff !== undefined ? `afterCutoff:${metadata.includeAfterCutoff ? '1' : '0'}` : '',
    metadata.shippingFeeText ? `确认运费:${metadata.shippingFeeText}` : '',
    metadata.bundleShippingFeeText ? `确认同捆:${metadata.bundleShippingFeeText}` : ''
  ].filter(Boolean).join('，');
  return `${label}${time ? ` ${time}` : ''}；${oldStatus}->${newStatus}${details ? `；${details}` : ''}`;
}

function renderProductTypeTag(productType: string | null | undefined) {
  if (productType === 'store') return <Tag color="red" style={{ marginLeft: 6 }}>商</Tag>;
  if (productType === 'normal') return <Tag color="green" style={{ marginLeft: 6 }}>普</Tag>;
  return <span style={{ marginLeft: 6 }}>-</span>;
}

function renderOrderStatus(status: string | null | undefined) {
  if (status === 'pending_settlement') return <Tag color="blue">待结算</Tag>;
  if (status === 'pending_payment') return <Tag color="gold">待支付</Tag>;
  if (status === 'pending_shipment') return <Tag color="lime">待发货</Tag>;
  if (status === 'pending_receipt') return <Tag color="geekblue">待收货</Tag>;
  if (status === 'cancelled') return <Tag color="red">取消</Tag>;
  if (status === 'waiting_shipping') return <Tag color="orange">等待运费</Tag>;
  if (status === 'pending_bundle') return <Tag color="purple">待同捆</Tag>;
  if (status === 'bundle_completed') return <Tag color="cyan">同捆完了</Tag>;
  if (status === 'completed') return <Tag color="success">完了</Tag>;
  return '';
}

const noWrapCell = {
  style: {
    whiteSpace: 'nowrap'
  }
};

function canAutoSettle(item: any) {
  return Boolean(
    item?.can_settle &&
    !item?.settled_at &&
    (item?.order_status === 'pending_payment' || item?.order_status === 'bundle_completed' || item?.order_status === 'pending_shipment')
  );
}

function canRequestPayment(item: any) {
  return Boolean(
    item?.order_status === 'pending_settlement' &&
    item?.payable_cny !== null &&
    item?.payable_cny !== undefined &&
    item?.payable_cny !== ''
  );
}

async function saveFinanceConfig(values: any) {
  const res = await fetch('/api/admin/finance-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(values)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '保存失败');
  return data;
}

async function settleOrders(values: { orderIds: Key[]; rate: number }) {
  const res = await fetch('/api/admin/orders/settle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(values)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '结算失败');
  return data;
}

async function requestPayment(orderIds: Key[]) {
  const res = await fetch('/api/admin/payment/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ orderIds })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '支付任务提交失败');
  return data;
}

export default function OrdersPage() {
  const [form] = Form.useForm();
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [settling, setSettling] = useState(false);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [settlementRate, setSettlementRate] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [autoSelectNonBidderPays, setAutoSelectNonBidderPays] = useState(false);
  const [currentRows, setCurrentRows] = useState<any[]>([]);
  const [idleFlags, setIdleFlags] = useState<any>(null);
  const [statusLogOpen, setStatusLogOpen] = useState(false);
  const [statusLogRows, setStatusLogRows] = useState<any[]>([]);
  const [storeBundleOpen, setStoreBundleOpen] = useState(false);
  const [storeBundleSubmitting, setStoreBundleSubmitting] = useState(false);
  const [storeBundleForm] = Form.useForm();

  async function loadFinanceConfig() {
    const data = await fetchAdminJson('/api/admin/finance-config');
    form.setFieldsValue({ 
      bankFeeJpy: data.bankFeeJpy,
      handlingFeeCny: data.handlingFeeCny,
      largeAmountFeeCny: data.largeAmountFeeCny
    });
  }

  useEffect(() => {
    loadFinanceConfig().catch(() => {});
    fetchAdminJson('/api/admin/idle-flags').then(setIdleFlags).catch(() => {});
  }, []);

  async function handleSaveConfig() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await saveFinanceConfig(values);
      message.success('参数已保存');
      setReloadKey(key => key + 1);
    } catch (e: any) {
      message.error(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleSettle() {
    if (!settlementRate || settlementRate <= 0) {
      message.error('请输入本次结算汇率');
      return;
    }
    if (selectedRowKeys.length === 0) {
      message.error('请选择要结算的订单');
      return;
    }
    const selectedRows = currentRows.filter(item => selectedRowKeys.includes(item.id));
    if (selectedRows.some(item => !canAutoSettle(item))) {
      message.error('只能选择待支付、待发货或同捆完了的订单进行结算');
      return;
    }
    setSettling(true);
    try {
      const data = await settleOrders({ orderIds: selectedRowKeys, rate: settlementRate });
      if (data.failed) {
        message.warning(`结算完成 ${data.settled || 0} 条，失败 ${data.failed} 条`);
      } else {
        message.success(`结算完成 ${data.settled || selectedRowKeys.length} 条`);
      }
      setReloadKey(key => key + 1);
    } catch (e: any) {
      message.error(e.message || '结算失败');
    } finally {
      setSettling(false);
    }
  }

  async function handlePaymentRequest() {
    if (selectedRowKeys.length === 0) {
      message.error('请选择要支付的订单');
      return;
    }
    const selectedRows = currentRows.filter(item => selectedRowKeys.includes(item.id));
    if (selectedRows.some(item => !canRequestPayment(item))) {
      message.error('只能选择待结算且应付款不为空的订单');
      return;
    }
    setPaymentSubmitting(true);
    try {
      const data = await requestPayment(selectedRowKeys);
      message.success(`支付任务已加入队列 ${data.requested ?? selectedRowKeys.length} 条`);
      setReloadKey(key => key + 1);
      fetchAdminJson('/api/admin/idle-flags').then(setIdleFlags).catch(() => {});
    } catch (e: any) {
      message.error(e.message || '支付任务提交失败');
    } finally {
      setPaymentSubmitting(false);
    }
  }

  async function showStatusLogs(orderId: number) {
    try {
      const data = await fetchAdminJson(`/api/admin/orders/${orderId}/status-logs`);
      setStatusLogRows(data.items || []);
      setStatusLogOpen(true);
    } catch (e: any) {
      message.error(e.message || '读取状态日志失败');
    }
  }

  function openStoreBundleBackfill(row: any) {
    if (row?.product_type !== 'store') {
      message.info('商城商品才支持同捆补录');
      return;
    }
    if (['completed', 'cancelled', 'pending_receipt'].includes(row?.order_status)) {
      message.warning('该订单状态不能做商城同捆补录');
      return;
    }
    storeBundleForm.setFieldsValue({
      mainProductId: row.product_id,
      childProductIds: '',
      bundleShippingFee: 0
    });
    setStoreBundleOpen(true);
  }

  function renderOrderStatusTrigger(row: any) {
    return (
      <span
        onDoubleClick={event => {
          event.stopPropagation();
          openStoreBundleBackfill(row);
        }}
        title={row?.product_type === 'store' ? '双击可打开商城同捆已付款补录' : '商城商品才支持同捆补录'}
        style={{ display: 'inline-block', minWidth: 48, cursor: 'default' }}
      >
        {renderOrderStatus(row.order_status) || '-'}
      </span>
    );
  }

  async function submitStoreBundleBackfill() {
    const values = await storeBundleForm.validateFields();
    setStoreBundleSubmitting(true);
    try {
      const res = await fetch('/api/admin/orders/store-bundle-backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(values)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '商城同捆补录失败');
      message.success(`补录完成：主商品待发货，子商品 ${data.childProductIds?.length || 0} 个同捆完了`);
      setStoreBundleOpen(false);
      setReloadKey(key => key + 1);
    } catch (e: any) {
      message.error(e.message || '商城同捆补录失败');
    } finally {
      setStoreBundleSubmitting(false);
    }
  }

  const columns = [
    { title: '用户名', dataIndex: 'username', width: 90, ellipsis: true, onCell: () => noWrapCell },
    {
      title: '商品ID',
      dataIndex: 'product_id',
      width: 170,
      onCell: () => noWrapCell,
      render: (_: any, row: any) => {
        const productId = row.product_id || row.product_url?.match(/[a-zA-Z]?\d{8,10}/)?.[0] || '';
        const url = row.product_url || (productId ? `https://auctions.yahoo.co.jp/jp/auction/${productId}` : '');
        const idNode = url ? <a href={url} target="_blank" rel="noreferrer">{productId || url}</a> : productId || '-';
        return <span>{idNode}{renderProductTypeTag(row.product_type)}</span>;
      }
    },
    {
      title: '商品名称',
      dataIndex: 'product_title',
      width: 190,
      ellipsis: true,
      render: (_: any, row: any) => truncateText(row.product_title)
    },
    { title: '落札时间', dataIndex: 'won_at', width: 155, onCell: () => noWrapCell, render: (_: any, row: any) => formatDateTime(row.won_at || row.won_time_text) },
    { title: '运费', dataIndex: 'shipping_fee_text', width: 150, ellipsis: true, onCell: () => noWrapCell, render: (_: any, row: any) => renderShippingText(row) },
    { title: '落札金额', dataIndex: 'final_price', width: 105, onCell: () => noWrapCell, render: (_: any, row: any) => formatJPY(row.final_price) },
    { title: '银行手续费', dataIndex: 'bank_fee_jpy', width: 100, onCell: () => noWrapCell, render: (_: any, row: any) => formatJPY(row.bank_fee_jpy) },
    { title: '手续费(RMB)', dataIndex: 'handling_fee_cny', width: 110, onCell: () => noWrapCell, render: (_: any, row: any) => formatCNY(row.handling_fee_cny) },
    {
      title: '大金额费用',
      dataIndex: 'large_amount_fee_cny',
      width: 100,
      onCell: () => noWrapCell,
      render: (_: any, row: any) => row.large_amount_fee_applied ? formatCNY(row.large_amount_fee_cny) : '-'
    },
    { title: '汇率', dataIndex: 'jpy_to_cny_rate', width: 70, onCell: () => noWrapCell },
    { title: '特殊设置', dataIndex: 'has_user_finance_override', width: 90, onCell: () => noWrapCell, render: (_: any, row: any) => row.settled_at && row.has_user_finance_override ? '已应用' : '' },
    { title: '应付款', dataIndex: 'payable_cny', width: 110, onCell: () => noWrapCell, render: (_: any, row: any) => formatCNY(row.payable_cny) },
    {
      title: '订单状态',
      dataIndex: 'order_status',
      width: 90,
      onCell: (row: any) => ({
        ...noWrapCell,
        onDoubleClick: () => openStoreBundleBackfill(row),
        title: row?.product_type === 'store' ? '双击可打开商城同捆已付款补录' : undefined
      }),
      render: (_: any, row: any) => renderOrderStatusTrigger(row)
    },
    { title: '交易开始错误', dataIndex: 'transaction_start_error', width: 180, ellipsis: true, onCell: () => noWrapCell },
    { title: '最后操作时间', dataIndex: 'updated_at', width: 155, onCell: () => noWrapCell, render: (_: any, row: any) => formatDateTime(row.updated_at || row.created_at) },
    { title: '状态来源', dataIndex: 'latest_status_change_source', width: 360, ellipsis: true, onCell: () => noWrapCell, render: (_: any, row: any) => renderStatusChangeSource(row) },
    {
      title: '状态日志',
      dataIndex: 'status_log',
      width: 90,
      onCell: () => noWrapCell,
      render: (_: any, row: any) => (
        <Button
          size="small"
          disabled={!row.latest_status_change_source}
          onClick={() => showStatusLogs(row.id)}
        >
          查看
        </Button>
      )
    },
    { title: '物流', dataIndex: 'shipping_company', width: 100, ellipsis: true, onCell: () => noWrapCell },
    { title: '追踪号', dataIndex: 'tracking_number', width: 120, ellipsis: true, onCell: () => noWrapCell }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Form form={form} layout="inline" className="admin-mobile-form" onFinish={handleSaveConfig}>
          <Form.Item name="bankFeeJpy" label="银行手续费(日元)" rules={[{ required: true, message: '请输入银行手续费' }]}>
            <InputNumber min={0} step={1} precision={0} />
          </Form.Item>
          <Form.Item name="handlingFeeCny" label="手续费(RMB)" rules={[{ required: true, message: '请输入手续费' }]}>
            <InputNumber min={0} step={0.01} precision={2} />
          </Form.Item>
          <Form.Item name="largeAmountFeeCny" label="大金额费用(RMB)" rules={[{ required: true, message: '请输入大金额费用' }]}>
            <InputNumber min={0} step={0.01} precision={2} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={saving}>保存参数</Button>
          </Form.Item>
          <Form.Item>
            <Link to="/special-user-settings">
              <Button>特殊用户设置</Button>
            </Link>
          </Form.Item>
          <Typography.Text type="secondary">
            应付款在点击结算后写入订单；汇率使用本次结算输入值，特殊用户设置会覆盖对应费用参数。
          </Typography.Text>
        </Form>
      </Card>

      <Card>
        <Space wrap className="admin-mobile-action-space">
          <Typography.Text>本次结算汇率</Typography.Text>
          <InputNumber min={0} step={0.001} precision={4} value={settlementRate} onChange={value => setSettlementRate(value === null ? null : Number(value))} />
          <Switch
            checked={autoSelectNonBidderPays}
            checkedChildren="已勾选"
            unCheckedChildren="未勾选"
            onChange={checked => {
              setAutoSelectNonBidderPays(checked);
              setSelectedRowKeys(checked ? currentRows.filter(item => canAutoSettle(item)).map(item => item.id) : []);
            }}
          />
          <Typography.Text>勾选待支付/同捆完了订单</Typography.Text>
          <Button type="primary" loading={settling} onClick={handleSettle}>结算</Button>
          <Button loading={paymentSubmitting} onClick={handlePaymentRequest}>支付</Button>
          <Typography.Text type="secondary">
            已选择 {selectedRowKeys.length} 条；每次进入页面默认不勾选订单。
          </Typography.Text>
        </Space>
      </Card>

      <Card>
        <Space wrap size={16} className="admin-mobile-flag-space">
          <Typography.Text>交易开始flag：{idleFlags?.transactionStartFlag ?? '-'}</Typography.Text>
          <Typography.Text>扫描计数：{idleFlags?.scanFlag ?? '-'} / {idleFlags?.scanEveryIdleRuns ?? '-'}</Typography.Text>
          <Typography.Text>付款flag：{idleFlags?.paymentFlag ?? '-'}</Typography.Text>
          <Typography.Text>确认收货flag：{idleFlags?.confirmReceiptFlag ?? '-'}</Typography.Text>
          <Typography.Text type="secondary">{renderTransactionStartLastRun(idleFlags?.transactionStartLastRunLog)}</Typography.Text>
        </Space>
      </Card>

      <Modal
        open={statusLogOpen}
        title="订单状态日志"
        footer={null}
        width={900}
        onCancel={() => setStatusLogOpen(false)}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {statusLogRows.length ? statusLogRows.map(row => {
            let metadataText = '-';
            try {
              metadataText = row.metadata ? JSON.stringify(JSON.parse(row.metadata), null, 2) : '-';
            } catch {
              metadataText = row.metadata || '-';
            }
            return (
              <div key={row.id} style={{ borderBottom: '1px solid #f0f0f0', paddingBottom: 8 }}>
                <Typography.Text strong>
                  {formatDateTime(row.created_at)} {row.source}：{row.old_status || '空'} -&gt; {row.new_status || '空'}
                </Typography.Text>
                <pre style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0', fontSize: 12 }}>
                  {metadataText}
                </pre>
              </div>
            );
          }) : <Typography.Text type="secondary">暂无状态日志</Typography.Text>}
        </Space>
      </Modal>

      <Modal
        open={storeBundleOpen}
        title="商城同捆已付款补录"
        okText="确定补录"
        cancelText="取消"
        confirmLoading={storeBundleSubmitting}
        onOk={submitStoreBundleBackfill}
        onCancel={() => setStoreBundleOpen(false)}
        destroyOnClose
      >
        <Form form={storeBundleForm} layout="vertical" preserve={false}>
          <Form.Item
            name="mainProductId"
            label="主商品ID"
            rules={[{ required: true, message: '请输入主商品ID' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="childProductIds"
            label="子商品ID"
            tooltip="用逗号分隔，支持全角逗号和半角逗号"
            rules={[{ required: true, message: '请输入子商品ID' }]}
          >
            <Input.TextArea rows={3} placeholder="子商品ID，子商品ID" />
          </Form.Item>
          <Form.Item
            name="bundleShippingFee"
            label="同捆运费"
            rules={[{ required: true, message: '请输入同捆运费' }]}
          >
            <InputNumber min={0} precision={0} addonAfter="円" style={{ width: '100%' }} />
          </Form.Item>
          <Typography.Text type="secondary">
            确定后：主商品改为待发货，子商品改为同捆完了；同组写入同一个 bundle_group_id，主商品同捆运费使用输入值，子商品同捆运费为 0円。
          </Typography.Text>
        </Form>
      </Modal>

      <ProTable
        key={reloadKey}
        columns={columns}
        request={async (params: any) => {
          try {
            const data = await fetchAdminJson('/api/admin/orders?' + new URLSearchParams(params));
            const rows = data.items || [];
            setCurrentRows(rows);
            setSelectedRowKeys(autoSelectNonBidderPays ? rows.filter((item: any) => canAutoSettle(item)).map((item: any) => item.id) : []);
            return { data: rows, total: data.total || 0 };
          } catch {
            setCurrentRows([]);
            setSelectedRowKeys([]);
            return { data: [], total: 0 };
          }
        }}
        rowKey="id"
        rowSelection={{
          selectedRowKeys,
          onChange: keys => setSelectedRowKeys(keys),
          getCheckboxProps: (record: any) => {
            const enabled = canAutoSettle(record) || canRequestPayment(record);
            return {
              disabled: !enabled,
              title: enabled ? undefined : '只能勾选待支付/待发货/同捆完了用于结算，或待结算且有应付款用于支付'
            };
          }
        }}
        search={false}
        scroll={{ x: 1460 }}
      />
    </Space>
  );
}
