const assert = require('assert/strict');
const {
  buildSubmitTaskInput,
  buildTaskListInput,
  buildActiveBiddingTaskListInput,
  buildWonTaskListInput,
  buildActiveBiddingTaskListQuery,
  buildWonStatsInput,
  buildWonStatsSummaryQuery,
  buildWonStatsExportQuery,
  calculateBidMaxPrice,
  getTaxIncludedPrice,
  resolveBuyoutTaskPrices,
  validateMultiBidUserMaxPrice,
  getMinMultiBidIncrement,
  getDefaultMultiBidIncrement,
  validateMultiBidIncrement,
  assertProductSubmissionOwner,
  isAutomaticStrategy,
  isActiveAutomaticStrategy,
  canCancelTask,
  assertNoActiveAutomaticStrategy,
  findTaskByClientRequestId
} = require('./task');

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
  const input = buildWonTaskListInput({ id: 9 }, { limit: '999' });
  assert.equal(input.userId, 9);
  assert.equal(input.limit, 100);
  assert.throws(() => buildWonTaskListInput(null, {}), /not logged in/);
}

function testActiveBiddingTaskListUsesAuthenticatedUserIdAndCapsLimit() {
  const input = buildActiveBiddingTaskListInput({ id: 9 }, { limit: '999' });
  assert.equal(input.userId, 9);
  assert.equal(input.limit, 100);
  assert.throws(() => buildActiveBiddingTaskListInput(null, {}), /not logged in/);
}

function testActiveBiddingQueryIncludesHighestAndOutbidStatuses() {
  const query = buildActiveBiddingTaskListQuery({ userId: 9, limit: 100 });

  assert.match(query.sql, /bi\.status IN \('highest', 'outbid'\)/);
  assert.match(query.sql, /bi\.status AS bidding_status/);
  assert.match(query.sql, /MAX\(t\.shipping_fee_text\) AS shipping_fee_text/);
  assert.match(query.sql, /CASE WHEN bi\.status = 'highest' THEN 1 ELSE 0 END AS is_highest_bidder/);
  assert.deepEqual(query.params, [9, 100]);
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
  assert.match(summary.sql, /SUM\(CASE\s+WHEN t\.tax_type = 'tax_included'/);
  assert.match(summary.sql, /COUNT\(\*\) AS item_count/);
  assert.deepEqual(summary.params, [9, 30]);

  assert.match(exportQuery.sql, /t\.product_id/);
  assert.match(exportQuery.sql, /t\.product_title/);
  assert.match(exportQuery.sql, /o\.final_price/);
  assert.match(exportQuery.sql, /t\.shipping_fee_text/);
  assert.match(exportQuery.sql, /o\.won_at/);
  assert.deepEqual(exportQuery.params, [9, 30]);
}

function testStoreUserMaxPriceConvertsToTaxExcludedBidMax() {
  assert.equal(calculateBidMaxPrice(1000, 'tax_included'), 900);
  assert.equal(calculateBidMaxPrice(1100, 'tax_included'), 1000);
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
      bidMaxPrice: 2230
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

function testMultiBidIncrementUsesOneTwentiethRule() {
  assert.equal(getMinMultiBidIncrement(5500), 275);
  assert.equal(getDefaultMultiBidIncrement(5500), 500);
  assert.equal(getMinMultiBidIncrement(10000), 500);
  assert.equal(getDefaultMultiBidIncrement(10000), 500);
  assert.equal(getMinMultiBidIncrement(15000), 750);
  assert.equal(getDefaultMultiBidIncrement(15000), 750);
  assert.equal(validateMultiBidIncrement('multi_bid', 5500, 275), 275);
  assert.throws(() => validateMultiBidIncrement('multi_bid', 10000, 499), /500/);
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

testSubmitUsesAuthenticatedUserId();
testSubmitAcceptsBuyoutMode();
testSubmitForcesBuyoutModeForBuyoutOnlyProducts();
testSubmitAcceptsThirdPartyAndNumericAuctionUrls();
testSubmitRejectsMissingAuthenticatedUser();
testTaskListUsesAuthenticatedUserId();
testWonTaskListUsesAuthenticatedUserIdAndCapsLimit();
testActiveBiddingTaskListUsesAuthenticatedUserIdAndCapsLimit();
testActiveBiddingQueryIncludesHighestAndOutbidStatuses();
testWonStatsInputDefaultsToThirtyDays();
testWonStatsQueriesUseWonDateAndExportFields();
testStoreUserMaxPriceConvertsToTaxExcludedBidMax();
testStoreCurrentPriceDisplaysAsTaxIncluded();
testStoreBuyoutPriceIsAlreadyTaxIncluded();
testMultiBidRequiresTaxIncludedUserMaxPriceAtLeast5000();
testMultiBidIncrementUsesOneTwentiethRule();
testProductSubmissionOwnerAllowsOriginalUser();
testProductSubmissionOwnerRejectsOtherUser();
testAutomaticStrategyDetection();
testActiveAutomaticStrategyDetection();
testCancelOnlyActiveAutomaticTasks();
testActiveAutomaticStrategyBlocksNewSubmission();
Promise.all([
  testFindTaskByClientRequestIdUsesTrimmedIdAndUserScope(),
  testFindTaskByClientRequestIdSkipsEmptyId()
]).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
