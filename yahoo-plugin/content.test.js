const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadContentForTest(bodyText, pathname = '/jp/auction/x123456789/bid/done', options = {}) {
  const code = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
  const sandbox = {
    console,
    setTimeout: options.setTimeout || setTimeout,
    Date: options.Date || Date,
    Event: class Event {
      constructor(type) {
        this.type = type;
      }
    },
    FocusEvent: class FocusEvent {
      constructor(type) {
        this.type = type;
      }
    },
    KeyboardEvent: class KeyboardEvent {
      constructor(type) {
        this.type = type;
      }
    },
    MouseEvent: class MouseEvent {
      constructor(type) {
        this.type = type;
      }
    },
    PointerEvent: class PointerEvent {
      constructor(type) {
        this.type = type;
      }
    },
    window: {
      location: {
        origin: 'http://localhost:3001',
        href: options.href || `https://auctions.yahoo.co.jp${pathname}`,
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
    getBoundingClientRect() {
      return { left: 10, top: 20, width: 100, height: 40 };
    },
    parentElement: null,
    checked: false,
    getAttribute(name) {
      if (name === 'aria-label') return '';
      if (name === 'href') return this.href;
      if (name === 'aria-checked') return this.checked ? 'true' : 'false';
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

function createOrderContainer(text, linkText, href, priceElements = [], extraLinks = undefined) {
  const link = createTestAnchor(linkText, href);
  const contactLinks = extraLinks === undefined
    ? [{ text: '取引連絡', href: `https://contact.auctions.yahoo.co.jp/seller/top?aid=${String(href || '').split('/').pop()}` }]
    : extraLinks;
  const anchors = [link, ...contactLinks.map(item => createTestAnchor(item.text, item.href))];
  return {
    textContent: text,
    querySelectorAll(selector) {
      if (selector === 'a[href*="/jp/auction/"]') return [link];
      if (selector === 'a') return anchors;
      // 模拟 DOM 叶子价格元素查找，对应 extractOrderHistory 的 findPriceElementText。
      if (/span|li|dd|td|p|strong|b/.test(selector)) {
        return priceElements.map(t => ({ textContent: t, querySelectorAll: () => [] }));
      }
      return [];
    }
  };
}

function createBiddingContainer(text, linkText, href, imageSrc = '') {
  const link = createTestAnchor(linkText, href);
  const image = imageSrc ? { src: imageSrc, alt: linkText } : null;
  let parent = null;
  const container = {
    textContent: text,
    parentElement: null,
    querySelector(selector) {
      return selector === 'img' ? image : null;
    },
    querySelectorAll(selector) {
      return selector === 'a[href*="/jp/auction/"]' ? [link] : [];
    }
  };
  parent = container;
  link.parentElement = parent;
  link.closest = () => null;
  return { container, link };
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

function testYahooBidAccessFailureTextIsDetected() {
  const api = loadContentForTest('\u5165\u672d\u306b\u5931\u6557\u3057\u307e\u3057\u305f \u30aa\u30fc\u30af\u30b7\u30e7\u30f3\u306b\u30a2\u30af\u30bb\u30b9\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f \u518d\u8aad\u307f\u8fbc\u307f\u3059\u308b');
  const systemErrorApi = loadContentForTest('\u30b7\u30b9\u30c6\u30e0\u30a8\u30e9\u30fc \u30a8\u30e9\u30fc\u304c\u767a\u751f\u3057\u307e\u3057\u305f\u3002\u3057\u3070\u3089\u304f\u6642\u9593\u3092\u304a\u3044\u3066\u304b\u3089\u3082\u3046\u4e00\u5ea6\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002');

  assert.equal(api.isYahooBidAccessFailureText(), true);
  assert.equal(systemErrorApi.isYahooBidAccessFailureText(), true);
}

async function testYahooBidAccessFailureClosesTask() {
  const result = await loadAndExecuteBidForTest(
    '\u5165\u672d\u306b\u5931\u6557\u3057\u307e\u3057\u305f \u30aa\u30fc\u30af\u30b7\u30e7\u30f3\u306b\u30a2\u30af\u30bb\u30b9\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f \u518d\u8aad\u307f\u8fbc\u307f\u3059\u308b',
    { maxPrice: 1000, strategy: 'direct' },
    '/jp/auction/1231265568'
  );

  assert.equal(result.success, false);
  assert.equal(result.closeTab, true);
  assert.match(result.error, /\u30aa\u30fc\u30af\u30b7\u30e7\u30f3\u306b\u30a2\u30af\u30bb\u30b9/);
}

async function testYahooSystemErrorPageReturnsStableBidError() {
  const result = await loadAndExecuteBidForTest(
    '\u30b7\u30b9\u30c6\u30e0\u30a8\u30e9\u30fc \u30a8\u30e9\u30fc\u304c\u767a\u751f\u3057\u307e\u3057\u305f\u3002\u3057\u3070\u3089\u304f\u6642\u9593\u3092\u304a\u3044\u3066\u304b\u3089\u3082\u3046\u4e00\u5ea6\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002',
    { maxPrice: 1000, strategy: 'direct' },
    '/jp/auction/v1233335580/bid'
  );

  assert.equal(result.success, false);
  assert.equal(result.closeTab, true);
  assert.match(result.error, /Yahoo bid failed/);
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

function testStoreBuyoutThankYouPageIsSuccess() {
  const api = loadContentForTest(
    '\u8cfc\u5165\u5185\u5bb9\u306f\u53d6\u5f15\u30ca\u30d3\u3067\u78ba\u8a8d\u3067\u304d\u307e\u3059',
    '/order/thank-you'
  );

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
  assert.equal(api.isStorePurchaseButtonText('購入手続きへ'), true);
  assert.equal(api.isFinalAgreeButtonText('上記のガイドライン等、情報提供に同意して 落札する'), true);
  assert.equal(api.isConfirmButtonText('確認する'), true);
}

function testBidEntryButtonTextAvoidsHelpLinks() {
  const api = loadContentForTest('');

  assert.equal(api.isBidEntryButtonText('入札について'), false);
  assert.equal(api.isBidEntryButtonText('入札する'), true);
  assert.equal(api.isBidEntryButtonText('値段を上げて入札'), true);
  assert.equal(api.isBidEntryButtonText('今すぐ落札', 'buyout'), true);
  assert.equal(api.isBidEntryButtonText('購入手続きへ', 'buyout'), true);
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

function testProductDataAddsTaxToStoreBuyoutPriceFromPageData() {
  const api = loadContentForTest('\u73fe\u5728 275,100\u5186 \uff08\u7a0e\u8fbc\uff09 \u5373\u6c7a\u4fa1\u683c 250,091\u5186', '/jp/auction/c1234567890', {
    scripts: [
      'var pageData = {"items":{"productID":"c1234567890","price":"250091","winPrice":"250091","productName":"store buyout"}};'
    ]
  });
  const product = api.extractProductData();

  assert.equal(product.taxType, 'tax_included');
  assert.equal(product.buyoutPrice, 275100);
}

function testProductDataPrefersPageDataProductName() {
  const api = loadContentForTest('', '/jp/auction/v1184829642', {
    scripts: [
      'var pageData = {"items":{"productID":"v1184829642","price":"2237","productName":"新品 ニニ・ロッソ リチャード・クレイダーマン レイモン・ルフェーブル 日本のメロディー CD2枚組"}};'
    ]
  });
  const product = api.extractProductData();

  assert.equal(product.title, '新品 ニニ・ロッソ リチャード・クレイダーマン レイモン・ルフェーブル 日本のメロディー CD2枚組');
}

function testProductDataExtractsTaxType() {
  const api = loadContentForTest('現在 1,000円 （税込）');
  const product = api.extractProductData();

  assert.equal(product.taxType, 'tax_included');
}

function testProductDataExtractsShippingFeeText() {
  const postage = createTestElement('送料 290円');
  const api = loadContentForTest('送料 290円', '/jp/auction/x1234567890', {
    querySelector(selector) {
      if (selector === '#itemPostage') return postage;
      return null;
    }
  });

  const product = api.extractProductData();
  assert.equal(product.shippingFeeText, '290円');
}

function testProductDataPrefersRenderedShippingAmount() {
  const api = loadContentForTest('現在 6,800円 送料 大阪府は1,350円（税込） 配送方法：ヤマト運輸', '/jp/auction/1230841006');

  const product = api.extractProductData();

  assert.equal(product.shippingFeeText, '1350円');
}

function testProductDataPrefersCashOnDeliveryOverBidderPays() {
  const api = loadContentForTest('送料 着払い 落札者負担', '/jp/auction/b1227905707');

  const product = api.extractProductData();

  assert.equal(product.shippingFeeText, '着払い');
}

function testProductDataExtractsFreeShippingFromNextData() {
  const nextData = createTestElement(JSON.stringify({
    props: {
      pageProps: {
        initialState: {
          item: {
            detail: {
              item: {
                chargeForShipping: 'seller'
              }
            }
          }
        }
      }
    }
  }));
  const api = loadContentForTest('現在 6,000円 送料 おすすめ 送料無料', '/jp/auction/j1231001710', {
    querySelector(selector) {
      if (selector === 'script#__NEXT_DATA__') return nextData;
      return null;
    }
  });

  const product = api.extractProductData();

  assert.equal(product.shippingFeeText, '無料');
}

function testProductDataDoesNotUseRecommendationFreeShippingForBidderPays() {
  const nextData = createTestElement(JSON.stringify({
    props: {
      pageProps: {
        initialState: {
          item: {
            detail: {
              item: {
                chargeForShipping: 'winner',
                shippingInput: '取引ナビ開始時に入力'
              }
            }
          }
        }
      }
    }
  }));
  const api = loadContentForTest('現在 3,300円 送料 おすすめ 送料無料', '/jp/auction/j1230730561', {
    querySelector(selector) {
      if (selector === 'script#__NEXT_DATA__') return nextData;
      return null;
    }
  });

  const product = api.extractProductData();

  assert.equal(product.shippingFeeText, '落札者負担');
}

function testProductDataDoesNotUseUnavailableCashOnDeliveryDescription() {
  const nextData = createTestElement(JSON.stringify({
    props: {
      pageProps: {
        initialState: {
          item: {
            detail: {
              item: {
                chargeForShipping: 'winner',
                descriptionHtml: '※着払い、代引きは不可でございます。ご了承下さいませ。'
              }
            }
          }
        }
      }
    }
  }));
  const api = loadContentForTest('現在 1円 送料 送料情報の取得に失敗しました', '/jp/auction/x1231101693', {
    querySelector(selector) {
      if (selector === 'script#__NEXT_DATA__') return nextData;
      return null;
    }
  });

  const product = api.extractProductData();

  assert.equal(product.shippingFeeText, '落札者負担');
}

function testProductDataPrefersTaxZeroWhenBothTaxLabelsExist() {
  const api = loadContentForTest('現在 110円 （税0円） 送料説明 （税込）');
  const product = api.extractProductData();

  assert.equal(product.taxType, 'tax_zero');
}

function testProductDataDoesNotUseBodyDateAsEndTime() {
  const api = loadContentForTest('出品日時 2026-06-04 18:00:00 現在 1,300円', '/jp/auction/r1232049114');
  const product = api.extractProductData();

  assert.equal(product.endTime, '');
}

function testProductDataExtractsExplicitEndTime() {
  const api = loadContentForTest('', '/jp/auction/r1232049114', {
    querySelector(selector) {
      if (selector === '[itemprop="endDate"][content], meta[property="product:expiration_time"][content]') {
        return { content: '2026-06-04T22:00:00+09:00' };
      }
      return null;
    }
  });
  const product = api.extractProductData();

  assert.equal(product.endTime, '2026-06-04T22:00:00+09:00');
}

function testTaxIncludedBidPriceForMultiBidIncrement() {
  const api = loadContentForTest('');

  assert.equal(api.getTaxIncludedBidPrice(5000, 'tax_included'), 5500);
  assert.equal(api.getTaxIncludedBidPrice(9, 'tax_included'), 9);
  assert.equal(api.getTaxIncludedBidPrice(5500, 'tax_zero'), 5500);
  assert.equal(api.getYahooMinBidIncrement(999), 10);
  assert.equal(api.getYahooMinBidIncrement(1000), 100);
  assert.equal(api.getYahooMinBidIncrement(5000), 250);
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

function testMultiBidCapsToMaxWhenNormalIncrementExceedsMaxButMaxIsValid() {
  const api = loadContentForTest('');
  const result = api.resolveMultiBidNextBidPrice({
    currentPrice: 26000,
    maxPrice: 30000,
    userMaxPrice: 30000,
    increment: 5000,
    taxType: 'tax_zero'
  });

  assert.equal(result.success, true);
  assert.equal(result.bidPrice, 30000);
  assert.equal(result.cappedToMax, true);
  assert.equal(result.minIncrement, 500);
}

function testMultiBidFailsWhenMaxPriceCannotMeetYahooMinIncrement() {
  const api = loadContentForTest('');
  const result = api.resolveMultiBidNextBidPrice({
    currentPrice: 29600,
    maxPrice: 30000,
    userMaxPrice: 30000,
    increment: 1000,
    taxType: 'tax_zero'
  });

  assert.equal(result.success, false);
  assert.equal(result.currentPrice, 30600);
  assert.equal(result.maxPrice, 30000);
}

function testMultiBidCapsToMaxWhenNextNormalBidWouldLeaveOneMinimumStep() {
  const api = loadContentForTest('');
  const result = api.resolveMultiBidNextBidPrice({
    currentPrice: 28100,
    maxPrice: 30000,
    userMaxPrice: 30000,
    increment: 1000,
    taxType: 'tax_zero'
  });

  assert.equal(result.success, true);
  assert.equal(result.bidPrice, 30000);
  assert.equal(result.cappedToMax, true);
}

function testMultiBidDoesNotCapWhenNearCeilingEqualsMax() {
  const api = loadContentForTest('');
  const result = api.resolveMultiBidNextBidPrice({
    currentPrice: 28000,
    maxPrice: 30000,
    userMaxPrice: 30000,
    increment: 1000,
    taxType: 'tax_zero'
  });

  assert.equal(result.success, true);
  assert.equal(result.bidPrice, 29000);
  assert.equal(result.cappedToMax, undefined);
}

function testMultiBidUsesThreeStageFirstTargetForLowCurrentPrice() {
  const api = loadContentForTest('');
  const result = api.resolveMultiBidNextBidPrice({
    currentPrice: 1,
    maxPrice: 10000,
    userMaxPrice: 10000,
    increment: 250,
    taxType: 'tax_zero'
  });

  assert.equal(result.success, true);
  assert.equal(result.bidPrice, 5000);
}

function testMultiBidUsesFiveStepMiddleRange() {
  const api = loadContentForTest('');
  const result = api.resolveMultiBidNextBidPrice({
    currentPrice: 5000,
    maxPrice: 10000,
    userMaxPrice: 10000,
    increment: 250,
    taxType: 'tax_zero'
  });

  assert.equal(result.success, true);
  assert.equal(result.bidPrice, 5500);
}

function testMultiBidRebalancesShortMiddleRange() {
  const api = loadContentForTest('');
  const result = api.resolveMultiBidNextBidPrice({
    currentPrice: 3100,
    maxPrice: 6200,
    userMaxPrice: 6200,
    increment: 250,
    taxType: 'tax_zero'
  });

  assert.equal(result.success, true);
  assert.equal(result.bidPrice, 3400);
}

function testMultiBidUsesFixedIncrementInFinalReserveRange() {
  const api = loadContentForTest('');
  const result = api.resolveMultiBidNextBidPrice({
    currentPrice: 8000,
    maxPrice: 10000,
    userMaxPrice: 10000,
    increment: 250,
    taxType: 'tax_zero'
  });

  assert.equal(result.success, true);
  assert.equal(result.bidPrice, 8250);
}

function testInferCurrentPriceFromYahooDefaultBidPrice() {
  const api = loadContentForTest('');

  assert.equal(api.inferCurrentPriceFromYahooDefaultBidPrice(1700), 1600);
  assert.equal(api.inferCurrentPriceFromYahooDefaultBidPrice(5500), 5250);
  assert.equal(api.inferCurrentPriceFromYahooDefaultBidPrice(7000), 6750);
  assert.equal(api.inferCurrentPriceFromYahooDefaultBidPrice(5000), 4900);
  assert.equal(api.inferCurrentPriceFromYahooDefaultBidPrice(10000), 9750);
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

async function testDirectBidNoLongerSkipsWhenWithinAutoBidLimit() {
  // 移除"已是最高 + 新出价≤自动上限就跳过"的拦截逻辑后，direct 任务会正常去找出价按钮，
  // 即使新出价低于当前 Yahoo 自动上限。这样用户才能用更低金额覆盖（降低）旧上限。
  const result = await loadAndExecuteBidForTest(
    '\u73fe\u5728 510\u5186 \u3042\u306a\u305f\u304c\u6700\u9ad8\u984d\u5165\u672d\u8005\u3067\u3059! \u81ea\u52d5\u5165\u672d\u4e0a\u9650 1,000\u5186',
    { maxPrice: 900, userMaxPrice: 900, strategy: 'direct' },
    '/jp/auction/x123456789'
  );

  // 不再返回 noStatus 跳过；测试页面没有出价按钮，所以会返回 bid button not found
  assert.equal(result.success, false);
  assert.notEqual(result.noStatus, true);
  assert.match(String(result.error || ''), /bid button not found/);
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

async function testDirectBidClicksConfirmInsideBidModalOnly() {
  const priceInput = createTestElement('');
  priceInput.name = 'bid';
  const modalConfirmButton = createTestElement('\u78ba\u8a8d\u3059\u308b');
  const recommendationButton = createTestElement('\u78ba\u8a8d\u3059\u308b');
  const bidModal = createTestElement('\u5165\u672d \u5165\u672d\u984d \u78ba\u8a8d\u3059\u308b');
  bidModal.querySelectorAll = selector => {
    if (selector.includes('button') || selector.includes('a')) return [modalConfirmButton];
    return [];
  };
  modalConfirmButton.closest = selector => selector.includes('role') || selector.includes('dialog') ? bidModal : null;
  recommendationButton.closest = () => null;

  const api = loadContentForTest('\u5165\u672d \u5165\u672d\u984d \u7a0e\u8fbc\u5408\u8a08\u91d1\u984d 1,100\u5186 \u3053\u306e\u5546\u54c1\u3082\u6ce8\u76ee\u3055\u308c\u3066\u3044\u307e\u3059 \u78ba\u8a8d\u3059\u308b', '/jp/auction/x1230699905/bid', {
    querySelector(selector) {
      return selector === 'input[name="bid"]' ? priceInput : null;
    },
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === '[role="dialog"], [aria-modal="true"], .ReactModal__Content, [class*="modal" i], [class*="dialog" i]') return [bidModal];
      if (selector.includes('button')) return [recommendationButton, modalConfirmButton];
      if (selector === 'body *') return [recommendationButton, modalConfirmButton];
      return [];
    }
  });

  const result = await api.executeBidV3(1100, { maxPrice: 1100, strategy: 'direct' });

  assert.equal(result.success, true);
  assert.equal(result.pendingFinal, true);
  assert.equal(modalConfirmButton.clicked, true);
  assert.equal(recommendationButton.clicked, false);
}

async function testDirectBidSubmitConfirmRequestsFormSubmit() {
  const priceInput = createTestElement('');
  priceInput.name = 'bid';
  const confirmButton = createTestElement('\u78ba\u8a8d\u3059\u308b');
  confirmButton.type = 'submit';
  const form = {
    submittedWith: null,
    requestSubmit(button) {
      this.submittedWith = button;
    }
  };
  const bidModal = createTestElement('\u5165\u672d \u5165\u672d\u984d \u78ba\u8a8d\u3059\u308b');
  bidModal.querySelectorAll = selector => {
    if (selector.includes('button') || selector.includes('input')) return [confirmButton];
    return [];
  };
  confirmButton.closest = selector => {
    if (selector === 'form') return form;
    if (selector.includes('role') || selector.includes('dialog')) return bidModal;
    return null;
  };

  const api = loadContentForTest('\u5165\u672d \u5165\u672d\u984d \u7a0e\u8fbc\u5408\u8a08\u91d1\u984d 1,100\u5186 \u78ba\u8a8d\u3059\u308b', '/jp/auction/x1230699905/bid', {
    querySelector(selector) {
      return selector === 'input[name="bid"]' ? priceInput : null;
    },
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === '[role="dialog"], [aria-modal="true"], .ReactModal__Content, [class*="modal" i], [class*="dialog" i]') return [bidModal];
      if (selector.includes('button') || selector.includes('input')) return [confirmButton];
      if (selector === 'body *') return [confirmButton];
      return [];
    }
  });

  const result = await api.executeBidV3(1100, { maxPrice: 1100, strategy: 'direct' });

  assert.equal(result.success, true);
  assert.equal(result.pendingFinal, true);
  assert.equal(form.submittedWith, confirmButton);
}

async function testDirectBidFinalConfirmUsesShortOutcomeWait() {
  let now = 0;
  const waits = [];
  const finalAgreeButton = createTestElement('\u4e0a\u8a18\u306b\u540c\u610f\u306e\u3046\u3048 \u5165\u672d\u3059\u308b');

  const fakeDate = class extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  };

  const api = loadContentForTest('\u5165\u672d\u5185\u5bb9\u306e\u78ba\u8a8d \u4e0a\u8a18\u306b\u540c\u610f\u306e\u3046\u3048 \u5165\u672d\u3059\u308b', '/jp/auction/x1230699905/bid/confirm', {
    Date: fakeDate,
    setTimeout(fn, ms) {
      waits.push(ms);
      now += ms;
      fn();
      return 1;
    },
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector.includes('button') || selector.includes('a')) return [finalAgreeButton];
      if (selector === 'body *') return [finalAgreeButton];
      return [];
    }
  });

  const result = await api.executeBidV3(400, { maxPrice: 400, strategy: 'direct', bidMode: 'bid' });

  assert.equal(finalAgreeButton.clicked, true);
  assert.equal(result.success, false);
  assert.match(result.error, /bid result confirmation timeout/);
  assert.equal(now, 3000);
  assert.ok(waits.length <= 6);
}

async function testBuyoutClicksInstantBuyThenFinalAgree() {
  let stage = 'product';
  const instantBuyButton = createTestElement('\u4eca\u3059\u3050\u843d\u672d');
  const finalAgreeButton = createTestElement('\u4e0a\u8a18\u306e\u30ac\u30a4\u30c9\u30e9\u30a4\u30f3\u7b49\u306b\u540c\u610f\u3057\u3066 \u843d\u672d\u3059\u308b');
  instantBuyButton.click = () => {
    instantBuyButton.clicked = true;
    stage = 'confirm';
  };
  finalAgreeButton.click = () => {
    finalAgreeButton.clicked = true;
    stage = 'done';
  };

  const api = loadContentForTest('', '/jp/auction/t1204059533', {
    getBodyText: () => {
      if (stage === 'product') return '\u73fe\u5728 2,800\u5186 \u4eca\u3059\u3050\u843d\u672d';
      if (stage === 'confirm') return '\u843d\u672d\u78ba\u8a8d \u4e0a\u8a18\u306e\u30ac\u30a4\u30c9\u30e9\u30a4\u30f3\u7b49\u306b\u540c\u610f\u3057\u3066 \u843d\u672d\u3059\u308b';
      return '\u843d\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f';
    },
    scripts: [
      'var pageData = {"items":{"productID":"t1204059533","price":"2800","winPrice":"2800","productName":"buyout only product"}};'
    ],
    querySelectorAll(selector) {
      if (selector === 'script') return [
        { textContent: 'var pageData = {"items":{"productID":"t1204059533","price":"2800","winPrice":"2800","productName":"buyout only product"}};' }
      ];
      if (selector.includes('button') || selector === 'body *') {
        if (stage === 'product') return [instantBuyButton];
        if (stage === 'confirm') return [finalAgreeButton];
      }
      return [];
    }
  });

  const result = await api.executeBidV3(2800, {
    maxPrice: 2800,
    userMaxPrice: 2800,
    bidMode: 'buyout',
    strategy: 'direct'
  });

  assert.equal(result.success, true);
  assert.equal(instantBuyButton.clicked, true);
  assert.equal(finalAgreeButton.clicked, true);
  assert.notEqual(result.error, 'buyout button not found');
}

async function testStoreBuyoutClicksPurchaseFlow() {
  let stage = 'product';
  const purchaseButton = createTestElement('\u8cfc\u5165\u624b\u7d9a\u304d\u3078');
  const bulkCheckbox = createTestElement('');
  const instantBuyButton = createTestElement('\u4eca\u3059\u3050\u843d\u672d\u3059\u308b');
  const finalAgreeButton = createTestElement('\u4e0a\u8a18\u306b\u540c\u610f\u306e\u3046\u3048\u843d\u672d\u3059\u308b');

  purchaseButton.click = () => {
    purchaseButton.clicked = true;
    stage = 'confirm';
  };
  bulkCheckbox.click = () => {
    bulkCheckbox.clicked = true;
    bulkCheckbox.checked = true;
  };
  instantBuyButton.click = () => {
    instantBuyButton.clicked = true;
    stage = 'modal';
  };
  finalAgreeButton.click = () => {
    finalAgreeButton.clicked = true;
    stage = 'success';
  };

  const api = loadContentForTest('', '/jp/auction/v1184829642', {
    getBodyText: () => {
      if (stage === 'product') return '\u4fa1\u683c 2,460\u5186\uff08\u7a0e\u8fbc\uff09 \u8cfc\u5165\u624b\u7d9a\u304d\u3078';
      if (stage === 'confirm') return '\u8cfc\u5165\u5185\u5bb9\u306e\u78ba\u8a8d \u3053\u306e\u51fa\u54c1\u8005\u306e\u4ed6\u306e\u5546\u54c1\u3068\u307e\u3068\u3081\u3066\u8cfc\u5165\u3059\u308b \u4eca\u3059\u3050\u843d\u672d\u3059\u308b';
      if (stage === 'modal') return '\u78ba\u8a8d \u4e0a\u8a18\u306b\u540c\u610f\u306e\u3046\u3048\u843d\u672d\u3059\u308b';
      return '\u3053\u306e\u5546\u54c1\u3092\u843d\u672d\u3057\u307e\u3057\u305f\u304c\u3001\u307e\u3060\u8cfc\u5165\u624b\u7d9a\u304d\u304c\u5b8c\u4e86\u3057\u3066\u3044\u307e\u305b\u3093\u3002 \u8cfc\u5165\u624b\u7d9a\u304d\u3092\u884c\u3046';
    },
    querySelectorAll(selector) {
      if (selector === 'script') {
        return stage === 'product'
          ? [{ textContent: 'var pageData = {"items":{"productID":"v1184829642","price":"2237","winPrice":"2237","productName":"store buyout"}};' }]
          : [];
      }
      if (selector === 'input[type="checkbox"], [role="checkbox"]') {
        return stage === 'confirm' ? [bulkCheckbox] : [];
      }
      if (selector.includes('button') || selector === 'body *') {
        if (stage === 'product') return [purchaseButton];
        if (stage === 'confirm') return [bulkCheckbox, instantBuyButton];
        if (stage === 'modal') return [finalAgreeButton];
      }
      return [];
    }
  });

  const result = await api.executeBidV3(2237, {
    maxPrice: 2237,
    userMaxPrice: 2460,
    bidMode: 'buyout',
    taxType: 'tax_included',
    strategy: 'direct'
  });

  assert.equal(result.success, true);
  assert.equal(purchaseButton.clicked, true);
  assert.equal(bulkCheckbox.clicked, true);
  assert.equal(instantBuyButton.clicked, true);
  assert.equal(finalAgreeButton.clicked, true);
}

async function testStoreBuyoutSkipsCurrentPriceAboveTaxExcludedMaxValidation() {
  let stage = 'modal';
  const finalAgreeButton = createTestElement('\u4e0a\u8a18\u306b\u540c\u610f\u306e\u3046\u3048\u843d\u672d\u3059\u308b');
  finalAgreeButton.click = () => {
    finalAgreeButton.clicked = true;
    stage = 'success';
  };
  const currentPrice = createTestElement('273\u5186');

  const api = loadContentForTest('', '/jp/auction/q1175609593', {
    getBodyText: () => {
      if (stage === 'modal') return '\u4fa1\u683c 300\u5186\uff08\u7a0e\u8fbc\uff09 \u7a0e\u8fbc\u5408\u8a08\u91d1\u984d 301\u5186 \u4e0a\u8a18\u306b\u540c\u610f\u306e\u3046\u3048\u843d\u672d\u3059\u308b';
      return '\u3053\u306e\u5546\u54c1\u3092\u843d\u672d\u3057\u307e\u3057\u305f';
    },
    querySelector(selector) {
      if (selector === '[class*="priceValue"]' || selector === '[class*="priceFrame"]' || selector === '[class*="currentPrice"]') return currentPrice;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'script') {
        return [{ textContent: 'var pageData = {"items":{"productID":"q1175609593","price":"273","winPrice":"273","productName":"store buyout"}};' }];
      }
      if (selector.includes('button') || selector === 'body *') {
        return stage === 'modal' ? [finalAgreeButton] : [];
      }
      return [];
    }
  });

  const result = await api.executeBidV3(272, {
    maxPrice: 272,
    userMaxPrice: 300,
    bidMode: 'buyout',
    taxType: 'tax_included',
    strategy: 'direct'
  });

  assert.equal(result.success, true);
  assert.equal(finalAgreeButton.clicked, true);
}

async function testStoreBuyoutReviewSkipsPayPayBenefitConfirmLink() {
  let stage = 'review';
  const payPayBenefitLink = createTestElement('\u7279\u5178\u3092\u78ba\u8a8d\u3059\u308b');
  payPayBenefitLink.tagName = 'A';
  payPayBenefitLink.href = 'https://www.paypay-card.co.jp/campaign/sign-up/web/yahoo';
  payPayBenefitLink.click = () => {
    payPayBenefitLink.clicked = true;
    stage = 'ad';
  };
  const reviewConfirmLink = createTestElement('\u78ba\u8a8d\u3059\u308b');
  reviewConfirmLink.tagName = 'A';
  reviewConfirmLink.getAttribute = name => {
    if (name === 'data-cl-params') return '_cl_link:confirm;_cl_position:1;';
    if (name === 'href') return reviewConfirmLink.href;
    return '';
  };
  reviewConfirmLink.click = () => {
    reviewConfirmLink.clicked = true;
    stage = 'final';
  };
  const finalAgreeButton = createTestElement('\u4e0a\u8a18\u306b\u540c\u610f\u306e\u3046\u3048\u843d\u672d\u3059\u308b');
  finalAgreeButton.click = () => {
    finalAgreeButton.clicked = true;
    stage = 'success';
  };

  const api = loadContentForTest('', '/order/review?auctionId=q1175609593', {
    getBodyText: () => {
      if (stage === 'review') return '\u8cfc\u5165\u5185\u5bb9\u306e\u78ba\u8a8d \u304a\u652f\u6255\u3044\u91d1\u984d\uff08\u7a0e\u8fbc\uff09 300\u5186 \u7279\u5178\u3092\u78ba\u8a8d\u3059\u308b \u78ba\u8a8d\u3059\u308b';
      if (stage === 'final') return '\u78ba\u8a8d \u4e0a\u8a18\u306b\u540c\u610f\u306e\u3046\u3048\u843d\u672d\u3059\u308b';
      if (stage === 'ad') return '\u7279\u5178\u7533\u3057\u8fbc\u307f';
      return '\u3053\u306e\u5546\u54c1\u3092\u843d\u672d\u3057\u307e\u3057\u305f';
    },
    querySelectorAll(selector) {
      if (selector === 'script') {
        return [{ textContent: 'var pageData = {"items":{"productID":"q1175609593","price":"273","winPrice":"273","productName":"store buyout"}};' }];
      }
      if (selector.includes('button') || selector === 'body *') {
        if (stage === 'review') return [payPayBenefitLink, reviewConfirmLink];
        if (stage === 'final') return [finalAgreeButton];
      }
      return [];
    }
  });

  const result = await api.executeBidV3(272, {
    maxPrice: 272,
    userMaxPrice: 300,
    bidMode: 'buyout',
    taxType: 'tax_included',
    strategy: 'direct'
  });

  assert.equal(result.success, true);
  assert.equal(payPayBenefitLink.clicked, false);
  assert.equal(reviewConfirmLink.clicked, true);
  assert.equal(finalAgreeButton.clicked, true);
}

async function testStoreBuyoutFinalPurchaseClickDoesNotRepeatReviewConfirm() {
  let stage = 'review';
  let reviewConfirmClicks = 0;
  const reviewConfirmLink = createTestElement('\u78ba\u8a8d\u3059\u308b');
  reviewConfirmLink.tagName = 'A';
  reviewConfirmLink.getAttribute = name => {
    if (name === 'data-cl-params') return '_cl_link:confirm;_cl_position:1;';
    if (name === 'href') return reviewConfirmLink.href;
    return '';
  };
  reviewConfirmLink.click = () => {
    reviewConfirmClicks += 1;
    stage = 'final';
  };
  const finalPurchaseButton = createTestElement('\u4e0a\u8a18\u306b\u540c\u610f\u306e\u3046\u3048\u8cfc\u5165\u3092\u78ba\u5b9a\u3059\u308b');
  finalPurchaseButton.click = () => {
    finalPurchaseButton.clicked = true;
    stage = 'success';
  };

  const api = loadContentForTest('', '/order/review?auctionId=q1175609593', {
    getBodyText: () => {
      if (stage === 'review') return '\u8cfc\u5165\u5185\u5bb9\u306e\u78ba\u8a8d \u304a\u652f\u6255\u3044\u91d1\u984d\uff08\u7a0e\u8fbc\uff09 300\u5186 \u78ba\u8a8d\u3059\u308b';
      if (stage === 'final') return '\u8cfc\u5165\u3092\u78ba\u5b9a\u3057\u307e\u3059\u304b\uff1f \u4e0a\u8a18\u306b\u540c\u610f\u306e\u3046\u3048\u8cfc\u5165\u3092\u78ba\u5b9a\u3059\u308b \u78ba\u8a8d\u3059\u308b';
      return '\u8cfc\u5165\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f';
    },
    querySelectorAll(selector) {
      if (selector === 'script') {
        return [{ textContent: 'var pageData = {"items":{"productID":"q1175609593","price":"273","winPrice":"273","productName":"store buyout"}};' }];
      }
      if (selector.includes('button') || selector === 'body *') {
        if (stage === 'review') return [reviewConfirmLink];
        if (stage === 'final') return [reviewConfirmLink, finalPurchaseButton];
      }
      return [];
    }
  });

  const result = await api.executeBidV3(272, {
    maxPrice: 272,
    userMaxPrice: 300,
    bidMode: 'buyout',
    taxType: 'tax_included',
    strategy: 'direct'
  });

  assert.equal(result.success, true);
  assert.equal(reviewConfirmClicks, 1);
  assert.equal(finalPurchaseButton.clicked, true);
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

  // max_price=2450（要填到 Yahoo 表单的税前金额）< 当前价 2530，插件应拒绝。
  // 之前用 user_max_price(2700) 比较的逻辑会通过，但语义错位：填 2450 进 Yahoo 必被拒。
  const result = await api.executeBidV3(2450, {
    maxPrice: 2450,
    userMaxPrice: 2700,
    strategy: '5min',
    taxType: 'tax_zero'
  });

  assert.equal(result.success, false);
  assert.match(String(result.error || ''), /已高于最高价/);
  assert.equal(result.currentPrice, 2530);
  assert.equal(result.maxPrice, 2450);
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

async function testMultiBidWaitsAfterPriceInputBeforeConfirmClick() {
  let bodyText = '\u73fe\u5728 5,000\u5186 \u7a0e\u8fbc\u5408\u8a08\u91d1\u984d 5,500\u5186 \u78ba\u8a8d\u3059\u308b';
  let sawInputSubmitDelay = false;
  const delays = [];
  const priceInput = createTestElement('');
  priceInput.name = 'bid';
  const confirmButton = createTestElement('\u78ba\u8a8d\u3059\u308b');
  confirmButton.click = () => {
    assert.equal(sawInputSubmitDelay, true);
    confirmButton.clicked = true;
    bodyText = '\u5165\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f';
  };
  const currentPrice = createTestElement('5,000\u5186');

  const api = loadContentForTest(bodyText, '/jp/auction/x1230699905/bid', {
    getBodyText: () => bodyText,
    setTimeout(fn, ms) {
      delays.push(ms);
      if (ms >= 700 && !confirmButton.clicked) {
        sawInputSubmitDelay = true;
      }
      fn();
      return 1;
    },
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
  assert.equal(confirmButton.clicked, true);
  assert.ok(delays.some(ms => ms >= 700));
}

async function testMultiBidRebidRequiredUsesTopDialogBidButton() {
  let bodyText = '\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059 \u5165\u672d \u5165\u672d\u984d \u7a0e\u8fbc\u5408\u8a08\u91d1\u984d 606\u5186 \u5165\u672d\u3059\u308b \u5024\u6bb5\u3092\u4e0a\u3052\u3066\u5165\u672d';
  const priceInput = createTestElement('');
  priceInput.name = 'bid';
  priceInput.value = '';
  const currentPrice = createTestElement('595\u5186');
  const outerRaiseButton = createTestElement('\u5024\u6bb5\u3092\u4e0a\u3052\u3066\u5165\u672d');
  const modalBidButton = createTestElement('\u5165\u672d\u3059\u308b');
  const rebidDialog = createTestElement('\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059 \u5165\u672d \u5165\u672d\u984d \u5165\u672d\u3059\u308b');
  rebidDialog.querySelectorAll = selector => {
    if (selector.includes('button') || selector.includes('a') || selector.includes('input')) return [modalBidButton];
    return [];
  };
  outerRaiseButton.click = () => {
    outerRaiseButton.clicked = true;
    bodyText = '\u5165\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f';
  };
  modalBidButton.click = () => {
    modalBidButton.clicked = true;
    bodyText = '\u5165\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f';
  };

  const api = loadContentForTest(bodyText, '/jp/auction/g1233324435', {
    getBodyText: () => bodyText,
    querySelector(selector) {
      if (selector === '[class*="currentPrice"]') return currentPrice;
      return selector === 'input[name="bid"]' ? priceInput : null;
    },
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === '[role="dialog"], [aria-modal="true"], .ReactModal__Content, [class*="modal" i], [class*="dialog" i]') return [rebidDialog];
      if (selector.includes('button') || selector.includes('a') || selector.includes('input')) return [outerRaiseButton, modalBidButton];
      if (selector === 'body *') return [outerRaiseButton, modalBidButton];
      return [];
    }
  });

  const result = await api.executeBidV3(1000, {
    maxPrice: 1000,
    userMaxPrice: 1100,
    strategy: 'multi_bid',
    taxType: 'tax_included',
    multiBidIncrement: 56
  });

  assert.equal(result.success, true);
  assert.equal(outerRaiseButton.clicked, false);
  assert.equal(modalBidButton.clicked, true);
  assert.equal(priceInput.value, '651');
}

async function testMultiBidRebidRequiredDoesNotFallbackToOuterRaiseButton() {
  let bodyText = '\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059 \u5165\u672d \u5165\u672d\u984d \u78ba\u8a8d\u3059\u308b \u5024\u6bb5\u3092\u4e0a\u3052\u3066\u5165\u672d';
  const priceInput = createTestElement('');
  priceInput.name = 'bid';
  priceInput.value = '1350';
  const currentPrice = createTestElement('1,375\u5186\uff08\u7a0e\u8fbc\uff09');
  const outerRaiseButton = createTestElement('\u5024\u6bb5\u3092\u4e0a\u3052\u3066\u5165\u672d');
  const nestedConfirmButton = createTestElement('\u78ba\u8a8d\u3059\u308b');
  const rebidDialog = createTestElement('\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059');
  rebidDialog.querySelectorAll = selector => {
    if (selector.includes('button') || selector.includes('a') || selector.includes('input')) return [];
    return [];
  };
  outerRaiseButton.click = () => {
    outerRaiseButton.clicked = true;
    bodyText = '\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059 \u5165\u672d \u78ba\u8a8d\u3059\u308b';
  };
  nestedConfirmButton.click = () => {
    nestedConfirmButton.clicked = true;
  };

  const api = loadContentForTest(bodyText, '/jp/auction/v1233335580', {
    getBodyText: () => bodyText,
    querySelector(selector) {
      if (selector === '[class*="currentPrice"]') return currentPrice;
      return selector === 'input[name="bid"]' ? priceInput : null;
    },
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === '[role="dialog"], [aria-modal="true"], .ReactModal__Content, [class*="modal" i], [class*="dialog" i]') return [rebidDialog];
      if (selector.includes('button') || selector.includes('a') || selector.includes('input')) return [outerRaiseButton, nestedConfirmButton];
      if (selector === 'body *') return [outerRaiseButton, nestedConfirmButton];
      return [];
    }
  });

  const result = await api.executeBidV3(3000, {
    maxPrice: 3000,
    userMaxPrice: 3300,
    strategy: 'multi_bid',
    taxType: 'tax_included',
    multiBidIncrement: 100
  });

  assert.equal(result.success, false);
  assert.equal(outerRaiseButton.clicked, false);
  assert.equal(nestedConfirmButton.clicked, false);
  assert.match(result.error, /rebid submit button not found/);
}

async function testMultiBidRebidRequiredUsesLatestVisibleCurrentPriceOverStaleScript() {
  let bodyText = '\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059 \u73fe\u5728 1,375\u5186\uff08\u7a0e\u8fbc\uff09 1,350\u5186\u304b\u3089\u5165\u672d\u3067\u304d\u307e\u3059 \u5165\u672d\u3059\u308b';
  const priceInput = createTestElement('');
  priceInput.name = 'bid';
  priceInput.value = '1350';
  const currentPrice = createTestElement('1,375\u5186\uff08\u7a0e\u8fbc\uff09');
  const modalBidButton = createTestElement('\u5165\u672d\u3059\u308b');
  const rebidDialog = createTestElement('\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059 \u5165\u672d\u3059\u308b');
  const stalePageDataScript = {
    textContent: 'var pageData = {"items":{"price":"900"}};',
    type: 'text/javascript'
  };
  rebidDialog.querySelectorAll = selector => {
    if (selector.includes('button') || selector.includes('a') || selector.includes('input')) return [modalBidButton];
    return [];
  };
  modalBidButton.click = () => {
    modalBidButton.clicked = true;
    bodyText = '\u5165\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f';
  };

  const api = loadContentForTest(bodyText, '/jp/auction/v1233335580', {
    getBodyText: () => bodyText,
    querySelector(selector) {
      if (selector === '[class*="currentPrice"]') return currentPrice;
      return selector === 'input[name="bid"]' ? priceInput : null;
    },
    querySelectorAll(selector) {
      if (selector === 'script') return [stalePageDataScript];
      if (selector === '[role="dialog"], [aria-modal="true"], .ReactModal__Content, [class*="modal" i], [class*="dialog" i]') return [rebidDialog];
      if (selector.includes('button') || selector.includes('a') || selector.includes('input')) return [modalBidButton];
      if (selector === 'body *') return [modalBidButton];
      return [];
    }
  });

  const result = await api.executeBidV3(3000, {
    maxPrice: 3000,
    userMaxPrice: 3300,
    strategy: 'multi_bid',
    taxType: 'tax_included',
    multiBidIncrement: 250
  });

  assert.equal(result.success, true);
  assert.equal(modalBidButton.clicked, true);
  assert.equal(priceInput.value, '1500');
}

async function testMultiBidRebidRequiredUsesYahooRebidConfirmButtonDataParams() {
  let bodyText = '\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059 \u73fe\u5728 1,375\u5186\uff08\u7a0e\u8fbc\uff09 1,350\u5186\u304b\u3089\u5165\u672d\u3067\u304d\u307e\u3059 \u5165\u672d\u3059\u308b \u5024\u6bb5\u3092\u4e0a\u3052\u3066\u5165\u672d';
  const priceInput = createTestElement('');
  priceInput.name = 'bid';
  priceInput.value = '1350';
  const currentPrice = createTestElement('1,375\u5186\uff08\u7a0e\u8fbc\uff09');
  const outerRaiseButton = createTestElement('\u5024\u6bb5\u3092\u4e0a\u3052\u3066\u5165\u672d');
  const rebidConfirmButton = createTestElement('\u5165\u672d\u3059\u308b');
  rebidConfirmButton.getAttribute = name => {
    if (name === 'data-cl-params') return '_cl_vmodule:rebid;_cl_link:cnfbtn;_cl_position:1';
    if (name === 'aria-label') return '';
    return '';
  };
  const rebidDialog = createTestElement('\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059');
  rebidDialog.querySelectorAll = () => [];
  outerRaiseButton.click = () => {
    outerRaiseButton.clicked = true;
  };
  rebidConfirmButton.click = () => {
    rebidConfirmButton.clicked = true;
    bodyText = '\u5165\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f';
  };

  const api = loadContentForTest(bodyText, '/jp/auction/v1233335580', {
    getBodyText: () => bodyText,
    querySelector(selector) {
      if (selector === '[class*="currentPrice"]') return currentPrice;
      return selector === 'input[name="bid"]' ? priceInput : null;
    },
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === '[role="dialog"], [aria-modal="true"], .ReactModal__Content, [class*="modal" i], [class*="dialog" i]') return [rebidDialog];
      if (selector.includes('button') || selector.includes('a') || selector.includes('input')) return [outerRaiseButton, rebidConfirmButton];
      if (selector === 'body *') return [outerRaiseButton, rebidConfirmButton];
      return [];
    }
  });

  const result = await api.executeBidV3(4000, {
    maxPrice: 4000,
    userMaxPrice: 4400,
    strategy: 'multi_bid',
    taxType: 'tax_included',
    multiBidIncrement: 250
  });

  assert.equal(result.success, true);
  assert.equal(outerRaiseButton.clicked, false);
  assert.equal(rebidConfirmButton.clicked, true);
  assert.equal(priceInput.value, '1500');
}

