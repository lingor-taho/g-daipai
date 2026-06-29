const express = require('express');
const https = require('https');
const fs = require('fs');
const { chromium } = require('playwright');
const {
  normalizeProductType,
  taxExcludedToTaxIncluded,
  normalizeTaxType
} = require('../../shared/priceRules.cjs');
const db = require('../models');

const router = express.Router();
const httpsAgent = new https.Agent({ keepAlive: true });

function normalizeAuctionUrl(input) {
  const match = String(input || '').match(/[a-zA-Z]?\d{8,10}/);
  if (!match) return null;
  const auctionId = match[0].toLowerCase();
  return {
    auctionId,
    standardUrl: `https://auctions.yahoo.co.jp/jp/auction/${auctionId}`
  };
}

function cleanupTitle(title, auctionId) {
  const cleaned = String(title || '')
    .replace(/^Yahoo![^-\n]*オークション\s*-\s*/i, '')
    .replace(/\s*-\s*Yahoo![^-\n]*オークション.*$/i, '')
    .trim();
  if (cleaned && !/^Yahoo![^-\n]*オークション$/i.test(cleaned)) return cleaned;
  return '商品 ' + auctionId;
}

function extractMeta(html, pattern) {
  const match = html.match(pattern);
  return match ? match[1].trim() : '';
}

function normalizeText(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripElementById(html, id) {
  let output = String(html || '');
  for (let i = 0; i < 20; i += 1) {
    const block = extractElementHtmlById(output, id);
    if (!block) break;
    output = output.replace(block, ' ');
  }
  return output;
}

function stripScriptAndStyleHtml(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template\b[\s\S]*?<\/template>/gi, ' ');
}

function stripProductDescriptionHtml(html) {
  return stripElementById(html, 'description');
}

function normalizePageTextWithoutProductDescription(html) {
  return normalizeText(stripScriptAndStyleHtml(stripProductDescriptionHtml(html)));
}

function extractElementHtmlById(html, id) {
  const source = String(html || '');
  const openPattern = new RegExp(`<([a-z0-9]+)\\b[^>]*id=["']${id}["'][^>]*>`, 'i');
  const openMatch = openPattern.exec(source);
  if (!openMatch) return '';
  const tagName = openMatch[1];
  let depth = 1;
  let cursor = openMatch.index + openMatch[0].length;
  const tagPattern = new RegExp(`</?${tagName}\\b[^>]*>`, 'ig');
  tagPattern.lastIndex = cursor;
  while (depth > 0) {
    const tagMatch = tagPattern.exec(source);
    if (!tagMatch) return source.slice(openMatch.index);
    depth += /^<\//.test(tagMatch[0]) ? -1 : 1;
    cursor = tagPattern.lastIndex;
  }
  return source.slice(openMatch.index, cursor);
}

function parsePriceText(text) {
  const match = String(text || '').match(/([\d,]+)\s*(?:円|JPY)?/);
  return match ? parseInt(match[1].replace(/,/g, ''), 10) || 0 : 0;
}

function parseCountText(text) {
  const match = String(text || '').match(/([\d,]+)\s*件/);
  if (!match?.[1]) return null;
  return parseCountValue(match[1]);
}

