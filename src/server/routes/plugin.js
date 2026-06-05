const express = require('express');
const router = express.Router();
const db = require('../models');
const { isYahooLoginError } = require('../services/yahooLoginStatus');
const {
  getOrderStatusAuditRows,
  writeOrderStatusAuditLogs
} = require('../services/orderStatusAudit');

const DEFAULT_MULTI_BID_START_HOURS = 0.5;
const DEFAULT_MULTI_BID_INTERVAL_MINUTES = 5;
const DEFAULT_IDLE_SYNC_INTERVAL_MINUTES = 5;
const DEFAULT_IDLE_BID_GUARD_MINUTES = 10;
const DEFAULT_MULTI_BID_MIN_PRICE = 5000;
const DEFAULT_TRANSACTION_START_HOUR = 1;
const DEFAULT_SCAN_START_HOUR = 1;
const DEFAULT_SCAN_END_HOUR = 20;
const DEFAULT_SCAN_EVERY_IDLE_RUNS = 5;
const DEFAULT_PAYMENT_JOB_LIMIT = 3;
const DEFAULT_PAYMENT_PAGE_STAY_SECONDS = 3;
const ORDER_STATUS_PENDING_PAYMENT = 'pending_payment';
const ORDER_STATUS_WAITING_SHIPPING = 'waiting_shipping';
const ORDER_STATUS_PENDING_BUNDLE = 'pending_bundle';
const ORDER_STATUS_BUNDLE_COMPLETED = 'bundle_completed';
const ORDER_STATUS_PENDING_SETTLEMENT = 'pending_settlement';
const ORDER_STATUS_PENDING_SHIPMENT = 'pending_shipment';

function parseTimeMs(value) {
  let input = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(input)) {
    input = input.replace(' ', 'T') + 'Z';
  }
  const time = Date.parse(input);
  return Number.isFinite(time) ? time : null;
}

function getStrategyLeadMs(task) {
  if (isMultiBidTask(task)) return getMultiBidStartMs(task);
  if (!task?.strategy || task.strategy === 'direct') return 0;
  const minutesFromColumn = Number(task.start_minutes_before || 0);
  const secondsFromColumn = Number(task.start_seconds_before || 0);
  if (minutesFromColumn || secondsFromColumn) {
    return minutesFromColumn * 60 * 1000 + secondsFromColumn * 1000;
  }
  const match = String(task.strategy).match(/^(\d+)min$/);
  return match ? Number(match[1]) * 60 * 1000 : 0;
}

function isMultiBidTask(task) {
  return task?.strategy === 'multi_bid';
}

function getMultiBidStartMs(config = {}) {
  const hours = Number(config.multiBidStartHours ?? config.multi_bid_start_hours ?? DEFAULT_MULTI_BID_START_HOURS);
  return Math.max(hours > 0 ? hours : DEFAULT_MULTI_BID_START_HOURS, 0.01) * 60 * 60 * 1000;
}

function getMultiBidIntervalMs(config = {}) {
  const minutes = Number(config.multiBidIntervalMinutes ?? config.multi_bid_interval_minutes ?? DEFAULT_MULTI_BID_INTERVAL_MINUTES);
  return Math.max(minutes > 0 ? minutes : DEFAULT_MULTI_BID_INTERVAL_MINUTES, 1) * 60 * 1000;
}

function getIdleBidGuardMs(config = {}) {
  const minutes = Number(config.idleBidGuardMinutes ?? config.idle_bid_guard_minutes ?? DEFAULT_IDLE_BID_GUARD_MINUTES);
  return Math.max(minutes > 0 ? minutes : DEFAULT_IDLE_BID_GUARD_MINUTES, 1) * 60 * 1000;
}

function isMultiBidIntervalReady(task, nowMs, config = {}) {
  if (!isMultiBidTask(task)) return true;
  const referenceTime = task.last_bid_at || (task.status === 'bidding' ? task.updated_at || task.created_at : null);
  const lastBidMs = parseTimeMs(referenceTime);
  if (!lastBidMs) return true;
  return nowMs - lastBidMs >= getMultiBidIntervalMs(config);
}

function isDirectTask(task) {
  return !isMultiBidTask(task) && (!task?.strategy || task.strategy === 'direct' || getStrategyLeadMs(task) <= 0);
}

function isTaskNeedingEndTimeRefresh(task) {
  return !isDirectTask(task) && !parseTimeMs(task?.end_time);
}

function isTaskReadyForDispatch(task, nowMs = Date.now(), config = {}) {
  const endMs = parseTimeMs(task.end_time);
  if (endMs && endMs <= nowMs) return false;
  if (isMultiBidTask(task) && !isMultiBidIntervalReady(task, nowMs, config)) {
    return false;
  }
  if (isDirectTask(task)) return true;
  if (!endMs) return true;
  if (endMs - nowMs > getStrategyLeadMs({ ...task, ...config })) return false;
  return isMultiBidIntervalReady(task, nowMs, config);
}

function getDispatchPriority(task) {
  if (isDirectTask(task)) return 0;
  if (isTaskNeedingEndTimeRefresh(task)) return 2;
  return 1;
}

function chooseNextPluginTask(tasks, nowMs = Date.now(), config = {}) {
  const readyTasks = tasks.filter(task => isTaskReadyForDispatch(task, nowMs, config));
  readyTasks.sort((a, b) => {
    const aPriority = getDispatchPriority(a);
    const bPriority = getDispatchPriority(b);
    if (aPriority !== bPriority) return aPriority - bPriority;
    const aEnd = parseTimeMs(a.end_time) || Number.MAX_SAFE_INTEGER;
    const bEnd = parseTimeMs(b.end_time) || Number.MAX_SAFE_INTEGER;
    if (aEnd !== bEnd) return aEnd - bEnd;
    return new Date(a.created_at || 0) - new Date(b.created_at || 0);
  });
  return readyTasks[0] || null;
}

function getNextTaskDispatchMs(task, nowMs = Date.now(), config = {}) {
  if (!task) return null;
  const endMs = parseTimeMs(task.end_time);
  if (endMs && endMs <= nowMs) return null;
  if (isDirectTask(task) || isTaskNeedingEndTimeRefresh(task)) return nowMs;

  const leadStartMs = endMs ? endMs - getStrategyLeadMs({ ...task, ...config }) : nowMs;
  if (isMultiBidTask(task)) {
    const referenceTime = task.last_bid_at || (task.status === 'bidding' ? task.updated_at || task.created_at : null);
    const lastBidMs = parseTimeMs(referenceTime);
    const intervalReadyMs = lastBidMs ? lastBidMs + getMultiBidIntervalMs(config) : nowMs;
    return Math.max(nowMs, leadStartMs, intervalReadyMs);
  }
  return Math.max(nowMs, leadStartMs);
}

function hasTaskWithinIdleGuard(tasks, nowMs = Date.now(), config = {}) {
  const guardUntilMs = nowMs + getIdleBidGuardMs(config);
  return tasks.some(task => {
    const nextMs = getNextTaskDispatchMs(task, nowMs, config);
    return Number.isFinite(nextMs) && nextMs <= guardUntilMs;
  });
}

