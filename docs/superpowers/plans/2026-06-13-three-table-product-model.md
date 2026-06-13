# Three Table Product Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `products / tasks / orders` as the long-term data model by moving product snapshot ownership out of `tasks` without changing current bidding, payment, transaction-start, receipt, or user-facing API behavior during the first rollout.

**Architecture:** Add `products` as the authoritative product snapshot table and add `orders.product_id` while keeping all existing product columns on `tasks` for compatibility. The first production-safe phase is schema + backfill + dual-write only; read paths continue using old task columns unless explicitly switched with tests. Payment and transaction flows must remain on their current fields until product/table parity is proven by regression and production-like observation.

**Tech Stack:** Node.js, Express, better-sqlite3, SQLite, React, Umi, Vite, Chrome Extension Manifest V3, plain Node test scripts.

---

## Non-Negotiable Safety Rules

- Do not remove product columns from `tasks` in this plan.
- Do not change task statuses, order statuses, API paths, response field names, plugin polling interval, idle-action order, payment task selection, transaction-start selection, or receipt selection.
- Do not change payment amount calculation, shipping settlement rules, Google Sheets payable formulas, or order status transitions.
- Do not route payment/transaction/receipt reads to `products` in Tasks 1-4. Those flows keep using the existing `tasks` fields to avoid repeating the recent payment issue.
- Do not run cleanup, payment, receipt, transaction-start, product delete, order resync, or batch refresh endpoints against real data during implementation.
- Every database-changing step must be additive and idempotent.
- Every task must finish with focused tests; every checkpoint must finish with `npm run regression`.
- Before production deployment, make a full backup with `备份.bat` or an equivalent stopped-service SQLite backup.

---

## Target Model

```text
products.product_id 1 --- N tasks.product_id
products.product_id 1 --- 0/1 orders.product_id
orders.task_id      N --- 0/1 tasks.id
```

`products` owns product snapshots:

- stable fields: `product_id`, `product_url`, `product_title`, `product_image_url`, `tax_type`, `product_type`, `shipping_fee_text`, `buyout_price`
- live fields: `current_price`, `bid_count`, `end_time`, `last_fetched_at`, `last_scanned_at`
- audit fields: `created_at`, `updated_at`

`tasks` remains the user intent and bidding record:

- `user_id`, `product_id`, `max_price`, `user_max_price`, `multi_bid_increment`, `strategy`, `bid_mode`, `status`, `error_msg`, `pending_followup_max_price`, `force_orders_resync`
- existing product columns stay populated for compatibility during this plan

`orders` owns won-order facts:

- `product_id` is added directly
- `task_id` stays as the source/success task pointer
- `final_price`, `won_at`, `transaction_url`, payment/status fields stay unchanged

---

## File Structure

- Create: `src/server/services/productRepository.js`
  - Pure database helpers for normalizing snapshots, upserting `products`, backfilling from existing tables, and building compatibility SELECT snippets.

- Create: `src/server/services/productRepository.test.js`
  - Tests SQL shape, merge precedence, idempotent upsert, and backfill calls using fake database objects.

- Modify: `src/server/models/index.js`
  - Add idempotent `products` table creation, indexes, and `orders.product_id`.

- Modify: `src/db/init.sql`
  - Keep fresh installs aligned with runtime schema.

- Modify: `src/server/routes/task.js`
  - On submit, upsert `products` and continue inserting the same product fields into `tasks`.
  - Later read-path tasks may join `products`, but API output must remain unchanged.

- Modify: `src/server/routes/plugin.js`
  - When updating product snapshots, write to `products` in addition to existing `tasks` and `bidding_items` writes.
  - When syncing won orders, populate `orders.product_id` without changing final-price or order-status behavior.
  - Do not change payment, transaction-start, receipt, or scheduled idle task flow in the first rollout.

- Modify: `src/server/routes/admin.js`
  - Manual order import confirmation should upsert `products` and populate `orders.product_id`, while still writing current `tasks` fields.
  - Product data delete must include `products` only after task/order deletion semantics are explicitly tested.

- Modify tests:
  - `src/server/routes/task.test.js`
  - `src/server/routes/plugin.test.js`
  - `src/server/routes/admin.orders.test.js`
  - `src/server/services/dataCleanup.test.js`

- Modify docs:
  - `agents.md`

---

## Task 1: Add Product Schema Additively

**Files:**
- Modify: `src/server/models/index.js`
- Modify: `src/db/init.sql`
- Create: `src/server/services/productRepository.test.js`
- Create: `src/server/services/productRepository.js`

