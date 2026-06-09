// content.js - Injected into Yahoo Auction pages

(() => {
const isYahooSyncPage = /\/my\/(?:bidding|won)/.test(window.location.pathname);
if (window.__G_DAIPAI_CONTENT_LOADED__ && !isYahooSyncPage) {
  return;
}
window.__G_DAIPAI_CONTENT_LOADED__ = true;

const API_BASE = 'http://localhost:3034';
const CLIENT_ORIGINS = new Set([
  'http://localhost:3035',
  'http://127.0.0.1:3035',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://43.165.177.49',
  'http://43.165.177.49:3035'
]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanupProductTitle(title, auctionId = '') {
  const cleaned = String(title || '')
    .replace(/^Yahoo![^-\n]*\u30aa\u30fc\u30af\u30b7\u30e7\u30f3\s*-\s*/i, '')
    .replace(/\s*-\s*Yahoo![^-\n]*\u30aa\u30fc\u30af\u30b7\u30e7\u30f3.*$/i, '')
    .trim();
  if (cleaned && !/^Yahoo![^-\n]*\u30aa\u30fc\u30af\u30b7\u30e7\u30f3$/i.test(cleaned)) return cleaned;
  return auctionId ? ('商品 ' + auctionId) : '';
}

if (false && CLIENT_ORIGINS.has(window.location.origin)) {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== 'g-daipai-client' || msg.type !== 'GET_PRODUCT_INFO') return;

    chrome.runtime.sendMessage(
      { type: 'FETCH_PRODUCT_REMOVED', auctionId: msg.auctionId, url: msg.url },
      (response) => {
        window.postMessage({
          source: 'g-daipai-extension',
          type: 'PRODUCT_INFO_RESULT',
          requestId: msg.requestId,
          data: response?.data || null,
          error: response?.error || null
        }, window.location.origin);
      }
    );
  });
}

// Extract product data from the Yahoo auction page
function extractProductData() {
  function getPageDataItems() {
    for (const script of document.querySelectorAll('script')) {
      const text = script.textContent || '';
      const pageDataJson = text.match(/var\s+pageData\s*=\s*(\{[\s\S]*?\});/)?.[1];
      if (!pageDataJson) continue;
      try {
        return JSON.parse(pageDataJson)?.items || null;
      } catch (_) {}
    }
    return null;
  }

  function getNextDataItem() {
    const script = document.querySelector('script#__NEXT_DATA__');
    if (!script?.textContent) return null;
    try {
      const data = JSON.parse(script.textContent);
      return data?.props?.pageProps?.initialState?.item?.detail?.item ||
        data?.props?.initialState?.item?.detail?.item ||
        data?.props?.pageProps?.initialState?.detail?.item ||
        null;
    } catch (_) {
      return null;
    }
  }

  // Try multiple selectors for price (Yahoo auction pages have various structures)
  function getPrice() {
    const pageDataPrice = parseYen(getPageDataItems()?.price);
    if (pageDataPrice > 0) return pageDataPrice;

    const priceEl = document.querySelector('[class*="priceValue"]') ||
                    document.querySelector('[class*="priceFrame"]') ||
                    document.querySelector('[class*="currentPrice"]') ||
                    document.querySelector('[class*="price"]') ||
                    document.querySelector('[data-price]');
    if (priceEl) {
      const text = priceEl.textContent || priceEl.getAttribute('data-price') || '';
      const match = text.match(/[\d,]+/);
      return match ? parseInt(match[0].replace(/,/g, '')) : 0;
    }
    // Fallback: search whole page
    const bodyText = document.body.textContent;
    const m = bodyText.match(/(?:\u73fe\u5728|current)[^\d]{0,20}([\d,]+)/i);
    if (m) return parseInt(m[1].replace(/,/g, ''));
    return 0;
  }

  function getBuyoutPrice() {
    const pageDataItems = getPageDataItems();
    if (pageDataItems && Object.prototype.hasOwnProperty.call(pageDataItems, 'winPrice')) {
      const value = parseYen(pageDataItems.winPrice);
      return getTaxType() === 'tax_included' && value >= 10 ? Math.floor(value * 1.1) : value;
    }

    const bodyText = document.body.textContent || '';
    const match = bodyText.match(/\u5373\u6c7a(?:\u4fa1\u683c)?[^\d]{0,20}([\d,]+)\s*(?:\u5186|JPY)?/i);
    if (match?.[1]) return parseInt(match[1].replace(/,/g, ''), 10) || 0;
    if (/\u8cfc\u5165\u624b\u7d9a\u304d\u3078/.test(bodyText)) return getPrice();
    return 0;
  }

  function getTaxType() {
    const text = document.body.textContent || '';
    if (/\uff08\s*\u7a0e\s*0\s*\u5186\s*\uff09|\(\s*\u7a0e\s*0\s*\u5186\s*\)/.test(text)) return 'tax_zero';
    if (/\uff08\s*\u7a0e\u8fbc\s*\uff09|\(\s*\u7a0e\u8fbc\s*\)/.test(text)) return 'tax_included';
    return 'tax_zero';
  }

  function getShippingFeeText() {
    const nextDataItem = getNextDataItem();
    const postageText = document.querySelector('#itemPostage')?.textContent || '';
    const nextDataShippingText = [
      nextDataItem?.descriptionHtml,
      ...(Array.isArray(nextDataItem?.description) ? nextDataItem.description : [])
    ].filter(Boolean).join(' ');
    const shippingInput = String(nextDataItem?.shippingInput || '');
    const shippingCharge = String(nextDataItem?.chargeForShipping || '');
    const bodyText = document.body?.textContent || '';
    const postageIndex = bodyText.search(/送料|送料負担|配送方法/);
    const fallbackText = !shippingInput && !shippingCharge && postageIndex >= 0
      ? bodyText.slice(postageIndex, postageIndex + 300)
      : '';
    const sourceText = `${postageText} ${nextDataShippingText} ${fallbackText}`;
    const priceMatch = sourceText.match(/送料[^\d]{0,40}([\d,]+)\s*円/);
    if (priceMatch?.[1]) return `${priceMatch[1].replace(/,/g, '')}円`;
    const labelText = `${postageText} ${fallbackText} ${shippingInput} ${shippingCharge}`;
    if (/着払い/.test(labelText)) return '着払い';
    if (/seller/i.test(shippingCharge)) return '無料';
    if (/無料/.test(labelText)) return '無料';
    if (/落札者負担|winner/i.test(labelText)) return '落札者負担';
    return '';
  }

  function getEndTime() {
    const metaEnd = document.querySelector('[itemprop="endDate"][content], meta[property="product:expiration_time"][content]');
    if (metaEnd?.content) return metaEnd.content.trim();

    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent || '{}');
        const nodes = Array.isArray(data) ? data : [data];
        for (const node of nodes) {
          const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
          if (offers?.priceValidUntil) return String(offers.priceValidUntil).trim();
        }
      } catch (_) {}
    }

    const timeEl = document.querySelector('time[datetime]');
    if (timeEl?.dateTime) return timeEl.dateTime.trim();

    const dataEndEl = document.querySelector('[data-end-time]');
    const dataEndTime = dataEndEl?.getAttribute('data-end-time');
    if (dataEndTime) return dataEndTime.trim();

    const el = document.querySelector('[class*="endedTime"]') ||
               document.querySelector('[class*="endTime"]') ||
               document.querySelector('[class*="countdown"]') ||
               document.querySelector('[class*="closeTime"]');
    const text = el?.textContent?.trim() || '';
    const dateMatch = text.match(/\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s*[\d:]+/);
    if (dateMatch) {
      return dateMatch[0];
    }
    return '';
  }

  function getImage() {
    const el = document.querySelector('[class*="mainImage"] img') ||
               document.querySelector('[class*="productMainImage"]') ||
               document.querySelector('#mainImage') ||
               document.querySelector('[class*="productImage"] img') ||
               document.querySelector('[data-product-image]') ||
               document.querySelector('meta[property="og:image"]');
    if (el) {
      return el.src || el.content || '';
    }
    return '';
  }

  function getTitle() {
    const pageDataTitle = cleanupProductTitle(getPageDataItems()?.productName, auctionId);
    if (pageDataTitle && pageDataTitle !== '商品 ' + auctionId) return pageDataTitle;

    const nextDataItem = getNextDataItem();
    const nextDataTitle = cleanupProductTitle(
      nextDataItem?.productName || nextDataItem?.title || nextDataItem?.name,
      auctionId
    );
    if (nextDataTitle && nextDataTitle !== '商品 ' + auctionId) return nextDataTitle;

    const el = document.querySelector('[class*="productTitle"]') ||
               document.querySelector('h1[class*="title"]') ||
               document.querySelector('h1[class*="ProductName"]') ||
               document.querySelector('meta[property="og:title"]');
    if (el) {
      return cleanupProductTitle(el.textContent || el.content || '', auctionId);
    }
    return cleanupProductTitle(document.title, auctionId);
  }

  const url = window.location.href;
  const match = url.match(/[a-zA-Z]?\d{8,10}/);
  const auctionId = match ? match[0].toLowerCase() : '';

  return {
    auctionId,
    url: window.location.href,
    title: getTitle(),
    currentPrice: getPrice(),
    buyoutPrice: getBuyoutPrice(),
    taxType: getTaxType(),
    shippingFeeText: getShippingFeeText(),
    endTime: getEndTime(),
    imageUrl: getImage()
  };
}

