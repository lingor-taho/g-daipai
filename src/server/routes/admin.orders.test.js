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
  normalizeOrderStatusRefreshTarget,
  normalizePositiveIntegerConfig,
  deleteProductDataByProductId,
  buildGoogleSheetUrl,
  parseStoreBundleChildProductIds,
  backfillStoreBundle,
  ORDER_STATUS_PENDING_SHIPMENT,
  ORDER_STATUS_BUNDLE_COMPLETED
} = require('./admin');

function testShippingFeeParsing() {
  assert.equal(parseShippingFeeToNumber('送料 無料'), 0);
  assert.equal(parseShippingFeeToNumber('送料 着払い'), 0);
  assert.equal(parseShippingFeeToNumber('送料 落札者負担'), 0);
  assert.equal(parseShippingFeeToNumber('送料 1,000円'), 1000);
}

function testBuildGoogleSheetUrl() {
  assert.equal(
    buildGoogleSheetUrl('1NFDVdBAdi3S6RzS3u7LEd0jX-etlyATioVfghXm-GB4'),
    'https://docs.google.com/spreadsheets/d/1NFDVdBAdi3S6RzS3u7LEd0jX-etlyATioVfghXm-GB4/edit?gid=0#gid=0'
  );
  assert.equal(buildGoogleSheetUrl(''), '');
}

function testParseStoreBundleChildProductIdsAcceptsFullAndHalfCommas() {
  assert.deepEqual(
    parseStoreBundleChildProductIds('s123456789，S123456780, https://auctions.yahoo.co.jp/jp/auction/s123456781, s123456789'),
    ['s123456789', 's123456780', 's123456781']
  );
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
  assert.equal(resolveSettlementOrderStatus('pending_shipment'), 'pending_shipment');
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

  assert.equal(mapped.shipping_fee_text, '\u9001\u6599 \u843d\u672d\u8005\u8ca0\u62c5');
  assert.equal(mapped.effective_shipping_fee_text, '110\u5186');
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

function testNormalizeOrderStatusRefreshTargetSupportsAllowedTargets() {
  assert.equal(normalizeOrderStatusRefreshTarget('blank'), null);
  assert.equal(normalizeOrderStatusRefreshTarget('completed'), ORDER_STATUS_COMPLETED);
  assert.equal(normalizeOrderStatusRefreshTarget('pending_shipment'), ORDER_STATUS_PENDING_SHIPMENT);
}

function testNormalizeOrderStatusRefreshTargetRejectsUnknownStatus() {
  assert.throws(() => normalizeOrderStatusRefreshTarget('pending_payment'), /invalid orderStatus/);
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

async function testRequestPaymentDoesNotSetFlagWhenNoPendingSettlementRows() {
  const queries = [];
  const fakeDb = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: /UPDATE orders/.test(sql) ? 0 : 1 };
    }
  };

  const result = await requestPayment(fakeDb, [3]);

  assert.equal(result.requested, 0);
  assert.match(queries[0].sql, /order_status = \?/);
  assert.equal(queries[0].params[0], 'pending_settlement');
  assert.equal(queries.length, 1);
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

async function testDeleteProductDataRemovesTaskOrderAndBiddingAssociations() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ type: 'getAll', sql, params });
      if (/FROM tasks/.test(sql)) {
        return [{ id: 276 }, { id: 277 }];
      }
      if (/FROM orders/.test(sql)) {
        return [{ id: 67 }, { id: 68 }];
      }
      return [];
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      if (/order_status_change_logs/.test(sql)) return { rowCount: 3 };
      if (/bid_logs/.test(sql)) return { rowCount: 2 };
      if (/orders/.test(sql)) return { rowCount: 2 };
      if (/bidding_items/.test(sql)) return { rowCount: 1 };
      if (/tasks/.test(sql)) return { rowCount: 2 };
      return { rowCount: 0 };
    }
  };

  const result = await deleteProductDataByProductId(fakeDb, 'v1231866422');

  assert.equal(result.success, true);
  assert.equal(result.taskCount, 2);
  assert.equal(result.orderCount, 2);
  assert.equal(result.bidLogCount, 2);
  assert.equal(result.biddingItemCount, 1);
  assert.equal(result.orderStatusLogCount, 3);
  assert.equal(calls[0].params[0], 'v1231866422');
  assert.match(calls[2].sql, /DELETE FROM order_status_change_logs/);
  assert.match(calls[3].sql, /DELETE FROM bid_logs/);
  assert.match(calls[4].sql, /DELETE FROM orders/);
  assert.match(calls[5].sql, /DELETE FROM bidding_items/);
  assert.match(calls[6].sql, /DELETE FROM tasks/);
}

