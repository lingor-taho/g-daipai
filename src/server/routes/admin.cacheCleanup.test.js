const assert = require('node:assert/strict');
if (!process.env.DATABASE_URL?.includes('gdaipai-regression-')) throw new Error('Run with scripts/run-isolated-regression.cjs');
process.env.JWT_SECRET = 'isolated-cache-cleanup-test';
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../models');
const admin = require('./admin');
const negotiation = require('../services/fleamarketNegotiation');
const { deleteStaleNegotiationCache, shouldRunAutoCleanup } = require('../services/dataCleanup');

(async () => {
  const { raw } = db;
  raw.exec("INSERT INTO users(id,username,password_hash,role,user_level) VALUES(91,'cache-admin','x','admin',3),(92,'cache-user','x','user',1)");
  const app = express();
  app.use(express.json());
  app.use('/api/admin', admin);
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const request = async (path, method = 'GET', body, role = 'admin') => {
    const token = jwt.sign({ id: role === 'admin' ? 91 : 92, role }, process.env.JWT_SECRET);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/data-cleanup/${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
  const put = raw.prepare('INSERT INTO config(key,value) VALUES (?,?)');
  const putHistory = (id, submittedAt) => put.run(`fleamarket_negotiation_history:${id}`,
    JSON.stringify({ productId: id, submittedAt: new Date(submittedAt).toISOString(), price: 800 }));
  const exists = key => Boolean(raw.prepare('SELECT 1 FROM config WHERE key=?').get(key));
  const day = 86_400_000;
  try {
    assert.deepEqual((await request('config')).body, { enabled: false, cleanupHour: 3, retentionDays: 30 });
    assert.deepEqual((await request('cache/config')).body, { enabled: false, cleanupHour: 3, retentionDays: 1 });
    assert.equal((await request('logs', 'DELETE', undefined, 'user')).status, 403);
    assert.equal((await request('cache/run', 'POST', { retentionDays: 0 })).status, 400);
    const settings = { enabled: true, cleanupHour: 3, retentionDays: 2 };
    assert.equal((await request('cache/config', 'PUT', settings)).status, 200);
    assert.deepEqual((await request('cache/config')).body, settings);
    assert.deepEqual((await request('config')).body, { enabled: false, cleanupHour: 3, retentionDays: 30 });

    const now = Date.now();
    putHistory('z100000001', now - 2 * day);
    putHistory('z100000002', now - day / 2);
    put.run('fleamarket_negotiation_history:z100000003', 'invalid JSON');
    negotiation.enqueue(raw, 'z100000004', 800, now - 3 * day);
    put.run('unrelated_setting', JSON.stringify({ submittedAt: new Date(now - 5 * day).toISOString() }));
    raw.exec("INSERT INTO products(product_id,product_type) VALUES('z100000001','fleamarket')");
    const manual = await request('CACHE/run', 'POST', { retentionDays: 1 });
    assert.equal(manual.status, 200, JSON.stringify(manual.body));
    assert.equal(manual.body.cacheCount, 1);
    assert.equal(negotiation.getStatus(raw, 'z100000001').state, 'available');
    assert.equal(negotiation.getStatus(raw, 'z100000002').state, 'submitted');
    assert.equal(negotiation.getStatus(raw, 'z100000004').state, 'pending');
    assert.ok(exists('fleamarket_negotiation_history:z100000003'));
    assert.ok(exists('unrelated_setting'));
    assert.ok(raw.prepare("SELECT 1 FROM products WHERE product_id='z100000001'").get());

    const runAt = new Date(2030, 0, 2, 3, 0, 0).getTime();
    raw.exec("INSERT INTO data_cleanup_logs(run_type,local_date,retention_days,task_count) VALUES('auto','2030-01-02',30,5)");
    assert.equal(await shouldRunAutoCleanup(db, settings, runAt), false);
    assert.equal(await shouldRunAutoCleanup(db, settings, runAt, 'cache'), true);
    putHistory('z100000005', runAt - day);
    putHistory('z100000006', runAt - day + 1);
    const auto = deleteStaleNegotiationCache(db, { nowMs: runAt, retentionDays: 1, runType: 'auto' });
    assert.equal(auto.cacheCount, 2, 'previous retained history and the 24h boundary are removed');
    assert.equal(negotiation.getStatus(raw, 'z100000006').state, 'submitted', '1ms inside retention is kept');
    assert.equal(deleteStaleNegotiationCache(db, { nowMs: runAt, runType: 'auto' }), null);
    const logs = (await request('logs')).body;
    assert.equal(logs.total, 3);
    assert.deepEqual(logs.items.map(row => [row.cleanup_scope, row.run_type, row.cache_count, row.task_count]).sort(), [
      ['cache', 'auto', 2, 0], ['cache', 'manual', 1, 0], ['data', 'auto', 0, 5]
    ]);

    assert.deepEqual((await request('logs', 'DELETE')).body, { success: true, deletedCount: 3 });
    assert.deepEqual((await request('logs')).body, { items: [], total: 0 });
    assert.equal(await shouldRunAutoCleanup(db, settings, runAt), false, 'clearing logs does not reopen the old data schedule');
    assert.equal(await shouldRunAutoCleanup(db, settings, runAt, 'cache'), false, 'clearing logs does not reopen the cache schedule');
    assert.equal(await shouldRunAutoCleanup(db, settings, new Date(2030, 0, 3, 3).getTime(), 'cache'), true);
    assert.equal(negotiation.getStatus(raw, 'z100000006').state, 'submitted', 'clearing logs leaves cached offers alone');
    console.log('Cache cleanup: separate settings, precise date scope, shared logs, admin authorization and schedule preserved');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
