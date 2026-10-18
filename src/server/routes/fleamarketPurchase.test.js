const assert = require('assert/strict');
if (!process.env.DATABASE_URL?.includes('gdaipai-regression-')) throw new Error('Run with scripts/run-isolated-regression.cjs');
const express = require('express');
const db = require('../models');
const accounts = require('../services/yahooAccounts');
const scope = require('../services/yahooAccountContext');
const sheetWrites = [];
const sheets = require('../services/googleSheets');
sheets.applyGoogleSheetsConfigFromDb = async () => {};
sheets.isGoogleSheetsConfigured = () => true;
sheets.findRowsByProductIdsWithAnyColor = async ids => Object.fromEntries(ids.map(id=>[id,{matched:true}]));
// Exercise the REAL validation/dedupe/append service; mock only Google transport.
const appendRows = sheets.appendRows;
const googleRows = [];
sheets.appendRows = async payload => {
  sheetWrites.push(payload);
  return appendRows(payload, {
    config:{spreadsheetId:'isolated-fleamarket-sheet',sheetName:'orders'},
    prepareSheet:async()=>{}, getSheetId:async()=>1,
    request:async path=>path.endsWith(':batchUpdate')?{}:{sheets:[{data:[{rowData:googleRows.map(row=>({values:[{formattedValue:row[2]}]}))}]}]},
    appendRequest:async(path,options)=>{
      const values=JSON.parse(options.body).values;googleRows.push(...values);
      return {updates:{updatedRows:values.length,updatedRange:`orders!A2:K${values.length+1}`}};
    }
  });
};
const plugin = require('./plugin');
const {submitAuctionTask} = require('./task');

