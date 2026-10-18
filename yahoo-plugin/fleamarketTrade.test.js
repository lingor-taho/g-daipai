const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const {chromium} = require('playwright');
const source = fs.readFileSync(require.resolve('./background.js'),'utf8');
const code = source.slice(source.indexOf('function buildScanStatusPayload('),source.indexOf('async function executePendingShipmentScanJob('));
const api = vm.runInNewContext(`${code}\n({readFleamarketTradePage,fleamarketReceiptStep,executeFleamarketTradeJob})`,{URL});
const id = 'z705860836';
const url = `https://paypayfleamarket-sec.yahoo.co.jp/item/${id}/trade/buyer`;

(async()=>{
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  try {
    const page = await browser.newPage();
    let html='';
    await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:html}));
    const read = async (body,target=url) => {
      html=body;await page.goto(target);
      return page.evaluate(`(${api.readFleamarketTradePage.toString()})('${id}')`);
    };
    assert.equal((await read('<div>発送待ち　配送中　受取評価　取引完了</div><div>出品者の発送をお待ちください</div>')).type,'pending_shipment');
    assert.equal((await read('<div>発送待ち　配送中　受取評価　取引完了</div>')).type,'unknown','progress labels do not imply shipment or completion');
    assert.equal((await read('<div style="display:none">出品者の発送をお待ちください</div>')).type,'unknown');
    assert.equal((await read('<h2>出品者の発送をお待ちください</h2>',url.replace(id,'z123456789'))).type,'unknown');
    assert.equal((await read('<h2>購入が完了しました</h2>')).type,'unknown','purchase completion is not shipment confirmation');
    assert.equal((await read('<div>配送中</div><div>お問い合わせ番号 123456789012</div><button>受取評価</button>')).type,'unknown','unsupported shipment/receipt DOM is left unchanged');
    const shippedHtml = fs.readFileSync(require.resolve('./fixtures/fleamarket-shipped.html'),'utf8');
    const shipped = await read(shippedHtml);
    assert.equal(shipped.type,'shipped');assert.equal(shipped.shippingCompany,'お問い合わせ');
    assert.equal(shipped.trackingNumber,'646960564235');assert.equal(shipped.shipmentDetailsRendered,true);
    assert.equal((await read(shippedHtml.replace('id="deliverystatus"','id="unrelated"'))).shipmentDetailsRendered,false,'do not take unrelated numbers outside delivery status');
    assert.equal((await read(shippedHtml.replace('>646960564235</a>','>読み込み中</a>'))).shipmentDetailsRendered,false,'link URL alone cannot replace the unrendered number');
    assert.equal((await read(shippedHtml.replace('>646960564235</a>','>6469-6056-4235</a>'))).trackingNumber,'646960564235');
    assert.equal((await read(shippedHtml.replace('<a class=', '<a style="display:none" class='))).shipmentDetailsRendered,false);
    assert.equal((await read(shippedHtml.replace('<h1>','<h1 style="display:none">'))).type,'unknown','hidden shipment text is not evidence');
    assert.equal((await read(shippedHtml.replace('<h1>','<p>').replace('</h1>','</p>'))).type,'unknown','seller message text cannot confirm shipment');
    assert.equal((await read(shippedHtml,url.replace(id,'z123456789'))).type,'unknown');
    assert.equal((await read(shippedHtml.replace('>646960564235</a>','>646960564235</a><a href="https://example.com">123456789012</a>'))).shipmentDetailsRendered,false,'conflicting tracking numbers defer instead of choosing one');
    await read(shippedHtml+'<button onclick="window.received=true">受取評価</button>');
    assert.equal(await page.evaluate('window.received'),undefined,'shipment reading never confirms receipt');
    const receiptHtml = fs.readFileSync(require.resolve('./fixtures/fleamarket-receipt.html'),'utf8');
    const receipt = (action='') => page.evaluate(`(${api.fleamarketReceiptStep.toString()})('${id}','${action}')`);
    await read(receiptHtml);
    let state=await receipt();assert.equal(state.type,'receipt_ready');assert.equal(state.checked,false);assert.equal(state.disabled,true);
    const comment=await page.locator('textarea').inputValue();
    assert.equal(await page.locator('input[name="rating"]:checked').inputValue(),'GOOD');
    await receipt('submit');assert.equal(await page.locator('input[type="checkbox"]').isChecked(),false,'disabled submit does not tick checkbox implicitly');
    await page.evaluate(()=>{
      document.querySelector('input[type="checkbox"]').addEventListener('change',event=>{document.querySelector('#rating button').disabled=!event.target.checked;});
      document.querySelector('#rating button').addEventListener('click',()=>{window.receiptClicks=(window.receiptClicks||0)+1;});
    });
    await receipt('check');state=await receipt();assert.equal(state.checked,true);assert.equal(state.disabled,false);
    await receipt('check');assert.equal(await page.locator('input[type="checkbox"]').isChecked(),true,'already checked must not be toggled off');
    assert.equal(await page.locator('textarea').inputValue(),comment);assert.equal(await page.locator('input[name="rating"]:checked').inputValue(),'GOOD','rating and comment stay unchanged');
    await receipt('submit');await receipt('submit');assert.equal(await page.evaluate('window.receiptClicks'),1,'receipt submit is single-use');
    await page.evaluate(()=>{document.querySelector('h1').textContent='すべての取引が完了しました';});
    assert.equal((await receipt()).type,'completed');
    await read('<h1>すべての取引が完了しました</h1>');assert.equal((await receipt()).type,'completed','manual completion needs no checkbox or button');
    await read('<p>すべての取引が完了しました</p>');assert.equal((await receipt()).type,'waiting','seller text cannot confirm completion');
    await read('<h1 style="display:none">すべての取引が完了しました</h1>');assert.equal((await receipt()).type,'waiting');
    await read('<script>window.message="すべての取引が完了しました"</script>');assert.equal((await receipt()).type,'waiting');
    await read(receiptHtml,url.replace(id,'z123456789'));assert.equal((await receipt('check')).type,'foreign');
    const notice = '<div class="ReactModal__Content" role="dialog" aria-modal="true"><p>受取評価と取引が完了しました</p><a onclick="window.noticeClicks=(window.noticeClicks||0)+1">OK</a></div>';
    await read(notice+'<button onclick="window.otherClicks=1">OK</button>');
    assert.equal((await receipt()).type,'receipt_notice');
    await receipt('notice-ok');await receipt('notice-ok');
    assert.equal(await page.evaluate('window.noticeClicks'),1,'acknowledge only this exact result modal once');
    assert.equal(await page.evaluate('window.otherClicks'),undefined,'unrelated page OK stays untouched');
    await read(notice+'<h1>すべての取引が完了しました</h1>');
    assert.equal((await receipt()).type,'receipt_notice','result modal is acknowledged before the heading behind it');
    await page.evaluate(()=>document.querySelector('[role="dialog"] a').onclick=()=>{document.querySelector('[role="dialog"]').remove();});
    await receipt('notice-ok');assert.equal((await receipt()).type,'completed');
    await read(notice.replace('<a onclick=', '<a aria-disabled="true" onclick='));
    assert.equal((await receipt()).ready,false);await receipt('notice-ok');assert.equal(await page.evaluate('window.noticeClicks'),undefined);
    await read(notice.replace('受取評価と取引が完了しました','別の確認です'));
    assert.equal((await receipt('notice-ok')).type,'waiting');assert.equal(await page.evaluate('window.noticeClicks'),undefined);
    await read(notice.replace('<div class=', '<div style="display:none" class='));
    assert.equal((await receipt('notice-ok')).type,'waiting');assert.equal(await page.evaluate('window.noticeClicks'),undefined);
    await read('<p>受取評価と取引が完了しました</p><button onclick="window.otherClicks=1">OK</button>');
    assert.equal((await receipt('notice-ok')).type,'waiting');assert.equal(await page.evaluate('window.otherClicks'),undefined,'seller message cannot authorize an unrelated OK');
    await read(notice,url.replace(id,'z123456789'));assert.equal((await receipt('notice-ok')).type,'foreign');



  } finally {await browser.close();}
  for(const [kind,type,rescan] of [['scan','pending_shipment',false],['scan','unknown',false],['scan','pending_shipment',true],['confirm-receipt','pending_shipment',false],['confirm-receipt','unknown',false],['scan','shipped',false],['scan','shipped',true],['scan','shipped-delayed',false],['scan','shipped-missing',false],['confirm-receipt','shipped',false]]) {
    let time=0,closed=0,created=0,reads=0;const updates=[],releases=[];
    class TestDate extends Date {static now(){return time;}}
    const context = {
      URL,Date:TestDate,console,PENDING_SHIPMENT_SCAN_RENDER_WAIT_MS:1000,PENDING_SHIPMENT_SCAN_POLL_MS:500,
      parseTimeMs:()=>Date.now(),async sleep(ms){time+=ms;},async waitForTabComplete(){},
      async closeTabIfExists(){closed++;},async releaseWorkJobs(k,jobs){releases.push({kind:k,order:jobs[0].orderId});},
      async updateScanStatus(payload){updates.push(payload);},async postScanDiagnostic(){},
      chrome:{tabs:{async create(options){assert.equal(options.url,url);assert.equal(options.active,false);created++;return {id:7};}},
        scripting:{async executeScript(options){assert.equal(options.target.tabId,7);reads++;return [{result:{type:type.startsWith('shipped')?'shipped':type,pageVariant:'fleamarket',
          shippingCompany:'お問い合わせ',trackingNumber:'646960564235',
          shipmentDetailsRendered:type==='shipped-missing'?false:type==='shipped-delayed'?reads>1:true}}];}}}
    };
    vm.runInNewContext(`${code}\nthis.execute=executeFleamarketTradeJob`,context);
    await context.execute({orderId:9,productId:id,orderStatus:'pending_shipment',trackingRescanRequested:rescan},kind);
    assert.equal(created,1);assert.equal(closed,1);
    if(kind==='scan'&&type==='pending_shipment'&&!rescan){assert.equal(updates.length,1);assert.equal(updates[0].pendingShipment,true);}
    else if(kind==='scan'&&['shipped','shipped-delayed'].includes(type)) {
      assert.equal(updates.length,1);assert.equal(updates[0].shipped,true);
      assert.equal(updates[0].shippingCompany,'お問い合わせ');assert.equal(updates[0].trackingNumber,'646960564235');
      assert.equal(updates[0].trackingRescanRequested,rescan);assert.equal(releases.length,0);
      assert.equal(reads,type==='shipped-delayed'?2:1,'complete shipment stops polling, incomplete data waits');
    }
    else {assert.equal(updates.length,0);assert.equal(releases.length,1);assert.equal(releases[0].kind,kind);}
  }
  // Run the real P executor with controlled page transitions and task callbacks.
  for (const scenario of ['normal','already','checked','navigation','timeout','disabled','foreign','waiting','cancel-check','notice','notice-existing','notice-navigation','notice-timeout']) {
    let time=0,checked=scenario==='checked',submitted=false,checks=0,submits=0,closed=0,reads=0,noticeClicks=0;
    const updates=[],released=[];
    class TestDate extends Date {static now(){return time;}}
    const context={URL,Date:TestDate,console,async sleep(ms){time+=ms;},async waitForTabComplete(){},
      isContentScriptTargetGoneError:()=>false,async closeTabIfExists(){closed++;},
      async releaseWorkJobs(kind){released.push(kind);},async updateConfirmReceiptStatus(payload){updates.push(payload);},
      chrome:{tabs:{async create({url:target}){assert.equal(target,url);return {id:7};}},scripting:{async executeScript({args}){
        const action=args[1];
        if(action==='check'){checks++;checked=true;return [{result:{type:'receipt_ready',checked:true}}];}
        if(action==='submit'){assert(checked);submits++;submitted=true;if(scenario==='navigation')throw Error('Execution context destroyed during navigation');return [{result:{type:'receipt_ready',clicked:true}}];}
        if(action==='notice-ok'){noticeClicks++;if(scenario==='notice-navigation')throw Error('Execution context destroyed during navigation');return [{result:{type:'receipt_notice',clicked:true}}];}
        reads++;
        const inNotice=scenario.startsWith('notice')&&(submitted||scenario==='notice-existing');
        const type=inNotice ? (noticeClicks&&scenario!=='notice-timeout'?'completed':'receipt_notice')
          :scenario==='foreign'?'foreign':scenario==='already'||(submitted&&scenario!=='timeout')?'completed':scenario==='waiting'?'waiting':'receipt_ready';
        return [{result:{type,checked,ready:true,disabled:scenario==='disabled'||!checked}}];
      }}}};
    vm.runInNewContext(`${code}\nthis.execute=executeFleamarketTradeJob`,context);
    const job={orderId:9,productId:id,orderStatus:'pending_receipt',jobType:scenario==='cancel-check'?'cancel_check':'confirm_receipt'};
    if(['timeout','disabled','foreign','notice-timeout'].includes(scenario)) {
      await assert.rejects(context.execute(job,'confirm-receipt'),/フリマ/);
      assert.equal(updates.length,0,'no success without a matching rendered completion heading');
    } else {
      await context.execute(job,'confirm-receipt');
      if(['waiting','cancel-check'].includes(scenario)){assert.equal(updates.length,0);assert.deepEqual(released,['confirm-receipt']);}
      else {assert.equal(updates.length,1);assert.equal(updates[0].status,['already','notice-existing'].includes(scenario)?'already_completed':'success');assert.equal(updates[0].orderId,9);}
    }
    assert.equal(closed,1,'close only this P job tab');
    assert.equal(noticeClicks,scenario.startsWith('notice')?1:0,'notice OK is single-use, including timeout/navigation');
    if(['already','waiting','cancel-check','foreign','notice-existing'].includes(scenario)){assert.equal(checks,0);assert.equal(submits,0);}
    else {assert.equal(checks,scenario==='checked'?0:1);assert.equal(submits,scenario==='disabled'?0:1);}
  }
  assert.match(source,/executePendingShipmentScanJob\(job\)\s*\{[\s\S]*?if \(isFleamarketManualImportItem\(job\)\) return executeFleamarketTradeJob/);
  assert.match(source,/executeConfirmReceiptJob\(job\)\s*\{[\s\S]*?if \(isFleamarketManualImportItem\(job\)\) return executeFleamarketTradeJob/);
  const dispatched = [];
  const dispatchContext = {
    savedProductType:require('../src/shared/fleamarket.cjs').getStoredProductType,
    isFleamarketManualImportItem:require('../src/shared/fleamarket.cjs').isStoredFleamarketProduct,
    async fetchScanJobs(){return [
      {productType:'fleamarket',productId:id,orderStatus:'pending_shipment'},
      {productType:'fleamarket',productId:id,orderStatus:'waiting_shipping'},
      {productType:'normal',productId:'p123456789',orderStatus:'pending_shipment'},
      {productType:'normal',productId:'a123456789',orderStatus:'pending_bundle'},
      {productType:'normal',productId:'a123456788',orderStatus:'waiting_shipping'}
    ];},
    async withWorkBatch(kind,jobs,callback){assert.equal(kind,'scan');return callback(()=>{});},
    async executeFleamarketTradeJob(){dispatched.push('P');},
    async executePendingShipmentScanJob(){dispatched.push('normal');},
    async executePendingBundleScanJob(){dispatched.push('bundle');},
    async executeWaitingShippingScanJob(){dispatched.push('shipping');}
  };
  vm.runInNewContext(source.slice(source.indexOf('async function runScanJobs('),source.indexOf('async function executePaymentJob(')),dispatchContext);
  await dispatchContext.runScanJobs();
  assert.deepEqual(dispatched,['P','P','normal','bundle','shipping']);
  console.log('Fleamarket pending/shipped DOM, tracking/default carrier, delayed rendering, scan/rescan and P-only receipt/completed-page handling passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
