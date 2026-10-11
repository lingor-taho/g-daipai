const assert=require('assert/strict');
const fs=require('fs');
const vm=require('vm');
const {randomUUID}=require('crypto');

function load(binding,transport,overrides={}) {
  const calls=[];
  const messages=[];
  const listen={addListener(){},removeListener(){}};
  const sandbox={console,URL,URLSearchParams,AbortController,Date,
    setTimeout,clearTimeout,setInterval(){},clearInterval(){},crypto:{randomUUID},
    chrome:{storage:{local:{async get(){return {yahooBinding:binding};},async set(){}},session:{async set(){},async remove(){}},onChanged:listen},
      runtime:{onInstalled:listen,onStartup:listen,onMessage:{addListener(fn){messages.push(fn);}}},alarms:{onAlarm:listen,create(){}},
      tabs:{onUpdated:listen,onRemoved:listen},windows:{async update(id,options){calls.push({focus:id});return {id};}}},
    fetch:async(url,options={})=>{calls.push({url,options});return transport(url,options);},...overrides};
  let source=fs.readFileSync(require.resolve('./background.js'),'utf8');
  source=source.replace(/\r?\nstartPolling\(\);\r?\n\r?\n\/\/ Listen for messages from content script or client page/,'\n// Listen for messages from content script or client page');
  source+=`\nglobalThis.transportTests={apiFetch,withYahooForeground,updateYahooWindow,buildBidError,executeBidTask,fillManualPinAnswer,assertYahooWorkClaim,
    runPaymentJobs,runScanJobs,runTransactionStartJobs,runConfirmReceiptJobs,runYahooMessageJobs,fetchYahooMessageJobs,yahooMessageApiJson,
    stubMessagePolling(){getOpenManualVerificationTabs=async()=>[];},
    stubRetry(errors){
      this.attempts=[];this.closed=[];this.statuses=[];
      sleep=async()=>{};injectContentScript=async()=>{};ensureTaskReadyByCurrentEndTime=async()=>true;
      heartbeatProcessingTask=async()=>({success:true});
      openTaskPage=async task=>({id:100+globalThis.transportTests.attempts.length});
      executeTaskInTabV2=async(tab,task)=>{this.attempts.push({...task});const error=errors.shift();if(error)throw new Error(error);return {bidPrice:task.max_price};};
      closeManagedTaskTabs=async(id,tab)=>this.closed.push(tab);
      getTabPageDiagnosticSnapshot=async()=>({});postBidFailureDiagnostic=async()=>{};
      markTaskStatus=async(id,status,error,extra)=>{this.statuses.push({id,status,error,extra});return {success:true};};
    },
    stubPin(debuggerFails){
      sleep=async()=>{};this.keys=[];this.domWrites=0;
      chrome.tabs.get=async id=>({id,windowId:9});chrome.tabs.update=async id=>({id,windowId:9});
      chrome.scripting={executeScript:async args=>{if(args.world==='MAIN'){this.domWrites++;return [{result:{success:true,method:'dom'}}];}return [{result:{}}];}};
      chrome.debugger={attach:async()=>{if(debuggerFails)throw new Error('debugger unavailable');},detach:async()=>{},sendCommand:async(target,command,args)=>this.keys.push({target,command,args})};
      getTrustedInputDiagnostics=async()=>'';postPluginDiagnostic=async()=>{};
    },
    activate(id,token,tab){yahooTaskClaims.set(id,token);yahooActiveBidClaims.set(id,token);registerManagedTaskTab(id,tab);},
    stubPayment(fn){executePaymentJob=fn;},
    stubScan(result){getTabIds=async()=>new Set();openTransactionPage=async()=>({id:7});waitForPendingShipmentScanResult=async()=>({success:true,result});closeTabsForScanFlow=async()=>{};},
    stubTrade(info){
      getTabIds=async()=>new Set();closeTabsForTransactionFlow=async()=>{};
      openTransactionPage=async()=>({id:7});chrome.tabs.sendMessage=async()=>({success:true,info});
      reportYahooLoginStatus=async()=>{};getBundleActionState=async()=>({});
      closeRejectedBundleNotice=async tab=>({success:true,tab,handled:false});
      this.tradeActions=0;
      startNormalSingleTransaction=completeNormalBundleRequest=async()=>{globalThis.transportTests.tradeActions++;throw new Error('unexpected Yahoo transaction action');};
    },
    stubReceipt(){executeConfirmReceiptJob=async()=>{throw new Error('receipt failed');};}
  };pollAndExecute=()=>{};`;
  vm.runInNewContext(source,sandbox);
  return {api:sandbox.transportTests,calls,messages};
}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
(async()=>{
  // Run the real authentication guard against an isolated DB and the real plugin poll.
  const Database=require('better-sqlite3');
  const accounts=require('../src/server/services/yahooAccounts');
  const raw=new Database(':memory:');
  raw.exec('CREATE TABLE yahoo_accounts(id INTEGER PRIMARY KEY,account_name TEXT,binding_token TEXT,instance_id TEXT,heartbeat_at INTEGER,protocol_version INTEGER)');
  let now=Date.now();
  const started=now;
  class Clock extends Date {static now(){return now;}}
  raw.prepare('INSERT INTO yahoo_accounts VALUES(?,?,?,?,?,1)').run(1,'A','A-token','main-instance-0001',now);
  raw.prepare('INSERT INTO yahoo_accounts VALUES(?,?,?,?,?,1)').run(2,'B','B-token','backup-old-instance',now);
  const errors=[];
  const reloaded=load({accountId:2,token:'B-token'},async(url,options)=>{
    const h=options.headers;
    try {
      accounts.authenticate(raw,{accountId:h['X-Yahoo-Account'],token:h['X-Yahoo-Token'],instanceId:h['X-Yahoo-Instance']},now);
      return json({jobs:[]});
    } catch(error) {return json({error:error.message},error.statusCode);}
  },{Date:Clock,console:{...console,error:(...args)=>errors.push(args)}});
  reloaded.api.stubMessagePolling();
  for(const elapsed of [0,10000,30000,44000]) {
    now=started+elapsed;
    assert.equal(await reloaded.api.runYahooMessageJobs(),0,'reload waits without claiming or executing messages');
    assert.equal(raw.prepare('SELECT instance_id FROM yahoo_accounts WHERE id=2').get().instance_id,'backup-old-instance');
  }
  assert.equal(accounts.authenticate(raw,{accountId:1,token:'A-token',instanceId:'main-instance-0001'},now).accountId,1,'main account remains independent');
  now=started+45000;
  assert.equal(await reloaded.api.runYahooMessageJobs(),0);
  assert.equal(raw.prepare('SELECT instance_id FROM yahoo_accounts WHERE id=2').get().instance_id,reloaded.calls.at(-1).options.headers['X-Yahoo-Instance'],'new instance takes over after expiry');
  assert.deepEqual(errors,[],'normal reload polling never reports a red error');
  raw.close();
  const conflict='该 Yahoo 账号已有在线插件，禁止重复执行';
  for(const [status,error] of [[401,'插件账号绑定无效，请重新绑定'],[409,'任务领取已失效，停止当前操作'],[500,'服务器异常']]) {
    const failed=load({accountId:2,token:'B-token'},async()=>json({error},status));
    await assert.rejects(failed.api.fetchYahooMessageJobs(),e=>e.status===status && e.message.includes(error),'real errors retain their cause');
  }
  const waiting=load({accountId:2,token:'B-token'},async()=>json({error:conflict},409),{Date:Clock});
  await assert.rejects(waiting.api.yahooMessageApiJson('/api/plugin/yahoo-messages/status',{method:'POST'}),/HTTP 409/,'a rejected writeback is never treated as success');
  now+=61000;
  await assert.rejects(waiting.api.fetchYahooMessageJobs(),/HTTP 409/,'persistent duplicate instance is not hidden after startup');
  let owned=true;
  const registered=load({accountId:2,token:'B-token'},async()=>owned?json({jobs:[]}):json({error:conflict},409));
  await registered.api.fetchYahooMessageJobs();owned=false;
  await assert.rejects(registered.api.fetchYahooMessageJobs(),/HTTP 409/,'conflicts after authentication are not masked as reload waits');
  let first=true;
  const a=load({accountId:2,token:'B-token'},async(url)=>{
    if(url.includes('/tasks?')) {if(first){first=false;throw new Error('response lost');}return json({tasks:[{id:91,claim_token:'lease-B'}]});}
    if(url.includes('/payment/jobs'))return json({jobs:[{orderId:77,productId:'a123456789',claimToken:'pay-B'}]});
    if(url.includes('/foreground/acquire'))return json({token:'focus-B'});
    return json({success:true});
  });
  await a.api.apiFetch('/api/plugin/tasks?limit=2');
  const claims=a.calls.filter(c=>c.url?.includes('/tasks?'));
  assert.equal(claims.length,2);
  assert.equal(new URL(claims[0].url).searchParams.get('request_id'),new URL(claims[1].url).searchParams.get('request_id'),'response-loss fallback keeps one request id');
  for(const c of claims) {
    assert.equal(c.options.headers['X-Yahoo-Account'],'2');assert.equal(c.options.headers['X-Yahoo-Token'],'B-token');
    assert.match(c.options.headers['X-Yahoo-Instance'],/^[a-zA-Z0-9-]{16,96}$/);
  }
  await a.api.apiFetch('/api/plugin/task/91/status',{method:'PATCH',body:JSON.stringify({status:'failed',error_code:'SELLER_BLACKLIST',result_unknown:false})});
  assert.equal(a.calls.at(-1).options.headers['X-Yahoo-Claim'],'lease-B');
  assert.equal(JSON.parse(a.calls.at(-1).options.body).error_code,'SELLER_BLACKLIST');
  await a.api.apiFetch('/api/plugin/payment/jobs');
  await a.api.apiFetch('/api/plugin/payment/status',{method:'POST',body:JSON.stringify({productIds:['a123456789']})});
  const payment=JSON.parse(a.calls.at(-1).options.body);
  assert.equal(payment.claim_token,'pay-B');assert.equal(payment.claim_order_id,77);
  await Promise.all([a.api.updateYahooWindow(10,{focused:true}),a.api.updateYahooWindow(20,{focused:true})]);
  const focus=a.calls.filter(c=>c.focus || c.url?.includes('/foreground/')).map(c=>c.focus || new URL(c.url).pathname.split('/').at(-1));
  assert.deepEqual(focus,['acquire',10,'release','acquire',20,'release']);
  const b=load({accountId:3,token:'C-token'},async()=>json({success:true}));
  await b.api.apiFetch('/api/plugin/task/91/heartbeat',{method:'PATCH'});
  assert.equal(b.calls[0].options.headers['X-Yahoo-Claim'],'','another plugin never inherits B task lease');
  assert.notEqual(b.calls[0].options.headers['X-Yahoo-Instance'],claims[0].options.headers['X-Yahoo-Instance']);
  // A late content message must never borrow a later execution's credential.
  a.api.activate(91,'new-lease',900);
  const countStatus=()=>a.calls.filter(c=>c.url?.includes('/task/91/status')).length;
  const before=countStatus();
  for(const message of [{claimToken:'lease-B'},{claimToken:'new-lease'},{}]) {
    for(const listener of a.messages) listener({type:'BID_RESULT',taskId:91,result:{success:true,bidPrice:1100},...message},{tab:{id:899}},()=>{});
  }
  for(const listener of a.messages) listener({type:'BID_RESULT',taskId:91,claimToken:'lease-B',result:{success:true,bidPrice:1100}},{tab:{id:900}},()=>{});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(countStatus(),before);
  for(const listener of a.messages) listener({type:'BID_RESULT',taskId:91,claimToken:'new-lease',result:{success:true,bidPrice:1200}},{tab:{id:900}},()=>{});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(countStatus(),before+1);
  await a.api.apiFetch('/api/plugin/task/91/heartbeat',{method:'PATCH',headers:{'X-Yahoo-Claim':'old-execution'}});
  assert.equal(a.calls.at(-1).options.headers['X-Yahoo-Claim'],'old-execution','in-flight run keeps its original credential');
  const jobs=[{orderId:11,productId:'p1',claimToken:'work-11'},{orderId:12,productId:'p2',claimToken:'work-12'}];
  const executedPayments=[];
  const work=load({accountId:2,token:'B-token'},async url=>json(url.includes('/jobs')?{jobs}: {success:true}));
  work.api.stubPayment(async job=>{executedPayments.push(job.orderId);throw new Error('first failed');});
  await work.api.runPaymentJobs();
  assert.deepEqual(executedPayments,[11],'payment failure stops this batch, preserving original business rule');
  let returned=work.calls.filter(c=>c.url?.endsWith('/work/release')).map(c=>JSON.parse(c.options.body));
  assert.deepEqual(returned[0].jobs,jobs.map(({orderId,claimToken})=>({orderId,claimToken})),'finished batch releases claims without changing payment stop/continue');
  await work.api.runTransactionStartJobs({processNormalJobs:false});
  returned=work.calls.filter(c=>c.url?.endsWith('/work/release')).map(c=>JSON.parse(c.options.body));
  assert.equal(returned[1].jobs.length,2,'skipped batch returns all claims');
  for(const scenario of [{rejectAt:1},{rejectAt:2},{rejectAt:3,available:true},{rejectAt:3,available:false}]) {
    let eligibilityChecks=0;
    const paused=load({accountId:2,token:'B-token'},async url=>{
      if(url.includes('/transaction-start/jobs')) return json({jobs:[jobs[0]]});
      if(url.includes('/eligibility')) return json({eligible:++eligibilityChecks!==scenario.rejectAt});
      return json({success:true});
    });
    paused.api.stubTrade({available:scenario.available,quantityMatched:true,productIds:['p1']});
    await paused.api.runTransactionStartJobs();
    assert.equal(eligibilityChecks,scenario.rejectAt);
    assert.equal(paused.api.tradeActions,0,'paused order never starts single or bundle Yahoo transaction');
    const releases=paused.calls.filter(call=>call.url?.endsWith('/work/release'));
    assert.equal(releases.length,2,'explicit skip and batch cleanup release the same original claim idempotently');
    assert.deepEqual(JSON.parse(releases[0].options.body),{kind:'transaction-start',jobs:[{orderId:11,claimToken:'work-11'}]});
    assert.equal(paused.calls.some(call=>call.url?.endsWith('/transaction-start/status')),false,'pause does not change the original order status');
  }
  const scan=load({accountId:2,token:'B-token'},async url=>json(url.includes('/jobs')?{jobs:[{...jobs[0],orderStatus:'pending_shipment',trackingRescanRequested:true}]}:{success:true}));
  scan.api.stubScan({type:'pending_shipment'});
  await scan.api.runScanJobs();
  assert.equal(scan.calls.filter(c=>c.url?.endsWith('/work/release')).length,2,'normal no-change rescan releases claim and batch cleanup is idempotent');
  work.api.stubReceipt();await work.api.runConfirmReceiptJobs();
  returned=work.calls.filter(c=>c.url?.endsWith('/work/release')).map(c=>JSON.parse(c.options.body));
  assert.deepEqual(returned.at(-1).jobs,jobs.map(({orderId,claimToken})=>({orderId,claimToken})));
  const unknown=load({accountId:2,token:'B-token'},async url=>{
    if(url.endsWith('/payment/status')) throw new Error('status response unavailable');
    return json(url.includes('/jobs')?{jobs}:{success:true});
  });
  unknown.api.stubPayment(async()=>{throw new Error('payment outcome unknown');});
  await assert.rejects(unknown.api.runPaymentJobs(),/status response unavailable/);
  const unused=unknown.calls.find(c=>c.url?.endsWith('/work/release'));
  assert.deepEqual(JSON.parse(unused.options.body).jobs,jobs.map(({orderId,claimToken})=>({orderId,claimToken})),'failed batch does not add a manual claim-release requirement');
  let releaseUnavailable=true;
  const disconnected=load({accountId:2,token:'B-token'},async url=>{
    if(url.endsWith('/work/release') && releaseUnavailable)return json({error:'unavailable'},503);
    return json(url.includes('/jobs')?{jobs}:{success:true});
  });
  disconnected.api.stubPayment(async()=>{throw new Error('payment failed');});
  await assert.rejects(disconnected.api.runPaymentJobs(),/释放失败/);
  const beforeResume=disconnected.calls.length;
  releaseUnavailable=false;
  await disconnected.api.runPaymentJobs();
  const resumedCalls=disconnected.calls.slice(beforeResume).filter(c=>c.url);
  assert(resumedCalls[0].url.endsWith('/work/release'),'a lost release is retried before requesting another batch');
  assert.deepEqual(JSON.parse(resumedCalls[0].options.body).jobs,jobs.map(({orderId,claimToken})=>({orderId,claimToken})));
  const failedScan=load({accountId:2,token:'B-token'},async url=>json(url.includes('/jobs')?{jobs:[{...jobs[0],orderStatus:'pending_shipment'}]}:{success:true}));
  failedScan.api.stubScan({type:'unknown'});
  await failedScan.api.runScanJobs();
  assert(failedScan.calls.some(c=>c.url?.endsWith('/work/release')),'unreadable scan does not leave a permanent claim');
  // Binding must not disable either original retry or change bid intent/count.
  for(const error of ['Frame with ID 0 was removed','bid result confirmation timeout',
    'Yahoo bid failed: Yahoo system error page','Yahoo bid failed: オークションにアクセスできませんでした',
    'Yahoo error page','Yahoo bid access failure']) {
    for(const persistent of [false,true]) {
      const retried=load({accountId:2,token:'B-token'},async()=>json({success:true,claim_token:'retry-token'}));
      retried.api.stubRetry(persistent?[error,error,error]:[error]);
      const original={id:91,claim_token:'first-token',max_price:2000,user_max_price:2000,strategy:'direct',bid_mode:'bid',account_id:2};
      await retried.api.executeBidTask(original,{alreadyClaimed:true});
      assert.equal(retried.api.attempts.length,2,'eligible failures retry once, including with account binding');
      assert.equal(retried.api.attempts[0].claim_token,'first-token');
      assert.equal(retried.api.attempts[1].claim_token,'retry-token');
      for(const attempt of retried.api.attempts) for(const key of ['max_price','user_max_price','strategy','bid_mode','account_id']) assert.equal(attempt[key],original[key]);
      assert.equal(retried.api.statuses.at(-1).status,persistent?'failed':'bidding');
      assert.equal(retried.api.statuses.length,1,'only the final attempt reports its outcome');
      assert.equal(retried.api.statuses[0].extra.executionClaim,'retry-token','final result uses the new attempt credential');
      assert.equal(retried.calls.filter(c=>c.url?.endsWith('/retry')).length,1);
    }
  }
  const ordinary=load({accountId:2,token:'B-token'},async()=>json({success:true}));
  ordinary.api.stubRetry(['current price exceeds max price']);
  await ordinary.api.executeBidTask({id:92,claim_token:'ordinary',max_price:1000,strategy:'direct'},{alreadyClaimed:true});
  assert.equal(ordinary.api.attempts.length,1,'ordinary price-rule failure adds no retry or price increase');
  assert.equal(ordinary.api.statuses.at(-1).status,'failed');
  for(const error of ['outbid after bid','Rebid required: current bid is not high enough','失败：卖家黑名单','Yahoo login required']) {
    const rejected=load({accountId:2,token:'B-token'},async()=>json({success:true}));
    rejected.api.stubRetry([error]);
    await rejected.api.executeBidTask({id:92,claim_token:'ordinary',max_price:1000,strategy:'direct'},{alreadyClaimed:true});
    assert.equal(rejected.api.attempts.length,1,`${error}: no added page-error retry`);
  }
  const retryThenOutbid=load({accountId:1,token:'A-token'},async()=>json({success:true,claim_token:'retry-A'}));
  retryThenOutbid.api.stubRetry(['Yahoo bid failed: Yahoo system error page','outbid after bid']);
  await retryThenOutbid.api.executeBidTask({id:93,claim_token:'first-A',max_price:400,strategy:'direct',account_id:1},{alreadyClaimed:true});
  assert.equal(retryThenOutbid.api.attempts.length,2);
  assert.equal(retryThenOutbid.api.statuses.at(-1).error,'outbid after bid','retry reports its actual failure');
  assert(retryThenOutbid.api.attempts.every(t=>t.max_price===400 && t.account_id===1));
  const expiredRetry=load({accountId:2,token:'B-token'},async()=>json({error:'任务领取已失效，停止当前操作'},409));
  expiredRetry.api.stubRetry(['Yahoo bid failed: Yahoo system error page']);
  await assert.rejects(expiredRetry.api.executeBidTask({id:94,claim_token:'old-B',max_price:400},{alreadyClaimed:true}),/领取已失效/);
  assert.equal(expiredRetry.api.attempts.length,1,'invalidated claims never open another bid attempt');
  for(const debuggerFails of [false,true]) {
    const pin=load({accountId:2,token:'B-token'},async url=>{
      if(url.endsWith('/foreground/acquire'))return json({token:'pin-focus'});
      if(url.endsWith('/manual-pin/type'))return json({success:false,error:'system keyboard unavailable'});
      return json({success:true});
    });
    pin.api.stubPin(debuggerFails);
    let timeout;
    const result=await Promise.race([pin.api.fillManualPinAnswer(8,'123456'),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('PIN foreground lock deadlocked')),3000);})]).finally(()=>clearTimeout(timeout));
    assert.equal(result.success,true);
    assert.equal(pin.calls.filter(c=>c.url?.endsWith('/foreground/acquire')).length,1,'PIN fallbacks retain one foreground lock');
    assert.equal(pin.calls.filter(c=>c.url?.endsWith('/foreground/release')).length,1);
    assert.equal(pin.api.domWrites,debuggerFails?1:0);
    if(!debuggerFails) assert(pin.api.keys.some(k=>k.command==='Input.dispatchKeyEvent' && k.target.tabId===8));
  }
  console.log('Multi-account extension identity, response-loss, task/work leases and focus queue tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
