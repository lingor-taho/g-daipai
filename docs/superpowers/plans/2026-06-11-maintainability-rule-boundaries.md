# Maintainability Rule Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve readability, maintainability, and extension safety by centralizing duplicated business rules and configuration access without changing current workflows, database data, API contracts, or plugin execution behavior.

**Architecture:** This is a behavior-preserving refactor. Shared constants and pure rule functions are extracted first, route files are then updated to import those rules, and only after parity tests pass should large route files be split into services. Existing SQLite schema, API paths, response fields, status values, and plugin polling order remain unchanged in this plan.

**Tech Stack:** Node.js, Express, better-sqlite3, React, Vite, Umi, Chrome Extension Manifest V3, plain Node test scripts.

---

## Non-Negotiable Safety Rules

- Do not modify `data/gdaipai.db`.
- Do not run admin cleanup, batch refresh, order resync, payment, receipt, transaction-start, or product-data-delete endpoints against real data.
- Do not change `src/db/init.sql` or add schema migrations in this plan.
- Do not change API route paths, response field names, task statuses, order statuses, config keys, plugin polling interval, idle-action order, or Chrome extension host permissions.
- Do not change business formulas. Every extracted function must preserve the current implementation exactly, including rounding behavior.
- Do not expand data cleanup scope in the first refactor pass. Current cleanup behavior is preserved: only stale `failed`, `cancelled`, and `bidding` tasks are deleted; successful won-order data is not deleted.
- Every task must finish with focused tests and then `npm run regression`.
- If any regression fails, stop and fix the refactor before continuing.

---

## File Structure

Create these shared rule modules:

- `src/shared/domainConstants.js`
  - Owns canonical string constants for tax types, product types, bid modes, task statuses, order statuses, bid strategy scopes, and common Yahoo rule numbers.

- `src/shared/priceRules.js`
  - Owns tax-included/tax-excluded conversion and display price helpers.

- `src/shared/biddingRules.js`
  - Owns Yahoo minimum bid increments, minimum required bid, multi-bid increment validation, low-price split rules, and buyout price resolution.

- `src/shared/shippingRules.js`
  - Owns shipping text normalization and payable shipping-fee interpretation.

- `src/shared/payableRules.js`
  - Owns tax-included final price and order payable calculation.

- `src/shared/orderStatus.js`
  - Owns order status constants, labels, and transition helper predicates.

- `src/server/services/dataCleanupPolicy.js`
  - Owns explicit cleanup status policy and documents which data is safe to delete. This keeps long-running invalid data cleanup separate from bidding, order, and settlement behavior.

Create these tests:

- `src/shared/priceRules.test.js`
- `src/shared/biddingRules.test.js`
- `src/shared/shippingRules.test.js`
- `src/shared/payableRules.test.js`
- `src/shared/orderStatus.test.js`
- `src/server/services/dataCleanupPolicy.test.js`

Modify these existing files in low-risk order:

- `src/server/routes/task.js`
  - Replace local price/bidding helper implementations and reverse dependency on `./plugin`.

- `src/server/routes/plugin.js`
  - Replace duplicated constants and pure rule helpers with shared imports.

- `src/server/routes/admin.js`
  - Replace duplicated order status, shipping, and payable helpers with shared imports.

- `src/server/routes/proxy.js`
  - Replace tax/product type helper duplication with shared imports where this does not alter parsing behavior.

- `src/client/src/utils/bidPrice.js`
  - Defer until server-side parity is proven. Later align browser-side helpers with shared rule names or copy exact tested logic into the client utility.

- `src/client/src/pages/Submit.jsx`
  - Defer until server-side parity is proven. Later remove local low-price split and minimum increment duplication.

- `agents.md`
  - Record the current maintenance plan and verification requirements.

---

## Task 1: Capture Current Regression Baseline

**Files:**
- Read only: all existing source files.
- Modify: none.

- [ ] **Step 1: Check worktree is clean**

Run:

```powershell
git status --short
```

Expected: no output, or only user-known unrelated changes. If unrelated changes exist, do not modify those files.

- [ ] **Step 2: Run current regression suite**

Run:

```powershell
npm run regression
```

Expected: all existing route tests, plugin tests, encoding guard, admin build, and client build pass.

- [ ] **Step 3: Record baseline**

Append the exact command result summary to the implementation notes in `agents.md` only after the suite passes. Do not proceed if the baseline is failing unless the failing tests are documented pre-existing failures and the user approves continuing.

---

## Task 2: Extract Domain Constants

**Files:**
- Create: `src/shared/domainConstants.js`
- Create: `src/shared/orderStatus.test.js`
- Modify: `src/server/routes/plugin.js`
- Modify: `src/server/routes/admin.js`

- [ ] **Step 1: Write constants test**

Create `src/shared/orderStatus.test.js`:

