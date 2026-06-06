export function isStoreProduct(product) {
  return (product?.taxType || product?.tax_type) === 'tax_included';
}

export function isBuyoutOnlyProduct(product) {
  const buyoutPrice = getBuyoutPrice(product);
  return Boolean(product?.buyoutOnly || product?.buyout_only) && buyoutPrice > 0;
}

export function getBuyoutPrice(product) {
  const directBuyoutPrice = Number(product?.buyoutPrice ?? product?.buyout_price ?? 0);
  if (Number.isFinite(directBuyoutPrice) && directBuyoutPrice > 0) {
    return Math.floor(directBuyoutPrice);
  }
  if (product?.buyoutOnly || product?.buyout_only) {
    const currentPrice = Number(product?.currentPrice ?? product?.current_price ?? 0);
    if (Number.isFinite(currentPrice) && currentPrice > 0) return Math.floor(currentPrice);
  }
  return 0;
}

export function getBuyoutSubmitPrice(product) {
  return getBuyoutPrice(product);
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

export function getYahooMinimumBidIncrement(currentTaxExcludedPrice) {
  const value = Number(currentTaxExcludedPrice || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value < 1000) return 10;
  if (value < 5000) return 100;
  if (value < 10000) return 250;
  if (value < 50000) return 500;
  return 1000;
}

export function getRequiredTaxExcludedBidPrice(product) {
  const currentPrice = Number(product?.currentPrice ?? product?.current_price ?? 0);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return 0;
  const bidCount = Number(product?.bidCount ?? product?.bid_count ?? 0);
  const increment = Number.isFinite(bidCount) && bidCount > 0
    ? getYahooMinimumBidIncrement(currentPrice)
    : 0;
  return Math.floor(currentPrice + increment);
}

export function isSubmitTaxExcludedPriceAtLeastRequiredBid(submitTaxExcludedPrice, product) {
  const required = getRequiredTaxExcludedBidPrice(product);
  if (required <= 0) return true;
  return Number(submitTaxExcludedPrice || 0) >= required;
}

export function getMinimumBidInputRequirement(product, storeBidPriceMode) {
  const currentTaxExcludedPrice = Number(product?.currentPrice ?? product?.current_price ?? 0);
  if (!Number.isFinite(currentTaxExcludedPrice) || currentTaxExcludedPrice <= 0) {
    return { currentPrice: 0, increment: 0, requiredPrice: 0, currentLabel: '当前价' };
  }

  const bidCount = Number(product?.bidCount ?? product?.bid_count ?? 0);
  const increment = Number.isFinite(bidCount) && bidCount > 0
    ? getYahooMinimumBidIncrement(currentTaxExcludedPrice)
    : 0;
  const storeProduct = isStoreProduct(product);
  const useTaxIncludedInput = storeProduct && storeBidPriceMode === 'tax_after';
  const currentPrice = useTaxIncludedInput
    ? getComparableCurrentPrice(product)
    : Math.floor(currentTaxExcludedPrice);
  const displayIncrement = useTaxIncludedInput && increment > 0
    ? Math.floor(increment * 1.1)
    : increment;
  const currentLabel = storeProduct
    ? (useTaxIncludedInput ? '当前税后价' : '当前税前价')
    : '当前价';

  return {
    currentPrice,
    increment: displayIncrement,
    requiredPrice: Math.floor(currentPrice + displayIncrement),
    currentLabel
  };
}

export function isSubmitMaxPriceAboveCurrentPrice(submitMaxPrice, product) {
  const currentPrice = getComparableCurrentPrice(product);
  if (currentPrice <= 0) return true;
  return Number(submitMaxPrice || 0) > currentPrice;
}
