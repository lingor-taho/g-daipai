const assert = require('assert/strict');
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const { chromium } = require('playwright');

// Always invoke via run-isolated-regression.cjs; never create users in the live DB.
if (process.env.GDAIPAI_ISOLATED_TESTS !== '1') throw new Error('Run this test with scripts/run-isolated-regression.cjs');
const db = require('../src/server/models');
const accounts = require('../src/server/services/yahooAccounts');
const app = express();
app.use(express.json());
app.use('/api/auth', require('../src/server/routes/auth'));
app.use('/api/task', require('../src/server/routes/task'));
app.use('/api/plugin', require('../src/server/routes/plugin'));
const dist = path.resolve(__dirname, '../src/client/dist');
app.use(express.static(dist));
app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));

(async () => {
  const username = '饿了就吃红烧排骨这是一个用于手机布局验证的超长用户名';
  const password = 'isolated-test-password';
  db.raw.prepare('INSERT INTO users(id,username,password_hash,role,user_level) VALUES(9101,?,?,?,1)')
    .run(username, bcrypt.hashSync(password, 10), 'user');
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  async function request(endpoint, headers = {}, expected = 200, options = {}) {
    const response = await fetch(base + endpoint, { headers, ...options, signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    assert.equal(response.status, expected, `${endpoint}: ${JSON.stringify(data)}`);
    return data;
  }
  try {
    const login = await request('/api/auth/login', { 'Content-Type': 'application/json' }, 200, {
      method: 'POST', body: JSON.stringify({ username, password })
    });
    const userHeaders = { Authorization: `Bearer ${login.token}` };
    await request('/api/task/bid-config', {}, 401);
    await request('/api/task/bid-config', { Authorization: 'Bearer invalid-user-token' }, 401);
    const defaults = await request('/api/task/bid-config', userHeaders);
    assert.deepEqual(defaults, { multiBidStartHours: 0.5, multiBidIntervalMinutes: 5, multiBidMinPrice: 5000 });
    // User tokens must not bypass the plugin's account identity or acquire work.
    await request('/api/plugin/config', userHeaders, 401);
    await request('/api/plugin/tasks?limit=1', userHeaders, 401);
    const main = accounts.list(db, Date.now(), true)[0];
    const pluginHeaders = { 'X-Yahoo-Account': String(main.id), 'X-Yahoo-Token': main.binding_token, 'X-Yahoo-Instance': 'login-regression-plugin-0001' };
    const set = db.raw.prepare('INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    for (const [key, value] of [['multi_bid_start_hours', '0.75'], ['multi_bid_interval_minutes', '7'], ['multi_bid_min_price', '6800']]) set.run(key, value);
    const clientConfig = await request('/api/task/bid-config', userHeaders);
    const pluginConfig = await request('/api/plugin/config', pluginHeaders);
    assert.deepEqual(clientConfig, { multiBidStartHours: 0.75, multiBidIntervalMinutes: 7, multiBidMinPrice: 6800 });
    for (const key of Object.keys(clientConfig)) assert.equal(clientConfig[key], pluginConfig[key], 'client and plugin use the same shared values');
    set.run('multi_bid_min_price', '7100');
    assert.equal((await request('/api/task/bid-config', userHeaders)).multiBidMinPrice, 7100, 'config changes are read without stale defaults');

    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    for (const width of [360, 390, 1200]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [], unauthorized = [], pluginRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.status() === 401) unauthorized.push(new URL(response.url()).pathname); });
      page.on('request', req => { if (new URL(req.url()).pathname.startsWith('/api/plugin/')) pluginRequests.push(req.url()); });
      // Exchange-rate network access is unrelated to this login test.
      await page.route('**/api/task/website-rate', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, rate: 0.05 }) }));
      await page.goto(base + '/login');
      assert.equal(await page.getByPlaceholder('用户名', { exact: true }).getAttribute('autocomplete'), 'username');
      assert.equal(await page.getByPlaceholder('密码', { exact: true }).getAttribute('autocomplete'), 'current-password');
      await page.getByPlaceholder('用户名', { exact: true }).fill(username);
      await page.getByPlaceholder('密码', { exact: true }).fill(password);
      const loadedConfig = page.waitForResponse(response => new URL(response.url()).pathname === '/api/task/bid-config');
      await page.getByRole('button', { name: '登录', exact: true }).click();
      const configResponse = await loadedConfig;
      assert.equal(configResponse.status(), 200);
      assert.deepEqual(await configResponse.json(), { multiBidStartHours: 0.75, multiBidIntervalMinutes: 7, multiBidMinPrice: 7100 });
      await page.waitForURL(base + '/submit');
      await page.getByRole('button', { name: '退出', exact: true }).waitFor();
      const header = await page.getByRole('button', { name: '退出', exact: true }).evaluate(button => {
        const row = button.parentElement.parentElement;
        const name = row.querySelector('[title]');
        const select = row.querySelector('select');
        const box = node => { const rect = node.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; };
        return { name: box(name), button: box(button), select: box(select),
          ellipsis: getComputedStyle(name).textOverflow, truncated: name.scrollWidth > name.clientWidth,
          overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(header.ellipsis, 'ellipsis');
      if (width < 400) assert.equal(header.truncated, true);
      assert(header.name.top < header.button.bottom && header.name.bottom > header.button.top);
      assert(header.select.top < header.button.bottom && header.select.bottom > header.button.top);
      assert.equal(header.overflow, false);
      // Include a subsequent poll and a page refresh, not only the first navigation.
      await page.waitForResponse(response => new URL(response.url()).pathname === '/api/task/batch-results' && response.status() === 200);
      assert.equal(new URL(page.url()).pathname, '/submit');
      assert(await page.evaluate(() => Boolean(localStorage.getItem('token'))));
      const refreshedConfig = page.waitForResponse(response => new URL(response.url()).pathname === '/api/task/bid-config');
      await page.reload();
      assert.equal((await refreshedConfig).status(), 200);
      await page.getByRole('button', { name: '退出', exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, '/submit');
      assert.deepEqual(pluginRequests, [], 'the user page never calls bound plugin APIs');
      assert.deepEqual(unauthorized, [], 'successful login and refresh do not clear the token');
      assert.deepEqual(errors, []);

      // Preserve browser storage across closing/reopening, including a saved /login URL.
      const savedState = await page.context().storageState();
      await page.close();
      const reopenedContext = await browser.newContext({ storageState: savedState, viewport: { width, height: 900 } });
      const reopened = await reopenedContext.newPage();
      await reopened.route('**/api/task/website-rate', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, rate: 0.05 }) }));
      await reopened.goto(base + '/login');
      await reopened.waitForURL(base + '/submit');
      await reopened.getByRole('button', { name: '退出', exact: true }).click();
      await reopened.waitForURL(base + '/login');
      assert.equal(await reopened.evaluate(() => localStorage.getItem('token')), null);
      await reopened.reload();
      await reopened.getByPlaceholder('密码', { exact: true }).waitFor();
      // Expired/rejected sessions must return to login without a redirect loop.
      await reopened.evaluate(() => localStorage.setItem('token', 'expired-test-token'));
      await reopened.reload();
      await reopened.getByPlaceholder('密码', { exact: true }).waitFor();
      assert.equal(new URL(reopened.url()).pathname, '/login');
      assert.equal(await reopened.evaluate(() => localStorage.getItem('token')), null);
      assert.equal(await reopened.getByPlaceholder('密码', { exact: true }).inputValue(), '');
      assert.equal(await reopened.evaluate(() => Object.keys(localStorage).some(key => /password/i.test(key))), false);
      await reopenedContext.close();
    }
    console.log('Client login tests passed: real auth, config/plugin isolation, long username layout, remembered login after reopen, logout and rejected sessions at 360/390/1200px.');
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.raw.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
