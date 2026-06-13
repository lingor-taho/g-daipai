#!/usr/bin/env node

const path = require('path');
const Database = require('better-sqlite3');
const config = require('../src/config');

function getCount(db, sql, params = []) {
  const row = db.prepare(sql).get(params);
  return Number(row?.count || 0);
}

function ensureRequiredSchema(db) {
  const products = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'products'").get();
  if (!products) throw new Error('products table does not exist');

  const orderColumns = db.prepare('PRAGMA table_info(orders)').all();
  if (!orderColumns.some(column => column.name === 'product_id')) {
    throw new Error('orders.product_id column does not exist');
  }
}

function collectProductParity(db) {
  ensureRequiredSchema(db);

  return {
    tasksWithoutProductRow: getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM tasks t
       LEFT JOIN products p ON p.product_id = t.product_id
       WHERE t.product_id IS NOT NULL
         AND TRIM(t.product_id) <> ''
         AND p.product_id IS NULL`
    ),
    ordersWithoutProductId: getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM orders
       WHERE product_id IS NULL
          OR TRIM(product_id) = ''`
    ),
    ordersProductIdMismatch: getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM orders o
       JOIN tasks t ON t.id = o.task_id
       WHERE o.product_id IS NOT NULL
         AND TRIM(o.product_id) <> ''
         AND t.product_id IS NOT NULL
         AND TRIM(t.product_id) <> ''
         AND o.product_id <> t.product_id`
    ),
    productsLatestTaskSnapshotMismatch: getCount(
      db,
      `WITH latest_tasks AS (
         SELECT t.*
         FROM tasks t
         JOIN (
           SELECT product_id, MAX(id) AS id
           FROM tasks
           WHERE product_id IS NOT NULL
             AND TRIM(product_id) <> ''
           GROUP BY product_id
         ) latest ON latest.id = t.id
       )
       SELECT COUNT(*) AS count
       FROM products p
       JOIN latest_tasks t ON t.product_id = p.product_id
       WHERE (
           p.shipping_fee_text IS NOT NULL
           AND t.shipping_fee_text IS NOT NULL
           AND TRIM(p.shipping_fee_text) <> TRIM(t.shipping_fee_text)
         )
          OR (
           p.product_type IS NOT NULL
           AND t.product_type IS NOT NULL
           AND p.product_type <> t.product_type
         )`
    )
  };
}

function resolveDatabasePath() {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is not configured');
  const dbPath = config.databaseUrl.replace('sqlite:', '').replace('//', '');
  return path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);
}

function main() {
  const dbPath = resolveDatabasePath();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const result = collectProductParity(db);
    console.log('Product parity check (read-only)');
    console.log(`Database: ${dbPath}`);
    for (const [key, value] of Object.entries(result)) {
      console.log(`${key}: ${value}`);
    }
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
  collectProductParity,
  ensureRequiredSchema
};
