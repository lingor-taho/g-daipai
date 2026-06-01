const assert = require('assert/strict');
const {
  applyUserFinanceConfig,
  calculateOrderPayable,
  canSettleShippingFeeText,
  buildOrderSettlement,
  buildAdminOrdersListQuery,
  ORDER_STATUS_PENDING_SETTLEMENT,
  ORDER_STATUS_COMPLETED,
  normalizeProductType,
  parseShippingFeeToNumber
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
  assert.deepEqual(query.params, [10, 0]);
}

function testSettlementStatusUsesPendingSettlement() {
  assert.equal(ORDER_STATUS_PENDING_SETTLEMENT, 'pending_settlement');
}

function testCompletedOrderStatusConstant() {
  assert.equal(ORDER_STATUS_COMPLETED, 'completed');
}

testShippingFeeParsing();
testSettleableShippingFeeDetection();
testLargeAmountFeeOnlyAppliesAtTaxIncludedThirtyThousand();
testStoreTaxIncludedThresholdUsesTaxIncludedPrice();
testSpecialUserConfigOverridesOnlyConfiguredValues();
testBuildOrderSettlementUsesSubmittedRateAndOverrides();
testNormalizeProductTypeForBatchRefresh();
testAdminOrdersQueryIncludesProductType();
testSettlementStatusUsesPendingSettlement();
testCompletedOrderStatusConstant();
