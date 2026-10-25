const assert = require('assert/strict');
const { loadBackgroundForTest } = require('./background.test');

const loginUrl = 'https://login.yahoo.co.jp/config/login?src=auc';
function fixture(options = {}) {
  let phase = options.phase || 'entry';
  let now = 100000;
  let round = 0;
  let challenge;
  const clicks = [];
  const reports = [];
  const storage = options.storage || {};
  const reloads = [];
  class Clock extends Date { static now() { return now; } }
  const tab = () => ({ id: 7, status: 'complete', active: true,
    url: phase === 'captcha' ? 'https://login.yahoo.co.jp/ncaptcha?fido=1' : phase === 'done' ? 'https://auctions.yahoo.co.jp/' : loginUrl });
  const api = loadBackgroundForTest({ disableAutoStart: true, Date: Clock,
    setTimeout(fn, ms) { if (!String(fn).includes('reject(')) { now += ms; queueMicrotask(fn); } return 1; },
    sessionStorage: {
      async get() { return structuredClone(storage); },
      async set(values) { Object.assign(storage, structuredClone(values)); },
      async remove(key) { delete storage[key]; }
    },
    tabs: { async get() { return tab(); }, async query() { return [tab()]; },
      async update() { return tab(); }, async reload(id) { reloads.push(id); },
      async create() { throw new Error('must reuse the Yahoo verification tab'); } },
    scripting: { async executeScript(payload) {
      const source = String(payload.func || '');
      if (source.includes('loginAction')) {
        if (!['entry', 'methods'].includes(phase)) return [{ result: null }];
        const stage = phase;
        const action = payload.args[0];
        if (!action) return [{ result: { stage } }];
        if (options.missingButton) return [{ result: { stage, clicked: false } }];
        clicks.push(action);
        if (action === 'entry') { phase = 'methods'; round += 1; }
        if (action === 'methods' && !options.timeout) phase = 'captcha';
        return [{ result: { stage, clicked: true } }];
      }
      if (source.includes('const codeInput')) return [{ result: null }];
      if (source.includes('captchaAnswer')) {
        assert.equal(payload.args[0], 'んすをらあすえ');
        phase = (options.afterCaptcha || ['pin'])[round - 1] || 'pin';
        return [{ result: { success: true } }];
      }
      return [{ result: null }];
    } },
    fetch: async (url, request = {}) => {
      if (String(url).includes('/challenge')) { challenge = JSON.parse(request.body); reports.push(challenge); }
      if (String(url).includes('/current')) return { async json() { return challenge ? { found: true, ...challenge } : { found: false }; } };
      if (String(url).includes('/manual-pin/type')) {
        assert.equal(phase, 'pin');
        assert.equal(JSON.parse(request.body).pin, '123456');
        phase = 'done';
      }
      return { async json() { return { success: true, answered: true, answer: challenge?.type === 'captcha' ? 'んすをらあすえ' : '123456' }; } };
    }
  });
  return { api, tab, clicks, reports, storage, reloads };
}

async function testContinuousFlow() {
  for (const afterCaptcha of [['pin'], ['entry', 'pin']]) {
    const f = fixture({ afterCaptcha });
    const result = await f.api.handleManualVerificationIfPresent(f.tab());
    assert.equal(result.tab.url, 'https://auctions.yahoo.co.jp/');
    assert.deepEqual(f.clicks, afterCaptcha.flatMap(() => ['entry', 'methods']));
    assert.equal(f.reports.filter(c => c.type === 'captcha').length, afterCaptcha.length);
    assert.equal(f.reports.filter(c => c.type === 'pin').length, 1);
    assert.deepEqual(f.reloads, [7], 'only the original PIN refresh is allowed');
    assert.equal(f.storage.manualAlternativeLoginSession, undefined);
  }
}

