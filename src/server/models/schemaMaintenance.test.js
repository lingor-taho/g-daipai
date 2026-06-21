const assert = require('assert');
const Database = require('better-sqlite3');
const { relaxTasksProductUrlNotNull } = require('./schemaMaintenance');

function getColumn(database, name) {
  return database.prepare('PRAGMA table_info(tasks)').all().find(column => column.name === name);
}

function run() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username VARCHAR(64)
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      product_id VARCHAR(32) NOT NULL,
      product_url TEXT NOT NULL,
      product_title VARCHAR(512),
      max_price INTEGER NOT NULL,
      status VARCHAR(32) DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_tasks_status ON tasks(status);
    CREATE INDEX idx_tasks_user_id ON tasks(user_id);
    INSERT INTO users (id, username) VALUES (1, 'u1'), (2, 'u2');
    INSERT INTO tasks (user_id, product_id, product_url, max_price)
    VALUES (1, 'a123', 'https://auctions.yahoo.co.jp/jp/auction/a123', 1000);
  `);

  assert.strictEqual(getColumn(db, 'product_url').notnull, 1);

  const changed = relaxTasksProductUrlNotNull(db);

  assert.strictEqual(changed, true);
  assert.strictEqual(getColumn(db, 'product_url').notnull, 0);
  db.prepare('INSERT INTO tasks (user_id, product_id, max_price) VALUES (?, ?, ?)').run(2, 'b123', 2000);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count, 2);
  assert.strictEqual(
    db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name IN ('idx_tasks_status', 'idx_tasks_user_id')").get().count,
    2
  );
  assert.strictEqual(relaxTasksProductUrlNotNull(db), false);
  db.close();
}

run();
console.log('schema maintenance tests passed');