async function testMultiBidRebidSubmitButtonIsClickedOnlyOnce() {
  let bodyText = '\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059 1,700\u5186\u304b\u3089\u5165\u672d\u3067\u304d\u307e\u3059 \u5165\u672d\u3059\u308b';
  let clickDispatchCount = 0;
  let nativeClickCount = 0;
  const priceInput = createTestElement('');
  priceInput.name = 'bid';
  priceInput.value = '1700';
  const rebidConfirmButton = createTestElement('\u5165\u672d\u3059\u308b');
  rebidConfirmButton.getAttribute = name => {
    if (name === 'data-cl-params') return '_cl_vmodule:rebid;_cl_link:cnfbtn;_cl_position:1';
    if (name === 'aria-label') return '';
    return '';
  };
  rebidConfirmButton.dispatchEvent = event => {
    if (event.type === 'click') clickDispatchCount += 1;
  };
  rebidConfirmButton.click = () => {
    nativeClickCount += 1;
    rebidConfirmButton.clicked = true;
    bodyText = '\u5165\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f';
  };
  const rebidDialog = createTestElement('\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059');
  rebidDialog.querySelectorAll = () => [];

  const api = loadContentForTest(bodyText, '/jp/auction/v1233335580', {
    getBodyText: () => bodyText,
    querySelector(selector) {
      return selector === 'input[name="bid"]' ? priceInput : null;
    },
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === '[role="dialog"], [aria-modal="true"], .ReactModal__Content, [class*="modal" i], [class*="dialog" i]') return [rebidDialog];
      if (selector.includes('button') || selector.includes('a') || selector.includes('input')) return [rebidConfirmButton];
      if (selector === 'body *') return [rebidConfirmButton];
      return [];
    }
  });

  const result = await api.executeBidV3(4000, {
    maxPrice: 4000,
    userMaxPrice: 4400,
    strategy: 'multi_bid',
    taxType: 'tax_included',
    multiBidIncrement: 250
  });

  assert.equal(result.success, true);
  assert.equal(nativeClickCount + clickDispatchCount, 1);
  assert.equal(priceInput.value, '1850');
}

