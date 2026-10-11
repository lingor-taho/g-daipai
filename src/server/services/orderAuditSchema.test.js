const assert = require('assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { repairStaleOrderAuditForeignKey } = require('./orderAuditSchema');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdaipai-order-audit-'));
const filename = path.join(dir, 'test.db');
const db = new Database(filename);
try {
  db.pragma('foreign_keys = OFF');
  db.exec(`CREATE TABLE orders(id INTEGER PRIMARY KEY,order_status TEXT,account_id INTEGER);
    INSERT INTO orders VALUES(31,NULL,1),(32,NULL,1);
    CREATE TABLE order_status_change_logs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL,source TEXT,metadata TEXT,
      FOREIGN KEY(order_id) REFERENCES "orders_default_fix_1780496607153"(id) ON DELETE CASCADE);
    CREATE INDEX audit_order ON order_status_change_logs(order_id);
    CREATE TABLE audit_observer(id INTEGER);
    CREATE TRIGGER audit_insert AFTER INSERT ON order_status_change_logs BEGIN INSERT INTO audit_observer VALUES(NEW.id); END;
    INSERT INTO order_status_change_logs VALUES(9,31,'old','history'),(20,99,'old','orphan history');
    UPDATE sqlite_sequence SET seq=30 WHERE name='order_status_change_logs';`);
  db.pragma('foreign_keys = ON');
  assert.throws(() => db.prepare("INSERT INTO order_status_change_logs(order_id,source) VALUES(31,'repair')").run(), /no such table: main.orders_default_fix_/);
  const orders = db.prepare('SELECT * FROM orders').all();
  const logs = db.prepare('SELECT * FROM order_status_change_logs').all();
  const result = repairStaleOrderAuditForeignKey(db);
  assert(result.repaired);
  assert(fs.existsSync(result.backupPath));
  const backup = new Database(result.backupPath, { readonly: true });
  assert.equal(backup.pragma('foreign_key_list(order_status_change_logs)')[0].table, 'orders_default_fix_1780496607153');
  assert.deepEqual(backup.prepare('SELECT * FROM order_status_change_logs').all(), logs);
  backup.close();
  assert.deepEqual(db.prepare('SELECT * FROM orders').all(), orders);
  assert.deepEqual(db.prepare('SELECT * FROM order_status_change_logs').all(), logs);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(db.pragma('legacy_alter_table', { simple: true }), 0);
  assert.equal(db.pragma('foreign_key_list(order_status_change_logs)')[0].table, 'orders');
  const inserted = db.prepare("INSERT INTO order_status_change_logs(order_id,source) VALUES(31,'repair')").run();
  assert.equal(inserted.lastInsertRowid, 31);
  assert(db.prepare('SELECT id FROM audit_observer WHERE id=31').get());
  assert.throws(() => db.prepare("INSERT INTO order_status_change_logs(order_id,source) VALUES(98,'invalid')").run(), /FOREIGN KEY constraint failed/);
  assert.equal(repairStaleOrderAuditForeignKey(db).repaired, false);
  assert.equal(fs.readdirSync(dir).filter(name => name.includes('backup')).length, 1);
  assert.deepEqual(db.pragma('foreign_key_check').map(row => row.rowid), [20]);
  const failing = new Database(':memory:');
  try {
    failing.pragma('foreign_keys = OFF');
    failing.exec(`CREATE TABLE orders(id INTEGER PRIMARY KEY);
      CREATE TABLE order_status_change_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER REFERENCES orders_default_fix_123(id));
      CREATE INDEX audit_order ON order_status_change_logs(order_id);
      INSERT INTO order_status_change_logs VALUES(1,31);`);
    failing.pragma('foreign_keys = ON');
    const originalExec = failing.exec.bind(failing);
    failing.exec = sql => {
      if (/^CREATE INDEX/i.test(sql)) throw new Error('simulated index restoration failure');
      return originalExec(sql);
    };
    assert.throws(() => repairStaleOrderAuditForeignKey(failing), /simulated index restoration failure/);
    assert.equal(failing.pragma('foreign_key_list(order_status_change_logs)')[0].table, 'orders_default_fix_123');
    assert.deepEqual(failing.prepare('SELECT * FROM order_status_change_logs').all(), [{id:1,order_id:31}]);
    assert.equal(failing.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(failing.pragma('legacy_alter_table', { simple: true }), 0);
    assert(!failing.prepare("SELECT 1 FROM sqlite_master WHERE name='order_status_change_logs__order_fk_repair'").get());
  } finally { failing.close(); }
  console.log('Order audit FK repair preserves orders, existing/orphan history, indexes, triggers, sequences and backup; repeat startup is a no-op.');
} finally {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
