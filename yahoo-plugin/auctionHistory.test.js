const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const {parseAuctionHistoryRow} = require('./auctionHistory');
assert.equal(parseAuctionHistoryRow('10月 4日 21時 46分','jailhnrx 自動入札。 81,000').price,81000);
assert.equal(parseAuctionHistoryRow('10月 1日 19時 42分','AA 入札。 数量： 1 で 1').username,'AA');
assert.equal(parseAuctionHistoryRow('10月 1日 18時 55分','オークション開始。 数量： 1 で 500').price,500);
for (const price of [1,900,1000,3619]) {
  assert.equal(parseAuctionHistoryRow('10月 5日 0時 41分',`オークション開始。 数量： 1 で ${price.toLocaleString('en-US')}`).price,price);
}
assert.throws(()=>parseAuctionHistoryRow('10月 5日 0時 41分','オークション開始。 数量： 1 で 不明'));
assert.throws(()=>parseAuctionHistoryRow('unknown','AA 自動入札。 1'));
const source = fs.readFileSync(require.resolve('./auctionHistory'),'utf8');
function read({rows=[],text='すべての入札履歴',url='https://auctions.yahoo.co.jp/jp/show/bid_hist?aID=u1246662246&apg=1&typ=log',links=[]}={}) {
  const document = {body:{innerText:text},querySelector:()=>null,querySelectorAll:selector=>selector==='tr'?rows.map(([time,text])=>({querySelectorAll:()=>[{innerText:time},{innerText:text}]})):links};
  const context = {document,location:new URL(url),URL};
  vm.createContext(context);vm.runInContext(source,context);
  return context.readAuctionHistoryPage();
}
assert.equal(read({rows:[['10月 4日 21時 46分','jailhnrx 自動入札。 81,000']],links:[{innerText:'次の50件',href:'https://auctions.yahoo.co.jp/jp/show/bid_hist?aID=u1246662246&apg=2&typ=log'}]}).nextUrl.includes('apg=2'),true);
assert.equal(read({text:'ログインしてください'}).error,'login required');
assert.equal(read({text:'システムエラー'}).expired,undefined);
assert.equal(read({text:'このオークションの入札履歴は表示できません'}).expired,true);
assert.equal(read({text:'指定されたドキュメントは存在しません。 商品ページが削除されている可能性があります。'}).expired,true);
assert.equal(read({text:'ログインしてください 指定されたドキュメントは存在しません。'}).error,'login required');
assert.equal(read({text:'指定されたドキュメントは存在しません。',url:'https://login.yahoo.co.jp/'}).expired,undefined);
assert.equal(read({text:'すべての入札履歴 0件 入札履歴はありません'}).rows.length,0);
assert.equal(read({rows:[['10月 4日 21時 46分','new markup']]}).error,'history rows missing');
const mixed = read({rows:[['10月 4日 21時 46分','jailhnrx 自動入札。 81,000'],['10月 4日 21時 45分','linkwood1989 入札の取り消し'],['10月 1日 18時 55分','オークション開始。 数量： 1 で 1,000']]});
assert.equal(mixed.error,undefined);
assert.equal(mixed.rows.length,2);
assert.equal(mixed.rawRows.length,3);
assert.equal(mixed.rows.at(-1).price,1000);
console.log('Auction history page parsing and failure classification tests passed');

