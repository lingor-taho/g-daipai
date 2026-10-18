const FLEAMARKET_BATCH_UNSUPPORTED_MESSAGE = '不支持フリマ商品！';

function isFleamarketProduct(input) {
  if (input && typeof input === 'object') {
    if (input.isFleamarket || input.isFleamarketItem || input.productType === 'fleamarket' || input.product_type === 'fleamarket') return true;
    return [input.auctionId, input.product_id, input.productId, input.standardUrl, input.product_url, input.productUrl]
      .some(value => isFleamarketProduct(value));
  }
  const value = String(input || '').trim();
  return /^z\d{8,10}$/i.test(value.match(/[a-zA-Z]?\d{8,10}/)?.[0] || '') ||
    /^(?:https?:\/\/)?paypayfleamarket\.yahoo\.co\.jp\/item\//i.test(value);
}

// Saved products/jobs must use their recorded type. ID/URL detection above is
// reserved for the first user input, before product information is available.
function getStoredProductType(input) {
  const type = input?.product_type ?? input?.productType;
  return ['normal', 'store', 'fleamarket'].includes(type) ? type : '';
}

function isStoredFleamarketProduct(input) {
  return getStoredProductType(input) === 'fleamarket';
}

module.exports = { isFleamarketProduct, isStoredFleamarketProduct, getStoredProductType, FLEAMARKET_BATCH_UNSUPPORTED_MESSAGE };
