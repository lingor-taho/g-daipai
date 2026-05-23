const assert = require('assert/strict');
const {
  getStrategyLeadMs,
  isTaskReadyForDispatch,
  chooseNextPluginTask,
  isTaskNeedingEndTimeRefresh,
  expireOverduePendingTasks,
  failPricedOutPendingTasks,
  resetStaleProcessingTasks,
  sweepPendingTasks,
  getMultiBidStartMs,
  getMultiBidIntervalMs,
  isMultiBidTask,
  syncBiddingItems,
  resolveOrderFinalPrice
} = require('./plugin');

const now = Date.parse('2026-05-13T12:00:00.000Z');

function minutesFromNow(minutes) {
  return new Date(now + minutes * 60 * 1000).toISOString();
}

function sqliteTimeFromNow(minutes) {
  return new Date(now + minutes * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

function testDirectTaskIsReadyImmediately() {
  assert.equal(isTaskReadyForDispatch({ strategy: 'direct', end_time: minutesFromNow(60) }, now), true);
  assert.equal(isTaskReadyForDispatch({ strategy: 'direct', end_time: minutesFromNow(-1) }, now), false);
}

function testTimedTaskWaitsUntilLeadWindow() {
  assert.equal(getStrategyLeadMs({ strategy: '5min' }), 5 * 60 * 1000);
  assert.equal(isTaskReadyForDispatch({ strategy: '5min', end_time: minutesFromNow(6) }, now), false);
  assert.equal(isTaskReadyForDispatch({ strategy: '5min', end_time: minutesFromNow(5) }, now), true);
  assert.equal(isTaskReadyForDispatch({ strategy: '5min', end_time: null }, now), true);
  assert.equal(isTaskNeedingEndTimeRefresh({ strategy: '5min', end_time: null }), true);
}

function testTimedTaskUsesExplicitMinuteColumns() {
  assert.equal(
    getStrategyLeadMs({ strategy: 'custom', start_minutes_before: 2, start_seconds_before: 30 }),
    150000
  );
}

function testMultiBidUsesGlobalConfigStartWindow() {
  assert.equal(isMultiBidTask({ strategy: 'multi_bid' }), true);
  assert.equal(getMultiBidStartMs({ multiBidStartHours: 0.5 }), 30 * 60 * 1000);
  assert.equal(isTaskReadyForDispatch({
    strategy: 'multi_bid',
    status: 'pending',
    end_time: minutesFromNow(31)
  }, now, { multiBidStartHours: 0.5, multiBidIntervalMinutes: 5 }), false);
  assert.equal(isTaskReadyForDispatch({
    strategy: 'multi_bid',
    status: 'pending',
    end_time: minutesFromNow(30)
  }, now, { multiBidStartHours: 0.5, multiBidIntervalMinutes: 5 }), true);
}

function testMultiBidBiddingTaskRepeatsOnlyAfterInterval() {
  assert.equal(getMultiBidIntervalMs({ multiBidIntervalMinutes: 5 }), 5 * 60 * 1000);
  assert.equal(isTaskReadyForDispatch({
    strategy: 'multi_bid',
    status: 'bidding',
    end_time: minutesFromNow(20),
    last_bid_at: new Date(now - 4 * 60 * 1000).toISOString()
  }, now, { multiBidStartHours: 0.5, multiBidIntervalMinutes: 5 }), false);
  assert.equal(isTaskReadyForDispatch({
    strategy: 'multi_bid',
    status: 'bidding',
    end_time: minutesFromNow(20),
    last_bid_at: new Date(now - 5 * 60 * 1000).toISOString()
  }, now, { multiBidStartHours: 0.5, multiBidIntervalMinutes: 5 }), true);
}

function testMultiBidBiddingTaskWithoutEndTimeStillWaitsForInterval() {
  assert.equal(isTaskReadyForDispatch({
    strategy: 'multi_bid',
    status: 'bidding',
    end_time: null,
    last_bid_at: new Date(now - 4 * 60 * 1000).toISOString()
  }, now, { multiBidStartHours: 0.5, multiBidIntervalMinutes: 5 }), false);
  assert.equal(isTaskReadyForDispatch({
    strategy: 'multi_bid',
    status: 'bidding',
    end_time: null,
    last_bid_at: new Date(now - 5 * 60 * 1000).toISOString()
  }, now, { multiBidStartHours: 0.5, multiBidIntervalMinutes: 5 }), true);
}

function testMultiBidPendingTaskWithRecentTouchStillWaitsForInterval() {
  assert.equal(isTaskReadyForDispatch({
    strategy: 'multi_bid',
    status: 'pending',
    end_time: minutesFromNow(20),
    last_bid_at: new Date(now - 4 * 60 * 1000).toISOString()
  }, now, { multiBidStartHours: 0.5, multiBidIntervalMinutes: 5 }), false);
}

function testMultiBidIntervalParsesSqliteUtcTimestamp() {
  assert.equal(isTaskReadyForDispatch({
    strategy: 'multi_bid',
    status: 'bidding',
    end_time: minutesFromNow(20),
    last_bid_at: sqliteTimeFromNow(-4)
  }, now, { multiBidStartHours: 0.5, multiBidIntervalMinutes: 5 }), false);
}

function testChooseNextTaskSkipsFutureTimedTask() {
  const task = chooseNextPluginTask([
    { id: 1, strategy: '10min', end_time: minutesFromNow(30), created_at: '2026-05-13T10:00:00Z' },
    { id: 2, strategy: 'direct', end_time: minutesFromNow(30), created_at: '2026-05-13T10:01:00Z' }
  ], now);
  assert.equal(task.id, 2);
}

function testChooseRefreshTaskWhenNoExecutableTaskExists() {
  const task = chooseNextPluginTask([
    { id: 1, strategy: '10min', end_time: minutesFromNow(30), created_at: '2026-05-13T10:00:00Z' },
    { id: 2, strategy: '5min', end_time: null, created_at: '2026-05-13T10:01:00Z' }
  ], now);
  assert.equal(task.id, 2);
}

async function testExpireOverduePendingTasksMarksOnlyExpiredPendingTasksFailed() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 2 };
    }
  };

  const count = await expireOverduePendingTasks(fakeDb, now);

  assert.equal(count, 2);
  assert.match(calls[0].sql, /status = 'pending'/);
  assert.match(calls[0].sql, /datetime\(end_time\) <= datetime\(\?\)/);
  assert.equal(calls[0].params[0], 'Auction ended before plugin execution');
  assert.equal(calls[0].params[1], new Date(now).toISOString());
}

