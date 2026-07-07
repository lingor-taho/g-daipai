const assert = require('assert/strict');
const {
  getStrategyLeadMs,
  isTaskReadyForDispatch,
  chooseNextPluginTask,
  isTaskNeedingEndTimeRefresh,
  expireOverduePendingTasks,
  failPricedOutPendingTasks,
  resetStaleProcessingTasks,
  heartbeatProcessingTask,
  claimTaskForProcessing,
  claimReadyPluginTasks,
  sweepPendingTasks,
  getMultiBidStartMs,
  getMultiBidIntervalMs,
  getMultiBidConfig,
  isMultiBidTask,
  syncBiddingItems,
  resolveOrderFinalPrice,
  normalizeYahooWonTimeText,
  shouldSplitDirectBidByYahooLowPriceRule,
  isFollowupTaskReady,
  processPendingFollowupTasks,
  getNextIdleAction,
  getNextScanIdleCounter,
  ensureScheduledTransactionStartRequest,
  ensureScheduledConfirmReceiptRequest,
  isTransactionStartReady,
  shouldAutoRequestTransactionStart,
  completeIdleAction,
  getTransactionStartJobs,
  saveTransactionStartRunLog,
  updateTransactionStartStatus,
  syncYahooWonOrders,
  upsertOrderFromTask,
  getScanJobs,
  updateScanStatus,
  buildDaipaiSheetRow,
  getOrdersForSheetAppend,
  getOrderForSheetUpdate,
  getPaymentJobs,
  getConfirmReceiptJobs,
  summarizePaymentError,
  updatePaymentStatus,
  updateConfirmReceiptStatus,
  savePluginDiagnostic,
  getPluginDiagnostics,
  randomIntInclusive,
  getPaymentJobLimitRange,
  normalizeManualPinCode,
  buildWindowsSendKeysScript,
  typeManualPinWithSystemKeyboard,
  ORDER_STATUS_PENDING_PAYMENT,
  ORDER_STATUS_WAITING_SHIPPING,
  ORDER_STATUS_PENDING_BUNDLE,
  ORDER_STATUS_BUNDLE_COMPLETED,
  ORDER_STATUS_PENDING_SETTLEMENT,
  ORDER_STATUS_PENDING_SHIPMENT,
  ORDER_STATUS_PENDING_RECEIPT,
  ORDER_STATUS_CANCELLED,
  DEFAULT_PAYMENT_JOB_LIMIT,
  DEFAULT_PAYMENT_PAGE_STAY_SECONDS
} = require('./plugin');

const now = Date.parse('2026-05-13T12:00:00.000Z');

function minutesFromNow(minutes) {
  return new Date(now + minutes * 60 * 1000).toISOString();
}

function sqliteTimeFromNow(minutes) {
  return new Date(now + minutes * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

function testTaskSchemaIncludesBuyoutAutoPaid() {
  const fs = require('fs');
  const path = require('path');
  const modelsSource = fs.readFileSync(path.join(__dirname, '../models/index.js'), 'utf8');
  const initSql = fs.readFileSync(path.join(__dirname, '../../db/init.sql'), 'utf8');
  assert.match(modelsSource, /ensureColumn\('tasks', 'buyout_auto_paid', 'INTEGER DEFAULT 0'\)/);
  assert.match(initSql, /buyout_auto_paid\s+INTEGER DEFAULT 0/);
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
  assert.match(calls[0].sql, /datetime\(p\.end_time\) <= datetime\(\?\)/);
  assert.doesNotMatch(calls[0].sql, /tasks\.end_time|[^.]end_time IS NOT NULL/);
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
  assert.match(calls[0].sql, /status = 'bidding' AND strategy = 'multi_bid'/);
  assert.match(calls[0].sql, /p\.current_price > tasks\.max_price/);
  assert.doesNotMatch(calls[0].sql, /tasks\.current_price/);
  assert.match(calls[0].sql, /COALESCE\(bid_mode,\s*'bid'\)\s*<>\s*'buyout'/);
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

async function testGetMultiBidConfigDoesNotExposeIdleBidGuard() {
  let capturedSql = '';
  const fakeDb = {
    async getAll(sql) {
      capturedSql = sql;
      return [
        { key: 'multi_bid_start_hours', value: '0.5' },
        { key: 'multi_bid_interval_minutes', value: '5' },
        { key: 'idle_sync_interval_minutes', value: '2' },
        { key: 'idle_bid_guard_minutes', value: '99' },
        { key: 'multi_bid_min_price', value: '5000' },
        { key: 'bid_concurrency_limit', value: '2' }
      ];
    }
  };

  const config = await getMultiBidConfig(fakeDb);

  assert.equal(Object.hasOwn(config, 'idleBidGuardMinutes'), false);
  assert.doesNotMatch(capturedSql, /idle_bid_guard_minutes/);
}

async function testHeartbeatProcessingTaskOnlyRefreshesProcessingUpdatedAt() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await heartbeatProcessingTask(42, fakeDb);

  assert.equal(result.success, true);
  assert.match(calls[0].sql, /SET updated_at = CURRENT_TIMESTAMP/);
  assert.match(calls[0].sql, /WHERE id = \?/);
  assert.match(calls[0].sql, /status = 'processing'/);
  assert.doesNotMatch(calls[0].sql, /last_bid_at/);
  assert.deepEqual(calls[0].params, [42]);
}

async function testClaimTaskForProcessingOnlyClaimsPendingTask() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await claimTaskForProcessing(42, fakeDb);

  assert.equal(result.success, true);
  assert.match(calls[0].sql, /SET status = 'processing'/);
  assert.match(calls[0].sql, /WHERE id = \?/);
  assert.match(calls[0].sql, /status = 'pending'/);
  assert.match(calls[0].sql, /status = 'bidding' AND strategy = 'multi_bid'/);
  assert.deepEqual(calls[0].params, [42]);
}

async function testClaimReadyPluginTasksClaimsMultipleReadyTasks() {
  const claimedIds = [];
  const fakeDb = {
    async getAll(sql) {
      if (/FROM config/.test(sql)) return [];
      return [
        { id: 1, status: 'pending', strategy: 'direct', end_time: minutesFromNow(60), created_at: '2026-05-13 01:00:00' },
        { id: 2, status: 'pending', strategy: 'direct', end_time: minutesFromNow(60), created_at: '2026-05-13 01:01:00' },
        { id: 3, status: 'pending', strategy: '5min', end_time: minutesFromNow(60), created_at: '2026-05-13 01:02:00' }
      ];
    },
    async query(sql, params) {
      if (/SET status = 'processing'/.test(sql)) claimedIds.push(Number(params[0]));
      return { rowCount: 1 };
    }
  };

  const tasks = await claimReadyPluginTasks(2, fakeDb, now);

  assert.deepEqual(tasks.map(task => task.id), [1, 2]);
  assert.deepEqual(claimedIds, [1, 2]);
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
    },
    async getAll() {
      return [];
    },
    async getOne() {
      return null;
    }
  };

  const result = await syncBiddingItems([
    { productId: 'a123456789', title: 'A', price: '1,200', url: 'https://auctions.yahoo.co.jp/jp/auction/a123456789', status: 'highest' },
    { productId: 'b123456789', title: 'B', price: '1,500', url: 'https://auctions.yahoo.co.jp/jp/auction/b123456789', status: 'outbid' }
  ], fakeDb);

  assert.equal(result.highest, 1);
  assert.equal(result.outbid, 1);
  assert.equal(result.total, 2);
  assert.equal(result.followup, 0);
  assert.match(calls[0].sql, /UPDATE bidding_items/);
  assert.match(calls[1].sql, /INSERT INTO bidding_items/);
  assert.equal(calls[1].params[0], 'a123456789');
  assert.equal(calls[1].params[6], 'highest');
  const productUpserts = calls.filter(call => /INSERT INTO products/.test(call.sql));
  assert.equal(productUpserts.length, 2);
  assert.equal(productUpserts[0].params[0], 'a123456789');
  assert.equal(productUpserts[0].params.includes('scan'), true);
  const highestTaskUpdate = calls.find(call => /is_highest_bidder = 1/.test(call.sql));
  assert.match(highestTaskUpdate.sql, /status = 'bidding'/);
  assert.doesNotMatch(highestTaskUpdate.sql, /product_title\s*=/);
  assert.equal(highestTaskUpdate.params.at(-1), 'a123456789');
  const outbidTaskUpdate = calls.find(call => /is_highest_bidder = 0/.test(call.sql));
  assert.equal(outbidTaskUpdate.params.at(-1), 'b123456789');
}

async function testSyncBiddingItemsStoresRemainingTimeText() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    },
    async getAll() {
      return [];
    },
    async getOne() {
      return null;
    }
  };

  await syncBiddingItems([
    {
      productId: 'b1230074910',
      title: 'B',
      price: '7,701',
      url: 'https://auctions.yahoo.co.jp/jp/auction/b1230074910',
      status: 'highest',
      remainingTimeText: '5分'
    }
  ], fakeDb);

  const insertCall = calls.find(call => /INSERT INTO bidding_items/.test(call.sql));
  assert.match(insertCall.sql, /remaining_time_text/);
  assert.equal(insertCall.params.includes('5分'), true);
}

async function testSyncBiddingItemsDoesNotOverwriteProductIdentityFields() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    },
    async getAll() {
      return [];
    },
    async getOne() {
      return { tax_type: 'tax_zero' };
    }
  };

  await syncBiddingItems([
    {
      productId: 'u1234595011',
      title: 's4236k [送料',
      price: '20,500',
      url: 'https://auctions.yahoo.co.jp/jp/auction/u1234595011',
      imageUrl: 'https://example.invalid/short.jpg',
      status: 'highest'
    }
  ], fakeDb);

  const biddingInsert = calls.find(call => /INSERT INTO bidding_items/.test(call.sql));
  assert.equal(biddingInsert.params[1], 'https://auctions.yahoo.co.jp/jp/auction/u1234595011');
  assert.equal(biddingInsert.params[2], 's4236k [送料');
  assert.equal(biddingInsert.params[3], 'https://example.invalid/short.jpg');

  const productUpsert = calls.find(call => /INSERT INTO products/.test(call.sql));
  assert.equal(productUpsert.params[1], null);
  assert.equal(productUpsert.params[2], null);
  assert.equal(productUpsert.params[3], null);
  assert.equal(productUpsert.params[4], 20500);
  assert.equal(productUpsert.params.includes('scan'), true);
}

function testResolveOrderFinalPriceUsesYahooParsedPriceEvenWhenLowerThanMaxPrice() {
  assert.equal(resolveOrderFinalPrice({ current_price: 2530, max_price: 5000 }, '3,200'), 3200);
}

function testResolveOrderFinalPriceUsesYahooParsedPriceWhenHigherThanTaskPrice() {
  assert.equal(resolveOrderFinalPrice({ current_price: 2300, max_price: 2450, user_max_price: 2700 }, '2,530'), 2530);
}

function testResolveOrderFinalPriceReturnsNullWhenYahooPriceMissing() {
  assert.equal(resolveOrderFinalPrice({ current_price: 2530, max_price: 2450, user_max_price: 2700 }, ''), null);
}

async function testSyncBiddingItemsConvertsTaxIncludedListPriceToTaxExcluded() {
  // /my/bidding 的商城含税列表价写入 bidding_items 前应折回税前。
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    },
    async getAll() {
      return [];
    },
    async getOne(sql, params) {
      calls.push({ type: 'getOne', sql, params });
      return { tax_type: 'tax_included' };
    }
  };

  await syncBiddingItems([
    { productId: 'a123456789', title: 'A', price: '11,103', url: 'https://auctions.yahoo.co.jp/jp/auction/a123456789', status: 'highest' }
  ], fakeDb);

  // INSERT INTO bidding_items 的 current_price 参数应为折回税前后的 10093。
  const insertCall = calls.find(c => /INSERT INTO bidding_items/.test(c.sql));
  assert.equal(insertCall.params[4], 10093);
  const taxQuery = calls.find(call => call.type === 'getOne');
  assert.match(taxQuery.sql, /FROM products/);
  assert.match(taxQuery.sql, /WHERE product_id = \?/);
  assert.doesNotMatch(taxQuery.sql, /tasks|t\.tax_type/);
}

