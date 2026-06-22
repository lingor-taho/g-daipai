#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../src/config');
const { collectProductParity } = require('./check-product-parity');
const { collectReadPathViolations } = require('./check-product-read-paths');

const root = path.resolve(__dirname, '..');
const DEFAULT_HISTORY_PATH = path.join(root, 'logs', 'product-health-history.jsonl');
const productCoreFields = [
  'product_url',
  'product_title',
  'product_image_url'
];

function getCount(db, sql, params = []) {
  const row = db.prepare(sql).get(params);
  return Number(row?.count || 0);
}

function buildMissingCorePredicate(alias = 'p') {
  return productCoreFields
    .map(field => `(${alias}.${field} IS NULL OR TRIM(CAST(${alias}.${field} AS TEXT)) = '')`)
    .join(' OR ');
}

function collectProductCoreGaps(db) {
  const missingCore = buildMissingCorePredicate('p');
  return {
    activeProductsMissingCore: getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM tasks t
       JOIN products p ON p.product_id = t.product_id
       WHERE t.status IN ('pending', 'processing', 'bidding')
         AND (${missingCore})`
    ),
    successProductsMissingCore: getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM tasks t
       JOIN products p ON p.product_id = t.product_id
       WHERE t.status = 'success'
         AND (${missingCore})`
    ),
    orderProductsMissingCore: getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM orders o
       JOIN products p ON p.product_id = o.product_id
       WHERE ${missingCore}`
    )
  };
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

function buildHealthStatus({ parity, readPathViolationCount, productCoreGaps }) {
  const parityProblemCount = Object.values(parity).reduce((sum, value) => sum + Number(value || 0), 0);
  const productCoreGapCount = Object.values(productCoreGaps).reduce((sum, value) => sum + Number(value || 0), 0);
  if (parityProblemCount > 0 || readPathViolationCount > 0) {
    return {
      status: 'FAIL',
      parityProblemCount,
      productCoreGapCount,
      message: 'three-table relationship or product read path has violations'
    };
  }
  if (productCoreGapCount > 0) {
    return {
      status: 'WARN',
      parityProblemCount,
      productCoreGapCount,
      message: 'product read paths are closed, but products has missing core display fields'
    };
  }
  return {
    status: 'OK',
    parityProblemCount,
    productCoreGapCount,
    message: 'three-table relationship is normal; products core display fields are present'
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
  const productCoreGaps = collectProductCoreGaps(db);
  const status = buildHealthStatus({
    parity,
    readPathViolationCount: readPathViolations.length,
    productCoreGaps
  });
  return {
    checkedAt,
    status: status.status,
    message: status.message,
    parityProblemCount: status.parityProblemCount,
    productCoreGapCount: status.productCoreGapCount,
    fallbackCount: status.productCoreGapCount,
    parity,
    readPathViolationCount: readPathViolations.length,
    readPathViolations,
    productCoreGaps,
    fallbackUsage: productCoreGaps
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
  console.log('Products core gaps:');
  for (const [key, value] of Object.entries(report.productCoreGaps)) {
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
    const productCoreGapCount = item.productCoreGapCount ?? item.fallbackCount ?? 0;
    console.log(`  ${item.checkedAt}  ${item.status}  productCoreGaps=${productCoreGapCount} parity=${item.parityProblemCount}`);
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
  collectFallbackUsage: collectProductCoreGaps,
  collectProductCoreGaps,
  buildHealthStatus,
  appendHealthHistory,
  readRecentHistory,
  buildReport
};
