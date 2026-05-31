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
  getIdleBidGuardMs,
  getNextTaskDispatchMs,
  hasTaskWithinIdleGuard,
  isMultiBidTask,
  syncBiddingItems,
  resolveOrderFinalPrice,
  normalizeYahooWonTimeText,
  shouldSplitDirectBidByYahooLowPriceRule,
  isFollowupTaskReady,
  processPendingFollowupTasks
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
  // /my/bidding 列表"現在 ××円"对商城商品是税后值，写入 bidding_items 时应折回税前。
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

  // INSERT INTO bidding_items 的 current_price 参数（第 5 个，0-indexed=4）应该是折回税前的 172,210
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
  // 普通商品（税前=税后）
  // 税前当前价<1000 + 税前出价>10000，触发
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 500, submitMaxPrice: 15000, taxType: 'tax_zero'
  }), true);
  // 当前价>=1000，不触发
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 1000, submitMaxPrice: 15000, taxType: 'tax_zero'
  }), false);
  // 税前出价不超过10000，不触发
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 500, submitMaxPrice: 10000, taxType: 'tax_zero'
  }), false);
  // 非 direct 策略不触发
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'multi_bid', bidMode: 'bid', currentPrice: 500, submitMaxPrice: 15000, taxType: 'tax_zero'
  }), false);
  // buyout 模式不触发
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'buyout', currentPrice: 500, submitMaxPrice: 15000, taxType: 'tax_zero'
  }), false);
  // 当前价未知（0/null）按"低于 1000"处理触发，避免漏判
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 0, submitMaxPrice: 15000, taxType: 'tax_zero'
  }), true);

  // 商城商品（current_price 是税前；submitMaxPrice 是税后）
  // 用户输入税前 9100 → effectiveMaxPrice 税后 10010，但税前 9100 ≤ 10000，不触发
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 1, submitMaxPrice: 10010, taxType: 'tax_included'
  }), false);
  // 用户输入税前 11000 → effectiveMaxPrice 税后 12100，税前 11000 > 10000，触发
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 1, submitMaxPrice: 12100, taxType: 'tax_included'
  }), true);
  // 商城商品 current_price=1000（税前），到边界，不触发
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 1000, submitMaxPrice: 15000, taxType: 'tax_included'
  }), false);
  // 商城商品 current_price=999（税前），低于 1000，触发
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 999, submitMaxPrice: 15000, taxType: 'tax_included'
  }), true);
  // 边界：税前出价正好 10000（税后 11000），不触发
  assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
    strategy: 'direct', bidMode: 'bid', currentPrice: 1, submitMaxPrice: 11000, taxType: 'tax_included'
  }), false);
}

function testIsFollowupTaskReady() {
  // 当前价>=1200 且任务未结束，可触发
  assert.equal(isFollowupTaskReady({
    pending_followup_max_price: 20000,
    current_price: 1200,
    status: 'bidding',
    end_time: minutesFromNow(60)
  }, now), true);
  // 当前价仍<1200（即使>1000），不触发，绕开税前/税后差异
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
  // 标记已清空
  assert.equal(isFollowupTaskReady({
    pending_followup_max_price: null,
    current_price: 2000,
    status: 'bidding'
  }, now), false);
  // 任务已结束
  assert.equal(isFollowupTaskReady({
    pending_followup_max_price: 20000,
    current_price: 2000,
    status: 'bidding',
    end_time: minutesFromNow(-10)
  }, now), false);
  // 任务已 success / failed，不再追加
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
        shipping_fee_text: '送料 落札者負担',
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
  // tax_zero 商品：max_price / user_max_price 都是 20000
  assert.equal(queries[1].params[9], 20000);
  assert.equal(queries[1].params[10], 20000);
  // client_request_id 用 followup-{id}
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
  // 含税商品口径：user_max_price 是含税值 12100，max_price 是除税值 11000
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
      // 已存在同 client_request_id 的任务
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
        // 1100 高于 Yahoo 规则 1000，但仍低于 followup 阈值 1200，绕开税前/税后差异
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
testSweepPendingTasksIncludesProcessingResets();
testSyncBiddingItemsMarksHighestAndOutbidTasks();
testResolveOrderFinalPriceUsesYahooParsedPriceEvenWhenLowerThanMaxPrice();
testResolveOrderFinalPriceUsesYahooParsedPriceWhenHigherThanTaskPrice();
testResolveOrderFinalPriceReturnsNullWhenYahooPriceMissing();
testNormalizeYahooWonTimeTextInfersCurrentYear();
testNormalizeYahooWonTimeTextUsesPreviousYearForFutureMonthDay();
testShouldSplitDirectBidByYahooLowPriceRule();
testIsFollowupTaskReady();
Promise.all([
  testSyncBiddingItemsConvertsTaxIncludedListPriceToTaxExcluded(),
  testProcessPendingFollowupTasksCreatesDirectTaskAndClearsMarker(),
  testProcessPendingFollowupTasksConvertsTaxIncludedMaxPriceToTaxExcluded(),
  testProcessPendingFollowupTasksSkipsWhenAlreadyHasFollowup(),
  testProcessPendingFollowupTasksSkipsWhenCurrentPriceStillBelowThreshold()
]).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