async function testAuthenticatedPagination() {
  const background = fs.readFileSync(require.resolve('./background.js'),'utf8');
  const jobSource = background.slice(background.indexOf('async function executeAuctionHistoryJob('), background.indexOf('async function runAuctionHistoryJobs('));
  const visited = []; const closed = []; const writes = [];
  let pageNumber = 1;
  const context = {
    console,Date,setTimeout,encodeURIComponent,
    chrome:{tabs:{
      create:async ({url})=>{ visited.push(url); return {id:7}; },
      update:async (id,{url})=>{visited.push(url);pageNumber=Number(new URL(url).searchParams.get('apg'));}
    },scripting:{executeScript:async opts=> {
      if (opts.files) return [];
      return [{result:read(pageNumber === 1 ? {
        rows:[['10月 4日 21時 46分','jailhnrx 自動入札。 81,000'],['10月 4日 21時 46分','jailhnrx 入札。 数量： 1 で 80,000']],
        links:[{innerText:'次の50件',href:'https://auctions.yahoo.co.jp/jp/show/bid_hist?aID=u1246662246&apg=2&typ=log'}]
      } : {url:visited.at(-1),rows:[['10月 1日 18時 55分','オークション開始。 数量： 1 で 1']]})}];
    }}},
    waitForTabComplete:async()=>{},closeTabIfExists:async id=>closed.push(id),
    apiFetch:async (url,options)=>{writes.push(JSON.parse(options.body));return {ok:true,json:async()=>({success:true})};}
  };
  vm.createContext(context);vm.runInContext(jobSource,context);
  assert.equal(await context.executeAuctionHistoryJob({productId:'u1246662246',token:'batch',claim:'claim'}),true);
  assert.equal(visited.length,2);
  assert.equal(writes[0].rows.length,3);
  assert.equal(writes[0].firstPageRows.length,2);
  assert.equal(writes[0].rows.at(-1).start,true);
  assert.deepEqual(closed,[7]);
  context.chrome.scripting.executeScript = async opts=>opts.files?[]:[{result:{error:'login required'}}];
  await context.executeAuctionHistoryJob({productId:'u1246662246',token:'batch',claim:'claim2'});
  assert.equal(writes.at(-1).expired,false);
  assert.equal(writes.at(-1).error,'login required');
  context.chrome.scripting.executeScript = async opts=>opts.files?[]:[{result:{expired:true}}];
  await context.executeAuctionHistoryJob({productId:'u1246662246',token:'batch',claim:'claim3'});
  assert.equal(writes.at(-1).expired,true);
  assert.equal(writes.at(-1).error,'');
  // Run the actual deleted-document parser through the worker and database writer.
  const Database = require('better-sqlite3');
  const history = require('../src/server/services/auctionHistory');
  const database = new Database(':memory:');
  database.exec(`CREATE TABLE config(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
    CREATE TABLE products(product_id TEXT PRIMARY KEY,auction_history_html TEXT,auction_history_data TEXT);
    INSERT INTO products(product_id) VALUES ('q1230679212');`);
  history.set(database,'auction_history_requested','1');
  history.set(database,'auction_history_queue',JSON.stringify({token:'deleted',ids:['q1230679212']}));
  const deletedJob = history.next(database);
  context.chrome.scripting.executeScript = async opts=>opts.files?[]:[{result:read({text:'指定されたドキュメントは存在しません。'})}];
  context.apiFetch = async (url,options)=>({ok:true,json:async()=>history.finish(database,JSON.parse(options.body))});
  assert.equal(await context.executeAuctionHistoryJob(deletedJob),true);
  assert.deepEqual(database.prepare('SELECT auction_history_html,auction_history_data FROM products').get(),{auction_history_html:'数据已过期',auction_history_data:'数据已过期'});
  assert.equal(history.get(database,'auction_history_requested'),'0');
  assert.deepEqual(history.getAlerts(database),[]);
  database.prepare('UPDATE products SET auction_history_html=NULL,auction_history_data=NULL').run();
  history.set(database,'auction_history_requested','1');
  history.set(database,'auction_history_queue',JSON.stringify({token:'deleted-later',ids:['q1230679212']}));
  pageNumber = 1;
  context.chrome.scripting.executeScript = async opts=>opts.files?[]:[{result:read(pageNumber===1 ? {
    url:visited.at(-1),rows:[['10月 4日 21時 46分','jailhnrx 自動入札。 81,000']],
    links:[{innerText:'次の50件',href:'https://auctions.yahoo.co.jp/jp/show/bid_hist?aID=q1230679212&apg=2&typ=log'}]
  } : {url:visited.at(-1),text:'指定されたドキュメントは存在しません。'})}];
  assert.equal(await context.executeAuctionHistoryJob(history.next(database)),true);
  assert.equal(new URL(visited.at(-1)).searchParams.get('apg'),'2');
  assert.deepEqual(database.prepare('SELECT auction_history_html,auction_history_data FROM products').get(),{auction_history_html:'数据已过期',auction_history_data:'数据已过期'});
  database.close();
  console.log('Authenticated tab pagination, first-page capture, login failure and cleanup tests passed');
}
async function testBatchFailureContinuation() {
  const background = fs.readFileSync(require.resolve('./background.js'),'utf8');
  const batchSource = background.slice(background.indexOf('async function runAuctionHistoryJobs('),background.indexOf('async function executeNextWorkflowAction('));
  const attempted = []; let claimed = 0;
  const context = {
    pauseIdleWorkForOpenManualPin:async()=>false,
    fetchNextIdleAction:async()=>({action:'auction_history'}),
    apiFetch:async url=>{assert.deepEqual(JSON.parse(decodeURIComponent(url.split('exclude=')[1])),attempted);return {ok:true,json:async()=>({job:{productId:`product-${++claimed}`}})};},
    executeAuctionHistoryJob:async job=>{attempted.push(job.productId);return attempted.length>1;}
  };
  vm.createContext(context);vm.runInContext(batchSource,context);
  await context.runAuctionHistoryJobs();
  assert.equal(attempted.length,10,'A failed first product must not stop the next nine products');
  assert.equal(claimed,10,'Do not claim an eleventh product');
  assert.equal(attempted[1],'product-2');
  attempted.length=0;claimed=0;
  context.executeAuctionHistoryJob=async job=>{attempted.push(job.productId);return false;};
  await context.runAuctionHistoryJobs();
  assert.equal(attempted.length,10,'Even consecutive acknowledged product failures must continue');
  attempted.length=0;claimed=0;
  context.fetchNextIdleAction=async()=>({action:'scan'});
  await context.runAuctionHistoryJobs();
  assert.equal(attempted.length,10,'Higher-priority work must wait until the batch finishes');
  attempted.length=0;claimed=0;
  context.fetchNextIdleAction=async()=>({action:'auction_history'});
  context.pauseIdleWorkForOpenManualPin=async()=>attempted.length>0;
  await context.runAuctionHistoryJobs();
  assert.equal(attempted.length,10,'Do not recheck manual verification midway through a started batch');
  attempted.length=0;claimed=0;
  context.pauseIdleWorkForOpenManualPin=async()=>true;
  await context.runAuctionHistoryJobs();
  assert.equal(attempted.length,0,'Do not start a batch while manual verification is already open');
  context.pauseIdleWorkForOpenManualPin=async()=>false;
  context.apiFetch=async()=>({ok:true,json:async()=>({job:null})});
  await context.runAuctionHistoryJobs();
  assert.equal(attempted.length,0,'An empty queue stops without execution');
  context.apiFetch=async()=>({ok:true,json:async()=>({job:{productId:`product-${++claimed}`}})});
  context.executeAuctionHistoryJob=async()=>{throw new Error('history result was not saved');};
  await assert.rejects(context.runAuctionHistoryJobs(),/result was not saved/);
  assert.equal(claimed,1,'Unacknowledged results must not cause another product claim');
  console.log('Auction history 10-product limit, failure continuation and uninterrupted batch tests passed');
}
testAuthenticatedPagination().then(testBatchFailureContinuation).catch(error=>{console.error(error);process.exitCode=1;});
