const fs = require('fs');
const path = require('path');
const readline = require('readline');

const root = path.resolve(__dirname, '..');
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'));

const TASK_COLUMNS = [
  'product_url',
  'product_title',
  'product_image_url',
  'current_price',
  'buyout_price',
  'bid_count',
  'tax_type',
  'product_type',
  'shipping_fee_text',
  'end_time'
];

const ORDER_COLUMNS = [
  'product_title',
  'product_url'
];

function quoteIdentifier(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function readDatabaseUrl() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return 'sqlite:./data/gdaipai.db';

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^DATABASE_URL\s*=\s*(.*)$/);
    if (!match) continue;

    let value = match[1].trim();
    const first = value.charCodeAt(0);
    const last = value.charCodeAt(value.length - 1);
    if (value.length >= 2 && first === last && (first === 34 || first === 39)) {
      value = value.slice(1, -1);
    }
    return value || 'sqlite:./data/gdaipai.db';
  }

  return 'sqlite:./data/gdaipai.db';
}

function resolveSqlitePath(databaseUrl) {
  if (!databaseUrl || !databaseUrl.toLowerCase().startsWith('sqlite:')) {
    throw new Error(`DATABASE_URL 必须是 sqlite: 格式。当前值：${databaseUrl}`);
  }

  let dbPath = databaseUrl.slice('sqlite:'.length);
  if (dbPath.startsWith('//')) dbPath = dbPath.slice(2);
  return path.isAbsolute(dbPath) ? dbPath : path.join(root, dbPath);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

function printIntro() {
  console.log('========================================');
  console.log('  g-daipai 三表清理');
  console.log('========================================');
  console.log('');
  console.log(`项目目录：${root}`);
  console.log('');
  console.log('本脚本会删除三表模型中已废弃的商品快照字段：');
  console.log('  tasks 表：');
  console.log('    product_url, product_title, product_image_url, current_price,');
  console.log('    buyout_price, bid_count, tax_type, product_type,');
  console.log('    shipping_fee_text, end_time');
  console.log('  orders 表：');
  console.log('    product_title, product_url');
  console.log('');
  console.log('继续前请先停止 API 服务、watcher、插件相关进程，以及任何正在写入数据库的程序。');
  console.log('脚本会先校验旧字段数据是否已在 products 表中存在，再创建数据库备份。');
  console.log('只有校验通过后，才会在一个事务中删除上述字段，并检查行数、外键和 integrity_check。');
  console.log('');
}

function getColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map(col => col.name);
}

function getRowCount(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count;
}

function sampleRows(rows) {
  return rows.slice(0, 10).map(row => JSON.stringify(row)).join('\n');
}

function assertTableExists(db, table) {
  const found = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!found) throw new Error(`必要数据表不存在：${table}`);
}

function assertNoTaskDataLoss(db, existingTaskColumns) {
  if (!existingTaskColumns.length) return;

  const productTable = getColumns(db, 'products');
  const sharedColumns = existingTaskColumns.filter(col => productTable.includes(col));
  const missingProductRows = db.prepare(`
    SELECT t.id, t.product_id
    FROM tasks t
    LEFT JOIN products p ON p.product_id = t.product_id
    WHERE p.product_id IS NULL
    LIMIT 10
  `).all();

  if (missingProductRows.length) {
    throw new Error(`中止：部分 tasks 记录找不到对应的 products 记录。\n${sampleRows(missingProductRows)}`);
  }

  for (const col of sharedColumns) {
    const q = quoteIdentifier(col);
    const rows = db.prepare(`
      SELECT t.id, t.product_id, t.${q} AS old_value
      FROM tasks t
      LEFT JOIN products p ON p.product_id = t.product_id
      WHERE t.${q} IS NOT NULL
        AND NULLIF(TRIM(CAST(t.${q} AS TEXT)), '') IS NOT NULL
        AND (p.${q} IS NULL OR NULLIF(TRIM(CAST(p.${q} AS TEXT)), '') IS NULL)
      LIMIT 10
    `).all();

    if (rows.length) {
      throw new Error(`中止：tasks.${col} 中仍有 products.${col} 缺失的数据。\n${sampleRows(rows)}`);
    }
  }
}

