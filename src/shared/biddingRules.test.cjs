const assert = require('assert');
const {
  getMinBidIncrement,
  getRequiredBidMaxPrice,
  shouldSplitDirectBidByYahooLowPriceRule,
  resolveBuyoutTaskPrices
} = require('./biddingRules.cjs');

assert.equal(getMinBidIncrement(999), 10);
assert.equal(getMinBidIncrement(1000), 100);
assert.equal(getMinBidIncrement(4999), 100);
assert.equal(getMinBidIncrement(5000), 250);
assert.equal(getMinBidIncrement(9999), 250);
assert.equal(getMinBidIncrement(10000), 500);
assert.equal(getMinBidIncrement(49999), 500);
assert.equal(getMinBidIncrement(50000), 1000);

assert.equal(getRequiredBidMaxPrice(9841, 0), 9841);
assert.equal(getRequiredBidMaxPrice(9841, 1), 10091);

assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
  strategy: 'direct',
  bidMode: 'bid',
  currentPrice: 500,
  submitMaxPrice: 15000,
  taxType: 'tax_zero'
}), true);
assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
  strategy: 'direct',
  bidMode: 'bid',
  currentPrice: 1000,
  submitMaxPrice: 15000,
  taxType: 'tax_zero'
}), false);
assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
  strategy: 'multi_bid',
  bidMode: 'bid',
  currentPrice: 500,
  submitMaxPrice: 15000,
  taxType: 'tax_zero'
}), false);
assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
  strategy: 'direct',
  bidMode: 'buyout',
  currentPrice: 500,
  submitMaxPrice: 15000,
  taxType: 'tax_zero'
}), false);
assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
  strategy: 'direct',
  bidMode: 'bid',
  currentPrice: 1,
  submitMaxPrice: 10010,
  taxType: 'tax_included'
}), false);
assert.equal(shouldSplitDirectBidByYahooLowPriceRule({
  strategy: 'direct',
  bidMode: 'bid',
  currentPrice: 1,
  submitMaxPrice: 12100,
  taxType: 'tax_included'
}), true);

assert.deepEqual(resolveBuyoutTaskPrices({
  fetchedBuyoutPrice: 0,
  submittedBuyoutPrice: 275100,
  inputMaxPrice: 0,
  taxType: 'tax_included'
}), {
  buyoutPrice: 275100,
  userMaxPrice: 275100,
  bidMaxPrice: 275100
});

console.log('bidding rules tests passed');
