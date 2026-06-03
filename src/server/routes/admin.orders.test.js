const assert = require('assert/strict');
const {
  applyUserFinanceConfig,
  calculateOrderPayable,
  canSettleShippingFeeText,
  buildOrderSettlement,
  buildAdminOrdersListQuery,
  mapAdminOrderListItem,
  resolveSettlementOrderStatus,
  ORDER_STATUS_PENDING_SETTLEMENT,
  ORDER_STATUS_COMPLETED,
  normalizeProductType,
  parseShippingFeeToNumber,
  requestScan,
  requestPayment,
  clearPaymentAlertAndContinue,
  normalizePositiveIntegerConfig
} = require('./admin');

function testShippingFeeParsing() {
  assert.equal(parseShippingFeeToNumber('送料 無料'), 0);
  assert.equal(parseShippingFeeToNumber('送料 着払い'), 0);
  assert.equal(parseShippingFeeToNumber('送料 落札者負担'), 0);
  assert.equal(parseShippingFeeToNumber('送料 1,000円'), 1000);
}

function testSettleableShippingFeeDetection() {
  assert.equal(canSettleShippingFeeText('送料 無料'), true);
  assert.equal(canSettleShippingFeeText('全国一律 230円'), true);
  assert.equal(canSettleShippingFeeText('送料 着払い'), true);
  assert.equal(canSettleShippingFeeText('送料 落札者負担'), false);
  assert.equal(canSettleShippingFeeText('待定'), false);
}

function testLargeAmountFeeOnlyAppliesAtTaxIncludedThirtyThousand() {
  const config = {
    rate: 0.05,
    bankFeeJpy: 500,
    handlingFeeCny: 15,
    largeAmountFeeCny: 20
  };

  assert.deepEqual(
    calculateOrderPayable({
      finalPrice: 30000,
      taxType: 'tax_zero',
      shippingFeeText: '送料 1,000円',
      config
    }),
    {
      finalPrice: 30000,
      taxIncludedFinalPrice: 30000,
      shippingFee: 1000,
      rate: 0.05,
      bankFeeJpy: 500,
      handlingFeeCny: 15,
      largeAmountFeeCny: 20,
      largeAmountFeeApplied: true,
      payableCny: 1610
    }
  );

  const belowThreshold = calculateOrderPayable({
    finalPrice: 29990,
    taxType: 'tax_zero',
    shippingFeeText: '送料 1,000円',
    config
  });
  assert.equal(belowThreshold.largeAmountFeeApplied, false);
  assert.equal(belowThreshold.largeAmountFeeCny, 0);
  assert.equal(belowThreshold.payableCny, 1589.5);
}

function testStoreTaxIncludedThresholdUsesTaxIncludedPrice() {
  const result = calculateOrderPayable({
    finalPrice: 28000,
    taxType: 'tax_included',
    shippingFeeText: '送料 無料',
    config: {
      rate: 0.05,
      bankFeeJpy: 0,
      handlingFeeCny: 0,
      largeAmountFeeCny: 30
    }
  });

  assert.equal(result.taxIncludedFinalPrice, 30800);
  assert.equal(result.largeAmountFeeApplied, true);
  assert.equal(result.payableCny, 1430);
}

function testSpecialUserConfigOverridesOnlyConfiguredValues() {
  const config = applyUserFinanceConfig(
    {
      rate: 0.05,
      bankFeeJpy: 500,
      handlingFeeCny: 15,
      largeAmountFeeCny: 20
    },
    {
      rate_adjustment: -0.01,
      bank_fee_jpy: 300,
      handling_fee_cny: null,
      large_amount_fee_cny: 50
    }
  );

  assert.deepEqual(config, {
    rate: 0.04,
    rateAdjustment: -0.01,
    bankFeeJpy: 300,
    handlingFeeCny: 15,
    largeAmountFeeCny: 50,
    hasUserFinanceOverride: true
  });
}

function testBuildOrderSettlementUsesSubmittedRateAndOverrides() {
  const result = buildOrderSettlement({
    order: {
      final_price: 20000,
      tax_type: 'tax_zero',
      shipping_fee_text: '送料 1,000円'
    },
    baseConfig: {
      rate: 0.05,
      bankFeeJpy: 500,
      handlingFeeCny: 15,
      largeAmountFeeCny: 20
    },
    userFinanceOverride: {
      rate_adjustment: 0.01,
      bank_fee_jpy: 100,
      handling_fee_cny: null,
      large_amount_fee_cny: null
    }
  });

  assert.deepEqual(result, {
    shippingFeeJpy: 1000,
    bankFeeJpy: 100,
    handlingFeeCny: 15,
    largeAmountFeeCny: 0,
    largeAmountFeeApplied: false,
    taxIncludedFinalPrice: 20000,
    jpyToCnyRate: 0.06,
    rateAdjustment: 0.01,
    hasUserFinanceOverride: true,
    payableCny: 1281
  });
}

function testBuildOrderSettlementPrefersBundleShippingFee() {
  const result = buildOrderSettlement({
    order: {
      final_price: 10000,
      tax_type: 'tax_zero',
      shipping_fee_text: '送料 1,000円',
      bundle_shipping_fee_text: '0円'
    },
    baseConfig: {
      rate: 0.05,
      bankFeeJpy: 500,
      handlingFeeCny: 15,
      largeAmountFeeCny: 20
    },
    userFinanceOverride: null
  });

  assert.equal(result.shippingFeeJpy, 0);
  assert.equal(result.payableCny, 540);
}

