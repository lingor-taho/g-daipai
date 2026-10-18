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
  assert.deepEqual(candidates.map(item => item.params[1]), ['z650804548', 'p1234567890', 'g1234567890']);
  const batchWrite = writes.find(item => /SET status = 'ready'/.test(item.sql));
  assert.equal(batchWrite.params[1], 3, 'Skipped fleamarket items do not count as scanned candidates');
  writes.length = 0;
  const result = await confirmManualOrderImport(9, [{ itemId: 5, userId: 999 }, { itemId: 2, userId: 999 }], database);
  assert.equal(result.imported, 3);
  assert.equal(writes.filter(item => /skipped_unsupported/.test(item.sql)).length, 2);
  for (const table of ['products', 'tasks', 'orders']) {
    const inserts = writes.filter(item => new RegExp(`INSERT INTO ${table}\\b`).test(item.sql));
    assert.equal(inserts.length, 3);
    const index = table === 'products' ? 0 : 1;
    assert.deepEqual(inserts.map(item => item.params[index]), ['z650804548', 'p1234567890', 'g1234567890']);
  }
  const Database=require('better-sqlite3');
  const saved=new Database(':memory:');
  saved.exec("CREATE TABLE products(product_id TEXT PRIMARY KEY,product_type TEXT); INSERT INTO products VALUES('z650804548','normal'),('x1234567890','fleamarket');");
  writes.length=0;
  database.raw=saved;
  await updateManualOrderImportStatus({batchId:9,status:'ready',items:[
    {productId:'z650804548',productType:'fleamarket'},
    {productId:'x1234567890',productType:'normal'}
  ]},database);
  const typedCandidates=writes.filter(item=>/INSERT INTO manual_order_import_items/.test(item.sql));
  assert.deepEqual(typedCandidates.map(item=>item.params[1]),['z650804548']);
  assert.equal(typedCandidates[0].params[11],'normal','product-table type wins over stale scraped type');
  saved.close();
  delete database.raw;
  // Confirming an old batch must also re-read products rather than trusting its snapshot.
  const realDb=require('../models');
  realDb.raw.prepare("INSERT INTO users(id,username,password_hash,role) VALUES(9999,'type-import-admin','x','admin')").run();
  realDb.raw.prepare("INSERT INTO products(product_id,product_type) VALUES('a555555555','fleamarket')").run();
  const batch=realDb.raw.prepare("INSERT INTO manual_order_import_batches(start_date,end_date,status) VALUES('2026-10-01','2026-10-18','ready')").run().lastInsertRowid;
  const item=realDb.raw.prepare("INSERT INTO manual_order_import_items(batch_id,product_id,product_type,assigned_user_id) VALUES(?,'a555555555','normal',9999)").run(batch).lastInsertRowid;
  const confirmed=await confirmManualOrderImport(Number(batch),[{itemId:Number(item),userId:9999}],realDb);
  assert.equal(confirmed.imported,0);
  assert.equal(realDb.raw.prepare('SELECT status FROM manual_order_import_items WHERE id=?').get(item).status,'skipped_unsupported');
  assert.equal(realDb.raw.prepare("SELECT count(*) n FROM tasks WHERE product_id='a555555555'").get().n,0);
  console.log('Manual import skips fleamarket at intake and confirmation; p-prefix normal and store imports remain intact');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
