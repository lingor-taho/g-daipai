const assert = require('assert/strict');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
  const dist = path.resolve('src/client/dist');
  const app = express();app.use(express.static(dist));app.get('*',(req,res)=>res.sendFile(path.join(dist,'index.html')));
  const server = await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  const titles = [
    '万年筆/ボールペン/シャーペン 約72点まとめ PILOT/MONTBLANC/SAILOR/PLATINUM/PARKER 他 筆記用具 文具 1円～ E0509',
    '万年筆/ボールペン 7点まとめ PELIKAN 1838-1988 ペン先 18C-750/S.T.Dupont 750/SHEAFFER 14K/Waterman 18K-750/他 ペリカン 1円～ I1448',
    'PILOTMONTBLANCSAILORPLATINUMPARKER'.repeat(5),
    '短标题'
  ];
  fs.mkdirSync('.test-artifacts',{recursive:true});
  try {
    for (const width of [320,393,1200]) {
      const page=await browser.newPage({viewport:{width,height:950},isMobile:width<800,hasTouch:width<800});
      await page.addInitScript(()=>{localStorage.setItem('token','layout-test');localStorage.setItem('username','test');});
      await page.route('**/api/**',async route=>{
        const pathname=new URL(route.request().url()).pathname;
        let data={success:true,data:[],total:0};
        if(pathname==='/api/auth/acting-users')data={success:true,data:[{id:1,username:'test',user_level:1}]};
        if(pathname==='/api/task/list')data={success:true,total:titles.length,data:titles.map((title,index)=>({
          id:index+1,product_id:`c124933093${index}`,product_title:title,product_type:'normal',
          status:index===2?'pending':'bidding',strategy:index===2?'multi_bid':'direct',max_price:47302,created_at:'2026-10-26 12:28:42'
        }))};
        await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      });
      for (const pathname of ['/tasks','/submit']) {
        await page.goto(`http://127.0.0.1:${server.address().port}${pathname}`);
        await page.getByText(titles[0],{exact:true}).waitFor();
        const layout=await page.evaluate(()=>({
          viewport:document.querySelector('meta[name="viewport"]').content,
          textAdjust:getComputedStyle(document.documentElement).webkitTextSizeAdjust,
          rows:[...document.querySelectorAll('.client-task-list .adm-list-item')].map(row=>{
            const main=row.querySelector('.adm-list-item-content-main');const extra=row.querySelector('.adm-list-item-content-extra');
            const title=main.firstElementChild;const description=main.querySelector('.adm-list-item-description');
            return {rowRight:row.getBoundingClientRect().right,mainRight:main.getBoundingClientRect().right,
              extraLeft:extra.getBoundingClientRect().left,extraRight:extra.getBoundingClientRect().right,
              width:main.clientWidth,scrollWidth:main.scrollWidth,titleFont:getComputedStyle(title).fontSize,
              descriptionFont:getComputedStyle(description.firstElementChild).fontSize};
          })
        }));
        assert.equal(layout.rows.length,titles.length);
        assert.equal(layout.textAdjust,'100%');
        assert.ok(!/user-scalable\s*=\s*(no|0)|maximum-scale/i.test(layout.viewport),'Manual zoom must remain available');
        for(const row of layout.rows){
          assert.equal(row.titleFont,'13px');assert.equal(row.descriptionFont,'12px');
          assert.ok(row.scrollWidth<=row.width+1,`Content overflows: ${JSON.stringify(row)}`);
          assert.ok(row.mainRight<=row.extraLeft+1,'Title and status must not overlap');
          assert.ok(row.extraRight<=row.rowRight+1,'Status/cancel controls must fit inside each row');
        }
        if(width===393)await page.screenshot({path:`.test-artifacts/task-list-mobile-${pathname.slice(1)}.png`,fullPage:true});
      }
      console.log(`${width}px: task and embedded lists keep uniform fonts, wrap long titles, and preserve status/cancel controls and manual zoom`);
      await page.close();
    }
  } finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
