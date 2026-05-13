const express = require('express');
const router = express.Router();
const db = require('../models');

function parseTimeMs(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : null;
}

function getStrategyLeadMs(task) {
  if (!task?.strategy || task.strategy === 'direct') return 0;
  const minutesFromColumn = Number(task.start_minutes_before || 0);
  const secondsFromColumn = Number(task.start_seconds_before || 0);
  if (minutesFromColumn || secondsFromColumn) {
    return minutesFromColumn * 60 * 1000 + secondsFromColumn * 1000;
  }
  const match = String(task.strategy).match(/^(\d+)min$/);
  return match ? Number(match[1]) * 60 * 1000 : 0;
}

function isDirectTask(task) {
  return !task?.strategy || task.strategy === 'direct' || getStrategyLeadMs(task) <= 0;
}

function isTaskNeedingEndTimeRefresh(task) {
  return !isDirectTask(task) && !parseTimeMs(task?.end_time);
}

function isTaskReadyForDispatch(task, nowMs = Date.now()) {
  const endMs = parseTimeMs(task.end_time);
  if (endMs && endMs <= nowMs) return false;
  if (isDirectTask(task)) return true;
  if (!endMs) return true;
  return endMs - nowMs <= getStrategyLeadMs(task);
}

function getDispatchPriority(task) {
  if (isDirectTask(task)) return 0;
  if (isTaskNeedingEndTimeRefresh(task)) return 2;
  return 1;
}

function chooseNextPluginTask(tasks, nowMs = Date.now()) {
  const readyTasks = tasks.filter(task => isTaskReadyForDispatch(task, nowMs));
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

// GET /api/plugin/task
router.get('/task', async (req, res) => {
  const tasks = await db.getAll(
    "SELECT * FROM tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT 100"
  );
  const task = chooseNextPluginTask(tasks);
  res.json({ task: task || null });
});

// PATCH /api/plugin/task/:id/status
router.patch('/task/:id/status', async (req, res) => {
  const { status, error_msg, bid_price } = req.body;
  if (status === 'bidding') {
    await db.query(
      `UPDATE tasks
       SET status = ?,
           error_msg = ?,
           bid_count = COALESCE(bid_count, 0) + 1,
           last_bid_at = CURRENT_TIMESTAMP,
           is_highest_bidder = 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, error_msg || null, req.params.id]
    );
    if (bid_price) {
      await db.query(
        'INSERT INTO bid_logs (task_id, bid_price, result) VALUES (?, ?, ?)',
        [req.params.id, normalizeYenAmount(bid_price), 'bidding']
      );
    }
  } else {
    await db.query(
      `UPDATE tasks
       SET status = ?,
           error_msg = ?,
           is_highest_bidder = CASE WHEN ? = 'failed' THEN 0 ELSE is_highest_bidder END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, error_msg || null, status, req.params.id]
    );
  }
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

async function upsertOrderFromTask(taskId, options = {}) {
  const task = await db.getOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) return;
  const existing = await db.getOne('SELECT id FROM orders WHERE task_id = ?', [taskId]);
  const finance = await getFinanceConfig();
  const finalPrice = normalizeYenAmount(options.finalPrice) || Number(task.current_price || task.max_price || 0);
  const totalAmountCny = Number(((finalPrice + finance.handlingFeeJpy) * finance.rate).toFixed(2));
  if (existing) {
    await db.query(
      `UPDATE orders
       SET product_title = ?, product_url = ?, final_price = ?, jpy_to_cny_rate = ?, handling_fee = ?, total_amount_cny = ?
       WHERE task_id = ?`,
      [task.product_title || task.product_id, task.product_url, finalPrice, finance.rate, finance.handlingFeeJpy, totalAmountCny, taskId]
    );
  } else {
    await db.query(
      `INSERT INTO orders (task_id, product_title, product_url, final_price, jpy_to_cny_rate, handling_fee, total_amount_cny, order_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_payment')`,
      [taskId, task.product_title || task.product_id, task.product_url, finalPrice, finance.rate, finance.handlingFeeJpy, totalAmountCny]
    );
  }
}

router.post('/orders/sync', async (req, res) => {
  const orders = Array.isArray(req.body?.orders) ? req.body.orders : [];
  const wonProductIds = new Set();
  let updated = 0;
  for (const order of orders) {
    const match = String(order.url || order.productId || '').match(/[a-zA-Z]?\d{8,10}/);
    if (!match) continue;
    const productId = match[0].toLowerCase();
    wonProductIds.add(productId);
    const task = await db.getOne(
      `SELECT id FROM tasks
       WHERE product_id = ? AND status IN ('bidding', 'success')
       ORDER BY datetime(COALESCE(last_bid_at, updated_at, created_at)) DESC, id DESC
       LIMIT 1`,
      [productId]
    );
    if (!task) continue;
    await db.query(
      "UPDATE tasks SET status = 'success', error_msg = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [task.id]
    );
    await upsertOrderFromTask(task.id, { finalPrice: order.price });
    if (order.trackingNumber) {
      await db.query('UPDATE orders SET tracking_number = ? WHERE task_id = ?', [order.trackingNumber, task.id]);
    }
    updated += 1;
  }

  const endedBiddingTasks = await db.getAll(
    "SELECT id, product_id, end_time FROM tasks WHERE status = 'bidding' AND end_time IS NOT NULL"
  );
  let failed = 0;
  for (const task of endedBiddingTasks) {
    const endMs = parseTimeMs(task.end_time);
    if (!endMs || endMs > Date.now()) continue;
    if (wonProductIds.has(String(task.product_id || '').toLowerCase())) continue;
    await db.query(
      "UPDATE tasks SET status = 'failed', is_highest_bidder = 0, error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ['Auction ended and the item was not found on the won page', task.id]
    );
    failed += 1;
  }
  res.json({ success: true, updated, failed });
});

router.patch('/task/:id/snapshot', async (req, res) => {
  const {
    product_title,
    product_image_url,
    current_price,
    end_time,
    status
  } = req.body || {};
  await db.query(
    `UPDATE tasks
     SET product_title = COALESCE(?, product_title),
         product_image_url = COALESCE(?, product_image_url),
         current_price = COALESCE(?, current_price),
         end_time = COALESCE(?, end_time),
         status = COALESCE(?, status),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      product_title || null,
      product_image_url || null,
      current_price || null,
      end_time || null,
      status || null,
      req.params.id
    ]
  );
  res.json({ success: true });
});

// GET /api/plugin/config 鈥?鑾峰彇鎻掍欢閰嶇疆
router.get('/config', async (req, res) => {
  const intervalMs = await db.getOne("SELECT value FROM config WHERE key = 'worker_interval_ms'");
  const rate = await db.getOne("SELECT rate FROM exchange_config ORDER BY updated_at DESC LIMIT 1");
  res.json({
    workerIntervalMs: parseInt(intervalMs?.value || '10000'),
    jpyToCnyRate: parseFloat(rate?.rate || '0.049')
  });
});

module.exports = router;
module.exports.getStrategyLeadMs = getStrategyLeadMs;
module.exports.isTaskNeedingEndTimeRefresh = isTaskNeedingEndTimeRefresh;
module.exports.isTaskReadyForDispatch = isTaskReadyForDispatch;
module.exports.chooseNextPluginTask = chooseNextPluginTask;