```javascript
const assert = require('assert');
const {
  ORDER_STATUS_PENDING_PAYMENT,
  ORDER_STATUS_WAITING_SHIPPING,
  ORDER_STATUS_PENDING_BUNDLE,
  ORDER_STATUS_BUNDLE_COMPLETED,
  ORDER_STATUS_PENDING_SETTLEMENT,
  ORDER_STATUS_PENDING_SHIPMENT,
  ORDER_STATUS_PENDING_RECEIPT,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_LABELS,
  isTerminalOrderStatus
} = require('./domainConstants');

assert.equal(ORDER_STATUS_PENDING_PAYMENT, 'pending_payment');
assert.equal(ORDER_STATUS_WAITING_SHIPPING, 'waiting_shipping');
assert.equal(ORDER_STATUS_PENDING_BUNDLE, 'pending_bundle');
assert.equal(ORDER_STATUS_BUNDLE_COMPLETED, 'bundle_completed');
assert.equal(ORDER_STATUS_PENDING_SETTLEMENT, 'pending_settlement');
assert.equal(ORDER_STATUS_PENDING_SHIPMENT, 'pending_shipment');
assert.equal(ORDER_STATUS_PENDING_RECEIPT, 'pending_receipt');
assert.equal(ORDER_STATUS_CANCELLED, 'cancelled');
assert.equal(ORDER_STATUS_COMPLETED, 'completed');
assert.equal(ORDER_STATUS_LABELS[ORDER_STATUS_PENDING_SETTLEMENT], '待结算');
assert.equal(isTerminalOrderStatus(ORDER_STATUS_COMPLETED), true);
assert.equal(isTerminalOrderStatus(ORDER_STATUS_CANCELLED), true);
assert.equal(isTerminalOrderStatus(ORDER_STATUS_PENDING_PAYMENT), false);

console.log('domain constants tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node src\shared\orderStatus.test.js
```

Expected: FAIL with module not found for `./domainConstants`.

- [ ] **Step 3: Add constants module**

Create `src/shared/domainConstants.js` with exactly the existing string values:

```javascript
const TAX_TYPE_ZERO = 'tax_zero';
const TAX_TYPE_INCLUDED = 'tax_included';

const PRODUCT_TYPE_NORMAL = 'normal';
const PRODUCT_TYPE_STORE = 'store';

const BID_MODE_BID = 'bid';
const BID_MODE_BUYOUT = 'buyout';

const TASK_STATUS_PENDING = 'pending';
const TASK_STATUS_PROCESSING = 'processing';
const TASK_STATUS_BIDDING = 'bidding';
const TASK_STATUS_SUCCESS = 'success';
const TASK_STATUS_FAILED = 'failed';
const TASK_STATUS_CANCELLED = 'cancelled';

const BID_STRATEGY_DIRECT = 'direct';
const BID_STRATEGY_MULTI_BID = 'multi_bid';
const BID_STRATEGY_SCOPE_ALL = 'all';
const BID_STRATEGY_SCOPE_DIRECT_ONLY = 'direct_only';

const ORDER_STATUS_PENDING_PAYMENT = 'pending_payment';
const ORDER_STATUS_WAITING_SHIPPING = 'waiting_shipping';
const ORDER_STATUS_PENDING_BUNDLE = 'pending_bundle';
const ORDER_STATUS_BUNDLE_COMPLETED = 'bundle_completed';
const ORDER_STATUS_PENDING_SETTLEMENT = 'pending_settlement';
const ORDER_STATUS_PENDING_SHIPMENT = 'pending_shipment';
const ORDER_STATUS_PENDING_RECEIPT = 'pending_receipt';
const ORDER_STATUS_CANCELLED = 'cancelled';
const ORDER_STATUS_COMPLETED = 'completed';

const ORDER_STATUS_LABELS = Object.freeze({
  [ORDER_STATUS_PENDING_PAYMENT]: '待支付',
  [ORDER_STATUS_WAITING_SHIPPING]: '等待发货',
  [ORDER_STATUS_PENDING_BUNDLE]: '待同捆',
  [ORDER_STATUS_BUNDLE_COMPLETED]: '同捆完成',
  [ORDER_STATUS_PENDING_SETTLEMENT]: '待结算',
  [ORDER_STATUS_PENDING_SHIPMENT]: '待发货',
  [ORDER_STATUS_PENDING_RECEIPT]: '待收货',
  [ORDER_STATUS_CANCELLED]: '已取消',
  [ORDER_STATUS_COMPLETED]: '完了'
});

const YAHOO_LOW_PRICE_THRESHOLD = 1000;
const YAHOO_LOW_PRICE_BID_LIMIT = 10000;
const YAHOO_LOW_PRICE_INITIAL_BID = 9000;
const YAHOO_LOW_PRICE_FOLLOWUP_THRESHOLD = 1200;
const DEFAULT_MULTI_BID_MIN_PRICE = 5000;

function isTerminalOrderStatus(status) {
  return status === ORDER_STATUS_COMPLETED || status === ORDER_STATUS_CANCELLED;
}

module.exports = {
  TAX_TYPE_ZERO,
  TAX_TYPE_INCLUDED,
  PRODUCT_TYPE_NORMAL,
  PRODUCT_TYPE_STORE,
  BID_MODE_BID,
  BID_MODE_BUYOUT,
  TASK_STATUS_PENDING,
  TASK_STATUS_PROCESSING,
  TASK_STATUS_BIDDING,
  TASK_STATUS_SUCCESS,
  TASK_STATUS_FAILED,
  TASK_STATUS_CANCELLED,
  BID_STRATEGY_DIRECT,
  BID_STRATEGY_MULTI_BID,
  BID_STRATEGY_SCOPE_ALL,
  BID_STRATEGY_SCOPE_DIRECT_ONLY,
  ORDER_STATUS_PENDING_PAYMENT,
  ORDER_STATUS_WAITING_SHIPPING,
  ORDER_STATUS_PENDING_BUNDLE,
  ORDER_STATUS_BUNDLE_COMPLETED,
  ORDER_STATUS_PENDING_SETTLEMENT,
  ORDER_STATUS_PENDING_SHIPMENT,
  ORDER_STATUS_PENDING_RECEIPT,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_LABELS,
  YAHOO_LOW_PRICE_THRESHOLD,
  YAHOO_LOW_PRICE_BID_LIMIT,
  YAHOO_LOW_PRICE_INITIAL_BID,
  YAHOO_LOW_PRICE_FOLLOWUP_THRESHOLD,
  DEFAULT_MULTI_BID_MIN_PRICE,
  isTerminalOrderStatus
};
```

- [ ] **Step 4: Run constants test**

