const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');
const express=require('express');
const {chromium}=require('playwright');

(async()=>{
  const root=path.resolve(__dirname,'..');
  const output=path.join(root,'.test-artifacts');fs.mkdirSync(output,{recursive:true});
  const app=express();app.use(express.static(path.join(root,'src/admin/dist')));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
    for(const width of [360,390,1200]) {
      const accountList=[1,2,3].map(id=>({id,account_name:['A','B','C'][id-1],yahoo_id:`yahoo-${id}`,profile_dir:`Profile ${id}`,email:`profile${id}@example.com`,is_primary:id===1?1:0,priority:id-1,enabled:1,online:true,binding_token:`test-binding-${id}`}));
      const flags=accountList.map(a=>({...a,account_id:a.id,transactionStartFlag:1,scanFlag:a.id,scanEveryIdleRuns:10,manualOrderImportFlag:0,paymentFlag:0,confirmReceiptFlag:0,auctionHistoryFlag:0,yahooLogin:{status:'ok'},captchaChallenge:a.id===2?{id:'email-B',type:'email',message:'需要邮箱验证码。'}:{id:`pin-${a.account_name}`,type:'pin',message:'需要 PIN 码'}}));
      const page=await browser.newPage({viewport:{width,height:900}});const errors=[];const writes=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(()=>{localStorage.setItem('token','browser-test-token');localStorage.setItem('role','admin');localStorage.setItem('username','test-admin');});
      await page.route('**/api/**',async route=>{
        const req=route.request();const url=new URL(req.url());const body=req.postDataJSON();let data={success:true,items:[],total:0};
        if(req.method()!=='GET') {
          writes.push({path:url.pathname,body,accountId:url.searchParams.get('account_id')});
          if(url.pathname==='/api/admin/accounts') {accountList.push({...body,id:4,online:false,binding_token:'new-test-binding'});data={success:true,id:4};}
          if(url.pathname==='/api/admin/manual-order-import/request') data={success:true,id:100};
          if(url.pathname==='/api/admin/manual-captcha/continue') flags.find(a=>a.account_id===Number(body.account_id || url.searchParams.get('account_id'))).captchaChallenge.answeredAt='test-time';
          if(url.pathname==='/api/admin/manual-captcha/close') flags.find(a=>a.account_id===body.account_id).captchaChallenge=null;
        } else if(url.pathname==='/api/admin/accounts') data={items:accountList,total:accountList.length};
        else if(url.pathname==='/api/admin/idle-flags') data={...flags[0],accounts:flags};
        else if(url.pathname==='/api/admin/tasks/stats') data={total:0,pending:0,processing:0,failed:0,success:0,yahooLogin:{status:'ok'}};
        else if(url.pathname==='/api/admin/manual-order-import/batches/100') data={batch:{id:100,account_id:2,status:'ready',candidate_count:0},items:[]};
        await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      });
      await page.goto(base+'/#/accounts');
      await page.getByRole('tab',{name:'Yahoo 执行账号'}).click();
      await page.getByRole('button',{name:'添加 Yahoo 账号',exact:true}).waitFor();
      const lights=page.locator('[data-yahoo-status-lights]');
      assert.equal(await lights.locator('[data-yahoo-status-id]').count(),3);
      assert.equal(await lights.innerText(),'','lights have no visible names or numbers');
      assert.equal(await lights.getByRole('button',{name:'展开其他账号状态'}).count(),0,'no expansion for up to four accounts');
      for(const id of [1,2,3]) assert.equal(await lights.locator(`[data-yahoo-status-id="${id}"]`).getAttribute('data-status'),'green');
      await page.getByRole('button',{name:'添加 Yahoo 账号',exact:true}).click();
      await page.locator('#account_name').fill('D');await page.locator('#yahoo_id').fill('yahoo-4');await page.locator('#profile_dir').fill('Profile 4');await page.locator('#email').fill('profile4@example.com');
      await page.getByRole('button',{name:'确 定',exact:true}).click();
      await page.getByText('账号已保存',{exact:true}).waitFor();
      assert.equal(writes.find(w=>w.path==='/api/admin/accounts').body.yahoo_id,'yahoo-4');
      const backup=page.locator('[data-yahoo-account="2"]');
      await backup.getByRole('button',{name:/继\s*续/}).click({timeout:8000}).catch(async e=>{console.error(await page.locator('body').innerText());await page.screenshot({path:'.test-artifacts/yahoo-ui-failure.png',fullPage:true});throw e;});
      assert.equal(writes.find(w=>w.path==='/api/admin/manual-captcha/continue').body.account_id,2);
      await backup.getByRole('button',{name:'关闭提醒',exact:true}).click();
      assert.equal(writes.find(w=>w.path==='/api/admin/manual-captcha/close').body.id,'email-B');
      assert.equal(flags[0].captchaChallenge.id,'pin-A');assert.equal(flags[2].captchaChallenge.id,'pin-C');
      await page.getByPlaceholder('输入 PIN 码',{exact:true}).fill('1234');
      await page.getByRole('button',{name:'提交 PIN',exact:true}).click();
      assert.equal(writes.find(w=>w.path==='/api/admin/manual-captcha/answer').accountId,'1','primary alert action retains its displayed account');
      await page.goto(base+'/#/orders');
      await page.getByRole('columnheader',{name:'成交 Yahoo',exact:true}).waitFor({state:width<600?'attached':'visible'});
      const toggle=page.getByRole('button',{name:'展开运行状态',exact:true});if(await toggle.count()) await toggle.click();
      assert.equal(await page.getByText('交易开始flag：1',{exact:true}).count(),3);
      await page.screenshot({path:path.join(output,`yahoo-accounts-${width}.png`),fullPage:true});
      assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth+1),true,'no page-wide horizontal overflow');
      await page.goto(base+'/#/manual-order-import');
      const select=page.locator('#account_id');await select.waitFor();await page.getByText('A / yahoo-1',{exact:true}).click();
      await page.getByText('B / yahoo-2',{exact:true}).last().click();
      await page.getByRole('button',{name:'读取落札商品',exact:true}).click();
      await page.getByText('已创建导入读取任务，插件会在扫描阶段优先执行',{exact:true}).waitFor();
      assert.equal(writes.find(w=>w.path==='/api/admin/manual-order-import/request').body.account_id,2);
      flags[0].account_name='本地主号';
      flags[1].account_name='备号1';flags[1].yahooLogin={status:'failed',message:'需要登录 Yahoo'};
      flags[2].account_name='备号2很长的账号名称用于检查布局';flags[2].online=false;
      await page.reload();
      await lights.locator('[data-yahoo-status-id="2"][data-status="red"]').waitFor();
      assert.equal(await lights.locator('[data-yahoo-status-id="1"]').getAttribute('data-status'),'green');
      assert.equal(await lights.locator('[data-yahoo-status-id="3"]').getAttribute('data-status'),'red','offline account cannot show a stale successful login');
      await lights.locator('[data-yahoo-status-id="3"]').click();
      await page.locator('.ant-popover-inner').getByText(`${flags[2].account_name}（yahoo-3）：插件离线`,{exact:true}).waitFor();
      await lights.locator('[data-yahoo-status-id="3"]').click();
      await page.screenshot({path:path.join(output,`yahoo-login-status-${width}.png`),fullPage:true});
      flags[1].yahooLogin={status:'unknown',message:''};
      await lights.getByRole('button',{name:'备号1（yahoo-2）：登录待确认',exact:true}).waitFor();
      assert.equal(await lights.locator('[data-yahoo-status-id="2"]').getAttribute('data-status'),'red','unknown login shows red');
      // Seven accounts: exactly four lights until the downward expansion is opened.
      for(const id of [4,5,6,7]) flags.push({...flags[0],account_id:id,account_name:`备号${id-1}`,yahoo_id:`yahoo-${id}`,is_primary:0,captchaChallenge:null,online:true,yahooLogin:{status:id===6?'failed':'ok'}});
      // Backup order comes from the API; primary still leads if the input moves it last.
      flags.push(flags.shift());
      await page.reload();
      const expand=lights.getByRole('button',{name:'展开其他账号状态',exact:true});await expand.waitFor();
      assert.equal(await lights.locator('[data-yahoo-status-id]').count(),4);
      assert.equal(await lights.locator('[data-yahoo-status-id]').first().getAttribute('data-yahoo-status-id'),'1');
      const firstPositions=await lights.locator('[data-yahoo-status-id]').evaluateAll(nodes=>nodes.map(el=>Math.round(el.getBoundingClientRect().top)));
      assert.equal(new Set(firstPositions).size,1,'four accounts share one row on mobile and desktop');
      await expand.click();
      assert.equal(await lights.locator('[data-yahoo-status-id]').count(),7);
      const extra=lights.locator('.yahoo-status-lights-extra');
      assert((await extra.boundingBox()).y>(await lights.locator('.yahoo-status-lights-row').boundingBox()).y,'additional lights expand downward');
      assert.equal(await extra.locator('[data-yahoo-status-id="6"]').getAttribute('data-status'),'red');
      assert.equal(await extra.locator('[data-yahoo-status-id="7"]').getAttribute('data-status'),'green');
      await page.screenshot({path:path.join(output,`yahoo-login-lights-expanded-${width}.png`),fullPage:true});
      await lights.getByRole('button',{name:'收起其他账号状态',exact:true}).click();
      assert.equal(await lights.locator('[data-yahoo-status-id]').count(),4);
      assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth+1),true,'account login states preserve narrow layout');
      assert.deepEqual(errors,[]);await page.close();
    }
    console.log('Admin multi-account browser tests passed at 360/390/1200px: four-column status lights, expansion, account lookup, verification, flags and import selection.');
  } finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