async function testMultiBidRebidWaitsOneSecondAfterPriceInputBeforeSubmit() {
  let bodyText = '\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059 1,700\u5186\u304b\u3089\u5165\u672d\u3067\u304d\u307e\u3059 \u5165\u672d\u3059\u308b';
  let sawRebidDelay = false;
  const delays = [];
  const priceInput = createTestElement('');
  priceInput.name = 'bid';
  priceInput.value = '1700';
  const rebidConfirmButton = createTestElement('\u5165\u672d\u3059\u308b');
  rebidConfirmButton.getAttribute = name => {
    if (name === 'data-cl-params') return '_cl_vmodule:rebid;_cl_link:cnfbtn;_cl_position:1';
    if (name === 'aria-label') return '';
    return '';
  };
  rebidConfirmButton.click = () => {
    assert.equal(sawRebidDelay, true);
    rebidConfirmButton.clicked = true;
    bodyText = '\u5165\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f';
  };
  const rebidDialog = createTestElement('\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059');
  rebidDialog.querySelectorAll = () => [];

  const api = loadContentForTest(bodyText, '/jp/auction/v1233335580', {
    getBodyText: () => bodyText,
    setTimeout(fn, ms) {
      delays.push(ms);
      if (ms >= 1000 && !rebidConfirmButton.clicked) sawRebidDelay = true;
      fn();
      return 1;
    },
    querySelector(selector) {
      return selector === 'input[name="bid"]' ? priceInput : null;
    },
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === '[role="dialog"], [aria-modal="true"], .ReactModal__Content, [class*="modal" i], [class*="dialog" i]') return [rebidDialog];
      if (selector.includes('button') || selector.includes('a') || selector.includes('input')) return [rebidConfirmButton];
      if (selector === 'body *') return [rebidConfirmButton];
      return [];
    }
  });

  const result = await api.executeBidV3(19800, {
    maxPrice: 19800,
    userMaxPrice: 21780,
    strategy: 'multi_bid',
    taxType: 'tax_included',
    multiBidIncrement: 250
  });

  assert.equal(result.success, true);
  assert.equal(rebidConfirmButton.clicked, true);
  assert.ok(delays.some(ms => ms >= 1000));
}

