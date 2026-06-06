const assert = require('assert/strict');
const {
  getStrategyLeadMs,
  isTaskReadyForDispatch,
  chooseNextPluginTask,
  isTaskNeedingEndTimeRefresh,
  expireOverduePendingTasks,
  failPricedOutPendingTasks,
  resetStaleProcessingTasks,
  claimTaskForProcessing,
  sweepPendingTasks,
  getMultiBidStartMs,
  getMultiBidIntervalMs,
  getIdleBidGuardMs,
  getNextTaskDispatchMs,
  hasTaskWithinIdleGuard,
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
  completeIdleAction,
  getTransactionStartJobs,
  saveTransactionStartRunLog,
  updateTransactionStartStatus,
  syncYahooWonOrders,
  getScanJobs,
  updateScanStatus,
  buildDaipaiSheetRow,
  getOrdersForSheetAppend,
  getPaymentJobs,
  updatePaymentStatus,
  randomIntInclusive,
  getPaymentJobLimitRange,
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

function testIdleGuardBlocksNearFutureBidTasks() {
  const config = { idleBidGuardMinutes: 10 };
  assert.equal(getIdleBidGuardMs(config), 10 * 60 * 1000);
  assert.equal(getNextTaskDispatchMs({
    id: 1,
    strategy: '10min',
    end_time: minutesFromNow(19),
    created_at: minutesFromNow(-10)
  }, now, config), now + 9 * 60 * 1000);
  assert.equal(hasTaskWithinIdleGuard([{
    id: 1,
    strategy: '10min',
    end_time: minutesFromNow(19),
    created_at: minutesFromNow(-10)
  }], now, config), true);
  assert.equal(hasTaskWithinIdleGuard([{
    id: 2,
    strategy: '10min',
    end_time: minutesFromNow(21),
    created_at: minutesFromNow(-10)
  }], now, config), false);
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
  assert.match(calls[0].sql, /status = 'bidding' AND strategy = 'multi_bid'/);
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
  assert.equal(calls[1].params[5], 'highest');
  assert.match(calls[2].sql, /is_highest_bidder = 1/);
  assert.match(calls[2].sql, /status = 'bidding'/);
  assert.doesNotMatch(calls[2].sql, /product_title\s*=/);
  assert.equal(calls[2].params.at(-1), 'a123456789');
  assert.match(calls[4].sql, /is_highest_bidder = 0/);
  assert.equal(calls[4].params.at(-1), 'b123456789');
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
  // /my/bidding 鍒楄〃"鐝惧湪 脳脳鍐?瀵瑰晢鍩庡晢鍝佹槸绋庡悗鍊硷紝鍐欏叆 bidding_items 鏃跺簲鎶樺洖绋庡墠銆?
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
      return { tax_type: 'tax_included' };
    }
  };

  await syncBiddingItems([
    { productId: 'a123456789', title: 'A', price: '189,431', url: 'https://auctions.yahoo.co.jp/jp/auction/a123456789', status: 'highest' }
  ], fakeDb);

  // INSERT INTO bidding_items 鐨?current_price 鍙傛暟锛堢 5 涓紝0-indexed=4锛夊簲璇ユ槸鎶樺洖绋庡墠鐨?172,210
  const insertCall = calls.find(c => /INSERT INTO bidding_items/.test(c.sql));
  assert.equal(insertCall.params[4], 172210);
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
  // 鏅€氬晢鍝侊紙绋庡墠=绋庡悗锛?
  // 绋庡墠褰撳墠浠?1000 + 绋庡墠鍑轰环>10000锛岃Е鍙?
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 500, submitMaxPrice: 15000, taxType: 'tax_zero'
  }), true);
  // 褰撳墠浠?=1000锛屼笉瑙﹀彂
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 1000, submitMaxPrice: 15000, taxType: 'tax_zero'
  }), false);
  // 绋庡墠鍑轰环涓嶈秴杩?0000锛屼笉瑙﹀彂
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 500, submitMaxPrice: 10000, taxType: 'tax_zero'
  }), false);
  // 闈?direct 绛栫暐涓嶈Е鍙?
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'multi_bid', bidMode: 'bid', currentPrice: 500, submitMaxPrice: 15000, taxType: 'tax_zero'
  }), false);
  // buyout 妯″紡涓嶈Е鍙?
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'buyout', currentPrice: 500, submitMaxPrice: 15000, taxType: 'tax_zero'
  }), false);
  // 褰撳墠浠锋湭鐭ワ紙0/null锛夋寜"浣庝簬 1000"澶勭悊瑙﹀彂锛岄伩鍏嶆紡鍒?
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 0, submitMaxPrice: 15000, taxType: 'tax_zero'
  }), true);

  // 鍟嗗煄鍟嗗搧锛坈urrent_price 鏄◣鍓嶏紱submitMaxPrice 鏄◣鍚庯級
  // 鐢ㄦ埛杈撳叆绋庡墠 9100 鈫?effectiveMaxPrice 绋庡悗 10010锛屼絾绋庡墠 9100 鈮?10000锛屼笉瑙﹀彂
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 1, submitMaxPrice: 10010, taxType: 'tax_included'
  }), false);
  // 鐢ㄦ埛杈撳叆绋庡墠 11000 鈫?effectiveMaxPrice 绋庡悗 12100锛岀◣鍓?11000 > 10000锛岃Е鍙?
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 1, submitMaxPrice: 12100, taxType: 'tax_included'
  }), true);
  // 鍟嗗煄鍟嗗搧 current_price=1000锛堢◣鍓嶏級锛屽埌杈圭晫锛屼笉瑙﹀彂
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 1000, submitMaxPrice: 15000, taxType: 'tax_included'
  }), false);
  // 鍟嗗煄鍟嗗搧 current_price=999锛堢◣鍓嶏級锛屼綆浜?1000锛岃Е鍙?
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 999, submitMaxPrice: 15000, taxType: 'tax_included'
  }), true);
  // 杈圭晫锛氱◣鍓嶅嚭浠锋濂?10000锛堢◣鍚?11000锛夛紝涓嶈Е鍙?
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 1, submitMaxPrice: 11000, taxType: 'tax_included'
  }), false);
}

