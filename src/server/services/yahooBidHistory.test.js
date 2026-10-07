const assert = require('assert/strict');
const { buildBidHistoryUrl, decodeYahooHtml, parseBidHistoryHtml, createBidHistoryService } = require('./yahooBidHistory');

const id = 'h1247001291';
const url = buildBidHistoryUrl(id);
const fixture = `<!doctype html><html><body>
  <script>const fake = '<table><tr><td>入札者</td><td>入札額</td><td>時間</td></tr></table>';</script>
  <table><tr><td>Yahoo navigation<table>
    <tr><th>入札者 / 評価</th><th>入札額</th><th>個数</th><th>最後に手動入札した時間</th></tr>
    <tr><td><a href="https://example.com">linkwood1989</a> / 評価：新規 <img src="badge.gif" alt="最高額入札者"></td><td>1,211 円</td><td>1</td><td>10月 4日 23時 06分</td></tr>
    <tr><td>cbk******** / 評価：37 &amp; &#26032;</td><td>1,111 円</td><td>1</td><td>10月 4日 17時 16分</td></tr>
    <tr><td colspan="4">広告</td></tr>
  </table></td></tr></table>
  <p>1/2ページ</p>
  <a href="/jp/show/bid_hist?aID=${id}&amp;typ=log">すべての入札履歴</a>
  <a href="/jp/show/bid_hist?aID=${id}&amp;b=21">次のページ</a>
  <a href="/jp/show/bid_hist?aID=${id}&amp;b=21">2</a>
  <a href="https://evil.example/jp/show/bid_hist?aID=${id}">次へ</a>
  <a href="/jp/show/bid_hist?aID=a1234567890">前へ</a>
  <a href="/jp/auction/${id}">商品ページに戻る</a>
</body></html>`;

async function run() {
  assert.equal(url, `https://auctions.yahoo.co.jp/jp/show/bid_hist?aID=${id}`);
  for (const badId of ['', 'foo', `${id}&url=http://evil`, `${id}extra`]) {
    assert.throws(() => buildBidHistoryUrl(badId), error => error.statusCode === 400);
  }
  for (const badUrl of [
    `https://evil.example/jp/show/bid_hist?aID=${id}`,
    `https://auctions.yahoo.co.jp/jp/auction/${id}`,
    '/jp/show/bid_hist?aID=a1234567890',
    `https://user:password@auctions.yahoo.co.jp/jp/show/bid_hist?aID=${id}`
  ]) assert.throws(() => buildBidHistoryUrl(id, badUrl), error => error.statusCode === 400);

  const parsed = parseBidHistoryHtml(fixture, id, url);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0][0], 'linkwood1989 / 評価：新規 最高額入札者');
  assert.equal(parsed.rows[0][1], '1,211 円');
  assert.equal(parsed.rows[1][0], 'cbk******** / 評価：37 & 新');
  assert.equal(parsed.pageLabel, '1/2ページ');
  assert.equal(parsed.links.length, 2);
  assert.equal(parsed.links[0].url, `${url}&typ=log`);
  assert.equal(parsed.links[1].url, `${url}&b=21`);
  assert.equal(JSON.stringify(parsed).includes('<'), false, 'Yahoo markup is never returned as executable HTML');

  const empty = parseBidHistoryHtml('<h1>入札履歴</h1><p>このオークションにはまだ入札がありません。</p>', id, url);
  assert.deepEqual(empty.rows, []);
  for (const invalid of [
    '<h1>ログイン</h1>', '<h1>アクセスが制限されています</h1>',
    '<h1>入札履歴</h1><p>ページを表示できません</p>',
    '<table><tr><th>入札者</th><th>入札額</th><th>時間</th></tr><tr><td>error</td></tr></table>'
  ]) assert.throws(() => parseBidHistoryHtml(invalid, id, url), error => error.statusCode === 502);

  const allHistory = parseBidHistoryHtml(`<table><tr><th>入札者</th><th>入札額</th><th>入札日時</th></tr>
    <tr><td>表示名 自動入札</td><td>1,220円</td><td>10月4日23時10分</td></tr></table>`, id, url);
  assert.equal(allHistory.headers.length, 3);
  assert.deepEqual(allHistory.rows[0], ['表示名 自動入札', '1,220円', '10月4日23時10分']);

  const utf8 = '<meta charset="utf-8">入札履歴';
  assert.equal(decodeYahooHtml(Buffer.from(utf8)), utf8);
  assert.equal(decodeYahooHtml(Buffer.from([0xc6, 0xfc, 0xcb, 0xdc]), 'text/html; charset=EUC-JP'), '日本');
  assert.equal(decodeYahooHtml(Buffer.from([0x93, 0xfa, 0x96, 0x7b]), 'text/html; charset=Shift_JIS'), '日本');

  const calls = [];
  const service = createBidHistoryService({
    httpFetcher: async address => { calls.push(['http', address]); return fixture; },
    playwrightFetcher: async () => { throw new Error('should not run'); }
  });
  assert.equal((await service.fetchBidHistory(id)).source, 'http');
  const nextPageUrl = parsed.links[1].url;
  await service.fetchBidHistory(id, nextPageUrl);
  assert.deepEqual(calls, [['http', url], ['http', nextPageUrl]]);
  await assert.rejects(service.fetchBidHistory(id, 'http://127.0.0.1/admin'), error => error.statusCode === 400);
  assert.equal(calls.length, 2, 'Rejected URLs cannot trigger network access');

  for (const httpFetcher of [async () => { throw new Error('timeout'); }, async () => '<h1>ログイン</h1>']) {
    const fallback = createBidHistoryService({ httpFetcher, playwrightFetcher: async () => fixture });
    assert.equal((await fallback.fetchBidHistory(id)).source, 'playwright');
  }
  const unavailable = createBidHistoryService({ httpFetcher: async () => 'blocked', playwrightFetcher: async () => 'login' });
  await assert.rejects(unavailable.fetchBidHistory(id), error => error.statusCode === 502);
  console.log('Yahoo bid history tests passed.');
}

run().catch(error => { console.error(error); process.exit(1); });
