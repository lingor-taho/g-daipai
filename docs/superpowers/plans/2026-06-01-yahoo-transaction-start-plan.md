# Yahoo Transaction Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add idle-time Yahoo transaction-start automation for won orders with empty order status.

**Architecture:** The server owns scheduling flags, daily execution state, order candidate selection, and order status updates. The Chrome extension executes Yahoo page actions only after the existing idle sync gate allows it. Content extraction functions remain isolated in `content.js` and covered by DOM fixture tests.

**Tech Stack:** Express, SQLite/better-sqlite3, Chrome Manifest V3 extension, vanilla DOM extraction, React/Umi admin.

---

## Files

- Modify `src/db/init.sql`: add order columns for transaction URL, bundle group, transaction timestamps, and error text.
- Modify `src/server/models/index.js`: add compatibility `ensureColumn` calls.
- Modify `src/server/routes/plugin.js`: add idle action config, transaction-start job APIs, order sync transaction URL persistence, and exported helpers for tests.
- Modify `src/server/routes/plugin.test.js`: cover scheduler, status updates, and order sync URL persistence.
- Modify `yahoo-plugin/content.js`: extract transaction URLs from `/my/won`, parse transaction-start pages, and perform button clicks.
- Modify `yahoo-plugin/content.test.js`: add fixtures for won links and bundle quantity validation.
- Modify `yahoo-plugin/background.js`: run idle operation chain after bidding/won sync and execute transaction-start jobs.
- Modify `yahoo-plugin/background.test.js`: cover idle action dispatch flow.
- Modify `src/server/routes/admin.js`: expose new config fields and manual transaction-start trigger.
- Modify `src/admin/src/MultiBidSettings.tsx`: rename config page text, add new fields and manual button.
- Modify `src/admin/src/Orders.tsx`: display waiting shipping, pending bundle, and transaction errors.

## Task 1: Schema and Constants

- [ ] Add failing tests in `src/server/routes/plugin.test.js` for order status constants and transaction columns through mocked SQL expectations.

Run:

```powershell
node src\server\routes\plugin.test.js
```

Expected: fail because constants/helpers do not exist.

- [ ] Add columns in `src/db/init.sql` and `src/server/models/index.js`:

```sql
transaction_url TEXT,
bundle_group_id VARCHAR(64),
transaction_started_at DATETIME,
transaction_start_error TEXT
```

- [ ] Add constants in `src/server/routes/plugin.js`:

```js
const ORDER_STATUS_PENDING_PAYMENT = 'pending_payment';
const ORDER_STATUS_WAITING_SHIPPING = 'waiting_shipping';
const ORDER_STATUS_PENDING_BUNDLE = 'pending_bundle';
```

- [ ] Run:

```powershell
node src\server\routes\plugin.test.js
```

Expected: pass.

## Task 2: Persist Transaction Links From Won Sync

- [ ] Add a `content.test.js` fixture where one `/my/won` item contains a `取引連絡` link. Assert `extractOrderHistory()[0].transactionUrl` equals the link.

- [ ] Update `yahoo-plugin/content.js` `extractOrderHistory()` to find the nearest item-level anchor with visible text `取引連絡` and include:

```js
transactionUrl: contactLink?.href || ''
```

- [ ] Add `plugin.test.js` coverage that `/api/plugin/orders/sync` updates `orders.transaction_url` through `upsertOrderFromTask()`.

- [ ] Update `upsertOrderFromTask(taskId, options)` to insert/update `transaction_url = COALESCE(?, transaction_url)`.

- [ ] Run:

```powershell
node yahoo-plugin\content.test.js
node src\server\routes\plugin.test.js
```

Expected: both pass.

## Task 3: Idle Action Scheduler

- [ ] Add tests for `getNextIdleAction()`:

```js
assert.equal(getNextIdleAction({ transactionStartRequested: true }).action, 'transaction_start');
assert.equal(getNextIdleAction({ nowHour: 1, lastRunDate: '2026-05-31', today: '2026-06-01' }).action, 'transaction_start');
assert.equal(getNextIdleAction({ scanCounter: 5, scanEvery: 5, nowHour: 10, scanStartHour: 1, scanEndHour: 20 }).action, 'scan');
```

- [ ] Implement config reader for these keys:

```js
transaction_start_hour
transaction_start_requested
transaction_start_last_run_date
scan_start_hour
scan_end_hour
scan_every_idle_runs
scan_idle_counter
```