Run:

```powershell
node src\shared\orderStatus.test.js
```

Expected: PASS with `domain constants tests passed`.

- [ ] **Step 5: Replace duplicate order status constants in server files**

In `src/server/routes/plugin.js` and `src/server/routes/admin.js`, import only the constants already defined locally, then delete the local duplicate `const ORDER_STATUS_...` declarations. Keep all exported names from `plugin.js` unchanged so existing tests and consumers still work.

Use this import pattern:

```javascript
const {
  ORDER_STATUS_PENDING_PAYMENT,
  ORDER_STATUS_WAITING_SHIPPING,
  ORDER_STATUS_PENDING_BUNDLE,
  ORDER_STATUS_BUNDLE_COMPLETED,
  ORDER_STATUS_PENDING_SETTLEMENT,
  ORDER_STATUS_PENDING_SHIPMENT,
  ORDER_STATUS_PENDING_RECEIPT,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_COMPLETED,
  DEFAULT_MULTI_BID_MIN_PRICE,
  YAHOO_LOW_PRICE_THRESHOLD,
  YAHOO_LOW_PRICE_BID_LIMIT,
  YAHOO_LOW_PRICE_INITIAL_BID,
  YAHOO_LOW_PRICE_FOLLOWUP_THRESHOLD
} = require('../../shared/domainConstants');
```

- [ ] **Step 6: Run focused tests**

Run:

```powershell
node src\shared\orderStatus.test.js
node src\server\routes\plugin.test.js
node src\server\routes\admin.orders.test.js
```

Expected: all pass.

- [ ] **Step 7: Run full regression**

Run:

```powershell
npm run regression
```

Expected: PASS.

---

## Task 3: Extract Price Rules

**Files:**
- Create: `src/shared/priceRules.js`
- Create: `src/shared/priceRules.test.js`
- Modify: `src/server/routes/task.js`
- Modify: `src/server/routes/plugin.js`
- Modify: `src/server/routes/admin.js`
- Modify: `src/server/routes/proxy.js`

- [ ] **Step 1: Write price rule tests matching current behavior**

Create `src/shared/priceRules.test.js`:

```javascript
const assert = require('assert');
const {
  normalizeTaxType,
  normalizeProductType,
  taxIncludedToTaxExcluded,
  taxExcludedToTaxIncluded,
  getDisplayPrice
} = require('./priceRules');

assert.equal(normalizeTaxType('tax_included'), 'tax_included');
assert.equal(normalizeTaxType('tax_zero'), 'tax_zero');
assert.equal(normalizeTaxType(''), 'tax_zero');
assert.equal(normalizeProductType('store', 'tax_zero'), 'store');
assert.equal(normalizeProductType('normal', 'tax_included'), 'normal');
assert.equal(normalizeProductType('', 'tax_included'), 'store');
assert.equal(normalizeProductType('', 'tax_zero'), 'normal');

assert.equal(taxIncludedToTaxExcluded(1000, 'tax_included'), 909);
assert.equal(taxIncludedToTaxExcluded(1100, 'tax_included'), 1000);
assert.equal(taxIncludedToTaxExcluded(11103, 'tax_included'), 10093);
assert.equal(taxIncludedToTaxExcluded(9, 'tax_included'), 9);
assert.equal(taxIncludedToTaxExcluded(1000, 'tax_zero'), 1000);

assert.equal(taxExcludedToTaxIncluded(1000, 'tax_included'), 1100);
assert.equal(taxExcludedToTaxIncluded(9, 'tax_included'), 9);
assert.equal(taxExcludedToTaxIncluded(1000, 'tax_zero'), 1000);

assert.equal(getDisplayPrice(5000, 'tax_included'), 5500);
assert.equal(getDisplayPrice(9, 'tax_included'), 9);
assert.equal(getDisplayPrice(5000, 'tax_zero'), 5000);

console.log('price rules tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node src\shared\priceRules.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: Add price rules module**

Create `src/shared/priceRules.js`:

```javascript
const {
  TAX_TYPE_ZERO,
  TAX_TYPE_INCLUDED,
  PRODUCT_TYPE_NORMAL,
  PRODUCT_TYPE_STORE
} = require('./domainConstants');

function normalizeTaxType(value) {
  return value === TAX_TYPE_INCLUDED ? TAX_TYPE_INCLUDED : TAX_TYPE_ZERO;
}

function normalizeProductType(value, taxType) {
  if (value === PRODUCT_TYPE_STORE || value === PRODUCT_TYPE_NORMAL) return value;
  return normalizeTaxType(taxType) === TAX_TYPE_INCLUDED ? PRODUCT_TYPE_STORE : PRODUCT_TYPE_NORMAL;
}

function taxIncludedToTaxExcluded(value, taxType) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  if (normalizeTaxType(taxType) !== TAX_TYPE_INCLUDED || number < 10) return Math.floor(number);
  return Math.floor((number / 1.1) + 1e-6);
}

function taxExcludedToTaxIncluded(value, taxType) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  if (normalizeTaxType(taxType) !== TAX_TYPE_INCLUDED || number < 10) return Math.floor(number);
  return Math.floor(number * 1.1);
}

function getDisplayPrice(value, taxType) {
  return taxExcludedToTaxIncluded(value, taxType);
}

