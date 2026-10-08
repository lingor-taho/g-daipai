const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const os = require('os');
async function run() {
  const root = path.resolve(__dirname,'../src/client');
  const {build} = await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')).href);
  const html = `<!DOCTYPE html><html><body><div id="root"></div><script type="module">
    import React from 'react';import {createRoot} from 'react-dom/client';
    import ProductSearchPopup from '/src/components/ProductSearchPopup.jsx';
    import AuctionHistoryChart,{AuctionHistoryChartButton} from '/src/components/AuctionHistoryChart.jsx';
    import {MemoryRouter} from 'react-router-dom';
    import ActiveBidding from '/src/pages/ActiveBidding.jsx';
    import WonItems from '/src/pages/WonItems.jsx';
    function ChartDemo() {
      const [selected,setSelected]=React.useState(null);
      const item={product_id:'u1246662246',product_title:'测试图表商品',end_time:'2026-10-08T21:46:00+09:00',has_auction_history:1};
      return React.createElement('div',null,React.createElement(AuctionHistoryChartButton,{item:{has_auction_history:0}}),React.createElement(AuctionHistoryChartButton,{item,onClick:()=>setSelected(item)}),React.createElement(AuctionHistoryChart,{item:selected,onClose:()=>setSelected(null)}));
    }
    const item={auctionId:'u1246662246',title:'测试商品',bidCount:131,currentPrice:81000,endTime:'2026-10-04T21:46:00+09:00'};
    createRoot(document.getElementById('root')).render(new URL(location.href).searchParams.has('page') ? React.createElement(MemoryRouter,null,React.createElement(new URL(location.href).searchParams.get('page')==='won'?WonItems:ActiveBidding)) : new URL(location.href).searchParams.has('chart') ? React.createElement(ChartDemo) : React.createElement(ProductSearchPopup,{
      visible:true,keyword:'',items:[],favorites:[],detailOnlyItem:item,onClose:()=>{},onBid:()=>{},
      onLoadDetail:async()=>item,detailAction:'close'
    }));
  </script></body></html>`;
  const fixture = path.join(root,'__history_test.html');
  const output = fs.mkdtempSync(path.join(os.tmpdir(),'g-daipai-history-'));
  try {
    fs.writeFileSync(fixture,html);
    await build({root,configFile:path.join(root,'vite.config.js'),build:{outDir:output,emptyOutDir:false,rollupOptions:{input:fixture}}});
  } finally { if (fs.existsSync(fixture)) fs.unlinkSync(fixture); }
  const server = http.createServer((req,res)=>{
    const pathname = new URL(req.url,'http://localhost').pathname;
    const target = path.resolve(output,pathname === '/__history_test' ? '__history_test.html' : '.'+pathname);
    if (!target.startsWith(output+path.sep) || !fs.existsSync(target)) {res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',target.endsWith('.js')?'application/javascript':target.endsWith('.css')?'text/css':'text/html');
    res.end(fs.readFileSync(target));
  });
  await new Promise(resolve=>server.listen(43821,'127.0.0.1',resolve));
  const closeServer = () => new Promise(resolve=>server.close(resolve));
  let browser;
  try { browser = await chromium.launch({headless:true,channel:'chrome'}); }
  catch (error) { await closeServer(); throw error; }
  try {
    for (const width of [390,1200]) {
      const page = await browser.newPage({viewport:{width,height:900}});
      const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message);});
      page.on('console',message=>{if(message.type()==='error')console.error('BROWSER',message.text());});
      let response = {html:'<div class="auction-history"><h3>入札履歴</h3><table><tr><td>10月4日21時46分</td><td>jailhnrx 自動入札。 81,000</td></tr></table></div>',expired:false};
      await page.route('**/api/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(route.request().url().includes('/task/auction-history/') ? response : {
        success:true,data:[{id:1,order_id:1,product_id:'u1246662246',product_title:'列表测试商品',has_auction_history:1,order_status:null,status:'success',strategy:'direct',max_price:82000,final_price:81000,current_price:81000,end_time:'2026-10-08T21:46:00+09:00',bid_history:[]}],total:1,page:1,limit:10
      })}));
      await page.goto('http://127.0.0.1:43821/__history_test');
      await page.getByRole('button',{name:'查看拍卖记录',exact:true}).click({timeout:10000}).catch(async error=>{console.error(await page.locator('body').innerText());throw error;});
      await page.getByText('jailhnrx 自動入札。 81,000').waitFor();
      assert.equal(await page.getByText('商品详细说明',{exact:true}).count(),0);
      assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth),true);
      await page.getByRole('button',{name:'返回商品详情'}).click();
      await page.getByText('商品详细说明',{exact:true}).waitFor();
      response={html:'',expired:false};
      await page.getByRole('button',{name:'查看拍卖记录',exact:true}).click();
      await page.getByText('拍卖记录尚未采集',{exact:true}).waitFor();
      await page.getByRole('button',{name:'返回商品详情'}).click();
      response={html:'数据已过期',expired:true};
      await page.getByRole('button',{name:'查看拍卖记录',exact:true}).click();
      await page.getByText('数据已过期',{exact:true}).waitFor();
      response={data:JSON.stringify([{time:'10-8 21:46',username:'Bob',price:81000},{time:'10-8 21:44',username:'Alice',price:80000},{time:'10-1 18:55',username:'开始',price:1}])};
      await page.goto('http://127.0.0.1:43821/__history_test?chart=1');
      assert.equal(await page.getByRole('button',{name:'拍卖记录尚未采集',exact:true}).isDisabled(),true);
      await page.getByRole('button',{name:'查看拍卖记录图表',exact:true}).click();
      await page.getByRole('img',{name:'用户拍卖记录时间价格折线图'}).waitFor();
      assert.equal(await page.locator('[data-segment-user]').count(),2);
      assert.equal(await page.locator('[data-segment-user="Alice"] line').getAttribute('stroke'),'hsl(130, 65%, 42%)');
      assert.equal(await page.locator('linearGradient').count(),2);
      await page.getByLabel('竞拍用户颜色列表').getByText('Alice',{exact:true}).waitFor();
      await page.getByLabel('竞拍用户颜色列表').getByText('Bob',{exact:true}).waitFor();
      assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth),true);
      await page.screenshot({path:path.join(output,`auction-history-chart-${width}.png`)});
      await page.getByRole('button',{name:'关闭',exact:true}).click();
      response={data:'数据已过期'};
      await page.getByRole('button',{name:'查看拍卖记录图表',exact:true}).click();
      await page.getByText('数据已过期',{exact:true}).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog').count(),0);
      response={data:JSON.stringify([{time:'10-8 21:46',username:'Bob',price:81000},{time:'10-1 18:55',username:'开始',price:1}])};
      await page.goto('http://127.0.0.1:43821/__history_test?page=won');
      const chartButton=page.getByRole('button',{name:'查看拍卖记录图表',exact:true});
      await chartButton.waitFor();
      const pauseBox=await page.getByRole('button',{name:'订单未暂停',exact:true}).boundingBox();
      const chartBox=await chartButton.boundingBox();
      assert.ok(chartBox.x>pauseBox.x);
      await chartButton.click();
      await page.getByRole('img',{name:'用户拍卖记录时间价格折线图'}).waitFor();
      await page.keyboard.press('Escape');
      await page.goto('http://127.0.0.1:43821/__history_test?page=active');
      await page.getByRole('button',{name:'入札中',exact:true}).click();
      await page.getByRole('button',{name:'失败分析 → 返回',exact:true}).waitFor();
      await page.getByRole('button',{name:'查看拍卖记录图表',exact:true}).click();
      await page.getByRole('img',{name:'用户拍卖记录时间价格折线图'}).waitFor();
      await page.keyboard.press('Escape');
      assert.deepEqual(errors,[]);
      await page.close();
    }
    const yahoo = await browser.newPage();
    await yahoo.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<h2>すべての入札履歴</h2><table><tr><td>10月 4日 21時 46分</td><td><img alt="">jailhnrx 自動入札。 81,000</td></tr></table><a href="?aID=u1246662246&apg=2&typ=log">次の50件</a>`}));
    await yahoo.goto('https://auctions.yahoo.co.jp/jp/show/bid_hist?aID=u1246662246&apg=1&typ=log');
    await yahoo.addScriptTag({path:path.resolve(__dirname,'../yahoo-plugin/auctionHistory.js')});
    const parsed = await yahoo.evaluate(()=>globalThis.readAuctionHistoryPage());
    assert.equal(parsed.error,undefined,JSON.stringify(parsed));
    assert.equal(parsed.rows[0].username,'jailhnrx');
    assert.equal(parsed.rows[0].price,81000);
    assert.equal(new URL(parsed.nextUrl).searchParams.get('apg'),'2');
    console.log('Auction history browser tests passed: 390/1200px, won/failure list entries, segment colors/gradient, return, empty/expired, real DOM extraction');
  } finally {await browser.close();await closeServer();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
