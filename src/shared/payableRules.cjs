const { taxExcludedToTaxIncluded } = require('./priceRules.cjs');
const { parseShippingFeeToNumber } = require('./shippingRules.cjs');

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function calculateOrderPayable({ finalPrice, taxType, shippingFeeText, config }) {
  const finalPriceValue = Number(finalPrice || 0);
  const shippingFee = parseShippingFeeToNumber(shippingFeeText);
  const rate = Number(config?.rate || 0);
  const bankFeeJpy = Number(config?.bankFeeJpy || 0);
  const handlingFeeCny = Number(config?.handlingFeeCny || 0);
  const taxIncludedFinalPrice = taxExcludedToTaxIncluded(finalPriceValue, taxType);
  const largeAmountFeeApplied = taxIncludedFinalPrice >= 30000;
  const largeAmountFeeCny = largeAmountFeeApplied ? Number(config?.largeAmountFeeCny || 0) : 0;
  const payableCny = Number((((finalPriceValue + shippingFee + bankFeeJpy) * rate) + handlingFeeCny + largeAmountFeeCny).toFixed(2));

  return {
    finalPrice: finalPriceValue,
    taxIncludedFinalPrice,
    shippingFee,
    rate,
    bankFeeJpy,
    handlingFeeCny,
    largeAmountFeeCny,
    largeAmountFeeApplied,
    payableCny
  };
}

function applySheetUserFinance(baseConfig = {}, order = {}) {
  const rateAdjustment = normalizeNullableNumber(order.user_rate_adjustment) || 0;
  const bankFeeJpy = normalizeNullableNumber(order.user_bank_fee_jpy);
  const handlingFeeCny = normalizeNullableNumber(order.user_handling_fee_cny);
  const largeAmountFeeCny = normalizeNullableNumber(order.user_large_amount_fee_cny);
  return {
    rate: Number((Number(baseConfig.rate || 0) + rateAdjustment).toFixed(4)),
    bankFeeJpy: bankFeeJpy !== null ? bankFeeJpy : Number(baseConfig.bankFeeJpy || 0),
    handlingFeeCny: handlingFeeCny !== null ? handlingFeeCny : Number(baseConfig.handlingFeeCny || 0),
    largeAmountFeeCny: largeAmountFeeCny !== null ? largeAmountFeeCny : Number(baseConfig.largeAmountFeeCny || 0)
  };
}

function calculateSheetPayable(order = {}, baseConfig = {}) {
  const finalPrice = Number(order.final_price || 0);
  const effectiveShippingText = String(order.bundle_shipping_fee_text || '').trim() || String(order.shipping_fee_text || '').trim();
  const shippingFee = parseShippingFeeToNumber(effectiveShippingText);
  const config = applySheetUserFinance(baseConfig, order);
  const taxIncludedFinalPrice = taxExcludedToTaxIncluded(finalPrice, order.tax_type);
  const largeAmountFeeCny = taxIncludedFinalPrice >= 30000 ? Number(config.largeAmountFeeCny || 0) : 0;
  return {
    totalJpy: finalPrice + shippingFee,
    payableCny: Number((((finalPrice + shippingFee + Number(config.bankFeeJpy || 0)) * Number(config.rate || 0)) + Number(config.handlingFeeCny || 0) + largeAmountFeeCny).toFixed(2))
  };
}

module.exports = {
  calculateOrderPayable,
  calculateSheetPayable,
  applySheetUserFinance,
  normalizeNullableNumber
};
