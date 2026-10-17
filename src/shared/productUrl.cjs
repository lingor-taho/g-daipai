const { isFleamarketProduct } = require('./fleamarket.cjs');

function getProductItemUrl(input) {
  const item = input && typeof input === 'object' ? input : { product_id: input };
  const existing = String(item.product_url || item.productUrl || item.standardUrl || '').trim();
  const id = String(item.product_id || item.productId || item.auctionId || existing.match(/[a-zA-Z]?\d{8,10}/)?.[0] || '').trim().toLowerCase();
  if (id && isFleamarketProduct(item)) return `https://paypayfleamarket.yahoo.co.jp/item/${id}`;
  return existing || (id ? `https://auctions.yahoo.co.jp/jp/auction/${id}` : '');
}

module.exports = { getProductItemUrl };
