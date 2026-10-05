const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { submitAuctionTask, validateBatchProduct, fetchBatchProduct } = require('./task');

function fixture() {
  const raw = new Database(':memory:');
  raw.exec(`
    CREATE TABLE config (key TEXT, value TEXT);
    CREATE TABLE products (product_id TEXT PRIMARY KEY, product_url TEXT, product_title TEXT,
      product_image_url TEXT, current_price INTEGER, buyout_price INTEGER, bid_count INTEGER,
      tax_type TEXT, product_type TEXT, shipping_fee_text TEXT, end_time TEXT,
      last_fetched_at TEXT, last_scanned_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, user_id INTEGER, product_id TEXT, max_price INTEGER,
      user_max_price INTEGER, multi_bid_increment INTEGER, strategy TEXT, bid_mode TEXT,
      start_minutes_before INTEGER, start_seconds_before INTEGER, status TEXT,
      client_request_id TEXT, pending_followup_max_price INTEGER);
  `);
  const database = {
    async getOne(sql, params = []) { return raw.prepare(sql).get(...params); },
    async query(sql, params = []) { return { rowCount: raw.prepare(sql).run(...params).changes }; }
  };
  const context = { user: { id: 1, user_level: 3 }, actingUser: { id: 7 } };
  const product = {
    auctionId: 'd1246248584', title: '真实商品', imageUrl: 'https://img.example/a.jpg',
    currentPrice: 11000, buyoutPrice: 20000, bidCount: 1, taxType: 'tax_zero', productType: 'normal',
    shippingFeeText: '送料 500円', endTime: '2099-01-01T00:00:00+09:00', auctionStatus: 'open'
  };
  const body = { product_url: product.auctionId, max_price: 11800, client_request_id: 'batch-1' };
  const options = { database, strictBatch: true, fetchProduct: async () => ({ success: true, data: product, source: 'http' }) };
  return { raw, database, context, product, body, options };
}