function assertNoOrderDataLoss(db, existingOrderColumns) {
  if (!existingOrderColumns.length) return;

  const productTable = getColumns(db, 'products');
  const sharedColumns = existingOrderColumns.filter(col => productTable.includes(col));
  for (const col of sharedColumns) {
    const q = quoteIdentifier(col);
    const rows = db.prepare(`
      SELECT o.id, COALESCE(o.product_id, t.product_id) AS product_id, o.${q} AS old_value
      FROM orders o
      LEFT JOIN tasks t ON t.id = o.task_id
      LEFT JOIN products p ON p.product_id = COALESCE(o.product_id, t.product_id)
      WHERE o.${q} IS NOT NULL
        AND NULLIF(TRIM(CAST(o.${q} AS TEXT)), '') IS NOT NULL
        AND (p.${q} IS NULL OR NULLIF(TRIM(CAST(p.${q} AS TEXT)), '') IS NULL)
      LIMIT 10
    `).all();

    if (rows.length) {
      throw new Error(`中止：orders.${col} 中仍有 products.${col} 缺失的数据。\n${sampleRows(rows)}`);
    }
  }
}

function dropColumns(db, table, columns) {
  for (const col of columns) {
    console.log(`正在删除 ${table}.${col} ...`);
    db.prepare(`ALTER TABLE ${quoteIdentifier(table)} DROP COLUMN ${quoteIdentifier(col)}`).run();
  }
}

async function main() {
  printIntro();

  const stopped = await ask('确认已停止服务并准备开始清理？输入 Y 继续，其他任意内容取消：');
  if (stopped.trim().toUpperCase() !== 'Y') {
    console.log('已取消。');
    process.exitCode = 1;
    return;
  }

  const databaseUrl = readDatabaseUrl();
  const dbPath = resolveSqlitePath(databaseUrl);
  console.log(`数据库文件：${dbPath}`);
  if (!fs.existsSync(dbPath)) throw new Error(`数据库文件不存在：${dbPath}`);

  const answer = await ask('请输入 CLEANUP 确认删除废弃字段：');
  if (answer !== 'CLEANUP') {
    console.log('已取消。');
    process.exitCode = 1;
    return;
  }

  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  assertTableExists(db, 'products');
  assertTableExists(db, 'tasks');
  assertTableExists(db, 'orders');

  const taskExisting = TASK_COLUMNS.filter(col => getColumns(db, 'tasks').includes(col));
  const orderExisting = ORDER_COLUMNS.filter(col => getColumns(db, 'orders').includes(col));
  console.log(`tasks 将删除字段：${taskExisting.length ? taskExisting.join(', ') : '无'}`);
  console.log(`orders 将删除字段：${orderExisting.length ? orderExisting.join(', ') : '无'}`);

  if (!taskExisting.length && !orderExisting.length) {
    console.log('没有需要清理的字段。');
    db.close();
    return;
  }

  console.log('正在执行数据保护校验...');
  assertNoTaskDataLoss(db, taskExisting);
  assertNoOrderDataLoss(db, orderExisting);

  const beforeCounts = {
    tasks: getRowCount(db, 'tasks'),
    orders: getRowCount(db, 'orders'),
    products: getRowCount(db, 'products')
  };

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const backupDir = path.join(root, 'backups', 'three-table-cleanup');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `gdaipai-before-three-table-cleanup-${stamp}.db`);
  console.log(`正在创建备份：${backupPath}`);
  await db.backup(backupPath);

  const migrate = db.transaction(() => {
    dropColumns(db, 'tasks', taskExisting);
    dropColumns(db, 'orders', orderExisting);

    const fkIssues = db.pragma('foreign_key_check');
    if (fkIssues.length) {
      throw new Error(`foreign_key_check 失败：${JSON.stringify(fkIssues.slice(0, 10))}`);
    }

    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`integrity_check 失败：${integrity}`);

    const afterCounts = {
      tasks: getRowCount(db, 'tasks'),
      orders: getRowCount(db, 'orders'),
      products: getRowCount(db, 'products')
    };

    for (const table of Object.keys(beforeCounts)) {
      if (beforeCounts[table] !== afterCounts[table]) {
        throw new Error(`${table} 行数从 ${beforeCounts[table]} 变为 ${afterCounts[table]}`);
      }
    }
  });

  migrate();
  db.close();

  console.log('');
  console.log('清理完成。');
  console.log(`备份文件：${backupPath}`);
  console.log('建议继续运行以下检查：');
  console.log('  node scripts/check-product-read-paths.js');
  console.log('  node scripts/check-product-health.js');
  console.log('  node scripts/check-product-parity.js');
  console.log('  node scripts/encoding-guard.js');
}

main().catch(error => {
  console.error('');
  console.error('清理失败：');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
