# Yahoo Payment Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the payment automation framework: settlement/payment admin controls, global payment flag, payment queue APIs, reminder bar, config, idle scheduling, and a conservative plugin runner skeleton.

**Architecture:** Use `orders.order_status='pending_settlement'` as the payment queue and `config.payment_requested` as the global run flag. The server owns eligibility, flag clearing, reminders, and status updates; the admin UI only starts/continues the queue; the plugin consumes jobs during idle actions and reports success/failure/empty results.

**Tech Stack:** Express, better-sqlite3, React/Umi admin, Ant Design, Chrome Extension Manifest V3, Node test files.

---

## File Map

- Modify `src/server/routes/admin.js`: settlement effective shipping, status rules, payment request/reminder/config endpoints, idle flags response.
- Modify `src/server/routes/admin.orders.test.js`: unit tests for settlement and payment admin helpers.
- Modify `src/server/routes/plugin.js`: payment config in idle action config, `payment` idle priority, payment jobs/status endpoints, status constants.
- Modify `src/server/routes/plugin.test.js`: unit tests for payment idle action, jobs, status update, empty queue behavior.
- Modify `src/db/init.sql`: add `updated_at` already exists; no new table columns are needed because payment flags/reminders live in `config`.
- Modify `src/admin/src/Orders.tsx`: settlement auto-select rule, payment button, payment-only row selection, flag/reminder refresh.
- Modify `src/admin/src/layouts/AdminLayout.tsx`: global reminder bar and continue button.
- Modify `src/admin/src/MultiBidSettings.tsx`: payment config fields.
- Modify `yahoo-plugin/background.js`: payment action branch, job fetch/status helpers, conservative runner skeleton that safely reports the deferred Yahoo detail phase if jobs are started before page selectors are supplied.
- Modify `yahoo-plugin/background.test.js`: unit tests for payment payload/runner behavior where possible.
- Modify `agents.md`: update status after implementation and verification.

---

### Task 1: Server Settlement Rules

**Files:**
- Modify: `src/server/routes/admin.js`
- Test: `src/server/routes/admin.orders.test.js`

- [ ] **Step 1: Write failing tests for effective shipping and status retention**

Add these tests to `src/server/routes/admin.orders.test.js` after `testBuildOrderSettlementUsesSubmittedRateAndOverrides`:

```js
function testBuildOrderSettlementPrefersBundleShippingFee() {
  const result = buildOrderSettlement({
    order: {
      final_price: 10000,
      tax_type: 'tax_zero',
      shipping_fee_text: '送料 1,000円',
      bundle_shipping_fee_text: '0円'
    },
    baseConfig: {
      rate: 0.05,
      bankFeeJpy: 500,
      handlingFeeCny: 15,
      largeAmountFeeCny: 20
    },
    userFinanceOverride: null
  });

  assert.equal(result.shippingFeeJpy, 0);
  assert.equal(result.payableCny, 540);
}

function testResolveSettlementStatusKeepsBundleCompleted() {
  assert.equal(resolveSettlementOrderStatus('pending_payment'), 'pending_settlement');
  assert.equal(resolveSettlementOrderStatus('bundle_completed'), 'bundle_completed');
}
```

Add calls near the bottom:

```js
testBuildOrderSettlementPrefersBundleShippingFee();
testResolveSettlementStatusKeepsBundleCompleted();
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
node src\server\routes\admin.orders.test.js
```

Expected: failure because `resolveSettlementOrderStatus` is not exported and bundled shipping is not used.

- [ ] **Step 3: Implement effective shipping and status helper**

In `src/server/routes/admin.js`, add constants near existing status constants:

```js
const ORDER_STATUS_PENDING_PAYMENT = 'pending_payment';
const ORDER_STATUS_BUNDLE_COMPLETED = 'bundle_completed';
```

Add helpers near `canSettleShippingFeeText`:

```js
function getEffectiveShippingFeeText(order = {}) {
  const bundleText = String(order.bundle_shipping_fee_text || '').trim();
  if (bundleText) return bundleText;
  return String(order.shipping_fee_text || '').trim();
}

function resolveSettlementOrderStatus(currentStatus) {
  return currentStatus === ORDER_STATUS_BUNDLE_COMPLETED
    ? ORDER_STATUS_BUNDLE_COMPLETED
    : ORDER_STATUS_PENDING_SETTLEMENT;
}
```

