const { getOrderStatusAuditRows, writeOrderStatusAuditLogs } = require('./orderStatusAudit');
const { ORDER_STATUS_PAUSED } = require('../../shared/domainConstants.cjs');

const PAUSE_DURATION_HOURS = 24;

function normalizeOrderId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error('valid order id is required');
    error.statusCode = 400;
    throw error;
  }
  return id;
}

async function setOrderPaused(database, { orderId, pause, userId = null, source = 'admin_order_pause' }) {
  const id = normalizeOrderId(orderId);
  const ownerId = userId === null ? null : Number(userId);
  if (userId !== null && (!Number.isInteger(ownerId) || ownerId <= 0)) {
    const error = new Error('not logged in');
    error.statusCode = 401;
    throw error;
  }
  const beforeRows = await getOrderStatusAuditRows(database, [id]);
  const ownerSql = ownerId === null ? '' : ` AND EXISTS (
    SELECT 1 FROM tasks owner_task WHERE owner_task.id = orders.task_id AND owner_task.user_id = ?
  )`;
  const productSql = ` AND EXISTS (
    SELECT 1 FROM tasks product_task
    LEFT JOIN products p ON p.product_id = product_task.product_id
    WHERE product_task.id = orders.task_id
      AND COALESCE(p.product_type, CASE WHEN COALESCE(p.tax_type, 'tax_zero') = 'tax_included' THEN 'store' ELSE 'normal' END) = 'normal'
  )`;
  const result = pause
    ? await database.query(
      `UPDATE orders
       SET order_status = ?, paused_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND (order_status IS NULL OR order_status = '')${productSql}${ownerSql}`,
      [ORDER_STATUS_PAUSED, id, ...(ownerId === null ? [] : [ownerId])]
    )
    : await database.query(
      `UPDATE orders
       SET order_status = NULL, paused_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND order_status = ?${productSql}${ownerSql}`,
      [id, ORDER_STATUS_PAUSED, ...(ownerId === null ? [] : [ownerId])]
    );
  if (!result.rowCount) {
    const error = new Error(pause ? '仅普通商品且订单状态为空时可暂停' : '该订单当前不是暂停状态');
    error.statusCode = 409;
    throw error;
  }
  await writeOrderStatusAuditLogs(database, beforeRows, {
    status: pause ? ORDER_STATUS_PAUSED : null,
    source
  }).catch(() => null);
  const order = await database.getOne('SELECT order_status, paused_at FROM orders WHERE id = ?', [id]);
  return { orderId: id, orderStatus: order?.order_status || null, pausedAt: order?.paused_at || null };
}

async function expirePausedOrders(database, nowMs = Date.now()) {
  const cutoff = new Date(nowMs - PAUSE_DURATION_HOURS * 60 * 60 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');
  const rows = await database.getAll(
    `SELECT id, paused_at FROM orders
     WHERE order_status = ? AND paused_at IS NOT NULL AND paused_at <= ?`,
    [ORDER_STATUS_PAUSED, cutoff]
  );
  let expired = 0;
  for (const row of rows) {
    const beforeRows = await getOrderStatusAuditRows(database, [row.id]);
    const result = await database.query(
      `UPDATE orders
       SET order_status = NULL, paused_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND order_status = ? AND paused_at = ? AND paused_at <= ?`,
      [row.id, ORDER_STATUS_PAUSED, row.paused_at, cutoff]
    );
    if (!result.rowCount) continue;
    expired += 1;
    await writeOrderStatusAuditLogs(database, beforeRows, {
      status: null,
      source: 'transaction_start_pause_expired',
      metadata: { pausedAt: row.paused_at, pauseDurationHours: PAUSE_DURATION_HOURS }
    }).catch(() => null);
  }
  return { expired };
}

async function checkTransactionStartEligibility(database, { orderId, productIds = [] }) {
  const id = normalizeOrderId(orderId);
  const order = await database.getOne(
    `SELECT o.order_status,
            COALESCE(p.product_type, CASE WHEN COALESCE(p.tax_type, 'tax_zero') = 'tax_included' THEN 'store' ELSE 'normal' END) AS product_type
     FROM orders o
     INNER JOIN tasks t ON t.id = o.task_id
     LEFT JOIN products p ON p.product_id = t.product_id
     WHERE o.id = ?`,
    [id]
  );
  if (!order || (order.order_status !== null && order.order_status !== '') || order.product_type !== 'normal') {
    return { eligible: false, reason: 'order status changed' };
  }
  const ids = [...new Set((Array.isArray(productIds) ? productIds : [])
    .map(value => String(value || '').trim().toLowerCase()).filter(Boolean))];
  if (ids.length) {
    const paused = await database.getOne(
      `SELECT o.id FROM orders o
       INNER JOIN tasks t ON t.id = o.task_id
       WHERE LOWER(t.product_id) IN (${ids.map(() => '?').join(',')})
         AND o.order_status = ? LIMIT 1`,
      [...ids, ORDER_STATUS_PAUSED]
    );
    if (paused) return { eligible: false, reason: 'bundle contains paused order' };
  }
  return { eligible: true };
}

module.exports = { ORDER_STATUS_PAUSED, setOrderPaused, expirePausedOrders, checkTransactionStartEligibility };
