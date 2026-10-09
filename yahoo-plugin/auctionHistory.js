// Injected into the authenticated Yahoo history page. No network or page actions.
function parseAuctionHistoryRow(rawTime, text) {
  const date = String(rawTime).match(/(\d{1,2})月\s*(\d{1,2})日\s*(\d{1,2})時\s*(\d{1,2})分/);
  if (!date) throw new Error('history time not recognized');
  const time = `${Number(date[1])}-${Number(date[2])} ${date[3].padStart(2,'0')}:${date[4].padStart(2,'0')}`;
  const start = /オークション開始/.test(text);
  const startAmount = start && String(text).match(/オークション開始。\s*数量\s*[:：]\s*\d+\s*で\s*([\d,]+)\s*(?:円)?\s*$/);
  const match = String(text).match(/^\s*(.*?)\s*(?:自動入札。\s*|入札。\s*数量\s*[:：]\s*\d+\s*で\s*)([\d,]+)\s*(?:円)?\s*$/);
  if (start ? !startAmount : !match) throw new Error('history bid not recognized');
  const price = Number((start ? startAmount[1] : match[2]).replace(/,/g,''));
  if (!Number.isSafeInteger(price) || price < 0) throw new Error('history price not recognized');
  return {rawTime:String(rawTime).trim(),text:String(text).trim(),time,username:start?'开始':match[1].trim(),price,start};
}
function readAuctionHistoryPage() {
  const body = document.body?.innerText || '';
  if (!/\/jp\/show\/bid_hist$/.test(location.pathname) || document.querySelector('input[type="password"]') || /ログインしてください|ログインが必要/.test(body)) return {error:'login required'};
  if (body.includes('指定されたドキュメントは存在しません。')) return {expired:true,documentMissing:true};
  // Only explicit history-unavailable messages are terminal. Generic errors remain retryable.
  if (/入札履歴.{0,30}(?:表示期間|保存期間).{0,30}(?:過ぎ|終了)|(?:表示期間|保存期間).{0,30}(?:過ぎ|終了).{0,30}入札履歴|このオークションの入札履歴は表示できません/.test(body)) return {expired:true};
  if (!/すべての入札履歴/.test(body)) return {error:'history page not ready'};
  if (new URL(location.href).searchParams.get('typ') !== 'log') return {error:'wrong history view'};
  const rows = []; const rawRows = [];
  for (const tr of document.querySelectorAll('tr')) {
    const cells = [...tr.querySelectorAll(':scope > td')];
    if (cells.length < 2 || !/\d+月\s*\d+日/.test(cells[0].innerText)) continue;
    const rawTime = cells[0].innerText; const text = cells.slice(1).map(c=>c.innerText).join(' ');
    rawRows.push({rawTime,text});
    try { rows.push(parseAuctionHistoryRow(rawTime,text)); }
    catch (_) { /* Non-price events such as withdrawn bids do not enter the array. */ }
  }
  if (!rows.length && !/入札履歴はありません|入札はありません|入札履歴がありません|すべての入札履歴\s*0件/.test(body)) return {error:'history rows missing'};
  let nextUrl = null;
  for (const a of document.querySelectorAll('a[href]')) {
    if (!/次の\s*\d+\s*件/.test(a.innerText)) continue;
    const url = new URL(a.href,location.href);
    const current = new URL(location.href);
    if (url.origin === current.origin && url.pathname === current.pathname && url.searchParams.get('aID') === current.searchParams.get('aID') && url.searchParams.get('typ') === 'log' && Number(url.searchParams.get('apg')) === Number(current.searchParams.get('apg') || 1)+1) nextUrl = url.href;
    else return {error:'history pagination invalid'};
  }
  if (/次の\s*\d+\s*件/.test(body) && !nextUrl && !rows.some(r=>r.start)) {
    // Disabled footer text can occur on the last page; require the start marker there.
    return {error:'history pagination missing'};
  }
  return {rows,rawRows,nextUrl};
}
globalThis.readAuctionHistoryPage = readAuctionHistoryPage;
if (typeof module !== 'undefined') module.exports = {parseAuctionHistoryRow,readAuctionHistoryPage};