Update `buildOrderSettlement`:

```js
function buildOrderSettlement({ order, baseConfig, userFinanceOverride }) {
  const effectiveShippingFeeText = getEffectiveShippingFeeText(order);
  if (!canSettleShippingFeeText(effectiveShippingFeeText)) {
    const error = new Error('该订单运费无法确认，不能结算');
    error.statusCode = 400;
    throw error;
  }
  const effectiveConfig = applyUserFinanceConfig(baseConfig, userFinanceOverride);
  const payable = calculateOrderPayable({
    finalPrice: order.final_price,
    taxType: order.tax_type,
    shippingFeeText: effectiveShippingFeeText,
    config: effectiveConfig
  });

  return {
    shippingFeeJpy: payable.shippingFee,
    bankFeeJpy: payable.bankFeeJpy,
    handlingFeeCny: payable.handlingFeeCny,
    largeAmountFeeCny: payable.largeAmountFeeCny,
    largeAmountFeeApplied: payable.largeAmountFeeApplied,
    taxIncludedFinalPrice: payable.taxIncludedFinalPrice,
    jpyToCnyRate: payable.rate,
    rateAdjustment: effectiveConfig.rateAdjustment,
    hasUserFinanceOverride: effectiveConfig.hasUserFinanceOverride,
    payableCny: payable.payableCny
  };
}
```

Update the order query inside `/orders/settle` to select `o.order_status` and `o.bundle_shipping_fee_text` already available via `o.*`. Replace the hard-coded status in the update params:

```js
resolveSettlementOrderStatus(order.order_status),
```

Export helpers at the bottom:

```js
module.exports.ORDER_STATUS_PENDING_PAYMENT = ORDER_STATUS_PENDING_PAYMENT;
module.exports.ORDER_STATUS_BUNDLE_COMPLETED = ORDER_STATUS_BUNDLE_COMPLETED;
module.exports.getEffectiveShippingFeeText = getEffectiveShippingFeeText;
module.exports.resolveSettlementOrderStatus = resolveSettlementOrderStatus;
```

Update imports in `src/server/routes/admin.orders.test.js`:

```js
  resolveSettlementOrderStatus,
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```powershell
node src\server\routes\admin.orders.test.js
```

Expected: no output and exit code `0`.

- [ ] **Step 5: Commit**

```powershell
git add src\server\routes\admin.js src\server\routes\admin.orders.test.js
git commit -m "Add payment settlement rules"
```

---

### Task 2: Admin Payment Request and Reminder APIs

**Files:**
- Modify: `src/server/routes/admin.js`
- Test: `src/server/routes/admin.orders.test.js`

- [ ] **Step 1: Write failing tests for payment admin helpers**

Add helper tests in `src/server/routes/admin.orders.test.js`:

```js
async function testRequestPaymentSetsFlag() {
  const queries = [];
  const fakeDb = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await requestPayment(fakeDb, [1, 2]);

  assert.equal(result.requested, 2);
  assert.match(queries[0].sql, /order_status = \?/);
  assert.equal(queries[0].params[0], 'pending_settlement');
  assert.match(queries[1].sql, /payment_requested/);
  assert.equal(queries[1].params[0], '1');
}

async function testClearPaymentAlertAndContinueClearsMessageAndSetsFlag() {
  const queries = [];
  const fakeDb = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await clearPaymentAlertAndContinue(fakeDb);

  assert.equal(result.success, true);
  assert.match(queries[0].sql, /payment_alert_message/);
  assert.equal(queries[0].params[0], '');
  assert.match(queries[1].sql, /payment_requested/);
  assert.equal(queries[1].params[0], '1');
}
```

Add async calls in the bottom promise chain:

```js
testRequestPaymentSetsFlag()
  .then(testClearPaymentAlertAndContinueClearsMessageAndSetsFlag)
  .then(testRequestScanSetsCounterToConfiguredEveryRuns)
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
```

Remove the old direct `testRequestScanSetsCounterToConfiguredEveryRuns().catch(...)` block.

Update destructuring imports:

```js
  requestPayment,
  clearPaymentAlertAndContinue
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
node src\server\routes\admin.orders.test.js
```

Expected: failure because `requestPayment` and `clearPaymentAlertAndContinue` are not exported.

- [ ] **Step 3: Implement admin payment helpers and routes**

In `src/server/routes/admin.js`, add helper near `requestScan`:

```js
async function saveConfigValue(database, key, value) {
  await database.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
    [key, String(value)]
  );
}

