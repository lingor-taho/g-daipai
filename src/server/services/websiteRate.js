const axios = require('axios');

const BOC_RATE_URL = 'https://www.boc.cn/sourcedb/whpj/';
const WEBSITE_RATE_CACHE_TTL_MS = 3 * 60 * 60 * 1000;

let websiteRateCache = null;

function stripHtml(value) {
  return String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .trim();
}

function parseRateNumber(value) {
  const normalized = String(value || '').replace(/,/g, '').trim();
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function findBocJpyRow(html) {
  const text = String(html || '');
  const dataCurrencyRow = text.match(/<tr\b[^>]*data-currency=['"]\s*\u65e5\u5143\s*['"][^>]*>[\s\S]*?<\/tr>/i);
  if (dataCurrencyRow) return dataCurrencyRow[0];

  const rows = text.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  return rows.find(row => /<td[^>]*>\s*\u65e5\u5143\s*<\/td>/i.test(row)) || '';
}

function parseBocJpyCashSellRate(html) {
  const row = findBocJpyRow(html);
  if (!row) throw new Error('BOC JPY rate row not found');

  const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map(match => stripHtml(match[1]));
  const sourceRate = parseRateNumber(cells[3]);
  if (!sourceRate) throw new Error('BOC JPY cash sell rate not found');
  return sourceRate;
}

function calculateWebsiteRate(sourceRate) {
  const value = Number(sourceRate || 0);
  if (!Number.isFinite(value) || value <= 0) throw new Error('valid source rate is required');
  return Number(((value / 100) + 0.002).toFixed(4));
}

function isWebsiteRateCacheValid(cache = websiteRateCache, nowMs = Date.now()) {
  return Boolean(
    cache &&
    Number(cache.rate) > 0 &&
    Number(cache.sourceRate) > 0 &&
    Number(cache.expiresAtMs) > nowMs
  );
}

async function fetchBocRateHtml(httpClient = axios) {
  const response = await httpClient.get(BOC_RATE_URL, {
    responseType: 'arraybuffer',
    timeout: 10000
  });
  if (Buffer.isBuffer(response.data)) return response.data.toString('utf8');
  if (response.data instanceof ArrayBuffer) return Buffer.from(response.data).toString('utf8');
  return String(response.data || '');
}

async function getWebsiteRate(options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  if (isWebsiteRateCacheValid(websiteRateCache, nowMs)) {
    return { ...websiteRateCache, cacheHit: true };
  }

  const html = options.html || await fetchBocRateHtml(options.httpClient || axios);
  const sourceRate = parseBocJpyCashSellRate(html);
  const rate = calculateWebsiteRate(sourceRate);
  websiteRateCache = {
    rate,
    sourceRate,
    sourceName: 'BOC JPY cash sell rate',
    fetchedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + WEBSITE_RATE_CACHE_TTL_MS).toISOString(),
    expiresAtMs: nowMs + WEBSITE_RATE_CACHE_TTL_MS
  };
  return { ...websiteRateCache, cacheHit: false };
}

function clearWebsiteRateCache() {
  websiteRateCache = null;
}

module.exports = {
  BOC_RATE_URL,
  WEBSITE_RATE_CACHE_TTL_MS,
  calculateWebsiteRate,
  clearWebsiteRateCache,
  getWebsiteRate,
  isWebsiteRateCacheValid,
  parseBocJpyCashSellRate
};