function parseYen(text) {
  const match = String(text || '').match(/([\d,]+)\s*(?:\u5186|JPY)?/);
  return match ? parseInt(match[1].replace(/,/g, ''), 10) || 0 : 0;
}

function extractCurrentPriceFromScripts() {
  for (const script of document.querySelectorAll('script')) {
    const text = script.textContent || '';
    const pageDataMatch = text.match(/var\s+pageData\s*=\s*(\{[\s\S]*?\});\s*<\/?script?/);
    const pageDataJson = pageDataMatch?.[1] || text.match(/var\s+pageData\s*=\s*(\{[\s\S]*?\});/)?.[1];
    if (pageDataJson) {
      try {
        const pageData = JSON.parse(pageDataJson);
        const price = parseYen(pageData?.items?.price);
        if (price > 0) return price;
      } catch (_) {}
    }

    if (script.type === 'application/ld+json') {
      try {
        const data = JSON.parse(text || '{}');
        const nodes = Array.isArray(data) ? data : [data];
        for (const node of nodes) {
          const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
          const price = parseYen(offers?.price);
          if (price > 0) return price;
        }
      } catch (_) {}
    }
  }
  return 0;
}

function extractCurrentAuctionPrice() {
  const fromScripts = extractCurrentPriceFromScripts();
  if (fromScripts > 0) return fromScripts;

  const selectors = [
    '[class*="priceValue"]',
    '[class*="PriceValue"]',
    '[class*="currentPrice"]',
    '[class*="CurrentPrice"]',
    '[class*="priceFrame"]',
    '[data-price]',
    '[itemprop="price"]'
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const fromAttr = parseInt(String(el.getAttribute('data-price') || el.getAttribute('content') || '').replace(/,/g, ''), 10);
    if (fromAttr > 0) return fromAttr;
    const fromText = parseYen(el.textContent);
    if (fromText > 0) return fromText;
  }

  return 0;
}

function getBodyText() {
  return document.body.textContent || '';
}

function isYahooLoginPageUrl(href = window.location.href || '') {
  return /login\.yahoo\.co\.jp|account\.edit\.yahoo\.co\.jp/i.test(href);
}

function detectYahooLoginStatus() {
  const text = getBodyText();
  const href = window.location.href;
  const isLoginUrl = isYahooLoginPageUrl(href);
  const hasLoginPrompt = /\u30ed\u30b0\u30a4\u30f3.*\u5fc5\u8981|\u30ed\u30b0\u30a4\u30f3\u3057\u3066\u304f\u3060\u3055\u3044|ログイン.*必要|ログインしてください/i.test(text);
  if (isLoginUrl || hasLoginPrompt) {
    return { status: 'failed', message: '需要登录 Yahoo' };
  }
  return { status: 'ok', message: '' };
}

function hasExplicitOutbidText(text = getBodyText()) {
  return /\u6700\u9ad8\u984d\u5165\u672d\u8005\u3067\u306f\u3042\u308a\u307e\u305b\u3093/.test(text);
}

function isOutbidText(text = getBodyText()) {
  return hasExplicitOutbidText(text);
}

function isRebidRequiredText(text = getBodyText()) {
  return /\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059/.test(text);
}

function isYahooBidAccessFailureText(text = getBodyText()) {
  return /\u5165\u672d\u306b\u5931\u6557\u3057\u307e\u3057\u305f|\u30aa\u30fc\u30af\u30b7\u30e7\u30f3\u306b\u30a2\u30af\u30bb\u30b9\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f/.test(text);
}

function hasBidSuccessText(text = getBodyText()) {
  return /\u5165\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f|\u5165\u672d\u3092\u53d7\u3051\u4ed8\u3051\u307e\u3057\u305f|\u5165\u672d\u3057\u307e\u3057\u305f|\u843d\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f|\u843d\u672d\u3057\u307e\u3057\u305f|\u843d\u672d\u3092\u53d7\u3051\u4ed8\u3051\u307e\u3057\u305f|\u3053\u306e\u5546\u54c1\u3092\u843d\u672d\u3057\u307e\u3057\u305f\u304c|\u307e\u3060\u8cfc\u5165\u624b\u7d9a\u304d\u304c\u5b8c\u4e86\u3057\u3066\u3044\u307e\u305b\u3093/.test(text) ||
    /\u8cfc\u5165\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f|\u3054\u8cfc\u5165\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3059/.test(text);
}

function isBuyoutThankYouPage(pathname = window.location.pathname) {
  return /\/order\/thank-you\b/.test(pathname);
}

function isHighestBidderText(text = getBodyText(), pathname = window.location.pathname) {
  const isBidDonePage = /\/jp\/auction\/[a-zA-Z]?\d{8,10}\/bid\/done/.test(pathname);
  if (hasExplicitOutbidText(text)) return false;
  if (isRebidRequiredText(text)) return false;
  return hasBidSuccessText(text) ||
    isBuyoutThankYouPage(pathname) ||
    (isBidDonePage && /\u6700\u9ad8\u984d\u5165\u672d\u8005/.test(text) && !/\u6700\u9ad8\u984d\u5165\u672d\u8005\u3067\u306f\u3042\u308a\u307e\u305b\u3093/.test(text));
}

function isOutbidPage() {
  return isOutbidText();
}

function isHighestBidderPage() {
  return isHighestBidderText();
}

function hasCurrentHighestBidderNotice(text = getBodyText()) {
  return /\u3042\u306a\u305f\u304c\u6700\u9ad8\u984d\u5165\u672d\u8005\u3067\u3059!?/.test(text);
}

function extractAutoBidLimit(text = getBodyText()) {
  const match = String(text || '').match(/\u81ea\u52d5\u5165\u672d\u4e0a\u9650[^\d]{0,30}([\d,]+)\s*\u5186?/);
  return match ? parseInt(match[1].replace(/,/g, ''), 10) || 0 : 0;
}

function hasRaiseBidPrompt() {
  const text = document.body.textContent || '';
  return /\u5024\u6bb5\u3092\u4e0a\u3052\u3066\u5165\u672d/.test(text);
}

function extractTaxIncludedTotal(text = getBodyText()) {
  const match = String(text || '').match(/\u7a0e\u8fbc\u5408\u8a08\u91d1\u984d[^\d]{0,30}([\d,]+)\s*\u5186?/);
  return match ? parseInt(match[1].replace(/,/g, ''), 10) || 0 : 0;
}

function isBidInputPage(text = getBodyText()) {
  return /\u7a0e\u8fbc\u5408\u8a08\u91d1\u984d/.test(text) && /\u78ba\u8a8d\u3059\u308b|\u78ba\u8a8d/.test(text);
}

