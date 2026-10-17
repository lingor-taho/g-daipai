const assert = require('assert/strict');
if (!process.env.DATABASE_URL?.includes('gdaipai-regression-')) throw new Error('Run through scripts/run-isolated-regression.cjs');
process.env.JWT_SECRET = 'isolated-product-delete-test';
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../models');
const accounts = require('../services/yahooAccounts');
const scope = require('../services/yahooAccountContext');
const admin = require('./admin');
const plugin = require('./plugin');
const task = require('./task');

(async()=>{
  const raw = db.raw;
  raw.exec("INSERT INTO users(id,username,password_hash,role,user_level) VALUES(1,'小毛','x','user',1),(2,'user1','x','user',1),(3,'third','x','user',1),(9,'admin','x','admin',3)");
  const a = accounts.list(db,Date.now(),true)[0];
  const b = accounts.save(db,{account_name:'B',yahoo_id:'delete-test-b',email:'b@example.com',profile_dir:'delete-b',enabled:0,priority:2}).id;
  const app=express();app.use(express.json());app.use('/api/admin',admin);app.use('/api/plugin',plugin);
  const server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const pluginHeaders={'Content-Type':'application/json','X-Yahoo-Account':String(a.id),'X-Yahoo-Token':a.binding_token,'X-Yahoo-Instance':'product-delete-instance-0001'};
  const adminHeaders={'Content-Type':'application/json',Authorization:`Bearer ${jwt.sign({id:9,role:'admin'},process.env.JWT_SECRET)}`};
  const id='z705858626',other='a123456789';
  const count=(table,product=id)=>raw.prepare(`SELECT COUNT(*) n FROM ${table} WHERE product_id=?`).get(product).n;
  const fetchProduct = async input => {
    const product = input.match(/[a-z]?\d{8,10}/i)[0].toLowerCase();
    const flea=product.startsWith('z');
    return {success:true,source:'http',data:{auctionId:product,title:'Fresh '+product,imageUrl:'https://example.com/a.png',currentPrice:300,buyoutPrice:300,
      bidCount:0,taxType:'tax_zero',productType:flea?'fleamarket':'normal',shippingFeeText:'送料無料',endTime:flea?'':'2099-01-01T00:00:00+09:00',auctionStatus:'open'}};
  };
  let requestId=0;
  const submit=(user,product=id,extra={})=>task.submitAuctionTask({user:{id:user,user_level:1},actingUser:{id:user,user_level:1}},
    {product_url:product,max_price:300,client_request_id:`delete-request-${++requestId}`},{database:db,fetchProduct,...extra});
  const remove=async product=>{
    const response=await fetch(base+'/api/admin/product-data-delete/run',{method:'POST',headers:adminHeaders,body:JSON.stringify({productIds:[product]})});
    assert.equal(response.status,200);return (await response.json()).results[0];
  };
  try {
    assert.equal((await fetch(base+'/api/plugin/config',{headers:pluginHeaders})).status,200);
    const original=await submit(1);
    // Reproduce the old production deletion: tasks gone, assignment survives SET NULL.
    raw.prepare('DELETE FROM tasks WHERE id=?').run(original.task_id);
    raw.prepare('DELETE FROM products WHERE product_id=?').run(id);
    raw.prepare('INSERT INTO yahoo_product_assignments(product_id,account_id,user_id) VALUES(?,?,3)').run(id,b);
    assert.equal(raw.prepare('SELECT task_id FROM yahoo_product_assignments WHERE product_id=? AND account_id=?').get(id,a.id).task_id,null);
    assert.throws(()=>accounts.selectAccount(db,id,2),/该商品已由其他用户提交/);
    const legacy=await remove(id.toUpperCase());
    assert.equal(legacy.success,true);assert.equal(legacy.assignmentCount,2);assert.equal(legacy.taskCount,0);assert.equal(legacy.productCount,0);
    const fresh=await submit(2);
    assert.equal(fresh.account_id,a.id);
    assert.equal(raw.prepare('SELECT user_id FROM yahoo_product_assignments WHERE product_id=?').get(id).user_id,2);
    const preserved=await submit(1,other);
    const second=raw.prepare("INSERT INTO tasks(user_id,account_id,product_id,max_price,strategy,status) VALUES(3,?,?,300,'direct','pending')").run(b,id).lastInsertRowid;
    raw.prepare('INSERT INTO yahoo_product_assignments(product_id,account_id,user_id,task_id) VALUES(?,?,3,?)').run(id,b,second);
    raw.prepare("UPDATE tasks SET status='success',claim_token='deleted-claim',claim_instance=? WHERE id=?").run(pluginHeaders['X-Yahoo-Instance'],fresh.task_id);
    const order=raw.prepare("INSERT INTO orders(task_id,product_id,account_id,final_price,order_status) VALUES(?,?,?,300,'pending_shipment')").run(fresh.task_id,id,a.id).lastInsertRowid;
    raw.prepare("INSERT INTO bid_logs(task_id,bid_price,result) VALUES(?,300,'bidding')").run(fresh.task_id);
    for(const account of [a.id,b]) raw.prepare("INSERT INTO bidding_items(account_id,product_id,status) VALUES(?,?,'highest')").run(account,id);
    raw.prepare("INSERT INTO order_status_change_logs(order_id,product_id,new_status,source) VALUES(?,?,'pending_shipment','test')").run(order,id);
    raw.prepare('INSERT INTO yahoo_trade_messages(order_id,product_id,account_id) VALUES(?,?,?)').run(order,id,a.id);
    raw.prepare("INSERT INTO plugin_diagnostics(product_id,order_id,type,account_id) VALUES(?,?,'test',?)").run(id,order,a.id);
    raw.prepare("INSERT INTO yahoo_work_claims VALUES(?,'scan',?,'old-instance','old-token',0)").run(a.id,order);
    raw.prepare("INSERT INTO yahoo_work_claims VALUES(?,'manual-order-import',?,'other-instance','other-token',0)").run(a.id,order);
    raw.prepare("INSERT INTO yahoo_account_transfers(task_id,from_account_id,reason) VALUES(?,?,'test')").run(fresh.task_id,a.id);
    const batch=raw.prepare("INSERT INTO batch_task_submissions(user_id,login_user_id,client_request_id,input_text) VALUES(1,1,'delete-batch','test')").run().lastInsertRowid;
    raw.prepare("INSERT INTO batch_task_submission_items(batch_id,line_number,input_text,product_id,status) VALUES(?,1,'delete',?,'pending'),(?,2,'keep',?,'pending')").run(batch,id,batch,other);
    const importBatch=raw.prepare("INSERT INTO manual_order_import_batches(account_id,start_date,end_date,status) VALUES(?,'2026-10-01','2026-10-17','ready')").run(a.id).lastInsertRowid;
    raw.prepare("INSERT INTO manual_order_import_items(batch_id,product_id,status,account_id) VALUES(?,?,'pending_user',?),(?,?,'pending_user',?)").run(importBatch,id,a.id,importBatch,other,a.id);
    const tracked=['tasks','orders','products','bidding_items','yahoo_product_assignments','manual_order_import_items','batch_task_submission_items','plugin_diagnostics'];
    const before=tracked.map(table=>count(table));
    raw.exec("CREATE TRIGGER fail_product_delete BEFORE DELETE ON products BEGIN SELECT RAISE(ABORT,'test deletion rollback'); END");
    const failed=await remove(id);
    assert.equal(failed.success,false);assert.match(failed.error,/rollback/);
    assert.deepEqual(tracked.map(table=>count(table)),before,'all earlier cleanup rolls back if snapshot deletion fails');
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM yahoo_work_claims').get().n,2);
    raw.exec('DROP TRIGGER fail_product_delete');
    const deleted=await scope.run({accountId:a.id},()=>admin.deleteProductDataByProductId(db,id));
    assert.equal(deleted.success,true);assert.equal(deleted.taskCount,2);assert.equal(deleted.assignmentCount,2);assert.equal(deleted.productCount,1);assert.equal(deleted.orderCount,1);
    for(const table of tracked)assert.equal(count(table),0,table+' must be empty for deleted product');
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM bid_logs').get().n,0);
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM yahoo_account_transfers').get().n,0);
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM yahoo_work_claims').get().n,1,'unrelated claim kind with same numeric ID survives');
    for(const table of ['tasks','products','yahoo_product_assignments','manual_order_import_items','batch_task_submission_items'])assert.equal(count(table,other),1,'other product preserved: '+table);
    assert.equal(raw.prepare('SELECT user_id FROM tasks WHERE id=?').get(preserved.task_id).user_id,1);
    const late=await fetch(`${base}/api/plugin/task/${fresh.task_id}/status`,{method:'PATCH',headers:{...pluginHeaders,'X-Yahoo-Claim':'deleted-claim'},body:JSON.stringify({status:'success'})});
    assert.equal(late.status,409,'deleted task rejects old plugin completion');
    const differentOwner=await submit(1);
    assert.equal(differentOwner.account_id,a.id,'another user can reuse the freed Yahoo account');
    // Product-linked orphan orders must also be removed without relying on task IDs.
    raw.prepare("INSERT INTO orders(product_id,account_id,final_price) VALUES(?,?,300)").run(id,a.id);
    const orphan=await remove(id);assert.equal(orphan.orderCount,1);assert.equal(orphan.productCount,1);
    assert.equal(count('orders'),0);assert.equal(count('yahoo_product_assignments'),0);
    // Deletion waits for an older in-flight submit and then removes its final snapshot/task.
    let entered,release;
    const waiting=new Promise(resolve=>{entered=resolve;});const gate=new Promise(resolve=>{release=resolve;});
    const submitting=submit(1,id,{fetchProduct:async input=>{entered();await gate;return fetchProduct(input);}});
    await waiting;
    let removed=false;
    const deleting=admin.deleteProductDataByProductId(db,id).then(value=>{removed=true;return value;});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(removed,false);
    release();await submitting;await deleting;
    for(const table of ['tasks','products','yahoo_product_assignments'])assert.equal(count(table),0);
    const again=await submit(2);assert.equal(again.account_id,a.id);
    // An old durable-batch worker holding a deleted line must not recreate the product.
    const queueProduct='p123456789';
    raw.prepare("INSERT INTO batch_task_submission_items(batch_id,line_number,input_text,product_id,status) VALUES(?,3,'old worker',?,'processing')").run(batch,queueProduct);
    assert.equal((await remove(queueProduct)).batchItemCount,1);
    await assert.rejects(task.submitAuctionTask({user:{id:1,user_level:1},actingUser:{id:1,user_level:1}},
      {product_url:queueProduct,max_price:300,client_request_id:`batch-queue-${batch}-3`},{database:db,strictBatch:true,fetchProduct:async()=>{throw Error('deleted line must not fetch');}}),/批量记录已删除/);
    assert.equal(count('tasks',queueProduct),0);assert.equal(count('products',queueProduct),0);
    assert.equal((await submit(1,queueProduct)).success,true,'ordinary p product may be submitted anew');
    console.log('Product deletion: orphan assignments, all-account cleanup, rollback, snapshot removal, late callbacks, in-flight submission and different-user resubmission passed');
  } finally {await new Promise(resolve=>server.close(resolve));raw.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
