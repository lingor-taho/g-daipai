// content.js 鈥?Injected into Yahoo Auction pages

(() => {
if (window.__G_DAIPAI_CONTENT_LOADED__) {
  return;
}
window.__G_DAIPAI_CONTENT_LOADED__ = true;

const API_BASE = 'http://localhost:3000';
const CLIENT_ORIGINS = new Set(['http://localhost:3001', 'http://127.0.0.1:3001']);

function cleanupProductTitle(title, auctionId = '') {
  const cleaned = String(title || '')
    .replace(/^Yahoo![^-\n]*オークション\s*-\s*/i, '')
    .replace(/\s*-\s*Yahoo![^-\n]*オークション.*$/i, '')
    .trim();
  if (cleaned && !/^Yahoo![^-\n]*オークション$/i.test(cleaned)) return cleaned;
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
    const m = bodyText.match(/(?:現在|current)[^\d]{0,20}([\d,]+)/i);
    if (m) return parseInt(m[1].replace(/,/g, ''));
    return 0;
  }

  function getBuyoutPrice() {
    const pageDataItems = getPageDataItems();
    if (pageDataItems && Object.prototype.hasOwnProperty.call(pageDataItems, 'winPrice')) {
      return parseYen(pageDataItems.winPrice);
    }

    const bodyText = document.body.textContent || '';
    const match = bodyText.match(/即決(?:価格)?[^\d]{0,20}([\d,]+)\s*(?:円|JPY)?/i);
    return match ? parseInt(match[1].replace(/,/g, ''), 10) || 0 : 0;
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
    endTime: getEndTime(),
    imageUrl: getImage()
  };
}

function parseYen(text) {
  const match = String(text || '').match(/([\d,]+)\s*(?:円|JPY)?/);
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

function isOutbidText(text = getBodyText()) {
  if (hasBidSuccessText(text)) return false;
  return /再入札|値段を上げて入札|最高額入札者ではありません|高値更新/.test(text);
}

function hasBidSuccessText(text = getBodyText()) {
  return /あなたが最高額入札者です|入札が完了しました|入札を受け付けました|入札しました|落札が完了しました|落札しました|落札を受け付けました/.test(text);
}

function isHighestBidderText(text = getBodyText(), pathname = window.location.pathname) {
  const isBidDonePage = /\/jp\/auction\/[a-zA-Z]?\d{8,10}\/bid\/done/.test(pathname);
  return hasBidSuccessText(text) ||
    (isBidDonePage && /最高額入札者/.test(text) && !/最高額入札者ではありません/.test(text));
}

function isOutbidPage() {
  return isOutbidText();
}

function isHighestBidderPage() {
  return isHighestBidderText();
}

function hasRaiseBidPrompt() {
  const text = document.body.textContent || '';
  return /値段を上げて入札/.test(text);
}

function isFinalAgreeButtonText(text) {
  return /同意.*(?:入札|落札)|上記.*(?:入札|落札)/.test(text);
}

function isConfirmButtonText(text) {
  return /確認|確認画面|入札内容|次へ/.test(text);
}

function isInstantBuyButtonText(text) {
  return /今すぐ落札/.test(text);
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

async function waitForBidOutcome(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isHighestBidderPage()) {
      return { success: true };
    }
    if (isOutbidPage()) {
      return { success: false, error: 'outbid after bid', outbid: true, closeTab: true };
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return { success: false, error: '入札結果を確認できません', closeTab: true };
}

async function getTaskData() {
  const result = await chrome.storage.session.get(['currentTask']);
  return result.currentTask || null;
}

async function executeBidV3(maxPrice, options = {}) {
  const numericMaxPrice = Number(maxPrice);
  const bidMode = options.bidMode === 'buyout' ? 'buyout' : 'bid';
  const bodyText = document.body.textContent || '';

  if (/ログイン.*必要|ログインしてください/.test(bodyText)) {
    return { success: false, error: '需要登录 Yahoo' };
  }

  if (bidMode === 'buyout' && Number(extractProductData()?.buyoutPrice || 0) <= 0) {
    return { success: false, error: '出价失败：该商品没有即決价格', closeTab: true };
  }

  if (isOutbidPage()) {
    return { success: false, error: 'outbid after bid', outbid: true, closeTab: true };
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

  function findClickable(patterns) {
    const selector = clickableSelector();
    const direct = [...document.querySelectorAll(selector)].find(el => {
      const style = window.getComputedStyle(el);
      return !el.disabled &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        patterns.some(pattern => pattern.test(textOf(el)));
    });
    if (direct) return direct;

    const textNodeOwner = [...document.querySelectorAll('body *')]
      .find(el => patterns.some(pattern => pattern.test(textOf(el))));
    return textNodeOwner?.closest(selector) || null;
  }

  function clickElement(el) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    el.click();
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
        return !el.disabled && !el.readOnly && /bid|price|入札|金額|最高|円/i.test(text);
      });
  }

  function validateCurrentPrice() {
    const currentPrice = extractCurrentAuctionPrice();
    if (currentPrice > 0 && currentPrice > numericMaxPrice) {
      return buildPriceTooHighResult(currentPrice, numericMaxPrice);
    }
    return null;
  }

  if (isHighestBidderPage()) {
    return { success: true, bidPrice: numericMaxPrice, stage: 'highest-bidder' };
  }

  const finalAgreePatterns = bidMode === 'buyout'
    ? [/同意.*落札/, /上記.*落札/]
    : [/同意.*入札/, /上記.*入札/];
  const finalAgreeBtn = findClickable(finalAgreePatterns);
  if (finalAgreeBtn) {
    const priceError = validateCurrentPrice();
    if (priceError) return priceError;
    clickElement(finalAgreeBtn);
    const outcome = await waitForBidOutcome();
    if (!outcome.success) return outcome;
    return { success: true, bidPrice: numericMaxPrice, stage: 'final-submitted' };
  }

  const priceInput = findPriceInput();
  if (priceInput) {
    const priceError = validateCurrentPrice();
    if (priceError) return priceError;

    priceInput.focus();
    priceInput.value = String(numericMaxPrice);
    priceInput.dispatchEvent(new Event('input', { bubbles: true }));
    priceInput.dispatchEvent(new Event('change', { bubbles: true }));

    const confirmBtn = findClickable([
      /確認/,
      /確認画面/,
      /入札内容/,
      /次へ/
    ]);
    if (!confirmBtn) {
      return { success: false, error: 'confirm button not found' };
    }
    clickElement(confirmBtn);
    return { success: true, bidPrice: numericMaxPrice, pendingFinal: true, stage: 'confirm-clicked' };
  }

  const standaloneConfirmBtn = bidMode === 'buyout' ? findClickable([
    /確認/,
    /確認画面/,
    /入札内容/,
    /次へ/
  ]) : null;
  if (standaloneConfirmBtn) {
    clickElement(standaloneConfirmBtn);
    await new Promise(resolve => setTimeout(resolve, 1200));
    return executeBidV3(numericMaxPrice, options);
  }

  const bidEntryBtn = findClickable(bidMode === 'buyout' ? [/今すぐ落札/] : [/入札/]);
  if (!bidEntryBtn) {
    return { success: false, error: bidMode === 'buyout' ? 'buyout button not found' : 'bid button not found' };
  }

  const priceError = validateCurrentPrice();
  if (priceError) return priceError;

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
    const trackingMatch = text.match(/(?:お問い合わせ番号|追跡番号|伝票番号|配送番号|tracking)[^\dA-Z]{0,20}([A-Z0-9-]{8,})/i);
    orders.push({
      productId,
      title: link.textContent?.trim() || '',
      price: text.match(/([\d,]+)\s*(?:円|JPY)?/)?.[1] || '',
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
    executeBidV3(taskData.maxPrice, { bidMode: taskData.bidMode })
      .then(result => {
        chrome.runtime.sendMessage({ type: 'BID_RESULT', taskId: taskData.taskId, result });
      })
      .catch(err => {
        chrome.runtime.sendMessage({ type: 'BID_RESULT', taskId: taskData.taskId, result: { success: false, error: err.message } });
      });
  } else {
    // No task 鈥?if on auction page, extract and save product data
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

  executeBidV3(msg.maxPrice, { bidMode: msg.bidMode })
    .then(result => sendResponse(result))
    .catch(err => sendResponse({ success: false, error: err.message }));
  return true;
});

window.__G_DAIPAI_TEST__ = {
  isOutbidText: () => isOutbidText(),
  isHighestBidderText: () => isHighestBidderText(),
  extractProductData: () => extractProductData(),
  extractCurrentAuctionPrice: () => extractCurrentAuctionPrice(),
  isInstantBuyButtonText,
  isFinalAgreeButtonText,
  isConfirmButtonText
};
})();

