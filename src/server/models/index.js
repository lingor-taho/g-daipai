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