async function testMultiBidRebidRequiredFallsBackToDefaultInputPriceWhenCurrentMissing() {
  async function runScenario(defaultInputValue, increment, maxPrice, userMaxPrice, expectedBidPrice) {
    let bodyText = '\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059 \u5165\u672d\u3059\u308b';
    const priceInput = createTestElement('');
    priceInput.name = 'bid';
    priceInput.value = String(defaultInputValue);
    const rebidConfirmButton = createTestElement('\u5165\u672d\u3059\u308b');
    rebidConfirmButton.getAttribute = name => {
      if (name === 'data-cl-params') return '_cl_vmodule:rebid;_cl_link:cnfbtn;_cl_position:1';
      if (name === 'aria-label') return '';
      return '';
    };
    const rebidDialog = createTestElement('\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059');
    rebidDialog.querySelectorAll = () => [];
    rebidConfirmButton.click = () => {
      rebidConfirmButton.clicked = true;
      bodyText = '\u5165\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f';
    };

    const api = loadContentForTest(bodyText, '/jp/auction/v1233335580', {
      getBodyText: () => bodyText,
      querySelector(selector) {
        return selector === 'input[name="bid"]' ? priceInput : null;
      },
      querySelectorAll(selector) {
        if (selector === 'script') return [];
        if (selector === '[role="dialog"], [aria-modal="true"], .ReactModal__Content, [class*="modal" i], [class*="dialog" i]') return [rebidDialog];
        if (selector.includes('button') || selector.includes('a') || selector.includes('input')) return [rebidConfirmButton];
        if (selector === 'body *') return [rebidConfirmButton];
        return [];
      }
    });

    const result = await api.executeBidV3(maxPrice, {
      maxPrice,
      userMaxPrice,
      strategy: 'multi_bid',
      taxType: 'tax_included',
      multiBidIncrement: increment
    });

    assert.equal(result.success, true);
    assert.equal(rebidConfirmButton.clicked, true);
    assert.equal(priceInput.value, String(expectedBidPrice));
  }

  await runScenario(1700, 250, 4000, 4400, 1850);
  await runScenario(5500, 250, 6000, 6600, 5500);
  await runScenario(7000, 500, 9000, 9900, 7250);
}

async function testMultiBidRebidRequiredPrefersDefaultInputPriceOverVisibleCurrent() {
  let bodyText = '\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059 \u73fe\u5728 2,200\u5186\uff08\u7a0e\u8fbc\uff09 1,700\u5186\u304b\u3089\u5165\u672d\u3067\u304d\u307e\u3059 \u5165\u672d\u3059\u308b';
  const priceInput = createTestElement('');
  priceInput.name = 'bid';
  priceInput.value = '1700';
  const currentPrice = createTestElement('2,200\u5186\uff08\u7a0e\u8fbc\uff09');
  const rebidConfirmButton = createTestElement('\u5165\u672d\u3059\u308b');
  rebidConfirmButton.getAttribute = name => {
    if (name === 'data-cl-params') return '_cl_vmodule:rebid;_cl_link:cnfbtn;_cl_position:1';
    if (name === 'aria-label') return '';
    return '';
  };
  const rebidDialog = createTestElement('\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059');
  rebidDialog.querySelectorAll = () => [];
  rebidConfirmButton.click = () => {
    rebidConfirmButton.clicked = true;
    bodyText = '\u5165\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f';
  };

  const api = loadContentForTest(bodyText, '/jp/auction/v1233335580', {
    getBodyText: () => bodyText,
    querySelector(selector) {
      if (selector === '[class*="currentPrice"]') return currentPrice;
      return selector === 'input[name="bid"]' ? priceInput : null;
    },
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === '[role="dialog"], [aria-modal="true"], .ReactModal__Content, [class*="modal" i], [class*="dialog" i]') return [rebidDialog];
      if (selector.includes('button') || selector.includes('a') || selector.includes('input')) return [rebidConfirmButton];
      if (selector === 'body *') return [rebidConfirmButton];
      return [];
    }
  });

  const result = await api.executeBidV3(4000, {
    maxPrice: 4000,
    userMaxPrice: 4400,
    strategy: 'multi_bid',
    taxType: 'tax_included',
    multiBidIncrement: 250
  });

  assert.equal(result.success, true);
  assert.equal(rebidConfirmButton.clicked, true);
  assert.equal(priceInput.value, '1850');
}

async function testMultiBidUsesTaxExcludedLatestPagePriceNotInputDefault() {
  async function runScenario(displayCurrentText, defaultInputValue, expectedBidPrice) {
    let bodyText = `\u73fe\u5728 ${displayCurrentText} \u5165\u672d \u5165\u672d\u984d \u7a0e\u8fbc\u5408\u8a08\u91d1\u984d 55\u5186 \u78ba\u8a8d\u3059\u308b`;
    const priceInput = createTestElement('');
    priceInput.name = 'bid';
    priceInput.value = String(defaultInputValue);
    const confirmButton = createTestElement('\u78ba\u8a8d\u3059\u308b');
    confirmButton.click = () => {
      confirmButton.clicked = true;
      bodyText = '\u5165\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f';
    };
    const currentPrice = createTestElement(displayCurrentText);

    const api = loadContentForTest(bodyText, '/jp/auction/g1233324435/bid', {
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

    const result = await api.executeBidV3(3000, {
      maxPrice: 3000,
      userMaxPrice: 3300,
      strategy: 'multi_bid',
      taxType: 'tax_included',
      multiBidIncrement: 250
    });

    assert.equal(result.success, true);
    assert.equal(confirmButton.clicked, true);
    assert.equal(priceInput.value, String(expectedBidPrice));
  }

  await runScenario('44\u5186\uff08\u7a0e\u8fbc\uff09', 50, 290);
  await runScenario('330\u5186\uff08\u7a0e\u8fbc\uff09', 50, 550);
}

async function testMultiBidPrefersYahooScriptTaxExcludedPrice() {
  let bodyText = '\u73fe\u5728 330\u5186\uff08\u7a0e\u8fbc\uff09 \u5165\u672d \u5165\u672d\u984d \u7a0e\u8fbc\u5408\u8a08\u91d1\u984d 55\u5186 \u78ba\u8a8d\u3059\u308b';
  const priceInput = createTestElement('');
  priceInput.name = 'bid';
  priceInput.value = '50';
  const confirmButton = createTestElement('\u78ba\u8a8d\u3059\u308b');
  confirmButton.click = () => {
    confirmButton.clicked = true;
    bodyText = '\u5165\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f';
  };
  const currentPrice = createTestElement('999\u5186\uff08\u7a0e\u8fbc\uff09');
  const pageDataScript = {
    textContent: 'var pageData = {"items":{"price":"300"}};',
    type: 'text/javascript'
  };

  const api = loadContentForTest(bodyText, '/jp/auction/j1233320198/bid', {
    getBodyText: () => bodyText,
    querySelector(selector) {
      if (selector === '[class*="currentPrice"]') return currentPrice;
      return selector === 'input[name="bid"]' ? priceInput : null;
    },
    querySelectorAll(selector) {
      if (selector === 'script') return [pageDataScript];
      if (selector.includes('button')) return [confirmButton];
      if (selector === 'body *') return [confirmButton];
      return [];
    }
  });

  const result = await api.executeBidV3(3000, {
    maxPrice: 3000,
    userMaxPrice: 3300,
    strategy: 'multi_bid',
    taxType: 'tax_included',
    multiBidIncrement: 250
  });

  assert.equal(result.success, true);
  assert.equal(confirmButton.clicked, true);
  assert.equal(priceInput.value, '550');
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
  assert.equal(Object.prototype.hasOwnProperty.call(orders[0], 'shippingFeeText'), false);
}

function testOrderHistoryExtractsTransactionUrl() {
  const orderContainer = createOrderContainer(
    '出品者に連絡してください 25円 6/1 05:08 商品ID：c1133337781',
    'NMB48 山岸奈津美 らしくない 通常版 封入特典 生写真',
    'https://auctions.yahoo.co.jp/jp/auction/c1133337781',
    ['25円'],
    [{ text: '取引連絡', href: 'https://contact.auctions.yahoo.co.jp/seller/top?aid=c1133337781' }]
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
  assert.equal(orders[0].productId, 'c1133337781');
  assert.equal(orders[0].transactionUrl, 'https://contact.auctions.yahoo.co.jp/seller/top?aid=c1133337781');
}

function testOrderHistoryIgnoresAuctionLinksWithoutTransactionContact() {
  const relatedItem = createOrderContainer(
    'recently won recommendation 5,000円 商品ID：v1231866422',
    'related recommendation item',
    'https://auctions.yahoo.co.jp/jp/auction/v1231866422',
    ['5,000円'],
    []
  );
  const api = loadContentForTest('', '/my/won', {
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === 'li, article, tr, div') return [relatedItem];
      return [];
    }
  });

  const orders = api.extractOrderHistory();

  assert.equal(orders.length, 0);
}

function testOrderHistoryExtractsUnlabeledWonPriceLine() {
  const orderContainer = createOrderContainer(
    '支払いを完了してください\nMD ゴールデンアックス\n2,530円\nストア\n5/23 22:26\n商品ID：x1230699905',
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
  assert.equal(orders[0].wonTimeText, '5/23 22:26');
}

function testOrderHistoryExtractsFirstYenAmountWhenTextIsFlattened() {
  const orderContainer = createOrderContainer(
    '支払いを完了してください MD ゴールデンアックス 2,530円 ストア 5/23 22:26 商品ID：x1230699905',
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
  assert.equal(orders[0].wonTimeText, '5/23 22:26');
}

function testOrderHistoryUsesPriceElementWhenTextContentMergesTitleCodeWithPrice() {
  // 真实 DOM：标题"...F26171"（独立 <p>）和价格"23,100円"（独立 <span>）相邻但分两个元素。
  // textContent 拼接 → "...F2617123,100円"，正则会错抓 2,617,123,100。
  // 修复：从容器内查找单独的"价格元素"（textContent 干净就是 23,100円）。
  const orderContainer = createOrderContainer(
    '商品が発送されました唐筆 【超品玉蘭蕊】5本 善連 双羊牌 羊毫筆 手彫り 牛骨 書道用筆 古い筆 F2617123,100円未使用ストア5/24 20:26商品ID：l1230196918',
    '唐筆 【超品玉蘭蕊】5本 善連 双羊牌 羊毫筆 手彫り 牛骨 書道用筆 古い筆 F26171',
    'https://auctions.yahoo.co.jp/jp/auction/l1230196918',
    ['23,100円']
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
  assert.equal(orders[0].productId, 'l1230196918');
  assert.equal(orders[0].price, '23,100');
}

function testOrderHistoryPriceElementAcceptsRealYenCharacter() {
  const orderContainer = createOrderContainer(
    '商品が発送されました 【美品】 バーグファベル 管理K261716,600円ストア6/15 22:08 商品ID：k1230268385',
    '【美品】 バーグファベル 管理K26171',
    'https://auctions.yahoo.co.jp/jp/auction/k1230268385',
    ['6,600円']
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
  assert.equal(orders[0].productId, 'k1230268385');
  assert.equal(orders[0].price, '6,600');
}

function testOrderHistoryFallbackTreatsCommaSeparatedNumberAsPrice() {
  // 没有独立价格元素时，兜底正则要求"千位逗号格式"或纯短数字，避免吃到 F2617123,100 这种粘连。
  const orderContainer = createOrderContainer(
    '空箱 SONY WM-DX100 カセットプレーヤー 元箱 本体無し 空き箱 説明書等有り 中古 現状品 管理ZI-80 31,500円 5/24 20:18 商品ID：k1230839207',
    '空箱 SONY WM-DX100 カセットプレーヤー 元箱 本体無し 空き箱 説明書等有り 中古 現状品 管理ZI-80',
    'https://auctions.yahoo.co.jp/jp/auction/k1230839207'
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
  assert.equal(orders[0].productId, 'k1230839207');
  assert.equal(orders[0].price, '31,500');
}

function testWonHistoryNextPageUsesSharedVisibleTextNormalizer() {
  const nextLink = createTestAnchor('next', 'https://auctions.yahoo.co.jp/my/won?page=2');
  nextLink.getAttribute = name => {
    if (name === 'rel') return 'next';
    if (name === 'href') return nextLink.href;
    if (name === 'aria-label') return '';
    return '';
  };
  const api = loadContentForTest('', '/my/won', {
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === 'a[href]') return [nextLink];
      return [];
    }
  });

  assert.equal(api.findWonHistoryNextPageUrl(), 'https://auctions.yahoo.co.jp/my/won?page=2');
}

function testBiddingItemsExtractsOutbidRebidRows() {
  const { container, link } = createBiddingContainer(
    '高値更新 再入札する 現在 1,500円 MD ゴールデンアックス',
    'MD ゴールデンアックス',
    'https://auctions.yahoo.co.jp/jp/auction/x1230699905',
    'https://example.com/item.jpg'
  );
  const api = loadContentForTest('', '/my/bidding', {
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === 'a[href*="/jp/auction/"]') return [link];
      return [];
    }
  });

  const items = api.extractBiddingItems();

  assert.equal(items.length, 1);
  assert.equal(items[0].productId, 'x1230699905');
  assert.equal(items[0].status, 'outbid');
  assert.equal(items[0].price, '1500');
  assert.equal(items[0].imageUrl, 'https://example.com/item.jpg');
}

function testBundleTransactionInfoValidatesQuantity() {
  const links = [
    createTestAnchor('商品A', 'https://auctions.yahoo.co.jp/jp/auction/c1133337781'),
    createTestAnchor('商品B', 'https://auctions.yahoo.co.jp/jp/auction/o1133346083')
  ];
  const api = loadContentForTest('まとめて取引を依頼できる商品 2件（落札数量：2）', '/seller/top', {
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === 'a[href*="/jp/auction/"]') return links;
      return [];
    }
  });

  const info = api.extractBundleTransactionInfo();

  assert.equal(info.available, true);
  assert.equal(info.expectedCount, 2);
  assert.equal(JSON.stringify(info.productIds), JSON.stringify(['c1133337781', 'o1133346083']));
  assert.equal(info.quantityMatched, true);
}