async function expireOverduePendingTasks(database = db, nowMs = Date.now()) {
  const nowIso = new Date(nowMs).toISOString();
  const result = await database.query(
    `UPDATE tasks
     SET status = 'failed',
         is_highest_bidder = 0,
         error_msg = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE status = 'pending'
       AND end_time IS NOT NULL
       AND datetime(end_time) <= datetime(?)`,
    ['Auction ended before plugin execution', nowIso]
  );
  return result.rowCount || 0;
}

async function failPricedOutPendingTasks(database = db) {
  // current_price 和 max_price 都是税前口径，user_max_price 是税后口径。
  // 这里要做"当前价已超过你愿意出的税前金额"的判断，应该用 max_price（税前）作比较基准。
  const result = await database.query(
    `UPDATE tasks
     SET status = 'failed',
         is_highest_bidder = 0,
         error_msg = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE (
         status = 'pending'
         OR (status = 'bidding' AND strategy = 'multi_bid')
       )
       AND current_price IS NOT NULL
       AND max_price IS NOT NULL
       AND current_price > 0
       AND max_price > 0
       AND current_price > max_price`,
    ['Current price is above max price before execution']
  );
  return result.rowCount || 0;
}

async function resetStaleProcessingTasks(database = db, nowMs = Date.now()) {
  const cutoffIso = new Date(nowMs - 60 * 1000).toISOString();
  const result = await database.query(
    `UPDATE tasks
     SET status = 'pending',
         error_msg = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE status = 'processing'
       AND datetime(updated_at) <= datetime(?)`,
    [cutoffIso]
  );
  return result.rowCount || 0;
}

async function sweepPendingTasks(database = db, nowMs = Date.now()) {
  const overdue = await expireOverduePendingTasks(database, nowMs);
  const pricedOut = await failPricedOutPendingTasks(database);
  const processingReset = await resetStaleProcessingTasks(database, nowMs);
  return { overdue, pricedOut, processingReset, total: overdue + pricedOut + processingReset };
}

async function getMultiBidConfig(database = db) {
  const rows = await database.getAll(
    "SELECT key, value FROM config WHERE key IN ('multi_bid_start_hours', 'multi_bid_interval_minutes', 'idle_sync_interval_minutes', 'idle_bid_guard_minutes', 'multi_bid_min_price', 'transaction_start_hour', 'scan_start_hour', 'scan_end_hour', 'scan_every_idle_runs')"
  );
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  return {
    multiBidStartHours: Number(values.multi_bid_start_hours || DEFAULT_MULTI_BID_START_HOURS),
    multiBidIntervalMinutes: Number(values.multi_bid_interval_minutes || DEFAULT_MULTI_BID_INTERVAL_MINUTES),
    idleSyncIntervalMinutes: Number(values.idle_sync_interval_minutes || DEFAULT_IDLE_SYNC_INTERVAL_MINUTES),
    idleBidGuardMinutes: Number(values.idle_bid_guard_minutes || DEFAULT_IDLE_BID_GUARD_MINUTES),
    multiBidMinPrice: Number(values.multi_bid_min_price || DEFAULT_MULTI_BID_MIN_PRICE),
    transactionStartHour: Number(values.transaction_start_hour ?? DEFAULT_TRANSACTION_START_HOUR),
    scanStartHour: Number(values.scan_start_hour ?? DEFAULT_SCAN_START_HOUR),
    scanEndHour: Number(values.scan_end_hour ?? DEFAULT_SCAN_END_HOUR),
    scanEveryIdleRuns: Number(values.scan_every_idle_runs ?? DEFAULT_SCAN_EVERY_IDLE_RUNS)
  };
}

function withMultiBidDispatchConfig(task, config) {
  if (!task || !isMultiBidTask(task)) return task;
  return {
    ...task,
    multi_bid_start_hours: config.multiBidStartHours,
    multi_bid_interval_minutes: config.multiBidIntervalMinutes,
    start_minutes_before: Math.round(config.multiBidStartHours * 60),
    start_seconds_before: 0
  };
}

async function setYahooLoginStatus(status, message = '') {
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at)
     VALUES ('yahoo_login_status', ?, CURRENT_TIMESTAMP)`,
    [status]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at)
     VALUES ('yahoo_login_message', ?, CURRENT_TIMESTAMP)`,
    [message || '']
  );
}

