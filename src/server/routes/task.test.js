const assert = require('assert/strict');
const {
  buildSubmitTaskInput,
  buildSubmitProductSnapshot,
  buildTaskListInput,
  buildActiveBiddingTaskListInput,
  buildWonTaskListInput,
  buildActiveBiddingTaskListQuery,
  buildWonStatsInput,
  buildWonStatsSummaryQuery,
  buildWonStatsExportQuery,
  calculateBidMaxPrice,
  normalizeProductType,
  getTaxIncludedPrice,
  resolveBuyoutTaskPrices,
  validateMultiBidUserMaxPrice,
  getMinMultiBidIncrement,
  getDefaultMultiBidIncrement,
  validateMultiBidIncrement,
  getRequiredBidMaxPrice,
  validateSubmitMeetsMinimumBidPrice,
  assertProductSubmissionOwner,
  isAutomaticStrategy,
  isActiveAutomaticStrategy,
  canCancelTask,
  assertNoActiveAutomaticStrategy,
  findTaskByClientRequestId,
  normalizeBidStrategyScope,
  assertBidStrategyAllowed,
  buildClientManualVerificationAlert
} = require('./task');
const {
  calculateWebsiteRate,
  clearWebsiteRateCache,
  getWebsiteRate,
  isWebsiteRateCacheValid,
  parseBocJpyCashSellRate
} = require('../services/websiteRate');

