import { ProTable } from '@ant-design/pro-components';
import type { Key } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Tag, Typography, message } from 'antd';
import { authHeaders, fetchAdminJson } from './utils/auth';
import { formatManualOrderImportFlag } from './manualOrderImportState';
import { buildOrdersCsv, needsCsvShippingInput } from './ordersCsv';

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

function formatDateOnly(value: string | null | undefined) {
  const raw = String(value || '').trim();
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const formatted = formatDateTime(raw);
  return formatted === '-' ? '-' : formatted.slice(0, 10);
}

function formatLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getYesterdayTodayDateRange() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  return {
    fromDate: formatLocalDateKey(yesterday),
    toDate: formatLocalDateKey(today)
  };
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

function getBundleGroupId(row: any) {
  return String(row?.bundle_group_id || '').trim();
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

function renderManualOrderImportFlag(flags: any) {
  if (!flags) return '-';
  return formatManualOrderImportFlag(flags);
}

function getAssignableUserTypeText(levelValue: any) {
  const level = Number(levelValue || 1);
  return level === 2 ? '代理用户' : '普通用户';
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

async function fetchSameUserWonDateRangeOrders(params: { userId: number; fromDate: string; toDate: string }) {
  const query = new URLSearchParams({
    userId: String(params.userId),
    fromDate: params.fromDate,
    toDate: params.toDate
  });
  return fetchAdminJson(`/api/admin/orders/user-won-date-range?${query.toString()}`);
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

async function reassignOrderUser(orderId: number, userId: number) {
  const res = await fetch(`/api/admin/orders/${orderId}/user`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ userId })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '订单用户修改失败');
  return data;
}

export default function OrdersPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [settling, setSettling] = useState(false);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [settlementRate, setSettlementRate] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [selectedRowsMap, setSelectedRowsMap] = useState<Record<string, any>>({});
  const [firstRangeSelectDone, setFirstRangeSelectDone] = useState(false);
  const [currentRows, setCurrentRows] = useState<any[]>([]);
  const [idleFlags, setIdleFlags] = useState<any>(null);
  const [statusLogOpen, setStatusLogOpen] = useState(false);
  const [statusLogRows, setStatusLogRows] = useState<any[]>([]);
  const [storeBundleOpen, setStoreBundleOpen] = useState(false);
  const [storeBundleSubmitting, setStoreBundleSubmitting] = useState(false);
  const [csvShippingOpen, setCsvShippingOpen] = useState(false);
  const [csvShippingRows, setCsvShippingRows] = useState<any[]>([]);
  const [csvShippingOverrides, setCsvShippingOverrides] = useState<Record<string, number | null>>({});
  const [users, setUsers] = useState<any[]>([]);
  const [ownerEditorOpen, setOwnerEditorOpen] = useState(false);
  const [ownerEditorOrder, setOwnerEditorOrder] = useState<any>(null);
  const [ownerEditorUserId, setOwnerEditorUserId] = useState<number | undefined>();
  const [ownerEditorSubmitting, setOwnerEditorSubmitting] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [flagsExpanded, setFlagsExpanded] = useState(false);
  const [storeBundleForm] = Form.useForm();

  const bundleRowClassMap = useMemo(() => {
    const map: Record<string, string> = {};
    let colorIndex = 0;
    for (const row of currentRows) {
      const groupId = getBundleGroupId(row);
      if (!groupId || map[groupId]) continue;
      map[groupId] = colorIndex % 2 === 0 ? 'admin-bundle-row-a' : 'admin-bundle-row-b';
      colorIndex += 1;
    }
    return map;
  }, [currentRows]);

  useEffect(() => {
    fetchAdminJson('/api/admin/idle-flags').then(setIdleFlags).catch(() => {});
    fetchAdminJson('/api/admin/users/options')
      .then(data => setUsers(Array.isArray(data.items) ? data.items : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    function handleChange(event: MediaQueryListEvent | MediaQueryList) {
      setIsMobile(event.matches);
      if (!event.matches) setFlagsExpanded(false);
    }
    handleChange(media);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  const userOptions = useMemo(() => users
    .map(user => {
      const userTypeText = getAssignableUserTypeText(user.user_level);
      return {
        value: user.id,
        label: user.username,
        userTypeText,
        searchText: `${user.username} ${userTypeText}`
      };
    }), [users]);

  function cacheRows(rows: any[]) {
    setSelectedRowsMap(prev => {
      const next = { ...prev };
      for (const row of rows || []) {
        if (row?.id !== undefined && row?.id !== null) next[String(row.id)] = row;
      }
      return next;
    });
  }

  function getSelectedRows() {
    const currentMap = new Map(currentRows.map(row => [String(row.id), row]));
    return selectedRowKeys
      .map(key => selectedRowsMap[String(key)] || currentMap.get(String(key)))
      .filter(Boolean);
  }

  async function maybeAutoSelectSameUserWonDateRange(record: any) {
    if (firstRangeSelectDone || !record?.user_id) return;
    setFirstRangeSelectDone(true);
    const range = getYesterdayTodayDateRange();
    try {
      const data = await fetchSameUserWonDateRangeOrders({
        userId: Number(record.user_id),
        fromDate: range.fromDate,
        toDate: range.toDate
      });
      const rows = data.items || [];
      cacheRows(rows);
      setSelectedRowKeys(prev => Array.from(new Set([...prev, ...rows.map((item: any) => item.id)])));
      if (rows.length) {
        message.success(`已自动选中该用户 ${range.fromDate} 至 ${range.toDate} 的订单 ${rows.length} 条`);
      }
    } catch (e: any) {
      message.error(e.message || '自动选中同用户订单失败');
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
    const selectedRows = getSelectedRows();
    if (selectedRows.length !== selectedRowKeys.length) {
      message.error('部分已选订单数据未加载，请刷新后重试');
      return;
    }
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
    const selectedRows = getSelectedRows();
    if (selectedRows.length !== selectedRowKeys.length) {
      message.error('部分已选订单数据未加载，请刷新后重试');
      return;
    }
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

  function downloadCsv(rows: any[], shippingOverrides: Record<string, number | null>) {
    const csv = `\ufeff${buildOrdersCsv(rows, shippingOverrides)}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `orders-${formatLocalDateKey(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleExportCsv() {
    if (selectedRowKeys.length === 0) {
      message.error('请选择要导出的订单');
      return;
    }
    const selectedRows = getSelectedRows();
    if (selectedRows.length !== selectedRowKeys.length) {
      message.error('部分已选订单数据未加载，请刷新后重试');
      return;
    }
    const inputRows = selectedRows.filter(needsCsvShippingInput);
    if (inputRows.length) {
      setCsvShippingRows(inputRows);
      setCsvShippingOverrides(Object.fromEntries(inputRows.map(row => [String(row.id), csvShippingOverrides[String(row.id)] ?? null])));
      setCsvShippingOpen(true);
      return;
    }
    downloadCsv(selectedRows, {});
  }

  function confirmCsvExportWithShipping() {
    const missing = csvShippingRows.filter(row => {
      const value = csvShippingOverrides[String(row.id)];
      return value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) < 0;
    });
    if (missing.length) {
      message.error('请填写所有待确认运费');
      return;
    }
    downloadCsv(getSelectedRows(), csvShippingOverrides);
    setCsvShippingOpen(false);
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

  function openOwnerEditor(row: any) {
    setOwnerEditorOrder(row);
    setOwnerEditorUserId(row?.user_id ? Number(row.user_id) : undefined);
    setOwnerEditorOpen(true);
  }

  async function submitOwnerEditor() {
    if (!ownerEditorOrder?.id || !ownerEditorUserId) {
      message.error('请选择用户');
      return;
    }
    setOwnerEditorSubmitting(true);
    try {
      const data = await reassignOrderUser(Number(ownerEditorOrder.id), Number(ownerEditorUserId));
      message.success(`已改为 ${data.username || '新用户'}，同步任务 ${data.taskCount || 0} 条`);
      setOwnerEditorOpen(false);
      setOwnerEditorOrder(null);
      setReloadKey(key => key + 1);
    } catch (e: any) {
      message.error(e.message || '订单用户修改失败');
    } finally {
      setOwnerEditorSubmitting(false);
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
    {
      title: '用户名',
      dataIndex: 'username',
      width: 90,
      ellipsis: true,
      onCell: (row: any) => ({
        ...noWrapCell,
        onDoubleClick: () => openOwnerEditor(row),
        title: '双击修改绑定用户'
      }),
      render: (_: any, row: any) => (
        <span style={{ cursor: 'pointer' }} title="双击修改绑定用户">
          {row.username || '-'}
        </span>
      )
    },
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
    { title: '汇率', dataIndex: 'jpy_to_cny_rate', width: 70, onCell: () => noWrapCell },
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
        <Space wrap className="admin-mobile-action-space admin-orders-action-panel">
          <span className="admin-orders-settle-line">
            <span className="admin-orders-rate-row">
              <Typography.Text>结算汇率</Typography.Text>
              <InputNumber min={0} step={0.001} precision={4} value={settlementRate} onChange={value => setSettlementRate(value === null ? null : Number(value))} />
            </span>
            <Button type="primary" loading={settling} onClick={handleSettle}>结算</Button>
          </span>
          <span className="admin-orders-secondary-actions">
            <Button loading={paymentSubmitting} onClick={handlePaymentRequest}>支付</Button>
            <Button onClick={handleExportCsv}>导出CSV</Button>
          </span>
          <Typography.Text type="secondary">
            已选择 {selectedRowKeys.length} 条；首次勾选会自动选中该用户昨天到今天的落札订单。
          </Typography.Text>
        </Space>
      </Card>

      <Card className="admin-orders-flags-card">
        {isMobile ? (
          <Button
            block
            size="small"
            className="admin-orders-flags-toggle"
            onClick={() => setFlagsExpanded(expanded => !expanded)}
          >
            {flagsExpanded ? '隐藏运行状态' : '展开运行状态'}
          </Button>
        ) : null}
        {(!isMobile || flagsExpanded) ? (
          <Space wrap size={16} className="admin-mobile-flag-space">
            <Typography.Text>交易开始flag：{idleFlags?.transactionStartFlag ?? '-'}</Typography.Text>
            <Typography.Text>扫描计数：{idleFlags?.scanFlag ?? '-'} / {idleFlags?.scanEveryIdleRuns ?? '-'}</Typography.Text>
            <Typography.Text>导入flag：{renderManualOrderImportFlag(idleFlags)}</Typography.Text>
            <Typography.Text>付款flag：{idleFlags?.paymentFlag ?? '-'}</Typography.Text>
            <Typography.Text>确认收货flag：{idleFlags?.confirmReceiptFlag ?? '-'}</Typography.Text>
            <Typography.Text type="secondary">{renderTransactionStartLastRun(idleFlags?.transactionStartLastRunLog)}</Typography.Text>
          </Space>
        ) : null}
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

      <Modal
        open={csvShippingOpen}
        title="填写导出用运费"
        okText="导出CSV"
        cancelText="取消"
        onOk={confirmCsvExportWithShipping}
        onCancel={() => setCsvShippingOpen(false)}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            以下订单原始运费为落札者負担或着払い，请填写本次 CSV 使用的运费。该运费不会写入数据库。
          </Typography.Text>
          {csvShippingRows.map(row => (
            <Card key={row.id} size="small">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Typography.Text strong>{row.product_id || row.id} {truncateText(row.product_title, 30)}</Typography.Text>
                <Typography.Text type="secondary">原运费：{row.shipping_fee_text || '-'}</Typography.Text>
                <InputNumber
                  min={0}
                  precision={0}
                  addonAfter="円"
                  style={{ width: '100%' }}
                  value={csvShippingOverrides[String(row.id)]}
                  onChange={value => setCsvShippingOverrides(prev => ({
                    ...prev,
                    [String(row.id)]: value === null ? null : Number(value)
                  }))}
                />
              </Space>
            </Card>
          ))}
        </Space>
      </Modal>

      <Modal
        open={ownerEditorOpen}
        title="修改订单绑定用户"
        okText="保存"
        cancelText="取消"
        confirmLoading={ownerEditorSubmitting}
        onOk={submitOwnerEditor}
        onCancel={() => {
          setOwnerEditorOpen(false);
          setOwnerEditorOrder(null);
        }}
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            当前订单：{ownerEditorOrder?.product_id || ownerEditorOrder?.id || '-'}
          </Typography.Text>
          <Select
            showSearch
            style={{ width: '100%' }}
            placeholder="搜索并选择用户"
            optionFilterProp="searchText"
            value={ownerEditorUserId}
            options={userOptions}
            optionRender={(option: any) => (
              <Space direction="vertical" size={0}>
                <span>{option.data.label}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{option.data.userTypeText}</Typography.Text>
              </Space>
            )}
            onChange={value => setOwnerEditorUserId(Number(value))}
          />
        </Space>
      </Modal>

      <ProTable
        key={reloadKey}
        className="admin-orders-table"
        columns={columns}
        request={async (params: any) => {
          try {
            const data = await fetchAdminJson('/api/admin/orders?' + new URLSearchParams(params));
            const rows = data.items || [];
            setCurrentRows(rows);
            cacheRows(rows);
            return { data: rows, total: data.total || 0 };
          } catch {
            setCurrentRows([]);
            return { data: [], total: 0 };
          }
        }}
        rowKey="id"
        rowClassName={(record: any) => {
          const groupId = getBundleGroupId(record);
          return groupId ? bundleRowClassMap[groupId] || 'admin-bundle-row-a' : '';
        }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys, rows) => {
            cacheRows(rows as any[]);
            setSelectedRowKeys(keys);
          },
          onSelect: (record: any, selected: boolean) => {
            cacheRows([record]);
            if (selected) maybeAutoSelectSameUserWonDateRange(record);
          },
          onSelectAll: (selected: boolean, rows: any[]) => {
            cacheRows(rows);
            if (selected && rows?.[0]) maybeAutoSelectSameUserWonDateRange(rows[0]);
          },
          preserveSelectedRowKeys: true,
          getCheckboxProps: () => ({})
        }}
        search={false}
        scroll={{ x: 1460 }}
      />
    </Space>
  );
}