function getLocalDateKey(nowMs = Date.now()) {
  const date = new Date(nowMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function clampHour(value, fallback) {
  const hour = Number(value);
  if (!Number.isFinite(hour)) return fallback;
  return Math.min(23, Math.max(0, Math.floor(hour)));
}

function getNextIdleAction(config = {}, nowMs = Date.now()) {
  const now = new Date(nowMs);
  const nowHour = config.nowHour ?? now.getHours();
  const today = config.today || getLocalDateKey(nowMs);
  const transactionStartHour = clampHour(config.transactionStartHour, DEFAULT_TRANSACTION_START_HOUR);
  const transactionRequested = Number(config.transactionStartRequested || 0) === 1;
  const lastRunDate = String(config.transactionStartLastRunDate || '');
  if (transactionRequested || (Number(nowHour) >= transactionStartHour && lastRunDate !== today)) {
    return { action: 'transaction_start', today };
  }

  const scanStartHour = clampHour(config.scanStartHour, DEFAULT_SCAN_START_HOUR);
  const scanEndHour = clampHour(config.scanEndHour, DEFAULT_SCAN_END_HOUR);
  const scanEvery = Math.max(1, Math.floor(Number(config.scanEveryIdleRuns || DEFAULT_SCAN_EVERY_IDLE_RUNS)));
  const scanCounter = Math.max(0, Math.floor(Number(config.scanIdleCounter || 0)));
  const inScanWindow = scanStartHour <= scanEndHour
    ? Number(nowHour) >= scanStartHour && Number(nowHour) <= scanEndHour
    : Number(nowHour) >= scanStartHour || Number(nowHour) <= scanEndHour;
  if (inScanWindow && scanCounter >= scanEvery) {
    return { action: 'scan', today };
  }
  if (Number(config.paymentRequested || 0) === 1) {
    return { action: 'payment', today };
  }
  return { action: 'none', today };
}

function getNextScanIdleCounter(action, config = {}) {
  const scanEvery = Math.max(1, Math.floor(Number(config.scanEveryIdleRuns || DEFAULT_SCAN_EVERY_IDLE_RUNS)));
  const scanCounter = Math.max(0, Math.floor(Number(config.scanIdleCounter || 0)));
  if (action === 'scan') return 0;
  if (scanCounter >= scanEvery) return 0;
  return scanCounter + 1;
}

async function getIdleActionConfig(database = db, nowMs = Date.now()) {
  const rows = await database.getAll(
    `SELECT key, value FROM config
     WHERE key IN (
       'transaction_start_hour',
       'transaction_start_requested',
       'transaction_start_last_run_date',
       'scan_start_hour',
       'scan_end_hour',
       'scan_every_idle_runs',
       'scan_idle_counter',
       'payment_requested',
       'payment_job_limit',
       'payment_page_stay_seconds'
     )`
  );
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  return {
    transactionStartHour: Number(values.transaction_start_hour ?? DEFAULT_TRANSACTION_START_HOUR),
    transactionStartRequested: Number(values.transaction_start_requested || 0),
    transactionStartLastRunDate: values.transaction_start_last_run_date || '',
    scanStartHour: Number(values.scan_start_hour ?? DEFAULT_SCAN_START_HOUR),
    scanEndHour: Number(values.scan_end_hour ?? DEFAULT_SCAN_END_HOUR),
    scanEveryIdleRuns: Number(values.scan_every_idle_runs ?? DEFAULT_SCAN_EVERY_IDLE_RUNS),
    scanIdleCounter: Number(values.scan_idle_counter || 0),
    paymentRequested: Number(values.payment_requested || 0),
    paymentJobLimit: parsePositiveInt(values.payment_job_limit, DEFAULT_PAYMENT_JOB_LIMIT),
    paymentPageStaySeconds: parsePositiveInt(values.payment_page_stay_seconds, DEFAULT_PAYMENT_PAGE_STAY_SECONDS),
    today: getLocalDateKey(nowMs),
    nowHour: new Date(nowMs).getHours()
  };
}

async function saveConfigValue(database, key, value) {
  await database.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
    [key, String(value)]
  );
}

function normalizeTransactionStartLogJob(job = {}) {
  return {
    orderId: job.orderId ?? job.order_id ?? null,
    productId: job.productId ?? job.product_id ?? '',
    productType: job.productType ?? job.product_type ?? '',
    shippingFeeText: job.shippingFeeText ?? job.shipping_fee_text ?? '',
    status: job.status || 'queued'
  };
}

async function saveTransactionStartRunLog(database, payload = {}) {
  const log = {
    createdAt: new Date().toISOString(),
    source: payload.source || (payload.includeAfterCutoff ? 'manual' : 'auto'),
    includeAfterCutoff: !!payload.includeAfterCutoff,
    total: Number(payload.total || 0),
    storeUpdated: Number(payload.storeUpdated || 0),
    missingTransactionUrl: Number(payload.missingTransactionUrl || 0),
    jobs: Array.isArray(payload.jobs) ? payload.jobs.map(normalizeTransactionStartLogJob) : [],
    results: Array.isArray(payload.results) ? payload.results : []
  };
  await saveConfigValue(database, 'transaction_start_last_run_log', JSON.stringify(log));
  return log;
}

async function appendTransactionStartRunLogResult(database, result = {}) {
  if (!database || typeof database.getOne !== 'function') return null;
  const row = await database.getOne("SELECT value FROM config WHERE key = 'transaction_start_last_run_log'");
  let log = null;
  try {
    log = row?.value ? JSON.parse(row.value) : null;
  } catch {
    log = null;
  }
  if (!log || typeof log !== 'object') return null;
  const nextResult = {
    at: new Date().toISOString(),
    orderIds: Array.isArray(result.orderIds) ? result.orderIds : [],
    productIds: Array.isArray(result.productIds) ? result.productIds : [],
    status: result.status || null,
    error: result.error || null,
    updated: Number(result.updated || 0)
  };
  log.results = Array.isArray(log.results) ? log.results : [];
  log.results.push(nextResult);
  log.results = log.results.slice(-100);
  await saveConfigValue(database, 'transaction_start_last_run_log', JSON.stringify(log));
  return log;
}

// GET /api/plugin/task
router.get('/task', async (req, res) => {
  const multiBidConfig = await getMultiBidConfig();
  const tasks = await db.getAll(
    "SELECT * FROM tasks WHERE status = 'pending' OR (status = 'bidding' AND strategy = 'multi_bid') ORDER BY created_at ASC LIMIT 100"
  );
  const nowMs = Date.now();
  const task = chooseNextPluginTask(tasks, nowMs, multiBidConfig);
  const canIdleSync = !task && !hasTaskWithinIdleGuard(tasks, nowMs, multiBidConfig);
  res.json({
    task: withMultiBidDispatchConfig(task, multiBidConfig) || null,
    canIdleSync,
    idleBidGuardMinutes: multiBidConfig.idleBidGuardMinutes
  });
});

router.get('/idle-action/next', async (req, res) => {
  const config = await getIdleActionConfig();
  res.json({ success: true, ...getNextIdleAction(config), config });
});

router.post('/idle-action/complete', async (req, res) => {
  const action = String(req.body?.action || 'none');
  const config = await getIdleActionConfig();
  if (action === 'transaction_start') {
    await saveConfigValue(db, 'transaction_start_requested', '0');
    await saveConfigValue(db, 'transaction_start_last_run_date', config.today);
  } else if (action === 'scan') {
    await saveConfigValue(db, 'scan_idle_counter', '0');
  } else {
    await saveConfigValue(db, 'scan_idle_counter', getNextScanIdleCounter(action, config));
  }
  res.json({ success: true });
});

// PATCH /api/plugin/task/:id/status
router.patch('/task/:id/status', async (req, res) => {
  const { status, error_msg, bid_price, no_bid, not_highest } = req.body;
  if (isYahooLoginError(error_msg)) {
    await setYahooLoginStatus('failed', error_msg);
  } else if (status === 'bidding') {
    await setYahooLoginStatus('ok');
  }

  if (status === 'bidding') {
    const result = await db.query(
      `UPDATE tasks
       SET status = ?,
           error_msg = ?,
           bid_count = CASE WHEN ? THEN COALESCE(bid_count, 0) ELSE COALESCE(bid_count, 0) + 1 END,
           last_bid_at = CURRENT_TIMESTAMP,
           is_highest_bidder = CASE WHEN ? THEN 0 ELSE 1 END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status != 'cancelled'`,
      [status, error_msg || null, no_bid ? 1 : 0, not_highest ? 1 : 0, req.params.id]
    );
    if (result.rowCount > 0 && bid_price) {
      await db.query(
        'INSERT INTO bid_logs (task_id, bid_price, result) VALUES (?, ?, ?)',
        [req.params.id, normalizeYenAmount(bid_price), 'bidding']
      );
    }
    return res.json({ success: result.rowCount > 0 });
  } else {
    const result = await db.query(
      `UPDATE tasks
       SET status = ?,
           error_msg = ?,
           is_highest_bidder = CASE WHEN ? = 'failed' THEN 0 ELSE is_highest_bidder END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status != 'cancelled'`,
      [status, error_msg || null, status, req.params.id]
    );
    return res.json({ success: result.rowCount > 0 });
  }
});

router.patch('/task/:id/touch', async (req, res) => {
  const allowedStatus = ['pending', 'bidding', 'success'].includes(req.body?.status) ? req.body.status : null;
  await db.query(
    `UPDATE tasks
     SET status = COALESCE(?, status),
         last_bid_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND status != 'cancelled'`,
    [allowedStatus, req.params.id]
  );
  res.json({ success: true });
});

function normalizeYenAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(String(value).replace(/[^\d]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function resolveOrderFinalPrice(task, parsedFinalPrice) {
  return normalizeYenAmount(parsedFinalPrice);
}

function normalizeYahooWonTimeText(value, nowMs = Date.now()) {
  const match = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const now = new Date(nowMs);
  let year = now.getFullYear();
  let date = new Date(year, Number(match[1]) - 1, Number(match[2]), Number(match[3]), Number(match[4]), 0);
  if (date.getTime() - nowMs > 24 * 60 * 60 * 1000) {
    date = new Date(year - 1, Number(match[1]) - 1, Number(match[2]), Number(match[3]), Number(match[4]), 0);
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function upsertOrderFromTask(taskId, options = {}) {
  const task = await db.getOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) return;
  const existing = await db.getOne('SELECT id FROM orders WHERE task_id = ?', [taskId]);
  const finalPrice = resolveOrderFinalPrice(task, options.finalPrice);
  const wonTimeText = String(options.wonTimeText || '').trim() || null;
  const wonAt = normalizeYahooWonTimeText(wonTimeText);
  const transactionUrl = String(options.transactionUrl || '').trim() || null;
  if (existing) {
    await db.query(
      `UPDATE orders
       SET product_title = ?, product_url = ?, final_price = ?,
           won_at = COALESCE(?, won_at),
           won_time_text = COALESCE(?, won_time_text),
           transaction_url = COALESCE(?, transaction_url),
           updated_at = CURRENT_TIMESTAMP
       WHERE task_id = ?`,
      [task.product_title || task.product_id, task.product_url, finalPrice, wonAt, wonTimeText, transactionUrl, taskId]
    );
  } else {
    await db.query(
      `INSERT INTO orders (task_id, product_title, product_url, final_price, won_at, won_time_text, transaction_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [taskId, task.product_title || task.product_id, task.product_url, finalPrice, wonAt, wonTimeText, transactionUrl]
    );
  }
}

function normalizeBiddingStatus(value) {
  return value === 'highest' || value === 'outbid' ? value : null;
}

const YAHOO_LOW_PRICE_THRESHOLD = 1000;
const YAHOO_LOW_PRICE_BID_LIMIT = 10000;
const YAHOO_LOW_PRICE_INITIAL_BID = 9000;
// followup 触发阈值高于 Yahoo 规则边界（1000），留 20% 缓冲，绕开税前/税后差异。
const YAHOO_LOW_PRICE_FOLLOWUP_THRESHOLD = 1200;

// 把含税值折回税前（Yahoo 内部口径）。普通商品税前=原值。
function toTaxExcludedYen(value, taxType) {
  const v = Number(value || 0);
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (taxType !== 'tax_included' || v < 10) return Math.floor(v);
  return Math.floor(((v / 1.1) + 1e-6) / 10) * 10;
}

/**
 * Yahoo 出价规则：商品税前价不足 1000 时，单次税前出价不能超过 10000。
 * 口径：
 * - submitMaxPrice 是税后值（user_max_price 口径），需折回税前再比较 10000
 * - currentPrice 来自 proxy 抓的 HTML price 字段，本身就是税前，直接比较 1000
 * 仅对 direct + bid 模式生效；buyout 不受影响。
 */
function shouldSplitDirectBidByYahooLowPriceRule({ strategy, bidMode, currentPrice, submitMaxPrice, taxType }) {
  if (strategy !== 'direct') return false;
  if (bidMode !== 'bid') return false;
  const submitTaxExcluded = toTaxExcludedYen(submitMaxPrice, taxType);
  if (submitTaxExcluded <= YAHOO_LOW_PRICE_BID_LIMIT) return false;
  const currentTaxExcluded = Number(currentPrice || 0);
  // 当前价未知（0）时按"低于 1000"处理，给出提示更安全。
  if (!Number.isFinite(currentTaxExcluded) || currentTaxExcluded <= 0) return true;
  return currentTaxExcluded < YAHOO_LOW_PRICE_THRESHOLD;
}

function isFollowupTaskReady(task, nowMs = Date.now()) {
  if (!task) return false;
  if (!Number(task.pending_followup_max_price || 0)) return false;
  // current_price 是税前价。followup 阈值 1200 留 20% 缓冲，> Yahoo 规则边界 1000。
  const current = Number(task.current_price || 0);
  if (!Number.isFinite(current) || current < YAHOO_LOW_PRICE_FOLLOWUP_THRESHOLD) return false;
  if (!['pending', 'processing', 'bidding'].includes(task.status)) return false;
  const endMs = parseTimeMs(task.end_time);
  if (endMs && endMs <= nowMs) return false;
  return true;
}

async function processPendingFollowupTasks(database = db, nowMs = Date.now()) {
  const candidates = await database.getAll(
    `SELECT id, user_id, product_id, product_url, product_title, product_image_url,
            current_price, buyout_price, tax_type, shipping_fee_text,
            pending_followup_max_price, status, end_time
     FROM tasks
     WHERE pending_followup_max_price IS NOT NULL
       AND status IN ('pending', 'processing', 'bidding')`
  );
  let created = 0;
  for (const task of candidates) {
    if (!isFollowupTaskReady(task, nowMs)) continue;
    const followupUserMaxPrice = Math.floor(Number(task.pending_followup_max_price));
    // followup 任务的口径与原任务保持一致：
    // - user_max_price 是用户视角（含税商品=含税值）
    // - max_price 是 Yahoo 表单接收的除税值
    const followupBidMaxPrice = task.tax_type === 'tax_included' && followupUserMaxPrice >= 10
      ? Math.floor(((followupUserMaxPrice / 1.1) + 1e-6) / 10) * 10
      : followupUserMaxPrice;
    const clientRequestId = `followup-${task.id}`;
    // 原子地清空标记，避免被并发触发多次
    const cleared = await database.query(
      `UPDATE tasks
       SET pending_followup_max_price = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND pending_followup_max_price IS NOT NULL`,
      [task.id]
    );
    if (!cleared.rowCount) continue;
    const existing = await database.getOne(
      'SELECT id FROM tasks WHERE user_id = ? AND client_request_id = ? LIMIT 1',
      [task.user_id, clientRequestId]
    );
    if (existing) continue;
    await database.query(
      `INSERT INTO tasks (
         user_id, product_id, product_url, product_title, product_image_url,
         current_price, buyout_price, tax_type, shipping_fee_text,
         max_price, user_max_price, strategy, bid_mode,
         status, end_time, client_request_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'direct', 'bid', 'pending', ?, ?)`,
      [
        task.user_id,
        task.product_id,
        task.product_url,
        task.product_title,
        task.product_image_url,
        task.current_price,
        task.buyout_price,
        task.tax_type || 'tax_zero',
        task.shipping_fee_text,
        followupBidMaxPrice,
        followupUserMaxPrice,
        task.end_time,
        clientRequestId
      ]
    );
    created += 1;
  }
  return created;
}

async function syncBiddingItems(items, database = db) {
  const biddingItems = Array.isArray(items) ? items : [];
  let highest = 0;
  let outbid = 0;

  await database.query(
    `UPDATE bidding_items
     SET status = 'stale',
         updated_at = CURRENT_TIMESTAMP`
  );

  for (const item of biddingItems) {
    const match = String(item.url || item.productId || '').match(/[a-zA-Z]?\d{8,10}/);
    if (!match) continue;
    const productId = match[0].toLowerCase();
    const itemStatus = normalizeBiddingStatus(item.status);
    if (!itemStatus) continue;
    const rawPrice = normalizeYenAmount(item.price);
    // /my/bidding 列表页"現在 ××円"对商城商品是税后值，对普通商品是税前。
    // 数据库 current_price 统一存税前口径，写入前按 task 的 tax_type 折回税前。
    const taskTaxRow = await database.getOne(
      "SELECT tax_type FROM tasks WHERE product_id = ? ORDER BY id DESC LIMIT 1",
      [productId]
    );
    const taxType = taskTaxRow?.tax_type === 'tax_included' ? 'tax_included' : 'tax_zero';
    const currentPrice = rawPrice && taxType === 'tax_included' && rawPrice >= 10
      ? Math.floor(((rawPrice / 1.1) + 1e-6) / 10) * 10
      : rawPrice;

    await database.query(
      `INSERT INTO bidding_items (
         product_id,
         product_url,
         product_title,
         product_image_url,
         current_price,
         status,
         synced_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(product_id) DO UPDATE SET
         product_url = excluded.product_url,
         product_image_url = excluded.product_image_url,
         current_price = excluded.current_price,
         status = excluded.status,
         synced_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
      [
        productId,
        item.url || `https://auctions.yahoo.co.jp/jp/auction/${productId}`,
        item.title || null,
        item.imageUrl || null,
        currentPrice,
        itemStatus
      ]
    );

    if (itemStatus === 'highest') {
      const result = await database.query(
        `UPDATE tasks
         SET status = 'bidding',
             is_highest_bidder = 1,
             product_image_url = COALESCE(?, product_image_url),
             current_price = COALESCE(?, current_price),
             error_msg = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE product_id = ?
           AND status IN ('bidding', 'success')`,
        [
          item.imageUrl || null,
          currentPrice,
          productId
        ]
      );
      highest += 1;
    } else {
      await database.query(
        `UPDATE tasks
         SET is_highest_bidder = 0,
             current_price = COALESCE(?, current_price),
             updated_at = CURRENT_TIMESTAMP
         WHERE product_id = ?
           AND status = 'bidding'`,
        [currentPrice, productId]
      );
      outbid += 1;
    }
  }

  const followupCreated = await processPendingFollowupTasks(database);
  return { highest, outbid, total: highest + outbid, followup: followupCreated };
}

async function getTransactionStartJobs(database = db, options = {}) {
  const includeAfterCutoff = options.includeAfterCutoff ? 1 : 0;
  const cutoffHour = clampHour(options.transactionStartHour, DEFAULT_TRANSACTION_START_HOUR);
  const cutoffModifier = `+${cutoffHour} hours`;
  const rows = await database.getAll(
    `SELECT o.id AS order_id,
            o.transaction_url,
            t.product_id,
            t.product_url,
            t.product_title,
            t.product_type,
            t.shipping_fee_text
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     WHERE t.status = 'success'
       AND (o.order_status IS NULL OR o.order_status = '')
       AND (? = 1 OR datetime(COALESCE(o.won_at, o.created_at)) < datetime('now', 'start of day', ?))
     ORDER BY datetime(COALESCE(o.won_at, o.created_at)) ASC, o.id ASC`
    ,
    [includeAfterCutoff, cutoffModifier]
  );

  const jobs = [];
  const logJobs = [];
  let storeUpdated = 0;
  let missingTransactionUrl = 0;
  for (const row of rows) {
    if (row.product_type === 'store') {
      const beforeRows = await getOrderStatusAuditRows(database, [row.order_id]);
      const result = await database.query(
        `UPDATE orders
         SET order_status = ?,
             transaction_started_at = CURRENT_TIMESTAMP,
             transaction_start_error = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND (order_status IS NULL OR order_status = '')`,
        [ORDER_STATUS_PENDING_PAYMENT, row.order_id]
      );
      storeUpdated += result.rowCount || 0;
      if (result.rowCount) {
        await writeOrderStatusAuditLogs(database, beforeRows, {
          status: ORDER_STATUS_PENDING_PAYMENT,
          source: 'transaction_start_jobs_store',
          metadata: {
            productId: row.product_id,
            productType: row.product_type,
            shippingFeeText: row.shipping_fee_text || '',
            includeAfterCutoff: !!includeAfterCutoff
          }
        }).catch(() => null);
      }
      logJobs.push({
        orderId: row.order_id,
        productId: row.product_id,
        productType: row.product_type || 'store',
        shippingFeeText: row.shipping_fee_text || '',
        status: ORDER_STATUS_PENDING_PAYMENT
      });
      continue;
    }
    const job = {
      orderId: row.order_id,
      productId: row.product_id,
      productUrl: row.product_url,
      productTitle: row.product_title,
      productType: row.product_type || 'normal',
      shippingFeeText: row.shipping_fee_text || '',
      transactionUrl: row.transaction_url || ''
    };
    jobs.push(job);
    logJobs.push(job);
  }
  return { jobs, logJobs, storeUpdated, missingTransactionUrl, total: rows.length };
}

function normalizeOrderStatus(value) {
  return [
    ORDER_STATUS_PENDING_PAYMENT,
    ORDER_STATUS_WAITING_SHIPPING,
    ORDER_STATUS_PENDING_BUNDLE
  ].includes(value) ? value : null;
}

async function updateTransactionStartStatus(payload = {}, database = db) {
  const error = String(payload.error || '').trim();
  let ids = Array.isArray(payload.orderIds)
    ? payload.orderIds
    : (payload.orderId ? [payload.orderId] : []);
  if ((!ids || !ids.length) && Array.isArray(payload.productIds) && payload.productIds.length) {
    const productIds = payload.productIds
      .map(id => String(id || '').trim().toLowerCase())
      .filter(Boolean);
    if (productIds.length) {
      const productPlaceholders = productIds.map(() => '?').join(',');
      const rows = await database.getAll(
        `SELECT o.id
         FROM orders o
         INNER JOIN tasks t ON o.task_id = t.id
         WHERE t.product_id IN (${productPlaceholders})
           AND t.status = 'success'
           AND (o.order_status IS NULL OR o.order_status = '')`,
        productIds
      );
      ids = rows.map(row => row.id);
    }
  }
  const orderIds = ids.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0);
  if (!orderIds.length) {
    const err = new Error('orderId is required');
    err.statusCode = 400;
    throw err;
  }
  const placeholders = orderIds.map(() => '?').join(',');
  if (error) {
    const result = await database.query(
      `UPDATE orders
       SET transaction_start_error = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${placeholders})
         AND (order_status IS NULL OR order_status = '')`,
      [error, ...orderIds]
    );
    await appendTransactionStartRunLogResult(database, {
      orderIds,
      productIds: Array.isArray(payload.productIds) ? payload.productIds : [],
      error,
      updated: result.rowCount || 0
    }).catch(() => null);
    return { updated: result.rowCount || 0 };
  }

  const status = normalizeOrderStatus(payload.status);
  if (!status) {
    const err = new Error('valid status is required');
    err.statusCode = 400;
    throw err;
  }
  const bundleGroupId = status === ORDER_STATUS_PENDING_BUNDLE
    ? String(payload.bundleGroupId || '').trim()
    : null;
  if (status === ORDER_STATUS_PENDING_BUNDLE && !bundleGroupId) {
    const err = new Error('bundleGroupId is required');
    err.statusCode = 400;
    throw err;
  }
  const beforeRows = await getOrderStatusAuditRows(database, orderIds);
  const result = await database.query(
    `UPDATE orders
     SET order_status = ?,
         bundle_group_id = COALESCE(?, bundle_group_id),
         transaction_started_at = CURRENT_TIMESTAMP,
         transaction_start_error = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id IN (${placeholders})
       AND (order_status IS NULL OR order_status = '')`,
    [status, bundleGroupId, ...orderIds]
  );
  if (result.rowCount) {
    await writeOrderStatusAuditLogs(database, beforeRows, {
      status,
      source: 'transaction_start_status',
      metadata: {
        productIds: Array.isArray(payload.productIds) ? payload.productIds : [],
        bundleGroupId,
        payloadStatus: payload.status || ''
      }
    }).catch(() => null);
  }
  await appendTransactionStartRunLogResult(database, {
    orderIds,
    productIds: Array.isArray(payload.productIds) ? payload.productIds : [],
    status,
    updated: result.rowCount || 0
  }).catch(() => null);
  return { updated: result.rowCount || 0 };
}

function normalizeShippingFeeText(value) {
  const amount = String(value || '').replace(/[^\d]/g, '');
  return amount ? `${amount}円` : '';
}

async function getScanJobs(database = db) {
  const rows = await database.getAll(
    `SELECT o.id AS order_id,
            o.order_status,
            o.transaction_url,
            o.bundle_group_id,
            t.product_id,
            t.product_url,
            t.product_title,
            t.shipping_fee_text
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     WHERE o.order_status IN (?, ?)
       AND t.status = 'success'
     ORDER BY datetime(COALESCE(o.won_at, o.created_at)) ASC, o.id ASC`,
    [ORDER_STATUS_WAITING_SHIPPING, ORDER_STATUS_PENDING_BUNDLE]
  );
  return {
    jobs: rows.map(row => ({
      orderId: row.order_id,
      orderStatus: row.order_status,
      productId: row.product_id,
      productUrl: row.product_url,
      productTitle: row.product_title,
      shippingFeeText: row.shipping_fee_text || '',
      bundleGroupId: row.bundle_group_id || '',
      transactionUrl: row.transaction_url || ''
    })),
    total: rows.length
  };
}

async function updateScanStatus(payload = {}, database = db) {
  const orderId = Number(payload.orderId || 0);
  const shippingFeeText = normalizeShippingFeeText(payload.shippingFeeText);
  const bundleShippingFeeText = normalizeShippingFeeText(payload.bundleShippingFeeText);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    const err = new Error('orderId is required');
    err.statusCode = 400;
    throw err;
  }
  if (payload.bundleRejected === true) {
    const beforeRows = typeof database.getAll === 'function'
      ? await database.getAll(
        `SELECT o.id AS order_id, o.order_status AS old_status, t.product_id
         FROM orders o
         INNER JOIN tasks t ON o.task_id = t.id
         WHERE o.bundle_group_id = (
           SELECT bundle_group_id FROM orders WHERE id = ?
         )
           AND o.bundle_group_id IS NOT NULL`,
        [orderId]
      )
      : [];
    const result = await database.query(
      `UPDATE orders
       SET order_status = NULL,
           bundle_group_id = NULL,
           bundle_shipping_fee_text = NULL,
           transaction_start_error = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE bundle_group_id = (
         SELECT bundle_group_id FROM orders WHERE id = ?
       )
         AND bundle_group_id IS NOT NULL`,
      [orderId]
    );
    if (result.rowCount) {
      await writeOrderStatusAuditLogs(database, beforeRows, {
        status: null,
        source: 'scan_bundle_rejected',
        metadata: { orderId }
      }).catch(() => null);
    }
    return { updated: result.rowCount || 0, bundleRejected: true };
  }
  if (bundleShippingFeeText) {
    const beforeRows = typeof database.getAll === 'function'
      ? await database.getAll(
        `SELECT o.id AS order_id, o.order_status AS old_status, t.product_id
         FROM orders o
         INNER JOIN tasks t ON o.task_id = t.id
         WHERE o.bundle_group_id = (
           SELECT bundle_group_id FROM orders WHERE id = ?
         )
           AND o.bundle_group_id IS NOT NULL
           AND o.order_status = ?`,
        [orderId, ORDER_STATUS_PENDING_BUNDLE]
      )
      : [];
    const result = await database.query(
      `UPDATE orders
       SET bundle_shipping_fee_text = CASE WHEN id = ? THEN ? ELSE ? END,
           order_status = CASE WHEN id = ? THEN ? ELSE ? END,
           updated_at = CURRENT_TIMESTAMP
       WHERE bundle_group_id = (
         SELECT bundle_group_id FROM orders WHERE id = ?
       )
         AND bundle_group_id IS NOT NULL
         AND order_status = ?`,
      [
        orderId,
        bundleShippingFeeText,
        '0円',
        orderId,
        ORDER_STATUS_PENDING_PAYMENT,
        ORDER_STATUS_BUNDLE_COMPLETED,
        orderId,
        ORDER_STATUS_PENDING_BUNDLE
      ]
    );
    if (result.rowCount) {
      const statusesByOrderId = Object.fromEntries(
        beforeRows.map(row => [
          row.order_id,
          Number(row.order_id) === orderId ? ORDER_STATUS_PENDING_PAYMENT : ORDER_STATUS_BUNDLE_COMPLETED
        ])
      );
      await writeOrderStatusAuditLogs(database, beforeRows, {
        statusesByOrderId,
        source: 'scan_bundle_shipping',
        metadata: { orderId, bundleShippingFeeText }
      }).catch(() => null);
    }
    return { updated: result.rowCount || 0, bundleShippingFeeText };
  }
  if (payload.pending === true) {
    const beforeRows = await getOrderStatusAuditRows(database, [orderId]);
    const result = await database.query(
      `UPDATE orders
       SET order_status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [ORDER_STATUS_WAITING_SHIPPING, orderId]
    );
    if (result.rowCount) {
      await writeOrderStatusAuditLogs(database, beforeRows, {
        status: ORDER_STATUS_WAITING_SHIPPING,
        source: 'scan_waiting_shipping_pending',
        metadata: { orderId }
      }).catch(() => null);
    }
    return { updated: result.rowCount || 0, pending: true };
  }
  if (!shippingFeeText) {
    const err = new Error('valid shippingFeeText is required');
    err.statusCode = 400;
    throw err;
  }

  await database.query(
    `UPDATE tasks
     SET shipping_fee_text = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = (
       SELECT task_id
       FROM orders
       WHERE id = ?
         AND order_status = ?
     )`,
    [shippingFeeText, orderId, ORDER_STATUS_WAITING_SHIPPING]
  );
  const beforeRows = await getOrderStatusAuditRows(database, [orderId]);
  const result = await database.query(
    `UPDATE orders
     SET order_status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND order_status = ?`,
    [ORDER_STATUS_PENDING_PAYMENT, orderId, ORDER_STATUS_WAITING_SHIPPING]
  );
  if (result.rowCount) {
    await writeOrderStatusAuditLogs(database, beforeRows, {
      status: ORDER_STATUS_PENDING_PAYMENT,
      source: 'scan_waiting_shipping_resolved',
      metadata: { orderId, shippingFeeText }
    }).catch(() => null);
  }
  return { updated: result.rowCount || 0, shippingFeeText };
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const intValue = Math.floor(parsed);
  return intValue > 0 ? intValue : fallback;
}

function randomIntInclusive(min, max, randomFn = Math.random) {
  const low = Math.ceil(Number(min));
  const high = Math.floor(Number(max));
  if (!Number.isFinite(low) || !Number.isFinite(high)) return 0;
  if (high <= low) return low;
  const raw = Number(randomFn());
  const randomValue = Number.isFinite(raw) ? Math.min(0.999999999, Math.max(0, raw)) : Math.random();
  return low + Math.floor(randomValue * (high - low + 1));
}

function getPaymentJobLimitRange(values = {}) {
  const legacyLimit = parsePositiveInt(values.payment_job_limit, DEFAULT_PAYMENT_JOB_LIMIT);
  const minValue = parsePositiveInt(values.payment_job_limit_min, legacyLimit);
  const maxValue = parsePositiveInt(values.payment_job_limit_max, legacyLimit);
  return {
    min: Math.min(minValue, maxValue),
    max: Math.max(minValue, maxValue)
  };
}

async function getPaymentJobs(database = db, options = {}) {
  const configRows = await database.getAll(
    "SELECT key, value FROM config WHERE key IN ('payment_job_limit', 'payment_job_limit_min', 'payment_job_limit_max')"
  );
  const values = Object.fromEntries((configRows || []).map(row => [row.key, row.value]));
  const range = getPaymentJobLimitRange(values);
  const limit = randomIntInclusive(range.min, range.max, options.random || Math.random);
  const rows = await database.getAll(
    `SELECT o.id AS order_id,
            o.transaction_url,
            o.total_amount_cny,
            o.final_price,
            o.bundle_shipping_fee_text,
            o.bundle_group_id,
            t.product_id,
            t.product_url,
            t.product_title,
            t.product_type,
            t.shipping_fee_text
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     WHERE o.order_status = ?
       AND o.total_amount_cny IS NOT NULL
       AND t.status = 'success'
     ORDER BY datetime(COALESCE(o.won_at, o.created_at)) ASC, o.id ASC
     LIMIT ?`,
    [ORDER_STATUS_PENDING_SETTLEMENT, limit]
  );
  return {
    jobs: rows.map(row => ({
      orderId: row.order_id,
      productId: row.product_id,
      productUrl: row.product_url,
      productTitle: row.product_title,
      productType: row.product_type || 'normal',
      transactionUrl: row.transaction_url || '',
      payableCny: row.total_amount_cny,
      finalPrice: row.final_price,
      effectiveShippingFeeText: row.bundle_shipping_fee_text || row.shipping_fee_text || '',
      bundleGroupId: row.bundle_group_id || ''
    })),
    total: rows.length,
    limit,
    limitMin: range.min,
    limitMax: range.max
  };
}

async function savePaymentConfigValue(database, key, value) {
  await database.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)`,
    [key, String(value)]
  );
}

async function updatePaymentStatus(payload = {}, database = db) {
  if (payload.empty === true) {
    await savePaymentConfigValue(database, 'payment_requested', '0');
    return { paymentRequested: 0 };
  }

  const error = String(payload.error || '').trim();
  if (error) {
    const productId = String(payload.productId || '').trim() || '-';
    await savePaymentConfigValue(database, 'payment_requested', '0');
    await savePaymentConfigValue(database, 'payment_alert_message', `付款失败：商品ID ${productId}，原因：${error}`);
    return { paymentRequested: 0 };
  }

  const orderId = Number(payload.orderId || 0);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    const err = new Error('orderId is required');
    err.statusCode = 400;
    throw err;
  }
  const paymentStatus = String(payload.status || '').trim();
  const isSuccessfulPayment = paymentStatus === 'success'
    || paymentStatus === 'already_paid'
    || payload.alreadyPaid === true;
  if (!isSuccessfulPayment) {
    const err = new Error('valid payment status is required');
    err.statusCode = 400;
    throw err;
  }
  const beforeRows = await getOrderStatusAuditRows(database, [orderId]);
  const result = await database.query(
    `UPDATE orders
     SET order_status = 'pending_shipment',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND order_status = 'pending_settlement'`,
    [orderId]
  );
  if (result.rowCount) {
    await writeOrderStatusAuditLogs(database, beforeRows, {
      status: ORDER_STATUS_PENDING_SHIPMENT,
      source: 'payment_status',
      metadata: {
        paymentStatus,
        alreadyPaid: payload.alreadyPaid === true
      }
    }).catch(() => null);
  }
  return { updated: result.rowCount || 0 };
}

router.post('/bidding/sync', async (req, res) => {
  const incomingItems = req.body?.items || req.body?.bidding || [];
  const result = await syncBiddingItems(incomingItems);
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at)
     VALUES ('last_bidding_sync_count', ?, CURRENT_TIMESTAMP)`,
    [String(Array.isArray(incomingItems) ? incomingItems.length : 0)]
  );
  await setYahooLoginStatus('ok');
  res.json({ success: true, ...result });
});

router.post('/orders/sync', async (req, res) => {
  const orders = Array.isArray(req.body?.orders) ? req.body.orders : [];
  let updated = 0;
  let skippedExisting = 0;
  let forcedResync = 0;
  // Yahoo /my/won 页面按落札时间倒序（最新在前）。从第一条开始处理，
  // 碰到已经存在 orders 行的任务就停下来——这条之后的都早就同步过了。
  // 例外：如果任务被打上 force_orders_resync 标记（后台"落札商品更新"功能触发），
  // 则强制覆盖且不中断后续遍历，处理后清除标记。
  for (const order of orders) {
    const match = String(order.url || order.productId || '').match(/[a-zA-Z]?\d{8,10}/);
    if (!match) continue;
    const productId = match[0].toLowerCase();
    const task = await db.getOne(
      `SELECT id, force_orders_resync FROM tasks
       WHERE product_id = ? AND status IN ('bidding', 'success')
       ORDER BY datetime(COALESCE(last_bid_at, updated_at, created_at)) DESC, id DESC
       LIMIT 1`,
      [productId]
    );
    if (!task) continue;
    const isForced = Number(task.force_orders_resync || 0) === 1;
    const existingOrder = await db.getOne('SELECT id FROM orders WHERE task_id = ?', [task.id]);
    if (existingOrder && !isForced) {
      skippedExisting += 1;
      break;
    }
    await db.query(
      `UPDATE tasks
       SET status = 'success',
           error_msg = NULL,
           force_orders_resync = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [task.id]
    );
    await upsertOrderFromTask(task.id, {
      finalPrice: order.price,
      wonTimeText: order.wonTimeText,
      transactionUrl: order.transactionUrl
    });
    if (order.trackingNumber) {
      await db.query('UPDATE orders SET tracking_number = ?, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?', [order.trackingNumber, task.id]);
    }
    if (isForced) forcedResync += 1;
    updated += 1;
  }
  await setYahooLoginStatus('ok');
  const failed = 0;
  res.json({ success: true, updated, failed, skippedExisting, forcedResync });
});