module.exports = {
  normalizeTaxType,
  normalizeProductType,
  taxIncludedToTaxExcluded,
  taxExcludedToTaxIncluded,
  getDisplayPrice
};
```

- [ ] **Step 4: Replace equivalent local helpers**

Replace these local implementations with imports where signatures match:

- `src/server/routes/task.js`
  - `normalizeTaxType`
  - `normalizeProductType`
  - `calculateBidMaxPrice` becomes imported `taxIncludedToTaxExcluded` but re-export `calculateBidMaxPrice = taxIncludedToTaxExcluded` to preserve tests.
  - `getTaxIncludedPrice` becomes imported `taxExcludedToTaxIncluded` but re-export `getTaxIncludedPrice = taxExcludedToTaxIncluded`.

- `src/server/routes/proxy.js`
  - Replace tax included conversion helper only if the current helper has identical behavior.

- `src/server/routes/admin.js`
  - Replace `getTaxIncludedFinalPrice` with `taxExcludedToTaxIncluded` only if tests confirm identical behavior.

- `src/server/routes/plugin.js`
  - Replace `getTaxIncludedFinalPrice` with `taxExcludedToTaxIncluded` only if tests confirm identical behavior.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
node src\shared\priceRules.test.js
node src\server\routes\task.test.js
node src\server\routes\proxy.test.js
node src\server\routes\plugin.test.js
node src\server\routes\admin.orders.test.js
```

Expected: all pass.

- [ ] **Step 6: Run full regression**

Run:

```powershell
npm run regression
```

Expected: PASS.

---

## Task 4: Extract Bidding Rules and Remove `task.js -> plugin.js` Dependency

**Files:**
- Create: `src/shared/biddingRules.js`
- Create: `src/shared/biddingRules.test.js`
- Modify: `src/server/routes/task.js`
- Modify: `src/server/routes/plugin.js`
- Modify: `src/client/src/pages/Submit.jsx` only after server-side tests pass.

- [ ] **Step 1: Write bidding rule tests matching current behavior**

Create `src/shared/biddingRules.test.js`:

```javascript
const assert = require('assert');
const {
  getMinBidIncrement,
  getRequiredBidMaxPrice,
  shouldSplitDirectBidByYahooLowPriceRule,
  resolveBuyoutTaskPrices
} = require('./biddingRules');

assert.equal(getMinBidIncrement(999), 10);
assert.equal(getMinBidIncrement(1000), 100);
assert.equal(getMinBidIncrement(4999), 100);
assert.equal(getMinBidIncrement(5000), 250);
assert.equal(getMinBidIncrement(9999), 250);
assert.equal(getMinBidIncrement(10000), 500);
assert.equal(getMinBidIncrement(49999), 500);
assert.equal(getMinBidIncrement(50000), 1000);

assert.equal(getRequiredBidMaxPrice(9841, 0), 9841);
assert.equal(getRequiredBidMaxPrice(9841, 1), 10091);

assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
  strategy: 'direct',
  bidMode: 'bid',
  currentPrice: 500,
  submitMaxPrice: 15000,
  taxType: 'tax_zero'
}), true);
assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
  strategy: 'direct',
  bidMode: 'bid',
  currentPrice: 1000,
  submitMaxPrice: 15000,
  taxType: 'tax_zero'
}), false);
assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
  strategy: 'multi_bid',
  bidMode: 'bid',
  currentPrice: 500,
  submitMaxPrice: 15000,
  taxType: 'tax_zero'
}), false);
assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
  strategy: 'direct',
  bidMode: 'buyout',
  currentPrice: 500,
  submitMaxPrice: 15000,
  taxType: 'tax_zero'
}), false);
assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
  strategy: 'direct',
  bidMode: 'bid',
  currentPrice: 1,
  submitMaxPrice: 10010,
  taxType: 'tax_included'
}), false);
assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
  strategy: 'direct',
  bidMode: 'bid',
  currentPrice: 1,
  submitMaxPrice: 12100,
  taxType: 'tax_included'
}), true);

assert.deepEqual(resolveBuyoutTaskPrices({
  fetchedBuyoutPrice: 0,
  submittedBuyoutPrice: 275100,
  inputMaxPrice: 0,
  taxType: 'tax_included'
}), {
  buyoutPrice: 275100,
  userMaxPrice: 275100,
  bidMaxPrice: 250090
});

console.log('bidding rules tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node src\shared\biddingRules.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: Add bidding rules module**

Create `src/shared/biddingRules.js` by moving the current pure implementations from `task.js`, `plugin.js`, and `Submit.jsx` without changing logic:

```javascript
const {
  BID_MODE_BID,
  BID_MODE_BUYOUT,
  BID_STRATEGY_DIRECT,
  YAHOO_LOW_PRICE_THRESHOLD,
  YAHOO_LOW_PRICE_BID_LIMIT,
  YAHOO_LOW_PRICE_INITIAL_BID,
  YAHOO_LOW_PRICE_FOLLOWUP_THRESHOLD,
  DEFAULT_MULTI_BID_MIN_PRICE
} = require('./domainConstants');
const {
  normalizeTaxType,
  taxIncludedToTaxExcluded
} = require('./priceRules');

function getMinBidIncrement(price) {
  const value = Number(price || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value < 1000) return 10;
  if (value < 5000) return 100;
  if (value < 10000) return 250;
  if (value < 50000) return 500;
  return 1000;
}

function getRequiredBidMaxPrice(currentPrice, bidCount) {
  const current = Number(currentPrice || 0);
  if (!Number.isFinite(current) || current <= 0) return 0;
  const count = Number(bidCount || 0);
  const increment = Number.isFinite(count) && count > 0 ? getMinBidIncrement(current) : 0;
  return Math.floor(current + increment);
}

function shouldSplitDirectBidByYahooLowPriceRule({ strategy, bidMode, currentPrice, submitMaxPrice, taxType }) {
  if (strategy !== BID_STRATEGY_DIRECT) return false;
  if (bidMode !== BID_MODE_BID) return false;
  const submitTaxExcluded = taxIncludedToTaxExcluded(submitMaxPrice, taxType);
  if (submitTaxExcluded <= YAHOO_LOW_PRICE_BID_LIMIT) return false;
  const currentTaxExcluded = Number(currentPrice || 0);
  if (!Number.isFinite(currentTaxExcluded) || currentTaxExcluded <= 0) return true;
  return currentTaxExcluded < YAHOO_LOW_PRICE_THRESHOLD;
}