- [x] **Step 1: Write failing product repository schema contract test**

Create `src/server/services/productRepository.test.js` with this first test:

```javascript
const assert = require('assert/strict');
const {
  normalizeProductSnapshot
} = require('./productRepository');

function testNormalizeProductSnapshotKeepsKnownFieldsOnly() {
  assert.deepEqual(normalizeProductSnapshot({
    product_id: 'A123456789',
    product_url: 'https://auctions.yahoo.co.jp/jp/auction/a123456789',
    product_title: 'Title',
    product_image_url: 'https://example.com/image.jpg',
    current_price: '1200',
    buyout_price: '5000',
    bid_count: '2',
    tax_type: 'tax_included',
    product_type: 'store',
    shipping_fee_text: '送料 500円',
    end_time: '2026-06-20T12:00:00+09:00',
    ignored: 'x'
  }), {
    product_id: 'a123456789',
    product_url: 'https://auctions.yahoo.co.jp/jp/auction/a123456789',
    product_title: 'Title',
    product_image_url: 'https://example.com/image.jpg',
    current_price: 1200,
    buyout_price: 5000,
    bid_count: 2,
    tax_type: 'tax_included',
    product_type: 'store',
    shipping_fee_text: '送料 500円',
    end_time: '2026-06-20T12:00:00+09:00'
  });
}

testNormalizeProductSnapshotKeepsKnownFieldsOnly();
console.log('product repository tests passed');
```

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
node src\server\services\productRepository.test.js
```

Expected: FAIL with module not found for `./productRepository`.

- [x] **Step 3: Add minimal product repository module**

Create `src/server/services/productRepository.js`:

```javascript
function normalizeInteger(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function normalizeProductId(value) {
  const text = String(value || '').trim().toLowerCase();
  return text || null;
}

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeProductSnapshot(input = {}) {
  const productId = normalizeProductId(input.product_id ?? input.productId);
  if (!productId) return null;
  return {
    product_id: productId,
    product_url: normalizeText(input.product_url ?? input.productUrl),
    product_title: normalizeText(input.product_title ?? input.productTitle ?? input.title),
    product_image_url: normalizeText(input.product_image_url ?? input.productImageUrl ?? input.imageUrl),
    current_price: normalizeInteger(input.current_price ?? input.currentPrice),
    buyout_price: normalizeInteger(input.buyout_price ?? input.buyoutPrice),
    bid_count: normalizeInteger(input.bid_count ?? input.bidCount) || 0,
    tax_type: normalizeText(input.tax_type ?? input.taxType) || 'tax_zero',
    product_type: normalizeText(input.product_type ?? input.productType) || 'normal',
    shipping_fee_text: normalizeText(input.shipping_fee_text ?? input.shippingFeeText),
    end_time: normalizeText(input.end_time ?? input.endTime)
  };
}

module.exports = {
  normalizeProductSnapshot
};
```

- [x] **Step 4: Run product repository test**

Run:

```powershell
node src\server\services\productRepository.test.js
```

Expected: PASS.

- [x] **Step 5: Add schema idempotently**

In `src/server/models/index.js`, add `products` table creation before `bidding_items`:

```javascript
db.prepare(`
  CREATE TABLE IF NOT EXISTS products (
    product_id VARCHAR(32) PRIMARY KEY,
    product_url TEXT,
    product_title VARCHAR(512),
    product_image_url TEXT,
    current_price INTEGER,
    buyout_price INTEGER,
    bid_count INTEGER DEFAULT 0,
    tax_type VARCHAR(32) DEFAULT 'tax_zero',
    product_type VARCHAR(32) DEFAULT 'normal',
    shipping_fee_text VARCHAR(64),
    end_time DATETIME,
    last_fetched_at DATETIME,
    last_scanned_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_products_end_time
  ON products(end_time)
`).run();
```

Add:

```javascript
ensureColumn('orders', 'product_id', 'VARCHAR(32)');
```

Add index:

```javascript
db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_orders_product_id
  ON orders(product_id)
`).run();
```

- [x] **Step 6: Mirror schema in `src/db/init.sql`**

Add the same `products` table and indexes to `src/db/init.sql`. Add `product_id VARCHAR(32)` to the `orders` table definition and add `CREATE INDEX IF NOT EXISTS idx_orders_product_id ON orders(product_id);`.

- [x] **Step 7: Run focused tests and regression**

Run:

```powershell
node src\server\services\productRepository.test.js
npm run regression
```

Expected: PASS.

Checkpoint: schema exists, but no runtime behavior has changed.

---

## Task 2: Backfill Products and Orders Product IDs

**Files:**
- Modify: `src/server/services/productRepository.js`
- Modify: `src/server/services/productRepository.test.js`

- [x] **Step 1: Add failing backfill tests**

Append tests that verify:

```javascript
const {
  backfillProductsFromExistingData,
  backfillOrderProductIds
} = require('./productRepository');

async function testBackfillProductsReadsTasksAndBiddingItemsOnly() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 3 };
    }
  };

  const result = await backfillProductsFromExistingData(fakeDb);

  assert.equal(result.rowCount, 3);
  assert.match(calls[0].sql, /INSERT INTO products/);
  assert.match(calls[0].sql, /FROM tasks/);
  assert.match(calls[0].sql, /LEFT JOIN bidding_items/);
}

async function testBackfillOrderProductIdsUsesTaskRelationOnly() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 2 };
    }
  };

  const result = await backfillOrderProductIds(fakeDb);

  assert.equal(result.rowCount, 2);
  assert.match(calls[0].sql, /UPDATE orders/);
  assert.match(calls[0].sql, /SELECT product_id FROM tasks/);
  assert.doesNotMatch(calls[0].sql, /order_status/);
}
```

Call both tests before the final `console.log`.

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
node src\server\services\productRepository.test.js
```

Expected: FAIL because backfill functions are missing.

- [x] **Step 3: Implement backfill functions**

Add `backfillProductsFromExistingData(database)` that inserts one product row per `product_id` from latest task plus `bidding_items` data:

- use `tasks` as source of stable fields
- use `bidding_items.current_price/product_image_url/product_title` as newer live fallback where present
- use `ON CONFLICT(product_id) DO UPDATE`
- do not alter `tasks`, `orders`, `bidding_items`, or statuses

Add `backfillOrderProductIds(database)`:

```sql
UPDATE orders
SET product_id = (
  SELECT product_id FROM tasks WHERE tasks.id = orders.task_id LIMIT 1
),
updated_at = CURRENT_TIMESTAMP
WHERE product_id IS NULL
  AND task_id IS NOT NULL
```

- [x] **Step 4: Run focused tests**

Run:

```powershell
node src\server\services\productRepository.test.js
```

Expected: PASS.

- [x] **Step 5: Add one-time startup backfill guarded by idempotence**

In `src/server/models/index.js`, after schema creation, run SQL-only backfill once every startup because it is idempotent. It must only populate missing/older product fields and missing `orders.product_id`; it must not update order statuses or payment fields.

- [x] **Step 6: Run full regression**

Run:

```powershell
npm run regression
```

Expected: PASS.

Checkpoint: existing data can populate `products`; task and payment behavior still unchanged.

---

## Task 3: Dual-Write Products on User Submit and Manual Import

**Files:**
- Modify: `src/server/services/productRepository.js`
- Modify: `src/server/services/productRepository.test.js`
- Modify: `src/server/routes/task.js`
- Modify: `src/server/routes/admin.js`
- Modify: `src/server/routes/task.test.js`
- Modify: `src/server/routes/admin.orders.test.js`

- [x] **Step 1: Add upsert test**

Add `upsertProductSnapshot(database, snapshot, options)` test that asserts the SQL:

- inserts into `products`
- uses `ON CONFLICT(product_id) DO UPDATE`
- preserves existing `shipping_fee_text` when the new snapshot has no shipping text
- sets `last_fetched_at` when `options.source === 'fetch'`

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
node src\server\services\productRepository.test.js
```

Expected: FAIL because `upsertProductSnapshot` is missing.

- [x] **Step 3: Implement upsert**

Implement `upsertProductSnapshot()` in `productRepository.js`. Use `COALESCE(excluded.field, products.field)` for nullable fields so an incomplete plugin/import snapshot cannot erase existing title/image/shipping data.

- [x] **Step 4: Wire submit dual-write**

In `src/server/routes/task.js`, after product information is resolved and before or immediately after `INSERT INTO tasks`, call:

```javascript
await upsertProductSnapshot(db, {
  product_id: productId,
  product_url: productUrl,
  product_title: product_title || productInfo?.title || null,
  product_image_url: product_image_url || productInfo?.imageUrl || null,
  current_price: current_price || productInfo?.currentPrice || null,
  buyout_price: buyoutPrices.buyoutPrice || null,
  bid_count: bidCountValue,
  tax_type: resolvedTaxType,
  product_type: resolvedProductType,
  shipping_fee_text: shippingFeeText,
  end_time: endTime
}, { source: 'fetch' });
```

Keep the existing `INSERT INTO tasks` fields unchanged.

- [x] **Step 5: Wire manual import dual-write**

In `src/server/routes/admin.js`, when confirming manual import and creating the task/order, upsert `products` from the candidate item. Continue writing product fields into `tasks` exactly as today.

- [x] **Step 6: Populate `orders.product_id` on new orders created by manual import**

When inserting into `orders`, include `product_id`. Keep `task_id` unchanged.

- [x] **Step 7: Run focused tests**

Run:

```powershell
node src\server\services\productRepository.test.js
node src\server\routes\task.test.js
node src\server\routes\admin.orders.test.js
```

Expected: PASS.

- [x] **Step 8: Run full regression**

Run:

```powershell
npm run regression
```

Expected: PASS.

Checkpoint: new user submits and manual imports dual-write `products`; API output and payment logic remain unchanged.

---

## Task 4: Dual-Write Products from Plugin Snapshot, Bidding Sync, and Won Sync

**Files:**
- Modify: `src/server/routes/plugin.js`
- Modify: `src/server/routes/plugin.test.js`
- Modify: `src/server/services/productRepository.js`
- Modify: `src/server/services/productRepository.test.js`

- [x] **Step 1: Add plugin tests for dual-write without payment changes**

In `src/server/routes/plugin.test.js`, add assertions for existing tests around:

- task snapshot update endpoint writes `products`
- bidding sync writes `products.last_scanned_at`
- won-order sync sets `orders.product_id`
- payment job SQL still reads `t.shipping_fee_text` and `t.product_type` as before

- [x] **Step 2: Run plugin tests to verify they fail**

Run:

```powershell
node src\server\routes\plugin.test.js
```

Expected: FAIL only on missing product writes/product_id population.

- [x] **Step 3: Update task snapshot endpoint**

In the `/api/plugin/task/:id/snapshot` logic, keep the existing `UPDATE tasks` statement and add `upsertProductSnapshot()` with snapshot values. Do not remove or rename task fields returned to the plugin.

- [x] **Step 4: Update bidding sync**

When `/api/plugin/bidding-items/sync` upserts `bidding_items`, also upsert `products` with:

- `product_id`
- `product_url`
- `product_title`
- `product_image_url`
- `current_price` converted to existing tax-excluded system口径
- `last_scanned_at`

Do not update `products.shipping_fee_text` from bidding sync.

- [x] **Step 5: Update won-order sync**

When inserting/updating `orders`, include `product_id`. Do not change final price rule: `orders.final_price` still comes only from Yahoo won page parsed price.

- [x] **Step 6: Run focused tests**

Run:

```powershell
node src\server\services\productRepository.test.js
node src\server\routes\plugin.test.js
```

Expected: PASS.

- [x] **Step 7: Run full regression**

Run:

```powershell
npm run regression
```

Expected: PASS.

Checkpoint: plugin dual-writes products, but payment/transaction/receipt behavior still uses existing task/order fields.

---

## Task 5: Switch Low-Risk Read Paths to Products with Compatibility Fallback

**Files:**
- Modify: `src/server/routes/task.js`
- Modify: `src/server/routes/admin.js`
- Modify: `src/server/routes/task.test.js`
- Modify: `src/server/routes/admin.orders.test.js`

- [x] **Step 1: Switch user display-only lists first**

Update only display/read list SQL for:

- user task list
- active bidding list
- won items list
- won stats export

Use `LEFT JOIN products p ON p.product_id = t.product_id` and return the same field names:

```sql
COALESCE(p.product_title, t.product_title, '') AS product_title
COALESCE(p.product_image_url, t.product_image_url, '') AS product_image_url
COALESCE(p.current_price, t.current_price) AS current_price
COALESCE(p.buyout_price, t.buyout_price) AS buyout_price
COALESCE(p.tax_type, t.tax_type, 'tax_zero') AS tax_type
COALESCE(p.product_type, t.product_type, CASE WHEN COALESCE(p.tax_type, t.tax_type, 'tax_zero') = 'tax_included' THEN 'store' ELSE 'normal' END) AS product_type
COALESCE(p.shipping_fee_text, t.shipping_fee_text) AS shipping_fee_text
COALESCE(p.end_time, t.end_time) AS end_time
```

- [x] **Step 2: Do not switch payment/settlement queries in this task**

Leave these flows on existing `tasks` columns:

- `getPendingPaymentJobs`
- `executePaymentJob`
- `getPendingTransactionStartJobs`
- transaction-start status updates
- receipt jobs
- Google Sheets append rows

- [x] **Step 3: Update tests to assert compatibility**

Existing tests that assert `t.product_title` should be updated to accept `COALESCE(p.product_title, t.product_title...)`, and add assertions that output aliases are unchanged.

- [x] **Step 4: Run focused tests**

Run:

```powershell
node src\server\routes\task.test.js
node src\server\routes\admin.orders.test.js
```

Expected: PASS.

- [x] **Step 5: Run full regression**

Run:

```powershell
npm run regression
```

Expected: PASS.

Checkpoint: display paths use `products` with fallback; operational payment paths remain untouched.

---

## Task 6: Product Data Delete and Cleanup Policy Alignment

**Files:**
- Modify: `src/server/routes/admin.js`
- Modify: `src/server/routes/admin.orders.test.js`
- Modify: `src/server/services/dataCleanup.js`
- Modify: `src/server/services/dataCleanup.test.js`

- [x] **Step 1: Define delete semantics**

For explicit product data delete by product ID, delete order remains:

1. bid logs for tasks
2. orders
3. bidding_items
4. tasks
5. products

This endpoint is already destructive and admin-triggered, so deleting `products` here is expected.

- [x] **Step 2: Preserve automatic cleanup semantics**

Automatic/manual stale task cleanup must not delete `products` in this plan. It only deletes stale failed/cancelled/bidding task-associated data as documented by Task 6 maintenance cleanup policy.

- [x] **Step 3: Add tests**

Update product-data-delete tests to assert `DELETE FROM products WHERE product_id IN (...)` occurs after task/order deletes.

Update `dataCleanup.test.js` to assert no `DELETE FROM products` occurs in stale cleanup.

- [x] **Step 4: Run focused tests**

Run:

```powershell
node src\server\routes\admin.orders.test.js
node src\server\services\dataCleanup.test.js
```

Expected: PASS.

- [x] **Step 5: Run full regression**

Run:

```powershell
npm run regression
```

Expected: PASS.

Checkpoint: destructive admin delete handles products; routine stale cleanup protects products.

---

## Task 7: Production Readiness Checks Before Operational Read Switch

**Files:**
- Modify: `agents.md`
- Create: `scripts/check-product-parity.js`

- [x] **Step 1: Add parity check script**

Create `scripts/check-product-parity.js` to report counts:

- tasks with no product row
- orders with no `product_id`
- orders whose `product_id` differs from source task product ID
- products whose latest task has a different shipping text/product type

The script must be read-only.

- [x] **Step 2: Run parity check on a backup or local copy**

Run:

```powershell
node scripts\check-product-parity.js
```

Expected: reports counts only; no writes.

- [x] **Step 3: Update handoff docs**

Update `agents.md` with:

- schema changes
- backfill status
- dual-write status
- read paths already switched
- payment/transaction/receipt paths intentionally not switched
- parity check output
- verification commands

- [x] **Step 4: Run final verification**

Run:

```powershell
npm run regression
git status --short
```

Expected:

- regression passes
- no `data/gdaipai.db` changes
- changed files match this plan

---

## Later Phase: Operational Query Switch

Only after at least one production-like run confirms dual-write parity:

- payment job selection may read `COALESCE(products.shipping_fee_text, tasks.shipping_fee_text)` but must keep the same settlement rules
- transaction-start job selection may read product type/shipping from `products` only after tests cover `store` direct待支付, normal `落札者負担` waiting_shipping, bundle, and normal fixed shipping
- receipt and Google Sheets flows may read product title/type/shipping from `products` only after a focused test covers the recent payment/paid/shipment states
- old `tasks` product columns remain until a separate removal plan exists; do not remove them in this plan

---

## Final Verification

Run:

```powershell
node src\server\services\productRepository.test.js
node src\server\services\dataCleanup.test.js
node src\server\routes\task.test.js
node src\server\routes\plugin.test.js
node src\server\routes\admin.orders.test.js
npm run regression
git status --short
```

Expected:

- all tests pass
- API response fields remain compatible
- payment, transaction-start, receipt, and plugin idle action tests still pass
- `data/gdaipai.db` is not modified in the working tree
- `tasks` product columns still exist and are still written

---

## Rollback Strategy

Because Tasks 1-4 are additive:

1. If a deploy has problems before read paths switch, stop the server, restore from backup, and redeploy the previous code.
2. If a deploy has problems after read paths switch, first revert the read-path task to fall back to `tasks` fields; keep the `products` table if it is not causing runtime errors.
3. Do not drop `products` in production unless a separate rollback script has been tested on a backup.
4. Never run cleanup expansion as part of rollback.
