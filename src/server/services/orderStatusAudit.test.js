const assert = require('assert/strict');
const {
  getOrderStatusAuditRows,
  writeOrderStatusAuditLogs
} = require('./orderStatusAudit');

async function testGetOrderStatusAuditRowsDedupesIds() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ sql, params });
      return [];
    }
  };

  await getOrderStatusAuditRows(fakeDb, [3, '3', 4, 0, 'x']);

  assert.deepEqual(calls[0].params, [3, 4]);
  assert.match(calls[0].sql, /INNER JOIN tasks/);
  assert.match(calls[0].sql, /shipping_fee_text/);
}

async function testWriteOrderStatusAuditLogsRecordsOnlyChangesWithSnapshot() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await writeOrderStatusAuditLogs(fakeDb, [
    {
      order_id: 1,
      product_id: 'a1',
      old_status: null,
      product_type: 'normal',
      shipping_fee_text: 'bidder pays',
      final_price: 28380,
      won_time_text: '6/3 21:05',
      old_updated_at: '2026-06-03 21:05:56'
    },
    { order_id: 2, product_id: 'a2', old_status: 'pending_payment' }
  ], {
    status: 'pending_payment',
    source: 'transaction_start_status',
    metadata: { reason: 'transaction status payload' }
  });

  assert.equal(result.inserted, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO order_status_change_logs/);
  assert.deepEqual(calls[0].params.slice(0, 5), [
    1,
    'a1',
    null,
    'pending_payment',
    'transaction_start_status'
  ]);
  const metadata = JSON.parse(calls[0].params[5]);
  assert.equal(metadata.reason, 'transaction status payload');
  assert.equal(metadata.auditSnapshot.productType, 'normal');
  assert.equal(metadata.auditSnapshot.shippingFeeText, 'bidder pays');
  assert.equal(metadata.auditSnapshot.finalPrice, 28380);
  assert.equal(metadata.auditSnapshot.wonTimeText, '6/3 21:05');
  assert.equal(metadata.auditSnapshot.oldUpdatedAt, '2026-06-03 21:05:56');
}

async function testWriteOrderStatusAuditLogsSupportsPerOrderStatus() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  await writeOrderStatusAuditLogs(fakeDb, [
    { order_id: 10, product_id: 'main', old_status: 'pending_bundle' },
    { order_id: 11, product_id: 'child', old_status: 'pending_bundle' }
  ], {
    statusesByOrderId: {
      10: 'pending_payment',
      11: 'bundle_completed'
    },
    source: 'scan_status'
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].params[3], 'pending_payment');
  assert.equal(calls[1].params[3], 'bundle_completed');
}

Promise.all([
  testGetOrderStatusAuditRowsDedupesIds(),
  testWriteOrderStatusAuditLogsRecordsOnlyChangesWithSnapshot(),
  testWriteOrderStatusAuditLogsSupportsPerOrderStatus()
]).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
