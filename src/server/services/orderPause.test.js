const assert = require('assert/strict');
const Database = require('better-sqlite3');
const {
  setOrderPaused,
  expirePausedOrders,
  checkTransactionStartEligibility
} = require('./orderPause');

function createDatabase() {
  const raw = new Database(':memory:');
  raw.exec(`
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, product_id TEXT, user_id INTEGER);
    CREATE TABLE products (product_id TEXT PRIMARY KEY, product_type TEXT, tax_type TEXT, shipping_fee_text TEXT);
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY, task_id INTEGER, product_id TEXT, order_status TEXT,
      paused_at TEXT, updated_at TEXT, final_price INTEGER, won_at TEXT,
      won_time_text TEXT, bundle_shipping_fee_text TEXT, bundle_group_id TEXT,
      transaction_start_error TEXT
    );
    CREATE TABLE order_status_change_logs (
      id INTEGER PRIMARY KEY, order_id INTEGER, product_id TEXT, old_status TEXT,
      new_status TEXT, source TEXT, metadata TEXT, created_at TEXT
    );
    INSERT INTO tasks VALUES (1, 'n100000001', 7), (2, 's100000002', 7), (3, 'n100000003', 8);
    INSERT INTO products VALUES
      ('n100000001', 'normal', 'tax_zero', NULL),
      ('s100000002', 'store', 'tax_included', NULL),
      ('n100000003', 'normal', 'tax_zero', NULL);
    INSERT INTO orders (id, task_id, product_id, order_status, updated_at) VALUES
      (1, 1, 'n100000001', NULL, '2026-09-27 00:00:00'),
      (2, 2, 's100000002', NULL, '2026-09-27 00:00:00'),
      (3, 3, 'n100000003', NULL, '2026-09-27 00:00:00');
  `);
  return {
    raw,
    async getOne(sql, params = []) { return raw.prepare(sql).get(...params); },
    async getAll(sql, params = []) { return raw.prepare(sql).all(...params); },
    async query(sql, params = []) { return { rowCount: raw.prepare(sql).run(...params).changes }; }
  };
}

async function testPauseResumeAndScope() {
  const database = createDatabase();
  try {
    const paused = await setOrderPaused(database, { orderId: 1, pause: true, source: 'admin_order_pause' });
    assert.equal(paused.orderStatus, 'paused');
    assert.match(paused.pausedAt, /^\d{4}-\d{2}-\d{2} /);
    await assert.rejects(setOrderPaused(database, { orderId: 1, pause: true }), { statusCode: 409 });
    await assert.rejects(setOrderPaused(database, { orderId: 2, pause: true }), { statusCode: 409 });
    await assert.rejects(setOrderPaused(database, { orderId: 1, pause: false, userId: 8 }), { statusCode: 409 });
    const resumed = await setOrderPaused(database, { orderId: 1, pause: false, userId: 7, source: 'user_order_resume' });
    assert.equal(resumed.orderStatus, null);
    assert.equal(resumed.pausedAt, null);
    assert.deepEqual(database.raw.prepare('SELECT old_status, new_status, source FROM order_status_change_logs ORDER BY id').all(), [
      { old_status: null, new_status: 'paused', source: 'admin_order_pause' },
      { old_status: 'paused', new_status: null, source: 'user_order_resume' }
    ]);
  } finally {
    database.raw.close();
  }
}

async function testExpiryBoundaryAndUpdatedAtIndependence() {
  const database = createDatabase();
  try {
    await setOrderPaused(database, { orderId: 1, pause: true });
    await setOrderPaused(database, { orderId: 3, pause: true });
    database.raw.prepare("UPDATE orders SET paused_at = '2026-09-26 12:00:00', updated_at = '2026-09-27 11:59:59' WHERE id = 1").run();
    database.raw.prepare("UPDATE orders SET paused_at = '2026-09-26 12:00:01' WHERE id = 3").run();
    const result = await expirePausedOrders(database, Date.parse('2026-09-27T12:00:00Z'));
    assert.equal(result.expired, 1);
    assert.equal((await database.getOne('SELECT order_status FROM orders WHERE id = 1')).order_status, null);
    assert.equal((await database.getOne('SELECT order_status FROM orders WHERE id = 3')).order_status, 'paused');
    const log = await database.getOne("SELECT source FROM order_status_change_logs WHERE source = 'transaction_start_pause_expired'");
    assert.equal(log.source, 'transaction_start_pause_expired');
  } finally {
    database.raw.close();
  }
}

async function testTransactionStartEligibilityChecksBundleMembers() {
  const database = createDatabase();
  try {
    assert.deepEqual(await checkTransactionStartEligibility(database, { orderId: 1 }), { eligible: true });
    assert.deepEqual(await checkTransactionStartEligibility(database, { orderId: 2 }), { eligible: false, reason: 'order status changed' });
    await setOrderPaused(database, { orderId: 3, pause: true });
    assert.deepEqual(
      await checkTransactionStartEligibility(database, { orderId: 1, productIds: ['n100000001', 'n100000003'] }),
      { eligible: false, reason: 'bundle contains paused order' }
    );
    assert.deepEqual(await checkTransactionStartEligibility(database, { orderId: 3 }), { eligible: false, reason: 'order status changed' });
  } finally {
    database.raw.close();
  }
}

Promise.resolve()
  .then(testPauseResumeAndScope)
  .then(testExpiryBoundaryAndUpdatedAtIndependence)
  .then(testTransactionStartEligibilityChecksBundleMembers)
  .catch(error => { console.error(error); process.exitCode = 1; });
