function formatDateTime(value) {
  if (!value) return '-';
  const raw = String(value).trim();
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw);
  if (Number.isNaN(date.getTime())) return raw;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

function formatDateOnly(value) {
  const raw = String(value || '').trim();
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const formatted = formatDateTime(raw);
  return formatted === '-' ? '-' : formatted.slice(0, 10);
}

function parseCsvShippingFee(value) {
  const text = String(value || '').trim();
  if (!text || text === '-' || /無料/.test(text)) return 0;
  const match = text.match(/([\d,]+)\s*円/);
  if (match) return Number(match[1].replace(/,/g, '')) || 0;
  const numeric = Number(text.replace(/[,\s円]/g, ''));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function needsCsvShippingInput(row) {
  return /落札者負担|着払い/.test(String(row?.shipping_fee_text || ''));
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parsePayableCny(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildOrdersCsv(rows = [], shippingOverrides = {}) {
  const headers = ['落札日期', '用户名', '商品链接', '商品标题', '落札价', '运费', '总价', '应付款(RMB)'];
  const totals = [];
  const payableTotals = [];
  const lines = rows.map(row => {
    const finalPrice = Number(row.final_price || 0);
    const shippingFee = needsCsvShippingInput(row)
      ? Number(shippingOverrides[String(row.id)] || 0)
      : parseCsvShippingFee(row.shipping_fee_text);
    const total = finalPrice + shippingFee;
    const payableCny = parsePayableCny(row.payable_cny);
    totals.push(total);
    if (payableCny !== null) payableTotals.push(payableCny);
    const productId = row.product_id || row.product_url?.match(/[a-zA-Z]?\d{8,10}/)?.[0] || '';
    const productUrl = row.product_url || (productId ? `https://auctions.yahoo.co.jp/jp/auction/${productId}` : '');
    return [
      formatDateOnly(row.won_at),
      row.username || '',
      productUrl,
      row.product_title || '',
      finalPrice,
      shippingFee,
      total,
      payableCny ?? ''
    ].map(csvEscape).join(',');
  });
  const totalAmount = totals.reduce((sum, value) => sum + value, 0);
  const payableTotalAmount = payableTotals.reduce((sum, value) => sum + value, 0);
  lines.push(['金额汇总', '', '', '', '', '', totalAmount, payableTotals.length ? payableTotalAmount : ''].map(csvEscape).join(','));
  return `${headers.join(',')}\r\n${lines.join('\r\n')}`;
}

module.exports = {
  buildOrdersCsv,
  csvEscape,
  formatDateOnly,
  needsCsvShippingInput,
  parsePayableCny,
  parseCsvShippingFee
};
