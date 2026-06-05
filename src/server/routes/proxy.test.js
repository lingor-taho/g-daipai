const assert = require('assert/strict');
const {
  createProductService,
  parseProductHtml,
  normalizeAuctionUrl,
  extractAuctionIdsFromSearchHtml,
  buildYahooSearchUrl
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

async function testParseProductTitlePrefersPageDataProductName() {
  const product = parseProductHtml(`
    <html>
      <head>
        <title>新品 ニニ・ロッソ リチャード...</title>
        <script>
          var pageData = {"items":{"productName":"新品 ニニ・ロッソ リチャード・クレイダーマン レイモン・ルフェーブル 日本のメロディー CD2枚組","price":"2237"}};
        </script>
      </head>
      <body></body>
    </html>
  `, 'v1184829642', 'https://auctions.yahoo.co.jp/jp/auction/v1184829642');

  assert.equal(product.title, '新品 ニニ・ロッソ リチャード・クレイダーマン レイモン・ルフェーブル 日本のメロディー CD2枚組');
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

async function testParseBidCountFromYahooBidHistoryLink() {
  const product = parseProductHtml(`
    <html>
      <head><title>Bid Count Test - Yahoo!</title></head>
      <body>
        <span itemprop="price" content="1078"></span>
        <a href="/jp/show/bid_hist?aID=e1232378827">0<!-- -->件</a>
      </body>
    </html>
  `, 'e1232378827', 'https://auctions.yahoo.co.jp/jp/auction/e1232378827');

  assert.equal(product.bidCount, 0);
}

async function testParseBidCountFromPageDataBids() {
  const product = parseProductHtml(`
    <html>
      <head>
        <title>Bid Count PageData Test - Yahoo!</title>
        <script>
          var pageData = {"items":{"price":"1200","bids":"12"}};
        </script>
      </head>
      <body></body>
    </html>
  `, 'b1222222222', 'https://auctions.yahoo.co.jp/jp/auction/b1222222222');

  assert.equal(product.bidCount, 12);
}

async function testParseBuyoutOnlyProductFromSingleInstantBuyButton() {
  const product = parseProductHtml(`
    <html>
      <head>
        <title>Buyout Only Test - Yahoo!</title>
        <script>
          var pageData = {"items":{"price":"2800","winPrice":"2800","bids":"0"}};
        </script>
      </head>
      <body>
        <div id="bidButtonGroup">
          <button disabled>今すぐ落札</button>
        </div>
      </body>
    </html>
  `, 't1204059533', 'https://auctions.yahoo.co.jp/jp/auction/t1204059533');

  assert.equal(product.currentPrice, 2800);
  assert.equal(product.buyoutPrice, 2800);
  assert.equal(product.buyoutOnly, true);
}

async function testParseNormalBuyoutProductKeepsBidAvailable() {
  const product = parseProductHtml(`
    <html>
      <head>
        <title>Bid And Buyout Test - Yahoo!</title>
        <script>
          var pageData = {"items":{"price":"1200","winPrice":"5600","bids":"0"}};
        </script>
      </head>
      <body>
        <div id="bidButtonGroup">
          <button>入札する</button>
          <button>今すぐ落札</button>
        </div>
      </body>
    </html>
  `, 'b1222222222', 'https://auctions.yahoo.co.jp/jp/auction/b1222222222');

  assert.equal(product.buyoutOnly, false);
}

async function testParseStoreBuyoutOnlyProductFromPurchaseButton() {
  const product = parseProductHtml(`
    <html>
      <head>
        <title>Store Buyout Test - Yahoo!</title>
        <script>
          var pageData = {"items":{"price":"2237","winPrice":"2237","bids":"0"}};
        </script>
      </head>
      <body>
        <span>価格</span><span>2,460円（税込）</span>
        <a href="https://buy.auctions.yahoo.co.jp/order/confirm">購入手続きへ</a>
      </body>
    </html>
  `, 'v1184829642', 'https://auctions.yahoo.co.jp/jp/auction/v1184829642');

  assert.equal(product.currentPrice, 2237);
  assert.equal(product.buyoutPrice, 2460);
  assert.equal(product.taxType, 'tax_included');
  assert.equal(product.buyoutOnly, true);
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

async function testParseProductTypeFromPriceTaxLabel() {
  const normalProduct = parseProductHtml(`
    <html>
      <head><title>Normal Product - Yahoo!</title></head>
      <body>
        <dt>現在</dt>
        <dd><span>1,000円</span><span>（税 0 円）</span></dd>
      </body>
    </html>
  `, 'n1222222222', 'https://auctions.yahoo.co.jp/jp/auction/n1222222222');
  const storeProduct = parseProductHtml(`
    <html>
      <head><title>Store Product - Yahoo!</title></head>
      <body>
        <dt>現在</dt>
        <dd><span>1,100円</span><span>（税込）</span></dd>
      </body>
    </html>
  `, 's1222222222', 'https://auctions.yahoo.co.jp/jp/auction/s1222222222');

  assert.equal(normalProduct.productType, 'normal');
  assert.equal(storeProduct.productType, 'store');
}

async function testParseShippingFeeFromItemPostage() {
  const bidderPays = parseProductHtml(`
    <html><head><title>Shipping Test - Yahoo!</title></head>
    <body><div id="itemPostage"><span>送料</span><span>落札者負担</span></div></body></html>
  `, 's1222222222', 'https://auctions.yahoo.co.jp/jp/auction/s1222222222');
  const cashOnDelivery = parseProductHtml(`
    <html><head><title>Shipping Test - Yahoo!</title></head>
    <body><div id="itemPostage"><span>送料</span><span>着払い</span></div></body></html>
  `, 's1222222222', 'https://auctions.yahoo.co.jp/jp/auction/s1222222222');
  const free = parseProductHtml(`
    <html><head><title>Shipping Test - Yahoo!</title></head>
    <body><div id="itemPostage"><span>送料</span><span>無料</span></div></body></html>
  `, 's1222222222', 'https://auctions.yahoo.co.jp/jp/auction/s1222222222');
  const fixed = parseProductHtml(`
    <html><head><title>Shipping Test - Yahoo!</title></head>
    <body><div id="itemPostage"><span>送料</span><span>290円</span></div></body></html>
  `, 's1222222222', 'https://auctions.yahoo.co.jp/jp/auction/s1222222222');
  const fallbackWithoutItemPostage = parseProductHtml(`
    <html><head><title>Shipping Test - Yahoo!</title></head>
    <body><section><span>送料負担</span><span>落札者負担</span></section></body></html>
  `, 's1222222222', 'https://auctions.yahoo.co.jp/jp/auction/s1222222222');
  const nextDataDescription = parseProductHtml(`
    <html><head><title>Shipping Test - Yahoo!</title></head>
    <body>
      <script id="__NEXT_DATA__" type="application/json">
        {"props":{"pageProps":{"initialState":{"detail":{"item":{"chargeForShipping":"winner","descriptionHtml":"※発送詳細<br>送料1380円 (北海道1880円 沖縄2380円）"}}}}}}
      </script>
    </body></html>
  `, 's1222222222', 'https://auctions.yahoo.co.jp/jp/auction/s1222222222');
  const cashOnDeliveryFromNextData = parseProductHtml(`
    <html><head><title>Shipping Test - Yahoo!</title></head>
    <body>
      <script id="__NEXT_DATA__" type="application/json">
        {"props":{"pageProps":{"initialState":{"item":{"detail":{"item":{"chargeForShipping":"winner","shippingInput":"着払い"}}}}}}}
      </script>
    </body></html>
  `, 'b1227905707', 'https://auctions.yahoo.co.jp/jp/auction/b1227905707');
  const freeShippingFromNextData = parseProductHtml(`
    <html><head><title>Shipping Test - Yahoo!</title></head>
    <body>
      <script id="__NEXT_DATA__" type="application/json">
        {"props":{"pageProps":{"initialState":{"item":{"detail":{"item":{"chargeForShipping":"seller"}}}}}}}
      </script>
    </body></html>
  `, 'j1231001710', 'https://auctions.yahoo.co.jp/jp/auction/j1231001710');
  const cashOnDeliveryUnavailableDescription = parseProductHtml(`
    <html><head><title>Shipping Test - Yahoo!</title></head>
    <body>
      <script id="__NEXT_DATA__" type="application/json">
        {"props":{"pageProps":{"initialState":{"item":{"detail":{"item":{"chargeForShipping":"winner","descriptionHtml":"※着払い、代引きは不可でございます。ご了承下さいませ。"}}}}}}}
      </script>
    </body></html>
  `, 'x1231101693', 'https://auctions.yahoo.co.jp/jp/auction/x1231101693');

  assert.equal(bidderPays.shippingFeeText, '落札者負担');
  assert.equal(cashOnDelivery.shippingFeeText, '着払い');
  assert.equal(free.shippingFeeText, '無料');
  assert.equal(fixed.shippingFeeText, '290円');
  assert.equal(fallbackWithoutItemPostage.shippingFeeText, '落札者負担');
  assert.equal(nextDataDescription.shippingFeeText, '1380円');
  assert.equal(cashOnDeliveryFromNextData.shippingFeeText, '着払い');
  assert.equal(freeShippingFromNextData.shippingFeeText, '無料');
  assert.equal(cashOnDeliveryUnavailableDescription.shippingFeeText, '落札者負担');
}

async function testParseShippingFeeUsesLowestStructuredShippingMethod() {
  const product = parseProductHtml(`
    <html>
      <head><title>Shipping Methods Test - Yahoo!</title></head>
      <body>
        <script id="__NEXT_DATA__" type="application/json">
          {"props":{"pageProps":{"initialState":{"detail":{"item":{
            "chargeForShipping":"winner",
            "shipping":{"methods":[
              {"name":"定形郵便","isFlatFee":true,"shippingFee":110},
              {"name":"定形郵便","isFlatFee":true,"shippingFee":210},
              {"name":"おてがる配送ゆうパケット","isFlatFee":false}
            ]},
            "descriptionHtml":"発送方法 定形郵便 送料210円"
          }}}}}}
        </script>
      </body>
    </html>
  `, 'm1114324624', 'https://auctions.yahoo.co.jp/jp/auction/m1114324624');

  assert.equal(product.shippingFeeText, '110円');
}

async function testWinnerShippingBeatsUnrelatedFreeText() {
  const product = parseProductHtml(`
    <html>
      <head><title>Winner Shipping Test - Yahoo!</title></head>
      <body>
        <section>送料 関連キャンペーン 無料</section>
        <script id="__NEXT_DATA__" type="application/json">
          {"props":{"pageProps":{"initialState":{"detail":{"item":{
            "chargeForShipping":"winner",
            "shippingInput":"取引ナビ開始時に入力",
            "shipping":{"methods":[
              {"name":"定形外郵便","isFlatFee":false}
            ]}
          }}}}}}
        </script>
      </body>
    </html>
  `, 'c1135451955', 'https://auctions.yahoo.co.jp/jp/auction/c1135451955');

  assert.equal(product.shippingFeeText, '落札者負担');
}

async function testLaterInputWinnerShippingIgnoresReferencePricesInDescription() {
  const product = parseProductHtml(`
    <html>
      <head><title>Later Input Shipping Test - Yahoo!</title></head>
      <body>
        <script id="__NEXT_DATA__" type="application/json">
          {"props":{"pageProps":{"initialState":{"detail":{"item":{
            "chargeForShipping":"winner",
            "shippingInput":"取引ナビ開始時に入力",
            "shipping":{"methods":[
              {"name":"スマートレター","isFlatFee":false},
              {"name":"おてがる配送ゆうパック","isFlatFee":false}
            ]},
            "descriptionHtml":"おてがる版ゆうパックは配送先によって送料異なります。750円以上の送料となります。"
          }}}}}}
        </script>
      </body>
    </html>
  `, 's1113817953', 'https://auctions.yahoo.co.jp/jp/auction/s1113817953');

  assert.equal(product.shippingFeeText, '落札者負担');
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

async function testFetchUsesYahooShipmentApiWhenHttpShippingIsGeneric() {
  const calls = [];
  const service = createProductService({
    httpFetcher: async (url) => {
      calls.push(url.includes('/shipments/shopping') ? 'shipment' : 'http');
      if (url.includes('/shipments/shopping')) {
        assert.match(url, /prefCode=27/);
        return JSON.stringify({
          lowestPrice: 2000,
          methods: [
            { name: 'ヤマト運輸', shippingPrice: 1350 },
            { name: '佐川急便', shippingPrice: 1800 }
          ]
        });
      }
      return `
        <html>
          <head><title>Generic Shipping Product - Yahoo!オークション</title></head>
          <body>
            <span itemprop="price" content="6800"></span>
            <script id="__NEXT_DATA__" type="application/json">
              {"props":{"pageProps":{"initialState":{"item":{"detail":{"item":{"price":6800,"taxinPrice":7480,"aucShoppingItemInfo":{"postageSetId":1,"weight":2,"shoppingSellerId":"sumariku"}}}}}}}}
            </script>
            <section><span>送料</span><span>落札者負担</span></section>
          </body>
        </html>
      `;
    },
    playwrightFetcher: async () => {
      throw new Error('should not call playwright');
    }
  });

  const result = await service.fetchProduct('https://auctions.yahoo.co.jp/jp/auction/1230841006');

  assert.equal(result.source, 'http');
  assert.equal(result.data.shippingFeeText, '1350円');
  assert.equal(result.data.currentPrice, 6800);
  assert.deepEqual(calls, ['http', 'shipment']);
}

async function testFetchDoesNotRenderGenericShippingWithoutShipmentApi() {
  const calls = [];
  const service = createProductService({
    httpFetcher: async () => {
      calls.push('http');
      return `
        <html>
          <head><title>Generic Shipping Product - Yahoo!オークション</title></head>
          <body>
            <span itemprop="price" content="3300"></span>
            <script id="__NEXT_DATA__" type="application/json">
              {"props":{"pageProps":{"initialState":{"item":{"detail":{"item":{"chargeForShipping":"winner","shippingInput":"取引ナビ開始時に入力"}}}}}}}
            </script>
            <section><span>送料</span></section>
          </body>
        </html>
      `;
    },
    playwrightFetcher: async () => {
      throw new Error('should not call playwright');
    }
  });

  const result = await service.fetchProduct('https://auctions.yahoo.co.jp/jp/auction/j1230730561');

  assert.equal(result.source, 'http');
  assert.equal(result.data.shippingFeeText, '落札者負担');
  assert.deepEqual(calls, ['http']);
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

function testExtractsUniqueAuctionIdFromProductsListOnly() {
  const ids = extractAuctionIdsFromSearchHtml(`
    <a href="https://auctions.yahoo.co.jp/jp/auction/z999999999">outside</a>
    <div class="Products__list">
      <a href="https://auctions.yahoo.co.jp/jp/auction/x1230699905">one</a>
      <a href="/jp/auction/x1230699905">duplicate</a>
    </div>
  `);

  assert.deepEqual(ids, ['x1230699905']);
}

function testExtractsMultipleAuctionIdsFromProductsList() {
  const ids = extractAuctionIdsFromSearchHtml(`
    <div class="Products__list">
      <a href="/jp/auction/x1230699905">one</a>
      <a href="/jp/auction/v1230349098">two</a>
    </div>
  `);

  assert.deepEqual(ids, ['x1230699905', 'v1230349098']);
}

function testBuildsYahooSearchUrlWithKeyword() {
  assert.equal(
    buildYahooSearchUrl('テスト 商品'),
    'https://auctions.yahoo.co.jp/search/search?auccat=0&tab_ex=commerce&ei=utf-8&aq=-1&oq=&sc_i=&fr=&p=%E3%83%86%E3%82%B9%E3%83%88%20%E5%95%86%E5%93%81'
  );
}

async function testFetchProductByKeywordUsesOnlySingleSearchResult() {
  const calls = [];
  const service = createProductService({
    httpFetcher: async url => {
      calls.push(url);
      if (url.includes('/search/search?')) {
        return `
          <a href="/jp/auction/z999999999">outside</a>
          <div class="Products__list">
            <a href="/jp/auction/x1230699905">target</a>
            <a href="/jp/auction/x1230699905">duplicate</a>
          </div>
        `;
      }
      return `
        <html>
          <head><title>Keyword Product - Yahoo!オークション</title></head>
          <body><span itemprop="price" content="2450"></span></body>
        </html>
      `;
    },
    playwrightFetcher: async () => {
      throw new Error('should not call playwright');
    }
  });

  const result = await service.fetchProductByKeyword('test keyword');

  assert.equal(result.data.auctionId, 'x1230699905');
  assert.equal(result.data.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/x1230699905');
  assert.equal(result.data.title, 'Keyword Product');
  assert.equal(result.data.currentPrice, 2450);
  assert.equal(calls[0], 'https://auctions.yahoo.co.jp/search/search?auccat=0&tab_ex=commerce&ei=utf-8&aq=-1&oq=&sc_i=&fr=&p=test%20keyword');
}

async function testFetchProductByKeywordFailsWhenResultCountIsNotOne() {
  const service = createProductService({
    httpFetcher: async () => `
      <div class="Products__list">
        <a href="/jp/auction/x1230699905">one</a>
        <a href="/jp/auction/v1230349098">two</a>
      </div>
    `,
    playwrightFetcher: async () => {
      throw new Error('should not call playwright');
    }
  });

  await assert.rejects(
    () => service.fetchProductByKeyword('test keyword'),
    error => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, '存在多个商品结果，无法显示！');
      return true;
    }
  );
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
  await testParseProductTitlePrefersPageDataProductName();
  await testParseCurrentDisplayedPriceBeforeJsonLdOffer();
  await testParsePriceValidUntilAsEndTime();
  await testParseBuyoutPriceFromPageData();
  await testParseBidCountFromYahooBidHistoryLink();
  await testParseBidCountFromPageDataBids();
  await testParseBuyoutOnlyProductFromSingleInstantBuyButton();
  await testParseNormalBuyoutProductKeepsBidAvailable();
  await testParseStoreBuyoutOnlyProductFromPurchaseButton();
  await testParseStoreTaxTypeFromTaxIncludedLabel();
  await testParseProductTypeFromPriceTaxLabel();
  await testParseShippingFeeFromItemPostage();
  await testParseShippingFeeUsesLowestStructuredShippingMethod();
  await testWinnerShippingBeatsUnrelatedFreeText();
  await testLaterInputWinnerShippingIgnoresReferencePricesInDescription();
  await testParsePersonalTaxTypeFromTaxZeroLabel();
  await testParseTaxZeroWinsWhenBothTaxLabelsExist();
  await testFallsBackToPlaywrightWhenHttpFails();
  await testFetchRefreshesBeforeUsingCache();
  await testFetchUsesYahooShipmentApiWhenHttpShippingIsGeneric();
  await testFetchDoesNotRenderGenericShippingWithoutShipmentApi();
  await testUsesCacheAfterFetchersFail();
  testExtractsUniqueAuctionIdFromProductsListOnly();
  testExtractsMultipleAuctionIdsFromProductsList();
  testBuildsYahooSearchUrlWithKeyword();
  await testFetchProductByKeywordUsesOnlySingleSearchResult();
  await testFetchProductByKeywordFailsWhenResultCountIsNotOne();
  await testFailsWhenServerCannotFetchProductAndNoCacheExists();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
