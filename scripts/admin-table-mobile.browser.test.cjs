const assert = require('assert/strict');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, '.test-artifacts');
  fs.mkdirSync(output, { recursive: true });
  const app = express();
  app.use(express.static(path.join(root, 'src/admin/dist')));
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const width of [360, 390, 1200]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(15000);
      await page.addInitScript(() => {
        localStorage.setItem('token', 'mock-table-test');
        localStorage.setItem('role', 'admin');
        localStorage.setItem('username', 'test-admin');
      });
      const row = {
        id: 1, username: '我想买您的东西呀很长的用户名', product_id: 't1247560114', execution_account_name: '主号',
        current_price: 8504, max_price: 10454, strategy: 'direct', status: 'failed',
        error_msg: 'Rebid required: current bid is not high enough',
        created_at: '2026-10-12T13:08:00+08:00', next_execute_at: '2026-10-12T13:43:00+08:00',
        end_time: '2026-10-12T14:04:00+08:00', won_at: '2026-10-12T13:08:00+08:00',
        product_type: 'normal', shipping_fee_text: '落札者负担', final_price: 10454, order_status: 'waiting_shipping'
      };
      await page.route('**/api/**', async route => {
        const p = new URL(route.request().url()).pathname;
        let data = { success: true, items: [], total: 0 };
        if (p === '/api/admin/tasks' || p === '/api/admin/orders') data = { items: [row], total: 1 };
        if (p === '/api/admin/orders') data = { items: [row, {...row,id:2,product_id:'z705858626',product_url:'https://auctions.yahoo.co.jp/jp/auction/z705858626',product_type:'fleamarket',order_status:'pending_shipment'}, {...row,id:3,product_id:'s1247071818',product_type:'store'}], total: 3 };
        if (p === '/api/admin/idle-flags') data = {googleSheetAlerts:[
          {id:'p-google',productId:'z705858626',product_type:'fleamarket',error:'test P append alert'},
          {id:'ordinary-google',productId:'r1243992660',product_type:'normal',error:'test ordinary append alert'}]};
        if (p === '/api/admin/tasks/stats') data = { total: 1, pending: 1, processing: 0, failed: 1, success: 0 };
        if (p === '/api/admin/tasks/queue') data = {items:[{...row,queue_key:'task-1',status:'preparation_pending'}],total:1};
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      });
      for (const name of ['tasks', 'orders']) {
        await page.goto(`http://127.0.0.1:${server.address().port}/#/${name}`);
        const table = page.locator(`.admin-${name}-table`);
        await table.getByText(row.product_id, { exact: true }).waitFor();
        const pAlert=page.locator('.ant-alert').filter({hasText:'test P append alert'});
        await pAlert.waitFor();
        assert.equal(await pAlert.getByRole('link',{name:'z705858626',exact:true}).getAttribute('href'),'https://paypayfleamarket.yahoo.co.jp/item/z705858626');
        const ordinaryAlert=page.locator('.ant-alert').filter({hasText:'test ordinary append alert'});
        assert.equal(await ordinaryAlert.getByRole('link',{name:'r1243992660',exact:true}).getAttribute('href'),'https://auctions.yahoo.co.jp/jp/auction/r1243992660');

        if (name === 'orders') {
          assert.equal(await table.getByRole('link',{name:'z705858626',exact:true}).getAttribute('href'),'https://paypayfleamarket.yahoo.co.jp/item/z705858626');
          for (const [id,tag,color] of [[1,'普','green'],[2,'P','purple'],[3,'商','red']]) {
            const productCell=table.locator(`tbody tr[data-row-key="${id}"] td`).nth(3);
            assert.equal(await productCell.locator(`.ant-tag-${color}`).textContent(),tag,'product ID has the corresponding type tag');
          }
        }
        const yh = await table.getByRole('columnheader', { name: 'YH', exact: true }).boundingBox();
        assert(Math.abs(yh.width - 64) < 1, `${name}: YH must be 64px, got ${yh.width}`);
        const headers = await table.locator('thead th').evaluateAll(nodes => nodes.map(el => ({
          height: el.getBoundingClientRect().height, wrap: getComputedStyle(el).whiteSpace
        })));
        assert(headers.every(h => h.wrap === 'nowrap' && h.height < 65), `${name}: single-line headers`);
        const cells = await table.locator('tbody tr[data-row-key="1"] td').evaluateAll(nodes => nodes.map(el => ({
          height: el.getBoundingClientRect().height, wrap: getComputedStyle(el).whiteSpace
        })));
        assert(cells.every(c => c.height < 65), `${name}: rows must not become vertical text`);
        if (name === 'tasks') {
          assert(cells.every(c => c.wrap === 'nowrap'));
          async function checkColumns(target) {
            const dataRow = target.locator('tbody tr').filter({hasText:row.username});
            const usernameCell = dataRow.locator('td').nth(1);
            const clipped = await usernameCell.evaluate(el => ({
              overflow:getComputedStyle(el).textOverflow, hidden:getComputedStyle(el).overflow,
              client:el.clientWidth,scroll:el.scrollWidth
            }));
            assert.equal(clipped.overflow,'ellipsis');assert.equal(clipped.hidden,'hidden');
            assert(clipped.scroll>clipped.client,'Long username must be clipped rather than cover product ID');
            const statusCell = dataRow.locator('td').nth(6);
            const bounds = await statusCell.evaluate(el => ({
              right:el.getBoundingClientRect().right-parseFloat(getComputedStyle(el).paddingRight),
              tagRight:el.querySelector('.ant-tag').getBoundingClientRect().right
            }));
            assert(bounds.tagRight<=bounds.right+1,'Status label must fit without touching the timestamp');
          }
          await checkColumns(table);
          await page.getByRole('button',{name:'展开队列详情',exact:true}).click();
          const queue = page.locator('#task-queue-details .admin-tasks-table');
          await queue.getByText(row.product_id,{exact:true}).waitFor();
          await checkColumns(queue);
          await page.screenshot({path:path.join(output,`admin-queue-ellipsis-${width}.png`),fullPage:true});
          await page.getByRole('button',{name:'收起队列详情',exact:true}).click();
          await queue.waitFor({state:'detached'});
        }
        const scroller = table.locator('.ant-table-content');
        const scroll = await scroller.evaluate(el => {
          el.scrollLeft = el.scrollWidth;
          return { left: el.scrollLeft, width: el.clientWidth, content: el.scrollWidth };
        });
        if (width < 768) {
          assert(scroll.content > scroll.width && scroll.left > 0, `${name}: horizontal scrolling required`);
          const links = await page.locator('.admin-bottom-nav-link').evaluateAll(nodes => nodes.map(el => ({
            y: el.getBoundingClientRect().y, wrap: getComputedStyle(el).whiteSpace
          })));
          assert(links.length && links.every(l => l.wrap === 'nowrap' && l.y === links[0].y));
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Only table/menu should scroll');
        }
        await scroller.evaluate(el => { el.scrollLeft = 0; });
        await page.screenshot({ path: path.join(output, `admin-${name}-single-line-${width}.png`), fullPage: true });
        console.log(`${width}px ${name}: single-line headers/rows and horizontal scroll verified; tasks also check long username and full status in both tables`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
