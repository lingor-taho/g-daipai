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
  isMultiBidTask
} = require('./plugin');

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
  if (Number(parent.user_level || 1) <= level) {
    const err = new Error('parent user level must be higher than child level');
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
  stats.yahooLogin = {
    status: loginStatus?.value === 'failed' ? 'failed' : 'ok',
    message: loginMessage?.value || '',
    updatedAt: loginStatus?.updated_at || null
  };
  res.json(stats);
});

// 订单管理
router.get('/orders', async (req, res) => {
  const { current = 1, pageSize = 10 } = req.query;
  const offset = (current - 1) * pageSize;
  const financeConfig = await getFinanceConfig();
  const items = await db.getAll(
    `SELECT o.*, t.product_id
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     WHERE t.status = 'success'
     ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
    [pageSize, offset]
  );
  const countResult = await db.getOne(`
    SELECT COUNT(*) as total
    FROM orders o
    INNER JOIN tasks t ON o.task_id = t.id
    WHERE t.status = 'success'
  `);
  const mappedItems = items.map(item => {
    const finalPrice = Number(item.final_price || 0);
    const handlingFeeJpy = Number(item.handling_fee || financeConfig.handlingFeeJpy || 0);
    const rate = Number(item.jpy_to_cny_rate || financeConfig.rate || 0);
    return {
      ...item,
      product_id: item.product_id || extractAuctionId(item.product_url) || '',
      handling_fee_jpy: handlingFeeJpy,
      jpy_to_cny_rate: rate,
      payable_cny: Number(((finalPrice + handlingFeeJpy) * rate).toFixed(2))
    };
  });
  res.json({ items: mappedItems, total: countResult?.total || 0, financeConfig });
});

// 财务统计
router.get('/orders/stats', async (req, res) => {
  const stats = await db.getOne(`
    SELECT
      COUNT(*) as total_orders,
      COALESCE(SUM(final_price), 0) as total_jpy,
      COALESCE(SUM(total_amount_cny), 0) as total_cny
    FROM orders
    INNER JOIN tasks t ON orders.task_id = t.id
    WHERE t.status = 'success'
  `);
  res.json(stats);
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

function extractAuctionId(input) {
  const match = String(input || '').match(/[a-zA-Z]?\d{8,10}/);
  return match ? match[0].toLowerCase() : '';
}

router.get('/finance-config', async (req, res) => {
  res.json(await getFinanceConfig());
});

router.put('/finance-config', async (req, res) => {
  const rate = Number(req.body.rate);
  const handlingFeeJpy = Number(req.body.handlingFeeJpy);
  if (!Number.isFinite(rate) || rate <= 0) {
    return res.status(400).json({ error: 'valid rate is required' });
  }
  if (!Number.isFinite(handlingFeeJpy) || handlingFeeJpy < 0) {
    return res.status(400).json({ error: 'valid handlingFeeJpy is required' });
  }
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('jpy_to_cny_rate', ?, CURRENT_TIMESTAMP)`,
    [String(rate)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('handling_fee_jpy', ?, CURRENT_TIMESTAMP)`,
    [String(handlingFeeJpy)]
  );
  res.json({ success: true, rate, handlingFeeJpy });
});

async function getMultiBidConfig() {
  const rows = await db.getAll(
    "SELECT key, value FROM config WHERE key IN ('multi_bid_start_hours', 'multi_bid_interval_minutes', 'idle_sync_interval_minutes')"
  );
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  return {
    startHours: Number(values.multi_bid_start_hours || 0.5),
    intervalMinutes: Number(values.multi_bid_interval_minutes || 5),
    idleSyncIntervalMinutes: Number(values.idle_sync_interval_minutes || 5)
  };
}

router.get('/multi-bid-config', async (req, res) => {
  res.json(await getMultiBidConfig());
});

router.put('/multi-bid-config', async (req, res) => {
  const startHours = Number(req.body.startHours);
  const intervalMinutes = Number(req.body.intervalMinutes);
  const idleSyncIntervalMinutes = Number(req.body.idleSyncIntervalMinutes ?? 5);
  if (!Number.isFinite(startHours) || startHours <= 0) {
    return res.status(400).json({ error: 'valid startHours is required' });
  }
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    return res.status(400).json({ error: 'valid intervalMinutes is required' });
  }
  if (!Number.isFinite(idleSyncIntervalMinutes) || idleSyncIntervalMinutes <= 0) {
    return res.status(400).json({ error: 'valid idleSyncIntervalMinutes is required' });
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
  res.json({ success: true, startHours, intervalMinutes, idleSyncIntervalMinutes });
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

