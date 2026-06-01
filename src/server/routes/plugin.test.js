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
  processPendingFollowupTasks,
  getNextIdleAction,
  getTransactionStartJobs,
  updateTransactionStartStatus,
  ORDER_STATUS_PENDING_PAYMENT,
  ORDER_STATUS_WAITING_SHIPPING,
  ORDER_STATUS_PENDING_BUNDLE
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
  assert.match(queries[0].sql, /datetime\(COALESCE\(o\.won_at, o\.created_at\)\) < datetime\('now', \?\)/);
  assert.doesNotMatch(queries[0].sql, /SELECT t2\.shipping_fee_text/);
  assert.deepEqual(queries[0].params, [0, 'start of day,+1 hours']);
  assert.equal(queries[1].params[0], ORDER_STATUS_PENDING_PAYMENT);
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
  assert.deepEqual(calls[0].params, [1, 'start of day,+3 hours']);
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
  assert.equal(calls[1].params[0], ORDER_STATUS_PENDING_BUNDLE);
  assert.equal(calls[1].params[1], 'bundle-20260601-c1133337781');
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
testIdleActionChoosesTransactionStartBeforeScan();
testIsFollowupTaskReady();
Promise.all([
  testSyncBiddingItemsConvertsTaxIncludedListPriceToTaxExcluded(),
  testProcessPendingFollowupTasksCreatesDirectTaskAndClearsMarker(),
  testProcessPendingFollowupTasksConvertsTaxIncludedMaxPriceToTaxExcluded(),
  testProcessPendingFollowupTasksSkipsWhenAlreadyHasFollowup(),
  testProcessPendingFollowupTasksSkipsWhenCurrentPriceStillBelowThreshold(),
  testGetTransactionStartJobsHandlesStoreAndMissingUrl(),
  testGetTransactionStartJobsCanIncludeAfterCutoffForManualRun(),
  testUpdateTransactionStartStatusUpdatesBundleByProductIds()
]).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
