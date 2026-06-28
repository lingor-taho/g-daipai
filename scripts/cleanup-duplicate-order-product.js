const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function normalizeProductId(value) {
  const match = String(value || '').match(/[a-zA-Z]?\d{8,10}/);
  return match ? match[0].toLowerCase() : '';
}

function resolveDatabasePath() {
  const raw = String(process.env.DATABASE_URL || 'sqlite:./data/gdaipai.db').trim();
  const relative = raw.startsWith('sqlite:') ? raw.slice('sqlite:'.length) : raw;
  return path.resolve(path.join(__dirname, '..'), relative);
}

function formatRow(row) {
  return JSON.stringify(row, null, 2);
}

function scoreOrder(row) {
  let score = 0;
  if (Number(row.bid_log_count || 0) > 0) score += 1000;
  if (row.last_bid_at) score += 500;
  if (Number(row.is_highest_bidder || 0) === 1) score += 300;
  if (row.bid_mode === 'buyout') score += 100;
  if (row.order_status === 'pending_payment') score += 50;
  if (row.order_status === 'pending_shipment') score += 40;
  if (row.order_status === 'pending_receipt') score += 30;
  if (row.order_status === 'completed') score += 20;
  score += Math.min(Number(row.task_id || 0), 999999) / 1000000;
  return score;
}

function createBackup(dbPath) {
  const backupDir = path.join(path.dirname(dbPath), '..', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const backupPath = path.join(backupDir, `gdaipai-before-duplicate-order-cleanup-${stamp}.db`);
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function printUsageAndExit() {
  console.log('Usage: node scripts/cleanup-duplicate-order-product.js <productId> --apply');
  console.log('Example: node scripts/cleanup-duplicate-order-product.js m1235180746 --apply');
  process.exit(1);
}

const productId = normalizeProductId(process.argv[2] || 'm1235180746');
const apply = process.argv.includes('--apply');
if (!productId) printUsageAndExit();

const dbPath = resolveDatabasePath();
if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const orderRows = db.prepare(`
  SELECT o.id AS order_id,
         o.task_id,
         o.product_id,
         o.order_status,
         o.final_price,
         o.won_at,
         o.won_time_text,
         o.transaction_url,
         o.created_at AS order_created_at,
         o.updated_at AS order_updated_at,
         t.status AS task_status,
         t.bid_mode,
         t.strategy,
         t.is_highest_bidder,
         t.last_bid_at,
         t.error_msg,
         t.created_at AS task_created_at,
         t.updated_at AS task_updated_at,
         u.username,
         (
           SELECT COUNT(*)
           FROM bid_logs bl
           WHERE bl.task_id = o.task_id
             AND bl.error_msg IS NULL
         ) AS bid_log_count
  FROM orders o
  LEFT JOIN tasks t ON t.id = o.task_id
  LEFT JOIN users u ON u.id = t.user_id
  WHERE COALESCE(o.product_id, t.product_id) = ?
  ORDER BY o.id ASC
`).all(productId);

const taskRows = db.prepare(`
  SELECT t.id AS task_id,
         t.product_id,
         t.status,
         t.bid_mode,
         t.strategy,
         t.is_highest_bidder,
         t.last_bid_at,
         t.error_msg,
         t.created_at,
         t.updated_at,
         u.username,
         (
           SELECT COUNT(*)
           FROM bid_logs bl
           WHERE bl.task_id = t.id
             AND bl.error_msg IS NULL
         ) AS bid_log_count
  FROM tasks t
  LEFT JOIN users u ON u.id = t.user_id
  WHERE t.product_id = ?
  ORDER BY t.id ASC
`).all(productId);

console.log(`Database: ${dbPath}`);
console.log(`Product: ${productId}`);
console.log('');
console.log(`Orders (${orderRows.length}):`);
for (const row of orderRows) console.log(formatRow({ ...row, keep_score: scoreOrder(row) }));
console.log('');
console.log(`Tasks (${taskRows.length}):`);
for (const row of taskRows) console.log(formatRow(row));

if (orderRows.length <= 1) {
  console.log('');
  console.log('No duplicate orders found. Nothing to clean.');
  db.close();
  process.exit(0);
}

const sorted = [...orderRows].sort((a, b) => {
  const diff = scoreOrder(b) - scoreOrder(a);
  if (diff) return diff;
  return Number(b.order_id || 0) - Number(a.order_id || 0);
});
const keep = sorted[0];
const duplicates = orderRows.filter(row => row.order_id !== keep.order_id);

console.log('');
console.log(`Will keep order ${keep.order_id} (task ${keep.task_id || '-'})`);
console.log(`Will delete duplicate order ids: ${duplicates.map(row => row.order_id).join(', ')}`);
console.log(`Will mark duplicate success task ids as failed when they are not the kept task: ${duplicates.map(row => row.task_id).filter(Boolean).join(', ') || '-'}`);

if (!apply) {
  console.log('');
  console.log('Dry run only. Re-run with --apply to modify the database.');
  db.close();
  process.exit(0);
}

const backupPath = createBackup(dbPath);
console.log('');
console.log(`Backup created: ${backupPath}`);

const cleanup = db.transaction(() => {
  const duplicateOrderIds = duplicates.map(row => row.order_id);
  const duplicateTaskIds = duplicates
    .map(row => Number(row.task_id || 0))
    .filter(taskId => taskId && taskId !== Number(keep.task_id || 0));

  const deleteOrderLog = db.prepare('DELETE FROM order_status_change_logs WHERE order_id = ?');
  const deleteTradeMessage = db.prepare('DELETE FROM yahoo_trade_messages WHERE order_id = ?');
  const clearManualImportOrder = db.prepare('UPDATE manual_order_import_items SET order_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?');
  const deleteOrder = db.prepare('DELETE FROM orders WHERE id = ?');

  for (const orderId of duplicateOrderIds) {
    deleteOrderLog.run(orderId);
    deleteTradeMessage.run(orderId);
    clearManualImportOrder.run(orderId);
    deleteOrder.run(orderId);
  }

  const markTaskFailed = db.prepare(`
    UPDATE tasks
    SET status = 'failed',
        is_highest_bidder = 0,
        error_msg = COALESCE(NULLIF(error_msg, ''), 'duplicate order cleanup: Yahoo won record belongs to another task'),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status = 'success'
  `);
  for (const taskId of duplicateTaskIds) {
    markTaskFailed.run(taskId);
  }

  const remainingDuplicates = db.prepare(`
    SELECT product_id, COUNT(*) AS count
    FROM orders
    WHERE product_id IS NOT NULL
      AND TRIM(product_id) <> ''
    GROUP BY product_id
    HAVING COUNT(*) > 1
    LIMIT 1
  `).get();

  if (!remainingDuplicates) {
    db.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_product_id
      ON orders(product_id)
      WHERE product_id IS NOT NULL AND TRIM(product_id) <> ''
    `).run();
  }

  return {
    deletedOrders: duplicateOrderIds,
    failedTasks: duplicateTaskIds,
    uniqueIndexCreated: !remainingDuplicates,
    remainingDuplicateProduct: remainingDuplicates || null
  };
});

const result = cleanup();
console.log('');
console.log('Cleanup result:');
console.log(formatRow(result));
db.close();
