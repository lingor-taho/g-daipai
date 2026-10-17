const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const {chromium} = require('playwright');
const source = fs.readFileSync(require.resolve('./background.js'),'utf8');
const code = source.slice(source.indexOf('function buildScanStatusPayload('),source.indexOf('async function executePendingShipmentScanJob('));
const api = vm.runInNewContext(`${code}\n({readFleamarketTradePage,executeFleamarketTradeJob})`,{URL});
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
  } finally {await browser.close();}
  for(const [kind,type,rescan] of [['scan','pending_shipment',false],['scan','unknown',false],['scan','pending_shipment',true],['confirm-receipt','pending_shipment',false],['confirm-receipt','unknown',false]]) {
    let time=0,closed=0,created=0;const updates=[],releases=[];
    class TestDate extends Date {static now(){return time;}}
    const context = {
      URL,Date:TestDate,console,PENDING_SHIPMENT_SCAN_RENDER_WAIT_MS:1000,PENDING_SHIPMENT_SCAN_POLL_MS:500,
      parseTimeMs:()=>Date.now(),async sleep(ms){time+=ms;},async waitForTabComplete(){},
      async closeTabIfExists(){closed++;},async releaseWorkJobs(k,jobs){releases.push({kind:k,order:jobs[0].orderId});},
      async updateScanStatus(payload){updates.push(payload);},async postScanDiagnostic(){},
      chrome:{tabs:{async create(options){assert.equal(options.url,url);assert.equal(options.active,false);created++;return {id:7};}},
        scripting:{async executeScript(options){assert.equal(options.target.tabId,7);return [{result:{type,pageVariant:'fleamarket'}}];}}}
    };
    vm.runInNewContext(`${code}\nthis.execute=executeFleamarketTradeJob`,context);
    await context.execute({orderId:9,productId:id,orderStatus:'pending_shipment',trackingRescanRequested:rescan},kind);
    assert.equal(created,1);assert.equal(closed,1);
    if(kind==='scan'&&type==='pending_shipment'&&!rescan){assert.equal(updates.length,1);assert.equal(updates[0].pendingShipment,true);}
    else {assert.equal(updates.length,0);assert.equal(releases.length,1);assert.equal(releases[0].kind,kind);}
  }
  assert.match(source,/executePendingShipmentScanJob\(job\)\s*\{\s*if \(isFleamarketManualImportItem\(job\)\) return executeFleamarketTradeJob/);
  assert.match(source,/executeConfirmReceiptJob\(job\)\s*\{\s*if \(isFleamarketManualImportItem\(job\)\) return executeFleamarketTradeJob/);
  const dispatched = [];
  const dispatchContext = {
    isFleamarketManualImportItem:require('../src/shared/fleamarket.cjs').isFleamarketProduct,
    async fetchScanJobs(){return [
      {productId:id,orderStatus:'pending_shipment'},
      {productId:id,orderStatus:'waiting_shipping'},
      {productId:'p123456789',orderStatus:'pending_shipment'},
      {productId:'a123456789',orderStatus:'pending_bundle'},
      {productId:'a123456788',orderStatus:'waiting_shipping'}
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
  console.log('Fleamarket trade URL, pending status, unknown-state deferral, work release and own-tab cleanup passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
