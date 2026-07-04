@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

title g-daipai three-table cleanup
echo ========================================
echo   g-daipai three-table cleanup
echo ========================================
echo.
echo Project root: %ROOT%
echo.
echo This script removes obsolete product snapshot columns:
echo   tasks:  product_url, product_title, product_image_url, current_price,
echo           buyout_price, bid_count, tax_type, product_type,
echo           shipping_fee_text, end_time
echo   orders: product_title, product_url
echo.
echo Before continuing, stop the API server, watchers, and any process writing to the database.
echo The script will:
echo   1. resolve DATABASE_URL from .env, defaulting to sqlite:./data/gdaipai.db
echo   2. verify old-column data is already available from products
echo   3. create a SQLite backup under backups\three-table-cleanup
echo   4. drop only the listed columns in one transaction
echo   5. verify row counts, foreign keys, and integrity_check
echo.

where /Q node
if errorlevel 1 (
  echo Node.js was not found.
  goto :fail
)

choice /C YN /M "Have you stopped services and are ready to run cleanup?"
if errorlevel 2 (
  echo Cleanup cancelled.
  pause
  exit /b 1
)

cd /d "%ROOT%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$script = @'
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const root = process.cwd();
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
  return '\"' + String(name).replace(/\"/g, '\"\"') + '\"';
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
    if (value.length >= 2 && value.charCodeAt(0) === value.charCodeAt(value.length - 1) && (value.charCodeAt(0) === 34 || value.charCodeAt(0) === 39)) {
      value = value.slice(1, -1);
    }
    return value || 'sqlite:./data/gdaipai.db';
  }
  return 'sqlite:./data/gdaipai.db';
}

function resolveSqlitePath(databaseUrl) {
  if (!databaseUrl || !databaseUrl.toLowerCase().startsWith('sqlite:')) {
    throw new Error('DATABASE_URL must be sqlite:. Current value: ' + databaseUrl);
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

function getColumns(db, table) {
  return db.prepare('PRAGMA table_info(' + quoteIdentifier(table) + ')').all().map(col => col.name);
}

function getRowCount(db, table) {
  return db.prepare('SELECT COUNT(*) AS count FROM ' + quoteIdentifier(table)).get().count;
}

function sampleRows(rows) {
  return rows.slice(0, 10).map(row => JSON.stringify(row)).join('\n');
}

function assertTableExists(db, table) {
  const found = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
  if (!found) throw new Error('Required table does not exist: ' + table);
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
    throw new Error('Abort: some tasks have no matching products row.\n' + sampleRows(missingProductRows));
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
      throw new Error('Abort: tasks.' + col + ' has data that is missing from products.' + col + '.\n' + sampleRows(rows));
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
      throw new Error('Abort: orders.' + col + ' has data that is missing from products.' + col + '.\n' + sampleRows(rows));
    }
  }
}

function dropColumns(db, table, columns) {
  for (const col of columns) {
    console.log('Dropping ' + table + '.' + col + ' ...');
    db.prepare('ALTER TABLE ' + quoteIdentifier(table) + ' DROP COLUMN ' + quoteIdentifier(col)).run();
  }
}

async function main() {
  const databaseUrl = readDatabaseUrl();
  const dbPath = resolveSqlitePath(databaseUrl);
  console.log('Database: ' + dbPath);
  if (!fs.existsSync(dbPath)) throw new Error('Database file does not exist: ' + dbPath);

  const answer = await ask('Type CLEANUP to remove the obsolete columns: ');
  if (answer !== 'CLEANUP') {
    console.log('Cancelled.');
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
  console.log('tasks columns to drop: ' + (taskExisting.length ? taskExisting.join(', ') : '(none)'));
  console.log('orders columns to drop: ' + (orderExisting.length ? orderExisting.join(', ') : '(none)'));

  if (!taskExisting.length && !orderExisting.length) {
    console.log('Nothing to clean.');
    db.close();
    return;
  }

  console.log('Running data-preservation checks...');
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
  const backupPath = path.join(backupDir, 'gdaipai-before-three-table-cleanup-' + stamp + '.db');
  console.log('Creating backup: ' + backupPath);
  await db.backup(backupPath);

  const migrate = db.transaction(() => {
    dropColumns(db, 'tasks', taskExisting);
    dropColumns(db, 'orders', orderExisting);

    const fkIssues = db.pragma('foreign_key_check');
    if (fkIssues.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(fkIssues.slice(0, 10)));

    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error('integrity_check failed: ' + integrity);

    const afterCounts = {
      tasks: getRowCount(db, 'tasks'),
      orders: getRowCount(db, 'orders'),
      products: getRowCount(db, 'products')
    };
    for (const table of Object.keys(beforeCounts)) {
      if (beforeCounts[table] !== afterCounts[table]) {
        throw new Error(table + ' row count changed from ' + beforeCounts[table] + ' to ' + afterCounts[table]);
      }
    }
  });

  migrate();
  db.close();

  console.log('');
  console.log('Cleanup completed.');
  console.log('Backup: ' + backupPath);
  console.log('Recommended checks:');
  console.log('  node scripts/check-product-read-paths.js');
  console.log('  node scripts/check-product-health.js');
  console.log('  node scripts/check-product-parity.js');
  console.log('  node scripts/encoding-guard.js');
}

main().catch(error => {
  console.error('');
  console.error('Cleanup failed:');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
'@;" ^
  "$tmp = Join-Path $env:TEMP ('g-daipai-three-table-cleanup-' + [guid]::NewGuid().ToString() + '.js');" ^
  "Set-Content -LiteralPath $tmp -Value $script -Encoding UTF8;" ^
  "try { node $tmp; $code = $LASTEXITCODE } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue };" ^
  "exit $code"

set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo Cleanup failed or was cancelled. Exit code: %EXIT_CODE%
  pause
  exit /b %EXIT_CODE%
)

echo Cleanup finished.
pause
exit /b 0

:fail
echo.
echo Cleanup failed. Read the message above, fix it, then run again.
echo.
pause
exit /b 1
