import { ProTable } from '@ant-design/pro-components';
import type { Key } from 'react';
import { useEffect, useState } from 'react';
import { Button, Card, Form, InputNumber, Space, Tag, Typography, message } from 'antd';
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

function renderProductTypeTag(productType: string | null | undefined) {
  if (productType === 'store') return <Tag color="red" style={{ marginLeft: 6 }}>商</Tag>;
  if (productType === 'normal') return <Tag color="green" style={{ marginLeft: 6 }}>普</Tag>;
  return <span style={{ marginLeft: 6 }}>-</span>;
}

const noWrapCell = {
  style: {
    whiteSpace: 'nowrap'
  }
};

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

export default function OrdersPage() {
  const [form] = Form.useForm();
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [settling, setSettling] = useState(false);
  const [settlementRate, setSettlementRate] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);

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
    { title: '运费', dataIndex: 'shipping_fee_text', width: 120, ellipsis: true, onCell: () => noWrapCell },
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
    { title: '订单状态', dataIndex: 'order_status', width: 90, onCell: () => noWrapCell, render: (_: any, row: any) => row.order_status === 'pending_payment' ? <Tag color="blue">待支付</Tag> : '' },
    { title: '追踪号', dataIndex: 'tracking_number', width: 120, ellipsis: true, onCell: () => noWrapCell }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Form form={form} layout="inline" onFinish={handleSaveConfig}>
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
        <Space wrap>
          <Typography.Text>本次结算汇率</Typography.Text>
          <InputNumber min={0} step={0.001} precision={4} value={settlementRate} onChange={value => setSettlementRate(value === null ? null : Number(value))} />
          <Button type="primary" loading={settling} onClick={handleSettle}>结算</Button>
          <Typography.Text type="secondary">
            已选择 {selectedRowKeys.length} 条；默认勾选运费为数值或無料的订单。
          </Typography.Text>
        </Space>
      </Card>

      <ProTable
        key={reloadKey}
        columns={columns}
        request={async (params: any) => {
          try {
            const data = await fetchAdminJson('/api/admin/orders?' + new URLSearchParams(params));
            setSelectedRowKeys((data.items || []).filter((item: any) => item.can_settle && !item.settled_at).map((item: any) => item.id));
            return { data: data.items || [], total: data.total || 0 };
          } catch {
            return { data: [], total: 0 };
          }
        }}
        rowKey="id"
        rowSelection={{
          selectedRowKeys,
          onChange: keys => setSelectedRowKeys(keys),
          getCheckboxProps: (record: any) => ({
            disabled: !record.can_settle,
            title: record.can_settle ? undefined : '运费不是数值或無料，不能结算'
          })
        }}
        search={false}
        scroll={{ x: 1185 }}
      />
    </Space>
  );
}
