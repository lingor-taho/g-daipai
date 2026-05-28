import { ProTable } from '@ant-design/pro-components';
import { useEffect, useState } from 'react';
import { Button, Card, Form, InputNumber, Space, Typography, message } from 'antd';
import { authHeaders, fetchAdminJson } from './utils/auth';

function formatJPY(value: number | string | null | undefined) {
  return `${Number(value || 0).toLocaleString('ja-JP')}円`;
}

function formatCNY(value: number | string | null | undefined) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

export default function OrdersPage() {
  const [form] = Form.useForm();
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);

  async function loadFinanceConfig() {
    const data = await fetchAdminJson('/api/admin/finance-config');
    form.setFieldsValue({ 
      rate: data.rate, 
      bankFeeJpy: data.bankFeeJpy,
      handlingFeeCny: data.handlingFeeCny
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

  const columns = [
    { title: '用户名', dataIndex: 'username', width: 100 },
    {
      title: '商品ID',
      dataIndex: 'product_id',
      width: 120,
      render: (_: any, row: any) => {
        const productId = row.product_id || row.product_url?.match(/[a-zA-Z]?\d{8,10}/)?.[0] || '';
        const url = row.product_url || (productId ? `https://auctions.yahoo.co.jp/jp/auction/${productId}` : '');
        return url ? <a href={url} target="_blank" rel="noreferrer">{productId || url}</a> : productId || '-';
      }
    },
    { title: '运费', dataIndex: 'shipping_fee_text', width: 150 },
    { title: '落札金额', dataIndex: 'final_price', width: 120, render: (_: any, row: any) => formatJPY(row.final_price) },
    { title: '银行手续费', dataIndex: 'bank_fee_jpy', width: 120, render: (_: any, row: any) => formatJPY(row.bank_fee_jpy) },
    { title: '手续费(RMB)', dataIndex: 'handling_fee_cny', width: 120, render: (_: any, row: any) => formatCNY(row.handling_fee_cny) },
    { title: '汇率', dataIndex: 'jpy_to_cny_rate', width: 80 },
    { title: '应付款', dataIndex: 'payable_cny', width: 120, render: (_: any, row: any) => formatCNY(row.payable_cny) },
    { title: '订单状态', dataIndex: 'order_status', width: 120 },
    { title: '追踪号', dataIndex: 'tracking_number', width: 150 }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Form form={form} layout="inline" onFinish={handleSaveConfig}>
          <Form.Item name="rate" label="汇率" rules={[{ required: true, message: '请输入汇率' }]}>
            <InputNumber min={0} step={0.001} precision={4} />
          </Form.Item>
          <Form.Item name="bankFeeJpy" label="银行手续费(日元)" rules={[{ required: true, message: '请输入银行手续费' }]}>
            <InputNumber min={0} step={1} precision={0} />
          </Form.Item>
          <Form.Item name="handlingFeeCny" label="手续费(RMB)" rules={[{ required: true, message: '请输入手续费' }]}>
            <InputNumber min={0} step={0.01} precision={2} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={saving}>保存参数</Button>
          </Form.Item>
          <Typography.Text type="secondary">应付款 =（落札金额 + 运费 + 银行手续费）* 汇率 + 手续费</Typography.Text>
        </Form>
      </Card>

      <ProTable
        key={reloadKey}
        columns={columns}
        request={async (params: any) => {
          try {
            const data = await fetchAdminJson('/api/admin/orders?' + new URLSearchParams(params));
            if (data.financeConfig) {
              form.setFieldsValue({
                rate: data.financeConfig.rate,
                bankFeeJpy: data.financeConfig.bankFeeJpy,
                handlingFeeCny: data.financeConfig.handlingFeeCny
              });
            }
            return { data: data.items || [], total: data.total || 0 };
          } catch {
            return { data: [], total: 0 };
          }
        }}
        rowKey="id"
        search={false}
      />
    </Space>
  );
}

