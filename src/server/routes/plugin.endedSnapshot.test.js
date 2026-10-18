const assert = require('assert/strict');
if (!process.env.DATABASE_URL?.includes('gdaipai-regression-')) throw new Error('Use scripts/run-isolated-regression.cjs');
process.env.JWT_SECRET='ended-snapshot-isolated-test';
const express = require('express');
const db = require('../models');
const plugin = require('./plugin');
const taskRoutes = require('./task');
const adminRoutes = require('./admin');
const jwt = require('jsonwebtoken');
const {withEndedTaskReason,ENDED_REASON}=require('../services/endedTaskReason');
(async () => {
  const account = db.raw.prepare('SELECT * FROM yahoo_accounts ORDER BY id LIMIT 1').get();
  db.raw.prepare("INSERT INTO users(id,username,password_hash,role) VALUES(700,'snapshot-user','test','user')").run();
  db.raw.prepare("INSERT INTO users(id,username,password_hash,role) VALUES(701,'snapshot-admin','test','admin')").run();
  const app = express();app.use(express.json());app.use('/api/plugin',plugin);
  app.use('/api/task',taskRoutes);app.use('/api/admin',adminRoutes);
  const server = await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={'Content-Type':'application/json','X-Yahoo-Account':String(account.id),'X-Yahoo-Token':account.binding_token,'X-Yahoo-Instance':'ended-snapshot-test-instance','X-Yahoo-Claim':'claim'};
  const past = '2026-01-01T10:00:00+09:00';
  const future = '2099-01-01T10:00:00+09:00';
  let nextId=50000;
  function task(error=null) {
    const id=nextId++;
    db.raw.prepare("INSERT INTO products(product_id,product_type) VALUES(?,'normal')").run(`s${123400000+id}`);
    db.raw.prepare(`INSERT INTO tasks(id,user_id,account_id,product_id,max_price,strategy,status,error_msg,claim_token,claim_instance)
      VALUES(?,700,?, ?,24000,'direct','processing',?,'claim','ended-snapshot-test-instance')`).run(id,account.id,`s${123400000+id}`,error);
    return id;
  }
  async function send(id,endpoint,body,claim='claim') {
    const r=await fetch(`${base}/api/plugin/task/${id}/${endpoint}`,{method:'PATCH',headers:{...headers,'X-Yahoo-Claim':claim},body:JSON.stringify(body)});
    return {status:r.status,data:await r.json()};
  }
  try {
    const ended=task();
    const initial = await send(ended,'snapshot',{status:'failed',end_time:past,current_price:20000});
    assert.equal(initial.status,200,JSON.stringify(initial.data));
    const expected='Auction ended according to product page snapshot';
    assert.equal(db.raw.prepare('SELECT error_msg FROM tasks WHERE id=?').get(ended).error_msg,expected);
    assert.equal((await send(ended,'status',{status:'failed',error_msg:expected})).data.duplicate,true);
    assert.equal(db.raw.prepare('SELECT error_msg FROM tasks WHERE id=?').get(ended).error_msg,expected);
    const labelSource = require('fs').readFileSync(require('path').join(__dirname,'../../shared/taskFailureReason.js'),'utf8').replace('export function','function');
    const label = require('vm').runInNewContext(`${labelSource};getTaskFailureLabel`);
    assert.equal(label(expected),'失败：商品已结束');
    for(const time of [future,null,'invalid']) {
      const id=task();await send(id,'snapshot',{status:'failed',end_time:time});
      assert.equal(db.raw.prepare('SELECT error_msg FROM tasks WHERE id=?').get(id).error_msg,null);
    }
    const existing=task('Rebid required: current bid is not high enough');
    await send(existing,'snapshot',{status:'failed',end_time:past});
    assert.equal(db.raw.prepare('SELECT error_msg FROM tasks WHERE id=?').get(existing).error_msg,'Rebid required: current bid is not high enough');
    assert.equal(label('Rebid required: current bid is not high enough'),'失败：出价后被超过');
    for(const state of ['pending','processing']) {
      const id=task();await send(id,'snapshot',{status:state,end_time:past});
      assert.equal(db.raw.prepare('SELECT error_msg FROM tasks WHERE id=?').get(id).error_msg,null);
    }
    const stale=task();
    const before=db.raw.prepare('SELECT * FROM tasks WHERE id=?').get(stale);
    assert.equal((await send(stale,'snapshot',{status:'failed',end_time:past},'wrong')).status,409);
    assert.deepEqual(db.raw.prepare('SELECT * FROM tasks WHERE id=?').get(stale),before);
    const won=task();
    db.raw.prepare('INSERT INTO orders(task_id,product_id,account_id,final_price) SELECT id,product_id,account_id,100 FROM tasks WHERE id=?').run(won);
    assert.equal((await send(won,'snapshot',{status:'failed',end_time:past})).status,409);
    assert.equal(db.raw.prepare('SELECT status FROM tasks WHERE id=?').get(won).status,'processing');
    const legacy=task();
    db.raw.prepare("UPDATE tasks SET status='failed' WHERE id=?").run(legacy);
    const rawLegacy=db.raw.prepare('SELECT * FROM tasks WHERE id=?').get(legacy);
    const diagnostic=db.raw.prepare("INSERT INTO plugin_diagnostics(account_id,type,product_id,message,diagnostics) VALUES(?,'bid_failure',?,?,?)");
    diagnostic.run(account.id,rawLegacy.product_id,ENDED_REASON,`stage=read-product-snapshot,taskId=${legacy}0,strategy=direct`);
    assert.equal(withEndedTaskReason([rawLegacy],db)[0].error_msg,null,'Task IDs must match exactly, not by substring');
    db.raw.prepare("INSERT INTO yahoo_accounts(id,account_name,email) VALUES(100,'isolated-other','other@example.com')").run();
    diagnostic.run(100,rawLegacy.product_id,ENDED_REASON,`taskId=${legacy}`);
    diagnostic.run(account.id,'s123456789',ENDED_REASON,`taskId=${legacy}`);
    assert.equal(withEndedTaskReason([rawLegacy],db)[0].error_msg,null,'Other account/product diagnostics must not change the label');
    diagnostic.run(account.id,rawLegacy.product_id,ENDED_REASON,`stage=read-product-snapshot,taskId=${legacy},strategy=direct`);
    assert.equal(withEndedTaskReason([rawLegacy],db)[0].error_msg,ENDED_REASON);
    assert.equal(rawLegacy.error_msg,null,'Read fallback must not mutate input or persisted task');
    const otherError={...rawLegacy,error_msg:'outbid after bid'};
    assert.equal(withEndedTaskReason([otherError],db)[0].error_msg,'outbid after bid');
    for(const [path,actor] of [['/api/task/list?limit=100',700],['/api/admin/tasks?pageSize=100',701]]) {
      const token=jwt.sign({id:actor,role:actor===701?'admin':'user',user_level:1},process.env.JWT_SECRET);
      const r=await fetch(base+path,{headers:{Authorization:`Bearer ${token}`}});assert.equal(r.status,200);
      const data=await r.json();const rows=data.data||data.items;
      assert.equal(rows.find(t=>t.id===legacy).error_msg,ENDED_REASON);
    }
    assert.equal(db.raw.prepare('SELECT error_msg FROM tasks WHERE id=?').get(legacy).error_msg,null);
    assert(db.raw.prepare('SELECT COUNT(*) n FROM tasks WHERE max_price<>24000 OR strategy<>?').get('direct').n===0);
    console.log('Ended snapshot stores reason before duplicate callback; other errors, scheduling, claims, won protection and bid rules unchanged');
  } finally { await new Promise(resolve=>server.close(resolve));db.raw.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
