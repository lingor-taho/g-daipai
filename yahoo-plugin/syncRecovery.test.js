const assert = require('node:assert/strict');
const { loadBackgroundForTest } = require('./background.test.js');

const BIDDING = 'https://auctions.yahoo.co.jp/my/bidding';
const WON = 'https://auctions.yahoo.co.jp/my/won';
const ERROR_PAGE = 'Frame with ID 0 is showing error page';

function scenario(accountId, settings = {}) {
  const tabs = new Map(), visits = new Map(), timers = new Map();
  const opened = [], removed = [], injected = [], requests = [], logs = [];
  const listeners = { error: [], complete: [] };
  let onMessage;
  let nextTabId = 1, timerId = 1, now = 1000000;
  class Clock extends Date { static now() { return now; } }
  function navigate(id, url) {
    const attempt = (visits.get(url) || 0) + 1;
    visits.set(url, attempt);
    const failure = settings.fail?.(url, attempt) || '';
    tabs.set(id, { id, url, status: failure === 'timeout' ? 'loading' : 'complete', failure, startedAt: now });
    opened.push({ id, url, attempt });
    if (url !== 'about:blank') onMessage?.({ type: url.includes('/my/won') ? 'ORDER_HISTORY' : 'BIDDING_ITEMS', items: [], orders: [] }, { tab: { id } }, () => {});
    if (failure === 'frame') {
      for (const listener of listeners.error) listener({ tabId: id, frameId: 0, url: `${url}?secret=do-not-log`, error: 'net::ERR_CONNECTION_RESET' });
    } else {
      for (const listener of listeners.complete) listener({ tabId: id, frameId: 0, url });
    }
    return { ...tabs.get(id) };
  }
  const api = loadBackgroundForTest({
    disableAutoStart: true, Date: Clock,
    onMessageListener(fn) { onMessage = fn; },
    localStorage: { async get() { return { yahooBinding: { accountId, token: `secret-binding-${accountId}` } }; } },
    console: Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map(level => [level, (...args) => logs.push({ level, args })])),
    setTimeout(fn, ms) {
      const id = timerId++;
      timers.set(id, { fn, ms });
      if (ms !== 300000) queueMicrotask(() => {
        if (!timers.has(id)) return;
        timers.delete(id);
        now += ms;
        if ((settings.cancelOnRetry && ms === 1000) || (settings.cancelOnWait && ms === 250)) {
          [...timers.values()].find(timer => timer.ms === 300000)?.fn();
        }
        fn();
      });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    webNavigation: {
      onErrorOccurred: { addListener(fn) { listeners.error.push(fn); } },
      onCompleted: { addListener(fn) { listeners.complete.push(fn); } },
      async getFrame({ tabId }) { return { errorOccurred: tabs.get(tabId)?.failure === 'frame', url: tabs.get(tabId)?.url }; }
    },
    tabs: {
      async create({ url }) { return navigate(nextTabId++, url); },
      async update(id, { url }) { return navigate(id, url); },
      async get(id) {
        if (!tabs.has(id)) throw new Error(`No tab with id: ${id}`);
        const tab = tabs.get(id);
        return settings.tabState?.({ ...tab }, now - tab.startedAt) || { ...tab };
      },
      async remove(id) { removed.push(id); tabs.delete(id); },
      async sendMessage(id, message) {
        const tab = tabs.get(id);
        if (tab.failure === 'extract') throw new Error('unexpected extraction failure');
        return settings.response?.(tab.url, message.type) || { success: true, items: [], orders: [], loginStatus: { status: 'ok' } };
      }
    },
    scripting: { async executeScript({ target }) {
      injected.push(target.tabId);
      settings.onInject?.(tabs.get(target.tabId), now - tabs.get(target.tabId).startedAt);
      const failure = tabs.get(target.tabId)?.failure;
      if (failure === 'inject') throw new Error(ERROR_PAGE);
      if (failure === 'permission') throw new Error('Cannot access contents of the page. Extension manifest must request permission');
    } },
    fetch: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      return new Response(JSON.stringify(String(url).endsWith('/config')
        ? { idleSyncIntervalMinutes: 1 } : { success: true, tasks: [], jobs: [] }), { status: 200 });
    }
  });
  return { api, tabs, visits, opened, removed, injected, requests, logs,
    autoReport(id, type = 'BIDDING_ITEMS') { return onMessage({ type, items: [], orders: [] }, { tab: { id } }, () => {}); },
    advance() { now += 60001; },
    writes(path) { return requests.filter(call => call.url.endsWith(path)); }
  };
}