function testNormalizeYahooWonTimeTextInfersCurrentYear() {
  const normalized = normalizeYahooWonTimeText('5/23 22:26', Date.parse('2026-05-26T12:00:00.000Z'));
  assert.match(normalized, /^2026-05-23T/);
}

function testNormalizeYahooWonTimeTextUsesPreviousYearForFutureMonthDay() {
  const normalized = normalizeYahooWonTimeText('12/31 22:26', Date.parse('2026-01-02T12:00:00.000Z'));
  assert.match(normalized, /^2025-12-31T/);
}

function testShouldSplitDirectBidByYahooLowPriceRule() {
  // 普通商品：税前等于税后，当前价低于 1000 且出价超过 10000 时触发。
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 500, submitMaxPrice: 15000, taxType: 'tax_zero'
  }), true);
  // 当前价等于 1000 时不触发。
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 1000, submitMaxPrice: 15000, taxType: 'tax_zero'
  }), false);
  // 税前出价不超过 10000 时不触发。
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 500, submitMaxPrice: 10000, taxType: 'tax_zero'
  }), false);
  // 非 direct 策略不触发。
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'multi_bid', bidMode: 'bid', currentPrice: 500, submitMaxPrice: 15000, taxType: 'tax_zero'
  }), false);
  // buyout 模式不触发。
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'buyout', currentPrice: 500, submitMaxPrice: 15000, taxType: 'tax_zero'
  }), false);
  // 当前价未知时按低于 1000 处理，避免漏拆。
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 0, submitMaxPrice: 15000, taxType: 'tax_zero'
  }), true);

  // 商城商品：current_price 是税前，submitMaxPrice 是税后。
  // 税前 9100 对应税后 10010，但税前未超过 10000，不触发。
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 1, submitMaxPrice: 10010, taxType: 'tax_included'
  }), false);
  // 税前 11000 对应税后 12100，税前超过 10000，触发。
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 1, submitMaxPrice: 12100, taxType: 'tax_included'
  }), true);
  // 商城商品 current_price=1000 税前，到达边界，不触发。
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 1000, submitMaxPrice: 15000, taxType: 'tax_included'
  }), false);
  // 商城商品 current_price=999 税前，低于 1000，触发。
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 999, submitMaxPrice: 15000, taxType: 'tax_included'
  }), true);
  // 边界：税前出价正好 10000（税后 11000），不触发。
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 1, submitMaxPrice: 11000, taxType: 'tax_included'
  }), false);
}

function testIdleActionChoosesTransactionStartBeforeScan() {
  assert.equal(ORDER_STATUS_PENDING_PAYMENT, 'pending_payment');
  assert.equal(ORDER_STATUS_WAITING_SHIPPING, 'waiting_shipping');
  assert.equal(ORDER_STATUS_PENDING_BUNDLE, 'pending_bundle');
  assert.equal(getNextIdleAction({
    manualOrderImportPending: 1,
    yahooMessagePending: 1,
    transactionStartRequested: 1,
    scanIdleCounter: 0,
    scanEveryIdleRuns: 5,
    scanStartHour: 1,
    scanEndHour: 2,
    nowHour: 10,
    today: '2026-06-01'
  }).action, 'manual_order_import');
  assert.equal(getNextIdleAction({
    yahooMessagePending: 1,
    transactionStartRequested: 1,
    scanIdleCounter: 5,
    scanEveryIdleRuns: 5,
    scanStartHour: 1,
    scanEndHour: 20,
    nowHour: 10,
    today: '2026-06-01'
  }).action, 'yahoo_message');
  assert.equal(getNextIdleAction({
    transactionStartRequested: 1,
    scanIdleCounter: 5,
    scanEveryIdleRuns: 5,
    nowHour: 10,
    today: '2026-06-01'
  }).action, 'transaction_start');
  assert.equal(getNextIdleAction({
    transactionStartHour: 1,
    transactionStartLastRunDate: '2026-05-31',
    nowHour: 1,
    today: '2026-06-01'
  }).action, 'transaction_start');
  assert.equal(getNextIdleAction({
    transactionStartHour: 1,
    transactionStartLastRunSlot: '2026-06-01-01',
    scanIdleCounter: 5,
    scanEveryIdleRuns: 5,
    scanStartHour: 1,
    scanEndHour: 20,
    nowHour: 10,
    today: '2026-06-01'
  }).action, 'scan');
}

function testManualScanRequestBypassesScanWindow() {
  assert.equal(getNextIdleAction({
    transactionStartHour: 1,
    transactionStartLastRunSlot: '2026-06-29-01',
    scanRequested: 1,
    scanIdleCounter: 0,
    scanEveryIdleRuns: 10,
    scanStartHour: 1,
    scanEndHour: 19,
    nowHour: 21,
    today: '2026-06-29'
  }).action, 'scan');
}

