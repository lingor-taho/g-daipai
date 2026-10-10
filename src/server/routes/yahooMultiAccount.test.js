// The runner must supply a disposable database; never use the configured project DB.
const assert=require('assert/strict');
if(!process.env.DATABASE_URL?.includes('gdaipai-regression-')) throw new Error('Run through scripts/run-isolated-regression.cjs');
process.env.JWT_SECRET='isolated-multi-account-test-secret';
const express=require('express');
const jwt=require('jsonwebtoken');
const database=require('../models');
const accounts=require('../services/yahooAccounts');
const scope=require('../services/yahooAccountContext');
const history=require('../services/auctionHistory');
const foreground=require('../services/yahooForeground');
const plugin=require('./plugin');
const admin=require('./admin');
const task=require('./task');

(async()=>{
  database.raw.exec("INSERT INTO users(id,username,password_hash,role,user_level) VALUES(1,'user1','test','user',1),(2,'user2','test','user',1),(3,'user3','test','user',1),(4,'user4','test','user',1),(9,'admin','test','admin',3)");
  const a=accounts.list(database)[0].id;
  accounts.save(database,{account_name:'A',yahoo_id:'test-yahoo-a',email:'a@example.com',profile_dir:'test-profile-a',is_primary:1,enabled:1,priority:0},a);
  const b=accounts.save(database,{account_name:'B',yahoo_id:'test-yahoo-b',email:'b@example.com',profile_dir:'test-profile-b',priority:1}).id;
  const c=accounts.save(database,{account_name:'C',yahoo_id:'test-yahoo-c',email:'c@example.com',profile_dir:'test-profile-c',priority:2}).id;
  const app=express();app.use(express.json());app.use('/api/plugin',plugin);app.use('/api/admin',admin);app.use('/api/task',task);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const instance=id=>`test-plugin-instance-${id}`;
  const headers=id=>{
    const row=accounts.list(database,Date.now(),true).find(a=>a.id===id);
    return {'Content-Type':'application/json','X-Yahoo-Account':String(id),'X-Yahoo-Token':row.binding_token,'X-Yahoo-Instance':instance(id)};
  };
  const token=user=>jwt.sign({id:user,role:user===9?'admin':'user',user_level:user===9?3:1},process.env.JWT_SECRET,{expiresIn:'5m'});
  async function request(path,options={},expected=200){const response=await fetch(base+path,{...options,signal:AbortSignal.timeout(8000)});const json=await response.json();assert.equal(response.status,expected,`${path}: ${JSON.stringify(json)}`);return json;}
  const adminRequest=(path,body,method='POST',expected=200)=>request('/api/admin/'+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token(9)}`},...(body?{body:JSON.stringify(body)}:{})},expected);
  let requestNumber=0;
  const claim=(id,requestId=`test-request-identifier-${++requestNumber}`)=>request(`/api/plugin/tasks?limit=2&request_id=${requestId}`,{headers:headers(id)});
  const status=(id,t,payload,expected=200)=>request(`/api/plugin/task/${t.id}/status`,{method:'PATCH',headers:{...headers(id),'X-Yahoo-Claim':t.claim_token},body:JSON.stringify(payload)},expected);
  async function submit(user,product='a123456789'){
    return task.submitAuctionTask({user:{id:user,user_level:1},actingUser:{id:user,user_level:1}}, {product_url:product,max_price:2000,client_request_id:`request-user-${user}-${product}`}, {database,fetchProduct:async()=>({success:true,source:'http',data:{auctionId:product,title:product,imageUrl:'https://example.com/image.png',currentPrice:1000,bidCount:0,taxType:'tax_zero',productType:'normal',endTime:'2099-01-01T00:00:00+09:00',auctionStatus:'open'}})});
  }
  try {
    await request('/api/plugin/config',{},401);
    for(const id of [a,b,c]) await request('/api/plugin/config',{headers:headers(id)});
    await request('/api/plugin/config',{headers:{...headers(a),'X-Yahoo-Instance':'another-profile-instance'}},409);
    const submitted=await Promise.all([submit(1),submit(2),submit(3)]);
    assert.deepEqual(submitted.map(t=>t.account_id),[a,b,c]);
    await assert.rejects(submit(4),/暂无可用/);
    const [first,retry]=await Promise.all([claim(a,'same-request-identifier-0001'),claim(a,'same-request-identifier-0001')]);
    assert.deepEqual(first.tasks.map(t=>t.id),retry.tasks.map(t=>t.id),'concurrent retries return the same claim');
    const ta=first.tasks[0],tb=(await claim(b)).tasks[0],tc=(await claim(c)).tasks[0];
    assert.equal(ta.account_id,a);assert.equal(tb.account_id,b);assert.equal(tc.account_id,c);
    await status(b,ta,{status:'bidding',bid_price:1200},409);
    for(const [id,t] of [[a,ta],[b,tb],[c,tc]]) await status(id,t,{status:'bidding',bid_price:1200});
    await status(a,ta,{status:'bidding',bid_price:1200});
    assert.equal(database.raw.prepare('SELECT COUNT(*) n FROM bid_logs WHERE task_id=?').get(ta.id).n,1,'repeated completion is idempotent');
    for(const [id,state] of [[a,'highest'],[b,'outbid']]) await request('/api/plugin/bidding/sync',{method:'POST',headers:headers(id),body:JSON.stringify({items:[{productId:'a123456789',url:'https://auctions.yahoo.co.jp/jp/auction/a123456789',price:1300,status:state}]})});
    assert.equal(database.raw.prepare("SELECT COUNT(*) n FROM bidding_items WHERE product_id='a123456789'").get().n,2);
    await request('/api/plugin/bidding/sync',{method:'POST',headers:headers(b),body:JSON.stringify({items:[{productId:'a123456789',price:1400,status:'outbid'}]})});
    const userB=await request('/api/task/bidding',{headers:{Authorization:`Bearer ${token(2)}`}});
    assert.equal(userB.data.length,1);assert.equal(userB.data[0].bidding_status,'outbid');
    assert.equal(database.raw.prepare("SELECT status FROM bidding_items WHERE account_id=? AND product_id='a123456789'").get(a).status,'highest');
    await request('/api/plugin/orders/sync',{method:'POST',headers:headers(b),body:JSON.stringify({orders:[{productId:'a123456789',price:1500,wonTimeText:'10/10 12:00',transactionUrl:'https://contact.auctions.yahoo.co.jp/buyer/top?aid=a123456789'}]})});
    const won=database.raw.prepare("SELECT o.*,t.user_id FROM orders o JOIN tasks t ON t.id=o.task_id WHERE o.product_id='a123456789'").get();
    assert.equal(won.account_id,b);assert.equal(won.user_id,2);
    await request('/api/plugin/orders/sync',{method:'POST',headers:headers(a),body:JSON.stringify({orders:[{productId:'a123456789',price:1500}]})},409);
    assert.equal(database.raw.prepare('SELECT status FROM tasks WHERE id=?').get(ta.id).status,'bidding');
    await request('/api/plugin/bidding/sync',{method:'POST',headers:headers(b),body:JSON.stringify({items:[{productId:'a123456789',price:1300,status:'highest'}]})});
    assert.equal(database.raw.prepare('SELECT status FROM tasks WHERE id=?').get(tb.id).status,'success','late pre-win bidding snapshot cannot undo an actual won task');
    database.raw.prepare("UPDATE orders SET order_status='pending_payment',settled_at=CURRENT_TIMESTAMP,total_amount_cny=100 WHERE id=?").run(won.id);
    await adminRequest('payment/request',{orderIds:[won.id]});
    assert.equal((await scope.run({accountId:b},()=>database.getOne("SELECT value FROM config WHERE key='payment_requested'"))).value,'1');
    assert.notEqual((await scope.run({accountId:a},()=>database.getOne("SELECT value FROM config WHERE key='payment_requested'")))?.value,'1');
    const payment=(await request('/api/plugin/payment/jobs',{headers:headers(b)})).jobs[0];
    assert.equal(payment.orderId,won.id);assert(payment.claimToken);
    assert.equal((await request('/api/plugin/payment/jobs',{headers:headers(b)})).jobs.length,0,'uncompleted work is not claimed twice');
    await request('/api/plugin/payment/status',{method:'POST',headers:headers(a),body:JSON.stringify({orderId:won.id,status:'success',claim_token:payment.claimToken})},409);
    await request('/api/plugin/payment/status',{method:'POST',headers:headers(b),body:JSON.stringify({orderId:won.id,status:'success',claim_token:payment.claimToken})});
    assert.equal(database.raw.prepare('SELECT order_status FROM orders WHERE id=?').get(won.id).order_status,'pending_shipment');
    // Transaction, scan, receipt checks and messages all remain on the won account.
    database.raw.prepare("UPDATE orders SET order_status='' WHERE id=?").run(won.id);
    assert.equal((await request('/api/plugin/transaction-start/jobs',{headers:headers(a)})).jobs.length,0);
    const trade=(await request('/api/plugin/transaction-start/jobs',{headers:headers(b)})).jobs[0];assert.equal(trade.orderId,won.id);
    await request('/api/plugin/transaction-start/status',{method:'POST',headers:headers(a),body:JSON.stringify({orderId:won.id,status:'waiting_shipping',claim_token:trade.claimToken})},409);
    await request('/api/plugin/transaction-start/status',{method:'POST',headers:headers(b),body:JSON.stringify({orderId:won.id,status:'waiting_shipping',claim_token:trade.claimToken})});
    assert.equal((await request('/api/plugin/scan/jobs',{headers:headers(a)})).jobs.length,0);
    const scan=(await request('/api/plugin/scan/jobs',{headers:headers(b)})).jobs[0];assert.equal(scan.orderId,won.id);
    await request('/api/plugin/scan/status',{method:'POST',headers:headers(a),body:JSON.stringify({orderId:won.id,shippingFeeText:'0円',claim_token:scan.claimToken})},409);
    await request('/api/plugin/scan/status',{method:'POST',headers:headers(b),body:JSON.stringify({orderId:won.id,shippingFeeText:'0円',claim_token:scan.claimToken})});
    assert.equal((await request('/api/plugin/confirm-receipt/jobs',{headers:headers(a)})).jobs.length,0);
    const receipt=(await request('/api/plugin/confirm-receipt/jobs',{headers:headers(b)})).jobs[0];assert.equal(receipt.orderId,won.id);
    await request('/api/plugin/confirm-receipt/status',{method:'POST',headers:headers(a),body:JSON.stringify({orderId:won.id,status:'pending_shipment',claim_token:receipt.claimToken})},409);
    await request('/api/plugin/confirm-receipt/status',{method:'POST',headers:headers(b),body:JSON.stringify({orderId:won.id,status:'pending_shipment',claim_token:receipt.claimToken})});
    database.raw.prepare("INSERT INTO yahoo_trade_messages(order_id,product_id,fetch_status,account_id) VALUES(?,'a123456789','pending',?)").run(won.id,b);
    assert.equal((await request('/api/plugin/yahoo-messages/jobs',{headers:headers(a)})).jobs.length,0);
    const msg=(await request('/api/plugin/yahoo-messages/jobs',{headers:headers(b)})).jobs[0];assert.equal(msg.orderId,won.id);
    assert.equal((await request('/api/plugin/yahoo-messages/jobs',{headers:headers(b)})).jobs.length,0);
    await request('/api/plugin/yahoo-messages/status',{method:'POST',headers:headers(a),body:JSON.stringify({orderId:won.id,startedAt:msg.startedAt,messageHtml:'<div data-gdaipai-message-empty="true"></div>'})},409);
    await request('/api/plugin/yahoo-messages/status',{method:'POST',headers:headers(b),body:JSON.stringify({orderId:won.id,startedAt:msg.startedAt,messageHtml:'<div data-gdaipai-message-empty="true"></div>'})});
    const fa=await submit(1,'b123456789');await submit(2,'b123456789');
    const original=(await claim(a)).tasks.find(t=>t.id===fa.task_id);
    const moved=await status(a,original,{status:'failed',error_code:'SELLER_BLACKLIST',result_unknown:false,error_msg:'卖家黑名单'});
    assert.equal(moved.accountId,c);
    await status(a,original,{status:'bidding',bid_price:1900},409);
    const replacement=(await claim(c)).tasks.find(t=>t.id===fa.task_id);
    assert.equal(replacement.id,original.id);
    const exhausted=await status(c,replacement,{status:'failed',error_code:'SELLER_BLACKLIST',result_unknown:false});assert(exhausted.exhausted);
    const unknownSubmission=await submit(1,'c123456789');
    const unknown=(await claim(a)).tasks.find(t=>t.id===unknownSubmission.task_id);
    await status(a,unknown,{status:'failed',error_msg:'network timeout'});
    await assert.rejects(task.submitAuctionTask({user:{id:1,user_level:1},actingUser:{id:1,user_level:1}}, {product_url:'c123456789',max_price:2000,client_request_id:'retry-unknown',product_title:'test',current_price:1000,end_time:'2099-01-01'}, {database,fetchProduct:async()=>({data:{currentPrice:1000}})}),/结果未确认/);
    await status(a,unknown,{status:'bidding',bid_price:1200},409,'late unknown callback');
    await adminRequest(`tasks/${unknown.id}/resolve-unknown`,{confirmed:true,resolution:'no_bid'},'POST',409);
    database.raw.prepare('UPDATE yahoo_accounts SET heartbeat_at=0 WHERE id=?').run(a);
    await adminRequest(`tasks/${unknown.id}/resolve-unknown`,{confirmed:true,resolution:'no_bid'});
    assert.equal(database.raw.prepare('SELECT execution_unknown FROM tasks WHERE id=?').get(unknown.id).execution_unknown,0);
    await request('/api/plugin/config',{headers:headers(a)});
    // Two independently visible verification states; no cross-account close.
    for(const id of [a,b]) await request('/api/plugin/manual-captcha/challenge',{method:'POST',headers:headers(id),body:JSON.stringify({id:`pin-${id}`,type:'pin',message:'PIN required',pageUrl:'https://login.yahoo.co.jp/'})});
    let flags=await adminRequest('idle-flags',null,'GET');assert.equal(flags.accounts.length,3);assert(flags.accounts.find(x=>x.account_id===b).captchaChallenge);
    await adminRequest('manual-captcha/close',{account_id:a,id:`pin-${a}`});
    flags=await adminRequest('idle-flags',null,'GET');assert(!flags.accounts.find(x=>x.account_id===a).captchaChallenge);assert(flags.accounts.find(x=>x.account_id===b).captchaChallenge);
    // Offline B is skipped, while online C with PIN remains eligible.
    database.raw.prepare('UPDATE yahoo_accounts SET heartbeat_at=0 WHERE id=?').run(b);
    await submit(1,'d123456789');assert.equal((await submit(2,'d123456789')).account_id,c);
    await request('/api/plugin/config',{headers:headers(b)});
    const batch=await adminRequest('manual-order-import/request',{account_id:b,startDate:'2026-10-01',endDate:'2026-10-10'});
    assert.equal((await request('/api/plugin/manual-order-import/jobs',{headers:headers(a)})).job,null);
    const importJob=(await request('/api/plugin/manual-order-import/jobs',{headers:headers(b)})).job;assert.equal(importJob.batchId,batch.id);
    await request('/api/plugin/manual-order-import/status',{method:'POST',headers:headers(a),body:JSON.stringify({batchId:batch.id,claim_token:importJob.claimToken,orders:[]})},409);
    await request('/api/plugin/manual-order-import/status',{method:'POST',headers:headers(b),body:JSON.stringify({batchId:batch.id,claim_token:importJob.claimToken,status:'ready',items:[{productId:'e123456789',title:'Imported B',price:2100,finalPrice:2100,wonTimeText:'10/09 12:00',transactionUrl:'https://contact.auctions.yahoo.co.jp/buyer/top?aid=e123456789',shippingFeeText:'0円'}]})});
    const importedItems=await adminRequest(`manual-order-import/batches/${batch.id}`,null,'GET');
    assert.equal(importedItems.items.length,1);
    await adminRequest(`manual-order-import/batches/${batch.id}/confirm`,{assignments:[{itemId:importedItems.items[0].id,userId:1,shippingFeeText:'0円'}]});
    const importedOrder=database.raw.prepare("SELECT o.account_id,t.user_id FROM orders o JOIN tasks t ON t.id=o.task_id WHERE o.product_id='e123456789'").get();
    assert.equal(importedOrder.account_id,b);assert.equal(importedOrder.user_id,1);
    // Cancelling an internal task does not erase an external Yahoo win or ownership.
    const cancelled=await submit(1,'f123456789');
    database.raw.prepare("UPDATE tasks SET status='cancelled' WHERE id=?").run(cancelled.task_id);
    await request('/api/plugin/orders/sync',{method:'POST',headers:headers(a),body:JSON.stringify({orders:[{productId:'f123456789',price:1900,wonTimeText:'10/10 12:00'}]})});
    assert.equal(database.raw.prepare("SELECT account_id FROM orders WHERE product_id='f123456789'").get().account_id,a);
    // Public history queue can only be read by the winning account.
    database.raw.prepare("UPDATE products SET end_time='2020-01-01T00:00:00+09:00' WHERE product_id='a123456789'").run();history.set(database,'auction_history_requested','0');history.request(database);
    assert.equal(await scope.run({accountId:a,instanceId:instance(a)},()=>history.next(database)),null);
    const h=await scope.run({accountId:b,instanceId:instance(b)},()=>history.next(database));assert.equal(h.productId,'a123456789');
    assert((await scope.run({accountId:a,instanceId:instance(a)},()=>history.finish(database,{...h,expired:true}))).stale);
    assert((await scope.run({accountId:b,instanceId:instance(b)},()=>history.finish(database,{...h,expired:true}))).success);
    const lock=await scope.run({accountId:a,instanceId:instance(a)},()=>foreground.acquire(database.raw));
    assert.throws(()=>scope.run({accountId:b,instanceId:instance(b)},()=>foreground.acquire(database.raw)),/其他账号/);
    scope.run({accountId:a,instanceId:instance(a)},()=>foreground.release(database.raw,lock.token));
    // Two users concurrently compete for the last per-product account slot.
    await submit(1,'r123456789');await submit(2,'r123456789');
    const last=await Promise.allSettled([submit(3,'r123456789'),submit(4,'r123456789')]);
    assert.equal(last.filter(r=>r.status==='fulfilled').length,1);assert.equal(last.filter(r=>r.status==='rejected').length,1);
    assert.equal(database.raw.prepare("SELECT COUNT(*) n FROM yahoo_product_assignments WHERE product_id='r123456789'").get().n,3);
    // No server-wide cap: three plugins each claim two distinct products.
    database.raw.exec("UPDATE tasks SET status='failed' WHERE status IN ('pending','processing')");
    for(const product of ['g123456789','h123456789','i123456789']) for(const user of [1,2,3]) await submit(user,product);
    const pools=await Promise.all([claim(a),claim(b),claim(c)]);
    assert.deepEqual(pools.map(p=>p.tasks.length),[2,2,2]);
    assert.equal(new Set(pools.flatMap(p=>p.tasks.map(t=>t.id))).size,6);
    assert.deepEqual((await Promise.all([claim(a),claim(a)])).map(p=>p.tasks.length),[0,0]);
    console.log('Real database and HTTP multi-account tests passed: allocation, claims, concurrent retries, independent snapshots, won ownership, payment, fallback, verification, import and shared history.');
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.raw.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
