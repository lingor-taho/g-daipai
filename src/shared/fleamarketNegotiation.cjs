const DUPLICATE_NEGOTIATION = '该商品已经提交过砍价了！';

function minimumNegotiationPrice(itemPrice) {
  return Math.ceil(itemPrice * 4 / 5);
}

function isNegotiationPriceValid(price, itemPrice) {
  return Number.isSafeInteger(price) && Number.isSafeInteger(itemPrice) &&
    itemPrice > 300 && price >= Math.max(300, minimumNegotiationPrice(itemPrice)) && price < itemPrice;
}

module.exports = { DUPLICATE_NEGOTIATION, minimumNegotiationPrice, isNegotiationPriceValid };