function testManualOrderImportCompletesWithoutClearingScanCounter() {
  const saved = [];
  const fakeDb = {
    async getAll() {
      return [
        { key: 'scan_every_idle_runs', value: '5' },
        { key: 'scan_idle_counter', value: '5' }
      ];
    },
    async query(sql, params) {
      saved.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  return completeIdleAction('manual_order_import', fakeDb, Date.parse('2026-06-23T09:00:00+08:00')).then(() => {
    assert.equal(saved.some(call => call.params?.[0] === 'scan_idle_counter'), false);
  });
}

function testYahooMessageCompletesWithoutClearingScanCounter() {
  const saved = [];
  const fakeDb = {
    async getAll() {
      return [
        { key: 'scan_every_idle_runs', value: '5' },
        { key: 'scan_idle_counter', value: '5' }
      ];
    },
    async getOne(sql) {
      if (/manual_order_import_batches/.test(sql)) return { count: 0 };
      if (/yahoo_trade_messages/.test(sql)) return { count: 0 };
      return null;
    },
    async query(sql, params) {
      saved.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  return completeIdleAction('yahoo_message', fakeDb, Date.parse('2026-06-25T09:00:00+08:00')).then(() => {
    assert.equal(saved.some(call => call.params?.[0] === 'scan_idle_counter'), false);
  });
}

function testTransactionStartReadyOneMinuteAfterConfiguredHour() {
  assert.equal(isTransactionStartReady({
    transactionStartHour: 0,
    nowHour: 0,
    nowMinute: 0
  }), false);
  assert.equal(isTransactionStartReady({
    transactionStartHour: 0,
    nowHour: 0,
    nowMinute: 1
  }), true);
  assert.equal(isTransactionStartReady({
    transactionStartHour: 5,
    nowHour: 5,
    nowMinute: 0
  }), false);
  assert.equal(isTransactionStartReady({
    transactionStartHour: 5,
    nowHour: 5,
    nowMinute: 1
  }), true);
  assert.equal(getNextIdleAction({
    transactionStartHour: 0,
    transactionStartLastRunDate: '2026-05-31',
    nowHour: 0,
    nowMinute: 0,
    today: '2026-06-01'
  }).action, 'none');
  assert.equal(getNextIdleAction({
    transactionStartHour: 0,
    transactionStartLastRunDate: '2026-05-31',
    nowHour: 0,
    nowMinute: 1,
    today: '2026-06-01'
  }).action, 'transaction_start');
}

function testTransactionStartScheduleFollowsChangedHourSlots() {
  assert.equal(shouldAutoRequestTransactionStart({
    transactionStartHour: 0,
    transactionStartHourUpdatedAt: '2026-06-06T20:00:00+08:00'
  }, Date.parse('2026-06-07T00:01:00+08:00')), true);

  assert.equal(shouldAutoRequestTransactionStart({
    transactionStartHour: 0,
    transactionStartHourUpdatedAt: '2026-06-06T20:00:00+08:00',
    transactionStartLastRunSlot: '2026-06-07-00'
  }, Date.parse('2026-06-07T08:00:00+08:00')), false);

  assert.equal(shouldAutoRequestTransactionStart({
    transactionStartHour: 9,
    transactionStartHourUpdatedAt: '2026-06-07T08:00:00+08:00',
    transactionStartLastRunSlot: '2026-06-07-00'
  }, Date.parse('2026-06-07T09:01:00+08:00')), true);

  assert.equal(shouldAutoRequestTransactionStart({
    transactionStartHour: 2,
    transactionStartHourUpdatedAt: '2026-06-07T10:00:00+08:00',
    transactionStartLastRunSlot: '2026-06-07-09'
  }, Date.parse('2026-06-07T10:01:00+08:00')), false);

  assert.equal(shouldAutoRequestTransactionStart({
    transactionStartHour: 2,
    transactionStartHourUpdatedAt: '2026-06-07T10:00:00+08:00',
    transactionStartLastRunSlot: '2026-06-07-09'
  }, Date.parse('2026-06-08T02:01:00+08:00')), true);
}

function testPaymentIdleActionUsesFlagAfterScanPriority() {
  assert.equal(DEFAULT_PAYMENT_JOB_LIMIT, 3);
  assert.equal(DEFAULT_PAYMENT_PAGE_STAY_SECONDS, 3);
  assert.equal(ORDER_STATUS_PENDING_SETTLEMENT, 'pending_settlement');
  assert.equal(ORDER_STATUS_PENDING_SHIPMENT, 'pending_shipment');
  assert.equal(getNextIdleAction({
    transactionStartHour: 1,
    transactionStartLastRunSlot: '2026-06-03-01',
    scanIdleCounter: 0,
    scanEveryIdleRuns: 5,
    scanStartHour: 1,
    scanEndHour: 20,
    paymentRequested: 1,
    nowHour: 10,
    today: '2026-06-03'
  }).action, 'payment');

  assert.equal(getNextIdleAction({
    transactionStartHour: 1,
    transactionStartLastRunSlot: '2026-06-03-01',
    scanIdleCounter: 5,
    scanEveryIdleRuns: 5,
    scanStartHour: 1,
    scanEndHour: 20,
    paymentRequested: 1,
    nowHour: 10,
    today: '2026-06-03'
  }).action, 'scan');
}

function testScanCounterClearsAfterThresholdWhenScanDoesNotRun() {
  assert.equal(getNextScanIdleCounter('scan', { scanIdleCounter: 13, scanEveryIdleRuns: 5 }), 0);
  assert.equal(getNextScanIdleCounter('none', { scanIdleCounter: 13, scanEveryIdleRuns: 5 }), 0);
  assert.equal(getNextScanIdleCounter('none', { scanIdleCounter: 4, scanEveryIdleRuns: 5 }), 5);
  assert.equal(getNextScanIdleCounter('none', { scanIdleCounter: 5, scanEveryIdleRuns: 5 }), 0);
  assert.equal(getNextScanIdleCounter('confirm_receipt', { scanIdleCounter: 2, scanEveryIdleRuns: 5 }), 3);
}

function testIsFollowupTaskReady() {
  // 当前价达到 1200 且任务未结束时可触发。
  assert.equal(isFollowupTaskReady({
    pending_followup_max_price: 20000,
    current_price: 1200,
    status: 'bidding',
    end_time: minutesFromNow(60)
  }, now), true);
  // 当前价仍低于 1200 时不触发，避开税前/税后差异。
  assert.equal(isFollowupTaskReady({
    pending_followup_max_price: 20000,
    current_price: 1100,
    status: 'bidding',
    end_time: minutesFromNow(60)
  }, now), false);
  assert.equal(isFollowupTaskReady({
    pending_followup_max_price: 20000,
    current_price: 800,
    status: 'bidding',
    end_time: minutesFromNow(60)
  }, now), false);
  // 标记已清空。
  assert.equal(isFollowupTaskReady({
    pending_followup_max_price: null,
    current_price: 2000,
    status: 'bidding'
  }, now), false);
  // 任务已结束。
  assert.equal(isFollowupTaskReady({
    pending_followup_max_price: 20000,
    current_price: 2000,
    status: 'bidding',
    end_time: minutesFromNow(-10)
  }, now), false);
  // 任务已 success / failed 时不再追加。
  assert.equal(isFollowupTaskReady({
    pending_followup_max_price: 20000,
    current_price: 2000,
    status: 'success'
  }, now), false);
}

async function testProcessPendingFollowupTasksCreatesDirectTaskAndClearsMarker() {
  const queries = [];
  const fakeDb = {
    async getAll() {
      return [{
        id: 42,
        user_id: 7,
        product_id: 'a123456789',
        product_url: 'https://auctions.yahoo.co.jp/jp/auction/a123456789',
        product_title: 'sample',
        product_image_url: 'https://example.com/img.jpg',
        current_price: 1200,
        buyout_price: null,
        tax_type: 'tax_zero',
        shipping_fee_text: '\u9001\u6599 \u843d\u672d\u8005\u8ca0\u62c5',
        pending_followup_max_price: 20000,
        status: 'bidding',
        end_time: minutesFromNow(60)
      }];
    },
    async getOne() {
      return null;
    },
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const created = await processPendingFollowupTasks(fakeDb, now);

  assert.equal(created, 1);
  assert.match(queries[0].sql, /pending_followup_max_price = NULL/);
  assert.equal(queries[0].params[0], 42);
  assert.match(queries[1].sql, /INSERT INTO tasks/);
  // 检查关键字段位置：user_id=7, product_id, ...
  assert.equal(queries[1].params[0], 7);
  assert.equal(queries[1].params[1], 'a123456789');
  // tax_zero 商品：max_price / user_max_price 都是 20000。
  assert.equal(queries[1].params[2], 20000);
  assert.equal(queries[1].params[3], 20000);
  // client_request_id 使用 followup-{id}。
  assert.equal(queries[1].params.at(-1), 'followup-42');
}

async function testProcessPendingFollowupTasksConvertsTaxIncludedMaxPriceToTaxExcluded() {
  let insertParams = null;
  const fakeDb = {
    async getAll() {
      return [{
        id: 42,
        user_id: 7,
        product_id: 'a123456789',
        product_url: 'https://auctions.yahoo.co.jp/jp/auction/a123456789',
        current_price: 1210,
        buyout_price: null,
        tax_type: 'tax_included',
        shipping_fee_text: null,
        pending_followup_max_price: 11103,
        status: 'bidding',
        end_time: minutesFromNow(60)
      }];
    },
    async getOne() {
      return null;
    },
    async query(sql, params) {
      if (/INSERT INTO tasks/.test(sql)) insertParams = params;
      return { rowCount: 1 };
    }
  };

  const created = await processPendingFollowupTasks(fakeDb, now);
  assert.equal(created, 1);
  // 含税商品口径：user_max_price 是含税值 11103，max_price 是除税值 10093。
  assert.equal(insertParams[2], 10093); // max_price
  assert.equal(insertParams[3], 11103); // user_max_price
}

async function testProcessPendingFollowupTasksSkipsWhenAlreadyHasFollowup() {
  const fakeDb = {
    async getAll() {
      return [{
        id: 42,
        user_id: 7,
        product_id: 'a123456789',
        current_price: 1200,
        pending_followup_max_price: 20000,
        status: 'bidding',
        end_time: minutesFromNow(60),
        tax_type: 'tax_zero'
      }];
    },
    async getOne() {
      // 已存在同 client_request_id 的任务。
      return { id: 99 };
    },
    async query() {
      return { rowCount: 1 };
    }
  };

  const created = await processPendingFollowupTasks(fakeDb, now);
  assert.equal(created, 0);
}

async function testProcessPendingFollowupTasksSkipsWhenCurrentPriceStillBelowThreshold() {
  let inserted = false;
  const fakeDb = {
    async getAll() {
      return [{
        id: 42,
        user_id: 7,
        product_id: 'a123456789',
        // 1100 高于 Yahoo 规则 1000，但仍低于 followup 阈值 1200，避开税前/税后差异。
        current_price: 1100,
        pending_followup_max_price: 20000,
        status: 'bidding',
        end_time: minutesFromNow(60)
      }];
    },
    async getOne() {
      return null;
    },
    async query(sql) {
      if (/INSERT INTO tasks/.test(sql)) inserted = true;
      return { rowCount: 1 };
    }
  };

  const created = await processPendingFollowupTasks(fakeDb, now);
  assert.equal(created, 0);
  assert.equal(inserted, false);
}

async function testGetTransactionStartJobsHandlesStoreAndMissingUrl() {
  const queries = [];
  const fakeDb = {
    async getAll(sql, params) {
      queries.push({ sql, params, type: 'getAll' });
      return [
        { order_id: 1, product_id: 's1', product_type: 'store', transaction_url: '', shipping_fee_text: '\u7121\u6599' },
        { order_id: 2, product_id: 'n1', product_type: 'normal', transaction_url: '', shipping_fee_text: '\u843d\u672d\u8005\u8ca0\u62c5' },
        { order_id: 3, product_id: 'n2', product_type: 'normal', transaction_url: 'https://contact.example/n2', shipping_fee_text: '\u7121\u6599' },
        { order_id: 4, product_id: 'n3', product_type: 'normal', transaction_url: '', shipping_fee_text: '370\u5186' }
      ];
    },
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await getTransactionStartJobs(fakeDb);

  assert.equal(result.storeUpdated, 1);
  assert.equal(result.missingTransactionUrl, 0);
  assert.equal(result.jobs.length, 3);
  assert.equal(result.jobs[0].productId, 'n1');
  assert.equal(result.jobs[0].transactionUrl, '');
  assert.equal(result.jobs[1].productId, 'n2');
  assert.equal(result.jobs[2].productId, 'n3');
  assert.match(queries[0].sql, /LEFT JOIN products p ON p\.product_id = t\.product_id/);
  assert.match(queries[0].sql, /p\.product_url AS product_url/);
  assert.match(queries[0].sql, /p\.product_title AS product_title/);
  assert.match(queries[0].sql, /p\.product_type AS product_type/);
  assert.match(queries[0].sql, /p\.shipping_fee_text AS shipping_fee_text/);
  assert.doesNotMatch(queries[0].sql, /t\.(product_url|product_title|product_type|shipping_fee_text)/);
  assert.doesNotMatch(queries[0].sql, /t\.status = 'success'/);
  assert.doesNotMatch(queries[0].sql, /datetime\(COALESCE\(o\.won_at, o\.created_at\)\) < datetime\('now', 'start of day', \?\)/);
  assert.doesNotMatch(queries[0].sql, /SELECT t2\.shipping_fee_text/);
  assert.equal(queries[0].params, undefined);
  const storeUpdate = queries.find(call => /UPDATE orders/.test(call.sql));
  assert.equal(storeUpdate.params[0], ORDER_STATUS_PENDING_PAYMENT);
}

async function testGetTransactionStartJobsCanIncludeAfterCutoffForManualRun() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ sql, params });
      return [];
    }
  };

  const result = await getTransactionStartJobs(fakeDb, { includeAfterCutoff: true, transactionStartHour: 3 });

  assert.equal(result.total, 0);
  assert.equal(calls[0].params, undefined);
}

async function testSaveTransactionStartRunLogWritesJsonConfig() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  await saveTransactionStartRunLog(fakeDb, {
    source: 'manual',
    includeAfterCutoff: true,
    total: 2,
    storeUpdated: 1,
    jobs: [{ productId: 'm1231277495', orderId: 7 }]
  });

  assert.match(calls[0].sql, /INSERT OR REPLACE INTO config/);
  assert.equal(calls[0].params[0], 'transaction_start_last_run_log');
  const log = JSON.parse(calls[0].params[1]);
  assert.equal(log.source, 'manual');
  assert.equal(log.includeAfterCutoff, true);
  assert.equal(log.total, 2);
  assert.equal(log.storeUpdated, 1);
  assert.equal(log.jobs[0].productId, 'm1231277495');
  assert.match(log.createdAt, /^\d{4}-\d{2}-\d{2}T/);
}
async function testUpdateTransactionStartStatusUpdatesBundleByProductIds() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ sql, params });
      return [{ id: 10 }, { id: 11 }, { id: 12 }];
    },
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 3 };
    }
  };

  const result = await updateTransactionStartStatus({
    productIds: ['c1133337781', 'o1133346083', 'm1114324624'],
    status: ORDER_STATUS_PENDING_BUNDLE,
    bundleGroupId: 'bundle-20260601-c1133337781'
  }, fakeDb);

  assert.equal(result.updated, 3);
  assert.match(calls[0].sql, /t\.product_id IN/);
  const statusUpdate = calls.find(call => /UPDATE orders/.test(call.sql) && /SET order_status/.test(call.sql));
  assert.equal(statusUpdate.params[0], ORDER_STATUS_PENDING_BUNDLE);
  assert.equal(statusUpdate.params[1], 'bundle-20260601-c1133337781');
}

async function testUpdateTransactionStartStatusMarksOrderCancelled() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ sql, params });
      if (/FROM orders o/.test(sql) && /WHERE o\.id IN/.test(sql)) {
        return [{ order_id: 21, old_status: null, product_id: 'u1231877298' }];
      }
      return [];
    },
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await updateTransactionStartStatus({
    orderId: 21,
    status: ORDER_STATUS_CANCELLED
  }, fakeDb);

  assert.equal(result.updated, 1);
  const statusUpdate = calls.find(call => /UPDATE orders/.test(call.sql) && /SET order_status/.test(call.sql));
  assert.equal(statusUpdate.params[0], ORDER_STATUS_CANCELLED);
  assert.match(statusUpdate.sql, /order_status IS NULL OR order_status = ''/);
}

