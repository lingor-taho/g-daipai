import assert from 'node:assert/strict';
import {
  getComparableCurrentPrice,
  getActualBidPrice,
  getActualBidDisplay,
  getBidInputYenPrice,
  getBuyoutPrice,
  getBuyoutSubmitPrice,
  getYenAsCnyAmount,
  getMinimumBidInputRequirement,
  getMinimumBidComparableInputPrice,
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
  assert.equal(getActualBidPrice(2247, product, 'tax_before'), 2472);
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

function testRmbBidInputConvertsToYen() {
  assert.equal(getBidInputYenPrice(100, 'cny', 0.0445), 2247);
  assert.equal(getBidInputYenPrice(100, 'jpy', 0.0445), 100);
  assert.equal(getBidInputYenPrice(100, 'cny', 0), 0);
  assert.equal(getYenAsCnyAmount(2247, 0.0445), 99.99);
}

function testActualBidDisplaySupportsNormalAndStoreRmb() {
  assert.deepEqual(
    getActualBidDisplay(100, { taxType: 'tax_zero' }, 'tax_before', 'cny', 0.0445),
    { inputYenPrice: 2247, actualYenPrice: 2247, actualCnyAmount: 100 }
  );
  assert.deepEqual(
    getActualBidDisplay(100, { taxType: 'tax_included' }, 'tax_before', 'cny', 0.0445),
    { inputYenPrice: 2247, actualYenPrice: 2472, actualCnyAmount: 110 }
  );
  assert.deepEqual(
    getActualBidDisplay(100, { taxType: 'tax_included' }, 'tax_after', 'cny', 0.0445),
    { inputYenPrice: 2247, actualYenPrice: 2247, actualCnyAmount: 100 }
  );
  assert.deepEqual(
    getActualBidDisplay(2247, { taxType: 'tax_zero' }, 'tax_before', 'jpy', 0.0445),
    { inputYenPrice: 2247, actualYenPrice: 2247, actualCnyAmount: 0 }
  );
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
    { currentPrice: 5500, increment: 275, requiredPrice: 5775, currentLabel: '当前税后价' }
  );
  assert.deepEqual(
    getMinimumBidInputRequirement({ taxType: 'tax_included', currentPrice: 1, bidCount: 1 }, 'tax_before'),
    { currentPrice: 1, increment: 10, requiredPrice: 11, currentLabel: '当前税前价' }
  );
}

function testTaxBeforeStoreMinimumBidUsesRawInputTaxExcludedPrice() {
  const product = { taxType: 'tax_included', currentPrice: 9841, bidCount: 9 };
  const comparable = getMinimumBidComparableInputPrice({
    inputYenPrice: 10093,
    submitTaxExcludedPrice: 10090,
    product,
    storeBidPriceMode: 'tax_before'
  });

  assert.equal(getMinimumBidInputRequirement(product, 'tax_before').requiredPrice, 10091);
  assert.equal(comparable, 10093);
  assert.equal(isSubmitTaxExcludedPriceAtLeastRequiredBid(comparable, product), true);
}

function testTaxAfterStoreMinimumBidUsesRawInputTaxIncludedPrice() {
  const product = { taxType: 'tax_included', currentPrice: 30045, bidCount: 7 };
  const requirement = getMinimumBidInputRequirement(product, 'tax_after');
  const comparable = getMinimumBidComparableInputPrice({
    inputYenPrice: 33599,
    submitTaxExcludedPrice: 30544,
    product,
    storeBidPriceMode: 'tax_after'
  });
  const roundedUpComparable = getMinimumBidComparableInputPrice({
    inputYenPrice: 33600,
    submitTaxExcludedPrice: 30545,
    product,
    storeBidPriceMode: 'tax_after'
  });

  assert.equal(requirement.currentPrice, 33049);
  assert.equal(requirement.increment, 551);
  assert.equal(requirement.requiredPrice, 33600);
  assert.equal(comparable, 33599);
  assert.equal(comparable >= requirement.requiredPrice, false);
  assert.equal(roundedUpComparable, 33600);
  assert.equal(roundedUpComparable >= requirement.requiredPrice, true);

  const lowerCurrentProduct = { taxType: 'tax_included', currentPrice: 28500, bidCount: 4 };
  const lowerRequirement = getMinimumBidInputRequirement(lowerCurrentProduct, 'tax_after');
  const higherComparable = getMinimumBidComparableInputPrice({
    inputYenPrice: 32500,
    submitTaxExcludedPrice: 29545,
    product: lowerCurrentProduct,
    storeBidPriceMode: 'tax_after'
  });

  assert.equal(lowerRequirement.currentPrice, 31350);
  assert.equal(lowerRequirement.increment, 550);
  assert.equal(lowerRequirement.requiredPrice, 31900);
  assert.equal(higherComparable, 32500);
  assert.equal(higherComparable >= lowerRequirement.requiredPrice, true);
}

testStoreProductDetection();
testTaxBeforeStoreBidUsesNormalSubmitTaxAndShowsTaxIncludedActual();
testTaxAfterStoreBidKeepsExistingTaxIncludedSubmitAndActual();
testNormalProductDoesNotApplyStoreMode();
testRmbBidInputConvertsToYen();
testActualBidDisplaySupportsNormalAndStoreRmb();
testBuyoutOnlyProductDetection();
testComparableCurrentPriceAddsTaxForStoreProducts();
testSubmitMaxPriceMustBeAboveCurrentPrice();
testRequiredBidPriceUsesYahooIncrementOnlyAfterExistingBids();
testMinimumBidInputRequirementUsesSelectedPriceMode();
testTaxBeforeStoreMinimumBidUsesRawInputTaxExcludedPrice();
testTaxAfterStoreMinimumBidUsesRawInputTaxIncludedPrice();

{
  const requirement = getMinimumBidInputRequirement({ taxType: 'tax_included', currentPrice: 4500, bidCount: 1 }, 'tax_after');
  assert.equal(requirement.currentPrice, 4950);
  assert.equal(requirement.increment, 110);
  assert.equal(requirement.requiredPrice, 5060);
}
