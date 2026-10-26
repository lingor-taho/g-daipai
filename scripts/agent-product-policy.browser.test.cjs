const assert = require('assert/strict');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
(async () => {
  const app = express(); const dist = path.resolve('src/client/dist');
  app.use(express.static(dist)); app.get('*',(req,res)=>res.sendFile(path.join(dist,'index.html')));
  const server = await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  fs.mkdirSync('.test-artifacts',{recursive:true});
  try {
    for (const width of [390,1200]) {
      const page=await browser.newPage({viewport:{width,height:950}}); page.setDefaultTimeout(12000);
      let policy='exclusive', conflicts=['n1247281943'], submissions=0, checks=0, canConfigure=true, checkFails=false;
      const requests=[];
      await page.addInitScript(()=>{localStorage.setItem('token','test-agent');localStorage.setItem('username','agent-a');localStorage.setItem('userLevel','2');});
      await page.route('**/api/**',async route=>{
        const req=route.request();const url=new URL(req.url());let status=200;
        let data={success:true,data:[],total:0};
        if(url.pathname==='/api/auth/acting-users') data={success:true,data:[{id:8100,username:'agent-a',user_level:2,bid_strategy_scope:'all'}]};
        if(url.pathname==='/api/auth/agent-product-policy') {
          if(req.method()==='PUT') policy=req.postDataJSON().policy;
          data={success:true,policy,agentId:8100,canConfigure};
        }
        if(url.pathname.endsWith('/agent-product-policy/check')) {
          requests.push('check');checks++;
          data={success:true,policy,conflicts:policy==='allow'?[]:conflicts};
          if(checkFails){status=503;data={error:'查询暂不可用'};}
        }
        if(url.pathname.includes('/proxy/')) data={success:true,data:{auctionId:'n1247281943',title:'代理组提交验证商品',imageUrl:'',currentPrice:20000,bidCount:0,taxType:'tax_zero',productType:'normal',shippingFeeText:'580円',endTime:'2099-01-01T10:00:00+09:00'}};
        if(url.pathname.includes('website-rate'))data={success:true,rate:0.05};
        if(url.pathname==='/api/task/submit'||url.pathname==='/api/task/batch-submit') {
          requests.push('submit');submissions++;
          status=409;data={error:'该商品已由其他用户提交，请联系管理员！'};
        }
        await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/submit`);
      const gear=page.getByRole('button',{name:'代理组设置',exact:true});await gear.click();
      const group=page.getByRole('radiogroup',{name:'代理组同商品策略'});await group.waitFor();
      assert.equal(await group.locator('input:checked').inputValue(),'exclusive');
      const box=await group.boundingBox(); assert.ok(box.x>=0&&box.x+box.width<=width,'Settings fit mobile/desktop');
      await page.screenshot({path:`.test-artifacts/agent-policy-settings-${width}.png`,fullPage:true});
      await group.getByLabel('同商品提醒，能继续拍',{exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('input[value="confirm"]')?.checked);
      assert.equal(policy,'confirm');
      await gear.click();
      await page.locator('input').first().fill('n1247281943');
      await page.getByRole('button',{name:'获取商品信息',exact:true}).click();
      await page.getByPlaceholder('日元',{exact:true}).fill('25000');
      const submit=page.getByRole('button',{name:'提交任务',exact:true});
      policy='exclusive'; await submit.click();
      await page.getByText('代理组内该商品有人提交，请联系代理！',{exact:true}).waitFor();
      assert.equal(submissions,0);await page.getByText('知道了',{exact:true}).click();
      policy='confirm';await submit.click();
      await page.getByText('代理组内该商品有人提交，是否继续？',{exact:true}).waitFor();
      await page.getByText('取消',{exact:true}).click();assert.equal(submissions,0);
      await submit.click();await page.getByText('继续',{exact:true}).click();
      await page.getByText('该商品已由其他用户提交，请联系管理员！',{exact:true}).waitFor();
      assert.equal(submissions,1);assert.deepEqual(requests.slice(-2),['check','submit']);
      policy='allow';await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/task/submit')),submit.click()]);
      assert.equal(submissions,2);
      policy='exclusive';conflicts=[];await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/task/submit')),submit.click()]);
      assert.equal(submissions,3);
      checkFails=true;await submit.click();await page.getByText('查询暂不可用',{exact:true}).waitFor();
      assert.equal(submissions,3,'Query failures cannot send a task');
      checkFails=false;conflicts=['n1247281943'];
      await page.getByRole('button',{name:'批量添加',exact:true}).click();
      await page.getByLabel('批量商品和最高价',{exact:true}).fill('n1247281943 25000');
      await page.getByRole('button',{name:'提交批量任务',exact:true}).click();
      await page.getByText(/代理组内该商品有人提交，请联系代理！/).waitFor();
      assert.equal(submissions,3,'Batch exclusivity prevents enqueue');
      await page.getByText('知道了',{exact:true}).click();
      policy='confirm';await page.getByRole('button',{name:'提交批量任务',exact:true}).click();
      await page.getByText('取消',{exact:true}).click();assert.equal(submissions,3);
      await page.getByRole('button',{name:'提交批量任务',exact:true}).click();
      await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/task/batch-submit')),page.getByText('继续',{exact:true}).click()]);
      assert.equal(submissions,4);
      canConfigure=false;await page.reload();
      await page.getByText('登录用户：',{exact:true}).waitFor();
      assert.equal(await gear.count(),0,'Subordinates have no settings');
      assert.ok(checks>=6);
      console.log(`${width}px: default/server save, mobile menu, exclusivity, cancel/continue, allow, no conflict, query failure, original allocation message passed`);
      await page.close();
      const adminPage=await browser.newPage({viewport:{width,height:950}});adminPage.setDefaultTimeout(12000);
      const policies=new Map([['8100','exclusive'],['8200','exclusive']]);const saves=[];
      const users=[{id:8100,username:'policy-agent-a',user_level:2},{id:8200,username:'policy-agent-b',user_level:2},{id:8101,username:'policy-child-a',user_level:1}];
      await adminPage.addInitScript(()=>{
        localStorage.setItem('token','test-client-admin');localStorage.setItem('username','client-admin');
        localStorage.setItem('userLevel','3');localStorage.setItem('actingUserId','8100');
      });
      await adminPage.route('**/api/**',async route=>{
        const req=route.request();const url=new URL(req.url());let data={success:true,data:[],total:0};
        if(url.pathname==='/api/auth/acting-users')data={success:true,data:users};
        if(url.pathname==='/api/auth/agent-product-policy'){
          const target=req.headers()['x-acting-user-id'];
          if(req.method()==='PUT') {saves.push({target,policy:req.postDataJSON().policy});policies.set(target,req.postDataJSON().policy);}
          data={success:true,agentId:Number(target),policy:policies.get(target)||'exclusive',canConfigure:users.find(u=>String(u.id)===target)?.user_level===2};
        }
        await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      });
      await adminPage.goto(`http://127.0.0.1:${server.address().port}/submit`);
      const adminGear=adminPage.getByRole('button',{name:'代理组设置',exact:true});
      const adminGroup=adminPage.getByRole('radiogroup',{name:'代理组同商品策略'});
      async function selectAccount(username){
        await adminPage.getByText('当前账号',{exact:true}).click();
        await adminPage.locator('.adm-popup-body').getByText(username,{exact:true}).click();
      }
      await adminGear.click();await adminGroup.waitFor();
      await adminGroup.getByLabel('同商品提醒，能继续拍',{exact:true}).click();
      await adminPage.waitForFunction(()=>document.querySelector('input[value="confirm"]')?.checked);
      assert.deepEqual(saves,[{target:'8100',policy:'confirm'}]);
      await adminGear.click();await selectAccount('policy-agent-b');
      await adminGear.click();await adminGroup.waitFor();
      assert.equal(await adminGroup.locator('input:checked').inputValue(),'exclusive');
      await adminGroup.getByLabel('同商品无提醒，直接拍',{exact:true}).click();
      await adminPage.waitForFunction(()=>document.querySelector('input[value="allow"]')?.checked);
      assert.deepEqual(saves.at(-1),{target:'8200',policy:'allow'});
      await adminPage.screenshot({path:`.test-artifacts/admin-agent-policy-${width}.png`,fullPage:true});
      await adminGear.click();await Promise.all([adminPage.waitForResponse(r=>r.url().endsWith('/api/auth/agent-product-policy')),selectAccount('policy-child-a')]);
      assert.equal(await adminGear.count(),0,'Admin selecting a subordinate must have no settings');
      await selectAccount('policy-agent-a');await adminGear.click();await adminGroup.waitFor();
      assert.equal(await adminGroup.locator('input:checked').inputValue(),'confirm','Switching back reads agent A, not agent B');
      assert.equal(policies.get('8200'),'allow');
      await adminGear.click();await adminPage.reload();await adminGear.click();await adminGroup.waitFor();
      assert.equal(await adminGroup.locator('input:checked').inputValue(),'confirm','Selected agent policy survives reload');
      await adminGear.click();await selectAccount('policy-agent-a');await adminGear.click();await adminGroup.waitFor();
      assert.equal(await adminGroup.locator('input:checked').inputValue(),'confirm','Reselecting the current agent preserves settings');
      console.log(`${width}px: client admin edits selected A/B independently, hides gear for subordinate, reload preserves target passed`);
      await adminPage.close();
    }
  } finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
