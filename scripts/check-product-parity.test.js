const assert = require('assert');
const Database = require('better-sqlite3');
const { collectProductParity } = require('./check-product-parity');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE products (
      product_id VARCHAR(32) PRIMARY KEY,
      shipping_fee_text VARCHAR(64),
      product_type VARCHAR(32)
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id VARCHAR(32),
      shipping_fee_text VARCHAR(64),
      product_type VARCHAR(32)
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      product_id VARCHAR(32)
    );
  `);
  return db;
}

function testCollectProductParityCountsOnlyReadinessGaps() {
  const db = createDb();
  try {
    db.prepare("INSERT INTO products (product_id, shipping_fee_text, product_type) VALUES (?, ?, ?)").run('p1', '500円', 'normal');
    db.prepare("INSERT INTO products (product_id, shipping_fee_text, product_type) VALUES (?, ?, ?)").run('p3', '無料', 'store');
    db.prepare("INSERT INTO products (product_id, shipping_fee_text, product_type) VALUES (?, ?, ?)").run('p4', '着払い', 'normal');

    db.prepare("INSERT INTO tasks (id, product_id, shipping_fee_text, product_type) VALUES (?, ?, ?, ?)").run(1, 'p1', '500円', 'normal');
    db.prepare("INSERT INTO tasks (id, product_id, shipping_fee_text, product_type) VALUES (?, ?, ?, ?)").run(2, 'p2', '700円', 'normal');
    db.prepare("INSERT INTO tasks (id, product_id, shipping_fee_text, product_type) VALUES (?, ?, ?, ?)").run(3, 'p3', '無料', 'normal');
    db.prepare("INSERT INTO tasks (id, product_id, shipping_fee_text, product_type) VALUES (?, ?, ?, ?)").run(4, 'p4', '着払い', 'normal');

    db.prepare("INSERT INTO orders (id, task_id, product_id) VALUES (?, ?, ?)").run(10, 1, 'p1');
    db.prepare("INSERT INTO orders (id, task_id, product_id) VALUES (?, ?, ?)").run(11, 1, null);
    db.prepare("INSERT INTO orders (id, task_id, product_id) VALUES (?, ?, ?)").run(12, 1, 'different');

    assert.deepEqual(collectProductParity(db), {
      tasksWithoutProductRow: 1,
      ordersWithoutProductId: 1,
      ordersProductIdMismatch: 1,
      productsLatestTaskSnapshotMismatch: 1
    });
  } finally {
    db.close();
  }
}

testCollectProductParityCountsOnlyReadinessGaps();
console.log('product parity check tests passed');
