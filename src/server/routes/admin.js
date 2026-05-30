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
  DEFAULT_MULTI_BID_MIN_PRICE
} = require('./plugin');
const { productService, normalizeAuctionUrl } = require('./proxy');
const { buildYahooLoginStatus } = require('../services/yahooLoginStatus');
const {
  deleteStaleTaskData,
  getDataCleanupConfig,
  saveDataCleanupConfig
} = require('../services/dataCleanup');

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

router.get('/users', async (req, res) => {
  const { current = 1, pageSize = 10 } = req.query;
  const offset = (current - 1) * pageSize;
  const items = await db.getAll(
    `SELECT u.id,
            u.username,
            u.role,
            COALESCE(u.user_level, 1) AS user_level,
            u.parent_user_id,
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
    `SELECT id, username, COALESCE(user_level, 1) AS user_level, parent_user_id
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
    'INSERT INTO users (username, password_hash, role, user_level, parent_user_id) VALUES (?, ?, ?, ?, ?)',
    [username, hash, 'user', hierarchy.userLevel, hierarchy.parentUserId]
  );
  const inserted = await db.getOne('SELECT last_insert_rowid() as id');
  res.json({ success: true, id: inserted.id });
});

router.put('/users/:id', async (req, res) => {
  const { username, password, user_level, parent_user_id } = req.body;
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
      "UPDATE users SET username = ?, password_hash = ?, role = 'user', user_level = ?, parent_user_id = ? WHERE id = ? AND role = 'user'",
      [username, hash, hierarchy.userLevel, hierarchy.parentUserId, req.params.id]
    );
  } else {
    await db.query(
      "UPDATE users SET username = ?, role = 'user', user_level = ?, parent_user_id = ? WHERE id = ? AND role = 'user'",
      [username, hierarchy.userLevel, hierarchy.parentUserId, req.params.id]
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
  const items = await db.getAll(
    `SELECT o.*, t.product_id, t.shipping_fee_text, t.tax_type, u.id AS user_id, u.username,
            ufo.rate_adjustment,
            ufo.bank_fee_jpy AS user_bank_fee_jpy,
            ufo.handling_fee_cny AS user_handling_fee_cny,
            ufo.large_amount_fee_cny AS user_large_amount_fee_cny
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     LEFT JOIN users u ON t.user_id = u.id
     LEFT JOIN user_finance_overrides ufo ON ufo.user_id = u.id
     WHERE t.status = 'success'
     ORDER BY datetime(COALESCE(o.won_at, o.created_at)) DESC, o.id DESC LIMIT ? OFFSET ?`,
    [pageSize, offset]
  );
  const countResult = await db.getOne(`
    SELECT COUNT(*) as total
    FROM orders o
    INNER JOIN tasks t ON o.task_id = t.id
    WHERE t.status = 'success'
  `);
  const mappedItems = items.map(item => {
    const settled = Boolean(item.settled_at);
    return {
      ...item,
      username: item.username || '-',
      product_id: item.product_id || extractAuctionId(item.product_url) || '',
      shipping_fee_text: item.shipping_fee_text || '-',
      can_settle: canSettleShippingFeeText(item.shipping_fee_text),
      shipping_fee_jpy: settled ? parseShippingFeeToNumber(item.shipping_fee_text) : null,
      bank_fee_jpy: settled ? item.bank_fee_jpy : null,
      handling_fee_cny: settled ? item.handling_fee_cny : null,
      large_amount_fee_cny: settled ? item.large_amount_fee_cny : null,
      large_amount_fee_applied: settled ? Boolean(item.large_amount_fee_applied) : null,
      tax_included_final_price: settled ? item.tax_included_final_price : null,
      jpy_to_cny_rate: settled ? item.jpy_to_cny_rate : null,
      rate_adjustment: settled ? item.rate_adjustment : null,
      has_user_finance_override: settled ? Boolean(item.has_user_finance_override) : null,
      payable_cny: settled ? item.total_amount_cny : null,
      order_status: settled ? item.order_status : null
    };
  });
  res.json({ items: mappedItems, total: countResult?.total || 0 });
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

function getTaxIncludedFinalPrice(finalPrice, taxType) {
  const value = Number(finalPrice || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (taxType !== 'tax_included' || value < 10) return Math.floor(value);
  return Math.floor(value * 1.1);
}

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

function calculateOrderPayable({ finalPrice, taxType, shippingFeeText, config }) {
  const finalPriceValue = Number(finalPrice || 0);
  const shippingFee = parseShippingFeeToNumber(shippingFeeText);
  const rate = Number(config?.rate || 0);
  const bankFeeJpy = Number(config?.bankFeeJpy || 0);
  const handlingFeeCny = Number(config?.handlingFeeCny || 0);
  const taxIncludedFinalPrice = getTaxIncludedFinalPrice(finalPriceValue, taxType);
  const largeAmountFeeApplied = taxIncludedFinalPrice >= 30000;
  const largeAmountFeeCny = largeAmountFeeApplied ? Number(config?.largeAmountFeeCny || 0) : 0;
  const payableCny = Number((((finalPriceValue + shippingFee + bankFeeJpy) * rate) + handlingFeeCny + largeAmountFeeCny).toFixed(2));

  return {
    finalPrice: finalPriceValue,
    taxIncludedFinalPrice,
    shippingFee,
    rate,
    bankFeeJpy,
    handlingFeeCny,
    largeAmountFeeCny,
    largeAmountFeeApplied,
    payableCny
  };
}

function canSettleShippingFeeText(shippingFeeText) {
  const text = String(shippingFeeText || '').trim();
  if (!text || text === '-') return false;
  if (/無料/i.test(text)) return true;
  return /(\d[\d,]*)\s*円/.test(text);
}

function buildOrderSettlement({ order, baseConfig, userFinanceOverride }) {
  if (!canSettleShippingFeeText(order?.shipping_fee_text)) {
    const error = new Error('该订单运费无法确认，不能结算');
    error.statusCode = 400;
    throw error;
  }
  const effectiveConfig = applyUserFinanceConfig(baseConfig, userFinanceOverride);
  const payable = calculateOrderPayable({
    finalPrice: order.final_price,
    taxType: order.tax_type,
    shippingFeeText: order.shipping_fee_text,
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

function parseShippingFeeToNumber(shippingFeeText) {
  const text = String(shippingFeeText || '').trim();
  if (!text || text === '-') return 0;
  if (/無料|着払い|落札者負担/i.test(text)) return 0;
  const match = text.match(/(\d[\d,]*)\s*円/);
  return match ? Number(match[1].replace(/,/g, '')) : 0;
}

function extractAuctionId(input) {
  const match = String(input || '').match(/[a-zA-Z]?\d{8,10}/);
  return match ? match[0].toLowerCase() : '';
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
      `SELECT o.*, t.product_id, t.shipping_fee_text, t.tax_type, u.id AS user_id,
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
             order_status = 'pending_payment',
             settled_at = CURRENT_TIMESTAMP
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
          orderId
        ]
      );

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
  const rows = await db.getAll(
    "SELECT key, value FROM config WHERE key IN ('multi_bid_start_hours', 'multi_bid_interval_minutes', 'idle_sync_interval_minutes', 'idle_bid_guard_minutes', 'multi_bid_min_price')"
  );
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  return {
    startHours: Number(values.multi_bid_start_hours || 0.5),
    intervalMinutes: Number(values.multi_bid_interval_minutes || 5),
    idleSyncIntervalMinutes: Number(values.idle_sync_interval_minutes || 5),
    idleBidGuardMinutes: Number(values.idle_bid_guard_minutes || 10),
    multiBidMinPrice: Number(values.multi_bid_min_price || DEFAULT_MULTI_BID_MIN_PRICE)
  };
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
  res.json({ success: true, startHours, intervalMinutes, idleSyncIntervalMinutes, idleBidGuardMinutes, multiBidMinPrice });
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
module.exports.calculateOrderPayable = calculateOrderPayable;
module.exports.canSettleShippingFeeText = canSettleShippingFeeText;
module.exports.parseShippingFeeToNumber = parseShippingFeeToNumber;
