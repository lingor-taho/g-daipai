const assert = require('assert/strict');
if (!process.env.DATABASE_URL?.includes('gdaipai-regression-')) throw new Error('Run with scripts/run-isolated-regression.cjs');
process.env.JWT_SECRET = 'isolated-shipment-alert-test';
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../models');
const accounts = require('../services/yahooAccounts');
const scope = require('../services/yahooAccountContext');
const plugin = require('./plugin');
const admin = require('./admin');

(async () => {
  const raw = db.raw;
  raw.exec("INSERT INTO users(id,username,password_hash,role,user_level) VALUES(1,'buyer','x','user',1),(9,'admin','x','admin',3)");
  const a = accounts.list(db)[0].id;
  const b = accounts.save(db, {account_name:'B',yahoo_id:'shipment-b',profile_dir:'shipment-b',priority:1}).id;
  const day = 86400000;
  const now = Date.now();
  const since = new Date(now - 9 * day).toISOString();
  function seed(id, account, status = 'pending_shipment', time = since, type = 'normal') {
    const product = `h${1246600000 + id}`;
    raw.prepare('INSERT INTO products(product_id,product_title,product_type) VALUES(?,?,?)').run(product, product, type);
    raw.prepare("INSERT INTO tasks(id,user_id,account_id,product_id,max_price,strategy,status) VALUES(?,1,?,?,100,'direct','success')").run(id, account, product);
    raw.prepare('INSERT INTO orders(id,task_id,product_id,account_id,final_price,order_status,won_at,created_at,updated_at) VALUES(?,?,?,?,100,?,?,?,?)')
      .run(id, id, product, account, status, new Date(now - 20 * day).toISOString(), time, time);
    raw.prepare("INSERT INTO order_status_change_logs(order_id,product_id,new_status,source,created_at) VALUES(?,?,'pending_shipment','test',?)").run(id,product,time);
    return product;
  }
  const product = seed(1, a);
  seed(2, b, 'pending_shipment', since, 'fleamarket');
  seed(3, a, 'pending_shipment', new Date(now - 7 * day).toISOString());
  for (const [i,status] of ['pending_payment','pending_receipt','completed','cancelled'].entries()) seed(i+4,a,status);
  seed(8, a, 'pending_shipment', new Date(now - 8 * day + 1).toISOString());
  seed(9, a, 'pending_shipment', new Date(now - 8 * day).toISOString(), 'store');
  seed(10, a);
  raw.prepare('DELETE FROM order_status_change_logs WHERE order_id=10').run();
  seed(11, a, 'pending_shipment', 'invalid');
  // A recent unrelated order update must not reset the original pending start.
  raw.prepare('UPDATE orders SET updated_at=? WHERE id=1').run(new Date(now).toISOString());
  const before = raw.prepare('SELECT * FROM orders ORDER BY id').all();
  const refresh = time => scope.run({accountId:a}, () => plugin.refreshPendingShipmentAlerts(db,time));
  let alerts = await refresh(now);
  assert.deepEqual(alerts.map(x=>[x.orderId,x.daysOverdue]), [[1,9],[9,8],[10,9]]);
  assert.equal((await refresh(now)).length,3,'polling deduplicates the same day');
  assert.equal((await scope.run({accountId:b},()=>plugin.getShipmentAlerts(db))).length,0,'account A cannot generate account B alerts');
  assert.deepEqual(raw.prepare('SELECT * FROM orders ORDER BY id').all(),before,'reminders never mutate orders');

  const app = express();
  app.use(express.json()); app.use('/api/admin',admin);
  const server = await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const token = jwt.sign({id:9,role:'admin',user_level:3},process.env.JWT_SECRET,{expiresIn:'5m'});
  async function request(path,method='GET') {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/${path}`,{method,headers:{Authorization:`Bearer ${token}`}});
    const json=await response.json(); assert.equal(response.status,200,JSON.stringify(json)); return json;
  }
  try {
    // No plugin or Yahoo reads: the actual top-alert endpoint generates both accounts.
    let flags = await request('idle-flags');
    assert(flags.accounts.find(x=>x.account_id===a).shipmentAlerts.some(x=>x.orderId===1));
    assert.deepEqual(flags.accounts.find(x=>x.account_id===b).shipmentAlerts.map(x=>x.orderId),[2]);
    await request(`shipment-alerts/shipment-1-9/close?account_id=${a}`,'POST');
    flags = await request('idle-flags');
    assert(!flags.accounts.find(x=>x.account_id===a).shipmentAlerts.some(x=>x.orderId===1),'closed reminder stays hidden on polling');
    // Existing successful scans share the same daily ID and cannot reopen it.
    await scope.run({accountId:a},()=>plugin.updateScanStatus({orderId:1,productId:product,pendingShipment:true,daysOverdue:9},db));
    alerts = await refresh(now);
    assert(alerts.find(x=>x.id==='shipment-1-9').closedAt);
    alerts = await refresh(now + day);
    assert(alerts.some(x=>x.id==='shipment-1-10'&&!x.closedAt),'next day produces the original new reminder');
    // Keep the existing shipment update and automatic close behavior.
    await scope.run({accountId:a},()=>plugin.updateScanStatus({orderId:1,shipped:true,shippingCompany:'test',trackingNumber:'123456789012'},db));
    alerts = await refresh(now + 2 * day);
    assert(!alerts.some(x=>x.id==='shipment-1-11'));
    assert(alerts.find(x=>x.id==='shipment-1-10').autoClosedAt);
    assert.equal(raw.prepare('SELECT order_status FROM orders WHERE id=1').get().order_status,'pending_receipt');
    assert.equal(plugin.calculateOverdueShipmentDays(since,now),9);
    console.log('Shipment alert threshold, daily close/repeat, scan independence, HTTP and account isolation passed');
  } finally { await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
