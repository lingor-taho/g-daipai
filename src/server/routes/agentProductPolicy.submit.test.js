const assert = require('assert/strict');
if (!process.env.DATABASE_URL?.includes('gdaipai-regression-')) throw new Error('Use isolated regression runner');
process.env.JWT_SECRET = 'agent-policy-submit-isolated';
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../models');
const task = require('./task');
const accounts = require('../services/yahooAccounts');
const { checkProducts, policyKey } = require('../services/agentProductPolicy');
const { createBatchTaskQueue } = require('../services/batchTaskQueue');
const { fork } = require('child_process');

(async () => {
  if (process.argv[2] === 'race-worker') {
    const request = await new Promise(resolve=>{process.once('message',resolve);process.send({ready:true});});
    try {
      const result=await task.submitAuctionTask({user:{id:request.user},actingUser:{id:request.user}},request.input,{database:db});
      process.send({status:200,data:result});
    } catch(error) {process.send({status:error.statusCode||500,data:{error:error.message}});}
    finally {db.raw.close();process.disconnect();}
    return;
  }
  db.raw.exec(`INSERT INTO users(id,username,password_hash,role,user_level,parent_user_id) VALUES
    (9400,'submit-agent-a','test','user',2,NULL),(9401,'submit-a1','test','user',1,9400),
    (9402,'submit-a2','test','user',1,9400),(9403,'submit-a3','test','user',1,9400),
    (9410,'submit-agent-b','test','user',2,NULL),(9411,'submit-b1','test','user',1,9410),
    (9420,'submit-admin','test','user',3,NULL),(9430,'submit-independent','test','user',1,NULL);`);
  const primary=accounts.list(db)[0].id;
  const secondary=accounts.save(db,{account_name:'Policy submit B',yahoo_id:'policy-submit-b',profile_dir:'policy-submit-b',priority:1}).id;
  db.raw.prepare("UPDATE yahoo_accounts SET enabled=1,heartbeat_at=?,instance_id='policy-submit-instance' WHERE id IN (?,?)").run(Date.now(),primary,secondary);
  const app=express();app.use(express.json());app.use('/api/task',task);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const url=`http://127.0.0.1:${server.address().port}/api/task`;
  let sequence=0;
  const body=product=>({product_url:product,max_price:2000,strategy:'direct',product_title:'policy submission',
    product_image_url:'https://example.com/policy.jpg',current_price:1000,bid_count:0,
    tax_type:'tax_zero',product_type:'normal',shipping_fee_text:'580円',end_time:'2099-01-01T00:00:00+09:00'});
  async function post(user,product,{acting,requestId,extra={},path='/submit'}={}) {
    const response=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',
      Authorization:`Bearer ${jwt.sign({id:user,role:'user',user_level:3},process.env.JWT_SECRET)}`,
      ...(acting?{'X-Acting-User-Id':String(acting)}:{})},
      body:JSON.stringify({...body(product),client_request_id:requestId||`policy-submit-${++sequence}`,...extra})});
    return {status:response.status,data:await response.json()};
  }
  const setPolicy=policy=>db.raw.prepare('INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(policyKey(9400),policy);
  const count=(table,product)=>db.raw.prepare(`SELECT COUNT(*) n FROM ${table} WHERE product_id=?`).get(product).n;
  try {
    const product='a1248070400';
    // Both browsers can pass preflight before either creates a task.
    assert.deepEqual((await checkProducts(db,9401,[product])).conflicts,[]);
    assert.deepEqual((await checkProducts(db,9402,[product])).conflicts,[]);
    const raced=await Promise.all([post(9401,product),post(9402,product)]);
    assert.deepEqual(raced.map(r=>r.status).sort(),[200,409]);
    assert.equal(raced.find(r=>r.status===409).data.error,'代理组内该商品有人提交，请联系代理！');
    assert.equal(count('tasks',product),1);assert.equal(count('yahoo_product_assignments',product),1,'Loser must not occupy the spare Yahoo account');
    const winner=raced[0].status===200?9401:9402;const loser=winner===9401?9402:9401;
    assert.equal((await post(winner,product,{extra:{max_price:3000}})).status,200,'Own task permits a later price increase');
    assert.equal((await post(loser,product,{extra:{policy:'allow',force:true,confirmed:true}})).status,409,'Client flags cannot bypass server policy');
    assert.equal((await post(9420,product,{acting:loser})).status,409,'Admin acting-user submissions use the selected user group');
    assert.equal((await post(9420,product,{acting:winner})).status,200);
    assert.equal((await post(9400,product)).status,409,'The agent also obeys the group rule');
    assert.equal((await post(9411,product)).status,200,'Another agent group can use the remaining account');
    // Users who already participated before exclusivity was enabled can both continue.
    const shared='b1248070400';setPolicy('allow');
    for(const user of [9401,9402])assert.equal((await post(user,shared)).status,200);
    setPolicy('exclusive');
    for(const status of ['failed','cancelled','success','pending','processing']) {
      db.raw.prepare('UPDATE tasks SET status=? WHERE product_id=?').run(status,shared);
      const continued=await Promise.all([post(9401,shared),post(9402,shared)]);
      assert.deepEqual(continued.map(r=>r.status),[200,200],`Both owners can resubmit after ${status}`);
      const third=await post(9403,shared);assert.equal(third.status,409);assert.equal(third.data.error,'代理组内该商品有人提交，请联系代理！');
    }
    const retry=await post(9401,shared,{requestId:'stable-owner-retry'});
    assert.equal(retry.status,200);
    const before=count('tasks',shared);
    assert.equal((await post(9401,shared,{requestId:'stable-owner-retry'})).data.duplicate,true);
    assert.equal(count('tasks',shared),before);
    for(const policy of ['confirm','allow']) {
      setPolicy(policy);const id=policy==='confirm'?'c1248070400':'d1248070400';
      assert.deepEqual((await Promise.all([post(9401,id),post(9402,id)])).map(r=>r.status),[200,200]);
      const noAccount=await post(9403,id);assert.equal(noAccount.status,409);
      assert.equal(noAccount.data.error,'该商品已由其他用户提交，请联系管理员！','Original allocation errors are retained outside exclusive policy');
    }
    setPolicy('exclusive');
    // Batch requests can both enqueue; their eventual task creation must still serialize.
    const batchProduct='e1248070400';
    const batches=await Promise.all([9401,9402].map(user=>post(user,batchProduct,{path:'/batch-submit',extra:{text:`${batchProduct} 2000`}})));
    assert.deepEqual(batches.map(r=>r.status),[200,200]);
    const worker=createBatchTaskQueue({raw:db.raw,readContext:(login,acting)=>task.readBatchSubmissionContext(login,acting,db),
      submitTask:(context,input)=>task.submitAuctionTask(context,input,{database:db,strictBatch:true,
        fetchProduct:async()=>({success:true,source:'http',data:{auctionId:batchProduct,title:'batch policy',imageUrl:'https://example.com/b.jpg',currentPrice:1000,bidCount:0,taxType:'tax_zero',productType:'normal',shippingFeeText:'580円',endTime:'2099-01-01T00:00:00+09:00',auctionStatus:'open'}})})});
    await worker.processPending();
    const items=db.raw.prepare('SELECT status,error_msg FROM batch_task_submission_items WHERE product_id=? ORDER BY id').all(batchProduct);
    assert.deepEqual(items.map(i=>i.status),['submitted','failed']);assert.equal(items[1].error_msg,'代理组内该商品有人提交，请联系代理！');
    assert.equal(count('tasks',batchProduct),1);assert.equal(count('yahoo_product_assignments',batchProduct),1);
    // Unattached users keep normal allocation behavior.
    assert.equal((await post(9430,'f1248070400')).status,200);
    // Independent Node processes have independent product locks. The SQLite
    // write transaction must still allow only one first participant.
    const processProduct='g1248070400';
    function spawnRaceWorker() {
      const child=fork(__filename,['race-worker'],{stdio:['ignore','pipe','pipe','ipc']});
      let output='';child.stderr.on('data',chunk=>{output+=chunk;});
      let readyResolve,readyReject,resultResolve,resultReject;
      const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
      const result=new Promise((resolve,reject)=>{resultResolve=resolve;resultReject=reject;});
      child.on('message',message=>{if(message.ready)readyResolve();else resultResolve(message);});
      child.on('error',error=>{readyReject(error);resultReject(error);});
      child.on('exit',code=>{if(code){const error=new Error(`Race worker exited ${code}: ${output}`);readyReject(error);resultReject(error);}});
      return {child,ready,result};
    }
    const workers=[spawnRaceWorker(),spawnRaceWorker()];
    await Promise.all(workers.map(w=>w.ready));
    workers.forEach((w,index)=>w.child.send({user:9401+index,input:{...body(processProduct),client_request_id:`process-race-${index}`}}));
    const processResults=await Promise.all(workers.map(w=>w.result));
    assert.deepEqual(processResults.map(r=>r.status).sort(),[200,409]);
    assert.equal(processResults.find(r=>r.status===409).data.error,'代理组内该商品有人提交，请联系代理！');
    assert.equal(count('tasks',processProduct),1);assert.equal(count('yahoo_product_assignments',processProduct),1);
    console.log('Agent policy final submission: concurrent HTTP preflights, own-task price increases, all task states, acting users, group isolation, confirm/allow, retries and durable batch creation passed');
  } finally {task.batchTaskQueue.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.raw.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
