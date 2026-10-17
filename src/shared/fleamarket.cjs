const FLEAMARKET_PURCHASE_BLOCKED_MESSAGE = 'Yahoo!フリマ 暂时无法购买，请联系管理员！';

function isFleamarketProduct(input) {
  if (input && typeof input === 'object') {
    if (input.isFleamarket || input.isFleamarketItem) return true;
    return [input.auctionId, input.product_id, input.standardUrl, input.product_url]
      .some(value => isFleamarketProduct(value));
  }
  const value = String(input || '').trim();
  return /^z\d{8,10}$/i.test(value.match(/[a-zA-Z]?\d{8,10}/)?.[0] || '') ||
    /^(?:https?:\/\/)?paypayfleamarket\.yahoo\.co\.jp\/item\//i.test(value);
}

module.exports = { isFleamarketProduct, FLEAMARKET_PURCHASE_BLOCKED_MESSAGE };
