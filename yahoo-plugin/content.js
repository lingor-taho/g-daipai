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

const MULTI_BID_INPUT_SUBMIT_DELAY_MS = 800;
const MULTI_BID_REBID_SUBMIT_DELAY_MS = 1000;
const MULTI_BID_PAGE_STEP_DELAY_MS = 2000;
const MULTI_BID_REBID_STABLE_DELAY_MS = 6000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeVisibleText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanupProductTitle(title, auctionId = '') {
  const cleaned = String(title || '')
    .replace(/^Yahoo![^-\n]*\u30aa\u30fc\u30af\u30b7\u30e7\u30f3\s*-\s*/i, '')
    .replace(/\s*-\s*Yahoo![^-\n]*\u30aa\u30fc\u30af\u30b7\u30e7\u30f3.*$/i, '')
    .trim();
  if (cleaned && !/^Yahoo![^-\n]*\u30aa\u30fc\u30af\u30b7\u30e7\u30f3$/i.test(cleaned)) return cleaned;
  return auctionId ? ('闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻閻愭亽鈧啴宕ㄧ划鍏夊亾閿曞倸惟闁宠桨绶氶崬璺衡攽閻樼粯娑ч柣妤€绻愰悾鐑藉醇閺囩啿鎷虹紒缁㈠幖閹冲孩绂嶈ぐ鎺撳仩婵炴垶鐗曢崝锔锯偓瑙勬礀缂嶅﹪鐛崱姘兼Х濠碘剝褰冮悧濠冪┍婵犲浂鏁嶆繛鎴炴皑閻撲礁鈹戦埥鍡椾簻闁哥噥鍋婇幃楣冩倻閽樺）鈺呮煃閸濆嫸鏀婚柡鍜冪秮濮婅櫣绱掑Ο鍏煎枦闂佺顑嗛幑鍥蓟?' + auctionId) : '';
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
    const postageIndex = bodyText.search(/\u9001\u6599|\u9001\u6599\u8ca0\u62c5|\u914d\u9001\u65b9\u6cd5/);
    const fallbackText = !shippingInput && !shippingCharge && postageIndex >= 0
      ? bodyText.slice(postageIndex, postageIndex + 300)
      : '';
    const sourceText = `${postageText} ${nextDataShippingText} ${fallbackText}`;
    const priceMatch = sourceText.match(/\u9001\u6599[^\d]{0,40}([\d,]+)\s*\u5186/);
    if (priceMatch?.[1]) return priceMatch[1].replace(/,/g, '') + '\u5186';
    const labelText = `${postageText} ${fallbackText} ${shippingInput} ${shippingCharge}`;
    if (/\u7740\u6255\u3044/.test(labelText)) return '\u7740\u6255\u3044';
    if (/seller/i.test(shippingCharge)) return '\u7121\u6599';
    if (/\u7121\u6599/.test(labelText)) return '\u7121\u6599';
    if (/\u843d\u672d\u8005\u8ca0\u62c5|winner/i.test(labelText)) return '\u843d\u672d\u8005\u8ca0\u62c5';
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
    if (pageDataTitle && pageDataTitle !== '闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻閻愭亽鈧啴宕ㄧ划鍏夊亾閿曞倸惟闁宠桨绶氶崬璺衡攽閻樼粯娑ч柣妤€绻愰悾鐑藉醇閺囩啿鎷虹紒缁㈠幖閹冲孩绂嶈ぐ鎺撳仩婵炴垶鐗曢崝锔锯偓瑙勬礀缂嶅﹪鐛崱姘兼Х濠碘剝褰冮悧濠冪┍婵犲浂鏁嶆繛鎴炴皑閻撲礁鈹戦埥鍡椾簻闁哥噥鍋婇幃楣冩倻閽樺）鈺呮煃閸濆嫸鏀婚柡鍜冪秮濮婅櫣绱掑Ο鍏煎枦闂佺顑嗛幑鍥蓟?' + auctionId) return pageDataTitle;

    const nextDataItem = getNextDataItem();
    const nextDataTitle = cleanupProductTitle(
      nextDataItem?.productName || nextDataItem?.title || nextDataItem?.name,
      auctionId
    );
    if (nextDataTitle && nextDataTitle !== '闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻閻愭亽鈧啴宕ㄧ划鍏夊亾閿曞倸惟闁宠桨绶氶崬璺衡攽閻樼粯娑ч柣妤€绻愰悾鐑藉醇閺囩啿鎷虹紒缁㈠幖閹冲孩绂嶈ぐ鎺撳仩婵炴垶鐗曢崝锔锯偓瑙勬礀缂嶅﹪鐛崱姘兼Х濠碘剝褰冮悧濠冪┍婵犲浂鏁嶆繛鎴炴皑閻撲礁鈹戦埥鍡椾簻闁哥噥鍋婇幃楣冩倻閽樺）鈺呮煃閸濆嫸鏀婚柡鍜冪秮濮婅櫣绱掑Ο鍏煎枦闂佺顑嗛幑鍥蓟?' + auctionId) return nextDataTitle;

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

function isTaxIncludedPriceText(text) {
  return /\u7a0e\u8fbc|\uff08\s*\u7a0e\u8fbc\s*\uff09|\(\s*\u7a0e\u8fbc\s*\)/.test(String(text || ''));
}

function toTaxExcludedBidPrice(price, text, taxType) {
  const value = Number(price || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (taxType === 'tax_included' && value >= 10 && isTaxIncludedPriceText(text)) {
    return Math.floor(value / 1.1);
  }
  return value;
}

function extractCurrentAuctionVisibleTaxExcludedPriceForBid(taxType) {
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
    const text = el.textContent || '';
    const fromText = parseYen(text);
    if (fromText > 0) return toTaxExcludedBidPrice(fromText, text, taxType);
  }

  const bodyText = getBodyText();
  const match = bodyText.match(/(?:\u73fe\u5728|current)[^\d]{0,20}([\d,]+)\s*(?:\u5186|JPY)?[^\n\r]{0,20}/i);
  if (match) {
    const amount = parseInt(match[1].replace(/,/g, ''), 10) || 0;
    return toTaxExcludedBidPrice(amount, match[0], taxType);
  }
  return 0;
}

function extractCurrentAuctionTaxExcludedPriceForBid(taxType, options = {}) {
  if (options.preferVisibleCurrentPrice) {
    const fromVisible = extractCurrentAuctionVisibleTaxExcludedPriceForBid(taxType);
    if (fromVisible > 0) return fromVisible;
  }

  const fromScripts = extractCurrentPriceFromScripts();
  if (fromScripts > 0) return fromScripts;

  return extractCurrentAuctionVisibleTaxExcludedPriceForBid(taxType);
}

function isYahooLoginPageUrl(href = window.location.href || '') {
  return /login\.yahoo\.co\.jp|account\.edit\.yahoo\.co\.jp/i.test(href);
}

function detectYahooLoginStatus() {
  const text = getBodyText();
  const href = window.location.href;
  const isLoginUrl = isYahooLoginPageUrl(href);
  const hasLoginPrompt = /\u30ed\u30b0\u30a4\u30f3.*\u5fc5\u8981|\u30ed\u30b0\u30a4\u30f3\u3057\u3066\u304f\u3060\u3055\u3044|login\s*required|please\s*login/i.test(text);
  if (isLoginUrl || hasLoginPrompt) {
    return { status: 'failed', message: 'Yahoo login required' };
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

function isYahooSystemBidFailureText(text = getBodyText()) {
  return /\u30b7\u30b9\u30c6\u30e0\u30a8\u30e9\u30fc|\u30a8\u30e9\u30fc\u304c\u767a\u751f\u3057\u307e\u3057\u305f|\u6b63\u5e38\u306b\u51e6\u7406\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f/.test(text) ||
    /\u3057\u3070\u3089\u304f\u6642\u9593\u3092\u304a\u3044\u3066|\u6642\u9593\u3092\u304a\u3044\u3066\u304b\u3089|\u6df7\u307f\u5408\u3063\u3066|\u3082\u3046\u4e00\u5ea6.*\u304a\u8a66\u3057|\u30da\u30fc\u30b8\u3092\u8868\u793a\u3067\u304d\u307e\u305b\u3093/.test(text);
}

function isYahooBidAccessFailureText(text = getBodyText()) {
  return /\u5165\u672d\u306b\u5931\u6557\u3057\u307e\u3057\u305f|\u30aa\u30fc\u30af\u30b7\u30e7\u30f3\u306b\u30a2\u30af\u30bb\u30b9\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f/.test(text) ||
    isYahooSystemBidFailureText(text);
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

function inferCurrentPriceFromYahooDefaultBidPrice(defaultBidPrice) {
  const value = Number(defaultBidPrice || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const increments = [10, 100, 250, 500, 1000];
  for (const increment of increments) {
    const current = value - increment;
    if (current > 0 && getYahooMinBidIncrement(current) === increment) {
      return current;
    }
  }
  return 0;
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
      error: `bid amount ${normalBidTaxIncludedPrice} JPY \u5df2\u9ad8\u4e8e\u6700\u9ad8\u4ef7 ${userMax} JPY; stop bidding`,
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
    error: `current price ${currentPrice} JPY \u5df2\u9ad8\u4e8e\u6700\u9ad8\u4ef7 ${maxPrice} JPY; stop bidding`,
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
      error: `tax included total ${numericTaxTotal} JPY \u5df2\u9ad8\u4e8e\u6700\u9ad8\u4ef7 ${numericUserMaxPrice} JPY; stop bidding`,
      currentPrice: numericTaxTotal,
      maxPrice: numericUserMaxPrice,
      closeTab: true
    };
  }

  if (plannedTaxIncludedPrice > numericUserMaxPrice) {
    return {
      success: false,
      error: `bid amount ${plannedTaxIncludedPrice} JPY \u5df2\u9ad8\u4e8e\u6700\u9ad8\u4ef7 ${numericUserMaxPrice} JPY; stop bidding`,
      currentPrice: plannedTaxIncludedPrice,
      maxPrice: numericUserMaxPrice,
      closeTab: true
    };
  }

  return null;
}
async function waitForBidOutcome(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let sawRebidRequiredAt = 0;
  while (Date.now() < deadline) {
    if (isHighestBidderPage()) {
      return { success: true };
    }
    if (isYahooSystemBidFailureText()) {
      return { success: false, error: 'Yahoo bid failed: Yahoo system error page', closeTab: true };
    }
    if (isYahooBidAccessFailureText()) {
      return { success: false, error: 'Yahoo bid access failed', closeTab: true };
    }
    if (isOutbidPage()) {
      return { success: false, error: 'outbid after bid', outbid: true, closeTab: true };
    }
    if (isRebidRequiredText()) {
      if (!sawRebidRequiredAt) sawRebidRequiredAt = Date.now();
      if (Date.now() - sawRebidRequiredAt >= MULTI_BID_REBID_STABLE_DELAY_MS) {
        return { success: false, rebidRequired: true, error: 'Rebid required: current bid is not high enough', closeTab: true };
      }
    } else {
      sawRebidRequiredAt = 0;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (sawRebidRequiredAt) {
    return { success: false, rebidRequired: true, error: 'Rebid required: current bid is not high enough', closeTab: true };
  }
  return { success: false, error: 'bid result confirmation timeout', closeTab: true };
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
  const taskId = options.taskId || null;
  const bodyText = document.body.textContent || '';

  if (isYahooSystemBidFailureText(bodyText)) {
    return { success: false, error: 'Yahoo bid failed: Yahoo system error page', closeTab: true };
  }

  if (isYahooLoginPageUrl()) {
    return { success: false, error: 'Yahoo login required' };
  }

  if (isYahooBidAccessFailureText(bodyText)) {
    return { success: false, error: 'Yahoo bid failed: \u30aa\u30fc\u30af\u30b7\u30e7\u30f3\u306b\u30a2\u30af\u30bb\u30b9\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f', closeTab: true };
  }

  if (bidMode === 'buyout' && Number(extractProductData()?.buyoutPrice || numericMaxPrice || 0) <= 0) {
    return { success: false, error: 'buyout price not found', closeTab: true };
  }

  if (strategy !== 'multi_bid' && isOutbidPage()) {
    return { success: false, error: 'outbid after bid', outbid: true, closeTab: true };
  }

  if (strategy !== 'multi_bid' && isRebidRequiredText()) {
    return {
      success: false,
      error: 'Rebid required: current bid is not high enough',
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

  function findRebidRequiredDialog() {
    const dialogs = [
      ...document.querySelectorAll('[role="dialog"], [aria-modal="true"], .ReactModal__Content, [class*="modal" i], [class*="dialog" i]')
    ].filter(el => isClickableElement(el));
    const matchedDialog = dialogs.find(el => /\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059/.test(textOf(el)));
    if (matchedDialog) return matchedDialog;
    return [...document.querySelectorAll('body *')]
      .filter(el => isClickableElement(el))
      .find(el => /\u518d\u5165\u672d\u304c\u5fc5\u8981\u3067\u3059/.test(textOf(el))) || null;
  }

  function findRebidSubmitButton(container) {
    const selector = clickableSelector();
    const controls = container?.querySelectorAll
      ? [...container.querySelectorAll(selector)]
      : [];
    const exactContainerButton = controls.find(el => {
      const text = textOf(el);
      return isClickableElement(el) && /^\s*\u5165\u672d\u3059\u308b\s*$/.test(text);
    });
    if (exactContainerButton) return exactContainerButton;

    return [...document.querySelectorAll(selector)].find(el => {
      const text = textOf(el);
      const clParams = String(el.getAttribute?.('data-cl-params') || '');
      return isClickableElement(el) &&
        /^\s*\u5165\u672d\u3059\u308b\s*$/.test(text) &&
        /(?:^|;)_cl_vmodule:rebid(?:;|$)/.test(clParams) &&
        /(?:^|;)_cl_link:cnfbtn(?:;|$)/.test(clParams);
    }) || null;
  }

  function fillBidPriceInput(bidPrice) {
    const priceInput = findPriceInput();
    if (!priceInput) {
      return { success: false, error: 'price input not found' };
    }
    priceInput.focus();
    priceInput.value = String(bidPrice);
    priceInput.dispatchEvent(new Event('input', { bubbles: true }));
    priceInput.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, input: priceInput };
  }

  function reportBidProgress(stage) {
    if (strategy !== 'multi_bid' || !taskId) return;
    try {
      chrome.runtime.sendMessage({ type: 'BID_PROGRESS', taskId, stage });
    } catch (_) {}
  }

  function resolveNextMultiBidPrice() {
    const isRebid = isRebidRequiredText();
    const pageCurrentTaxExcludedPrice = extractCurrentAuctionTaxExcludedPriceForBid(taxType, {
      preferVisibleCurrentPrice: isRebidRequiredText()
    }) || numericCurrentPrice;
    const defaultInputCurrentPrice = isRebid
      ? inferCurrentPriceFromYahooDefaultBidPrice(parseYen(findPriceInput()?.value || ''))
      : 0;
    const currentTaxExcludedPrice = defaultInputCurrentPrice || pageCurrentTaxExcludedPrice || 0;
    return resolveMultiBidNextBidPrice({
      currentPrice: currentTaxExcludedPrice,
      maxPrice: numericMaxPrice,
      userMaxPrice: numericUserMaxPrice,
      increment: numericMultiBidIncrement,
      taxType
    });
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
      const currentTaxExcludedPrice = extractCurrentAuctionTaxExcludedPriceForBid(taxType) || numericCurrentPrice;
      const plannedBidPrice = currentTaxExcludedPrice && numericMultiBidIncrement
        ? currentTaxExcludedPrice + numericMultiBidIncrement
        : numericMaxPrice;
      const skipResult = buildSkipWhenWithinAutoBidLimit(plannedBidPrice);
      if (skipResult) return skipResult;
    }

    if (isRebidRequiredText()) {
      const rebidDialog = findRebidRequiredDialog();
      const rebidSubmitButton = findRebidSubmitButton(rebidDialog);
      if (rebidSubmitButton) {
        const nextBid = resolveNextMultiBidPrice();
        if (!nextBid.success) return nextBid;
        const inputResult = fillBidPriceInput(nextBid.bidPrice);
        if (!inputResult.success) return inputResult;
        reportBidProgress('rebid-price-filled');
        await sleep(MULTI_BID_REBID_SUBMIT_DELAY_MS);
        clickElement(rebidSubmitButton);
        reportBidProgress('rebid-submitted');
        const outcome = await waitForBidOutcome();
        if (!outcome.success && outcome.rebidRequired) {
          await sleep(MULTI_BID_PAGE_STEP_DELAY_MS);
          return executeMultiBidLoop(attempt + 1);
        }
        if (!outcome.success && outcome.outbid) {
          return { success: true, noBid: true, notHighest: true, closeTab: true, stage: 'multi-not-highest-stop' };
        }
        if (!outcome.success) return outcome;
        return { success: true, bidPrice: nextBid.bidPrice, stage: 'multi-rebid-submitted' };
      }
      return { success: false, error: 'rebid submit button not found in active dialog', closeTab: true };
    }

    const finalAgreeBtn = findClickable([/\u540c\u610f.*\u5165\u672d/, /\u4e0a\u8a18.*\u5165\u672d/]);
    if (finalAgreeBtn) {
      clickElement(finalAgreeBtn);
      reportBidProgress('final-agree-submitted');
      const outcome = await waitForBidOutcome();
      if (!outcome.success && outcome.rebidRequired) {
        await sleep(MULTI_BID_PAGE_STEP_DELAY_MS);
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
          error: `tax included total ${taxTotal} JPY \u5df2\u9ad8\u4e8e\u6700\u9ad8\u4ef7 ${numericUserMaxPrice} JPY; stop bidding`,
          currentPrice: taxTotal,
          maxPrice: numericUserMaxPrice,
          closeTab: true
        };
      }
      const nextBid = resolveNextMultiBidPrice();
      if (!nextBid.success) return nextBid;
      const inputResult = fillBidPriceInput(nextBid.bidPrice);
      if (!inputResult.success) return inputResult;
      reportBidProgress('bid-price-filled');
      const confirmBtn = await waitForClickable([/\u78ba\u8a8d\u3059\u308b/, /\u78ba\u8a8d/]);
      if (!confirmBtn) {
        return { success: false, error: 'confirm button not found' };
      }
      await sleep(MULTI_BID_INPUT_SUBMIT_DELAY_MS);
      clickElement(confirmBtn);
      reportBidProgress('confirm-clicked');
      await sleep(MULTI_BID_PAGE_STEP_DELAY_MS);
      return executeMultiBidLoop(attempt + 1);
    }

    const bidEntryBtn = findBidEntryButton('bid');
    if (!bidEntryBtn) {
      return { success: false, error: 'bid button not found' };
    }
    clickElement(bidEntryBtn);
    reportBidProgress('bid-entry-clicked');
    await sleep(MULTI_BID_PAGE_STEP_DELAY_MS);
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
    // currentPrice 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻閻愮儤鍋嬮柣妯荤湽閳ь兛绶氬鏉戭潩鏉堚敩銏ゆ⒒娴ｈ鍋犻柛搴㈡そ瀹曟粓鏁冮崒姘€梺鎼炲労閸撴岸鎮¤箛娑氬彄闁搞儯鍔嶇粈鈧柛鐔告倐濮婃椽骞愭惔锝冣偓鎺楁煕閻樺磭澧い顐㈢箰鐓ゆい蹇撳瀹撳秴顪冮妶鍡樺皑闁告挻绻堥、鎾澄旈崨顔规嫼闂佸憡绺块崕杈ㄧ墡闂備胶绮〃鍫熸叏閹绢喗鍋?Yahoo HTML price 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧湱鈧懓瀚崳纾嬨亹閹烘垹鍊炲銈嗗笒椤︿即寮查鍫熷仭婵犲﹤鍟扮粻濠氭煕閳规儳浜炬俊鐐€栫敮濠囨嚄閸洖鐓濋柟鍓х帛閻撴盯鏌涘☉鍗炴灓缂佺姵锕㈤弻娑㈠箳閹惧磭鐟ㄩ梺瀹狀嚙闁帮綁鐛Ο铏规殾闁搞儴娉涢弫钘夆攽閻樻鏆滅紒杈ㄦ礋瀹曟垵鈽夐姀鈥冲壄闂佺粯鍨煎Λ鍕婵犳碍鐓欓柟瑙勫姦閸ゆ瑧绱掗埀顒勫礃閳瑰じ绨婚梺鍝勫暙閸婂摜鏁崼鏇熺厾闁哄娉曟禒銏ゆ煃鐟欏嫬鐏撮柟顔界懇瀵爼骞嬮悩杈╃婵犵绱曢崑娑㈡偤閵娾晛绠栭柛灞惧嚬閸ゆ洟鏌＄仦璇插姎闁绘挻鐩弻娑樷槈閸楃偞鐏堥梺閫炲苯澧伴柡浣割煼瀵鈽夊鍛澑闂佺懓鐏濋崯顖滅懅婵犵數鍋涢悺銊у垝閹惧墎涓嶉柡宓本缍庡┑鐐叉▕娴滄粌顔忓┑鍡忔斀闁绘ɑ褰冮弳娆愩亜閿旇娅婃慨濠冩そ瀹曘劍绻濋崘銊╃€洪梻浣哄帶缂嶅﹦绮婚弽顓炴槬闁靛繒濯崥瀣熆鐠虹尨宸ラ柛鐐妼椤啴濡堕崱妯烘殫闂佸摜濮甸幑鍥х暦閵忥紕顩烽悗锝庡亽濡懎顪冮妶鍡楀闁搞劎鍎ゅ鍕礋椤掑倻顔曢梺鍛婄懃椤﹁鲸鏅堕鍌滅＜闁稿本绋戠粭鈺傘亜閿曗偓缂嶅﹪寮婚敍鍕勃闁告挆浣插亾閹烘鐓冪憸婊堝礈閵娧呯闁糕剝绋戠壕濠氭煕濞戝崬鐏熼柣鎺戯躬閺岋綁濮€閻樺啿鏆堥梺缁樻尵閸犳牠寮婚敐澶婄睄闁逞屽墰閹广垽宕掗悙鑼枃闂佸綊鍋婇崰鏍夊顑炲綊鎮╁顔煎壉闂佺粯鎸诲ú鐔煎箖濮椻偓閹瑩骞撻幒鍡樺瘱闂備胶鎳撻崯鍧楀箠韫囨稑桅闁告洦鍨遍弲婊冣攽閸屾碍鍟炴い搴＄Ч濮婃椽妫冨☉娆愭倷闁诲孩鐭崡鎶芥偘椤旈敮鍋撻敐搴濈按闁衡偓娴犲鐓曢柕澶嬪灥鐎氶攱绂掗鐐╂斀闁挎稑瀚禍濂告煕婵犲啫鐏寸€规洘绻冪换婵嬪炊瑜忛敍鐔兼⒒閸屾氨澧涚紒瀣崌瀵娊鏁冮崒娑氬帾婵犵數濮寸换鎰般€呴鍌滅＜闁抽敮鍋撻柛瀣崌濮婄粯鎷呴崨濠傛殘闂佸憡鏌ㄧ换妯侯嚕閹绘巻鏀藉┑鐐层仒濮规姊虹粔鍡楀濞堟洟鏌嶉柨瀣瑨闂囧鏌ㄥ┑鍡欏妞ゅ繒濞€閹粙顢涘☉姘ｅ闂侀潧娲ょ€氫即銆佸鈧幃娆撴濞戞帒寰嶅┑锛勫亼閸婃垿宕归悜妯尖攳婵炲樊鈧亜娲畷婊勬媴閾忕櫢绱茬紓鍌氬€烽悞锕傗€﹂崼鐔虹彾婵せ鍋撻柡灞界Ф閹叉挳宕熼銈勭礉闂備浇顕栭崰妤冨垝閹惧磭鏆﹂柛顐ｆ礀閻撴稑霉閿濆懏鎲搁柛妯诲笒閳规垿鎮╅崹顐ｆ瘎闂佺顑嗛惄顖炲箚閸ャ劌顕遍柡澶嬪灩椤︻噣姊虹涵鍛涧缂佺姵鍨块幃姗€骞庨懞銉у弳闂佸搫鍟犻崑鎾绘煕鎼达紕锛嶉柍褜鍏涚徊鑽や焊濞嗘垶顫曢柟鐑橆殔閸ㄥ倹绻涢幋鐏诲吋绔熼弲淇癱MaxPrice 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋锝嗩棄闁哄绶氶弻鐔兼⒒鐎靛壊妲紒鐐劤椤兘寮婚敐澶婄疀妞ゆ帊鐒﹂崕鎾绘⒑閹肩偛濡奸柛濠傛健楠炲啰鎲撮崟顒€顫￠梺鐟板槻閻牓宕濋崨顓涙斀闁绘劖褰冮幃鎴︽煟濡や焦绀嬮柛鈺冨仱楠炲鏁傞挊澶夋睏闂佽楠稿﹢杈ㄦ叏閹绢啟澶娾攽閸垻锛濇繛杈剧悼閹虫挻鎱ㄩ崼鐔翠簻闁靛鍎婚煬顒傗偓娈垮枛椤兘骞冮姀銈呯闁兼祴鏅涙慨娲⒒娴ｇ懓顕滄繛鎻掔Ч瀹曟垿骞樼紒妯煎幈闂佸搫鍟幐楣冩偩閻㈠憡鐓涢悘鐐额嚙婵″ジ鏌嶇憴鍕伌鐎规洟浜堕崺锟犲磼閸岋箓妾紒缁樼〒婢规洜鈧綆浜欏Ч妤佺節閻㈤潧浜归柛瀣崌濮婃椽宕崟顒佹嫳濠电偛寮堕…鍥╁垝閳哄懏鍋勭痪鎷岄哺閺咁剙鈹戦鏂や緵闁告鍘ч埢宥堫樄婵﹥妞藉畷銊︾節韫囧海杩旈梻浣规偠閸斿繐鈻斿☉顫稏闊洦绋掗幆鐐烘偡濞嗗繐顏╅柛妯虹秺濮婃椽宕ㄦ繝浣虹箒闂佸憡锚閹碱偅鏅ュ┑掳鍊曢幊蹇涙偂閻斿吋鐓熼柟閭﹀墻閸ょ喖鏌嶇粭鍝勨偓婵嬪蓟濞戞瑦鍎熼柨婵嗘濮ｅ牓鎮楃憴鍕婵＄偘绮欏畷娲焵椤掍降浜滈柟鍝勭Ч濡惧嘲霉濠婂嫮鐭掗柡宀€鍠栧畷顐﹀礋椤撳鍊栭妵鍕晜閼测晝鏆犲銈庡弨閸庡篓娓氣偓閺屾盯濡搁妷褍鐓熼悗娈垮枛椤兘寮澶婄闁靛鍎版竟鏇㈡⒑閹稿海鈽夌€规洦鍓熷畷顖炲煛閸屾粎褰鹃梺鍝勬储閸ㄦ椽鍩涢幒妤佺厱閻忕偞宕樻竟姗€鏌嶈閸撴岸骞冮崒姘辨殾闁规壆澧楅崐濠氭煠閹帒鍔氶柍褜鍓欏锟犲蓟閵娾晛绫嶉柛顐ゅ枑濞堜即姊虹粙娆惧剱闁圭澧介崚鎺楊敇閻愨晜顫嶅┑鈽嗗灥椤曆冣枍瑜斿鍝劽虹拠鎻掔闂佽崵鍟块弲鐘差嚕婵犳碍鍋勯悶娑掆偓鍏呭濠电偞鍨堕悷顖炴倿閻ｅ瞼纾奸柣姗嗗枛閸旓箓鏌″畝瀣М鐎殿噮鍓熼獮鎰償椤旀枻绱楅梻鍌欑閹碱偊寮甸鍌滅煓闁硅揪绲挎禍娆撴⒒娓氣偓閳ь剛鍋涢懟顖涙櫠鐎电硶鍋撳▓鍨珮闁稿锕ら悾?max_price闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕婵犲倹鍋ラ柡灞诲姂瀵噣宕奸悢鍛婎唶闂備胶顭堥鍡涘箰閸撗冨灊妞ゆ挾鍋愬Σ鍫熶繆椤栨繍鍤欐繛鍛囧洦鈷戞繛鑼额嚙楠炴鏌ｉ悢鍙夋珚鐎殿喖顭烽幃銏焊娴ｅ湱鈧姊婚崟顐ｅ枠妞ゃ垺淇洪ˇ鏌ユ偂閵堝棎浜滈柟鍨暞婵炲洭鏌嶈閸忔稓绮堟笟鈧敐鐐差煥閸繄鍔﹀銈嗗笂閻掞箓宕ｈ箛娑欑厓鐟滄粓宕滈悢鐓庤摕闁挎繂鎷嬪銊╂煃瑜滈崜娆撯€﹂崶顏嶆Ъ闂?
    // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋锝嗩棄闁哄绶氶弻鐔兼⒒鐎靛壊妲紒鐐劤椤兘寮婚敐澶婄疀妞ゆ帊鐒﹂崕鎾绘⒑閹肩偛濡奸柛濠傛健瀵鈽夐姀鈺傛櫇闂佹寧绻傚Λ娑⑺囬妷褏纾藉ù锝呮惈灏忛梺鍛婎殕婵炲﹤顕ｇ拠娴嬫闁靛繆鏅滈弲婵嬫⒑閹稿海绠撴俊顐ｇ洴钘濋柕澹懐锛滈梺缁樺姦閸撴瑧绮堥崘鈹夸簻妞ゆ劑鍩勫Σ娲煙楠炲灝鐏╅柍钘夘樀婵偓闁绘ɑ顔栭崥鍛節閻㈤潧浠滄俊顐ｎ殘閹广垽骞掗幘棰濇祫婵犻潧鍊搁幉锟犲煕閹寸姷纾藉ù锝咁潠椤忓棛绠旈柟鐑橆殕閻撶喖鐓崶銊︾叆闁告繂鎼埞鎴︽晬閸曨剚姣堥悗瑙勬礈閸犳牠銆佸☉姗嗘僵濡插本鐗曢弫浠嬫⒒閸屾瑨鍏岀痪顓炵埣瀹曟粌鈹戠€ｎ€箓鏌ｉ幇顒夊殶闁绘繂鐖奸弻锟犲炊閵夈儳浠鹃梺鎶芥敱鐢帡婀侀梺鎸庣箓濞层倝宕濈€ｎ喗鐓曢柕鍫濆€告禍楣冩⒒閸屾瑧顦﹂柟鑺ョ矒瀹曠増鎯旈埥鍡欏姺闂佽法鍠撴慨鎾嫅閻斿皝鏀介柣妯哄级婢跺嫰鏌￠崨顔肩祷妞ゎ叀娉曢幑鍕偊閸噮浼冪紓鍌欐缁躲倗绮婚幘鎰佹綎婵炲樊浜滃婵嗏攽閻樻彃鈧瓕顤傞梻鍌欑閹芥粍鎱ㄩ悽鍛婂亱婵犲﹤鎳庨崹婵堢磽娴ｈ鐒界紒鈾€鍋撴繝娈垮枟閿曗晠宕㈤崗鑲╊浄妞ゆ牜鍋為埛鎴︽煙閼测晛浠滈柛鏃€娼欓湁婵犲﹤瀚惌鎺楁煙椤栨艾鏆欓悡銈嗐亜韫囨挻鍣介柛妯圭矙濮婃椽宕烽鐐板濠电偛鍚嬮悷鈺呭箖濡皷鍋撳☉娅虫垿宕ｈ箛鎾斀闁绘ɑ褰冮弳鐐烘煏閸ャ劎绠栨い銊ｅ劦閹瑩寮堕幋婵愭綌闂備浇顕栭崹鍗炍涢崘顔兼瀬闁圭増婢橀悙濠囨煃閸濆嫬鈧綊顢欓幘缁樷拻闁稿本鑹鹃埀顒傚厴閹虫宕奸弴妯峰亾娴ｅ湱绡€闁稿本顨嗛悗娲⒑閸濆嫭鍌ㄩ柛銊ユ贡缁牊寰勭€ｂ晝绠氶梺闈涚墕閹冲酣寮冲▎鎾寸厱闁靛濡囩粻鐐烘煛鐏炶濡奸柍瑙勫灴瀹曢亶鍩￠崒鍌冨洦鈷戠紒瀣皡閸旂喖鏌涜箛鏃撹€跨€殿喖顭烽弫鎰緞婵犲嫷鍚呴梻浣虹帛閸ㄩ潧螞濞戙垹绀夐柣鎴ｅГ閳锋垿鏌涘☉妯峰闁兼祴鏅涢崹婵囩箾閸℃绂嬫繛鍏肩墵閺屟嗙疀閹惧啿杈呴梺绋款儐閹瑰洤鐣烽悜绛嬫晣闁绘劖鍔х紞渚€寮婚弴銏犲耿婵°倐鍋撻柡鍡秮閺岋紕浠︾拠娴嬪亾濠靛棛鏆︽慨妞诲亾闁瑰磭濞€椤㈡鍩€椤掑嫭鍋傞柣鏃囧仱閺冨牊鍋愰梻鍫熺◥濞岊亜顪冮妶鍐ㄥ闁挎洦浜悰顕€宕橀鑲╁幐闂佸憡鍔︽禍鐐烘晬濠婂啠鏀介柍钘夋閻忋儲淇婂鐓庡缂佽鲸鎹囬獮妯肩礄閻樼數鐣鹃梻浣虹帛閸旓附绂嶅鍫濈劦妞ゆ帊鑳舵晶鐢告煙椤斻劌鍚橀弮鍫濈妞ゅ繐妫涢崢顖炴⒒娴ｅ憡璐￠柛搴涘€曢～蹇涙嚒閵堝洨鐒兼繝鐢靛Т濞诧箓鎮″▎鎾村€甸柣銏☆問閻掗箖寮介敓鐘斥拺缂佸顑欓崕鎰版煟濡や緡娈橀柟骞垮灩閳藉濮€閻樿尪鈧灝鈹戦埥鍡楃仴妞ゆ泦鍥棄鐎广儱顦伴埛鎴犵磽娴ｈ偂鎴犱焊娴煎瓨鐓熼柍鍝勶工閻忥妇鈧鍠涢褔鍩ユ径鎰潊闁绘鏁搁弶鎼佹⒒娴ｅ摜鏋冩俊妞煎妿缁牊绗熼埀顒勫灳閺嶃劌绶為柟閭﹀幖閳ь剛鏁婚弻锝夋偄閸濆嫷鏆梺鍝ュ枔閸嬬喓妲愰幒鏃€瀚氶柟缁樺俯娴尖偓婵犵鈧啿绾ч柛鏃€鐟╅悰顕€骞掗幊铏閸┾偓妞ゆ帒鍊绘稉宥嗙箾閹寸偟鎳€濞存粍绮撻弻鐔煎箲閹邦厾銆愰柡宥忕節濮婃椽宕ㄦ繝鍌滅懖闂佺儵鏅╅崹浼达綖韫囨拋娲敂閸曨亞鐐婇梻浣告啞濞诧箓宕抽纰辩劷闁割偅娲橀埛鎴︽煕濞戞﹫鏀婚柣鎾卞劦閺岋綁顢橀悙娴嬪亾閸喚鏆︽繛宸簻鍞梺鎸庢磵閸嬫挾绱掗崜浣镐粶闁宠鍨块幃娆撴濞戞顥氶梻浣筋嚙妤犳悂鈥﹀畡閭︽綎婵炲樊浜濋崑锟犳煙濞堝灝鏋熼柟鎻掋偢濮婃椽鎳￠妶鍛€梺鎼炲姀濡嫰鎮鹃悜钘夌闁挎洍鍋撶紒鐘差煼閹綊宕堕鍕濡炪倖鏌ㄩ敃銈夊煘閹寸偛绠犻梺绋匡攻閹瑰洭骞婂Δ鍛唶闁哄洨鍋涢崑?numericUserMaxPrice闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕婵犲倹鍋ラ柡灞诲姂瀵噣宕奸悢鍛婎唶闂備胶顭堥鍡涘箰閸撗冨灊妞ゆ挾鍋愬Σ鍫熶繆椤栨繍鍤欐繛鍛囧洦鈷戞繛鑼额嚙楠炴鏌ｉ悢鍙夋珚鐎殿喖顭烽幃銏ゅ川婵犲嫮肖濠德板€х徊浠嬪疮椤栫儐鏁佺€广儱顦伴埛鎴犵磼鐎ｎ偒鍎ラ柛搴＄箲閵囧嫰骞嬪┑鎰枅闂佽鍣换婵嬨€侀弴銏℃櫇闁逞屽墴閹瑦绻濋崶銊у帾婵犵數鍊埀顒勫磻閹剧繝绻嗛柟缁樺笧婢э附鎱ㄦ繝鍛仩缂佽鲸甯掕灒閻犲洤寮跺▓顐︽⒒娴ｅ憡鎲稿┑顔炬暬閹囨偐瀹割喖娈ㄦ繝鐢靛У閼圭偓鍎梻渚€娼чˇ顓㈠垂濞差亜妫橀柍褜鍓熷缁樻媴閾忓箍鈧﹥淇婇悪娆忔搐閻ょ偓绻濇繝鍌涘櫧闁瑰啿鎳樺濠氬磼濞嗘劗銈伴悗瑙勬礈閺佽鐣锋导鏉戠疀闁绘鐗嗘禒顓㈡煛婢跺﹦澧愰柡鍛箖缁嬪顓兼径瀣幍闂佺顫夐崝鏇㈠触閸︻厸鍋撶憴鍕矮缂佽埖宀稿濠氬灳閹颁礁鎮戦柟鑲╄ˉ閳ь剙纾鎰磽閸屾瑨鍏屽┑顕€绠栭敐鐐村緞閹邦儵锕傛煕閺囥劌鐏犵紒鐘差煼閹銈﹂幐搴涒偓鍐煙閹绢喗鏁辩紒缁樼〒閳ь剛鏁搁…鍫ヮ敁瀹€鍕厱闁靛鍎抽敍宥嗕繆閸欏濮嶆鐐搭焽閳ь剚绋掗敋妞ゅ孩鎹囧娲捶椤撶姴绗￠柣銏╁灠閿曘儳绮╅悢鐓庡嵆闁靛繆妾ч幏缁樼箾鏉堝墽绉繛鍜冪秮婵″瓨绻濋崶銊у幈闂佽鍎抽顓犵不閻愮儤瀵犳繝闈涙焾閺冨牊鏅濆〒姘躬閻涙粍绻涚€涙鐭婄紓宥咃躬瀵鎮㈤崗鐓庘偓缁樹繆椤栨繃顏犲ù鐘靛帶椤啴濡甸娆戭槮婵炶绠撻崺娑㈠箣閻樼數锛濇繛杈剧秬閸嬪倿骞嬮悩杈╁墾濡炪倖鎸鹃崐锝夊籍閸喎浜归梺鎯ф禋閸嬪嫰鍩€椤掍礁濮堟い銊ｅ劦閹瑩骞栭鐔烘澒闂備浇顕栭崰鏇犲垝濞嗗繒鏆﹂柕濠忓缁犻箖鏌ｉ幇闈涘妞ゅ繐缍婂缁樻媴閸涘﹥鍎撳銈忕畵娴滆泛鐣烽幋锔藉€烽悗闈涙憸瑜伴箖姊虹化鏇炲⒉闁炬柨顑夊畷鍫曨敆娴ｈ鐝栭梻浣侯焾閺堫剛绮欓幘璇茬煑闁糕剝绋掗埛鎴︽煕濠靛棗顏璺哄閺屻劌顫濋懜鐢靛幈闂佸搫鍟幑鍥ь瀶椤斿浜滈柕濠忕到閸旓箓鏌熼鐣屾噰闁瑰磭濞€椤㈡宕掗妶鍛珨闂備浇顕у锕傦綖婢跺⊕楦跨疀濞戞顦梺纭呮彧鐠愮喖鍩€椤戣法顦﹂摶锝嗙箾閸℃瑥浜炬禍娑㈡⒒閸屾瑦绁版い鏇熺墵瀹曟澘螖閸涱厼鐎梺鍓茬厛閸ｎ喖顭囬弽銊х鐎瑰壊鍠曠花鑽も偓鐟版啞缁诲倿鍩為幋锔藉亹闁圭粯宸婚崑鎾愁潰鐏炵儵鍋撻弽顐ょ＝闁稿本鑹鹃埀顒€鍢查湁闁搞儮鏅欓悞濠冦亜韫囨挻鍣洪柛娆忕箻閺屾洟宕煎┑鍥х獩闂?
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
  // Yahoo 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳婀遍埀顒傛嚀鐎氼參宕崇壕瀣ㄤ汗闁圭儤鍨归崐鐐差渻閵堝懐绠扮紒澶愭涧琚欓幖娣妽閳锋帡鏌涚仦鍓ф噯闁稿繐鏈妵鍕敇閻愰潧鈪靛銈冨灪閻楃姴鐣烽崡鐐╂婵☆垳鈷堥崬褰掓⒒娴ｈ鍋犻柛搴㈡そ瀹曟粌鈻庨幘鏉戠彅闂佺粯鏌ㄩ崥瀣偂韫囨稒鐓曟い鎰剁悼缁犮儲淇婇幓鎺撴喐缂佽鲸甯￠幃鈺呭礃閸欏鐧侀梻浣告惈閻ジ宕伴弽顓炵畺婵犲﹤鍚橀悢鍏兼優闂侇偅绋掑Ο濠冪節閻㈤潧校妞ゆ梹鐗犲畷鏉课旈埀顒傚弲闂佺粯姊婚崢褔鎷戦悢鍏肩叆婵犻潧妫Σ褰掓煕鐎ｎ偄濮嶉柡灞剧洴楠炲洭顢橀悙鐢点偡婵＄偑鍊ら崑鍕箠濡警娼栨繛宸簼閻掑鏌ｉ幇顖氳敿閻庢碍婢橀…鑳檨闁搞劌鐖煎璇测槈閵忕姷顔掔紒鐐劤椤戝懘藟濠靛鈷戦梻鍫熺⊕椤ョ偤鎮介娑辨畼闁瑰箍鍨归埞鎴﹀幢閳哄倸鍏婃俊鐐€栭幐鐐叏鐎靛憡鏆滃Δ锝呭暞閳锋帒霉閿濆浂鐒炬い銉ョ箻閺屾稓鈧綆浜濋崳浠嬫煙楠炲灝鐏茬€规洘锕㈤崺鈩冩媴閾忓湱宓侀梻鍌欑閹测€趁洪敃鍌氬瀭闂侇剙绉甸崑鍌涚箾閹存瑥鐏柣鎾存礋閺屽秹濡烽妷褝绱炵紓浣哄Т瀵墎鎹㈠☉銏犲窛妞ゆ挾鍣ュΛ銈囩磽?DOM 缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎靛壊妲紒鐐劤缂嶅﹪寮婚悢鍏尖拻閻庨潧澹婂Σ顔剧磼閻愵剙鍔ょ紓宥咃躬瀵鏁愭径濠勵吅闂佹寧绻傞幉娑㈠箻缂佹鍘辨繝鐢靛Т閸婂綊宕戦妷鈺傜厸閻忕偠顕ф慨鍌溾偓娈垮枟閹告娊骞冨▎寰濆湱鈧綆浜欐竟鏇㈡⒑閸涘﹦缂氶柛搴ゆ珪缁嬪顓兼径瀣幐婵犮垼娉涢敃锕€顫濋妸鈺傜厸闁逞屽墯缁傛帞鈧綆鍋嗛崢钘夆攽閳藉棗鐏ユ繛鍜冪秮閺佸秴顓奸崱鎰盎闂佹寧绻傚Λ娑㈠矗閳ь剟姊洪崫鍕拱缂佸甯為幑銏犫攽鐎ｎ亞锛滃┑鐘才堥崑鎾剁磼椤旂偓鏆慨濠冩そ濡啫鈽夊▎鎰€烽梺璇插绾板秴顭垮鈧、姘舵晲閸℃瑯娴勯柣搴到閻忔岸寮插┑鍡╂富闁靛牆楠告禍浠嬫煕濡湱鐭欑€规洜鍠栧畷姗€顢欑憴锝嗗濠电偠鎻徊浠嬪箟閿熺姴绠氶柛顐犲劜閻撴瑧鈧懓瀚伴崑濠囧磿閺冨倵鍋撶憴鍕缂侇喖鐭傞敐鐐测攽閸喎纾梺鎯х箰濠€閬嶅级娴犲鈷掑〒姘ｅ亾婵炰匠鍥ｂ偓锕傚醇閵夈儳锛熼梺鍛婄箓鐎氱兘鎮炴禒瀣厪濠电偟鍋撳▍鍡涙煟閹惧瓨绀嬮柡灞界Ч閸┾剝鎷呴崨濠勪壕婵犵數鍋涢悧濠傤潖閼姐倖顫曢柟鐑橆殕閸嬫劗鈧懓澹婇崰姘跺触鐎ｎ亖鏀芥い鏃傘€嬮弨缁樹繆閻愭壆鐭欓柣娑卞櫍瀵粙顢橀悢灏佸亾閻戣姤鐓欑紓浣姑穱顖炴煟鎼达絽鍘存慨濠勭帛閹峰懘宕ㄦ繝鍌涙畼婵＄偑鍊ら崢鐓幬涘┑鍡欐殾闁告鍋愰弸搴ㄥ箹鏉堝墽鎮肩紒澶婃健濮婂宕掑顑藉亾閹间礁纾归柣鎴ｅГ閸ゅ嫰鏌涢幘鑼槮闁搞劍绻冮妵鍕冀椤愵澀鏉梺閫炲苯澧柛鐔告綑閻ｇ兘濡歌閸嬫挸鈽夊▍顓т簼缁傚秹鏌嗗鍡忔嫼缂傚倷鐒﹂敋濠殿喖娲弻鐔哄枈閸楃偘绨界紓渚囧枛閻楁挸鐣烽幒鎴旀闁哄稄濡囬惄搴ㄦ⒒娴ｅ憡璐￠柛搴涘€濆畷褰掓偨缁嬭法鍔﹀銈嗗笒閸燁偊宕ラ悷閭︾唵閻熸瑥瀚粈鍐磼閾忚娅曠紒顔界懅閹瑰嫰濡搁埡鍐ㄧ闂傚倸鍊风粈浣圭珶婵犲洤纾婚柛娑卞灣閻瑩鏌熺€电浠掔紒璇叉閺屾稖顦虫い銊ユ閹€斥枎閹惧鍘遍梺褰掑亰閸撴瑧鐥閳ь剛鎳撻幉锛勬崲閸儱钃熺€广儱鐗滃銊╂⒑閸涘﹥灏扮紒璇茬墦閺佹劙鎮欓弶鎴犵獮婵犵數鍋炵敮锛勭磽濮樿京涓嶆繛鎴炃氬Σ鍫熶繆椤栨嚎鈧妲愰悽鍛娾拻濞达絽婀卞﹢浠嬫煕閵婏附銇濇鐐插暣瀹曞ジ寮撮悙闈涘Е婵＄偑鍊栭崹鐓庘枖閺囩姷鐜婚柡鍐ㄥ€甸崑鎾斥枔閸喗鐏嶉梺瑙勭摃濞呮洟骞堥妸鈺佺劦妞ゆ帒瀚悡鐔哥箾閸℃瀚板ù婊勫劤閳规垿鎮欓棃娑樹粯闂佹寧娲︽禍婊堬綖韫囨拋娲敂閸滀焦顥堟繝鐢靛仦閸ㄨ泛顫濋妸鈺婃晩濠电姴鍟扮弧鈧┑鐐茬墕閻忔繂鈻嶅鍡欑濞达絽鍟垮ú銈夋偂濠靛鐓欓柟顖嗗懐鏆涙繛瀛樼矊缂嶅﹪寮婚悢鍏煎€绘俊顖濐嚙閻ㄦ垿姊洪悷鏉挎Щ妞ゎ厼鍢查～蹇涙惞閸︻厾鐓撻梺鍦焾鐎涒晠骞忛柆宥嗏拺闁煎鍊曢弳鈧梺鍛婁緱閸犳牠顢旈崨濠勭閻庣數顭堢敮鍫曟煟鎺抽崝鎴﹀箖閿熺姴鍗抽柕蹇ョ磿閸樿棄鈹戦埥鍡楃仭閻庣瑳鍥ㄥ仧妞ゅ繐妫岄崑鎾舵喆閸曨剛顦ラ梺娲诲墮閵堟悂宕洪埀顒併亜閹烘垵鏋ゆ繛鍏煎姈缁绘盯宕ｆ径妯煎姺闂佺懓绠嶉崹钘夌暦閹烘鍊烽柡澶嬪灣閹絾绻濋悽闈涒枅婵炰匠鍥舵晞闁告侗鍨抽惌鍡涙倵閿濆骸浜栧ù婊勭矒閺岀喖骞嶉搹顐ｇ彅闂侀€炲苯澧柣妤冨█楠炲啴鏁撻悩铏珳婵犮垼娉涢鍌炲箯缂佹绠鹃柟鐐綑閻掑綊鏌涚€ｎ偅灏扮紒缁樼⊕閹峰懘宕橀崣澶婃閻庤娲橀悡锟犲蓟濞戙埄鏁冮柣妯诲絻婵海绱掗悙顒€鍔ょ紓宥咃躬瀵鏁撻悩鑼€為梺瀹犳〃閻掞箓鎮楃拠宸富闁靛牆妫欑粈瀣瑰鍐煟鐎殿喖顭烽弫鎰板川閸屾粌鏋庨柍璇查叄閹瑩顢栭懞銉ョ樁闂備浇宕甸崰鎰垝鎼淬垺娅犳俊銈呭暞閺嗘粍淇婇妶鍛櫣闁汇倝绠栭弻锛勪沪鐠囨彃濮曢梺缁樻尰濞叉鎹㈠☉銏犵婵犻潧妫滈崺鐐参旈悩闈涗沪妞ゃ劌妫涚划瀣吋閸涱亝顫嶉梺闈涚箚濡狙囧箯缂佹绠鹃弶鍫濆⒔缁夘剙鈹戦鍝勨偓婵囦繆閹绢喖绀冩い鏃囨娴狀垱绻涙潏鍓у埌婵犫偓闁秴鐭楅柍褜鍓熼幃妤€鈻撻崹顔界亶闂佺粯鎼换婵嬬嵁閸愵喖鐓涢柛鎰ㄦ櫅閻濅即姊洪懝鏉款棈闁糕晜鐗犻獮?F26171闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕婵犲倹鍋ラ柡灞诲姂瀵噣宕奸悢鍛婎唶闂備胶顭堥鍡涘箰閸撗冨灊妞ゆ挾鍋愬Σ鍫熶繆椤栨繍鍤欐繛鍛囧洦鈷戞繛鑼额嚙楠炴鏌ｉ悢鍙夋珚鐎殿喖顭烽幃銏焊娴ｅ湱鈧姊婚崟顐ｅ枠妞ゃ垺淇洪ˇ鏌ユ偂閵堝棎浜滈柟鍨暞婵炲洭鏌嶈閸忔稓绮堟笟鈧崺銉﹀緞閹邦剦娼婇梺鐐藉劜閺嬪ジ宕戦幘缁樺€婚柤鎭掑劤閸樺墽绱掗悙顒佺凡鐎规洦鍓氶弲鑸电節濮橆厾鍘遍梺缁樺姇閻忔岸寮抽浣瑰弿濠电姴瀚敮娑㈡煙瀹勭増鍤囬柟鐓庣秺閹兘骞嶉鍛还婵犵绱曢崑鎴﹀磹閹达箑绀夌€光偓閸曨偆鐤囧┑顔姐仜閸嬫挻顨ラ悙鎻掓殺妞わ箑澧庣槐鎺楁偐瀹曞洠妲堥梺瀹犳椤﹂潧顕ｆ禒瀣ч柛娑卞墮椤ユ岸姊绘担鍛婂暈缂佸鍨块幃娲Ω閳轰胶锛欐繝鐢靛У绾板秹鎮￠悩缁樼厵妞ゆ挾鍠庣粭鎺楁煕閺冣偓椤ㄥ﹪寮婚悢鍏肩叆閻庯綆鍋佹禒銏犫攽椤旂》鏀绘俊鐐舵閻ｅ嘲顭ㄩ崼鐔锋濡炪倖宸婚崑鎾绘偨椤栨ê鍔︽慨濠冩そ濡啴鍩￠崘顎綁姊洪棃鈺冪Ф缂佽弓绮欓幃楣冩倻閽樺宓嗛梺闈涚箳婵兘顢橀崫鍕ㄦ斀闁绘灏欐禒娑㈡煕閺冣偓椤ㄥ﹤鐣?23,100闂?闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻濞戔懞鍥偨缁嬫寧鐎悗骞垮劚椤︻垳绮堢€ｎ偁浜滈柟鍝勭Ф閸斿秵銇勯弬鎸庡枠婵﹦绮幏鍛村川婵犲懐顢呴梻浣侯焾缁ㄦ椽宕愬┑鍡欐殾闁汇垹鎲￠弲婵嬫煃瑜滈崜鐔煎春閵夛箑绶炲┑鐐灮閸犲酣鈥﹂妸鈺佺妞ゆ帒顦伴ˉ鍫ユ煟鎼淬値娼愭繛鎻掔箻瀹曟繈骞嬮敂琛″亾娴ｇ硶鏋庨柟鐐綑娴滄鏌熼懖鈺勊夋俊鎻掓噹铻為柟閭﹀幘缁♀偓闂佹眹鍨藉褍鏆╂俊鐐€х紞鈧俊顐㈠瀹撳嫰姊洪崨濠勨姇婵炲吋鐟╁畷褰掑磼閻愮补鎷婚梺鍓插亞閸犳捇濡撮幒妤佺厸闁糕槅鍘鹃悾鐢告煛瀹€瀣М濠殿喒鍋撻梺闈涚箚閺呮繈宕濋幖浣光拺缂備焦蓱鐏忔壆绱掔拠鑼ⅵ鐎殿喖顭烽弫鎾绘偐閼碱剦妲伴梻渚€娼ч…鍫ュ磿椤曗偓瀹曟垿骞樼紒妯轰缓缂備礁顑堝▔鏇㈡晬濞戙垺鈷戦悷娆忓缁€鍐偓瑙勬礋濞佳囨偩閸偆鐟归柍褜鍓熷璇测槈閳垛斁鍋撻敃鍌氱婵犻潧娲ㄦ禍顏勨攽閻樻剚鍟忛柛鐘崇墵閺屽﹪鏁愰崪浣圭稁濠电偛妯婃禍婵嬪磻閿熺姵鐓涘璺侯儏椤曟粍鎱ㄩ敐鍡楀缂佽鲸鎸婚幏鍛存惞閻熸壆顐奸梻浣瑰瀹€鎼佸蓟閿濆鏅查柛銉戝啫绠ｆ俊銈囧Х閸嬫稑煤椤撱垹绠栫憸鏂跨暦婵傜顫呴柣妯荤暙閿曞倹鈷戦悹鍥ㄧ叀椤庢绱掗悩鑼х€规洘娲熷畷锟犳倷瀹ュ棛鈽夐柍钘夘樀婵偓闁绘ɑ褰冩禍鍫曟⒒閸屾瑧璐伴柛鎾寸懅缁棃鎮介弶鍡楊槹缁绘繈宕橀敂璺ㄧ泿闂備浇顫夋竟瀣疾濞戙垺鍊舵い蹇撳閻斿棝鎮归崫鍕儓妞ゅ浚鍙冮弻鈥崇暆閳ь剟宕伴弽褏鏆﹂柕濠忓缁♀偓闂佸憡鍔戦崝澶愬磻閹捐绠涙い鏃傛嚀娴滅偓绻涢崼婵堜虎闁哄鍠庨埞鎴︽倷鐠囇嗗惈濡ょ姷鍋涢崯瀛樻叏閳ь剟鏌曢崼婵囶棡闁稿寒浜娲閳轰胶妲ｉ梺鍛婄懃缁绘帒危閹版澘钃熼柕澶涜吂閹风粯绻涢幘鏉戠劰闁稿鎹囬弻宥堫檨闁告挻鐩畷鎴濃槈閵忊€虫濡炪倖鐗楃粙鎺戔枍閻樼偨浜滈柡鍥殔娴滈箖姊洪崫鍕効缂傚秳绶氬顐﹀箛閺夊灝鑰垮┑鐐叉閸ㄥ綊寮舵禒瀣厽閹兼番鍊ゅ鎰箾閸欏鐭掔€规洑鍗冲浠嬵敇濠ф儳浜惧ù锝堝€介弮鈧幏鍛存偡闁腹鍋撻幘缁樷拺闂傚牃鏅涢惁婊堟煕濡厧甯舵い?
  // 闂?item.textContent 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋锝嗩棄闁哄绶氶弻鐔兼⒒鐎靛壊妲紒鐐劤椤兘寮婚敐澶婄疀妞ゆ帊璁查弸娆撴⒑缂佹ê绗╁┑顔哄€楅幑銏犫槈閵忕姴鑰垮┑鈽嗗灥椤曆呭枈瀹ュ鐓熼柣鏂挎憸閹虫洜绱掗悩铏磳妤犵偛鍟灃闁告侗鍠楀▍婊堟煙閼测晞藟闁逞屽墯閸撴艾顭囨繝姘拻濞达絽鎲￠幆鍫熴亜閹存繃鍤囬柟顔ㄥ棛鐤€婵炴垶顭囬崝锕€顪冮妶鍡楀潑闁稿鎸剧槐鎺楁偐閼碱儷褏鈧娲樺ú鐔风暦閿熺姵鍊风€广儱妫涘ú瀵糕偓娈垮櫘閸ｏ絽鐣烽幒鎴旀婵☆垵娅ｉ崫搴ㄦ⒒閸屾瑨鍏岀痪顓炵埣瀹曟粌鈹戦崼銏㈢厯闂佸湱鍎ら〃鍡涘磻閸岀偞鐓涢柛銉㈡櫅閺嬫梻绱掗埦鈧崑鎾绘⒒閸屾艾鈧悂鎮ф繝鍕煓闁硅揪瀵岄弫鍌炴煃閸濆嫭鍣洪柣鎾存礋閺岋繝宕橀敐鍛婵＄偑鍊戦崝宀勬晝椤忓嫷鍤曢悹鍥ㄧゴ濡插牊鎱ㄥ鍫㈠埌濞存粓绠栭弻銊モ攽閸℃侗鈧霉濠婂嫮绠橀柍褜鍓濋～澶娒洪弽顓熷剹闁稿瞼鍋涢拑鐔兼煟閺冨倵鎷￠柡浣革躬閺岀喖顢涢崱妤€鏆欑紒鐙呯秮閺岋絾鎯旈姀鈺佹櫛闂佸摜濮甸悧鐘诲箖閵夛妇闄勯柛婵勫劚缁侊箓姊鸿ぐ鎺戜喊闁告ü绮欏畷鏇㈡偄閸忚偐鍘棅顐㈡搐閿曘儱鈻嶉崨瀛樼厵妞ゆ洖鎳嶇花鑲╃磼缂佹绠為柟顔荤矙濡啫霉闊彃鍔﹂柡灞稿墲閹峰懘宕ㄦ繝鍌涙畼闂備線鈧稓鈹掗柛鏃€鍨块悰顔碱潨閳ь剟銆佸▎鎾村殟闁靛濡囪ぐ鍥⒒閸屾瑧绐旀繛浣冲泚鍥敃閿曗偓閻ょ偓绻涢幋娆忕仼闁搞劌鍊块弻娑樼暆閳ь剟宕戦悙鐑樺亗闁哄洨濮甸崰鎰板箹濞ｎ剙濡搁柍褜鍓欓崯鏉戠暦閻撳簶鏀介柛顐ゅ枑椤旀挸鈹戦悙瀛樺鞍闁糕晛鍟村畷鎴﹀箻缂佹鍘介梺鐟扮仢閸燁偅绂嶉幍顔瑰亾鐟欏嫭绀€闁绘牕鍚嬫穱濠傤潰瀹€濠冃ユ繝纰樺墲瑜板啴鎮ц箛鏇燁潟闁规儳鐡ㄦ刊鎾煙缂佹ê绗傚瑙勬礋濮婄粯鎷呮笟顖滃姼闂佹椿鍓欓妶绋跨暦閹达附鍊烽柣鎴灻禍妤呮⒑缂佹ɑ鐓ラ柛姘儔閹€斥枎閹惧鍘甸柣鐔哥懃鐎氼剚鎱ㄩ崼銉︾厽婵犲灚鍔掗柇顖炴煛瀹€鈧崰鏍箚閸岀偛浼犻柕澶堝劚閻撳倿姊?"...F2617123,100闂?闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕婵犲倹鍋ラ柡灞诲姂瀵噣宕奸悢鍛婎唶闂備胶顭堥鍡涘箰閸撗冨灊妞ゆ挾鍋愬Σ鍫熶繆椤栨繍鍤欐繛鍛囧洦鈷戞繛鑼额嚙楠炴鏌ｉ悢鍙夋珚鐎殿喖顭烽幃銏ゅ川婵犲嫮肖闂備礁鎲￠幐鍡涘川椤旂瓔鍟呴梻鍌欐祰椤曆呪偓娑掓櫊閹虫繃銈ｉ崗顖氭处鐎靛ジ寮堕幊绛圭畵閺屾盯寮撮妸銉т哗缂備胶濮垫繛濠囧蓟閻旇　鍋撳☉娆樼劷缂佺姰鍎遍湁闁绘挸娴烽悞鍛婃叏婵犲嫬鍔嬫繛纰变邯楠炲秹顢氶崨顔ф粍绻濈喊妯活潑闁稿鎳橀幃鐤樄妤犵偞鍨挎慨鈧柣姗嗗亝閺傗偓闂備焦鎮堕崕顕€寮插┑瀣剨闁割偁鍎查埛鎴犵磼鐎ｎ偄顕滄繝鈧幍顔剧＜妞ゆ棁鍋愰悞鎼佹煏閸℃鈧潡骞栬ぐ鎺戞嵍妞ゆ挾濯寸槐鍐测攽閻愯埖褰х紒鍙夊礃閵囨劙宕橀埡鍐炬锤婵°倧绲介崯顖炲煕閹寸姷纾兼い鏍ㄧ⊕缁€鈧繝鈷€鍐ㄧ骇闁靛洤瀚伴、姗€鎮欓弶鎴犵崺缂傚倷绶￠崰姘卞垝椤栫偛围闁挎繂顦粈鍐煃閸濆嫬鏆欐鐐茬墦濮婄粯鎷呯憴鍕紘闂佸搫鎳忛惄顖氱暦閺夋娼╂い鎴ｅГ閻忎礁鈹戦埥鍡楃仴闁稿鍔楁竟鏇熺附閸涘﹦鍘藉┑鈽嗗灥濞咃綁鏁嶅澶嬬厱婵炲棗鑻禍楣冩⒒閸屾瑧顦﹂柟纰卞亰瀵敻顢楅崒婊呯厯闂佸湱鍎ゅ鐟扮暦閸欏绡€闂傚牊渚楅崕蹇曠磼閳ь剟宕橀埞澶哥盎闂婎偄娲﹂幐鎼侇敂閵堝鐓欏瀣椤ｈ偐绱掔紒妯肩畵闁崇粯鎹囧畷褰掝敊閻ｅ奔閭梻鍌欑劍鐎笛兠鸿箛娑樼？闂侇剙绉埀顒佹瀹曟﹢鍩￠崘鐐カ闂佽鍑界紞鍡涘礈濞嗘垹鐭堥柨鏇炲€归埛鎴犳喐閻楀牆绗掑ù婊€鍗抽弻娑樜熼崷顓犵厯閻庤娲樺ú鐔煎箖閵忋倕绀傞柤娴嬫櫅瀵櫕绻濋悽闈涒枅婵炰匠鍏炬稑鈻庨幘宥咁槸椤劑宕熼鐙€鍟庨梻浣告啞娓氭宕㈤悙顒佹珡濠?
  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑鐐烘偋閻樻眹鈧線寮村杈┬㈤梻浣规偠閸庢椽宕滈敃鍌氭瀬闁告劦鍠楅悡銉╂煛閸ヮ煈娈斿ù婊堢畺濮婂搫效閸パ€鍋撳Δ鍛；闁规崘鍩栧畷鍙夌節闂堟稒宸濈紒鈾€鍋撻梻浣侯焾閺堫剛鍒掑畝鍔肩兘鍩€椤掑嫭鈷掑ù锝勮閻掔偓銇勯幋鐐茬仼闁瑰箍鍨归埞鎴犫偓锝庝海閹芥洟姊洪崫鍕偍闁搞劌缍婇弻瀣炊閵娧呯槇闂佸壊鐓堥崑鍕叏閸儱鏋侀柛顐犲劜閳锋帒霉閿濆牊顏犻悽顖涚洴閺岀喖宕ㄦ繝鍐ㄢ偓鎰偓瑙勬礃閸旀瑥鐣烽悜绛嬫晣闁绘柨鍢茬花銉︾節閻㈤潧鈻堟繛浣冲厾娲Ω瑜嶆慨顒勬煃瑜滈崜鐔奉潖閾忓湱鐭欓柟绋垮閹疯京绱撴笟鍥ф灈闁活厼鍊挎俊鎾磼閻愬瓨鍎梺闈╁瘜閸橀箖鏁嶅┑鍥╃閺夊牆澧界粙鑽ゆ喐閺夊灝鏆炵紒鍌氱У閵堬綁宕橀埞鐐闂備礁鎲＄粙鎴︽晝閵夛箑绶為柛鏇ㄥ灡閻撴洟鏌曟繛鐐珒闁规煡绠栭弻鐔碱敋閸℃瑧鐦堥梺璇″枓閺呮繄妲愰幒鎳崇喖鎮℃惔锛勵吋婵犵绱曢崑鎴﹀磹閺嶎厼绠板Δ锝呭暙缁愭骞栨潏鍓ф偧缂佺姵妫冮弻鐔兼倻濮楀棙鐣烽梺缁樻尰濞茬喖寮婚敓鐘茬闁挎繂鎳嶆竟鏇犵磽閸屾瑧璐伴柛鐘崇墱缁棃宕奸弴鐐殿唹闂侀潧绻掓慨顓炍ｉ崼銉︾厪闊洦娲栭埢鍫ユ煕閻愯尙鍩ｆ慨濠冩そ楠炴劖鎯旈敐鍥╂殼婵犵妲呴崑鍛存儎椤栨稐绻嗛柟缁㈠枛缁犳盯鏌ｅΔ鈧悧鍐箯婵犳碍鈷戦柟鑲╁仜閸斺偓闁诲繒鍋ら弫顕€寮搁崨瀛樷拻濞达絽鎲￠幆鍫ユ煟椤撶儐妲虹€垫澘锕畷鎰版偄鏉炴媽鍩呴梻鍌氬€烽懗鍫曞储瑜旈敐鐐哄即閵忕姷锛欓梺鍝勬川閸庢劙宕甸弴銏＄厪濠电偛鐏濋崝瀛樼箾閹炬剚鐓奸柡灞炬礋瀹曠厧鈹戦崶褎顏犳俊鐐€栫敮鍥垂濞差亜桅闁告洦鍨版儫闂侀潧顧€鐎靛苯螞閿旂晫绡€缁炬澘顦辩壕鍧楁煛娴ｇ瓔鍤欓柣锝囧厴閹垻鍠婃潏銊︽珫婵犳鍠楅…鍫熺椤掆偓椤洦寰勯幇顓涙嫽婵炴挻鍩冮崑鎾绘煃瑜滈崜娑㈠磻濞戙垺鍤愭い鏍ㄧ⊕濞呯娀鎮楅悽鐢点€婇柛瀣尵閹叉挳宕熼鍌ゆО缂傚倷娴囬褔宕愰崸妤€鏄ラ柕蹇婂墲閸庣喖鏌曢崼婵囧窛闁哄鎮傚娲传閸曨剙绐涢梺鍝ュУ閸旀瑩銆佸▎鎾冲嵆闁靛繆妾ч幏缁樼箾鏉堝墽鎮奸柣鈩冩煥椤洭骞囬悧鍫㈠幈闁硅壈鎻徊鐣屾暜閸洘鎳氶柣鎰劋閻撴洟鏌￠崶銉ュ濠⒀屽櫍閺屾盯寮埀顒€螞閸愵煈娼栧┑鐘宠壘绾惧吋绻涢崱妯虹仼闁绘稏鍨归埞鎴︽倷閺夊灝鐨熼梺鎼炲劙缁€浣该洪顫偓浣割潨閳ь剚鎱ㄩ埀顒勬煟濡⒈鏆滅紒杈╂暬濮婄粯鎷呴崨濠冨創闁荤偞鍑归崑濠傜暦閺囥垹纭€闁绘劖鍓崶褑鎽曢梺闈涱檧婵″洭宕㈤鍛瘈闁靛骏绲剧涵鐐繆椤愶絿鎳冮柍璇茬Ч瀹曞崬鈽夊▎鎴濆笚闂傚倷绀侀悘婵嬵敄閸涱垳绠旈柟鐑橆殕閻撳繘鏌涢埄鍏狀亞绮幒鎾变簻妞ゆ劧绲跨粻鐐淬亜閵忊槅娈曢柟宄版噽閹叉挳宕熼鐔蜂壕闁绘垼濮ら埛鎺懨归敐鍛暈闁诡垰鐗婇妵鍕箣濠靛浂妫為柧鑽ゅ仱閺屾盯骞囬棃娑欑亪闂佽棄鍟伴崰鎰崲濞戙垹绠ｆ繛鍡楃箳娴犵厧鈹戦埥鍡椾簼闁挎洏鍨藉璇测槈濠婂孩歇婵＄偑鍊戦崝宀€鎹㈠鈧畷娲焵椤掍降浜滈柟鍝勭Ф鐠愮増绻涢崼鐔虹煉闁哄瞼鍠栭、姘跺幢濞嗘垹妲囧┑鐘茬棄閵堝懐鍘悗鍨緲鐎氼噣鍩€椤掑﹦绉甸柛鎾寸懇閻涱噣宕奸妷锔惧幗闂佺粯鏌ㄩ幗婊堟儗婵犲洦鈷戦悽顖ｅ枤缁夘喖鈹戦埄鍐╁唉鐎规洘锕㈤、娆撴偂鎼达絿宕哄┑锛勫亼閸婃牠鎮уΔ鍐ㄥ灊闁割偁鍨荤粻鏂款熆閼搁潧濮堥柍閿嬪灴閹嘲鈻庤箛鎿冧患闂佸憡妫佸▔娑㈠煘閹达富鏁婇柛婵嗗閸嬫挸鈹戠€ｎ亞鐣洪梻鍕川缁鈽夐姀鐘殿啌闂佸憡鍔︽禍婊堝极閹间焦鈷掑ù锝呮惈鐢爼鏌熼懞銉х煉鐎殿噮鍋婇獮鏍ㄦ媴閼叉縿鍎甸弻鐔兼倻濮楀棙鐣烽梺缁樻尵閸犳牠寮婚妸銉㈡斀闁糕剝鐟ラ埅鐢告⒑閸涘﹦绠栨俊鐐扮矙瀵?闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻濞戔懞鍥偨缁嬫寧鐎梺鐟板⒔缁垶宕戦幇鐗堢厱闁归偊鍨扮槐锕傛煟閵忕媭鐓兼慨濠勭帛缁楃喖鍩€椤掆偓椤洩顦归柍銉畵瀹曞ジ濡烽妷褝绱垫俊鐐€栧ú宥夊磻閹惧灈鍋撳▓鍨灍闁诡喖鍊搁锝嗙鐎ｎ€晝鎲歌箛娑辨晩闁哄洢鍨洪埛鎴︽煟閻旂顥嬮柟鐣屽█閺岋綁鎮㈤弶鎴濆Е闂佽鍠楅敃銏ゃ€侀弮鍫濋唶闁绘柨鎼獮鍫ユ⒑鐠囨彃鍤辩紒鎻掝煼瀹曟繂鐣濋崟顐ゅ姦濡炪倖甯婇懗鑸垫櫠闁秵鐓欐鐐茬仢閻忊晠鏌嶉挊澶樻█濠殿喒鍋撻梺缁橆焾鐏忣亪鍩€椤掆偓閻忔繈鍩為幋锕€鐓￠柛鈩冾殘娴犫晠姊洪崷顓涙嫛闁稿锕弫鎰版倷鐎涙ê鍔呴梺瀹犳濡瑧鈧潧鐭傚娲濞戞艾顣洪梺绋匡功閹虫捇鍩㈠澶婄倞妞ゆ帊鑳堕崢閬嶆椤愩垺澶勯柡瀣€块、鏃堝醇椤掑倻鈼ら梻濠庡亜濞诧箓骞忕€ｎ€㈡椽顢斿鍡樻珕闂備礁鎲″ú锕傚磻閸℃稑鐒垫い鎺戭槸楠炴牗銇勯鍕殻濠碘€崇埣瀹曞崬螣绾拌鲸袣闂傚倷鑳堕幊鎾诲疮閸ф鐓€闁挎繂鎳愰弳锔界節婵犲倻澧涢柟顖滃仦閵囧嫰骞囬埡浣插亾濡ゅ懏鍎婇柛顐犲劜閳锋垿姊婚崼鐔烘创闁绘稒绮庣槐鎾愁吋閸涱噮妫炲銈庡幖濞差參鐛崶顒佸亱闁割偁鍨归獮鍫ユ⒒娴ｅ憡鎯堥柛鐔哄█瀹曟垿骞樼紒妯煎幗闂佺粯鏌ㄥ璺衡枍閸涱喓浜滈柡鍥朵簽閹ジ鏌熸搴⌒㈤棁澶愭倵閿濆骸浜芥繛鍏兼⒐缁绘繈鎮介棃娴躲垽鏌ㄩ弴妯衡偓婵嬬嵁婵犲洤绠涢柡澶庢硶妤犲洭姊鸿ぐ鎺擄紵闁绘帪绠撻崺娑㈠箣閿旇棄浠┑鐐叉缁绘劙顢旈埡鍐＜闁逞屽墴瀹曟﹢鍩￠崘顏嶅晭闂備礁鎲℃笟妤呭窗濡ゅ啰鐭嗛柍褜鍓熷鍝勭暦閸モ晛绗￠梺鍦嚀濞层倝鎮惧畡閭︾叆闁告洦鍓欓鎾绘⒑閹呯婵炲懌鍨诲Σ鎰板礃濞村鏂€闂佺粯鍔橀崺鏍亹瑜忕槐鎺楀矗婢跺﹦顦ㄩ梺闈涙处閸旀瑥鐣峰鈧崺锟犲礃閻愵剟鏁?闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕婵犲倹鍋ラ柡灞诲姂瀵噣宕奸悢鍛婎唶闂備胶顭堥鍡涘箰閸撗冨灊妞ゆ挾鍋愬Σ鍫熶繆椤栨繍鍤欐繛鍛囧洦鈷戞繛鑼额嚙楠炴鏌ｉ悢鍙夋珚鐎殿喖顭烽幃銏ゅ川婵犲嫮肖濠德板€х徊浠嬪疮椤栫儐鏁佺€广儱顦伴埛鎴犵磼鐎ｎ偒鍎ラ柛搴＄箲閵囧嫰骞嬪┑鎰枅閻庢鍠涢褔鍩ユ径鎰潊闁绘﹢娼ф慨鍫曟⒒娴ｅ憡鍟為柛鏃€鍨垮畷婵嗩吋婢跺﹦鐣惧┑鐐村灦閻熝呯不妤ｅ啯鍊垫繛鎴炵懐閻掍粙鏌ｉ鐑囨敾缂佺粯绻堥崺鈧い鎺戝閻掕偐鈧箍鍎遍幊鎰版偪閸涘瓨鈷戠憸鐗堝笚閿涚喓绱掗埀顒佹媴閼叉繃绋戦～婊堝焵椤掑嫬绠栫憸鐗堝笒缁犳帡鏌熼悜妯虹仴妞ゎ剙顦埞鎴︽倷閼碱剙鈪电紓浣哄У閻楁洟锝炶箛鎾佹椽顢旈崪浣诡棃婵犵數鍋為崹鍏笺仈缁嬭法鎽ラ梻鍌氬€风粈渚€骞栭锕€绠犲鑸靛姇閻ら箖鏌ｅΟ鐑樷枙闁搞倖娲橀妵鍕箛閸撲胶鏆犵紓浣插亾闁告劏鏂傛禍婊堟煛閸愩劌鈧懓鈻嶉弴銏＄厱婵炲棗绻戦ˉ婊堟煃鐟欏嫬鐏撮柟顔规櫇缁辨帒螣婵犳碍鏆樺┑鐘殿暯濡插懘宕戦崨瀛樺仭闁冲搫瀚敍鍌炴⒒娴ｈ櫣甯涢柛鏃€鐗犻幃楣冾敂閸涱垼娲稿┑鐘诧工閻楀﹪鎮″☉銏＄厱閻忕偛澧界粻鏍棯椤撶偟鍩ｇ€殿噮鍋婂畷濂稿Ψ閿旇瀚?闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻濞戔懞鍥偨缁嬫寧鐎梺鐟板⒔缁垶宕戦幇鐗堢厾缁炬澘宕晶缁樹繆閼碱剙鍘存慨濠勭帛閹峰懘宕ㄦ繝鍐ㄥ壍婵犵數鍋涢惇浼村礉閹存繄鏆﹂柟鎵閺呮煡鏌涘☉鍙樼凹妞ゎ偄绉撮埞鎴︻敊閺傘倕鍙曠紓浣藉蔼婵倗绮嬪鍡愬亝闁告劏鏂侀幏濠氭⒑閸撴彃浜為柛鐘虫崌閸╁﹪寮撮姀锛勫幈闂佺粯鏌ㄩ幖顐ｇ閿曞倹鐓忛柛銉戝喚浼冨銈冨灪濞茬喖寮幇鏉垮耿婵炲棙蓱琚ㄩ梻鍌氬€风欢姘跺焵椤掍胶銆掗柍瑙勫浮閺屾盯寮捄銊у姰闂佽绻戠敮鈥愁潖濞差亜绀堥柤纰卞墮鐢儵姊洪崫銉バｇ€光偓缁嬭法鏆﹂柕蹇嬪€ら弫鍐煥閺冨泦鎺楀箯濞差亝鈷戦柛娑橈功缁犳捇鎮楀鐓庡箺闁告帒锕ョ缓浠嬪川婵犲嫬骞堥梻浣筋潐閸庢娊顢氶鐏绘椽骞橀鐣屽幈闂佸疇顫夐崕铏閻愵兛绻嗛柣鎰典簻閳ь剚鐗曢蹇旂節濮橆剛锛涢梺鐟板⒔缁垶鎮￠弴鐔剁箚妞ゆ牗绻傞崥褰掓煟椤撶喎绗ч柍褜鍓濋～澶娒哄鈧畷褰掑锤濡ゅ啫绁﹀┑鈽嗗灥閸嬫劗澹曢崗闂寸箚妞ゆ牗绮岀敮鑸殿殽閻愯尙澧︽慨濠勭帛閹峰懐绮电€ｎ偆绉锋繝鐢靛О閸ㄦ椽鏁冮姀鐘垫殾闁靛鏅涢悞鍨亜閹烘垵鈧崵澹曟總鍛婄厪濠电偛鐏濇俊鑲╂偖濮樿埖鈷戦梻鍫熺⊕閹兼劙鎮楀顓熺凡妞ゆ洩缍侀、妤呭焵椤掑嫬鐓濋幖娣妽閸婇攱銇勯幋锝呅撻柣搴㈡緲閳规垿鎮╅幇浣告櫛闂佸摜濮甸悧鐘诲极閸愵喖唯闁靛鍠楃€靛本绻涚€电孝妞ゆ垵娲ら悾鍨瑹閳ь剟寮婚垾鎰佸悑閹肩补鈧磭顔戦梻浣侯焾閿曪箓宕楀鈧濠氭偄閾忓湱锛滃┑鈽嗗灥濞咃綁鎮烽妸鈺傚仩婵﹩鍙忛懓鎸庢叏婵犲偆鐓肩€规洘甯掗埢搴ㄥ箳閹存繂鑵愬┑锛勫亼閸娿倝宕㈡總鍛婂亱闁圭偓鐪归埀顑跨窔瀵粙顢橀悙鑼垛偓鍨攽閻愭潙鐏﹂柣鐔村劦瀹曟粓顢欑喊杈ㄥ瘜闂侀潧鐗嗗Λ娑欐櫠椤掍焦鍙忔俊顖滎焾婵倻鈧鍠楁繛濠囧极閸岀偛绠ｉ柟鐑樻⒒閻ｉ箖姊绘笟鈧褔鎮ч崱娑樼疇闊洦绋戦梻顖涚箾瀹割喕绨奸柣鎾跺枛閺岀喖鎮滃Ο鑽ゎ槬婵炲瓨绮岀紞濠囧蓟瀹ュ牜妾ㄩ梺鍛婃尰閻熝呭垝鐠囧樊鍚嬪璺猴功閿涚喖姊绘笟鍥у缂佸顕划濠氭偐缂佹鍘甸梺鍝勵槸閻忔繆銇愰崟顖涚厱闁靛鍠栨晶顕€鏌ｉ幘瀵告创闁哄本绋戦埥澶愬础閻愬浜愰梻浣哥秺閺€鍗烆渻閽樺娼栫紓浣诡焽閻熷綊鏌涢妷鎴濆€婚弫鏍⒒娴ｄ警鐒炬い鎴濇閹嫰顢涢悙鑼枃闂佺粯姊婚埛鍫ュ极瀹ュ棛绠鹃柟瀵稿仧閹冲嫰鏌ｅ┑鍫濆幋闁哄矉绲鹃幆鏃堟晲閸℃ɑ鐦庣紓浣鸿檸閸樺ジ鎮ラ悡搴ｆ殾闁硅揪绠戠粻濠氭煛閸屾ê鍔滈柣蹇庣窔濮婃椽宕滈懠顒€甯ラ梺鍝ュУ椤ㄥ﹪骞冮悽鍓叉晪闁逞屽墮椤繐煤椤忓嫬绐涙繝鐢靛Т閸燁偊寮冲Δ鍛拺闁告縿鍎卞瓭闂備礁搴滅紞渚€鐛崘鈹垮亝闁告劏鏅涢埀顒€顭烽弻锕€螣娓氼垱鈻堥梺鍝ュ仜閻栫厧顫忓ú顏勪紶闁告洦鍓欑粣娑㈡⒑缁嬫鐓紓宥勭窔瀹曟椽鏁撻悩鎻掔獩濡炪倖姊归崕鍐差嚕閹惰姤鈷掑ù锝呮啞閹牓鏌涢悤浣镐簻閻撱倝鏌ㄩ弴鐐扮椽濠㈣泛顑呯欢鐐烘倵閿濆啫濡虹紒銊ヮ煼濡懘顢曢姀鈩冩倷婵°倗濮烽…鍫ユ偩閻㈢骞㈡俊顖濐嚙瀵?
  function findPriceElementText(container) {
    const candidates = container.querySelectorAll
      ? container.querySelectorAll('span, li, dd, td, p, strong, b')
      : [];
    for (const el of candidates) {
      const text = String(el.textContent || '').replace(/\s+/g, '').trim();
      // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋锝嗩棄闁哄绶氶弻鐔兼⒒鐎靛壊妲紒鐐劤椤兘寮婚敐澶婄疀妞ゆ帊璁查弸娆撴⒑缂佹ê绗╁┑顔哄€楅幑銏犫槈閵忕姴鑰垮┑鈽嗗灥椤曆呭枈瀹ュ鐓熼柣鏂挎憸閹虫洜绱掗悩铏磳妤犵偛鍟灃闁告侗鍠楀▍婊堟煙閼测晞藟闁告挻绻堥幃妯侯吋婢跺鎷洪梺鍛婄箓鐎氼厽鍒婇悡骞熺懓顭ㄦ惔婵堢泿濡炪値鍋勭换鎺旀閹烘嚦鐔烘嫚瀹割喒鍋撻幘缁樷拺闁告稑锕﹂埥澶愭煥閺囨ê鈧繂顕ｉ幎钘夐唶闁靛濡囬崣鍐⒑閸涘﹤濮﹂柛鐘虫礋楠炲銈ｉ崘鈺冨幐閻庡厜鍋撻悗锝庡墰琚﹂梻浣虹《閺備線宕滃┑鍫熷床婵犻潧顑呯壕鍏肩節婵炴儳浜鹃梺鍛婄箖椤ㄥ﹤顫忕紒妯诲濡炲绨肩憰鍡欑磽娴ｇ懓绲绘繛灏栤偓宕囨殾婵°倐鍋撴い顐ｇ矒閸┾偓妞ゆ帒瀚畵渚€鏌涢幇闈涙灈闁绘挻鐩弻娑樷槈閸楃偛绠婚梺浼欑稻婵炲﹤顫忓ú顏呭仭闁绘鐗婇崕鎾剁磽娴ｅ壊妲洪柡浣割煼楠炲棝宕奸敐鍥╂澑濠电偞鍨堕悷銏ゅ箯缂佹绠鹃弶鍫濆⒔閸掍即鏌熺拠褏纾块柟宄扮秺閺佹捇鎮╁畷鍥у箞闂佸湱鍘ч悺銊х矙閹达箑鐒垫い鎺嶈兌缁犳捇鏌ｉ敐鍥ㄧ効闁靛洦鍔欓獮鎺楀箻閸忓懐绱﹂梻鍌欑婢瑰﹪鎮￠崼銉ョ；闁告洦鍨遍崕?"X,XXX闂? 闂?"XXX闂? 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛婵°倗濮烽崑鐐烘偋閻樻眹鈧線寮村杈┬㈤梻浣规偠閸庢椽宕滈敃鍌氭瀬闁告劦鍠楅悡銉╂煛閸ヮ煈娈斿ù婊堢畺濮婂搫效閸パ€鍋撳Δ鍛；闁规崘鍩栧畷鍙夌節闂堟稒宸濈紒鈾€鍋撻梻浣侯焾閺堫剛鍒掑畝鍔肩兘鍩€椤掑嫭鈷掑ù锝勮閻掔偓銇勯幋鐐茬仼婵″弶鍔欏鎾閻樼數鏋€闂備礁缍婂Λ璺ㄧ矆娴ｈ櫣灏电€广儱顦伴悡鏇熴亜閹扳晛鈧洟寮搁幋鐐电闁告侗鍠氶惌鎺撴叏婵犲懏顏犵紒杈ㄥ笒铻ｉ柛婵嗗濞兼捇姊绘担鍛婅础闁冲嘲鐗撳畷鎴﹀幢濞嗗繐鐏婃繝鐢靛У閼瑰墽绮婚鈧弻銈夊箒閹烘垵濮㈤梺鍛娚戦幃鍌氼潖濞差亜宸濆┑鐘插€搁～鍥⒑閸涘﹥鐓ラ柣顓炲€垮畷娲焵椤掍降浜滈柟鍝勬娴滃墽绱撻崒姘毙㈤柨鏇ㄤ簻椤曪綁顢曢姀鈺佹倯闂佸壊鍋侀崹濠氬级閹间焦鈷戦柣鐔稿娴犮垽鏌涢悤浣哥仯闁逞屽墴濞佳囨儗閸屾凹娼栨繛宸簼椤ュ牊绻涢幋鐐跺妞わ絽鎼埞鎴﹀煡閸℃ぞ绨肩紓浣割儐鐢€愁嚕閺屻儱閱囬柡鍥ュ妽閺呫垽姊洪崨濠冨闁告挻鐩畷銏＄鐎ｎ偀鎷虹紓鍌欑劍钃遍柍閿嬪姉缁辨帞鎷犻幓鎺嗗亾閸濄儱寮查梻渚€娼ч…鍫ュ磿閹惰棄姹查柕鍫濇噷閳ь剚甯掗～婵嬫晲閸涱剙顥氶梻鍌欑閹碱偊寮甸鍕剮妞ゆ牜鍋涢弰銉╂煕閺囥劌鐏犵紒鈧崘鈹夸簻闊洤娴烽ˇ锔姐亜椤愩垻鐒告慨濠勭帛閹峰懘鎼归悷鎵偧闂備浇顫夐悺鏇炵暦閻㈤潧鍨濇繛鍡樻尭缁犲鎮归崶顏勭毢闁告棑绠戦—鍐Χ閸℃娼戦梺绋款儐閹稿墽妲愰幒妤佸亹闁肩⒈鍎疯閳ь剝顫夊ú妯好洪悢鐓庤摕闁糕剝顨忛崥瀣煕濞戝崬鐏ｉ柡瀣暣濮婃椽鎮烽弶鎸庡€梺浼欑秵娴滎亜鐣峰┑鍡欐殕闁逞屽墰閸掓帗绻濆顒€鍞ㄥ銈嗘尵閸犳捇宕㈤悽鍛婄厸濠㈣泛锕︽晶锔剧磼閻樺磭澧い顒€锕、姘跺焵椤掑嫬钃熼柨婵嗩槸缁犲鎮归搹鐟板妺闁诲海鍋撶换娑㈡晲閸涱喗鎮欓梺鎸庢处娴滄繃绌辨繝鍥ч唶闁哄洨鍋涚粣娑橆渻閵堝棙灏甸柛鐘虫尰缁傚秵銈ｉ崘鈹炬嫽婵炶揪缍€濞咃絿鏁☉銏″仺妞ゆ牗绮屾禒杈┾偓瑙勬礃閸ㄥ潡鐛Ο鍏煎珰闁告瑥鍋婄粻鎾诲蓟濞戙垹鍗抽柕濞垮劤娴犫晠姊洪崨濠庢畽婵炲懏娲熸俊鐢稿礋椤斿墽鏉搁梺鍦亾閹苯螞閵堝鍋犳慨妯哄⒔閹偐绱掓潏銊﹀磳鐎规洘甯掗埢搴ㄥ箳閹存繂鑵愭繝鐢靛У椤旀牠宕板璺烘瀬濠电姵鑹剧粻姘舵煕閺囥劌鐏遍柡浣哥У缁绘盯骞嬮悜鍡樼暭缂備胶濮靛畝绋款潖閸濆嫅褔宕惰閸嬫捇濡舵径濠傜€梺缁樻尭鐎诡偊鏁愭径濠勭暰閻熸粍绮岄妴鎺撶節濮橆厾鍘梺鍓插亝缁诲嫮绮诲ú顏呯厱婵﹩鍓欓埀顒€娼″濠氭晸閻樻彃绐涘銈嗙墬椤曟挳濮€鎺虫禍婊勩亜閹扳晛鐏紒鐘卞嵆閹繝濡堕崱鎰盎闂婎偄娲﹂幐鎼侇敂閳哄啰纾奸柟閭﹀幘閳洜绱掔紒妯肩疄闁诡喕绮欏Λ鍐归煬鎻掔伈闁诡喗顨呴埥澶愬箳閹惧褰嬮梻浣筋嚃閸ｏ絿绮婚弽褏鏆﹀┑鍌滎焾閸楁娊鏌ｉ弬鍨骇閻庢艾銈稿缁樻媴閸涘﹤鏆堢紓浣告惈濞尖€崇暦閺囥垺鐒肩€广儱鎳忔潏鍫ユ⒒娓氬洤澧紒澶屾暬閹€斥槈閵忥紕鍘卞┑鐐村灥瀹曨剟寮搁妶鍥╃＜闁绘ɑ鍨氶幋鐐碘攳濠电姴娲ら惌妤€顭跨捄鐚村伐妞ゎ偅甯″铏规嫚閳ヨ櫕鐏嶉梺鑽ゅ暱閺呮盯鎮鹃悜绛嬫晝闁挎洍鍋撶紒鈧€ｎ偁浜滈柟鎵虫櫅閳ь剚顨呴悾宄懊洪鍛嫽婵炶揪绲块悺鏃堝吹濞嗘挻鍊垫繛鎴炲笚濞呭洨绱掗鐣屾噰妤犵偞甯掗—鍐倻閳轰椒澹曢梺鎸庢礀閸婃悂鎮欐繝鍐︿簻闁瑰搫妫楁禍鍓х磽娴ｆ彃浜炬繝銏ｅ煐閸旀牠鍩涢幒妤佺厱妞ゆ劑鍊曢弸鏃堟煃缂佹ɑ宕岄柡宀嬬節閸┾偓妞ゆ帊鑳堕々鐑芥倵閿濆簼绨芥い鏂匡躬濮婅櫣鎲撮崟顐㈠Ц濠碘槅鍋勭€氼喗绔熼弴掳浜归柟鐑樻尵閸樼敻姊虹紒姗嗘當闁绘锕﹀▎銏ゆ嚑椤掑倹锛忛梺璇″瀻瀹€鈧崥瀣⒑閸濆嫮鐏遍柛鐘崇墵閻涱噣骞嬮敃鈧粻娑欍亜閹烘垵鈧摜鏁崸妤佲拻濞达絽鎲￠幉绋库攽椤旂偓鏆€规洘绻傞埢搴ㄥ箻鐎圭姵鎲伴梻浣规灱閺呮盯宕銈嗩偨闁绘劗鍎ら崐鐢告煥濠靛棛鍑归柟鏌ョ畺閺屾盯濡堕崪浣稿壎濠殿喖锕ㄥ▍锝囧垝濞嗗繆鏋庨柟顖嗗啫顥夐梻鍌欒兌椤牏鈧稈鏅滅换娑欑節閸パ勬К闂侀€炲苯澧柕鍥у楠炴帡骞嬪┑鍥╀壕婵犵數鍋涢崥瀣礉閺嶎偅宕叉繛鎴欏灩閻顭跨憴鍕濞存粠浜獮鍐箚瑜夐弨浠嬫煕椤愮姴鐏柣鎾存崌閺岋綁鎮╅崗鍛板焻闂佸憡鏌ㄧ粔鎾煝閹炬番鍋呴柛鎰ㄦ杹閹锋椽姊洪崨濠勨槈妞ゎ収鍓欓埢鎾愁潨閳ь剟寮诲☉姘ｅ亾閿濆骸浜滃┑顔兼喘瀹曪繝鏌嗗鍡欏幈濡炪倖鍔戦崐鏇㈠几閺冨倻纾奸柣妯垮吹閻ｆ椽鏌＄仦鍓ф创闁糕晛瀚板畷姗€鏁愰崱顓犵濠碉紕鍋戦崐鏇犳崲閹扮増鍋嬮柛鈩冪懅娑撳秹鏌″搴″箺闁绘挸鍟撮弻娑樷攽閸℃浠鹃梺闈╃稻濡炰粙寮?
      const labeledMatch = text.match(/^(\d{1,3}(?:,\d{3})+|\d+)闂?/);
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

    // 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋锝嗩棄闁哄绶氶弻鐔兼⒒鐎靛壊妲紒鐐劤椤兘寮婚敐澶婄疀妞ゆ帊璁查弸娆撴⒑缂佹ê绗╁┑顔哄€楅幑銏犫槈閵忕姴鑰垮┑鈽嗗灥椤曆呭枈瀹ュ鐓熼柣鏂挎憸閹虫洜绱掗悩铏磳妤犵偛鍟灃闁告侗鍠楀▍婊堟煙閼测晞藟闁告挻绻堥幃妯侯吋婢跺鎷洪梺鍛婄箓鐎氼厽鍒婇悡骞熺懓顭ㄦ惔婵堢泿濡炪値鍋勭换鎺旀閹烘嚦鐔烘嫚瀹割喒鍋撻幘缁樷拺闁告稑锕﹂埥澶愭煥閺囨ê鈧繂顕ｉ幎钘夐唶闁靛濡囬崣鍐⒑閸涘﹤濮﹂柛鐘虫礋楠炲銈ｉ崘鈺冨幐閻庡厜鍋撻悗锝庡墰琚﹂梻浣虹《閺備線宕滃┑鍫熷床婵犻潧顑呯壕鍏肩節婵炴儳浜惧┑鈩冾殕閹哥粯绌?DOM 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻濞戔懞鍥偨缁嬫寧鐎梺鐟板⒔缁垶宕戦幇鐗堢厱闁归偊鍨扮槐锕傛煟閵忕媭鐓兼慨濠勭帛缁楃喖鍩€椤掆偓椤洩顦归柍銉畵瀹曞ジ濡烽妷褝绱垫俊鐐€栧ú宥夊磻閹惧灈鍋撳▓鍨灍闁诡喖鍊搁锝嗙鐎ｎ€晝鎲歌箛娑辨晩闁哄洢鍨洪埛鎴︽煟閻旂顥嬮柟鐣屽█閺岋綁鎮㈤弶鎴濆Е闂佽鍠楅敃銏ゃ€侀弮鍫濋唶闁绘柨鎼獮鍫ユ⒑鐠囨彃鍤辩紒鎻掝煼瀹曟繂鐣濋崟顐ゅ姦濡炪倖甯婇懗鑸垫櫠闁秵鐓欐鐐茬仢閻忊晠鏌嶉挊澶樻█濠殿喒鍋撻梺缁橆焾鐏忣亪鍩€椤掆偓閻忔繈鍩為幋锕€鐓￠柛鈩冾殘娴犳潙顪冮妶鍡樿偁闁搞儺鐓堝Λ鍕倵楠炲灝鍔氭い锔垮嵆閸╂盯骞嬮敂鐣屽幍闂佸吋绁撮弲娑欑濠婂牊鐓冪憸婊堝礈濮橆優鍝勵煥閸涱厼鐏婇梺鍝勫暙濞层垺绂嶈ぐ鎺撶厵闁绘垶锚閻忛亶鏌熼懞銉︾闁宠鍨块幃娆撳级閹寸姳妗撻梻浣规た閸欏酣宕伴弽顓炵厺濞寸姴顑愰弫鍌炴煕椤愩倕鏋旈柛姗€浜跺娲捶椤撶偘澹曞銈冨妼閹虫﹢鐛繝鍥х疀闁哄鐏濋崑宥夋⒑瑜版帒浜伴柛蹇旓耿瀵劍绂掔€ｎ偆鍘介梺褰掑亰閸撴岸鍩㈤弴銏＄厱闁靛牆娲ら弸搴ㄦ煃鐟欏嫬鐏存い銏＄洴閺佹劙宕ㄩ鐘垫綁闂佽姘﹂～澶娒洪弽顐ょ濠电姴鍊婚弳锕€鈹戦崒婊庣劸闁告濞婇弻锝夊箛椤栨氨鍘梺纭呭紦閸楀啿顫忕紒妯诲闁荤喖鍋婇崵瀣磽娴ｅ壊鍎愰柛銊ョ秺閸┾偓妞ゆ帊绀侀崵顒€霉濠婂嫮鐭掗柛鈹垮灪缁傛帞鈧絽鐏氶弲婊堟⒑閸撴彃浜為柛鐘插缁傛帡顢涢悙绮规嫼闂佺鍋愰崑娑㈠礉濮椻偓閺屾盯寮捄銊т紘閻庡灚婢橀敃锕傚箯閻樿鍦偓锝庡亝閺夊憡淇婇悙顏勨偓鏍涙担瑙勫弿闁靛牆娲ㄩ惌鍡涙煕閹板吀绨界痪鎹愬亹缁辨挻鎷呯拠锛勫姺缂備胶濮烽崑娑㈠煘閹达富鏁婇柣鐔碱暒婢规洟姊婚崒娆戝妽閻庣瑳鍛床闁稿本澹曢崑鎾斥槈閹烘挻鐝栫紓浣戒含閸嬨倕鐣锋總绋课ㄩ柨鏃囶潐鐎氬ジ姊绘担鍛婅础妞ゎ厼鐗忛埀顒佺▓閺呮繃绔熼弴銏犵濞达絽婀遍崢閬嶆⒑闂堟侗鐒鹃柛鏂跨Ч钘熷璺侯儍娴滄粓鏌￠崶鏈电敖缂佸鍠楅妵鍕閳╁啰顦版繝娈垮枓閸嬫捇姊虹€圭姵銆冮柣鎺炵畵瀹曟劙顢涢悙绮规嫽婵炶揪绲介幉锟犲疮閻愮數纾兼い鏃囧亹婢э箓鏌熼鎯т槐闁轰礁鍟村畷鎺戭潩閹插闂梻鍌欑劍閻綊宕硅ぐ鎺戠疅闁跨喓濮撮悡鏇㈡煙鏉堥箖妾柣鎾存礃缁绘繈妫冨☉娆樻濡炪倕娴氶崑鍕€﹂懗顖ｆЧ闂佹悶鍔嬬划娆忣嚕婵犳艾鐒洪柛鎰ㄦ櫅椤庢捇姊洪崨濠勨槈闁挎洏鍎靛畷浼村箛椤戣姤鏂€闂佺偨鍎遍崯璺ㄧ棯瑜旈弻娑㈠籍閳ь剙煤閻斿吋鏅查柣鎰ゴ閺€浠嬫倵閿濆骸浜滄繛鍫熺箞濮婂宕掑鍗烆杸缂備礁顑呴悧鎾崇暦閹达箑绠婚悹鍥ㄥ絻閻庮厼顪冮妶鍡楀闁稿﹥顨婇、娆撳即閵忊檧鎷洪梺鍛婃尰瑜板啯绂嶅┑鍫㈢＜閻犲洦褰冮顏嗙磼閸屾稑娴┑顔瑰亾闂侀潧鐗嗗Λ娑㈠储閹间焦鐓熼幖鎼灣缁夌敻鏌涚€ｎ亝鍣归柣锝呭槻閻ｆ繈宕熼鍌氬箰?textContent 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧湱鈧懓瀚崳纾嬨亹閹烘垹鍊為悷婊冪箻瀵娊鏁冮崒娑氬幈濡炪値鍘介崹鍨濠靛鐓曟繛鍡楃箳缁犲鏌＄仦鍓ф创闁炽儻绠撻獮瀣攽閸涱垱鏅煎┑锛勫亼閸婃劙寮插鍡愪汗闁告劦鍠楃粻鎺楁⒒娴ｈ櫣甯涢柨姘繆椤栨熬韬€规洘娲濈粻娑㈠即閻樼绱查梻渚€鈧偛鑻晶顖溾偓鍨緲鐎氼喗绂掗敂鍓х煓濠㈠墎顭堥ˉ姘舵⒒娴ｄ警鐒剧紒缁樺姍钘濇い鏍ㄧ〒椤╂彃螖閿濆懎鏆為柍閿嬪灴閺屾稑鈽夊鍫熸暰婵犮垼娉涚€氫即寮诲☉姘ｅ亾閿濆簼绨绘い蹇ｅ幘閳ь剝顫夊ú姗€宕归悽鍓叉晣闁稿繒鍘х欢鐐烘倵閿涘崬瀚褰掓⒒娴ｈ棄鍚归柛鐘冲姍閹兘濡疯閸嬫挸顫濋悡搴☆潾缂備緡鍠栭悧鎾崇暦濮椻偓椤㈡瑩鎮剧仦钘夌疄闂傚倷绀侀崯鍧楀箹椤愶箑纾圭紓浣股戝▍鐘绘煟閵忕姵鍟為柣鎾卞劜缁绘繈妫冨☉姘暫婵炲濮炬禍顒勫焵椤掍緡鍟忛柛鐘愁殜楠炴劙鎼归锝呭伎闂侀€炲苯澧撮柡灞诲妼閳藉螣娓氼垯鎮ｆ俊銈囧Х閸嬬偤銆冮崱娆愬床婵犻潧鐗嗛弸鍫熶繆椤栨稒銇熸繛鍏煎灴濮婃椽骞栭悙鎻掝瀱闂佸憡顨嗘繛濠囨偘椤曗偓瀵粙顢樿閺呮繈姊洪幐搴㈢５闁稿鎸婚幈銊ф喆閸曨厼寮ㄩ悗娈垮枛閻栫厧鐣烽悡搴樻婵☆垯缍嶉埡鍌滅閻庢稒顭囬惌瀣磼椤旇姤宕岄柟顕嗙節椤㈡洟鏁冮埀顒勬倷婵犲洦鐓忓┑鐘茬箻濡绢噣鏌涙惔锟犲弰婵﹨娅ｇ槐鎺懳熺拠鑼暡闂備線娼ч悧濠囧箖閸屾凹鍤曞┑鐘宠壘閻忓磭鈧娲栧ú锕€鈻撻弴銏♀拺闂侇偆鍋涢懟顖涙櫠鐎电硶鍋撶憴鍕；闁告鍟块锝嗙鐎ｅ灚鏅ｉ梺缁橆焾鐏忔瑩濡堕敃鈧埞鎴︽倷鐎涙ê闉嶉梺绯曟櫅閸熸潙鐣烽幋锕€绠婚柟纰卞幗椤旀棃姊虹紒妯哄婵炲吋鐟ラ湁妞ゆ梻鐡斿▓浠嬫煟閹邦剚鈻曢柛搴＄箻閺屽秶鎲撮崟顐や紝閻庤娲戦崡鎶藉箖瑜斿畷濂告偄娓氼垱效濠电姵顔栭崰鏍晝閿旀儳鍨濇い鏍ㄧ矌缁犳棃鏌ｉ弮鍌氬付闁绘帒鐏氶妵鍕箳閹存繍浠奸梺缁樺笒閻忔岸濡甸崟顖氱闁瑰瓨绺鹃崑鎾诲川婵犲嫷娴勫┑鐘诧工閻楀﹪鎮￠悩宕囩闁煎ジ顤傞崵娆撴煟韫囥儳绡€闁哄矉绻濆畷銊╊敇閻樿尙鍘介柣搴㈩問閸犳盯宕洪弽顓炵畾闁哄啫鐗嗙粻濠氭倵濞戞鎴濐熆閹存績鏀介柨娑樺娴滃ジ鏌涙繝鍐ⅹ妞ゎ偄绻戠换婵嗩潩椤掑偊绱遍梻浣筋潐瀹曟﹢顢氳鏁堥柛娆忣槶娴滄粓鏌熼悜妯虹仴闁逞屽墰閺佽鐣烽幋锕€绠婚柤鎼佹涧閺嬪倿姊洪崨濠冨闁告挻鐩棟妞ゆ挶鍨洪埛鎴犵棯椤撶偞鍣洪柣婵愪邯閺岀喖鎮烽悧鍫濇灎闂佽桨鐒﹂崝娆撳箖濞嗗緷鍦偓锝庡亝閺夋悂姊虹拠鎻掑毐缂傚秴妫濆畷鎴﹀礋椤愮喐鐏佸┑鐘绘涧椤戝棝鍩涢幒妤佺厱閻忕偟鍋撻惃鎴濐熆瑜庣粙鎾舵閹烘柡鍋撻敐搴′簻闁诲骏濡囩槐鎺楀籍閸屾碍鐏堥悗瑙勬礈閸犳牠銆佸☉妯锋闁圭儤鎸搁鐑樼節閻㈤潧浠╅柟娲讳簽瀵板﹥绂掔€ｎ亞鐤呴梺璺ㄥ枔婵挳鎮块鈧弻锝夊箛椤掑娈剁紓浣哄█缁犳牠骞冭ぐ鎺戠倞闁搞儜鍕闂佸搫妫庨崐婵嬪箖濡ゅ啯鍠嗛柛鏇ㄥ墰椤︺劎绱撴笟鍥ф灈闁活厼鍊块弫鎰版倷濞村鏂€闁诲函绲介悘姘跺疾閻愮儤鈷戦柛蹇涙？閼割亪鏌涙惔銈嗙彧缂佸倸绉瑰浠嬵敇閻斿弶瀚藉┑鐐舵彧缁插潡鈥﹂崼銉嬪绠涘☉娆戝幈闁诲函缍嗘禍婵嬪闯瑜版帗鍋傞柕鍫濇閸欏繑淇婇悙棰濆殭濞存粓绠栭幃妤冩喆閸曨剛顦ㄩ梺鍛婃⒐閻熴儵鎮鹃悿顖樹汗闁圭儤绻冮弲婵嬫⒑闂堟稓澧曟繛鏉戝€垮畷顖涙償閵婏腹鎷绘繛杈剧悼閸庛倝宕甸埀顒€顪冮妶鍡樺闁告瑥鍟悾鐑藉箣閿旇棄浜滈梺缁樻尭濞寸兘鎮块崶顒佲拺鐟滅増甯掓禍浼存煕濡搫鈷旂紒顔剧帛閵堬綁宕橀埡鍐ㄥ箞婵＄偑鍊栭崝鎴﹀磹閺囩偐鏋嶉柟鎵閻撶娀鏌℃径瀣嚋闁稿鍎甸弻锛勪沪缁洖浜剧€规洖娲﹀▓鏇㈡煟鎼搭垳绉甸柛鎾寸閳潧鈹戦敍鍕杭闁稿﹥鍨垮畷鐟懊洪鍛珖闂侀潧绻堥崐鏇犵不閺嶎厽鐓忛煫鍥ь儏閳ь剚娲滅划濠氬箮閼恒儳鍘甸梺璇″瀻閸滃啰绀婂┑鐐差嚟婵潧顭囧▎鎾偓鏃堝礃椤斿槈褔骞栫划鍏夊亾瀹曞浂鍟囧┑鐘垫暩閸嬬娀顢氬鍕箚闁搞儺鍓欑粻鏌ユ煏韫囨洖袥闁衡偓娴犲鐓曢柍閿亾闁哄懏绮撳畷鎾绘濞戣鲸瀵岄梺闈涚墕濡瑧浜搁悽鍛婄厱閻庯綆鍋勬慨宥団偓瑙勬礃閸ㄥ潡鐛Ο鑲╃＜婵☆垳鍘у鎶芥⒑鐠囨彃鍤辩紒鎻掝煼瀹曟繄鈧綆鍓濇慨鍐测攽閻樺磭顣叉い銉ワ攻閵囧嫰骞囬埡浣轰痪闂佺懓鍚嬮崝鏍崲濞戞埃鍋撻悽娈跨劸闁告ɑ鎸抽幐濠傗攽鐎ｎ偆鍙嗛梺鍝勬处椤ㄥ懏绂嶆ィ鍐┾拻?
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

    const mojibakeYenAmounts = [...value.matchAll(/(\d{1,3}(?:,\d{3})+|\b\d{1,7})\s*闂傚倷绀侀幉锟犲焵?/g)];
    if (mojibakeYenAmounts.length) return mojibakeYenAmounts[mojibakeYenAmounts.length - 1][1];
    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻閻愮儤鍋嬮柣妯荤湽閳ь兛绶氬鎾閳╁啯鐝曢梻浣藉Г閿氭い锔诲枤缁辨棃寮撮姀鈾€鎷绘繛杈剧到閹诧繝宕悙鐑樼厱闁哄啯鎸鹃悾鐢碘偓瑙勬磻閸楀啿顕ｆ禒瀣垫晝闁靛繆鏅滈ˉ鈥斥攽閻樺灚鏆╁┑顔炬暩閸犲﹤顓兼径瀣簵濠电偛妫欓幐濠氭偂閺囥垺鐓欓柣鎰靛墻濞堟棃鏌熼崘鍙夋崳缂侇噮鍙冮弫鎾绘偐閺傘儲瀚肩紓鍌氬€烽悞锕佹懌闁诲繐绻掓晶妤冩崲濞戙垹鐭楀鑸电閳ь剚瀵ч〃銉╂倷閼碱剙鈪垫繝纰樺墲閹倹淇婇悜绛嬫晩闁芥ê顦辩槐锕傛⒒閸屾瑨鍏岀痪顓炵埣瀹曟粌鈹戠€ｃ劉鍋撻崘顔煎窛闁哄鍨归崢閬嶆煟鎼搭垳绉靛ù婊嗘硾閵嗘帗绻濆顓犲帾闂佸壊鍋呯换鍐闯鐟欏嫨浜滈柟鍝勵儏閻忣亪鏌曢崶褍顏┑鈩冩倐婵＄兘顢涘┑鍡樺創闂佽瀛╅鏍窗濞戙埄鏁嬬憸鏃堝春閵夛箑绶炲┑鐐灮閸犲酣鈥﹂妸鈺佸窛妞ゆ挾鍠撻埀顒€顭峰铏光偓鍦閸ゆ瑩姊虹敮顔剧М妤犵偛鍟埢搴ㄥ箼閸愨晜娅岄梻浣侯焾閺堫剛鑺辨禒瀣ㄩ柍鍝勫€甸幏濠氭⒑缁嬫寧婀伴柣鐕傚缁﹪鎮ч崼娑楃盎闂佸搫娲ㄩ崰鎾存櫠閻㈢鍋撶憴鍕缂傚秴锕ら悾鐑芥晸閻樺啿鈧鈧箍鍎卞Λ娑樏虹€电硶鍋撶憴鍕闁挎洏鍨介崹楣冩晝閸屾氨顓哄┑鐘绘涧濞村倿宕ュ▎鎾粹拻闁稿本鐟чˇ锔界節閳ь剟鏌嗗鍡樺劒闁瑰吋鐣崝宀勬⒒椤栨稏浜滈柡鍥殔娴滈箖鎮楀▓鍨珮闁稿锕ら悾鐑藉箳濡や礁鈧兘鎮楅悽娈跨劸妤犵偛鐗撳缁樻媴鐟欏嫮浼囬梺鍝勬噺閻╊垰鐣烽娑橆嚤闁哄鍨归悿鍥⒑閸涘﹣绶遍柛顭戜邯瀹曟垿骞橀懜闈涙瀭闂佸憡娲﹂崜娑⑺囬妷鈺傗拺缂備焦顭囨晶閬嶆煕濡姴娴勭紞鏍叓閸ャ劍濯兼繛宸憾閺佸倿鏌涘☉鍗炲箺妞ゆ挸銈稿缁樼瑹閳ь剙顭囪閹囧幢濞戞鐤囬棅顐㈡处缁嬫帡宕愰悽鍛婄厵妞ゆ牕妫岄崑鎾绘煛閳ь剚绂掔€ｎ偆鍘介梺褰掑亰閸樿偐寰婇懡銈囩＜闁绘瑦鐟ュú锕傛偂閺囥垺鐓忓┑鐐茬仢閸旀粓鏌涚€ｃ劌鍔滄い銊ｅ劦閹瑩骞撻幒鎾搭啋闂備浇顕栭崰妤呮偡閳哄懎绠栨繝濠傚悩閻旇櫣纾兼俊顖滃帶缁插潡姊婚崒姘偓鐑芥嚄閸洍鈧箓宕奸妷銉ョ彉濡炪倖甯掗崐濠氭儗濞嗘挻鐓欓弶鍫濆⒔閻ｈ京绱掗埀顒勫醇閵夛妇鍙勯棅顐㈡祫缁茶姤绂嶉悙鐢电＜闁绘宕甸悾娲煛鐏炵澧茬€垫澘瀚埀顒婄秵娴滅偞绂掗幘顔解拺閻犲洠鈧櫕鐏嶉梺鎼炲妼婢у酣骞戦姀鐘闁靛繒濮烽ˇ褔姊洪崗鑲┿偞闁哄懏绮撳畷鎶筋敊鐏忔牗鏂€闂佺粯鍔栧娆撴倶閳哄懏鐓涘ù锝呭閻撹偐鈧娲樺浠嬪春閳ь剚銇勯幒宥夋濞存粍绮撻弻鐔兼倻濡櫣浠村銈呮禋娴滎亪寮诲澶嬬叆閻庯綆浜炴导宀勬⒑閸濆嫭婀扮紒瀣灴閸┿儲寰勬繝搴㈠缓闂佸壊鍋呯换鈧紒鎲嬬到閳规垿鎮╅鑲╀紕闂佺娅曢幑鍥х暦椤栫偛绠绘い鏃囧閹芥洖鈹戦悙鏉戠仸閼裤倖淇婇幓鎺斿ⅵ闁哄本绋戣灃闁告劑鍔嬮幋鐑芥⒑闁偛鑻晶顖涗繆閻愭壆鐭欑€殿喖顭峰鎾晬閸曨厽婢戦梺璇插嚱缂嶅棙绂嶉弽顓炵；闁规崘顕ч崘鈧銈嗘尵閸嬬喖宕㈤柆宥嗏拺缁绢厼鎳忚ぐ褔姊婚崟顐㈩伃闁诡噯绻濆鎾偄閾忓湱妲囬梻鍌氬€搁悧濠勭矙閹烘澶婎煥閸曗晙绨婚棅顐㈡祫缁茶姤绂嶆导瀛樼厵闁惧浚鍋嗘晶鐢碘偓娈垮枙缁瑩銆佸鈧幃銏ゅ矗婢跺浼栭梻鍌氬€风粈渚€骞夐敍鍕煓闁硅揪鑵归埀顒婄畵椤㈡宕熼鈧埀顒€鐏濋埞鎴﹀磼濮橆厼鏆堥梺缁樻尰濞叉鎹㈠☉銏犵婵犻潧妫滈崺鐐测攽閻愬弶鍣洪拑杈╃磼缂佹娲撮柟铏墵閸┾剝鎷呴崷顓濋偗濠电姵顔栭崰鏍晝閵娿儮鏋嶉柨婵嗩槸缁犳煡鏌涢弴銊ョ仩閹喖姊洪棃娑辨濠碘€虫处缁傚秹寮借閺€浠嬫煟濡澧柛鐔风箻閺屾盯鎮╅崘鎻掓懙閻庢鍣崑鍡涘箯閻樺樊鍟呮い鏂垮悑椤撳潡姊绘担鍛婃儓閻炴凹鍋婂畷鏇灻洪鍕€梺绯曞墲缁嬫帡鎮￠弴銏＄厸闁搞儯鍎辨俊鐓庮熆瑜岄崡鎶藉蓟濞戞鐔煎传閸曨喖鐓樻俊鐐€ゆ禍婊堝疮鐎涙ü绻嗛柛顐ｆ礀楠炪垺淇婇妶鍌氫壕閻炴稖鍋愮槐鎾诲磼濞嗘劗銈伴柣蹇撴禋娴滄粓鍩㈤弮鍫濆嵆闁绘ɑ褰冮悘濠囨煟閻樺弶鎼愭俊顖氾工椤洭濡搁埡鍌滃帗閻熸粍绮撳畷婊堟偄婵傚娈?,闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕婵犲倹鍋ラ柡灞诲姂瀵噣宕奸悢鍛婎唶闂備胶顭堥鍡涘箰閸撗冨灊妞ゆ挾鍋愬Σ鍫熶繆椤栨繍鍤欐繛鍛囧洦鈷戞繛鑼额嚙楠炴鏌ｉ悢鍙夋珚鐎殿喖顭烽幃銏焊娴ｅ湱鈧姊婚崟顐ｅ枠妞ゃ垺淇洪ˇ鏌ユ偂閵堝鐓ラ柡鍐ㄧ墛閺嗘粓鏌涚€ｎ偅宕屾俊顐㈠暙閳藉寮借閸掓帡鏌ｆ惔銏╁晱闁哥姵鐗犻幃銉︾附閸濄儱绁﹂柣搴秵娴滄牠寮ㄦ禒瀣厱妞ゆ劧缍€婢规ê霉濠婂懎浜鹃柕鍥у楠炴﹢宕￠悙鍏哥棯闂備焦濞婇弨閬嶅垂閸噮娼栧┑鐘宠壘闁卞洭鏌ｉ弬鍨Щ缂佲偓鐎ｎ喗鈷戦柛鎾村絻娴滄牠鏌涙惔銊ゆ喚闁诡喖娼￠幃娆擃敆閸屾粠鍟庨梻浣烘嚀椤曨參宕戦悢绗衡偓鍌炲蓟閵夛妇鍘遍棅顐㈡处濮婂鎯岄幒妤佺厸閻忕偟鏅暩濡炪伇鍌滅獢闁哄本鐩獮妯兼崉閻戞鈧顪冮妶搴′簻缂佺粯鍔楅崣鍛渻閵堝懐绠伴悗姘间簽濡叉劙宕奸弴鐔叉嫼闂佸憡绋戦敃銉﹀緞閸曨垱鐓曢柟鎯ь嚟閹冲懐绱掗鍡欏埌闁宠棄顦埢搴ㄥ箣閻樺灚顫屽┑鐘垫暩閸嬫盯鎮ч崱娑欏€舵繝闈涱儏閸戠娀鏌ｉ弬鍨倯闁绘挻鐟х槐鎺斺偓锝庝簽娴犮垽鏌￠崱娑楁喚闁哄矉缍侀弫鎰板炊瑜嶉獮瀣⒑鐠団€虫灆缂侇喗鐟ラ悾鐑藉Ω閿斿墽鐦堥梺鍛婃处閸嬪嫮鐟ч梻鍌欐祰椤曆勵殽閸濄儳涓嶇€广儱顦壕鍧楁煕濡ゅ啫鈧絽鈽夊Ο閿嬵潔闂侀潧绻掓慨鎾磻瀹ュ鈷戦柛娑橈功閳藉鏌ㄩ弴顏勵洭缂侇喚绮妶锝夊礃閵娧囩崜闂備礁澹婇崑鍛崲閸岀偛鐓曢柡鍐ㄥ€荤壕鐓庮熆閼稿緱顏呮櫠椤栫偞鐓忛柛銉戝喚浼冨銈冨灪濞茬喐鎱ㄩ埀顒勬煃閸濆嫬鈧劙濡搁妷銏℃杸闂佺粯鍔曞鍫曀夐幘缁樼厱闁靛鍔嶉ˉ澶嬨亜閺囶亞绋荤紒缁樼箓椤繈顢栭埞鍨闁哄被鍔戝顕€鍩€椤掑嫬纾块柟鍓佹櫕瀹?+ 闂?
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
    if (/\u9001\u6599[^\n\r]{0,40}\u7740\u6255\u3044/.test(value)) return '\u7740\u6255\u3044';
    if (/\u9001\u6599[^\n\r]{0,40}\u7121\u6599/.test(value)) return '\u7121\u6599';
    if (/\u9001\u6599[^\n\r]{0,40}\u843d\u672d\u8005\u8ca0\u62c5/.test(value)) return '\u843d\u672d\u8005\u8ca0\u62c5';
    const match = value.match(/\u9001\u6599[^\d]{0,20}([\d,]+)\s*(?:\u5186|JPY)/i);
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
      .find(a => /contact\.auctions\.yahoo\.co\.jp/i.test(String(a.href || a.getAttribute?.('href') || '')) || /\u53d6\u5f15\u9023\u7d61/.test(normalizeVisibleText(a.textContent)));
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
    if (!/\u6b21|\u6b21\u3078|next/i.test(text)) return false;
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
  
  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻閻愮儤鍋嬮柣妯荤湽閳ь兛绶氬鎾閳╁啯鐝栭梻渚€鈧偛鑻晶鏉款熆鐟欏嫭绀嬮柟顔惧厴楠炲﹥绻濋崒婊呅ㄩ梺璇″枓閺呮盯顢欒箛娑辨晩闁绘挸楠歌灇缂傚倸鍊搁崐鎼佸磹閸濄儳鐭撻柣銏犳啞閸嬪鏌￠崶锝嗗櫚闁逞屽墾婵″洭骞戦崟顖毼╅柨鏇楀亾缁剧虎鍨跺铏圭磼濡櫣浠搁柦鍐憾閺岀喖鎮滈幋鎺撳枤濠?: 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧湱鈧懓瀚崳纾嬨亹閹烘垹鍊炲銈嗗笒椤︿即寮查鍫熷仭婵犲﹤鍟扮粻缁橆殽閻愭潙鐏村┑顔瑰亾闂侀潧鐗嗛幊鎰版偪閳ь剚淇婇悙顏勨偓鏍涙担鑲濇盯宕熼浣稿妳婵犵數濮村ú锕傚煕閹达附鐓熼柣鏃傚帶娴滀即鏌涢妶鍥ф瀻闁宠鍨块、姘跺焵椤掆偓椤洩顦归柟顕€绠栭幃婊堟寠婢跺孩鎲伴梻渚€娼ч¨鈧┑鈥虫喘瀹曘垽鏌嗗鍡忔嫼闂佸搫鍊堕崕鎻掆枍閸涘瓨鐓曢柣鏃囨硾瀹撳棝鏌涢埡渚婅含鐎殿喗鎸虫慨鈧柨娑樺楠炲牓姊虹涵鍛汗閻炴稏鍎卞嵄闁告洦鍨扮紒鈺佲攽閻樺磭顣查柣鎾崇箻閺屾盯濡烽幋婵嗘灓濞寸厧鍟撮幃妤€鈻撻崹顔界亞缂備緡鍠楅悷鈺呭Υ娓氣偓瀵挳锝為鍓р棨婵＄偑鍊栭幐楣冨窗鎼淬垹鍨斿ù鐓庣摠閳锋帡鏌涚仦鍓ф噯闁稿繐鐬肩槐鎺楊敋閸涱厾浠梺杞扮贰閸ｏ綁骞冨▎鎾搭棃婵炴垶顭囨禍鐗堜繆閻愵亜鈧牠鎮у鍫濈；婵炴垶姘ㄦ稉宥夋煟閹邦喖鍔嬮柣鎾崇箰閳规垿鎮欓懠顑胯檸闂佸憡鎸搁…鐑藉蓟閿濆妫橀柛顭戝枟閸婎垶姊虹拠鈥崇仯闁稿鍊濆濠氭晲閸偅些闂備胶顢婃慨銈囧垝鎼达絽鍨濋柛顐ゅ枔缁♀偓闂佸憡娲﹂崢楣冩晬濠靛鈷戠紒瀣濠€浼存煟閻旀潙濮傜€规洘顨堟禒锔炬喆閿濆棙鏉告俊鐐€栧濠氬磻閹捐姹叉い鎺戝閻撴瑦銇勯弬璇插婵炶绠撳畷鎴﹀箛閻楀牆浠梺鎼炲労娴滄粓鎷曟總鍛婄厵闁兼亽鍎茬粈瀣叏婵犲啯銇濇鐐村姈閹棃鏁愰崶鈺傛濠碉紕鍋戦崐褏鈧潧鐭傚畷鐟扮暦閸パ冪亰婵犵數濮甸懝鍓х不椤曗偓閺屻倝骞侀幒鎴濆Б闂佸憡眉缁瑥顫忔ウ瑁や汗闁圭儤鍨抽崰濠囨⒑閸涘﹥灏扮€光偓閹间礁鏄ラ柕蹇嬪€曢崡鎶芥煟閺冨洦顏犳い鏃€娲熼幃妤呮偡閺夋妫岄梺鍝ュУ閻楁洟顢氶敐澶樻晩闁兼亽鍎卞?+ Enter 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻鐔兼⒒鐎靛壊妲紒鐐劤缂嶅﹪寮婚敐澶婄闁挎繂鎲涢幘缁樼厱濠电姴鍊归崑銉╂煛鐏炶濮傜€殿喗鎸抽幃娆撶叓椤撶姵鏅奸梻鍌欐祰濡椼劎绮堟担琛″亾濮樼厧骞橀柟骞垮灩閳藉濮€閻樿尪鈧灝鈹戦埥鍡楃仴妞ゆ泦鍛瀳鐎广儱娲ㄧ壕钘壝归敐鍥ㄥ殌濠殿喖鐗婇妵鍕Ω閵夛富妫ら梺鐟扮畭閸ㄥ綊鍩ユ径鎰潊闁绘ɑ顔栭崥鍛存⒒娴ｈ櫣甯涢柛鏃€顨婂顐﹀箹娴ｇ懓浜楅梺缁橆焽缁垶鍩涢幋锔界厱婵犻潧妫楅瀛樹繆閼奸娼愬ǎ鍥э躬閹瑩鎳滃▓鎸庮棄婵＄偑鍊ら崑鍕崲閹烘梹顫曢柟鐑樺殾閻旂儤瀚氱€瑰壊鍠掗崑鎾诲箻缂佹ǚ鎷洪梺鍛婄☉閿曪箓鍩ユ径鎰叆闁哄洦锚閳ь剚绻傞锝夊箮閽樺鍞堕梺闈涱檧閼靛綊骞忓ú顏呪拺闁绘挸瀵掑鐔兼煕婵犲啯绀€闁宠绉归獮鍥敊閸撗嶇床闂備胶绮…鍫濃枍閺囩姳鐒婃い鎾卞灪閻撶喖鏌ㄥ┑鍡樻悙闁告ɑ鎸抽弻鐔碱敊閻ｅ瞼鐓€闁句紮缍侀弻銈吤圭€ｎ偅鐝栧┑鈩冨絻濞差厼顫忕紒妯诲闁告稑锕ら弳鍫濃攽閻愰鍤嬬紒鐘虫尭閻ｅ嘲顭ㄩ崼鐔告珖闂侀€炲苯澧撮柍銉畵瀹曞爼顢楁担闀愮盎闂佽绻愮换瀣倿閿曞倸妫橀柍褜鍓熷缁樻媴閾忕懓绗￠梺鍛婃⒐濞叉牠顢氶敐澶婇唶闁哄洠鍋撳璺侯煬閻撱儵鏌涘☉鍗炵仯闁挎稒绮岄—鍐Χ閸℃锛曢梺绋款儐閹稿墽妲愰幒妤佸亹鐎规洖娲ら埛灞轿旈悩闈涗粶闁哥喎鐡ㄩ幈銊╁焵椤掑嫭鐓忛柛顐ｇ箖椤ユ粌霉濠婂嫷娈滈柡宀€鍠栭幊婵嬫偋閸繃閿紓鍌欐祰鐏忣亝鎱ㄩ妶澶婄疄闁靛ň鏅涢柋鍥煛閸モ晛鏆遍柟椋庣帛缁绘稒娼忛崜褍鍩岄梺纭咁嚋缁绘繂鐣烽鐐村€烽柣鎴烆焽閸橀亶姊洪崫鍕殜闁稿鎹囬弻娑㈠Ω閵壯傝檸闂佷紮绲介崲鏌ュ煘閹达箑鐐婇柕濞垮劚婵℃娊姊绘笟鈧褔鎮ч崱娑樼柈闁宠桨绲胯铻栭柛娑卞枓閹锋椽姊洪崨濠勭畵閻庢凹鍨堕敐鐐烘晝閸屾稓鍘遍柟鍏肩暘閸ㄥ宕ｉ埀顒勬⒑缁洘娅嗛柣鈺婂灦閻涱噣骞掑Δ鈧粻鐘绘煏婵炲灝鍔ょ紒澶嬫そ閺屸剝鎷呴悷鏉款潚閻庤娲栭妶鎼併€侀弴銏狀潊闁挎稑瀚▓鍫曟⒒閸屾艾鈧兘鎳楅崼鏇椻偓锕傚醇閵忥絽小濠电偛妯婃禍婊呭閸ф鐓熼柕蹇嬪焺閻掗箖鏌﹂崘顏勬瀾缂佺粯鐩獮瀣枎韫囨洑鐥梻浣侯焾椤戝棝宕濆▎鎾崇畺婵°倕鎳庨幑鑸点亜閹捐泛鈧偊濮€鎺虫禍婊堟煏婢舵稑顩紒鐘靛仱閺屸€崇暆鐎ｎ剛袦濡ょ姷鍋為敃銏犵暦閿熺姵鍊烽柍杞版婢规洖鈹戦悩缁樻锭妞ゆ垵妫濆畷鎴﹀磼濞戞牔绨婚梺瑙勬緲婢у酣鎮鹃柆宥嗙厽闁归偊鍓ㄩ煬顒勬煛鐏炵偓绀冪紒缁樼椤︻噣鏌涚€ｎ偅灏板ǎ鍥э躬楠炴捇骞掗弬搴撳彙缂傚倷娴囨ご鎼佸箰婵犳艾绠柛娑欐綑娴肩娀鏌涢弴鐔风劸闁告挾鍠栧璇测槈濮橈絽浜鹃柨婵嗛娴滄粌鈹戦鑲┬ч柡灞剧洴閸╃偤骞嗚婢规洖鈹戦敍鍕杭闁稿﹥鐗曢蹇旂節濮橆剛锛涢梺瑙勫劤婢у海澹曟總鍛婄厽婵☆垰鐏濋惃娲极閸儲鍊甸悷娆忓缁€鍐╃箾閸欏顏堚€﹂崶顏嗙杸婵炴垶顭囬崢鎾⒑鐠団€崇€婚柛灞惧嚬濡粌鈹戦悩鎰佸晱闁哥姵顨婇垾锕傚炊椤掆偓閸屻劎鎲搁弬娆惧殨闁归棿绀佸洿闂佹悶鍎弲婵嬫晬濠婂喚娓婚柕鍫濇閳锋帡鏌￠崪浣镐喊妤犵偛锕畷鐔碱敇閻樼绱茬紓鍌氬€烽悞锕傗€﹂崶鈺冧笉闁绘劗顣介崑鎾舵喆閸曨剛顦ラ梺缁樼墪閸氬绌辨繝鍌ゆ桨鐎光偓婵犲唭鈺呮煟?
  try {
    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁炬儳缍婇弻锝夊箣閿濆憛鎾绘煕閵堝懎顏柡灞剧洴椤㈡洟鏁愰崱娆欑穿闂備線鈧偛鑻晶鍓х磼閻樿櫕灏柣锝夋敱缁虹晫绮欏▎鐐秱闂備胶鍋ㄩ崕閬嶅疮鐠恒劏濮抽柕澶嗘櫆閳锋帒霉閿濆洨鎽傛繛鍏煎姇椤潡鎮烽悧鍫！闂佸搫鎳撳▔娑滅亙闂佸憡渚楅崢楣冩晬濞戙垺鐓熼幖鎼灣缁夌敻鏌涢悩鎰佹疁闁诡喒鈧枼鏋庣€电増绻傜紞濠傜暦濡ゅ懎绀傞柤娴嬫櫇閳诲繐鈹戦悙鑼憼缂侇喖鐗撳畷锟犲箮閽樺鎽曢梺鏂ユ櫅閸燁垱鍒婇幘顔解拻闁割偅纰嶅▍鍫ユ煕濮樼厧浜版慨濠冩そ瀹曨偊宕熼纰变純缂傚倷绀侀ˇ閬嶅礂濡偐妲靛┑鐐存尰閸╁啴宕戦幘缁樼厸閻忕偛澧藉ú瀛橆殽閻愭惌鐒介柟鐟板閹粌螣闂傛挳鍋楅梻浣筋嚙鐎涒晠顢欓弽顓炵獥婵炴垯鍩勯弫瀣喐閺冨牆鏄ラ柕澶涚畱缁剁偛鈹戦悩鍙夋崳闁告瑥妫濆娲川婵犱胶绻侀梺鎼炲妼瀹曨剟鈥﹂崸妤€绠ｉ柨鏃囆掗幏缁樼箾鏉堝墽鎮奸柣鈩冩煥椤洭骞囬鐟颁壕閻熸瑥瀚粈鍐煥濮樿埖鐓冮悹鍥皺鏁堥悗娈垮枟閹告娊骞冨▎鎾崇厸闁稿本绮堢花鎾⒒閸屾瑧顦﹂柟璇х節楠炴劙鎮滈懞銉ユ畱闂佸憡鎸风粈渚€藟濮樿埖鐓㈡俊顖欒濡妇鎲搁悧鍫濈瑲闁哄懏鐓￠弻娑㈠焺閸愮偓鐣肩紓浣风窔閺€杈╂崲濞戞埃鍋撳☉娆樼劷闁活厽甯炵槐鎺楁偐瀹曞洤鈷屽Δ鐘靛仜閸燁偉鐏冮梺鍛婁緱閸橀箖藝瑜庣换婵嬪閿濆棛銆愰梺鎸庢穿缁插墽绮╅悢鐓庡嵆闁靛繆妾ч幏缁樼箾鏉堝墽鍒伴柟璇х節瀹曨垶鎮欑€靛摜顔曢柣鐘叉厂閸涱垱娈奸柣搴ゎ潐濞叉鍒掑畝鍕厺閹兼番鍊楅悿鈧繝鐢靛Т閸熺増绂嶉弽顓熺厽闁绘柨鎽滈惌瀣繆椤愩垹鏆ｉ柣娑卞櫍瀹曟﹢濡告惔銏☆棃鐎规洏鍔戦、娆撴⒒鐎靛憡鏆伴梻鍌氬€风粈渚€骞栭位鍥ㄥ閹碱厽鏅炲┑鐐叉閸旀銆呴悜鑺ョ厽闁逛即娼ф晶鎵磼閳锯偓閸嬫捇姊绘笟鈧褏鎹㈤崼銉ュ瀭婵炲樊浜滈崥褰掓煃瑜滈崜娆撳煘閹达箑鐓￠柛鈩冦仦缁ㄥジ姊洪悜鈺傛珦闁搞劌鐖奸幃浼搭敋閳ь剟鐛€ｎ喗鏅濋柍褜鍓熼敐鐐哄川鐎涙鍙嗗┑鐐村灦閿氭い蹇ｅ亰閺岀喖鎼归銈囩杽濠殿喖锕ュ浠嬪蓟閸涘瓨鍊烽柤鑹版硾椤忣厽绻濋埛鈧崘鎯ф闂侀€炲苯澧い鏃€鐗犲畷浼村冀椤撴稈鍋撻敃鍌涘€婚柦妯侯槹閻庮剟姊鸿ぐ鎺戜喊闁告鍋愬▎銏ゆ倷濞村鏂€闂佺粯蓱瑜板啴顢旈幘顔界厱闁绘劕鐡ㄩ妵婵囨叏婵犲嫮甯涢柟宄版嚇閹煎綊鎮烽幍顕呭仹闂傚倷绀侀幉鈥愁潖閻熸噴娲冀椤掑倷鑸繝鐢靛Х閺佸憡鎱ㄧ€涙ê顕遍柛娑卞姸濞差亶鏁傜€广儱妫欏▍宥夋⒒娓氣偓濞佳呮崲閸℃鐎剁憸鏃堢嵁?
    target.focus();
    
    // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧湱鈧懓瀚崳纾嬨亹閹烘垹鍊為悷婊冪箻瀵娊鏁冮崒娑氬幗闂侀潧绻堥崺鍕倿閸撗呯＜闁归偊鍙庡▓婊堟煛瀹€鈧崰鏍嵁瀹ュ鏁婄痪鎷岄哺濮ｅ姊绘担渚劸妞ゆ垶鍨归幑銏犫攽閸♀晛娈ㄩ梺鍓插亝濞叉牠鏌嬮崶銊﹀弿婵妫楅獮妤呮煟濠靛洨澧紒缁樼洴楠炲鎮欓弶鎴狀暡缂傚倷绀侀ˇ顖滅礊婵犲偆鍤曞┑鐘崇閸嬪嫰鏌涘☉姗堝姛缂佸鐖煎娲川婵犲啫鐦烽梺鍛婁緱閸嬪嫭绂掗鐔虹瘈?focusin 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋锝嗩棄闁哄绶氶弻鐔兼⒒鐎靛壊妲紒鎯у⒔缁垳鎹㈠☉銏犵婵炲棗绻掓禒楣冩⒑缁嬫鍎嶉柛濠冪箞瀵寮撮悢铏诡啎閻熸粌绉瑰畷顖烆敃閿旇棄鈧泛鈹戦悩鍙夊闁稿﹦鏁婚弻娑滅疀閹垮啯笑婵炲瓨绮撶粻鏍ь潖濞差亜宸濆┑鐘插暟椤︺儵姊虹拠鑼鐎光偓缁嬫鍤曢柡灞诲劜閸婄兘鏌ｉ幋鐐冩岸骞忓ú顏呪拺闁告稑锕﹂埥澶愭煥閺囨ê鍔滅€垫澘瀚板畷鐔碱敍濞戞艾骞堥梺璇插嚱閹儵宕樿椤ユ岸姊?
    target.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: true }));
    
    // 濠电姷鏁告慨鐑藉极閸涘﹥鍙忛柣鎴ｆ閺嬩線鏌涘☉姗堟敾闁告瑥绻橀弻锝夊箣濠垫劖缍楅梺閫炲苯澧柛濠傛健楠炴劖绻濋崘顏嗗骄闂佸啿鎼鍥╃矓椤旈敮鍋撶憴鍕８闁告梹鍨甸锝夊醇閺囩偟顓哄┑鐘绘涧閻楀啴宕戦幘娲绘晣闁绘垵妫欑€靛矂姊洪棃娑氬闁硅櫕鍔楃划缁樺鐎涙鍘藉┑掳鍊愰崑鎾翠繆椤愶絿銆掗柛鎺撳浮瀹曞ジ濡烽妷鈺佹暪闂備胶绮Λ浣糕枍閿濆鍎婇柛顐犲劜閳锋帡鏌涚仦鐐殤濠⒀勭〒缁辨帞鈧綆鍋呯亸浼存煛閸涱厾鍩ｆ鐐叉喘閹囧醇閵忕姴绠為梻浣筋嚙閸戠晫绱為崱娑樼；闁告侗鍨悞濠冦亜閹捐泛鏋傚ù婊勭矋閵囧嫰骞囬崜浣瑰仹缂備胶濮烽崑鐐哄Φ閸曨垰顫呴柍钘夋嚀閳ь剙娼￠弻鐔碱敊鐟欏嫭鐝氶悗瑙勬礃閿曘垹鐣烽敐鍡楃窞閻忕偘绮欓崣鈩冪節閻㈤潧孝闁汇儱顦靛鑸垫償閹惧厖澹曞┑掳鍊撻悞锕傚矗韫囨稒鐓熼柟杈剧稻椤ュ鐥幆褜鐓奸柡宀嬬秮楠炲洭顢楁担鐟板壍缂傚倷璁查崑鎾愁熆閼搁潧濮堥柣鎾寸〒閳ь剝顫夐幖鈺呭窗閺嶎厽鍤愭い鏍ㄥ焹閺嬫梹銇勯幇鍫曟闁抽攱鍨块弻娑樷槈濮楀牊鏁炬繝銏ｆ硾鐎氫即寮诲☉銏犵閻庨潧鎲￠崳顔尖攽閻愬弶顥撻柛銊ょ矙楠炲啫鈻庨幋婵囩€冲┑鈽嗗灥濡椼劍绔熼弴銏♀拺缂佸娉曠粻鐗堛亜閿旇鐏＄紒鍌氱У閵堬綁宕橀埞鐐闂傚倷绶￠崑鍡涘磻濞戙垺鍤愭い鏍ㄧ⊕濞呯娀鎮楀☉娆欎緵婵?Enter 闂?
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
  
  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻閻愮儤鍋嬮柣妯荤湽閳ь兛绶氬鎾閳╁啯鐝栭梻渚€鈧偛鑻晶鏉款熆鐟欏嫭绀嬮柟顔惧厴楠炲﹥绻濋崒婊呅ㄩ梺璇″枓閺呮盯顢欒箛娑辨晩闁绘挸楠歌灇缂傚倸鍊搁崐鎼佸磹閸濄儳鐭撻柣銏犳啞閸嬪鏌￠崶锝嗗櫚闁逞屽墾婵″洭骞戦崟顖毼╅柨鏇楀亾缁剧虎鍨跺铏圭磼濡櫣浠搁柦鍐憾閺岀喖鎮滈幋鎺撳枤濠?: 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ幋锝嗩棄闁哄绶氶弻娑樷槈濮楀牊鏁鹃梺鍛婄懃缁绘﹢寮婚敐澶婄婵犲灚鍔栫紞妤呮⒑闁偛鑻晶顕€鏌涙繝鍌涜础缂侇喖顑夐獮鎺楀棘閸濆嫪澹曢梺鎸庣箓缁ㄨ偐鑺辨禒瀣厱闁哄啯鎸鹃悾杈ㄣ亜椤忓嫬鏆ｅ┑鈥崇埣瀹曞崬螖閳ь剙顭囬幋锔解拺缂佸顑欓崕鎰版煙閻熺増鍠樼€殿喛顕ч埥澶愬閳ュ厖绨婚梻鍌欑閻忔繈顢栭崨顔绢浄闁圭虎鍠楅埛鎴犵磼椤栨稒绀冮柡澶婄秺閺屾稓鈧綆鍋呯亸顓熴亜椤忓嫬鏆ｅ┑鈥崇埣瀹曞崬螖閳ь剙顭囬幋锔解拺缂佸顑欓崕鎰版煙缁嬪灝鈷旀俊鍙夊姍楠炴﹢骞囨担鍛婂€梻浣告啞缁矂宕幎钘夎Е妞ゆ劏鎳￠弮鍫熷亹闂傚牊绋愮划鍫曟⒑閸濄儱娅忛柛瀣樀閹﹢骞掑Δ浣哄幗闂佺粯锚瀵墎绮氶崸妤佸€堕煫鍥ㄦ⒒閹冲懐绱掗鍡欑М闁诡喗鐟╅幃婊兾熼柨瀣伖闂佽崵鍠愮划搴㈡櫠濡ゅ啯鏆滈柟鐑樻尵椤╂彃霉閻撳海鎽犻柣鎾存礋閺岀喖骞嗚閸ょ喖鏌熼崘鎻掓殲闁?submit 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闂囧鏌ㄥ┑鍡╂Ч濞存嚎鍊濋弻銈夊级閹稿骸浠村┑顔硷攻濡炰粙銆佸Δ鍛劦妞ゆ帒鍊婚惌鎾淬亜閺囨浜鹃梺绯曟杹閸嬫挸顪冮妶鍡楃瑨闁挎洩绠撻幃楣冩偨绾版ê浜鹃悷娆忓缁€鈧梺闈涚墕閹测剝绌辨繝鍐炬Ч閹煎瓨锚娴滈箖鏌ㄥ┑鍡欏嚬缂併劌銈搁弻娑㈡偐缁涚鈧潡鏌″畝鈧崰鏍€佸▎鎾村€锋い鎺嶈兌瑜把呯磽閸屾瑧璐伴柛鐘愁殜閹柉顦规鐐村灴瀹曠喖顢涘璇蹭壕闁挎洖鍊哥粻锝嗙節闂堟稒澶勬慨锝呮濮婂宕掑顑藉亾閹间礁纾圭€瑰嫭鍣磋ぐ鎺戠倞妞ゆ帒锕︾粙蹇旂節閵忥絽鐓愰柛鏃€娲滄竟鏇㈠锤濡や胶鍘遍棅顐㈡处閹告悂骞冮幋锔界厱婵炲棗绻掔粻濠氭煛鐏炵偓绀嬬€规洜鍘ч埞鎴﹀箛椤撳绠撳鍝勑ч崶褉鍋撳Δ鍛；闁规崘顕ф闂佸憡娲﹂崹鎵不閹惰姤鐓欓悗娑欘焽缁犮儱霉閻樿崵鐣烘慨濠呮缁瑩宕犻垾鍏呯矗闂備胶绮悧鏇㈠Χ缁嬫鍤曞┑鐘崇閺呮彃顭跨捄鐚村姛闁汇倐鍋撳┑锛勫亼閸婃牜鏁幒妤€纾瑰瀣閸ㄦ繈姊婚崼鐔衡枔闁衡偓娴犲鐓熼柟閭﹀墮缁狙囨煕閿濆洤鍔嬬紒缁樼洴瀹曪絾寰勫☉婧惧亾閹稿寒娈介柣鎰皺婢э箑鈹戦埄鍐╁€愰柛鈺嬬節瀹曟帒鈽夊▎鎴濈闂傚倸鍊搁…顒勫磻閸曨個娲晝閳ь剛鍙呭┑鐘诧工閻楀棗效閺屻儲鐓忛柛顐ｇ箥濡插綊鏌嶉柨瀣伌闁诡喖缍婂畷鍫曟晲閸屾矮澹曢梺鎯ф禋閸嬪棙绂嶉鍡欑＝闁稿本鑹鹃埀顒€鎽滅划鏃堝箻椤旇姤娅囬梺闈涚墕椤︿即宕戦埡鍛厽闁硅揪绲鹃ˉ澶愭⒑閸楃偞鍠橀柡宀嬬節瀹曞爼鍩℃担鎻掍壕闁挎繂顦悡娑㈡煕濞戝崬鏋ら柛娆忔濮婃椽宕崟顐ｆ闂佺锕ㄥΛ鍕€栨繝鍥у窛濠电姳鑳剁粻姘舵⒑閼规澘顥嶆繛澶嬬洴閹繝骞囬鍓э紲缂傚倷鐒﹂…鍥╃不閻愮儤鐓欐い鏃囧吹閻瑦淇婇銏犳殭闁宠棄顦灃濞达絿顭堥蹇涙⒒娴ｈ棄鍚归柛鐘冲姉閸掓帒顓奸崪浣哄數濠殿喗銇涢崑鎾垛偓瑙勬处閸ㄥ爼銆侀弴銏℃櫆闁稿繐顦禍楣冩煥閺囩偛鈧悂鎮欐繝鍐︿簻闁瑰搫绉堕崝宥嗙箾閸涱偄鐏叉慨濠呮缁辨帒顫滈崼锝傚亾閹稿海绠惧ù锝呭暱閹虫劙鎯岄崼銉︾叆闁哄洨鍋涢埀顒€缍婇崺娑㈠箣閿旂晫鍘遍梺鎸庢椤曆囩嵁閺嶎厽鐓曢柡鍌涱儥閸庢劙鏌曢崶褍顏┑鈩冩倐婵＄兘鏁冮埀顒€鈻嶉敐澶嬧拺閺夌偞澹嗙拹浼存煕閿濆繒鍒版い顐㈢箳缁辨帒螣鐠囧樊鈧捇姊洪懡銈呮灈闁稿锕畷鐢碘偓锝庝簴閺€浠嬫煟閹邦厽缍戠紒鑼跺吹缁辨帗寰勭仦鎯ф畬闂佷紮绲块崗姗€鐛€ｎ喗鏅濋柍褜鍓涚划缁樼節濮橆厾鍘遍梺瑙勫礃鐏忣亪宕楀畝鍕叆婵炴垶鐟ч惌鎺撴叏婵犲啯銇濋柟铏墵閸╃偤鎮欓鈧悵閬嶆⒒娴ｅ憡鍟為柟姝岊嚙閻ｆ繄绮欑捄銊︽闂佹眹鍨婚…鍫ユ倿閸偁浜滈柟鐑樺灥椤忣亪鏌嶉柨瀣诞闁哄本鐩俊鐑藉箣濠靛洦鎷遍柡浣哥墢缁辨捇宕掑▎鎺戝帯缂備緡鍣崹鎶藉箲閵忋倕骞㈡繛瀛樻緲濞差厼顕ｆ繝姘ㄩ柨鏃€鍎抽獮妤呮⒒婵犲骸浜滄繛璇х畱椤繘鎳￠妶鍥︾瑝闂佺粯鍔楅崕銈夋偂閺囥垺鐓冮悷娆忓閸斻倕霉濠婂懎浜惧ǎ鍥э躬閹瑩顢旈崟銊ヤ壕闁哄稁鍋呴弳婊冣攽閻樺弶澶勯柛銈呭閹綊宕崟鈺佷缓濠电偛妯婃禍婊呯棯瑜旈弻鐔衡偓娑櫳戦埛鎰版煛閸屾浜鹃梻鍌氬€烽悞锕傚几婵傜鐤炬繛鎴欏灩閻ゎ喗銇勯弽銊х焼闁绘帒锕弻銊╁籍閸喐娈伴梺绋款儐閹搁箖骞夐幘顔肩妞ゆ帒鍋嗗Σ浼存⒒娴ｇ懓顕滄繛鎻掔箻瀹曡绂掔€ｎ€儱霉閿濆洨銆婇柡瀣叄閺岀喖鎮欓浣虹▏濠电偛鐗婇崝娆忣潖濞差亜绀冮柛娆忣槹閸庢捇姊洪幐搴㈢８闁稿酣娼ч?
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
  
  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻閻愮儤鍋嬮柣妯荤湽閳ь兛绶氬鎾閳╁啯鐝栭梻渚€鈧偛鑻晶鏉款熆鐟欏嫭绀嬮柟顔惧厴楠炲﹥绻濋崒婊呅ㄩ梺璇″枓閺呮盯顢欒箛娑辨晩闁绘挸楠歌灇缂傚倸鍊搁崐鎼佸磹閸濄儳鐭撻柣銏犳啞閸嬪鏌￠崶锝嗗櫚闁逞屽墾婵″洭骞戦崟顖毼╅柨鏇楀亾缁剧虎鍨跺铏圭磼濡櫣浠搁柦鍐憾閺岀喖鎮滈幋鎺撳枤濠?: 婵犵數濮烽弫鍛婃叏閻戣棄鏋侀柛娑橈攻閸欏繘鏌ｉ姀鐘差棌闁轰礁锕弻鈥愁吋鎼粹€崇缂備焦鍔栭〃鍡樼┍婵犲洤围闁稿本鐭竟鏇㈡⒒娴ｉ涓茬紒鎻掓健瀹曟螣閾忚娈剧紓浣割儓椤曟娊寮崼婵堝姦濡炪倖宸婚崑鎾淬亜閺傝法绠伴柍瑙勫灴瀹曞爼濡烽妶鍥╂晨闂傚倷绀佸﹢閬嶅磻閹捐绀堟慨姗嗗墻閻庡墎鎲歌箛鏇燁潟闁圭偓鍓氶崥瀣煕閺囥劌骞橀柣娑栧灲閹鈻撻崹顔界亪濡炪値鍘鹃崗妯侯嚕椤愶箑绠涙い鎾跺仧缁愮偞绻濋悽闈浶㈤柛濠冩倐瀵偊濡舵径瀣ф嫽婵炶揪绲藉﹢鍗烇耿娴犲鐓曢柕濞垮労閻撹偐鈧鍣崑鍕綖閵忣澀娌柣鎰靛墮濞咃紕绱撻崒姘偓鎼佸磹閹间礁纾归柟闂寸绾剧懓顪冪€ｎ亝鎹ｉ柣顓炴閵嗘帒顫濋敐鍛闁诲氦顫夊ú姗€宕濆▎蹇曟殾妞ゆ劧绠戝敮閻熸粌绻橀幃锛勨偓锝庡枟閳锋垿鏌涢幘鏉戠祷濞存粍绻冪换娑㈠矗婢跺苯鈷岄梺璇″枤閸嬨倕鐣疯ぐ鎺濇晝闁绘浜惄搴ㄦ⒒娴ｅ憡璐￠柛搴涘€濆畷鐑樼節閸パ咁槷闂佺粯妫侀妴鈧柛瀣崌瀹曟寰勬繝浣割棜濠电姷鏁搁崑鐐哄垂椤栫偛鍨傛繛宸簼閸嬪倹绻涢幋娆忕仾闁绘挻娲樼换娑㈠箣濠靛棜鍩為梺鍝勵儍閸婃繈寮婚敐澶樻晣闁绘棃顥撻悷鏌ユ⒑闂堟稒鎼愰悗姘卞閹便劑鍩€椤掑嫭鐓冮柍杞扮閺嗙喐銇勯敂鍝勫缂佽鲸鎸婚幏鍛矙鎼存挸浜鹃柛锔诲幗閺嗘粓鏌ｉ幇顒佹儓闁绘帒鐏氶妵鍕箳閹搭垰濮涚紓浣割樀濞佳囨箒濠电姴锕ら幊搴㈢鏉堛劊浜滈柕蹇ョ磿閹冲洦顨ラ悙鍙夊枠闁诡啫鍥ч唶婵﹩鍘奸褰掓⒒閸屾瑧顦﹂柟璇х磿閹广垽宕掑┃鎯т壕婵﹩鍓欏Σ濠氬础鏉堚晜鍠愰柣妤€鐗嗙粭姘舵煟閹惧瓨绀嬮柡灞炬礃缁绘盯宕归鐓庮潥闂佽崵濮甸崝褏妲愰弴鐘愁潟闁圭儤顨忛弫濠囨煕閹炬鍟伴濂告⒑鐠囪尙鍑圭紒鎻掝煼瀹曟垿骞囬弶璺ㄥ姦濡炪倖甯婇懗鍫曞煀閺囩喆浜滄い鎾跺仦閸犳鈧?
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
  
  // 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻閻愮儤鍋嬮柣妯荤湽閳ь兛绶氬鎾閳╁啯鐝栭梻渚€鈧偛鑻晶鏉款熆鐟欏嫭绀嬮柟顔惧厴楠炲﹥绻濋崒婊呅ㄩ梺璇″枓閺呮盯顢欒箛娑辨晩闁绘挸楠歌灇缂傚倸鍊搁崐鎼佸磹閸濄儳鐭撻柣銏犳啞閸嬪鏌￠崶锝嗗櫚闁逞屽墾婵″洭骞戦崟顖毼╅柨鏇楀亾缁剧虎鍨跺铏圭磼濡櫣浠搁柦鍐憾閺岀喖鎮滈幋鎺撳枤濠?: 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧綊鏌熼梻瀵割槮缁惧墽鎳撻—鍐偓锝庝簼閹癸綁鏌ｉ鐐搭棞闁靛棙甯掗～婵嬫晲閸涱剙顥氬┑掳鍊楁慨鐑藉磻濞戔懞鍥偨缁嬫寧鐎梺鐟板⒔缁垶宕戦幇顓滀簻闁归偊鍠栭弸搴∶瑰鍫㈢暫闁哄被鍔戝鎾倷濞村浜鹃柟闂寸劍閸婂嘲鈹戦悩鎻掓殧濞存粍绮撻弻鐔煎传閸曨剦妫炴繛瀛樼矊婢х晫妲愰幘瀛樺闁荤喐婢橀～宥咁渻閵堝啫濡奸柨鏇ㄤ簻椤曪絾绻濆顓炰簻闂佺粯鎸稿ù鐑筋敊婢舵劖鈷戦梺顐ｇ☉瀹撳棙绻涙担鍐插暊閺嬫梹銇勯幘鍗炵仾闁?click
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

function detectBuyerDeletedCancellation(text = getBodyText()) {
  const source = String(text || '');
  return /\u843d\u672d\u8005\u524a\u9664\u3055\u308c\u305f\u305f\u3081[\s\S]{0,20}\u53d6\u5f15\u306f\u3067\u304d\u307e\u305b\u3093/.test(source) ||
    /\u843d\u672d\u8005\u524a\u9664\u3055\u308c\u307e\u3057\u305f/.test(source) ||
    /\u843d\u672d\u8005\u524a\u9664/.test(source);
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
  '\u914d\u9001\u696d\u8005',
  '\u914d\u9001\u65b9\u6cd5',
  '\u4f1d\u7968\u756a\u53f7',
  '\u8ffd\u8de1\u756a\u53f7',
  '\u914d\u9001\u5e0c\u671b\u65e5',
  '\u914d\u9001\u5e0c\u671b\u6642\u9593',
  '\u8cfc\u5165\u65e5\u6642',
  '\u6ce8\u6587\u756a\u53f7'
];

function valueAfterLabel(text, labels) {
  const source = String(text || '');
  for (const label of labels) {
    const index = source.indexOf(label);
    if (index < 0) continue;
    let value = source.slice(index + label.length).replace(/^\s*[:\uff1a]?\s*/, '');
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
  const match = source.match(/\u51fa\u54c1\u8005\s*[:\uff1a]?\s*([^\n\r\uff1a]+)/);
  return normalizeTextValue(String(match?.[1] || '').replace(/[\uff08(][\s\S]*$/, ''));
}

function normalizeNameValue(value, maxLength = 128) {
  return String(value || '').replace(/[ \t\r\n\f]+/g, ' ').trim().slice(0, maxLength);
}

function extractNameValueFromSellerInfoBlock(value) {
  const source = String(value || '');
  const match = source.match(/\u6c0f\u540d\s*[:\uff1a]?\s*([^\n\r]+)/);
  if (!match?.[1]) return '';
  return normalizeNameValue(match[1].replace(/\s*(?:\u4f4f\u6240|\u51fa\u54c1\u8005\u60c5\u5831\u3092\u78ba\u8a8d\u3059\u308b)[\s\S]*$/, ''));
}

function extractSellerInfoSectionText(value) {
  const source = String(value || '');
  const sellerInfoLabel = '\u51fa\u54c1\u8005\u60c5\u5831';
  const sellerInfoIndex = source.indexOf(sellerInfoLabel);
  if (sellerInfoIndex < 0) return '';
  let section = source.slice(sellerInfoIndex);
  const nextSection = section.slice(sellerInfoLabel.length).search(/(?:\u304a\u5c4a\u3051\u60c5\u5831|\u304a\u652f\u6255\u3044\u60c5\u5831|\u843d\u672d\u8005\u60c5\u5831|\u304a\u5c4a\u3051\u5148)/);
  if (nextSection >= 0) {
    section = section.slice(0, sellerInfoLabel.length + nextSection);
  }
  return section;
}

function extractSellerInfoName(text = getBodyText()) {
  const elements = Array.from(document.querySelectorAll('tr, dl, div, li, p') || []);
  let inSellerInfo = false;
  for (const element of elements) {
    const rawText = String(element?.textContent || '');
    const normalized = normalizeTextValue(rawText, 512);
    if (/\u51fa\u54c1\u8005\u60c5\u5831/.test(normalized)) {
      inSellerInfo = true;
    } else if (inSellerInfo && /(?:\u304a\u5c4a\u3051\u60c5\u5831|\u304a\u652f\u6255\u3044\u60c5\u5831|\u843d\u672d\u8005\u60c5\u5831|\u304a\u5c4a\u3051\u5148)/.test(normalized)) {
      inSellerInfo = false;
    }
    if (!inSellerInfo && !/\u51fa\u54c1\u8005\u60c5\u5831/.test(normalized)) continue;
    const name = extractNameValueFromSellerInfoBlock(extractSellerInfoSectionText(rawText) || rawText);
    if (name) return name;
  }
  const source = String(text || '');
  return extractNameValueFromSellerInfoBlock(extractSellerInfoSectionText(source));
}

function hasUnregisteredTrackingNumber(text = getBodyText()) {
  const labeledTrackingNumber = extractLabeledValue(['\u4f1d\u7968\u756a\u53f7', '\u8ffd\u8de1\u756a\u53f7'], text);
  if (/\u672a\u767b\u9332|\u53cd\u6620\u3055\u308c\u308b\u307e\u3067\u304a\u5f85\u3061/.test(labeledTrackingNumber)) return true;
  return /(?:\u4f1d\u7968\u756a\u53f7|\u8ffd\u8de1\u756a\u53f7)\s*[:\uff1a]?\s*\u672a\u767b\u9332/.test(String(text || ''));
}

function extractTrackingNumberFromText(text = getBodyText()) {
  const labeledTrackingNumber = extractLabeledValue(['\u4f1d\u7968\u756a\u53f7', '\u8ffd\u8de1\u756a\u53f7'], text);
  if (labeledTrackingNumber) {
    const labeledMatches = labeledTrackingNumber.match(/(?:\d[\s-]*){10,12}/g) || [];
    for (const candidate of labeledMatches) {
      const digits = candidate.replace(/\D/g, '');
      if (digits.length >= 10 && digits.length <= 12) return digits;
    }
  }
  const source = String(text || '');
  const matches = source.match(/(?:\d[\s-]*){10,12}/g) || [];
  for (const candidate of matches) {
    const digits = candidate.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 12) return digits;
  }
  return '';
}

function extractShippingCompany(text = getBodyText()) {
  const labeledShippingCompany = extractLabeledValue(['\u914d\u9001\u696d\u8005', '\u914d\u9001\u65b9\u6cd5'], text);
  if (labeledShippingCompany) {
    return normalizeTextValue(labeledShippingCompany
      .replace(/[\uff1a:]\s*\u9001\u6599[\s\S]*$/, '')
      .replace(/\s*\u9001\u6599[\s\S]*$/, '')
      .replace(/[\uff08(][\s\S]*$/, ''));
  }
  const source = String(text || '');
  const patterns = [
    /\u914d\u9001(?:\u696d\u8005|\u65b9\u6cd5)\s*[:\uff1a]?\s*([^\n\r]+)/,
    /\u914d\u9001\u65b9\u6cd5\s+([^\n\r:\uff1a]+)/,
    /\u914d\u9001\u696d\u8005\s+([^\n\r:\uff1a]+)/
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) {
      return normalizeTextValue(match[1]
        .replace(/\u8ffd\u8de1\u756a\u53f7[\s\S]*$/, '')
        .replace(/[\uff1a:]\s*\u9001\u6599[\s\S]*$/, '')
        .replace(/\u9001\u6599[\s\S]*$/, '')
        .replace(/[\uff08(][\s\S]*$/, ''));
    }
  }
  return '';
}

function extractPendingShipmentScanResult(text = getBodyText()) {
  const source = String(text || '');
  if (/\u30ad\u30e3\u30f3\u30bb\u30eb\u3055\u308c\u307e\u3057\u305f/.test(source)) {
    return { type: 'cancelled' };
  }

  const storeShipped = /\u5546\u54c1\u304c\u767a\u9001\u3055\u308c\u307e\u3057\u305f/.test(source);
  const normalShipped = /\u51fa\u54c1\u8005[\s\S]{0,80}\u5546\u54c1\u767a\u9001[\s\S]{0,80}\u9023\u7d61/.test(source);
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

  const storePending = /\u3054\u8cfc\u5165\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3059[\s\S]{0,120}\u5546\u54c1\u306e\u767a\u9001\u9023\u7d61\u3092\u304a\u5f85\u3061/.test(source);
  const normalPending = /\u51fa\u54c1\u8005\u306b\u652f\u6255\u3044\u5b8c\u4e86\u306e\u9023\u7d61[\s\S]{0,120}\u5546\u54c1\u306e\u767a\u9001\u9023\u7d61\u3092\u304a\u5f85\u3061/.test(source);
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
    paymentReady: !!findClickableByText(/Yahoo!\s*\u304b\u3093\u305f\u3093\u6c7a\u6e08\u3067\u652f\u6255\u3046/),
    waitingShipping: detectWaitingShippingPaymentAmount(),
    cancelled: detectBuyerDeletedCancellation(),
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
    executeBidV3(taskData.maxPrice, { taskId: taskData.taskId, bidMode: taskData.bidMode, strategy: taskData.strategy, userMaxPrice: taskData.userMaxPrice, currentPrice: taskData.currentPrice, taxType: taskData.taxType, multiBidIncrement: taskData.multiBidIncrement })
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

  executeBidV3(msg.maxPrice, { taskId: msg.taskId, bidMode: msg.bidMode, strategy: msg.strategy, userMaxPrice: msg.userMaxPrice, currentPrice: msg.currentPrice, taxType: msg.taxType, multiBidIncrement: msg.multiBidIncrement })
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
  inferCurrentPriceFromYahooDefaultBidPrice,
  resolveMultiBidNextBidPrice,
  validateUserMaxBidLimit,
  executeBidV3,
  isBidInputPage: () => isBidInputPage(),
  isInstantBuyButtonText,
  isStorePurchaseButtonText,
  isBidEntryButtonText,
  isFinalAgreeButtonText,
  isConfirmButtonText,
  extractOrderHistory,
  findWonHistoryNextPageUrl
};
})();

