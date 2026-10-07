const YAHOO_ORIGIN = 'https://auctions.yahoo.co.jp';

function historyError(message, statusCode = 502) {
  return Object.assign(new Error(message), { statusCode });
}

function buildBidHistoryUrl(auctionId, pageUrl) {
  const id = String(auctionId || '').trim().toLowerCase();
  if (!/^[a-z]?\d{8,10}$/.test(id)) throw historyError('商品 ID 无效', 400);
  const url = pageUrl
    ? new URL(String(pageUrl), YAHOO_ORIGIN)
    : new URL(`/jp/show/bid_hist?aID=${id}`, YAHOO_ORIGIN);
  if (url.origin !== YAHOO_ORIGIN || url.username || url.password ||
      !/^\/jp\/show\/bid_hist(?:_all)?$/.test(url.pathname) ||
      url.searchParams.get('aID')?.toLowerCase() !== id || url.toString().length > 1000) {
    throw historyError('拍卖记录页面地址无效', 400);
  }
  url.hash = '';
  return url.toString();
}

function decodeYahooHtml(buffer, contentType = '') {
  const probe = buffer.toString('ascii', 0, Math.min(buffer.length, 4096));
  const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1] ||
    /charset\s*=\s*["']?([\w-]+)/i.exec(probe)?.[1] || 'utf-8';
  try { return new TextDecoder(charset).decode(buffer); }
  catch (_) { return buffer.toString('utf8'); }
}

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, key) => {
    if (key[0] !== '#') return named[key.toLowerCase()];
    const number = /^#x/i.test(key) ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return number <= 0x10ffff ? String.fromCodePoint(number) : raw;
  });
}

function text(html) {
  return decodeEntities(String(html || '')
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<img\b[^>]*\balt\s*=\s*(["'])(.*?)\1[^>]*>/gi, ' $2 ')
    .replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parseBidHistoryHtml(html, auctionId, pageUrl) {
  const source = String(html || '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  let tableResult = null;
  // Match leaf tables, so legacy Yahoo layout tables cannot become history rows.
  for (const table of source.matchAll(/<table\b[^>]*>((?:(?!<table\b)[\s\S])*?)<\/table>/gi)) {
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map(row => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => text(cell[1])));
    const headerIndex = rows.findIndex(cells =>
      cells.some(cell => /入札者/.test(cell)) && cells.some(cell => /入札額/.test(cell)) &&
      cells.some(cell => /時間|日時/.test(cell)));
    if (headerIndex < 0) continue;
    const headers = rows[headerIndex];
    const amountIndex = headers.findIndex(cell => /入札額/.test(cell));
    const dataRows = rows.slice(headerIndex + 1).filter(cells =>
      cells.length === headers.length && /\d[\d,]*\s*円/.test(cells[amountIndex]));
    const empty = /入札(?:者|履歴|は|が|件数)[^。]{0,35}(?:ありません|いません|なし|まだ|0件)|まだ[^。]{0,20}入札/.test(text(table[1]));
    if (dataRows.length || empty) { tableResult = { headers, rows: dataRows }; break; }
  }
  const pageText = text(source);
  if (!tableResult && /入札履歴/.test(pageText) &&
      /入札(?:者|履歴|は|が|件数)[^。]{0,35}(?:ありません|いません|なし|まだ|0件)|まだ[^。]{0,20}入札/.test(pageText)) {
    tableResult = { headers: ['入札者 / 評価', '入札額', '個数', '最後に手動入札した時間'], rows: [] };
  }
  if (!tableResult) throw historyError('Yahoo 拍卖记录暂时无法读取，可能需要登录或页面已失效，请稍后重试');
  const links = [];
  for (const anchor of source.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = text(anchor[3]);
    if (!/入札者の順位|すべての入札履歴|全ての入札履歴|次|前|^\d+$/.test(label)) continue;
    try {
      const url = buildBidHistoryUrl(auctionId, new URL(decodeEntities(anchor[2]), pageUrl).toString());
      if (url !== pageUrl && !links.some(link => link.url === url)) links.push({ label, url });
    } catch (_) {}
  }
  return { auctionId, ...tableResult, links, pageLabel: pageText.match(/\d+\s*\/\s*\d+\s*ページ/)?.[0] || '' };
}

function createBidHistoryService({ httpFetcher, playwrightFetcher }) {
  return {
    async fetchBidHistory(auctionId, pageUrl) {
      let url;
      try { url = buildBidHistoryUrl(auctionId, pageUrl); }
      catch (error) { throw historyError(error.statusCode ? error.message : '拍卖记录页面地址无效', 400); }
      const id = new URL(url).searchParams.get('aID').toLowerCase();
      for (const [source, fetcher] of [['http', httpFetcher], ['playwright', playwrightFetcher]]) {
        try {
          const html = await fetcher(url);
          return { success: true, data: parseBidHistoryHtml(html, id, url), source };
        } catch (_) {}
      }
      throw historyError('Yahoo 拍卖记录加载失败，请稍后重试；记录页可能需要登录或已失效');
    }
  };
}

module.exports = { buildBidHistoryUrl, decodeYahooHtml, parseBidHistoryHtml, createBidHistoryService };
