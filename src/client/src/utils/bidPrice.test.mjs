import assert from 'node:assert/strict';
import {
  getComparableCurrentPrice,
  getActualBidPrice,
  getBuyoutPrice,
  getBuyoutSubmitPrice,
  getMinimumBidInputRequirement,
  getSubmitMaxPrice,
  getSubmitTaxType,
  getYahooMinimumBidIncrement,
  getRequiredTaxExcludedBidPrice,
  isSubmitMaxPriceAboveCurrentPrice,
  isSubmitTaxExcludedPriceAtLeastRequiredBid,
  isBuyoutOnlyProduct,
  isStoreProduct
} from './bidPrice.js';

function testStoreProductDetection() {
  assert.equal(isStoreProduct({ taxType: 'tax_included' }), true);
  assert.equal(isStoreProduct({ tax_type: 'tax_included' }), true);
  assert.equal(isStoreProduct({ taxType: 'tax_zero' }), false);
}

function testTaxBeforeStoreBidUsesNormalSubmitTaxAndShowsTaxIncludedActual() {
  const product = { taxType: 'tax_included' };

  assert.equal(getSubmitTaxType(product, 'tax_before'), 'tax_included');
  assert.equal(getActualBidPrice(1000, product, 'tax_before'), 1100);
  assert.equal(getSubmitMaxPrice(1000, product, 'tax_before'), 1100);
}

function testTaxAfterStoreBidKeepsExistingTaxIncludedSubmitAndActual() {
  const product = { taxType: 'tax_included' };

  assert.equal(getSubmitTaxType(product, 'tax_after'), 'tax_included');
  assert.equal(getActualBidPrice(1100, product, 'tax_after'), 1100);
  assert.equal(getSubmitMaxPrice(1100, product, 'tax_after'), 1100);
}

function testNormalProductDoesNotApplyStoreMode() {
  const product = { taxType: 'tax_zero' };

  assert.equal(getSubmitTaxType(product, 'tax_before'), 'tax_zero');
  assert.equal(getActualBidPrice(1000, product, 'tax_before'), 1000);
  assert.equal(getSubmitMaxPrice(1000, product, 'tax_before'), 1000);
}

function testBuyoutOnlyProductDetection() {
  assert.equal(isBuyoutOnlyProduct({ buyoutOnly: true, buyoutPrice: 2800 }), true);
  assert.equal(isBuyoutOnlyProduct({ buyout_only: true, buyout_price: 2800 }), true);
  assert.equal(isBuyoutOnlyProduct({ buyoutOnly: true, buyoutPrice: 0, currentPrice: 1982 }), true);
  assert.equal(isBuyoutOnlyProduct({ buyoutOnly: true, buyoutPrice: 0, currentPrice: 0 }), false);
  assert.equal(isBuyoutOnlyProduct({ buyoutOnly: false, buyoutPrice: 2800 }), false);
  assert.equal(getBuyoutPrice({ buyoutOnly: true, currentPrice: 1982 }), 1982);
  assert.equal(getBuyoutPrice({ buyout_only: true, current_price: 1982 }), 1982);
  assert.equal(getBuyoutSubmitPrice({ buyoutOnly: true, taxType: 'tax_included', buyoutPrice: 2460 }), 2460);
}

function testComparableCurrentPriceAddsTaxForStoreProducts() {
  // current_price 来自 HTML price 字段（税前）。商城商品要 ×1.1 才能跟税后的 effectiveMaxPrice 比较。
  assert.equal(getComparableCurrentPrice({ taxType: 'tax_included', currentPrice: 1000 }), 1100);
  assert.equal(getComparableCurrentPrice({ taxType: 'tax_zero', currentPrice: 1000 }), 1000);
}

