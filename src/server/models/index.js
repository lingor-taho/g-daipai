const Database = require('better-sqlite3');
const path = require('path');
const config = require('../../config');

const dbPath = config.databaseUrl.replace('sqlite:', '').replace('//', '');
const db = new Database(path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath));

// 启用外键约束
db.pragma('foreign_keys = ON');

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
