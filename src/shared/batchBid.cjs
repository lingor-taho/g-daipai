const MAX_BATCH_BID_ITEMS = 50;
const AUCTION_ID_PATTERN = /^[a-z]?\d{8,10}$/i;

function normalizeBatchProduct(input) {
  const value = String(input || '').trim();
  let productId = value;
  if (!AUCTION_ID_PATTERN.test(value)) {
    let url;
    try { url = new URL(value); } catch (_) { throw new Error('商品 ID 或链接格式错误'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) {
      throw new Error('商品链接格式错误');
    }
    const host = url.hostname.toLowerCase();
    let match;
    if (['auctions.yahoo.co.jp', 'page.auctions.yahoo.co.jp'].includes(host)) {
      match = url.pathname.match(/^\/jp\/auction\/([a-z]?\d{8,10})\/?$/i);
    } else if (['gougoujp.com', 'www.gougoujp.com', 'm.gougoujp.com'].includes(host)) {
      match = url.pathname.match(/^\/aucitem\/([a-z]?\d{8,10})\/?$/i);
    } else if (['fromjapan.co.jp', 'www.fromjapan.co.jp'].includes(host)) {
      match = url.pathname.match(/^\/japan\/[a-z]+\/auction\/yahoo\/input\/([a-z]?\d{8,10})\/?$/i);
    }
    if (!match) throw new Error('请输入 Yahoo 拍卖商品 ID 或商品链接');
    productId = match[1];
  }
  productId = productId.toLowerCase();
  return { productId, standardUrl: `https://auctions.yahoo.co.jp/jp/auction/${productId}` };
}

function normalizeBatchPrice(input) {
  const text = String(input ?? '').trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) {
    throw new Error('最高价必须为正整数日元');
  }
  const price = Number(text.replace(/,/g, ''));
  if (!Number.isSafeInteger(price) || price <= 0 || !Number.isSafeInteger(Math.ceil(price * 1.1))) {
    throw new Error('最高价必须为有效的正整数日元');
  }
  return price;
}

function parseBatchBidText(input) {
  const rows = String(input || '').split(/\r\n|\r|\n/).flatMap((text, index) => {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const row = { line: index + 1, text: trimmed };
    // Read the price from the right, preserving commas used as thousands separators.
    const match = trimmed.match(/^(\S+?)[\s,，;；|｜:：、]+(\d[\d,]*)$/);
    try {
      if (!match) throw new Error('每行请输入商品 ID 或链接，再输入最高价');
      Object.assign(row, normalizeBatchProduct(match[1]));
      row.maxPrice = normalizeBatchPrice(match[2]);
    } catch (error) { row.error = error.message; }
    return [row];
  });
  if (!rows.length) throw new Error('请输入批量商品');
  if (rows.length > MAX_BATCH_BID_ITEMS) throw new Error(`每批最多提交 ${MAX_BATCH_BID_ITEMS} 件商品`);
  const counts = new Map();
  for (const row of rows) {
    if (row.productId) counts.set(row.productId, (counts.get(row.productId) || 0) + 1);
  }
  for (const row of rows) {
    if (counts.get(row.productId) > 1) row.error = '同一批次商品 ID 重复，请只保留一行';
  }
  return rows;
}

module.exports = { MAX_BATCH_BID_ITEMS, normalizeBatchProduct, normalizeBatchPrice, parseBatchBidText };
