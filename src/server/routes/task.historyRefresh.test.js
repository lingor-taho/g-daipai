const assert = require('assert/strict');
if (!process.env.DATABASE_URL?.includes('gdaipai-regression-')) throw new Error('Use isolated regression runner');
const db = require('../models');
const { submitAuctionTask } = require('./task');
const { processPendingFollowupTasks } = require('./plugin');
const { upsertProductSnapshot } = require('../services/productRepository');
const history = require('../services/auctionHistory');

(async () => {
  const now = Date.now();
  db.raw.exec("INSERT INTO users(id,username,password_hash,role) VALUES(9501,'refresh-a','test','user'),(9502,'refresh-b','test','user')");
  const account = db.raw.prepare('SELECT id FROM yahoo_accounts WHERE is_primary=1').get().id;
  db.raw.prepare("UPDATE yahoo_accounts SET heartbeat_at=?,instance_id='history-test',enabled=1 WHERE id=?").run(now,account);
  const future = new Date(now+86400000).toISOString();
  const past = new Date(now-86400000).toISOString();
  const context = userId => ({user:{id:userId,role:'user'},actingUser:{id:userId,role:'user',bid_strategy_scope:'all'}});
  const base = {max_price:24000,strategy:'direct',product_title:'relisted',product_image_url:'https://example.com/image.jpg',current_price:20000,tax_type:'tax_zero',product_type:'normal',shipping_fee_text:'580円',end_time:future};
  function seed(id,type='normal') {
    db.raw.prepare('INSERT INTO products(product_id,product_type,end_time,current_price,auction_history_html,auction_history_data) VALUES(?,?,?,1000,?,?)').run(id,type,past,'OLD HTML','OLD JSON');
  }
  const fields = id => db.raw.prepare('SELECT auction_history_html,auction_history_data FROM products WHERE product_id=?').get(id);
  const empty = {auction_history_html:null,auction_history_data:null};
  async function submit(id,requestId,extra={},user=9501,options={}) {
    return submitAuctionTask(context(user),{...base,product_url:id,client_request_id:requestId,...extra},{database:db,...options});
  }
  try {
    seed('c1248070488');seed('a1248070488');seed('b1248070488');
    // Snapshot reads/scans are never a refresh trigger.
    await upsertProductSnapshot(db,{product_id:'c1248070488',current_price:20000},{source:'scan'});
    assert.equal(fields('c1248070488').auction_history_data,'OLD JSON');
    const first = await submit('c1248070488','refresh-first');
    assert.ok(first.task_id);assert.deepEqual(fields('c1248070488'),empty);
    assert.equal(fields('a1248070488').auction_history_data,'OLD JSON');
    assert.ok(!history.eligible(db,now).includes('c1248070488'),'Wait for this auction to finish');
    const boundary = history.get(db,'auction_history_refresh:c1248070488');
    await submit('c1248070488','refresh-second');
    assert.deepEqual(fields('c1248070488'),empty);
    assert.equal(history.get(db,'auction_history_refresh:c1248070488'),boundary,'Repeated submissions retain the same refresh boundary');
    // Idempotent retries and failed validation/allocation never erase records.
    db.raw.prepare("UPDATE products SET auction_history_html='RESTORED',auction_history_data='RESTORED' WHERE product_id='c1248070488'").run();
    assert.equal((await submit('c1248070488','refresh-first')).duplicate,true);
    assert.equal(fields('c1248070488').auction_history_data,'RESTORED');
    await assert.rejects(submit('a1248070488','bad-end',{end_time:past}),/商品已结束/);
    assert.equal(fields('a1248070488').auction_history_data,'OLD JSON');
    db.raw.prepare('INSERT INTO yahoo_product_assignments(product_id,account_id,user_id) VALUES(?,?,9502)').run('b1248070488',account);
    await assert.rejects(submit('b1248070488','no-account'),/其他用户提交/);
    assert.equal(fields('b1248070488').auction_history_data,'OLD JSON');
    assert.equal(history.get(db,'auction_history_refresh:b1248070488'),'');
    // Real batch-created user tasks also reset the previous history.
    seed('d1248070488');
    await submit('d1248070488','batch-refresh',{},9501,{strictBatch:true,fetchProduct:async()=>({success:true,source:'http',data:{auctionId:'d1248070488',title:'batch',imageUrl:'https://example.com/b.jpg',currentPrice:20000,bidCount:0,taxType:'tax_zero',productType:'normal',shippingFeeText:'580円',endTime:future,auctionStatus:'open'}})});
    assert.deepEqual(fields('d1248070488'),empty);
    seed('f1248070488','store');
    db.raw.prepare("UPDATE products SET auction_history_html=?,auction_history_data=? WHERE product_id='f1248070488'").run(history.EXPIRED,history.EXPIRED);
    await submit('f1248070488','store-refresh',{product_type:'store',tax_type:'tax_included'});
    assert.deepEqual(fields('f1248070488'),empty,'Store products and expired history also reset');
    // Automatic followup creation and automatic strategy execution keep history.
    db.raw.prepare('UPDATE tasks SET pending_followup_max_price=30000 WHERE id=?').run(first.task_id);
    await processPendingFollowupTasks(db,now);
    assert.ok(db.raw.prepare('SELECT id FROM tasks WHERE client_request_id=?').get(`followup-${first.task_id}`));
    assert.equal(fields('c1248070488').auction_history_data,'RESTORED');
    assert.equal(history.get(db,'auction_history_refresh:c1248070488'),boundary);
    await upsertProductSnapshot(db,{product_id:'c1248070488',current_price:21000,end_time:future},{source:'plugin'});
    assert.equal(fields('c1248070488').auction_history_data,'RESTORED');
    // A currently running old auction collector is fenced off; other claims survive.
    history.set(db,'auction_history_requested','1');
    history.set(db,'auction_history_queue',JSON.stringify({token:'old-batch',ids:['c1248070488','a1248070488'],claim:'old-claim',leaseUntil:now+600000,failures:{c1248070488:{attempts:1}}}));
    await submit('c1248070488','while-collecting');
    assert.deepEqual(fields('c1248070488'),empty);
    assert.equal(history.finish(db,{productId:'c1248070488',token:'old-batch',claim:'old-claim',expired:true}).stale,true);
    const queue=JSON.parse(history.get(db,'auction_history_queue'));
    assert.deepEqual(queue.ids,['a1248070488']);assert.equal(queue.claim,undefined);
    history.set(db,'auction_history_queue',JSON.stringify({token:'other-batch',ids:['a1248070488','c1248070488'],claim:'other-claim',leaseUntil:now+600000}));
    await submit('c1248070488','non-head');
    assert.equal(JSON.parse(history.get(db,'auction_history_queue')).claim,'other-claim');
    // Retained old orders must not cause collection during the new auction.
    seed('e1248070488');
    const oldTask=db.raw.prepare("INSERT INTO tasks(user_id,account_id,product_id,max_price,status) VALUES(9501,?,'e1248070488',1000,'success')").run(account).lastInsertRowid;
    const oldOrder=db.raw.prepare("INSERT INTO orders(task_id,product_id,account_id,final_price,won_at) VALUES(?,'e1248070488',?,1000,?)").run(oldTask,account,past).lastInsertRowid;
    const orderBefore=db.raw.prepare('SELECT * FROM orders WHERE id=?').get(oldOrder);
    await submit('e1248070488','old-order');
    assert.ok(!history.eligible(db,now).includes('e1248070488'));
    assert.ok(history.eligible(db,now+86400001).includes('e1248070488'));
    assert.deepEqual(db.raw.prepare('SELECT * FROM orders WHERE id=?').get(oldOrder),orderBefore);
    // The existing order sync may refresh the same order row with the new win time.
    db.raw.prepare('UPDATE orders SET won_at=? WHERE id=?').run(new Date(now-1000).toISOString(),oldOrder);
    assert.ok(history.eligible(db,now).includes('e1248070488'));
    db.raw.prepare("UPDATE orders SET won_at=NULL WHERE id=?").run(oldOrder);
    assert.ok(!history.eligible(db,now).includes('e1248070488'),'A new win missing its time must not fall back to deadline');
    db.raw.prepare('UPDATE orders SET won_at=? WHERE id=?').run(new Date(now-1000).toISOString(),oldOrder);
    history.set(db,'auction_history_requested','0');history.request(db,now);
    const job=history.next(db,now);
    assert.equal(job.productId,'e1248070488');
    const rows=[{time:'10-26 12:00',username:'new-bidder',price:24000},{time:'10-25 12:00',username:'开始',price:1000,start:true}];
    assert.equal(history.finish(db,{...job,rows,firstPageRows:[]}).success,true);
    assert.ok(fields('e1248070488').auction_history_data.includes('new-bidder'));
    assert.equal(history.get(db,'auction_history_refresh:e1248070488'),'');
    // Refresh errors roll the task and allocation back instead of reporting a
    // failed submission after committing an unrefreshed task.
    seed('g1248070488');
    const queueBefore=history.get(db,'auction_history_queue');
    history.set(db,'auction_history_queue','invalid JSON');
    await assert.rejects(submit('g1248070488','rollback-refresh'),SyntaxError);
    assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM tasks WHERE product_id='g1248070488'").get().n,0);
    assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM yahoo_product_assignments WHERE product_id='g1248070488'").get().n,0);
    assert.equal(fields('g1248070488').auction_history_data,'OLD JSON');
    history.set(db,'auction_history_queue',queueBefore);
    await submit('g1248070488','rollback-refresh');
    assert.deepEqual(fields('g1248070488'),empty);
    seed('z1248070488','fleamarket');
    assert.equal(history.resetAfterSubmission(db,'z1248070488'),false);
    assert.equal(fields('z1248070488').auction_history_data,'OLD JSON');
    console.log('History refresh: successful user/batch tasks only, repeats, failed allocation, followup/scan preservation, stale collectors, old-order boundary and fresh capture passed');
  } finally { db.raw.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
