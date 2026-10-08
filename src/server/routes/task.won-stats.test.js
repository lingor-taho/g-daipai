const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

async function run() {
  const raw = new Database(':memory:');
  raw.exec(`CREATE TABLE tasks (id INTEGER PRIMARY KEY, user_id INTEGER, product_id TEXT, status TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, task_id INTEGER, final_price INTEGER, won_at TEXT, won_time_text TEXT);
    CREATE TABLE products (product_id TEXT PRIMARY KEY, product_title TEXT, product_url TEXT, shipping_fee_text TEXT);`);
  const database = {
    getAll: async (sql, params = []) => raw.prepare(sql).all(...params),
    getOne: async (sql, params = []) => raw.prepare(sql).get(...params)
  };
  const modelPath = require.resolve('../models');
  require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: database };
  const router = require('./task');
  const { buildWonStatsInput, buildWonStatsDailyRows } = router;
  const route = router.stack.find(layer => layer.route?.path === '/won-stats').route.stack[0].handle;
  const dates = raw.prepare(`SELECT date('now', 'localtime') AS today,
    date('now', 'localtime', '-1 day') AS yesterday,
    date('now', 'localtime', '-89 days') AS earliest,
    date('now', 'localtime', '-90 days') AS outside`).get();
  const insertTask = raw.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?)');
  ['failed', 'success', 'cancelled', 'pending', 'processing', 'bidding'].forEach((status, index) => {
    // The same product can have multiple submissions; activity counts every task.
    insertTask.run(index + 1, 1, 'same-product', status, `${dates.today} 12:00:00`, `${dates.today} 12:00:00`);
  });
  insertTask.run(7, 1, 'yesterday', 'success', `${dates.yesterday} 12:00:00`, `${dates.today} 12:00:00`);
  insertTask.run(8, 1, 'earliest', 'failed', `${dates.earliest} 12:00:00`, `${dates.earliest} 12:00:00`);
  insertTask.run(9, 1, 'outside', 'success', `${dates.outside} 12:00:00`, `${dates.today} 12:00:00`);
  insertTask.run(10, 2, 'other-user', 'success', `${dates.today} 12:00:00`, `${dates.today} 12:00:00`);
  raw.prepare('INSERT INTO orders VALUES (?, ?, ?, ?, ?)').run(1, 2, 1000, `${dates.today} 12:00:00`, 'today');
  raw.prepare('INSERT INTO orders VALUES (?, ?, ?, ?, ?)').run(2, 7, 2000, `${dates.today} 12:00:00`, 'today');
  raw.prepare('INSERT INTO orders VALUES (?, ?, ?, ?, ?)').run(3, 9, 3000, `${dates.today} 12:00:00`, 'today');
  raw.prepare('INSERT INTO orders VALUES (?, ?, ?, ?, ?)').run(4, 10, 99999, `${dates.today} 12:00:00`, 'today');

  async function request(userId, query = {}) {
    let result;
    let status = 200;
    await route({ user: { id: 1 }, actingUser: { id: userId }, query }, {
      json(value) { result = value; }, status(value) { status = value; return this; }
    });
    assert.equal(status, 200);
    return result.data;
  }
  try {
    const data = await request(1);
    assert.equal(data.days, 90);
    assert.equal(data.daily.length, 90);
    assert.equal(data.daily[0].date, dates.earliest);
    assert.equal(data.daily.at(-1).date, dates.today);
    assert.equal(data.daily.at(-1).task_count, 6, 'Every status and repeat-product submission must count');
    assert.equal(data.daily.at(-1).item_count, 3, 'Wins use won date, including earlier submitted tasks');
    assert.equal(data.daily.at(-1).bid_product_count, 1, 'Repeated submissions for one product count once in the harvest denominator');
    assert.equal(data.daily.at(-1).harvest_rate, 3);
    assert.equal(data.daily.at(-1).total_amount, 6000);
    assert.equal(data.daily.at(-2).task_count, 1);
    assert.equal(data.daily.at(-2).bid_product_count, 1);
    assert.equal(data.daily.at(-2).item_count, 0);
    assert.equal(data.daily.at(-2).harvest_rate, 0);
    assert.equal(data.daily[1].harvest_rate, 0, 'No submissions are displayed as zero to keep the line continuous');
    assert.equal(data.daily.reduce((sum, row) => sum + row.task_count, 0), 8);
    assert.equal(data.performance.taskCount, 8);
    assert.equal(data.items.length, 3, 'CSV continues to use the selected 90-day won range');
    const other = await request(2);
    assert.equal(other.daily.at(-1).task_count, 1);
    assert.equal(other.daily.at(-1).item_count, 1);
    assert.equal(other.daily.at(-1).total_amount, 99999);
    const empty = await request(3);
    assert.equal(empty.daily.length, 90);
    assert.ok(empty.daily.every(row => row.task_count === 0 && row.item_count === 0 && row.harvest_rate === 0));
    const today = data.daily.at(-1).date;
    const overflow = buildWonStatsDailyRows(1, [{ won_date: today, item_count: 3 }], [{ task_date: today, task_count: 4, bid_product_count: 1 }]);
    assert.equal(overflow[0].harvest_rate, 3, 'Daily event-date ratio must preserve values above 100%');
    assert.equal(buildWonStatsInput({ id: 1 }, { days: 1000 }).days, 90);
    assert.equal(buildWonStatsInput({ id: 1 }, { days: 30 }).days, 30, 'Explicit historical API ranges stay supported');
    console.log('90-day statistics API tests passed.');
  } finally { raw.close(); }
}

run().catch(error => { console.error(error); process.exit(1); });
