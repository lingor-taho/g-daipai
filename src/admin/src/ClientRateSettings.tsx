import { ProTable } from '@ant-design/pro-components';
import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Form, InputNumber, Modal, Select, Space, Statistic, Typography, message } from 'antd';
import { fetchAdminJson } from './utils/auth';

async function saveOverride(values: any, id?: number) {
  const url = id ? `/api/admin/user-client-rate-overrides/${id}` : '/api/admin/user-client-rate-overrides';
  return fetchAdminJson(url, {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values)
  });
}

async function deleteOverride(id: number) {
  return fetchAdminJson(`/api/admin/user-client-rate-overrides/${id}`, {
    method: 'DELETE'
  });
}

function formatRate(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(4) : '-';
}

function formatAdjustment(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return `${number >= 0 ? '+' : ''}${number.toFixed(4)}`;
}

export default function ClientRateSettingsPage() {
  const [baseForm] = Form.useForm();
  const [overrideForm] = Form.useForm();
  const [users, setUsers] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [savingBase, setSavingBase] = useState(false);
  const [savingOverride, setSavingOverride] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  async function loadSettings() {
    const data = await fetchAdminJson('/api/admin/client-rate-settings');
    setSettings(data);
    baseForm.setFieldsValue({ baseAdjustment: data.baseAdjustment ?? 0.002 });
  }

  useEffect(() => {
    loadSettings().catch((error: any) => message.error(error.message || '读取用户端汇率失败'));
    fetchAdminJson('/api/admin/users/options')
      .then(data => setUsers(data.items || []))
      .catch(() => setUsers([]));
  }, []);

  const baseRate = Number(settings?.baseRate || 0);
  const userOptions = useMemo(
    () => users.map(user => ({ value: user.id, label: user.username })),
    [users]
  );

  async function handleSaveBase() {
    const values = await baseForm.validateFields();
    setSavingBase(true);
    try {
      const data = await fetchAdminJson('/api/admin/client-rate-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseAdjustment: Number(values.baseAdjustment || 0) })
      });
      setSettings(data);
      baseForm.setFieldsValue({ baseAdjustment: data.baseAdjustment ?? values.baseAdjustment });
      message.success('用户端基准汇率已保存');
      setReloadKey(key => key + 1);
    } catch (error: any) {
      message.error(error.message || '保存失败');
    } finally {
      setSavingBase(false);
    }
  }

  function openCreate() {
    setEditing(null);
    overrideForm.resetFields();
    setOpen(true);
  }

  function openEdit(row: any) {
    setEditing(row);
    overrideForm.setFieldsValue({
      userId: row.user_id,
      rateAdjustment: row.rate_adjustment
    });
    setOpen(true);
  }

  async function handleSaveOverride() {
    const values = await overrideForm.validateFields();
    setSavingOverride(true);
    try {
      await saveOverride({
        userId: values.userId,
        rateAdjustment: Number(values.rateAdjustment || 0)
      }, editing?.id);
      message.success('用户端用户汇率已保存');
      setOpen(false);
      setReloadKey(key => key + 1);
    } catch (error: any) {
      message.error(error.message || '保存失败');
    } finally {
      setSavingOverride(false);
    }
  }

  function handleDelete(row: any) {
    Modal.confirm({
      title: '删除用户端汇率设置',
      content: `确认删除 ${row.username} 的用户端汇率设置？`,
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
    { title: '用户名', dataIndex: 'username', width: 160 },
    {
      title: '用户调节',
      dataIndex: 'rate_adjustment',
      width: 120,
      render: (value: any) => formatAdjustment(value)
    },
    {
      title: '用户端汇率',
      dataIndex: 'rate_adjustment',
      width: 140,
      render: (value: any) => formatRate(baseRate + Number(value || 0))
    },
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
      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>用户端汇率设置</Typography.Title>
          <Space wrap size={24}>
            <Statistic title="中行日元现钞卖出价" value={settings?.sourceRate ?? 0} precision={4} />
            <Statistic title="公式值 BOC/100" value={settings?.rawRate ?? 0} precision={4} />
            <Statistic title="基准汇率" value={settings?.baseRate ?? 0} precision={4} />
          </Space>
          <Form form={baseForm} layout="inline" onFinish={handleSaveBase}>
            <Form.Item
              name="baseAdjustment"
              label="全局调节"
              rules={[{ required: true, message: '请输入全局调节值' }]}
            >
              <InputNumber step={0.0001} precision={4} style={{ width: 160 }} placeholder="+0.0020" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={savingBase}>保存基准汇率</Button>
            <Typography.Text type="secondary">
              基准汇率 = BOC/100 + 全局调节；未单独设置的用户使用基准汇率。
            </Typography.Text>
          </Form>
        </Space>
      </Card>

      <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>用户单独汇率</Typography.Title>
        <Button type="primary" onClick={openCreate}>新增用户设置</Button>
      </Space>
      <ProTable
        key={reloadKey}
        columns={columns}
        request={async () => {
          try {
            const data = await fetchAdminJson('/api/admin/user-client-rate-overrides');
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
        title={editing ? '修改用户端汇率设置' : '新增用户端汇率设置'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={handleSaveOverride}
        confirmLoading={savingOverride}
        destroyOnClose
      >
        <Form form={overrideForm} layout="vertical" preserve={false}>
          <Form.Item name="userId" label="用户名" rules={[{ required: true, message: '请选择用户' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={userOptions}
              disabled={Boolean(editing)}
            />
          </Form.Item>
          <Form.Item name="rateAdjustment" label="用户调节" rules={[{ required: true, message: '请输入用户调节值' }]}>
            <InputNumber style={{ width: '100%' }} step={0.0001} precision={4} placeholder="如 +0.0010 / -0.0005" />
          </Form.Item>
          <Typography.Text type="secondary">
            用户端汇率 = 当前基准汇率 {formatRate(baseRate)} + 用户调节。
          </Typography.Text>
        </Form>
      </Modal>
    </Space>
  );
}