function resolveBuyoutTaskPrices({ fetchedBuyoutPrice, submittedBuyoutPrice, inputMaxPrice, taxType }) {
  const resolvedTaxType = normalizeTaxType(taxType);
  const value = Number(fetchedBuyoutPrice || submittedBuyoutPrice || inputMaxPrice || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return { buyoutPrice: 0, userMaxPrice: 0, bidMaxPrice: 0 };
  }
  const buyoutPrice = Math.floor(value);
  if (resolvedTaxType === 'tax_included') {
    return {
      buyoutPrice,
      userMaxPrice: buyoutPrice,
      bidMaxPrice: taxIncludedToTaxExcluded(buyoutPrice, resolvedTaxType)
    };
  }
  return {
    buyoutPrice,
    userMaxPrice: buyoutPrice,
    bidMaxPrice: buyoutPrice
  };
}

module.exports = {
  BID_MODE_BID,
  BID_MODE_BUYOUT,
  YAHOO_LOW_PRICE_THRESHOLD,
  YAHOO_LOW_PRICE_BID_LIMIT,
  YAHOO_LOW_PRICE_INITIAL_BID,
  YAHOO_LOW_PRICE_FOLLOWUP_THRESHOLD,
  DEFAULT_MULTI_BID_MIN_PRICE,
  getMinBidIncrement,
  getRequiredBidMaxPrice,
  shouldSplitDirectBidByYahooLowPriceRule,
  resolveBuyoutTaskPrices
};
```

- [ ] **Step 4: Remove reverse dependency**

In `src/server/routes/task.js`, replace:

```javascript
const { DEFAULT_MULTI_BID_MIN_PRICE, shouldSplitDirectBidByYahooLowPriceRule, YAHOO_LOW_PRICE_INITIAL_BID } = require('./plugin');
```

with imports from `../../shared/biddingRules`.

Keep exported function names from `task.js` unchanged by aliasing:

```javascript
const getMinMultiBidIncrement = getMinBidIncrement;
const getDefaultMultiBidIncrement = getMinBidIncrement;
```

- [ ] **Step 5: Replace duplicate implementation in `plugin.js`**

Import `shouldSplitDirectBidByYahooLowPriceRule` and Yahoo low-price constants from `../../shared/biddingRules`, then delete the local duplicate constants and function. Keep `module.exports.shouldSplitDirectBidByYahooLowPriceRule` unchanged.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
node src\shared\biddingRules.test.js
node src\server\routes\task.test.js
node src\server\routes\plugin.test.js
```

Expected: all pass.

- [ ] **Step 7: Run full regression**

Run:

```powershell
npm run regression
```

Expected: PASS.

---

## Task 5: Extract Shipping and Payable Rules

**Files:**
- Create: `src/shared/shippingRules.js`
- Create: `src/shared/shippingRules.test.js`
- Create: `src/shared/payableRules.js`
- Create: `src/shared/payableRules.test.js`
- Modify: `src/server/routes/admin.js`
- Modify: `src/server/routes/plugin.js`

- [ ] **Step 1: Write shipping tests from existing settlement behavior**

Create `src/shared/shippingRules.test.js`:

```javascript
const assert = require('assert');
const {
  normalizeShippingFeeText,
  parseShippingFeeJpy,
  canSettleWithShippingFee
} = require('./shippingRules');

assert.equal(normalizeShippingFeeText(' 送料 1,000円 '), '送料 1,000円');
assert.equal(parseShippingFeeJpy('無料'), 0);
assert.equal(parseShippingFeeJpy('着払い'), 0);
assert.equal(parseShippingFeeJpy('送料 1,000円'), 1000);
assert.equal(parseShippingFeeJpy('落札者負担'), null);
assert.equal(canSettleWithShippingFee({ productType: 'store', shippingFeeText: '落札者負担' }), true);
assert.equal(canSettleWithShippingFee({ productType: 'normal', shippingFeeText: '落札者負担' }), false);
assert.equal(canSettleWithShippingFee({ productType: 'normal', shippingFeeText: '着払い' }), true);
assert.equal(canSettleWithShippingFee({ productType: 'normal', shippingFeeText: '送料 500円' }), true);

console.log('shipping rules tests passed');
```

- [ ] **Step 2: Write payable tests from existing formulas**

Create `src/shared/payableRules.test.js`:

```javascript
const assert = require('assert');
const { calculateOrderPayable } = require('./payableRules');

assert.deepEqual(calculateOrderPayable({
  finalPrice: 20000,
  taxType: 'tax_zero',
  shippingFeeText: '送料 1,000円',
  config: {
    rate: 0.05,
    bankFeeJpy: 500,
    handlingFeeCny: 15,
    largeAmountFeeCny: 0
  }
}), {
  finalPrice: 20000,
  taxIncludedFinalPrice: 20000,
  shippingFee: 1000,
  bankFeeJpy: 500,
  handlingFeeCny: 15,
  largeAmountFeeCny: 0,
  largeAmountFeeApplied: 0,
  payableCny: 1090
});

assert.equal(calculateOrderPayable({
  finalPrice: 30000,
  taxType: 'tax_zero',
  shippingFeeText: '無料',
  config: {
    rate: 0.05,
    bankFeeJpy: 0,
    handlingFeeCny: 0,
    largeAmountFeeCny: 20
  }
}).largeAmountFeeApplied, 1);

console.log('payable rules tests passed');
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```powershell
node src\shared\shippingRules.test.js
node src\shared\payableRules.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 4: Implement modules by moving existing logic exactly**

