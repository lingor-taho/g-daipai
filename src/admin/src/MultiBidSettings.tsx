import { useEffect, useState } from 'react';
import { Button, Card, Checkbox, Form, Input, InputNumber, Select, Space, Typography, message } from 'antd';
import { authHeaders, fetchAdminJson } from './utils/auth';

const PREFECTURE_OPTIONS = [
  ['01', '01 Hokkaido'], ['02', '02 Aomori'], ['03', '03 Iwate'], ['04', '04 Miyagi'],
  ['05', '05 Akita'], ['06', '06 Yamagata'], ['07', '07 Fukushima'], ['08', '08 Ibaraki'],
  ['09', '09 Tochigi'], ['10', '10 Gunma'], ['11', '11 Saitama'], ['12', '12 Chiba'],
  ['13', '13 Tokyo'], ['14', '14 Kanagawa'], ['15', '15 Niigata'], ['16', '16 Toyama'],
  ['17', '17 Ishikawa'], ['18', '18 Fukui'], ['19', '19 Yamanashi'], ['20', '20 Nagano'],
  ['21', '21 Gifu'], ['22', '22 Shizuoka'], ['23', '23 Aichi'], ['24', '24 Mie'],
  ['25', '25 Shiga'], ['26', '26 Kyoto'], ['27', '27 Osaka'], ['28', '28 Hyogo'],
  ['29', '29 Nara'], ['30', '30 Wakayama'], ['31', '31 Tottori'], ['32', '32 Shimane'],
  ['33', '33 Okayama'], ['34', '34 Hiroshima'], ['35', '35 Yamaguchi'], ['36', '36 Tokushima'],
  ['37', '37 Kagawa'], ['38', '38 Ehime'], ['39', '39 Kochi'], ['40', '40 Fukuoka'],
  ['41', '41 Saga'], ['42', '42 Nagasaki'], ['43', '43 Kumamoto'], ['44', '44 Oita'],
  ['45', '45 Miyazaki'], ['46', '46 Kagoshima'], ['47', '47 Okinawa']
].map(([value, label]) => ({ value, label }));