async function requestPayment(database = db, orderIds = []) {
  const ids = Array.isArray(orderIds) ? orderIds.map(Number).filter(id => Number.isInteger(id) && id > 0) : [];
  if (!ids.length) {
    const error = new Error('orderIds is required');
    error.statusCode = 400;
    throw error;
  }
  const placeholders = ids.map(() => '?').join(',');
  const result = await database.query(
    `UPDATE orders
     SET order_status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id IN (${placeholders})
       AND order_status = ?
       AND total_amount_cny IS NOT NULL`,
    [ORDER_STATUS_PENDING_SETTLEMENT, ...ids, ORDER_STATUS_PENDING_SETTLEMENT]
  );
  await saveConfigValue(database, 'payment_requested', '1');
  return { requested: result.rowCount || 0 };
}

async function clearPaymentAlertAndContinue(database = db) {
  await saveConfigValue(database, 'payment_alert_message', '');
  await saveConfigValue(database, 'payment_requested', '1');
  return { success: true };
}
```

Add routes:

```js
router.post('/payment/request', async (req, res) => {
  try {
    const result = await requestPayment(db, req.body?.orderIds || []);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'payment request failed' });
  }
});

router.post('/payment/continue', async (req, res) => {
  const result = await clearPaymentAlertAndContinue(db);
  res.json(result);
});
```

Update `/idle-flags` config query to include:

```sql
'payment_requested',
'payment_alert_message'
```

Add fields to the response:

```js
paymentFlag: Number(values.payment_requested || 0) === 1 ? 1 : 0,
paymentAlertMessage: values.payment_alert_message || ''
```

Export helpers:

```js
module.exports.requestPayment = requestPayment;
module.exports.clearPaymentAlertAndContinue = clearPaymentAlertAndContinue;
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```powershell
node src\server\routes\admin.orders.test.js
```

Expected: no output and exit code `0`.

- [ ] **Step 5: Commit**

```powershell
git add src\server\routes\admin.js src\server\routes\admin.orders.test.js
git commit -m "Add admin payment request APIs"
```

---

### Task 3: Plugin Payment Queue APIs and Idle Scheduling

**Files:**
- Modify: `src/server/routes/plugin.js`
- Test: `src/server/routes/plugin.test.js`

- [ ] **Step 1: Write failing plugin route tests**

Add tests to `src/server/routes/plugin.test.js` near idle action tests:

```js
function testPaymentIdleActionUsesFlagAfterScanPriority() {
  assert.equal(getNextIdleAction({
    transactionStartHour: 1,
    transactionStartLastRunDate: '2026-06-03',
    scanIdleCounter: 0,
    scanEveryIdleRuns: 5,
    scanStartHour: 1,
    scanEndHour: 20,
    paymentRequested: 1,
    nowHour: 10,
    today: '2026-06-03'
  }).action, 'payment');

  assert.equal(getNextIdleAction({
    transactionStartHour: 1,
    transactionStartLastRunDate: '2026-06-03',
    scanIdleCounter: 5,
    scanEveryIdleRuns: 5,
    scanStartHour: 1,
    scanEndHour: 20,
    paymentRequested: 1,
    nowHour: 10,
    today: '2026-06-03'
  }).action, 'scan');
}

async function testGetPaymentJobsReturnsPendingSettlementWithPayable() {
  const fakeDb = {
    async getOne(sql) {
      assert.match(sql, /payment_job_limit/);
      return { value: '2' };
    },
    async getAll(sql, params) {
      assert.match(sql, /o\.order_status = \?/);
      assert.match(sql, /o\.total_amount_cny IS NOT NULL/);
      assert.match(sql, /ORDER BY datetime\(COALESCE\(o\.won_at, o\.created_at\)\) ASC, o\.id ASC/);
      assert.equal(params[0], 'pending_settlement');
      assert.equal(params[1], 2);
      return [{
        order_id: 9,
        product_id: 'x1',
        product_url: 'https://auctions.yahoo.co.jp/jp/auction/x1',
        product_title: 'Item',
        product_type: 'normal',
        transaction_url: 'https://contact.example/x1',
        total_amount_cny: 123.45,
        final_price: 2000,
        shipping_fee_text: '送料 500円',
        bundle_shipping_fee_text: '',
        bundle_group_id: ''
      }];
    }
  };

  const result = await getPaymentJobs(fakeDb);

  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].orderId, 9);
  assert.equal(result.jobs[0].effectiveShippingFeeText, '送料 500円');
}

async function testUpdatePaymentStatusSuccessAndEmptyQueue() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const success = await updatePaymentStatus({ orderId: 5, status: 'success' }, fakeDb);
  const empty = await updatePaymentStatus({ empty: true }, fakeDb);

  assert.equal(success.updated, 1);
  assert.match(calls[0].sql, /pending_shipment/);
  assert.equal(empty.paymentRequested, 0);
  assert.match(calls[1].sql, /payment_requested/);
  assert.equal(calls[1].params[1], '0');
}

async function testUpdatePaymentStatusFailureWritesAlertAndClearsFlag() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await updatePaymentStatus({ orderId: 6, productId: 'p6', error: 'button not found' }, fakeDb);

  assert.equal(result.paymentRequested, 0);
  assert.match(calls[0].sql, /payment_requested/);
  assert.equal(calls[0].params[1], '0');
  assert.match(calls[1].sql, /payment_alert_message/);
  assert.match(calls[1].params[1], /p6/);
  assert.match(calls[1].params[1], /button not found/);
}
```

