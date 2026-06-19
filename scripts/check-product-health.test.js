const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const {
  collectFallbackUsage,
  buildHealthStatus,
  appendHealthHistory
} = require('./check-product-health');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE products (
      product_id VARCHAR(32) PRIMARY KEY,
      product_url TEXT,
      product_title VARCHAR(512),
      product_image_url TEXT,
      current_price INTEGER,
      buyout_price INTEGER,
      bid_count INTEGER,
      tax_type VARCHAR(32),
      product_type VARCHAR(32),
      shipping_fee_text VARCHAR(64),
      end_time DATETIME
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id VARCHAR(32),
      product_url TEXT,
      product_title VARCHAR(512),
      product_image_url TEXT,
      current_price INTEGER,
      buyout_price INTEGER,
      bid_count INTEGER,
      tax_type VARCHAR(32),
      product_type VARCHAR(32),
      shipping_fee_text VARCHAR(64),
      end_time DATETIME
    );
  `);
  return db;
}

function testCollectFallbackUsageCountsOnlyProductsMissingTasksPresent() {
  const db = createDb();
  try {
    db.prepare("INSERT INTO products (product_id, product_title, shipping_fee_text) VALUES (?, ?, ?)").run('p1', 'title', null);
    db.prepare("INSERT INTO tasks (product_id, product_title, shipping_fee_text) VALUES (?, ?, ?)").run('p1', 'title', '500');
    db.prepare("INSERT INTO products (product_id, product_title, shipping_fee_text) VALUES (?, ?, ?)").run('p2', null, '700');
    db.prepare("INSERT INTO tasks (product_id, product_title, shipping_fee_text) VALUES (?, ?, ?)").run('p2', 'fallback-title', '700');

    const usage = collectFallbackUsage(db);

    assert.equal(usage.product_title, 1);
    assert.equal(usage.shipping_fee_text, 1);
    assert.equal(usage.product_url, 0);
  } finally {
    db.close();
  }
}

function testBuildHealthStatusSeparatesFailAndWarn() {
  const ok = buildHealthStatus({
    parity: {
      tasksWithoutProductRow: 0,
      ordersWithoutProductId: 0,
      ordersProductIdMismatch: 0,
      productsLatestTaskSnapshotMismatch: 0
    },
    readPathViolationCount: 0,
    fallbackUsage: { product_title: 0 }
  });
  assert.equal(ok.status, 'OK');

  const warn = buildHealthStatus({
    parity: {
      tasksWithoutProductRow: 0,
      ordersWithoutProductId: 0,
      ordersProductIdMismatch: 0,
      productsLatestTaskSnapshotMismatch: 0
    },
    readPathViolationCount: 0,
    fallbackUsage: { product_title: 2 }
  });
  assert.equal(warn.status, 'WARN');

  const fail = buildHealthStatus({
    parity: {
      tasksWithoutProductRow: 1,
      ordersWithoutProductId: 0,
      ordersProductIdMismatch: 0,
      productsLatestTaskSnapshotMismatch: 0
    },
    readPathViolationCount: 0,
    fallbackUsage: { product_title: 0 }
  });
  assert.equal(fail.status, 'FAIL');
}

function testAppendHealthHistoryKeepsJsonLines() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-health-'));
  const file = path.join(dir, 'history.jsonl');
  try {
    appendHealthHistory(file, { checkedAt: '2026-06-19T00:00:00.000Z', status: 'OK' });
    appendHealthHistory(file, { checkedAt: '2026-06-20T00:00:00.000Z', status: 'WARN' });
    const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].status, 'OK');
    assert.equal(lines[1].status, 'WARN');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

testCollectFallbackUsageCountsOnlyProductsMissingTasksPresent();
testBuildHealthStatusSeparatesFailAndWarn();
testAppendHealthHistoryKeepsJsonLines();

console.log('product health check tests passed');
