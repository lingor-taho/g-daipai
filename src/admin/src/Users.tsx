import { ProTable } from '@ant-design/pro-components';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Tag, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { authHeaders, fetchAdminJson } from './utils/auth';

const USER_LEVELS = [
  { value: 1, label: '普通用户', color: 'default' },
  { value: 2, label: '代理用户', color: 'blue' },
  { value: 3, label: '管理员', color: 'purple' }
];

function getLevelMeta(level: number) {
  return USER_LEVELS.find(item => item.value === Number(level)) || USER_LEVELS[0];
}

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
  const selectedLevel = Form.useWatch('user_level', form) || 1;
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [userOptions, setUserOptions] = useState<any[]>([]);

  async function loadUserOptions() {
    try {
      const data = await fetchAdminJson('/api/admin/users/options');
      setUserOptions(data.items || []);
    } catch {
      setUserOptions([]);
    }
  }

  useEffect(() => {
    loadUserOptions();
  }, []);

  const parentOptions = useMemo(() => {
    return userOptions
      .filter(user => Number(user.user_level || 1) > Number(selectedLevel || 1))
      .filter(user => !editing || String(user.id) !== String(editing.id))
      .map(user => {
        const level = getLevelMeta(user.user_level);
        return {
          value: user.id,
          label: `${user.username}（${level.label}）`
        };
      });
  }, [userOptions, selectedLevel, editing]);

  function openCreate() {
    setEditing(null);
    form.setFieldsValue({ username: '', password: '', user_level: 1, parent_user_id: null });
    loadUserOptions();
    setModalOpen(true);
  }

  function openEdit(row: any) {
    setEditing(row);
    form.setFieldsValue({
      username: row.username,
      password: '',
      user_level: Number(row.user_level || 1),
      parent_user_id: row.parent_user_id || null
    });
    loadUserOptions();
    setModalOpen(true);
  }

  async function handleSave() {
    const values = await form.validateFields();
    if (editing && !values.password) delete values.password;
    if (!values.parent_user_id) values.parent_user_id = null;
    setSaving(true);
    try {
      await saveUser(values, editing?.id);
      message.success('保存成功');
      setModalOpen(false);
      await loadUserOptions();
      actionRef.current?.reload();
    } catch (e: any) {
      message.error(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { title: '用户名', dataIndex: 'username' },
    {
      title: '用户等级',
      dataIndex: 'user_level',
      render: (_: any, row: any) => {
        const level = getLevelMeta(row.user_level);
        return <Tag color={level.color}>{level.label}</Tag>;
      }
    },
    {
      title: '上级归属',
      dataIndex: 'parent_username',
      render: (_: any, row: any) => row.parent_username || '-'
    },
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
                await loadUserOptions();
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
          <Form.Item name="user_level" label="用户等级" rules={[{ required: true, message: '请选择用户等级' }]}>
            <Select
              options={USER_LEVELS.map(({ value, label }) => ({ value, label }))}
              onChange={() => form.setFieldValue('parent_user_id', null)}
            />
          </Form.Item>
          <Form.Item name="parent_user_id" label="上级归属">
            <Select
              allowClear
              disabled={parentOptions.length === 0}
              placeholder={parentOptions.length ? '请选择上级用户' : '当前等级暂无可选上级'}
              options={parentOptions}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
