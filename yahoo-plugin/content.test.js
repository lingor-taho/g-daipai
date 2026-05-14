const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadContentForTest(bodyText, pathname = '/jp/auction/x123456789/bid/done', options = {}) {
  const code = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
  const sandbox = {
    console,
    setTimeout,
    window: {
      location: {
        origin: 'http://localhost:3001',
        href: `https://auctions.yahoo.co.jp${pathname}`,
        pathname
      },
      addEventListener() {}
    },
    document: {
      title: 'Yahoo!オークション - 最高級 イタリア製 OLIVER PEOPLES サングラス',
      body: { textContent: bodyText },
      querySelector() { return null; },
      querySelectorAll(selector) {
        if (selector === 'script') {
          return (options.scripts || []).map(textContent => ({ textContent }));
        }
        return [];
      }
    },
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage() {}
      },
      storage: {
        session: {
          async get() { return {}; },
          set() {}
        }
      }
    }
  };
  sandbox.window.window = sandbox.window;
  vm.runInNewContext(code, sandbox);
  return sandbox.window.__G_DAIPAI_TEST__;
}

function testOutbidTextIsNotHighestBidder() {
  const api = loadContentForTest('最高額入札者ではありません。値段を上げて入札してください。');

  assert.equal(api.isOutbidText(), true);
  assert.equal(api.isHighestBidderText(), false);
}

function testAcceptedBidTextIsHighestBidder() {
  const api = loadContentForTest('あなたが最高額入札者です。入札を受け付けました。');

  assert.equal(api.isOutbidText(), false);
  assert.equal(api.isHighestBidderText(), true);
}

function testAcceptedBuyoutTextIsSuccess() {
  const api = loadContentForTest('\u843d\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f', '/jp/auction/b1222222222/bid/done');

  assert.equal(api.isOutbidText(), false);
  assert.equal(api.isHighestBidderText(), true);
}

function testSuccessTextWinsOverGenericOutbidWords() {
  const api = loadContentForTest('\u5165\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f\u3002\u9ad8\u5024\u66f4\u65b0\u306e\u901a\u77e5\u8aac\u660e');

  assert.equal(api.isOutbidText(), false);
  assert.equal(api.isHighestBidderText(), true);
}

function testProductTitleDoesNotUseYahooPrefix() {
  const api = loadContentForTest('');
  const product = api.extractProductData();

  assert.equal(product.title, '最高級 イタリア製 OLIVER PEOPLES サングラス');
}

function testCurrentPriceUsesProductPageDataBeforeRecommendationText() {
  const api = loadContentForTest('この商品も注目されています 現在33,000円 現在1円', '/jp/auction/g1229909638', {
    scripts: [
      'var pageData = {"items":{"productID":"g1229909638","price":"1","productName":"current product"}};'
    ]
  });

  assert.equal(api.extractCurrentAuctionPrice(), 1);
}

function testInstantBuyButtonTextIsRecognized() {
  const api = loadContentForTest('');

  assert.equal(api.isInstantBuyButtonText('今すぐ落札'), true);
  assert.equal(api.isFinalAgreeButtonText('上記のガイドライン等、情報提供に同意して 落札する'), true);
  assert.equal(api.isConfirmButtonText('確認する'), true);
}

function testProductDataExtractsBuyoutPriceFromPageData() {
  const api = loadContentForTest('', '/jp/auction/b1222222222', {
    scripts: [
      'var pageData = {"items":{"productID":"b1222222222","price":"1200","winPrice":"5600","productName":"buyout product"}};'
    ]
  });
  const product = api.extractProductData();

  assert.equal(product.currentPrice, 1200);
  assert.equal(product.buyoutPrice, 5600);
}

function testPlainBidEntryIsNotFinalAgree() {
  const api = loadContentForTest('');

  assert.equal(api.isFinalAgreeButtonText('\u5165\u672d\u3059\u308b'), false);
  assert.equal(api.isFinalAgreeButtonText('\u4e0a\u8a18\u306e\u30ac\u30a4\u30c9\u30e9\u30a4\u30f3\u7b49\u3001\u60c5\u5831\u63d0\u4f9b\u306b\u540c\u610f\u3057\u3066 \u5165\u672d\u3059\u308b'), true);
}

testOutbidTextIsNotHighestBidder();
testAcceptedBidTextIsHighestBidder();
testAcceptedBuyoutTextIsSuccess();
testSuccessTextWinsOverGenericOutbidWords();
testProductTitleDoesNotUseYahooPrefix();
testCurrentPriceUsesProductPageDataBeforeRecommendationText();
testInstantBuyButtonTextIsRecognized();
testProductDataExtractsBuyoutPriceFromPageData();
testPlainBidEntryIsNotFinalAgree();
