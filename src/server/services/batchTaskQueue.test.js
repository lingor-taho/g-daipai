const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { createBatchTaskQueue, ensureBatchTaskQueueSchema, getBatchPreparationStats } = require('./batchTaskQueue');
const { submitAuctionTask, readBatchSubmissionContext } = require('../routes/task');

function fixture(fetchProduct) {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  raw.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, role TEXT, user_level INTEGER,
      parent_user_id INTEGER, bid_strategy_scope TEXT);
    INSERT INTO users VALUES (1, 'admin', 'user', 3, NULL, 'all'),
      (7, 'user7', 'user', 1, NULL, 'all'), (8, 'user8', 'user', 1, NULL, 'all');
    CREATE TABLE config (key TEXT, value TEXT);
    CREATE TABLE products (product_id TEXT PRIMARY KEY, product_url TEXT, product_title TEXT,
      product_image_url TEXT, current_price INTEGER, buyout_price INTEGER, bid_count INTEGER,
      tax_type TEXT, product_type TEXT, shipping_fee_text TEXT, end_time TEXT,
      last_fetched_at TEXT, last_scanned_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, user_id INTEGER, product_id TEXT, max_price INTEGER,
      user_max_price INTEGER, multi_bid_increment INTEGER, strategy TEXT, bid_mode TEXT,
      start_minutes_before INTEGER, start_seconds_before INTEGER, status TEXT, error_msg TEXT,
      client_request_id TEXT, pending_followup_max_price INTEGER);`);
  ensureBatchTaskQueueSchema(raw);
  ensureBatchTaskQueueSchema(raw);
  const database = {
    async getOne(sql, params = []) { return raw.prepare(sql).get(...params); },
    async getAll(sql, params = []) { return raw.prepare(sql).all(...params); },
    async query(sql, params = []) { return { rowCount: raw.prepare(sql).run(...params).changes }; }
  };
  const context = { user: { id: 1, user_level: 3 }, actingUser: { id: 7 } };
  let revoked = false;
  const calls = [];
  const queue = createBatchTaskQueue({
    raw,
    readContext: async (loginId, userId) => {
      assert.equal(loginId, 1);
      if (revoked) throw new Error('no permission for selected user');
      // Use the production identity path, including actual actingUser module exports.
      return readBatchSubmissionContext(loginId, userId, database);
    },
    submitTask: (ctx, body) => {
      calls.push(body.product_url);
      return submitAuctionTask(ctx, body, { database, strictBatch: true, fetchProduct: fetchProduct || (async url => ({
        success: true, source: 'http', data: { auctionId: url.split('/').pop(), currentPrice: 1000,
          title: '商品标题', imageUrl: 'https://example.com/item.jpg', bidCount: 0,
          taxType: 'tax_zero', productType: 'normal', endTime: '2099-01-01', auctionStatus: 'open' }
      })) });
    }
  });
  return { raw, database, queue, calls, context, revoke: () => { revoked = true; }, close: () => { queue.stop(); raw.close(); } };
}

async function run() {
  const f = fixture();
  try {
    const productionContext = await readBatchSubmissionContext(1, 7, f.database);
    assert.equal(productionContext.user.id, 1);
    assert.equal(productionContext.user.user_level, 3);
    assert.equal(productionContext.actingUser.id, 7);
    await assert.rejects(readBatchSubmissionContext(7, 8, f.database), /no permission/);
    const body = { text: 'd1246248584 11800\nwrong 100\ne1246602869 21980', client_request_id: 'batch-1' };
    const batch = f.queue.enqueue(f.context, body);
    assert.equal(f.calls.length, 0, 'Enqueue must not wait for or fetch Yahoo products');
    assert.equal(f.queue.enqueue(f.context, body).batch_id, batch.batch_id);
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM batch_task_submissions').get().n, 1);
    assert.throws(() => f.queue.enqueue(f.context, { ...body, text: 'r1246380884 4980' }), /其他批量/);
    assert.throws(() => f.queue.enqueue(f.context, { text: '', client_request_id: 'empty' }));
    assert.throws(() => f.queue.enqueue(f.context, { ...body, text: Array(51).fill('d1246248584 1').join('\n'), client_request_id: 'too-many' }), /50/);
    assert.deepEqual(f.queue.listResults(7), []);
    const preparation = await getBatchPreparationStats(f.database);
    assert.equal(preparation.pending, 2);
    assert.equal(preparation.failed, 1);
    assert.equal(preparation.items.length, 3);
    await f.queue.processPending();
    assert.equal(f.calls.length, 2);
    assert.equal(f.raw.prepare('SELECT status FROM batch_task_submissions').get().status, 'completed');
    const result = f.queue.listResults(7)[0];
    assert.equal(result.submit_success_count, 2, 'Submission results do not wait for plugin execution');
    assert.equal(result.submit_failed_count, 1);
    assert.equal(result.items.length, 1, 'Only submission failures are returned');
    assert.equal(result.items[0].line, 2);
    assert.equal(result.items[0].status, 'submit_failed');
    assert.equal((await getBatchPreparationStats(f.database)).pending, 0);
    f.raw.prepare("UPDATE tasks SET status = 'bidding' WHERE product_id = 'd1246248584'").run();
    assert.deepEqual(f.queue.listResults(7)[0], result);
    f.raw.prepare("UPDATE tasks SET status = 'failed', error_msg = 'outbid after bid' WHERE product_id = 'e1246602869'").run();
    assert.equal(result.total, 3);
    assert.deepEqual(f.queue.listResults(7)[0], result, 'Bid failures do not appear in submission results');
    assert.deepEqual(f.queue.listResults(8), []);
    assert.throws(() => f.queue.dismiss(8, batch.batch_id), /不存在/);
    f.raw.prepare("UPDATE tasks SET status = 'success'").run();
    assert.deepEqual(f.queue.listResults(7)[0], result);
    f.queue.dismiss(7, batch.batch_id);
    f.queue.dismiss(7, batch.batch_id);
    assert.deepEqual(f.queue.listResults(7), []);
  } finally { f.close(); }

  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const concurrent = fixture(async url => {
    if (url.endsWith('d1246248584')) await gate;
    return { success: true, source: 'http', data: { auctionId: url.split('/').pop(), title: '真实商品',
      currentPrice: 1000, bidCount: 0, taxType: 'tax_zero', productType: 'normal', endTime: '2099-01-01', auctionStatus: 'open' } };
  });
  try {
    concurrent.queue.enqueue(concurrent.context, { text: 'd1246248584 11800', client_request_id: 'first' });
    const processing = concurrent.queue.processPending();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(concurrent.calls.length, 1);
    concurrent.queue.enqueue(concurrent.context, { text: 'e1246602869 21980', client_request_id: 'second' });
    concurrent.queue.enqueue(concurrent.context, { text: 'r1246380884 4980', client_request_id: 'third' });
    assert.equal(concurrent.raw.prepare('SELECT COUNT(*) AS n FROM batch_task_submissions').get().n, 3);
    assert.equal(concurrent.calls.length, 1, 'Later batches enqueue even while Yahoo fetch is blocked');
    const single = await submitAuctionTask(concurrent.context, {
      product_url: 's1246477286', max_price: 18800, strategy: 'direct', client_request_id: 'single-during-batch',
      current_price: 1000, bid_count: 0, product_title: '单独提交商品', product_image_url: 'https://example.com/item.jpg',
      tax_type: 'tax_zero', product_type: 'normal', shipping_fee_text: '送料未定', end_time: '2099-01-01'
    }, { database: concurrent.database, fetchProduct: async () => assert.fail('Single submission must not wait for the batch fetch') });
    assert.equal(single.product_id, 's1246477286');
    release();
    await processing;
    assert.deepEqual(concurrent.calls.map(url => url.split('/').pop()), ['d1246248584', 'e1246602869', 'r1246380884']);
    assert.equal(concurrent.raw.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 4);
    assert.deepEqual(concurrent.queue.listResults(7), [], 'Successful submissions never open a result popup');
    concurrent.raw.prepare("UPDATE tasks SET status = 'failed', error_msg = 'outbid after bid'").run();
    assert.deepEqual(concurrent.queue.listResults(7), [], 'Even all bids failing does not open a submission popup');
  } finally { concurrent.close(); }

  let releaseSecond;
  const secondGate = new Promise(resolve => { releaseSecond = resolve; });
  const incremental = fixture(async url => {
    if (url.endsWith('e1246602869')) await secondGate;
    return { success: true, source: 'http', data: { auctionId: url.split('/').pop(), title: '逐件补全商品',
      currentPrice: 1000, bidCount: 0, taxType: 'tax_zero', productType: 'normal', endTime: '2099-01-01', auctionStatus: 'open' } };
  });
  let incrementalWork;
  try {
    incremental.queue.enqueue(incremental.context, {
      text: 'd1246248584 11800\ne1246602869 21980', client_request_id: 'incremental'
    });
    incrementalWork = incremental.queue.processPending();
    await new Promise(resolve => setImmediate(resolve));
    const firstTask = incremental.raw.prepare('SELECT product_id, status FROM tasks').all();
    assert.deepEqual(firstTask, [{ product_id: 'd1246248584', status: 'pending' }],
      'First prepared item must already be in the original plugin queue while the next product is still fetching');
    const preparation = await getBatchPreparationStats(incremental.database);
    assert.equal(preparation.processing, 1);
    assert.equal(preparation.items[0].product_id, 'e1246602869');
    // The plugin can claim/execute the first item independently of preparing the rest.
    incremental.raw.prepare("UPDATE tasks SET status = 'failed', error_msg = 'outbid after bid'").run();
    assert.deepEqual(incremental.queue.listResults(7), []);
    releaseSecond();
    await incrementalWork;
    assert.equal(incremental.raw.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 2);
    assert.deepEqual(incremental.queue.listResults(7), [], 'Both submissions succeeded even if a bid failed');
  } finally {
    releaseSecond();
    if (incrementalWork) await incrementalWork;
    incremental.close();
  }

  const recovery = fixture();
  try {
    const queued = recovery.queue.enqueue(recovery.context, { text: 'd1246248584 11800', client_request_id: 'recovery' });
    const item = recovery.raw.prepare('SELECT * FROM batch_task_submission_items').get();
    recovery.raw.prepare("UPDATE batch_task_submission_items SET status = 'processing'").run();
    recovery.raw.prepare("INSERT INTO tasks (user_id, product_id, status, client_request_id) VALUES (7, ?, 'bidding', ?)")
      .run(item.product_id, `batch-queue-${queued.batch_id}-${item.line_number}`);
    recovery.revoke();
    recovery.queue.start();
    await recovery.queue.processPending();
    assert.equal(recovery.calls.length, 0);
    assert.equal(recovery.raw.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 1);
    assert.deepEqual(recovery.queue.listResults(7), []);
    assert.throws(() => recovery.queue.dismiss(7, 'wrong'));
  } finally { recovery.close(); }
  const revoked = fixture();
  try {
    revoked.queue.enqueue(revoked.context, { text: 'd1246248584 11800', client_request_id: 'revoked' });
    revoked.revoke();
    await revoked.queue.processPending();
    assert.equal(revoked.calls.length, 0);
    assert.equal(revoked.queue.listResults(7)[0].submit_failed_count, 1);
  } finally { revoked.close(); }
  let activeFetches = 0, maxFetches = 0;
  const starts = [];
  const parallel = fixture(async url => {
    starts.push(url.split('/').pop());
    maxFetches = Math.max(maxFetches, ++activeFetches);
    await new Promise(resolve => setTimeout(resolve, 25));
    activeFetches--;
    return { success: true, source: 'http', data: { auctionId: url.split('/').pop(), title: '商品标题',
      currentPrice: 1000, bidCount: 0, taxType: 'tax_zero', productType: 'normal', endTime: '2099-01-01', auctionStatus: 'open' } };
  });
  try {
    const ids = Array.from({ length: 6 }, (_, index) => `a123456780${index}`);
    const enqueueStarted = Date.now();
    parallel.queue.enqueue(parallel.context, { text: ids.map(id => `${id} 2000`).join('\n'), client_request_id: 'serial' });
    const enqueueElapsedMs = Date.now() - enqueueStarted;
    assert.equal(starts.length, 0, 'Batch enqueue must finish before any product fetch starts');
    const startedAt = Date.now();
    await parallel.queue.processPending();
    const elapsedMs = Date.now() - startedAt;
    assert.equal(maxFetches, 1);
    assert.deepEqual(starts, ids, 'Product preparations start in queue order');
    assert.equal(starts.length, 6, 'Each product is fetched exactly once');
    console.log(`Batch submission simulation: enqueue=${enqueueElapsedMs}ms; background preparation=${elapsedMs}ms; 6 products, one fetch each, serial worker`);
  } finally { parallel.close(); }
  const schema = fs.readFileSync(path.join(__dirname, 'batchTaskQueue.sql'), 'utf8').trim();
  assert.ok(fs.readFileSync(path.join(__dirname, '../../db/init.sql'), 'utf8').includes(schema));
  console.log('Durable batch queue tests passed: quick enqueue, per-item task creation, continued submissions, restart recovery, submission-only results and user isolation.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
