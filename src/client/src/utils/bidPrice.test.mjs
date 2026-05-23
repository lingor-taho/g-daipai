import assert from 'node:assert/strict';
import {
  getActualBidPrice,
  getSubmitTaxType,
  isStoreProduct
} from './bidPrice.js';

function testStoreProductDetection() {
  assert.equal(isStoreProduct({ taxType: 'tax_included' }), true);
  assert.equal(isStoreProduct({ tax_type: 'tax_included' }), true);
  assert.equal(isStoreProduct({ taxType: 'tax_zero' }), false);
}

function testTaxBeforeStoreBidUsesNormalSubmitTaxAndShowsTaxIncludedActual() {
  const product = { taxType: 'tax_included' };

  assert.equal(getSubmitTaxType(product, 'tax_before'), 'tax_zero');
  assert.equal(getActualBidPrice(1000, product, 'tax_before'), 1100);
}

function testTaxAfterStoreBidKeepsExistingTaxIncludedSubmitAndActual() {
  const product = { taxType: 'tax_included' };

  assert.equal(getSubmitTaxType(product, 'tax_after'), 'tax_included');
  assert.equal(getActualBidPrice(1100, product, 'tax_after'), 1100);
}

function testNormalProductDoesNotApplyStoreMode() {
  const product = { taxType: 'tax_zero' };

  assert.equal(getSubmitTaxType(product, 'tax_before'), 'tax_zero');
  assert.equal(getActualBidPrice(1000, product, 'tax_before'), 1000);
}

testStoreProductDetection();
testTaxBeforeStoreBidUsesNormalSubmitTaxAndShowsTaxIncludedActual();
testTaxAfterStoreBidKeepsExistingTaxIncludedSubmitAndActual();
testNormalProductDoesNotApplyStoreMode();
