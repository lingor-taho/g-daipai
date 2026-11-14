const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

if (!process.env.DATABASE_URL?.includes('gdaipai-regression-')) {
  throw new Error('Run with scripts/run-isolated-regression.cjs');
}

const config = require('../../config');
const db = require('../models');
const taskRouter = require('./task');
const authRouter = require('./auth');

const token = (id, level) => jwt.sign({ id, role: 'user', user_level: level }, config.jwtSecret, { expiresIn: '1h' });

async function checkBrowser(baseUrl) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const [id, level, orderId, productId, width] of [[1, 1, 4, 'z123456789', 390], [3, 3, 5, 'a123456789', 1200]]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      await page.addInitScript(({ auth, level }) => {
        localStorage.setItem('token', auth);
        localStorage.setItem('role', 'user');
        localStorage.setItem('userLevel', String(level));
        localStorage.setItem('actingUserId', '1');
        localStorage.setItem('username', 'owner');
      }, { auth: token(id, level), level });
      await page.goto(`${baseUrl}/won`);
      const row = page.locator('.adm-list-item').filter({ hasText: productId });
      const deleteButton = row.getByRole('button', { name: '订单删除', exact: true });
      await deleteButton.waitFor();
      const pending = page.locator('.adm-list-item').filter({ hasText: 'b123456789' });
      assert.equal(await pending.getByRole('button', { name: '订单删除', exact: true }).isDisabled(), true);
      assert.equal(await deleteButton.isEnabled(), true);
      await deleteButton.click();
      await page.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(db.raw.prepare('SELECT user_deleted_at FROM orders WHERE id = ?').get(orderId).user_deleted_at, null);
      await deleteButton.click();
      await page.getByRole('button', { name: '删除', exact: true }).click();
      if (level === 3) {
        const marker = row.getByText('用户已删除', { exact: true });
        await marker.waitFor();
        assert.equal(await marker.evaluate(node => node.previousElementSibling.textContent), '完了');
        assert.equal(await row.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(229, 231, 235)');
        assert.equal(await deleteButton.count(), 0);
      } else {
        await row.waitFor({ state: 'detached' });
        await page.reload();
        await pending.waitFor();
        assert.equal(await row.count(), 0);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

async function run() {
  const raw = db.raw;
  raw.exec(`INSERT INTO users(id, username, password_hash, role, user_level, parent_user_id) VALUES
    (2, 'agent', 'x', 'user', 2, NULL), (1, 'owner', 'x', 'user', 1, 2),
    (3, 'admin', 'x', 'user', 3, NULL), (4, 'unrelated', 'x', 'user', 1, NULL);
    INSERT INTO tasks(id, user_id, product_id, max_price, status) VALUES
    (1, 1, 'c123456789', 1000, 'success'), (2, 1, 'b123456789', 2000, 'success'),
    (3, 4, 'c987654321', 3000, 'success'), (4, 1, 'z123456789', 4000, 'success'),
    (5, 1, 'a123456789', 5000, 'success'), (6, 1, 'e123456789', 6000, 'success');
    UPDATE tasks SET updated_at = datetime('now', '-6 days') WHERE id = 6;
    INSERT INTO orders(id, task_id, product_id, order_status, final_price, won_at) VALUES
    (1, 1, 'c123456789', 'completed', 1000, datetime('now', '-1 day')),
    (2, 2, 'b123456789', 'pending_receipt', 2000, datetime('now', '-2 days')),
    (3, 3, 'c987654321', 'completed', 3000, datetime('now', '-3 days')),
    (4, 4, 'z123456789', 'completed', 4000, datetime('now', '-4 days')),
    (5, 5, 'a123456789', 'completed', 5000, datetime('now', '-5 days'));`);

  const app = express();
  app.use('/api/task', taskRouter);
  app.use('/api/auth', authRouter);
  const dist = path.resolve('src/client/dist');
  app.use(express.static(dist));
  app.get('/won', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (id, level, selected, suffix = '', method = 'GET') => fetch(`${base}/api/task/won${suffix}`, {
    method, headers: { Authorization: `Bearer ${token(id, level)}`, 'X-Acting-User-Id': String(selected) }
  });
  try {
    const statsBefore = await (await request(1, 1, 1, '-stats')).json();
    assert.equal(statsBefore.data.items.length, 4);
    assert.equal((await request(2, 2, 4, '/3', 'DELETE')).status, 403);
    assert.equal((await request(4, 1, 1, '/1', 'DELETE')).status, 403);
    assert.equal((await request(3, 3, 1, '/3', 'DELETE')).status, 404);
    assert.equal((await request(1, 1, 1, '/2', 'DELETE')).status, 404);
    assert.equal((await request(2, 2, 1, '/1', 'DELETE')).status, 200);
    const stored = raw.prepare('SELECT * FROM orders WHERE id = 1').get();
    assert.ok(stored.user_deleted_at);
    assert.equal(stored.order_status, 'completed');
    assert.equal((await request(1, 1, 1, '/1', 'DELETE')).status, 200);
    assert.deepEqual(raw.prepare('SELECT * FROM orders WHERE id = 1').get(), stored);

    for (const [id, level] of [[1, 1], [2, 2], [3, 3]]) {
      const response = await request(id, level, 1, '?search=c123456789');
      assert.equal(response.status, 200);
      const { data, total } = await response.json();
      assert.equal(data.length, level === 3 ? 1 : 0);
      assert.equal(total, data.length);
      if (level === 3) assert.equal(data[0].user_deleted_at, stored.user_deleted_at);
      // The database login level controls visibility, even if the token has an old level.
      const firstPage = await (await request(id, 3, 1, '?page=1&limit=1')).json();
      assert.equal(firstPage.total, level === 3 ? 5 : 4);
      assert.equal(firstPage.data[0].order_id, level === 3 ? 1 : 2);
    }
    assert.deepEqual(await (await request(2, 2, 1, '-stats')).json(), statsBefore);
    if (process.argv.includes('--browser')) await checkBrowser(base);
    console.log('Completed order delete, role visibility, pagination, and unchanged statistics passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    raw.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
