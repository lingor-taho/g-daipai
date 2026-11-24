const { randomUUID } = require('crypto');
const { normalizeId, getStatus, isEnabledPrimary } = require('./fleamarketNegotiation');

const PREFIX = 'fleamarket_price_check:';
const QUEUE_MS = 60_000;
const CLAIM_MS = 30_000;
const VALID_MS = 5 * 60_000;
const INVALID_PRICE_CHECK = '核验价格已失效，请重新核验后提交';

function fail(message, statusCode = 409) {
  throw Object.assign(new Error(message), { statusCode });
}

function read(raw, requestId) {
  if (!/^[a-f0-9-]{36}$/.test(String(requestId || ''))) return null;
  const row = raw.prepare('SELECT value FROM config WHERE key=?').get(PREFIX + requestId);
  return row ? JSON.parse(row.value) : null;
}

function write(raw, job) {
  raw.prepare('INSERT OR REPLACE INTO config (key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)')
    .run(PREFIX + job.requestId, JSON.stringify(job));
}

function prune(raw, now) {
  raw.prepare("DELETE FROM config WHERE key GLOB ? AND json_extract(value,'$.expiresAt')<=?")
    .run(PREFIX + '*', now);
}

function enqueue(raw, userId, productId, now = Date.now()) {
  const id = normalizeId(productId);
  return raw.transaction(() => {
    if (getStatus(raw, id, now).state !== 'submitted') fail('该商品没有砍价记录');
    prune(raw, now);
    const pending = raw.prepare(`SELECT value FROM config WHERE key GLOB ?
      AND json_extract(value,'$.userId')=? AND json_extract(value,'$.productId')=?
      AND json_extract(value,'$.state') IN ('queued','claimed') LIMIT 1`).get(PREFIX + '*', Number(userId), id);
    if (pending) return { requestId: JSON.parse(pending.value).requestId, state: 'pending' };
    const requestId = randomUUID();
    write(raw, { requestId, productId: id, userId: Number(userId), state: 'queued', queuedAt: now, expiresAt: now + QUEUE_MS });
    return { requestId, state: 'pending' };
  }).immediate();
}

function claim(raw, context, now = Date.now()) {
  return raw.transaction(() => {
    if (!isEnabledPrimary(raw, context.accountId)) return null;
    prune(raw, now);
    const row = raw.prepare(`SELECT value FROM config WHERE key GLOB ? AND json_extract(value,'$.state')='queued'
      ORDER BY json_extract(value,'$.queuedAt'),key LIMIT 1`).get(PREFIX + '*');
    if (!row) return null;
    const job = JSON.parse(row.value);
    const claimToken = randomUUID();
    write(raw, { ...job, state: 'claimed', claimToken, accountId: context.accountId, instanceId: context.instanceId, expiresAt: now + CLAIM_MS });
    return { jobType: 'price-check', productId: job.productId, requestId: job.requestId, claimToken };
  }).immediate();
}

function update(raw, context, { requestId, productId, claimToken, price }, now = Date.now()) {
  return raw.transaction(() => {
    const job = read(raw, requestId);
    if (!job || job.state !== 'claimed' || job.expiresAt <= now || job.productId !== productId ||
        !claimToken || job.claimToken !== claimToken || job.accountId !== context.accountId ||
        job.instanceId !== context.instanceId || !isEnabledPrimary(raw, context.accountId)) fail('价格核验领取已失效');
    const checked = Number.isSafeInteger(price) && price > 0;
    write(raw, { requestId, productId: job.productId, userId: job.userId, accountId: job.accountId,
      state: checked ? 'verified' : 'failed', ...(checked ? { price } : {}), expiresAt: now + VALID_MS });
    return { success: true };
  }).immediate();
}

function status(raw, userId, productId, requestId, now = Date.now()) {
  const job = read(raw, requestId);
  if (!job || job.productId !== normalizeId(productId) || job.userId !== Number(userId) || job.expiresAt <= now) {
    fail('价格核验已超时或失效，请重新核验');
  }
  if (job.state === 'verified') {
    if (!isEnabledPrimary(raw, job.accountId)) fail(INVALID_PRICE_CHECK);
    return { state: 'verified', requestId, price: job.price, expiresAt: job.expiresAt };
  }
  return { state: job.state === 'failed' ? 'failed' : 'pending' };
}

function verifiedPrice(raw, userId, productId, requestId, now = Date.now()) {
  const job = raw && read(raw, requestId);
  if (!job || job.state !== 'verified' || job.expiresAt <= now ||
      job.userId !== Number(userId) || job.productId !== productId || !isEnabledPrimary(raw, job.accountId)) fail(INVALID_PRICE_CHECK);
  return job.price;
}

module.exports = { enqueue, claim, update, status, verifiedPrice };
