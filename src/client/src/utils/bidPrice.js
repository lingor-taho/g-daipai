export function isStoreProduct(product) {
  return (product?.taxType || product?.tax_type) === 'tax_included';
}

export function getSubmitTaxType(product, storeBidPriceMode) {
  if (!isStoreProduct(product)) return product?.taxType || product?.tax_type || 'tax_zero';
  return storeBidPriceMode === 'tax_before' ? 'tax_zero' : 'tax_included';
}

export function getActualBidPrice(maxPrice, product, storeBidPriceMode) {
  const value = Number(maxPrice || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (isStoreProduct(product) && storeBidPriceMode === 'tax_before') {
    return Math.floor(value * 1.1);
  }
  return Math.floor(value);
}
