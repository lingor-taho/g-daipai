const assert = require('assert/strict');
if (!process.env.DATABASE_URL?.includes('gdaipai-regression-')) throw Error('Run through scripts/run-isolated-regression.cjs');
const express = require('express');
const db = require('../models');
const accounts = require('../services/yahooAccounts');
const scope = require('../services/yahooAccountContext');
const plugin = require('./plugin');
const taskRoute = require('./task');

(async () => {
  db.raw.exec("INSERT INTO users(id,username,password_hash,user_level) VALUES(1,'safety-user1','test',1),(2,'safety-user2','test',1)");
  const a = accounts.list(db)[0].id;
  const b = accounts.save(db, {account_name:'Safety B',yahoo_id:'safety-b',profile_dir:'safety-b',priority:1}).id;
  const c = accounts.save(db, {account_name:'Safety C',yahoo_id:'safety-c',profile_dir:'safety-c',priority:2}).id;
  const app = express(); app.use(express.json()); app.use('/api/plugin', plugin);
  const server = await new Promise(resolve => { const s=app.listen(0,'127.0.0.1',()=>resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/plugin/`;
  let sequence = 0;
  const headers = id => ({'Content-Type':'application/json','X-Yahoo-Account':String(id),
    'X-Yahoo-Token':accounts.list(db,Date.now(),true).find(x=>x.id===id).binding_token,'X-Yahoo-Instance':`safety-plugin-instance-${id}`});
  async function request(id,path,body,method=body?'POST':'GET',expected=200,claim) {
    const response=await fetch(base+path,{method,headers:{...headers(id),...(claim?{'X-Yahoo-Claim':claim}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(8000)});
    const result=await response.json(); assert.equal(response.status,expected,JSON.stringify(result)); return result;
  }
  const claim=id=>request(id,`tasks?limit=2&request_id=safety-request-${++sequence}`);
  const status=(id,t,body,expected=200)=>request(id,`task/${t.id}/status`,body,'PATCH',expected,t.claim_token);
  async function submit(user,product,maxPrice=2000) {
    return taskRoute.submitAuctionTask({user:{id:user,user_level:1},actingUser:{id:user,user_level:1}},
      {product_url:product,max_price:maxPrice,client_request_id:`safety-submit-${++sequence}`},
      {database:db,fetchProduct:async()=>({data:{auctionId:product,title:product,imageUrl:'https://example.com/x.png',
        currentPrice:1000,bidCount:0,taxType:'tax_zero',productType:'normal',endTime:'2099-01-01T00:00:00+09:00',auctionStatus:'open'}})});
  }
  try {
    for (const id of [a,b,c]) await request(id,'config');
    const product='s123456781';
    const first=await submit(1,product),second=await submit(1,product,2500);
    db.raw.prepare("UPDATE tasks SET strategy='snipe',start_seconds_before=30 WHERE id=?").run(second.task_id);
    const historical=db.raw.prepare("INSERT INTO tasks(account_id,user_id,product_id,max_price,status) VALUES(?,1,?,1000,'failed') RETURNING id").get(a,product);
    const originalQueued=db.raw.prepare('SELECT * FROM tasks WHERE id=?').get(second.task_id);
    const current=(await claim(a)).tasks.find(t=>t.id===first.task_id); assert(current);
    const transferred=await status(a,current,{status:'failed',error_code:'SELLER_BLACKLIST',result_unknown:false});
    assert.equal(transferred.accountId,b);
    const moved=db.raw.prepare('SELECT * FROM tasks WHERE id=?').get(second.task_id);
    assert.equal(moved.account_id,b); assert.equal(moved.status,'pending');
    for (const key of ['max_price','user_max_price','strategy','start_seconds_before','created_at']) assert.equal(moved[key],originalQueued[key]);
    assert.deepEqual(JSON.parse(moved.account_attempts),[a]);
    assert.equal(db.raw.prepare('SELECT account_id FROM tasks WHERE id=?').get(historical.id).account_id,a,'finished history remains on actual account');
    await status(a,current,{status:'bidding',bid_price:1200},409);
    const nextUser=await submit(2,product); assert.equal(nextUser.account_id,a);
    const nextA=(await claim(a)).tasks; assert.deepEqual(nextA.map(t=>t.id),[nextUser.task_id]);
    await status(a,nextA[0],{status:'bidding',bid_price:1200});
    // Guard pre-fix or inconsistent queued data as well as newly transferred data.
    const stale=db.raw.prepare("INSERT INTO tasks(account_id,user_id,product_id,max_price,status) VALUES(?,1,?,2000,'pending') RETURNING id").get(a,product);
    assert.equal((await request(a,`task/${stale.id}/status`,{status:'processing'},'PATCH')).success,false);
    assert.equal((await claim(a)).tasks.length,0);
    db.raw.prepare("UPDATE tasks SET status='failed' WHERE id=?").run(stale.id);
    const nextB=(await claim(b)).tasks.find(t=>t.id===first.task_id); assert(nextB);
    const again=await status(b,nextB,{status:'failed',error_code:'SELLER_BLACKLIST',result_unknown:false});
    assert.equal(again.accountId,c); assert.equal(db.raw.prepare('SELECT account_id FROM tasks WHERE id=?').get(second.task_id).account_id,c);
    const last=(await claim(c)).tasks.find(t=>t.id===first.task_id); assert(last);
    assert.equal((await status(c,last,{status:'failed',error_code:'SELLER_BLACKLIST',result_unknown:false})).exhausted,true);
    assert.equal(db.raw.prepare('SELECT status FROM tasks WHERE id=?').get(second.task_id).status,'failed','queued sibling cannot return to a blacklisted account after exhaustion');
    console.log('Queued ownership transfer, retry order, exhaustion and original intent preservation passed.');

    const unknownProduct='s123456782';
    const unknown1=await submit(1,unknownProduct),unknown2=await submit(1,unknownProduct);
    const otherUser=await submit(2,unknownProduct); assert.equal(otherUser.account_id,b);
    const uncertain=(await claim(a)).tasks.find(t=>t.id===unknown1.task_id); assert(uncertain);
    await status(a,uncertain,{status:'failed',result_unknown:true,error_msg:'Yahoo result unavailable'});
    assert.equal((await claim(a)).tasks.length,0);
    assert.equal((await request(a,`task/${unknown2.task_id}/status`,{status:'processing'},'PATCH')).success,false);
    await assert.rejects(submit(1,unknownProduct),/未确认/);
    const unrelated=await submit(1,'s123456785');
    const unrelatedClaim=(await claim(a)).tasks;
    assert.deepEqual(unrelatedClaim.map(t=>t.id),[unrelated.task_id],'unknown result does not block other products on the same account');
    await status(a,unrelatedClaim[0],{status:'bidding',bid_price:1200});
    const independent=(await claim(b)).tasks.find(t=>t.id===otherUser.task_id); assert(independent,'other account remains independent');
    await status(b,independent,{status:'bidding',bid_price:1200});
    // Reuse the existing admin resolution; no new automatic recovery rule.
    const admin=require('./admin');
    db.raw.prepare('UPDATE yahoo_accounts SET heartbeat_at=0 WHERE id=?').run(a);
    const jwt=require('jsonwebtoken');
    db.raw.exec("INSERT INTO users(id,username,password_hash,role,user_level) VALUES(9,'safety-admin','test','admin',3)");
    app.use('/api/admin',admin);
    const adminResponse=await fetch(`http://127.0.0.1:${server.address().port}/api/admin/tasks/${uncertain.id}/resolve-unknown`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${jwt.sign({id:9,role:'admin',user_level:3},require('../../config').jwtSecret,{expiresIn:'5m'})}`},
      body:JSON.stringify({confirmed:true,resolution:'no_bid'})});
    assert.equal(adminResponse.status,200,await adminResponse.text());
    const resumed=(await claim(a)).tasks.find(t=>t.id===unknown2.task_id); assert(resumed);
    await status(a,resumed,{status:'bidding',bid_price:1200});
    console.log('Unknown result blocks existing same-account queue; other accounts and manual resolution remain unchanged.');

    const wonSubmission=await submit(1,'s123456783');
    const won=(await claim(a)).tasks.find(t=>t.id===wonSubmission.task_id); assert(won);
    await request(a,`task/${won.id}/snapshot`,{status:'processing',current_price:1300},'PATCH',200,won.claim_token);
    await request(a,'orders/sync',{orders:[{productId:won.product_id,price:1500}]});
    const before=db.raw.prepare('SELECT * FROM tasks WHERE id=?').get(won.id);
    const beforeProduct=db.raw.prepare('SELECT current_price FROM products WHERE product_id=?').get(won.product_id);
    for (const endpoint of ['touch','snapshot']) await request(a,`task/${won.id}/${endpoint}`,{status:'pending',current_price:9000},'PATCH',409,won.claim_token);
    assert.deepEqual(db.raw.prepare('SELECT * FROM tasks WHERE id=?').get(won.id),before);
    assert.deepEqual(db.raw.prepare('SELECT current_price FROM products WHERE product_id=?').get(won.product_id),beforeProduct);
    const order=db.raw.prepare('SELECT id FROM orders WHERE task_id=?').get(won.id);
    const trade=(await request(a,'transaction-start/jobs')).jobs.find(j=>j.orderId===order.id); assert(trade);
    const pause=require('../services/orderPause');
    await scope.run({accountId:a},()=>pause.setOrderPaused(db,{orderId:order.id,pause:true}));
    assert.equal((await request(a,'transaction-start/eligibility',{orderId:order.id})).eligible,false);
    await request(a,'work/release',{kind:'transaction-start',jobs:[{orderId:order.id,claimToken:trade.claimToken}]});
    assert.equal(db.raw.prepare('SELECT order_status FROM orders WHERE id=?').get(order.id).order_status,'paused');
    await scope.run({accountId:a},()=>pause.setOrderPaused(db,{orderId:order.id,pause:false}));
    const tradeResumed=(await request(a,'transaction-start/jobs')).jobs.find(j=>j.orderId===order.id); assert(tradeResumed);
    assert.notEqual(tradeResumed.claimToken,trade.claimToken,'original resume can acquire a new transaction claim');
    await request(a,'work/release',{kind:'transaction-start',jobs:[{orderId:order.id,claimToken:tradeResumed.claimToken}]});
    await status(a,uncertain,{status:'bidding',bid_price:1400},409);
    for (const endpoint of ['touch','snapshot']) await request(a,`task/${resumed.id}/${endpoint}`,{status:'pending'},'PATCH',409,'obsolete-claim');
    const activeSubmission=await submit(1,'s123456784');
    const active=(await claim(a)).tasks.find(t=>t.id===activeSubmission.task_id); assert(active);
    // Normal strategy-window deferral and no-bid scheduling still work.
    await request(a,`task/${active.id}/snapshot`,{status:'pending',current_price:1100},'PATCH',200,active.claim_token);
    const reclaimed=(await claim(a)).tasks.find(t=>t.id===active.id); assert(reclaimed); assert.notEqual(reclaimed.claim_token,active.claim_token);
    await request(a,`task/${active.id}/snapshot`,{status:'processing',current_price:9999},'PATCH',409,active.claim_token);
    await request(a,`task/${reclaimed.id}/touch`,{status:'bidding'},'PATCH',200,reclaimed.claim_token);
    await request(a,`task/${reclaimed.id}/touch`,{status:'bidding'},'PATCH',200,reclaimed.claim_token);
    console.log('Won state and snapshot fencing; current execution snapshot and scheduling behavior passed.');
    console.log('Original pause/resume with exact transaction claim release and reacquisition passed.');
  } finally {
    server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); db.raw.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
