import { ProTable } from '@ant-design/pro-components';
import { useEffect, useState } from 'react';
import { Button, Form, InputNumber, Modal, Select, Space, Typography, message } from 'antd';
import { fetchAdminJson } from './utils/auth';

async function saveOverride(values: any, id?: number) {
  const url = id ? `/api/admin/user-finance-overrides/${id}` : '/api/admin/user-finance-overrides';
  return fetchAdminJson(url, {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values)
  });
}

async function deleteOverride(id: number) {
  return fetchAdminJson(`/api/admin/user-finance-overrides/${id}`, {
    method: 'DELETE'
  });
}

function nullableNumber(value: unknown) {
  return value === undefined || value === null || value === '' ? null : value;
}

export default function SpecialUserSettingsPage() {
  const [form] = Form.useForm();
  const [users, setUsers] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    fetchAdminJson('/api/admin/users/options')
      .then(data => setUsers(data.items || []))
      .catch(() => setUsers([]));
  }, []);

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  }

  function openEdit(row: any) {
    setEditing(row);
    form.setFieldsValue({
      userId: row.user_id,
      rateAdjustment: row.rate_adjustment,
      bankFeeJpy: row.bank_fee_jpy,
      handlingFeeCny: row.handling_fee_cny,
      largeAmountFeeCny: row.large_amount_fee_cny
    });
    setOpen(true);
  }

  async function handleSave() {
    const values = await form.validateFields();
    const payload = {
      userId: values.userId,
      rateAdjustment: nullableNumber(values.rateAdjustment),
      bankFeeJpy: nullableNumber(values.bankFeeJpy),
      handlingFeeCny: nullableNumber(values.handlingFeeCny),
      largeAmountFeeCny: nullableNumber(values.largeAmountFeeCny)
    };
    setSaving(true);
    try {
      await saveOverride(payload, editing?.id);
      message.success('设置已保存');
      setOpen(false);
      setReloadKey(key => key + 1);
    } catch (e: any) {
      message.error(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(row: any) {
    Modal.confirm({
      title: '删除特殊用户设置',
      content: `确认删除 ${row.username} 的特殊参数？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      async onOk() {
        await deleteOverride(row.id);
        message.success('已删除');
        setReloadKey(key => key + 1);
      }
    });
  }

  const columns = [
    { title: '用户名', dataIndex: 'username', width: 140 },
    { title: '汇率调节', dataIndex: 'rate_adjustment', width: 120, render: (_: any, row: any) => row.rate_adjustment ?? '默认' },
    { title: '银行手续费', dataIndex: 'bank_fee_jpy', width: 120, render: (_: any, row: any) => row.bank_fee_jpy ?? '默认' },
    { title: '手续费(RMB)', dataIndex: 'handling_fee_cny', width: 120, render: (_: any, row: any) => row.handling_fee_cny ?? '默认' },
    { title: '大金额费用', dataIndex: 'large_amount_fee_cny', width: 120, render: (_: any, row: any) => row.large_amount_fee_cny ?? '默认' },
    {
      title: '操作',
      valueType: 'option',
      width: 140,
      render: (_: any, row: any) => (
        <Space>
          <a onClick={() => openEdit(row)}>修改</a>
          <a onClick={() => handleDelete(row)}>删除</a>
        </Space>
      )
    }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>特殊用户设置</Typography.Title>
        <Button type="primary" onClick={openCreate}>新增设置</Button>
      </Space>
      <ProTable
        key={reloadKey}
        columns={columns}
        request={async () => {
          try {
            const data = await fetchAdminJson('/api/admin/user-finance-overrides');
            return { data: data.items || [], total: data.items?.length || 0 };
          } catch {
            return { data: [], total: 0 };
          }
        }}
        rowKey="id"
        search={false}
        pagination={false}
      />
      <Modal
        title={editing ? '修改特殊用户设置' : '新增特殊用户设置'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="userId" label="用户名" rules={[{ required: true, message: '请选择用户' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={users.map(user => ({ value: user.id, label: user.username }))}
              disabled={Boolean(editing)}
            />
          </Form.Item>
          <Form.Item name="rateAdjustment" label="汇率调节">
            <InputNumber style={{ width: '100%' }} step={0.001} precision={4} placeholder="如 +0.01 / -0.02，留空使用默认汇率" />
          </Form.Item>
          <Form.Item name="bankFeeJpy" label="银行手续费(日元)">
            <InputNumber style={{ width: '100%' }} min={0} step={1} precision={0} placeholder="留空使用订单管理页默认值" />
          </Form.Item>
          <Form.Item name="handlingFeeCny" label="手续费(RMB)">
            <InputNumber style={{ width: '100%' }} min={0} step={0.01} precision={2} placeholder="留空使用订单管理页默认值" />
          </Form.Item>
          <Form.Item name="largeAmountFeeCny" label="大金额费用(RMB)">
            <InputNumber style={{ width: '100%' }} min={0} step={0.01} precision={2} placeholder="留空使用订单管理页默认值" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
