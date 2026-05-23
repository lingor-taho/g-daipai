const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadContentForTest(bodyText, pathname = '/jp/auction/x123456789/bid/done', options = {}) {
  const code = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
  const sandbox = {
    console,
    setTimeout,
    Event: class Event {
      constructor(type) {
        this.type = type;
      }
    },
    MouseEvent: class MouseEvent {
      constructor(type) {
        this.type = type;
      }
    },
    window: {
      location: {
        origin: 'http://localhost:3001',
        href: `https://auctions.yahoo.co.jp${pathname}`,
        pathname
      },
      addEventListener() {},
      getComputedStyle() {
        return { display: 'block', visibility: 'visible' };
      }
    },
    document: {
      title: 'Yahoo!オークション - 最高級 イタリア製 OLIVER PEOPLES サングラス',
      body: {
        get textContent() {
          return options.getBodyText ? options.getBodyText() : bodyText;
        }
      },
      querySelector(selector) {
        return options.querySelector ? options.querySelector(selector) : null;
      },
      querySelectorAll(selector) {
        if (options.querySelectorAll) return options.querySelectorAll(selector);
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

async function loadAndExecuteBidForTest(bodyText, execOptions = {}, pathname = '/jp/auction/x123456789/bid/done') {
  const api = loadContentForTest(bodyText, pathname);
  return api.executeBidV3(execOptions.maxPrice || 1000, execOptions);
}

function createTestElement(text = '') {
  return {
    textContent: text,
    value: '',
    disabled: false,
    readOnly: false,
    name: '',
    id: '',
    placeholder: '',
    title: '',
    href: '',
    clicked: false,
    focus() {},
    scrollIntoView() {},
    click() { this.clicked = true; },
    closest() { return null; },
    getAttribute(name) {
      if (name === 'aria-label') return '';
      if (name === 'href') return this.href;
      return '';
    },
    dispatchEvent(event) {
      if (this.onDispatch) this.onDispatch(event);
    }
  };
}

function createTestAnchor(text, href) {
  return {
    ...createTestElement(text),
    href,
    getAttribute(name) {
      if (name === 'href') return href;
      if (name === 'aria-label') return '';
      return '';
    }
  };
}

function createOrderContainer(text, linkText, href) {
  const link = createTestAnchor(linkText, href);
  return {
    textContent: text,
    querySelectorAll(selector) {
      return selector === 'a[href*="/jp/auction/"]' ? [link] : [];
    }
  };
}

function testOutbidTextIsNotHighestBidder() {
  const api = loadContentForTest('最高額入札者ではありません。値段を上げて入札してください。');

  assert.equal(api.isOutbidText(), true);
  assert.equal(api.isHighestBidderText(), false);
}

function testRaiseBidButtonTextAloneIsNotOutbidFailure() {
  const api = loadContentForTest('値段を上げて入札');

  assert.equal(api.isOutbidText(), false);
}

function testRebidRequiredIsSeparateFromOutbidFailure() {
  const api = loadContentForTest('再入札が必要です 入札する');

  assert.equal(api.isRebidRequiredText(), true);
  assert.equal(api.isOutbidText(), false);
}

function testRebidRequiredWinsOverBidCompletedText() {
  const api = loadContentForTest('入札が完了しました。再入札が必要です 入札する');

  assert.equal(api.isRebidRequiredText(), true);
  assert.equal(api.isHighestBidderText(), false);
}

async function testRebidRequiredFailsAfterOutcomeWait() {
  const result = await loadAndExecuteBidForTest(
    '\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059 \u5165\u672d\u3059\u308b',
    { maxPrice: 1000, strategy: 'direct' }
  );

  assert.equal(result.success, false);
  assert.equal(result.closeTab, true);
}

function testAcceptedBidTextIsHighestBidder() {
  const api = loadContentForTest('あなたが最高額入札者です。入札を受け付けました。');

  assert.equal(api.isOutbidText(), false);
  assert.equal(api.isHighestBidderText(), true);
}

function testProductPageHighestBidderNoticeDoesNotSkipNewBid() {
  const api = loadContentForTest(
    'あなたが最高額入札者です!',
    '/jp/auction/x123456789'
  );

  assert.equal(api.hasCurrentHighestBidderNotice(), true);
  assert.equal(api.isHighestBidderText(), false);
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

function testExplicitOutbidWinsOverBidCompletedText() {
  const api = loadContentForTest('\u5165\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f\u3002\u6700\u9ad8\u984d\u5165\u672d\u8005\u3067\u306f\u3042\u308a\u307e\u305b\u3093\u3002\u9ad8\u5024\u66f4\u65b0');

  assert.equal(api.isOutbidText(), true);
  assert.equal(api.isHighestBidderText(), false);
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

function testBidEntryButtonTextAvoidsHelpLinks() {
  const api = loadContentForTest('');

  assert.equal(api.isBidEntryButtonText('入札について'), false);
  assert.equal(api.isBidEntryButtonText('入札する'), true);
  assert.equal(api.isBidEntryButtonText('値段を上げて入札'), true);
  assert.equal(api.isBidEntryButtonText('今すぐ落札', 'buyout'), true);
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

function testProductDataExtractsTaxType() {
  const api = loadContentForTest('現在 1,000円 （税込）');
  const product = api.extractProductData();

  assert.equal(product.taxType, 'tax_included');
}

function testProductDataPrefersTaxZeroWhenBothTaxLabelsExist() {
  const api = loadContentForTest('現在 110円 （税0円） 送料説明 （税込）');
  const product = api.extractProductData();

  assert.equal(product.taxType, 'tax_zero');
}

function testTaxIncludedBidPriceForMultiBidIncrement() {
  const api = loadContentForTest('');

  assert.equal(api.getTaxIncludedBidPrice(5000, 'tax_included'), 5500);
  assert.equal(api.getTaxIncludedBidPrice(9, 'tax_included'), 9);
  assert.equal(api.getTaxIncludedBidPrice(5500, 'tax_zero'), 5500);
}

function testBidLimitRejectsTaxTotalAboveUserMax() {
  const api = loadContentForTest('');
  const result = api.validateUserMaxBidLimit(5600, 5000, 5500, 'tax_included');

  assert.equal(result.success, false);
  assert.equal(result.currentPrice, 5600);
  assert.equal(result.maxPrice, 5500);
}

function testBidLimitRejectsPlannedStoreBidAboveUserMax() {
  const api = loadContentForTest('');
  const result = api.validateUserMaxBidLimit(5400, 5100, 5500, 'tax_included');

  assert.equal(result.success, false);
  assert.equal(result.currentPrice, 5610);
  assert.equal(result.maxPrice, 5500);
}

function testBidLimitAllowsPlannedPersonalBidAtUserMax() {
  const api = loadContentForTest('');
  const result = api.validateUserMaxBidLimit(0, 5500, 5500, 'tax_zero');

  assert.equal(result, null);
}

function testPlainBidEntryIsNotFinalAgree() {
  const api = loadContentForTest('');

  assert.equal(api.isFinalAgreeButtonText('\u5165\u672d\u3059\u308b'), false);
  assert.equal(api.isFinalAgreeButtonText('\u4e0a\u8a18\u306e\u30ac\u30a4\u30c9\u30e9\u30a4\u30f3\u7b49\u3001\u60c5\u5831\u63d0\u4f9b\u306b\u540c\u610f\u3057\u3066 \u5165\u672d\u3059\u308b'), true);
}

function testExtractTaxIncludedTotal() {
  const api = loadContentForTest('\u7a0e\u8fbc\u5408\u8a08\u91d1\u984d 1,250\u5186');

  assert.equal(api.extractTaxIncludedTotal(), 1250);
}

function testMultiBidInputPageDetection() {
  const api = loadContentForTest('\u7a0e\u8fbc\u5408\u8a08\u91d1\u984d 1,250\u5186 \u78ba\u8a8d\u3059\u308b');

  assert.equal(api.isBidInputPage(), true);
}

function testProductHighestBidderNoticeDetection() {
  const api = loadContentForTest('\u3042\u306a\u305f\u304c\u6700\u9ad8\u984d\u5165\u672d\u8005\u3067\u3059!');

  assert.equal(api.hasCurrentHighestBidderNotice(), true);
}

function testExtractAutoBidLimit() {
  const api = loadContentForTest('\u3042\u306a\u305f\u304c\u6700\u9ad8\u984d\u5165\u672d\u8005\u3067\u3059! \u81ea\u52d5\u5165\u672d\u4e0a\u9650 1,000\u5186');

  assert.equal(api.extractAutoBidLimit(), 1000);
}

async function testSkipWhenBidIsWithinAutoBidLimit() {
  const result = await loadAndExecuteBidForTest(
    '\u73fe\u5728 510\u5186 \u3042\u306a\u305f\u304c\u6700\u9ad8\u984d\u5165\u672d\u8005\u3067\u3059! \u81ea\u52d5\u5165\u672d\u4e0a\u9650 1,000\u5186',
    { maxPrice: 900, userMaxPrice: 900, strategy: 'direct' },
    '/jp/auction/x123456789'
  );

  assert.equal(result.success, true);
  assert.equal(result.noBid, true);
  assert.equal(result.noStatus, true);
  assert.equal(result.closeTab, true);
  assert.equal(result.autoBidLimit, 1000);
}

async function testDirectBidWaitsForConfirmButtonEnabledAfterInput() {
  const priceInput = createTestElement('');
  priceInput.name = 'bid';
  const confirmButton = createTestElement('\u78ba\u8a8d\u3059\u308b');
  confirmButton.disabled = true;
  priceInput.onDispatch = event => {
    if (event.type === 'input') {
      setTimeout(() => {
        confirmButton.disabled = false;
      }, 20);
    }
  };

  const api = loadContentForTest('\u7a0e\u8fbc\u5408\u8a08\u91d1\u984d 1,000\u5186 \u78ba\u8a8d\u3059\u308b', '/jp/auction/x123456789/bid', {
    querySelector(selector) {
      return selector === 'input[name="bid"]' ? priceInput : null;
    },
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector.includes('button')) return [confirmButton];
      if (selector === 'body *') return [confirmButton];
      return [];
    }
  });

  const result = await api.executeBidV3(1000, { maxPrice: 1000, strategy: 'direct' });

  assert.equal(result.success, true);
  assert.equal(result.pendingFinal, true);
  assert.equal(result.stage, 'confirm-clicked');
  assert.equal(confirmButton.clicked, true);
}

async function testDirectBidDoesNotClickAuctionLinkWhenLookingForConfirm() {
  const priceInput = createTestElement('');
  priceInput.name = 'bid';
  const otherAuctionLink = createTestAnchor('\u78ba\u8a8d', 'https://auctions.yahoo.co.jp/jp/auction/v1230349098');
  const confirmButton = createTestElement('\u78ba\u8a8d\u3059\u308b');

  const api = loadContentForTest('\u7a0e\u8fbc\u5408\u8a08\u91d1\u984d 1,000\u5186 \u78ba\u8a8d\u3059\u308b', '/jp/auction/x1230699905/bid', {
    querySelector(selector) {
      return selector === 'input[name="bid"]' ? priceInput : null;
    },
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector.includes('button')) return [otherAuctionLink, confirmButton];
      if (selector === 'body *') return [otherAuctionLink, confirmButton];
      return [];
    }
  });

  const result = await api.executeBidV3(2450, { maxPrice: 2450, strategy: 'direct' });

  assert.equal(result.success, true);
  assert.equal(result.pendingFinal, true);
  assert.equal(otherAuctionLink.clicked, false);
  assert.equal(confirmButton.clicked, true);
}

async function testTimedStoreTaxBeforeBidUsesUserMaxForCurrentPriceValidation() {
  const priceInput = createTestElement('');
  priceInput.name = 'bid';
  const confirmButton = createTestElement('\u78ba\u8a8d\u3059\u308b');
  const currentPrice = createTestElement('2,530\u5186');

  const api = loadContentForTest('\u73fe\u5728 2,530\u5186 \u7a0e\u8fbc\u5408\u8a08\u91d1\u984d 2,695\u5186 \u78ba\u8a8d\u3059\u308b', '/jp/auction/x1230699905/bid', {
    querySelector(selector) {
      if (selector === '[class*="currentPrice"]') return currentPrice;
      return selector === 'input[name="bid"]' ? priceInput : null;
    },
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector.includes('button')) return [confirmButton];
      if (selector === 'body *') return [confirmButton];
      return [];
    }
  });

  const result = await api.executeBidV3(2450, {
    maxPrice: 2450,
    userMaxPrice: 2700,
    strategy: '5min',
    taxType: 'tax_zero'
  });

  assert.equal(result.success, true);
  assert.equal(result.pendingFinal, true);
  assert.equal(priceInput.value, '2450');
  assert.equal(confirmButton.clicked, true);
}

async function testMultiBidClicksConfirmAfterInput() {
  let bodyText = '\u73fe\u5728 5,000\u5186 \u7a0e\u8fbc\u5408\u8a08\u91d1\u984d 5,500\u5186 \u78ba\u8a8d\u3059\u308b';
  const priceInput = createTestElement('');
  priceInput.name = 'bid';
  const confirmButton = createTestElement('\u78ba\u8a8d\u3059\u308b');
  confirmButton.click = () => {
    confirmButton.clicked = true;
    bodyText = '\u5165\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f';
  };
  const currentPrice = createTestElement('5,000\u5186');

  const api = loadContentForTest(bodyText, '/jp/auction/x1230699905/bid', {
    getBodyText: () => bodyText,
    querySelector(selector) {
      if (selector === '[class*="currentPrice"]') return currentPrice;
      return selector === 'input[name="bid"]' ? priceInput : null;
    },
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector.includes('button')) return [confirmButton];
      if (selector === 'body *') return [confirmButton];
      return [];
    }
  });

  const result = await api.executeBidV3(5500, {
    maxPrice: 5500,
    userMaxPrice: 6600,
    strategy: 'multi_bid',
    taxType: 'tax_included',
    multiBidIncrement: 500
  });

  assert.equal(result.success, true);
  assert.equal(result.noBid, true);
  assert.equal(result.stage, 'already-highest');
  assert.equal(priceInput.value, '5500');
  assert.equal(confirmButton.clicked, true);
}

