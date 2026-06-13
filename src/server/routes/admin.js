const express = require('express');
const router = express.Router();
const db = require('../models');
const bcrypt = require('bcryptjs');
const authMiddleware = require('../middleware/auth');
const adminAuthMiddleware = require('../middleware/adminAuth');
const {
  chooseNextPluginTask,
  getMultiBidConfig: getPluginMultiBidConfig,
  getMultiBidIntervalMs,
  getStrategyLeadMs,
  isMultiBidTask,
  ensureScheduledTransactionStartRequest,
  shouldAutoRequestTransactionStart,
  ensureScheduledConfirmReceiptRequest,
  shouldAutoRequestConfirmReceipt,
  getShipmentAlerts,
  appendPendingReceiptOrderToGoogleSheet,
  DEFAULT_MULTI_BID_MIN_PRICE,
  DEFAULT_CONFIRM_RECEIPT_HOUR,
  DEFAULT_CONFIRM_RECEIPT_COLOR,
  normalizeReceiptColorConfig
} = require('./plugin');
const { productService, normalizeAuctionUrl } = require('./proxy');
const { buildYahooLoginStatus } = require('../services/yahooLoginStatus');
const {
  deleteStaleTaskData,
  getDataCleanupConfig,
  saveDataCleanupConfig
} = require('../services/dataCleanup');
const {
  getOrderStatusAuditRows,
  writeOrderStatusAuditLogs,
  backfillMissingOrderStatusAuditLogs
} = require('../services/orderStatusAudit');
const {
  applyGoogleSheetsConfig,
  applyGoogleSheetsConfigFromDb,
  extractSpreadsheetId,
  getGoogleSheetsCredentialPath,
  getSheetConfig
} = require('../services/googleSheets');
const {
  getCaptchaChallenge,
  answerCaptchaChallenge,
  closeCaptchaChallenge
} = require('../services/manualCaptcha');
const {
  ORDER_STATUS_PENDING_SETTLEMENT,
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_PENDING_PAYMENT,
  ORDER_STATUS_BUNDLE_COMPLETED,
  ORDER_STATUS_PENDING_SHIPMENT,
  ORDER_STATUS_PENDING_RECEIPT,
  ORDER_STATUS_CANCELLED
} = require('../../shared/domainConstants.cjs');
const {
  taxExcludedToTaxIncluded
} = require('../../shared/priceRules.cjs');
const {
  parseShippingFeeToNumber,
  canSettleShippingFeeText,
  canSettleOrderShippingFee,
  getEffectiveShippingFeeText
} = require('../../shared/shippingRules.cjs');
const {
  calculateOrderPayable
} = require('../../shared/payableRules.cjs');
const { upsertProductSnapshot } = require('../services/productRepository');

function buildGoogleSheetUrl(spreadsheetId) {
  const id = String(spreadsheetId || '').trim();
  if (!id) return '';
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit?gid=0#gid=0`;
}

function normalizeBidStrategyScope(value) {
  return value === 'direct_only' ? 'direct_only' : 'all';
}

function normalizeOrderStatusRefreshTarget(value) {
  const normalized = String(value || 'completed').trim();
  if (normalized === 'blank') return null;
  if (normalized === ORDER_STATUS_COMPLETED) return ORDER_STATUS_COMPLETED;
  if (normalized === ORDER_STATUS_PENDING_SHIPMENT) return ORDER_STATUS_PENDING_SHIPMENT;
  throw new Error('invalid orderStatus');
}

function getOrderStatusRefreshText(orderStatus) {
  if (orderStatus === ORDER_STATUS_PENDING_SHIPMENT) return '待发货';
  return orderStatus === null ? '为空' : '完了';
}

router.use(authMiddleware);
router.use(adminAuthMiddleware);

function parseTaskTimeMs(value) {
  let input = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(input)) {
    input = input.replace(' ', 'T') + 'Z';
  }
  const time = Date.parse(input);
  return Number.isFinite(time) ? time : null;
}