Call these tests near the bottom:

```js
testPaymentIdleActionUsesFlagAfterScanPriority();
testGetPaymentJobsReturnsPendingSettlementWithPayable()
  .then(testUpdatePaymentStatusSuccessAndEmptyQueue)
  .then(testUpdatePaymentStatusFailureWritesAlertAndClearsFlag)
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
```

Update imports by relying on the already-required module object or destructuring the new exports:

```js
  getPaymentJobs,
  updatePaymentStatus
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
node src\server\routes\plugin.test.js
```

Expected: failure because payment exports and idle action support are still missing.

- [ ] **Step 3: Implement constants, config, idle action, jobs, and status**

In `src/server/routes/plugin.js`, add constants:

```js
const DEFAULT_PAYMENT_JOB_LIMIT = 3;
const DEFAULT_PAYMENT_PAGE_STAY_SECONDS = 3;
const ORDER_STATUS_PENDING_SETTLEMENT = 'pending_settlement';
const ORDER_STATUS_PENDING_SHIPMENT = 'pending_shipment';
```

Update `getIdleActionConfig` query to include:

```sql
'payment_requested',
'payment_job_limit',
'payment_page_stay_seconds'
```

Add returned fields:

```js
paymentRequested: Number(values.payment_requested || 0),
paymentJobLimit: Number(values.payment_job_limit ?? DEFAULT_PAYMENT_JOB_LIMIT),
paymentPageStaySeconds: Number(values.payment_page_stay_seconds ?? DEFAULT_PAYMENT_PAGE_STAY_SECONDS),
```

Update `getNextIdleAction` after the scan block:

```js
  if (Number(config.paymentRequested || 0) === 1) {
    return { action: 'payment', today };
  }
```

Add helpers near scan helpers:

