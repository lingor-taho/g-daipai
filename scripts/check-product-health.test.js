const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const {
  collectProductCoreGaps,
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
      product_image_url TEXT
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id VARCHAR(32),
      status VARCHAR(32)
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id VARCHAR(32)
    );
  `);
  return db;
}

function testCollectProductCoreGapsDoesNotRequireTaskSnapshotColumns() {
  const db = createDb();
  try {
    db.prepare('INSERT INTO products (product_id, product_url, product_title, product_image_url) VALUES (?, ?, ?, ?)').run('active-missing', 'url', null, 'image');
    db.prepare('INSERT INTO products (product_id, product_url, product_title, product_image_url) VALUES (?, ?, ?, ?)').run('success-missing', 'url', 'title', null);
    db.prepare('INSERT INTO products (product_id, product_url, product_title, product_image_url) VALUES (?, ?, ?, ?)').run('order-missing', null, 'title', 'image');
    db.prepare('INSERT INTO products (product_id, product_url, product_title, product_image_url) VALUES (?, ?, ?, ?)').run('complete', 'url', 'title', 'image');

    db.prepare('INSERT INTO tasks (product_id, status) VALUES (?, ?)').run('active-missing', 'bidding');
    db.prepare('INSERT INTO tasks (product_id, status) VALUES (?, ?)').run('success-missing', 'success');
    db.prepare('INSERT INTO tasks (product_id, status) VALUES (?, ?)').run('complete', 'pending');
    db.prepare('INSERT INTO orders (product_id) VALUES (?)').run('order-missing');

    assert.deepEqual(collectProductCoreGaps(db), {
      activeProductsMissingCore: 1,
      successProductsMissingCore: 1,
      orderProductsMissingCore: 1
    });
  } finally {
    db.close();
  }
}

function testBuildHealthStatusSeparatesFailAndWarn() {
  const ok = buildHealthStatus({
    parity: {
      tasksWithoutProductRow: 0,
      ordersWithoutProductId: 0,
      ordersProductIdMismatch: 0
    },
    readPathViolationCount: 0,
    productCoreGaps: { activeProductsMissingCore: 0 }
  });
  assert.equal(ok.status, 'OK');

  const warn = buildHealthStatus({
    parity: {
      tasksWithoutProductRow: 0,
      ordersWithoutProductId: 0,
      ordersProductIdMismatch: 0
    },
    readPathViolationCount: 0,
    productCoreGaps: { activeProductsMissingCore: 2 }
  });
  assert.equal(warn.status, 'WARN');

  const fail = buildHealthStatus({
    parity: {
      tasksWithoutProductRow: 1,
      ordersWithoutProductId: 0,
      ordersProductIdMismatch: 0
    },
    readPathViolationCount: 0,
    productCoreGaps: { activeProductsMissingCore: 0 }
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

testCollectProductCoreGapsDoesNotRequireTaskSnapshotColumns();
testBuildHealthStatusSeparatesFailAndWarn();
testAppendHealthHistoryKeepsJsonLines();

console.log('product health check tests passed');