function getTaxIncludedBidPrice(bidPrice, taxType) {
  const value = Number(bidPrice || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (taxType !== 'tax_included' || value < 10) return Math.floor(value);
  return Math.floor(value * 1.1);
}

function getYahooMinBidIncrement(currentPrice) {
  const value = Number(currentPrice || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value < 1000) return 10;
  if (value < 5000) return 100;
  if (value < 10000) return 250;
  if (value < 50000) return 500;
  return 1000;
}

function resolveMultiBidNextBidPrice({ currentPrice, maxPrice, userMaxPrice, increment, taxType }) {
  const current = Number(currentPrice || 0);
  const max = Number(maxPrice || 0);
  const userMax = Number(userMaxPrice || 0);
  const step = Number(increment || 0);
  if (!current || !max || !userMax || !step) {
    return { success: false, error: 'multi bid price data missing', closeTab: true };
  }

  const minIncrement = getYahooMinBidIncrement(current);
  const normalBidPrice = current + step;
  const normalBidTaxIncludedPrice = getTaxIncludedBidPrice(normalBidPrice, taxType);
  const maxBidTaxIncludedPrice = getTaxIncludedBidPrice(max, taxType);
  const canBidAtMax = max - current >= minIncrement && maxBidTaxIncludedPrice <= userMax;
  const shouldCapToMax = normalBidTaxIncludedPrice > userMax ||
    current + minIncrement * 2 + step > max;

  if (shouldCapToMax && canBidAtMax) {
    return {
      success: true,
      bidPrice: Math.floor(max),
      cappedToMax: true,
      minIncrement
    };
  }

  if (normalBidTaxIncludedPrice > userMax) {
    return {
      success: false,
      error: `加价后金额 ${normalBidTaxIncludedPrice}円 已高于最高价 ${userMax}円，停止出价`,
      currentPrice: normalBidTaxIncludedPrice,
      maxPrice: userMax,
      closeTab: true
    };
  }

  return {
    success: true,
    bidPrice: Math.floor(normalBidPrice),
    minIncrement
  };
}

function isFinalAgreeButtonText(text) {
  return /\u540c\u610f.*(?:\u5165\u672d|\u843d\u672d)|\u4e0a\u8a18.*(?:\u5165\u672d|\u843d\u672d)/.test(text);
}

function isConfirmButtonText(text) {
  return /\u78ba\u8a8d|\u78ba\u8a8d\u753b\u9762|\u5165\u672d\u5185\u5bb9|\u6b21\u3078/.test(text);
}

function isInstantBuyButtonText(text) {
  return /\u4eca\u3059\u3050\u843d\u672d/.test(text);
}

function isStorePurchaseButtonText(text) {
  return /\u8cfc\u5165\u624b\u7d9a\u304d\u3078/.test(text);
}

function isBidEntryButtonText(text, bidMode = 'bid') {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (bidMode === 'buyout') {
    return /\u4eca\u3059\u3050\u843d\u672d/.test(normalized) || isStorePurchaseButtonText(normalized);
  }
  return /(?:^| )\u5165\u672d\u3059\u308b(?: |$)|\u5024\u6bb5\u3092\u4e0a\u3052\u3066\u5165\u672d/.test(normalized);
}

function buildPriceTooHighResult(currentPrice, maxPrice) {
  return {
    success: false,
    error: `当前价格 ${currentPrice}円 已高于最高价 ${maxPrice}円，停止出价`,
    currentPrice,
    maxPrice,
    closeTab: true
  };
}

function validateUserMaxBidLimit(taxTotal, bidPrice, userMaxPrice, taxType) {
  const numericTaxTotal = Number(taxTotal || 0);
  const numericUserMaxPrice = Number(userMaxPrice || 0);
  const plannedTaxIncludedPrice = getTaxIncludedBidPrice(bidPrice, taxType);

  if (numericTaxTotal > 0 && numericTaxTotal > numericUserMaxPrice) {
    return {
      success: false,
      error: `税込合計金額 ${numericTaxTotal}円 已高于最高价 ${numericUserMaxPrice}円，停止出价`,
      currentPrice: numericTaxTotal,
      maxPrice: numericUserMaxPrice,
      closeTab: true
    };
  }

  if (plannedTaxIncludedPrice > numericUserMaxPrice) {
    return {
      success: false,
      error: `出价金额 ${plannedTaxIncludedPrice}円 已高于最高价 ${numericUserMaxPrice}円，停止出价`,
      currentPrice: plannedTaxIncludedPrice,
      maxPrice: numericUserMaxPrice,
      closeTab: true
    };
  }

  return null;
}

async function waitForBidOutcome(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let sawRebidRequired = false;
  while (Date.now() < deadline) {
    if (isHighestBidderPage()) {
      return { success: true };
    }
    if (isYahooBidAccessFailureText()) {
      return { success: false, error: 'Yahoo入札失败：オークションにアクセスできませんでした', closeTab: true };
    }
    if (isOutbidPage()) {
      return { success: false, error: 'outbid after bid', outbid: true, closeTab: true };
    }
    if (isRebidRequiredText()) {
      sawRebidRequired = true;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (sawRebidRequired) {
    return {
      success: false,
      rebidRequired: true,
      error: '再入札が必要です：最高价未超过当前最高出价',
      closeTab: true
    };
  }
  return { success: false, error: '入札結果を確認できません', closeTab: true };
}

async function getTaskData() {
  const result = await chrome.storage.session.get(['currentTask']);
  return result.currentTask || null;
}

async function executeBidV3(maxPrice, options = {}) {
  const numericMaxPrice = Number(maxPrice);
  const numericUserMaxPrice = Number(options.userMaxPrice || maxPrice);
  const numericCurrentPrice = Number(options.currentPrice || 0);
  const numericMultiBidIncrement = Number(options.multiBidIncrement || 0);
  const taxType = options.taxType === 'tax_included' ? 'tax_included' : 'tax_zero';
  const bidMode = options.bidMode === 'buyout' ? 'buyout' : 'bid';
  const strategy = options.strategy || 'direct';
  const bodyText = document.body.textContent || '';

  if (isYahooLoginPageUrl()) {
    return { success: false, error: '需要登录 Yahoo' };
  }

  if (isYahooBidAccessFailureText(bodyText)) {
    return { success: false, error: 'Yahoo入札失败：オークションにアクセスできませんでした', closeTab: true };
  }

  if (bidMode === 'buyout' && Number(extractProductData()?.buyoutPrice || numericMaxPrice || 0) <= 0) {
    return { success: false, error: '出价失败：该商品没有即決价格', closeTab: true };
  }

  if (strategy !== 'multi_bid' && isOutbidPage()) {
    return { success: false, error: 'outbid after bid', outbid: true, closeTab: true };
  }

  if (strategy !== 'multi_bid' && isRebidRequiredText()) {
    return {
      success: false,
      error: '再入札が必要です：最高价未超过当前最高出价',
      outbid: true,
      closeTab: true
    };
  }

  function textOf(el) {
    return `${el.textContent || ''} ${el.value || ''} ${el.getAttribute('aria-label') || ''} ${el.title || ''}`
      .replace(/\s+/g, ' ')
      .trim();
  }

  function clickableSelector() {
    return [
      'a',
      'button',
      'input[type="button"]',
      'input[type="submit"]',
      'input[type="image"]',
      '[role="button"]',
      '[onclick]'
    ].join(',');
  }

  function isUnsafeClickableTarget(el) {
    const href = el?.href || el?.getAttribute?.('href') || '';
    return /support\.yahoo-net\.jp|\/PccAuctions\/|\/jp\/auction\/[a-zA-Z]?\d{8,10}/i.test(href);
  }

  function findClickable(patterns) {
    const selector = clickableSelector();
    const modal = findActiveDialog();
    const modalMatch = findClickableWithin(modal, selector, patterns);
    if (modalMatch) return modalMatch;

    const direct = [...document.querySelectorAll(selector)].find(el => {
      return isClickableElement(el) &&
        patterns.some(pattern => pattern.test(textOf(el)));
    });
    if (direct) return direct;

    const textNodeOwner = [...document.querySelectorAll('body *')]
      .find(el => patterns.some(pattern => pattern.test(textOf(el))));
    const closest = textNodeOwner?.closest(selector) || null;
    return closest && isClickableElement(closest) ? closest : null;
  }

  function findBuyoutReviewConfirmButton() {
    const selector = clickableSelector();
    const isExactConfirm = el => /^\s*\u78ba\u8a8d\u3059\u308b\s*$/.test(textOf(el));
    const controls = [...document.querySelectorAll(selector)]
      .filter(el => isClickableElement(el) && isExactConfirm(el));
    return controls.find(el => /_cl_link:confirm/.test(String(el.getAttribute?.('data-cl-params') || ''))) ||
      controls.find(el => String(el.tagName || '').toUpperCase() === 'A') ||
      controls[0] ||
      null;
  }

  function isBuyoutFinalPurchaseButton(el) {
    return /\u8cfc\u5165\u3092\u78ba\u5b9a\u3059\u308b/.test(textOf(el));
  }

  function findBuyoutFinalPurchaseButton() {
    const selector = clickableSelector();
    const modal = findActiveDialog();
    const modalMatch = modal?.querySelectorAll
      ? [...modal.querySelectorAll(selector)].find(el => isClickableElement(el) && isBuyoutFinalPurchaseButton(el))
      : null;
    if (modalMatch) return modalMatch;

    return [...document.querySelectorAll(selector)]
      .find(el => isClickableElement(el) && isBuyoutFinalPurchaseButton(el)) || null;
  }

  function findActiveDialog() {
    const dialogs = [
      ...document.querySelectorAll('[role="dialog"], [aria-modal="true"], .ReactModal__Content, [class*="modal" i], [class*="dialog" i]')
    ].filter(el => isClickableElement(el));
    return dialogs.find(el => /\u5165\u672d|\u843d\u672d|\u78ba\u8a8d|\u5165\u672d\u984d/.test(textOf(el))) || null;
  }

  function findClickableWithin(container, selector, patterns) {
    if (!container?.querySelectorAll) return null;
    return [...container.querySelectorAll(selector)].find(el => {
      return isClickableElement(el) &&
        patterns.some(pattern => pattern.test(textOf(el)));
    }) || null;
  }

  function findBidEntryButton(mode = 'bid') {
    const selector = clickableSelector();
    return [...document.querySelectorAll(selector)].find(el => {
      return isClickableElement(el) &&
        isBidEntryButtonText(textOf(el), mode);
    }) || null;
  }

  function findBulkPurchaseCheckbox() {
    if (!/\u3053\u306e\u51fa\u54c1\u8005\u306e\u4ed6\u306e\u5546\u54c1\u3068\u307e\u3068\u3081\u3066\u8cfc\u5165\u3059\u308b/.test(getBodyText())) {
      return null;
    }
    const checkboxes = [
      ...document.querySelectorAll('input[type="checkbox"], [role="checkbox"]')
    ].filter(el => isClickableElement(el));
    const matched = checkboxes.find(el => {
      const labelText = [
        textOf(el),
        el.closest?.('label')?.textContent || '',
        el.parentElement?.textContent || ''
      ].join(' ');
      return /\u3053\u306e\u51fa\u54c1\u8005.*\u4ed6\u306e\u5546\u54c1.*\u307e\u3068\u3081\u3066\u8cfc\u5165/.test(labelText);
    });
    return matched || (checkboxes.length === 1 ? checkboxes[0] : null);
  }

  function isClickableElement(el) {
    if (!el || el.disabled || isUnsafeClickableTarget(el)) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  async function waitForClickable(patterns, timeoutMs = 1500) {
    const deadline = Date.now() + timeoutMs;
    let found = findClickable(patterns);
    while (!found && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
      found = findClickable(patterns);
    }
    return found;
  }

  function clickElement(el) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.focus?.();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    if (el.type === 'submit') {
      try {
        el.closest?.('form')?.requestSubmit?.(el);
      } catch (_) {}
    }
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    el.click();
  }

  async function executeMultiBidLoop(attempt = 0) {
    if (attempt > 20) {
      return { success: false, error: 'multi bid retry limit exceeded', closeTab: true };
    }

    if (isHighestBidderPage()) {
      return { success: true, noBid: true, stage: 'already-highest' };
    }

    const autoBidLimit = extractAutoBidLimit();
    if (hasCurrentHighestBidderNotice() && autoBidLimit) {
      const currentTaxExcludedPrice = extractCurrentAuctionPrice() || numericCurrentPrice;
      const plannedBidPrice = currentTaxExcludedPrice && numericMultiBidIncrement
        ? currentTaxExcludedPrice + numericMultiBidIncrement
        : numericMaxPrice;
      const skipResult = buildSkipWhenWithinAutoBidLimit(plannedBidPrice);
      if (skipResult) return skipResult;
    }

    if (isRebidRequiredText()) {
      const rebidBtn = findBidEntryButton('bid');
      if (rebidBtn) {
        clickElement(rebidBtn);
        await new Promise(resolve => setTimeout(resolve, 1200));
        return executeMultiBidLoop(attempt + 1);
      }
    }

    const finalAgreeBtn = findClickable([/\u540c\u610f.*\u5165\u672d/, /\u4e0a\u8a18.*\u5165\u672d/]);
    if (finalAgreeBtn) {
      clickElement(finalAgreeBtn);
      const outcome = await waitForBidOutcome();
      if (!outcome.success && outcome.rebidRequired) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        return executeMultiBidLoop(attempt + 1);
      }
      if (!outcome.success && outcome.outbid) {
        return { success: true, noBid: true, notHighest: true, closeTab: true, stage: 'multi-not-highest-stop' };
      }
      if (!outcome.success) return outcome;
      return { success: true, bidPrice: numericMaxPrice, stage: 'multi-final-submitted' };
    }

    if (isBidInputPage()) {
      const taxTotal = extractTaxIncludedTotal();
      if (taxTotal > 0 && taxTotal > numericUserMaxPrice) {
        return {
          success: false,
          error: `税込合計金額 ${taxTotal}円 已高于最高价 ${numericUserMaxPrice}円，停止出价`,
          currentPrice: taxTotal,
          maxPrice: numericUserMaxPrice,
          closeTab: true
        };
      }
      const currentTaxExcludedPrice = extractCurrentAuctionPrice() || numericCurrentPrice;
      const nextBid = resolveMultiBidNextBidPrice({
        currentPrice: currentTaxExcludedPrice,
        maxPrice: numericMaxPrice,
        userMaxPrice: numericUserMaxPrice,
        increment: numericMultiBidIncrement,
        taxType
      });
      if (!nextBid.success) return nextBid;
      const priceInput = findPriceInput();
      if (!priceInput) {
        return { success: false, error: 'price input not found' };
      }
      priceInput.focus();
      priceInput.value = String(nextBid.bidPrice);
      priceInput.dispatchEvent(new Event('input', { bubbles: true }));
      priceInput.dispatchEvent(new Event('change', { bubbles: true }));
      const confirmBtn = await waitForClickable([/\u78ba\u8a8d\u3059\u308b/, /\u78ba\u8a8d/]);
      if (!confirmBtn) {
        return { success: false, error: 'confirm button not found' };
      }
      clickElement(confirmBtn);
      await new Promise(resolve => setTimeout(resolve, 1200));
      return executeMultiBidLoop(attempt + 1);
    }

    const bidEntryBtn = findBidEntryButton('bid');
    if (!bidEntryBtn) {
      return { success: false, error: 'bid button not found' };
    }
    clickElement(bidEntryBtn);
    await new Promise(resolve => setTimeout(resolve, 1200));
    return executeMultiBidLoop(attempt + 1);
  }

  function findPriceInput() {
    const direct = document.querySelector('input[name="bid"]') ||
      document.querySelector('input[name="Bid"]') ||
      document.querySelector('input[name*="price" i]') ||
      document.querySelector('input[id*="price" i]') ||
      document.querySelector('input[type="number"]');
    if (direct) return direct;

    return [...document.querySelectorAll('input[type="text"], input:not([type])')]
      .find(el => {
        const text = `${el.name || ''} ${el.id || ''} ${el.placeholder || ''} ${el.getAttribute('aria-label') || ''} ${el.closest('label')?.textContent || ''}`;
        return !el.disabled && !el.readOnly && /bid|price|\u5165\u672d|\u91d1\u984d|\u6700\u9ad8|\u5186/i.test(text);
      });
  }

  function validateCurrentPrice() {
    if (bidMode === 'buyout') return null;
    const currentPrice = extractCurrentAuctionPrice();
    // currentPrice 来自 Yahoo HTML price 字段，是税前。numericMaxPrice 也是税前（task.max_price）。
    // 两者同口径直接比较；用 numericUserMaxPrice（税后）会错位。
    if (currentPrice > 0 && currentPrice > numericMaxPrice) {
      return buildPriceTooHighResult(currentPrice, numericMaxPrice);
    }
    return null;
  }

  function validateUserMaxBeforeSubmit(bidPrice = numericMaxPrice) {
    if (bidMode === 'buyout') return null;
    const taxTotal = extractTaxIncludedTotal();
    return validateUserMaxBidLimit(taxTotal, bidPrice, numericUserMaxPrice, taxType);
  }

  function buildSkipWhenWithinAutoBidLimit(plannedBidPrice) {
    const autoBidLimit = extractAutoBidLimit();
    if (!hasCurrentHighestBidderNotice() || !autoBidLimit) return null;
    if (Number(plannedBidPrice || 0) <= autoBidLimit) {
      return {
        success: true,
        noBid: true,
        noStatus: true,
        closeTab: true,
        autoBidLimit,
        bidPrice: plannedBidPrice,
        stage: 'skip-within-auto-bid-limit'
      };
    }
    return null;
  }

  if (strategy === 'multi_bid') {
    return executeMultiBidLoop();
  }

  if (isHighestBidderPage()) {
    return { success: true, bidPrice: numericMaxPrice, stage: 'highest-bidder' };
  }

  if (bidMode === 'buyout') {
    const bulkPurchaseCheckbox = findBulkPurchaseCheckbox();
    const checked = bulkPurchaseCheckbox?.checked === true ||
      bulkPurchaseCheckbox?.getAttribute?.('aria-checked') === 'true';
    if (bulkPurchaseCheckbox && !checked) {
      clickElement(bulkPurchaseCheckbox);
      await new Promise(resolve => setTimeout(resolve, 800));
      return executeBidV3(numericMaxPrice, options);
    }
  }

  const finalAgreeBtn = bidMode === 'buyout'
    ? (findBuyoutFinalPurchaseButton() || findClickable([/\u540c\u610f.*\u843d\u672d/, /\u4e0a\u8a18.*\u843d\u672d/]))
    : findClickable([/\u540c\u610f.*\u5165\u672d/, /\u4e0a\u8a18.*\u5165\u672d/]);
  if (finalAgreeBtn) {
    const isBuyoutFinalPurchase = bidMode === 'buyout' && isBuyoutFinalPurchaseButton(finalAgreeBtn);
    if (isBuyoutFinalPurchase && window.__G_DAIPAI_BUYOUT_FINAL_CLICKED__) {
      const pendingOutcome = await waitForBidOutcome(10000);
      return pendingOutcome.success
        ? { success: true, bidPrice: numericMaxPrice, stage: 'buyout-final-completed-after-wait' }
        : { success: true, bidPrice: numericMaxPrice, pendingFinal: true, stage: 'buyout-final-waiting' };
    }
    const priceError = validateCurrentPrice();
    if (priceError) return priceError;
    const userMaxError = validateUserMaxBeforeSubmit();
    if (userMaxError) return userMaxError;
    if (isBuyoutFinalPurchase) window.__G_DAIPAI_BUYOUT_FINAL_CLICKED__ = true;
    clickElement(finalAgreeBtn);
    const outcome = await waitForBidOutcome();
    if (isBuyoutFinalPurchase && !outcome.success) {
      return { success: true, bidPrice: numericMaxPrice, pendingFinal: true, stage: 'buyout-final-waiting' };
    }
    if (!outcome.success) return outcome;
    return { success: true, bidPrice: numericMaxPrice, stage: 'final-submitted' };
  }

  const priceInput = findPriceInput();
  if (priceInput) {
    const priceError = validateCurrentPrice();
    if (priceError) return priceError;
    const userMaxError = validateUserMaxBeforeSubmit();
    if (userMaxError) return userMaxError;

    priceInput.focus();
    priceInput.value = String(numericMaxPrice);
    priceInput.dispatchEvent(new Event('input', { bubbles: true }));
    priceInput.dispatchEvent(new Event('change', { bubbles: true }));

    const confirmBtn = await waitForClickable([
      /\u78ba\u8a8d/,
      /\u78ba\u8a8d\u753b\u9762/,
      /\u5165\u672d\u5185\u5bb9/,
      /\u6b21\u3078/
    ]);
    if (!confirmBtn) {
      return { success: false, error: 'confirm button not found' };
    }
    clickElement(confirmBtn);
    return { success: true, bidPrice: numericMaxPrice, pendingFinal: true, stage: 'confirm-clicked' };
  }

  const standaloneConfirmBtn = bidMode === 'buyout' ? findBuyoutReviewConfirmButton() : null;
  if (standaloneConfirmBtn) {
    clickElement(standaloneConfirmBtn);
    await new Promise(resolve => setTimeout(resolve, 1200));
    return executeBidV3(numericMaxPrice, options);
  }

  const priceError = validateCurrentPrice();
  if (priceError) return priceError;
  const userMaxError = validateUserMaxBeforeSubmit();
  if (userMaxError) return userMaxError;

  const bidEntryBtn = findBidEntryButton(bidMode);
  if (!bidEntryBtn) {
    return { success: false, error: bidMode === 'buyout' ? 'buyout button not found' : 'bid button not found' };
  }

  clickElement(bidEntryBtn);
  await new Promise(resolve => setTimeout(resolve, 1200));
  return executeBidV3(numericMaxPrice, options);
}

function extractOrderHistory() {
  function normalizeVisibleText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  // Yahoo 落札页的 DOM 结构：标题（含尾部商品代码 F26171）和价格 23,100円 分属不同元素，
  // 用 item.textContent 会把它们拼成 "...F2617123,100円"，正则吃错。
  // 这个函数从容器内部直接找"叶子价格元素"（只含数字+円），返回干净文本。
  function findPriceElementText(container) {
    const candidates = container.querySelectorAll
      ? container.querySelectorAll('span, li, dd, td, p, strong, b')
      : [];
    for (const el of candidates) {
      const text = String(el.textContent || '').replace(/\s+/g, '').trim();
      // 优先匹配 "X,XXX円" 或 "XXX円" 这种纯价格格式（千位逗号分隔）
      const labeledMatch = text.match(/^(\d{1,3}(?:,\d{3})+|\d+)円$/);
      if (labeledMatch) return labeledMatch[1];
    }
    return '';
  }

  function extractOrderPrice(text, container) {
    const value = String(text || '');
    const labeledPatterns = [
      /(?:\u843d\u672d\u4fa1\u683c|\u843d\u672d\u984d|\u843d\u672d\u91d1\u984d|\u652f\u6255\u91d1\u984d|\u5408\u8a08\u91d1\u984d)[^\d]{0,40}([\d,]+)\s*(?:\u5186|JPY)/i,
      /(?:winning\s*bid|winning\s*price|final\s*price|total)[^\d]{0,40}([\d,]+)\s*(?:\u5186|JPY)/i
    ];
    for (const pattern of labeledPatterns) {
      const match = value.match(pattern);
      if (match?.[1]) return match[1];
    }

    // 优先用 DOM 叶子节点查找：避开 textContent 跨元素拼接造成的数字粘连。
    if (container) {
      const fromDom = findPriceElementText(container);
      if (fromDom) return fromDom;
    }

    const lines = value
      .split(/\n+|\r+|\s{2,}/)
      .map(line => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      const match = line.match(/^([\d,]+)\s*(?:\u5186|JPY)$/i);
      if (match?.[1]) return match[1];
    }

    // 最后兜底：要求千位格式（带 ,）或单纯数字 + 円
    const safeYenAmount = value.match(/(\d{1,3}(?:,\d{3})+|\b\d{1,7})\s*(?:\u5186|JPY)/i);
    if (safeYenAmount?.[1]) return safeYenAmount[1];

    return '';
  }

  function extractWonTimeText(text) {
    const match = String(text || '').match(/(\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2})/);
    return match?.[1] || '';
  }

  function extractOrderShippingFeeText(text) {
    const value = String(text || '');
    if (/送料[^\n\r]{0,40}着払い/.test(value)) return '着払い';
    if (/送料[^\n\r]{0,40}無料/.test(value)) return '無料';
    if (/送料[^\n\r]{0,40}落札者負担/.test(value)) return '落札者負担';
    const match = value.match(/送料[^\d]{0,20}([\d,]+)\s*(?:\u5186|JPY)/i);
    return match?.[1] ? `${match[1].replace(/,/g, '')}\u5186` : '';
  }

  const containers = [...document.querySelectorAll('li, article, tr, div')];
  const seen = new Set();
  const orders = [];
  for (const item of containers) {
    const link = [...item.querySelectorAll('a[href*="/jp/auction/"]')]
      .find(a => /[a-zA-Z]?\d{8,10}/.test(a.href));
    if (!link) continue;
    const match = link.href.match(/[a-zA-Z]?\d{8,10}/);
    if (!match) continue;
    const productId = match[0].toLowerCase();
    const text = item.textContent || '';
    const contactLink = [...item.querySelectorAll('a')]
      .find(a => /取引連絡/.test(normalizeVisibleText(a.textContent)));
    if (!contactLink?.href) continue;
    if (seen.has(productId)) continue;
    seen.add(productId);
    const trackingMatch = text.match(/(?:\u304a\u554f\u3044\u5408\u308f\u305b\u756a\u53f7|\u8ffd\u8de1\u756a\u53f7|\u53d7\u4ed8\u756a\u53f7|\u4f1d\u7968\u756a\u53f7|tracking)[^\dA-Z]{0,20}([A-Z0-9-]{8,})/i);
    orders.push({
      productId,
      title: link.textContent?.trim() || '',
      price: extractOrderPrice(text, item),
      wonTimeText: extractWonTimeText(text),
      url: `https://auctions.yahoo.co.jp/jp/auction/${productId}`,
      transactionUrl: contactLink?.href || '',
      trackingNumber: trackingMatch?.[1] || ''
    });
  }
  return orders;
}

function findWonHistoryNextPageUrl() {
  const links = [...document.querySelectorAll('a[href]')];
  const next = links.find(a => {
    if (String(a.getAttribute('rel') || '').toLowerCase() === 'next') return true;
    const text = normalizeVisibleText(a.textContent || a.getAttribute('aria-label') || a.title || '');
    if (!/次へ|次の|次ページ|Next|next|›|»/.test(text)) return false;
    return /\/my\/won/.test(a.href) || /auctions\.yahoo\.co\.jp/.test(a.href);
  });
  return next?.href || '';
}

function extractBiddingItems() {
  function isBiddingStatusText(value) {
    return /\u6700\u9ad8\u984d\u3067\u5165\u672d\u4e2d|\u9ad8\u5024\u66f4\u65b0|\u518d\u5165\u672d\u3059\u308b/.test(String(value || ''));
  }

  function cleanupBiddingTitle(value, productId = '') {
    const lines = String(value || '')
      .replace(/\u6700\u9ad8\u984d\u3067\u5165\u672d\u4e2d|\u9ad8\u5024\u66f4\u65b0|\u518d\u5165\u672d\u3059\u308b/g, '\n')
      .replace(/[\d,]+\s*(?:\u5186|JPY)/gi, '\n')
      .split(/\s*\n+\s*|\s{2,}/)
      .map(line => line.trim())
      .filter(Boolean)
      .filter(line => !isBiddingStatusText(line))
      .filter(line => !/^[\d,]+\s*(?:\u5186|JPY)$/i.test(line))
      .filter(line => !/^\d+\s*$/.test(line))
      .filter(line => line.toLowerCase() !== String(productId || '').toLowerCase());

    return lines.find(line => line.length >= 4) || lines[0] || '';
  }

  function extractBiddingPrice(text) {
    const value = String(text || '');
    const currentMatch = value.match(/\u73fe\u5728[\s\S]{0,120}?([\d,]+)\s*(?:\u5186|JPY)/i);
    if (currentMatch) {
      return currentMatch[1].replace(/,/g, '');
    }

    const matches = [...value.matchAll(/([\d,]+)\s*(?:\u5186|JPY)/gi)]
      .map(match => parseInt(match[1].replace(/,/g, ''), 10))
      .filter(amount => Number.isFinite(amount) && amount > 0);
    return matches.length ? String(matches[0]) : '';
  }

  const seen = new Set();
  const items = [];
  const links = [...document.querySelectorAll('a[href*="/jp/auction/"]')]
    .filter(a => /[a-zA-Z]?\d{8,10}/.test(a.href));

  for (const link of links) {
    const match = link.href.match(/[a-zA-Z]?\d{8,10}/);
    if (!match) continue;
    const productId = match[0].toLowerCase();
    if (seen.has(productId)) continue;

    let item = link;
    let matchedItem = null;
    let depth = 0;
    while (item && item !== document.body && depth < 10) {
      const candidateText = item.textContent || '';
      if (/\u6700\u9ad8\u984d\u3067\u5165\u672d\u4e2d|\u9ad8\u5024\u66f4\u65b0|\u518d\u5165\u672d\u3059\u308b/.test(candidateText)) {
        matchedItem = item;
        if (/\u73fe\u5728[\s\S]{0,120}?[\d,]+(?:\s|\u00a0)*(?:\u5186|JPY)/i.test(candidateText)) {
          break;
        }
      }
      item = item.parentElement;
      depth += 1;
    }
    item = matchedItem;
    if (!item || item === document.body) continue;

    const text = item.textContent || '';
    const hasHighestMark = /\u6700\u9ad8\u984d\u3067\u5165\u672d\u4e2d/.test(text);
    const hasOutbidMark = /\u9ad8\u5024\u66f4\u65b0/.test(text);
    const hasRebidButton = /\u518d\u5165\u672d\u3059\u308b/.test(text);
    if (!hasHighestMark && !hasOutbidMark) continue;

    seen.add(productId);
    const image = item.querySelector('img');
    const title = cleanupBiddingTitle(image?.alt, productId) ||
      cleanupBiddingTitle(link.textContent, productId) ||
      cleanupBiddingTitle(text, productId);
    items.push({
      productId,
      title,
      price: extractBiddingPrice(text),
      url: `https://auctions.yahoo.co.jp/jp/auction/${productId}`,
      imageUrl: image?.src || '',
      status: hasHighestMark && !hasRebidButton ? 'highest' : 'outbid'
    });
  }
  return items;
}

function extractBundleTransactionInfo() {
  const bodyText = document.body?.textContent || '';
  const quantityMatch = bodyText.match(/(\d+)\s*\u4ef6\s*[\uff08(]\s*\u843d\u672d\u6570\u91cf\s*[:\uff1a]\s*(\d+)\s*[\uff09)]/);
  const expectedCount = quantityMatch
    ? Math.max(Number(quantityMatch[1] || 0), Number(quantityMatch[2] || 0))
    : 0;
  const productIds = [];
  const seen = new Set();
  for (const link of [...document.querySelectorAll('a[href*="/jp/auction/"]')]) {
    const match = String(link.href || '').match(/[a-zA-Z]?\d{8,10}/);
    if (!match) continue;
    const productId = match[0].toLowerCase();
    if (seen.has(productId)) continue;
    seen.add(productId);
    productIds.push(productId);
  }
  const hasBundleText = /\u307e\u3068\u3081\u3066\u53d6\u5f15/.test(bodyText);
  const available = hasBundleText && (expectedCount > 1 || productIds.length > 1);
  return {
    available,
    expectedCount,
    productIds,
    quantityMatched: expectedCount > 0 && productIds.length === expectedCount
  };
}

function detectBundleAvailable() {
  return extractBundleTransactionInfo().available;
}

function detectBundleRequestedComplete() {
  return /\u307e\u3068\u3081\u3066\u53d6\u5f15\u3092\u4f9d\u983c\u4e2d\u3067\u3059\u3002?\s*\u51fa\u54c1\u8005\u304b\u3089\u306e\u9023\u7d61\u3092\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002?/.test(document.body?.textContent || '');
}

function findTransactionContactForProduct(productId) {
  const target = String(productId || '').toLowerCase();
  if (!target) return null;
  const candidates = [...document.querySelectorAll('li, article, tr, div')]
    .filter(item => {
      const text = item.textContent || '';
      return text.toLowerCase().includes(target) ||
        [...item.querySelectorAll('a[href*="/jp/auction/"]')]
          .some(a => String(a.href || '').toLowerCase().includes(target));
    })
    .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
  for (const item of candidates) {
    const text = item.textContent || '';
    const textHasProduct = text.toLowerCase().includes(target);
    const linkHasProduct = [...item.querySelectorAll('a[href*="/jp/auction/"]')]
      .some(a => String(a.href || '').toLowerCase().includes(target));
    if (!textHasProduct && !linkHasProduct) continue;
    const contact = [...item.querySelectorAll('a, button, input[type="button"], input[type="submit"]')]
      .find(el => /\u53d6\u5f15\u9023\u7d61/.test(`${el.textContent || ''} ${el.value || ''}`.replace(/\s+/g, ' ').trim()));
    if (contact) return contact;
  }
  return null;
}

function clickTransactionContactForProduct(productId) {
  const contact = findTransactionContactForProduct(productId);
  if (!contact) return { success: false, error: 'transaction contact button not found' };
  const href = contact.href || contact.getAttribute?.('href') || '';
  if (!href) contact.click();
  return { success: true, href, clicked: !href };
}

function getClickableText(el) {
  return [
    el.textContent,
    el.value,
    el.title,
    el.getAttribute?.('aria-label')
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function resolveClickableElement(el) {
  return el.closest?.('button, a, input[type="button"], input[type="submit"], [role="button"], [onclick], [tabindex], [data-cl-params]') || el;
}

function isElementClickable(el) {
  const target = resolveClickableElement(el);
  if (!target || target.disabled) return false;
  const style = window.getComputedStyle ? window.getComputedStyle(target) : null;
  return !(style && (style.display === 'none' || style.visibility === 'hidden'));
}

function isNativeClickableElement(el) {
  return /^(BUTTON|A|INPUT)$/i.test(el?.tagName || '');
}

function isClickableLikeElement(el) {
  return isNativeClickableElement(el) ||
    el?.getAttribute?.('role') === 'button' ||
    typeof el?.onclick === 'function' ||
    el?.hasAttribute?.('onclick') ||
    el?.hasAttribute?.('tabindex') ||
    el?.hasAttribute?.('data-cl-params');
}

function clickElement(el) {
  const target = resolveClickableElement(el);
  target.scrollIntoView?.({ block: 'center', inline: 'center' });
  
  // 方法1: 尝试通过焦点 + Enter 键触发（模拟键盘操作）
  try {
    // 先让元素获得焦点
    target.focus();
    
    // 触发 focusin 事件
    target.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: true }));
    
    // 模拟按下 Enter 键
    const enterKeyDown = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });
    
    const enterKeyPress = new KeyboardEvent('keypress', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });
    
    const enterKeyUp = new KeyboardEvent('keyup', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });
    
    target.dispatchEvent(enterKeyDown);
    target.dispatchEvent(enterKeyPress);
    target.dispatchEvent(enterKeyUp);
    
    console.log('[Yahoo Bid] Keyboard Enter simulation completed');
  } catch (e) {
    console.warn('[Yahoo Bid] Keyboard simulation failed:', e);
  }
  
  // 方法2: 如果是 submit 按钮，尝试直接提交表单
  if (target.type === 'submit') {
    const form = target.closest('form');
    if (form) {
      try {
        if (form.requestSubmit) {
          form.requestSubmit(target);
          return;
        } else {
          form.submit();
          return;
        }
      } catch (e) {
        console.warn('[Yahoo Bid] Form submit failed:', e);
      }
    }
  }
  
  // 方法3: 鼠标事件序列
  const rect = target.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  
  const eventOptions = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    button: 0,
    buttons: 1
  };
  
  target.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
  target.dispatchEvent(new MouseEvent('mousedown', eventOptions));
  target.dispatchEvent(new PointerEvent('pointerup', eventOptions));
  target.dispatchEvent(new MouseEvent('mouseup', eventOptions));
  target.dispatchEvent(new MouseEvent('click', eventOptions));
  
  // 方法4: 原生 click
  target.click();
}

