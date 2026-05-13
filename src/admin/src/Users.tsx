import { ProTable } from '@ant-design/pro-components';
import { useRef, useState } from 'react';
import { Button, Form, Input, Modal, Popconfirm, Space, Tag, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { authHeaders, fetchAdminJson } from './utils/auth';

async function saveUser(values: any, id?: number) {
  const res = await fetch(id ? `/api/admin/users/${id}` : '/api/admin/users', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(values)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '保存失败');
  return data;
}

async function deleteUser(id: number) {
  const res = await fetch(`/api/admin/users/${id}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '删除失败');
  return data;
}

export default function UsersPage() {
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
      await saveUser(values, editing?.id);
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
    { title: '类型', dataIndex: 'role', render: () => <Tag>用户端</Tag> },
    { title: '创建时间', dataIndex: 'created_at', valueType: 'dateTime' },
    {
      title: '操作',
      render: (_: any, row: any) => (
        <Space>
          <Button size="small" onClick={() => openEdit(row)}>编辑</Button>
          <Popconfirm
            title="确认删除这个用户？"
            onConfirm={async () => {
              try {
                await deleteUser(row.id);
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
            const data = await fetchAdminJson('/api/admin/users?' + new URLSearchParams(params));
            return { data: data.items || [], total: data.total || 0 };
          } catch {
            return { data: [], total: 0 };
          }
        }}
        rowKey="id"
        search={false}
        headerTitle="用户账号管理"
        toolbar={{ actions: [<Button key="add" type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加用户</Button>] }}
      />

      <Modal
        title={editing ? '编辑用户账号' : '添加用户账号'}
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
