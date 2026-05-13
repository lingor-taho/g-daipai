import { ProTable } from '@ant-design/pro-components';
import { useRef, useState } from 'react';
import { Button, Form, Input, Modal, Popconfirm, Space, Tag, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { authHeaders, fetchAdminJson } from './utils/auth';

async function saveServerAccount(values: any, id?: number) {
  const res = await fetch(id ? `/api/admin/server-accounts/${id}` : '/api/admin/server-accounts', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(values)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '保存失败');
  return data;
}

async function deleteServerAccount(id: number) {
  const res = await fetch(`/api/admin/server-accounts/${id}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '删除失败');
  return data;
}

export default function ServerAccountsPage() {
  const actionRef = useRef<any>();
  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  }

  function openEdit(row: any) {
    setEditing(row);
    form.setFieldsValue({ username: row.username, password: '' });
    setModalOpen(true);
  }

  async function handleSave() {
    const values = await form.validateFields();
    if (editing && !values.password) delete values.password;
    setSaving(true);
    try {
      await saveServerAccount(values, editing?.id);
      message.success('保存成功');
      setModalOpen(false);
      actionRef.current?.reload();
    } catch (e: any) {
      message.error(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { title: '用户名', dataIndex: 'username' },
    { title: '类型', dataIndex: 'role', render: () => <Tag color="blue">服务器端</Tag> },
    { title: '创建时间', dataIndex: 'created_at', valueType: 'dateTime' },
    {
      title: '操作',
      render: (_: any, row: any) => (
        <Space>
          <Button size="small" onClick={() => openEdit(row)}>编辑</Button>
          <Popconfirm
            title="确认删除这个服务器账号？"
            onConfirm={async () => {
              try {
                await deleteServerAccount(row.id);
                message.success('删除成功');
                actionRef.current?.reload();
              } catch (e: any) {
                message.error(e.message || '删除失败');
              }
            }}
          >
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <>
      <ProTable
        actionRef={actionRef}
        columns={columns}
        request={async (params: any) => {
          try {
            const data = await fetchAdminJson('/api/admin/server-accounts?' + new URLSearchParams(params));
            return { data: data.items || [], total: data.total || 0 };
          } catch {
            return { data: [], total: 0 };
          }
        }}
        rowKey="id"
        search={false}
        headerTitle="服务器账号"
        toolbar={{ actions: [<Button key="add" type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加服务器账号</Button>] }}
      />

      <Modal
        title={editing ? '编辑服务器账号' : '添加服务器账号'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="password"
            label={editing ? '新密码' : '密码'}
            rules={editing ? [] : [{ required: true, message: '请输入密码' }]}
          >
            <Input.Password placeholder={editing ? '不填写则不修改密码' : ''} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
