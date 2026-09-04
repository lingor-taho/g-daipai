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
  const withoutHead = String(html || '').replace(/<head\b[\s\S]*?<\/head>/gi, ' ');
  return normalizeText(stripScriptAndStyleHtml(stripProductDescriptionHtml(withoutHead)));
}

function normalizeComparableText(value) {
  return normalizeText(value).replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim();
}

function removeProductTitleText(text, html) {
  const nextDataItem = extractNextDataItem(html);
  const candidates = [
    extractPageDataItems(html)?.productName,
    nextDataItem?.productName,
    nextDataItem?.title,
    nextDataItem?.name,
    normalizeText(extractElementHtmlById(html, 'itemTitle'))
  ];
  let output = normalizeComparableText(text);
  for (const candidate of candidates) {
    const title = normalizeComparableText(candidate);
    if (title.length >= 4) output = output.split(title).join(' ');
  }
  return normalizeComparableText(output);
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

function extractProductSummaryHtml(html) {
  const source = String(html || '');
  const titleOpen = /<div\b[^>]*id=["']itemTitle["'][^>]*>/i.exec(source);
  if (!titleOpen) return '';
  let endIndex = 0;
  for (const id of ['itemStatus', 'bidButtonGroup']) {
    const block = extractElementHtmlById(source, id);
    const blockIndex = block ? source.indexOf(block, titleOpen.index) : -1;
    if (blockIndex >= titleOpen.index) endIndex = Math.max(endIndex, blockIndex + block.length);
  }
  return endIndex > titleOpen.index ? source.slice(titleOpen.index, endIndex) : '';
}

function extractLabeledProductPriceText(html, labelPattern) {
  const summaryHtml = extractProductSummaryHtml(html);
  if (!summaryHtml) return '';
  const row = summaryHtml.match(new RegExp(`<dt[^>]*>\\s*(?:${labelPattern})\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`, 'i'));
  return row?.[1] ? normalizeText(row[1]) : '';
}

function extractLabeledProductPrice(html, labelPattern) {
  return parsePriceText(extractLabeledProductPriceText(html, labelPattern));
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

function normalizeProductImageUrl(value) {
  const decoded = decodeHtmlEntities(value).trim();
  if (/^\/\//.test(decoded)) return `https:${decoded}`;
  return /^https?:\/\//i.test(decoded) ? decoded : '';
}

function extractProductImages(html) {
  const item = extractNextDataItem(html);
  const images = [];
  const seen = new Set();

  for (const image of Array.isArray(item?.img) ? item.img : []) {
    const url = normalizeProductImageUrl(image?.image || image?.url || image?.src || image?.thumbnail);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    images.push({
      url,
      thumbnailUrl: normalizeProductImageUrl(image?.thumbnail) || url,
      width: Number(image?.width || 0) || null,
      height: Number(image?.height || 0) || null
    });
  }

  if (images.length === 0) {
    const fallbackUrl = normalizeProductImageUrl(extractImage(html));
    if (fallbackUrl) images.push({ url: fallbackUrl, thumbnailUrl: fallbackUrl, width: null, height: null });
  }
  return images;
}

function descriptionHtmlToText(value) {
  const withoutScripts = stripScriptAndStyleHtml(value)
    .replace(/<img\b[^>]*\balt\s*=\s*(["'])([\s\S]*?)\1[^>]*>/gi, ' $2 ')
    .replace(/<li\b[^>]*>/gi, '\n・')
    .replace(/<br\b[^>]*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|header|footer|h[1-6]|tr|table|ul|ol|dl|dt|dd)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(withoutScripts)
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractProductDescriptionText(html) {
  const item = extractNextDataItem(html);
  const descriptionHtml = item?.descriptionHtml || extractElementHtmlById(html, 'description');
  const htmlText = descriptionHtmlToText(descriptionHtml);
  if (htmlText) return htmlText;

  const description = Array.isArray(item?.description)
    ? item.description.join('\n')
    : String(item?.description || '');
  return descriptionHtmlToText(description);
}

function sanitizeProductDescriptionHtml(value) {
  return String(value || '')
    .replace(/<(script|iframe|object|embed|form|button|textarea|select)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(?:script|iframe|object|embed|form|input|button|textarea|select|option|meta|base|link)\b[^>]*\/?\s*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(["'])[\s\S]*?\1/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\s+(?:srcdoc|formaction)\s*=\s*(["'])[\s\S]*?\1/gi, '')
    .replace(/\s+(?:srcdoc|formaction)\s*=\s*[^\s>]+/gi, '')
    .replace(/\b(href|src)\s*=\s*(["'])\s*(?:javascript|vbscript):[\s\S]*?\2/gi, '$1="#"');
}

function extractProductDescriptionHtml(html) {
  const item = extractNextDataItem(html);
  const descriptionHtml = item?.descriptionHtml || extractElementHtmlById(html, 'description');
  return sanitizeProductDescriptionHtml(descriptionHtml);
}

function formatDetailPriceText(amount, taxIncluded) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  return `${Math.round(value).toLocaleString('ja-JP')}円${taxIncluded ? '（税込）' : ''}`;
}

function extractDetailDisplayPrice(html, currentPrice, buyoutPrice, taxType) {
  const item = extractNextDataItem(html);
  const baseCurrentPrice = parsePriceText(item?.price) || Number(currentPrice || 0);
  const taxIncludedCurrentPrice = parsePriceText(item?.taxinPrice);
  const displayCurrentPrice = taxIncludedCurrentPrice || baseCurrentPrice;
  const currentPriceIncludesTax = taxIncludedCurrentPrice > 0 ||
    (normalizeTaxType(taxType) === 'tax_included' && displayCurrentPrice > 0);

  const baseBuyoutPrice = parsePriceText(item?.bidorbuy) || Number(buyoutPrice || 0);
  const taxIncludedBuyoutPrice = parsePriceText(item?.taxinBidorbuy);
  const displayBuyoutPrice = taxIncludedBuyoutPrice || Number(buyoutPrice || 0) || baseBuyoutPrice;
  const buyoutPriceIncludesTax = taxIncludedBuyoutPrice > 0 ||
    (normalizeTaxType(taxType) === 'tax_included' && displayBuyoutPrice > 0);

  return {
    currentPrice: displayCurrentPrice,
    currentPriceBeforeTax: baseCurrentPrice,
    currentPriceText: formatDetailPriceText(displayCurrentPrice, currentPriceIncludesTax),
    buyoutPrice: displayBuyoutPrice,
    buyoutPriceBeforeTax: baseBuyoutPrice,
    buyoutPriceText: formatDetailPriceText(displayBuyoutPrice, buyoutPriceIncludesTax),
    taxRate: Number(item?.taxRate || 0) || null
  };
}

function extractAuctionStatus(html) {
  const rawStatus = String(extractNextDataItem(html)?.status || '').trim().toLowerCase();
  if (rawStatus === 'open') return { auctionStatus: rawStatus, auctionStatusText: '进行中' };
  if (/closed|ended|sold/.test(rawStatus)) return { auctionStatus: rawStatus, auctionStatusText: '已结束' };
  if (/cancel|suspend/.test(rawStatus)) return { auctionStatus: rawStatus, auctionStatusText: '已取消' };

  const pageText = normalizePageTextWithoutProductDescription(html);
  if (/オークションは終了|このオークションは終了|終了しました/.test(pageText)) {
    return { auctionStatus: 'closed', auctionStatusText: '已结束' };
  }
  if (/入札する|今すぐ落札|購入手続きへ/.test(pageText)) {
    return { auctionStatus: 'open', auctionStatusText: '进行中' };
  }
  return { auctionStatus: rawStatus || 'unknown', auctionStatusText: '状态未知' };
}

function extractProductConditionName(html) {
  const item = extractNextDataItem(html);
  const structuredCondition = normalizeComparableText(item?.conditionName);
  if (structuredCondition) return structuredCondition;

  const pageDataCondition = normalizeComparableText(extractPageDataItems(html)?.conditionName);
  if (pageDataCondition) return pageDataCondition;

  const source = stripScriptAndStyleHtml(stripProductDescriptionHtml(html));
  const match = source.match(/<dt[^>]*>\s*(?:商品の状態|商品状態|状態)\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/i);
  return normalizeComparableText(match?.[1] || '');
}

function extractPrice(html) {
  const pageDataPrice = extractPageDataItemPrice(html, 'price');
  if (pageDataPrice > 0) return pageDataPrice;
  const nextDataPrice = parsePriceText(extractNextDataItem(html)?.price);
  if (nextDataPrice > 0) return nextDataPrice;
  return extractLabeledProductPrice(html, '現在|current') || extractLabeledProductPrice(html, '即決|buyout|即決価格');
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

  return extractLabeledProductPrice(html, '即決|buyout|即決価格');
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

  const source = extractElementHtmlById(html, 'itemStatus');
  if (!source) return 0;
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
  const pageText = normalizeText(extractProductSummaryHtml(html));
  const actionText = buttonGroupText || pageText;
  const hasInstantBuyButton = /今すぐ落札/.test(buttonGroupText);
  const hasStorePurchaseButton = /購入手続きへ/.test(actionText);
  const hasStorePriceLabel = /(?:価格|即決)[^\d]{0,20}[\d,]+\s*円/.test(pageText);
  const hasBidButton = /入札する|入札に進む|値段を上げて入札/.test(actionText);
  return ((hasInstantBuyButton && Boolean(buttonGroupText)) || (hasStorePurchaseButton && hasStorePriceLabel)) && !hasBidButton;
}

function extractStorePurchaseTaxIncludedPrice(html) {
  const labeledBuyoutText = extractLabeledProductPriceText(html, '即決|buyout|即決価格');
  if (/税込/.test(labeledBuyoutText)) return parsePriceText(labeledBuyoutText);
  const text = normalizeText(extractProductSummaryHtml(html));
  if (!/購入手続きへ/.test(text)) return 0;
  const match = text.match(/価格[^\d]{0,40}([\d,]+)\s*円\s*[\(（]?\s*税込/i);
  return match?.[1] ? parsePriceText(match[1]) : 0;
}

function extractTaxType(html) {
  const text = normalizeText(extractProductSummaryHtml(html));
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
  const pageText = removeProductTitleText(
    normalizePageTextWithoutProductDescription(stripElementById(html, 'itemTitle')),
    html
  );
  const postageIndex = pageText.search(/送料|送料負担|配送方法/);
  const shippingCharge = String(nextDataItem?.chargeForShipping || '');
  const shippingInput = String(nextDataItem?.shippingInput || '');
  const fallbackText = !postageHtml && !shippingCharge && !shippingInput && postageIndex >= 0
    ? pageText.slice(postageIndex, postageIndex + 240)
    : '';
  const text = normalizeText([postageHtml, fallbackText].filter(Boolean).join(' '));
  const labelText = normalizeText([postageHtml, fallbackText, shippingInput, shippingCharge].filter(Boolean).join(' '));
  if (!text && !shippingCharge && !shippingInput) return '';
  if (/seller/i.test(shippingCharge)) return '無料';
  const structuredShippingFee = extractLowestStructuredShippingFee(nextDataItem);
  if (structuredShippingFee > 0) return `${structuredShippingFee}円`;
  const isLaterInputShipping = /取引ナビ開始時に入力/.test(shippingInput);
  const priceMatch = normalizeText(postageHtml).match(/送料[^\d]{0,20}([\d,]+)\s*円/);
  if (priceMatch && !isLaterInputShipping) return `${priceMatch[1].replace(/,/g, '')}円`;
  if (/着払い/.test(labelText)) return '着払い';
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
  const nextDataItem = extractNextDataItem(html);
  if (nextDataItem?.endTime) return String(nextDataItem.endTime).trim();
  if (nextDataItem?.timeForBrightTag?.endTime) return String(nextDataItem.timeForBrightTag.endTime).trim();
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

  const itemTitle = cleanupTitle(normalizeText(extractElementHtmlById(html, 'itemTitle')), auctionId);
  if (itemTitle !== '商品 ' + auctionId) return itemTitle;

  const patterns = [
    /<meta[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]*(?:property|name)=["']twitter:title["'][^>]*content=["']([^"']+)["']/i,
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
  const images = extractProductImages(html);
  const auctionStatus = extractAuctionStatus(html);
  const pageDataBuyoutPrice = extractPageDataItemPrice(html, 'winPrice');
  const rawBuyoutPrice = extractBuyoutPrice(html);
  const storePurchaseTaxIncludedPrice = taxType === 'tax_included'
    ? extractStorePurchaseTaxIncludedPrice(html)
    : 0;
  const buyoutPrice = storePurchaseTaxIncludedPrice ||
    (pageDataBuyoutPrice > 0 ? toTaxIncludedBuyoutPrice(pageDataBuyoutPrice, taxType) : rawBuyoutPrice);
  const currentPrice = extractPrice(html);
  return {
    auctionId,
    standardUrl,
    title,
    currentPrice,
    buyoutPrice,
    bidCount: extractBidCount(html),
    buyoutOnly: extractBuyoutOnly(html),
    taxType,
    productType: getProductTypeFromTaxType(taxType),
    shippingFeeText: extractShippingFeeText(html),
    endTime: extractEndTime(html),
    imageUrl: images[0]?.url || extractImage(html),
    images,
    descriptionText: extractProductDescriptionText(html),
    descriptionHtml: extractProductDescriptionHtml(html),
    detailDisplayPrice: extractDetailDisplayPrice(html, currentPrice, buyoutPrice, taxType),
    conditionName: extractProductConditionName(html),
    ...auctionStatus
  };
}

const YAHOO_SEARCH_PAGE_SIZE = 50;

function buildYahooSearchUrl(keyword, page = 1) {
  const normalizedPage = Math.max(1, Math.floor(Number(page) || 1));
  const start = ((normalizedPage - 1) * YAHOO_SEARCH_PAGE_SIZE) + 1;
  return `https://auctions.yahoo.co.jp/search/search?auccat=0&tab_ex=commerce&ei=utf-8&aq=-1&oq=&sc_i=&fr=&p=${encodeURIComponent(String(keyword || '').trim())}&b=${start}&n=${YAHOO_SEARCH_PAGE_SIZE}`;
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

function decodeHtmlEntities(value) {
  const namedEntities = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  };
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
      const codePoint = parseInt(hex, 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&#(\d+);/g, (match, decimal) => {
      const codePoint = parseInt(decimal, 10);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&([a-z]+);/gi, (match, name) => namedEntities[name.toLowerCase()] ?? match);
}

function extractHtmlAttribute(html, attributeName) {
  const escapedName = String(attributeName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(html || '').match(new RegExp(`\\b${escapedName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'));
  return decodeHtmlEntities(match?.[2] || '').trim();
}

function getClassTokensFromTag(tagHtml) {
  return extractHtmlAttribute(tagHtml, 'class').split(/\s+/).filter(Boolean);
}

function extractElementByClassToken(html, tagName, classToken) {
  const source = String(html || '');
  const openPattern = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  for (const openMatch of source.matchAll(openPattern)) {
    const openingTag = openMatch[0];
    if (!getClassTokensFromTag(openingTag).includes(classToken)) continue;
    if (/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(tagName)) {
      return openingTag;
    }

    let depth = 1;
    let cursor = openMatch.index + openingTag.length;
    const tagPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
    tagPattern.lastIndex = cursor;
    while (depth > 0) {
      const tagMatch = tagPattern.exec(source);
      if (!tagMatch) return source.slice(openMatch.index);
      depth += /^<\//.test(tagMatch[0]) ? -1 : 1;
      cursor = tagPattern.lastIndex;
    }
    return source.slice(openMatch.index, cursor);
  }
  return '';
}

function extractSearchPriceByLabel(cardHtml, label) {
  const labelPattern = new RegExp(
    `<[^>]+class=["'][^"']*\\bProduct__label\\b[^"']*["'][^>]*>\\s*${label}\\s*<\\/[^>]+>`,
    'i'
  );
  const labelMatch = labelPattern.exec(cardHtml);
  if (!labelMatch) return 0;
  const priceHtml = extractElementByClassToken(
    cardHtml.slice(labelMatch.index + labelMatch[0].length, labelMatch.index + labelMatch[0].length + 500),
    'span',
    'Product__priceValue'
  );
  return parsePriceText(normalizeText(priceHtml));
}

function extractSearchProductCards(html) {
  const productsHtml = extractProductsListHtml(html);
  if (!productsHtml) return [];

  const items = [];
  const seen = new Set();
  const listItemPattern = /<li\b[^>]*>[\s\S]*?<\/li>/gi;
  for (const match of productsHtml.matchAll(listItemPattern)) {
    const cardHtml = match[0];
    const openingTag = cardHtml.match(/^<li\b[^>]*>/i)?.[0] || '';
    if (!getClassTokensFromTag(openingTag).includes('Product')) continue;

    const titleLink = extractElementByClassToken(cardHtml, 'a', 'Product__titleLink');
    const imageLink = extractElementByClassToken(cardHtml, 'a', 'Product__imageLink');
    const linkHtml = titleLink || imageLink;
    const parsed = normalizeAuctionUrl(
      extractHtmlAttribute(linkHtml, 'data-auction-id') || extractHtmlAttribute(linkHtml, 'href')
    );
    if (!parsed || seen.has(parsed.auctionId)) continue;

    const bonusHtml = extractElementByClassToken(cardHtml, 'div', 'Product__bonus');
    const imageHtml = extractElementByClassToken(cardHtml, 'img', 'Product__imageData');
    const postageHtml = extractElementByClassToken(cardHtml, 'p', 'Product__postage');
    const bidHtml = extractElementByClassToken(cardHtml, 'dd', 'Product__bid');
    const timeHtml = extractElementByClassToken(cardHtml, 'dd', 'Product__time');
    const title = decodeHtmlEntities(
      extractHtmlAttribute(titleLink, 'data-auction-title') ||
      extractHtmlAttribute(titleLink, 'title') ||
      normalizeText(titleLink)
    ).trim();
    const currentPrice = extractSearchPriceByLabel(cardHtml, '現在') ||
      parsePriceText(extractHtmlAttribute(titleLink || imageLink, 'data-auction-price'));
    const buyoutPrice = extractSearchPriceByLabel(cardHtml, '即決') ||
      parsePriceText(extractHtmlAttribute(bonusHtml, 'data-auction-buynowprice'));
    const endTimeEpoch = parseInt(extractHtmlAttribute(bonusHtml, 'data-auction-endtime'), 10) || null;

    seen.add(parsed.auctionId);
    items.push({
      auctionId: parsed.auctionId,
      standardUrl: parsed.standardUrl,
      title: title || ('商品 ' + parsed.auctionId),
      imageUrl: extractHtmlAttribute(titleLink || imageLink, 'data-auction-img') ||
        extractHtmlAttribute(imageHtml, 'src'),
      currentPrice,
      buyoutPrice,
      shippingFeeText: decodeHtmlEntities(normalizeText(postageHtml)),
      bidCount: parseCountValue(normalizeText(bidHtml)) ?? 0,
      remainingTimeText: decodeHtmlEntities(normalizeText(timeHtml)),
      endTimeEpoch
    });
  }
  return items;
}

function hasNextYahooSearchPage(html) {
  const anchorPattern = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  for (const match of String(html || '').matchAll(anchorPattern)) {
    const text = decodeHtmlEntities(normalizeText(match[0]));
    const href = extractHtmlAttribute(match[0], 'href');
    if (text === '次へ' && /\/search\/search/i.test(href) && /[?&]b=\d+/i.test(href)) return true;
  }
  return false;
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
      images: Array.isArray(rawProduct.images) ? rawProduct.images : [],
      descriptionText: rawProduct.descriptionText || '',
      descriptionHtml: rawProduct.descriptionHtml || '',
      detailDisplayPrice: rawProduct.detailDisplayPrice || null,
      conditionName: rawProduct.conditionName || '',
      auctionStatus: rawProduct.auctionStatus || 'unknown',
      auctionStatusText: rawProduct.auctionStatusText || '状态未知',
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

  async function fetchSearchHtml(keyword, page = 1) {
    const searchUrl = buildYahooSearchUrl(keyword, page);
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

  async function searchProducts(keyword, page = 1) {
    const normalizedKeyword = String(keyword || '').trim();
    if (!normalizedKeyword) {
      const error = new Error('keyword is required');
      error.statusCode = 400;
      throw error;
    }
    const normalizedPage = Math.max(1, Math.floor(Number(page) || 1));
    const searchHtml = await fetchSearchHtml(normalizedKeyword, normalizedPage);
    const items = extractSearchProductCards(searchHtml);
    return {
      success: true,
      data: {
        keyword: normalizedKeyword,
        page: normalizedPage,
        pageSize: YAHOO_SEARCH_PAGE_SIZE,
        items,
        hasMore: hasNextYahooSearchPage(searchHtml),
        nextPage: normalizedPage + 1
      }
    };
  }

  return { cacheProduct, fetchProduct, fetchProductByKeyword, searchProducts };
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

router.get('/search', async (req, res) => {
  const keyword = String(req.query.keyword || '').trim();
  const page = Math.max(1, Math.min(200, Math.floor(Number(req.query.page) || 1)));
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });

  try {
    res.json(await productService.searchProducts(keyword, page));
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || '商品搜索失败' });
  }
});

module.exports = router;
module.exports.createProductService = createProductService;
module.exports.normalizeAuctionUrl = normalizeAuctionUrl;
module.exports.parseProductHtml = parseProductHtml;
module.exports.extractAuctionIdsFromSearchHtml = extractAuctionIdsFromSearchHtml;
module.exports.extractSearchProductCards = extractSearchProductCards;
module.exports.hasNextYahooSearchPage = hasNextYahooSearchPage;
module.exports.buildYahooSearchUrl = buildYahooSearchUrl;
module.exports.normalizeYahooShippingPrefCode = normalizeYahooShippingPrefCode;
module.exports.getYahooShippingPrefCode = getYahooShippingPrefCode;
module.exports.productService = productService;