function testIdleActionChoosesTransactionStartBeforeScan() {
  assert.equal(ORDER_STATUS_PENDING_PAYMENT, 'pending_payment');
  assert.equal(ORDER_STATUS_WAITING_SHIPPING, 'waiting_shipping');
  assert.equal(ORDER_STATUS_PENDING_BUNDLE, 'pending_bundle');
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
    transactionStartLastRunDate: '2026-06-01',
    scanIdleCounter: 5,
    scanEveryIdleRuns: 5,
    scanStartHour: 1,
    scanEndHour: 20,
    nowHour: 10,
    today: '2026-06-01'
  }).action, 'scan');
}

function testPaymentIdleActionUsesFlagAfterScanPriority() {
  assert.equal(DEFAULT_PAYMENT_JOB_LIMIT, 3);
  assert.equal(DEFAULT_PAYMENT_PAGE_STAY_SECONDS, 3);
  assert.equal(ORDER_STATUS_PENDING_SETTLEMENT, 'pending_settlement');
  assert.equal(ORDER_STATUS_PENDING_SHIPMENT, 'pending_shipment');
  assert.equal(getNextIdleAction({
    transactionStartHour: 1,
    transactionStartLastRunDate: '2026-06-03',
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
    transactionStartLastRunDate: '2026-06-03',
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
}

function testIsFollowupTaskReady() {
  // 褰撳墠浠?=1200 涓斾换鍔℃湭缁撴潫锛屽彲瑙﹀彂
  assert.equal(isFollowupTaskReady({
    pending_followup_max_price: 20000,
    current_price: 1200,
    status: 'bidding',
    end_time: minutesFromNow(60)
  }, now), true);
  // 褰撳墠浠蜂粛<1200锛堝嵆浣?1000锛夛紝涓嶈Е鍙戯紝缁曞紑绋庡墠/绋庡悗宸紓
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
  // 鏍囪宸叉竻绌?
  assert.equal(isFollowupTaskReady({
    pending_followup_max_price: null,
    current_price: 2000,
    status: 'bidding'
  }, now), false);
  // 浠诲姟宸茬粨鏉?
  assert.equal(isFollowupTaskReady({
    pending_followup_max_price: 20000,
    current_price: 2000,
    status: 'bidding',
    end_time: minutesFromNow(-10)
  }, now), false);
  // 浠诲姟宸?success / failed锛屼笉鍐嶈拷鍔?
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
  // 妫€鏌ュ叧閿瓧娈典綅缃細user_id=7, product_id, ...
  assert.equal(queries[1].params[0], 7);
  assert.equal(queries[1].params[1], 'a123456789');
  // tax_zero 鍟嗗搧锛歮ax_price / user_max_price 閮芥槸 20000
  assert.equal(queries[1].params[9], 20000);
  assert.equal(queries[1].params[10], 20000);
  // client_request_id 鐢?followup-{id}
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
        pending_followup_max_price: 12100,
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
  // 鍚◣鍟嗗搧鍙ｅ緞锛歶ser_max_price 鏄惈绋庡€?12100锛宮ax_price 鏄櫎绋庡€?11000
  assert.equal(insertParams[9], 11000); // max_price
  assert.equal(insertParams[10], 12100); // user_max_price
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
      // 宸插瓨鍦ㄥ悓 client_request_id 鐨勪换鍔?
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
        // 1100 楂樹簬 Yahoo 瑙勫垯 1000锛屼絾浠嶄綆浜?followup 闃堝€?1200锛岀粫寮€绋庡墠/绋庡悗宸紓
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
  assert.match(queries[0].sql, /datetime\(COALESCE\(o\.won_at, o\.created_at\)\) < datetime\('now', 'start of day', \?\)/);
  assert.doesNotMatch(queries[0].sql, /SELECT t2\.shipping_fee_text/);
  assert.deepEqual(queries[0].params, [0, '+1 hours']);
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
  assert.deepEqual(calls[0].params, [1, '+3 hours']);
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

async function testSyncYahooWonOrdersContinuesAfterExistingAndRecoversFailedTask() {
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
      if (/SELECT id FROM orders WHERE task_id/.test(sql)) return existingOrders.get(params[0]) || null;
      if (/SELECT \* FROM tasks WHERE id/.test(sql)) return taskRows.get(params[0]) || null;
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
  assert.match(taskSelects[0].sql, /'failed'/);
  const statusUpdate = calls.find(call => call.type === 'query' && /UPDATE tasks/.test(call.sql));
  assert.equal(statusUpdate.params[0], 110);
  const orderInsert = calls.find(call => call.type === 'query' && /INSERT INTO orders/.test(call.sql));
  assert.equal(orderInsert.params[0], 110);
  assert.equal(orderInsert.params[3], 350);
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
  assert.equal(calls[0].params[1], ORDER_STATUS_WAITING_SHIPPING);
  assert.equal(calls[0].params[2], ORDER_STATUS_PENDING_BUNDLE);
  assert.equal(calls[0].params[3], ORDER_STATUS_PENDING_SHIPMENT);
  assert.equal(result.total, 1);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].orderId, 11);
  assert.equal(result.jobs[0].productId, 'm111111111');
  assert.equal(result.jobs[0].orderStatus, ORDER_STATUS_WAITING_SHIPPING);
  assert.equal(result.jobs[0].transactionUrl, 'https://contact.auctions.yahoo.co.jp/seller/top?aid=m111111111');
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

function testBuildDaipaiSheetRowUsesBundleShippingForTotalAndPayable() {
  const row = buildDaipaiSheetRow({
    won_at: '2026-06-06 12:34:56',
    username: 'user-a',
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
    '628620458093'
  ]);
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
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await updateScanStatus({ orderId: 11, shippingFeeText: '1,060\u5186' }, fakeDb);

  assert.equal(result.updated, 1);
  assert.equal(result.shippingFeeText, '1060\u5186');
  assert.match(queries[0].sql, /UPDATE tasks/);
  assert.match(queries[0].sql, /WHERE id = \(/);
  assert.doesNotMatch(queries[0].sql, /product_id = \(/);
  assert.match(queries[0].sql, /SELECT task_id/);
  assert.equal(queries[0].params[0], '1060\u5186');
  assert.equal(queries[0].params[1], 11);
  assert.match(queries[1].sql, /UPDATE orders/);
  assert.equal(queries[1].params[0], ORDER_STATUS_PENDING_PAYMENT);
  assert.equal(queries[1].params[1], 11);
  assert.equal(queries[1].params[2], ORDER_STATUS_WAITING_SHIPPING);
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
      assert.match(sql, /ORDER BY datetime\(COALESCE\(o\.won_at, o\.created_at\)\) ASC, o\.id ASC/);
      assert.equal(params[0], 'pending_settlement');
      assert.equal(params[1], 4);
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

function testPaymentJobLimitRangeAndRandomSelection() {
  assert.deepEqual(getPaymentJobLimitRange({ payment_job_limit: '3' }), { min: 3, max: 3 });
  assert.deepEqual(getPaymentJobLimitRange({ payment_job_limit_min: '5', payment_job_limit_max: '2' }), { min: 2, max: 5 });
  assert.equal(randomIntInclusive(2, 5, () => 0), 2);
  assert.equal(randomIntInclusive(2, 5, () => 0.9999), 5);
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

async function testCompleteManualTransactionStartDoesNotWriteAutoRunDate() {
  const queries = [];
  const fakeDb = {
    async getAll(sql) {
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
  assert.match(calls[1].params[1], /button not found/);
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
testIdleGuardBlocksNearFutureBidTasks();
testExpireOverduePendingTasksMarksOnlyExpiredPendingTasksFailed();
testFailPricedOutPendingTasksMarksCurrentPriceAboveMaxFailed();
testResetStaleProcessingTasksReturnsOldProcessingToPending();
testClaimTaskForProcessingOnlyClaimsPendingTask();
testSweepPendingTasksIncludesProcessingResets();
testSyncBiddingItemsMarksHighestAndOutbidTasks();
testResolveOrderFinalPriceUsesYahooParsedPriceEvenWhenLowerThanMaxPrice();
testResolveOrderFinalPriceUsesYahooParsedPriceWhenHigherThanTaskPrice();
testResolveOrderFinalPriceReturnsNullWhenYahooPriceMissing();
testNormalizeYahooWonTimeTextInfersCurrentYear();
testNormalizeYahooWonTimeTextUsesPreviousYearForFutureMonthDay();
testShouldSplitDirectBidByYahooLowPriceRule();
testIdleActionChoosesTransactionStartBeforeScan();
testPaymentIdleActionUsesFlagAfterScanPriority();
testScanCounterClearsAfterThresholdWhenScanDoesNotRun();
testIsFollowupTaskReady();
Promise.all([
  testSyncBiddingItemsConvertsTaxIncludedListPriceToTaxExcluded(),
  testProcessPendingFollowupTasksCreatesDirectTaskAndClearsMarker(),
  testProcessPendingFollowupTasksConvertsTaxIncludedMaxPriceToTaxExcluded(),
  testProcessPendingFollowupTasksSkipsWhenAlreadyHasFollowup(),
  testProcessPendingFollowupTasksSkipsWhenCurrentPriceStillBelowThreshold(),
  testGetTransactionStartJobsHandlesStoreAndMissingUrl(),
  testGetTransactionStartJobsCanIncludeAfterCutoffForManualRun(),
  testSaveTransactionStartRunLogWritesJsonConfig(),
  testUpdateTransactionStartStatusUpdatesBundleByProductIds(),
  testSyncYahooWonOrdersContinuesAfterExistingAndRecoversFailedTask(),
  testGetScanJobsReturnsWaitingShippingOnly(),
  testUpdateScanStatusMarksPendingShipmentAsShipped(),
  Promise.resolve().then(testBuildDaipaiSheetRowUsesBundleShippingForTotalAndPayable),
  testGetOrdersForSheetAppendReturnsWholeBundleGroup(),
  testUpdateScanStatusMarksPendingShipmentAsCancelled(),
  testUpdateScanStatusWritesShippingAndPendingPayment(),
  testUpdateScanStatusKeepsWaitingShippingWhenShippingPending(),
  testUpdateScanStatusCompletesBundleGroupWithShippingFee(),
  testUpdateScanStatusRejectsBundleGroupToEmptyStatus(),
  testGetPaymentJobsReturnsPendingSettlementWithPayable(),
  Promise.resolve().then(testPaymentJobLimitRangeAndRandomSelection),
  testEnsureScheduledTransactionStartRequestSetsFlagWhenHourReached(),
  testCompleteManualTransactionStartDoesNotWriteAutoRunDate(),
  testUpdatePaymentStatusSuccessAndEmptyQueue(),
  testUpdatePaymentStatusFailureWritesAlertAndClearsFlag(),
  testUpdatePaymentStatusRejectsInvalidStatusWithoutUpdating()
]).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