async function testFailPricedOutPendingTasksMarksCurrentPriceAboveMaxFailed() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const count = await failPricedOutPendingTasks(fakeDb);

  assert.equal(count, 1);
  assert.match(calls[0].sql, /status = 'pending'/);
  assert.match(calls[0].sql, /current_price > max_price/);
  assert.equal(calls[0].params[0], 'Current price is above max price before execution');
}

async function testResetStaleProcessingTasksReturnsOldProcessingToPending() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 3 };
    }
  };

  const count = await resetStaleProcessingTasks(fakeDb, now);

  assert.equal(count, 3);
  assert.match(calls[0].sql, /status = 'pending'/);
  assert.match(calls[0].sql, /WHERE status = 'processing'/);
  assert.match(calls[0].sql, /datetime\(updated_at\) <= datetime\(\?\)/);
  assert.equal(calls[0].params[0], new Date(now - 60 * 1000).toISOString());
}

async function testSweepPendingTasksIncludesProcessingResets() {
  const fakeDb = {
    calls: 0,
    async query() {
      this.calls += 1;
      return { rowCount: this.calls };
    }
  };

  const result = await sweepPendingTasks(fakeDb, now);

  assert.deepEqual(result, { overdue: 1, pricedOut: 2, processingReset: 3, total: 6 });
}

async function testSyncBiddingItemsMarksHighestAndOutbidTasks() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await syncBiddingItems([
    { productId: 'a123456789', title: 'A', price: '1,200', url: 'https://auctions.yahoo.co.jp/jp/auction/a123456789', status: 'highest' },
    { productId: 'b123456789', title: 'B', price: '1,500', url: 'https://auctions.yahoo.co.jp/jp/auction/b123456789', status: 'outbid' }
  ], fakeDb);

  assert.deepEqual(result, { highest: 1, outbid: 1, total: 2 });
  assert.match(calls[0].sql, /UPDATE bidding_items/);
  assert.match(calls[1].sql, /INSERT INTO bidding_items/);
  assert.equal(calls[1].params[0], 'a123456789');
  assert.equal(calls[1].params[5], 'highest');
  assert.match(calls[2].sql, /is_highest_bidder = 1/);
  assert.match(calls[2].sql, /status = 'bidding'/);
  assert.equal(calls[2].params.at(-1), 'a123456789');
  assert.match(calls[4].sql, /is_highest_bidder = 0/);
  assert.equal(calls[4].params.at(-1), 'b123456789');
}

function testResolveOrderFinalPriceIgnoresLowerParsedNoise() {
  assert.equal(resolveOrderFinalPrice({ current_price: 2530, max_price: 2450 }, '10'), 2530);
}

function testResolveOrderFinalPriceUsesParsedWhenHigherThanKnownTaskPrice() {
  assert.equal(resolveOrderFinalPrice({ current_price: 2300, max_price: 2450, user_max_price: 2700 }, '2,530'), 2530);
}

function testResolveOrderFinalPriceRejectsParsedPriceAboveUserMaxAsNoise() {
  assert.equal(resolveOrderFinalPrice({ current_price: 2530, max_price: 2450, user_max_price: 2700 }, '21,780'), 2530);
}

testDirectTaskIsReadyImmediately();
testTimedTaskWaitsUntilLeadWindow();
testTimedTaskUsesExplicitMinuteColumns();
testMultiBidUsesGlobalConfigStartWindow();
testMultiBidBiddingTaskRepeatsOnlyAfterInterval();
testMultiBidBiddingTaskWithoutEndTimeStillWaitsForInterval();
testMultiBidPendingTaskWithRecentTouchStillWaitsForInterval();
testMultiBidIntervalParsesSqliteUtcTimestamp();
testChooseNextTaskSkipsFutureTimedTask();
testChooseRefreshTaskWhenNoExecutableTaskExists();
testExpireOverduePendingTasksMarksOnlyExpiredPendingTasksFailed();
testFailPricedOutPendingTasksMarksCurrentPriceAboveMaxFailed();
testResetStaleProcessingTasksReturnsOldProcessingToPending();
testSweepPendingTasksIncludesProcessingResets();
testSyncBiddingItemsMarksHighestAndOutbidTasks();
testResolveOrderFinalPriceIgnoresLowerParsedNoise();
testResolveOrderFinalPriceUsesParsedWhenHigherThanKnownTaskPrice();
testResolveOrderFinalPriceRejectsParsedPriceAboveUserMaxAsNoise();