function testBundleTransactionInfoDetectsQuantityMismatch() {
  const links = [
    createTestAnchor('商品A', 'https://auctions.yahoo.co.jp/jp/auction/c1133337781'),
    createTestAnchor('商品B', 'https://auctions.yahoo.co.jp/jp/auction/o1133346083')
  ];
  const api = loadContentForTest('まとめて取引を依頼できる商品 3件（落札数量：3）', '/seller/top', {
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === 'a[href*="/jp/auction/"]') return links;
      return [];
    }
  });

  const info = api.extractBundleTransactionInfo();

  assert.equal(info.expectedCount, 3);
  assert.equal(info.quantityMatched, false);
}

function testBundleTransactionInfoDetectsPopupBundleText() {
  const links = [
    createTestAnchor('商品A', 'https://auctions.yahoo.co.jp/jp/auction/m1114324624'),
    createTestAnchor('商品B', 'https://auctions.yahoo.co.jp/jp/auction/o1133346083'),
    createTestAnchor('商品C', 'https://auctions.yahoo.co.jp/jp/auction/c1133337781')
  ];
  const bodyText = '\u3053\u306e\u5546\u54c1\u306f\u3001\u307e\u3068\u3081\u3066\u53d6\u5f15\u304c\u3067\u304d\u307e\u3059\u3002 3\u4ef6\uff08\u843d\u672d\u6570\u91cf\uff1a3\uff09';
  const api = loadContentForTest(bodyText, '/seller/top', {
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === 'a[href*="/jp/auction/"]') return links;
      return [];
    }
  });

  const info = api.extractBundleTransactionInfo();

  assert.equal(info.available, true);
  assert.equal(info.expectedCount, 3);
  assert.equal(info.quantityMatched, true);
}

function testDetectBundleRequestedComplete() {
  const api = loadContentForTest('まとめて取引を依頼中です。 出品者からの連絡をお待ちください。', '/seller/top');

  assert.equal(api.detectBundleRequestedComplete(), true);
}

function testTransactionPageYahooIdTextDoesNotMeanLoggedOut() {
  const api = loadContentForTest('Yahoo! JAPAN ID ????? ????', '/seller/top?aid=u1231519486');

  assert.equal(api.detectYahooLoginStatus().status, 'ok');
}

function testLoginUrlStillMeansLoggedOut() {
  const api = loadContentForTest('Yahoo! JAPAN ID ??????????', '/login', {
    href: 'https://login.yahoo.co.jp/config/login'
  });

  assert.equal(api.detectYahooLoginStatus().status, 'failed');
}

async function testProductPageLoginHintDoesNotShortCircuitBidExecution() {
  const api = loadContentForTest(
    '\u5546\u54c1\u60c5\u5831 \u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981\u306a\u6a5f\u80fd\u304c\u3042\u308a\u307e\u3059',
    '/jp/auction/f1232542390'
  );

  const result = await api.executeBidV3(9600, { currentPrice: 9341, userMaxPrice: 10560, taxType: 'tax_included' });

  assert.equal(result.success, false);
  assert.notEqual(result.error, '\u9700\u8981\u767b\u5f55 Yahoo');
  assert.equal(result.error, 'bid button not found');
}

function testClickTransactionContactForProduct() {
  const contact = createTestAnchor('取引連絡', 'https://contact.auctions.yahoo.co.jp/seller/top?aid=m1114324624');
  const auction = createTestAnchor('商品', 'https://auctions.yahoo.co.jp/jp/auction/m1114324624');
  const container = {
    textContent: '商品ID：m1114324624',
    querySelectorAll(selector) {
      if (selector === 'a[href*="/jp/auction/"]') return [auction];
      if (selector === 'a, button, input[type="button"], input[type="submit"]') return [contact];
      return [];
    }
  };
  const api = loadContentForTest('', '/my/won', {
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === 'li, article, tr, div') return [container];
      return [];
    }
  });

  const result = api.clickTransactionContactForProduct('m1114324624');

  assert.equal(result.success, true);
  assert.equal(result.href, 'https://contact.auctions.yahoo.co.jp/seller/top?aid=m1114324624');
  assert.equal(contact.clicked, false);
}

function testClickBundleTransactionActionFindsRequestButton() {
  const requestButton = createTestElement('\u307e\u3068\u3081\u3066\u53d6\u5f15\u3092\u4f9d\u983c\u3059\u308b');
  requestButton.tagName = 'BUTTON';
  const api = loadContentForTest('', '/seller/top', {
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === 'button, a, input[type="button"], input[type="submit"]') return [requestButton];
      if (selector === '*') return [requestButton];
      return [];
    }
  });

  const result = api.clickBundleTransactionAction('start');

  assert.equal(result.success, true);
}

function testClickBundleTransactionActionIgnoresInstructionText() {
  const heading = createTestElement('\u307e\u3068\u3081\u3066\u53d6\u5f15\u3092\u4f9d\u983c\u3059\u308b\u305f\u3081\u306b\u3001\u5546\u54c1\u3092\u53d7\u3051\u53d6\u308b\u90fd\u9053\u5e9c\u770c\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044');
  heading.tagName = 'DIV';
  const requestButton = createTestElement('\u307e\u3068\u3081\u3066\u53d6\u5f15\u3092\u4f9d\u983c\u3059\u308b');
  requestButton.tagName = 'BUTTON';
  const api = loadContentForTest('', '/seller/top', {
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === 'button, a, input[type="button"], input[type="submit"]') return [requestButton];
      if (selector === '*') return [heading, requestButton];
      return [];
    }
  });

  const result = api.clickBundleTransactionAction('start');

  assert.equal(result.success, true);
  assert.equal(requestButton.clicked, true);
}

function testClickBundleTransactionActionFindsInputRoleButtonParent() {
  const roleButton = createTestElement('');
  roleButton.tagName = 'DIV';
  roleButton.getAttribute = name => name === 'role' ? 'button' : '';
  roleButton.hasAttribute = name => name === 'role';
  const label = createTestElement('\u53d6\u5f15\u60c5\u5831\u3092\u5165\u529b\u3059\u308b');
  label.tagName = 'SPAN';
  label.closest = selector => selector.includes('[role="button"]') ? roleButton : null;
  const api = loadContentForTest('', '/buyer/top', {
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === 'button, a, input[type="button"], input[type="submit"], [role="button"], [onclick], [tabindex], [data-cl-params]') return [roleButton];
      if (selector === '*') return [label, roleButton];
      return [];
    }
  });

  const state = api.getBundleTransactionActionState();
  const result = api.clickBundleTransactionAction('input');

  assert.equal(state.canInputTransaction, true);
  assert.equal(result.success, true);
  assert.equal(roleButton.clicked, true);
}

function testBundleTransactionActionStateDetectsDecideButton() {
  const decideButton = createTestElement('\u6c7a\u5b9a\u3059\u308b');
  decideButton.tagName = 'BUTTON';
  const api = loadContentForTest('', '/seller/confirm', {
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === 'button, a, input[type="button"], input[type="submit"]') return [decideButton];
      if (selector === '*') return [decideButton];
      return [];
    }
  });

  const state = api.getBundleTransactionActionState();

  assert.equal(state.canDecide, true);
  assert.equal(state.complete, false);
}

function testBundleTransactionActionStateDetectsReviewButtonAsDecide() {
  const reviewButton = createTestElement('\u78ba\u8a8d\u3059\u308b');
  reviewButton.tagName = 'BUTTON';
  const api = loadContentForTest('', '/buyer/input', {
    querySelectorAll(selector) {
      if (selector === 'script') return [];
      if (selector === 'button, a, input[type="button"], input[type="submit"]') return [reviewButton];
      if (selector === '*') return [reviewButton];
      return [];
    }
  });

  const state = api.getBundleTransactionActionState();
  const clickResult = api.clickBundleTransactionAction('decide');

  assert.equal(state.canDecide, true);
  assert.equal(clickResult.success, true);
  assert.equal(reviewButton.clicked, true);
}

function testBundleTransactionActionStateDetectsPlacementOkModal() {
  const okButton = createTestElement('OK');
  okButton.tagName = 'BUTTON';
  const api = loadContentForTest(
    '\u7f6e\u304d\u914d\u5834\u6240\uff08\u7384\u95a2\u524d\uff09\u304c\u521d\u671f\u8a2d\u5b9a\u3055\u308c\u307e\u3057\u305f',
    '/buyer/edit',
    {
      querySelectorAll(selector) {
        if (selector === 'script') return [];
        if (selector === 'button, a, input[type="button"], input[type="submit"], [role="button"], [onclick], [tabindex], [data-cl-params]') return [okButton];
        if (selector === '*') return [okButton];
        return [];
      }
    }
  );

  const state = api.getBundleTransactionActionState();
  const clickResult = api.clickBundleTransactionAction('placementOk');

  assert.equal(state.canPlacementOk, true);
  assert.equal(clickResult.success, true);
  assert.equal(okButton.clicked, true);
}

function testBundleTransactionActionStateDetectsWaitingShippingPaymentAmount() {
  const api = loadContentForTest('\u304a\u652f\u6255\u3044\u60c5\u5831 \u652f\u6255\u3044\u91d1\u984d \uff1a \u9001\u6599\u6c7a\u5b9a\u5f8c\u3001\u78ba\u5b9a\u3057\u307e\u3059\u3002', '/seller/top');
  const state = api.getBundleTransactionActionState();

  assert.equal(api.detectWaitingShippingPaymentAmount(), true);
  assert.equal(state.waitingShipping, true);
}

function testBundleTransactionActionStateDetectsPaymentReadyPage() {
  const paymentButton = createTestElement('Yahoo!\u304b\u3093\u305f\u3093\u6c7a\u6e08\u3067\u652f\u6255\u3046');
  paymentButton.tagName = 'A';
  const api = loadContentForTest(
    '\u51fa\u54c1\u8005\u306b\u53d6\u5f15\u60c5\u5831\u306e\u9023\u7d61\u3092\u3057\u307e\u3057\u305f\u3002\u5f15\u304d\u7d9a\u304d\u3001\u652f\u6255\u3044\u3092\u884c\u3063\u3066\u304f\u3060\u3055\u3044\u3002',
    '/buyer/top',
    {
      querySelectorAll(selector) {
        if (selector === 'script') return [];
        if (selector === 'button, a, input[type="button"], input[type="submit"], [role="button"], [onclick], [tabindex], [data-cl-params]') return [paymentButton];
        if (selector === '*') return [paymentButton];
        return [];
      }
    }
  );

  const state = api.getBundleTransactionActionState();

  assert.equal(state.paymentReady, true);
}

function testBundleTransactionActionStateDetectsBuyerDeletedCancellation() {
  const api = loadContentForTest(
    '\u843d\u672d\u8005\u524a\u9664\u3055\u308c\u305f\u305f\u3081\u3001\u53d6\u5f15\u306f\u3067\u304d\u307e\u305b\u3093\u3002 \u904e\u53bb\u306e\u53d6\u5f15\u30e1\u30c3\u30bb\u30fc\u30b8\u306e\u95b2\u89a7\u306e\u307f\u53ef\u80fd\u3067\u3059\u3002',
    '/buyer/top'
  );
  const state = api.getBundleTransactionActionState();

  assert.equal(state.cancelled, true);
}