async function testSyncYahooWonOrdersContinuesAfterExistingAndCreatesWonOrder() {
  const calls = [];
  const tasks = new Map([
    ['a123456789', { id: 1, force_orders_resync: 0 }],
    ['u1231877298', { id: 110, force_orders_resync: 0 }]
  ]);
  const taskRows = new Map([
    [110, {
      id: 110,
      product_id: 'u1231877298',
      product_title: 'buyout item',
      product_url: 'https://auctions.yahoo.co.jp/jp/auction/u1231877298'
    }]
  ]);
  const existingOrders = new Map([[1, { id: 1001 }]]);
  const fakeDb = {
    async getOne(sql, params) {
      calls.push({ type: 'getOne', sql, params });
      if (/FROM tasks\s+WHERE product_id/.test(sql)) return tasks.get(params[0]) || null;
      if (/FROM orders WHERE task_id/.test(sql)) return existingOrders.get(params[0]) || null;
      if (/FROM tasks t\s+LEFT JOIN products p/.test(sql) && /WHERE t\.id = \?/.test(sql)) return taskRows.get(params[0]) || null;
      return null;
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await syncYahooWonOrders([
    { productId: 'a123456789', price: '100円' },
    { productId: 'u1231877298', price: '350円', wonTimeText: '6/6 04:26', transactionUrl: 'https://contact.example/u1231877298' }
  ], fakeDb);

  assert.equal(result.skippedExisting, 1);
  assert.equal(result.updated, 1);
  const taskSelects = calls.filter(call => call.type === 'getOne' && /FROM tasks\s+WHERE product_id/.test(call.sql));
  assert.equal(taskSelects.length, 2);
  assert.match(taskSelects[0].sql, /status <> 'cancelled'/);
  const statusUpdate = calls.find(call => call.type === 'query' && /UPDATE tasks/.test(call.sql));
  assert.equal(statusUpdate.params[0], 110);
  const orderInsert = calls.find(call => call.type === 'query' && /INSERT INTO orders/.test(call.sql));
  assert.equal(orderInsert.params[0], 110);
  assert.match(orderInsert.sql, /product_id/);
  assert.doesNotMatch(orderInsert.sql, /product_title|product_url/);
  assert.equal(orderInsert.params[1], 'u1231877298');
  assert.equal(orderInsert.params[2], 350);
}

async function testSyncYahooWonOrdersMarksStoreProductTypeWithoutTaxType() {
  const calls = [];
  const fakeDb = {
    async getOne(sql, params) {
      calls.push({ type: 'getOne', sql, params });
      if (/FROM tasks\s+WHERE product_id/.test(sql)) return { id: 343, force_orders_resync: 0 };
      if (/FROM orders WHERE task_id/.test(sql)) return null;
      if (/FROM orders o/.test(sql) && /COALESCE\(o\.product_id/.test(sql)) return null;
      if (/FROM tasks t\s+LEFT JOIN products p/.test(sql) && /WHERE t\.id = \?/.test(sql)) {
        return { id: 343, product_id: '1234843296', max_price: 1200, tax_type: 'tax_zero' };
      }
      return null;
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: 1 };
    }
  };

  await syncYahooWonOrders([
    {
      productId: '1234843296',
      price: '1,200\u5186',
      transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=1234843296',
      productType: 'store'
    }
  ], fakeDb);

  const productUpsert = calls.find(call => call.type === 'query' && /INSERT INTO products/.test(call.sql));
  assert.ok(productUpsert);
  assert.equal(productUpsert.params[0], '1234843296');
  assert.equal(productUpsert.params[7], null);
  assert.equal(productUpsert.params[8], 'store');
}

async function testSyncYahooWonOrdersUsesWonPageAsSourceOfTruthForFailedTask() {
  const calls = [];
  const fakeDb = {
    async getOne(sql, params) {
      calls.push({ type: 'getOne', sql, params });
      if (/FROM tasks\s+WHERE product_id/.test(sql)) {
        assert.match(sql, /status <> 'cancelled'/);
        return { id: 1169, force_orders_resync: 0 };
      }
      if (/FROM orders WHERE task_id/.test(sql)) return null;
      if (/FROM orders o/.test(sql) && /COALESCE\(o\.product_id/.test(sql)) return null;
      if (/FROM tasks t\s+LEFT JOIN products p/.test(sql) && /WHERE t\.id = \?/.test(sql)) {
        return {
          id: 1169,
          product_id: 'm1235180746',
          current_price: 20001
        };
      }
      return null;
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await syncYahooWonOrders([
    {
      productId: 'm1235180746',
      price: '22,001円',
      wonTimeText: '6/28 13:18',
      transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=m1235180746'
    }
  ], fakeDb);

  assert.equal(result.updated, 1);
  const statusUpdate = calls.find(call => call.type === 'query' && /UPDATE tasks/.test(call.sql));
  assert.ok(statusUpdate);
  assert.equal(statusUpdate.params[0], 1169);
  const orderInsert = calls.find(call => call.type === 'query' && /INSERT INTO orders/.test(call.sql));
  assert.ok(orderInsert);
  assert.equal(orderInsert.params[0], 1169);
}

async function testSyncYahooWonOrdersCreatesOrderFromFailedTaskWhenWonPageHasProduct() {
  const calls = [];
  const fakeDb = {
    async getOne(sql, params) {
      calls.push({ type: 'getOne', sql, params });
      if (/FROM tasks\s+WHERE product_id/.test(sql)) {
        assert.match(sql, /status <> 'cancelled'/);
        return { id: 1439, force_orders_resync: 0 };
      }
      if (/FROM orders WHERE task_id/.test(sql)) return null;
      if (/FROM orders o/.test(sql) && /COALESCE\(o\.product_id/.test(sql)) return null;
      if (/FROM tasks t\s+LEFT JOIN products p/.test(sql) && /WHERE t\.id = \?/.test(sql)) {
        return {
          id: 1439,
          product_id: 'x1235487667',
          current_price: 8600
        };
      }
      return null;
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await syncYahooWonOrders([
    {
      productId: 'x1235487667',
      price: '9,460円',
      wonTimeText: '7/1 14:19',
      transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=x1235487667'
    }
  ], fakeDb);

  assert.equal(result.updated, 1);
  const statusUpdate = calls.find(call => call.type === 'query' && /UPDATE tasks/.test(call.sql));
  assert.ok(statusUpdate);
  assert.equal(statusUpdate.params[0], 1439);
  const orderInsert = calls.find(call => call.type === 'query' && /INSERT INTO orders/.test(call.sql));
  assert.ok(orderInsert);
  assert.equal(orderInsert.params[0], 1439);
  assert.equal(orderInsert.params[1], 'x1235487667');
  assert.equal(orderInsert.params[2], 9460);
}

async function testSyncYahooWonOrdersDoesNotDuplicateExistingProductOrder() {
  const calls = [];
  const fakeDb = {
    async getOne(sql, params) {
      calls.push({ type: 'getOne', sql, params });
      if (/FROM tasks\s+WHERE product_id/.test(sql)) {
        return { id: 1170, force_orders_resync: 0 };
      }
      if (/FROM orders WHERE task_id/.test(sql)) return null;
      if (/FROM tasks t\s+LEFT JOIN products p/.test(sql) && /WHERE t\.id = \?/.test(sql)) {
        return {
          id: 1170,
          product_id: 'm1235180746',
          current_price: 20001
        };
      }
      if (/FROM orders o/.test(sql) && /COALESCE\(o\.product_id/.test(sql)) {
        return {
          id: 275,
          task_id: 1169,
          order_status: ORDER_STATUS_PENDING_PAYMENT,
          tracking_number: ''
        };
      }
      return null;
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await syncYahooWonOrders([
    {
      productId: 'm1235180746',
      price: '22,001円',
      wonTimeText: '6/28 13:18',
      transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=m1235180746'
    }
  ], fakeDb);

  assert.equal(result.skippedExisting, 1);
  assert.equal(result.updated, 0);
  assert.equal(calls.some(call => call.type === 'query' && /UPDATE tasks/.test(call.sql)), false);
  assert.equal(calls.some(call => call.type === 'query' && /INSERT INTO orders/.test(call.sql)), false);
}

async function testUpsertOrderFromTaskUsesExistingProductOrder() {
  const calls = [];
  const fakeDb = {
    async getOne(sql, params) {
      calls.push({ type: 'getOne', sql, params });
      if (/FROM tasks t\s+LEFT JOIN products p/.test(sql) && /WHERE t\.id = \?/.test(sql)) {
        return {
          id: 1170,
          product_id: 'm1235180746',
          current_price: 20001
        };
      }
      if (/FROM orders WHERE task_id/.test(sql)) return null;
      if (/FROM orders o/.test(sql) && /COALESCE\(o\.product_id/.test(sql)) {
        return { id: 275, task_id: 1169 };
      }
      return null;
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: 1 };
    }
  };

  await upsertOrderFromTask(1170, {
    finalPrice: 22001,
    wonTimeText: '6/28 13:18',
    transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=m1235180746'
  }, fakeDb);

  assert.equal(calls.some(call => call.type === 'query' && /INSERT INTO orders/.test(call.sql)), false);
  const orderUpdate = calls.find(call => call.type === 'query' && /UPDATE orders/.test(call.sql));
  assert.ok(orderUpdate);
  assert.match(orderUpdate.sql, /WHERE id = \?/);
  assert.equal(orderUpdate.params.at(-1), 275);
}

async function testSyncYahooWonOrdersUpdatesExistingFinalPriceWithCoalesce() {
  const calls = [];
  const fakeDb = {
    async getOne(sql, params) {
      calls.push({ type: 'getOne', sql, params });
      if (/FROM tasks\s+WHERE product_id/.test(sql)) return { id: 77, force_orders_resync: 1 };
      if (/FROM orders WHERE task_id/.test(sql)) return { id: 177 };
      if (/FROM tasks t\s+LEFT JOIN products p/.test(sql) && /WHERE t\.id = \?/.test(sql)) {
        return {
          id: 77,
          product_id: 'k1230268385',
          product_title: 'store item',
          product_url: 'https://auctions.yahoo.co.jp/jp/auction/k1230268385',
          current_price: 1200,
          tax_type: 'tax_included',
          product_type: 'store'
        };
      }
      return null;
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await syncYahooWonOrders([
    {
      productId: 'k1230268385',
      price: '6,600円',
      wonTimeText: '6/15 22:08',
      transactionUrl: 'https://contact.auctions.yahoo.co.jp/seller/top?aid=k1230268385'
    }
  ], fakeDb);

  assert.equal(result.updated, 1);
  assert.equal(result.forcedResync, 1);
  const orderUpdate = calls.find(call => call.type === 'query' && /UPDATE orders/.test(call.sql) && /final_price/.test(call.sql));
  assert.ok(orderUpdate);
  assert.doesNotMatch(orderUpdate.sql, /product_title|product_url/);
  assert.match(orderUpdate.sql, /final_price = COALESCE\(\?, final_price\)/);
  assert.equal(orderUpdate.params[1], 6600);
}

async function testSyncYahooWonOrdersMovesExistingPendingShipmentWithTrackingToPendingReceipt() {
  const calls = [];
  const fakeDb = {
    async getOne(sql, params) {
      calls.push({ type: 'getOne', sql, params });
      if (/FROM tasks\s+WHERE product_id/.test(sql)) return { id: 88, force_orders_resync: 0 };
      if (/FROM orders WHERE task_id/.test(sql)) {
        return {
          id: 188,
          order_status: ORDER_STATUS_PENDING_SHIPMENT,
          tracking_number: ''
        };
      }
      return null;
    },
    async getAll(sql, params) {
      calls.push({ type: 'getAll', sql, params });
      return [];
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: /UPDATE orders/.test(sql) ? 1 : 0 };
    }
  };

  const result = await syncYahooWonOrders([
    {
      productId: 'l1233674201',
      price: '6,800円',
      wonTimeText: '6/15 22:38',
      transactionUrl: 'https://contact.auctions.yahoo.co.jp/seller/top?aid=l1233674201',
      trackingNumber: '490459840452'
    }
  ], fakeDb);

  assert.equal(result.skippedExisting, 0);
  assert.equal(result.updated, 1);
  const orderUpdate = calls.find(call => call.type === 'query' && /UPDATE orders/.test(call.sql) && /order_status = \?/.test(call.sql));
  assert.ok(orderUpdate);
  assert.equal(orderUpdate.params[0], ORDER_STATUS_PENDING_RECEIPT);
  assert.equal(orderUpdate.params[1], '490459840452');
  assert.equal(orderUpdate.params[2], 'https://contact.auctions.yahoo.co.jp/seller/top?aid=l1233674201');
  assert.equal(orderUpdate.params[3], 188);
}

async function testSyncYahooWonOrdersKeepsForcedResyncWhenPriceMissing() {
  const calls = [];
  const fakeDb = {
    async getOne(sql, params) {
      calls.push({ type: 'getOne', sql, params });
      if (/FROM tasks\s+WHERE product_id/.test(sql)) return { id: 77, force_orders_resync: 1 };
      if (/FROM orders WHERE task_id/.test(sql)) return { id: 177 };
      return null;
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await syncYahooWonOrders([
    { productId: 'k1230268385', price: '', wonTimeText: '6/15 22:08' }
  ], fakeDb);

  assert.equal(result.updated, 0);
  assert.equal(result.missingPrice, 1);
  assert.equal(result.forcedResync, 0);
  assert.equal(calls.some(call => call.type === 'query' && /force_orders_resync = 0/.test(call.sql)), false);
  assert.equal(calls.some(call => call.type === 'query' && /UPDATE orders/.test(call.sql)), false);
}

async function testGetScanJobsReturnsWaitingShippingOnly() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ sql, params });
      return [{
        order_id: 11,
        transaction_url: 'https://contact.auctions.yahoo.co.jp/seller/top?aid=m111111111',
        product_id: 'm111111111',
        product_url: 'https://auctions.yahoo.co.jp/jp/auction/m111111111',
        product_title: 'sample',
        order_status: ORDER_STATUS_WAITING_SHIPPING,
        shipping_fee_text: '\u843d\u672d\u8005\u8ca0\u62c5'
      }];
    }
  };

  const result = await getScanJobs(fakeDb);

  assert.match(calls[0].sql, /o\.order_status IN/);
  assert.equal(calls[0].params[0], ORDER_STATUS_PENDING_SHIPMENT);
  assert.equal(calls[0].params[1], ORDER_STATUS_PENDING_SHIPMENT);
  assert.equal(calls[0].params[2], ORDER_STATUS_WAITING_SHIPPING);
  assert.equal(calls[0].params[3], ORDER_STATUS_PENDING_BUNDLE);
  assert.equal(calls[0].params[4], ORDER_STATUS_PENDING_RECEIPT);
  assert.match(calls[0].sql, /LEFT JOIN products p ON p\.product_id = t\.product_id/);
  assert.match(calls[0].sql, /p\.product_url AS product_url/);
  assert.match(calls[0].sql, /p\.product_title AS product_title/);
  assert.match(calls[0].sql, /p\.product_type AS product_type/);
  assert.match(calls[0].sql, /p\.shipping_fee_text AS shipping_fee_text/);
  assert.doesNotMatch(calls[0].sql, /t\.(product_url|product_title|product_type|shipping_fee_text)/);
  assert.equal(result.total, 1);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].orderId, 11);
  assert.equal(result.jobs[0].productId, 'm111111111');
  assert.equal(result.jobs[0].orderStatus, ORDER_STATUS_WAITING_SHIPPING);
  assert.equal(result.jobs[0].transactionUrl, 'https://contact.auctions.yahoo.co.jp/seller/top?aid=m111111111');
}

async function testGetScanJobsReturnsTrackingRescanAsPendingShipment() {
  const fakeDb = {
    async getAll() {
      return [{
        order_id: 12,
        transaction_url: 'https://contact.auctions.yahoo.co.jp/seller/top?aid=m222222222',
        product_id: 'm222222222',
        product_url: 'https://auctions.yahoo.co.jp/jp/auction/m222222222',
        product_title: 'sample',
        order_status: ORDER_STATUS_PENDING_RECEIPT,
        tracking_rescan_requested: 1,
        shipping_fee_text: '\u7121\u6599'
      }];
    }
  };

  const result = await getScanJobs(fakeDb);

  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].orderStatus, ORDER_STATUS_PENDING_SHIPMENT);
  assert.equal(result.jobs[0].originalOrderStatus, ORDER_STATUS_PENDING_RECEIPT);
  assert.equal(result.jobs[0].trackingRescanRequested, true);
}

async function testUpdateScanStatusMarksPendingShipmentAsShipped() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ sql, params });
      return [{ order_id: 31, order_status: ORDER_STATUS_PENDING_SHIPMENT }];
    },
    async getOne(sql, params) {
      calls.push({ sql, params });
      return null;
    },
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: /UPDATE orders/.test(sql) ? 1 : 0 };
    }
  };

  const result = await updateScanStatus({
    orderId: 31,
    shipped: true,
    shippingCompany: '\u65e5\u672c\u90f5\u4fbf',
    trackingNumber: '628620458093'
  }, fakeDb);

  assert.equal(result.updated, 1);
  assert.equal(result.shipped, true);
  const statusUpdate = calls.find(call => /UPDATE orders/.test(call.sql) && /shipping_company/.test(call.sql));
  assert.equal(statusUpdate.params[0], ORDER_STATUS_PENDING_RECEIPT);
  assert.equal(statusUpdate.params[1], '\u65e5\u672c\u90f5\u4fbf');
  assert.equal(statusUpdate.params[2], '628620458093');
  assert.equal(statusUpdate.params[3], 31);
  assert.equal(statusUpdate.params[4], ORDER_STATUS_PENDING_SHIPMENT);
}

