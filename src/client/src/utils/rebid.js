export function getAuctionProductUrl(item) {
  const productUrl = String(item?.product_url || '').trim();
  if (productUrl) return productUrl;

  const productId = String(item?.product_id || '').trim();
  return productId ? `https://auctions.yahoo.co.jp/jp/auction/${productId}` : '';
}

export function getRebidSubmitPath(item) {
  const productUrl = getAuctionProductUrl(item);
  return productUrl ? `/submit?url=${encodeURIComponent(productUrl)}` : '/submit';
}
