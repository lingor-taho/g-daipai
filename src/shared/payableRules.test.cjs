const assert = require('assert');
const {
  calculateOrderPayable,
  calculateSheetPayable
} = require('./payableRules.cjs');

assert.deepEqual(calculateOrderPayable({
  finalPrice: 20000,
  taxType: 'tax_zero',
  shippingFeeText: '送料 1,000円',
  config: {
    rate: 0.05,
    bankFeeJpy: 500,
    handlingFeeCny: 15,
    largeAmountFeeCny: 0
  }
}), {
  finalPrice: 20000,
  taxIncludedFinalPrice: 20000,
  shippingFee: 1000,
  rate: 0.05,
  bankFeeJpy: 500,
  handlingFeeCny: 15,
  largeAmountFeeCny: 0,
  largeAmountFeeApplied: false,
  payableCny: 1090
});

assert.deepEqual(calculateOrderPayable({
  finalPrice: 28000,
  taxType: 'tax_included',
  shippingFeeText: '送料 無料',
  config: {
    rate: 0.05,
    bankFeeJpy: 0,
    handlingFeeCny: 0,
    largeAmountFeeCny: 30
  }
}), {
  finalPrice: 28000,
  taxIncludedFinalPrice: 30800,
  shippingFee: 0,
  rate: 0.05,
  bankFeeJpy: 0,
  handlingFeeCny: 0,
  largeAmountFeeCny: 30,
  largeAmountFeeApplied: true,
  payableCny: 1430
});

assert.deepEqual(calculateSheetPayable({
  final_price: 20000,
  tax_type: 'tax_zero',
  shipping_fee_text: '送料 1,000円',
  user_rate_adjustment: 0.01,
  user_bank_fee_jpy: 100,
  user_handling_fee_cny: null,
  user_large_amount_fee_cny: null
}, {
  rate: 0.05,
  bankFeeJpy: 500,
  handlingFeeCny: 15,
  largeAmountFeeCny: 20
}), {
  totalJpy: 21000,
  payableCny: 1281
});

console.log('payable rules tests passed');