Move current settlement shipping and payable logic from `admin.js` and `plugin.js` into shared modules. Preserve:

- `無料` => 0
- `着払い` => 0
- fixed yen text => parsed yen number
- `落札者負担` => blocked for normal products
- `落札者負担` => allowed as 0 only for `product_type=store`
- payable formula: `(落札金额 + 运费 + 银行手续费) * 汇率 + 手续费(RMB) + 大金额费用`
- large amount fee threshold: tax-included final price >= 30000

- [ ] **Step 5: Replace server duplicates**

In `src/server/routes/admin.js` and `src/server/routes/plugin.js`, replace duplicate helper bodies with imports from `../../shared/shippingRules` and `../../shared/payableRules`. Keep existing exported helper names from both route modules unchanged for test compatibility.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
node src\shared\shippingRules.test.js
node src\shared\payableRules.test.js
node src\server\routes\plugin.test.js
node src\server\routes\admin.orders.test.js
```

Expected: all pass.

- [ ] **Step 7: Run full regression**

Run:

```powershell
npm run regression
```

Expected: PASS.

---

## Task 6: Extract Data Cleanup Policy Without Expanding Scope

**Files:**
- Create: `src/server/services/dataCleanupPolicy.js`
- Create: `src/server/services/dataCleanupPolicy.test.js`
- Modify: `src/server/services/dataCleanup.js`
- Modify: `src/server/services/dataCleanup.test.js`
- Modify: `src/admin/src/DataCleanup.tsx` only for copy changes if needed.

- [ ] **Step 1: Write cleanup policy tests matching current behavior**

Create `src/server/services/dataCleanupPolicy.test.js`:

```javascript
const assert = require('assert/strict');
const {
  CLEANUP_TASK_STATUSES,
  PRESERVED_TASK_STATUSES,
  shouldCleanupTaskStatus,
  buildCleanupScopeDescription
} = require('./dataCleanupPolicy');

assert.deepEqual(CLEANUP_TASK_STATUSES, ['failed', 'cancelled', 'bidding']);
assert.equal(shouldCleanupTaskStatus('failed'), true);
assert.equal(shouldCleanupTaskStatus('cancelled'), true);
assert.equal(shouldCleanupTaskStatus('bidding'), true);
assert.equal(shouldCleanupTaskStatus('success'), false);
assert.equal(shouldCleanupTaskStatus('pending'), false);
assert.equal(shouldCleanupTaskStatus('processing'), false);
assert.equal(PRESERVED_TASK_STATUSES.includes('success'), true);
assert.match(buildCleanupScopeDescription(), /failed/);
assert.match(buildCleanupScopeDescription(), /success/);