function testResolveSettlementStatusKeepsBundleCompleted() {
  assert.equal(resolveSettlementOrderStatus('pending_payment'), 'pending_settlement');
  assert.equal(resolveSettlementOrderStatus('bundle_completed'), 'bundle_completed');
}

function testNormalizeProductTypeForBatchRefresh() {
  assert.equal(normalizeProductType('normal'), 'normal');
  assert.equal(normalizeProductType('store'), 'store');
  assert.equal(normalizeProductType('tax_zero'), 'normal');
  assert.equal(normalizeProductType('tax_included'), 'store');
  assert.equal(normalizeProductType(''), '');
}

function testAdminOrdersQueryIncludesProductType() {
  const query = buildAdminOrdersListQuery({ pageSize: 10, offset: 0 });

  assert.match(query.sql, /t\.product_type/);
  assert.match(query.sql, /ORDER BY datetime\(COALESCE\(o\.won_at, t\.updated_at\)\) DESC, t\.id DESC/);
  assert.deepEqual(query.params, [10, 0]);
}

function testMapAdminOrderListItemUsesEffectiveBundleShipping() {
  const item = {
    product_id: 'x123456789',
    product_url: 'https://auctions.yahoo.co.jp/jp/auction/x123456789',
    shipping_fee_text: '\u9001\u6599 \u843d\u672d\u8005\u8ca0\u62c5',
    bundle_shipping_fee_text: '110\u5186',
    settled_at: '2026-06-03T00:00:00.000Z',
    bank_fee_jpy: 500,
    handling_fee_cny: 15,
    large_amount_fee_cny: 0,
    large_amount_fee_applied: 0,
    tax_included_final_price: 10000,
    jpy_to_cny_rate: 0.05,
    rate_adjustment: 0,
    has_user_finance_override: 0,
    total_amount_cny: 545,
    order_status: 'pending_settlement',
    transaction_start_error: null
  };

  const mapped = mapAdminOrderListItem(item);

  assert.equal(mapped.shipping_fee_text, '110\u5186');
  assert.equal(mapped.can_settle, true);
  assert.equal(mapped.shipping_fee_jpy, 110);
  assert.equal(mapped.bundle_shipping_fee_text, '110\u5186');
}

function testSettlementStatusUsesPendingSettlement() {
  assert.equal(ORDER_STATUS_PENDING_SETTLEMENT, 'pending_settlement');
}

function testCompletedOrderStatusConstant() {
  assert.equal(ORDER_STATUS_COMPLETED, 'completed');
}

function testNormalizePositiveIntegerConfig() {
  assert.equal(normalizePositiveIntegerConfig('4', 3), 4);
  assert.equal(normalizePositiveIntegerConfig('0', 3), 3);
  assert.equal(normalizePositiveIntegerConfig('abc', 3), 3);
}

async function testRequestScanSetsCounterToConfiguredEveryRuns() {
  const queries = [];
  const fakeDb = {
    async getOne(sql) {
      assert.match(sql, /scan_every_idle_runs/);
      return { value: '7' };
    },
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await requestScan(fakeDb);

  assert.equal(result.scanIdleCounter, 7);
  assert.match(queries[0].sql, /scan_idle_counter/);
  assert.equal(queries[0].params[0], '7');
}

async function testRequestPaymentSetsFlag() {
  const queries = [];
  const fakeDb = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await requestPayment(fakeDb, [1, 2]);

  assert.equal(result.requested, 1);
  assert.match(queries[0].sql, /order_status = \?/);
  assert.equal(queries[0].params[0], 'pending_settlement');
  assert.match(queries[1].sql, /payment_requested/);
  assert.equal(queries[1].params[0], '1');
}

async function testClearPaymentAlertAndContinueClearsMessageAndSetsFlag() {
  const queries = [];
  const fakeDb = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await clearPaymentAlertAndContinue(fakeDb);

  assert.equal(result.success, true);
  assert.match(queries[0].sql, /payment_alert_message/);
  assert.equal(queries[0].params[0], '');
  assert.match(queries[1].sql, /payment_requested/);
  assert.equal(queries[1].params[0], '1');
}

testShippingFeeParsing();
testSettleableShippingFeeDetection();
testLargeAmountFeeOnlyAppliesAtTaxIncludedThirtyThousand();
testStoreTaxIncludedThresholdUsesTaxIncludedPrice();
testSpecialUserConfigOverridesOnlyConfiguredValues();
testBuildOrderSettlementUsesSubmittedRateAndOverrides();
testBuildOrderSettlementPrefersBundleShippingFee();
testResolveSettlementStatusKeepsBundleCompleted();
testNormalizeProductTypeForBatchRefresh();
testAdminOrdersQueryIncludesProductType();
testMapAdminOrderListItemUsesEffectiveBundleShipping();
testSettlementStatusUsesPendingSettlement();
testCompletedOrderStatusConstant();
testNormalizePositiveIntegerConfig();

Promise.all([
  testRequestScanSetsCounterToConfiguredEveryRuns(),
  testRequestPaymentSetsFlag(),
  testClearPaymentAlertAndContinueClearsMessageAndSetsFlag()
]).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
