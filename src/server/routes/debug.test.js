const assert = require('assert/strict');
const {
  isValidDebugToken,
  buildProductDebugReport
} = require('./debug');

function testDebugTokenRequiresExactConfiguredValue() {
  assert.equal(isValidDebugToken('secret-token', 'secret-token'), true);
  assert.equal(isValidDebugToken('wrong-token', 'secret-token'), false);
  assert.equal(isValidDebugToken('', 'secret-token'), false);
  assert.equal(isValidDebugToken('secret-token', ''), false);
  assert.equal(isValidDebugToken('secret-token-extra', 'secret-token'), false);
}

async function testBuildProductDebugReportCollectsRelatedRows() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ type: 'getAll', sql, params });
      if (/FROM tasks t/.test(sql) && /t\.error_msg/.test(sql)) {
        return [
          { id: 9, status: 'failed', error_msg: 'bid button not found' },
          { id: 8, status: 'bidding', error_msg: null }
        ];
      }
      if (/FROM bid_logs bl/.test(sql)) {
        return [{ id: 7, task_id: 9, error_msg: 'bid button not found' }];
      }
      if (/FROM orders o/.test(sql)) {
        return [{ id: 6, task_id: 9, order_status: 'pending_payment' }];
      }
      return [];
    },
    async getOne(sql, params) {
      calls.push({ type: 'getOne', sql, params });
      if (/FROM products/.test(sql)) return { product_id: 'u1051658399', current_price: 2857 };
      return null;
    }
  };

  const report = await buildProductDebugReport('u1051658399', fakeDb);

  assert.equal(report.productId, 'u1051658399');
  assert.equal(report.summary.taskCount, 2);
  assert.equal(report.summary.failedTaskCount, 1);
  assert.equal(report.summary.latestError, 'bid button not found');
  assert.equal(report.summary.bidLogCount, 1);
  assert.equal(report.summary.orderCount, 1);
  assert.equal(report.productSnapshot.current_price, 2857);
  assert.equal(calls.some(call => /FROM plugin_diagnostics/.test(call.sql)), true);
  assert.equal(calls.some(call => /FROM bidding_items/.test(call.sql)), true);
}

testDebugTokenRequiresExactConfiguredValue();

testBuildProductDebugReportCollectsRelatedRows().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