async function testThirdVisitAndFailuresStop() {
  const f = fixture({ afterCaptcha: ['entry', 'entry'] });
  await assert.rejects(f.api.handleManualVerificationIfPresent(f.tab()), /登录方式跳第三次验证，请人工处理！/);
  assert.deepEqual(f.clicks, ['entry', 'methods', 'entry', 'methods']);
  assert.equal(f.reports.at(-1).type, 'login');
  assert.equal(f.reports.at(-1).phase, 'error');
  assert.deepEqual(f.reloads, []);
  const restart = fixture({ storage: f.storage });
  await assert.rejects(restart.api.handleManualVerificationIfPresent(restart.tab()), /登录方式跳第三次验证/);
  assert.deepEqual(restart.clicks, []);
  const savedCount = fixture({ storage: { manualAlternativeLoginSession: { tabId: 7, attempts: 2 } } });
  await assert.rejects(savedCount.api.handleManualVerificationIfPresent(savedCount.tab()), /登录方式跳第三次验证/);
  assert.deepEqual(savedCount.clicks, []);
  for (const options of [{ missingButton: true }, { timeout: true }]) {
    const failed = fixture(options);
    await assert.rejects(failed.api.handleManualVerificationIfPresent(failed.tab()), /不可用|30秒未进入/);
    assert.equal(failed.reports.at(-1).phase, 'error');
    assert.deepEqual(failed.reloads, []);
  }
}

async function testActualPageScript() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    const api = loadBackgroundForTest({ disableAutoStart: true,
      scripting: { async executeScript(payload) {
        return [{ result: await page.evaluate(({ source, args }) => (0, eval)(`(${source})`)(...args),
          { source: String(payload.func), args: payload.args || [] }) }];
      } }
    });
    const html = `<button onclick="window.sms=(window.sms||0)+1">確認コードを送信</button>
      <a href="#" onclick="document.querySelector('[role=dialog]').hidden=false;return false">他の方法でログイン</a>
      <div role="dialog" hidden><h2>他の方法でログイン</h2>
      <button onclick="window.passkey=(window.passkey||0)+1">パスキー</button>
      <button onclick="window.sms=(window.sms||0)+1">確認コード（SMS）</button></div>`;
    await page.setContent(html);
    const tab = { id: 7, url: loginUrl };
    assert.equal((await api.getManualAlternativeLoginState(tab)).stage, 'entry');
    assert.equal((await api.getManualAlternativeLoginState(tab, 'entry')).clicked, true);
    assert.equal((await api.getManualAlternativeLoginState(tab)).stage, 'methods');
    assert.equal((await api.getManualAlternativeLoginState(tab, 'methods')).clicked, true);
    assert.equal((await api.getManualAlternativeLoginState(tab, 'methods')).clicked, false, 'single click per control');
    assert.deepEqual(await page.evaluate(() => [window.sms || 0, window.passkey]), [0, 1]);
    await page.setContent(html);
    await api.getManualAlternativeLoginState(tab, 'entry');
    await page.getByRole('button', { name: 'パスキー', exact: true }).evaluate(el => { el.disabled = true; });
    assert.equal((await api.getManualAlternativeLoginState(tab, 'methods')).clicked, false, 'disabled passkey must not click the link behind the modal');
    assert.equal(await page.evaluate(() => window.sms || 0), 0);
    await page.setContent(html + '<input placeholder="確認コード">');
    assert.equal(await api.getManualAlternativeLoginState(tab), null, 'email/code entry remains with original flow');
    await page.setContent('<div>他の方法でログイン パスキー 確認コード（SMS）</div>');
    assert.equal(await api.getManualAlternativeLoginState(tab), null, 'text alone cannot authorize a click');
    assert.equal(await api.getManualAlternativeLoginState({ id: 7, url: 'https://example.com/' }), null);
  } finally { await browser.close(); }
}