function findClickableByText(pattern, options = {}) {
  const priority = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"], [onclick], [tabindex], [data-cl-params]')];
  const broad = [...document.querySelectorAll('*')];
  const candidates = [...priority, ...broad]
    .filter(el => pattern.test(getClickableText(el)) && isElementClickable(el))
    .filter(el => {
      const target = resolveClickableElement(el);
      if (isClickableLikeElement(target)) return true;
      if (options.nativeOnly) return false;
      return false;
    })
    .sort((a, b) => {
      const aNative = isNativeClickableElement(resolveClickableElement(a)) ? 0 : 1;
      const bNative = isNativeClickableElement(resolveClickableElement(b)) ? 0 : 1;
      if (aNative !== bNative) return aNative - bNative;
      return getClickableText(a).length - getClickableText(b).length;
    });
  return candidates[0] || null;
}

function clickBundleTransactionAction(action) {
  const patterns = {
    close: /\u9589\u3058\u308b/,
    start: /^\s*\u307e\u3068\u3081\u3066\u53d6\u5f15\u3092(?:\u306f\u3058\u3081\u308b|\u4f9d\u983c\u3059\u308b)\s*$/,
    input: /\u53d6\u5f15\s*\u60c5\u5831\s*\u3092\s*\u5165\u529b\s*\u3059\u308b/,
    placementOk: /^\s*OK\s*$/,
    decide: /^\s*(?:\u6c7a\u5b9a\u3059\u308b|\u78ba\u8a8d\u3059\u308b)\s*$/,
    confirm: /\u78ba\u5b9a\u3059\u308b/
  };
  const pattern = patterns[action];
  if (!pattern) return { success: false, error: 'unknown bundle action' };
  const button = findClickableByText(pattern);
  if (!button) return { success: false, error: `bundle ${action} button not found` };
  clickElement(button);
  return { success: true };
}

