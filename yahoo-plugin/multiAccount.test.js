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
  source+=`\nglobalThis.transportTests={apiFetch,withYahooForeground,updateYahooWindow,buildBidError,
    runPaymentJobs,runScanJobs,runTransactionStartJobs,runConfirmReceiptJobs,runYahooMessageJobs,fetchYahooMessageJobs,yahooMessageApiJson,
    stubMessagePolling(){getOpenManualVerificationTabs=async()=>[];},
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
  assert.deepEqual(returned[0].jobs,[{orderId:12,claimToken:'work-12'}],'only unstarted payment released');
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
    assert.equal(releases.length,1,'each pre-transaction eligibility exit releases its original claim');
    assert.deepEqual(JSON.parse(releases[0].options.body),{kind:'transaction-start',jobs:[{orderId:11,claimToken:'work-11'}]});
    assert.equal(paused.calls.some(call=>call.url?.endsWith('/transaction-start/status')),false,'pause does not change the original order status');
  }
  const scan=load({accountId:2,token:'B-token'},async url=>json(url.includes('/jobs')?{jobs:[{...jobs[0],orderStatus:'pending_shipment',trackingRescanRequested:true}]}:{success:true}));
  scan.api.stubScan({type:'pending_shipment'});
  await scan.api.runScanJobs();
  assert.equal(scan.calls.filter(c=>c.url?.endsWith('/work/release')).length,1,'normal no-change rescan releases claim');
  work.api.stubReceipt();await work.api.runConfirmReceiptJobs();
  returned=work.calls.filter(c=>c.url?.endsWith('/work/release')).map(c=>JSON.parse(c.options.body));
  assert.deepEqual(returned.at(-1).jobs,[{orderId:12,claimToken:'work-12'}]);
  const unknown=load({accountId:2,token:'B-token'},async url=>{
    if(url.endsWith('/payment/status')) throw new Error('status response unavailable');
    return json(url.includes('/jobs')?{jobs}:{success:true});
  });
  unknown.api.stubPayment(async()=>{throw new Error('payment outcome unknown');});
  await assert.rejects(unknown.api.runPaymentJobs(),/status response unavailable/);
  const unused=unknown.calls.find(c=>c.url?.endsWith('/work/release'));
  assert.deepEqual(JSON.parse(unused.options.body).jobs,[{orderId:12,claimToken:'work-12'}],'unknown started payment remains protected');
  console.log('Multi-account extension identity, response-loss, task/work leases and focus queue tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