async function run() {
  const f = fixture();
  try {
    const results = await Promise.all([
      submitAuctionTask(f.context, { ...f.body, strategy: 'multi_bid', bid_mode: 'buyout', current_price: 1, tax_type: 'tax_included', acting_user_id: 99 }, f.options),
      submitAuctionTask(f.context, f.body, f.options)
    ]);
    assert.equal(results[0].task_id, results[1].task_id);
    assert.equal(results[1].duplicate, true);
    const task = await f.database.getOne('SELECT * FROM tasks');
    assert.equal(task.user_id, 7);
    assert.equal(task.max_price, 11800);
    assert.equal(task.user_max_price, 11800);
    assert.equal(task.strategy, 'direct');
    assert.equal(task.bid_mode, 'bid');
    assert.equal(task.status, 'pending');
    const snapshot = await f.database.getOne('SELECT * FROM products');
    assert.equal(snapshot.product_title, f.product.title);
    assert.equal(snapshot.current_price, 11000);
    assert.equal(snapshot.shipping_fee_text, '送料 500円');
    assert.equal(snapshot.product_image_url, f.product.imageUrl);
    await assert.rejects(submitAuctionTask(f.context, { ...f.body, client_request_id: 'another' }, f.options), /排队中/);
    await assert.rejects(submitAuctionTask({ ...f.context, actingUser: { id: 8 } }, { ...f.body, client_request_id: 'user8' }, f.options), /其他用户/);
    await assert.rejects(submitAuctionTask(f.context, { ...f.body, product_url: 'e1246602869' }, f.options), /其他商品/);
    f.raw.prepare("UPDATE tasks SET status = 'bidding'").run();
    f.product.taxType = 'tax_included';
    f.product.productType = 'store';
    await submitAuctionTask(f.context, { ...f.body, max_price: 11801, client_request_id: 'tax-round' }, f.options);
    const taxed = await f.database.getOne("SELECT * FROM tasks WHERE client_request_id = 'tax-round'");
    assert.equal(taxed.max_price, 11801);
    assert.equal(taxed.user_max_price, 12982);
    f.raw.prepare("UPDATE tasks SET status = 'bidding'").run();
    f.product.taxType = 'tax_zero';
    await submitAuctionTask(f.context, { ...f.body, client_request_id: 'store-zero' }, f.options);
    assert.equal((await f.database.getOne("SELECT * FROM tasks WHERE client_request_id = 'store-zero'")).max_price, 11800);
  } finally { f.raw.close(); }

  for (const change of [
    { source: 'cache-fallback' }, { product: { auctionStatus: 'closed' } },
    { product: { endTime: '2020-01-01' } }, { product: { auctionStatus: 'unknown' } },
    { product: { buyoutOnly: true } }, { product: { currentPrice: 0 } },
    { product: { auctionId: 'e1246602869' } }, { product: { endTime: '' } }
  ]) {
    const g = fixture();
    try {
      const fetchProduct = async () => ({ success: true, source: change.source || 'http', data: { ...g.product, ...change.product } });
      await assert.rejects(submitAuctionTask(g.context, g.body, { ...g.options, fetchProduct }));
      assert.equal((await g.database.getOne('SELECT COUNT(*) AS n FROM tasks')).n, 0);
      assert.equal((await g.database.getOne('SELECT COUNT(*) AS n FROM products')).n, 0);
    } finally { g.raw.close(); }
  }
  const g = fixture();
  try {
    await assert.rejects(submitAuctionTask(g.context, { ...g.body, max_price: 100 }, g.options), /最低/);
    await assert.rejects(submitAuctionTask(g.context, { ...g.body, max_price: '1200oops' }, g.options), /正整数/);
    await assert.rejects(submitAuctionTask(g.context, { ...g.body, product_url: 'd1246248584oops' }, g.options));
    await assert.rejects(submitAuctionTask({ ...g.context, actingUser: { id: 7, bid_strategy_scope: 'bid_blocked' } }, g.body, g.options), /一时限制/);
    await assert.rejects(submitAuctionTask(g.context, { ...g.body, client_request_id: '' }, g.options), /标识/);
    await assert.rejects(submitAuctionTask(g.context, g.body, { ...g.options, fetchProduct: async () => { throw new Error('network'); } }), /无法获取/);
    assert.equal((await g.database.getOne('SELECT COUNT(*) AS n FROM tasks')).n, 0);
    g.product.currentPrice = 500;
    await submitAuctionTask(g.context, { ...g.body, max_price: 25000 }, g.options);
    const split = await g.database.getOne('SELECT * FROM tasks');
    assert.equal(split.max_price, 9000);
    assert.equal(split.pending_followup_max_price, 25000);
    // Single submissions still share the same persistence and retain buyout behavior.
    const single = await submitAuctionTask(g.context, { product_url: 'e1246602869', max_price: 20000, bid_mode: 'buyout', client_request_id: 'single' }, {
      database: g.database, fetchProduct: async () => ({ data: { ...g.product, auctionId: 'e1246602869' } })
    });
    assert.equal(single.product_id, 'e1246602869');
    assert.equal((await g.database.getOne('SELECT * FROM tasks WHERE id = ?', [single.task_id])).bid_mode, 'buyout');
  } finally { g.raw.close(); }
  const concurrent = fixture();
  try {
    const options = {
      ...concurrent.options,
      fetchProduct: async url => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return { success: true, source: 'http', data: { ...concurrent.product, auctionId: url.split('/').pop() } };
      }
    };
    const submitted = await Promise.all(['d1246248584', 'e1246602869'].map((id, index) => submitAuctionTask(
      { user: { id: 7 }, actingUser: { id: 7, bid_strategy_scope: 'direct_only' } },
      { ...concurrent.body, product_url: id, client_request_id: `concurrent-${index}` }, options
    )));
    assert.notEqual(submitted[0].task_id, submitted[1].task_id);
    for (const item of submitted) {
      assert.equal((await concurrent.database.getOne('SELECT product_id FROM tasks WHERE id = ?', [item.task_id])).product_id, item.product_id);
    }
    concurrent.raw.prepare("UPDATE tasks SET strategy = 'multi_bid', status = 'bidding' WHERE id = ?").run(submitted[0].task_id);
    await assert.rejects(submitAuctionTask(concurrent.context, { ...concurrent.body, client_request_id: 'active-strategy' }, concurrent.options), /生效策略/);
  } finally { concurrent.raw.close(); }
  await assert.rejects(fetchBatchProduct(() => new Promise(() => {}), 'unused', 5), /超时/);
  assert.throws(() => validateBatchProduct({ success: false }, 'x'), /最新/);
  console.log('Batch task submission tests passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