function detectWaitingShippingPaymentAmount(text = getBodyText()) {
  return /\u652f\u6255\u3044\u91d1\u984d[\s\S]{0,80}\u9001\u6599\u6c7a\u5b9a\u5f8c[\s\S]{0,20}\u78ba\u5b9a\u3057\u307e\u3059/.test(String(text || ''));
}

function detectPlacementDefaultModal(text = getBodyText()) {
  const source = String(text || '');
  return /\u7f6e\u304d\u914d\u5834\u6240[\s\S]{0,40}\u521d\u671f\u8a2d\u5b9a\u3055\u308c\u307e\u3057\u305f/.test(source) &&
    !!findClickableByText(/^\s*OK\s*$/);
}

function normalizeYenText(value) {
  const amount = String(value || '').replace(/[^\d]/g, '');
  return amount ? `${amount}\u5186` : '';
}

function extractWaitingShippingScanResult(text = getBodyText()) {
  const source = String(text || '');
  const shippingMatch = source.match(/\u652f\u6255\u3044\u91d1\u984d[\s\S]{0,200}\u9001\u6599\s*[:\uff1a]\s*([\d,]+)\s*\u5186/);
  if (shippingMatch) {
    return {
      hasShippingFee: true,
      shippingFeeText: normalizeYenText(shippingMatch[1]),
      pending: false
    };
  }
  return {
    hasShippingFee: false,
    shippingFeeText: '',
    pending: detectWaitingShippingPaymentAmount(source)
  };
}

