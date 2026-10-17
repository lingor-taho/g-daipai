const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { normalizeAuctionUrl, parseProductHtml, extractSearchProductCards, createProductService } = require('./proxy');
const { buildSubmitTaskInput, submitAuctionTask, validateBatchProduct } = require('./task');
const productHtml = fs.readFileSync(path.join(__dirname, 'fixtures/fleamarket-product.html'), 'utf8');
const searchHtml = fs.readFileSync(path.join(__dirname, 'fixtures/fleamarket-search.html'), 'utf8');
const id = 'z650804548';
const url = `https://paypayfleamarket.yahoo.co.jp/item/${id}`;

async function run() {
  for (const input of [id, id.toUpperCase(), url, `${url}?from=search`]) {
    assert.deepEqual(normalizeAuctionUrl(input), { auctionId: id, standardUrl: url });
  }
  const product = parseProductHtml(productHtml, id, url);
  assert.equal(product.currentPrice, 29700);
  assert.equal(product.buyoutPrice, 29700);
  assert.equal(product.buyoutOnly, true);
  assert.equal(product.productType, 'fleamarket');
  assert.equal(product.images.length, 2);
  assert.match(product.title, /影輝鋼衣龍王丸/);
  assert.equal(product.shippingFeeText, '送料無料');
  assert.equal(product.endTime, '');
  assert.equal(product.descriptionText, '新品\n未塗装未組立のガレージキットです');
  assert.equal(product.auctionStatus, 'open');
  const noPurchaseButton=productHtml.replace(/<a id="item_buy_button"[\s\S]*?<\/a>/,'');
  assert.equal(parseProductHtml(noPurchaseButton,id,url).auctionStatus,'ended','InStock JSON-LD without a purchase control is delisted');
  for(const extra of [
    '<p>購入手続きへ</p>',
    '<script>const buttonText="購入手続きへ";</script>',
    `<div id="description"><a id="item_buy_button">購入手続きへ</a></div>`,
    `<a href="https://paypayfleamarket-sec.yahoo.co.jp/item/z123456789/order">購入手続きへ</a>`,
    '<a id="item_buy_button" aria-disabled="true">購入手続きへ</a>',
    '<a id="item_buy_button" style="display:none">購入手続きへ</a>'
  ]) assert.equal(parseProductHtml(noPurchaseButton+extra,id,url).auctionStatus,'ended','unrelated/hidden/script/description text is not a purchase button');
  assert.equal(parseProductHtml(noPurchaseButton+`<a href="https://paypayfleamarket-sec.yahoo.co.jp/item/${id}/order"><span>購入手続きへ</span></a>`,id,url).auctionStatus,'open');

  assert.equal(product.conditionName,'新品','keep the original JSON-LD new-condition fallback');
  const usedHtml=fs.readFileSync(path.join(__dirname,'fixtures/fleamarket-used-product.html'),'utf8');
  const usedId='z705858626',usedUrl=`https://paypayfleamarket.yahoo.co.jp/item/${usedId}`;
  const used=parseProductHtml(usedHtml,usedId,usedUrl);
  assert.equal(used.conditionName,'やや傷や汚れあり','read the exact rendered condition from the matching item table');
  assert.equal(used.currentPrice,300);assert.equal(used.auctionStatus,'ended','sale status is independent of item condition');
  assert.equal(parseProductHtml(usedHtml.replace('UsedCondition','NewCondition'),usedId,usedUrl).conditionName,'やや傷や汚れあり','precise visible condition takes priority over generic JSON-LD');
  for(const condition of ['未使用','目立った傷や汚れなし','傷や汚れあり']) {
    assert.equal(parseProductHtml(usedHtml.replace('やや傷や汚れあり',condition),usedId,usedUrl).conditionName,condition);
  }
  const otherTable='<table><tr><th>商品の状態</th><td>未使用</td></tr><tr><th>商品ID</th><td>z123456789</td></tr></table>';
  assert.equal(parseProductHtml(otherTable+usedHtml,usedId,usedUrl).conditionName,'やや傷や汚れあり','ignore other product tables');
  const withoutTable=usedHtml.replace(/<table\b[\s\S]*?<\/table>/i,'');
  assert.equal(parseProductHtml(otherTable+withoutTable,usedId,usedUrl).conditionName,'','do not guess a used item grade from another product');
  assert.equal(parseProductHtml(withoutTable,usedId,usedUrl).conditionName,'');
  const usedService=createProductService({httpFetcher:async()=>usedHtml});
  assert.equal((await usedService.fetchProduct(usedUrl)).data.conditionName,'やや傷や汚れあり','proxy/cache payload retains the extracted condition');

  assert.equal(parseProductHtml(productHtml.replace('InStock', 'OutOfStock'), id, url).auctionStatus, 'ended');
  assert.throws(() => parseProductHtml('<title>Yahoo generic page</title>', id, url));
  assert.throws(() => parseProductHtml(productHtml.replace(id, 'z123456789'), id, url));
  const cards = extractSearchProductCards(searchHtml);
  assert.deepEqual(cards.map(item => item.auctionId), ['z650807476', 'z650805568', id]);
  for (const card of cards) {
    assert.equal(card.standardUrl, `https://paypayfleamarket.yahoo.co.jp/item/${card.auctionId}`);
    assert.equal(card.isFleamarket, true);
    assert.equal(card.productType, 'fleamarket');
  }
  const oldCards = extractSearchProductCards(`<div class="Products__list">
    <li class="Product"><a class="Product__titleLink" data-auction-id="${id}" href="${url}">フリマ</a></li>
    <li class="Product"><a class="Product__titleLink" data-auction-id="x1234567890" href="#">旧拍卖</a></li>
  </div>`);
  assert.equal(oldCards[0].standardUrl, url);
  assert.equal(oldCards[0].isFleamarket, true);
  assert.equal(oldCards[1].standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/x1234567890');
  assert.equal(oldCards[1].isFleamarket, undefined);
  // Rendered mixed results preserve source order, including fleamarket entries.
  const mixed = searchHtml.replace('<div id="searchItems">', '<div id="searchItems"><a href="/jp/auction/x1234567890">auction</a>')
    .replace('"items": [{', '"items": [{"auctionId":"x1234567890","title":"Auction","price":1000}, {');
  assert.deepEqual(extractSearchProductCards(mixed).map(item => item.auctionId), ['x1234567890', 'z650807476', 'z650805568', id]);
  assert.equal(extractSearchProductCards(mixed)[0].isFleamarket, undefined);
  const requests = [];
  const service = createProductService({
    httpFetcher: async target => { requests.push(target); return target.includes('/search/') ? searchHtml : productHtml; },
    playwrightFetcher: async () => { throw new Error('unexpected browser fallback'); }
  });
  assert.equal((await service.fetchProduct(id.toUpperCase())).data.images.length, 2);
  assert.deepEqual(requests, [url]);
  assert.equal(service.cacheProduct(product).buyoutOnly, true);
  const fallback = createProductService({ httpFetcher: async () => '<title>generic</title>', playwrightFetcher: async target => {
    assert.equal(target, url); return productHtml;
  } });
  assert.equal((await fallback.fetchProduct(url)).source, 'playwright');
  const singleSearch = createProductService({ httpFetcher: async target => target.includes('/search/') ?
    `<div class="Products__list"><li class="Product"><a class="Product__titleLink" href="${url}">item</a></li></div>` : productHtml });
  assert.equal((await singleSearch.fetchProductByKeyword('single')).data.standardUrl, url);

  // Submit through the real persistence path, using an isolated in-memory schema.
  const raw = new Database(':memory:');
  raw.exec(`
    CREATE TABLE config (key TEXT, value TEXT);
    CREATE TABLE products (product_id TEXT PRIMARY KEY, product_url TEXT, product_title TEXT,
      product_image_url TEXT, current_price INTEGER, buyout_price INTEGER, bid_count INTEGER,
      tax_type TEXT, product_type TEXT, shipping_fee_text TEXT, end_time TEXT,
      last_fetched_at TEXT, last_scanned_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, user_id INTEGER, product_id TEXT, max_price INTEGER,
      user_max_price INTEGER, multi_bid_increment INTEGER, strategy TEXT, bid_mode TEXT,
      start_minutes_before INTEGER, start_seconds_before INTEGER, status TEXT,
      client_request_id TEXT, pending_followup_max_price INTEGER);
  `);
  const database = {
    getOne: async (sql, params = []) => raw.prepare(sql).get(...params),
    query: async (sql, params = []) => ({ rowCount: raw.prepare(sql).run(...params).changes })
  };
  const context = { user: { id: 1, user_level: 3 }, actingUser: { id: 1 } };
  const body = { product_url: url, max_price: 29700, strategy: 'multi_bid', bid_mode: 'bid', client_request_id: 'flea-submit' };
  const message = '不支持フリマ商品！';
  assert.throws(() => validateBatchProduct({ success: true, data: product }, id), { message });
  const options = { database, fetchProduct: async target => {
    assert.equal(target, url); return { success: true, source: 'http', data: product };
  } };
  try {
    let count = 0;
    for (const product_url of [url, id, id.toUpperCase(), `https://auctions.yahoo.co.jp/jp/auction/${id}`]) {
      for (const bid_mode of ['bid', 'buyout']) {
        const input = buildSubmitTaskInput(context.user, { ...body, product_url, bid_mode });
        assert.equal(input.standardUrl, url);
        assert.equal(input.bidMode, 'buyout');
        const result = await submitAuctionTask(context, { ...body, product_url, bid_mode,
          client_request_id: `single-${++count}`, start_minutes_before: 5, pending_followup_max_price: 99999,
          end_time:'2000-01-01T00:00:00Z',product_title:'old title',product_image_url:'https://example.com/old.png',
          current_price:1,shipping_fee_text:'old shipping',bid_count:99 }, options);
        const task = await database.getOne('SELECT * FROM tasks WHERE id=?', [result.task_id]);
        assert.equal(task.bid_mode, 'buyout'); assert.equal(task.strategy, 'direct');
        assert.equal(task.max_price, 29700); assert.equal(task.user_max_price, 29700);
        assert.equal(task.start_minutes_before, null); assert.equal(task.pending_followup_max_price, null);
        await assert.rejects(submitAuctionTask(context, { ...body, product_url, bid_mode }, { ...options, strictBatch: true }), { message });
      }
    }
    const stored = await database.getOne('SELECT * FROM products WHERE product_id=?', [id]);
    assert.equal(stored.product_type, 'fleamarket'); assert.equal(stored.product_url, url);
    assert.equal(stored.product_title,product.title);assert.equal(stored.current_price,29700);
    assert.equal(stored.product_image_url,product.imageUrl);assert.equal(stored.shipping_fee_text,'送料無料');
    assert.equal(stored.bid_count,0);assert.equal(stored.end_time,null);
    const once = await submitAuctionTask(context, body, options);
    assert.equal((await submitAuctionTask(context, body, options)).duplicate, true);
    assert.ok(once.task_id);
    for (const result of [
      { success: true, source: 'cache-fallback', data: product },
      { success: true, data: { ...product, auctionStatus: 'ended' } },
      { success: true, data: parseProductHtml(noPurchaseButton,id,url) },
      { success: true, data: { ...product, buyoutPrice: 0 } },
      { success: true, data: { ...product, buyoutPrice: 30000 } },
      { success: true, data: { ...product, auctionId: 'z123456789' } }
    ]) await assert.rejects(submitAuctionTask(context, { ...body, client_request_id: 'reject' }, {
      database, fetchProduct: async () => result
    }));
    const { normalizeBatchProduct } = require('../../shared/batchBid.cjs');
    for (const value of [url, id, id.toUpperCase()]) assert.throws(() => normalizeBatchProduct(value), { message });
    assert.equal((await database.getOne('SELECT COUNT(*) AS n FROM tasks')).n, count + 1);
  } finally { raw.close(); }
  console.log('Fleamarket parsing, mixed search, URL routing, fallback and single buyout submission passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