function testExtractWaitingShippingScanResultFindsShippingFee() {
  const api = loadContentForTest(
    '\u304a\u652f\u6255\u3044\u60c5\u5831 \u652f\u6255\u3044\u91d1\u984d \uff1a 2,560\u5186\uff08\u843d\u672d\u4fa1\u683c\uff1a1,500\u5186 \u6570\u91cf\uff1a1\u500b \u9001\u6599\uff1a1,060\u5186\uff09 \u652f\u6255\u3044\u671f\u9650',
    '/seller/top'
  );
  const result = api.extractWaitingShippingScanResult();

  assert.equal(result.hasShippingFee, true);
  assert.equal(result.shippingFeeText, '1060\u5186');
  assert.equal(result.pending, false);
}

function testExtractWaitingShippingScanResultDoesNotUseTotalPayment() {
  const api = loadContentForTest(
    '\u652f\u6255\u3044\u91d1\u984d \uff1a 2,560\u5186\uff08\u843d\u672d\u4fa1\u683c\uff1a1,500\u5186 \u6570\u91cf\uff1a1\u500b \u9001\u6599\uff1a1,060\u5186\uff09',
    '/seller/top'
  );

  assert.notEqual(api.extractWaitingShippingScanResult().shippingFeeText, '2560\u5186');
}

function testExtractWaitingShippingScanResultDetectsPendingShipping() {
  const api = loadContentForTest(
    '\u304a\u652f\u6255\u3044\u60c5\u5831 \u652f\u6255\u3044\u91d1\u984d \uff1a \u9001\u6599\u6c7a\u5b9a\u5f8c\u3001\u78ba\u5b9a\u3057\u307e\u3059\u3002 \u652f\u6255\u3044\u671f\u9650',
    '/seller/top'
  );
  const result = api.extractWaitingShippingScanResult();

  assert.equal(result.hasShippingFee, false);
  assert.equal(result.shippingFeeText, '');
  assert.equal(result.pending, true);
}

function testExtractWaitingShippingScanResultPendingBeatsOtherShippingText() {
  const api = loadContentForTest(
    '\u5546\u54c1\u540d \u9001\u6599\uff1a1,060\u5186 \u304a\u652f\u6255\u3044\u60c5\u5831 \u652f\u6255\u3044\u91d1\u984d \uff1a \u9001\u6599\u6c7a\u5b9a\u5f8c\u3001\u78ba\u5b9a\u3057\u307e\u3059\u3002 \u652f\u6255\u3044\u671f\u9650',
    '/seller/top'
  );
  const result = api.extractWaitingShippingScanResult();

  assert.equal(result.hasShippingFee, false);
  assert.equal(result.shippingFeeText, '');
  assert.equal(result.pending, true);
}

function testExtractBundleScanResultDetectsWaitingForSellerAgreement() {
  const api = loadContentForTest('\u307e\u3068\u3081\u3066\u53d6\u5f15\u3092\u4f9d\u983c\u4e2d\u3067\u3059\u3002\u51fa\u54c1\u8005\u304b\u3089\u306e\u9023\u7d61\u3092\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002', '/seller/top');
  const result = api.extractBundleScanResult();

  assert.equal(result.type, 'waiting_agreement');
}

function testExtractBundleScanResultDetectsChildAgreementPopup() {
  const api = loadContentForTest('\u51fa\u54c1\u8005\u304c\u3001\u3053\u306e\u5546\u54c1\u3092\u542b\u3081\u305f\u307e\u3068\u3081\u3066\u53d6\u5f15\u306b\u540c\u610f\u3057\u307e\u3057\u305f\u3002 \u53d6\u5f15\u5185\u5bb9\u3092\u3054\u78ba\u8a8d\u304f\u3060\u3055\u3044\u3002', '/seller/top');
  const result = api.extractBundleScanResult();

  assert.equal(result.type, 'child_agreed');
}

function testExtractBundleScanResultDetectsMainAgreementPopup() {
  const api = loadContentForTest('\u51fa\u54c1\u8005\u304c\u307e\u3068\u3081\u3066\u53d6\u5f15\u306b\u540c\u610f\u3057\u307e\u3057\u305f\u3002\u51fa\u54c1\u8005\u304b\u3089\u914d\u9001\u65b9\u6cd5\u306e\u9023\u7d61\u304c\u5c4a\u3044\u3066\u3044\u307e\u3059\u3002\u78ba\u8a8d\u3057\u53d6\u5f15\u60c5\u5831\u306e\u5165\u529b\u3078\u9032\u3093\u3067\u304f\u3060\u3055\u3044\u3002', '/seller/top');
  const result = api.extractBundleScanResult();

  assert.equal(result.type, 'main_agreed');
}

function testExtractBundleScanResultPrefersInputRequiredWhenInputLinkExists() {
  const inputLink = createTestElement('\u53d6\u5f15\u60c5\u5831\u3092\u5165\u529b\u3059\u308b');
  inputLink.tagName = 'A';
  inputLink.href = '/buyer/edit?aid=s1113817953';
  const api = loadContentForTest(
    '\u51fa\u54c1\u8005\u304c\u307e\u3068\u3081\u3066\u53d6\u5f15\u306b\u540c\u610f\u3057\u307e\u3057\u305f\u3002\u51fa\u54c1\u8005\u304b\u3089\u914d\u9001\u65b9\u6cd5\u306e\u9023\u7d61\u304c\u5c4a\u3044\u3066\u3044\u307e\u3059\u3002',
    '/seller/top',
    {
      querySelectorAll(selector) {
        if (selector === 'script') return [];
        if (selector === 'button, a, input[type="button"], input[type="submit"], [role="button"], [onclick], [tabindex], [data-cl-params]') return [inputLink];
        if (selector === '*') return [inputLink];
        return [];
      }
    }
  );
  const result = api.extractBundleScanResult();

  assert.equal(result.type, 'input_required');
}

function testExtractBundleScanResultDetectsInputRequiredPage() {
  const api = loadContentForTest('\u51fa\u54c1\u8005\u304c\u307e\u3068\u3081\u3066\u53d6\u5f15\u306b\u540c\u610f\u3057\u307e\u3057\u305f\u3002\u914d\u9001\u65b9\u6cd5\u3092\u78ba\u8a8d\u3057\u53d6\u5f15\u60c5\u5831\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\u3002', '/seller/top');
  const result = api.extractBundleScanResult();

  assert.equal(result.type, 'input_required');
}

function testExtractBundleScanResultExtractsDeliveryMethodShippingFee() {
  const api = loadContentForTest('\u307e\u3068\u3081\u3066\u53d6\u5f15\u306e\u914d\u9001\u65b9\u6cd5 \u914d\u9001\u65b9\u6cd5 \uff1a \u5b9a\u5f62\u90f5\u4fbf \uff08110\u5186\uff09', '/seller/top');
  const result = api.extractBundleScanResult();

  assert.equal(result.type, 'shipping_ready');
  assert.equal(result.bundleShippingFeeText, '110\u5186');
}

function testExtractBundleScanResultExtractsPaymentShippingFee() {
  const api = loadContentForTest('\u304a\u652f\u6255\u3044\u60c5\u5831 \u652f\u6255\u3044\u91d1\u984d\uff1a87,620\u5186\uff08\u843d\u672d\u4fa1\u683c\uff1a86,000\u5186 \u6570\u91cf\uff1a1\u500b \u9001\u6599\uff1a1,620\u5186\uff09', '/seller/top');
  const result = api.extractBundleScanResult();

  assert.equal(result.type, 'shipping_ready');
  assert.equal(result.bundleShippingFeeText, '1620\u5186');
}

function testExtractBundleScanResultKeepsSellerPaidPaymentShippingText() {
  const api = loadContentForTest('\u304a\u652f\u6255\u3044\u60c5\u5831 \u652f\u6255\u3044\u91d1\u984d \uff1a 2,800\u5186\uff08\u843d\u672d\u5408\u8a08\u91d1\u984d\uff1a2,800\u5186 \u9001\u6599\uff1a\u51fa\u54c1\u8005\u8ca0\u62c5\uff09 Yahoo!\u304b\u3093\u305f\u3093\u6c7a\u6e08\u3067\u652f\u6255\u3046', '/seller/top');
  const result = api.extractBundleScanResult();

  assert.equal(result.type, 'shipping_ready');
  assert.equal(result.bundleShippingFeeText, '\u51fa\u54c1\u8005\u8ca0\u62c5');
}

function testExtractBundleScanResultKeepsFreePaymentShippingText() {
  const api = loadContentForTest('\u304a\u652f\u6255\u3044\u60c5\u5831 \u652f\u6255\u3044\u91d1\u984d \uff1a 2,800\u5186\uff08\u843d\u672d\u5408\u8a08\u91d1\u984d\uff1a2,800\u5186 \u9001\u6599\uff1a\u7121\u6599\uff09 Yahoo!\u304b\u3093\u305f\u3093\u6c7a\u6e08\u3067\u652f\u6255\u3046', '/seller/top');
  const result = api.extractBundleScanResult();

  assert.equal(result.type, 'shipping_ready');
  assert.equal(result.bundleShippingFeeText, '\u7121\u6599');
}

function testExtractBundleScanResultKeepsCodPaymentShippingText() {
  const api = loadContentForTest('\u304a\u652f\u6255\u3044\u60c5\u5831 \u652f\u6255\u3044\u91d1\u984d \uff1a 2,800\u5186\uff08\u843d\u672d\u5408\u8a08\u91d1\u984d\uff1a2,800\u5186 \u9001\u6599\uff1a\u7740\u6255\u3044\uff09 Yahoo!\u304b\u3093\u305f\u3093\u6c7a\u6e08\u3067\u652f\u6255\u3046', '/seller/top');
  const result = api.extractBundleScanResult();

  assert.equal(result.type, 'shipping_ready');
  assert.equal(result.bundleShippingFeeText, '\u7740\u6255\u3044');
}

function testExtractBundleScanResultDetectsBundleRejected() {
  const api = loadContentForTest('\u53d6\u5f15\u5185\u5bb9\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002 \u51fa\u54c1\u8005\u304c\u5358\u54c1\u3067\u306e\u53d6\u5f15\u3092\u5e0c\u671b\u3057\u305f\u305f\u3081\u3001\u5546\u54c1\u3054\u3068\u306b\u53d6\u5f15\u3092\u884c\u3063\u3066\u304f\u3060\u3055\u3044\u3002', '/seller/top');
  const result = api.extractBundleScanResult();

  assert.equal(result.type, 'bundle_rejected');
}

function testExtractPendingShipmentScanResultDetectsStorePending() {
  const api = loadContentForTest('\u3054\u8cfc\u5165\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3059\u3002\u5546\u54c1\u306e\u767a\u9001\u9023\u7d61\u3092\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002');
  assert.equal(api.extractPendingShipmentScanResult().type, 'pending_shipment');
}

function testExtractPendingShipmentScanResultDetectsNormalPending() {
  const api = loadContentForTest('\u51fa\u54c1\u8005\u306b\u652f\u6255\u3044\u5b8c\u4e86\u306e\u9023\u7d61\u3092\u3057\u307e\u3057\u305f\u3002\u5546\u54c1\u306e\u767a\u9001\u9023\u7d61\u3092\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002');
  assert.equal(api.extractPendingShipmentScanResult().type, 'pending_shipment');
}

function testExtractPendingShipmentScanResultDetectsStoreShipped() {
  const api = loadContentForTest('\u51fa\u54c1\u8005\uff1a LOLOMA\uff089986\uff09\n\u5546\u54c1\u304c\u767a\u9001\u3055\u308c\u307e\u3057\u305f\u3002\u5230\u7740\u307e\u3067\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002\n\u914d\u9001\u696d\u8005\uff1a \u65e5\u672c\u90f5\u4fbf\n\u4f1d\u7968\u756a\u53f7\uff1a 628620458093');
  const result = api.extractPendingShipmentScanResult();
  assert.equal(result.type, 'shipped');
  assert.equal(result.shippingCompany, '\u65e5\u672c\u90f5\u4fbf');
  assert.equal(result.trackingNumber, '628620458093');
}

function testExtractPendingShipmentScanResultExtractsStoreShipmentTableFields() {
  const api = loadContentForTest(
    '\u5546\u54c1\u304c\u767a\u9001\u3055\u308c\u307e\u3057\u305f\u3002\u5230\u7740\u307e\u3067\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002',
    '/order/status',
    {
      querySelectorAll(selector) {
        if (selector !== 'tr, dl, div, li, p') return [];
        return [
          { textContent: '\u914d\u9001\u696d\u8005 \uff1a \u65e5\u672c\u90f5\u4fbf' },
          { textContent: '\u914d\u9001\u5e0c\u671b\u65e5 \uff1a \u6307\u5b9a\u306a\u3057' },
          { textContent: '\u4f1d\u7968\u756a\u53f7 \uff1a 628620458093' }
        ];
      }
    }
  );
  const result = api.extractPendingShipmentScanResult();
  assert.equal(result.type, 'shipped');
  assert.equal(result.shippingCompany, '\u65e5\u672c\u90f5\u4fbf');
  assert.equal(result.trackingNumber, '628620458093');
}

function testExtractPendingShipmentScanResultExtractsSagawaStoreShipmentFromTradeInfo() {
  const api = loadContentForTest(
    [
      '\u5546\u54c1\u304c\u767a\u9001\u3055\u308c\u307e\u3057\u305f\u3002',
      '\u5230\u7740\u307e\u3067\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002',
      '\u30b9\u30c8\u30a2\u304b\u3089\u8cfc\u5165\u3057\u305f\u5546\u54c1\u306f\u53d7\u53d6\u9023\u7d61\u306f\u5fc5\u8981\u3042\u308a\u307e\u305b\u3093\u3002',
      '\u53d6\u5f15\u60c5\u5831',
      '\u8cfc\u5165\u65e5\u6642 \uff1a 2026\u5e746\u670815\u65e5 21\u664238\u5206',
      '\u6ce8\u6587\u756a\u53f7 \uff1a vectorpremium-11247014',
      '\u914d\u9001\u60c5\u5831',
      '\u914d\u9001\u696d\u8005 \uff1a \u4f50\u5ddd\u6025\u4fbf',
      '\u914d\u9001\u5e0c\u671b\u65e5 \uff1a \u6307\u5b9a\u306a\u3057',
      '\u914d\u9001\u5e0c\u671b\u6642\u9593 \uff1a \u6307\u5b9a\u306a\u3057',
      '\u4f1d\u7968\u756a\u53f7 \uff1a 490459840452',
      '\u914d\u9001\u72b6\u6cc1\u3092\u8abf\u3079\u308b\uff08\u5916\u90e8\u30b5\u30a4\u30c8\uff09'
    ].join('\n'),
    '/seller/top',
    {
      querySelectorAll(selector) {
        if (selector !== 'tr, dl, div, li, p') return [];
        return [
          { textContent: '\u914d\u9001\u696d\u8005 \uff1a \u4f50\u5ddd\u6025\u4fbf' },
          { textContent: '\u914d\u9001\u5e0c\u671b\u65e5 \uff1a \u6307\u5b9a\u306a\u3057' },
          { textContent: '\u914d\u9001\u5e0c\u671b\u6642\u9593 \uff1a \u6307\u5b9a\u306a\u3057' },
          { textContent: '\u4f1d\u7968\u756a\u53f7 \uff1a 490459840452\n\u914d\u9001\u72b6\u6cc1\u3092\u8abf\u3079\u308b\uff08\u5916\u90e8\u30b5\u30a4\u30c8\uff09' }
        ];
      }
    }
  );
  const result = api.extractPendingShipmentScanResult();
  assert.equal(result.type, 'shipped');
  assert.equal(result.shippingCompany, '\u4f50\u5ddd\u6025\u4fbf');
  assert.equal(result.trackingNumber, '490459840452');
  assert.equal(result.trackingFallback, '');
}