async function testUpdateScanStatusDropsTrackingUrlLabelAsShippingCompany() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ sql, params });
      return [{ order_id: 32, order_status: ORDER_STATUS_PENDING_SHIPMENT }];
    },
    async getOne(sql, params) {
      calls.push({ sql, params });
      return null;
    },
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: /UPDATE orders/.test(sql) ? 1 : 0 };
    }
  };

  const result = await updateScanStatus({
    orderId: 32,
    shipped: true,
    shippingCompany: '\u304a\u8377\u7269\u691c\u7d22URL\uff1a https://track.example.test/193398193940',
    trackingNumber: '193398193940'
  }, fakeDb);

  assert.equal(result.updated, 1);
  const statusUpdate = calls.find(call => /UPDATE orders/.test(call.sql) && /shipping_company/.test(call.sql));
  assert.equal(statusUpdate.params[1], null);
  assert.equal(statusUpdate.params[2], '193398193940');
}

async function testUpdateScanStatusStripsShippingMethodLabelFromCompany() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ sql, params });
      return [{ order_id: 33, order_status: ORDER_STATUS_PENDING_SHIPMENT }];
    },
    async getOne(sql, params) {
      calls.push({ sql, params });
      return null;
    },
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: /UPDATE orders/.test(sql) ? 1 : 0 };
    }
  };

  const result = await updateScanStatus({
    orderId: 33,
    shipped: true,
    shippingCompany: '\u914d\u9001\u65b9\u6cd5 \u3086\u3046\u30d1\u30c3\u30af',
    trackingNumber: '193398193940'
  }, fakeDb);

  assert.equal(result.updated, 1);
  const statusUpdate = calls.find(call => /UPDATE orders/.test(call.sql) && /shipping_company/.test(call.sql));
  assert.equal(statusUpdate.params[1], '\u3086\u3046\u30d1\u30c3\u30af');
  assert.equal(statusUpdate.params[2], '193398193940');
}

async function testUpdateScanStatusRefreshesTrackingForRescanOrder() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ sql, params });
      return [{ order_id: 41, order_status: ORDER_STATUS_PENDING_RECEIPT }];
    },
    async getOne(sql, params) {
      calls.push({ sql, params });
      return null;
    },
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: /UPDATE orders/.test(sql) ? 1 : 0 };
    }
  };

  const result = await updateScanStatus({
    orderId: 41,
    shipped: true,
    trackingRescanRequested: true,
    shippingCompany: '\u30e4\u30de\u30c8\u904b\u8f38',
    trackingNumber: '123456789012'
  }, fakeDb);

  assert.equal(result.updated, 1);
  assert.equal(result.trackingRescanRequested, true);
  const statusUpdate = calls.find(call => /UPDATE orders/.test(call.sql) && /tracking_rescan_requested = 0/.test(call.sql));
  assert.ok(statusUpdate);
  assert.match(statusUpdate.sql, /COALESCE\(tracking_rescan_requested, 0\) = 1/);
  assert.equal(statusUpdate.params[1], '\u30e4\u30de\u30c8\u904b\u8f38');
  assert.equal(statusUpdate.params[2], '123456789012');
  assert.equal(statusUpdate.params[3], 41);
}

function testBuildDaipaiSheetRowUsesBundleShippingForTotalAndPayable() {
  const row = buildDaipaiSheetRow({
    won_at: '2026-06-06 12:34:56',
    username: 'user-a',
    product_id: 's1113817953',
    product_url: 'https://auctions.yahoo.co.jp/jp/auction/s1113817953',
    product_title: 'bundle item',
    final_price: 1000,
    shipping_fee_text: '落札者負担',
    bundle_shipping_fee_text: '110円',
    shipping_company: '日本郵便',
    tracking_number: '628620458093',
    tax_type: 'tax_zero'
  }, {
    rate: 0.05,
    bankFeeJpy: 500,
    handlingFeeCny: 15,
    largeAmountFeeCny: 0
  });

  assert.deepEqual(row, [
    '2026-06-06',
    'user-a',
    'https://auctions.yahoo.co.jp/jp/auction/s1113817953',
    'bundle item',
    1000,
    '落札者負担',
    '110円',
    1110,
    '日本郵便',
    '628620458093',
    ''
  ]);
}

function testBuildDaipaiSheetRowAppendsOrderRemarkAfterTrackingNumber() {
  const row = buildDaipaiSheetRow({
    won_at: '2026-06-06 12:34:56',
    username: 'user-a',
    product_id: 's1113817953',
    product_title: 'remark item',
    final_price: 1000,
    shipping_fee_text: '無料',
    shipping_company: '佐川急便',
    tracking_number: '123456789012',
    order_remark: 'fragile box',
    tax_type: 'tax_zero'
  }, {
    rate: 0.05,
    bankFeeJpy: 0,
    handlingFeeCny: 0,
    largeAmountFeeCny: 0
  });

  assert.equal(row.length, 11);
  assert.equal(row[9], '123456789012');
  assert.equal(row[10], 'fragile box');
}

function testBuildDaipaiSheetRowFallsBackToProductIdForGoogleMatching() {
  const row = buildDaipaiSheetRow({
    won_at: '2026-06-22 11:12:13',
    username: 'user-b',
    product_id: 'E1233463523',
    product_url: '',
    product_title: '',
    final_price: 21000,
    shipping_fee_text: '880\u5186',
    shipping_company: 'Japan Post',
    tracking_number: '639290914765',
    tax_type: 'tax_zero'
  }, {
    rate: 0.044,
    bankFeeJpy: 0,
    handlingFeeCny: 0,
    largeAmountFeeCny: 0
  });

  assert.equal(row[2], 'https://auctions.yahoo.co.jp/jp/auction/e1233463523');
  assert.equal(row[3], 'e1233463523');
}

async function testGetOrdersForSheetAppendReturnsWholeBundleGroup() {
  const calls = [];
  const fakeDb = {
    async getOne(sql, params) {
      calls.push({ sql, params });
      if (/SELECT id, bundle_group_id/.test(sql)) return { id: 14, bundle_group_id: 'bundle-a' };
      if (/COALESCE\(bundle_shipping_fee_text/.test(sql)) return { yes: 1 };
      return null;
    },
    async getAll(sql, params) {
      calls.push({ sql, params });
      assert.match(sql, /o\.bundle_group_id = \?/);
      assert.match(sql, /LEFT JOIN products p ON p\.product_id = t\.product_id/);
      assert.match(sql, /p\.product_url AS product_url/);
      assert.match(sql, /p\.product_title AS product_title/);
      assert.match(sql, /p\.shipping_fee_text AS shipping_fee_text/);
      assert.match(sql, /p\.tax_type AS tax_type/);
      assert.match(sql, /o\.order_remark/);
      assert.doesNotMatch(sql, /t\.(product_url|product_title|shipping_fee_text|tax_type)/);
      assert.deepEqual(params, ['bundle-a', ORDER_STATUS_PENDING_RECEIPT, ORDER_STATUS_BUNDLE_COMPLETED]);
      return [
        { id: 13, product_id: 'c1135451955', bundle_shipping_fee_text: '0円' },
        { id: 14, product_id: 's1113817953', bundle_shipping_fee_text: '110円' }
      ];
    }
  };

  const result = await getOrdersForSheetAppend(14, fakeDb);

  assert.equal(result.isBundle, true);
  assert.equal(result.bundleGroupId, 'bundle-a');
  assert.deepEqual(result.orders.map(order => order.id), [13, 14]);
  assert.equal(calls.length, 3);
}

async function testGetOrderForSheetUpdateUsesProductSnapshotFields() {
  const calls = [];
  const fakeDb = {
    async getOne(sql, params) {
      calls.push({ sql, params });
      return {
        id: 15,
        product_id: 'm1233193360',
        product_url: 'https://auctions.yahoo.co.jp/jp/auction/m1233193360',
        product_title: 'sheet update item',
        shipping_fee_text: '1940\u5186',
        tax_type: 'tax_zero'
      };
    }
  };

  const order = await getOrderForSheetUpdate(15, fakeDb);

  assert.equal(order.id, 15);
  assert.match(calls[0].sql, /LEFT JOIN products p ON p\.product_id = t\.product_id/);
  assert.match(calls[0].sql, /p\.product_url AS product_url/);
  assert.match(calls[0].sql, /p\.product_title AS product_title/);
  assert.match(calls[0].sql, /p\.shipping_fee_text AS shipping_fee_text/);
  assert.match(calls[0].sql, /p\.tax_type AS tax_type/);
  assert.match(calls[0].sql, /o\.order_remark/);
  assert.doesNotMatch(calls[0].sql, /t\.(product_url|product_title|shipping_fee_text|tax_type)/);
  assert.deepEqual(calls[0].params, [15, ORDER_STATUS_PENDING_RECEIPT, ORDER_STATUS_BUNDLE_COMPLETED]);
}

async function testUpdateScanStatusMarksPendingShipmentAsCancelled() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ sql, params });
      return [{ order_id: 32, order_status: ORDER_STATUS_PENDING_SHIPMENT }];
    },
    async getOne(sql, params) {
      calls.push({ sql, params });
      return null;
    },
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: /UPDATE orders/.test(sql) ? 1 : 0 };
    }
  };

  const result = await updateScanStatus({ orderId: 32, cancelled: true }, fakeDb);

  assert.equal(result.updated, 1);
  assert.equal(result.cancelled, true);
  const statusUpdate = calls.find(call => /UPDATE orders/.test(call.sql) && /order_status =/.test(call.sql));
  assert.equal(statusUpdate.params[0], ORDER_STATUS_CANCELLED);
  assert.equal(statusUpdate.params[1], 32);
  assert.equal(statusUpdate.params[2], ORDER_STATUS_PENDING_SHIPMENT);
}

