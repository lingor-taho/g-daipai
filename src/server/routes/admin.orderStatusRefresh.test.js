const assert = require('assert/strict');
if (!process.env.DATABASE_URL?.includes('gdaipai-regression-')) throw new Error('Run through scripts/run-isolated-regression.cjs');
process.env.JWT_SECRET = 'isolated-order-status-refresh-test';
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../models');
const admin = require('./admin');

(async () => {
  const raw = db.raw;
  raw.exec("INSERT INTO users(id,username,password_hash,role) VALUES(1,'status-user','x','user'),(9,'status-admin','x','admin')");
  const orderIds = [];
  for (const [productId, productType, status] of [
    ['a123456789', 'normal', 'pending_payment'],
    ['b123456789', 'store', 'pending_receipt'],
    ['z123456789', 'fleamarket', 'pending_shipment'],
    ['s123456789', 'store', 'completed']
  ]) {
    raw.prepare('INSERT OR IGNORE INTO products(product_id,product_type) VALUES(?,?)').run(productId, productType);
    const taskId = raw.prepare("INSERT INTO tasks(user_id,product_id,max_price,strategy,status) VALUES(1,?,300,'direct','success')").run(productId).lastInsertRowid;
    orderIds.push(Number(raw.prepare('INSERT INTO orders(task_id,product_id,final_price,order_status) VALUES(?,?,300,?)').run(taskId, productId, status).lastInsertRowid));
  }
  const app = express();
  app.use(express.json());
  app.use('/api/admin', admin);
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ id: 9, role: 'admin' }, process.env.JWT_SECRET)}` };
  const run = body => fetch(`http://127.0.0.1:${server.address().port}/api/admin/order-status-refresh/run`, { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    const response = await run({ productIdsText: 'a123456789\nb123456789\nz123456789\nx123456789', orderStatus: 'cancelled' });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.updated, 3);
    assert.equal(data.failed, 1);
    assert.deepEqual(data.results[0].orderIds, [orderIds[0]]);
    for (const result of data.results.slice(0, 3)) {
      assert.equal(result.orderStatus, 'cancelled');
      assert.equal(result.orderStatusText, '取消');
    }
    assert.deepEqual(raw.prepare('SELECT order_status FROM orders ORDER BY id').all().map(row => row.order_status), ['cancelled', 'cancelled', 'cancelled', 'completed']);
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM order_status_change_logs WHERE new_status='cancelled' AND source='admin_order_status_refresh'").get().n, 3);
    assert.equal((await run({ productIdsText: 's123456789', orderStatus: 'invalid' })).status, 400);
    assert.equal(raw.prepare('SELECT final_price FROM orders WHERE id=?').get(orderIds[0]).final_price, 300);
    console.log('admin order status refresh HTTP tests passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