function testExtractPendingShipmentScanResultFallsBackToStoreInfoName() {
  const api = loadContentForTest(
    '\u5546\u54c1\u304c\u767a\u9001\u3055\u308c\u307e\u3057\u305f\u3002\u5230\u7740\u307e\u3067\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002',
    '/order/status',
    {
      querySelectorAll(selector) {
        if (selector !== 'tr, dl, div, li, p') return [];
        return [
          { textContent: '\u914d\u9001\u696d\u8005 \uff1a \u65e5\u672c\u90f5\u4fbf' },
          { textContent: '\u30b9\u30c8\u30a2\u60c5\u5831' },
          { textContent: '\u30b9\u30c8\u30a2\u540d \u30ed\u30ed\u30de\u5546\u4e8b' }
        ];
      }
    }
  );
  const result = api.extractPendingShipmentScanResult();
  assert.equal(result.type, 'shipped');
  assert.equal(result.shippingCompany, '\u65e5\u672c\u90f5\u4fbf');
  assert.equal(result.trackingNumber, '\u30ed\u30ed\u30de\u5546\u4e8b');
  assert.equal(result.trackingFallback, 'store_info_name');
}

function testExtractPendingShipmentScanResultFallsBackToStructuredStoreInfoName() {
  const storeSection = {
    textContent: '\u30b9\u30c8\u30a2\u60c5\u5831\u30b9\u30c8\u30a2\u540dSOFTomo\u30b9\u30c8\u30a2\u60c5\u5831\u3092\u78ba\u8a8d\u3059\u308b',
    querySelectorAll(selector) {
      if (selector === 'dl, li, tr') {
        return [
          {
            textContent: '\u30b9\u30c8\u30a2\u540dSOFTomo\u30b9\u30c8\u30a2\u60c5\u5831\u3092\u78ba\u8a8d\u3059\u308b',
            querySelectorAll(innerSelector) {
              if (innerSelector === 'dt, th') return [{ textContent: '\u30b9\u30c8\u30a2\u540d' }];
              if (innerSelector === 'dd, td') {
                return [{ textContent: 'SOFTomo\u30b9\u30c8\u30a2\u60c5\u5831\u3092\u78ba\u8a8d\u3059\u308b\u203b\u8cfc\u5165\u306b\u3064\u3044\u3066\u306e\u8cea\u554f\u306f\u76f4\u63a5\u30b9\u30c8\u30a2\u306b\u304a\u554f\u3044\u5408\u308f\u305b\u304f\u3060\u3055\u3044\u3002' }];
              }
              return [];
            }
          }
        ];
      }
      return [];
    }
  };
  const api = loadContentForTest(
    '\u5546\u54c1\u304c\u767a\u9001\u3055\u308c\u307e\u3057\u305f\u3002\u5230\u7740\u307e\u3067\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002',
    '/order/status',
    {
      querySelectorAll(selector) {
        if (selector === 'tr, dl, div, li, p') return [];
        if (selector === 'section') return [storeSection];
        return [];
      }
    }
  );
  const result = api.extractPendingShipmentScanResult();
  assert.equal(result.type, 'shipped');
  assert.equal(result.trackingNumber, 'SOFTomo');
  assert.equal(result.trackingFallback, 'store_info_name');
}

function testExtractPendingShipmentScanResultStoreDoesNotUseUnlabeledBodyNumber() {
  const api = loadContentForTest(
    '\u5546\u54c1\u304c\u767a\u9001\u3055\u308c\u307e\u3057\u305f\u3002\u5230\u7740\u307e\u3067\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002\u53d6\u5f15\u30e1\u30c3\u30bb\u30fc\u30b8 123456789012',
    '/order/status',
    {
      querySelectorAll(selector) {
        if (selector !== 'tr, dl, div, li, p') return [];
        return [
          { textContent: '\u30b9\u30c8\u30a2\u60c5\u5831' },
          { textContent: '\u30b9\u30c8\u30a2\u540d SOFTomo' }
        ];
      }
    }
  );
  const result = api.extractPendingShipmentScanResult();
  assert.equal(result.type, 'shipped');
  assert.equal(result.trackingNumber, 'SOFTomo');
  assert.equal(result.trackingFallback, 'store_info_name');
}

function testExtractPendingShipmentScanResultIgnoresLeadingZeroPhoneNumberAsTracking() {
  const api = loadContentForTest(
    '\u51fa\u54c1\u8005\uff1a asua\uff089986\uff09\n\u51fa\u54c1\u8005\u304b\u3089\u5546\u54c1\u767a\u9001\u306e\u9023\u7d61\u304c\u3042\u308a\u307e\u3057\u305f\u3002\u5230\u7740\u3057\u305f\u3089\u3001\u53d7\u3051\u53d6\u308a\u9023\u7d61\u3092\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
    '/buyer/top',
    {
      querySelectorAll(selector) {
        if (selector !== 'tr, dl, div, li, p') return [];
        return [
          { textContent: '\u914d\u9001\u65b9\u6cd5 \uff1a \u30e4\u30de\u30c8\u904b\u8f38' },
          { textContent: '\u304a\u554f\u3044\u5408\u308f\u305b\u756a\u53f7 \uff1a 080-9609-6438' }
        ];
      }
    }
  );
  const result = api.extractPendingShipmentScanResult();
  assert.equal(result.type, 'shipped');
  assert.equal(result.trackingNumber, 'asua');
  assert.equal(result.trackingFallback, 'seller_name');
}

function testExtractPendingShipmentScanResultIgnoresLeadingZeroTenDigitPhoneNumberAsTracking() {
  const api = loadContentForTest(
    '\u51fa\u54c1\u8005\uff1a asua\uff089986\uff09\n\u51fa\u54c1\u8005\u304b\u3089\u5546\u54c1\u767a\u9001\u306e\u9023\u7d61\u304c\u3042\u308a\u307e\u3057\u305f\u3002\u5230\u7740\u3057\u305f\u3089\u3001\u53d7\u3051\u53d6\u308a\u9023\u7d61\u3092\u3057\u3066\u304f\u3060\u3055\u3044\u3002\n\u53d6\u5f15\u30e1\u30c3\u30bb\u30fc\u30b8 0123456789',
    '/buyer/top',
    {
      querySelectorAll(selector) {
        if (selector !== 'tr, dl, div, li, p') return [];
        return [{ textContent: '\u914d\u9001\u65b9\u6cd5 \uff1a \u30e4\u30de\u30c8\u904b\u8f38' }];
      }
    }
  );
  const result = api.extractPendingShipmentScanResult();
  assert.equal(result.type, 'shipped');
  assert.equal(result.trackingNumber, 'asua');
  assert.equal(result.trackingFallback, 'seller_name');
}

function testExtractPendingShipmentScanResultTrimsTrackingFieldToFirstNumber() {
  const api = loadContentForTest(
    '\u5546\u54c1\u304c\u767a\u9001\u3055\u308c\u307e\u3057\u305f\u3002\u5230\u7740\u307e\u3067\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002',
    '/order/status',
    {
      querySelectorAll(selector) {
        if (selector !== 'tr, dl, div, li, p') return [];
        return [
          { textContent: '\u914d\u9001\u696d\u8005 \uff1a \u30e4\u30de\u30c8\u904b\u8f38' },
          { textContent: '\u4f1d\u7968\u756a\u53f7 \uff1a 3901-6644-7193\u914d\u9001\u72b6\u6cc1\u3092\u8abf\u3079\u308b\uff08\u5916\u90e8\u30b5\u30a4\u30c8\uff09 \u304a\u5c4a\u3051\u60c5\u5831 08096096438' }
        ];
      }
    }
  );
  const result = api.extractPendingShipmentScanResult();
  assert.equal(result.type, 'shipped');
  assert.equal(result.shippingCompany, '\u30e4\u30de\u30c8\u904b\u8f38');
  assert.equal(result.trackingNumber, '390166447193');
}

function testExtractPendingShipmentScanResultDetectsNormalShipped() {
  const api = loadContentForTest('\u51fa\u54c1\u8005\uff1a SAMANSA\uff08658\uff09\n\u51fa\u54c1\u8005\u304b\u3089\u5546\u54c1\u767a\u9001\u306e\u9023\u7d61\u304c\u3042\u308a\u307e\u3057\u305f\u3002\u5230\u7740\u3057\u305f\u3089\u3001\u53d7\u3051\u53d6\u308a\u9023\u7d61\u3092\u3057\u3066\u304f\u3060\u3055\u3044\u3002\n\u914d\u9001\u65b9\u6cd5\uff1a \u3086\u3046\u30d1\u30c3\u30af\uff08\u9001\u6599\uff1a880\u5186\uff09\n\u8ffd\u8de1\u756a\u53f7\uff1a 751242160303');
  const result = api.extractPendingShipmentScanResult();
  assert.equal(result.type, 'shipped');
  assert.equal(result.shippingCompany, '\u3086\u3046\u30d1\u30c3\u30af');
  assert.equal(result.trackingNumber, '751242160303');
}

function testExtractPendingShipmentScanResultAcceptsTenDigitTrackingNumber() {
  const api = loadContentForTest('\u51fa\u54c1\u8005\uff1a \u30a8\u30eb\u30b3\u30fc\u30dd\u30ec\u30fc\u30b7\u30e7\u30f3\uff082875\uff09\n\u51fa\u54c1\u8005\u304b\u3089\u5546\u54c1\u767a\u9001\u306e\u9023\u7d61\u304c\u3042\u308a\u307e\u3057\u305f\u3002\u5230\u7740\u3057\u305f\u3089\u3001\u53d7\u3051\u53d6\u308a\u9023\u7d61\u3092\u3057\u3066\u304f\u3060\u3055\u3044\u3002\n\u914d\u9001\u65b9\u6cd5\uff1a \u5b85\u6025\u4fbf\uff08\u30e4\u30de\u30c8\u904b\u8f38\uff09\uff08\u9001\u6599\uff1a1,000\u5186\uff09\n\u8ffd\u8de1\u756a\u53f7\uff1a 2326453359');
  const result = api.extractPendingShipmentScanResult();
  assert.equal(result.type, 'shipped');
  assert.equal(result.shippingCompany, '\u5b85\u6025\u4fbf');
  assert.equal(result.trackingNumber, '2326453359');
  assert.equal(result.trackingFallback, '');
}

function testExtractPendingShipmentScanResultExtractsNormalShipmentTableFields() {
  const api = loadContentForTest(
    '\u51fa\u54c1\u8005\u304b\u3089\u5546\u54c1\u767a\u9001\u306e\u9023\u7d61\u304c\u3042\u308a\u307e\u3057\u305f\u3002\u5230\u7740\u3057\u305f\u3089\u3001\u53d7\u3051\u53d6\u308a\u9023\u7d61\u3092\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
    '/buyer/top',
    {
      querySelectorAll(selector) {
        if (selector !== 'tr, dl, div, li, p') return [];
        return [
          { textContent: '\u914d\u9001\u65b9\u6cd5 \uff1a \u3086\u3046\u30d1\u30c3\u30af\uff08\u9001\u6599:880\u5186\uff09' },
          { textContent: '\u8ffd\u8de1\u756a\u53f7 \uff1a 751242160303' }
        ];
      }
    }
  );
  const result = api.extractPendingShipmentScanResult();
  assert.equal(result.type, 'shipped');
  assert.equal(result.shippingCompany, '\u3086\u3046\u30d1\u30c3\u30af');
  assert.equal(result.trackingNumber, '751242160303');
}

function testExtractPendingShipmentScanResultExtractsInquiryNumberLabel() {
  const api = loadContentForTest(
    '\u51fa\u54c1\u8005\u304b\u3089\u5546\u54c1\u767a\u9001\u306e\u9023\u7d61\u304c\u3042\u308a\u307e\u3057\u305f\u3002\u5230\u7740\u3057\u305f\u3089\u3001\u53d7\u3051\u53d6\u308a\u9023\u7d61\u3092\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
    '/buyer/top',
    {
      querySelectorAll(selector) {
        if (selector !== 'tr, dl, div, li, p') return [];
        return [
          { textContent: '\u914d\u9001\u65b9\u6cd5 \uff1a \u30e4\u30de\u30c8\u904b\u8f38' },
          { textContent: '\u304a\u554f\u3044\u5408\u308f\u305b\u756a\u53f7 \uff1a 1234-5678-9012 \u914d\u9001\u5e0c\u671b\u65e5 \uff1a \u6307\u5b9a\u306a\u3057' }
        ];
      }
    }
  );
  const result = api.extractPendingShipmentScanResult();
  assert.equal(result.type, 'shipped');
  assert.equal(result.shippingCompany, '\u30e4\u30de\u30c8\u904b\u8f38');
  assert.equal(result.trackingNumber, '123456789012');
}

function testExtractPendingShipmentScanResultFindsHyphenatedTrackingInMessages() {
  const api = loadContentForTest('\u51fa\u54c1\u8005\uff1a asua\uff089986\uff09\n\u51fa\u54c1\u8005\u304b\u3089\u5546\u54c1\u767a\u9001\u306e\u9023\u7d61\u304c\u3042\u308a\u307e\u3057\u305f\u3002\u5230\u7740\u3057\u305f\u3089\u3001\u53d7\u3051\u53d6\u308a\u9023\u7d61\u3092\u3057\u3066\u304f\u3060\u3055\u3044\u3002\n\u53d6\u5f15\u30e1\u30c3\u30bb\u30fc\u30b8 1234-5678-9012');
  assert.equal(api.extractPendingShipmentScanResult().trackingNumber, '123456789012');
}

function testExtractPendingShipmentScanResultTreatsUnregisteredTrackingAsPending() {
  const api = loadContentForTest('\u51fa\u54c1\u8005\u304b\u3089\u5546\u54c1\u767a\u9001\u306e\u9023\u7d61\u304c\u3042\u308a\u307e\u3057\u305f\u3002\u5230\u7740\u3057\u305f\u3089\u3001\u53d7\u3051\u53d6\u308a\u9023\u7d61\u3092\u3057\u3066\u304f\u3060\u3055\u3044\u3002\n\u914d\u9001\u72b6\u6cc1\uff1a \u8377\u7269\u53d7\u4ed8\n\u914d\u9001\u65b9\u6cd5\uff1a \u304a\u3066\u304c\u308b\u914d\u9001 \u30cd\u30b3\u30dd\u30b9\uff08\u9001\u6599\uff1a230\u5186\uff09\n\u8ffd\u8de1\u756a\u53f7\uff1a \u672a\u767b\u9332\uff08\u53cd\u6620\u3055\u308c\u308b\u307e\u3067\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\uff09');
  assert.equal(api.extractPendingShipmentScanResult().type, 'pending_shipment');
}