async function testUpdateScanStatusWritesShippingAndPendingPayment() {
  const queries = [];
  const fakeDb = {
    async getOne(sql, params) {
      queries.push({ sql, params });
      return {
        product_id: 'm1233193360',
        product_url: 'https://auctions.yahoo.co.jp/jp/auction/m1233193360',
        product_title: 'test product',
        product_image_url: '',
        current_price: 1000,
        buyout_price: null,
        bid_count: 0,
        tax_type: 'tax_zero',
        product_type: 'normal',
        end_time: null
      };
    },
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await updateScanStatus({ orderId: 11, shippingFeeText: '1,060\u5186' }, fakeDb);

  assert.equal(result.updated, 1);
  assert.equal(result.shippingFeeText, '1060\u5186');
  assert.match(queries[0].sql, /FROM tasks t/);
  assert.match(queries[0].sql, /LEFT JOIN products p ON p\.product_id = t\.product_id/);
  assert.match(queries[0].sql, /p\.product_url AS product_url/);
  assert.match(queries[0].sql, /p\.tax_type AS tax_type/);
  assert.match(queries[0].sql, /p\.product_type AS product_type/);
  assert.doesNotMatch(queries[0].sql, /t\.(product_url|tax_type|product_type)/);
  assert.equal(queries[0].params[0], 11);
  assert.equal(queries[0].params[1], ORDER_STATUS_WAITING_SHIPPING);
  assert.doesNotMatch(queries.map(q => q.sql).join('\n'), /UPDATE tasks[\s\S]*shipping_fee_text/);
  assert.match(queries[1].sql, /INSERT INTO products/);
  assert.equal(queries[1].params[0], 'm1233193360');
  assert.equal(queries[1].params[9], '1060\u5186');
  assert.match(queries[2].sql, /UPDATE orders/);
  assert.equal(queries[2].params[0], ORDER_STATUS_PENDING_PAYMENT);
  assert.equal(queries[2].params[1], 11);
  assert.equal(queries[2].params[2], ORDER_STATUS_WAITING_SHIPPING);
}

async function testUpdateScanStatusKeepsWaitingShippingWhenShippingPending() {
  const queries = [];
  const fakeDb = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await updateScanStatus({ orderId: 12, pending: true }, fakeDb);

  assert.equal(result.updated, 1);
  assert.equal(result.pending, true);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /UPDATE orders/);
  assert.equal(queries[0].params[0], ORDER_STATUS_WAITING_SHIPPING);
  assert.equal(queries[0].params[1], 12);
}

async function testUpdateScanStatusCompletesBundleGroupWithShippingFee() {
  const queries = [];
  const fakeDb = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 3 };
    }
  };

  const result = await updateScanStatus({ orderId: 20, bundleShippingFeeText: '1,620\u5186' }, fakeDb);

  assert.equal(result.updated, 3);
  assert.equal(result.bundleShippingFeeText, '1620\u5186');
  assert.match(queries[0].sql, /bundle_shipping_fee_text/);
  assert.match(queries[0].sql, /bundle_group_id =/);
  assert.equal(queries[0].params[0], 20);
  assert.equal(queries[0].params[1], '1620\u5186');
  assert.equal(queries[0].params[2], '0\u5186');
  assert.equal(queries[0].params[3], 20);
  assert.equal(queries[0].params[4], ORDER_STATUS_PENDING_PAYMENT);
  assert.equal(queries[0].params[5], ORDER_STATUS_BUNDLE_COMPLETED);
  assert.equal(queries[0].params[6], 20);
}

async function testUpdateScanStatusCompletesBundleGroupWithNonNumericShippingFee() {
  const queries = [];
  const fakeDb = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 2 };
    }
  };

  const result = await updateScanStatus({ orderId: 24, bundleShippingFeeText: '\u51fa\u54c1\u8005\u8ca0\u62c5' }, fakeDb);

  assert.equal(result.updated, 2);
  assert.equal(result.bundleShippingFeeText, '\u51fa\u54c1\u8005\u8ca0\u62c5');
  assert.equal(queries[0].params[0], 24);
  assert.equal(queries[0].params[1], '\u51fa\u54c1\u8005\u8ca0\u62c5');
  assert.equal(queries[0].params[2], '0\u5186');
  assert.equal(queries[0].params[4], ORDER_STATUS_PENDING_PAYMENT);
  assert.equal(queries[0].params[5], ORDER_STATUS_BUNDLE_COMPLETED);
}

async function testUpdateScanStatusRejectsBundleGroupToEmptyStatus() {
  const queries = [];
  const fakeDb = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 2 };
    }
  };

  const result = await updateScanStatus({ orderId: 21, bundleRejected: true }, fakeDb);

  assert.equal(result.updated, 2);
  assert.equal(result.bundleRejected, true);
  assert.match(queries[0].sql, /order_status = NULL/);
  assert.match(queries[0].sql, /bundle_group_id = NULL/);
  assert.match(queries[0].sql, /bundle_shipping_fee_text = NULL/);
  assert.equal(queries[0].params[0], 21);
}

async function testGetPaymentJobsReturnsPendingSettlementWithPayable() {
  let getAllCall = 0;
  const fakeDb = {
    async getAll(sql, params) {
      getAllCall += 1;
      if (getAllCall === 1) {
        assert.match(sql, /payment_job_limit_min/);
        return [
          { key: 'payment_job_limit_min', value: '2' },
          { key: 'payment_job_limit_max', value: '5' }
        ];
      }
      assert.match(sql, /o\.order_status = \?/);
      assert.match(sql, /o\.total_amount_cny IS NOT NULL/);
      assert.match(sql, /LEFT JOIN products p ON p\.product_id = t\.product_id/);
      assert.match(sql, /p\.product_url AS product_url/);
      assert.match(sql, /p\.product_title AS product_title/);
      assert.match(sql, /p\.product_type AS product_type/);
      assert.match(sql, /p\.shipping_fee_text AS shipping_fee_text/);
      assert.doesNotMatch(sql, /t\.(product_url|product_title|product_type|shipping_fee_text)/);
      assert.match(sql, /ORDER BY datetime\(COALESCE\(o\.won_at, o\.created_at\)\) ASC, o\.id ASC/);
      assert.deepEqual(params.slice(0, 3), [
        ORDER_STATUS_PENDING_SETTLEMENT,
        ORDER_STATUS_BUNDLE_COMPLETED,
        ORDER_STATUS_PENDING_SETTLEMENT
      ]);
      assert.equal(params[3], 4);
      return [{
        order_id: 9,
        product_id: 'x1',
        product_url: 'https://auctions.yahoo.co.jp/jp/auction/x1',
        product_title: 'Item',
        product_type: 'normal',
        transaction_url: 'https://contact.example/x1',
        total_amount_cny: 123.45,
        final_price: 2000,
        shipping_fee_text: '送料 500円',
        bundle_shipping_fee_text: '',
        bundle_group_id: ''
      }];
    }
  };

  const result = await getPaymentJobs(fakeDb, { random: () => 0.5 });

  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].orderId, 9);
  assert.equal(result.jobs[0].effectiveShippingFeeText, '送料 500円');
  assert.equal(result.limit, 4);
  assert.equal(result.limitMin, 2);
  assert.equal(result.limitMax, 5);
}

async function testGetPaymentJobsIncludesBundleFinalPriceTotal() {
  let getAllCall = 0;
  const fakeDb = {
    async getAll(sql, params) {
      getAllCall += 1;
      if (getAllCall === 1) return [];
      assert.match(sql, /bundle_group_id/);
      assert.match(sql, /SUM\(og\.final_price\)/);
      assert.match(sql, /payment_final_price/);
      assert.deepEqual(params.slice(0, 3), [
        ORDER_STATUS_PENDING_SETTLEMENT,
        ORDER_STATUS_BUNDLE_COMPLETED,
        ORDER_STATUS_PENDING_SETTLEMENT
      ]);
      return [{
        order_id: 21,
        product_id: 'a1',
        product_url: 'https://auctions.yahoo.co.jp/jp/auction/a1',
        product_title: 'Bundle main',
        product_type: 'normal',
        transaction_url: 'https://contact.example/a1',
        total_amount_cny: 85,
        final_price: 1000,
        payment_final_price: 1500,
        shipping_fee_text: '送料 800円',
        bundle_shipping_fee_text: '200円',
        bundle_group_id: 'bundle-a'
      }];
    }
  };

  const result = await getPaymentJobs(fakeDb, { random: () => 0 });

  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].finalPrice, 1000);
  assert.equal(result.jobs[0].paymentFinalPrice, 1500);
  assert.equal(result.jobs[0].effectiveShippingFeeText, '200円');
  assert.equal(result.jobs[0].bundleGroupId, 'bundle-a');
}

function testPaymentJobLimitRangeAndRandomSelection() {
  assert.deepEqual(getPaymentJobLimitRange({ payment_job_limit: '3' }), { min: 3, max: 3 });
  assert.deepEqual(getPaymentJobLimitRange({ payment_job_limit_min: '5', payment_job_limit_max: '2' }), { min: 2, max: 5 });
  assert.equal(randomIntInclusive(2, 5, () => 0), 2);
  assert.equal(randomIntInclusive(2, 5, () => 0.9999), 5);
}

function testNormalizeManualPinCodeKeepsDigitsOnly() {
  assert.equal(normalizeManualPinCode(' 12-34 56 '), '123456');
  assert.equal(normalizeManualPinCode('abc'), '');
  assert.equal(normalizeManualPinCode('123456789012345'), '123456789012');
}

function testBuildWindowsSendKeysScriptClicksPinBoxAndTypesDigitsOnly() {
  const script = buildWindowsSendKeysScript('123456');
  assert.match(script, /SetCursorPos/);
  assert.match(script, /mouse_event/);
  assert.match(script, /keybd_event/);
  assert.match(script, /matchedTitle=/);
  assert.match(script, /foregroundHandle=/);
  assert.match(script, /\$pin = '123456'/);
  assert.doesNotMatch(script, /123456;|\$pin = 123456/);
  assert.doesNotMatch(script, /\{ENTER\}|VK_RETURN|0x0D/);
}

async function testTypeManualPinWithSystemKeyboardUsesPowerShellNativeInput() {
  const calls = [];
  const result = await typeManualPinWithSystemKeyboard('123456', {
    platform: 'win32',
    execFileImpl(file, args, options, callback) {
      calls.push({ file, args, options });
      callback(null, 'typed=6; clicked=True; activated=True; matchedTitle=Yahoo; foregroundHandle=123', '');
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.digits, 6);
  assert.equal(result.stdout, 'typed=6; clicked=True; activated=True; matchedTitle=Yahoo; foregroundHandle=123');
  assert.equal(calls[0].file, 'powershell.exe');
  assert.equal(calls[0].args.includes('-STA'), true);
  assert.equal(calls[0].args.includes('-Command'), true);
  assert.equal(calls[0].options.windowsHide, true);
}

async function testPluginDiagnosticsSaveAndQuery() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: 1 };
    },
    async getAll(sql, params) {
      calls.push({ type: 'getAll', sql, params });
      return [
        {
          id: 1,
          type: 'trusted_input',
          level: 'error',
          product_id: 'd1233443897',
          order_id: 148,
          action: 'bundle:start',
          method: 'debuggerMouse',
          message: 'bundle start next page did not appear',
          diagnostics: 'method=debuggerMouse,url=https://contact.auctions.yahoo.co.jp/buyer/top?aid=d1233443897',
          url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=d1233443897',
          created_at: '2026-06-19 01:02:03'
        }
      ];
    }
  };

  const saved = await savePluginDiagnostic(fakeDb, {
    type: 'trusted_input',
    level: 'error',
    productId: 'D1233443897',
    orderId: 148,
    action: 'bundle:start',
    method: 'debuggerMouse',
    message: 'bundle start next page did not appear',
    diagnostics: 'x'.repeat(4000),
    url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=d1233443897'
  });
  const queried = await getPluginDiagnostics(fakeDb, {
    productId: 'D1233443897',
    type: 'trusted_input',
    limit: 20
  });

  assert.equal(saved.inserted, 1);
  assert.match(calls[0].sql, /INSERT INTO plugin_diagnostics/);
  assert.equal(calls[0].params[2], 'd1233443897');
  assert.equal(calls[0].params[3], 148);
  assert.equal(calls[0].params[7].length, 3000);
  assert.match(calls[1].sql, /WHERE product_id = \? AND type = \?/);
  assert.deepEqual(calls[1].params, ['d1233443897', 'trusted_input', 20]);
  assert.equal(queried.total, 1);
}

