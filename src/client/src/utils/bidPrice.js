export function isStoreProduct(product) {
  return (product?.taxType || product?.tax_type) === 'tax_included';
}

export function getSubmitTaxType(product, storeBidPriceMode) {
  if (!isStoreProduct(product)) return product?.taxType || product?.tax_type || 'tax_zero';
  return 'tax_included';
}

export function getActualBidPrice(maxPrice, product, storeBidPriceMode) {
  const value = Number(maxPrice || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (isStoreProduct(product) && storeBidPriceMode === 'tax_before') {
    return Math.floor(value * 1.1);
  }
  return Math.floor(value);
}

export function getSubmitMaxPrice(maxPrice, product, storeBidPriceMode) {
  if (isStoreProduct(product) && storeBidPriceMode === 'tax_before') {
    return getActualBidPrice(maxPrice, product, storeBidPriceMode);
  }
  const value = Number(maxPrice || 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

// current_price 来自 proxy.js 抓的 Yahoo HTML `price` 字段，始终是税前口径
// （商城商品页面显示的"現在 ××円（税込）"是税后，但 HTML 里另存了 price=税前 + taxinPrice=税后）。
// effectiveMaxPrice / user_max_price 是税后口径，要跟它比就把税前 current_price ×1.1 加税。
export function getComparableCurrentPrice(product) {
  const value = Number(product?.currentPrice ?? product?.current_price ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!isStoreProduct(product) || value < 10) return Math.floor(value);
  return Math.floor(value * 1.1);
}

export function isSubmitMaxPriceAboveCurrentPrice(submitMaxPrice, product) {
  const currentPrice = getComparableCurrentPrice(product);
  if (currentPrice <= 0) return true;
  return Number(submitMaxPrice || 0) > currentPrice;
}