function testExtractPendingShipmentScanResultFallsBackToSellerInfoName() {
  const api = loadContentForTest(
    '\u51fa\u54c1\u8005\uff1a kat********\uff08356\uff09\n\u51fa\u54c1\u8005\u304b\u3089\u5546\u54c1\u767a\u9001\u306e\u9023\u7d61\u304c\u3042\u308a\u307e\u3057\u305f\u3002\u5230\u7740\u3057\u305f\u3089\u3001\u53d7\u3051\u53d6\u308a\u9023\u7d61\u3092\u3057\u3066\u304f\u3060\u3055\u3044\u3002\n\u914d\u9001\u65b9\u6cd5\uff1a \u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8\uff08\u9001\u6599\uff1a185\u5186\uff09',
    '/buyer/top',
    {
      querySelectorAll(selector) {
        if (selector !== 'tr, dl, div, li, p') return [];
        return [
          { textContent: '\u51fa\u54c1\u8005\u60c5\u5831' },
          { textContent: '\u6c0f\u540d \u6bdb\u5229\u3000\u597d\u4e4b\u52a9' },
          { textContent: '\u4f4f\u6240 \u3012064**** \u5317\u6d77\u9053 \u672d\u5e4c\u5e02\u4e2d\u592e\u533a ****' }
        ];
      }
    }
  );
  const result = api.extractPendingShipmentScanResult();
  assert.equal(result.type, 'shipped');
  assert.equal(result.trackingNumber, '\u6bdb\u5229\u3000\u597d\u4e4b\u52a9');
  assert.equal(result.trackingFallback, 'seller_info_name');
}

function testExtractPendingShipmentScanResultFallsBackToSellerInfoNameInsideFullTradeBlock() {
  const fullTradeBlock = [
    '\u53d6\u5f15\u60c5\u5831',
    '\u304a\u5c4a\u3051\u60c5\u5831 \u6c0f\u540d \uff1a GAO YUN \u4f4f\u6240 \uff1a \u30125580023',
    '\u304a\u652f\u6255\u3044\u60c5\u5831 \u652f\u6255\u3044\u91d1\u984d \uff1a 3,390\u5186',
    '\u843d\u672d\u8005\u60c5\u5831 \u6c0f\u540d \uff1a GAO YUN \u4f4f\u6240 \uff1a \u30125580023',
    '\u51fa\u54c1\u8005\u60c5\u5831 \u6c0f\u540d \uff1a \u30a8\u30fc\u30b7\u30fc\u3000\u5546\u4e8b \u4f4f\u6240 \uff1a \u3012260**** \u51fa\u54c1\u8005\u60c5\u5831\u3092\u78ba\u8a8d\u3059\u308b'
  ].join('\n');
  const api = loadContentForTest(
    '\u51fa\u54c1\u8005\uff1a kat********\uff08356\uff09\n\u51fa\u54c1\u8005\u304b\u3089\u5546\u54c1\u767a\u9001\u306e\u9023\u7d61\u304c\u3042\u308a\u307e\u3057\u305f\u3002\u5230\u7740\u3057\u305f\u3089\u3001\u53d7\u3051\u53d6\u308a\u9023\u7d61\u3092\u3057\u3066\u304f\u3060\u3055\u3044\u3002\n\u914d\u9001\u65b9\u6cd5\uff1a \u5b9a\u5f62\u5916\u90f5\u4fbf\uff08\u9001\u6599\uff1a390\u5186\uff09',
    '/buyer/top',
    {
      querySelectorAll(selector) {
        if (selector !== 'tr, dl, div, li, p') return [];
        return [{ textContent: fullTradeBlock }];
      }
    }
  );
  const result = api.extractPendingShipmentScanResult();
  assert.equal(result.type, 'shipped');
  assert.equal(result.trackingNumber, '\u30a8\u30fc\u30b7\u30fc\u3000\u5546\u4e8b');
  assert.equal(result.trackingFallback, 'seller_info_name');
}

function testExtractPendingShipmentScanResultFallsBackToSellerName() {
  const api = loadContentForTest('\u51fa\u54c1\u8005\uff1a asua\uff089986\uff09\n\u5546\u54c1\u304c\u767a\u9001\u3055\u308c\u307e\u3057\u305f\u3002\u5230\u7740\u307e\u3067\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002\n\u914d\u9001\u696d\u8005\uff1a \u65e5\u672c\u90f5\u4fbf');
  const result = api.extractPendingShipmentScanResult();
  assert.equal(result.type, 'shipped');
  assert.equal(result.trackingNumber, 'asua');
  assert.equal(result.trackingFallback, 'seller_name');
}

function testExtractPendingShipmentScanResultDetectsCancelled() {
  const api = loadContentForTest('\u53d6\u5f15\u304c\u30ad\u30e3\u30f3\u30bb\u30eb\u3055\u308c\u307e\u3057\u305f\u3002\u30ad\u30e3\u30f3\u30bb\u30eb\u5f8c\u306e\u6d41\u308c\u306f\u30d8\u30eb\u30d7\u3092\u3054\u78ba\u8a8d\u304f\u3060\u3055\u3044\u3002');
  assert.equal(api.extractPendingShipmentScanResult().type, 'cancelled');
}

async function run() {
  testOutbidTextIsNotHighestBidder();
  testRaiseBidButtonTextAloneIsNotOutbidFailure();
  testRebidRequiredIsSeparateFromOutbidFailure();
  testRebidRequiredWinsOverBidCompletedText();
  await testRebidRequiredFailsAfterOutcomeWait();
  testYahooBidAccessFailureTextIsDetected();
  await testYahooBidAccessFailureClosesTask();
  await testYahooSystemErrorPageReturnsStableBidError();
  testAcceptedBidTextIsHighestBidder();
  testProductPageHighestBidderNoticeDoesNotSkipNewBid();
  testAcceptedBuyoutTextIsSuccess();
  testStoreBuyoutThankYouPageIsSuccess();
  testSuccessTextWinsOverGenericOutbidWords();
  testExplicitOutbidWinsOverBidCompletedText();
  testProductTitleDoesNotUseYahooPrefix();
  testCurrentPriceUsesProductPageDataBeforeRecommendationText();
  testInstantBuyButtonTextIsRecognized();
  testBidEntryButtonTextAvoidsHelpLinks();
  testProductDataExtractsBuyoutPriceFromPageData();
  testProductDataAddsTaxToStoreBuyoutPriceFromPageData();
  testProductDataPrefersPageDataProductName();
  testProductDataExtractsTaxType();
  testProductDataExtractsShippingFeeText();
  testProductDataPrefersRenderedShippingAmount();
  testProductDataPrefersCashOnDeliveryOverBidderPays();
  testProductDataExtractsFreeShippingFromNextData();
  testProductDataDoesNotUseRecommendationFreeShippingForBidderPays();
  testProductDataDoesNotUseUnavailableCashOnDeliveryDescription();
  testProductDataPrefersTaxZeroWhenBothTaxLabelsExist();
  testProductDataDoesNotUseBodyDateAsEndTime();
  testProductDataExtractsExplicitEndTime();
  testTaxIncludedBidPriceForMultiBidIncrement();
  testBidLimitRejectsTaxTotalAboveUserMax();
  testBidLimitRejectsPlannedStoreBidAboveUserMax();
  testBidLimitAllowsPlannedPersonalBidAtUserMax();
  testMultiBidCapsToMaxWhenNormalIncrementExceedsMaxButMaxIsValid();
  testMultiBidFailsWhenMaxPriceCannotMeetYahooMinIncrement();
  testMultiBidCapsToMaxWhenNextNormalBidWouldLeaveOneMinimumStep();
  testMultiBidDoesNotCapWhenNearCeilingEqualsMax();
  testMultiBidUsesThreeStageFirstTargetForLowCurrentPrice();
  testMultiBidUsesFiveStepMiddleRange();
  testMultiBidRebalancesShortMiddleRange();
  testMultiBidUsesFixedIncrementInFinalReserveRange();
  testInferCurrentPriceFromYahooDefaultBidPrice();
  testPlainBidEntryIsNotFinalAgree();
  testExtractTaxIncludedTotal();
  testMultiBidInputPageDetection();
  testProductHighestBidderNoticeDetection();
  testExtractAutoBidLimit();
  await testDirectBidNoLongerSkipsWhenWithinAutoBidLimit();
  await testDirectBidWaitsForConfirmButtonEnabledAfterInput();
  await testDirectBidDoesNotClickAuctionLinkWhenLookingForConfirm();
  await testDirectBidClicksConfirmInsideBidModalOnly();
  await testDirectBidSubmitConfirmRequestsFormSubmit();
  await testDirectBidFinalConfirmUsesShortOutcomeWait();
  await testBuyoutClicksInstantBuyThenFinalAgree();
  await testStoreBuyoutClicksPurchaseFlow();
  await testStoreBuyoutSkipsCurrentPriceAboveTaxExcludedMaxValidation();
  await testStoreBuyoutReviewSkipsPayPayBenefitConfirmLink();
  await testStoreBuyoutFinalPurchaseClickDoesNotRepeatReviewConfirm();
  await testTimedStoreTaxBeforeBidUsesUserMaxForCurrentPriceValidation();
  await testMultiBidClicksConfirmAfterInput();
  await testMultiBidWaitsAfterPriceInputBeforeConfirmClick();
  await testMultiBidRebidRequiredUsesTopDialogBidButton();
  await testMultiBidRebidRequiredDoesNotFallbackToOuterRaiseButton();
  await testMultiBidRebidRequiredUsesLatestVisibleCurrentPriceOverStaleScript();
  await testMultiBidRebidRequiredUsesYahooRebidConfirmButtonDataParams();
  await testMultiBidRebidSubmitButtonIsClickedOnlyOnce();
  await testMultiBidRebidWaitsOneSecondAfterPriceInputBeforeSubmit();
  await testMultiBidRebidRequiredFallsBackToDefaultInputPriceWhenCurrentMissing();
  await testMultiBidRebidRequiredPrefersDefaultInputPriceOverVisibleCurrent();
  await testMultiBidUsesTaxExcludedLatestPagePriceNotInputDefault();
  await testMultiBidPrefersYahooScriptTaxExcludedPrice();
  testOrderHistoryPrefersWinningPriceLabelOverFirstYenAmount();
  testOrderHistoryExtractsTransactionUrl();
  testOrderHistoryIgnoresAuctionLinksWithoutTransactionContact();
  testOrderHistoryExtractsUnlabeledWonPriceLine();
  testOrderHistoryExtractsFirstYenAmountWhenTextIsFlattened();
  testOrderHistoryUsesPriceElementWhenTextContentMergesTitleCodeWithPrice();
  testOrderHistoryPriceElementAcceptsRealYenCharacter();
  testOrderHistoryFallbackTreatsCommaSeparatedNumberAsPrice();
  testWonHistoryNextPageUsesSharedVisibleTextNormalizer();
  testBiddingItemsExtractsOutbidRebidRows();
  testBundleTransactionInfoValidatesQuantity();
  testBundleTransactionInfoDetectsQuantityMismatch();
  testBundleTransactionInfoDetectsPopupBundleText();
  testDetectBundleRequestedComplete();
  testTransactionPageYahooIdTextDoesNotMeanLoggedOut();
  testLoginUrlStillMeansLoggedOut();
  await testProductPageLoginHintDoesNotShortCircuitBidExecution();
  testClickTransactionContactForProduct();
  testClickBundleTransactionActionFindsRequestButton();
  testClickBundleTransactionActionIgnoresInstructionText();
  testClickBundleTransactionActionFindsInputRoleButtonParent();
  testBundleTransactionActionStateDetectsDecideButton();
  testBundleTransactionActionStateDetectsReviewButtonAsDecide();
  testBundleTransactionActionStateDetectsPlacementOkModal();
  testBundleTransactionActionStateDetectsWaitingShippingPaymentAmount();
  testBundleTransactionActionStateDetectsPaymentReadyPage();
  testBundleTransactionActionStateDetectsBuyerDeletedCancellation();
  testExtractWaitingShippingScanResultFindsShippingFee();
  testExtractWaitingShippingScanResultDoesNotUseTotalPayment();
  testExtractWaitingShippingScanResultDetectsPendingShipping();
  testExtractWaitingShippingScanResultPendingBeatsOtherShippingText();
  testExtractBundleScanResultDetectsWaitingForSellerAgreement();
  testExtractBundleScanResultDetectsChildAgreementPopup();
  testExtractBundleScanResultDetectsMainAgreementPopup();
  testExtractBundleScanResultPrefersInputRequiredWhenInputLinkExists();
  testExtractBundleScanResultExtractsDeliveryMethodShippingFee();
  testExtractBundleScanResultExtractsPaymentShippingFee();
  testExtractBundleScanResultKeepsSellerPaidPaymentShippingText();
  testExtractBundleScanResultKeepsFreePaymentShippingText();
  testExtractBundleScanResultKeepsCodPaymentShippingText();
  testExtractBundleScanResultDetectsBundleRejected();
  testExtractPendingShipmentScanResultDetectsStorePending();
  testExtractPendingShipmentScanResultDetectsNormalPending();
  testExtractPendingShipmentScanResultDetectsStoreShipped();
  testExtractPendingShipmentScanResultExtractsStoreShipmentTableFields();
  testExtractPendingShipmentScanResultExtractsSagawaStoreShipmentFromTradeInfo();
  testExtractPendingShipmentScanResultFallsBackToStoreInfoName();
  testExtractPendingShipmentScanResultFallsBackToStructuredStoreInfoName();
  testExtractPendingShipmentScanResultStoreDoesNotUseUnlabeledBodyNumber();
  testExtractPendingShipmentScanResultIgnoresLeadingZeroPhoneNumberAsTracking();
  testExtractPendingShipmentScanResultIgnoresLeadingZeroTenDigitPhoneNumberAsTracking();
  testExtractPendingShipmentScanResultTrimsTrackingFieldToFirstNumber();
  testExtractPendingShipmentScanResultDetectsNormalShipped();
  testExtractPendingShipmentScanResultAcceptsTenDigitTrackingNumber();
  testExtractPendingShipmentScanResultExtractsNormalShipmentTableFields();
  testExtractPendingShipmentScanResultExtractsInquiryNumberLabel();
  testExtractPendingShipmentScanResultFindsHyphenatedTrackingInMessages();
  testExtractPendingShipmentScanResultTreatsUnregisteredTrackingAsPending();
  testExtractPendingShipmentScanResultFallsBackToSellerInfoName();
  testExtractPendingShipmentScanResultFallsBackToSellerInfoNameInsideFullTradeBlock();
  testExtractPendingShipmentScanResultFallsBackToSellerName();
  testExtractPendingShipmentScanResultDetectsCancelled();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
