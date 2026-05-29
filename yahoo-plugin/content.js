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
      return parseYen(pageDataItems.winPrice);
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

    const el = document.querySelector('[class*="endedTime"]') ||
               document.querySelector('[class*="endTime"]') ||
               document.querySelector('[class*="countdown"]') ||
               document.querySelector('[data-end-time]') ||
               document.querySelector('[class*="closeTime"]');
    if (el) {
      return el.textContent.trim() || el.getAttribute('data-end-time') || '';
    }
    // Fallback: look for date patterns
    const bodyText = document.body.textContent;
    const m = bodyText.match(/\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s*[\d:]+/);
    return m ? m[0] : '';
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

function detectYahooLoginStatus() {
  const text = getBodyText();
  const href = window.location.href;
  const isLoginUrl = /login\.yahoo\.co\.jp|account\.edit\.yahoo\.co\.jp/i.test(href);
  const hasLoginPrompt = /\u30ed\u30b0\u30a4\u30f3.*\u5fc5\u8981|\u30ed\u30b0\u30a4\u30f3\u3057\u3066\u304f\u3060\u3055\u3044|ログイン.*必要|ログインしてください|Yahoo! JAPAN ID/i.test(text);
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

function hasBidSuccessText(text = getBodyText()) {
  return /\u5165\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f|\u5165\u672d\u3092\u53d7\u3051\u4ed8\u3051\u307e\u3057\u305f|\u5165\u672d\u3057\u307e\u3057\u305f|\u843d\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f|\u843d\u672d\u3057\u307e\u3057\u305f|\u843d\u672d\u3092\u53d7\u3051\u4ed8\u3051\u307e\u3057\u305f|\u3053\u306e\u5546\u54c1\u3092\u843d\u672d\u3057\u307e\u3057\u305f\u304c|\u307e\u3060\u8cfc\u5165\u624b\u7d9a\u304d\u304c\u5b8c\u4e86\u3057\u3066\u3044\u307e\u305b\u3093/.test(text);
}

function isHighestBidderText(text = getBodyText(), pathname = window.location.pathname) {
  const isBidDonePage = /\/jp\/auction\/[a-zA-Z]?\d{8,10}\/bid\/done/.test(pathname);
  if (hasExplicitOutbidText(text)) return false;
  if (isRebidRequiredText(text)) return false;
  return hasBidSuccessText(text) ||
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

async function waitForBidOutcome(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let sawRebidRequired = false;
  while (Date.now() < deadline) {
    if (isHighestBidderPage()) {
      return { success: true };
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

  if (/\u30ed\u30b0\u30a4\u30f3.*\u5fc5\u8981|\u30ed\u30b0\u30a4\u30f3\u3057\u3066\u304f\u3060\u3055\u3044/.test(bodyText)) {
    return { success: false, error: '需要登录 Yahoo' };
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
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
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
      const nextBidPrice = currentTaxExcludedPrice + numericMultiBidIncrement;
      const nextBidTaxIncludedPrice = getTaxIncludedBidPrice(nextBidPrice, taxType);
      if (!currentTaxExcludedPrice || !numericMultiBidIncrement) {
        return { success: false, error: 'multi bid price data missing', closeTab: true };
      }
      if (nextBidTaxIncludedPrice > numericUserMaxPrice) {
        return {
          success: false,
          error: `加价后金额 ${nextBidTaxIncludedPrice}円 已高于最高价 ${numericUserMaxPrice}円，停止出价`,
          currentPrice: nextBidTaxIncludedPrice,
          maxPrice: numericUserMaxPrice,
          closeTab: true
        };
      }
      const priceInput = findPriceInput();
      if (!priceInput) {
        return { success: false, error: 'price input not found' };
      }
      priceInput.focus();
      priceInput.value = String(nextBidPrice);
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
    const currentPrice = extractCurrentAuctionPrice();
    // currentPrice 来自 Yahoo HTML price 字段，是税前。numericMaxPrice 也是税前（task.max_price）。
    // 两者同口径直接比较；用 numericUserMaxPrice（税后）会错位。
    if (currentPrice > 0 && currentPrice > numericMaxPrice) {
      return buildPriceTooHighResult(currentPrice, numericMaxPrice);
    }
    return null;
  }

  function validateUserMaxBeforeSubmit(bidPrice = numericMaxPrice) {
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

  const finalAgreePatterns = bidMode === 'buyout'
    ? [/\u540c\u610f.*\u843d\u672d/, /\u4e0a\u8a18.*\u843d\u672d/]
    : [/\u540c\u610f.*\u5165\u672d/, /\u4e0a\u8a18.*\u5165\u672d/];
  const finalAgreeBtn = findClickable(finalAgreePatterns);
  if (finalAgreeBtn) {
    const priceError = validateCurrentPrice();
    if (priceError) return priceError;
    const userMaxError = validateUserMaxBeforeSubmit();
    if (userMaxError) return userMaxError;
    clickElement(finalAgreeBtn);
    const outcome = await waitForBidOutcome();
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

  const standaloneConfirmBtn = bidMode === 'buyout' ? findClickable([
    /\u78ba\u8a8d/,
    /\u78ba\u8a8d\u753b\u9762/,
    /\u5165\u672d\u5185\u5bb9/,
    /\u6b21\u3078/
  ]) : null;
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
    if (seen.has(productId)) continue;
    seen.add(productId);
    const text = item.textContent || '';
    const trackingMatch = text.match(/(?:\u304a\u554f\u3044\u5408\u308f\u305b\u756a\u53f7|\u8ffd\u8de1\u756a\u53f7|\u53d7\u4ed8\u756a\u53f7|\u4f1d\u7968\u756a\u53f7|tracking)[^\dA-Z]{0,20}([A-Z0-9-]{8,})/i);
    orders.push({
      productId,
      title: link.textContent?.trim() || '',
      price: extractOrderPrice(text, item),
      wonTimeText: extractWonTimeText(text),
      url: `https://auctions.yahoo.co.jp/jp/auction/${productId}`,
      trackingNumber: trackingMatch?.[1] || ''
    });
  }
  return orders;
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
  isHighestBidderText: () => isHighestBidderText(),
  hasCurrentHighestBidderNotice: () => hasCurrentHighestBidderNotice(),
  extractAutoBidLimit: () => extractAutoBidLimit(),
  extractProductData: () => extractProductData(),
  extractCurrentAuctionPrice: () => extractCurrentAuctionPrice(),
  extractBiddingItems,
  detectYahooLoginStatus,
  extractTaxIncludedTotal: () => extractTaxIncludedTotal(),
  getTaxIncludedBidPrice,
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

