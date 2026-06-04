const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadBackgroundForTest(overrides = {}) {
  const code = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
  const tabs = overrides.tabs || {};
  const scripting = overrides.scripting || {};
  const debuggerApi = overrides.debuggerApi || {};
  const windows = overrides.windows || {};
  const sandbox = {
    console,
    globalThis: {},
    setInterval() {},
    setTimeout(fn) { fn(); },
    clearTimeout() {},
    fetch: overrides.fetch || (async () => ({ async json() { return { task: null }; } })),
    chrome: {
      alarms: {
        create() {},
        onAlarm: { addListener() {} }
      },
      runtime: {
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener() {} }
      },
      tabs: {
        async query(...args) { return tabs.query ? tabs.query(...args) : []; },
        async create(...args) { return tabs.create ? tabs.create(...args) : { id: 1 }; },
        async get(...args) { return tabs.get ? tabs.get(...args) : { id: args[0], status: 'complete' }; },
        async update(...args) { return tabs.update ? tabs.update(...args) : { id: args[0], status: 'complete' }; },
        async sendMessage(...args) { return tabs.sendMessage ? tabs.sendMessage(...args) : { success: true, items: [], orders: [] }; },
        async remove(...args) { return tabs.remove ? tabs.remove(...args) : undefined; },
        onRemoved: { addListener() {} }
      },
      windows: {
        async update(...args) { return windows.update ? windows.update(...args) : undefined; }
      },
      debugger: {
        async attach(...args) { return debuggerApi.attach ? debuggerApi.attach(...args) : undefined; },
        async sendCommand(...args) { return debuggerApi.sendCommand ? debuggerApi.sendCommand(...args) : undefined; },
        async detach(...args) { return debuggerApi.detach ? debuggerApi.detach(...args) : undefined; }
      },
      scripting: {
        async executeScript(...args) {
          return scripting.executeScript ? scripting.executeScript(...args) : undefined;
        }
      },
      storage: {
        session: {
          async remove() {}
        }
      }
    }
  };
  vm.runInNewContext(code, sandbox);
  return sandbox.globalThis.__G_DAIPAI_BACKGROUND_TEST__;
}

function testMultiBidSuccessKeepsTabOpenForImmediateRebid() {
  const api = loadBackgroundForTest();

  assert.equal(api.shouldKeepTaskTabOpen(
    { strategy: 'multi_bid' },
    { success: true, bidPrice: 2000 }
  ), true);
}

function testAlreadyHighestMultiBidClosesTab() {
  const api = loadBackgroundForTest();

  assert.equal(api.shouldKeepTaskTabOpen(
    { strategy: 'multi_bid' },
    { success: true, noBid: true }
  ), false);
}

async function testWithTimeoutMarksCloseTab() {
  const api = loadBackgroundForTest();

  await assert.rejects(
    () => api.withTimeout(new Promise(() => {}), 30000),
    error => {
      assert.equal(error.closeTab, true);
      assert.match(error.message, /Task execution timeout after 30s/);
      return true;
    }
  );
}

async function testBundleStartWaitsForDecideButtonState() {
  let queryCalled = false;
  let injected = false;
  const api = loadBackgroundForTest({
    tabs: {
      async query() {
        queryCalled = true;
        return [{ id: 2, url: 'https://unexpected.example/', status: 'complete' }];
      },
      async get(id) {
        return { id, url: 'https://contact.auctions.yahoo.co.jp/seller/confirm?aid=c1133337781', status: 'complete' };
      },
      async sendMessage(id, message) {
        assert.equal(id, 1);
        if (message.type === 'CLICK_BUNDLE_TRANSACTION_ACTION') {
          assert.equal(message.action, 'start');
          return { success: true };
        }
        if (message.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
          return { success: true, state: { canDecide: true, complete: false } };
        }
        return { success: true };
      }
    },
    scripting: {
      async executeScript() {
        injected = true;
      }
    }
  });

  const result = await api.clickBundleActionAndFollowTab({
    id: 1,
    url: 'https://contact.auctions.yahoo.co.jp/seller/top?aid=c1133337781',
    _gdaipaiCreatedTabIds: [1]
  }, 'start');

  assert.equal(result.success, true);
  assert.equal(result.tab.id, 1);
  assert.equal(result.tab.url, 'https://contact.auctions.yahoo.co.jp/seller/confirm?aid=c1133337781');
  assert.equal(queryCalled, true);
  assert.equal(injected, true);
}