function getLocalDateKey(nowMs = Date.now()) {
  const date = new Date(nowMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toIsoOrNull(ms) {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

function getNextExecuteAt(task, multiBidConfig, nowMs = Date.now()) {
  if (!task || ['success', 'failed'].includes(task.status)) return null;
  const endMs = parseTaskTimeMs(task.end_time);
  if (endMs && endMs <= nowMs) return null;

  if (isMultiBidTask(task)) {
    const startMs = endMs ? endMs - getStrategyLeadMs({ ...task, ...multiBidConfig }) : nowMs;
    const referenceMs = parseTaskTimeMs(task.last_bid_at || (task.status === 'bidding' ? task.updated_at || task.created_at : null));
    const intervalReadyMs = referenceMs ? referenceMs + getMultiBidIntervalMs(multiBidConfig) : nowMs;
    return toIsoOrNull(Math.max(startMs, intervalReadyMs, nowMs));
  }

  if (task.status === 'bidding') return null;
  if (!task.strategy || task.strategy === 'direct') return toIsoOrNull(nowMs);
  if (!endMs) return toIsoOrNull(nowMs);
  return toIsoOrNull(Math.max(endMs - getStrategyLeadMs(task), nowMs));
}

function buildAdminOrdersListQuery({ pageSize, offset }) {
  return {
    sql: `SELECT o.*,
            COALESCE(o.product_id, t.product_id) AS product_id,
            COALESCE(p.product_url, t.product_url) AS product_url,
            COALESCE(p.shipping_fee_text, t.shipping_fee_text) AS shipping_fee_text,
            COALESCE(p.tax_type, t.tax_type, 'tax_zero') AS tax_type,
            COALESCE(p.product_type, t.product_type, CASE WHEN COALESCE(p.tax_type, t.tax_type, 'tax_zero') = 'tax_included' THEN 'store' ELSE 'normal' END) AS product_type,
            u.id AS user_id,
            u.username,
            ufo.rate_adjustment,
            ufo.bank_fee_jpy AS user_bank_fee_jpy,
            ufo.handling_fee_cny AS user_handling_fee_cny,
            ufo.large_amount_fee_cny AS user_large_amount_fee_cny,
            (
              SELECT l.source
              FROM order_status_change_logs l
              WHERE l.order_id = o.id
              ORDER BY datetime(l.created_at) DESC, l.id DESC
              LIMIT 1
            ) AS latest_status_change_source,
            (
              SELECT l.created_at
              FROM order_status_change_logs l
              WHERE l.order_id = o.id
              ORDER BY datetime(l.created_at) DESC, l.id DESC
              LIMIT 1
            ) AS latest_status_change_at,
            (
              SELECT l.old_status
              FROM order_status_change_logs l
              WHERE l.order_id = o.id
              ORDER BY datetime(l.created_at) DESC, l.id DESC
              LIMIT 1
            ) AS latest_status_old_status,
            (
              SELECT l.new_status
              FROM order_status_change_logs l
              WHERE l.order_id = o.id
              ORDER BY datetime(l.created_at) DESC, l.id DESC
              LIMIT 1
            ) AS latest_status_new_status,
            (
              SELECT l.metadata
              FROM order_status_change_logs l
              WHERE l.order_id = o.id
              ORDER BY datetime(l.created_at) DESC, l.id DESC
              LIMIT 1
            ) AS latest_status_change_metadata
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     LEFT JOIN products p ON p.product_id = t.product_id
     LEFT JOIN users u ON t.user_id = u.id
     LEFT JOIN user_finance_overrides ufo ON ufo.user_id = u.id
     WHERE t.status = 'success'
     ORDER BY datetime(COALESCE(o.won_at, t.updated_at)) DESC, t.id DESC LIMIT ? OFFSET ?`,
    params: [pageSize, offset]
  };
}

function buildAdminOrdersUserWonDateRangeQuery({ userId, fromDate, toDate }) {
  return {
    sql: `SELECT o.id,
            o.task_id,
            o.product_title,
            COALESCE(o.product_url, t.product_url) AS product_url,
            o.final_price,
            o.won_at,
            o.won_time_text,
            o.order_status,
            o.bundle_shipping_fee_text,
            o.transaction_url,
            o.transaction_start_error,
            o.shipping_company,
            o.tracking_number,
            o.settled_at,
            o.updated_at,
            o.jpy_to_cny_rate,
            o.bank_fee_jpy,
            o.handling_fee_cny,
            o.large_amount_fee_cny,
            o.large_amount_fee_applied,
            o.tax_included_final_price,
            o.has_user_finance_override,
            o.total_amount_cny,
            t.product_id,
            t.shipping_fee_text,
            t.tax_type,
            t.product_type,
            u.id AS user_id,
            u.username,
            ufo.rate_adjustment,
            ufo.bank_fee_jpy AS user_bank_fee_jpy,
            ufo.handling_fee_cny AS user_handling_fee_cny,
            ufo.large_amount_fee_cny AS user_large_amount_fee_cny
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     LEFT JOIN users u ON t.user_id = u.id
     LEFT JOIN user_finance_overrides ufo ON ufo.user_id = u.id
     WHERE t.status = 'success'
       AND u.id = ?
       AND o.won_at IS NOT NULL
       AND substr(COALESCE(o.won_at, ''), 1, 10) >= ?
       AND substr(COALESCE(o.won_at, ''), 1, 10) <= ?
     ORDER BY datetime(o.won_at) DESC, o.id DESC`,
    params: [userId, fromDate, toDate]
  };
}

function mapAdminOrderListItem(item) {
  const settled = Boolean(item.settled_at);
  const effectiveShippingFeeText = getEffectiveShippingFeeText(item);
  return {
    ...item,
    username: item.username || '-',
    product_id: item.product_id || extractAuctionId(item.product_url) || '',
    shipping_fee_text: item.shipping_fee_text || '-',
    effective_shipping_fee_text: effectiveShippingFeeText || '-',
    can_settle: canSettleOrderShippingFee(item),
    shipping_fee_jpy: settled ? parseShippingFeeToNumber(effectiveShippingFeeText) : null,
    bank_fee_jpy: settled ? item.bank_fee_jpy : null,
    handling_fee_cny: settled ? item.handling_fee_cny : null,
    large_amount_fee_cny: settled ? item.large_amount_fee_cny : null,
    large_amount_fee_applied: settled ? Boolean(item.large_amount_fee_applied) : null,
    tax_included_final_price: settled ? item.tax_included_final_price : null,
    jpy_to_cny_rate: settled ? item.jpy_to_cny_rate : null,
    rate_adjustment: settled ? item.rate_adjustment : null,
    has_user_finance_override: settled ? Boolean(item.has_user_finance_override) : null,
    payable_cny: settled ? item.total_amount_cny : null,
    order_status: item.order_status || null,
    transaction_start_error: item.transaction_start_error || null,
    latest_status_change_source: item.latest_status_change_source || null,
    latest_status_change_at: item.latest_status_change_at || null,
    latest_status_old_status: item.latest_status_old_status || null,
    latest_status_new_status: item.latest_status_new_status || null,
    latest_status_change_metadata: item.latest_status_change_metadata || null
  };
}

router.get('/users', async (req, res) => {
  const { current = 1, pageSize = 10 } = req.query;
  const offset = (current - 1) * pageSize;
  const items = await db.getAll(
    `SELECT u.id,
            u.username,
            u.role,
            COALESCE(u.user_level, 1) AS user_level,
            u.parent_user_id,
            COALESCE(u.bid_strategy_scope, 'all') AS bid_strategy_scope,
            p.username AS parent_username,
            COALESCE(p.user_level, 1) AS parent_user_level,
            u.created_at
     FROM users u
     LEFT JOIN users p ON p.id = u.parent_user_id
     WHERE u.role = 'user'
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
    [pageSize, offset]
  );
  const countResult = await db.getOne("SELECT COUNT(*) as total FROM users WHERE role = 'user'");
  res.json({ items, total: countResult?.total || 0 });
});

router.get('/users/options', async (req, res) => {
  const items = await db.getAll(
    `SELECT id, username, COALESCE(user_level, 1) AS user_level, parent_user_id, COALESCE(bid_strategy_scope, 'all') AS bid_strategy_scope
     FROM users
     WHERE role = 'user'
     ORDER BY user_level DESC, username ASC`
  );
  res.json({ items });
});

async function normalizeClientUserHierarchy(userLevel, parentUserId, selfId = null) {
  const level = Number(userLevel || 1);
  const parentId = parentUserId === null || parentUserId === undefined || parentUserId === '' ? null : Number(parentUserId);
  if (![1, 2, 3].includes(level)) {
    const err = new Error('valid user_level is required');
    err.status = 400;
    throw err;
  }
  if (!parentId) return { userLevel: level, parentUserId: null };
  if (level >= 3) {
    const err = new Error('client admin user cannot have parent user');
    err.status = 400;
    throw err;
  }
  if (String(parentId) === String(selfId)) {
    const err = new Error('parent user cannot be self');
    err.status = 400;
    throw err;
  }
  const parent = await db.getOne(
    "SELECT id, COALESCE(user_level, 1) AS user_level FROM users WHERE id = ? AND role = 'user'",
    [parentId]
  );
  if (!parent) {
    const err = new Error('parent user not found');
    err.status = 400;
    throw err;
  }
  if (Number(parent.user_level || 1) !== 2) {
    const err = new Error('parent user must be agent user');
    err.status = 400;
    throw err;
  }
  if (level === 1 && Number(parent.user_level || 1) !== 2) {
    const err = new Error('normal user parent must be agent user');
    err.status = 400;
    throw err;
  }
  if (level === 2 && Number(parent.user_level || 1) !== 2) {
    const err = new Error('agent user parent must be agent user');
    err.status = 400;
    throw err;
  }
  return { userLevel: level, parentUserId: parentId };
}

router.post('/users', async (req, res) => {
  const { username, password, user_level, parent_user_id } = req.body;
  const bidStrategyScope = normalizeBidStrategyScope(req.body?.bid_strategy_scope);
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  const existing = await db.getOne('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return res.status(409).json({ error: 'username already exists' });
  let hierarchy;
  try {
    hierarchy = await normalizeClientUserHierarchy(user_level, parent_user_id);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  const hash = await bcrypt.hash(password, 10);
  await db.query(
    'INSERT INTO users (username, password_hash, role, user_level, parent_user_id, bid_strategy_scope) VALUES (?, ?, ?, ?, ?, ?)',
    [username, hash, 'user', hierarchy.userLevel, hierarchy.parentUserId, bidStrategyScope]
  );
  const inserted = await db.getOne('SELECT last_insert_rowid() as id');
  res.json({ success: true, id: inserted.id });
});

router.put('/users/:id', async (req, res) => {
  const { username, password, user_level, parent_user_id } = req.body;
  const bidStrategyScope = normalizeBidStrategyScope(req.body?.bid_strategy_scope);
  if (!username) return res.status(400).json({ error: 'username is required' });
  const existing = await db.getOne('SELECT id FROM users WHERE username = ? AND id != ?', [username, req.params.id]);
  if (existing) return res.status(409).json({ error: 'username already exists' });
  let hierarchy;
  try {
    hierarchy = await normalizeClientUserHierarchy(user_level, parent_user_id, req.params.id);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    await db.query(
      "UPDATE users SET username = ?, password_hash = ?, role = 'user', user_level = ?, parent_user_id = ?, bid_strategy_scope = ? WHERE id = ? AND role = 'user'",
      [username, hash, hierarchy.userLevel, hierarchy.parentUserId, bidStrategyScope, req.params.id]
    );
  } else {
    await db.query(
      "UPDATE users SET username = ?, role = 'user', user_level = ?, parent_user_id = ?, bid_strategy_scope = ? WHERE id = ? AND role = 'user'",
      [username, hierarchy.userLevel, hierarchy.parentUserId, bidStrategyScope, req.params.id]
    );
  }
  res.json({ success: true });
});

router.delete('/users/:id', async (req, res) => {
  await db.query("UPDATE users SET parent_user_id = NULL WHERE parent_user_id = ? AND role = 'user'", [req.params.id]);
  await db.query("DELETE FROM users WHERE id = ? AND role = 'user'", [req.params.id]);
  res.json({ success: true });
});

router.get('/server-accounts', async (req, res) => {
  const { current = 1, pageSize = 10 } = req.query;
  const offset = (current - 1) * pageSize;
  const items = await db.getAll(
    `SELECT id, username, role, created_at FROM users WHERE role = 'admin' ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [pageSize, offset]
  );
  const countResult = await db.getOne("SELECT COUNT(*) as total FROM users WHERE role = 'admin'");
  res.json({ items, total: countResult?.total || 0 });
});

router.post('/server-accounts', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  const existing = await db.getOne('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return res.status(409).json({ error: 'username already exists' });
  const hash = await bcrypt.hash(password, 10);
  await db.query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [username, hash, 'admin']);
  const inserted = await db.getOne('SELECT last_insert_rowid() as id');
  res.json({ success: true, id: inserted.id });
});

router.put('/server-accounts/:id', async (req, res) => {
  const { username, password } = req.body;
  if (!username) return res.status(400).json({ error: 'username is required' });
  const existing = await db.getOne('SELECT id FROM users WHERE username = ? AND id != ?', [username, req.params.id]);
  if (existing) return res.status(409).json({ error: 'username already exists' });
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    await db.query("UPDATE users SET username = ?, password_hash = ?, role = 'admin' WHERE id = ? AND role = 'admin'", [username, hash, req.params.id]);
  } else {
    await db.query("UPDATE users SET username = ?, role = 'admin' WHERE id = ? AND role = 'admin'", [username, req.params.id]);
  }
  res.json({ success: true });
});

router.delete('/server-accounts/:id', async (req, res) => {
  if (String(req.user.id) === String(req.params.id)) {
    return res.status(400).json({ error: 'cannot delete current server account' });
  }
  await db.query("DELETE FROM users WHERE id = ? AND role = 'admin'", [req.params.id]);
  res.json({ success: true });
});

// 账号管理
router.get('/accounts', async (req, res) => {
  const { current = 1, pageSize = 10 } = req.query;
  const offset = (current - 1) * pageSize;
  const items = await db.getAll(
    `SELECT * FROM yahoo_accounts ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [pageSize, offset]
  );
  const countResult = await db.getOne('SELECT COUNT(*) as total FROM yahoo_accounts');
  res.json({ items, total: countResult?.total || 0 });
});

router.post('/accounts', async (req, res) => {
  const { account_name, email, profile_dir } = req.body;
  if (!account_name || !email) {
    return res.status(400).json({ error: 'account_name and email are required' });
  }
  try {
    await db.query(
      'INSERT INTO yahoo_accounts (account_name, email, profile_dir) VALUES (?, ?, ?)',
      [account_name, email, profile_dir]
    );
    const inserted = await db.getOne('SELECT last_insert_rowid() as id');
    res.json({ success: true, id: inserted.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/accounts/:id', async (req, res) => {
  const { account_name, email, profile_dir, status, error_msg } = req.body;
  if (!account_name || !email) {
    return res.status(400).json({ error: 'account_name and email are required' });
  }
  try {
    await db.query(
      `UPDATE yahoo_accounts
       SET account_name = ?, email = ?, profile_dir = ?, status = ?, error_msg = ?
       WHERE id = ?`,
      [account_name, email, profile_dir || null, status || 'idle', error_msg || null, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/accounts/:id', async (req, res) => {
  await db.query('DELETE FROM yahoo_accounts WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// 账号统计
router.get('/accounts/stats', async (req, res) => {
  const stats = await db.getAll(
    "SELECT status, COUNT(*) as count FROM yahoo_accounts GROUP BY status"
  );
  res.json({ stats });
});

// 任务看板
router.get('/tasks', async (req, res) => {
  const { current = 1, pageSize = 10 } = req.query;
  const offset = (current - 1) * pageSize;
  const items = await db.getAll(
    `SELECT t.*, u.username
     FROM tasks t
     LEFT JOIN users u ON u.id = t.user_id
     ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
    [pageSize, offset]
  );
  const multiBidConfig = await getPluginMultiBidConfig();
  const nowMs = Date.now();
  const mappedItems = items.map(item => ({
    ...item,
    next_execute_at: getNextExecuteAt(item, multiBidConfig, nowMs)
  }));
  const countResult = await db.getOne('SELECT COUNT(*) as total FROM tasks');
  const statusRows = await db.getAll(
    'SELECT status, COUNT(*) as count FROM tasks GROUP BY status'
  );
  const queue = {
    total: countResult?.total || 0,
    pending: 0,
    processing: 0,
    bidding: 0,
    success: 0,
    failed: 0
  };
  for (const row of statusRows) {
    queue[row.status] = row.count;
  }
  res.json({ items: mappedItems, total: queue.total, queue });
});

// 队列统计
router.get('/tasks/stats', async (req, res) => {
  const rows = await db.getAll(
    'SELECT status, COUNT(*) as count FROM tasks GROUP BY status'
  );
  const pendingTasks = await db.getAll(
    "SELECT id, product_id, product_title, max_price, strategy, start_minutes_before, start_seconds_before, status, last_bid_at, end_time, created_at FROM tasks WHERE status = 'pending' OR (status = 'bidding' AND strategy = 'multi_bid') ORDER BY created_at ASC LIMIT 100"
  );
  const nextTask = chooseNextPluginTask(pendingTasks, Date.now(), await getPluginMultiBidConfig());
  const stats = {
    total: 0,
    pending: 0,
    processing: 0,
    bidding: 0,
    success: 0,
    failed: 0,
    nextTask: nextTask || null
  };
  for (const row of rows) {
    stats[row.status] = row.count;
    stats.total += row.count;
  }
  const loginStatus = await db.getOne("SELECT value, updated_at FROM config WHERE key = 'yahoo_login_status'");
  const loginMessage = await db.getOne("SELECT value FROM config WHERE key = 'yahoo_login_message'");
  stats.yahooLogin = buildYahooLoginStatus(loginStatus, loginMessage);
  res.json(stats);
});

// 订单管理
router.get('/orders', async (req, res) => {
  const { current = 1, pageSize = 10 } = req.query;
  const offset = (current - 1) * pageSize;
  await backfillMissingOrderStatusAuditLogs(db, 100).catch(() => null);
  const ordersQuery = buildAdminOrdersListQuery({ pageSize, offset });
  const items = await db.getAll(ordersQuery.sql, ordersQuery.params);
  const countResult = await db.getOne(`
    SELECT COUNT(*) as total
    FROM orders o
    INNER JOIN tasks t ON o.task_id = t.id
    WHERE t.status = 'success'
  `);
  const mappedItems = items.map(mapAdminOrderListItem);
  res.json({ items: mappedItems, total: countResult?.total || 0 });
});

router.get('/orders/user-won-date-range', async (req, res) => {
  const userId = Number(req.query.userId || 0);
  const fromDate = String(req.query.fromDate || '').trim();
  const toDate = String(req.query.toDate || '').trim();
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'valid userId is required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return res.status(400).json({ error: 'valid fromDate and toDate are required' });
  }
  const query = buildAdminOrdersUserWonDateRangeQuery({ userId, fromDate, toDate });
  const items = await db.getAll(query.sql, query.params);
  res.json({ items: items.map(mapAdminOrderListItem), total: items.length });
});