function testSubmitMaxPriceMustBeAboveCurrentPrice() {
  // 商城商品 current_price=1000（税前 1000，税后 1100），最高出价 1200 税后 > 1100 通过
  assert.equal(isSubmitMaxPriceAboveCurrentPrice(1200, { taxType: 'tax_included', currentPrice: 1000 }), true);
  // 1100 等于税后当前价，不通过
  assert.equal(isSubmitMaxPriceAboveCurrentPrice(1100, { taxType: 'tax_included', currentPrice: 1000 }), false);
  assert.equal(isSubmitMaxPriceAboveCurrentPrice(999, { taxType: 'tax_zero', currentPrice: 1000 }), false);
  assert.equal(isSubmitMaxPriceAboveCurrentPrice(1000, { taxType: 'tax_zero', currentPrice: 0 }), true);
}

function testRequiredBidPriceUsesYahooIncrementOnlyAfterExistingBids() {
  assert.equal(getYahooMinimumBidIncrement(999), 10);
  assert.equal(getYahooMinimumBidIncrement(1000), 100);
  assert.equal(getYahooMinimumBidIncrement(4999), 100);
  assert.equal(getYahooMinimumBidIncrement(5000), 250);
  assert.equal(getYahooMinimumBidIncrement(10000), 500);
  assert.equal(getYahooMinimumBidIncrement(50000), 1000);

  assert.equal(getRequiredTaxExcludedBidPrice({ currentPrice: 1, bidCount: 1 }), 11);
  assert.equal(getRequiredTaxExcludedBidPrice({ currentPrice: 5500, bidCount: 0 }), 5500);
  assert.equal(getRequiredTaxExcludedBidPrice({ currentPrice: 5500, bidCount: 1 }), 5750);
  assert.equal(getRequiredTaxExcludedBidPrice({ current_price: 4999, bid_count: 2 }), 5099);

  assert.equal(isSubmitTaxExcludedPriceAtLeastRequiredBid(5600, { currentPrice: 5500, bidCount: 1 }), false);
  assert.equal(isSubmitTaxExcludedPriceAtLeastRequiredBid(5750, { currentPrice: 5500, bidCount: 1 }), true);
  assert.equal(isSubmitTaxExcludedPriceAtLeastRequiredBid(5500, { currentPrice: 5500, bidCount: 0 }), true);
}

function testMinimumBidInputRequirementUsesSelectedPriceMode() {
  assert.deepEqual(
    getMinimumBidInputRequirement({ taxType: 'tax_zero', currentPrice: 5000, bidCount: 1 }, 'tax_before'),
    { currentPrice: 5000, increment: 250, requiredPrice: 5250, currentLabel: '当前价' }
  );
  assert.deepEqual(
    getMinimumBidInputRequirement({ taxType: 'tax_included', currentPrice: 5000, bidCount: 1 }, 'tax_before'),
    { currentPrice: 5000, increment: 250, requiredPrice: 5250, currentLabel: '当前税前价' }
  );
  assert.deepEqual(
    getMinimumBidInputRequirement({ taxType: 'tax_included', currentPrice: 5000, bidCount: 1 }, 'tax_after'),
    { currentPrice: 5500, increment: 250, requiredPrice: 5750, currentLabel: '当前税后价' }
  );
  assert.deepEqual(
    getMinimumBidInputRequirement({ taxType: 'tax_included', currentPrice: 1, bidCount: 1 }, 'tax_before'),
    { currentPrice: 1, increment: 10, requiredPrice: 11, currentLabel: '当前税前价' }
  );
}

testStoreProductDetection();
testTaxBeforeStoreBidUsesNormalSubmitTaxAndShowsTaxIncludedActual();
testTaxAfterStoreBidKeepsExistingTaxIncludedSubmitAndActual();
testNormalProductDoesNotApplyStoreMode();
testBuyoutOnlyProductDetection();
testComparableCurrentPriceAddsTaxForStoreProducts();
testSubmitMaxPriceMustBeAboveCurrentPrice();
testRequiredBidPriceUsesYahooIncrementOnlyAfterExistingBids();
testMinimumBidInputRequirementUsesSelectedPriceMode();
