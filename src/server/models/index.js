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
ensureColumn('tasks', 'user_max_price', 'INTEGER');
ensureColumn('tasks', 'multi_bid_increment', 'INTEGER');
ensureColumn('tasks', 'client_request_id', 'VARCHAR(128)');
ensureColumn('tasks', 'shipping_fee_text', 'VARCHAR(64)');
ensureColumn('users', 'user_level', 'INTEGER DEFAULT 1');
ensureColumn('users', 'parent_user_id', 'INTEGER');

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
  }
};