function testOrderHistoryPrefersWinningPriceLabelOverFirstYenAmount() {
  const orderContainer = createOrderContainer(
    '送料 10円 落札価格 2,530円 MD ゴールデンアックス',
    'MD ゴールデンアックス',
    'https://auctions.yahoo.co.jp/jp/auction/x1230699905'
  );
  const api = loadContentForTest('', '/my/won', {
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === 'li, article, tr, div') return [orderContainer];
      return [];
    }
  });

  const orders = api.extractOrderHistory();

  assert.equal(orders.length, 1);
  assert.equal(orders[0].productId, 'x1230699905');
  assert.equal(orders[0].price, '2,530');
}

async function run() {
  testOutbidTextIsNotHighestBidder();
  testRaiseBidButtonTextAloneIsNotOutbidFailure();
  testRebidRequiredIsSeparateFromOutbidFailure();
  testRebidRequiredWinsOverBidCompletedText();
  await testRebidRequiredFailsAfterOutcomeWait();
  testAcceptedBidTextIsHighestBidder();
  testProductPageHighestBidderNoticeDoesNotSkipNewBid();
  testAcceptedBuyoutTextIsSuccess();
  testSuccessTextWinsOverGenericOutbidWords();
  testExplicitOutbidWinsOverBidCompletedText();
  testProductTitleDoesNotUseYahooPrefix();
  testCurrentPriceUsesProductPageDataBeforeRecommendationText();
  testInstantBuyButtonTextIsRecognized();
  testBidEntryButtonTextAvoidsHelpLinks();
  testProductDataExtractsBuyoutPriceFromPageData();
  testProductDataExtractsTaxType();
  testProductDataPrefersTaxZeroWhenBothTaxLabelsExist();
  testTaxIncludedBidPriceForMultiBidIncrement();
  testBidLimitRejectsTaxTotalAboveUserMax();
  testBidLimitRejectsPlannedStoreBidAboveUserMax();
  testBidLimitAllowsPlannedPersonalBidAtUserMax();
  testPlainBidEntryIsNotFinalAgree();
  testExtractTaxIncludedTotal();
  testMultiBidInputPageDetection();
  testProductHighestBidderNoticeDetection();
  testExtractAutoBidLimit();
  await testSkipWhenBidIsWithinAutoBidLimit();
  await testDirectBidWaitsForConfirmButtonEnabledAfterInput();
  await testDirectBidDoesNotClickAuctionLinkWhenLookingForConfirm();
  await testTimedStoreTaxBeforeBidUsesUserMaxForCurrentPriceValidation();
  await testMultiBidClicksConfirmAfterInput();
  testOrderHistoryPrefersWinningPriceLabelOverFirstYenAmount();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