async function saveMultiBidConfig(values: any) {
  const res = await fetch('/api/admin/multi-bid-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(values)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '保存失败');
  return data;
}

async function requestTransactionStart() {
  const res = await fetch('/api/admin/transaction-start/request', {
    method: 'POST',
    headers: authHeaders()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '执行失败');
  return data;
}

async function requestConfirmReceipt() {
  const res = await fetch('/api/admin/confirm-receipt/request', {
    method: 'POST',
    headers: authHeaders()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '执行失败');
  return data;
}

async function requestScan() {
  const res = await fetch('/api/admin/scan/request', {
    method: 'POST',
    headers: authHeaders()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '执行失败');
  return data;
}

export default function MultiBidSettingsPage() {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestingConfirmReceipt, setRequestingConfirmReceipt] = useState(false);
  const [requestingScan, setRequestingScan] = useState(false);
  const [googleConfigEditable, setGoogleConfigEditable] = useState(false);

  useEffect(() => {
    fetchAdminJson('/api/admin/multi-bid-config')
      .then(data => {
        form.setFieldsValue({
          startHours: data.startHours ?? 0.5,
          intervalMinutes: data.intervalMinutes ?? 5,
          multiBidMinPrice: data.multiBidMinPrice ?? 5000,
          bidConcurrencyLimit: data.bidConcurrencyLimit ?? 2,
          yahooShippingPrefCode: data.yahooShippingPrefCode || '27',
          idleSyncIntervalMinutes: data.idleSyncIntervalMinutes ?? 5,
          transactionStartHour: data.transactionStartHour ?? 1,
          confirmReceiptHour: data.confirmReceiptHour ?? 18,
          confirmReceiptColor: data.confirmReceiptColor || '#ffff00',
          scanStartHour: data.scanStartHour ?? 1,
          scanEndHour: data.scanEndHour ?? 20,
          scanEveryIdleRuns: data.scanEveryIdleRuns ?? 5,
          paymentJobLimitMin: data.paymentJobLimitMin ?? data.paymentJobLimit ?? 3,
          paymentJobLimitMax: data.paymentJobLimitMax ?? data.paymentJobLimit ?? 3,
          paymentPageStaySeconds: data.paymentPageStaySeconds ?? 3,
          googleSheetUrl: data.googleSheetUrl || '',
          googleSheetName: data.googleSheetName || '-代拍表-',
          googleCredentialPath: data.googleCredentialPath || '',
          googleConfigEditable: false
        });
        setGoogleConfigEditable(false);
      })
      .catch(() => {});
  }, [form]);

  async function handleSave() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await saveMultiBidConfig(values);
      setGoogleConfigEditable(false);
      form.setFieldValue('googleConfigEditable', false);
      message.success('参数已保存');
    } catch (e: any) {
      message.error(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleRequestTransactionStart() {
    setRequesting(true);
    try {
      await requestTransactionStart();
      message.success('交易开始已加入空闲执行队列');
    } catch (e: any) {
      message.error(e.message || '执行失败');
    } finally {
      setRequesting(false);
    }
  }

  async function handleRequestConfirmReceipt() {
    setRequestingConfirmReceipt(true);
    try {
      await requestConfirmReceipt();
      message.success('确认收货已加入空闲执行队列');
    } catch (e: any) {
      message.error(e.message || '执行失败');
    } finally {
      setRequestingConfirmReceipt(false);
    }
  }

  async function handleRequestScan() {
    setRequestingScan(true);
    try {
      await requestScan();
      message.success('扫描已加入空闲执行队列');
    } catch (e: any) {
      message.error(e.message || '执行失败');
    } finally {
      setRequestingScan(false);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSave}
        className="admin-config-form"
        initialValues={{
          startHours: 0.5,
          intervalMinutes: 5,
          multiBidMinPrice: 5000,
          bidConcurrencyLimit: 2,
          yahooShippingPrefCode: '27',
          idleSyncIntervalMinutes: 5,
          transactionStartHour: 1,
          confirmReceiptHour: 18,
          confirmReceiptColor: '#ffff00',
          scanStartHour: 1,
          scanEndHour: 20,
          scanEveryIdleRuns: 5,
          paymentJobLimitMin: 3,
          paymentJobLimitMax: 3,
          paymentPageStaySeconds: 3,
          googleSheetUrl: '',
          googleSheetName: '-代拍表-',
          googleCredentialPath: '',
          googleConfigEditable: false
        }}
        style={{ maxWidth: 640 }}
      >
        <Card title="多次出价配置">
          <Form.Item
            name="multiBidMinPrice"
            label="多次出价最低最高价"
            rules={[{ required: true, message: '请输入最低最高价' }]}
          >
            <InputNumber min={1} step={100} precision={0} addonAfter="日元" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="startHours"
            label="结束前 X 小时开始拍"
            rules={[{ required: true, message: '请输入开始时间' }]}
          >
            <InputNumber min={0.01} step={0.5} precision={2} addonAfter="小时" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="intervalMinutes"
            label="每 X 分钟自动加价"
            rules={[{ required: true, message: '请输入加价间隔' }]}
          >
            <InputNumber min={0} step={1} precision={0} addonAfter="分钟" style={{ width: '100%' }} />
          </Form.Item>
          <Typography.Text type="secondary">
            多次出价会在开始时间后按加价间隔重复执行，在最高价范围内继续尝试超过对方。
          </Typography.Text>
        </Card>

        <Card title="入札 / 落札空闲同步" style={{ marginTop: 16 }}>
          <Form.Item
            name="idleSyncIntervalMinutes"
            label="空闲同步间隔"
            rules={[{ required: true, message: '请输入空闲同步间隔' }]}
          >
            <InputNumber min={1} step={1} precision={0} addonAfter="分钟" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="bidConcurrencyLimit"
            label="出价并发任务数"
            rules={[{ required: true, message: '请输入出价并发任务数' }]}
          >
            <InputNumber min={1} max={10} step={1} precision={0} addonAfter="任务" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="yahooShippingPrefCode"
            label="Yahoo shipment API 都道府県"
            rules={[{ required: true, message: '请选择都道府県' }]}
          >
            <Select options={PREFECTURE_OPTIONS} />
          </Form.Item>
          <Typography.Text type="secondary">
            并行调度后，出价任务、入札 / 落札监控和订单工作流按独立执行线运行。
          </Typography.Text>
        </Card>

        <Card title="交易开始任务" style={{ marginTop: 16 }}>
          <Form.Item
            name="transactionStartHour"
            label="交易开始执行整点后1分钟"
            rules={[{ required: true, message: '请输入交易开始执行整点' }]}
          >
            <InputNumber min={0} max={23} step={1} precision={0} addonAfter="点01分" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="手动执行交易开始">
            <Space wrap>
              <Button loading={requesting} onClick={handleRequestTransactionStart}>加入执行队列</Button>
            </Space>
          </Form.Item>
        </Card>

        <Card title="扫描任务" style={{ marginTop: 16 }}>
          <Form.Item
            name="scanStartHour"
            label="扫描开始整点"
            rules={[{ required: true, message: '请输入扫描开始整点' }]}
          >
            <InputNumber min={0} max={23} step={1} precision={0} addonAfter="点" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="scanEndHour"
            label="扫描结束整点"
            rules={[{ required: true, message: '请输入扫描结束整点' }]}
          >
            <InputNumber min={0} max={23} step={1} precision={0} addonAfter="点" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="scanEveryIdleRuns"
            label="每 X 次空闲同步执行扫描"
            rules={[{ required: true, message: '请输入扫描间隔次数' }]}
          >
            <InputNumber min={1} step={1} precision={0} addonAfter="次" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="手动执行扫描">
            <Button loading={requestingScan} onClick={handleRequestScan}>加入执行队列</Button>
          </Form.Item>
        </Card>

        <Card title="付款任务" style={{ marginTop: 16 }}>
          <Space className="admin-config-payment-range" style={{ width: '100%' }} align="baseline">
            <Form.Item
              name="paymentJobLimitMin"
              label="付款流程执行任务数最小"
              rules={[{ required: true, message: '请输入付款流程执行任务数最小值' }]}
            >
              <InputNumber min={1} step={1} precision={0} addonAfter="件" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="paymentJobLimitMax"
              label="付款流程执行任务数最大"
              rules={[{ required: true, message: '请输入付款流程执行任务数最大值' }]}
            >
              <InputNumber min={1} step={1} precision={0} addonAfter="件" style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item
            name="paymentPageStaySeconds"
            label="付款页面停留时间(秒)"
            rules={[{ required: true, message: '请输入付款页面停留时间' }]}
          >
            <InputNumber min={1} step={1} precision={0} addonAfter="秒" style={{ width: '100%' }} />
          </Form.Item>
        </Card>

        <Card title="确认收货任务" style={{ marginTop: 16 }}>
          <Form.Item
            name="confirmReceiptHour"
            label="确认收货执行整点后1分钟"
            rules={[{ required: true, message: '请输入确认收货执行整点' }]}
          >
            <InputNumber min={0} max={23} step={1} precision={0} addonAfter="点01分" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="confirmReceiptColor"
            label="收货商品颜色配置"
            rules={[{ required: true, pattern: /^#[0-9a-fA-F]{6}$/, message: '请输入 #ffff00 这种颜色值' }]}
          >
            <Input addonBefore="HEX" />
          </Form.Item>
          <Form.Item label="手动执行确认收货">
            <Button loading={requestingConfirmReceipt} onClick={handleRequestConfirmReceipt}>加入执行队列</Button>
          </Form.Item>
        </Card>

        <Card title="Google 表格配置" style={{ marginTop: 16 }}>
          <Form.Item name="googleConfigEditable" valuePropName="checked">
            <Checkbox onChange={event => setGoogleConfigEditable(event.target.checked)}>
              允许修改 Google 表格配置
            </Checkbox>
          </Form.Item>
          <Form.Item
            name="googleSheetUrl"
            label="Google表格地址"
          >
            <Input disabled={!googleConfigEditable} />
          </Form.Item>
          <Form.Item
            name="googleSheetName"
            label="Google工作表名称"
            rules={[{ required: googleConfigEditable, message: '请输入Google工作表名称' }]}
          >
            <Input disabled={!googleConfigEditable} placeholder="-代拍表-" />
          </Form.Item>
          <Form.Item
            name="googleCredentialPath"
            label="Google JSON文件绝对路径"
          >
            <Input disabled={!googleConfigEditable} placeholder="GOOGLE_APPLICATION_CREDENTIALS 未配置" />
          </Form.Item>
          <Typography.Text type="secondary">
            备注：平时默认锁定，避免误改；换服务器或更换表格时，勾选后再修改并保存。JSON 文件路径需要在当前服务器真实存在。
          </Typography.Text>
        </Card>

        <Form.Item style={{ marginTop: 16 }}>
          <Button type="primary" htmlType="submit" loading={saving}>保存参数</Button>
        </Form.Item>
      </Form>
    </Space>
  );
}