function parseCountValue(rawValue) {
  const match = String(rawValue ?? '').match(/([\d,]+)/);
  if (!match?.[1]) return null;
  const value = parseInt(match[1].replace(/,/g, ''), 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function extractImage(html) {
  const patterns = [
    /<meta[^>]*(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]*(?:property|name)=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
    /<img[^>]+(?:class|id)=["'][^"']*(?:mainImage|productMainImage|productImage)[^"']*["'][^>]+src=["']([^"']+)["']/i,
    /<img[^>]+src=["']([^"']+)["'][^>]+(?:class|id)=["'][^"']*(?:mainImage|productMainImage|productImage)[^"']*["']/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  const nextDataItem = extractNextDataItem(html);
  const nextDataImage = Array.isArray(nextDataItem?.img)
    ? nextDataItem.img.find(image => image?.image || image?.thumbnail)
    : null;
  if (nextDataImage?.image) return nextDataImage.image;
  if (nextDataImage?.thumbnail) return nextDataImage.thumbnail;
  return '';
}

function extractPrice(html) {
  const pageDataPrice = extractPageDataItemPrice(html, 'price');
  if (pageDataPrice > 0) return pageDataPrice;

  const currentPriceBlock = html.match(/<dt[^>]*>\s*(?:現在|current)\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/i);
  if (currentPriceBlock?.[1]) {
    const currentPrice = parsePriceText(normalizeText(currentPriceBlock[1]));
    if (currentPrice > 0) return currentPrice;
  }

  const patterns = [
    /itemprop=["']price["'][^>]*content=["']([^"']+)["']/i,
    /["']price["']\s*:\s*"?([\d,]+)/i,
    /priceValue["']?\s*:\s*"?([\d,]+)/i,
    /data-price=["']([^"']+)["']/i,
    /class=["'][^"']*price[^"']*["'][^>]*>[\s\S]*?([\d,]+)\s*(?:円|JPY)?/i,
    /([\d,]+)\s*(?:円|JPY)?\s*<\/span>/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return parseInt(match[1].replace(/,/g, ''), 10) || 0;
  }
  return 0;
}

function extractPageDataItemPrice(html, key) {
  const match = String(html || '').match(/var\s+pageData\s*=\s*(\{[\s\S]*?\});/);
  if (!match?.[1]) return 0;
  try {
    const pageData = JSON.parse(match[1]);
    return parsePriceText(pageData?.items?.[key]);
  } catch (_) {
    return 0;
  }
}

function extractPageDataItems(html) {
  const match = String(html || '').match(/var\s+pageData\s*=\s*(\{[\s\S]*?\});/);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1])?.items || null;
  } catch (_) {
    return null;
  }
}

function extractNextDataItem(html) {
  const match = String(html || '').match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return null;
  try {
    const data = JSON.parse(match[1]);
    return data?.props?.pageProps?.initialState?.item?.detail?.item ||
      data?.props?.initialState?.item?.detail?.item ||
      data?.props?.pageProps?.initialState?.detail?.item ||
      null;
  } catch (_) {
    return null;
  }
}

function extractBuyoutPrice(html) {
  const pageDataItems = extractPageDataItems(html);
  if (pageDataItems && Object.prototype.hasOwnProperty.call(pageDataItems, 'winPrice')) {
    return parsePriceText(pageDataItems.winPrice);
  }

  const patterns = [
    /<dt[^>]*>\s*(?:即決|buyout|即決価格)\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/i,
    /即決(?:価格)?[^\d]{0,20}([\d,]+)\s*(?:円|JPY)?/i,
    /buyoutPrice["']?\s*:\s*"?([\d,]+)/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const price = parsePriceText(normalizeText(match[1]));
      if (price > 0) return price;
    }
  }
  return 0;
}

function toTaxIncludedBuyoutPrice(value, taxType) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  if (normalizeTaxType(taxType) !== 'tax_included' || number < 10) return Math.floor(number);
  return Math.round(number * 1.1);
}

function extractBidCount(html) {
  const pageDataItems = extractPageDataItems(html);
  const pageDataCount = parseCountValue(pageDataItems?.bids ?? pageDataItems?.bidCount ?? pageDataItems?.bid_count);
  if (pageDataCount !== null) return pageDataCount;

  const nextDataItem = extractNextDataItem(html);
  const nextDataCount = parseCountValue(nextDataItem?.bids ?? nextDataItem?.bidCount ?? nextDataItem?.bid_count);
  if (nextDataCount !== null) return nextDataCount;

  const source = String(html || '');
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let fallbackCount = null;
  for (const match of source.matchAll(anchorPattern)) {
    const attrs = match[1] || '';
    const innerHtml = match[2] || '';
    const count = parseCountText(normalizeText(innerHtml));
    if (count === null) continue;
    const candidate = `${attrs} ${innerHtml}`;
    if (/bid[_-]?hist|bidhistory|入札履歴|show\/bid/i.test(candidate)) return count;
    if (fallbackCount === null) fallbackCount = count;
  }
  return fallbackCount ?? 0;
}

function extractBuyoutOnly(html) {
  const buyoutPrice = extractBuyoutPrice(html);
  if (buyoutPrice <= 0) return false;
  const buttonGroupText = normalizeText(extractElementHtmlById(html, 'bidButtonGroup'));
  const pageText = normalizePageTextWithoutProductDescription(html);
  const actionText = buttonGroupText || pageText;
  const hasInstantBuyButton = /今すぐ落札/.test(buttonGroupText);
  const hasStorePurchaseButton = /購入手続きへ/.test(actionText);
  const hasStorePriceLabel = /価格[^\d]{0,20}[\d,]+\s*円/.test(pageText);
  const hasBidButton = /入札する|入札に進む|値段を上げて入札/.test(actionText);
  return ((hasInstantBuyButton && Boolean(buttonGroupText)) || (hasStorePurchaseButton && hasStorePriceLabel)) && !hasBidButton;
}

function extractStorePurchaseTaxIncludedPrice(html) {
  const text = normalizePageTextWithoutProductDescription(html);
  if (!/購入手続きへ/.test(text)) return 0;
  const match = text.match(/価格[^\d]{0,40}([\d,]+)\s*円\s*[\(（]?\s*税込/i);
  return match?.[1] ? parsePriceText(match[1]) : 0;
}

function extractTaxType(html) {
  const text = normalizePageTextWithoutProductDescription(html || '');
  if (/（\s*税\s*0\s*円\s*）|\(\s*税\s*0\s*円\s*\)/.test(text)) return 'tax_zero';
  if (/（\s*税込\s*）|\(\s*税込\s*\)/.test(text)) return 'tax_included';
  return 'tax_zero';
}

function getProductTypeFromTaxType(taxType) {
  return normalizeProductType('', taxType);
}

function extractLowestStructuredShippingFee(item) {
  const prices = (Array.isArray(item?.shipping?.methods) ? item.shipping.methods : [])
    .map(method => Number(method?.shippingFee || 0))
    .filter(amount => Number.isFinite(amount) && amount > 0);
  return prices.length ? Math.min(...prices) : 0;
}

function extractShippingFeeText(html) {
  const postageHtml = extractElementHtmlById(html, 'itemPostage');
  const nextDataItem = extractNextDataItem(html);
  const pageText = normalizePageTextWithoutProductDescription(html);
  const postageIndex = pageText.search(/送料|送料負担|配送方法/);
  const fallbackText = postageIndex >= 0 ? pageText.slice(postageIndex, postageIndex + 240) : '';
  const text = normalizeText([postageHtml, fallbackText].filter(Boolean).join(' '));
  const shippingCharge = String(nextDataItem?.chargeForShipping || '');
  const shippingInput = String(nextDataItem?.shippingInput || '');
  const labelText = normalizeText([postageHtml, fallbackText, shippingInput, shippingCharge].filter(Boolean).join(' '));
  if (!text && !shippingCharge && !shippingInput) return '';
  const structuredShippingFee = extractLowestStructuredShippingFee(nextDataItem);
  if (structuredShippingFee > 0) return `${structuredShippingFee}円`;
  const isLaterInputShipping = /取引ナビ開始時に入力/.test(shippingInput);
  const priceMatch = text.match(/送料[^\d]{0,20}([\d,]+)\s*円/);
  if (priceMatch && !isLaterInputShipping) return `${priceMatch[1].replace(/,/g, '')}円`;
  if (/着払い/.test(labelText)) return '着払い';
  if (/seller/i.test(shippingCharge)) return '無料';
  if (/winner/i.test(shippingCharge)) return '落札者負担';
  if (/無料/.test(labelText)) return '無料';
  if (/落札者負担|winner/i.test(labelText)) return '落札者負担';
  return '';
}

function isGenericShippingFeeText(value) {
  return value === '落札者負担';
}

function normalizeYahooShippingPrefCode(value, fallback = '27') {
  const text = String(value || '').trim().padStart(2, '0');
  return /^(0[1-9]|[1-3][0-9]|4[0-7])$/.test(text) ? text : fallback;
}

async function getYahooShippingPrefCode(database = db) {
  const envPrefCode = normalizeYahooShippingPrefCode(process.env.YAHOO_SHIPPING_PREF_CODE || '27');
  try {
    const row = await database.getOne("SELECT value FROM config WHERE key = 'yahoo_shipping_pref_code'");
    return normalizeYahooShippingPrefCode(row?.value, envPrefCode);
  } catch {
    return envPrefCode;
  }
}

function buildYahooShipmentUrls(html, auctionId, prefCodeValue = '27') {
  const item = extractNextDataItem(html);
  const urls = [];
  const shoppingInfo = item?.aucShoppingItemInfo;
  const sellerId = shoppingInfo?.shoppingSellerId;
  const postageSet = shoppingInfo?.postageSetId || shoppingInfo?.shoppingItemInfo?.postageSet;
  const prefCode = normalizeYahooShippingPrefCode(prefCodeValue);
  if (sellerId && postageSet) {
    const params = new URLSearchParams({
      sellerId,
      prefCode,
      itemCode: auctionId,
      postageSet: String(postageSet),
      price: String(item?.taxinPrice || item?.price || 0)
    });
    if (shoppingInfo.weight) params.set('weight', String(shoppingInfo.weight));
    urls.push(`https://auctions.yahoo.co.jp/web/api/itempage/v1/shipments/shopping?${params.toString()}`);
  }
  if (Array.isArray(item?.shipping?.methods) && item.shipping.methods.length > 0) {
    const params = new URLSearchParams({ aid: auctionId, prefCode });
    urls.push(`https://auctions.yahoo.co.jp/web/api/itempage/v1/shipments/auction/items/${auctionId}?${params.toString()}`);
  }
  return urls;
}

function extractShippingFeeTextFromShipmentJson(value) {
  try {
    const data = typeof value === 'string' ? JSON.parse(value) : value;
    const methodPrices = (Array.isArray(data?.methods) ? data.methods : [])
      .map(method => Number(method?.shippingPrice || 0))
      .filter(amount => amount > 0);
    const price = methodPrices.length ? Math.min(...methodPrices) : Number(data?.lowestPrice || 0);
    return Number.isFinite(price) && price > 0 ? `${price}円` : '';
  } catch (_) {
    return '';
  }
}

function extractEndTime(html) {
  const patterns = [
    /itemprop=["']endDate["'][^>]*content=["']([^"']+)["']/i,
    /["']priceValidUntil["']\s*:\s*["']([^"']+)["']/i,
    /class=["']endedText[^"']*["'][^>]*>([^<]+)<\/span>/i,
    /終了日時[^>]*>(\d{4}\/\d{1,2}\/\d{1,2}[^<]*)/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function extractTitle(html, auctionId) {
  const pageDataTitle = cleanupTitle(extractPageDataItems(html)?.productName, auctionId);
  if (pageDataTitle !== '商品 ' + auctionId) return pageDataTitle;

  const nextDataItem = extractNextDataItem(html);
  const nextDataTitle = cleanupTitle(
    nextDataItem?.productName || nextDataItem?.title || nextDataItem?.name,
    auctionId
  );
  if (nextDataTitle !== '商品 ' + auctionId) return nextDataTitle;

  const patterns = [
    /<meta[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]*(?:property|name)=["']twitter:title["'][^>]*content=["']([^"']+)["']/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<title>([^<]+)<\/title>/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const title = cleanupTitle(normalizeText(match?.[1] || ''), auctionId);
    if (title !== '商品 ' + auctionId) return title;
  }
  return '商品 ' + auctionId;
}

function parseProductHtml(html, auctionId, standardUrl) {
  const title = extractTitle(html, auctionId);
  const taxType = extractTaxType(html);
  const pageDataBuyoutPrice = extractPageDataItemPrice(html, 'winPrice');
  const rawBuyoutPrice = extractBuyoutPrice(html);
  const storePurchaseTaxIncludedPrice = taxType === 'tax_included'
    ? extractStorePurchaseTaxIncludedPrice(html)
    : 0;
  const buyoutPrice = storePurchaseTaxIncludedPrice ||
    (pageDataBuyoutPrice > 0 ? toTaxIncludedBuyoutPrice(pageDataBuyoutPrice, taxType) : rawBuyoutPrice);
  return {
    auctionId,
    standardUrl,
    title,
    currentPrice: extractPrice(html),
    buyoutPrice,
    bidCount: extractBidCount(html),
    buyoutOnly: extractBuyoutOnly(html),
    taxType,
    productType: getProductTypeFromTaxType(taxType),
    shippingFeeText: extractShippingFeeText(html),
    endTime: extractEndTime(html),
    imageUrl: extractImage(html)
  };
}

function buildYahooSearchUrl(keyword) {
  return `https://auctions.yahoo.co.jp/search/search?auccat=0&tab_ex=commerce&ei=utf-8&aq=-1&oq=&sc_i=&fr=&p=${encodeURIComponent(String(keyword || '').trim())}`;
}

function extractProductsListHtml(html) {
  const source = String(html || '');
  const openMatch = /<div\b[^>]*class=["'][^"']*\bProducts__list\b[^"']*["'][^>]*>/i.exec(source);
  if (!openMatch) return '';

  let depth = 1;
  let cursor = openMatch.index + openMatch[0].length;
  const tagPattern = /<\/?div\b[^>]*>/ig;
  tagPattern.lastIndex = cursor;

  while (depth > 0) {
    const tagMatch = tagPattern.exec(source);
    if (!tagMatch) return source.slice(openMatch.index);
    if (/^<div\b/i.test(tagMatch[0])) {
      depth += 1;
    } else {
      depth -= 1;
    }
    cursor = tagPattern.lastIndex;
  }

  return source.slice(openMatch.index, cursor);
}

function extractAuctionIdsFromSearchHtml(html) {
  const productsHtml = extractProductsListHtml(html);
  if (!productsHtml) return [];

  const ids = [];
  const seen = new Set();
  for (const match of productsHtml.matchAll(/\/jp\/auction\/([a-zA-Z]?\d{8,10})/g)) {
    const auctionId = match[1].toLowerCase();
    if (seen.has(auctionId)) continue;
    seen.add(auctionId);
    ids.push(auctionId);
  }
  return ids;
}

function isUsefulProduct(product, auctionId) {
  return Boolean(
    product &&
    (product.title && product.title !== '商品 ' + auctionId || product.imageUrl || Number(product.currentPrice) > 0)
  );
}

function httpFetchHtml(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      agent: httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'ja-JP,ja;q=0.9'
      }
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const redirectUrl = new URL(response.headers.location, url).toString();
        httpFetchHtml(redirectUrl, timeoutMs).then(resolve, reject);
        return;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Yahoo returned ${response.statusCode}`));
        return;
      }

      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve(data));
    });

    request.on('error', reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('Yahoo request timeout'));
    });
  });
}

async function playwrightFetchHtml(url) {
  const launchOptions = { headless: true };
  const chromePaths = [
    process.env.CHROME_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : null,
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  const executablePath = chromePaths.find(candidate => fs.existsSync(candidate));
  if (executablePath) launchOptions.executablePath = executablePath;
  if (process.env.YAHOO_PROXY_SERVER) {
    launchOptions.proxy = {
      server: process.env.YAHOO_PROXY_SERVER,
      username: process.env.YAHOO_PROXY_USERNAME || undefined,
      password: process.env.YAHOO_PROXY_PASSWORD || undefined
    };
  }

  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({
      locale: 'ja-JP',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    return await page.content();
  } finally {
    await browser.close();
  }
}

function createProductService({
  cache = new Map(),
  httpFetcher = httpFetchHtml,
  playwrightFetcher = playwrightFetchHtml
} = {}) {
  function cacheProduct(rawProduct) {
    const parsed = normalizeAuctionUrl(rawProduct?.auctionId || rawProduct?.url || rawProduct?.standardUrl);
    if (!parsed) return null;
    const product = {
      auctionId: parsed.auctionId,
      standardUrl: rawProduct.standardUrl || rawProduct.url || parsed.standardUrl,
      title: rawProduct.title || ('商品 ' + parsed.auctionId),
      currentPrice: Number(rawProduct.currentPrice || 0),
      buyoutPrice: Number(rawProduct.buyoutPrice || 0),
      bidCount: Number(rawProduct.bidCount ?? rawProduct.bid_count ?? 0),
      buyoutOnly: Boolean(rawProduct.buyoutOnly || rawProduct.buyout_only),
      taxType: rawProduct.taxType || rawProduct.tax_type || 'tax_zero',
      productType: rawProduct.productType || rawProduct.product_type || getProductTypeFromTaxType(rawProduct.taxType || rawProduct.tax_type),
      shippingFeeText: rawProduct.shippingFeeText || rawProduct.shipping_fee_text || '',
      endTime: rawProduct.endTime || '',
      imageUrl: rawProduct.imageUrl || '',
      cachedAt: new Date().toISOString()
    };
    cache.set(parsed.auctionId, product);
    return product;
  }

  async function fetchProduct(url) {
    const parsed = normalizeAuctionUrl(url);
    if (!parsed) {
      const error = new Error('invalid product url');
      error.statusCode = 400;
      throw error;
    }

    const cached = cache.get(parsed.auctionId);

    try {
      const html = await httpFetcher(parsed.standardUrl);
      const data = parseProductHtml(html, parsed.auctionId, parsed.standardUrl);
      const prefCode = await getYahooShippingPrefCode();
      const shipmentUrls = buildYahooShipmentUrls(html, parsed.auctionId, prefCode);
      const attemptedShipmentLookup = shipmentUrls.length > 0;
      if (attemptedShipmentLookup) {
        for (const shipmentUrl of shipmentUrls) {
          try {
            const shipmentJson = await httpFetcher(shipmentUrl);
            const resolvedShipping = extractShippingFeeTextFromShipmentJson(shipmentJson);
            if (resolvedShipping) {
              data.shippingFeeText = resolvedShipping;
              break;
            }
          } catch (_) {}
        }
      }
      if (isUsefulProduct(data, parsed.auctionId)) {
        cacheProduct(data);
        return { success: true, data, source: 'http' };
      }
    } catch (_) {}

    try {
      const html = await playwrightFetcher(parsed.standardUrl);
      const data = parseProductHtml(html, parsed.auctionId, parsed.standardUrl);
      const prefCode = await getYahooShippingPrefCode();
      const shipmentUrls = buildYahooShipmentUrls(html, parsed.auctionId, prefCode);
      for (const shipmentUrl of shipmentUrls) {
        try {
          const shipmentJson = await httpFetcher(shipmentUrl);
          const resolvedShipping = extractShippingFeeTextFromShipmentJson(shipmentJson);
          if (resolvedShipping) {
            data.shippingFeeText = resolvedShipping;
            break;
          }
        } catch (_) {}
      }
      if (isUsefulProduct(data, parsed.auctionId)) {
        cacheProduct(data);
        return { success: true, data, source: 'playwright' };
      }
    } catch (_) {}

    if (cached) {
      return { success: true, data: cached, source: 'cache-fallback' };
    }

    const error = new Error('服务器网络问题，请稍后重试！');
    error.statusCode = 502;
    throw error;
  }

  async function fetchSearchHtml(keyword) {
    const searchUrl = buildYahooSearchUrl(keyword);
    try {
      return await httpFetcher(searchUrl);
    } catch (_) {
      return playwrightFetcher(searchUrl);
    }
  }

  async function fetchProductByKeyword(keyword) {
    const normalizedKeyword = String(keyword || '').trim();
    if (!normalizedKeyword) {
      const error = new Error('keyword is required');
      error.statusCode = 400;
      throw error;
    }

    const searchHtml = await fetchSearchHtml(normalizedKeyword);
    const auctionIds = extractAuctionIdsFromSearchHtml(searchHtml);
    if (auctionIds.length !== 1) {
      const error = new Error('存在多个商品结果，无法显示！');
      error.statusCode = 400;
      throw error;
    }

    return fetchProduct(`https://auctions.yahoo.co.jp/jp/auction/${auctionIds[0]}`);
  }

  return { cacheProduct, fetchProduct, fetchProductByKeyword };
}

const productService = createProductService();

router.get('/fetch', async (req, res) => {
  const { url, keyword } = req.query;
  if (!url && !keyword) return res.status(400).json({ error: 'url or keyword is required' });

  try {
    const result = keyword
      ? await productService.fetchProductByKeyword(keyword)
      : await productService.fetchProduct(url);
    res.json(result);
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || '商品信息获取失败' });
  }
});

module.exports = router;
module.exports.createProductService = createProductService;
module.exports.normalizeAuctionUrl = normalizeAuctionUrl;
module.exports.parseProductHtml = parseProductHtml;
module.exports.extractAuctionIdsFromSearchHtml = extractAuctionIdsFromSearchHtml;
module.exports.buildYahooSearchUrl = buildYahooSearchUrl;
module.exports.normalizeYahooShippingPrefCode = normalizeYahooShippingPrefCode;
module.exports.getYahooShippingPrefCode = getYahooShippingPrefCode;
module.exports.productService = productService;