```js
function getEffectiveShippingFeeText(row = {}) {
  const bundleText = String(row.bundle_shipping_fee_text || '').trim();
  return bundleText || String(row.shipping_fee_text || '').trim();
}

async function getPaymentJobLimit(database = db) {
  const row = await database.getOne("SELECT value FROM config WHERE key = 'payment_job_limit'");
  const limit = Math.floor(Number(row?.value || DEFAULT_PAYMENT_JOB_LIMIT));
  return Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_PAYMENT_JOB_LIMIT;
}

async function getPaymentJobs(database = db) {
  const limit = await getPaymentJobLimit(database);
  const rows = await database.getAll(
    `SELECT o.id AS order_id,
            o.transaction_url,
            o.total_amount_cny,
            o.final_price,
            o.bundle_shipping_fee_text,
            o.bundle_group_id,
            t.product_id,
            t.product_url,
            t.product_title,
            t.product_type,
            t.shipping_fee_text
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     WHERE o.order_status = ?
       AND o.total_amount_cny IS NOT NULL
       AND t.status = 'success'
     ORDER BY datetime(COALESCE(o.won_at, o.created_at)) ASC, o.id ASC
     LIMIT ?`,
    [ORDER_STATUS_PENDING_SETTLEMENT, limit]
  );
  return {
    jobs: rows.map(row => ({
      orderId: row.order_id,
      productId: row.product_id,
      productUrl: row.product_url,
      productTitle: row.product_title,
      productType: row.product_type || 'normal',
      transactionUrl: row.transaction_url || '',
      payableCny: row.total_amount_cny,
      finalPrice: row.final_price,
      effectiveShippingFeeText: getEffectiveShippingFeeText(row),
      bundleGroupId: row.bundle_group_id || ''
    })),
    total: rows.length,
    limit
  };
}

async function updatePaymentStatus(payload = {}, database = db) {
  if (payload.empty === true) {
    await saveConfigValue(database, 'payment_requested', '0');
    return { success: true, paymentRequested: 0 };
  }
  const error = String(payload.error || '').trim();
  if (error) {
    const productId = String(payload.productId || payload.orderId || '').trim();
    await saveConfigValue(database, 'payment_requested', '0');
    await saveConfigValue(database, 'payment_alert_message', `付款失败：商品ID ${productId || '-'}，原因：${error}`);
    return { success: true, paymentRequested: 0 };
  }
  const orderId = Number(payload.orderId || 0);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    const err = new Error('orderId is required');
    err.statusCode = 400;
    throw err;
  }
  const result = await database.query(
    `UPDATE orders
     SET order_status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND order_status = ?`,
    [ORDER_STATUS_PENDING_SHIPMENT, orderId, ORDER_STATUS_PENDING_SETTLEMENT]
  );
  return { success: true, updated: result.rowCount || 0 };
}
```

Add routes:

```js
router.get('/payment/jobs', async (req, res) => {
  res.json({ success: true, ...(await getPaymentJobs(db)) });
});

router.post('/payment/status', async (req, res) => {
  try {
    res.json(await updatePaymentStatus(req.body || {}, db));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'payment update failed' });
  }
});
```

Export:

