const path = require('path');

const quote = name => `"${String(name).replace(/"/g, '""')}"`;

function repairStaleOrderAuditForeignKey(db) {
  const table = 'order_status_change_logs';
  const definition = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!definition) return { repaired: false };
  const stale = db.pragma(`foreign_key_list(${quote(table)})`)
    .filter(fk => /^orders_default_fix_\d+$/.test(fk.table));
  if (!stale.length) return { repaired: false };
  if (db.inTransaction) throw new Error('Order audit schema repair requires no active transaction');
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='orders'").get()) {
    throw new Error('Cannot repair order audit foreign key without orders table');
  }
  for (const fk of stale) {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(fk.table)) {
      throw new Error('Order audit temporary reference still exists; refusing to replace it');
    }
  }
  let backupPath = null;
  if (db.name && db.name !== ':memory:') {
    backupPath = path.resolve(`${db.name}.order-audit-fk-backup-${Date.now()}.db`);
    db.prepare('VACUUM INTO ?').run(backupPath);
  }
  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  const legacyAlterTable = db.pragma('legacy_alter_table', { simple: true });
  const temp = `${table}__order_fk_repair`;
  let sql = definition.sql.replace(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"order_status_change_logs"|`order_status_change_logs`|\[order_status_change_logs\]|order_status_change_logs)/i, `CREATE TABLE ${quote(temp)}`);
  for (const fk of stale) {
    sql = sql.replace(new RegExp('REFERENCES\\s+(?:"' + fk.table + '"|`' + fk.table + '`|\\[' + fk.table + '\\]|' + fk.table + ')(?=\\s*\\()', 'gi'), 'REFERENCES orders');
  }
  if (sql === definition.sql || /orders_default_fix_\d+/.test(sql)) throw new Error('Unrecognized order audit table definition');
  db.pragma('foreign_keys = OFF');
  db.pragma('legacy_alter_table = ON');
  try {
    db.transaction(() => {
      const columns = db.pragma(`table_info(${quote(table)})`).map(col => quote(col.name)).join(', ');
      const sequence = db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get(table)?.seq || 0;
      const dependencies = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name=? AND type IN ('index','trigger') AND sql IS NOT NULL").all(table);
      db.exec(sql);
      db.exec(`INSERT INTO ${quote(temp)} (${columns}) SELECT ${columns} FROM ${quote(table)}`);
      db.exec(`DROP TABLE ${quote(table)}`);
      db.exec(`ALTER TABLE ${quote(temp)} RENAME TO ${quote(table)}`);
      for (const dependency of dependencies) db.exec(dependency.sql);
      const maxId = db.prepare(`SELECT COALESCE(MAX(id),0) AS n FROM ${quote(table)}`).get().n;
      db.prepare('DELETE FROM sqlite_sequence WHERE name=?').run(table);
      db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').run(table, Math.max(sequence, maxId));
    }).immediate();
  } finally {
    db.pragma(`legacy_alter_table = ${legacyAlterTable ? 'ON' : 'OFF'}`);
    db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
  return { repaired: true, backupPath };
}

module.exports = { repairStaleOrderAuditForeignKey };
