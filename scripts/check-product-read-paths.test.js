const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { collectReadPathViolations } = require('./check-product-read-paths');

function withTempFile(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-read-path-'));
  const file = path.join(dir, 'sample.js');
  fs.writeFileSync(file, content, 'utf8');
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testDetectsDirectTaskSnapshotRead() {
  withTempFile(
    "const sql = `SELECT t.shipping_fee_text AS shipping_fee_text FROM tasks t`;\n",
    file => {
      const violations = collectReadPathViolations([file]);
      assert.equal(violations.length, 1);
      assert.equal(violations[0].field, 'shipping_fee_text');
    }
  );
}

function testDetectsProductsFallbackRead() {
  withTempFile(
    "const sql = `SELECT COALESCE(p.shipping_fee_text, t.shipping_fee_text) AS shipping_fee_text FROM tasks t LEFT JOIN products p ON p.product_id = t.product_id`;\n",
    file => {
      const violations = collectReadPathViolations([file]);
      assert.equal(violations.length, 1);
      assert.equal(violations[0].field, 'shipping_fee_text');
    }
  );
}

function testDetectsTaskSnapshotWrites() {
  withTempFile(
    "const sql = `UPDATE tasks SET shipping_fee_text = ? WHERE product_id = ?`;\n",
    file => {
      const violations = collectReadPathViolations([file]);
      assert.equal(violations.length, 1);
      assert.equal(violations[0].field, 'shipping_fee_text');
    }
  );
}

function testDetectsDebugComparisonTaskAlias() {
  withTempFile(
    "const sql = `SELECT t.shipping_fee_text AS task_shipping_fee_text, p.shipping_fee_text AS product_shipping_fee_text FROM tasks t LEFT JOIN products p ON p.product_id = t.product_id`;\n",
    file => {
      const violations = collectReadPathViolations([file]);
      assert.equal(violations.length, 1);
      assert.equal(violations[0].field, 'shipping_fee_text');
    }
  );
}

function testDetectsBuyoutTaskBidAmountDisplay() {
  withTempFile(
    "const sql = `CASE WHEN COALESCE(t.bid_mode, 'bid') = 'buyout' THEN COALESCE(t.user_max_price, t.buyout_price, t.max_price) ELSE t.max_price END AS max_price`;\n",
    file => {
      const violations = collectReadPathViolations([file]);
      assert.equal(violations.length, 1);
      assert.equal(violations[0].field, 'buyout_price');
    }
  );
}

testDetectsDirectTaskSnapshotRead();
testDetectsProductsFallbackRead();
testDetectsTaskSnapshotWrites();
testDetectsDebugComparisonTaskAlias();
testDetectsBuyoutTaskBidAmountDisplay();

console.log('product read-path closure tests passed');
