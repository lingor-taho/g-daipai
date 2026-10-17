const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const app = express();
  app.use(express.static(path.resolve('src/admin/dist')));
  const server = await new Promise(resolve => { const s = app.listen(0,'127.0.0.1',()=>resolve(s)); });
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  const rows = [
    {id:1,product_id:'z705858626',product_type:'normal'},
    {id:2,product_id:'a123456789',product_type:'fleamarket'},
    {id:3,product_id:'z123456789',product_type:null}
  ].map(row=>({...row,order_id:row.id,username:'test',product_title:'type test',product_url:'https://paypayfleamarket.yahoo.co.jp/item/z999999999',
    final_price:300,current_price:300,status:'pending',order_status:'pending_shipment',level:'info',created_at:'2026-10-17'}));
  try {
    for (const width of [390,1200]) {
      const page=await browser.newPage({viewport:{width,height:950}});
      await page.addInitScript(()=>{localStorage.setItem('token','mock-type-test');localStorage.setItem('role','admin');});
      await page.route('**/api/**',async route=>{
        const p=new URL(route.request().url()).pathname;
        let data={success:true,items:[],total:0};
        if (['/api/admin/tasks','/api/admin/orders','/api/admin/messages','/api/admin/reports/trusted-input','/api/admin/reports/bid-failures'].includes(p)) data={success:true,items:rows,total:3,summary:{},byAction:[],byMethod:[],byStage:[]};
        if(p==='/api/admin/tasks/stats') data={total:3,pending:3,nextTask:rows[0]};
        if(p==='/api/admin/idle-flags') data={
          paymentAlertMessage:'payment type check z705858626 a123456789 z123456789',
          productTypes:{z705858626:'normal',a123456789:'fleamarket',z123456789:null},
          googleSheetAlerts:rows.map(row=>({id:row.id,productId:row.product_id,product_type:row.product_type,error:'type check'})),
          shipmentAlerts:rows.map(row=>({id:row.id,productId:row.product_id,product_type:row.product_type,daysOverdue:9})),
          auctionHistoryAlerts:[{id:'history',items:rows.map(row=>({productId:row.product_id,product_type:row.product_type,attempts:3}))}]
        };
        await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      });
      async function check() {
        await page.locator('.ant-table-tbody:visible').getByText('a123456789',{exact:true}).first().waitFor();
        for(const [id,url] of [['z705858626','https://auctions.yahoo.co.jp/jp/auction/z705858626'],['a123456789','https://paypayfleamarket.yahoo.co.jp/item/a123456789']]) {
          const links=page.getByRole('link',{name:id,exact:true});
          assert.ok(await links.count()>0);
          for(const href of await links.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')))) assert.equal(href,url);
        }
        assert.equal(await page.locator('a[href]').filter({hasText:/^z123456789$/}).count(),0,'missing type must not use Z fallback');
      }
      for(const route of ['tasks','orders','message-read','reports']) {
        await page.goto(`http://127.0.0.1:${server.address().port}/#/${route}`);
        await check();
        if(route==='reports') { await page.getByRole('tab',{name:'出价失败',exact:true}).click(); await check(); }
      }
      console.log(`${width}px admin lists, next task, both reports and all alert links obey saved type; missing type has no link`);
      await page.close();
    }
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