router.get('/orders/:id/status-logs', async (req, res) => {
  const orderId = Number(req.params.id || 0);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({ error: 'valid order id is required' });
  }
  const items = await db.getAll(
    `SELECT id, order_id, product_id, old_status, new_status, source, metadata, created_at
     FROM order_status_change_logs
     WHERE order_id = ?
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT 20`,
    [orderId]
  );
  res.json({ items });
});

router.get('/orders/status-debug/:productId', async (req, res) => {
  const productId = extractAuctionId(req.params.productId || req.query.productId || '');
  if (!productId) {
    return res.status(400).json({ error: 'valid product id is required' });
  }
  const tasks = await db.getAll(
    `SELECT id, product_id, status, strategy, product_type, shipping_fee_text,
            created_at, updated_at, last_bid_at
     FROM tasks
     WHERE product_id = ?
     ORDER BY id DESC`,
    [productId]
  );
  const orders = await db.getAll(
    `SELECT o.id, o.task_id, o.order_status, o.final_price, o.won_at, o.won_time_text,
            o.created_at, o.updated_at, o.transaction_started_at, o.transaction_start_error,
            o.bundle_group_id, o.bundle_shipping_fee_text,
            t.product_id, t.product_type, t.shipping_fee_text
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     WHERE t.product_id = ?
     ORDER BY o.id DESC`,
    [productId]
  );
  const logs = await db.getAll(
    `SELECT l.*
     FROM order_status_change_logs l
     WHERE l.product_id = ?
        OR l.order_id IN (
          SELECT o.id FROM orders o INNER JOIN tasks t ON o.task_id = t.id WHERE t.product_id = ?
        )
     ORDER BY datetime(l.created_at) DESC, l.id DESC
     LIMIT 50`,
    [productId, productId]
  );
  const tableInfo = db.raw.prepare('PRAGMA table_info(orders)').all();
  const triggers = db.raw.prepare(
    "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'orders'"
  ).all();
  res.json({ productId, tasks, orders, logs, ordersTableInfo: tableInfo, orderTriggers: triggers });
});

// 财务统计
router.get('/orders/stats', async (req, res) => {
  const stats = await db.getOne(`
    SELECT
      COUNT(*) as total_orders,
      COALESCE(SUM(final_price), 0) as total_jpy,
      COALESCE(SUM(CASE WHEN settled_at IS NOT NULL THEN total_amount_cny ELSE 0 END), 0) as total_cny
    FROM orders
    INNER JOIN tasks t ON orders.task_id = t.id
    WHERE t.status = 'success'
  `);
  res.json(stats);
});

async function getFinanceConfig() {
  const rows = await db.getAll("SELECT key, value FROM config WHERE key IN ('jpy_to_cny_rate', 'bank_fee_jpy', 'handling_fee_cny', 'large_amount_fee_cny')");
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  if (!values.jpy_to_cny_rate) {
    const latestRate = await db.getOne('SELECT rate FROM exchange_config ORDER BY updated_at DESC LIMIT 1');
    values.jpy_to_cny_rate = String(latestRate?.rate || '0.049');
  }
  return {
    rate: Number(values.jpy_to_cny_rate || 0.049),
    bankFeeJpy: Number(values.bank_fee_jpy || 0),
    handlingFeeCny: Number(values.handling_fee_cny || 0),
    largeAmountFeeCny: Number(values.large_amount_fee_cny || 0)
  };
}

const getTaxIncludedFinalPrice = taxExcludedToTaxIncluded;

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function applyUserFinanceConfig(baseConfig = {}, userConfig = null) {
  const rateAdjustment = normalizeNullableNumber(userConfig?.rate_adjustment) || 0;
  const userBankFee = normalizeNullableNumber(userConfig?.bank_fee_jpy);
  const userHandlingFee = normalizeNullableNumber(userConfig?.handling_fee_cny);
  const userLargeAmountFee = normalizeNullableNumber(userConfig?.large_amount_fee_cny);
  const hasUserFinanceOverride = Boolean(userConfig) && (
    normalizeNullableNumber(userConfig.rate_adjustment) !== null ||
    userBankFee !== null ||
    userHandlingFee !== null ||
    userLargeAmountFee !== null
  );

  return {
    rate: Number((Number(baseConfig.rate || 0) + rateAdjustment).toFixed(4)),
    rateAdjustment,
    bankFeeJpy: userBankFee !== null ? userBankFee : Number(baseConfig.bankFeeJpy || 0),
    handlingFeeCny: userHandlingFee !== null ? userHandlingFee : Number(baseConfig.handlingFeeCny || 0),
    largeAmountFeeCny: userLargeAmountFee !== null ? userLargeAmountFee : Number(baseConfig.largeAmountFeeCny || 0),
    hasUserFinanceOverride
  };
}

function resolveSettlementOrderStatus(currentStatus) {
  return currentStatus === ORDER_STATUS_BUNDLE_COMPLETED || currentStatus === ORDER_STATUS_PENDING_SHIPMENT
    ? currentStatus
    : ORDER_STATUS_PENDING_SETTLEMENT;
}

function buildOrderSettlement({ order, baseConfig, userFinanceOverride }) {
  const effectiveShippingFeeText = getEffectiveShippingFeeText(order);
  if (!canSettleOrderShippingFee(order)) {
    const error = new Error('该订单运费无法确认，不能结算');
    error.statusCode = 400;
    throw error;
  }
  const effectiveConfig = applyUserFinanceConfig(baseConfig, userFinanceOverride);
  const payable = calculateOrderPayable({
    finalPrice: order.final_price,
    taxType: order.tax_type,
    shippingFeeText: effectiveShippingFeeText,
    config: effectiveConfig
  });

  return {
    shippingFeeJpy: payable.shippingFee,
    bankFeeJpy: payable.bankFeeJpy,
    handlingFeeCny: payable.handlingFeeCny,
    largeAmountFeeCny: payable.largeAmountFeeCny,
    largeAmountFeeApplied: payable.largeAmountFeeApplied,
    taxIncludedFinalPrice: payable.taxIncludedFinalPrice,
    jpyToCnyRate: payable.rate,
    rateAdjustment: effectiveConfig.rateAdjustment,
    hasUserFinanceOverride: effectiveConfig.hasUserFinanceOverride,
    payableCny: payable.payableCny
  };
}

function extractAuctionId(input) {
  const match = String(input || '').match(/[a-zA-Z]?\d{8,10}/);
  return match ? match[0].toLowerCase() : '';
}

function parseStoreBundleChildProductIds(input) {
  return [...new Set(String(input || '')
    .split(/[,，]/)
    .map(value => extractAuctionId(value) || String(value || '').trim().toLowerCase())
    .filter(Boolean))];
}

function normalizeBundleShippingFeeText(value) {
  const amount = Number(String(value ?? '').replace(/[^\d]/g, ''));
  if (!Number.isInteger(amount) || amount < 0) {
    const error = new Error('valid bundle shipping fee is required');
    error.statusCode = 400;
    throw error;
  }
  return `${amount}円`;
}

function buildStoreBundleGroupId(mainProductId, nowMs = Date.now()) {
  return `store-bundle-${String(mainProductId || '').toLowerCase()}-${nowMs}`;
}

