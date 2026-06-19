#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../src/config');
const { collectProductParity } = require('./check-product-parity');
const { collectReadPathViolations } = require('./check-product-read-paths');

const root = path.resolve(__dirname, '..');
const DEFAULT_HISTORY_PATH = path.join(root, 'logs', 'product-health-history.jsonl');
const productSnapshotFields = [
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

function getCount(db, sql, params = []) {
  const row = db.prepare(sql).get(params);
  return Number(row?.count || 0);
}

function collectFallbackUsage(db) {
  const result = {};
  for (const field of productSnapshotFields) {
    result[field] = getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM tasks t
       LEFT JOIN products p ON p.product_id = t.product_id
       WHERE t.product_id IS NOT NULL
         AND TRIM(t.product_id) <> ''
         AND p.${field} IS NULL
         AND t.${field} IS NOT NULL
         AND TRIM(CAST(t.${field} AS TEXT)) <> ''`
    );
  }
  return result;
}

function listJsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

function collectServerReadPathViolations() {
  const files = [
    ...listJsFiles(path.join(root, 'src', 'server', 'routes')),
    ...listJsFiles(path.join(root, 'src', 'server', 'services'))
  ];
  return collectReadPathViolations(files);
}

function buildHealthStatus({ parity, readPathViolationCount, fallbackUsage }) {
  const parityProblemCount = Object.values(parity).reduce((sum, value) => sum + Number(value || 0), 0);
  const fallbackCount = Object.values(fallbackUsage).reduce((sum, value) => sum + Number(value || 0), 0);
  if (parityProblemCount > 0 || readPathViolationCount > 0) {
    return {
      status: 'FAIL',
      parityProblemCount,
      fallbackCount,
      message: '三表关系或读路径存在问题，需要先处理。'
    };
  }
  if (fallbackCount > 0) {
    return {
      status: 'WARN',
      parityProblemCount,
      fallbackCount,
      message: '程序读路径正常，但当前数据仍存在需要 fallback 的字段。'
    };
  }
  return {
    status: 'OK',
    parityProblemCount,
    fallbackCount,
    message: '三表关系正常，当前数据未发现 fallback 使用。'
  };
}

function resolveDatabasePath() {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is not configured');
  const dbPath = config.databaseUrl.replace('sqlite:', '').replace('//', '');
  return path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);
}

function appendHealthHistory(historyPath, record) {
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.appendFileSync(historyPath, `${JSON.stringify(record)}\n`, 'utf8');
}

function readRecentHistory(historyPath, limit = 10) {
  if (!fs.existsSync(historyPath)) return [];
  const lines = fs.readFileSync(historyPath, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.slice(-limit).map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function buildReport(db, options = {}) {
  const checkedAt = options.checkedAt || new Date().toISOString();
  const parity = collectProductParity(db);
  const readPathViolations = collectServerReadPathViolations();
  const fallbackUsage = collectFallbackUsage(db);
  const status = buildHealthStatus({
    parity,
    readPathViolationCount: readPathViolations.length,
    fallbackUsage
  });
  return {
    checkedAt,
    status: status.status,
    message: status.message,
    parityProblemCount: status.parityProblemCount,
    fallbackCount: status.fallbackCount,
    parity,
    readPathViolationCount: readPathViolations.length,
    readPathViolations,
    fallbackUsage
  };
}

function printReport(report, historyPath) {
  console.log('Product three-table health check');
  console.log(`Checked at: ${report.checkedAt}`);
  console.log(`Status: ${report.status}`);
  console.log(report.message);
  console.log('');
  console.log('Parity:');
  for (const [key, value] of Object.entries(report.parity)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log(`Read path violations: ${report.readPathViolationCount}`);
  if (report.readPathViolations.length > 0) {
    for (const item of report.readPathViolations.slice(0, 20)) {
      console.log(`  ${item.file}:${item.line} ${item.field}`);
    }
  }
  console.log('');
  console.log('Fallback usage by field:');
  for (const [key, value] of Object.entries(report.fallbackUsage)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log('');
  console.log(`History file: ${historyPath}`);
}

function printRecentHistory(historyPath) {
  const recent = readRecentHistory(historyPath, 10);
  if (recent.length === 0) return;
  console.log('');
  console.log('Recent history:');
  for (const item of recent) {
    console.log(`  ${item.checkedAt}  ${item.status}  fallback=${item.fallbackCount} parity=${item.parityProblemCount}`);
  }
}

function main() {
  const historyPath = process.env.PRODUCT_HEALTH_HISTORY || DEFAULT_HISTORY_PATH;
  const dbPath = resolveDatabasePath();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const report = buildReport(db);
    appendHealthHistory(historyPath, report);
    printReport(report, historyPath);
    printRecentHistory(historyPath);
    if (report.status === 'FAIL') process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message || err);
    process.exitCode = 1;
  }
}

module.exports = {
  collectFallbackUsage,
  buildHealthStatus,
  appendHealthHistory,
  readRecentHistory,
  buildReport
};
