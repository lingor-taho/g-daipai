import fleamarket from '../../../shared/fleamarket.cjs';

export function getProductItemUrl(productId: string) {
  const id = String(productId || '').trim().toLowerCase();
  return fleamarket.isFleamarketProduct(id)
    ? `https://paypayfleamarket.yahoo.co.jp/item/${id}`
    : `https://auctions.yahoo.co.jp/jp/auction/${id}`;
}
