export function formatBidSubmissionTime(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

export function buildBidPriceMarkers(bids, currentPrice, width = 320) {
  const endpoint = Number(currentPrice);
  if (!Number.isFinite(endpoint) || endpoint <= 0) return [];
  const scaleMax = Math.max(endpoint, ...bids.map(bid => Number(bid.amount)).filter(amount => Number.isFinite(amount) && amount >= 0));
  const lanes = [];
  return bids.map(bid => {
    const amount = Number(bid.amount);
    if (!Number.isFinite(amount) || amount < 0) return null;
    const x = amount / scaleMax * width;
    let lane = 0;
    while (lanes[lane]?.some(position => Math.abs(position - x) < 12)) lane += 1;
    if (!lanes[lane]) lanes[lane] = [];
    lanes[lane].push(x);
    return { ...bid, amount, x, lane, overflow: amount > endpoint, scaleMax, currentX: endpoint / scaleMax * width };
  }).filter(Boolean);
}