router.get('/transaction-start/jobs', async (req, res) => {
  const config = await getIdleActionConfig();
  const includeAfterCutoff = req.query?.includeAfterCutoff === '1';
  const result = await getTransactionStartJobs(db, {
    includeAfterCutoff,
    transactionStartHour: config.transactionStartHour
  });
  await saveTransactionStartRunLog(db, {
    source: includeAfterCutoff ? 'manual' : 'auto',
    includeAfterCutoff,
    total: result.total,
    storeUpdated: result.storeUpdated,
    missingTransactionUrl: result.missingTransactionUrl,
    jobs: result.logJobs || result.jobs
  }).catch(() => null);
  res.json({ success: true, ...result });
});

router.post('/transaction-start/status', async (req, res) => {
  try {
    const result = await updateTransactionStartStatus(req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'update failed' });
  }
});

router.get('/scan/jobs', async (req, res) => {
  const result = await getScanJobs(db);
  res.json({ success: true, ...result });
});

router.post('/scan/status', async (req, res) => {
  try {
    const result = await updateScanStatus(req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'scan update failed' });
  }
});

router.get('/payment/jobs', async (req, res) => {
  const config = await getIdleActionConfig();
  const result = await getPaymentJobs(db);
  res.json({
    success: true,
    paymentPageStaySeconds: config.paymentPageStaySeconds,
    ...result
  });
});