function extractBundleShippingFeeText(text = getBodyText()) {
  const source = String(text || '');
  const paymentMatch = source.match(/\u652f\u6255\u3044\u91d1\u984d[\s\S]{0,240}\u9001\u6599\s*[:\uff1a]\s*([\d,]+)\s*\u5186/);
  if (paymentMatch) return normalizeYenText(paymentMatch[1]);
  const deliveryMatch = source.match(/\u914d\u9001\u65b9\u6cd5[\s\S]{0,160}[\uff08(]\s*([\d,]+)\s*\u5186\s*[\uff09)]/);
  if (deliveryMatch) return normalizeYenText(deliveryMatch[1]);
  return '';
}

function extractBundleScanResult(text = getBodyText()) {
  const source = String(text || '');
  const bundleShippingFeeText = extractBundleShippingFeeText(source);
  if (bundleShippingFeeText) {
    return { type: 'shipping_ready', bundleShippingFeeText };
  }
  if (/\u51fa\u54c1\u8005\u304c\u5358\u54c1\u3067\u306e\u53d6\u5f15\u3092\u5e0c\u671b\u3057\u305f/.test(source)) {
    return { type: 'bundle_rejected' };
  }
  if (/\u3053\u306e\u5546\u54c1\u3092\u542b\u3081\u305f\u307e\u3068\u3081\u3066\u53d6\u5f15\u306b\u540c\u610f\u3057\u307e\u3057\u305f/.test(source)) {
    return { type: 'child_agreed' };
  }
  const canInputTransaction = !!findClickableByText(/\u53d6\u5f15\s*\u60c5\u5831\s*\u3092\s*\u5165\u529b\s*\u3059\u308b/);
  if (/\u51fa\u54c1\u8005\u304c\u307e\u3068\u3081\u3066\u53d6\u5f15\u306b\u540c\u610f\u3057\u307e\u3057\u305f/.test(source) &&
      canInputTransaction &&
      (/\u914d\u9001\u65b9\u6cd5\u306e\u9023\u7d61\u304c\u5c4a\u3044\u3066\u3044\u307e\u3059/.test(source) ||
       /\u914d\u9001\u65b9\u6cd5\u3092\u78ba\u8a8d\u3057\s*\u53d6\u5f15\s*\u60c5\u5831\s*\u3092\s*\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044/.test(source))) {
    return { type: 'input_required' };
  }
  if (/\u51fa\u54c1\u8005\u304c\u307e\u3068\u3081\u3066\u53d6\u5f15\u306b\u540c\u610f\u3057\u307e\u3057\u305f/.test(source) &&
      /\u914d\u9001\u65b9\u6cd5\u306e\u9023\u7d61\u304c\u5c4a\u3044\u3066\u3044\u307e\u3059/.test(source)) {
    return { type: 'main_agreed' };
  }
  if (/\u51fa\u54c1\u8005\u304c\u307e\u3068\u3081\u3066\u53d6\u5f15\u306b\u540c\u610f\u3057\u307e\u3057\u305f/.test(source) &&
      /\u914d\u9001\u65b9\u6cd5\u3092\u78ba\u8a8d\u3057\s*\u53d6\u5f15\s*\u60c5\u5831\s*\u3092\s*\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044/.test(source)) {
    return { type: 'input_required' };
  }
  if (detectBundleRequestedComplete()) {
    return { type: 'waiting_agreement' };
  }
  if (detectWaitingShippingPaymentAmount(source)) {
    return { type: 'shipping_pending' };
  }
  return { type: 'unknown' };
}

