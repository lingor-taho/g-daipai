const Database = require('better-sqlite3');
const path = require('path');
const config = require('../../config');

const dbPath = config.databaseUrl.replace('sqlite:', '').replace('//', '');
const db = new Database(path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath));

// 启用外键约束
db.pragma('foreign_keys = ON');

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(col => col.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

ensureColumn('tasks', 'buyout_price', 'INTEGER');
ensureColumn('tasks', 'bid_mode', "VARCHAR(32) DEFAULT 'bid'");
ensureColumn('tasks', 'tax_type', "VARCHAR(32) DEFAULT 'tax_zero'");
ensureColumn('tasks', 'product_type', "VARCHAR(32) DEFAULT 'normal'");
ensureColumn('tasks', 'bid_count', 'INTEGER DEFAULT 0');
ensureColumn('tasks', 'user_max_price', 'INTEGER');
ensureColumn('tasks', 'multi_bid_increment', 'INTEGER');
ensureColumn('tasks', 'client_request_id', 'VARCHAR(128)');
ensureColumn('tasks', 'shipping_fee_text', 'VARCHAR(64)');
ensureColumn('tasks', 'pending_followup_max_price', 'INTEGER');
ensureColumn('tasks', 'force_orders_resync', 'INTEGER DEFAULT 0');
ensureColumn('orders', 'won_at', 'DATETIME');
ensureColumn('orders', 'won_time_text', 'VARCHAR(64)');
ensureColumn('orders', 'bank_fee_jpy', 'INTEGER');
ensureColumn('orders', 'handling_fee_cny', 'DECIMAL(10,2)');
ensureColumn('orders', 'large_amount_fee_cny', 'DECIMAL(10,2)');
ensureColumn('orders', 'large_amount_fee_applied', 'INTEGER');
ensureColumn('orders', 'tax_included_final_price', 'INTEGER');
ensureColumn('orders', 'has_user_finance_override', 'INTEGER');
ensureColumn('orders', 'settled_at', 'DATETIME');
ensureColumn('orders', 'updated_at', 'DATETIME');
db.prepare("UPDATE orders SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL").run();
ensureColumn('orders', 'bundle_shipping_fee_text', 'VARCHAR(64)');
ensureColumn('orders', 'transaction_url', 'TEXT');
ensureColumn('orders', 'bundle_group_id', 'VARCHAR(64)');
ensureColumn('orders', 'transaction_started_at', 'DATETIME');
ensureColumn('orders', 'transaction_start_error', 'TEXT');
ensureColumn('orders', 'shipping_company', 'VARCHAR(128)');
ensureColumn('orders', 'google_sheet_appended_at', 'DATETIME');
ensureColumn('users', 'user_level', 'INTEGER DEFAULT 1');
ensureColumn('users', 'parent_user_id', 'INTEGER');
ensureColumn('users', 'bid_strategy_scope', "VARCHAR(32) DEFAULT 'all'");

db.prepare(`
  CREATE TABLE IF NOT EXISTS bidding_items (
    product_id VARCHAR(32) PRIMARY KEY,
    product_url TEXT,
    product_title VARCHAR(512),
    product_image_url TEXT,
    current_price INTEGER,
    status VARCHAR(32) NOT NULL,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS data_cleanup_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_type VARCHAR(32) NOT NULL,
    local_date VARCHAR(10),
    retention_days INTEGER NOT NULL,
    cutoff_at DATETIME,
    task_count INTEGER DEFAULT 0,
    bid_log_count INTEGER DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    bidding_item_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS user_finance_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    rate_adjustment DECIMAL(10,4),
    bank_fee_jpy INTEGER,
    handling_fee_cny DECIMAL(10,2),
    large_amount_fee_cny DECIMAL(10,2),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS order_status_change_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id VARCHAR(32),
    old_status VARCHAR(32),
    new_status VARCHAR(32),
    source VARCHAR(64) NOT NULL,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  )
`).run();

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_order_status_change_logs_order
  ON order_status_change_logs(order_id, created_at)
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS manual_order_import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date VARCHAR(10) NOT NULL,
    end_date VARCHAR(10) NOT NULL,
    max_pages INTEGER DEFAULT 10,
    status VARCHAR(32) DEFAULT 'requested',
    error_msg TEXT,
    scanned_pages INTEGER DEFAULT 0,
    scanned_count INTEGER DEFAULT 0,
    candidate_count INTEGER DEFAULT 0,
    skipped_existing_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    scanned_at DATETIME,
    confirmed_at DATETIME
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS manual_order_import_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    product_id VARCHAR(32) NOT NULL,
    product_url TEXT,
    product_title VARCHAR(512),
    product_image_url TEXT,
    final_price INTEGER,
    won_at DATETIME,
    won_time_text VARCHAR(64),
    transaction_url TEXT,
    shipping_fee_text VARCHAR(64),
    tax_type VARCHAR(32) DEFAULT 'tax_zero',
    product_type VARCHAR(32) DEFAULT 'normal',
    assigned_user_id INTEGER,
    status VARCHAR(32) DEFAULT 'pending_user',
    task_id INTEGER,
    order_id INTEGER,
    error_msg TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id) REFERENCES manual_order_import_batches(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_user_id) REFERENCES users(id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
  )
`).run();

db.prepare(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_order_import_items_batch_product
  ON manual_order_import_items(batch_id, product_id)
`).run();

module.exports = {
  db,
  async query(text, params) {
    const stmt = db.prepare(text);
    const result = params ? stmt.run(...params) : stmt.run();
    return { rows: [], rowCount: result.changes };
  },
  async getOne(text, params) {
    const stmt = db.prepare(text);
    return params ? stmt.get(...params) : stmt.get();
  },
  async getAll(text, params) {
    const stmt = db.prepare(text);
    return params ? stmt.all(...params) : stmt.all();
  },
  raw: db
};
