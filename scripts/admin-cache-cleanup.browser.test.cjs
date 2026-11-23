const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const app = express();
  app.use(express.static(path.resolve('src/admin/dist')));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      await page.addInitScript(() => {
        localStorage.setItem('token', 'mock-cleanup-test');
        localStorage.setItem('role', 'admin');
      });
      const writes = [];
      let settings = { enabled: false, cleanupHour: 3, retentionDays: 1 };
      let logs = [{ id: 1, run_type: 'manual', retention_days: 30, task_count: 7, created_at: '2026-11-20T01:00:00Z' }];
      await page.route('**/api/**', async route => {
        const req = route.request();
        const name = new URL(req.url()).pathname.replace('/api/admin/data-cleanup/', '');
        let json = { success: true };
        if (!name.startsWith('/') && req.method() !== 'GET') writes.push([name, req.method(), req.postDataJSON()]);
        if (name === 'config') json = { enabled: false, cleanupHour: 3, retentionDays: 30 };
        if (name === 'cache/config') {
          if (req.method() === 'PUT') settings = req.postDataJSON();
          json = settings;
        }
        if (name === 'cache/run') {
          logs = [{
            id: 2, run_type: 'manual', cleanup_scope: 'cache', cache_count: 4,
            retention_days: req.postDataJSON().retentionDays, created_at: '2026-11-23T01:00:00Z'
          }, ...logs];
          json = { totalCount: 4 };
        }
        if (name === 'logs') {
          if (req.method() === 'DELETE') logs = [];
          json = { items: logs, total: logs.length };
        }
        await route.fulfill({ json });
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/#/data-cleanup`);
      const card = title => page.locator('.ant-card').filter({ has: page.getByText(title, { exact: true }) });
      const dataCard = card('清理数据');
      const cacheCard = card('清理缓存');
      const retention = cacheCard.getByRole('spinbutton', { name: '清理多少天以前的缓存' });
      await retention.waitFor();
      assert.equal(await retention.inputValue(), '1');
      assert.equal(await dataCard.getByRole('spinbutton', { name: '清理多少天以前的数据' }).inputValue(), '30');
      const [dataBox, cacheBox] = await Promise.all([dataCard.boundingBox(), cacheCard.boundingBox()]);
      if (width === 390) assert.ok(cacheBox.y >= dataBox.y + dataBox.height);
      else assert.ok(cacheBox.x > dataBox.x && cacheBox.y === dataBox.y);
      await cacheCard.getByRole('switch', { name: '自动清理' }).click();
      await cacheCard.getByRole('spinbutton', { name: '每天执行时间' }).fill('6');
      await retention.fill('2');
      await Promise.all([
        page.waitForResponse(res => res.url().endsWith('/cache/config') && res.request().method() === 'PUT'),
        cacheCard.getByRole('button', { name: '保存配置' }).click()
      ]);
      await cacheCard.getByRole('button', { name: '手动执行' }).click();
      const table = page.getByRole('table');
      await table.getByRole('cell', { name: '缓存', exact: true }).waitFor();
      assert.equal(await table.getByRole('cell', { name: '数据', exact: true }).count(), 1);
      const clear = card('清理日志').getByRole('button', { name: /^清\s*空$/ });
      await clear.click();
      await page.getByRole('dialog').getByRole('button', { name: /^取\s*消$/ }).click();
      assert.equal(writes.some(([, method]) => method === 'DELETE'), false);
      await clear.click();
      await page.getByRole('dialog').getByRole('button', { name: /^清\s*空$/ }).click();
      await table.getByRole('cell', { name: '缓存', exact: true }).waitFor({ state: 'hidden' });
      assert.equal(await table.getByRole('cell', { name: '数据', exact: true }).count(), 0);
      assert.equal(await clear.isDisabled(), true);
      assert.deepEqual(writes, [
        ['cache/config', 'PUT', { enabled: true, cleanupHour: 6, retentionDays: 2 }],
        ['cache/run', 'POST', { retentionDays: 2 }],
        ['logs', 'DELETE', null]
      ]);
      console.log(`${width}px: separate cleanup cards, cache-only actions, shared logs and confirmed clear passed`);
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
