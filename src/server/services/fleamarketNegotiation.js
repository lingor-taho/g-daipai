const { randomUUID } = require('crypto');
const { DUPLICATE_NEGOTIATION } = require('../../shared/fleamarketNegotiation.cjs');

const QUEUE_PREFIX = 'fleamarket_negotiation_queue:';
const HISTORY_PREFIX = 'fleamarket_negotiation_history:';
const LEASE_MS = 60_000;

function fail(message, statusCode = 409) {
  throw Object.assign(new Error(message), { statusCode });
}

function normalizeId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!/^z\d{8,10}$/.test(id)) fail('P 商品 ID 无效', 400);
  return id;
}

function read(raw, key) {
  const row = raw.prepare('SELECT value FROM config WHERE key=?').get(key);
  return row ? JSON.parse(row.value) : null;
}

function write(raw, key, value) {
  raw.prepare('INSERT OR REPLACE INTO config (key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)')
    .run(key, JSON.stringify(value));
}

function removeExpired(raw, keyPattern, now) {
  // The SQL condition also protects a fresh reservation made by another process.
  raw.prepare(`DELETE FROM config WHERE key GLOB ? AND (
    json_extract(value,'$.state') NOT IN ('queued','claimed','sending') OR
    (json_extract(value,'$.state') IN ('claimed','sending') AND json_extract(value,'$.leaseUntil')<=?)
  )`).run(keyPattern, now);
}

function deleteHistoryThrough(raw, cutoffAt) {
  return raw.prepare(`DELETE FROM config WHERE key GLOB ?
    AND julianday(CASE WHEN json_valid(value) THEN json_extract(value,'$.submittedAt') END) <= julianday(?)`)
    .run(HISTORY_PREFIX + '*', cutoffAt).changes;
}

function getStatus(raw, productId, now = Date.now()) {
  const historyKey = HISTORY_PREFIX + productId;
  const queueKey = QUEUE_PREFIX + productId;
  const row = raw.prepare('SELECT key,value FROM config WHERE key IN (?,?) ORDER BY (key=?) DESC LIMIT 1')
    .get(historyKey, queueKey, historyKey);
  if (!row) return { state: 'available' };
  const job = JSON.parse(row.value);
  if (row.key === historyKey) return { state: 'submitted', ...job };
  if (job.state === 'queued' || (['claimed', 'sending'].includes(job.state) && job.leaseUntil > now)) {
    return { state: 'pending' };
  }
  removeExpired(raw, queueKey, now);
  return { state: 'available' };
}

function assertAvailable(raw, productId, now) {
  if (getStatus(raw, productId, now).state !== 'available') fail(DUPLICATE_NEGOTIATION);
}

function enqueue(raw, productId, price, now = Date.now()) {
  return raw.transaction(() => {
    assertAvailable(raw, productId, now);
    write(raw, QUEUE_PREFIX + productId, { state: 'queued', price, queuedAt: now });
    return { state: 'pending' };
  }).immediate();
}

function isEnabledPrimary(raw, accountId) {
  return Boolean(raw.prepare('SELECT 1 FROM yahoo_accounts WHERE id=? AND is_primary=1 AND enabled=1').get(accountId));
}

function claim(raw, context, now = Date.now()) {
  return raw.transaction(() => {
    if (!isEnabledPrimary(raw, context.accountId)) return null;
    removeExpired(raw, QUEUE_PREFIX + '*', now);
    const row = raw.prepare(`SELECT key,value FROM config WHERE key GLOB ?
      AND json_extract(value,'$.state')='queued'
      ORDER BY json_extract(value,'$.queuedAt'),key LIMIT 1`).get(QUEUE_PREFIX + '*');
    if (!row) return null;
    const job = JSON.parse(row.value);
    const claimToken = randomUUID();
    write(raw, row.key, {
      ...job, state: 'claimed', claimToken, leaseUntil: now + LEASE_MS,
      accountId: context.accountId, instanceId: context.instanceId
    });
    return { jobType: 'negotiate', productId: row.key.slice(QUEUE_PREFIX.length), price: job.price, claimToken };
  }).immediate();
}

function update(raw, context, { productId, claimToken, action }, now = Date.now()) {
  const id = normalizeId(productId);
  return raw.transaction(() => {
    const key = QUEUE_PREFIX + id;
    const job = read(raw, key);
    if (!job && action === 'success' && read(raw, HISTORY_PREFIX + id)) return { success: true };
    if (!job || !claimToken || job.claimToken !== claimToken || job.accountId !== context.accountId ||
        job.instanceId !== context.instanceId || job.leaseUntil <= now) fail('砍价领取已失效');

    if (action === 'begin' && job.state === 'claimed') {
      if (!isEnabledPrimary(raw, context.accountId)) fail('仅主 Yahoo 账号可以提交 P 商品砍价');
      write(raw, key, { ...job, state: 'sending', leaseUntil: now + LEASE_MS });
    } else if (action === 'success' && job.state === 'sending') {
      write(raw, HISTORY_PREFIX + id, { productId: id, submittedAt: new Date(now).toISOString(), price: job.price });
      raw.prepare('DELETE FROM config WHERE key=?').run(key);
    } else if (action === 'failed' && ['claimed', 'sending'].includes(job.state)) {
      raw.prepare('DELETE FROM config WHERE key=?').run(key);
    } else {
      fail('砍价状态已变化');
    }
    return { success: true };
  }).immediate();
}

module.exports = { normalizeId, getStatus, assertAvailable, enqueue, claim, update, deleteHistoryThrough, isEnabledPrimary };
