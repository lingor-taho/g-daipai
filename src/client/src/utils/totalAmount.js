function parseYenNumber(value) {
  const match = String(value || '').match(/([\d,]+)\s*(?:円|JPY)?/i);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

export function parseShippingFeeForTotal(shippingFeeText) {
  const text = String(shippingFeeText || '').trim();
  if (!text) return { pending: true, amount: null };
  if (/無料/.test(text)) return { pending: false, amount: 0 };

  const amount = parseYenNumber(text);
  if (amount !== null) return { pending: false, amount };

  return { pending: true, amount: null };
}

export function formatTotalAmount(price, shippingFeeText) {
  const itemPrice = Number(String(price || '').replace(/,/g, ''));
  if (!Number.isFinite(itemPrice) || itemPrice <= 0) return '待定';

  const shippingFee = parseShippingFeeForTotal(shippingFeeText);
  if (shippingFee.pending) return '待定';

  return `${Math.floor(itemPrice + shippingFee.amount).toLocaleString('ja-JP')}円`;
}