async function testEnsureScheduledTransactionStartRequestSetsFlagWhenHourReached() {
  const queries = [];
  const fakeDb = {
    async getAll(sql) {
      assert.match(sql, /transaction_start_hour/);
      return [
        { key: 'transaction_start_hour', value: '0' },
        { key: 'transaction_start_requested', value: '0' },
        { key: 'transaction_start_last_run_date', value: '2026-06-05' }
      ];
    },
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await ensureScheduledTransactionStartRequest(fakeDb, Date.parse('2026-06-06T00:15:00+08:00'));

  assert.equal(result.updated, true);
  assert.equal(result.transactionStartRequested, 1);
  assert.equal(queries.length, 2);
  assert.equal(queries[0].params[0], 'transaction_start_requested');
  assert.equal(queries[0].params[1], '1');
  assert.equal(queries[1].params[0], 'transaction_start_requested_source');
  assert.equal(queries[1].params[1], 'auto');
}

async function testEnsureScheduledTransactionStartRequestWaitsOneMinuteAfterHour() {
  const queries = [];
  const fakeDb = {
    async getAll(sql) {
      assert.match(sql, /transaction_start_hour/);
      return [
        { key: 'transaction_start_hour', value: '0' },
        { key: 'transaction_start_requested', value: '0' },
        { key: 'transaction_start_last_run_date', value: '2026-06-05' }
      ];
    },
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const before = await ensureScheduledTransactionStartRequest(fakeDb, Date.parse('2026-06-06T00:00:30+08:00'));
  assert.equal(before.updated, false);
  assert.equal(queries.length, 0);

  const after = await ensureScheduledTransactionStartRequest(fakeDb, Date.parse('2026-06-06T00:01:00+08:00'));
  assert.equal(after.updated, true);
  assert.equal(queries.length, 2);
}

async function testEnsureScheduledTransactionStartRequestDoesNotBackfillPastChangedHour() {
  const queries = [];
  const fakeDb = {
    async getAll(sql) {
      assert.match(sql, /transaction_start_hour/);
      return [
        { key: 'transaction_start_hour', value: '2', updated_at: '2026-06-07T10:00:00+08:00' },
        { key: 'transaction_start_requested', value: '0' },
        { key: 'transaction_start_last_run_slot', value: '2026-06-07-09' }
      ];
    },
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await ensureScheduledTransactionStartRequest(fakeDb, Date.parse('2026-06-07T10:01:00+08:00'));

  assert.equal(result.updated, false);
  assert.equal(queries.length, 0);
}

async function testEnsureScheduledConfirmReceiptRequestSetsFlagAtDefault1801() {
  const queries = [];
  const fakeDb = {
    async getAll(sql) {
      assert.match(sql, /confirm_receipt_hour/);
      return [
        { key: 'confirm_receipt_requested', value: '0' }
      ];
    },
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const before = await ensureScheduledConfirmReceiptRequest(fakeDb, Date.parse('2026-06-07T18:00:30+08:00'));
  assert.equal(before.updated, false);
  assert.equal(queries.length, 0);

  const after = await ensureScheduledConfirmReceiptRequest(fakeDb, Date.parse('2026-06-07T18:01:00+08:00'));
  assert.equal(after.updated, true);
  assert.equal(after.confirmReceiptRequested, 1);
  assert.equal(queries[0].params[0], 'confirm_receipt_requested');
  assert.equal(queries[0].params[1], '1');
  assert.equal(queries[1].params[0], 'confirm_receipt_requested_source');
  assert.equal(queries[1].params[1], 'auto');
}

function testIdleActionUsesScanPaymentConfirmReceiptPriority() {
  const base = {
    transactionStartRequested: 0,
    transactionStartHour: 1,
    transactionStartLastRunSlot: '2026-06-07-01',
    confirmReceiptRequested: 1,
    scanStartHour: 1,
    scanEndHour: 23,
    scanEveryIdleRuns: 5,
    paymentRequested: 1,
    today: '2026-06-07',
    nowHour: 18
  };
  const nowMs = Date.parse('2026-06-07T18:02:00+08:00');

  assert.equal(getNextIdleAction({ ...base, scanIdleCounter: 5 }, nowMs).action, 'scan');
  assert.equal(getNextIdleAction({ ...base, scanIdleCounter: 2 }, nowMs).action, 'payment');
  assert.equal(getNextIdleAction({ ...base, scanIdleCounter: 2, paymentRequested: 0 }, nowMs).action, 'confirm_receipt');
}

async function testCompleteConfirmReceiptIncrementsScanCounter() {
  const queries = [];
  const fakeDb = {
    async getAll(sql) {
      if (/transaction_start_hour/.test(sql) && !/confirm_receipt_hour/.test(sql)) {
        return [
          { key: 'transaction_start_hour', value: '1', updated_at: '2026-06-07T00:00:00+08:00' },
          { key: 'transaction_start_requested', value: '0' },
          { key: 'transaction_start_last_run_slot', value: '2026-06-07-01' }
        ];
      }
      if (/confirm_receipt_hour/.test(sql) && !/transaction_start_hour/.test(sql)) {
        return [
          { key: 'confirm_receipt_hour', value: '18', updated_at: '2026-06-07T00:00:00+08:00' },
          { key: 'confirm_receipt_requested', value: '1' },
          { key: 'confirm_receipt_requested_source', value: 'manual' },
          { key: 'confirm_receipt_last_run_slot', value: '' }
        ];
      }
      return [
        { key: 'transaction_start_hour', value: '1', updated_at: '2026-06-07T00:00:00+08:00' },
        { key: 'transaction_start_requested', value: '0' },
        { key: 'transaction_start_last_run_slot', value: '2026-06-07-01' },
        { key: 'confirm_receipt_hour', value: '18' },
        { key: 'confirm_receipt_requested', value: '1' },
        { key: 'confirm_receipt_requested_source', value: 'manual' },
        { key: 'scan_every_idle_runs', value: '5' },
        { key: 'scan_idle_counter', value: '2' }
      ];
    },
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  await completeIdleAction('confirm_receipt', fakeDb, Date.parse('2026-06-07T18:02:00+08:00'));

  assert.deepEqual(queries.map(call => call.params[0]), [
    'confirm_receipt_requested',
    'confirm_receipt_requested_source',
    'scan_idle_counter'
  ]);
  assert.equal(queries[2].params[1], '3');
}

async function testUpdateConfirmReceiptStatusCompletesBundleGroup() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ type: 'getAll', sql, params });
      return [
        { order_id: 31, old_status: 'pending_receipt', product_id: 'm1' },
        { order_id: 32, old_status: 'bundle_completed', product_id: 'm2' }
      ];
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: 2 };
    }
  };

  const result = await updateConfirmReceiptStatus({ orderId: 31, status: 'success', bundleGroupId: 'bundle-1' }, fakeDb);

  assert.equal(result.updated, 2);
  const updateCall = calls.find(call => call.type === 'query');
  assert.match(updateCall.sql, /bundle_group_id = \?/);
  assert.match(updateCall.sql, /order_status = \?/);
  assert.equal(updateCall.params[0], 'completed');
  assert.equal(updateCall.params[1], 'bundle-1');
}

async function testGetConfirmReceiptJobsIncludesPendingPaymentAndSettlementCancelChecks() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ sql, params });
      if (/FROM config/.test(sql)) return [{ key: 'confirm_receipt_color', value: '#ffff00' }];
      return [
        {
          order_id: 41,
          order_status: ORDER_STATUS_PENDING_RECEIPT,
          transaction_url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=r111111111',
          bundle_group_id: '',
          product_id: 'r111111111',
          product_url: 'https://auctions.yahoo.co.jp/jp/auction/r111111111',
          product_title: 'receipt item',
          product_type: 'normal'
        },
        {
          order_id: 42,
          order_status: ORDER_STATUS_PENDING_PAYMENT,
          transaction_url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=p222222222',
          bundle_group_id: '',
          product_id: 'p222222222',
          product_url: 'https://auctions.yahoo.co.jp/jp/auction/p222222222',
          product_title: 'payment item',
          product_type: 'store'
        },
        {
          order_id: 43,
          order_status: ORDER_STATUS_PENDING_SETTLEMENT,
          transaction_url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=s333333333',
          bundle_group_id: '',
          product_id: 's333333333',
          product_url: 'https://auctions.yahoo.co.jp/jp/auction/s333333333',
          product_title: 'settlement item',
          product_type: 'store'
        }
      ];
    }
  };

  const result = await getConfirmReceiptJobs(fakeDb, {
    async findRowsByProductIdWithAnyColor(productId) {
      return { matched: productId === 'r111111111' };
    }
  });

  assert.match(calls[1].sql, /o\.order_status IN/);
  assert.deepEqual(calls[1].params, [
    ORDER_STATUS_PENDING_RECEIPT,
    ORDER_STATUS_PENDING_PAYMENT,
    ORDER_STATUS_PENDING_SETTLEMENT
  ]);
  assert.match(calls[1].sql, /LEFT JOIN products p ON p\.product_id = t\.product_id/);
  assert.match(calls[1].sql, /p\.product_url AS product_url/);
  assert.match(calls[1].sql, /p\.product_title AS product_title/);
  assert.match(calls[1].sql, /p\.product_type AS product_type/);
  assert.doesNotMatch(calls[1].sql, /t\.(product_url|product_title|product_type)/);
  assert.equal(result.jobs.length, 3);
  assert.equal(result.jobs[0].jobType, 'confirm_receipt');
  assert.equal(result.jobs[1].jobType, 'cancel_check');
  assert.equal(result.jobs[1].orderStatus, ORDER_STATUS_PENDING_PAYMENT);
  assert.equal(result.jobs[2].jobType, 'cancel_check');
  assert.equal(result.jobs[2].orderStatus, ORDER_STATUS_PENDING_SETTLEMENT);
}

async function testUpdateConfirmReceiptStatusMarksPaymentOrSettlementOrderCancelled() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ type: 'getAll', sql, params });
      return [{ order_id: 42, old_status: ORDER_STATUS_PENDING_PAYMENT, product_id: 'p222222222' }];
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: /UPDATE orders/.test(sql) ? 1 : 0 };
    }
  };

  const result = await updateConfirmReceiptStatus({ orderId: 42, productId: 'p222222222', status: 'cancelled' }, fakeDb);

  assert.equal(result.updated, 1);
  assert.equal(result.cancelled, true);
  const updateCall = calls.find(call => call.type === 'query' && /UPDATE orders/.test(call.sql));
  assert.equal(updateCall.params[0], ORDER_STATUS_CANCELLED);
  assert.equal(updateCall.params[1], 42);
  assert.equal(updateCall.params[2], ORDER_STATUS_PENDING_PAYMENT);
  assert.equal(updateCall.params[3], ORDER_STATUS_PENDING_SETTLEMENT);
  assert.equal(updateCall.params[4], ORDER_STATUS_PENDING_RECEIPT);
}

async function testUpdateConfirmReceiptStatusMarksPaidCancelCheckOrderPendingShipment() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ type: 'getAll', sql, params });
      return [{ order_id: 43, old_status: ORDER_STATUS_PENDING_SETTLEMENT, product_id: 'p222222222' }];
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: /UPDATE orders/.test(sql) ? 1 : 0 };
    }
  };

  const result = await updateConfirmReceiptStatus({ orderId: 43, productId: 'p222222222', status: 'pending_shipment' }, fakeDb);

  assert.equal(result.updated, 1);
  assert.equal(result.pendingShipment, true);
  const updateCall = calls.find(call => call.type === 'query' && /UPDATE orders/.test(call.sql));
  assert.equal(updateCall.params[0], ORDER_STATUS_PENDING_SHIPMENT);
  assert.equal(updateCall.params[1], 43);
  assert.equal(updateCall.params[2], ORDER_STATUS_PENDING_PAYMENT);
  assert.equal(updateCall.params[3], ORDER_STATUS_PENDING_SETTLEMENT);
}