router.post('/payment/status', async (req, res) => {
  try {
    const result = await updatePaymentStatus(req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'payment update failed' });
  }
});

router.post('/yahoo-login/status', async (req, res) => {
  const status = req.body?.status === 'ok' ? 'ok' : 'failed';
  const message = req.body?.message || (status === 'ok' ? '' : '需要登录 Yahoo');
  await setYahooLoginStatus(status, message);
  res.json({ success: true });
});

router.patch('/task/:id/snapshot', async (req, res) => {
  const {
    product_image_url,
    current_price,
    buyout_price,
    tax_type,
    end_time,
    status
  } = req.body || {};
  await db.query(
    `UPDATE tasks
     SET product_image_url = COALESCE(?, product_image_url),
         current_price = COALESCE(?, current_price),
         buyout_price = COALESCE(?, buyout_price),
         tax_type = COALESCE(?, tax_type),
         end_time = COALESCE(?, end_time),
         status = COALESCE(?, status),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND status != 'cancelled'`,
    [
      product_image_url || null,
      current_price || null,
      buyout_price || null,
      tax_type || null,
      end_time || null,
      status || null,
      req.params.id
    ]
  );
  await processPendingFollowupTasks();
  res.json({ success: true });
});

// GET /api/plugin/config 鈥?鑾峰彇鎻掍欢閰嶇疆
router.get('/config', async (req, res) => {
  const intervalMs = await db.getOne("SELECT value FROM config WHERE key = 'worker_interval_ms'");
  const rate = await db.getOne("SELECT rate FROM exchange_config ORDER BY updated_at DESC LIMIT 1");
  const multiBidConfig = await getMultiBidConfig();
  res.json({
    workerIntervalMs: parseInt(intervalMs?.value || '10000'),
    jpyToCnyRate: parseFloat(rate?.rate || '0.049'),
    multiBidStartHours: multiBidConfig.multiBidStartHours,
    multiBidIntervalMinutes: multiBidConfig.multiBidIntervalMinutes,
    idleSyncIntervalMinutes: multiBidConfig.idleSyncIntervalMinutes,
    idleBidGuardMinutes: multiBidConfig.idleBidGuardMinutes,
    multiBidMinPrice: multiBidConfig.multiBidMinPrice,
    transactionStartHour: multiBidConfig.transactionStartHour,
    scanStartHour: multiBidConfig.scanStartHour,
    scanEndHour: multiBidConfig.scanEndHour,
    scanEveryIdleRuns: multiBidConfig.scanEveryIdleRuns
  });
});

