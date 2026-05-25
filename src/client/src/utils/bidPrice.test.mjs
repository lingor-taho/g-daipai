import assert from 'node:assert/strict';
import {
  getComparableCurrentPrice,
  getActualBidPrice,
  getSubmitMaxPrice,
  getSubmitTaxType,
  isSubmitMaxPriceAboveCurrentPrice,
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

function testComparableCurrentPriceUsesTaxIncludedPriceForStoreProducts() {
  assert.equal(getComparableCurrentPrice({ taxType: 'tax_included', currentPrice: 1000 }), 1100);
  assert.equal(getComparableCurrentPrice({ taxType: 'tax_zero', currentPrice: 1000 }), 1000);
}

function testSubmitMaxPriceMustBeAboveCurrentPrice() {
  assert.equal(isSubmitMaxPriceAboveCurrentPrice(1200, { taxType: 'tax_included', currentPrice: 1000 }), true);
  assert.equal(isSubmitMaxPriceAboveCurrentPrice(1100, { taxType: 'tax_included', currentPrice: 1000 }), false);
  assert.equal(isSubmitMaxPriceAboveCurrentPrice(999, { taxType: 'tax_zero', currentPrice: 1000 }), false);
  assert.equal(isSubmitMaxPriceAboveCurrentPrice(1000, { taxType: 'tax_zero', currentPrice: 0 }), true);
}

testStoreProductDetection();
testTaxBeforeStoreBidUsesNormalSubmitTaxAndShowsTaxIncludedActual();
testTaxAfterStoreBidKeepsExistingTaxIncludedSubmitAndActual();
testNormalProductDoesNotApplyStoreMode();
testComparableCurrentPriceUsesTaxIncludedPriceForStoreProducts();
testSubmitMaxPriceMustBeAboveCurrentPrice();