async function testWaitForBundleActionStateAcrossTabsFollowsNewConfirmTab() {
  const api = loadBackgroundForTest({
    tabs: {
      async query() {
        return [
          { id: 1, url: 'https://contact.auctions.yahoo.co.jp/seller/top?aid=c1133337781', status: 'complete' },
          { id: 2, url: 'https://contact.auctions.yahoo.co.jp/seller/confirm?aid=c1133337781', status: 'complete' }
        ];
      },
      async get(id) {
        return {
          id,
          url: id === 2
            ? 'https://contact.auctions.yahoo.co.jp/seller/confirm?aid=c1133337781'
            : 'https://contact.auctions.yahoo.co.jp/seller/top?aid=c1133337781',
          status: 'complete'
        };
      },
      async sendMessage(id, message) {
        if (message.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
          return { success: true, state: { canDecide: id === 2, complete: false, url: id === 2 ? '/seller/confirm' : '/seller/top' } };
        }
        return { success: true };
      }
    },
    scripting: {
      async executeScript() {
        return [{ result: { success: true } }];
      }
    }
  });

  const result = await api.waitForBundleActionStateAcrossTabs(
    { id: 1, _gdaipaiCreatedTabIds: [1] },
    state => state.canDecide,
    new Set([1]),
    100
  );

  assert.equal(result.id, 2);
  assert.equal(JSON.stringify(result._gdaipaiCreatedTabIds.sort()), JSON.stringify([1, 2]));
}

async function testTrustedBundleClickDispatchesMouseThroughDebugger() {
  const commands = [];
  let attached = false;
  let detached = false;
  let focusedWindow = null;
  const api = loadBackgroundForTest({
    tabs: {
      async get(id) {
        return { id, windowId: 9, status: 'complete' };
      },
      async update(id, props) {
        return { id, windowId: 9, active: props.active };
      }
    },
    windows: {
      async update(id, props) {
        focusedWindow = { id, props };
      }
    },
    scripting: {
      async executeScript({ func }) {
        if (!func) return [];
        return [{
          result: {
            success: true,
            x: 120,
            y: 55,
            rect: { left: 20, top: 30, width: 200, height: 50 },
            text: 'まとめて取引を依頼する'
          }
        }];
      }
    },
    debuggerApi: {
      async attach(target, version) {
        attached = target.tabId === 7 && version === '1.3';
      },
      async sendCommand(target, command, params) {
        commands.push({ target, command, params });
      },
      async detach(target) {
        detached = target.tabId === 7;
      }
    }
  });

  const result = await api.dispatchTrustedBundleActionClick({ id: 7, windowId: 9 }, 'start');

  assert.equal(result.success, true);
  assert.equal(attached, true);
  assert.equal(detached, true);
  assert.equal(focusedWindow.id, 9);
  assert.equal(focusedWindow.props.focused, true);
  assert.equal(JSON.stringify(commands.map(item => item.params.type)), JSON.stringify(['mouseMoved', 'mousePressed', 'mouseReleased']));
  assert.equal(commands[1].params.x, 120);
  assert.equal(commands[1].params.y, 55);
}

async function testBidderPaysShippingTransactionClicksDecideAndConfirm() {
  const clickedActions = [];
  let statePhase = 'decide';
  const api = loadBackgroundForTest({
    tabs: {
      async query() {
        return [];
      },
      async get(id) {
        return { id, url: 'https://contact.auctions.yahoo.co.jp/seller/top?aid=n1', status: 'complete' };
      },
      async sendMessage(id, message) {
        assert.equal(id, 3);
        if (message.type === 'CLICK_BUNDLE_TRANSACTION_ACTION') {
          clickedActions.push(message.action);
          statePhase = message.action === 'decide' ? 'confirm' : 'waiting_shipping';
          return { success: true };
        }
        if (message.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
          return {
            success: true,
            state: {
              canConfirm: statePhase === 'confirm',
              waitingShipping: statePhase === 'waiting_shipping',
              complete: false
            }
          };
        }
        return { success: true };
      }
    },
    scripting: {
      async executeScript() {
        return [{ result: { success: false, error: 'button not found in MAIN world' } }];
      }
    }
  });

  const result = await api.completeBidderPaysShippingTransaction({ id: 3 });

  assert.equal(result.success, true);
  assert.deepEqual(clickedActions, ['decide', 'confirm']);
}