module.exports = router;
module.exports.getStrategyLeadMs = getStrategyLeadMs;
module.exports.getMultiBidStartMs = getMultiBidStartMs;
module.exports.getMultiBidIntervalMs = getMultiBidIntervalMs;
module.exports.getIdleBidGuardMs = getIdleBidGuardMs;
module.exports.isMultiBidTask = isMultiBidTask;
module.exports.isTaskNeedingEndTimeRefresh = isTaskNeedingEndTimeRefresh;
module.exports.isTaskReadyForDispatch = isTaskReadyForDispatch;
module.exports.chooseNextPluginTask = chooseNextPluginTask;
module.exports.getNextTaskDispatchMs = getNextTaskDispatchMs;
module.exports.hasTaskWithinIdleGuard = hasTaskWithinIdleGuard;
module.exports.getMultiBidConfig = getMultiBidConfig;
module.exports.DEFAULT_MULTI_BID_MIN_PRICE = DEFAULT_MULTI_BID_MIN_PRICE;
module.exports.DEFAULT_PAYMENT_JOB_LIMIT = DEFAULT_PAYMENT_JOB_LIMIT;
module.exports.DEFAULT_PAYMENT_PAGE_STAY_SECONDS = DEFAULT_PAYMENT_PAGE_STAY_SECONDS;
module.exports.randomIntInclusive = randomIntInclusive;
module.exports.getPaymentJobLimitRange = getPaymentJobLimitRange;
module.exports.ORDER_STATUS_PENDING_PAYMENT = ORDER_STATUS_PENDING_PAYMENT;
module.exports.ORDER_STATUS_WAITING_SHIPPING = ORDER_STATUS_WAITING_SHIPPING;
module.exports.ORDER_STATUS_PENDING_BUNDLE = ORDER_STATUS_PENDING_BUNDLE;
module.exports.ORDER_STATUS_BUNDLE_COMPLETED = ORDER_STATUS_BUNDLE_COMPLETED;
module.exports.ORDER_STATUS_PENDING_SETTLEMENT = ORDER_STATUS_PENDING_SETTLEMENT;
module.exports.ORDER_STATUS_PENDING_SHIPMENT = ORDER_STATUS_PENDING_SHIPMENT;
module.exports.getNextIdleAction = getNextIdleAction;
module.exports.getNextScanIdleCounter = getNextScanIdleCounter;
module.exports.getTransactionStartJobs = getTransactionStartJobs;
module.exports.saveTransactionStartRunLog = saveTransactionStartRunLog;
module.exports.updateTransactionStartStatus = updateTransactionStartStatus;
module.exports.getScanJobs = getScanJobs;
module.exports.updateScanStatus = updateScanStatus;
module.exports.getPaymentJobs = getPaymentJobs;
module.exports.updatePaymentStatus = updatePaymentStatus;
module.exports.expireOverduePendingTasks = expireOverduePendingTasks;
module.exports.failPricedOutPendingTasks = failPricedOutPendingTasks;
module.exports.resetStaleProcessingTasks = resetStaleProcessingTasks;
module.exports.sweepPendingTasks = sweepPendingTasks;
module.exports.isYahooLoginError = isYahooLoginError;
module.exports.syncBiddingItems = syncBiddingItems;
module.exports.processPendingFollowupTasks = processPendingFollowupTasks;
module.exports.isFollowupTaskReady = isFollowupTaskReady;
module.exports.shouldSplitDirectBidByYahooLowPriceRule = shouldSplitDirectBidByYahooLowPriceRule;
module.exports.YAHOO_LOW_PRICE_THRESHOLD = YAHOO_LOW_PRICE_THRESHOLD;
module.exports.YAHOO_LOW_PRICE_FOLLOWUP_THRESHOLD = YAHOO_LOW_PRICE_FOLLOWUP_THRESHOLD;
module.exports.YAHOO_LOW_PRICE_BID_LIMIT = YAHOO_LOW_PRICE_BID_LIMIT;
module.exports.YAHOO_LOW_PRICE_INITIAL_BID = YAHOO_LOW_PRICE_INITIAL_BID;
module.exports.resolveOrderFinalPrice = resolveOrderFinalPrice;
module.exports.normalizeYahooWonTimeText = normalizeYahooWonTimeText;