```js
module.exports.ORDER_STATUS_PENDING_SETTLEMENT = ORDER_STATUS_PENDING_SETTLEMENT;
module.exports.ORDER_STATUS_PENDING_SHIPMENT = ORDER_STATUS_PENDING_SHIPMENT;
module.exports.getPaymentJobs = getPaymentJobs;
module.exports.updatePaymentStatus = updatePaymentStatus;
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```powershell
node src\server\routes\plugin.test.js
```

Expected: no output and exit code `0`.

- [ ] **Step 5: Commit**

```powershell
git add src\server\routes\plugin.js src\server\routes\plugin.test.js
git commit -m "Add payment queue APIs"
```

---

### Task 4: Admin UI for Settlement, Payment, Reminder, and Config

**Files:**
- Modify: `src/admin/src/Orders.tsx`
- Modify: `src/admin/src/layouts/AdminLayout.tsx`
- Modify: `src/admin/src/MultiBidSettings.tsx`
- Test: `src/admin` build

- [ ] **Step 1: Update Orders page API helpers and selection helpers**

In `src/admin/src/Orders.tsx`, add:

```tsx
async function requestPayment(orderIds: Key[]) {
  const res = await fetch('/api/admin/payment/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ orderIds })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '支付任务提交失败');
  return data;
}

function canAutoSettle(item: any) {
  return (item?.order_status === 'pending_payment' || item?.order_status === 'bundle_completed') && !item.settled_at;
}

function canRequestPayment(item: any) {
  return item?.order_status === 'pending_settlement' && item?.payable_cny !== null && item?.payable_cny !== undefined && item?.payable_cny !== '';
}
```

Replace the old `isNonBidderPaysShipping` auto-selection usage with `canAutoSettle`.

- [ ] **Step 2: Add payment button state and handler**

Add state:

```tsx
const [paymentSubmitting, setPaymentSubmitting] = useState(false);
```

Add handler:

```tsx
async function handlePaymentRequest() {
  if (selectedRowKeys.length === 0) {
    message.error('请选择要支付的订单');
    return;
  }
  const selectedRows = currentRows.filter(item => selectedRowKeys.includes(item.id));
  if (selectedRows.some(item => !canRequestPayment(item))) {
    message.error('只能选择待结算且应付款不为空的订单');
    return;
  }
  setPaymentSubmitting(true);
  try {
    const data = await requestPayment(selectedRowKeys);
    message.success(`支付任务已加入队列 ${data.requested || selectedRowKeys.length} 条`);
    setReloadKey(key => key + 1);
    fetchAdminJson('/api/admin/idle-flags').then(setIdleFlags).catch(() => {});
  } catch (e: any) {
    message.error(e.message || '支付任务提交失败');
  } finally {
    setPaymentSubmitting(false);
  }
}
```

- [ ] **Step 3: Update toolbar labels and buttons**

Replace the switch label and selection body:

```tsx
<Switch
  checked={autoSelectNonBidderPays}
  checkedChildren="已勾选"
  unCheckedChildren="未勾选"
  onChange={checked => {
    setAutoSelectNonBidderPays(checked);
    setSelectedRowKeys(checked ? currentRows.filter(item => canAutoSettle(item)).map(item => item.id) : []);
  }}
/>
<Typography.Text>勾选待支付/同捆完了订单</Typography.Text>
<Button type="primary" loading={settling} onClick={handleSettle}>结算</Button>
<Button loading={paymentSubmitting} onClick={handlePaymentRequest}>支付</Button>
```

Update ProTable request selection:

```tsx
setSelectedRowKeys(autoSelectNonBidderPays ? rows.filter((item: any) => canAutoSettle(item)).map((item: any) => item.id) : []);
```

Update `rowSelection.getCheckboxProps` to allow either settlement or payment-eligible rows:

```tsx
getCheckboxProps: (record: any) => {
  const enabled = canAutoSettle(record) || canRequestPayment(record);
  return {
    disabled: !enabled,
    title: enabled ? undefined : '只能勾选待支付/同捆完了用于结算，或待结算且有应付款用于支付'
  };
}
```

Add payment flag display:

```tsx
<Typography.Text>付款flag：{idleFlags?.paymentFlag ?? '-'}</Typography.Text>
```

- [ ] **Step 4: Add global reminder bar**

In `src/admin/src/layouts/AdminLayout.tsx`, import `Alert`:

```tsx
import { Alert, Button, Layout, Menu, Space, Typography, message } from 'antd';
```

Add state:

```tsx
const [paymentAlert, setPaymentAlert] = useState('');
```

Inside the existing polling function after stats call, fetch flags:

```tsx
const flags = await fetchAdminJson('/api/admin/idle-flags');
if (active) setPaymentAlert(flags.paymentAlertMessage || '');
```

Add continue handler:

```tsx
async function clearPaymentAlertAndContinue() {
  try {
    await fetchAdminJson('/api/admin/payment/continue', { method: 'POST' });
    setPaymentAlert('');
    message.success('付款任务已继续');
  } catch (e: any) {
    message.error(e.message || '继续付款任务失败');
  }
}
```

Render before `<Outlet />`:

```tsx
{paymentAlert ? (
  <Alert
    type="error"
    showIcon
    message={
      <Space wrap>
        <Typography.Text style={{ color: '#cf1322' }}>{paymentAlert}</Typography.Text>
        <Button size="small" danger onClick={clearPaymentAlertAndContinue}>清除并继续任务</Button>
      </Space>
    }
    style={{ marginBottom: 12 }}
  />
) : null}
```

- [ ] **Step 5: Add payment config fields**

In `src/admin/src/MultiBidSettings.tsx`, load defaults in `setFieldsValue`:

```tsx
paymentJobLimit: data.paymentJobLimit ?? 3,
paymentPageStaySeconds: data.paymentPageStaySeconds ?? 3
```

Add reset defaults:

```tsx
paymentJobLimit: 3,
paymentPageStaySeconds: 3
```

Add form items inside the config card:

```tsx
<Form.Item
  name="paymentJobLimit"
  label="付款流程执行任务数"
  rules={[{ required: true, message: '请输入付款流程执行任务数' }]}
>
  <InputNumber min={1} step={1} precision={0} />
</Form.Item>
<Form.Item
  name="paymentPageStaySeconds"
  label="付款页面停留时间(秒)"
  rules={[{ required: true, message: '请输入付款页面停留时间' }]}
>
  <InputNumber min={1} step={1} precision={0} />
</Form.Item>
```

- [ ] **Step 6: Run admin build**

Run:

```powershell
Set-Location src\admin
npm run build
```

Expected: `Compiled successfully`.

- [ ] **Step 7: Commit**

```powershell
git add src\admin\src\Orders.tsx src\admin\src\layouts\AdminLayout.tsx src\admin\src\MultiBidSettings.tsx
git commit -m "Add admin payment controls"
```

---

### Task 5: Admin Config Server Support

**Files:**
- Modify: `src/server/routes/admin.js`
- Test: `src/server/routes/admin.orders.test.js`
- Test: `src/admin` build from Task 4 should pass against these fields after implementation.

- [ ] **Step 1: Add config tests**

In `src/server/routes/admin.orders.test.js`, add:

```js
function testNormalizePositiveIntegerConfig() {
  assert.equal(normalizePositiveIntegerConfig('4', 3), 4);
  assert.equal(normalizePositiveIntegerConfig('0', 3), 3);
  assert.equal(normalizePositiveIntegerConfig('abc', 3), 3);
}
```

Call it near other sync tests:

```js
testNormalizePositiveIntegerConfig();
```

Import:

```js
  normalizePositiveIntegerConfig
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
node src\server\routes\admin.orders.test.js
```

Expected: failure because `normalizePositiveIntegerConfig` is missing.

- [ ] **Step 3: Implement payment config load/save**

In `src/server/routes/admin.js`, add:

```js
function normalizePositiveIntegerConfig(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
```

Update `getMultiBidConfig` SQL key list to include:

```sql
'payment_job_limit', 'payment_page_stay_seconds'
```

Return:

```js
paymentJobLimit: normalizePositiveIntegerConfig(values.payment_job_limit, 3),
paymentPageStaySeconds: normalizePositiveIntegerConfig(values.payment_page_stay_seconds, 3)
```

In `router.put('/multi-bid-config')`, parse:

```js
const paymentJobLimit = normalizePositiveIntegerConfig(req.body.paymentJobLimit ?? 3, 3);
const paymentPageStaySeconds = normalizePositiveIntegerConfig(req.body.paymentPageStaySeconds ?? 3, 3);
```

Save:

```js
await db.query(
  `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('payment_job_limit', ?, CURRENT_TIMESTAMP)`,
  [String(paymentJobLimit)]
);
await db.query(
  `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('payment_page_stay_seconds', ?, CURRENT_TIMESTAMP)`,
  [String(paymentPageStaySeconds)]
);
```

Include in JSON response:

```js
paymentJobLimit,
paymentPageStaySeconds
```

Export:

```js
module.exports.normalizePositiveIntegerConfig = normalizePositiveIntegerConfig;
```

- [ ] **Step 4: Run tests**

Run:

```powershell
node src\server\routes\admin.orders.test.js
```

Expected: no output and exit code `0`.

- [ ] **Step 5: Commit**

```powershell
git add src\server\routes\admin.js src\server\routes\admin.orders.test.js
git commit -m "Add payment config support"
```

---

### Task 6: Plugin Payment Runner Skeleton

**Files:**
- Modify: `yahoo-plugin/background.js`
- Test: `yahoo-plugin/background.test.js`

- [ ] **Step 1: Add background tests for payment payload and empty queue**

First update `loadBackgroundForTest` in `yahoo-plugin/background.test.js` so tests can override fetch:

```js
    fetch: overrides.fetch || (async () => ({ async json() { return { task: null }; } })),
```

This replaces the current hard-coded `fetch` entry in the sandbox object.

Then add tests near scan payload tests:

```js
async function testRunPaymentJobsReportsEmptyQueue() {
  const calls = [];
  const api = loadBackgroundForTest({
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, jobs: [] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.deepEqual(calls[0], { empty: true });
}

async function testBuildPaymentFailurePayloadIncludesProductId() {
  const api = loadBackgroundForTest();
  const payload = api.buildPaymentFailurePayload({
    orderId: 7,
    productId: 'p7'
  }, new Error('payment page detail phase disabled'));

  assert.equal(payload.orderId, 7);
  assert.equal(payload.productId, 'p7');
  assert.equal(payload.error, 'payment page detail phase disabled');
}
```

Call them in the async test runner:

```js
await testRunPaymentJobsReportsEmptyQueue();
await testBuildPaymentFailurePayloadIncludesProductId();
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
node yahoo-plugin\background.test.js
```

Expected: failure because `runPaymentJobs` and `buildPaymentFailurePayload` are not exported.

- [ ] **Step 3: Implement payment helpers and branch**

In `yahoo-plugin/background.js`, add API helpers near scan helpers:

```js
async function fetchPaymentJobs() {
  const res = await apiFetch('/api/plugin/payment/jobs');
  return res.json();
}

async function updatePaymentStatus(payload) {
  await apiFetch('/api/plugin/payment/status', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

function buildPaymentFailurePayload(job, error) {
  return {
    orderId: job?.orderId,
    productId: job?.productId,
    error: error?.message || String(error || 'payment failed')
  };
}
```

Add conservative execution function:

```js
async function executePaymentJob(job) {
  throw new Error('payment page detail phase disabled');
}

async function runPaymentJobs() {
  const result = await fetchPaymentJobs();
  const jobs = Array.isArray(result?.jobs) ? result.jobs : [];
  if (!jobs.length) {
    await updatePaymentStatus({ empty: true });
    return;
  }
  for (const job of jobs) {
    try {
      const paymentResult = await executePaymentJob(job);
      if (paymentResult?.alreadyPaid || paymentResult?.success) {
        await updatePaymentStatus({ orderId: job.orderId, productId: job.productId, status: 'success' });
        continue;
      }
      throw new Error(paymentResult?.error || 'payment failed');
    } catch (error) {
      await updatePaymentStatus(buildPaymentFailurePayload(job, error));
      break;
    }
  }
}
```

Add branch in `syncIdleYahooPages`:

```js
  } else if (idleAction?.action === 'payment') {
    await runPaymentJobs();
```

Export in `globalThis.__G_DAIPAI_BACKGROUND_TEST__`:

```js
  runPaymentJobs,
  buildPaymentFailurePayload
```

- [ ] **Step 4: Run tests**

Run:

```powershell
node yahoo-plugin\background.test.js
```

Expected: no output and exit code `0`.

- [ ] **Step 5: Commit**

```powershell
git add yahoo-plugin\background.js yahoo-plugin\background.test.js
git commit -m "Add payment runner skeleton"
```

---

### Task 7: Final Verification and Documentation

**Files:**
- Modify: `agents.md`

- [ ] **Step 1: Update project status**

Append to `agents.md`:

```markdown
## 2026-06-03 付款功能当前进度

### 当前状态

- 分支：`codex/payment-automation`。
- 已实现付款框架：后台结算/支付入口、全局付款 flag、付款提醒栏、付款配置、服务端付款队列、插件空闲调度付款分支。
- Yahoo 付款页面具体点击和成功/已结款 DOM 判断处于安全暂停状态，等待真实页面图片和 HTML 后补充。

### 已实现规则

- 结算自动勾选 `pending_payment` 和 `bundle_completed`。
- `pending_payment` 结算后进入 `pending_settlement`。
- `bundle_completed` 结算后保持 `bundle_completed`，不进入付款流程。
- 结算金额优先使用 `bundle_shipping_fee_text`，否则使用 `shipping_fee_text`。
- 特殊用户费用覆盖逻辑保持不变。
- 支付按钮只允许 `pending_settlement` 且应付款不为空的订单。
- `payment_requested=1` 时插件才执行付款队列。
- 本批成功后 flag 保持 1；直到没有剩余 `pending_settlement` 且应付款不为空的订单时才清 0。
- 付款失败时只显示全局提醒并暂停 flag，订单保持 `pending_settlement`。
```

- [ ] **Step 2: Run full relevant regression**

Run:

```powershell
node src\server\routes\admin.orders.test.js
node src\server\routes\plugin.test.js
node yahoo-plugin\background.test.js
Set-Location src\admin
npm run build
```

Expected:

- Node tests produce no output and exit `0`.
- Admin build reports `Compiled successfully`.

- [ ] **Step 3: Check git status**

Run:

```powershell
git status -sb
```

Expected: only `agents.md` modified before commit.

- [ ] **Step 4: Commit docs**

```powershell
git add agents.md
git commit -m "Document payment automation progress"
```

---

## Self-Review

- Spec coverage: Tasks cover settlement rules, special-user preservation, bundled shipping, payment request, reminder bar, config, payment idle action, job/status APIs, conservative runner, tests, and docs.
- Deferred Yahoo page detail is explicitly non-goal for this plan and remains isolated behind `executePaymentJob`.
- Placeholder scan: The plan does not include unbounded placeholder steps. The runner skeleton intentionally reports `payment page detail phase disabled` until Yahoo page evidence is supplied.
- Type consistency: Shared names are `payment_requested`, `payment_alert_message`, `payment_job_limit`, `payment_page_stay_seconds`, `pending_settlement`, and `pending_shipment`.
