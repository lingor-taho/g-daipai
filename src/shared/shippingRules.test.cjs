const assert = require('assert');
const {
  normalizeShippingFeeText,
  parseShippingFeeToNumber,
  canSettleShippingFeeText,
  canSettleOrderShippingFee,
  getEffectiveShippingFeeText
} = require('./shippingRules.cjs');

assert.equal(normalizeShippingFeeText('送料 1,000円'), '1000円');
assert.equal(normalizeShippingFeeText('送料 無料'), '');
assert.equal(parseShippingFeeToNumber('送料 無料'), 0);
assert.equal(parseShippingFeeToNumber('送料 着払い'), 0);
assert.equal(parseShippingFeeToNumber('送料 落札者負担'), 0);
assert.equal(parseShippingFeeToNumber('送料 1,000円'), 1000);
assert.equal(parseShippingFeeToNumber('全国一律 230円'), 230);

assert.equal(canSettleShippingFeeText('送料 無料'), true);
assert.equal(canSettleShippingFeeText('全国一律 230円'), true);
assert.equal(canSettleShippingFeeText('送料 着払い'), true);
assert.equal(canSettleShippingFeeText('送料 落札者負担'), false);
assert.equal(canSettleShippingFeeText('待定'), false);

assert.equal(canSettleOrderShippingFee({
  product_type: 'store',
  shipping_fee_text: '送料 落札者負担'
}), true);
assert.equal(canSettleOrderShippingFee({
  product_type: 'normal',
  shipping_fee_text: '送料 落札者負担'
}), false);
assert.equal(canSettleOrderShippingFee({
  product_type: 'normal',
  shipping_fee_text: '送料 落札者負担',
  bundle_shipping_fee_text: '0円'
}), true);

assert.equal(getEffectiveShippingFeeText({
  shipping_fee_text: '送料 1,000円',
  bundle_shipping_fee_text: '0円'
}), '0円');

console.log('shipping rules tests passed');
