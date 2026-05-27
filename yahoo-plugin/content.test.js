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

function createOrderContainer(text, linkText, href, priceElements = []) {
  const link = createTestAnchor(linkText, href);
  return {
    textContent: text,
    querySelectorAll(selector) {
      if (selector === 'a[href*="/jp/auction/"]') return [link];
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
  testProductDataExtractsShippingFeeText();
  testProductDataPrefersRenderedShippingAmount();
  testProductDataPrefersCashOnDeliveryOverBidderPays();
  testProductDataExtractsFreeShippingFromNextData();
  testProductDataDoesNotUseRecommendationFreeShippingForBidderPays();
  testProductDataDoesNotUseUnavailableCashOnDeliveryDescription();
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
  await testDirectBidNoLongerSkipsWhenWithinAutoBidLimit();
  await testDirectBidWaitsForConfirmButtonEnabledAfterInput();
  await testDirectBidDoesNotClickAuctionLinkWhenLookingForConfirm();
  await testTimedStoreTaxBeforeBidUsesUserMaxForCurrentPriceValidation();
  await testMultiBidClicksConfirmAfterInput();
  testOrderHistoryPrefersWinningPriceLabelOverFirstYenAmount();
  testOrderHistoryExtractsUnlabeledWonPriceLine();
  testOrderHistoryExtractsFirstYenAmountWhenTextIsFlattened();
  testOrderHistoryUsesPriceElementWhenTextContentMergesTitleCodeWithPrice();
  testOrderHistoryFallbackTreatsCommaSeparatedNumberAsPrice();
  testBiddingItemsExtractsOutbidRebidRows();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