function normalizeTextValue(value, maxLength = 128) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

const SHIPMENT_LABELS = [
  '配送業者',
  '配送方法',
  '伝票番号',
  '追跡番号',
  '配送希望日',
  '配送希望時間',
  '購入日時',
  '注文番号'
];

function valueAfterLabel(text, labels) {
  const source = String(text || '');
  for (const label of labels) {
    const index = source.indexOf(label);
    if (index < 0) continue;
    let value = source.slice(index + label.length).replace(/^\s*[:：]?\s*/, '');
    let stopAt = value.length;
    for (const stopLabel of SHIPMENT_LABELS) {
      const stopIndex = value.indexOf(stopLabel);
      if (stopIndex > 0 && stopIndex < stopAt) stopAt = stopIndex;
    }
    value = value.slice(0, stopAt).split(/[\n\r]/)[0];
    return normalizeTextValue(value);
  }
  return '';
}

function extractLabeledValue(labels, text = getBodyText()) {
  const selectors = 'tr, dl, div, li, p';
  const elements = Array.from(document.querySelectorAll(selectors) || []);
  for (const element of elements) {
    const value = valueAfterLabel(element?.textContent || '', labels);
    if (value) return value;
  }
  return valueAfterLabel(text, labels);
}

function extractSellerName(text = getBodyText()) {
  const source = String(text || '');
  const match = source.match(/出品者\s*[:：]\s*([^\n\r（(]+)/);
  return normalizeTextValue(match?.[1] || '');
}

function normalizeNameValue(value, maxLength = 128) {
  return String(value || '').replace(/[ \t\r\n\f]+/g, ' ').trim().slice(0, maxLength);
}

function extractNameValueFromSellerInfoBlock(value) {
  const source = String(value || '');
  const match = source.match(/氏名\s*[:：]?\s*([^\n\r]+)/);
  if (!match?.[1]) return '';
  return normalizeNameValue(match[1].replace(/\s*(?:住所|出品者情報を確認する)[\s\S]*$/, ''));
}

function extractSellerInfoSectionText(value) {
  const source = String(value || '');
  const sellerInfoMatch = /出品者情報(?!を確認する)/.exec(source);
  if (!sellerInfoMatch) return '';
  let section = source.slice(sellerInfoMatch.index);
  const nextSection = section.slice('出品者情報'.length).search(/(?:お届け情報|お支払い情報|落札者情報|お届け先)/);
  if (nextSection >= 0) {
    section = section.slice(0, '出品者情報'.length + nextSection);
  }
  return section;
}

function extractSellerInfoName(text = getBodyText()) {
  const elements = Array.from(document.querySelectorAll('tr, dl, div, li, p') || []);
  let inSellerInfo = false;
  for (const element of elements) {
    const rawText = String(element?.textContent || '');
    const normalized = normalizeTextValue(rawText, 512);
    if (/出品者情報/.test(normalized)) {
      inSellerInfo = true;
    } else if (inSellerInfo && /(?:お届け情報|お支払い情報|落札者情報|お届け先)/.test(normalized)) {
      inSellerInfo = false;
    }
    if (!inSellerInfo && !/出品者情報/.test(normalized)) continue;
    const name = extractNameValueFromSellerInfoBlock(extractSellerInfoSectionText(rawText) || rawText);
    if (name) return name;
  }
  const source = String(text || '');
  return extractNameValueFromSellerInfoBlock(extractSellerInfoSectionText(source));
}

function hasUnregisteredTrackingNumber(text = getBodyText()) {
  const labeledTrackingNumber = extractLabeledValue(['伝票番号', '追跡番号'], text);
  if (/未登録|反映されるまでお待ちください/.test(labeledTrackingNumber)) return true;
  return /(?:伝票番号|追跡番号)\s*[:：]?\s*未登録/.test(String(text || ''));
}

function extractTrackingNumberFromText(text = getBodyText()) {
  const labeledTrackingNumber = extractLabeledValue(['伝票番号', '追跡番号'], text);
  if (labeledTrackingNumber) {
    const labeledMatches = labeledTrackingNumber.match(/(?:\d[\s-]*){12}/g) || [];
    for (const candidate of labeledMatches) {
      const digits = candidate.replace(/\D/g, '');
      if (digits.length === 12) return digits;
    }
  }
  const source = String(text || '');
  const matches = source.match(/(?:\d[\s-]*){12}/g) || [];
  for (const candidate of matches) {
    const digits = candidate.replace(/\D/g, '');
    if (digits.length === 12) return digits;
  }
  return '';
}

function extractShippingCompany(text = getBodyText()) {
  const labeledShippingCompany = extractLabeledValue(['配送業者', '配送方法'], text);
  if (labeledShippingCompany) {
    return normalizeTextValue(labeledShippingCompany
      .replace(/[（(]\s*送料[\s\S]*$/, '')
      .replace(/\s*送料[\s\S]*$/, ''));
  }
  const source = String(text || '');
  const patterns = [
    /配送(?:業者|方法)\s*[:：]\s*([^\n\r]+)/,
    /配送方法\s+([^\n\r:：]+)/,
    /配送業者\s+([^\n\r:：]+)/
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) {
      return normalizeTextValue(match[1]
        .replace(/追跡番号[\s\S]*$/, '')
        .replace(/[（(]\s*送料[\s\S]*$/, '')
        .replace(/送料[\s\S]*$/, ''));
    }
  }
  return '';
}

function extractPendingShipmentScanResult(text = getBodyText()) {
  const source = String(text || '');
  if (/キャンセルされました/.test(source)) {
    return { type: 'cancelled' };
  }

  const storeShipped = /商品が発送されました。?\s*到着までお待ちください/.test(source);
  const normalShipped = /出品者から商品発送の連絡がありました。?\s*到着したら、受け取り連絡をしてください/.test(source);
  if (storeShipped) {
    const trackingNumber = extractTrackingNumberFromText(source);
    const sellerName = extractSellerName(source);
    return {
      type: 'shipped',
      shippingCompany: extractShippingCompany(source),
      trackingNumber: trackingNumber || sellerName,
      trackingFallback: trackingNumber ? '' : (sellerName ? 'seller_name' : '')
    };
  }
  if (normalShipped) {
    if (hasUnregisteredTrackingNumber(source)) {
      return { type: 'pending_shipment' };
    }
    const trackingNumber = extractTrackingNumberFromText(source);
    const sellerInfoName = extractSellerInfoName(source);
    const sellerName = extractSellerName(source);
    return {
      type: 'shipped',
      shippingCompany: extractShippingCompany(source),
      trackingNumber: trackingNumber || sellerInfoName || sellerName,
      trackingFallback: trackingNumber
        ? ''
        : (sellerInfoName ? 'seller_info_name' : (sellerName ? 'seller_name' : ''))
    };
  }

  const storePending = /ご購入ありがとうございます。?\s*商品の発送連絡をお待ちください/.test(source);
  const normalPending = /出品者に支払い完了の連絡をしました。?\s*商品の発送連絡をお待ちください/.test(source);
  if (storePending || normalPending) {
    return { type: 'pending_shipment' };
  }

  return { type: 'unknown' };
}

function getBundleTransactionActionState() {
  return {
    canStart: !!findClickableByText(/^\s*\u307e\u3068\u3081\u3066\u53d6\u5f15\u3092(?:\u306f\u3058\u3081\u308b|\u4f9d\u983c\u3059\u308b)\s*$/),
    canInputTransaction: !!findClickableByText(/\u53d6\u5f15\s*\u60c5\u5831\s*\u3092\s*\u5165\u529b\s*\u3059\u308b/),
    canPlacementOk: detectPlacementDefaultModal(),
    canDecide: !!findClickableByText(/^\s*(?:\u6c7a\u5b9a\u3059\u308b|\u78ba\u8a8d\u3059\u308b)\s*$/),
    canConfirm: !!findClickableByText(/\u78ba\u5b9a\u3059\u308b/),
    waitingShipping: detectWaitingShippingPaymentAmount(),
    complete: detectBundleRequestedComplete(),
    url: window.location.href
  };
}

// Main: read task from storage and execute
if (!CLIENT_ORIGINS.has(window.location.origin)) {
getTaskData().then(taskData => {
  const pageProductData = extractProductData();
  const shouldExecuteBid = taskData?.executeBid &&
    taskData.auctionId &&
    (!pageProductData.auctionId || pageProductData.auctionId === taskData.auctionId);

  if (shouldExecuteBid) {
    executeBidV3(taskData.maxPrice, { bidMode: taskData.bidMode, strategy: taskData.strategy, userMaxPrice: taskData.userMaxPrice, currentPrice: taskData.currentPrice, taxType: taskData.taxType, multiBidIncrement: taskData.multiBidIncrement })
      .then(result => {
        chrome.runtime.sendMessage({ type: 'BID_RESULT', taskId: taskData.taskId, result });
      })
      .catch(err => {
        chrome.runtime.sendMessage({ type: 'BID_RESULT', taskId: taskData.taskId, result: { success: false, error: err.message } });
      });
  } else {
// No task - if on auction page, extract and save product data
    if (pageProductData.auctionId) {
      chrome.storage.session.set({ cachedProduct: pageProductData });
      console.log('[Yahoo Bid] Product extracted:', pageProductData);
    } else if (window.location.href.includes('/my/won')) {
      const orders = extractOrderHistory();
      chrome.runtime.sendMessage({ type: 'ORDER_HISTORY', orders, loginStatus: detectYahooLoginStatus() });
      console.log('[Yahoo Bid] Order history:', orders);
    } else if (window.location.href.includes('/my/bidding')) {
      const items = extractBiddingItems();
      chrome.runtime.sendMessage({ type: 'BIDDING_ITEMS', items, loginStatus: detectYahooLoginStatus() });
      console.log('[Yahoo Bid] Bidding items:', items);
    }
  }
});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_PRODUCT_SNAPSHOT') {
    const pageProductData = extractProductData();
    if (!msg.auctionId || (pageProductData.auctionId && pageProductData.auctionId === msg.auctionId)) {
      sendResponse(pageProductData);
    } else {
      sendResponse({ error: 'current page is not the task product page' });
    }
    return true;
  }

  if (msg.type === 'EXTRACT_BIDDING_ITEMS') {
    const loginStatus = detectYahooLoginStatus();
    sendResponse({ success: loginStatus.status === 'ok', items: loginStatus.status === 'ok' ? extractBiddingItems() : [], loginStatus });
    return true;
  }

  if (msg.type === 'EXTRACT_ORDER_HISTORY') {
    const loginStatus = detectYahooLoginStatus();
    sendResponse({ success: loginStatus.status === 'ok', orders: loginStatus.status === 'ok' ? extractOrderHistory() : [], loginStatus });
    return true;
  }

  if (msg.type === 'EXTRACT_ORDER_IMPORT_PAGE') {
    const loginStatus = detectYahooLoginStatus();
    sendResponse({
      success: loginStatus.status === 'ok',
      orders: loginStatus.status === 'ok' ? extractOrderHistory() : [],
      nextPageUrl: loginStatus.status === 'ok' ? findWonHistoryNextPageUrl() : '',
      loginStatus
    });
    return true;
  }

  if (msg.type === 'EXTRACT_TRANSACTION_START_INFO') {
    const loginStatus = detectYahooLoginStatus();
    sendResponse({
      success: loginStatus.status === 'ok',
      info: loginStatus.status === 'ok' ? extractBundleTransactionInfo() : null,
      complete: loginStatus.status === 'ok' ? detectBundleRequestedComplete() : false,
      loginStatus
    });
    return true;
  }

  if (msg.type === 'EXTRACT_WAITING_SHIPPING_SCAN') {
    const loginStatus = detectYahooLoginStatus();
    sendResponse({
      success: loginStatus.status === 'ok',
      result: loginStatus.status === 'ok' ? extractWaitingShippingScanResult() : null,
      loginStatus
    });
    return true;
  }

  if (msg.type === 'EXTRACT_BUNDLE_SCAN') {
    const loginStatus = detectYahooLoginStatus();
    sendResponse({
      success: loginStatus.status === 'ok',
      result: loginStatus.status === 'ok' ? extractBundleScanResult() : null,
      loginStatus
    });
    return true;
  }

  if (msg.type === 'EXTRACT_PENDING_SHIPMENT_SCAN') {
    const loginStatus = detectYahooLoginStatus();
    sendResponse({
      success: loginStatus.status === 'ok',
      result: loginStatus.status === 'ok' ? extractPendingShipmentScanResult() : null,
      loginStatus
    });
    return true;
  }

  if (msg.type === 'CLICK_TRANSACTION_CONTACT') {
    sendResponse(clickTransactionContactForProduct(msg.productId));
    return true;
  }

  if (msg.type === 'CLICK_BUNDLE_TRANSACTION_ACTION') {
    sendResponse(clickBundleTransactionAction(msg.action));
    return true;
  }

  if (msg.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
    sendResponse({ success: true, state: getBundleTransactionActionState() });
    return true;
  }

  if (msg.type !== 'EXECUTE_BID') return;
  const pageProductData = extractProductData();
  if (!msg.auctionId || (pageProductData.auctionId && pageProductData.auctionId !== msg.auctionId)) {
    sendResponse({ success: false, error: 'current page is not the task product page' });
    return true;
  }

  executeBidV3(msg.maxPrice, { bidMode: msg.bidMode, strategy: msg.strategy, userMaxPrice: msg.userMaxPrice, currentPrice: msg.currentPrice, taxType: msg.taxType, multiBidIncrement: msg.multiBidIncrement })
    .then(result => sendResponse(result))
    .catch(err => sendResponse({ success: false, error: err.message }));
  return true;
});

