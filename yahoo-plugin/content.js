// content.js - Injected into Yahoo Auction pages

(() => {
if (window.__G_DAIPAI_CONTENT_LOADED__) {
  return;
}
window.__G_DAIPAI_CONTENT_LOADED__ = true;

const API_BASE = 'http://localhost:3034';
const CLIENT_ORIGINS = new Set(['http://localhost:3035', 'http://127.0.0.1:3035']);

function cleanupProductTitle(title, auctionId = '') {
  const cleaned = String(title || '')
    .replace(/^Yahoo![^-\n]*\u30aa\u30fc\u30af\u30b7\u30e7\u30f3\s*-\s*/i, '')
    .replace(/\s*-\s*Yahoo![^-\n]*\u30aa\u30fc\u30af\u30b7\u30e7\u30f3.*$/i, '')
    .trim();
  if (cleaned && !/^Yahoo![^-\n]*\u30aa\u30fc\u30af\u30b7\u30e7\u30f3$/i.test(cleaned)) return cleaned;
  return auctionId ? ('商品 ' + auctionId) : '';
}

if (CLIENT_ORIGINS.has(window.location.origin)) {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== 'g-daipai-client' || msg.type !== 'GET_PRODUCT_INFO') return;

    chrome.runtime.sendMessage(
      { type: 'FETCH_PRODUCT', auctionId: msg.auctionId, url: msg.url },
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
    return match ? parseInt(match[1].replace(/,/g, ''), 10) || 0 : 0;
  }

  function getTaxType() {
    const text = document.body.textContent || '';
    if (/\uff08\s*\u7a0e\s*0\s*\u5186\s*\uff09|\(\s*\u7a0e\s*0\s*\u5186\s*\)/.test(text)) return 'tax_zero';
    if (/\uff08\s*\u7a0e\u8fbc\s*\uff09|\(\s*\u7a0e\u8fbc\s*\)/.test(text)) return 'tax_included';
    return 'tax_zero';
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
  return /\u5165\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f|\u5165\u672d\u3092\u53d7\u3051\u4ed8\u3051\u307e\u3057\u305f|\u5165\u672d\u3057\u307e\u3057\u305f|\u843d\u672d\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f|\u843d\u672d\u3057\u307e\u3057\u305f|\u843d\u672d\u3092\u53d7\u3051\u4ed8\u3051\u307e\u3057\u305f/.test(text);
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

function isBidEntryButtonText(text, bidMode = 'bid') {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (bidMode === 'buyout') {
    return /\u4eca\u3059\u3050\u843d\u672d/.test(normalized);
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

  if (bidMode === 'buyout' && Number(extractProductData()?.buyoutPrice || 0) <= 0) {
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
    return /support\.yahoo-net\.jp|\/PccAuctions\//i.test(href);
  }

  function findClickable(patterns) {
    const selector = clickableSelector();
    const direct = [...document.querySelectorAll(selector)].find(el => {
      const style = window.getComputedStyle(el);
      return !el.disabled &&
        !isUnsafeClickableTarget(el) &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        patterns.some(pattern => pattern.test(textOf(el)));
    });
    if (direct) return direct;

    const textNodeOwner = [...document.querySelectorAll('body *')]
      .find(el => patterns.some(pattern => pattern.test(textOf(el))));
    const closest = textNodeOwner?.closest(selector) || null;
    return closest && !isUnsafeClickableTarget(closest) ? closest : null;
  }

  function findBidEntryButton(mode = 'bid') {
    const selector = clickableSelector();
    return [...document.querySelectorAll(selector)].find(el => {
      const style = window.getComputedStyle(el);
      return !el.disabled &&
        !isUnsafeClickableTarget(el) &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        isBidEntryButtonText(textOf(el), mode);
    }) || null;
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
      const confirmBtn = findClickable([/\u78ba\u8a8d\u3059\u308b/, /\u78ba\u8a8d/]);
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

    const confirmBtn = findClickable([
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
  const autoBidSkip = buildSkipWhenWithinAutoBidLimit(numericMaxPrice);
  if (autoBidSkip) return autoBidSkip;

  const bidEntryBtn = findBidEntryButton(bidMode);
  if (!bidEntryBtn) {
    return { success: false, error: bidMode === 'buyout' ? 'buyout button not found' : 'bid button not found' };
  }

  clickElement(bidEntryBtn);
  await new Promise(resolve => setTimeout(resolve, 1200));
  return executeBidV3(numericMaxPrice, options);
}

function extractOrderHistory() {
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
      price: text.match(/([\d,]+)\s*(?:\u5186|JPY)?/)?.[1] || '',
      url: `https://auctions.yahoo.co.jp/jp/auction/${productId}`,
      trackingNumber: trackingMatch?.[1] || ''
    });
  }
  return orders;
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
      // Notify background that product data is available
      chrome.runtime.sendMessage({ type: 'PRODUCT_DATA', data: pageProductData });
      console.log('[Yahoo Bid] Product extracted:', pageProductData);
    } else if (window.location.href.includes('/my/won')) {
      const orders = extractOrderHistory();
      chrome.runtime.sendMessage({ type: 'ORDER_HISTORY', orders });
      console.log('[Yahoo Bid] Order history:', orders);
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
  extractTaxIncludedTotal: () => extractTaxIncludedTotal(),
  getTaxIncludedBidPrice,
  validateUserMaxBidLimit,
  executeBidV3,
  isBidInputPage: () => isBidInputPage(),
  isInstantBuyButtonText,
  isBidEntryButtonText,
  isFinalAgreeButtonText,
  isConfirmButtonText
};
})();