async function testBidderPaysShippingTransactionAcceptsAlreadyWaitingShippingPage() {
  const clickedActions = [];
  const api = loadBackgroundForTest({
    tabs: {
      async get(id) {
        return { id, url: 'https://contact.auctions.yahoo.co.jp/seller/top?aid=n1', status: 'complete' };
      },
      async sendMessage(id, message) {
        assert.equal(id, 4);
        if (message.type === 'CLICK_BUNDLE_TRANSACTION_ACTION') {
          clickedActions.push(message.action);
          return { success: true };
        }
        if (message.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
          return {
            success: true,
            state: {
              waitingShipping: true,
              complete: false
            }
          };
        }
        return { success: true };
      }
    }
  });

  const result = await api.completeBidderPaysShippingTransaction({ id: 4 });

  assert.equal(result.success, true);
  assert.deepEqual(clickedActions, []);
}

function testBuildScanStatusPayloadUsesShippingFeeOnly() {
  const api = loadBackgroundForTest();
  const payload = api.buildScanStatusPayload({
    orderId: 11,
    result: { hasShippingFee: true, shippingFeeText: '1060\u5186', pending: false }
  });

  assert.equal(payload.orderId, 11);
  assert.equal(payload.shippingFeeText, '1060\u5186');
}

function testBuildScanStatusPayloadSkipsPendingShipping() {
  const api = loadBackgroundForTest();
  const payload = api.buildScanStatusPayload({
    orderId: 11,
    result: { hasShippingFee: false, shippingFeeText: '', pending: true }
  });

  assert.equal(payload.orderId, 11);
  assert.equal(payload.pending, true);
}

function testBuildScanStatusPayloadHandlesBundleShippingFee() {
  const api = loadBackgroundForTest();
  const payload = api.buildScanStatusPayload({
    orderId: 22,
    orderStatus: 'pending_bundle',
    result: { type: 'shipping_ready', bundleShippingFeeText: '110\u5186' }
  });

  assert.equal(payload.orderId, 22);
  assert.equal(payload.bundleShippingFeeText, '110\u5186');
}

function testBuildScanStatusPayloadHandlesBundleRejected() {
  const api = loadBackgroundForTest();
  const payload = api.buildScanStatusPayload({
    orderId: 23,
    orderStatus: 'pending_bundle',
    result: { type: 'bundle_rejected' }
  });

  assert.equal(payload.orderId, 23);
  assert.equal(payload.bundleRejected, true);
}

