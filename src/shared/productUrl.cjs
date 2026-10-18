const { getStoredProductType } = require('./fleamarket.cjs');

function getProductItemUrl(input) {
  const type = getStoredProductType(input);
  const id = String(input?.product_id || input?.productId || input?.auctionId || '').trim().toLowerCase();
  if (!id || !type) return '';
  return type === 'fleamarket' ? `https://paypayfleamarket.yahoo.co.jp/item/${id}` : `https://auctions.yahoo.co.jp/jp/auction/${id}`;
}

module.exports = { getProductItemUrl };