function testSubmitUsesAuthenticatedUserId() {
  const input = buildSubmitTaskInput(
    { id: 7 },
    {
      product_url: 'https://auctions.yahoo.co.jp/jp/auction/x1234567890',
      max_price: 1200,
      strategy: 'direct'
    }
  );

  assert.equal(input.userId, 7);
  assert.equal(input.productId, 'x1234567890');
  assert.equal(input.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/x1234567890');
  assert.equal(input.maxPrice, 1200);
  assert.equal(input.bidMode, 'bid');
}

function testBuildSubmitProductSnapshotUsesResolvedTaskProductFields() {
  const snapshot = buildSubmitProductSnapshot({
    input: {
      productId: 'a123456789',
      standardUrl: 'https://auctions.yahoo.co.jp/jp/auction/a123456789'
    },
    productInfo: {
      title: 'Fetched title',
      imageUrl: 'https://example.com/fetched.jpg',
      currentPrice: 900
    },
    productTitle: 'Submitted title',
    productImageUrl: '',
    currentPrice: 1200,
    buyoutPrice: 5000,
    bidCount: 2,
    resolvedTaxType: 'tax_included',
    resolvedProductType: 'store',
    shippingFeeText: '送料 500円',
    endTime: '2026-06-20T12:00:00+09:00'
  });

  assert.deepEqual(snapshot, {
    product_id: 'a123456789',
    product_url: 'https://auctions.yahoo.co.jp/jp/auction/a123456789',
    product_title: 'Submitted title',
    product_image_url: 'https://example.com/fetched.jpg',
    current_price: 1200,
    buyout_price: 5000,
    bid_count: 2,
    tax_type: 'tax_included',
    product_type: 'store',
    shipping_fee_text: '送料 500円',
    end_time: '2026-06-20T12:00:00+09:00'
  });
}

function testSubmitAcceptsBuyoutMode() {
  const input = buildSubmitTaskInput(
    { id: 7 },
    {
      product_url: 'https://auctions.yahoo.co.jp/jp/auction/x1234567890',
      max_price: 1200,
      bid_mode: 'buyout'
    }
  );

  assert.equal(input.bidMode, 'buyout');
}

function testClientManualVerificationAlertOnlyShowsPinForClientAdmin() {
  assert.deepEqual(
    buildClientManualVerificationAlert({ user_level: 3 }, { type: 'pin', id: 'pin-1' }),
    { show: true, message: '后端有事情要处理！', type: 'pin' }
  );
  assert.deepEqual(
    buildClientManualVerificationAlert({ user_level: 3 }, { type: 'captcha', id: 'captcha-1' }),
    { show: false, message: '', type: '' }
  );
  assert.deepEqual(
    buildClientManualVerificationAlert({ user_level: 1 }, { type: 'pin', id: 'pin-1' }),
    { show: false, message: '', type: '' }
  );
}

function testSubmitForcesBuyoutModeForBuyoutOnlyProducts() {
  const input = buildSubmitTaskInput(
    { id: 7 },
    {
      product_url: 'https://auctions.yahoo.co.jp/jp/auction/t1204059533',
      max_price: 2800,
      buyout_only: true
    }
  );

  assert.equal(input.bidMode, 'buyout');
}

function testSubmitAcceptsThirdPartyAndNumericAuctionUrls() {
  const thirdParty = buildSubmitTaskInput(
    { id: 7 },
    {
      product_url: 'https://www.fromjapan.co.jp/japan/cn/auction/yahoo/input/g1225234655/',
      max_price: 1200
    }
  );
  assert.equal(thirdParty.productId, 'g1225234655');
  assert.equal(thirdParty.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/g1225234655');

  const numeric = buildSubmitTaskInput(
    { id: 7 },
    {
      product_url: 'https://auctions.yahoo.co.jp/jp/auction/1229405242',
      max_price: 1200
    }
  );
  assert.equal(numeric.productId, '1229405242');
  assert.equal(numeric.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/1229405242');

  const paypay = buildSubmitTaskInput(
    { id: 7 },
    {
      product_url: 'https://paypayfleamarket.yahoo.co.jp/item/z562177666',
      max_price: 1200
    }
  );
  assert.equal(paypay.productId, 'z562177666');
  assert.equal(paypay.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/z562177666');

  const numericNine = buildSubmitTaskInput(
    { id: 7 },
    {
      product_url: 'https://example.com/item/562177666',
      max_price: 1200
    }
  );
  assert.equal(numericNine.productId, '562177666');
  assert.equal(numericNine.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/562177666');

  const letterEight = buildSubmitTaskInput(
    { id: 7 },
    {
      product_url: 'https://example.com/item/a12345678',
      max_price: 1200
    }
  );
  assert.equal(letterEight.productId, 'a12345678');
  assert.equal(letterEight.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/a12345678');

  const numericEight = buildSubmitTaskInput(
    { id: 7 },
    {
      product_url: 'https://example.com/item/12345678',
      max_price: 1200
    }
  );
  assert.equal(numericEight.productId, '12345678');
  assert.equal(numericEight.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/12345678');
}

function testSubmitRejectsMissingAuthenticatedUser() {
  assert.throws(
    () => buildSubmitTaskInput(null, {
      product_url: 'https://auctions.yahoo.co.jp/jp/auction/x1234567890',
      max_price: 1200
    }),
    /not logged in/
  );
}

function testTaskListUsesAuthenticatedUserId() {
  const input = buildTaskListInput({ id: 9 }, { page: '3', limit: '10' });
  assert.equal(input.userId, 9);
  assert.equal(input.limit, 10);
  assert.equal(input.offset, 20);
  assert.equal(input.page, 3);
}

function testWonTaskListUsesAuthenticatedUserIdAndCapsLimit() {
  const input = buildWonTaskListInput({ id: 9 }, { page: '3', limit: '999' });
  assert.equal(input.userId, 9);
  assert.equal(input.limit, 100);
  assert.equal(input.page, 3);
  assert.equal(input.offset, 200);
  assert.throws(() => buildWonTaskListInput(null, {}), /not logged in/);
}

function testActiveBiddingTaskListUsesAuthenticatedUserIdAndCapsLimit() {
  const input = buildActiveBiddingTaskListInput({ id: 9 }, { page: '2', limit: '999' });
  assert.equal(input.userId, 9);
  assert.equal(input.limit, 100);
  assert.equal(input.page, 2);
  assert.equal(input.offset, 100);
  assert.throws(() => buildActiveBiddingTaskListInput(null, {}), /not logged in/);
}

function testActiveBiddingQueryIncludesHighestAndOutbidStatuses() {
  const query = buildActiveBiddingTaskListQuery({ userId: 9, limit: 100 });

  assert.match(query.sql, /bi\.status IN \('highest', 'outbid'\)/);
  assert.match(query.sql, /bi\.status AS bidding_status/);
  assert.match(query.sql, /ORDER BY datetime\(t2\.created_at\) DESC, t2\.id DESC/);
  assert.match(query.sql, /LEFT JOIN products p ON p\.product_id = bi\.product_id/);
  assert.match(query.sql, /COALESCE\(p\.product_title, t\.product_title\) AS product_title/);
  assert.doesNotMatch(query.sql, /bi\.product_title/);
  assert.match(query.sql, /COALESCE\(p\.shipping_fee_text, t\.shipping_fee_text\) AS shipping_fee_text/);
  assert.match(query.sql, /AS product_type/);
  assert.match(query.sql, /CASE WHEN bi\.status = 'highest' THEN 1 ELSE 0 END AS is_highest_bidder/);
  assert.match(query.sql, /LIMIT \? OFFSET \?/);
  assert.deepEqual(query.params, [9, 9, 100, 0]);
}

function testProductTypeFallsBackToTaxLabel() {
  assert.equal(normalizeProductType('normal', 'tax_included'), 'normal');
  assert.equal(normalizeProductType('store', 'tax_zero'), 'store');
  assert.equal(normalizeProductType('', 'tax_zero'), 'normal');
  assert.equal(normalizeProductType('', 'tax_included'), 'store');
}

function testWonStatsInputDefaultsToThirtyDays() {
  const input = buildWonStatsInput({ id: 9 }, {});

  assert.equal(input.userId, 9);
  assert.equal(input.days, 30);
  assert.throws(() => buildWonStatsInput(null, {}), /not logged in/);
}

function testWonStatsQueriesUseWonDateAndExportFields() {
  const input = { userId: 9, days: 30 };
  const summary = buildWonStatsSummaryQuery(input);
  const exportQuery = buildWonStatsExportQuery(input);

  assert.match(summary.sql, /date\(COALESCE\(o\.won_at, t\.updated_at\), 'localtime'\) AS won_date/);
  assert.match(summary.sql, /SUM\(COALESCE\(o\.final_price, 0\)\) AS total_amount/);
  assert.doesNotMatch(summary.sql, /tax_included|final_price \* 1\.1/);
  assert.match(summary.sql, /COUNT\(\*\) AS item_count/);
  assert.deepEqual(summary.params, [9, 30]);

  assert.match(exportQuery.sql, /t\.product_id/);
  assert.match(exportQuery.sql, /LEFT JOIN products p ON p\.product_id = t\.product_id/);
  assert.match(exportQuery.sql, /COALESCE\(o\.product_title, p\.product_title, t\.product_title, ''\) AS product_title/);
  assert.match(exportQuery.sql, /o\.final_price/);
  assert.match(exportQuery.sql, /COALESCE\(p\.shipping_fee_text, t\.shipping_fee_text\) AS shipping_fee_text/);
  assert.match(exportQuery.sql, /o\.won_at/);
  assert.deepEqual(exportQuery.params, [9, 30]);
}

function testStoreUserMaxPriceConvertsToTaxExcludedBidMax() {
  assert.equal(calculateBidMaxPrice(1000, 'tax_included'), 909);
  assert.equal(calculateBidMaxPrice(1100, 'tax_included'), 1000);
  assert.equal(calculateBidMaxPrice(11103, 'tax_included'), 10093);
  assert.equal(calculateBidMaxPrice(9, 'tax_included'), 9);
  assert.equal(calculateBidMaxPrice(1000, 'tax_zero'), 1000);
}

function testStoreCurrentPriceDisplaysAsTaxIncluded() {
  assert.equal(getTaxIncludedPrice(1000, 'tax_included'), 1100);
  assert.equal(getTaxIncludedPrice(9, 'tax_included'), 9);
  assert.equal(getTaxIncludedPrice(1000, 'tax_zero'), 1000);
}

function testStoreBuyoutPriceIsAlreadyTaxIncluded() {
  assert.deepEqual(
    resolveBuyoutTaskPrices({
      fetchedBuyoutPrice: 2460,
      submittedBuyoutPrice: 0,
      inputMaxPrice: 2460,
      taxType: 'tax_included'
    }),
    {
      buyoutPrice: 2460,
      userMaxPrice: 2460,
      bidMaxPrice: 2236
    }
  );
  assert.deepEqual(
    resolveBuyoutTaskPrices({
      fetchedBuyoutPrice: 1982,
      submittedBuyoutPrice: 0,
      inputMaxPrice: 1982,
      taxType: 'tax_zero'
    }),
    {
      buyoutPrice: 1982,
      userMaxPrice: 1982,
      bidMaxPrice: 1982
    }
  );
}

function testMultiBidRequiresTaxIncludedUserMaxPriceAtLeast5000() {
  assert.doesNotThrow(() => validateMultiBidUserMaxPrice('multi_bid', 5000));
  assert.throws(() => validateMultiBidUserMaxPrice('multi_bid', 4999), /多次出价最高价不能低于5000円/);
  assert.doesNotThrow(() => validateMultiBidUserMaxPrice('multi_bid', 6000, 6000));
  assert.throws(() => validateMultiBidUserMaxPrice('multi_bid', 5999, 6000), /6000/);
  assert.doesNotThrow(() => validateMultiBidUserMaxPrice('direct', 1000));
}

function testMultiBidIncrementUsesYahooBidStepRule() {
  assert.equal(getMinMultiBidIncrement(999), 10);
  assert.equal(getDefaultMultiBidIncrement(999), 10);
  assert.equal(getMinMultiBidIncrement(1000), 100);
  assert.equal(getMinMultiBidIncrement(4999), 100);
  assert.equal(getDefaultMultiBidIncrement(4999), 100);
  assert.equal(getMinMultiBidIncrement(5000), 250);
  assert.equal(getMinMultiBidIncrement(10000), 500);
  assert.equal(getDefaultMultiBidIncrement(10000), 500);
  assert.equal(getMinMultiBidIncrement(49999), 500);
  assert.equal(getMinMultiBidIncrement(50000), 1000);
  assert.equal(getDefaultMultiBidIncrement(50000), 1000);
  assert.equal(validateMultiBidIncrement('multi_bid', 5500, 250), 250);
  assert.throws(() => validateMultiBidIncrement('multi_bid', 5500, 249), /250/);
}

function testSubmitMinimumBidPriceUsesBidCount() {
  assert.equal(getRequiredBidMaxPrice(1, 1), 11);
  assert.equal(getRequiredBidMaxPrice(5500, 0), 5500);
  assert.equal(getRequiredBidMaxPrice(5500, 1), 5750);
  assert.equal(getRequiredBidMaxPrice(9999, 3), 10249);
  assert.doesNotThrow(() => validateSubmitMeetsMinimumBidPrice({
    bidMode: 'bid',
    bidMaxPrice: 5500,
    currentPrice: 5500,
    bidCount: 0
  }));
  assert.throws(() => validateSubmitMeetsMinimumBidPrice({
    bidMode: 'bid',
    bidMaxPrice: 5600,
    currentPrice: 5500,
    bidCount: 1
  }), /最低加价250円/);
  assert.doesNotThrow(() => validateSubmitMeetsMinimumBidPrice({
    bidMode: 'bid',
    bidMaxPrice: 5750,
    currentPrice: 5500,
    bidCount: 1
  }));
  assert.doesNotThrow(() => validateSubmitMeetsMinimumBidPrice({
    bidMode: 'buyout',
    bidMaxPrice: 5500,
    currentPrice: 5500,
    bidCount: 1
  }));
}

function testStoreSubmitMinimumBidPriceUsesTaxExcludedBidMax() {
  assert.throws(() => validateSubmitMeetsMinimumBidPrice({
    bidMode: 'bid',
    bidMaxPrice: 5600,
    currentPrice: 5500,
    bidCount: 1
  }), /最低需出到5750円/);
  assert.doesNotThrow(() => validateSubmitMeetsMinimumBidPrice({
    bidMode: 'bid',
    bidMaxPrice: 5750,
    currentPrice: 5500,
    bidCount: 1
  }));
}

function testProductSubmissionOwnerAllowsOriginalUser() {
  assert.doesNotThrow(() => assertProductSubmissionOwner({ user_id: 7 }, 7));
  assert.doesNotThrow(() => assertProductSubmissionOwner(null, 7));
}

function testProductSubmissionOwnerRejectsOtherUser() {
  assert.throws(
    () => assertProductSubmissionOwner({ user_id: 7 }, 8),
    /该商品已由其他用户提交，请联系管理员！/
  );
}

function testAutomaticStrategyDetection() {
  assert.equal(isAutomaticStrategy('direct'), false);
  assert.equal(isAutomaticStrategy('buyout'), false);
  assert.equal(isAutomaticStrategy('2min'), true);
  assert.equal(isAutomaticStrategy('multi_bid'), true);
}

function testActiveAutomaticStrategyDetection() {
  assert.equal(isActiveAutomaticStrategy({ strategy: '2min', status: 'pending' }), true);
  assert.equal(isActiveAutomaticStrategy({ strategy: '2min', status: 'processing' }), true);
  assert.equal(isActiveAutomaticStrategy({ strategy: '2min', status: 'bidding' }), false);
  assert.equal(isActiveAutomaticStrategy({ strategy: 'multi_bid', status: 'bidding' }), true);
  assert.equal(isActiveAutomaticStrategy({ strategy: 'multi_bid', status: 'cancelled' }), false);
  assert.equal(isActiveAutomaticStrategy({ strategy: 'direct', status: 'pending' }), false);
}

function testCancelOnlyActiveAutomaticTasks() {
  assert.equal(canCancelTask({ strategy: '2min', status: 'pending' }), true);
  assert.equal(canCancelTask({ strategy: 'multi_bid', status: 'bidding' }), true);
  assert.equal(canCancelTask({ strategy: 'direct', status: 'pending' }), false);
  assert.equal(canCancelTask({ strategy: '2min', status: 'bidding' }), false);
  assert.equal(canCancelTask({ strategy: 'multi_bid', status: 'success' }), false);
}

function testActiveAutomaticStrategyBlocksNewSubmission() {
  assert.throws(
    () => assertNoActiveAutomaticStrategy({ strategy: '2min', status: 'pending' }),
    /该商品已有生效策略，请先终止后再提交新任务/
  );
  assert.throws(
    () => assertNoActiveAutomaticStrategy({ strategy: 'multi_bid', status: 'bidding' }),
    /该商品已有生效策略，请先终止后再提交新任务/
  );
  assert.doesNotThrow(() => assertNoActiveAutomaticStrategy({ strategy: 'direct', status: 'bidding' }));
  assert.doesNotThrow(() => assertNoActiveAutomaticStrategy({ strategy: '2min', status: 'cancelled' }));
}

function testBidStrategyScopeDefaultsToAll() {
  assert.equal(normalizeBidStrategyScope('direct_only'), 'direct_only');
  assert.equal(normalizeBidStrategyScope('all'), 'all');
  assert.equal(normalizeBidStrategyScope(''), 'all');
  assert.equal(normalizeBidStrategyScope(null), 'all');
  assert.equal(normalizeBidStrategyScope('bad'), 'all');
}

function testDirectOnlyUserAllowsOnlyDirectStrategy() {
  assert.doesNotThrow(() => assertBidStrategyAllowed({ actingUser: { bid_strategy_scope: 'direct_only' } }, 'direct'));
  assert.throws(
    () => assertBidStrategyAllowed({ actingUser: { bid_strategy_scope: 'direct_only' } }, 'multi_bid'),
    /该用户只能使用即时拍策略/
  );
  assert.throws(
    () => assertBidStrategyAllowed({ actingUser: { bid_strategy_scope: 'direct_only' } }, '5min'),
    /该用户只能使用即时拍策略/
  );
  assert.doesNotThrow(() => assertBidStrategyAllowed({ actingUser: { bid_strategy_scope: 'all' } }, 'multi_bid'));
}

function testClientAdminBypassesActingUserBidStrategyScope() {
  assert.doesNotThrow(() => assertBidStrategyAllowed({
    loginUser: { user_level: 3 },
    actingUser: { bid_strategy_scope: 'direct_only' }
  }, 'multi_bid'));
}

async function testFindTaskByClientRequestIdUsesTrimmedIdAndUserScope() {
  const calls = [];
  const fakeDb = {
    async getOne(sql, params) {
      calls.push({ sql, params });
      return { id: 11, product_id: 'a123456789' };
    }
  };

  const task = await findTaskByClientRequestId(fakeDb, 7, ' request-1 ');

  assert.equal(task.id, 11);
  assert.match(calls[0].sql, /client_request_id = \?/);
  assert.deepEqual(calls[0].params, [7, 'request-1']);
}

async function testFindTaskByClientRequestIdSkipsEmptyId() {
  let called = false;
  const fakeDb = {
    async getOne() {
      called = true;
    }
  };

  const task = await findTaskByClientRequestId(fakeDb, 7, ' ');

  assert.equal(task, null);
  assert.equal(called, false);
}

function testBocJpyCashSellRateParsing() {
  const html = `
    <table>
      <tr><th>货币名称</th><th>现汇买入价</th><th>现钞买入价</th><th>现汇卖出价</th></tr>
      <tr data-currency='日元'>
        <td>日元</td>
        <td>4.2163</td>
        <td>4.2163</td>
        <td>4.2518</td>
        <td>4.2518</td>
      </tr>
    </table>
  `;

  assert.equal(parseBocJpyCashSellRate(html), 4.2518);
}

function testWebsiteRateCalculationRoundsToFourDecimals() {
  assert.equal(calculateWebsiteRate(4.2518), 0.0445);
  assert.equal(calculateWebsiteRate(4.2599), 0.0446);
}

function testWebsiteRateCacheValidity() {
  assert.equal(isWebsiteRateCacheValid({ rate: 0.0445, sourceRate: 4.2518, expiresAtMs: 2000 }, 1000), true);
  assert.equal(isWebsiteRateCacheValid({ rate: 0.0445, sourceRate: 4.2518, expiresAtMs: 1000 }, 1000), false);
  assert.equal(isWebsiteRateCacheValid({ rate: 0, sourceRate: 4.2518, expiresAtMs: 2000 }, 1000), false);
}

async function testWebsiteRateProviderUsesCacheUntilExpiry() {
  clearWebsiteRateCache();
  let calls = 0;
  const httpClient = {
    async get() {
      calls += 1;
      return {
        data: `
          <tr data-currency='日元'>
            <td>日元</td><td>4.2163</td><td>4.2163</td><td>4.2518</td><td>4.2518</td>
          </tr>
        `
      };
    }
  };

  const first = await getWebsiteRate({ nowMs: 1000, httpClient });
  const second = await getWebsiteRate({ nowMs: 2000, httpClient });
  const third = await getWebsiteRate({ nowMs: 1000 + (3 * 60 * 60 * 1000) + 1, httpClient });

  assert.equal(first.rate, 0.0445);
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(third.cacheHit, false);
  assert.equal(calls, 2);
  clearWebsiteRateCache();
}

testSubmitUsesAuthenticatedUserId();
testBuildSubmitProductSnapshotUsesResolvedTaskProductFields();
testSubmitAcceptsBuyoutMode();
testSubmitForcesBuyoutModeForBuyoutOnlyProducts();
testSubmitAcceptsThirdPartyAndNumericAuctionUrls();
testSubmitRejectsMissingAuthenticatedUser();
testTaskListUsesAuthenticatedUserId();
testWonTaskListUsesAuthenticatedUserIdAndCapsLimit();
testActiveBiddingTaskListUsesAuthenticatedUserIdAndCapsLimit();
testActiveBiddingQueryIncludesHighestAndOutbidStatuses();
testProductTypeFallsBackToTaxLabel();
testWonStatsInputDefaultsToThirtyDays();
testWonStatsQueriesUseWonDateAndExportFields();
testStoreUserMaxPriceConvertsToTaxExcludedBidMax();
testStoreCurrentPriceDisplaysAsTaxIncluded();
testStoreBuyoutPriceIsAlreadyTaxIncluded();
testMultiBidRequiresTaxIncludedUserMaxPriceAtLeast5000();
testMultiBidIncrementUsesYahooBidStepRule();
testSubmitMinimumBidPriceUsesBidCount();
testStoreSubmitMinimumBidPriceUsesTaxExcludedBidMax();
testProductSubmissionOwnerAllowsOriginalUser();
testProductSubmissionOwnerRejectsOtherUser();
testAutomaticStrategyDetection();
testActiveAutomaticStrategyDetection();
testCancelOnlyActiveAutomaticTasks();
testActiveAutomaticStrategyBlocksNewSubmission();
testBidStrategyScopeDefaultsToAll();
testDirectOnlyUserAllowsOnlyDirectStrategy();
testClientAdminBypassesActingUserBidStrategyScope();
testClientManualVerificationAlertOnlyShowsPinForClientAdmin();
testBocJpyCashSellRateParsing();
testWebsiteRateCalculationRoundsToFourDecimals();
testWebsiteRateCacheValidity();
Promise.all([
  testFindTaskByClientRequestIdUsesTrimmedIdAndUserScope(),
  testFindTaskByClientRequestIdSkipsEmptyId(),
  testWebsiteRateProviderUsesCacheUntilExpiry()
]).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
