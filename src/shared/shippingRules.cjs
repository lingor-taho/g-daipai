function normalizeShippingFeeText(value) {
  const amount = String(value || '').replace(/[^\d]/g, '');
  return amount ? `${amount}円` : '';
}

function parseShippingFeeToNumber(shippingFeeText) {
  const text = String(shippingFeeText || '').trim();
  if (!text || text === '-') return 0;
  if (/無料|着払い|落札者負担/i.test(text)) return 0;
  const match = text.match(/(\d[\d,]*)\s*円/);
  return match ? Number(match[1].replace(/,/g, '')) || 0 : 0;
}

function canSettleShippingFeeText(shippingFeeText) {
  const text = String(shippingFeeText || '').trim();
  if (!text || text === '-') return false;
  if (/落札者負担/.test(text)) return false;
  if (/着払い/.test(text)) return true;
  if (/無料/i.test(text)) return true;
  return /(\d[\d,]*)\s*円/.test(text);
}

function getEffectiveShippingFeeText(order = {}) {
  const bundleText = String(order.bundle_shipping_fee_text || '').trim();
  if (bundleText) return bundleText;
  return String(order.shipping_fee_text || '').trim();
}

function canSettleOrderShippingFee(order = {}) {
  const effectiveShippingFeeText = getEffectiveShippingFeeText(order);
  if (String(order.product_type || '') === 'store' && /落札者負担/.test(effectiveShippingFeeText)) {
    return true;
  }
  return canSettleShippingFeeText(effectiveShippingFeeText);
}

module.exports = {
  normalizeShippingFeeText,
  parseShippingFeeToNumber,
  canSettleShippingFeeText,
  canSettleOrderShippingFee,
  getEffectiveShippingFeeText
};
