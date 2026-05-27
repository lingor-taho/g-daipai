const express = require('express');
const router = express.Router();
const db = require('../models');
const { isYahooLoginError } = require('../services/yahooLoginStatus');

const DEFAULT_MULTI_BID_START_HOURS = 0.5;
const DEFAULT_MULTI_BID_INTERVAL_MINUTES = 5;
const DEFAULT_IDLE_SYNC_INTERVAL_MINUTES = 5;
const DEFAULT_IDLE_BID_GUARD_MINUTES = 10;
const DEFAULT_MULTI_BID_MIN_PRICE = 5000;

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
     WHERE status = 'pending'
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
    "SELECT key, value FROM config WHERE key IN ('multi_bid_start_hours', 'multi_bid_interval_minutes', 'idle_sync_interval_minutes', 'idle_bid_guard_minutes', 'multi_bid_min_price')"
  );
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  return {
    multiBidStartHours: Number(values.multi_bid_start_hours || DEFAULT_MULTI_BID_START_HOURS),
    multiBidIntervalMinutes: Number(values.multi_bid_interval_minutes || DEFAULT_MULTI_BID_INTERVAL_MINUTES),
    idleSyncIntervalMinutes: Number(values.idle_sync_interval_minutes || DEFAULT_IDLE_SYNC_INTERVAL_MINUTES),
    idleBidGuardMinutes: Number(values.idle_bid_guard_minutes || DEFAULT_IDLE_BID_GUARD_MINUTES),
    multiBidMinPrice: Number(values.multi_bid_min_price || DEFAULT_MULTI_BID_MIN_PRICE)
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

async function getFinanceConfig() {
  const rows = await db.getAll("SELECT key, value FROM config WHERE key IN ('jpy_to_cny_rate', 'handling_fee_jpy')");
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  if (!values.jpy_to_cny_rate) {
    const latestRate = await db.getOne('SELECT rate FROM exchange_config ORDER BY updated_at DESC LIMIT 1');
    values.jpy_to_cny_rate = String(latestRate?.rate || '0.049');
  }
  return {
    rate: Number(values.jpy_to_cny_rate || 0.049),
    handlingFeeJpy: Number(values.handling_fee_jpy || 0)
  };
}

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
  const finance = await getFinanceConfig();
  const finalPrice = resolveOrderFinalPrice(task, options.finalPrice);
  const wonTimeText = String(options.wonTimeText || '').trim() || null;
  const wonAt = normalizeYahooWonTimeText(wonTimeText);
  const totalAmountCny = finalPrice
    ? Number(((finalPrice + finance.handlingFeeJpy) * finance.rate).toFixed(2))
    : null;
  if (existing) {
    await db.query(
      `UPDATE orders
       SET product_title = ?, product_url = ?, final_price = ?, won_at = COALESCE(?, won_at), won_time_text = COALESCE(?, won_time_text), jpy_to_cny_rate = ?, handling_fee = ?, total_amount_cny = ?
       WHERE task_id = ?`,
      [task.product_title || task.product_id, task.product_url, finalPrice, wonAt, wonTimeText, finance.rate, finance.handlingFeeJpy, totalAmountCny, taskId]
    );
  } else {
    await db.query(
      `INSERT INTO orders (task_id, product_title, product_url, final_price, won_at, won_time_text, jpy_to_cny_rate, handling_fee, total_amount_cny, order_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment')`,
      [taskId, task.product_title || task.product_id, task.product_url, finalPrice, wonAt, wonTimeText, finance.rate, finance.handlingFeeJpy, totalAmountCny]
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
         product_title = excluded.product_title,
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
             product_title = COALESCE(?, product_title),
             product_image_url = COALESCE(?, product_image_url),
             current_price = COALESCE(?, current_price),
             error_msg = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE product_id = ?
           AND status IN ('bidding', 'success')`,
        [
          item.title || null,
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
  for (const order of orders) {
    const match = String(order.url || order.productId || '').match(/[a-zA-Z]?\d{8,10}/);
    if (!match) continue;
    const productId = match[0].toLowerCase();
    const task = await db.getOne(
      `SELECT id FROM tasks
       WHERE product_id = ? AND status IN ('bidding', 'success')
       ORDER BY datetime(COALESCE(last_bid_at, updated_at, created_at)) DESC, id DESC
       LIMIT 1`,
      [productId]
    );
    if (!task) continue;
    await db.query(
      `UPDATE tasks
       SET status = 'success',
           error_msg = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [task.id]
    );
    await upsertOrderFromTask(task.id, { finalPrice: order.price, wonTimeText: order.wonTimeText });
    if (order.trackingNumber) {
      await db.query('UPDATE orders SET tracking_number = ? WHERE task_id = ?', [order.trackingNumber, task.id]);
    }
    updated += 1;
  }
  await setYahooLoginStatus('ok');
  const failed = 0;
  res.json({ success: true, updated, failed });
});

router.post('/yahoo-login/status', async (req, res) => {
  const status = req.body?.status === 'ok' ? 'ok' : 'failed';
  const message = req.body?.message || (status === 'ok' ? '' : '需要登录 Yahoo');
  await setYahooLoginStatus(status, message);
  res.json({ success: true });
});

router.patch('/task/:id/snapshot', async (req, res) => {
  const {
    product_title,
    product_image_url,
    current_price,
    buyout_price,
    tax_type,
    end_time,
    status
  } = req.body || {};
  await db.query(
    `UPDATE tasks
     SET product_title = COALESCE(?, product_title),
         product_image_url = COALESCE(?, product_image_url),
         current_price = COALESCE(?, current_price),
         buyout_price = COALESCE(?, buyout_price),
         tax_type = COALESCE(?, tax_type),
         end_time = COALESCE(?, end_time),
         status = COALESCE(?, status),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND status != 'cancelled'`,
    [
      product_title || null,
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
    multiBidMinPrice: multiBidConfig.multiBidMinPrice
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