async function testSingleTabLockAndOwnedChildCleanup() {
  let now = 100000;
  let stage = 'entry';
  const tabs = new Map([
    [7, { id: 7, url: loginUrl, status: 'complete', active: true }],
    [8, { id: 8, url: loginUrl, status: 'complete' }],
    [13, { id: 13, url: 'https://login.yahoo.co.jp/ncaptcha?old=1', status: 'complete' }],
    [42, { id: 42, url: 'https://example.com/', status: 'complete' }]
  ]);
  const removed = [];
  const clicks = [];
  const stored = {};
  class Clock extends Date { static now() { return now; } }
  const api = loadBackgroundForTest({ disableAutoStart: true, Date: Clock,
    setTimeout(fn, ms) { if (!String(fn).includes('reject(')) { now += ms; queueMicrotask(fn); } return 1; },
    sessionStorage: { async get() { return stored; }, async set(values) { Object.assign(stored, structuredClone(values)); }, async remove() {} },
    tabs: {
      async get(id) { if (!tabs.has(id)) throw new Error('tab closed'); return tabs.get(id); },
      async query() { return [...tabs.values()]; }, async update(id) { return tabs.get(id); },
      async remove(id) { removed.push(id); tabs.delete(id); },
      async create() { throw new Error('must never create another login tab'); },
      async reload() { throw new Error('must never refresh the prerequisite'); }
    },
    scripting: { async executeScript(payload) {
      if (!String(payload.func).includes('loginAction') || payload.target.tabId !== 7) return [{ result: null }];
      const action = payload.args[0];
      if (!action) return [{ result: { stage } }];
      clicks.push(action);
      if (action === 'entry') stage = 'methods';
      if (action === 'methods') {
        tabs.set(91, { id: 91, openerTabId: 7, url: 'https://login.yahoo.co.jp/ncaptcha?new=1', status: 'complete' });
        tabs.set(92, { id: 92, openerTabId: 7, url: 'https://login.yahoo.co.jp/ncaptcha?duplicate=1', status: 'complete' });
        tabs.set(93, { id: 93, openerTabId: 7, url: loginUrl, status: 'complete' });
      }
      return [{ result: { stage: action, clicked: true } }];
    } },
    fetch: async () => ({ async json() { return { success: true }; } })
  });
  const first = api.handleManualAlternativeLogin(tabs.get(7));
  const concurrent = api.handleManualAlternativeLogin(tabs.get(7));
  const [result, second] = await Promise.all([first, concurrent]);
  assert.equal(result.id, 91);
  assert.equal(second.id, 91);
  assert.deepEqual(clicks, ['entry', 'methods'], 'concurrent handling shares the original flow');
  assert.deepEqual(removed.sort((a, b) => a - b), [7, 8, 92, 93]);
  assert.deepEqual([...tabs.keys()], [13, 42, 91], 'keep the locked child and leave unrelated old tabs alone');
  assert.equal(stored.manualAlternativeLoginSession.tabId, 91);
  assert.equal(stored.manualAlternativeLoginSession.attempts, 1, 'handoff does not reset the login limit');
}

async function testCaptchaPinTransitionOnlyAdoptsOwnedNewTab() {
  for (const preferPin of [true, false]) {
    const original = { id: 7, url: preferPin ? 'https://login.yahoo.co.jp/ncaptcha?current=1' : loginUrl, status: 'complete', active: true };
    const old = { id: 13, url: preferPin ? loginUrl : 'https://login.yahoo.co.jp/ncaptcha?old=1', status: 'complete', active: true };
    const child = { id: 91, openerTabId: 7, url: preferPin ? loginUrl : 'https://login.yahoo.co.jp/ncaptcha?new=1', status: 'complete' };
    const api = loadBackgroundForTest({ disableAutoStart: true,
      tabs: { async get() { return original; }, async query() { return [original, old, child]; } }
    });
    const result = await api.findManualVerificationTransitionTab(original, new Set([7, 13]), {
      preferPin, preferCaptcha: !preferPin, singleAlternativeTab: true
    });
    assert.equal(result.id, 91, 'do not stick to the old page or adopt an unrelated old verification page');
  }
}

(async () => {
  await testContinuousFlow();
  await testThirdVisitAndFailuresStop();
  await testActualPageScript();
  await testSingleTabLockAndOwnedChildCleanup();
  await testCaptchaPinTransitionOnlyAdoptsOwnedNewTab();
  console.log('Alternative login tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
