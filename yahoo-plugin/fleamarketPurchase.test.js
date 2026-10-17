const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const { chromium } = require('playwright');
const source = fs.readFileSync(require.resolve('./background.js'),'utf8');
const implementation = source.slice(source.indexOf('function fleamarketPageStep('),source.indexOf('async function executeBidTask('));
const helpers = vm.runInNewContext(`${implementation}\n({fleamarketPageStep,executeFleamarketPurchaseTask})`,{URL});
const id = 'z705860836';
const itemUrl = `https://paypayfleamarket.yahoo.co.jp/item/${id}`;
const orderUrl = `https://paypayfleamarket-sec.yahoo.co.jp/item/${id}/order`;
const doneUrl = `${orderUrl}/done`;
const total = '<div><span>お支払い金額（合計）</span><b>300円</b></div>';

async function domTests() {
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  try {
    const page = await browser.newPage();
    let html = '';
    await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<html><body>${html}</body></html>`}));
    const load = async (url,body) => {html=body;await page.goto(url);};
    const step = (action='',max=300) => page.evaluate(`(${helpers.fleamarketPageStep.toString()})(${JSON.stringify(id)},${JSON.stringify(action)},${max})`);
    const button = label => `<button onclick="window.clicks=(window.clicks||0)+1">${label}</button>`;
    await load(itemUrl,button('アプリで購入する')+button('購入手続きへ'));
    assert.equal((await step('item')).clicked,true);
    assert.equal((await step('item')).clicked,undefined);
    assert.equal(await page.evaluate('window.clicks'),1);
    await load(orderUrl,`<div role="dialog"><h2>置き配場所（玄関前）が<br>初期設定されました</h2>${button('OK')}</div>${button('購入内容を確認する')}`);
    assert.equal((await step('review')).state,'placement');
    assert.equal(await page.evaluate('window.clicks'),undefined);
    assert.equal((await step('placement')).clicked,true);
    await load(orderUrl,button('購入内容を確認する')+'<input value="keep payment and address">');
    assert.equal((await step('review')).clicked,true);
    assert.equal(await page.locator('input').inputValue(),'keep payment and address');
    await load(orderUrl,`<div role="dialog"><p>追加の確認が必要です</p>${button('OK')}</div>${button('購入内容を確認する')}`);
    assert.equal((await step('review')).state,'waiting','an unrecognized dialog does not click the checkout underneath');
    assert.equal(await page.evaluate('window.clicks'),undefined);
    await load(orderUrl,`<div role="dialog"><h2>購入を確定しますか？</h2>${total}${button('キャンセル')}${button('OK')}</div>`);
    assert.equal((await step()).state,'confirm');
    assert.equal((await step()).paidAmount,300);
    assert.equal((await step('confirm',299)).state,'invalid-price');
    assert.equal(await page.evaluate('window.clicks'),undefined);
    assert.equal((await step('confirm')).clicked,true);
    assert.equal((await step('confirm')).clicked,undefined);
    await load(orderUrl,`<div role="dialog"><h2>購入を確定しますか？</h2><div>クーポンの使用<span>適用されていません</span></div><div>ポイント利用<span>0ポイント</span></div>${total}${button('OK')}</div>`);
    assert.equal((await step('confirm')).clicked,true,'unused coupons and zero points are allowed');
    for (const discount of ['クーポンの使用<span>100円引き</span>','ポイント利用<span>100ポイント</span>']) {
      await load(orderUrl,`<div role="dialog"><h2>購入を確定しますか？</h2><div>${discount}</div>${total}${button('OK')}</div>`);
      assert.equal((await step('confirm')).state,'unsupported-discount');
      assert.equal(await page.evaluate('window.clicks'),undefined,'applied discounts never click final OK');
    }
    await load(orderUrl,`<div role="dialog"><h2>購入を確定しますか？</h2>${total.replace('300円','200円')}${button('OK')}</div>`);
    assert.equal((await step('confirm')).state,'invalid-price','a discounted total also blocks unknown discount labels');
    await load(orderUrl,`${total}<div role="dialog"><h2>購入を確定しますか？</h2>${total.replace('300円','301円')}${button('OK')}</div>`);
    assert.equal((await step('confirm')).state,'invalid-price','confirmation amount takes priority over checkout behind modal');
    await load(orderUrl,`<div>決済処理中です。このままお待ちください</div>${button('購入内容を確認する')}`);
    assert.equal((await step('review')).state,'processing');
    assert.equal(await page.evaluate('window.clicks'),undefined);
    await load(doneUrl,`<h1>購入が<span>完了</span>しました</h1>${total}<a href="/item/${id}/transaction">取引ページへ</a>`);
    const done = await step(); assert.equal(done.state,'success');assert.equal(done.paidAmount,300);assert.equal(done.doneUrl,doneUrl);
    await load(doneUrl,'<p>出品者の発送をお待ちください</p>');
    assert.equal((await step()).state,'waiting','old incorrect text cannot confirm success');
    await load(doneUrl,"<script>window.placeholder='購入が完了しました'</script>");
    assert.equal((await step()).state,'waiting','hydration script text is not a rendered success message');
    await load(orderUrl,'<h1>購入が完了しました</h1>');
    assert.notEqual((await step()).state,'success','text without done URL cannot confirm success');
    await load(doneUrl.replace(id,'z123456789'),'<h1>購入が完了しました</h1>');
    assert.equal((await step()).state,'foreign');
    await load('https://example.com/item/'+id,button('購入手続きへ'));
    assert.equal((await step('item')).state,'foreign');
    console.log('Fleamarket real DOM button, dialog, amount and success-marker checks passed');
  } finally {await browser.close();}
}

async function executorTest({placement=false,child=false,loseBegin=false,rejectBegin=false,loseLease=false,timeout=false,navigation=false,wrongPrice=false,discountPrice=false,appliedDiscount=false,loseComplete=false,recoveryOnly=false,recoveryMissing=false}={}) {
  let clock=0,state=recoveryOnly?(recoveryMissing?'confirm':'success'):'item',begin=0,complete=0,created=0,closed=0,released=0,finalClicks=0;
  const actions=[],statuses=[],owned=new Map(); let taskTab=1;
  class TestDate extends Date {static now(){return clock;}}
  const sandbox = {
    URL,AbortSignal,Date:TestDate,console:{error(){}},
    yahooActiveBidClaims:new Map(),activeBidRuns:new Map([[9,true]]),managedTaskTabIdsByTaskId:owned,
    normalizeAuctionId:()=>id,
    registerManagedTaskTab(task,tab){if(!owned.has(task))owned.set(task,new Set());owned.get(task).add(tab);},
    async closeManagedTaskTabs(){closed++;}, releaseManagedTaskTabs(){released++;},
    isContentScriptTargetGoneError:()=>false,
    async sleep(ms){clock+=ms;},
    async heartbeatProcessingTask(){return {success:!(loseLease && state==='confirm')};},
    async markTaskStatus(task,status,error,extra){statuses.push({status,error,extra});return {success:true,claim_token:'claim'};},
    async apiFetch(url){
      if(url.endsWith('/begin')){begin++;if(loseBegin)throw Error('lost begin response');if(rejectBegin)return {ok:false,status:409,async json(){return {error:'already purchased'};}};}
      if(url.endsWith('/complete')){complete++;if(loseComplete && complete===1)throw Error('lost completion response');}
      return {ok:true,async json(){return {success:true};}};
    },
    chrome:{tabs:{
      async query(){return created ? [{id:1},...(child&&state!=='item'?[{id:2,openerTabId:1,url:orderUrl}]:[]),{id:80,url:orderUrl}] : [{id:80,url:orderUrl}];},
      async create({url}){assert.equal(url,recoveryOnly?doneUrl:itemUrl);created++;return {id:1};}
    },scripting:{async executeScript({target,args}){
      if(child&&state!=='item')assert.equal(target.tabId,2,'only the new child checkout is used');
      assert.notEqual(target.tabId,80,'existing unrelated checkout stays untouched');
      const action=args[1];
      if(!action){
        if(state==='processing'&&!timeout)state='success';
        return [{result:state==='success'?{state,doneUrl,successText:'購入が完了しました',paidAmount:300}:{state:appliedDiscount&&state==='confirm'?'unsupported-discount':state,ready:true,paidAmount:wrongPrice?301:discountPrice?200:300}}];
      }
      actions.push(action);
      if(action==='item')state=placement?'placement':'review';
      else if(action==='placement')state='review';
      else if(action==='review')state='confirm';
      else if(action==='confirm'){finalClicks++;state='processing';if(navigation)throw Error('Execution context was destroyed during navigation');}
      return [{result:{state,clicked:true}}];
    }}}
  };
  vm.runInNewContext(`${implementation}\nthis.execute=executeFleamarketPurchaseTask`,sandbox);
  await sandbox.execute({id:9,product_id:id,product_url:itemUrl,max_price:300,bid_mode:'buyout',strategy:'direct',claim_token:'claim',fleamarket_recovery_only:recoveryOnly},{alreadyClaimed:true});
  assert.equal(created,1);assert.equal(sandbox.activeBidRuns.size,0);
  if(recoveryOnly){assert.equal(begin,0);assert.equal(finalClicks,0);assert.equal(actions.length,0);assert.equal(closed,1);assert.equal(complete,recoveryMissing?0:1);if(recoveryMissing)assert.equal(statuses[0].extra.result_unknown,true);}
  else if(rejectBegin){assert.equal(finalClicks,0);assert.equal(closed,1);assert.equal(statuses[0].extra.result_unknown,false);}
  else if(loseBegin||timeout){assert.equal(released,1);assert.equal(closed,0);assert.equal(complete,0);assert.equal(statuses[0].extra.result_unknown,true);}
  else if(loseLease||wrongPrice||discountPrice||appliedDiscount){assert.equal(finalClicks,0);assert.equal(begin,0);assert.equal(closed,1);assert.equal(statuses[0].status,'failed');assert.equal(statuses[0].extra.result_unknown,false);}
  else {assert.equal(begin,1);assert.equal(finalClicks,1);assert.equal(complete,loseComplete?2:1);assert.equal(closed,1);assert.equal(statuses.length,0);}
  if(loseBegin)assert.equal(finalClicks,0);
  if(timeout)assert.equal(finalClicks,1,'processing timeout never clicks OK again');
  if(placement)assert(actions.includes('placement'));
}

(async()=>{
  await domTests();
  for(const options of [{},{placement:true,child:true},{navigation:true},{loseBegin:true},{rejectBegin:true},{loseLease:true},{wrongPrice:true},{discountPrice:true},{appliedDiscount:true},{timeout:true},{loseComplete:true},{recoveryOnly:true},{recoveryOnly:true,recoveryMissing:true}])await executorTest(options);
  assert.match(source,/if \(isFleamarketManualImportItem\(task\)\) return executeFleamarketPurchaseTask/);
  console.log('Fleamarket executor, child tab, lost-response, navigation and no-repeat tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
