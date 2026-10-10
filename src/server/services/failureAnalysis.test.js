const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { getFailureAnalysis } = require('./failureAnalysis');

async function run() {
  const raw = new Database(':memory:');
  raw.exec(`CREATE TABLE tasks (id INTEGER PRIMARY KEY, user_id INTEGER, product_id TEXT, max_price INTEGER,
    user_max_price INTEGER, strategy TEXT, status TEXT, created_at TEXT, pending_followup_max_price INTEGER, client_request_id TEXT,account_id INTEGER DEFAULT 1);
    CREATE TABLE products (product_id TEXT PRIMARY KEY, product_url TEXT, product_title TEXT, product_image_url TEXT,
      current_price INTEGER, tax_type TEXT, end_time TEXT, auction_history_data TEXT);
    CREATE TABLE bidding_items (product_id TEXT, status TEXT,account_id INTEGER DEFAULT 1,PRIMARY KEY(account_id,product_id));`);
  const db = { getAll: async (sql, params = []) => raw.prepare(sql).all(...params), getOne: async (sql, params = []) => raw.prepare(sql).get(...params) };
  const expired = raw.prepare("SELECT datetime('now', '-1 day') AS time").get().time;
  const future = raw.prepare("SELECT datetime('now', '+1 day') AS time").get().time;
  const product = raw.prepare('INSERT INTO products(product_id,product_url,product_title,product_image_url,current_price,tax_type,end_time) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const task = raw.prepare('INSERT INTO tasks(id,user_id,product_id,max_price,user_max_price,strategy,status,created_at,pending_followup_max_price,client_request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  let nextId = 1;
  function addProduct(id, end = expired, price = 3500, tax = 'tax_zero') {
    product.run(id, `https://auctions.yahoo.co.jp/jp/auction/${id}`, `Product ${id}`, 'image.png', price, tax, end);
  }
  function addTask(id, price, status = 'failed', user = 1, requestId = null, pendingPrice = null) {
    const taskId = nextId++;
    task.run(taskId, user, id, price, price, 'direct', status, expired, pendingPrice, requestId);
    return taskId;
  }
  try {
    addProduct('history');
    addTask('history', 1000);
    addTask('history', 90000, 'cancelled');
    addTask('history', 2000);
    addTask('history', 2000);
    addTask('history', 99999, 'success', 2);
    raw.prepare('INSERT INTO bidding_items(product_id,status) VALUES (?, ?)').run('history', 'stale');
    addProduct('future', future); addTask('future', 1500);
    addProduct('still-active'); addTask('still-active', 1600);
    raw.prepare('INSERT INTO bidding_items(product_id,status) VALUES (?, ?)').run('still-active', 'outbid');
    addProduct('won'); addTask('won', 1800, 'success'); addTask('won', 2000);
    addProduct('expired-pending'); addTask('expired-pending', 1200, 'pending');
    raw.prepare("UPDATE products SET current_price = 2000 WHERE product_id = 'expired-pending'").run();
    raw.prepare("UPDATE tasks SET strategy = 'multi_bid', max_price = 9000, user_max_price = 9000 WHERE product_id = 'expired-pending'").run();
    addProduct('other-user'); addTask('other-user', 3000, 'failed', 2);
    addProduct('unknown-end', null); addTask('unknown-end', 3000);
    addProduct('bad-end', 'unknown'); addTask('bad-end', 3000);
    addTask('missing-product', 3000);
    addProduct('cancelled-only'); addTask('cancelled-only', 8000, 'cancelled');
    addProduct('split', expired, 7000, 'tax_included');
    const original = addTask('split', 6600);
    addTask('split', 11000, 'failed', 1, `followup-${original}`);
    addProduct('split-pending', expired, 6000, 'tax_included');
    addTask('split-pending', 6600, 'pending', 1, null, 9900);

    raw.prepare("UPDATE products SET auction_history_data='[]' WHERE product_id='history'").run();
    raw.prepare("UPDATE products SET auction_history_data='数据已过期' WHERE product_id='split'").run();
    const result = await getFailureAnalysis(db, { userId: 1, limit: 100 });
    assert.equal(result.total, 5);
    assert.deepEqual(new Set(result.data.map(item => item.product_id)), new Set(['history', 'expired-pending', 'split', 'split-pending', 'cancelled-only']));
    const history = result.data.find(item => item.product_id === 'history');
    assert.equal(history.has_auction_history,1);
    assert.equal(result.data.find(item=>item.product_id==='split').has_auction_history,1);
    assert.equal(result.data.find(item=>item.product_id==='expired-pending').has_auction_history,0);
    assert.equal(history.current_price, 3500);
    assert.equal(history.final_bid, 2000);
    const multiBid = result.data.find(item => item.product_id === 'expired-pending');
    assert.equal(multiBid.current_price, 2000);
    assert.deepEqual(multiBid.bid_history.map(item => item.amount), [9000], 'Multi-bid execution uses the submitted limit, not the current auction price');
    assert.deepEqual(history.bid_history.map(item => item.amount), [1000, 2000, 2000]);
    assert.ok(history.bid_history.every(item => item.status !== 'cancelled'));
    const cancelledOnly = result.data.find(item => item.product_id === 'cancelled-only');
    assert.deepEqual(cancelledOnly.bid_history, [], 'Terminated-only products have no chart triangles or times');
    assert.equal(cancelledOnly.final_bid, 0, 'Textual highest bid uses the same non-terminated history as the chart');
    assert.equal(result.data.find(item => item.product_id === 'split').bid_history.length, 1, 'Automatic followup is not another user submission');
    assert.equal(result.data.find(item => item.product_id === 'split').final_bid, 11000);
    assert.equal(result.data.find(item => item.product_id === 'split-pending').final_bid, 9900);
    const other = await getFailureAnalysis(db, { userId: 2 });
    assert.equal(other.total, 1);
    assert.equal(other.data[0].product_id, 'other-user');
    assert.deepEqual(other.data[0].bid_history.map(item => item.amount), [3000]);
    const { getTaskSubmissionHistory } = require('./taskSubmissionHistory');
    const wonHistory = await getTaskSubmissionHistory(db, 2, ['history']);
    assert.deepEqual(wonHistory.get('history').map(item => item.amount), [99999], 'Won history includes successful submissions and excludes other accounts');
    assert.equal((await getTaskSubmissionHistory(db, 2, [])).size, 0);
    assert.deepEqual((await getTaskSubmissionHistory(db, 1, ['history'])).get('history').map(item => item.amount), [1000, 2000, 2000], 'Shared won-chart history omits terminated tasks');

    for (let i = 0; i < 21; i++) { addProduct(`extra-${i}`); addTask(`extra-${i}`, 100 + i); }
    const first = await getFailureAnalysis(db, { userId: 1, page: 1, limit: 10 });
    const second = await getFailureAnalysis(db, { userId: 1, page: 2, limit: 10 });
    const third = await getFailureAnalysis(db, { userId: 1, page: 3, limit: 10 });
    assert.equal(first.total, 26);
    assert.equal(first.data.length, 10);
    assert.equal(second.data.length, 10);
    assert.equal(third.data.length, 6);
    assert.equal(new Set([...first.data, ...second.data, ...third.data].map(item => item.product_id)).size, 26);
    assert.equal((await getFailureAnalysis(db, { userId: 3 })).total, 0);
    // Route wiring can be exercised without initializing any workspace database.
    const modelPath = require.resolve('../models');
    require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: db };
    const router = require('../routes/task');
    const routeIndex = router.stack.findIndex(layer => layer.route?.path === '/bidding-analysis');
    assert.ok(routeIndex < router.stack.findIndex(layer => layer.route?.path === '/:id'));
    let response;
    await router.stack[routeIndex].route.stack[0].handle({ user: { id: 1 }, actingUser: { id: 2 }, query: {} }, {
      json(value) { response = value; }, status() { throw new Error('Unexpected route error'); }
    });
    assert.equal(response.total, 1, 'Route must use acting user rather than login user');
    const originalGetAll = db.getAll;
    const originalGetOne = db.getOne;
    db.getAll = async (sql, params) => sql.includes('FROM tasks won_task') ? [{ product_id: 'history', final_price: 2000 }] : originalGetAll(sql, params);
    db.getOne = async () => ({ total: 1 });
    const wonRoute = router.stack.find(layer => layer.route?.path === '/won');
    await wonRoute.route.stack[0].handle({ user: { id: 1 }, actingUser: { id: 2 }, query: {} }, {
      json(value) { response = value; }, status() { throw new Error('Unexpected won route error'); }
    });
    assert.deepEqual(response.data[0].bid_history.map(item => item.amount), [99999]);
    assert.equal(response.data[0].final_price, 2000, 'The won price remains unchanged');
    db.getAll = originalGetAll;
    db.getOne = originalGetOne;
    console.log('Failure analysis tests passed.');
  } finally { raw.close(); }
}

run().catch(error => { console.error(error); process.exit(1); });