async function testBackfillStoreBundleMarksMainPendingShipmentAndChildrenCompleted() {
  const calls = [];
  const rows = [
    { order_id: 101, order_status: 'pending_payment', product_id: 's100000001', product_type: 'store' },
    { order_id: 102, order_status: 'pending_payment', product_id: 's100000002', product_type: 'store' },
    { order_id: 103, order_status: 'pending_settlement', product_id: 's100000003', product_type: 'store' }
  ];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ type: 'getAll', sql, params });
      if (/SELECT o\.id AS order_id/.test(sql) && /LOWER\(t\.product_id\)/.test(sql)) return rows;
      if (/old_status/.test(sql)) return rows.map(row => ({
        ...row,
        old_status: row.order_status,
        product_type: row.product_type,
        shipping_fee_text: '送料 230円'
      }));
      return [];
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: /INSERT INTO order_status_change_logs/.test(sql) ? 1 : 1 };
    }
  };

  const result = await backfillStoreBundle(fakeDb, {
    mainProductId: 's100000001',
    childProductIds: 's100000002，s100000003',
    bundleShippingFee: 780
  }, { nowMs: 12345 });

  assert.equal(result.mainProductId, 's100000001');
  assert.deepEqual(result.childProductIds, ['s100000002', 's100000003']);
  assert.equal(result.bundleShippingFeeText, '780円');
  assert.equal(result.bundleGroupId, 'store-bundle-s100000001-12345');
  const mainUpdate = calls.find(call => call.type === 'query' && /WHERE id = \?/.test(call.sql) && /bundle_shipping_fee_text = \?/.test(call.sql));
  assert.deepEqual(mainUpdate.params, ['store-bundle-s100000001-12345', '780円', ORDER_STATUS_PENDING_SHIPMENT, 101]);
  const childUpdate = calls.find(call => call.type === 'query' && /WHERE id IN/.test(call.sql));
  assert.deepEqual(childUpdate.params, ['store-bundle-s100000001-12345', ORDER_STATUS_BUNDLE_COMPLETED, 102, 103]);
  const auditCalls = calls.filter(call => call.type === 'query' && /INSERT INTO order_status_change_logs/.test(call.sql));
  assert.equal(auditCalls.length, 3);
}

async function testBackfillStoreBundleRejectsNormalProduct() {
  const fakeDb = {
    async getAll(sql) {
      if (/LOWER\(t\.product_id\)/.test(sql)) {
        return [
          { order_id: 101, order_status: 'pending_payment', product_id: 's100000001', product_type: 'store' },
          { order_id: 102, order_status: 'pending_payment', product_id: 'a100000002', product_type: 'normal' }
        ];
      }
      return [];
    },
    async query() {
      throw new Error('should not update');
    }
  };

  await assert.rejects(
    () => backfillStoreBundle(fakeDb, {
      mainProductId: 's100000001',
      childProductIds: 'a100000002',
      bundleShippingFee: 780
    }),
    /只能补录商城商品/
  );
}

async function testDeleteProductDataCanRemoveOrphanBiddingItem() {
  const fakeDb = {
    async getAll() {
      return [];
    },
    async query(sql) {
      return { rowCount: /bidding_items/.test(sql) ? 1 : 0 };
    }
  };

  const result = await deleteProductDataByProductId(fakeDb, 'v1231866422');

  assert.equal(result.success, true);
  assert.equal(result.taskCount, 0);
  assert.equal(result.biddingItemCount, 1);
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
testNormalizeOrderStatusRefreshTargetSupportsAllowedTargets();
testNormalizeOrderStatusRefreshTargetRejectsUnknownStatus();
testNormalizePositiveIntegerConfig();
testBuildGoogleSheetUrl();
testParseStoreBundleChildProductIdsAcceptsFullAndHalfCommas();

Promise.all([
  testRequestScanSetsCounterToConfiguredEveryRuns(),
  testRequestPaymentSetsFlag(),
  testRequestPaymentDoesNotSetFlagWhenNoPendingSettlementRows(),
  testClearPaymentAlertAndContinueClearsMessageAndSetsFlag(),
  testBackfillStoreBundleMarksMainPendingShipmentAndChildrenCompleted(),
  testBackfillStoreBundleRejectsNormalProduct(),
  testDeleteProductDataRemovesTaskOrderAndBiddingAssociations(),
  testDeleteProductDataCanRemoveOrphanBiddingItem()
]).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
