import productUrl from '../../../shared/productUrl.cjs';

export function getAuctionProductUrl(item) {
  return productUrl.getProductItemUrl(item);
}

export function getRebidSubmitPath(item) {
  const productUrl = getAuctionProductUrl(item);
  return productUrl ? `/submit?url=${encodeURIComponent(productUrl)}` : '/submit';
}