console.log('data cleanup policy tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node src\server\services\dataCleanupPolicy.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: Add cleanup policy module**

Create `src/server/services/dataCleanupPolicy.js`:

```javascript
const CLEANUP_TASK_STATUSES = Object.freeze(['failed', 'cancelled', 'bidding']);
const PRESERVED_TASK_STATUSES = Object.freeze(['success', 'pending', 'processing']);

function shouldCleanupTaskStatus(status) {
  return CLEANUP_TASK_STATUSES.includes(String(status || ''));
}

function buildCleanupStatusSqlList() {
  return CLEANUP_TASK_STATUSES.map(status => `'${status}'`).join(', ');
}

function buildCleanupScopeDescription() {
  return 'Deletes stale failed, cancelled, and bidding tasks plus related bid logs, orders, and bidding cache; preserves success won-order data.';
}

module.exports = {
  CLEANUP_TASK_STATUSES,
  PRESERVED_TASK_STATUSES,
  shouldCleanupTaskStatus,
  buildCleanupStatusSqlList,
  buildCleanupScopeDescription
};
```

- [ ] **Step 4: Replace local cleanup status constant**

In `src/server/services/dataCleanup.js`, replace:

```javascript
const CLEANUP_STATUSES = ['failed', 'cancelled', 'bidding'];
```

with:

```javascript
const {
  CLEANUP_TASK_STATUSES,
  buildCleanupStatusSqlList
} = require('./dataCleanupPolicy');
```

Keep exported `CLEANUP_STATUSES` unchanged for compatibility:

```javascript
const CLEANUP_STATUSES = CLEANUP_TASK_STATUSES;
```

Replace the SQL literal:

```sql
WHERE status IN ('failed', 'cancelled', 'bidding')
```

with the generated literal from `buildCleanupStatusSqlList()` while preserving the same SQL output:

```javascript
`SELECT id, product_id
 FROM tasks
 WHERE status IN (${buildCleanupStatusSqlList()})
   AND datetime(COALESCE(end_time, updated_at, created_at)) < datetime(?)`
```

- [ ] **Step 5: Keep admin copy aligned**

Check `src/admin/src/DataCleanup.tsx`. If the visible explanation already says cleanup covers failed, cancelled, and bidding tasks and preserves success orders, do not change it. If it differs, update copy only; do not change API calls.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
node src\server\services\dataCleanupPolicy.test.js
node src\server\services\dataCleanup.test.js
```

Expected: all pass, including the existing assertion that SQL still contains `status IN ('failed', 'cancelled', 'bidding')`.

- [ ] **Step 7: Run full regression**

Run:

```powershell
npm run regression
```

Expected: PASS.

---

## Future Cleanup Expansion Checkpoint

This is intentionally outside the behavior-preserving refactor. If the business wants to delete more long-running invalid data such as stale `pending` or `processing` rows, add a separate plan with these steps:

- Add a dry-run endpoint that counts candidate rows by status, age, and whether an order exists.
- Exclude all `success` rows and any row linked to a real won order.
- Define exact age rules for each status, for example stale `pending` older than N days with ended `end_time`, or stale `processing` older than N hours after reset attempts.
- Show candidate counts in the admin cleanup page before deletion.
- Require a manual confirmation for expanded cleanup rules.
- Run expanded cleanup against a backup copy of SQLite before production.

---

## Task 7: Add Config Registry Without Changing Storage

**Files:**
- Create: `src/server/services/configRegistry.js`
- Create: `src/server/services/configService.js`
- Create: `src/server/services/configService.test.js`
- Modify: none outside tests in this task.

- [ ] **Step 1: Write config service tests**

Create `src/server/services/configService.test.js`:

```javascript
const assert = require('assert');
const {
  CONFIG_DEFINITIONS,
  normalizeConfigValue,
  readConfigMap
} = require('./configService');

assert.equal(CONFIG_DEFINITIONS.multi_bid_min_price.defaultValue, 5000);
assert.equal(normalizeConfigValue('multi_bid_min_price', '6000'), 6000);
assert.equal(normalizeConfigValue('multi_bid_min_price', '-1'), 5000);
assert.equal(normalizeConfigValue('idle_bid_guard_minutes', '15'), 15);
assert.equal(normalizeConfigValue('idle_bid_guard_minutes', '0'), 10);

const fakeDb = {
  async getAll(sql, params) {
    assert.match(sql, /SELECT key, value FROM config/);
    assert.deepEqual(params, ['multi_bid_min_price', 'idle_bid_guard_minutes']);
    return [
      { key: 'multi_bid_min_price', value: '7000' },
      { key: 'idle_bid_guard_minutes', value: '20' }
    ];
  }
};

readConfigMap(fakeDb, ['multi_bid_min_price', 'idle_bid_guard_minutes']).then(result => {
  assert.equal(result.multi_bid_min_price, 7000);
  assert.equal(result.idle_bid_guard_minutes, 20);
  console.log('config service tests passed');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node src\server\services\configService.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: Add config registry**

Create `src/server/services/configRegistry.js`:

```javascript
const CONFIG_DEFINITIONS = Object.freeze({
  multi_bid_start_hours: { type: 'number', defaultValue: 0.5, min: 0.01 },
  multi_bid_interval_minutes: { type: 'integer', defaultValue: 5, min: 1 },
  idle_sync_interval_minutes: { type: 'integer', defaultValue: 5, min: 1 },
  idle_bid_guard_minutes: { type: 'integer', defaultValue: 10, min: 1 },
  multi_bid_min_price: { type: 'integer', defaultValue: 5000, min: 1 },
  transaction_start_hour: { type: 'integer', defaultValue: 1, min: 0, max: 23 },
  confirm_receipt_hour: { type: 'integer', defaultValue: 18, min: 0, max: 23 },
  scan_start_hour: { type: 'integer', defaultValue: 1, min: 0, max: 23 },
  scan_end_hour: { type: 'integer', defaultValue: 20, min: 0, max: 23 },
  scan_every_idle_runs: { type: 'integer', defaultValue: 5, min: 1 },
  payment_job_limit: { type: 'integer', defaultValue: 3, min: 1 },
  payment_job_limit_min: { type: 'integer', defaultValue: 3, min: 1 },
  payment_job_limit_max: { type: 'integer', defaultValue: 3, min: 1 },
  payment_page_stay_seconds: { type: 'integer', defaultValue: 3, min: 1 },
  data_cleanup_enabled: { type: 'boolean', defaultValue: false },
  data_cleanup_hour: { type: 'integer', defaultValue: 3, min: 0, max: 23 },
  data_cleanup_retention_days: { type: 'integer', defaultValue: 30, min: 1 }
});

module.exports = { CONFIG_DEFINITIONS };
```

- [ ] **Step 4: Add config service**

Create `src/server/services/configService.js`:

```javascript
const { CONFIG_DEFINITIONS } = require('./configRegistry');

function normalizeConfigValue(key, value) {
  const definition = CONFIG_DEFINITIONS[key];
  if (!definition) return value;
  if (definition.type === 'boolean') {
    return value === true || value === '1' || value === 1;
  }
  if (definition.type === 'integer' || definition.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) return definition.defaultValue;
    const normalized = definition.type === 'integer' ? Math.floor(number) : number;
    if (definition.min !== undefined && normalized < definition.min) return definition.defaultValue;
    if (definition.max !== undefined && normalized > definition.max) return definition.defaultValue;
    return normalized;
  }
  return value ?? definition.defaultValue;
}

async function readConfigMap(database, keys) {
  const rows = await database.getAll(
    `SELECT key, value FROM config WHERE key IN (${keys.map(() => '?').join(',')})`,
    keys
  );
  const byKey = new Map(rows.map(row => [row.key, row.value]));
  return Object.fromEntries(keys.map(key => {
    const definition = CONFIG_DEFINITIONS[key];
    const raw = byKey.has(key) ? byKey.get(key) : definition?.defaultValue;
    return [key, normalizeConfigValue(key, raw)];
  }));
}

module.exports = {
  CONFIG_DEFINITIONS,
  normalizeConfigValue,
  readConfigMap
};
```

- [ ] **Step 5: Run config service tests**

Run:

```powershell
node src\server\services\configService.test.js
```

Expected: PASS.

- [ ] **Step 6: Run full regression**

Run:

```powershell
npm run regression
```

Expected: PASS.

---

## Task 8: Adopt Config Service Gradually

**Files:**
- Modify: `src/server/routes/plugin.js`
- Modify: `src/server/routes/admin.js`
- Modify: `src/server/services/dataCleanup.js`

- [ ] **Step 1: Replace one config group at a time**

Start with `getMultiBidConfig()` in `src/server/routes/plugin.js`, because it already reads a bounded set of keys. Replace only the config-read block with `readConfigMap()`. Keep the returned object shape exactly:

```javascript
{
  multiBidStartHours,
  multiBidIntervalMinutes,
  idleSyncIntervalMinutes,
  idleBidGuardMinutes,
  multiBidMinPrice,
  transactionStartHour,
  scanStartHour,
  scanEndHour,
  scanEveryIdleRuns
}
```

- [ ] **Step 2: Run plugin tests**

Run:

```powershell
node src\server\routes\plugin.test.js
```

Expected: PASS.

- [ ] **Step 3: Replace admin multi-bid config normalization**

In `src/server/routes/admin.js`, update only the multi-bid config read/write validation to use `normalizeConfigValue()`. Do not rename keys or change defaults.

- [ ] **Step 4: Run admin tests**

Run:

```powershell
node src\server\routes\admin.orders.test.js
```

Expected: PASS.

- [ ] **Step 5: Replace data cleanup config read normalization**

In `src/server/services/dataCleanup.js`, use `normalizeConfigValue()` for:

- `data_cleanup_enabled`
- `data_cleanup_hour`
- `data_cleanup_retention_days`

Keep `getDataCleanupConfig()` return shape unchanged.

- [ ] **Step 6: Run focused tests and regression**

Run:

```powershell
node src\server\services\dataCleanup.test.js
npm run regression
```

Expected: all pass.

---

## Task 9: Split Route Files Only After Rule Parity Is Proven

**Files:**
- Create: `src/server/services/pluginTaskDispatchService.js`
- Create: `src/server/services/idleActionScheduler.js`
- Create: `src/server/services/orderSyncService.js`
- Create: `src/server/services/paymentService.js`
- Create: `src/server/services/receiptService.js`
- Create: `src/server/services/adminOrderService.js`
- Modify: `src/server/routes/plugin.js`
- Modify: `src/server/routes/admin.js`

- [ ] **Step 1: Move only pure exported functions first**

Move functions that already have tests and do not close over router-local state. Keep a compatibility export in the original route file:

```javascript
const { chooseNextPluginTask } = require('../services/pluginTaskDispatchService');
module.exports.chooseNextPluginTask = chooseNextPluginTask;
```

- [ ] **Step 2: Run the exact existing tests after each moved function group**

For dispatch-related functions:

```powershell
node src\server\routes\plugin.test.js
```

For admin order functions:

```powershell
node src\server\routes\admin.orders.test.js
```

Expected: PASS after every small move.

- [ ] **Step 3: Stop before moving route handlers**

Do not move actual `router.get/post/patch` handlers in this task. Moving handlers changes too much context at once. Route handler split should be a separate plan after pure functions and services are stable.

- [ ] **Step 4: Run full regression**

Run:

```powershell
npm run regression
```

Expected: PASS.

---

## Task 10: Frontend Rule Alignment

**Files:**
- Modify: `src/client/src/utils/bidPrice.js`
- Modify: `src/client/src/pages/Submit.jsx`
- Modify: `src/client/src/components/ProductCard.jsx`
- Modify: `src/client/src/pages/ActiveBidding.jsx`
- Modify: `src/client/src/pages/WonItems.jsx`

- [ ] **Step 1: Keep frontend behavior client-local**

Because the browser build is ESM and existing shared server modules use CommonJS, do not import server CommonJS modules into Vite directly in this task. Instead, align frontend utility function names and tests with the same examples used in shared server tests.

- [ ] **Step 2: Move local `Submit.jsx` helper duplication into `utils/bidPrice.js`**

Move these helpers from `Submit.jsx` into `src/client/src/utils/bidPrice.js`:

- `toTaxExcludedYen`
- `shouldSplitDirectBidByYahooLowPriceRule`
- `getMinMultiBidIncrement`
- `getDefaultMultiBidIncrement`

Keep exported names stable and update imports in `Submit.jsx`.

- [ ] **Step 3: Add or update frontend utility tests**

Update `src/client/src/utils/bidPrice.test.mjs` to include the same low-price split examples used in `src/shared/biddingRules.test.js`.

- [ ] **Step 4: Run frontend tests and build**

Run:

```powershell
node src\client\src\utils\bidPrice.test.mjs
Set-Location src\client
npm run build
Set-Location ..\..
npm run regression
```

Expected: all pass.

---

## Task 11: Update Handoff Documentation

**Files:**
- Modify: `agents.md`

- [ ] **Step 1: Add implementation summary**

Append a `2026-06-11 维护性整理进度` section describing:

- Extracted rule modules.
- Config registry status.
- Files intentionally not changed.
- Verification commands.
- Any remaining duplication.

- [ ] **Step 2: Run documentation sanity check**

Run:

```powershell
git diff -- agents.md docs/superpowers/plans/2026-06-11-maintainability-rule-boundaries.md
```

Expected: diff only contains planned documentation and implementation notes.

---

## Final Verification

Run:

```powershell
npm run regression
git status --short
```

Expected:

- Regression suite passes.
- Worktree contains only intended refactor files.
- No SQLite database file changes.
- No changes to plugin execution order, API paths, response fields, status strings, or config key names.

---

## Rollback Strategy

Because this plan is behavior-preserving and does not change data:

1. If any task fails, revert only that task's changed files.
2. Keep earlier completed tasks if their focused tests and full regression passed.
3. Never revert unrelated user changes.
4. Do not touch `data/gdaipai.db`.

---

## Execution Options

Recommended execution mode: implement Tasks 1-4 first, then stop for review. Tasks 5-7 should be a second checkpoint. Tasks 8-9 should only proceed after at least one production-like run confirms the extracted server rules are stable.
