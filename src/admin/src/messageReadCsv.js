const { getProductItemUrl } = require('../../shared/productUrl.cjs');

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildProductUrl(row) {
  return getProductItemUrl(row);
}

function buildMessageReadCsv(rows = [], formatDateTime = value => String(value || '')) {
  const headers = ['用户名', '商品url', '商品名称', '落札时间', '追踪号'];
  const lines = rows.map(row => [
    row?.username || '',
    buildProductUrl(row),
    row?.product_title || '',
    row?.won_at ? formatDateTime(row.won_at) : '',
    row?.tracking_number || ''
  ].map(csvEscape).join(','));
  return `${headers.join(',')}\r\n${lines.join('\r\n')}`;
}

module.exports = {
  buildMessageReadCsv,
  buildProductUrl,
  csvEscape
};
