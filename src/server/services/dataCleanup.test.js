const assert = require('assert/strict');
const {
  buildDataCleanupConfig,
  deleteStaleTaskData,
  getCleanupCutoffIso,
  shouldRunAutoCleanup
} = require('./dataCleanup');

function testBuildDataCleanupConfigUsesDefaults() {
  const config = buildDataCleanupConfig({});

  assert.deepEqual(config, {
    enabled: false,
    cleanupHour: 3,
    retentionDays: 30
  });
}

function testBuildDataCleanupConfigNormalizesValues() {
  const config = buildDataCleanupConfig({
    data_cleanup_enabled: '1',
    data_cleanup_hour: '4',
    data_cleanup_retention_days: '45'
  });

  assert.deepEqual(config, {
    enabled: true,
    cleanupHour: 4,
    retentionDays: 45
  });
}

function testCleanupCutoffUsesRetentionDays() {
  const nowMs = Date.parse('2026-05-25T03:10:00.000Z');

  assert.equal(getCleanupCutoffIso(30, nowMs), '2026-04-25T03:10:00.000Z');
}

async function testShouldRunAutoCleanupRequiresEnabledAndHourAndNoSameDayLog() {
  const nowMs = new Date(2026, 4, 25, 3, 10, 0).getTime();
  const fakeDb = {
    async getOne() {
      return null;
    }
  };

  assert.equal(await shouldRunAutoCleanup(fakeDb, { enabled: false, cleanupHour: 3 }, nowMs), false);
  assert.equal(await shouldRunAutoCleanup(fakeDb, { enabled: true, cleanupHour: 4 }, nowMs), false);
  assert.equal(await shouldRunAutoCleanup(fakeDb, { enabled: true, cleanupHour: 3 }, nowMs), true);
}

async function testShouldRunAutoCleanupSkipsSameDayAutoLog() {
  const nowMs = new Date(2026, 4, 25, 3, 10, 0).getTime();
  const fakeDb = {
    async getOne(sql, params) {
      assert.match(sql, /data_cleanup_logs/);
      assert.deepEqual(params, ['auto', '2026-05-25']);
      return { id: 1 };
    }
  };

  assert.equal(await shouldRunAutoCleanup(fakeDb, { enabled: true, cleanupHour: 3 }, nowMs), false);
}

async function testDeleteStaleTaskDataDeletesAssociationsAndLogs() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ type: 'getAll', sql, params });
      return [
        { id: 11, product_id: 'a123456789' },
        { id: 12, product_id: 'b123456789' }
      ];
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: /DELETE FROM tasks/.test(sql) ? 2 : 1 };
    }
  };

  const result = await deleteStaleTaskData(fakeDb, {
    retentionDays: 30,
    runType: 'manual',
    nowMs: Date.parse('2026-05-25T03:10:00.000Z')
  });

  assert.equal(result.taskCount, 2);
  assert.equal(result.bidLogCount, 1);
  assert.equal(result.orderCount, 1);
  assert.equal(result.biddingItemCount, 1);
  assert.match(calls[0].sql, /status IN \('failed', 'cancelled', 'bidding'\)/);
  assert.match(calls[1].sql, /DELETE FROM bid_logs/);
  assert.match(calls[2].sql, /DELETE FROM orders/);
  assert.match(calls[3].sql, /DELETE FROM bidding_items/);
  assert.match(calls[4].sql, /DELETE FROM tasks/);
  assert.match(calls[5].sql, /INSERT INTO data_cleanup_logs/);
  assert.equal(calls[5].params[0], 'manual');
  assert.equal(calls[5].params[2], 30);
  assert.equal(calls[5].params[4], 2);
}

testBuildDataCleanupConfigUsesDefaults();
testBuildDataCleanupConfigNormalizesValues();
testCleanupCutoffUsesRetentionDays();
Promise.all([
  testShouldRunAutoCleanupRequiresEnabledAndHourAndNoSameDayLog(),
  testShouldRunAutoCleanupSkipsSameDayAutoLog(),
  testDeleteStaleTaskDataDeletesAssociationsAndLogs()
]).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
