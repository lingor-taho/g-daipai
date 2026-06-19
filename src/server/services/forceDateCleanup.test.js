const assert = require('assert/strict');

const {
  buildWonDateCleanupCutoff,
  previewWonDateCleanup,
  runWonDateCleanup
} = require('./forceDateCleanup');

function makeFakeDb({ targetRows = [], taskRows = [], orderRows = [], countMap = {} } = {}) {
  const calls = [];
  return {
    calls,
    async getAll(sql, params) {
      calls.push({ type: 'getAll', sql, params });
      if (/FROM orders o\s+LEFT JOIN tasks t/.test(sql)) return targetRows;
      if (/SELECT id FROM tasks/.test(sql)) return taskRows;
      if (/SELECT id FROM orders/.test(sql)) return orderRows;
      return [];
    },
    async getOne(sql, params) {
      calls.push({ type: 'getOne', sql, params });
      const key = Object.keys(countMap).find(pattern => new RegExp(pattern).test(sql));
      return { count: key ? countMap[key] : 0 };
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      const key = Object.keys(countMap).find(pattern => new RegExp(pattern).test(sql));
      return { rowCount: key ? countMap[key] : 0 };
    }
  };
}

function testBuildWonDateCleanupCutoffIncludesSelectedDate() {
  assert.deepEqual(buildWonDateCleanupCutoff('2026-06-08'), {
    cutoffDate: '2026-06-08',
    cutoffExclusive: '2026-06-09 00:00:00'
  });
  assert.throws(() => buildWonDateCleanupCutoff('2026-6-8'), /valid cleanup date/);
}

async function testPreviewWonDateCleanupUsesWonAtAndDoesNotDelete() {
  const db = makeFakeDb({
    targetRows: [
      { product_id: 'a123456789', task_id: 11 },
      { product_id: 'b123456789', task_id: 21 }
    ],
    taskRows: [{ id: 11 }, { id: 12 }, { id: 21 }],
    orderRows: [{ id: 101 }, { id: 102 }],
    countMap: {
      'FROM bid_logs': 3,
      'FROM order_status_change_logs': 2,
      'FROM bidding_items': 1,
      'FROM tasks': 3,
      'FROM orders': 2,
      'FROM products': 2
    }
  });

  const result = await previewWonDateCleanup(db, '2026-06-08');

  assert.equal(result.dryRun, true);
  assert.equal(result.cutoffDate, '2026-06-08');
  assert.equal(result.cutoffExclusive, '2026-06-09 00:00:00');
  assert.deepEqual(result.productIds, ['a123456789', 'b123456789']);
  assert.deepEqual(result.taskIds, [11, 12, 21]);
  assert.deepEqual(result.orderIds, [101, 102]);
  assert.equal(result.totalCount, 13);
  assert.match(db.calls[0].sql, /datetime\(o\.won_at\) < datetime\(\?\)/);
  assert.deepEqual(db.calls[0].params, ['2026-06-09 00:00:00']);
  assert.equal(db.calls.some(call => call.type === 'query' && /DELETE FROM/.test(call.sql)), false);
}

async function testRunWonDateCleanupDeletesAssociationsBeforeProducts() {
  const db = makeFakeDb({
    targetRows: [{ product_id: 'a123456789', task_id: 11 }],
    orderRows: [{ id: 101 }],
    countMap: {
      'FROM order_status_change_logs': 2,
      'FROM bid_logs': 3,
      'FROM orders': 1,
      'FROM bidding_items': 1,
      'FROM tasks': 1,
      'FROM products': 1,
      'DELETE FROM order_status_change_logs': 2,
      'DELETE FROM bid_logs': 3,
      'DELETE FROM orders': 1,
      'DELETE FROM bidding_items': 1,
      'DELETE FROM tasks': 1,
      'DELETE FROM products': 1
    }
  });

  const result = await runWonDateCleanup(db, '2026-06-08');
  const deleteSql = db.calls
    .filter(call => call.type === 'query' && /DELETE FROM/.test(call.sql))
    .map(call => call.sql);

  assert.equal(result.dryRun, false);
  assert.equal(result.totalCount, 9);
  assert.match(deleteSql[0], /DELETE FROM order_status_change_logs/);
  assert.match(deleteSql[1], /DELETE FROM bid_logs/);
  assert.match(deleteSql[2], /DELETE FROM orders/);
  assert.match(deleteSql[3], /DELETE FROM bidding_items/);
  assert.match(deleteSql[4], /DELETE FROM tasks/);
  assert.match(deleteSql[5], /DELETE FROM products/);
}

testBuildWonDateCleanupCutoffIncludesSelectedDate();
Promise.all([
  testPreviewWonDateCleanupUsesWonAtAndDoesNotDelete(),
  testRunWonDateCleanupDeletesAssociationsBeforeProducts()
]).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