async function run() {
  // Real Chrome can report the old complete document while its new navigation
  // has only been queued. All these pages finish within the original 30 seconds.
  for (const kind of ['blank', 'pending-navigation', 'late-loading', 'slow']) {
    const readyAt = kind === 'slow' ? 29000 : 8000;
    const test = scenario(1, {
      tabState(tab, age) {
        if (tab.url === 'about:blank' || age >= readyAt) return tab;
        if (kind === 'blank' && age < 1000) return { ...tab, url: 'about:blank', status: 'complete' };
        if (kind === 'pending-navigation') return { ...tab, pendingUrl: tab.url, status: 'complete' };
        if (kind === 'late-loading' && age < 1000) return { ...tab, status: 'complete' };
        return { ...tab, status: 'loading' };
      },
      onInject(tab, age) { assert(age >= readyAt, `${kind}: never extract from the old or still-loading document`); }
    });
    await test.api.syncMonitorYahooPages();
    assert.equal(test.visits.get(BIDDING), 1, `${kind}: loading within 30 s must not trigger a reopen`);
    assert.equal(test.visits.get(WON), 1);
    assert.equal(test.writes('/bidding/sync').length, 1);
    assert.equal(test.writes('/orders/sync').length, 1);
    assert.equal(test.logs.some(log => log.level === 'error' || String(log.args[0]).includes('retrying once')), false);
    assert.equal(test.tabs.size, 0);
  }
  const waitingAges = [];
  const slowFailure = scenario(1, {
    tabState(tab, age) { if(tab.url === BIDDING) {waitingAges.push(age);return {...tab,status:'loading'};} return tab; }
  });
  await assert.rejects(slowFailure.api.syncMonitorYahooPages(), /Product page load timeout/);
  assert.equal(slowFailure.visits.get(BIDDING), 2, 'genuine timeouts retain the existing single retry');
  assert.equal(Math.max(...waitingAges), 30000, 'each attempt waits the full original deadline, not 3 s');
  assert.equal(slowFailure.injected.length, 0);
  assert.equal(slowFailure.writes('/bidding/sync').length, 0);

  for (const kind of ['frame', 'inject', 'timeout']) {
    const test = scenario(1, { fail: (url, attempt) => url === BIDDING && attempt === 1 ? kind : '' });
    await test.api.syncMonitorYahooPages();
    assert.equal(test.visits.get(BIDDING), 2, `${kind}: retry once`);
    assert.equal(test.visits.get(WON), 1);
    assert.equal(test.writes('/bidding/sync').length, 1);
    assert.equal(test.writes('/orders/sync').length, 1);
    assert.equal(test.logs.filter(log => log.level === 'error').length, 0);
    assert.equal(test.tabs.size, 0);
    if (kind !== 'inject') assert.ok(!test.injected.includes(test.opened.find(tab => tab.url === BIDDING).id), 'do not inject into known failed/loading document');
  }

  const persistent = scenario(2, { fail: url => url === BIDDING ? 'frame' : '' });
  await assert.rejects(persistent.api.syncMonitorYahooPages(), error => {
    assert.match(error.message, /accountId=2/);
    assert.match(error.message, /sync=bidding,page=1,stage=check-document,attempt=2/);
    assert.match(error.message, /net::ERR_CONNECTION_RESET/);
    assert.ok(error.message.includes(BIDDING));
    assert.ok(!error.message.includes('do-not-log') && !error.message.includes('secret-binding'));
    return true;
  });
  assert.equal(persistent.visits.get(BIDDING), 2);
  assert.equal(persistent.visits.get(WON), undefined);
  assert.equal(persistent.writes('/bidding/sync').length, 0, 'failed read cannot upload empty data');
  for (const id of persistent.removed) persistent.autoReport(id);
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  assert.equal(persistent.writes('/bidding/sync').length, 0, 'late content messages from failed tabs remain ignored');
  assert.equal(persistent.logs.filter(log => log.level === 'error').length, 0, 'only caller reports the final error');
  await persistent.api.syncMonitorYahooPages();
  assert.equal(persistent.visits.get(BIDDING), 2, 'retain normal sync interval after failure');
  persistent.advance();
  await assert.rejects(persistent.api.syncMonitorYahooPages());
  assert.equal(persistent.visits.get(BIDDING), 4, 'failure releases running guard for next round');

  const page2 = `${BIDDING}?page=2`;
  for (const persistentPage2 of [false, true]) {
    const test = scenario(1, {
      fail: (url, attempt) => url === page2 && (persistentPage2 || attempt === 1) ? 'inject' : '',
      response: url => url === BIDDING
        ? { success: true, items: [{ productId: 'a1234567890' }], nextPageUrl: page2 }
        : { success: true, items: [{ productId: 'b1234567890' }], orders: [] }
    });
    if (persistentPage2) {
      await assert.rejects(test.api.syncMonitorYahooPages(), /sync=bidding,page=2,stage=inject-content,attempt=2/);
      assert.equal(test.writes('/bidding/sync').length, 0, 'do not upload an incomplete combined list');
    } else {
      await test.api.syncMonitorYahooPages();
      const payload = JSON.parse(test.writes('/bidding/sync')[0].options.body);
      assert.deepEqual(payload.items.map(item => item.productId), ['a1234567890', 'b1234567890']);
    }
    assert.equal(test.visits.get(BIDDING), 1);
    assert.equal(test.visits.get(page2), 2, 'reopen the failed page, not the first page');
    assert.equal(test.tabs.size, 0);
  }

  const failedWon = scenario(2, { fail: url => url === WON ? 'frame' : '' });
  await assert.rejects(failedWon.api.syncMonitorYahooPages(), /sync=won,page=1/);
  assert.equal(failedWon.writes('/bidding/sync').length, 1, 'completed bidding sync remains valid');
  assert.equal(failedWon.writes('/orders/sync').length, 0);

  for (const failure of ['permission', 'extract']) {
    const test = scenario(1, { fail: () => failure });
    await assert.rejects(test.api.syncMonitorYahooPages(), /Yahoo sync failed/);
    assert.equal(test.visits.get(BIDDING), 1, 'unrelated errors are not retried or swallowed');
    assert.equal(test.logs.filter(log => log.level === 'error').length, 0);
  }

  const loggedOut = scenario(1, { response: () => ({ success: false, loginStatus: { status: 'failed', message: 'login required' } }) });
  await loggedOut.api.syncMonitorYahooPages();
  assert.equal(loggedOut.visits.get(BIDDING), 1);
  assert.equal(loggedOut.visits.get(WON), 1);
  assert.equal(loggedOut.writes('/bidding/sync').length, 0);
  assert.equal(loggedOut.writes('/orders/sync').length, 0);

  const cancelled = scenario(1, { fail: () => 'inject', cancelOnRetry: true });
  await assert.rejects(cancelled.api.syncMonitorYahooPages(), /Bidding page sync timeout/);
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  assert.equal(cancelled.visits.get(BIDDING), 1, 'watchdog must prevent late retries');
  assert.equal(cancelled.writes('/bidding/sync').length, 0);
  assert.equal(cancelled.tabs.size, 0);

  const cancelledWait = scenario(1, { fail: () => 'timeout', cancelOnWait: true });
  await assert.rejects(cancelledWait.api.syncMonitorYahooPages(), /Bidding page sync timeout/);
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  assert.equal(cancelledWait.visits.get(BIDDING), 1, 'overall watchdog cancels the document wait without opening a retry');
  assert.equal(cancelledWait.injected.length, 0);
  assert.equal(cancelledWait.tabs.size, 0);

  const main = scenario(1, { fail: (url, attempt) => url === BIDDING && attempt === 1 ? 'frame' : '' });
  const backup = scenario(2);
  await Promise.all([main.api.syncMonitorYahooPages(), backup.api.syncMonitorYahooPages()]);
  assert.equal(main.visits.get(BIDDING), 2);
  assert.equal(backup.visits.get(BIDDING), 1);
  for (const [id, test] of [[1, main], [2, backup]]) {
    assert.ok(test.requests.every(call => call.options.headers['X-Yahoo-Account'] === String(id)));
    assert.equal(test.writes('/bidding/sync').length, 1);
    assert.equal(test.writes('/orders/sync').length, 1);
  }
  const manual = scenario(1);
  manual.autoReport(999);
  for (let turn = 0; turn < 30; turn++) await Promise.resolve();
  assert.equal(manual.writes('/bidding/sync').length, 1, 'manual Yahoo tabs retain existing auto reporting');
  let injections = 0;
  const errors = [];
  const originalInjection = loadBackgroundForTest({
    disableAutoStart: true,
    console: { ...console, error(...args) { errors.push(args); } },
    scripting: { async executeScript() { injections++; throw new Error(ERROR_PAGE); } }
  });
  await assert.rejects(originalInjection.injectContentScript(77), /showing error page/);
  assert.equal(injections, 1, 'other workflows do not acquire sync retries');
  assert.equal(errors.length, 1, 'other workflows retain error reporting');
  console.log('Yahoo sync recovery tests passed (load errors, timeout, pagination, diagnostics, cancellation, two profiles).');
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
