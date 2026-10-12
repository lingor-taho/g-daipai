const assert = require('assert/strict');
if (!process.env.DATABASE_URL?.includes('gdaipai-regression-')) throw new Error('Run through scripts/run-isolated-regression.cjs');
process.env.JWT_SECRET = 'isolated-user-deletion-test';
const express = require('express');
const jwt = require('jsonwebtoken');
const database = require('../models');
const admin = require('./admin');
const plugin = require('./plugin');

(async () => {
  const raw = database.raw;
  const account = raw.prepare('SELECT id FROM yahoo_accounts ORDER BY id LIMIT 1').get().id;
  raw.exec(`INSERT INTO users(id,username,password_hash,role,user_level) VALUES
    (700,'delete-user','test','user',1),(701,'other-user','test','user',1),
    (702,'protected-user','test','user',3),(703,'empty-user','test','user',2),(799,'test-admin','test','admin',3);`);
  const taskInsert = raw.prepare('INSERT INTO tasks(id,user_id,account_id,product_id,max_price,status) VALUES(?,?,?,?,100,?)');
  taskInsert.run(50000,700,account,'exclusive-delete','success');
  taskInsert.run(50001,701,account,'other-product','success');
  raw.prepare('INSERT INTO orders(id,task_id,account_id,product_id,final_price) VALUES(?,?,?,?,100)').run(60000,50000,account,'exclusive-delete');
  raw.prepare('INSERT INTO orders(id,task_id,account_id,product_id,final_price) VALUES(?,?,?,?,200)').run(60001,50001,account,'other-product');
  raw.prepare('INSERT INTO user_finance_overrides(user_id) VALUES(703)').run();
  const app = express(); app.use(express.json()); app.use('/api/admin',admin);
  app.use('/api/plugin',plugin);
  app.get('/health', (req,res) => res.json({ ok:true }));
  const server = await new Promise(resolve => { const s = app.listen(0,'127.0.0.1',()=>resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = id => jwt.sign({id,role:id===799?'admin':'user',user_level:id===799?3:1},process.env.JWT_SECRET);
  async function remove(id,confirmed=false,actor=799) {
    const response = await fetch(`${base}/api/admin/users/${id}${confirmed?'?confirm=1':''}`, {method:'DELETE',headers:{Authorization:`Bearer ${token(actor)}`}});
    return {status:response.status,data:await response.json()};
  }
  try {
    assert.equal((await remove(700,false,701)).status,403,'Ordinary users cannot delete accounts');
    assert.equal((await remove(702,true)).status,403);
    assert.equal((await remove(799,true)).status,403);
    assert.equal((await remove(99999)).status,404);
    const before = raw.serialize();
    const preview = await remove(700);
    assert.equal(preview.status,409);
    assert.equal(preview.data.requiresConfirmation,true);
    assert.equal(preview.data.taskCount,1);
    assert.equal(preview.data.orderCount,1);
    assert.deepEqual(raw.serialize(),before);
    raw.exec("CREATE TRIGGER user_delete_rollback BEFORE DELETE ON users WHEN OLD.id=700 BEGIN SELECT RAISE(ABORT,'injected deletion error'); END;");
    const beforeRollback = raw.serialize();
    assert.equal((await remove(700,true)).status,500);
    assert.deepEqual(raw.serialize(),beforeRollback);
    assert.equal((await fetch(`${base}/health`)).status,200,'Deletion error must not kill API');
    raw.exec('DROP TRIGGER user_delete_rollback');
    const otherTask = raw.prepare('SELECT * FROM tasks WHERE id=50001').get();
    const otherOrder = raw.prepare('SELECT * FROM orders WHERE id=60001').get();
    assert.equal((await remove(700,true)).status,200);
    assert.deepEqual(raw.prepare('SELECT * FROM tasks WHERE id=50001').get(),otherTask);
    assert.deepEqual(raw.prepare('SELECT * FROM orders WHERE id=60001').get(),otherOrder);
    const binding = raw.prepare('SELECT binding_token FROM yahoo_accounts WHERE id=?').get(account).binding_token;
    const pluginHeaders = {'Content-Type':'application/json','X-Yahoo-Account':String(account),'X-Yahoo-Token':binding,'X-Yahoo-Instance':'delete-test-instance','X-Yahoo-Claim':'old-task-claim'};
    const lateTask = await fetch(`${base}/api/plugin/task/50000/status`,{method:'POST',headers:pluginHeaders,body:JSON.stringify({status:'success'})});
    assert.equal(lateTask.status,409,'Deleted task cannot accept a late plugin callback');
    const lateWork = await fetch(`${base}/api/plugin/work/check`,{method:'POST',headers:pluginHeaders,body:JSON.stringify({kind:'payment',orderId:60000,claimToken:'old-claim'})});
    assert.equal(lateWork.status,409,'Deleted order claim must stop subsequent actions');
    assert.equal((await remove(703)).status,200,'Finance-only user deletes without second confirmation');
    const deletedToken = await fetch(`${base}/api/admin/users`,{headers:{Authorization:`Bearer ${token(700)}`}});
    assert.equal(deletedToken.status,401);
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM user_sessions WHERE user_id=700').get().n,0);
    assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(),[]);
    console.log('User deletion real HTTP confirmation, authorization, rollback, API survival and stale login token tests passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    raw.close();
  }
})().catch(error => { console.error(error); process.exitCode=1; });
