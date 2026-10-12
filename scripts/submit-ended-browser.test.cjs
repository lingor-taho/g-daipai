const assert=require('assert/strict');
const express=require('express');const path=require('path');const fs=require('fs');
const {chromium}=require('playwright');
(async()=>{
  const app=express();const dist=path.resolve('src/client/dist');app.use(express.static(dist));app.get('*',(req,res)=>res.sendFile(path.join(dist,'index.html')));
  const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  fs.mkdirSync('.test-artifacts',{recursive:true});
  try {for(const width of [390,1200]) {
    const page=await browser.newPage({viewport:{width,height:950}});page.setDefaultTimeout(15000);
    await page.addInitScript(()=>{localStorage.setItem('token','mock-client-token');localStorage.setItem('role','user');localStorage.setItem('username','test');});
    let end='2026-01-01T10:00:00+09:00';let submissions=0;
    await page.route('**/api/**',async route=>{
      const url=new URL(route.request().url());let data={success:true,data:[],total:0};
      if(url.pathname.includes('/proxy/'))data={success:true,data:{auctionId:'n1247281943',title:'截止时间展示测试商品',imageUrl:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="136" height="136"><rect width="136" height="136" fill="lightblue"/></svg>',currentPrice:20000,buyoutPrice:24000,bidCount:5,taxType:'tax_zero',productType:'normal',shippingFeeText:'580円',endTime:end}};
      if(url.pathname.includes('website-rate'))data={success:true,rate:0.05};
      if(url.pathname.includes('bid-config'))data={success:true,data:{multiBidStartHours:12,multiBidIntervalMinutes:5,multiBidMinPrice:5000}};
      if(route.request().method()==='POST')submissions++;
      await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const input=page.locator('input').first();await input.fill('n1247281943');
    const fetchButton=page.getByRole('button',{name:'获取商品信息',exact:true});await fetchButton.click();
    await page.locator('[data-auction-ended]').waitFor();
    assert.equal(await page.getByRole('button',{name:'提交任务',exact:true}).count(),0);
    assert.equal(await page.getByText('最高出价',{exact:true}).count(),0);
    assert.equal(await page.getByText('出价策略',{exact:true}).count(),0);
    const badge=await page.locator('[data-auction-ended]').boundingBox();
    const image=await page.getByRole('button',{name:'查看商品详情：截止时间展示测试商品'}).boundingBox();
    assert.equal(badge.x,image.x);assert.equal(badge.y,image.y);
    assert.equal(submissions,0);
    await page.screenshot({path:`.test-artifacts/submit-ended-${width}.png`,fullPage:true});
    end='2099-01-01T10:00:00+09:00';await fetchButton.click();
    await page.getByRole('button',{name:'提交任务',exact:true}).waitFor();
    assert.equal(await page.locator('[data-auction-ended]').count(),0);
    // Freeze the display at read time, even after the deadline or focus changes.
    end=new Date(Date.now()+1800).toISOString();await fetchButton.click();
    await page.getByRole('button',{name:'提交任务',exact:true}).waitFor();
    await page.waitForTimeout(2100);
    await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
    assert.equal(await page.locator('[data-auction-ended]').count(),0);
    assert.equal(await page.getByRole('button',{name:'提交任务',exact:true}).count(),1);
    await fetchButton.click();
    await page.locator('[data-auction-ended]').waitFor();
    assert.equal(await page.getByRole('button',{name:'提交任务',exact:true}).count(),0);
    assert.equal(submissions,0);
    console.log(`${width}px: ended badge/form only determined at read time; deadline/focus preserve display, refetch updates it`);
    await page.close();
  }}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
