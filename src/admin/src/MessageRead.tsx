import { useEffect, useState } from 'react';
import { Button, Card, DatePicker, Form, Input, Modal, Space, Table, Tag, Typography, message } from 'antd';
import { fetchAdminJson } from './utils/auth';

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

function formatDateOnly(value: any) {
  if (!value) return '';
  if (typeof value.format === 'function') return value.format('YYYY-MM-DD');
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

function isWonMoreThanOneMonthAgo(value: string | null | undefined) {
  if (!value) return false;
  const raw = String(value).trim();
  const wonAt = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw);
  if (Number.isNaN(wonAt.getTime())) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 1);
  return wonAt.getTime() < cutoff.getTime();
}

function canRequestMessageUpdate(row: any) {
  if (row.order_status === 'completed') return false;
  if (row.order_status === 'cancelled') return false;
  if (row.order_status === 'bundle_completed') return false;
  if (isWonMoreThanOneMonthAgo(row.won_at)) return false;
  return true;
}

function sanitizeTradeHtml(html: string) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/\shref="javascript:[^"]*"/gi, ' href="#"');
}

function renderTradeHtml(html: string) {
  const sanitized = sanitizeTradeHtml(html);
  if (typeof DOMParser === 'undefined') return sanitized;
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${sanitized}</div>`, 'text/html');
  doc.querySelectorAll('dl').forEach(dl => {
    const senderText = String(dl.querySelector('dt')?.textContent || '').replace(/\s+/g, '');
    if (senderText.includes('あなた')) {
      dl.classList.add('yahoo-own-message');
    } else {
      dl.classList.add('yahoo-partner-message');
    }
  });
  return doc.body.firstElementChild?.innerHTML || sanitized;
}

function renderProductTypeTag(productType: string | null | undefined) {
  if (productType === 'store') return <Tag color="red">商</Tag>;
  return <Tag color="green">普</Tag>;
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
  return '-';
}

export default function MessageReadPage() {
  const [form] = Form.useForm();
  const [items, setItems] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [loading, setLoading] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<number | null>(null);
  const [selected, setSelected] = useState<any>(null);
  const [sendText, setSendText] = useState('');
  const [sending, setSending] = useState(false);

  async function load(next = pagination, values = form.getFieldsValue()) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('current', String(next.current || 1));
      params.set('pageSize', String(next.pageSize || 20));
      const username = String(values.username || '').trim();
      const productId = String(values.productId || '').trim();
      const range = values.wonRange || [];
      if (username) params.set('username', username);
      if (productId) params.set('productId', productId);
      if (range[0]) params.set('wonFrom', formatDateOnly(range[0]));
      if (range[1]) params.set('wonTo', formatDateOnly(range[1]));
      const data = await fetchAdminJson(`/api/admin/messages?${params.toString()}`);
      setItems(data.items || []);
      setPagination({
        current: Number(data.current || next.current || 1),
        pageSize: Number(data.pageSize || next.pageSize || 20),
        total: Number(data.total || 0)
      });
    } catch (error: any) {
      message.error(error.message || '消息列表加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function requestUpdate(row: any) {
    setUpdatingOrderId(row.order_id);
    try {
      await fetchAdminJson(`/api/admin/messages/${row.order_id}/update`, { method: 'POST' });
      message.success('已提交消息抓取任务');
      await load(pagination);
    } catch (error: any) {
      message.error(error.message || '消息抓取提交失败');
    } finally {
      setUpdatingOrderId(null);
    }
  }

  async function sendMessage() {
    const text = sendText.trim();
    if (!selected?.order_id || !text) {
      message.warning('请输入消息内容');
      return;
    }
    setSending(true);
    try {
      await fetchAdminJson(`/api/admin/messages/${selected.order_id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      setSendText('');
      message.success('已提交消息发送任务');
      await load(pagination);
    } catch (error: any) {
      message.error(error.message || '消息发送提交失败');
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    load({ current: 1, pageSize: 20, total: 0 }, {});
  }, []);

  return (
    <Card title="消息读取">
      <Form
        form={form}
        layout="inline"
        onFinish={values => load({ ...pagination, current: 1 }, values)}
        style={{ marginBottom: 16, rowGap: 8 }}
      >
        <Form.Item name="username" label="用户名">
          <Input allowClear placeholder="用户名" style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="productId" label="商品ID">
          <Input allowClear placeholder="m123..." style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="wonRange" label="落札时间">
          <DatePicker.RangePicker />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={loading}>搜索</Button>
            <Button onClick={() => {
              form.resetFields();
              load({ current: 1, pageSize: pagination.pageSize, total: pagination.total }, {});
            }}>重置</Button>
          </Space>
        </Form.Item>
      </Form>

      <Table
        rowKey="order_id"
        loading={loading}
        dataSource={items}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true,
          showTotal: total => `共 ${total} 条`,
          onChange: (current, pageSize) => load({ current, pageSize, total: pagination.total })
        }}
        scroll={{ x: 1100 }}
        columns={[
          { title: '用户名', dataIndex: 'username', width: 150, render: value => value || '-' },
          {
            title: '商品ID',
            dataIndex: 'product_id',
            width: 170,
            render: (value, row: any) => (
              <Space size={4}>
                <a href={`https://auctions.yahoo.co.jp/jp/auction/${value}`} target="_blank" rel="noreferrer">{value}</a>
                {renderProductTypeTag(row.product_type)}
              </Space>
            )
          },
          { title: '商品名称', dataIndex: 'product_title', width: 260, ellipsis: true, render: value => value || '-' },
          { title: '落札时间', dataIndex: 'won_at', width: 180, render: value => formatDateTime(value) },
          { title: '订单状态', dataIndex: 'order_status', width: 120, render: renderOrderStatus },
          {
            title: '消息更新',
            width: 130,
            render: (_, row: any) => {
              if (!canRequestMessageUpdate(row)) return '-';
              const fetching = updatingOrderId === row.order_id || row.fetch_status === 'pending' || row.fetch_status === 'processing';
              return (
                <Button size="small" loading={fetching} onClick={() => requestUpdate(row)}>
                  {fetching ? '消息抓取中' : '消息更新'}
                </Button>
              );
            }
          },
          {
            title: '时间',
            dataIndex: 'message_updated_at',
            width: 180,
            render: (value, row: any) => value ? (
              <Button type="link" style={{ padding: 0 }} onClick={() => setSelected(row)}>{formatDateTime(value)}</Button>
            ) : row.fetch_status === 'failed' ? <Typography.Text type="danger">{row.fetch_error || '抓取失败'}</Typography.Text> : '-'
          }
        ]}
      />

      <Modal
        title={selected ? `聊天记录：${selected.product_id}` : '聊天记录'}
        open={!!selected}
        onCancel={() => setSelected(null)}
        footer={null}
        width={860}
      >
        <style>{`
          .yahoo-message-view {
            font-family: Arial, "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif;
            color: #222;
            font-size: 14px;
            line-height: 1.45;
          }
          .yahoo-message-view a {
            color: #1d64b7;
            text-decoration: underline;
          }
          .yahoo-message-view ul.sc-c46fd2ce-0,
          .yahoo-message-view ul[class*="sc-c46fd2ce-0"] {
            list-style: none;
            padding: 0;
            margin: 0;
          }
          .yahoo-message-view ul.sc-c46fd2ce-0 dl,
          .yahoo-message-view ul[class*="sc-c46fd2ce-0"] dl {
            display: grid;
            grid-template-columns: 198px minmax(0, 1fr);
            gap: 10px;
            margin: 0 0 8px;
            background: transparent;
          }
          .yahoo-message-view ul.sc-c46fd2ce-0 dt,
          .yahoo-message-view ul[class*="sc-c46fd2ce-0"] dt {
            margin: 0;
            padding: 14px 10px;
            background: #fffdd1;
            text-align: center;
          }
          .yahoo-message-view ul.sc-c46fd2ce-0 dt span,
          .yahoo-message-view ul[class*="sc-c46fd2ce-0"] dt span {
            display: block;
            color: #d97300;
            font-weight: 600;
          }
          .yahoo-message-view ul.sc-c46fd2ce-0 dt img,
          .yahoo-message-view ul[class*="sc-c46fd2ce-0"] dt img {
            display: none;
          }
          .yahoo-message-view ul.sc-c46fd2ce-0 dl > div,
          .yahoo-message-view ul[class*="sc-c46fd2ce-0"] dl > div {
            min-width: 0;
            padding: 14px 12px;
            background: #fffdd1;
          }
          .yahoo-message-view ul.sc-c46fd2ce-0 dl.yahoo-own-message dt,
          .yahoo-message-view ul.sc-c46fd2ce-0 dl.yahoo-own-message > div,
          .yahoo-message-view ul[class*="sc-c46fd2ce-0"] dl.yahoo-own-message dt,
          .yahoo-message-view ul[class*="sc-c46fd2ce-0"] dl.yahoo-own-message > div {
            background: #f1f2ff;
          }
          .yahoo-message-view ul.sc-c46fd2ce-0 dd,
          .yahoo-message-view ul[class*="sc-c46fd2ce-0"] dd {
            margin: 0;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
          }
          .yahoo-message-view ul.sc-c46fd2ce-0 time,
          .yahoo-message-view ul[class*="sc-c46fd2ce-0"] time {
            display: block;
            color: #888;
            margin-top: 6px;
          }
          .yahoo-message-view #messagelist {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .yahoo-message-view #messagelist dl {
            display: grid;
            grid-template-columns: 198px minmax(0, 1fr);
            gap: 10px;
            margin: 0;
          }
          .yahoo-message-view #messagelist dt,
          .yahoo-message-view #messagelist dd {
            margin: 0;
            padding: 14px 12px;
            background: #fffdd1;
          }
          .yahoo-message-view #messagelist dl.ptsOwn dt,
          .yahoo-message-view #messagelist dl.ptsOwn dd {
            background: #f1f2ff;
          }
          .yahoo-message-view #messagelist #buyerid,
          .yahoo-message-view #messagelist dt p {
            margin: 0 0 8px;
            text-align: center;
            font-weight: 600;
          }
          .yahoo-message-view #messagelist .decTime {
            display: block;
            color: #888;
            text-align: center;
          }
          .yahoo-message-view #messagelist dd#body,
          .yahoo-message-view #messagelist dd {
            white-space: pre-wrap;
            overflow-wrap: anywhere;
          }
        `}</style>
        <div
          className="yahoo-message-view"
          style={{ maxHeight: 520, overflow: 'auto', border: '1px solid #f0f0f0', padding: 12, background: '#fff' }}
          dangerouslySetInnerHTML={{ __html: renderTradeHtml(selected?.message_html || '') }}
        />
        <Space.Compact style={{ width: '100%', marginTop: 12 }}>
          <Input.TextArea
            value={sendText}
            onChange={event => setSendText(event.target.value)}
            placeholder="输入要发送到 Yahoo 取引連絡 的消息"
            autoSize={{ minRows: 2, maxRows: 5 }}
          />
          <Button type="primary" loading={sending} onClick={sendMessage}>发送</Button>
        </Space.Compact>
        {selected?.send_status === 'failed' ? (
          <Typography.Text type="danger">{selected.send_error || '发送失败'}</Typography.Text>
        ) : null}
      </Modal>
    </Card>
  );
}
