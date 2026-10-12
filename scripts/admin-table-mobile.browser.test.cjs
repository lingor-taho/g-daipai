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
        id: 1, username: '小陈', product_id: 't1247560114', execution_account_name: '主号',
        current_price: 8504, max_price: 10454, strategy: 'direct', status: 'bidding',
        created_at: '2026-10-12T13:08:00+08:00', next_execute_at: '2026-10-12T13:43:00+08:00',
        end_time: '2026-10-12T14:04:00+08:00', won_at: '2026-10-12T13:08:00+08:00',
        shipping_fee_text: '落札者负担', final_price: 10454, order_status: 'waiting_shipping'
      };
      await page.route('**/api/**', async route => {
        const p = new URL(route.request().url()).pathname;
        let data = { success: true, items: [], total: 0 };
        if (p === '/api/admin/tasks' || p === '/api/admin/orders') data = { items: [row], total: 1 };
        if (p === '/api/admin/tasks/stats') data = { total: 1, pending: 0, processing: 0, failed: 0, success: 0 };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      });
      for (const name of ['tasks', 'orders']) {
        await page.goto(`http://127.0.0.1:${server.address().port}/#/${name}`);
        const table = page.locator(`.admin-${name}-table`);
        await table.getByText(row.product_id, { exact: true }).waitFor();
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
        if (name === 'tasks') assert(cells.every(c => c.wrap === 'nowrap'));
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
        console.log(`${width}px ${name}: 64px YH, single-line headers/rows, horizontal scroll verified`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