async function testCompleteManualTransactionStartDoesNotWriteAutoRunDate() {
  const queries = [];
  const fakeDb = {
    async getAll(sql) {
      if (/confirm_receipt_requested/.test(sql) && !/transaction_start_requested_source/.test(sql)) return [];
      assert.match(sql, /transaction_start_requested_source/);
      return [
        { key: 'transaction_start_hour', value: '5' },
        { key: 'transaction_start_requested_source', value: 'manual' },
        { key: 'scan_every_idle_runs', value: '5' },
        { key: 'scan_idle_counter', value: '0' }
      ];
    },
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  await completeIdleAction('transaction_start', fakeDb, Date.parse('2026-06-06T03:00:00+08:00'));

  assert.deepEqual(queries.map(call => call.params[0]), [
    'transaction_start_requested',
    'transaction_start_requested_source'
  ]);
  assert.equal(queries.some(call => call.params[0] === 'transaction_start_last_run_date'), false);
}

async function testUpdatePaymentStatusSuccessAndEmptyQueue() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const success = await updatePaymentStatus({ orderId: 5, status: 'success' }, fakeDb);
  const empty = await updatePaymentStatus({ empty: true }, fakeDb);

  assert.equal(success.updated, 1);
  assert.match(calls[0].sql, /pending_shipment/);
  assert.equal(empty.paymentRequested, 0);
  assert.match(calls[1].sql, /INSERT OR REPLACE INTO config/);
  assert.equal(calls[1].params[0], 'payment_requested');
  assert.equal(calls[1].params[1], '0');
}

async function testUpdatePaymentStatusFailureWritesAlertAndClearsFlag() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await updatePaymentStatus({ orderId: 6, productId: 'p6', error: 'button not found' }, fakeDb);

  assert.equal(result.paymentRequested, 0);
  assert.match(calls[0].sql, /INSERT OR REPLACE INTO config/);
  assert.equal(calls[0].params[0], 'payment_requested');
  assert.equal(calls[0].params[1], '0');
  assert.match(calls[1].sql, /INSERT OR REPLACE INTO config/);
  assert.equal(calls[1].params[0], 'payment_alert_message');
  assert.match(calls[1].params[1], /p6/);
  assert.match(calls[1].params[1], /页面按钮未找到/);
}

function testSummarizePaymentErrorRemovesDebugDetails() {
  const raw = 'action=review; synthetic=success:click:確認する; trusted=success:debuggerMouse:確認する; wait=payment next page did not appear; url=https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017; controls=ファンキー？ モンキー？; candidates=[{"text":"確認する","rect":{"height":13}}]';
  const summary = summarizePaymentError(raw);

  assert.equal(summary, '确认付款后页面未跳转');
  assert.equal(summary.includes('https://'), false);
  assert.equal(summary.includes('controls='), false);
  assert.equal(summary.includes('candidates='), false);
  assert.equal(summary.includes('synthetic='), false);
  assert.equal(summary.includes('trusted='), false);
}

async function testUpdatePaymentStatusFailureWritesConciseAlert() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    }
  };
  const raw = 'action=review; synthetic=success:click:確認する; trusted=success:debuggerMouse:確認する; wait=payment next page did not appear; url=https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017; controls=Yahoo JAPAN Help Search; candidates=[{"text":"確認する"}]';

  await updatePaymentStatus({ orderId: 6, productId: 'j1232680017', error: raw }, fakeDb);

  const alert = calls[1].params[1];
  assert.match(alert, /j1232680017/);
  assert.match(alert, /确认付款后页面未跳转/);
  assert.equal(alert.includes('https://'), false);
  assert.equal(alert.includes('controls='), false);
  assert.equal(alert.includes('candidates='), false);
  assert.equal(alert.includes('synthetic='), false);
  assert.equal(alert.includes('trusted='), false);
  assert.ok(alert.length < 80);
}

async function testUpdatePaymentStatusMarksCancelled() {
  const calls = [];
  const fakeDb = {
    async getAll() {
      return [{ order_id: 8, old_status: ORDER_STATUS_PENDING_SETTLEMENT, product_id: 'u1231877298' }];
    },
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await updatePaymentStatus({
    orderId: 8,
    productId: 'u1231877298',
    status: 'cancelled'
  }, fakeDb);

  assert.equal(result.cancelled, true);
  const statusUpdate = calls.find(call => /UPDATE orders/.test(call.sql));
  assert.ok(statusUpdate);
  assert.equal(statusUpdate.params[0], ORDER_STATUS_CANCELLED);
  assert.equal(statusUpdate.params[1], 8);
  assert.equal(calls.some(call =>
    /INSERT OR REPLACE INTO config/.test(call.sql) &&
    call.params[0] === 'payment_requested' &&
    call.params[1] === '0'
  ), false);
}

async function testUpdatePaymentStatusRejectsInvalidStatusWithoutUpdating() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  await assert.rejects(
    () => updatePaymentStatus({ orderId: 5 }, fakeDb),
    error => {
      assert.equal(error.message, 'valid payment status is required');
      assert.equal(error.statusCode, 400);
      return true;
    }
  );
  await assert.rejects(
    () => updatePaymentStatus({ orderId: 5, status: 'failed' }, fakeDb),
    error => {
      assert.equal(error.message, 'valid payment status is required');
      assert.equal(error.statusCode, 400);
      return true;
    }
  );
  assert.equal(calls.length, 0);
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
testHeartbeatProcessingTaskOnlyRefreshesProcessingUpdatedAt();
testTaskSchemaIncludesBuyoutAutoPaid();
testClaimTaskForProcessingOnlyClaimsPendingTask();
Promise.resolve().then(testClaimReadyPluginTasksClaimsMultipleReadyTasks).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
testSweepPendingTasksIncludesProcessingResets();
testSyncBiddingItemsMarksHighestAndOutbidTasks();
testResolveOrderFinalPriceUsesYahooParsedPriceEvenWhenLowerThanMaxPrice();
testResolveOrderFinalPriceUsesYahooParsedPriceWhenHigherThanTaskPrice();
testResolveOrderFinalPriceReturnsNullWhenYahooPriceMissing();
testNormalizeYahooWonTimeTextInfersCurrentYear();
testNormalizeYahooWonTimeTextUsesPreviousYearForFutureMonthDay();
testShouldSplitDirectBidByYahooLowPriceRule();
testIdleActionChoosesTransactionStartBeforeScan();
testManualScanRequestBypassesScanWindow();
testTransactionStartReadyOneMinuteAfterConfiguredHour();
testTransactionStartScheduleFollowsChangedHourSlots();
testPaymentIdleActionUsesFlagAfterScanPriority();
testIdleActionUsesScanPaymentConfirmReceiptPriority();
testScanCounterClearsAfterThresholdWhenScanDoesNotRun();
testIsFollowupTaskReady();
testNormalizeManualPinCodeKeepsDigitsOnly();
testBuildWindowsSendKeysScriptClicksPinBoxAndTypesDigitsOnly();
testSummarizePaymentErrorRemovesDebugDetails();
Promise.all([
  testSyncBiddingItemsStoresRemainingTimeText(),
  testSyncBiddingItemsDoesNotOverwriteProductIdentityFields(),
  testSyncBiddingItemsConvertsTaxIncludedListPriceToTaxExcluded(),
  testProcessPendingFollowupTasksCreatesDirectTaskAndClearsMarker(),
  testProcessPendingFollowupTasksConvertsTaxIncludedMaxPriceToTaxExcluded(),
  testProcessPendingFollowupTasksSkipsWhenAlreadyHasFollowup(),
  testProcessPendingFollowupTasksSkipsWhenCurrentPriceStillBelowThreshold(),
  testGetTransactionStartJobsHandlesStoreAndMissingUrl(),
  testGetTransactionStartJobsCanIncludeAfterCutoffForManualRun(),
  testGetMultiBidConfigDoesNotExposeIdleBidGuard(),
  testSaveTransactionStartRunLogWritesJsonConfig(),
  testUpdateTransactionStartStatusUpdatesBundleByProductIds(),
  testUpdateTransactionStartStatusMarksOrderCancelled(),
  testSyncYahooWonOrdersContinuesAfterExistingAndCreatesWonOrder(),
  testSyncYahooWonOrdersMarksStoreProductTypeWithoutTaxType(),
  testSyncYahooWonOrdersUsesWonPageAsSourceOfTruthForFailedTask(),
  testSyncYahooWonOrdersCreatesOrderFromFailedTaskWhenWonPageHasProduct(),
  testSyncYahooWonOrdersDoesNotDuplicateExistingProductOrder(),
  testUpsertOrderFromTaskUsesExistingProductOrder(),
  testSyncYahooWonOrdersUpdatesExistingFinalPriceWithCoalesce(),
  testSyncYahooWonOrdersMovesExistingPendingShipmentWithTrackingToPendingReceipt(),
  testSyncYahooWonOrdersKeepsForcedResyncWhenPriceMissing(),
  testGetScanJobsReturnsWaitingShippingOnly(),
  testGetScanJobsReturnsTrackingRescanAsPendingShipment(),
  testUpdateScanStatusMarksPendingShipmentAsShipped(),
  testUpdateScanStatusDropsTrackingUrlLabelAsShippingCompany(),
  testUpdateScanStatusStripsShippingMethodLabelFromCompany(),
  testUpdateScanStatusRefreshesTrackingForRescanOrder(),
  Promise.resolve().then(testBuildDaipaiSheetRowUsesBundleShippingForTotalAndPayable),
  Promise.resolve().then(testBuildDaipaiSheetRowAppendsOrderRemarkAfterTrackingNumber),
  Promise.resolve().then(testBuildDaipaiSheetRowFallsBackToProductIdForGoogleMatching),
  testGetOrdersForSheetAppendReturnsWholeBundleGroup(),
  testGetOrderForSheetUpdateUsesProductSnapshotFields(),
  testUpdateScanStatusMarksPendingShipmentAsCancelled(),
  testUpdateScanStatusWritesShippingAndPendingPayment(),
  testUpdateScanStatusKeepsWaitingShippingWhenShippingPending(),
  testUpdateScanStatusCompletesBundleGroupWithShippingFee(),
  testUpdateScanStatusCompletesBundleGroupWithNonNumericShippingFee(),
  testUpdateScanStatusRejectsBundleGroupToEmptyStatus(),
  testGetPaymentJobsReturnsPendingSettlementWithPayable(),
  testGetPaymentJobsIncludesBundleFinalPriceTotal(),
  Promise.resolve().then(testPaymentJobLimitRangeAndRandomSelection),
  testManualOrderImportCompletesWithoutClearingScanCounter(),
  testYahooMessageCompletesWithoutClearingScanCounter(),
  testEnsureScheduledTransactionStartRequestSetsFlagWhenHourReached(),
  testEnsureScheduledTransactionStartRequestWaitsOneMinuteAfterHour(),
  testEnsureScheduledTransactionStartRequestDoesNotBackfillPastChangedHour(),
  testEnsureScheduledConfirmReceiptRequestSetsFlagAtDefault1801(),
  testCompleteConfirmReceiptIncrementsScanCounter(),
  testGetConfirmReceiptJobsIncludesPendingPaymentAndSettlementCancelChecks(),
  testUpdateConfirmReceiptStatusCompletesBundleGroup(),
  testUpdateConfirmReceiptStatusMarksPaymentOrSettlementOrderCancelled(),
  testUpdateConfirmReceiptStatusMarksPaidCancelCheckOrderPendingShipment(),
  testCompleteManualTransactionStartDoesNotWriteAutoRunDate(),
  testUpdatePaymentStatusSuccessAndEmptyQueue(),
  testUpdatePaymentStatusFailureWritesAlertAndClearsFlag(),
  testUpdatePaymentStatusFailureWritesConciseAlert(),
  testUpdatePaymentStatusMarksCancelled(),
  testUpdatePaymentStatusRejectsInvalidStatusWithoutUpdating(),
  testTypeManualPinWithSystemKeyboardUsesPowerShellNativeInput(),
  testPluginDiagnosticsSaveAndQuery()
]).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
