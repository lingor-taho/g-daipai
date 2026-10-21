const assert = require('assert/strict');
if (!process.env.DATABASE_URL?.includes('gdaipai-regression-')) throw new Error('Run with scripts/run-isolated-regression.cjs');
const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const db = require('../models');
const accounts = require('../services/yahooAccounts');
const plugin = require('./plugin');
const taskRouter = require('./task');
const { completePurchase } = require('../services/fleamarketPurchase');

(async () => {
  const raw = db.raw;
  const RealDate = Date;
  const fixedNow = RealDate.parse('2026-10-20T23:45:37+09:00');
  const accountId = accounts.list(db)[0].id;
  const context = { accountId, instanceId: 'time-test-instance' };
  let server;
  try {
    raw.exec("INSERT INTO users(id,username,password_hash,role,user_level) VALUES(1,'time-test','x','user',1)");
    for (const [id, productId, type] of [[1,'d1248717488','normal'],[2,'z708102256','fleamarket'],[3,'s1248717488','store'],[4,'a1248717488','normal']]) {
      raw.prepare('INSERT INTO products(product_id,product_type) VALUES(?,?)').run(productId,type);
      raw.prepare(`INSERT INTO tasks(id,user_id,account_id,product_id,max_price,strategy,bid_mode,status,claim_token,claim_instance,execution_unknown)
        VALUES(?,1,?,?,2000,'direct','buyout',?,'time-claim',?,?)`).run(id,accountId,productId,id===2?'processing':'success',context.instanceId,id===2?1:0);
    }
    global.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [fixedNow])); }
      static now() { return fixedNow; }
    };
    completePurchase(raw,2,context,'time-claim',{
      doneUrl:'https://paypayfleamarket-sec.yahoo.co.jp/item/z708102256/order/done',successText:'購入が完了しました'
    });
    await plugin.upsertOrderFromTask(1,{finalPrice:2000,wonTimeText:'10/20 22:52'},db);
    await plugin.upsertOrderFromTask(3,{finalPrice:2000,wonTimeText:'10/20 23:50'},db);
    await plugin.upsertOrderFromTask(4,{finalPrice:2000,wonTimeText:'10/20 23:45'},db);
    const p = raw.prepare('SELECT * FROM orders WHERE task_id=2').get();
    const normal = raw.prepare('SELECT * FROM orders WHERE task_id=4').get();
    assert.equal(p.won_time_text,'10/20 23:45','P display text stays in Japan time');
    assert.equal(p.won_at,normal.won_at,'same Japan wall time must save identically for P and normal');
    assert.equal(p.won_at,new RealDate(2026,9,20,23,45,0).toISOString(),'preserve normal/shop local-time conversion and minute precision');
    // A duplicate/recovery confirmation must preserve the original stored time.
    const duplicate = completePurchase(raw,2,context,'time-claim',{
      doneUrl:'https://paypayfleamarket-sec.yahoo.co.jp/item/z708102256/order/done',successText:'購入が完了しました'
    });
    assert.equal(duplicate.duplicate,true);
    assert.equal(raw.prepare('SELECT won_at FROM orders WHERE task_id=2').get().won_at,p.won_at);
    global.Date = RealDate;
    const app = express();
    app.use('/api/task',taskRouter);
    server = await new Promise(resolve => { const value=app.listen(0,'127.0.0.1',()=>resolve(value)); });
    const token = jwt.sign({id:1,role:'user',user_level:1},config.jwtSecret,{expiresIn:'1h'});
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/task/won`,{headers:{Authorization:`Bearer ${token}`}});
    assert.equal(response.status,200);
    const body = await response.json();
    assert.deepEqual(body.data.map(row=>row.product_id),['s1248717488','a1248717488','z708102256','d1248717488'],'shared list sorts shop, tied normal/P, then earlier normal');
    const listedP = body.data.find(row=>row.product_id==='z708102256');
    assert.equal(listedP.won_at,p.won_at);
    assert.equal(listedP.won_time_text,p.won_time_text,'shared read path returns stored Japan text unchanged');
    console.log(`P/normal/shop order time and won-list HTTP tests passed (${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
  } finally {
    global.Date = RealDate;
    if (server) await new Promise(resolve=>server.close(resolve));
    raw.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