function assertStoreBundleBackfillRows({ mainProductId, childProductIds, rows }) {
  const ids = [mainProductId, ...childProductIds];
  const byProductId = new Map((rows || []).map(row => [String(row.product_id || '').toLowerCase(), row]));
  const missing = ids.filter(id => !byProductId.has(id));
  if (missing.length) {
    const error = new Error(`商品不存在或不是落札订单：${missing.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
  const nonStore = ids.filter(id => byProductId.get(id)?.product_type !== 'store');
  if (nonStore.length) {
    const error = new Error(`只能补录商城商品：${nonStore.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
  const blocked = ids.filter(id => [ORDER_STATUS_COMPLETED, ORDER_STATUS_CANCELLED, ORDER_STATUS_PENDING_RECEIPT].includes(byProductId.get(id)?.order_status));
  if (blocked.length) {
    const error = new Error(`这些商品状态不能补录：${blocked.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
}

async function backfillStoreBundle(database, payload = {}, options = {}) {
  const mainProductId = extractAuctionId(payload.mainProductId || payload.main_product_id || '');
  const childProductIds = parseStoreBundleChildProductIds(payload.childProductIds || payload.child_product_ids || '');
  if (!mainProductId) {
    const error = new Error('mainProductId is required');
    error.statusCode = 400;
    throw error;
  }
  if (!childProductIds.length) {
    const error = new Error('childProductIds is required');
    error.statusCode = 400;
    throw error;
  }
  if (childProductIds.includes(mainProductId)) {
    const error = new Error('主商品不能同时作为子商品');
    error.statusCode = 400;
    throw error;
  }
  const bundleShippingFeeText = normalizeBundleShippingFeeText(payload.bundleShippingFee ?? payload.bundle_shipping_fee ?? payload.bundleShippingFeeText);
  const allProductIds = [mainProductId, ...childProductIds];
  const placeholders = allProductIds.map(() => '?').join(',');
  const rows = await database.getAll(
    `SELECT o.id AS order_id,
            o.order_status,
            t.product_id,
            COALESCE(t.product_type, CASE WHEN COALESCE(t.tax_type, 'tax_zero') = 'tax_included' THEN 'store' ELSE 'normal' END) AS product_type
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     WHERE LOWER(t.product_id) IN (${placeholders})
       AND t.status = 'success'`,
    allProductIds
  );
  assertStoreBundleBackfillRows({ mainProductId, childProductIds, rows });

  const byProductId = new Map(rows.map(row => [String(row.product_id || '').toLowerCase(), row]));
  const mainOrderId = byProductId.get(mainProductId).order_id;
  const childOrderIds = childProductIds.map(id => byProductId.get(id).order_id);
  const orderIds = [mainOrderId, ...childOrderIds];
  const bundleGroupId = String(payload.bundleGroupId || '').trim() || buildStoreBundleGroupId(mainProductId, options.nowMs || Date.now());
  const beforeRows = await getOrderStatusAuditRows(database, orderIds);

  await database.query(
    `UPDATE orders
     SET bundle_group_id = ?,
         bundle_shipping_fee_text = ?,
         order_status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [bundleGroupId, bundleShippingFeeText, ORDER_STATUS_PENDING_SHIPMENT, mainOrderId]
  );

  if (childOrderIds.length) {
    const childPlaceholders = childOrderIds.map(() => '?').join(',');
    await database.query(
      `UPDATE orders
       SET bundle_group_id = ?,
           bundle_shipping_fee_text = '0円',
           order_status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${childPlaceholders})`,
      [bundleGroupId, ORDER_STATUS_BUNDLE_COMPLETED, ...childOrderIds]
    );
  }

  const statusesByOrderId = {
    [mainOrderId]: ORDER_STATUS_PENDING_SHIPMENT,
    ...Object.fromEntries(childOrderIds.map(id => [id, ORDER_STATUS_BUNDLE_COMPLETED]))
  };
  await writeOrderStatusAuditLogs(database, beforeRows, {
    statusesByOrderId,
    source: 'admin_store_bundle_backfill',
    metadata: {
      mainProductId,
      childProductIds,
      bundleShippingFeeText,
      bundleGroupId
    }
  }).catch(() => null);

  return {
    mainProductId,
    childProductIds,
    bundleShippingFeeText,
    bundleGroupId,
    mainOrderId,
    childOrderIds,
    updated: orderIds.length
  };
}

router.post('/orders/settle', async (req, res) => {
  const orderIds = Array.isArray(req.body?.orderIds) ? req.body.orderIds.map(Number).filter(Number.isFinite) : [];
  const rate = Number(req.body?.rate);
  if (orderIds.length === 0) {
    return res.status(400).json({ error: 'orderIds is required' });
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    return res.status(400).json({ error: 'valid rate is required' });
  }

  const financeConfig = await getFinanceConfig();
  const baseConfig = { ...financeConfig, rate };
  const results = [];

  for (const orderId of orderIds) {
    const order = await db.getOne(
      `SELECT o.*, t.product_id, t.shipping_fee_text, t.tax_type, t.product_type, u.id AS user_id,
              ufo.rate_adjustment,
              ufo.bank_fee_jpy AS user_bank_fee_jpy,
              ufo.handling_fee_cny AS user_handling_fee_cny,
              ufo.large_amount_fee_cny AS user_large_amount_fee_cny
       FROM orders o
       INNER JOIN tasks t ON o.task_id = t.id
       LEFT JOIN users u ON t.user_id = u.id
       LEFT JOIN user_finance_overrides ufo ON ufo.user_id = u.id
       WHERE o.id = ? AND t.status = 'success'`,
      [orderId]
    );

    if (!order) {
      results.push({ orderId, success: false, error: '订单不存在' });
      continue;
    }

    try {
      const settlement = buildOrderSettlement({
        order,
        baseConfig,
        userFinanceOverride: {
          rate_adjustment: order.rate_adjustment,
          bank_fee_jpy: order.user_bank_fee_jpy,
          handling_fee_cny: order.user_handling_fee_cny,
          large_amount_fee_cny: order.user_large_amount_fee_cny
        }
      });
      const nextOrderStatus = resolveSettlementOrderStatus(order.order_status);
      const beforeRows = await getOrderStatusAuditRows(db, [orderId]);

      await db.query(
        `UPDATE orders
         SET jpy_to_cny_rate = ?,
             bank_fee_jpy = ?,
             handling_fee_cny = ?,
             large_amount_fee_cny = ?,
             large_amount_fee_applied = ?,
             tax_included_final_price = ?,
             has_user_finance_override = ?,
             total_amount_cny = ?,
             order_status = ?,
             settled_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          settlement.jpyToCnyRate,
          settlement.bankFeeJpy,
          settlement.handlingFeeCny,
          settlement.largeAmountFeeCny,
          settlement.largeAmountFeeApplied ? 1 : 0,
          settlement.taxIncludedFinalPrice,
          settlement.hasUserFinanceOverride ? 1 : 0,
          settlement.payableCny,
          nextOrderStatus,
          orderId
        ]
      );
      await writeOrderStatusAuditLogs(db, beforeRows, {
        status: nextOrderStatus,
        source: 'admin_settle',
        metadata: {
          rate,
          payableCny: settlement.payableCny
        }
      }).catch(() => null);

      results.push({ orderId, success: true, payableCny: settlement.payableCny });
    } catch (error) {
      results.push({ orderId, success: false, error: error.message || '结算失败' });
    }
  }

  res.json({
    success: results.some(item => item.success),
    settled: results.filter(item => item.success).length,
    failed: results.filter(item => !item.success).length,
    results
  });
});

router.post('/orders/store-bundle-backfill', async (req, res) => {
  try {
    const result = await backfillStoreBundle(db, req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || '商城同捆补录失败' });
  }
});

router.get('/finance-config', async (req, res) => {
  res.json(await getFinanceConfig());
});

router.put('/finance-config', async (req, res) => {
  const hasRate = req.body.rate !== undefined && req.body.rate !== null && req.body.rate !== '';
  const rate = hasRate ? Number(req.body.rate) : null;
  const bankFeeJpy = Number(req.body.bankFeeJpy);
  const handlingFeeCny = Number(req.body.handlingFeeCny);
  const largeAmountFeeCny = Number(req.body.largeAmountFeeCny ?? 0);
  if (hasRate && (!Number.isFinite(rate) || rate <= 0)) {
    return res.status(400).json({ error: 'valid rate is required' });
  }
  if (!Number.isFinite(bankFeeJpy) || bankFeeJpy < 0) {
    return res.status(400).json({ error: 'valid bankFeeJpy is required' });
  }
  if (!Number.isFinite(handlingFeeCny) || handlingFeeCny < 0) {
    return res.status(400).json({ error: 'valid handlingFeeCny is required' });
  }
  if (!Number.isFinite(largeAmountFeeCny) || largeAmountFeeCny < 0) {
    return res.status(400).json({ error: 'valid largeAmountFeeCny is required' });
  }
  if (hasRate) {
    await db.query(
      `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('jpy_to_cny_rate', ?, CURRENT_TIMESTAMP)`,
      [String(rate)]
    );
  }
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('bank_fee_jpy', ?, CURRENT_TIMESTAMP)`,
    [String(bankFeeJpy)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('handling_fee_cny', ?, CURRENT_TIMESTAMP)`,
    [String(handlingFeeCny)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('large_amount_fee_cny', ?, CURRENT_TIMESTAMP)`,
    [String(largeAmountFeeCny)]
  );
  res.json({ success: true, ...(hasRate ? { rate } : {}), bankFeeJpy, handlingFeeCny, largeAmountFeeCny });
});

router.get('/user-finance-overrides', async (req, res) => {
  const items = await db.getAll(
    `SELECT ufo.*, u.username
     FROM user_finance_overrides ufo
     INNER JOIN users u ON u.id = ufo.user_id
     WHERE u.role = 'user'
     ORDER BY u.username ASC`
  );
  res.json({ items });
});

router.post('/user-finance-overrides', async (req, res) => {
  try {
    const result = await saveUserFinanceOverride(req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'save failed' });
  }
});

router.put('/user-finance-overrides/:id', async (req, res) => {
  try {
    const result = await saveUserFinanceOverride({ ...req.body, id: req.params.id });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'save failed' });
  }
});

router.delete('/user-finance-overrides/:id', async (req, res) => {
  await db.query('DELETE FROM user_finance_overrides WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

async function saveUserFinanceOverride(body = {}) {
  const id = body.id ? Number(body.id) : null;
  const userId = Number(body.userId ?? body.user_id);
  const rateAdjustment = normalizeNullableNumber(body.rateAdjustment ?? body.rate_adjustment);
  const bankFeeJpy = normalizeNullableNumber(body.bankFeeJpy ?? body.bank_fee_jpy);
  const handlingFeeCny = normalizeNullableNumber(body.handlingFeeCny ?? body.handling_fee_cny);
  const largeAmountFeeCny = normalizeNullableNumber(body.largeAmountFeeCny ?? body.large_amount_fee_cny);

  if (!Number.isFinite(userId) || userId <= 0) {
    const error = new Error('valid userId is required');
    error.statusCode = 400;
    throw error;
  }
  for (const [name, value] of [
    ['bankFeeJpy', bankFeeJpy],
    ['handlingFeeCny', handlingFeeCny],
    ['largeAmountFeeCny', largeAmountFeeCny]
  ]) {
    if (value !== null && value < 0) {
      const error = new Error(`valid ${name} is required`);
      error.statusCode = 400;
      throw error;
    }
  }

  if (id) {
    await db.query(
      `UPDATE user_finance_overrides
       SET user_id = ?, rate_adjustment = ?, bank_fee_jpy = ?, handling_fee_cny = ?, large_amount_fee_cny = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [userId, rateAdjustment, bankFeeJpy, handlingFeeCny, largeAmountFeeCny, id]
    );
    return { id };
  }

  await db.query(
    `INSERT INTO user_finance_overrides (user_id, rate_adjustment, bank_fee_jpy, handling_fee_cny, large_amount_fee_cny)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       rate_adjustment = excluded.rate_adjustment,
       bank_fee_jpy = excluded.bank_fee_jpy,
       handling_fee_cny = excluded.handling_fee_cny,
       large_amount_fee_cny = excluded.large_amount_fee_cny,
       updated_at = CURRENT_TIMESTAMP`,
    [userId, rateAdjustment, bankFeeJpy, handlingFeeCny, largeAmountFeeCny]
  );
  const row = await db.getOne('SELECT id FROM user_finance_overrides WHERE user_id = ?', [userId]);
  return { id: row?.id };
}

async function getMultiBidConfig() {
  await applyGoogleSheetsConfigFromDb(db);
  const rows = await db.getAll(
    "SELECT key, value FROM config WHERE key IN ('multi_bid_start_hours', 'multi_bid_interval_minutes', 'idle_sync_interval_minutes', 'idle_bid_guard_minutes', 'multi_bid_min_price', 'transaction_start_hour', 'confirm_receipt_hour', 'confirm_receipt_color', 'scan_start_hour', 'scan_end_hour', 'scan_every_idle_runs', 'payment_job_limit', 'payment_job_limit_min', 'payment_job_limit_max', 'payment_page_stay_seconds')"
  );
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  const legacyPaymentJobLimit = normalizePositiveIntegerConfig(values.payment_job_limit, 3);
  const paymentJobLimitMin = normalizePositiveIntegerConfig(values.payment_job_limit_min, legacyPaymentJobLimit);
  const paymentJobLimitMax = normalizePositiveIntegerConfig(values.payment_job_limit_max, legacyPaymentJobLimit);
  return {
    startHours: Number(values.multi_bid_start_hours || 0.5),
    intervalMinutes: Number(values.multi_bid_interval_minutes || 5),
    idleSyncIntervalMinutes: Number(values.idle_sync_interval_minutes || 5),
    idleBidGuardMinutes: Number(values.idle_bid_guard_minutes || 10),
    multiBidMinPrice: Number(values.multi_bid_min_price || DEFAULT_MULTI_BID_MIN_PRICE),
    transactionStartHour: Number(values.transaction_start_hour ?? 1),
    confirmReceiptHour: Number(values.confirm_receipt_hour ?? DEFAULT_CONFIRM_RECEIPT_HOUR),
    confirmReceiptColor: normalizeReceiptColorConfig(values.confirm_receipt_color, DEFAULT_CONFIRM_RECEIPT_COLOR),
    scanStartHour: Number(values.scan_start_hour ?? 1),
    scanEndHour: Number(values.scan_end_hour ?? 20),
    scanEveryIdleRuns: Number(values.scan_every_idle_runs ?? 5),
    paymentJobLimit: legacyPaymentJobLimit,
    paymentJobLimitMin: Math.min(paymentJobLimitMin, paymentJobLimitMax),
    paymentJobLimitMax: Math.max(paymentJobLimitMin, paymentJobLimitMax),
    paymentPageStaySeconds: normalizePositiveIntegerConfig(values.payment_page_stay_seconds, 3),
    googleSheetUrl: buildGoogleSheetUrl(getSheetConfig().spreadsheetId),
    googleSheetName: getSheetConfig().sheetName,
    googleCredentialPath: getGoogleSheetsCredentialPath()
  };
}

function normalizePositiveIntegerConfig(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

router.get('/multi-bid-config', async (req, res) => {
  res.json(await getMultiBidConfig());
});

router.put('/multi-bid-config', async (req, res) => {
  const startHours = Number(req.body.startHours);
  const intervalMinutes = Number(req.body.intervalMinutes);
  const idleSyncIntervalMinutes = Number(req.body.idleSyncIntervalMinutes ?? 5);
  const idleBidGuardMinutes = Number(req.body.idleBidGuardMinutes ?? 10);
  const multiBidMinPrice = Number(req.body.multiBidMinPrice ?? DEFAULT_MULTI_BID_MIN_PRICE);
  const transactionStartHour = Number(req.body.transactionStartHour ?? 1);
  const confirmReceiptHour = Number(req.body.confirmReceiptHour ?? DEFAULT_CONFIRM_RECEIPT_HOUR);
  const confirmReceiptColor = normalizeReceiptColorConfig(req.body.confirmReceiptColor ?? DEFAULT_CONFIRM_RECEIPT_COLOR, '');
  const scanStartHour = Number(req.body.scanStartHour ?? 1);
  const scanEndHour = Number(req.body.scanEndHour ?? 20);
  const scanEveryIdleRuns = Number(req.body.scanEveryIdleRuns ?? 5);
  const legacyPaymentJobLimit = normalizePositiveIntegerConfig(req.body.paymentJobLimit ?? 3, 3);
  const paymentJobLimitMin = normalizePositiveIntegerConfig(req.body.paymentJobLimitMin ?? legacyPaymentJobLimit, legacyPaymentJobLimit);
  const paymentJobLimitMax = normalizePositiveIntegerConfig(req.body.paymentJobLimitMax ?? legacyPaymentJobLimit, legacyPaymentJobLimit);
  const paymentPageStaySeconds = normalizePositiveIntegerConfig(req.body.paymentPageStaySeconds ?? 3, 3);
  const googleConfigEditable = req.body.googleConfigEditable === true;
  const googleSheetId = extractSpreadsheetId(req.body.googleSheetUrl || '');
  const googleSheetName = String(req.body.googleSheetName || '').trim();
  const googleCredentialPath = String(req.body.googleCredentialPath || '').trim();
  if (!Number.isFinite(startHours) || startHours <= 0) {
    return res.status(400).json({ error: 'valid startHours is required' });
  }
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    return res.status(400).json({ error: 'valid intervalMinutes is required' });
  }
  if (!Number.isFinite(idleSyncIntervalMinutes) || idleSyncIntervalMinutes <= 0) {
    return res.status(400).json({ error: 'valid idleSyncIntervalMinutes is required' });
  }
  if (!Number.isFinite(idleBidGuardMinutes) || idleBidGuardMinutes <= 0) {
    return res.status(400).json({ error: 'valid idleBidGuardMinutes is required' });
  }
  if (!Number.isFinite(multiBidMinPrice) || multiBidMinPrice <= 0 || Math.floor(multiBidMinPrice) !== multiBidMinPrice) {
    return res.status(400).json({ error: 'valid multiBidMinPrice is required' });
  }
  for (const [name, value] of [
    ['transactionStartHour', transactionStartHour],
    ['confirmReceiptHour', confirmReceiptHour],
    ['scanStartHour', scanStartHour],
    ['scanEndHour', scanEndHour]
  ]) {
    if (!Number.isFinite(value) || value < 0 || value > 23 || Math.floor(value) !== value) {
      return res.status(400).json({ error: `valid ${name} is required` });
    }
  }
  if (!Number.isFinite(scanEveryIdleRuns) || scanEveryIdleRuns <= 0 || Math.floor(scanEveryIdleRuns) !== scanEveryIdleRuns) {
    return res.status(400).json({ error: 'valid scanEveryIdleRuns is required' });
  }
  if (!confirmReceiptColor) {
    return res.status(400).json({ error: 'valid confirmReceiptColor is required' });
  }
  if (paymentJobLimitMin > paymentJobLimitMax) {
    return res.status(400).json({ error: 'paymentJobLimitMin must be <= paymentJobLimitMax' });
  }
  if (googleConfigEditable && !googleSheetId) {
    return res.status(400).json({ error: 'valid googleSheetUrl is required' });
  }
  if (googleConfigEditable && !googleSheetName) {
    return res.status(400).json({ error: 'valid googleSheetName is required' });
  }
  if (googleConfigEditable && !googleCredentialPath) {
    return res.status(400).json({ error: 'valid googleCredentialPath is required' });
  }
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('multi_bid_start_hours', ?, CURRENT_TIMESTAMP)`,
    [String(startHours)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('multi_bid_interval_minutes', ?, CURRENT_TIMESTAMP)`,
    [String(intervalMinutes)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('idle_sync_interval_minutes', ?, CURRENT_TIMESTAMP)`,
    [String(idleSyncIntervalMinutes)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('idle_bid_guard_minutes', ?, CURRENT_TIMESTAMP)`,
    [String(idleBidGuardMinutes)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('multi_bid_min_price', ?, CURRENT_TIMESTAMP)`,
    [String(multiBidMinPrice)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('transaction_start_hour', ?, CURRENT_TIMESTAMP)`,
    [String(transactionStartHour)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('confirm_receipt_hour', ?, CURRENT_TIMESTAMP)`,
    [String(confirmReceiptHour)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('confirm_receipt_color', ?, CURRENT_TIMESTAMP)`,
    [confirmReceiptColor]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('scan_start_hour', ?, CURRENT_TIMESTAMP)`,
    [String(scanStartHour)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('scan_end_hour', ?, CURRENT_TIMESTAMP)`,
    [String(scanEndHour)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('scan_every_idle_runs', ?, CURRENT_TIMESTAMP)`,
    [String(scanEveryIdleRuns)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('payment_job_limit', ?, CURRENT_TIMESTAMP)`,
    [String(paymentJobLimitMax)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('payment_job_limit_min', ?, CURRENT_TIMESTAMP)`,
    [String(paymentJobLimitMin)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('payment_job_limit_max', ?, CURRENT_TIMESTAMP)`,
    [String(paymentJobLimitMax)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('payment_page_stay_seconds', ?, CURRENT_TIMESTAMP)`,
    [String(paymentPageStaySeconds)]
  );
  if (googleConfigEditable) {
    await db.query(
      `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('google_sheets_spreadsheet_id', ?, CURRENT_TIMESTAMP)`,
      [googleSheetId]
    );
    await db.query(
      `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('google_sheets_sheet_name', ?, CURRENT_TIMESTAMP)`,
      [googleSheetName]
    );
    await db.query(
      `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('google_application_credentials', ?, CURRENT_TIMESTAMP)`,
      [googleCredentialPath]
    );
    applyGoogleSheetsConfig({ googleSheetId, googleSheetName, googleCredentialPath });
  }
  res.json({ success: true, startHours, intervalMinutes, idleSyncIntervalMinutes, idleBidGuardMinutes, multiBidMinPrice, transactionStartHour, confirmReceiptHour, confirmReceiptColor, scanStartHour, scanEndHour, scanEveryIdleRuns, paymentJobLimit: paymentJobLimitMax, paymentJobLimitMin, paymentJobLimitMax, paymentPageStaySeconds, googleSheetName });
});

router.post('/transaction-start/request', async (req, res) => {
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('transaction_start_requested', '1', CURRENT_TIMESTAMP)`
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('transaction_start_requested_source', 'manual', CURRENT_TIMESTAMP)`
  );
  res.json({ success: true });
});

router.post('/confirm-receipt/request', async (req, res) => {
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('confirm_receipt_alert_message', '', CURRENT_TIMESTAMP)`
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('confirm_receipt_requested', '1', CURRENT_TIMESTAMP)`
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('confirm_receipt_requested_source', 'manual', CURRENT_TIMESTAMP)`
  );
  res.json({ success: true });
});

async function requestScan(database = db) {
  const row = await database.getOne(
    `SELECT value FROM config WHERE key = 'scan_every_idle_runs'`
  );
  const scanEveryIdleRuns = Math.max(1, Math.floor(Number(row?.value || 5) || 5));
  await database.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at)
     VALUES ('scan_idle_counter', ?, CURRENT_TIMESTAMP)`,
    [String(scanEveryIdleRuns)]
  );
  return { scanIdleCounter: scanEveryIdleRuns };
}

async function saveConfigValue(database, key, value) {
  const allowedKeys = new Set([
    'payment_requested',
    'payment_alert_message',
    'scan_idle_counter',
    'transaction_start_requested',
    'transaction_start_requested_source'
  ]);
  if (!allowedKeys.has(key)) {
    throw new Error('invalid config key');
  }
  await database.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('${key}', ?, CURRENT_TIMESTAMP)`,
    [String(value)]
  );
}

async function requestPayment(database = db, orderIds = []) {
  const ids = Array.isArray(orderIds) ? orderIds.map(Number).filter(id => Number.isInteger(id) && id > 0) : [];
  if (!ids.length) {
    const error = new Error('orderIds is required');
    error.statusCode = 400;
    throw error;
  }
  const placeholders = ids.map(() => '?').join(',');
  const result = await database.query(
    `UPDATE orders
     SET order_status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id IN (${placeholders})
       AND order_status = ?
       AND total_amount_cny IS NOT NULL`,
    [ORDER_STATUS_PENDING_SETTLEMENT, ...ids, ORDER_STATUS_PENDING_SETTLEMENT]
  );
  if ((result.rowCount || 0) > 0) {
    await saveConfigValue(database, 'payment_requested', '1');
  }
  return { requested: result.rowCount || 0 };
}

async function clearPaymentAlertAndContinue(database = db) {
  await saveConfigValue(database, 'payment_alert_message', '');
  await saveConfigValue(database, 'payment_requested', '1');
  return { success: true };
}

function normalizeImportDate(value, fallback = '') {
  const text = String(value || fallback || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function normalizeImportMaxPages(value) {
  const num = Math.floor(Number(value || 10));
  if (!Number.isFinite(num) || num <= 0) return 10;
  return Math.min(50, Math.max(1, num));
}

function normalizeImportProductId(value) {
  const match = String(value || '').match(/[a-zA-Z]?\d{8,10}/);
  return match ? match[0].toLowerCase() : '';
}

function normalizeImportYenAmount(value) {
  const match = String(value || '').match(/(\d[\d,]*)/);
  return match ? Number(match[1].replace(/,/g, '')) || 0 : 0;
}

async function createManualOrderImportBatch(payload = {}, database = db) {
  const startDate = normalizeImportDate(payload.startDate || payload.start_date);
  const endDate = normalizeImportDate(payload.endDate || payload.end_date);
  if (!startDate || !endDate) {
    const error = new Error('valid startDate and endDate are required');
    error.statusCode = 400;
    throw error;
  }
  if (startDate > endDate) {
    const error = new Error('startDate must be <= endDate');
    error.statusCode = 400;
    throw error;
  }
  const maxPages = normalizeImportMaxPages(payload.maxPages || payload.max_pages);
  const result = await database.query(
    `INSERT INTO manual_order_import_batches
       (start_date, end_date, max_pages, status, created_at, updated_at)
     VALUES (?, ?, ?, 'requested', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [startDate, endDate, maxPages]
  );
  const row = await database.getOne('SELECT last_insert_rowid() AS id');
  return { id: row?.id, startDate, endDate, maxPages, requested: result.rowCount || 0 };
}

async function getManualOrderImportBatch(batchId, database = db) {
  const id = Number(batchId || 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  return await database.getOne(
    `SELECT * FROM manual_order_import_batches WHERE id = ?`,
    [id]
  );
}

async function listManualOrderImportBatches(database = db) {
  return await database.getAll(
    `SELECT *
     FROM manual_order_import_batches
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT 20`
  );
}

async function listManualOrderImportItems(batchId, database = db) {
  return await database.getAll(
    `SELECT i.*, u.username AS assigned_username
     FROM manual_order_import_items i
     LEFT JOIN users u ON u.id = i.assigned_user_id
     WHERE i.batch_id = ?
     ORDER BY datetime(COALESCE(i.won_at, i.created_at)) DESC, i.id ASC`,
    [batchId]
  );
}

function normalizeManualOrderImportSummary(summary = {}) {
  const requested = Number(summary?.requested || 0);
  const scanning = Number(summary?.scanning || 0);
  return {
    flag: requested + scanning > 0 ? 1 : 0,
    requested,
    scanning,
    ready: Number(summary?.ready || 0),
    readyEmpty: Number(summary?.ready_empty || summary?.readyEmpty || 0)
  };
}

async function confirmManualOrderImport(batchId, assignments = [], database = db) {
  const batch = await getManualOrderImportBatch(batchId, database);
  if (!batch) {
    const error = new Error('import batch not found');
    error.statusCode = 404;
    throw error;
  }
  if (!['ready', 'confirmed'].includes(String(batch.status || ''))) {
    const error = new Error('import batch is not ready');
    error.statusCode = 400;
    throw error;
  }

  for (const item of Array.isArray(assignments) ? assignments : []) {
    const itemId = Number(item?.itemId || item?.id || 0);
    const userId = Number(item?.userId || item?.assignedUserId || 0);
    const shippingFeeText = String(item?.shippingFeeText ?? item?.shipping_fee_text ?? '').trim();
    if (!Number.isInteger(itemId) || itemId <= 0) continue;
    if (!Number.isInteger(userId) || userId <= 0) {
      if (shippingFeeText) {
        await database.query(
          `UPDATE manual_order_import_items
           SET shipping_fee_text = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND batch_id = ? AND status = 'pending_user'`,
          [shippingFeeText, itemId, batch.id]
        );
      }
      continue;
    }
    const assignableUser = await database.getOne(
      `SELECT id FROM users
       WHERE id = ? AND role = 'user' AND COALESCE(user_level, 1) < 3`,
      [userId]
    );
    if (!assignableUser) {
      const error = new Error('assigned user must be normal or agent user');
      error.statusCode = 400;
      throw error;
    }
    await database.query(
      `UPDATE manual_order_import_items
       SET assigned_user_id = ?, shipping_fee_text = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND batch_id = ? AND status = 'pending_user'`,
      [userId, shippingFeeText, itemId, batch.id]
    );
  }

  const unassigned = await database.getOne(
    `SELECT COUNT(*) AS count
     FROM manual_order_import_items
     WHERE batch_id = ? AND status = 'pending_user' AND assigned_user_id IS NULL`,
    [batch.id]
  );
  const skippedUnassigned = Number(unassigned?.count || 0);
  if (skippedUnassigned > 0) {
    await database.query(
      `UPDATE manual_order_import_items
       SET status = 'skipped_unassigned', updated_at = CURRENT_TIMESTAMP
       WHERE batch_id = ? AND status = 'pending_user' AND assigned_user_id IS NULL`,
      [batch.id]
    );
  }

  const items = await database.getAll(
    `SELECT *
     FROM manual_order_import_items
     WHERE batch_id = ? AND status = 'pending_user' AND assigned_user_id IS NOT NULL
     ORDER BY id ASC`,
    [batch.id]
  );
  let imported = 0;
  let skippedExisting = 0;

  for (const item of items) {
    const productId = normalizeImportProductId(item.product_id);
    if (!productId || !item.assigned_user_id) continue;
    const existing = await database.getOne(
      `SELECT o.id
       FROM orders o
       INNER JOIN tasks t ON t.id = o.task_id
       WHERE t.product_id = ?
       LIMIT 1`,
      [productId]
    );
    if (existing) {
      skippedExisting += 1;
      await database.query(
        `UPDATE manual_order_import_items
         SET status = 'skipped_existing', order_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [existing.id, item.id]
      );
      continue;
    }
    const importProductUrl = item.product_url || `https://auctions.yahoo.co.jp/jp/auction/${productId}`;
    const importFinalPrice = normalizeImportYenAmount(item.final_price);
    await upsertProductSnapshot(database, {
      product_id: productId,
      product_url: importProductUrl,
      product_title: item.product_title || productId,
      product_image_url: item.product_image_url || '',
      current_price: importFinalPrice,
      tax_type: item.tax_type || 'tax_zero',
      product_type: item.product_type || 'normal',
      shipping_fee_text: item.shipping_fee_text || '',
      end_time: null
    }, { source: 'fetch' });
    await database.query(
      `INSERT INTO tasks
        (user_id, product_id, product_url, product_title, product_image_url,
         current_price, max_price, user_max_price, tax_type, product_type,
         strategy, bid_mode, status, shipping_fee_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual_import', 'manual_import', 'success', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        item.assigned_user_id,
        productId,
        importProductUrl,
        item.product_title || productId,
        item.product_image_url || '',
        importFinalPrice,
        importFinalPrice,
        importFinalPrice,
        item.tax_type || 'tax_zero',
        item.product_type || 'normal',
        item.shipping_fee_text || ''
      ]
    );
    const taskRow = await database.getOne('SELECT last_insert_rowid() AS id');
    await database.query(
      `INSERT INTO orders
        (task_id, product_id, product_title, product_url, final_price, won_at, won_time_text,
         transaction_url, order_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        taskRow.id,
        productId,
        item.product_title || productId,
        importProductUrl,
        importFinalPrice,
        item.won_at || null,
        item.won_time_text || null,
        item.transaction_url || null
      ]
    );
    const orderRow = await database.getOne('SELECT last_insert_rowid() AS id');
    await database.query(
      `UPDATE manual_order_import_items
       SET status = 'imported', task_id = ?, order_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [taskRow.id, orderRow.id, item.id]
    );
    imported += 1;
  }

  await database.query(
    `UPDATE manual_order_import_batches
     SET status = 'confirmed',
         skipped_existing_count = COALESCE(skipped_existing_count, 0) + ?,
         confirmed_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [skippedExisting, batch.id]
  );
  await saveConfigValue(database, 'transaction_start_requested', '1');
  await saveConfigValue(database, 'transaction_start_requested_source', 'manual');
  return { imported, skippedExisting, skippedUnassigned };
}

router.post('/scan/request', async (req, res) => {
  const result = await requestScan(db);
  res.json({ success: true, ...result });
});

router.post('/payment/request', async (req, res) => {
  try {
    const result = await requestPayment(db, req.body?.orderIds || []);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'payment request failed' });
  }
});

router.post('/payment/continue', async (req, res) => {
  const result = await clearPaymentAlertAndContinue(db);
  res.json(result);
});

router.post('/manual-order-import/request', async (req, res) => {
  try {
    const result = await createManualOrderImportBatch(req.body || {}, db);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'manual order import request failed' });
  }
});

router.get('/manual-order-import/batches', async (req, res) => {
  const items = await listManualOrderImportBatches(db);
  res.json({ success: true, items });
});

router.get('/manual-order-import/batches/:id', async (req, res) => {
  const batch = await getManualOrderImportBatch(req.params.id, db);
  if (!batch) return res.status(404).json({ error: 'import batch not found' });
  const items = await listManualOrderImportItems(batch.id, db);
  res.json({ success: true, batch, items });
});

router.post('/manual-order-import/batches/:id/confirm', async (req, res) => {
  try {
    const result = await confirmManualOrderImport(req.params.id, req.body?.assignments || [], db);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'manual order import confirm failed' });
  }
});

router.post('/manual-captcha/answer', async (req, res) => {
  try {
    const challenge = await answerCaptchaChallenge(db, req.body || {});
    res.json({ success: true, id: challenge.id, answeredAt: challenge.answeredAt });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'captcha answer failed' });
  }
});

router.post('/manual-captcha/close', async (req, res) => {
  const result = await closeCaptchaChallenge(db, req.body?.id || '');
  res.json({ success: true, ...result });
});

router.get('/idle-flags', async (req, res) => {
  await ensureScheduledTransactionStartRequest(db);
  await ensureScheduledConfirmReceiptRequest(db);
  const rows = await db.getAll(
    `SELECT key, value, updated_at FROM config
     WHERE key IN (
       'transaction_start_hour',
       'transaction_start_requested',
       'transaction_start_last_run_date',
       'transaction_start_last_run_slot',
       'transaction_start_last_run_log',
       'confirm_receipt_hour',
       'confirm_receipt_requested',
       'confirm_receipt_last_run_slot',
       'confirm_receipt_alert_message',
       'scan_every_idle_runs',
       'scan_idle_counter',
       'payment_requested',
       'payment_alert_message',
       'shipment_alerts'
     )`
  );
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  const updatedAt = Object.fromEntries(rows.map(row => [row.key, row.updated_at]));
  const today = getLocalDateKey();
  const transactionStartHour = Number(values.transaction_start_hour ?? 1);
  const transactionStartRequested = Number(values.transaction_start_requested || 0) === 1;
  const transactionStartLastRunDate = values.transaction_start_last_run_date || '';
  let transactionStartLastRunLog = null;
  try {
    transactionStartLastRunLog = values.transaction_start_last_run_log
      ? JSON.parse(values.transaction_start_last_run_log)
      : null;
  } catch {
    transactionStartLastRunLog = null;
  }
  const transactionStartFlag = transactionStartRequested || shouldAutoRequestTransactionStart({
    transactionStartHour,
    transactionStartHourUpdatedAt: updatedAt.transaction_start_hour || '',
    transactionStartLastRunSlot: values.transaction_start_last_run_slot || '',
    transactionStartLastRunLog: values.transaction_start_last_run_log || ''
  }) ? 1 : 0;
  const confirmReceiptHour = Number(values.confirm_receipt_hour ?? DEFAULT_CONFIRM_RECEIPT_HOUR);
  const confirmReceiptRequested = Number(values.confirm_receipt_requested || 0) === 1;
  const confirmReceiptFlag = confirmReceiptRequested || shouldAutoRequestConfirmReceipt({
    confirmReceiptHour,
    confirmReceiptHourUpdatedAt: updatedAt.confirm_receipt_hour || '',
    confirmReceiptLastRunSlot: values.confirm_receipt_last_run_slot || ''
  }) ? 1 : 0;
  const scanEveryIdleRuns = Math.max(1, Number(values.scan_every_idle_runs || 5));
  const scanIdleCounter = Math.max(0, Number(values.scan_idle_counter || 0));
  const manualImportSummary = await db.getOne(
    `SELECT
       SUM(CASE WHEN status = 'requested' THEN 1 ELSE 0 END) AS requested,
       SUM(CASE WHEN status = 'scanning' THEN 1 ELSE 0 END) AS scanning,
       SUM(CASE WHEN status = 'ready' AND COALESCE(candidate_count, 0) > 0 THEN 1 ELSE 0 END) AS ready,
       SUM(CASE WHEN status = 'ready' AND COALESCE(candidate_count, 0) = 0 THEN 1 ELSE 0 END) AS ready_empty
     FROM manual_order_import_batches
     WHERE status IN ('requested', 'scanning', 'ready')`
  );
  const manualImportFlags = normalizeManualOrderImportSummary(manualImportSummary);

  res.json({
    success: true,
    transactionStartFlag,
    transactionStartRequested: transactionStartRequested ? 1 : 0,
    transactionStartHour,
    transactionStartLastRunDate,
    transactionStartLastRunLog,
    confirmReceiptFlag,
    confirmReceiptRequested: confirmReceiptRequested ? 1 : 0,
    confirmReceiptHour,
    confirmReceiptAlertMessage: values.confirm_receipt_alert_message || '',
    scanFlag: scanIdleCounter,
    scanEveryIdleRuns,
    manualOrderImportFlag: manualImportFlags.flag,
    manualOrderImportRequested: manualImportFlags.requested,
    manualOrderImportScanning: manualImportFlags.scanning,
    manualOrderImportReady: manualImportFlags.ready,
    manualOrderImportReadyEmpty: manualImportFlags.readyEmpty,
    paymentFlag: Number(values.payment_requested || 0) === 1 ? 1 : 0,
    paymentAlertMessage: values.payment_alert_message || '',
    captchaChallenge: await getCaptchaChallenge(db),
    shipmentAlerts: (await getShipmentAlerts(db)).filter(alert => !alert.closedAt && !alert.autoClosedAt)
  });
});

router.post('/shipment-alerts/:id/close', async (req, res) => {
  const alertId = String(req.params.id || '').trim();
  if (!alertId) return res.status(400).json({ error: 'alert id is required' });
  const alerts = await getShipmentAlerts(db);
  let closed = 0;
  const next = alerts.map(alert => {
    if (alert.id !== alertId || alert.closedAt || alert.autoClosedAt) return alert;
    closed += 1;
    return { ...alert, closedAt: new Date().toISOString() };
  });
  if (closed) {
    await db.query(
      `INSERT OR REPLACE INTO config (key, value, updated_at)
       VALUES ('shipment_alerts', ?, CURRENT_TIMESTAMP)`,
      [JSON.stringify(next)]
    );
  }
  res.json({ success: true, closed });
});

function parseShippingRefreshIds(value) {
  const seen = new Set();
  return String(value || '')
    .split(/\r?\n|,|，/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => normalizeAuctionUrl(item)?.auctionId || '')
    .filter(id => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function normalizeProductType(value) {
  if (value === 'normal' || value === 'store') return value;
  if (value === 'tax_zero') return 'normal';
  if (value === 'tax_included') return 'store';
  return '';
}

function buildPlaceholders(values) {
  return values.map(() => '?').join(',');
}

async function deleteProductDataByProductId(database, productId) {
  const normalizedProductId = normalizeAuctionUrl(productId)?.auctionId || String(productId || '').trim();
  if (!normalizedProductId) {
    return { productId: '', success: false, error: '商品 ID 无效' };
  }

  const tasks = await database.getAll(
    'SELECT id FROM tasks WHERE product_id = ? ORDER BY id ASC',
    [normalizedProductId]
  );
  const taskIds = tasks.map(task => task.id).filter(id => id !== null && id !== undefined);
  let orderIds = [];
  let orderStatusLogCount = 0;
  let bidLogCount = 0;
  let orderCount = 0;
  let biddingItemCount = 0;
  let taskCount = 0;
  let productCount = 0;

  if (taskIds.length > 0) {
    const taskPlaceholders = buildPlaceholders(taskIds);
    const orders = await database.getAll(
      `SELECT id FROM orders WHERE task_id IN (${taskPlaceholders})`,
      taskIds
    );
    orderIds = orders.map(order => order.id).filter(id => id !== null && id !== undefined);
  }

  if (orderIds.length > 0) {
    const orderPlaceholders = buildPlaceholders(orderIds);
    orderStatusLogCount = (await database.query(
      `DELETE FROM order_status_change_logs
       WHERE product_id = ?
          OR order_id IN (${orderPlaceholders})`,
      [normalizedProductId, ...orderIds]
    )).rowCount || 0;
  } else {
    orderStatusLogCount = (await database.query(
      'DELETE FROM order_status_change_logs WHERE product_id = ?',
      [normalizedProductId]
    )).rowCount || 0;
  }

  if (taskIds.length > 0) {
    const taskPlaceholders = buildPlaceholders(taskIds);
    bidLogCount = (await database.query(
      `DELETE FROM bid_logs WHERE task_id IN (${taskPlaceholders})`,
      taskIds
    )).rowCount || 0;
    orderCount = (await database.query(
      `DELETE FROM orders WHERE task_id IN (${taskPlaceholders})`,
      taskIds
    )).rowCount || 0;
  }

  biddingItemCount = (await database.query(
    'DELETE FROM bidding_items WHERE product_id = ?',
    [normalizedProductId]
  )).rowCount || 0;

  if (taskIds.length > 0) {
    const taskPlaceholders = buildPlaceholders(taskIds);
    taskCount = (await database.query(
      `DELETE FROM tasks WHERE id IN (${taskPlaceholders})`,
      taskIds
    )).rowCount || 0;
  }

  productCount = (await database.query(
    'DELETE FROM products WHERE product_id = ?',
    [normalizedProductId]
  )).rowCount || 0;

  const totalCount = taskCount + orderCount + bidLogCount + biddingItemCount + orderStatusLogCount + productCount;
  return {
    productId: normalizedProductId,
    success: totalCount > 0,
    taskIds,
    orderIds,
    taskCount,
    orderCount,
    bidLogCount,
    biddingItemCount,
    productCount,
    orderStatusLogCount,
    totalCount,
    error: totalCount > 0 ? undefined : '系统中没有这个商品数据'
  };
}

router.post('/shipping-refresh/run', async (req, res) => {
  const productIds = Array.isArray(req.body?.productIds)
    ? parseShippingRefreshIds(req.body.productIds.join('\n'))
    : parseShippingRefreshIds(req.body?.productIdsText || req.body?.productIds || '');
  if (productIds.length === 0) {
    return res.status(400).json({ error: 'productIds is required' });
  }

  const results = [];
  for (const productId of productIds) {
    const taskCount = await db.getOne('SELECT COUNT(*) AS count FROM tasks WHERE product_id = ?', [productId]);
    if (!taskCount?.count) {
      results.push({ productId, success: false, error: '系统中没有这个商品' });
      continue;
    }

    try {
      const product = await productService.fetchProduct(`https://auctions.yahoo.co.jp/jp/auction/${productId}`);
      const shippingFeeText = String(product?.data?.shippingFeeText || '').trim();
      if (!shippingFeeText) {
        results.push({ productId, success: false, error: '未解析到运费，未更新' });
        continue;
      }
      const updateResult = await db.query(
        `UPDATE tasks
         SET shipping_fee_text = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE product_id = ?`,
        [shippingFeeText, productId]
      );
      results.push({
        productId,
        success: true,
        shippingFeeText,
        updatedCount: updateResult.rowCount || 0
      });
    } catch (err) {
      results.push({ productId, success: false, error: err.message || '运费更新失败' });
    }
  }

  res.json({
    success: true,
    results,
    updated: results.filter(item => item.success).length,
    failed: results.filter(item => !item.success).length
  });
});

router.post('/product-type-refresh/run', async (req, res) => {
  const productIds = Array.isArray(req.body?.productIds)
    ? parseShippingRefreshIds(req.body.productIds.join('\n'))
    : parseShippingRefreshIds(req.body?.productIdsText || req.body?.productIds || '');
  if (productIds.length === 0) {
    return res.status(400).json({ error: 'productIds is required' });
  }

  const results = [];
  for (const productId of productIds) {
    const taskCount = await db.getOne('SELECT COUNT(*) AS count FROM tasks WHERE product_id = ?', [productId]);
    if (!taskCount?.count) {
      results.push({ productId, success: false, error: '系统中没有这个商品' });
      continue;
    }

    try {
      const product = await productService.fetchProduct(`https://auctions.yahoo.co.jp/jp/auction/${productId}`);
      const productType = normalizeProductType(product?.data?.productType || product?.data?.taxType);
      if (!productType) {
        results.push({ productId, success: false, error: '未解析到商品类型，未更新' });
        continue;
      }
      const updateResult = await db.query(
        `UPDATE tasks
         SET product_type = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE product_id = ?`,
        [productType, productId]
      );
      results.push({
        productId,
        success: true,
        productType,
        productTypeText: productType === 'store' ? '商城商品' : '普通商品',
        updatedCount: updateResult.rowCount || 0
      });
    } catch (err) {
      results.push({ productId, success: false, error: err.message || '商品类型更新失败' });
    }
  }

  res.json({
    success: true,
    results,
    updated: results.filter(item => item.success).length,
    failed: results.filter(item => !item.success).length
  });
});

router.post('/receipt-sheet-backfill/run', async (req, res) => {
  const limit = Math.max(1, Math.min(500, Math.floor(Number(req.body?.limit || 100))));
  const rows = await db.getAll(
    `SELECT o.id AS order_id,
            t.product_id,
            o.bundle_group_id
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     WHERE o.order_status = 'pending_receipt'
       AND o.google_sheet_appended_at IS NULL
     ORDER BY datetime(COALESCE(o.shipped_at, o.updated_at, o.created_at)) ASC, o.id ASC
     LIMIT ?`,
    [limit]
  );
  const processedBundleGroups = new Set();
  const results = [];
  for (const row of rows) {
    if (row.bundle_group_id && processedBundleGroups.has(row.bundle_group_id)) {
      results.push({
        orderId: row.order_id,
        productId: row.product_id,
        success: true,
        skipped: true,
        reason: '同捆组已随主商品处理'
      });
      continue;
    }
    try {
      const appendResult = await appendPendingReceiptOrderToGoogleSheet(row.order_id, db);
      if (row.bundle_group_id && !appendResult?.skipped) processedBundleGroups.add(row.bundle_group_id);
      results.push({
        orderId: row.order_id,
        productId: row.product_id,
        success: !appendResult?.skipped,
        skipped: appendResult?.skipped === true,
        reason: appendResult?.reason || '',
        appendedRows: appendResult?.appendedRows || 0,
        updatedRange: appendResult?.updatedRange || ''
      });
    } catch (err) {
      results.push({
        orderId: row.order_id,
        productId: row.product_id,
        success: false,
        error: err.message || '待收货补表格失败'
      });
    }
  }
  res.json({
    success: true,
    results,
    total: rows.length,
    appended: results.filter(item => item.success && !item.skipped).length,
    skipped: results.filter(item => item.skipped).length,
    failed: results.filter(item => !item.success && !item.skipped).length
  });
});

router.post('/orders-resync/run', async (req, res) => {
  const productIds = Array.isArray(req.body?.productIds)
    ? parseShippingRefreshIds(req.body.productIds.join('\n'))
    : parseShippingRefreshIds(req.body?.productIdsText || req.body?.productIds || '');
  if (productIds.length === 0) {
    return res.status(400).json({ error: 'productIds is required' });
  }

  const results = [];
  for (const productId of productIds) {
    const task = await db.getOne(
      `SELECT id, status FROM tasks
       WHERE product_id = ?
       ORDER BY datetime(COALESCE(last_bid_at, updated_at, created_at)) DESC, id DESC
       LIMIT 1`,
      [productId]
    );
    if (!task) {
      results.push({ productId, success: false, error: '系统中没有这个商品' });
      continue;
    }
    // 标记任务下次插件 /orders/sync 时强制覆盖；处理后插件路由会自动清除标记。
    const updateResult = await db.query(
      `UPDATE tasks
       SET force_orders_resync = 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [task.id]
    );
    const existingOrder = await db.getOne('SELECT id FROM orders WHERE task_id = ?', [task.id]);
    results.push({
      productId,
      success: true,
      taskId: task.id,
      taskStatus: task.status,
      hasExistingOrder: Boolean(existingOrder),
      markedCount: updateResult.rowCount || 0
    });
  }

  res.json({
    success: true,
    results,
    queued: results.filter(item => item.success).length,
    failed: results.filter(item => !item.success).length
  });
});

router.post('/product-data-delete/run', async (req, res) => {
  const productIds = Array.isArray(req.body?.productIds)
    ? parseShippingRefreshIds(req.body.productIds.join('\n'))
    : parseShippingRefreshIds(req.body?.productIdsText || req.body?.productIds || '');
  if (productIds.length === 0) {
    return res.status(400).json({ error: 'productIds is required' });
  }

  const results = [];
  for (const productId of productIds) {
    results.push(await deleteProductDataByProductId(db, productId));
  }

  res.json({
    success: true,
    results,
    deleted: results.filter(item => item.success).length,
    failed: results.filter(item => !item.success).length,
    totalDeletedRows: results.reduce((sum, item) => sum + Number(item.totalCount || 0), 0)
  });
});

router.post('/order-status-refresh/run', async (req, res) => {
  let targetOrderStatus;
  try {
    targetOrderStatus = normalizeOrderStatusRefreshTarget(req.body?.orderStatus);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const productIds = Array.isArray(req.body?.productIds)
    ? parseShippingRefreshIds(req.body.productIds.join('\n'))
    : parseShippingRefreshIds(req.body?.productIdsText || req.body?.productIds || '');
  if (productIds.length === 0) {
    return res.status(400).json({ error: 'productIds is required' });
  }

  const results = [];
  for (const productId of productIds) {
    const orders = await db.getAll(
      `SELECT o.id AS order_id, o.order_status, t.id AS task_id
       FROM orders o
       INNER JOIN tasks t ON o.task_id = t.id
       WHERE t.product_id = ?
       ORDER BY datetime(COALESCE(o.won_at, o.created_at)) DESC, o.id DESC`,
      [productId]
    );
    if (!orders.length) {
      results.push({ productId, success: false, error: '系统中没有这个商品订单' });
      continue;
    }

    const orderIds = orders.map(order => order.order_id);
    const beforeRows = await getOrderStatusAuditRows(db, orderIds);
    const updateResult = await db.query(
      `UPDATE orders
       SET order_status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${orders.map(() => '?').join(',')})`,
      [targetOrderStatus, ...orderIds]
    );
    if (updateResult.rowCount) {
      await writeOrderStatusAuditLogs(db, beforeRows, {
        status: targetOrderStatus,
        source: 'admin_order_status_refresh',
        metadata: { productId, orderStatus: req.body?.orderStatus || '' }
      }).catch(() => null);
    }
    results.push({
      productId,
      success: true,
      orderIds,
      updatedCount: updateResult.rowCount || 0,
      orderStatus: targetOrderStatus,
      orderStatusText: getOrderStatusRefreshText(targetOrderStatus)
    });
  }

  res.json({
    success: true,
    results,
    updated: results.filter(item => item.success).length,
    failed: results.filter(item => !item.success).length
  });
});

router.get('/data-cleanup/config', async (req, res) => {
  res.json(await getDataCleanupConfig(db));
});

router.put('/data-cleanup/config', async (req, res) => {
  const cleanupHour = Number(req.body.cleanupHour);
  const retentionDays = Number(req.body.retentionDays);
  if (!Number.isFinite(cleanupHour) || cleanupHour < 0 || cleanupHour > 23 || Math.floor(cleanupHour) !== cleanupHour) {
    return res.status(400).json({ error: 'valid cleanupHour is required' });
  }
  if (!Number.isFinite(retentionDays) || retentionDays < 1 || Math.floor(retentionDays) !== retentionDays) {
    return res.status(400).json({ error: 'valid retentionDays is required' });
  }
  const saved = await saveDataCleanupConfig(db, {
    enabled: Boolean(req.body.enabled),
    cleanupHour,
    retentionDays
  });
  res.json({ success: true, ...saved });
});

router.post('/data-cleanup/run', async (req, res) => {
  const config = await getDataCleanupConfig(db);
  const retentionDays = Number(req.body?.retentionDays || config.retentionDays);
  if (!Number.isFinite(retentionDays) || retentionDays < 1 || Math.floor(retentionDays) !== retentionDays) {
    return res.status(400).json({ error: 'valid retentionDays is required' });
  }
  const result = await deleteStaleTaskData(db, {
    retentionDays,
    runType: 'manual'
  });
  res.json({ success: true, ...result });
});

router.get('/data-cleanup/logs', async (req, res) => {
  const current = Math.max(parseInt(req.query.current || '1', 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '10', 10) || 10, 1), 100);
  const offset = (current - 1) * pageSize;
  const items = await db.getAll(
    `SELECT *
     FROM data_cleanup_logs
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT ? OFFSET ?`,
    [pageSize, offset]
  );
  const countResult = await db.getOne('SELECT COUNT(*) AS total FROM data_cleanup_logs');
  res.json({ items, total: countResult?.total || 0 });
});

// 操作日志
router.get('/logs', async (req, res) => {
  const { current = 1, pageSize = 50 } = req.query;
  const offset = (current - 1) * pageSize;
  const items = await db.getAll(
    `SELECT bl.*, t.product_title, ya.account_name
     FROM bid_logs bl
     LEFT JOIN tasks t ON bl.task_id = t.id
     LEFT JOIN yahoo_accounts ya ON bl.account_id = ya.id
     ORDER BY bl.created_at DESC
     LIMIT ? OFFSET ?`,
    [pageSize, offset]
  );
  res.json({ items });
});

module.exports = router;
module.exports.applyUserFinanceConfig = applyUserFinanceConfig;
module.exports.buildOrderSettlement = buildOrderSettlement;
module.exports.buildAdminOrdersListQuery = buildAdminOrdersListQuery;
module.exports.buildAdminOrdersUserWonDateRangeQuery = buildAdminOrdersUserWonDateRangeQuery;
module.exports.mapAdminOrderListItem = mapAdminOrderListItem;
module.exports.calculateOrderPayable = calculateOrderPayable;
module.exports.canSettleShippingFeeText = canSettleShippingFeeText;
module.exports.ORDER_STATUS_PENDING_SETTLEMENT = ORDER_STATUS_PENDING_SETTLEMENT;
module.exports.ORDER_STATUS_COMPLETED = ORDER_STATUS_COMPLETED;
module.exports.ORDER_STATUS_PENDING_PAYMENT = ORDER_STATUS_PENDING_PAYMENT;
module.exports.ORDER_STATUS_BUNDLE_COMPLETED = ORDER_STATUS_BUNDLE_COMPLETED;
module.exports.ORDER_STATUS_PENDING_SHIPMENT = ORDER_STATUS_PENDING_SHIPMENT;
module.exports.getEffectiveShippingFeeText = getEffectiveShippingFeeText;
module.exports.resolveSettlementOrderStatus = resolveSettlementOrderStatus;
module.exports.normalizeOrderStatusRefreshTarget = normalizeOrderStatusRefreshTarget;
module.exports.normalizeProductType = normalizeProductType;
module.exports.parseShippingFeeToNumber = parseShippingFeeToNumber;
module.exports.parseStoreBundleChildProductIds = parseStoreBundleChildProductIds;
module.exports.backfillStoreBundle = backfillStoreBundle;
module.exports.deleteProductDataByProductId = deleteProductDataByProductId;
module.exports.createManualOrderImportBatch = createManualOrderImportBatch;
module.exports.confirmManualOrderImport = confirmManualOrderImport;
module.exports.normalizeManualOrderImportSummary = normalizeManualOrderImportSummary;
module.exports.requestScan = requestScan;
module.exports.requestPayment = requestPayment;
module.exports.clearPaymentAlertAndContinue = clearPaymentAlertAndContinue;
module.exports.normalizePositiveIntegerConfig = normalizePositiveIntegerConfig;
module.exports.normalizeBidStrategyScope = normalizeBidStrategyScope;
module.exports.buildGoogleSheetUrl = buildGoogleSheetUrl;
