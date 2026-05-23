const assert = require('assert/strict');
const {
  createProductService,
  parseProductHtml,
  normalizeAuctionUrl
} = require('./proxy');

async function testNormalizeAuctionUrl() {
  const parsed = normalizeAuctionUrl('https://page.auctions.yahoo.co.jp/jp/auction/x1234567890?foo=1');
  assert.equal(parsed.auctionId, 'x1234567890');
  assert.equal(parsed.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/x1234567890');

  const mobileProxy = normalizeAuctionUrl('https://m.gougoujp.com/aucitem/p1229273606');
  assert.equal(mobileProxy.auctionId, 'p1229273606');
  assert.equal(mobileProxy.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/p1229273606');

  const fromJapan = normalizeAuctionUrl('https://www.fromjapan.co.jp/japan/cn/auction/yahoo/input/g1225234655/');
  assert.equal(fromJapan.auctionId, 'g1225234655');
  assert.equal(fromJapan.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/g1225234655');

  const numericOnly = normalizeAuctionUrl('https://auctions.yahoo.co.jp/jp/auction/1229405242');
  assert.equal(numericOnly.auctionId, '1229405242');
  assert.equal(numericOnly.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/1229405242');

  const paypay = normalizeAuctionUrl('https://paypayfleamarket.yahoo.co.jp/item/z562177666');
  assert.equal(paypay.auctionId, 'z562177666');
  assert.equal(paypay.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/z562177666');

  const numericNine = normalizeAuctionUrl('https://example.com/item/562177666');
  assert.equal(numericNine.auctionId, '562177666');
  assert.equal(numericNine.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/562177666');

  const letterEight = normalizeAuctionUrl('https://example.com/item/a12345678');
  assert.equal(letterEight.auctionId, 'a12345678');
  assert.equal(letterEight.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/a12345678');

  const numericEight = normalizeAuctionUrl('https://example.com/item/12345678');
  assert.equal(numericEight.auctionId, '12345678');
  assert.equal(numericEight.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/12345678');
}

async function testParseProductHtml() {
  const product = parseProductHtml(`
    <html>
      <head>
        <title>Test Product - Yahoo!オークション</title>
        <meta property="og:image" content="https://img.example/a.jpg">
        <meta itemprop="endDate" content="2026-05-13T12:00:00+09:00">
      </head>
      <body>
        <span itemprop="price" content="12,300"></span>
      </body>
    </html>
  `, 'x1234567890', 'https://auctions.yahoo.co.jp/jp/auction/x1234567890');

  assert.equal(product.title, 'Test Product');
  assert.equal(product.imageUrl, 'https://img.example/a.jpg');
  assert.equal(product.currentPrice, 12300);
  assert.equal(product.endTime, '2026-05-13T12:00:00+09:00');
}

async function testParseProductTitleWhenYahooPrefixComesFirst() {
  const product = parseProductHtml(`
    <html>
      <head>
        <title>Yahoo!オークション - 最高級 イタリア製 OLIVER PEOPLES サングラス</title>
        <meta property="og:title" content="最高級 イタリア製 OLIVER PEOPLES サングラス">
      </head>
      <body>
        <h1>最高級 イタリア製 OLIVER PEOPLES サングラス</h1>
      </body>
    </html>
  `, 'h1229411184', 'https://auctions.yahoo.co.jp/jp/auction/h1229411184');

  assert.equal(product.title, '最高級 イタリア製 OLIVER PEOPLES サングラス');
}

async function testParseCurrentDisplayedPriceBeforeJsonLdOffer() {
  const product = parseProductHtml(`
    <html>
      <head>
        <title>Current Price Test - Yahoo!オークション</title>
        <script type="application/ld+json">
          {"offers":{"priceCurrency":"JPY","price":"3800"}}
        </script>
      </head>
      <body>
        <dt>現在</dt>
        <dd><span>4,180<!-- -->円</span><span>（税込）</span></dd>
      </body>
    </html>
  `, 'v1229669054', 'https://auctions.yahoo.co.jp/jp/auction/v1229669054');

  assert.equal(product.currentPrice, 4180);
}

async function testParsePriceValidUntilAsEndTime() {
  const product = parseProductHtml(`
    <html>
      <head>
        <title>End Time Test - Yahoo!オークション</title>
        <script type="application/ld+json">
          {"offers":{"priceCurrency":"JPY","price":"1","priceValidUntil":"2026-05-14T21:25:42+09:00"}}
        </script>
      </head>
      <body></body>
    </html>
  `, 's1229683165', 'https://auctions.yahoo.co.jp/jp/auction/s1229683165');

  assert.equal(product.endTime, '2026-05-14T21:25:42+09:00');
}

async function testParseBuyoutPriceFromPageData() {
  const product = parseProductHtml(`
    <html>
      <head>
        <title>Buyout Test - Yahoo!</title>
        <script>
          var pageData = {"items":{"price":"1200","winPrice":"5600"}};
        </script>
      </head>
      <body></body>
    </html>
  `, 'b1222222222', 'https://auctions.yahoo.co.jp/jp/auction/b1222222222');

  assert.equal(product.currentPrice, 1200);
  assert.equal(product.buyoutPrice, 5600);
}

async function testParseStoreTaxTypeFromTaxIncludedLabel() {
  const product = parseProductHtml(`
    <html>
      <head><title>Store Product - Yahoo!</title></head>
      <body>
        <dt>現在</dt>
        <dd><span>1,000円</span><span>（税込）</span></dd>
      </body>
    </html>
  `, 's1222222222', 'https://auctions.yahoo.co.jp/jp/auction/s1222222222');

  assert.equal(product.currentPrice, 1000);
  assert.equal(product.taxType, 'tax_included');
}

async function testParsePersonalTaxTypeFromTaxZeroLabel() {
  const product = parseProductHtml(`
    <html>
      <head><title>Personal Product - Yahoo!</title></head>
      <body>
        <dt>現在</dt>
        <dd><span>1,000円</span><span>（税0円）</span></dd>
      </body>
    </html>
  `, 'p1222222222', 'https://auctions.yahoo.co.jp/jp/auction/p1222222222');

  assert.equal(product.taxType, 'tax_zero');
}

async function testParseTaxZeroWinsWhenBothTaxLabelsExist() {
  const product = parseProductHtml(`
    <html>
      <head><title>Personal Product - Yahoo!</title></head>
      <body>
        <dt>現在</dt>
        <dd><span>110円</span><span>（税0円）</span></dd>
        <p>配送説明 （税込）</p>
      </body>
    </html>
  `, '1230198307', 'https://auctions.yahoo.co.jp/jp/auction/1230198307');

  assert.equal(product.taxType, 'tax_zero');
}

async function testFallsBackToPlaywrightWhenHttpFails() {
  const calls = [];
  const service = createProductService({
    httpFetcher: async () => {
      calls.push('http');
      throw new Error('blocked');
    },
    playwrightFetcher: async () => {
      calls.push('playwright');
      return `
        <html>
          <head>
            <title>Playwright Product - Yahoo!オークション</title>
            <meta property="og:image" content="https://img.example/pw.jpg">
          </head>
          <body>
            <span itemprop="price" content="2300"></span>
          </body>
        </html>
      `;
    }
  });

  const result = await service.fetchProduct('https://auctions.yahoo.co.jp/jp/auction/x1234567890');

  assert.equal(result.source, 'playwright');
  assert.equal(result.data.title, 'Playwright Product');
  assert.equal(result.data.imageUrl, 'https://img.example/pw.jpg');
  assert.equal(result.data.currentPrice, 2300);
  assert.deepEqual(calls, ['http', 'playwright']);
}

async function testFetchRefreshesBeforeUsingCache() {
  const service = createProductService({
    httpFetcher: async () => `
      <html>
        <head><title>Fresh Product - Yahoo!オークション</title></head>
        <body>
          <dt>現在</dt>
          <dd><span>121<!-- -->円</span></dd>
        </body>
      </html>
    `,
    playwrightFetcher: async () => {
      throw new Error('should not call playwright');
    }
  });

  service.cacheProduct({
    auctionId: 'd1229660047',
    title: 'Cached Product',
    currentPrice: 1
  });

  const result = await service.fetchProduct('https://auctions.yahoo.co.jp/jp/auction/d1229660047');

  assert.equal(result.source, 'http');
  assert.equal(result.data.currentPrice, 121);
}

async function testUsesCacheAfterFetchersFail() {
  const service = createProductService({
    httpFetcher: async () => {
      throw new Error('http failed');
    },
    playwrightFetcher: async () => {
      throw new Error('playwright failed');
    }
  });

  service.cacheProduct({
    auctionId: 'x1234567890',
    title: 'Cached Product',
    imageUrl: 'https://img.example/cache.jpg',
    currentPrice: 999
  });

  const result = await service.fetchProduct('https://auctions.yahoo.co.jp/jp/auction/x1234567890');

  assert.equal(result.source, 'cache-fallback');
  assert.equal(result.data.title, 'Cached Product');
}

async function testFailsWhenServerCannotFetchProductAndNoCacheExists() {
  const service = createProductService({
    httpFetcher: async () => {
      throw new Error('http failed');
    },
    playwrightFetcher: async () => {
      throw new Error('playwright failed');
    }
  });

  await assert.rejects(
    () => service.fetchProduct('https://auctions.yahoo.co.jp/jp/auction/x1234567890'),
    error => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.message, '服务器网络问题，请稍后重试！');
      return true;
    }
  );
}

async function run() {
  await testNormalizeAuctionUrl();
  await testParseProductHtml();
  await testParseProductTitleWhenYahooPrefixComesFirst();
  await testParseCurrentDisplayedPriceBeforeJsonLdOffer();
  await testParsePriceValidUntilAsEndTime();
  await testParseBuyoutPriceFromPageData();
  await testParseStoreTaxTypeFromTaxIncludedLabel();
  await testParsePersonalTaxTypeFromTaxZeroLabel();
  await testParseTaxZeroWinsWhenBothTaxLabelsExist();
  await testFallsBackToPlaywrightWhenHttpFails();
  await testFetchRefreshesBeforeUsingCache();
  await testUsesCacheAfterFetchersFail();
  await testFailsWhenServerCannotFetchProductAndNoCacheExists();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
