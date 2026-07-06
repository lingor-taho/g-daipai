const axios = require('axios');
const db = require('../models');

const BOC_RATE_URL = 'https://www.boc.cn/sourcedb/whpj/';
const WEBSITE_RATE_CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const DEFAULT_CLIENT_RATE_ADJUSTMENT = 0.002;

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

function normalizeRateAdjustment(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function calculateWebsiteRate(sourceRate, baseAdjustment = DEFAULT_CLIENT_RATE_ADJUSTMENT, userAdjustment = 0) {
  const value = Number(sourceRate || 0);
  if (!Number.isFinite(value) || value <= 0) throw new Error('valid source rate is required');
  return Number(((value / 100) + normalizeRateAdjustment(baseAdjustment) + normalizeRateAdjustment(userAdjustment)).toFixed(4));
}

function calculateRawWebsiteRate(sourceRate) {
  const value = Number(sourceRate || 0);
  if (!Number.isFinite(value) || value <= 0) throw new Error('valid source rate is required');
  return Number((value / 100).toFixed(4));
}

function isWebsiteRateCacheValid(cache = websiteRateCache, nowMs = Date.now()) {
  return Boolean(
    cache &&
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

async function getClientRateAdjustment(database = db) {
  const row = await database.getOne("SELECT value FROM config WHERE key = 'client_rate_adjustment'").catch(() => null);
  return normalizeRateAdjustment(row?.value, DEFAULT_CLIENT_RATE_ADJUSTMENT);
}

async function getUserClientRateAdjustment(userId, database = db) {
  if (!userId) return null;
  const row = await database.getOne(
    'SELECT rate_adjustment FROM user_client_rate_overrides WHERE user_id = ?',
    [userId]
  ).catch(() => null);
  return row ? normalizeRateAdjustment(row.rate_adjustment, 0) : null;
}

async function getWebsiteRate(options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  let sourceData = websiteRateCache;
  let cacheHit = true;
  if (!isWebsiteRateCacheValid(sourceData, nowMs)) {
    const html = options.html || await fetchBocRateHtml(options.httpClient || axios);
    const sourceRate = parseBocJpyCashSellRate(html);
    sourceData = {
      sourceRate,
      sourceName: 'BOC JPY cash sell rate',
      fetchedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + WEBSITE_RATE_CACHE_TTL_MS).toISOString(),
      expiresAtMs: nowMs + WEBSITE_RATE_CACHE_TTL_MS
    };
    websiteRateCache = sourceData;
    cacheHit = false;
  }

  const database = options.database || db;
  const baseAdjustment = options.baseAdjustment !== undefined
    ? normalizeRateAdjustment(options.baseAdjustment, DEFAULT_CLIENT_RATE_ADJUSTMENT)
    : await getClientRateAdjustment(database);
  const userAdjustment = options.userAdjustment !== undefined
    ? normalizeRateAdjustment(options.userAdjustment, 0)
    : await getUserClientRateAdjustment(options.userId, database);
  const rawRate = calculateRawWebsiteRate(sourceData.sourceRate);
  const baseRate = calculateWebsiteRate(sourceData.sourceRate, baseAdjustment, 0);
  const resolvedUserAdjustment = userAdjustment === null ? null : normalizeRateAdjustment(userAdjustment, 0);
  const rate = calculateWebsiteRate(sourceData.sourceRate, baseAdjustment, resolvedUserAdjustment || 0);

  return {
    ...sourceData,
    rawRate,
    baseAdjustment,
    baseRate,
    userAdjustment: resolvedUserAdjustment,
    rate,
    cacheHit,
    hasUserOverride: resolvedUserAdjustment !== null
  };
}

function clearWebsiteRateCache() {
  websiteRateCache = null;
}

module.exports = {
  BOC_RATE_URL,
  DEFAULT_CLIENT_RATE_ADJUSTMENT,
  WEBSITE_RATE_CACHE_TTL_MS,
  calculateRawWebsiteRate,
  calculateWebsiteRate,
  clearWebsiteRateCache,
  getClientRateAdjustment,
  getWebsiteRate,
  getUserClientRateAdjustment,
  isWebsiteRateCacheValid,
  normalizeRateAdjustment,
  parseBocJpyCashSellRate
};
