import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Switch, Table, Tag, message } from 'antd';
import { fetchAdminJson } from './utils/auth';

export default function YahooAccounts() {
  const [items,setItems]=useState<any[]>([]);
  const [editing,setEditing]=useState<any>(null);
  const [open,setOpen]=useState(false);
  const [saving,setSaving]=useState(false);
  const [form]=Form.useForm();
  async function load(){const data=await fetchAdminJson('/api/admin/accounts');setItems(data.items||[]);}
  useEffect(()=>{load().catch(()=>{});const timer=window.setInterval(()=>load().catch(()=>{}),5000);return()=>window.clearInterval(timer);},[]);
  async function save(){const values=await form.validateFields();setSaving(true);try{await fetchAdminJson(`/api/admin/accounts${editing?`/${editing.id}`:''}`,{method:editing?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});setOpen(false);await load();message.success('账号已保存');}catch(e:any){message.error(e.message);}finally{setSaving(false);}}
  function edit(row:any){setEditing(row);form.resetFields();form.setFieldsValue(row||{priority:items.length,enabled:true,is_primary:false});setOpen(true);}
  return <Space direction="vertical" style={{width:'100%'}}>
    <Alert type="info" message="所有账号使用统一系统配置；出价并发任务数是每个插件的上限。每个 Yahoo 账号绑定独立 Chrome profile。停用仅停止新任务分配，已有任务和订单仍按原账号处理。" />
    <Button type="primary" onClick={()=>edit(null)}>添加 Yahoo 账号</Button>
    <Table rowKey="id" dataSource={items} pagination={false} scroll={{x:1000}} columns={[
      {title:'账号',render:(_:any,a:any)=><>{a.account_name} <Tag>{a.is_primary?'主账号':`备用 / ${a.priority}`}</Tag><div>Yahoo：{a.yahoo_id||'待填写'} / ID：{a.id}</div></>},
      {title:'Profile / Gmail',render:(_:any,a:any)=><>{a.profile_dir||'-'}<div>{a.email||'-'}</div></>},
      {title:'状态',render:(_:any,a:any)=><>{a.online?<Tag color="green">插件在线</Tag>:<Tag color="red">插件离线</Tag>}{!a.enabled?<Tag>停止新分配</Tag>:null}</>},
      {title:'插件绑定码',render:(_:any,a:any)=><Input.Password readOnly value={a.binding_token} style={{width:200}} />},
      {title:'操作',render:(_:any,a:any)=><Space><Button onClick={()=>edit(a)}>设置</Button><Popconfirm title="删除未使用的离线账号？已有业务记录的账号只能停用。" onConfirm={async()=>{try{await fetchAdminJson(`/api/admin/accounts/${a.id}`,{method:'DELETE'});await load();}catch(e:any){message.error(e.message);}}}><Button danger disabled={!!a.is_primary}>删除</Button></Popconfirm></Space>}
    ]}/>
    <Modal title={editing?'设置 Yahoo 账号':'添加 Yahoo 账号'} open={open} onCancel={()=>setOpen(false)} onOk={save} confirmLoading={saving}>
      <Form form={form} layout="vertical"><Form.Item name="account_name" label="显示名称" rules={[{required:true}]}><Input /></Form.Item><Form.Item name="yahoo_id" label="实际 Yahoo ID" rules={[{required:true}]}><Input /></Form.Item><Form.Item name="profile_dir" label="Chrome profile 名称或完整路径" rules={[{required:true}]}><Input /></Form.Item><Form.Item name="email" label="该 profile 登录的 Gmail" rules={[{required:true,type:'email'}]}><Input /></Form.Item><Form.Item name="priority" label="备用顺序（数字小的优先）"><InputNumber min={0} max={100000}/></Form.Item><Form.Item name="is_primary" label="主账号" valuePropName="checked"><Switch /></Form.Item><Form.Item name="enabled" label="接受新分配" valuePropName="checked"><Switch /></Form.Item></Form>
    </Modal>
  </Space>;
}
