// Admin links use the saved product type only. Missing types have no link.
function getProductItemUrl(item = {}) {
  const id = String(item?.product_id || item?.productId || '').trim().toLowerCase();
  const type = Object.prototype.hasOwnProperty.call(item || {}, 'link_product_type') ? item.link_product_type : item?.product_type;
  if (!id) return '';
  if (type === 'fleamarket') return `https://paypayfleamarket.yahoo.co.jp/item/${id}`;
  if (type === 'normal' || type === 'store') return `https://auctions.yahoo.co.jp/jp/auction/${id}`;
  return '';
}

module.exports = { getProductItemUrl };