async function testRunPaymentJobsReportsEmptyQueue() {
  const calls = [];
  const api = loadBackgroundForTest({
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, jobs: [] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.deepEqual(calls[0], { empty: true });
}

async function testRunPaymentJobsCompletesNormalItemPayment() {
  const calls = [];
  let removedTabId = null;
  const states = [
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/top', hasEasyPaymentButton: true, paymentAmountJpy: 4330 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', hasReviewButton: true, paymentAmountJpy: 4330 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/confirm', hasFinalizeButton: true, paymentAmountJpy: 4330 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/complete', complete: true } }
  ];
  const api = loadBackgroundForTest({
    tabs: {
      async create() { return { id: 9, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async get(id) { return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async query() { return [{ id: 9, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }]; },
      async remove(id) { removedTabId = id; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        if (payload.files) return undefined;
        if (payload.args && payload.args.length) return [{ result: { success: true, text: 'clicked' } }];
        return [{ result: states.shift() || { success: true, state: { complete: true } } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 8, productId: 'p8', transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/top', finalPrice: 3450, effectiveShippingFeeText: '880\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].orderId, 8);
  assert.equal(calls[0].productId, 'p8');
  assert.equal(calls[0].status, 'success');
  assert.equal(removedTabId, 9);
}

async function testRunPaymentJobsMarksAlreadyPaidAsSuccess() {
  const calls = [];
  const api = loadBackgroundForTest({
    tabs: {
      async create() { return { id: 10, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async get(id) { return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async query() { return [{ id: 10, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        if (payload.files) return undefined;
        return [{ result: { success: true, state: { alreadyPaid: true, url: 'https://contact.auctions.yahoo.co.jp/buyer/top' } } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, jobs: [{ orderId: 9, productId: 'p9', transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/top', finalPrice: 3450, effectiveShippingFeeText: '880\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.equal(calls[0].orderId, 9);
  assert.equal(calls[0].productId, 'p9');
  assert.equal(calls[0].status, 'success');
}

async function testRunPaymentJobsReportsUnknownPaymentPageFailure() {
  const calls = [];
  const api = loadBackgroundForTest({
    tabs: {
      async create() { return { id: 11, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async get(id) { return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async query() { return [{ id: 11, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        if (payload.files) return undefined;
        return [{ result: { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/top' } } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, jobs: [{ orderId: 10, productId: 'p10', transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/top', finalPrice: 3450, effectiveShippingFeeText: '880\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.equal(calls[0].orderId, 10);
  assert.equal(calls[0].productId, 'p10');
  assert.equal(calls[0].error, 'payment entry button not found');
}

function testBuildPaymentFailurePayloadIncludesProductId() {
  const api = loadBackgroundForTest();
  const payload = api.buildPaymentFailurePayload({
    orderId: 7,
    productId: 'p7'
  }, new Error('payment page detail phase disabled'));

  assert.equal(payload.orderId, 7);
  assert.equal(payload.productId, 'p7');
  assert.equal(payload.error, 'payment page detail phase disabled');
}

function testYahooLoginPageCountsAsTransactionTab() {
  const api = loadBackgroundForTest();

  assert.equal(api.isLikelyYahooTransactionTab({ url: 'https://login.yahoo.co.jp/config/login?.src=auc' }), true);
  assert.equal(api.isLikelyYahooTransactionTab({ url: 'https://account.edit.yahoo.co.jp/verify' }), true);
}

async function testTransactionCleanupClosesNewYahooLoginTabs() {
  const removed = [];
  const api = loadBackgroundForTest({
    tabs: {
      async query() {
        return [
          { id: 1, url: 'https://contact.auctions.yahoo.co.jp/buyer/top' },
          { id: 2, url: 'https://login.yahoo.co.jp/config/login?.src=auc' },
          { id: 3, url: 'https://example.com/' }
        ];
      },
      async remove(id) {
        removed.push(id);
      }
    }
  });

  await api.closeTabsForTransactionFlow(null, new Set([1]));

  assert.deepEqual(removed, [2]);
}

async function run() {
  testMultiBidSuccessKeepsTabOpenForImmediateRebid();
  testAlreadyHighestMultiBidClosesTab();
  await testWithTimeoutMarksCloseTab();
  await testBundleStartWaitsForDecideButtonState();
  await testWaitForBundleActionStateAcrossTabsFollowsNewConfirmTab();
  await testTrustedBundleClickDispatchesMouseThroughDebugger();
  await testBidderPaysShippingTransactionClicksDecideAndConfirm();
  await testBidderPaysShippingTransactionAcceptsAlreadyWaitingShippingPage();
  testBuildScanStatusPayloadUsesShippingFeeOnly();
  testBuildScanStatusPayloadSkipsPendingShipping();
  testBuildScanStatusPayloadHandlesBundleShippingFee();
  testBuildScanStatusPayloadHandlesBundleRejected();
  await testRunPaymentJobsReportsEmptyQueue();
  await testRunPaymentJobsCompletesNormalItemPayment();
  await testRunPaymentJobsMarksAlreadyPaidAsSuccess();
  await testRunPaymentJobsReportsUnknownPaymentPageFailure();
  testBuildPaymentFailurePayloadIncludesProductId();
  testYahooLoginPageCountsAsTransactionTab();
  await testTransactionCleanupClosesNewYahooLoginTabs();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
