function escapeCsvValue(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function getWonTime(item) {
  return item.won_time_text || item.won_at || item.updated_at || '';
}

export function buildWonStatsCsv(items = []) {
  const header = ['商品id', '商品名称', '落札价', '运费', '落札时间'];
  const rows = items.map(item => [
    item.product_id,
    item.product_title,
    item.final_price,
    item.shipping_fee_text,
    getWonTime(item)
  ]);
  return [header, ...rows]
    .map(row => row.map(escapeCsvValue).join(','))
    .join('\r\n');
}

export function downloadCsv(filename, csv) {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
