const assert = require('assert/strict');
const { updateManualOrderImportStatus } = require('./plugin');
const { confirmManualOrderImport } = require('./admin');

async function run() {
  const rows = [
    { id: 1, product_id: 'z650804548', product_type: 'normal' },
    { id: 2, product_id: 'x1234567890', product_type: 'fleamarket' },
    { id: 3, product_id: 'p1234567890', product_type: 'normal' },
    { id: 4, product_id: 'g1234567890', product_type: 'store' },
    { id: 5, product_id: 'a1234567890', product_url: 'https://paypayfleamarket.yahoo.co.jp/item/z650804548' }
  ].map(item => ({ ...item, assigned_user_id: 8, final_price: 1000 }));
  const writes = [];
  const database = {
    async getOne(sql) {
      if (/FROM manual_order_import_batches/.test(sql)) return { id: 9, status: 'ready' };
      if (/COUNT\(\*\) AS count/.test(sql)) return { count: 0 };
      if (/FROM orders o/.test(sql)) return null;
      if (/last_insert_rowid/.test(sql)) return { id: writes.length };
      throw new Error(`unexpected SQL: ${sql}`);
    },
    async getAll() { return rows; },
    async query(sql, params) { writes.push({ sql, params }); return { rowCount: 1 }; }
  };
  await updateManualOrderImportStatus({ batchId: 9, status: 'ready', items: rows }, database);
  const candidates = writes.filter(item => /INSERT INTO manual_order_import_items/.test(item.sql));
  assert.deepEqual(candidates.map(item => item.params[1]), ['p1234567890', 'g1234567890']);
  const batchWrite = writes.find(item => /SET status = 'ready'/.test(item.sql));
  assert.equal(batchWrite.params[1], 2, 'Skipped fleamarket items do not count as scanned candidates');
  writes.length = 0;
  const result = await confirmManualOrderImport(9, [{ itemId: 1, userId: 999 }, { itemId: 2, userId: 999 }], database);
  assert.equal(result.imported, 2);
  assert.equal(writes.filter(item => /skipped_unsupported/.test(item.sql)).length, 3);
  for (const table of ['products', 'tasks', 'orders']) {
    const inserts = writes.filter(item => new RegExp(`INSERT INTO ${table}\\b`).test(item.sql));
    assert.equal(inserts.length, 2);
    const index = table === 'products' ? 0 : 1;
    assert.deepEqual(inserts.map(item => item.params[index]), ['p1234567890', 'g1234567890']);
  }
  console.log('Manual import skips fleamarket at intake and confirmation; p-prefix normal and store imports remain intact');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