- [ ] Add `GET /api/plugin/idle-action/next` and `POST /api/plugin/idle-action/complete`.

- [ ] Ensure completion clears `transaction_start_requested` and writes `transaction_start_last_run_date` after transaction start.

- [ ] Run:

```powershell
node src\server\routes\plugin.test.js
```

Expected: pass.

## Task 4: Transaction Job APIs

- [ ] Add tests for `buildTransactionStartJobs()`:

Store product returns direct update count and is not sent to plugin. Normal products with empty order status and transaction URL are returned. Normal products without transaction URL keep empty status and receive `transaction_start_error`.

- [ ] Implement:

```http
GET /api/plugin/transaction-start/jobs
POST /api/plugin/transaction-start/status
```

- [ ] `GET` must process all empty-status orders, without a 20-order limit.

- [ ] `POST` must support:

```json
{ "orderId": 1, "status": "waiting_shipping" }
{ "orderIds": [1, 2, 3], "status": "pending_bundle", "bundleGroupId": "bundle-20260601-c1133337781" }
{ "orderId": 1, "error": "bundle quantity mismatch" }
```

- [ ] Run:

```powershell
node src\server\routes\plugin.test.js
```

Expected: pass.

## Task 5: Content Transaction Page Parser

- [ ] Add `content.test.js` fixtures for:

  - Bundle modal/page with `2件（落札数量：2）` and two auction IDs.
  - Mismatch case where count says 3 but only two IDs are extracted.
  - Completion text `まとめて取引を依頼中です。出品者からの連絡をお待ちください。`.

- [ ] Implement exported test helpers in `content.js`:

```js
extractBundleTransactionInfo()
detectBundleRequestedComplete()
detectBundleAvailable()
```

- [ ] Parser must return:

```js
{
  available: true,
  expectedCount: 2,
  productIds: ['c1133337781', 'o1133346083'],
  quantityMatched: true
}
```

- [ ] Run:

```powershell
node yahoo-plugin\content.test.js
```

Expected: pass.

## Task 6: Background Transaction Execution

- [ ] Add background tests that when idle action is `transaction_start`, background fetches jobs and posts status updates.

- [ ] Implement `runIdleActionChain()`:

```js
await openBiddingPageForSync();
await openWonPageForSync();
const action = await fetchNextIdleAction();
if (action.action === 'transaction_start') await runTransactionStartJobs();
await completeIdleAction(action);
```

- [ ] Implement normal job execution:

  - Open `transactionUrl`.
  - Inject `content.js`.
  - Ask content for bundle info.
  - If no bundle, use job `shippingFeeText` to post `pending_payment` or `waiting_shipping`.
  - If bundle exists and quantity matches, post `pending_bundle` for all bundle product orders after server validation.

- [ ] Add timeout handling and tab cleanup similar to task execution.

- [ ] Run:

```powershell
node yahoo-plugin\background.test.js
```

Expected: pass.

## Task 7: Admin Config and Orders UI

- [ ] Add admin API tests for config save/load and manual trigger.

- [ ] Extend `/api/admin/multi-bid-config` response and update to include new fields.

- [ ] Add `POST /api/admin/transaction-start/request` to set `transaction_start_requested=1`.

- [ ] Update `MultiBidSettings.tsx` labels and fields.

- [ ] Update `Orders.tsx` status renderer:

```ts
if (status === 'waiting_shipping') return <Tag color="orange">等待运费</Tag>;
if (status === 'pending_bundle') return <Tag color="purple">待同捆</Tag>;
```

- [ ] Run:

```powershell
node src\server\routes\admin.orders.test.js
Set-Location src\admin
npm run build
```

Expected: pass.

## Task 8: Full Regression

- [ ] Run:

```powershell
node src\server\routes\task.test.js
node src\server\routes\plugin.test.js
node src\server\routes\proxy.test.js
node src\server\routes\admin.orders.test.js
node yahoo-plugin\content.test.js
node yahoo-plugin\background.test.js
node src\client\src\utils\bidPrice.test.mjs
Set-Location src\client
npm run build
Set-Location ..\admin
npm run build
```

Expected: all pass.

## Self-Review

- Spec coverage: schema, scheduler, all-empty-order processing, transaction URL extraction, bundle quantity validation, admin config, and order display are covered.
- Scope control: scan/payment/receipt are scheduler placeholders only; no Yahoo action implementation in this plan.
- Known blocker: real `/my/won` link extraction could not be verified in the current Codex-controlled Chrome profile because Yahoo redirected to login.