(async () => {
  const raw = db.raw;
  raw.exec("INSERT INTO users(id,username,password_hash,role,user_level) VALUES(1,'flea-test','x','user',1)");
  const accountId = accounts.list(db)[0].id;
  const account = accounts.list(db,Date.now(),true)[0];
  const context = {accountId,instanceId:'fleamarket-test-instance-0001'};
  const headers = {'Content-Type':'application/json','X-Yahoo-Account':String(accountId),'X-Yahoo-Token':account.binding_token,'X-Yahoo-Instance':context.instanceId,'X-Yahoo-Claim':'claim-flea'};
  const app = express(); app.use(express.json()); app.use('/api/plugin',plugin);
  const server = await new Promise(resolve => {const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
  const base = `http://127.0.0.1:${server.address().port}/api/plugin`;
  const seed = (id,product,status='processing',unknown=0) => {
    raw.prepare("INSERT OR IGNORE INTO products(product_id,product_type,current_price,buyout_price) VALUES(?,'fleamarket',300,300)").run(product);
    raw.prepare(`INSERT INTO tasks(id,user_id,account_id,product_id,max_price,strategy,bid_mode,status,claim_token,claim_instance,execution_unknown)
      VALUES(?,1,?,?,300,'direct','buyout',?,'claim-flea',?,?)`).run(id,accountId,product,status,context.instanceId,unknown);
  };
  const call = async (id,action,body,expected=200,customHeaders=headers) => {
    body ??= action === 'fleamarket/begin' ? {itemPrice:300} : {};
    const response = await fetch(`${base}/task/${id}/${action}`,{method:'POST',headers:customHeaders,body:JSON.stringify(body)});
    const result = await response.json(); assert.equal(response.status,expected,JSON.stringify(result)); return result;
  };
  const evidence = product => ({doneUrl:`https://paypayfleamarket-sec.yahoo.co.jp/item/${product}/order/done`,successText:'購入が完了しました',paidAmount:300,transactionUrl:`https://paypayfleamarket-sec.yahoo.co.jp/item/${product}/transaction`});
  try {
    seed(1,'z705860836');
    const duplicateSubmit = product => submitAuctionTask({user:{id:1,user_level:1},actingUser:{id:1,user_level:1}},
      {product_url:product,max_price:300},{database:db,fetchProduct:async()=>{throw new Error('duplicate must not fetch');}});
    await assert.rejects(duplicateSubmit('z705860836'),/已有待执行任务/);
    await call(1,'fleamarket/complete',evidence('z705860836'),409);
    await call(1,'fleamarket/begin',{},409,{...headers,'X-Yahoo-Claim':'stale'});
    for (const itemPrice of [null,0,200,301,'300']) await call(1,'fleamarket/begin',{itemPrice},409);
    await call(1,'fleamarket/begin',{},409);
    assert.equal(raw.prepare('SELECT execution_unknown FROM tasks WHERE id=1').get().execution_unknown,0);
    await call(1,'fleamarket/begin');
    await call(1,'fleamarket/begin',{},409);
    await call(1,'retry',{},409);
    await call(1,'fleamarket/complete',evidence('z999999999'),409);
    await call(1,'fleamarket/complete',{...evidence('z705860836'),successText:'出品者の発送をお待ちください'},409);
    const biddingResponse = await fetch(`${base}/task/1/status`,{method:'PATCH',headers,body:JSON.stringify({status:'bidding',bid_price:300})});
    assert.equal(biddingResponse.status,409,'P cannot enter the intermediate bidding state');
    assert.equal(raw.prepare('SELECT status FROM tasks WHERE id=1').get().status,'processing');
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM orders').get().n,0);
    // A failing order audit must roll back BOTH task success and order insertion.
    raw.exec("CREATE TRIGGER reject_flea_audit BEFORE INSERT ON order_status_change_logs BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
    await call(1,'fleamarket/complete',evidence('z705860836'),500);
    assert.equal(raw.prepare('SELECT status FROM tasks WHERE id=1').get().status,'processing');
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM orders').get().n,0);
    raw.exec('DROP TRIGGER reject_flea_audit');
    const result = await call(1,'fleamarket/complete',evidence('z705860836'));
    const order = raw.prepare('SELECT * FROM orders WHERE id=?').get(result.orderId);
    await assert.rejects(duplicateSubmit('z705860836'),/已有成交订单/);
    assert.equal(order.order_status,'pending_shipment'); assert.equal(order.final_price,300);
    assert.equal(order.account_id,accountId); assert.equal(order.task_id,1); assert(order.won_at); assert(order.won_time_text);
    assert.equal(raw.prepare('SELECT buyout_auto_paid FROM tasks WHERE id=1').get().buyout_auto_paid,1);
    raw.prepare("UPDATE orders SET order_status='completed' WHERE id=?").run(order.id);
    assert.equal((await call(1,'fleamarket/complete',evidence('z705860836'))).duplicate,true);
    assert.equal(raw.prepare('SELECT order_status FROM orders WHERE id=?').get(order.id).order_status,'completed','duplicate cannot regress status');
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM orders').get().n,1);
    raw.prepare("UPDATE orders SET order_status='pending_shipment' WHERE id=?").run(order.id);
    const scanJobs = (await scope.run(context,()=>plugin.getScanJobs(db))).jobs;
    assert.equal(scanJobs.length,1,'P order now enters the shared scan queue');
    assert.equal(scanJobs[0].productType,'fleamarket');
    assert.equal(scanJobs[0].transactionUrl,'https://paypayfleamarket-sec.yahoo.co.jp/item/z705860836/trade/buyer');
    const scanRequest = async (path,body) => {
      const response = await fetch(`${base}/scan/${path}`,{headers,method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});
      const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;
    };
    let scan = (await scanRequest('jobs')).jobs[0];
    await scanRequest('status',{orderId:order.id,pendingShipment:true,productId:'z705860836',daysOverdue:0,claim_token:scan.claimToken});
    assert.equal(raw.prepare('SELECT order_status FROM orders WHERE id=?').get(order.id).order_status,'pending_shipment');
    assert.equal(sheetWrites.length,0);
    // Payload verified from the supplied P shipped-page fixture; shared scan/sheet flow stays unchanged.
    scan = (await scanRequest('jobs')).jobs[0];
    await scanRequest('status',{orderId:order.id,shipped:true,shippingCompany:'お問い合わせ',trackingNumber:'646960564235',claim_token:scan.claimToken});
    assert.equal(raw.prepare('SELECT order_status FROM orders WHERE id=?').get(order.id).order_status,'pending_receipt');
    assert.equal(sheetWrites.length,1,'shared shipped status automatically invokes the existing sheet writer');
    assert.equal(sheetWrites[0].rows[0][2],'https://paypayfleamarket.yahoo.co.jp/item/z705860836');
    assert.equal(googleRows.length,1,'real Google Sheets validation accepts and appends the P item URL');
    assert.equal(googleRows[0][2],sheetWrites[0].rows[0][2]);
    assert.ok(raw.prepare('SELECT google_sheet_appended_at FROM orders WHERE id=?').get(order.id).google_sheet_appended_at);
    assert.equal(sheetWrites[0].rows[0][8],'お問い合わせ');
    assert.equal(sheetWrites[0].rows[0][9],'646960564235');
    const shipment = raw.prepare('SELECT shipping_company,tracking_number FROM orders WHERE id=?').get(order.id);
    assert.equal(shipment.shipping_company,'お問い合わせ');assert.equal(shipment.tracking_number,'646960564235');
    const receiptJobs = await scope.run(context,()=>plugin.getConfirmReceiptJobs(db,{
      findRowsByProductIdsWithAnyColor:async()=>({'z705860836':{matched:true}})
    }));
    assert.equal(receiptJobs.jobs[0].jobType,'confirm_receipt');
    assert.equal(receiptJobs.jobs[0].productType,'fleamarket');
    assert.equal(receiptJobs.jobs[0].transactionUrl,'https://paypayfleamarket-sec.yahoo.co.jp/item/z705860836/trade/buyer');
    await call(1,'fleamarket/complete',evidence('z705860836'));
    assert.equal(raw.prepare('SELECT order_status FROM orders WHERE id=?').get(order.id).order_status,'pending_receipt');
    await scope.run(context,()=>plugin.syncYahooWonOrders([{productId:'z705860836',price:999,wonTimeText:'10/17 12:00'}],db));
    assert.equal(raw.prepare('SELECT final_price FROM orders WHERE id=?').get(order.id).final_price,300,'auction won sync does not overwrite P order');
    raw.prepare("UPDATE orders SET order_status=NULL WHERE id=?").run(order.id);
    assert.equal((await scope.run(context,()=>plugin.getTransactionStartJobs(db,{includeAfterCutoff:true}))).jobs.length,0,'P never enters ordinary transaction start');
    raw.prepare("UPDATE orders SET order_status='pending_settlement',total_amount_cny=100 WHERE id=?").run(order.id);
    const paymentJobs = await scope.run(context,()=>plugin.getPaymentJobs(db));
    assert.equal(paymentJobs.jobs.length,0,'P never enters the ordinary payment queue');
    assert.equal(paymentJobs.total,0);
    raw.prepare("UPDATE orders SET order_status='pending_receipt',total_amount_cny=NULL WHERE id=?").run(order.id);
    seed(2,'z705860836'); await call(2,'fleamarket/begin',{},409);
    seed(3,'z705860837'); await call(3,'fleamarket/begin');
    seed(4,'z705860837'); await call(4,'fleamarket/begin',{},409);
    raw.prepare("UPDATE tasks SET updated_at=datetime('now','-2 minutes') WHERE id=3").run();
    seed(5,'p123456789'); raw.prepare("UPDATE products SET product_type='normal' WHERE product_id='p123456789'").run();
    raw.prepare("UPDATE tasks SET updated_at=datetime('now','-2 minutes') WHERE id=5").run();
    await plugin.resetStaleProcessingTasks(db);
    assert.equal(raw.prepare('SELECT status FROM tasks WHERE id=3').get().status,'failed');
    assert.equal(raw.prepare('SELECT execution_unknown FROM tasks WHERE id=3').get().execution_unknown,1);
    assert.equal(raw.prepare('SELECT status FROM tasks WHERE id=5').get().status,'pending','ordinary p auction keeps original recovery');
    await call(3,'retry',{},409);
    await call(3,'fleamarket/complete',evidence('z705860837'));
    seed(6,'p123456788'); raw.prepare("UPDATE products SET product_type='normal' WHERE product_id='p123456788'").run();
    await call(6,'fleamarket/begin',{},409);
    raw.prepare("UPDATE tasks SET status='failed',execution_unknown=0 WHERE id IN (2,4,6)").run();
    // Discounted, zero and absent actual payments never change the gross deal price.
    for (const [offset, paidAmount] of [[0,10880],[1,0],[2,null],[3,undefined]]) {
      const taskId=20+offset, product='z70586085'+offset;
      seed(taskId,product);
      raw.prepare('UPDATE tasks SET max_price=11700 WHERE id=?').run(taskId);
      await call(taskId,'fleamarket/begin',{itemPrice:11700});
      const result=await call(taskId,'fleamarket/complete',{...evidence(product),paidAmount,discountApplied:true});
      const created=raw.prepare('SELECT final_price,order_status FROM orders WHERE id=?').get(result.orderId);
      assert.equal(created.final_price,11700,'order stores submitted product price, never discounted payment');
      assert.equal(created.order_status,'pending_shipment');
    }
    // P receipt uses the unchanged, claimed original status endpoint after sheet eligibility.
    for (const status of ['success','already_completed']) {
      raw.prepare("UPDATE orders SET order_status='pending_receipt' WHERE id=?").run(order.id);
      const jobsResponse=await fetch(`${base}/confirm-receipt/jobs`,{headers});
      assert.equal(jobsResponse.status,200);
      const receipt=(await jobsResponse.json()).jobs.find(job=>job.orderId===order.id);
      assert.equal(receipt.productType,'fleamarket');assert.equal(receipt.jobType,'confirm_receipt');
      const response=await fetch(`${base}/confirm-receipt/status`,{method:'POST',headers,
        body:JSON.stringify({orderId:order.id,productId:'z705860836',status,claim_token:receipt.claimToken})});
      assert.equal(response.status,200,JSON.stringify(await response.json()));
      assert.equal(raw.prepare('SELECT order_status FROM orders WHERE id=?').get(order.id).order_status,'completed');
    }
    seed(7,'z705860839','failed',1);
    raw.prepare("UPDATE tasks SET updated_at=datetime('now','-3 minutes') WHERE id=7").run();
    seed(8,'z705860840','failed',1); // Fresh failure backs off rather than reloading each poll.
    seed(10,'p123456787','failed',1);
    raw.prepare("UPDATE products SET product_type='normal' WHERE product_id='p123456787'").run();
    raw.prepare("UPDATE tasks SET updated_at=datetime('now','-3 minutes') WHERE id=10").run();
    const otherAccount = accounts.save(db,{account_name:'B',yahoo_id:'flea-b',email:'b@example.com',profile_dir:'flea-b',priority:2}).id;
    seed(9,'z705860841','failed',1);
    raw.prepare("UPDATE tasks SET account_id=?,updated_at=datetime('now','-3 minutes') WHERE id=9").run(otherAccount);
    // Simulate extension reload: the old plugin has expired; a new instance may only observe.
    raw.prepare('UPDATE yahoo_accounts SET heartbeat_at=0 WHERE id=?').run(accountId);
    const recoveryHeaders = {...headers,'X-Yahoo-Instance':'fleamarket-new-instance-0002'};
    const recover = async () => {
      const response = await fetch(`${base}/fleamarket/recovery/jobs?limit=10`,{headers:recoveryHeaders});
      assert.equal(response.status,200);return (await response.json()).tasks;
    };
    const recovered = await recover();
    assert.deepEqual(recovered.map(task=>task.id),[7]);
    assert.equal(recovered[0].fleamarket_recovery_only,true);
    assert.notEqual(recovered[0].claim_token,'claim-flea');
    assert.equal((await recover()).length,0,'fresh observations are not claimed twice');
    await call(7,'fleamarket/complete',evidence('z705860839'),409,headers);
    const observerHeaders = {...recoveryHeaders,'X-Yahoo-Claim':recovered[0].claim_token};
    await call(7,'fleamarket/begin',{},409,observerHeaders);
    await call(7,'fleamarket/complete',evidence('z705860839'),200,observerHeaders);
    assert.equal(raw.prepare('SELECT status FROM tasks WHERE id=7').get().status,'success');
    assert.equal(raw.prepare('SELECT status FROM tasks WHERE id=9').get().status,'failed','other account recovery stays isolated');
    assert.equal(raw.prepare('SELECT status FROM tasks WHERE id=10').get().status,'failed','ordinary p unknown task is not a P recovery');
    seed(11,'z705860842','processing',1);
    raw.prepare("UPDATE tasks SET updated_at=datetime('now','-3 minutes') WHERE id=11").run();
    const staleProcessing = await recover();
    assert.deepEqual(staleProcessing.map(task=>task.id),[11]);
    seed(90,'z705860990');
    raw.prepare("UPDATE products SET product_type='normal' WHERE product_id='z705860990'").run();
    await call(90,'fleamarket/begin',{},409);
    assert.equal(raw.prepare('SELECT execution_unknown FROM tasks WHERE id=90').get().execution_unknown,0,'Z prefix cannot authorize a P purchase');
    raw.prepare("UPDATE tasks SET status='failed',execution_unknown=1,updated_at=datetime('now','-10 minutes') WHERE id=90").run();
    seed(91,'a123456789','failed',1);
    raw.prepare("UPDATE tasks SET updated_at=datetime('now','-10 minutes') WHERE id=91").run();
    const typedRecovery=await recover();
    assert.equal(typedRecovery.some(task=>task.id===90),false,'normal Z task must not enter P recovery');
    assert.equal(typedRecovery.some(task=>task.id===91),true,'P recovery follows saved type, not ID prefix');
    const normalRow=plugin.buildDaipaiSheetRow({product_id:'z705860990',product_type:'normal',product_url:'https://paypayfleamarket.yahoo.co.jp/item/z705860990',final_price:300});
    assert.equal(normalRow[2],'https://auctions.yahoo.co.jp/jp/auction/z705860990');
    assert.throws(()=>plugin.buildDaipaiSheetRow({product_id:'z705860990'}),/商品类型缺失/);
    raw.prepare("INSERT INTO products(product_id,product_type) VALUES('z777777777','normal')").run();
    const normalSubmission=await submitAuctionTask({user:{id:1,user_level:1},actingUser:{id:1,user_level:1}},
      {product_url:'https://paypayfleamarket.yahoo.co.jp/item/z777777777',product_type:'fleamarket',max_price:1000,bid_mode:'bid'},
      {database:db,fetchProduct:async(url,options)=>{
        assert.equal(url,'https://auctions.yahoo.co.jp/jp/auction/z777777777');
        assert.equal(options.recordedProductType,'normal');
        return {success:true,data:{auctionId:'z777777777',productType:'normal',title:'Recorded normal Z product',
          imageUrl:'https://example.com/test.png',currentPrice:300,taxType:'tax_zero',shippingFeeText:'送料無料',endTime:'2099-01-01T00:00:00+09:00'}};
      }});
    assert.equal(raw.prepare('SELECT bid_mode FROM tasks WHERE id=?').get(normalSubmission.task_id).bid_mode,'bid');
    assert.equal(raw.prepare("SELECT product_type FROM products WHERE product_id='z777777777'").get().product_type,'normal','submission and snapshot must preserve the saved type');
    console.log('Fleamarket purchase HTTP, atomic order, claims and recovery tests passed');
  } finally { await new Promise(resolve=>server.close(resolve)); raw.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