window.__G_DAIPAI_TEST__ = {
  isOutbidText: () => isOutbidText(),
  isRebidRequiredText: () => isRebidRequiredText(),
  isYahooBidAccessFailureText: () => isYahooBidAccessFailureText(),
  isHighestBidderText: () => isHighestBidderText(),
  hasCurrentHighestBidderNotice: () => hasCurrentHighestBidderNotice(),
  extractAutoBidLimit: () => extractAutoBidLimit(),
  extractProductData: () => extractProductData(),
  extractCurrentAuctionPrice: () => extractCurrentAuctionPrice(),
  extractBiddingItems,
  extractBundleTransactionInfo,
  detectBundleAvailable,
  detectBundleRequestedComplete,
  clickTransactionContactForProduct,
  clickBundleTransactionAction,
  getBundleTransactionActionState,
  detectWaitingShippingPaymentAmount,
  extractWaitingShippingScanResult,
  extractBundleScanResult,
  extractPendingShipmentScanResult,
  extractSellerInfoName,
  extractTrackingNumberFromText,
  extractShippingCompany,
  extractSellerName,
  detectYahooLoginStatus,
  extractTaxIncludedTotal: () => extractTaxIncludedTotal(),
  getTaxIncludedBidPrice,
  getYahooMinBidIncrement,
  resolveMultiBidNextBidPrice,
  validateUserMaxBidLimit,
  executeBidV3,
  isBidInputPage: () => isBidInputPage(),
  isInstantBuyButtonText,
  isStorePurchaseButtonText,
  isBidEntryButtonText,
  isFinalAgreeButtonText,
  isConfirmButtonText,
  extractOrderHistory
};
})();

