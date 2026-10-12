const assert = require('assert/strict');
const express = require('express');
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const app = express(); app.use(express.static(path.resolve('src/admin/dist')));
  const server = await new Promise(resolve => { const s=app.listen(0,'127.0.0.1',()=>resolve(s)); });
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  try {
    for (const width of [390,1200]) {
      const page = await browser.newPage({viewport:{width,height:900}});
      page.setDefaultTimeout(15000);
      await page.addInitScript(()=>{localStorage.setItem('token','test');localStorage.setItem('role','admin');localStorage.setItem('username','admin');});
      let users = [
        {id:1,username:'with-data',role:'user',user_level:1},
        {id:2,username:'without-data',role:'user',user_level:2},
        {id:3,username:'protected-admin',role:'user',user_level:3}
      ];
      const deletes=[];
      await page.route('**/api/**',async route=>{
        const request=route.request();const url=new URL(request.url());
        let data={success:true,items:[],total:0};let status=200;
        if (url.pathname==='/api/admin/users'||url.pathname==='/api/admin/users/options') data={items:users,total:users.length};
        if(request.method()==='DELETE') {
          const id=Number(url.pathname.split('/').at(-1));const confirmed=url.searchParams.get('confirm')==='1';
          deletes.push({id,confirmed});
          if(id===1&&!confirmed){status=409;data={requiresConfirmation:true,taskCount:2,orderCount:1};}
          else users=users.filter(u=>u.id!==id);
        }
        await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/#/accounts`);
      await page.getByRole('tab',{name:'用户账号',exact:true}).click();
      const row=name=>page.getByRole('row').filter({hasText:name});
      await row('with-data').waitFor();
      assert.equal(await row('protected-admin').getByRole('button',{name:/删\s*除/}).isDisabled(),true);
      async function initialDelete(name) {
        await row(name).getByRole('button',{name:/删\s*除/}).click();
        await page.locator('.ant-popconfirm').getByRole('button',{name:/确\s*定/}).click();
      }
      await initialDelete('with-data');
      const dialog=page.getByRole('dialog');
      await dialog.locator('.ant-modal-confirm-title').waitFor();
      assert.equal(await dialog.locator('.ant-modal-confirm-title').innerText(),'该用户还有订单、任务未清空，需要一起删除吗？');
      await dialog.getByRole('button',{name:/取\s*消/}).click();
      assert.deepEqual(deletes,[{id:1,confirmed:false}]);
      assert.equal(users.some(u=>u.id===1),true);
      await initialDelete('with-data');
      await dialog.getByRole('button',{name:'一起删除'}).click();
      await row('with-data').waitFor({state:'detached'});
      assert.deepEqual(deletes.at(-1),{id:1,confirmed:true});
      await initialDelete('without-data');
      await row('without-data').waitFor({state:'detached'});
      assert.deepEqual(deletes.at(-1),{id:2,confirmed:false});
      assert.equal(await page.getByRole('dialog').count(),0);
      assert.deepEqual(users.map(u=>u.id),[3]);
      console.log(`${width}px: second confirmation only for tasks/orders, cancel is safe, direct deletion and admin protection passed`);
      await page.close();
    }
  } finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
