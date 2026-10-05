const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const express = require('express');
const jwt = require('jsonwebtoken');
const { getAdminTaskQueue } = require('./adminTaskQueue');
const { getBatchPreparationStats } = require('./batchTaskQueue');

async function run() {
  const raw = new Database(':memory:');
  raw.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
    INSERT INTO users VALUES (1, 'user1');
    CREATE TABLE config (key TEXT, value TEXT);
    CREATE TABLE products (product_id TEXT PRIMARY KEY, product_url TEXT, current_price INTEGER,
      buyout_price INTEGER, end_time TEXT);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, user_id INTEGER, product_id TEXT, max_price INTEGER,
      user_max_price INTEGER, bid_mode TEXT, strategy TEXT, status TEXT, created_at TEXT,
      updated_at TEXT, last_bid_at TEXT, start_minutes_before INTEGER, start_seconds_before INTEGER);
    CREATE TABLE bid_logs (task_id INTEGER, bid_price INTEGER, result TEXT);`);
  raw.exec(fs.readFileSync(path.join(__dirname, 'batchTaskQueue.sql'), 'utf8'));
  const db = {
    async getAll(sql, params = []) { return raw.prepare(sql).all(...params); },
    async getOne(sql, params = []) { return raw.prepare(sql).get(...params); }
  };
  // Prevent importing the route from opening or initializing a workspace database.
  const modelPath = require.resolve('../models');
  require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: db };
  const router = require('../routes/admin');
  const app = express();
  app.use('/api/admin', router);
  app.use((error, req, res, next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/admin/tasks/queue`;
  const token = role => jwt.sign({ id: 1, role }, require('../../config').jwtSecret);
  const request = (query = '', role = 'admin') => fetch(url + query, {
    headers: { Authorization: `Bearer ${token(role)}` }
  });
  try {
    raw.exec(`INSERT INTO products VALUES ('p1', 'https://example.com/p1', 100, 1100, '2099-01-01T00:00:00Z');
      INSERT INTO tasks VALUES
        (1,1,'p1',1000,1100,'buyout','direct','pending','2026-10-01',NULL,NULL,NULL,NULL),
        (2,1,'p1',1000,1000,'bid','5min','pending','2026-10-02',NULL,NULL,NULL,NULL),
        (3,1,'p1',1000,1000,'bid','direct','processing','2026-10-02',NULL,NULL,NULL,NULL),
        (4,1,'p1',1000,1000,'bid','direct','failed','2026-10-02',NULL,NULL,NULL,NULL),
        (5,1,'p1',1000,1000,'bid','multi_bid','bidding','2026-10-02',NULL,NULL,NULL,NULL);
      INSERT INTO batch_task_submissions (id,user_id,login_user_id,client_request_id,input_text,created_at)
        VALUES (1,1,1,'batch1','text','2026-10-03');`);
    const insert = raw.prepare(`INSERT INTO batch_task_submission_items
      (batch_id,line_number,input_text,product_id,product_url,max_price,status,task_id)
      VALUES (1,?,'text',?,'https://example.com/new',200,?,?)`);
    for (let line = 1; line <= 53; line++) insert.run(line, `new${line}`, 'pending', null);
    insert.run(54, 'processing', 'processing', null);
    insert.run(55, 'failed', 'submit_failed', null);
    insert.run(56, 'submitted', 'submitted', 1);

    const all = await getAdminTaskQueue(db, { pageSize: 100 });
    assert.equal(all.total, 55);
    assert.equal(all.items.length, 55, 'Detail must include pending preparations beyond the stats preview limit');
    const preparation = await getBatchPreparationStats(db);
    const pendingTasks = await db.getOne("SELECT COUNT(*) AS n FROM tasks WHERE status = 'pending'");
    assert.equal(all.total, pendingTasks.n + preparation.pending, 'Detail and statistic use the same pending states');
    assert.equal(new Set(all.items.map(item => item.queue_key)).size, 55, 'Task and preparation IDs cannot collide');
    assert.ok(all.items.every(item => ['pending', 'preparation_pending'].includes(item.status)));
    assert.equal(all.items.filter(item => item.queue_key === 'task:1').length, 1, 'Submitted batch rows must not duplicate created tasks');
    const paged = [];
    for (let offset = 0; offset < 55; offset += 10) {
      const page = await getAdminTaskQueue(db, { pageSize: 10, offset });
      paged.push(...page.items);
      assert.equal(page.total, 55);
    }
    assert.deepEqual(paged, all.items);
    assert.equal((await getAdminTaskQueue(db, { offset: 1000 })).items.length, 0);

    assert.equal((await fetch(url)).status, 401);
    assert.equal((await request('', 'user')).status, 403);
    for (const query of ['?current=0', '?current=bad', '?pageSize=101', '?pageSize=1.5']) {
      assert.equal((await request(query)).status, 400);
    }
    const response = await request('?current=1&pageSize=10');
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.total, 55);
    assert.equal(data.items.length, 10);
    assert.equal(data.items[0].max_price, 1100, 'Buyout display must match the existing task list');
    assert.equal(data.items[1].next_execute_at, '2098-12-31T23:55:00.000Z', 'Future scheduled tasks remain visible');
    assert.equal(data.items[2].next_execute_at, null, 'Unprepared items have no bid execution time');
    assert.equal(data.items[2].current_price, null, 'Do not display stale product snapshots before preparation');
    assert.equal((await db.getOne('SELECT COUNT(*) AS n FROM tasks')).n, 5, 'Viewing the queue must not create or claim work');
    raw.exec("UPDATE tasks SET status = 'failed'; UPDATE batch_task_submission_items SET status = 'submit_failed';");
    assert.deepEqual(await (await request()).json(), { items: [], total: 0 });
    console.log('Admin queue details tests passed.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    raw.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
