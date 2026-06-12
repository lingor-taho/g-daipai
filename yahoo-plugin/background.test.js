const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadBackgroundForTest(overrides = {}) {
  let code = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
  if (overrides.disableAutoStart) {
    code = code.replace(/\r?\nstartPolling\(\);\r?\n\r?\n\/\/ Listen for messages from content script or client page/, '\n// Listen for messages from content script or client page');
  }
  const tabs = overrides.tabs || {};
  const scripting = overrides.scripting || {};
  const debuggerApi = overrides.debuggerApi || {};
  const windows = overrides.windows || {};
  const sandbox = {
    console,
    Date: overrides.now
      ? class MockDate extends Date {
          static now() { return overrides.now(); }
        }
      : Date,
    globalThis: {
      __G_DAIPAI_TRANSACTION_START_ENABLED__: overrides.transactionStartEnabled,
      __G_DAIPAI_RANDOM__: overrides.random,
      __G_DAIPAI_SLEEP__: overrides.sleep
    },
    setInterval() {},
    setTimeout(fn, ms) { return overrides.setTimeout ? overrides.setTimeout(fn, ms) : fn(); },
    clearTimeout() {},
    URL,
    URLSearchParams,
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
        async reload(...args) { return tabs.reload ? tabs.reload(...args) : undefined; },
        async captureVisibleTab(...args) { return tabs.captureVisibleTab ? tabs.captureVisibleTab(...args) : 'data:image/png;base64,'; },
        async sendMessage(...args) { return tabs.sendMessage ? tabs.sendMessage(...args) : { success: true, items: [], orders: [] }; },
        async remove(...args) { return tabs.remove ? tabs.remove(...args) : undefined; },
        onUpdated: {
          addListener(...args) { return tabs.onUpdatedAddListener ? tabs.onUpdatedAddListener(...args) : undefined; },
          removeListener(...args) { return tabs.onUpdatedRemoveListener ? tabs.onUpdatedRemoveListener(...args) : undefined; }
        },
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
          async set() {},
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

async function testManualPinDispatchesDigitsThroughDebuggerKeyboard() {
  const commands = [];
  let attached = false;
  let detached = false;
  let focusedWindow = null;
  const api = loadBackgroundForTest({
    tabs: {
      async get(id) {
        return { id, windowId: 9, status: 'complete', title: 'Yahoo PIN Window' };
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
    debuggerApi: {
      async attach(target, version) {
        attached = target.tabId === 8 && version === '1.3';
      },
      async sendCommand(target, command, params) {
        commands.push({ target, command, params });
      },
      async detach(target) {
        detached = target.tabId === 8;
      }
    }
  });

  const result = await api.dispatchTrustedManualPinKeys({ id: 8, windowId: 9 }, '123456');

  assert.equal(result.success, true);
  assert.equal(attached, true);
  assert.equal(detached, true);
  assert.equal(focusedWindow.props.focused, true);
  assert.deepEqual(
    commands.filter(item => item.command === 'Input.dispatchKeyEvent').map(item => `${item.params.type}:${item.params.text || item.params.key}`),
    [
      'rawKeyDown:1', 'char:1', 'keyUp:1',
      'rawKeyDown:2', 'char:2', 'keyUp:2',
      'rawKeyDown:3', 'char:3', 'keyUp:3',
      'rawKeyDown:4', 'char:4', 'keyUp:4',
      'rawKeyDown:5', 'char:5', 'keyUp:5',
      'rawKeyDown:6', 'char:6', 'keyUp:6'
    ]
  );
}

async function testManualPinUsesSystemKeyboardEndpointBeforeDebugger() {
  const fetchCalls = [];
  const debuggerCommands = [];
  const windowUpdates = [];
  const tabUpdates = [];
  const api = loadBackgroundForTest({
    tabs: {
      async get(id) {
        return { id, windowId: 9, status: 'complete', title: 'Yahoo PIN Window' };
      },
      async update(id, props) {
        tabUpdates.push({ id, props });
        return { id, windowId: 9, active: props.active };
      }
    },
    windows: {
      async update(id, props) {
        windowUpdates.push({ id, props });
      }
    },
    debuggerApi: {
      async attach() {},
      async sendCommand(target, command, params) {
        debuggerCommands.push({ command, params });
      },
      async detach() {}
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url: String(url), body: options.body || '' });
      if (String(url).includes('/api/plugin/manual-pin/type')) {
        return { async json() { return { success: true, digits: 6 }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  const result = await api.fillManualPinAnswer(8, '123456');

  assert.equal(result.success, true);
  assert.equal(result.method, 'systemSendKeys');
  assert.equal(fetchCalls.some(call => call.url.includes('/api/plugin/manual-pin/type') && /123456/.test(call.body)), true);
  assert.equal(fetchCalls.some(call => call.url.includes('/api/plugin/manual-pin/type') && /Yahoo PIN Window/.test(call.body)), true);
  assert.equal(debuggerCommands.length, 0);
  assert.equal(windowUpdates.some(update => update.id === 9 && update.props.focused === true && update.props.state === 'normal'), true);
  assert.equal(tabUpdates.some(update => update.id === 8 && update.props.active === true && update.props.highlighted === true), true);
}

async function testManualPinFallsBackToDebuggerWhenSystemKeyboardFails() {
  const debuggerCommands = [];
  const api = loadBackgroundForTest({
    tabs: {
      async get(id) {
        return { id, windowId: 9, status: 'complete' };
      },
      async update(id, props) {
        return { id, windowId: 9, active: props.active };
      }
    },
    debuggerApi: {
      async attach() {},
      async sendCommand(target, command, params) {
        debuggerCommands.push({ command, params });
      },
      async detach() {}
    },
    fetch: async (url) => {
      if (String(url).includes('/api/plugin/manual-pin/type')) {
        return { async json() { return { success: false, error: 'sendkeys failed' }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  const result = await api.fillManualPinAnswer(8, '123456');

  assert.equal(result.success, true);
  assert.equal(result.method, 'debuggerRealKeyboard');
  assert.equal(debuggerCommands.some(item => item.command === 'Input.dispatchKeyEvent'), true);
}

async function testManualPinUsesRealKeyboardBeforeInsertTextFallback() {
  const commands = [];
  const api = loadBackgroundForTest({
    tabs: {
      async get(id) {
        return { id, windowId: 9, status: 'complete' };
      },
      async update(id, props) {
        return { id, windowId: 9, active: props.active };
      }
    },
    debuggerApi: {
      async attach() {},
      async sendCommand(target, command, params) {
        commands.push({ command, params });
      },
      async detach() {}
    }
  });

  const result = await api.dispatchTrustedManualPinKeys({ id: 8, windowId: 9 }, '123456');

  assert.equal(result.success, true);
  assert.equal(commands[0].command, 'Input.dispatchKeyEvent');
  assert.equal(commands[0].params.type, 'rawKeyDown');
  assert.equal(commands.some(item => item.command === 'Input.insertText'), false);
}

async function testManualPinFallsBackToInsertTextWhenRealKeyboardFails() {
  const commands = [];
  const api = loadBackgroundForTest({
    tabs: {
      async get(id) {
        return { id, windowId: 9, status: 'complete' };
      },
      async update(id, props) {
        return { id, windowId: 9, active: props.active };
      }
    },
    debuggerApi: {
      async attach() {},
      async sendCommand(target, command, params) {
        commands.push({ command, params });
        if (command === 'Input.dispatchKeyEvent') throw new Error('keyboard unavailable');
      },
      async detach() {}
    }
  });

  const result = await api.dispatchTrustedManualPinKeys({ id: 8, windowId: 9 }, '123456');

  assert.equal(result.success, true);
  assert.equal(commands.some(item => item.command === 'Input.insertText'), true);
  assert.equal(commands.filter(item => item.command === 'Input.dispatchKeyEvent' && item.params.type === 'rawKeyDown').length, 1);
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

function testBundleInputActionCanRunFromWaitingAgreementState() {
  const api = loadBackgroundForTest();

  assert.equal(api.shouldAttemptBundleInputAction(
    { type: 'waiting_agreement' },
    { canInputTransaction: true }
  ), true);
  assert.equal(api.shouldAttemptBundleInputAction(
    { type: 'shipping_pending' },
    { canInputTransaction: true }
  ), true);
  assert.equal(api.shouldAttemptBundleInputAction(
    { type: 'input_required' },
    { canInputTransaction: true }
  ), true);
  assert.equal(api.shouldAttemptBundleInputAction(
    { type: 'child_agreed' },
    { canInputTransaction: true }
  ), false);
  assert.equal(api.shouldAttemptBundleInputAction(
    { type: 'waiting_agreement' },
    { canInputTransaction: false }
  ), false);
}

function testPaymentPageStateDetectsPurchaseCompletePage() {
  const api = loadBackgroundForTest();
  const state = api.buildPaymentPageStateFromSnapshot({
    url: 'https://buy.auctions.yahoo.co.jp/order/thank-you?auctionId=k1200063399',
    bodyText: '購入が完了しました！ 購入完了メールを送信しました。購入内容は取引ナビで確認できます。',
    controls: ['取引内容を確認する']
  });

  assert.equal(state.complete, true);
  assert.equal(state.alreadyPaid, false);
}

function testPaymentPageStateDetectsStoreAlreadyPaidPage() {
  const api = loadBackgroundForTest();
  const state = api.buildPaymentPageStateFromSnapshot({
    url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=k1200063399',
    bodyText: 'ご購入ありがとうございます。商品の発送連絡をお待ちください。ストアから購入した商品は受取連絡は必要ありません。商品受取後、評価してください。',
    controls: ['出品者を評価する']
  });

  assert.equal(state.alreadyPaid, true);
  assert.equal(state.complete, false);
}

function testPaymentPageStateKeepsSelectedShippingOption() {
  const api = loadBackgroundForTest();
  const state = api.buildPaymentPageStateFromSnapshot({
    url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=u1231877298',
    bodyText: '\u914d\u9001\u65b9\u6cd5 \u304a\u3066\u304c\u308b\u914d\u9001 \u3086\u3046\u30d1\u30b1\u30c3\u30c8 230\u5186 \u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8 185\u5186 \u78ba\u8a8d\u3059\u308b',
    controls: ['\u78ba\u8a8d\u3059\u308b'],
    shippingOptions: [
      { amountJpy: 230, checked: true, disabled: false, text: '\u304a\u3066\u304c\u308b\u914d\u9001 \u3086\u3046\u30d1\u30b1\u30c3\u30c8 230\u5186' },
      { amountJpy: 185, checked: false, disabled: false, text: '\u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8 185\u5186' }
    ]
  });

  assert.equal(state.hasReviewButton, true);
  assert.equal(state.selectedShippingAmountJpy, 230);
  assert.equal(state.shippingOptions.length, 2);
}

function testPaymentPageStateDetectsPaymentMethodFee() {
  const api = loadBackgroundForTest();
  const state = api.buildPaymentPageStateFromSnapshot({
    url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=u1231877298',
    bodyText: '\u304a\u652f\u6255\u3044\u65b9\u6cd5 \u30b3\u30f3\u30d3\u30cb\uff08\u30bb\u30d6\u30f3-\u30a4\u30ec\u30d6\u30f3\uff09\uff08\u624b\u6570\u6599330\u5186\uff09 \u304a\u652f\u6255\u3044\u91d1\u984d\uff08\u5408\u8a08\uff09 865\u5186',
    controls: ['\u78ba\u8a8d\u3059\u308b']
  });

  assert.equal(state.paymentAmountJpy, 865);
  assert.equal(state.paymentMethodFeeJpy, 330);
}

function testPaymentPageStateUsesTotalAmountWithPayPayBenefitAd() {
  const api = loadBackgroundForTest();
  const state = api.buildPaymentPageStateFromSnapshot({
    url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=x1232305352',
    bodyText: '\u304a\u652f\u6255\u3044\u65b9\u6cd5 \u30af\u30ec\u30b8\u30c3\u30c8\u30ab\u30fc\u30c9\u6255\u3044 PayPay\u30ab\u30fc\u30c9\u5165\u4f1a\u7279\u5178 \u5229\u7528\u5f8c\u306e\u5408\u8a08\u91d1\u984d 51,000\u5186 \u3054\u8cfc\u5165\u5185\u5bb9\u8a73\u7d30 \u843d\u672d\u5408\u8a08\u91d1\u984d 56,000\u5186 \u9001\u6599 0\u5186 \u304a\u652f\u6255\u3044\u91d1\u984d\uff08\u5408\u8a08\uff09 56,000\u5186',
    controls: ['PayPay\u30a2\u30d7\u30ea\u304b\u3089ID\u9023\u643a\u3059\u308b', '\u7279\u5178\u3092\u78ba\u8a8d\u3059\u308b', '\u78ba\u8a8d\u3059\u308b']
  });

  assert.equal(state.paymentAmountJpy, 56000);
  assert.equal(state.hasReviewButton, true);
}

function testPaymentPageStateDetectsStoreConfirmationSection() {
  const api = loadBackgroundForTest();
  const state = api.buildPaymentPageStateFromSnapshot({
    url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017',
    bodyText: '\u30b9\u30c8\u30a2\u304b\u3089\u306e\u78ba\u8a8d\u4e8b\u9805 \u5e74\u9f62\u78ba\u8a8d \u79c1\u306f33\u6b73\u3067\u3059 \u5fc5\u9808 \u9818\u53ce\u66f8 \u4e0d\u8981 \u304a\u652f\u6255\u3044\u91d1\u984d\uff08\u7a0e\u8fbc\uff09 43,320\u5186',
    controls: ['\u5909\u66f4', '\u78ba\u8a8d\u3059\u308b']
  });
  const editState = api.buildPaymentPageStateFromSnapshot({
    url: 'https://buy.auctions.yahoo.co.jp/order/store-confirmation?auctionId=j1232680017',
    bodyText: '\u30b9\u30c8\u30a2\u304b\u3089\u306e\u78ba\u8a8d\u4e8b\u9805\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002 \u5e74\u9f62\u78ba\u8a8d \u5fc5\u9808',
    controls: ['\u5909\u66f4\u3059\u308b']
  });

  assert.equal(state.hasStoreConfirmationSection, true);
  assert.equal(state.hasStoreConfirmationEditPage, false);
  assert.equal(editState.hasStoreConfirmationSection, true);
  assert.equal(editState.hasStoreConfirmationEditPage, true);
}

function testPaymentPageStateDoesNotTreatCartoptOnlyAsStoreConfirmation() {
  const api = loadBackgroundForTest();
  const state = api.buildPaymentPageStateFromSnapshot({
    url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1232862422',
    bodyText: '\u30af\u30fc\u30dd\u30f3 PayPay\u30dd\u30a4\u30f3\u30c8 \u304a\u652f\u6255\u3044\u65b9\u6cd5 \u30af\u30ec\u30b8\u30c3\u30c8\u30ab\u30fc\u30c9 \u5546\u54c1\u5408\u8a08 19,800\u5186 \u9001\u6599 900\u5186 \u304a\u652f\u6255\u3044\u91d1\u984d 20,700\u5186 \u78ba\u8a8d\u3059\u308b',
    controls: ['\u7279\u5178\u3092\u78ba\u8a8d\u3059\u308b', '\u78ba\u8a8d\u3059\u308b'],
    hasStoreConfirmationSection: true
  });

  assert.equal(state.hasStoreConfirmationSection, false);
  assert.equal(state.hasStoreConfirmationEditPage, false);
  assert.equal(state.hasReviewButton, true);
}

function testBuildStoreOptionsUrlUsesProductId() {
  const api = loadBackgroundForTest();

  assert.equal(
    api.buildStoreOptionsUrl(
      { url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=ignored' },
      { productId: 'j1232680017' }
    ),
    'https://buy.auctions.yahoo.co.jp/order/change/store-options?auctionId=j1232680017'
  );
  assert.equal(
    api.buildStoreOptionsUrl(
      { url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017' },
      {}
    ),
    'https://buy.auctions.yahoo.co.jp/order/change/store-options?auctionId=j1232680017'
  );
}

async function testStoreConfirmationChangeUsesCartoptSelector() {
  let clicked = false;
  const changeLink = {
    tagName: 'A',
    textContent: '\u5909\u66f4',
    value: '',
    title: '',
    getAttribute(name) {
      return name === 'aria-label' ? '' : null;
    },
    closest(selector) {
      return String(selector).includes('a') ? this : null;
    },
    scrollIntoView() {},
    focus() {},
    dispatchEvent() {},
    click() { clicked = true; }
  };
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript(payload) {
        const result = vm.runInNewContext(`(${payload.func.toString()})()`, {
          document: {
            querySelector(selector) {
              if (selector.includes('#cartopt')) return changeLink;
              return null;
            },
            querySelectorAll(selector) {
              if (String(selector).includes('h1')) return [];
              return [changeLink];
            }
          },
          window: {},
          MouseEvent: function MouseEvent() {},
          PointerEvent: function PointerEvent() {},
          Node: { DOCUMENT_POSITION_FOLLOWING: 4 }
        });
        return [{ result }];
      }
    }
  });

  const result = await api.clickStoreConfirmationChange(19);

  assert.equal(result.success, true);
  assert.equal(result.method, 'storeConfirmationSelector');
  assert.equal(clicked, true);
}

async function testStoreConfirmationApplyUsesConfirmUpdateSelector() {
  let applyClicked = false;
  const checkboxA = {
    id: 'agree-a',
    checked: false,
    disabled: false,
    getBoundingClientRect() { return { width: 10, height: 10 }; },
    closest() { return this; },
    scrollIntoView() {},
    click() { this.checked = true; },
    dispatchEvent() {}
  };
  const checkboxB = {
    id: 'agree-b',
    checked: false,
    disabled: false,
    getBoundingClientRect() { return { width: 10, height: 10 }; },
    closest() { return this; },
    scrollIntoView() {},
    click() { this.checked = true; },
    dispatchEvent() {}
  };
  const applyLink = {
    tagName: 'A',
    textContent: '\u5909\u66f4\u3059\u308b',
    value: '',
    title: '',
    getAttribute(name) {
      return name === 'aria-label' ? '' : null;
    },
    closest(selector) {
      return String(selector).includes('a') ? this : null;
    },
    scrollIntoView() {},
    focus() {},
    dispatchEvent() {},
    click() { applyClicked = true; }
  };
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript(payload) {
        const result = vm.runInNewContext(`(${payload.func.toString()})(...args)`, {
          args: payload.args || [],
          document: {
            body: {},
            querySelector(selector) {
              if (String(selector).startsWith('label')) return null;
              if (selector.includes('#confirm')) return applyLink;
              return null;
            },
            querySelectorAll(selector) {
              if (selector === 'input[type="checkbox"]') return [checkboxA, checkboxB];
              return [applyLink];
            }
          },
          window: {
            getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
            HTMLInputElement: { prototype: {} }
          },
          CSS: { escape: value => value },
          Event: function Event() {},
          MouseEvent: function MouseEvent() {},
          PointerEvent: function PointerEvent() {}
        });
        return [{ result }];
      }
    }
  });

  const result = await api.checkAllStoreConfirmationItemsAndApply(19);

  assert.equal(result.success, true);
  assert.equal(result.checkedCount, 2);
  assert.equal(checkboxA.checked, true);
  assert.equal(checkboxB.checked, true);
  assert.equal(applyClicked, true);
}

async function testStoreConfirmationApplyChecksHiddenInputs() {
  const checkbox = {
    id: 'agree-hidden',
    checked: false,
    disabled: false,
    closest() { return this; },
    scrollIntoView() {},
    click() { this.clicked = true; },
    dispatchEvent() {}
  };
  const applyLink = {
    textContent: '\u5909\u66f4\u3059\u308b',
    value: '',
    title: '',
    getAttribute() { return ''; },
    closest() { return this; },
    scrollIntoView() {},
    focus() {},
    dispatchEvent() {},
    click() {}
  };
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript(payload) {
        const result = vm.runInNewContext(`(${payload.func.toString()})(...args)`, {
          args: payload.args || [],
          document: {
            body: {},
            querySelector(selector) {
              if (String(selector).startsWith('label')) return null;
              if (selector.includes('#confirm')) return applyLink;
              return null;
            },
            querySelectorAll(selector) {
              if (selector === 'input[type="checkbox"]') return [checkbox];
              return [applyLink];
            }
          },
          window: { HTMLInputElement: { prototype: {} } },
          CSS: { escape: value => value },
          Event: function Event() {},
          MouseEvent: function MouseEvent() {},
          PointerEvent: function PointerEvent() {}
        });
        return [{ result }];
      }
    }
  });

  const result = await api.checkAllStoreConfirmationItemsAndApply(19, false);

  assert.equal(result.success, true);
  assert.equal(result.checkedCount, 1);
  assert.equal(checkbox.checked, true);
  assert.equal(checkbox.clicked, true);
}

async function testStoreConfirmationTrustedClickPointsUseRealSelectors() {
  const cartoptLink = {
    textContent: '\u5909\u66f4',
    value: '',
    title: '',
    getAttribute() { return ''; },
    scrollIntoView() {},
    getBoundingClientRect() { return { left: 580, top: 220, width: 40, height: 20 }; }
  };
  const confirmUpdateLink = {
    textContent: '\u5909\u66f4\u3059\u308b',
    value: '',
    title: '',
    getAttribute() { return ''; },
    scrollIntoView() {},
    getBoundingClientRect() { return { left: 590, top: 258, width: 240, height: 38 }; }
  };
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript(payload) {
        const result = vm.runInNewContext(`(${payload.func.toString()})(...args)`, {
          args: payload.args || [],
          document: {
            querySelector(selector) {
              if (String(selector).includes('#cartopt')) return cartoptLink;
              if (String(selector).includes('#confirm')) return confirmUpdateLink;
              return null;
            }
          }
        });
        return [{ result }];
      }
    }
  });

  const changePoint = await api.getStoreConfirmationClickPoint(19, 'change');
  const applyPoint = await api.getStoreConfirmationClickPoint(19, 'apply');

  assert.equal(changePoint.success, true);
  assert.equal(changePoint.x, 600);
  assert.equal(changePoint.y, 230);
  assert.equal(applyPoint.success, true);
  assert.equal(applyPoint.x, 710);
  assert.equal(applyPoint.y, 277);
}

function testPaymentAmountAllowsUnknownShippingWhenPageTotalEqualsFinalPrice() {
  const api = loadBackgroundForTest();

  assert.doesNotThrow(() => api.assertPaymentAmountMatches(
    { finalPrice: 56000, productType: 'store', effectiveShippingFeeText: '\u9001\u6599 \u843d\u672d\u8005\u8ca0\u62c5' },
    { paymentAmountJpy: 56000 }
  ));
}

function testPaymentAmountRejectsUnknownShippingWhenPageTotalExceedsFinalPrice() {
  const api = loadBackgroundForTest();

  assert.throws(() => api.assertPaymentAmountMatches(
    { finalPrice: 56000, effectiveShippingFeeText: '\u9001\u6599 \u843d\u672d\u8005\u8ca0\u62c5' },
    { paymentAmountJpy: 57000 }
  ), /payment expected amount unavailable/);
}

function testPaymentAmountTreatsFreeAndCashOnDeliveryAsZeroShippingForAllProducts() {
  const api = loadBackgroundForTest();

  assert.equal(api.parseYenAmount('\u9001\u6599 \u7121\u6599'), 0);
  assert.equal(api.parseYenAmount('\u9001\u6599 \u7740\u6255\u3044'), 0);
  assert.equal(api.getExpectedPaymentAmountJpy({
    finalPrice: 56000,
    effectiveShippingFeeText: '\u9001\u6599 \u7121\u6599'
  }), 56000);
  assert.equal(api.getExpectedPaymentAmountJpy({
    finalPrice: 56000,
    effectiveShippingFeeText: '\u9001\u6599 \u7740\u6255\u3044'
  }), 56000);
  assert.doesNotThrow(() => api.assertPaymentAmountMatches(
    { finalPrice: 56000, productType: 'normal', effectiveShippingFeeText: '\u9001\u6599 \u7121\u6599' },
    { paymentAmountJpy: 56000 }
  ));
  assert.doesNotThrow(() => api.assertPaymentAmountMatches(
    { finalPrice: 56000, productType: 'normal', effectiveShippingFeeText: '\u9001\u6599 \u7740\u6255\u3044' },
    { paymentAmountJpy: 56000 }
  ));
}

function testShouldSelectPaymentShippingOptionWhenDefaultDiffers() {
  const api = loadBackgroundForTest();
  const state = {
    hasReviewButton: true,
    selectedShippingAmountJpy: 230,
    shippingOptions: [
      { amountJpy: 230, checked: true, disabled: false },
      { amountJpy: 185, checked: false, disabled: false }
    ]
  };

  assert.equal(api.shouldSelectPaymentShippingOption({ effectiveShippingFeeText: '185\u5186' }, state), true);
  assert.equal(api.shouldSelectPaymentShippingOption({ effectiveShippingFeeText: '230\u5186' }, state), false);
  assert.equal(api.shouldSelectPaymentShippingOption({ effectiveShippingFeeText: '600\u5186' }, state), false);
}

function testRandomIntInclusiveUsesConfiguredRange() {
  const api = loadBackgroundForTest({ random: () => 0.75 });
  assert.equal(api.getRandomIntInclusive(1, 3), 3);
  assert.equal(api.getRandomIntInclusive(2, 5), 5);
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

async function testRunTransactionStartJobsCanOnlyRefreshServerSideStoreOrders() {
  const requestedUrls = [];
  let createdTab = false;
  let statusUpdated = false;
  const api = loadBackgroundForTest({
    tabs: {
      async create() {
        createdTab = true;
        return { id: 77, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' };
      }
    },
    fetch: async (url, options = {}) => {
      requestedUrls.push(String(url));
      if (String(url).includes('/api/plugin/transaction-start/jobs')) {
        return {
          async json() {
            return {
              success: true,
              storeUpdated: 3,
              jobs: [{
                orderId: 9,
                productId: 'n9',
                transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=n9',
                shippingFeeText: '800\u5186'
              }]
            };
          }
        };
      }
      if (String(url).includes('/api/plugin/transaction-start/status')) {
        statusUpdated = true;
      }
      return { async json() { return { success: true }; } };
    }
  });

  await api.runTransactionStartJobs({ processNormalJobs: false });

  assert.equal(requestedUrls.some(url => url.includes('/api/plugin/transaction-start/jobs')), true);
  assert.equal(createdTab, false);
  assert.equal(statusUpdated, false);
}

async function testIdleTransactionStartRefreshesStoreOrdersWhenNormalFlowDisabled() {
  const requestedUrls = [];
  const completedActions = [];
  let createdTransactionTab = false;
  const api = loadBackgroundForTest({
    transactionStartEnabled: false,
    tabs: {
      async create(urlOrOptions) {
        const url = typeof urlOrOptions === 'string' ? urlOrOptions : urlOrOptions?.url;
        if (String(url || '').includes('contact.auctions.yahoo.co.jp')) {
          createdTransactionTab = true;
        }
        return { id: 31, url, status: 'complete' };
      },
      async sendMessage(id, message) {
        if (message.type === 'BIDDING_ITEMS') return { success: true, items: [] };
        if (message.type === 'ORDER_HISTORY') return { success: true, orders: [] };
        return { success: true, items: [], orders: [] };
      }
    },
    fetch: async (url, options = {}) => {
      requestedUrls.push(String(url));
      if (String(url).includes('/api/plugin/config')) {
        return { async json() { return { idleSyncIntervalMinutes: 0 }; } };
      }
      if (String(url).includes('/api/plugin/idle-action/next')) {
        return {
          async json() {
            return {
              success: true,
              action: 'transaction_start',
              config: { transactionStartRequested: 0 }
            };
          }
        };
      }
      if (String(url).includes('/api/plugin/transaction-start/jobs')) {
        return {
          async json() {
            return {
              success: true,
              storeUpdated: 3,
              jobs: [{
                orderId: 9,
                productId: 'n9',
                transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=n9',
                shippingFeeText: '800\u5186'
              }]
            };
          }
        };
      }
      if (String(url).includes('/api/plugin/idle-action/complete')) {
        completedActions.push(JSON.parse(options.body || '{}').action);
      }
      return { async json() { return { success: true }; } };
    }
  });

  await api.syncIdleYahooPages();

  assert.equal(requestedUrls.some(url => url.includes('/api/plugin/transaction-start/jobs')), true);
  assert.deepEqual(completedActions, ['transaction_start']);
  assert.equal(createdTransactionTab, false);
}

async function testRunTransactionStartMarksAlreadyWaitingShippingPageWaitingShipping() {
  const statusCalls = [];
  const clickedActions = [];
  const api = loadBackgroundForTest({
    disableAutoStart: true,
    tabs: {
      async create(urlOrOptions) {
        const url = typeof urlOrOptions === 'string' ? urlOrOptions : urlOrOptions?.url;
        return { id: 41, url, status: 'complete', windowId: 3 };
      },
      async get(id) {
        return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=j1232375474', status: 'complete', windowId: 3 };
      },
      async update(id, props) {
        return { id, url: props?.url || 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=j1232375474', status: 'complete', windowId: 3 };
      },
      async query() {
        return [{ id: 41, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=j1232375474', status: 'complete', windowId: 3 }];
      },
      async sendMessage(id, message) {
        if (message.type === 'EXTRACT_TRANSACTION_START_INFO') {
          return { success: true, loginStatus: { status: 'ok' }, info: { available: false } };
        }
        if (message.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
          return {
            success: true,
            state: {
              waitingShipping: true,
              complete: false,
              url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=j1232375474'
            }
          };
        }
        if (message.type === 'CLICK_BUNDLE_TRANSACTION_ACTION') {
          clickedActions.push(message.action);
          return { success: false, error: 'transaction start should not click when already waiting shipping' };
        }
        return { success: true };
      },
      async remove() {}
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/transaction-start/jobs')) {
        return {
          async json() {
            return {
              success: true,
              jobs: [{
                orderId: 77,
                productId: 'j1232375474',
                productType: 'normal',
                transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=j1232375474',
                shippingFeeText: '\u843d\u672d\u8005\u8ca0\u62c5'
              }]
            };
          }
        };
      }
      if (String(url).includes('/api/plugin/transaction-start/status')) {
        statusCalls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true, updated: 1 }; } };
      }
      return { async json() { return { success: true }; } };
    }
  });

  await api.runTransactionStartJobs();

  assert.deepEqual(clickedActions, []);
  assert.equal(statusCalls.length, 1);
  assert.equal(statusCalls[0].orderId, 77);
  assert.equal(statusCalls[0].status, 'waiting_shipping');
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

async function testRunPaymentJobsCompletesNormalItemPaymentAfterTransactionInfoInput() {
  const calls = [];
  const actions = [];
  const states = [
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/top', hasTransactionInfoInputButton: true } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/input', hasTransactionDecideButton: true } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/input', hasTransactionConfirmButton: true } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/top', hasEasyPaymentButton: true, paymentAmountJpy: 185 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', hasReviewButton: true, paymentAmountJpy: 185 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/confirm', hasFinalizeButton: true, paymentAmountJpy: 185 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/complete', complete: true } }
  ];
  const api = loadBackgroundForTest({
    tabs: {
      async create() { return { id: 12, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async get(id) { return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async query() { return [{ id: 12, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        if (payload.files) return undefined;
        if (payload.args && payload.args.length) {
          actions.push(payload.args[1]);
          return [{ result: { success: true, text: 'clicked' } }];
        }
        return [{ result: states.shift() || { success: true, state: { complete: true } } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 12, productId: 'p12', transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/top', finalPrice: 75, effectiveShippingFeeText: '110\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.deepEqual(actions, ['transactionInfoInput', 'transactionDecide', 'transactionConfirm', 'easyPayment', 'review', 'finalize']);
  assert.equal(calls[0].orderId, 12);
  assert.equal(calls[0].productId, 'p12');
  assert.equal(calls[0].status, 'success');
}

async function testRunPaymentJobsClicksPlacementOkAfterTransactionInfoInput() {
  const calls = [];
  const actions = [];
  const states = [
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/top', hasTransactionInfoInputButton: true } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/input', hasPlacementOkButton: true } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/input', hasTransactionDecideButton: true } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/input', hasTransactionConfirmButton: true } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/top', hasEasyPaymentButton: true, paymentAmountJpy: 185 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', hasReviewButton: true, paymentAmountJpy: 185 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/confirm', hasFinalizeButton: true, paymentAmountJpy: 185 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/complete', complete: true } }
  ];
  const api = loadBackgroundForTest({
    tabs: {
      async create() { return { id: 13, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async get(id) { return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async query() { return [{ id: 13, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        if (payload.files) return undefined;
        if (payload.args && payload.args.length) {
          actions.push(payload.args[1]);
          return [{ result: { success: true, text: 'clicked' } }];
        }
        return [{ result: states.shift() || { success: true, state: { complete: true } } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 13, productId: 'p13', transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/top', finalPrice: 75, effectiveShippingFeeText: '110\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.deepEqual(actions, ['transactionInfoInput', 'placementOk', 'transactionDecide', 'transactionConfirm', 'easyPayment', 'review', 'finalize']);
  assert.equal(calls[0].orderId, 13);
  assert.equal(calls[0].status, 'success');
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

async function testRunPaymentJobsCompletesStoreItemAfterPurchaseProcedure() {
  const calls = [];
  const actions = [];
  const states = [
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=s1', hasPurchaseProcedureButton: true } },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/confirm?auctionId=s1', hasReviewButton: true, paymentAmountJpy: 1760 } },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/payment/confirm?auctionId=s1', hasFinalizeButton: true, paymentAmountJpy: 1760 } },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/thank-you?auctionId=s1', complete: true } }
  ];
  const api = loadBackgroundForTest({
    tabs: {
      async create() { return { id: 14, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=s1', status: 'complete' }; },
      async get(id) { return { id, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=s1', status: 'complete' }; },
      async query() { return [{ id: 14, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=s1', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        if (payload.files) return undefined;
        if (payload.args && payload.args.length) {
          actions.push(payload.args[1]);
          return [{ result: { success: true, text: 'clicked' } }];
        }
        return [{ result: states.shift() || { success: true, state: { complete: true } } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 14, productId: 's1', productType: 'store', transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=s1', finalPrice: 1760, effectiveShippingFeeText: '0\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.deepEqual(actions, ['purchaseProcedure', 'review', 'finalize']);
  assert.equal(calls[0].orderId, 14);
  assert.equal(calls[0].productId, 's1');
  assert.equal(calls[0].status, 'success');
}

async function testRunPaymentJobsUsesSinglePurchaseForStoreBundlePage() {
  const calls = [];
  const actions = [];
  const states = [
    {
      success: true,
      state: {
        url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=x1231583550',
        hasStoreBundlePurchaseNotice: true,
        hasPaymentCloseButton: true,
        hasSinglePurchaseProcedureButton: true
      }
    },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=x1231583550', hasSinglePurchaseProcedureButton: true } },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/confirm?auctionId=x1231583550', hasReviewButton: true, paymentAmountJpy: 28172 } },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/payment/confirm?auctionId=x1231583550', hasFinalizeButton: true, paymentAmountJpy: 28172 } },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/thank-you?auctionId=x1231583550', complete: true } }
  ];
  const api = loadBackgroundForTest({
    tabs: {
      async create() { return { id: 16, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=x1231583550', status: 'complete' }; },
      async get(id) { return { id, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=x1231583550', status: 'complete' }; },
      async query() { return [{ id: 16, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=x1231583550', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        if (payload.files) return undefined;
        if (payload.args && payload.args.length) {
          actions.push(payload.args[1]);
          return [{ result: { success: true, text: 'clicked' } }];
        }
        return [{ result: states.shift() || { success: true, state: { complete: true } } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 16, productId: 'x1231583550', productType: 'store', transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=x1231583550', finalPrice: 28172, effectiveShippingFeeText: '0\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.deepEqual(actions, ['paymentClose', 'singlePurchaseProcedure', 'review', 'finalize']);
  assert.equal(calls[0].orderId, 16);
  assert.equal(calls[0].productId, 'x1231583550');
  assert.equal(calls[0].status, 'success');
}

async function testRunPaymentJobsContinuesNormalEntryAfterStorePurchaseProcedure() {
  const calls = [];
  const actions = [];
  const states = [
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=s2', hasPurchaseProcedureButton: true } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=s2', hasEasyPaymentButton: true, paymentAmountJpy: 2760 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase?aid=s2', hasReviewButton: true, paymentAmountJpy: 2760 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/confirm?aid=s2', hasFinalizeButton: true, paymentAmountJpy: 2760 } },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/thank-you?auctionId=s2', complete: true } }
  ];
  const api = loadBackgroundForTest({
    tabs: {
      async create() { return { id: 15, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=s2', status: 'complete' }; },
      async get(id) { return { id, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=s2', status: 'complete' }; },
      async query() { return [{ id: 15, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=s2', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        if (payload.files) return undefined;
        if (payload.args && payload.args.length) {
          actions.push(payload.args[1]);
          return [{ result: { success: true, text: 'clicked' } }];
        }
        return [{ result: states.shift() || { success: true, state: { complete: true } } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 15, productId: 's2', productType: 'store', transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=s2', finalPrice: 1760, effectiveShippingFeeText: '1000\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.deepEqual(actions, ['purchaseProcedure', 'easyPayment', 'review', 'finalize']);
  assert.equal(calls[0].orderId, 15);
  assert.equal(calls[0].productId, 's2');
  assert.equal(calls[0].status, 'success');
}

async function testRunPaymentJobsWaitsRandomSecondsBeforeFinalizeAndIgnoresProcessingPage() {
  const calls = [];
  const actions = [];
  const sleeps = [];
  const states = [
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/top', hasEasyPaymentButton: true, paymentAmountJpy: 4330 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', hasReviewButton: true, paymentAmountJpy: 4330 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/confirm', hasFinalizeButton: true, paymentAmountJpy: 4330 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/confirm', processing: true } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/complete', complete: true } }
  ];
  const api = loadBackgroundForTest({
    random: () => 0.75,
    setTimeout(fn, ms) {
      sleeps.push({ ms, actions: [...actions] });
      fn();
      return 1;
    },
    tabs: {
      async create() { return { id: 16, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async get(id) { return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async query() { return [{ id: 16, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        if (payload.files) return undefined;
        if (payload.args && payload.args.length) {
          actions.push(payload.args[1]);
          return [{ result: { success: true, text: 'clicked' } }];
        }
        return [{ result: states.shift() || { success: true, state: { complete: true } } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 3, jobs: [{ orderId: 16, productId: 'p16', transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/top', finalPrice: 3450, effectiveShippingFeeText: '880\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.deepEqual(actions, ['easyPayment', 'review', 'finalize']);
  assert.equal(sleeps.some(item => item.ms === 3000 && item.actions.join(',') === 'easyPayment,review'), true);
  assert.equal(calls[0].status, 'success');
}

async function testRunConfirmReceiptJobsCompletesStoreItemWithoutOpeningTab() {
  const calls = [];
  let openedTab = false;
  const api = loadBackgroundForTest({
    tabs: {
      async create() {
        openedTab = true;
        return { id: 31, status: 'complete' };
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/confirm-receipt/jobs')) {
        return { async json() { return { success: true, jobs: [{ orderId: 31, productId: 's31', productType: 'store', bundleGroupId: '' }] }; } };
      }
      if (String(url).includes('/api/plugin/confirm-receipt/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true, updated: 1 }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runConfirmReceiptJobs();

  assert.equal(openedTab, false);
  assert.deepEqual(calls[0], { orderId: 31, productId: 's31', status: 'success', bundleGroupId: '' });
}

async function testRunConfirmReceiptJobsWaitsForEnabledReceiveButton() {
  const statusCalls = [];
  const sentDebuggerCommands = [];
  let scriptCall = 0;
  const snapshots = [
    {
      bodyText: '商品を受け取りました。 受け取り連絡',
      controls: ['受け取り連絡'],
      hasReceiptCheckbox: true,
      hasReceiptCheckboxChecked: false,
      hasReceiptSubmitButton: false,
      receiptSubmitButtonDisabled: true
    },
    {
      bodyText: '商品を受け取りました。 受け取り連絡',
      controls: ['受け取り連絡'],
      hasReceiptCheckbox: true,
      hasReceiptCheckboxChecked: false,
      hasReceiptSubmitButton: false,
      receiptSubmitButtonDisabled: true
    },
    {
      bodyText: '商品を受け取りました。 受け取り連絡',
      controls: ['受け取り連絡'],
      hasReceiptCheckbox: true,
      hasReceiptCheckboxChecked: true,
      hasReceiptSubmitButton: true,
      receiptSubmitButtonDisabled: false
    },
    {
      bodyText: 'すべての取引が完了しました',
      controls: [],
      hasReceiptCheckbox: false,
      hasReceiptCheckboxChecked: false,
      hasReceiptSubmitButton: false,
      receiptSubmitButtonDisabled: false
    }
  ];
  const api = loadBackgroundForTest({
    sleep: async () => {},
    tabs: {
      async create() { return { id: 32, windowId: 5, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async get(id) { return { id, windowId: 5, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async query() { return [{ id: 32, windowId: 5, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }]; },
      async update(id) { return { id, windowId: 5, status: 'complete' }; }
    },
    debuggerApi: {
      async attach() {},
      async sendCommand(target, command, params) {
        sentDebuggerCommands.push({ command, params });
      },
      async detach() {}
    },
    windows: {
      async update() {}
    },
    scripting: {
      async executeScript(payload = {}) {
        if (payload.files) return undefined;
        scriptCall += 1;
        if (scriptCall === 2) return [{ result: { success: true } }];
        if (scriptCall === 4) return [{ result: { success: true, x: 42, y: 24, text: '商品を受け取りました。' } }];
        if (scriptCall === 6) return [{ result: { success: true, method: 'click', text: '受け取り連絡' } }];
        const snapshot = snapshots.shift();
        return [{ result: { success: true, snapshot } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/confirm-receipt/jobs')) {
        return {
          async json() {
            return {
              success: true,
              jobs: [{
                orderId: 32,
                productId: 'x1226734300',
                productType: 'normal',
                transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/top',
                bundleGroupId: ''
              }]
            };
          }
        };
      }
      if (String(url).includes('/api/plugin/confirm-receipt/status')) {
        statusCalls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true, updated: 1 }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runConfirmReceiptJobs();

  assert.equal(statusCalls[0].status, 'success');
  assert.equal(statusCalls[0].productId, 'x1226734300');
  assert.equal(sentDebuggerCommands.some(item => item.command === 'Input.dispatchMouseEvent'), true);
}

async function testRunPaymentJobsSelectsExpectedShippingBeforeReview() {
  const calls = [];
  const actions = [];
  let expandedShipping = false;
  const selectedShippingAmounts = [];
  const states = [
    {
      success: true,
      state: {
        url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase',
        hasReviewButton: true,
        paymentAmountJpy: 910,
        textSample: '\u304a\u652f\u6255\u3044\u65b9\u6cd5 \u30b3\u30f3\u30d3\u30cb\uff08\u30bb\u30d6\u30f3-\u30a4\u30ec\u30d6\u30f3\uff09 \u624b\u6570\u6599330\u5186',
        selectedShippingAmountJpy: 230,
        shippingOptions: []
      }
    },
    {
      success: true,
      state: {
        url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase',
        hasReviewButton: true,
        paymentAmountJpy: 535,
        textSample: '\u914d\u9001\u65b9\u6cd5 \u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8 185\u5186',
        selectedShippingAmountJpy: 185,
        shippingOptions: [
          { amountJpy: 230, checked: false, disabled: false },
          { amountJpy: 185, checked: true, disabled: false }
        ]
      }
    },
    {
      success: true,
      state: {
        url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase',
        hasReviewButton: true,
        paymentAmountJpy: 535,
        textSample: '\u914d\u9001\u65b9\u6cd5 \u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8 185\u5186',
        selectedShippingAmountJpy: 185,
        shippingOptions: [
          { amountJpy: 230, checked: false, disabled: false },
          { amountJpy: 185, checked: true, disabled: false }
        ]
      }
    },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/confirm', hasFinalizeButton: true, paymentAmountJpy: 535 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/complete', complete: true } }
  ];
  const api = loadBackgroundForTest({
    sleep: async () => {},
    tabs: {
      async create() { return { id: 18, url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', status: 'complete' }; },
      async get(id) { return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', status: 'complete' }; },
      async query() { return [{ id: 18, url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        if (payload.files) return undefined;
        if (!payload.args && String(payload.func || '').includes('shipping change button not found')) {
          expandedShipping = true;
          return [{ result: { success: true, changed: true, text: '\u5909\u66f4\u3059\u308b' } }];
        }
        if (payload.args && payload.args.length === 1 && typeof payload.args[0] === 'number') {
          selectedShippingAmounts.push(payload.args[0]);
          return [{ result: { success: true, changed: true, selectedShippingJpy: payload.args[0] } }];
        }
        if (payload.args && payload.args.length >= 2) {
          actions.push(payload.args[1]);
          return [{ result: { success: true, text: 'clicked' } }];
        }
        return [{ result: states.shift() || { success: true, state: { complete: true } } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 18, productId: 'u1231877298', transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', finalPrice: 350, effectiveShippingFeeText: '185\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.equal(expandedShipping, true);
  assert.deepEqual(selectedShippingAmounts, [185]);
  assert.deepEqual(actions, ['review', 'finalize']);
  assert.equal(calls[0].orderId, 18);
  assert.equal(calls[0].status, 'success');
}

async function testRunPaymentJobsWaitsForSlowReviewButtonOnPurchasePage() {
  const calls = [];
  const actions = [];
  const states = [
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', paymentAmountJpy: 4330 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', paymentAmountJpy: 4330 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', hasReviewButton: true, paymentAmountJpy: 4330 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/confirm', hasFinalizeButton: true, paymentAmountJpy: 4330 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/complete', complete: true } }
  ];
  const api = loadBackgroundForTest({
    sleep: async () => {},
    tabs: {
      async create() { return { id: 17, url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', status: 'complete' }; },
      async get(id) { return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', status: 'complete' }; },
      async query() { return [{ id: 17, url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        if (payload.files) return undefined;
        if (payload.args && payload.args.length) {
          actions.push(payload.args[1]);
          return [{ result: { success: true, text: 'clicked' } }];
        }
        return [{ result: states.shift() || { success: true, state: { complete: true } } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 17, productId: 'p17', transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', finalPrice: 3450, effectiveShippingFeeText: '880\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.deepEqual(actions, ['review', 'finalize']);
  assert.equal(calls[0].orderId, 17);
  assert.equal(calls[0].status, 'success');
}

async function testRunPaymentJobsWaitsForStoreReviewPageReadyBeforeConfirmClick() {
  const calls = [];
  const actions = [];
  let stateReads = 0;
  let stateReadsAtReviewClick = 0;
  const states = [
    {
      success: true,
      state: {
        url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1232862422',
        hasReviewButton: true,
        paymentAmountJpy: 20700,
        reviewPageReady: false,
        textSample: '\u8cfc\u5165 \u78ba\u8a8d\u3059\u308b'
      }
    },
    {
      success: true,
      state: {
        url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1232862422',
        hasReviewButton: true,
        paymentAmountJpy: 20700,
        reviewPageReady: false,
        textSample: '\u8cfc\u5165 \u304a\u652f\u6255\u3044\u65b9\u6cd5 \u78ba\u8a8d\u3059\u308b'
      }
    },
    {
      success: true,
      state: {
        url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1232862422',
        hasReviewButton: true,
        paymentAmountJpy: 20700,
        reviewPageReady: true,
        textSample: '\u304a\u652f\u6255\u3044\u65b9\u6cd5 \u5546\u54c1\u5408\u8a08 19,800\u5186 \u9001\u6599 900\u5186 \u304a\u652f\u6255\u3044\u91d1\u984d 20,700\u5186 \u78ba\u8a8d\u3059\u308b'
      }
    },
    {
      success: true,
      state: {
        url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1232862422',
        hasReviewButton: true,
        paymentAmountJpy: 20700,
        reviewPageReady: true,
        textSample: '\u304a\u652f\u6255\u3044\u65b9\u6cd5 \u5546\u54c1\u5408\u8a08 19,800\u5186 \u9001\u6599 900\u5186 \u304a\u652f\u6255\u3044\u91d1\u984d 20,700\u5186 \u78ba\u8a8d\u3059\u308b'
      }
    },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/confirm?auctionId=p1232862422', hasFinalizeButton: true, paymentAmountJpy: 20700 } },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/thank-you?auctionId=p1232862422', complete: true } }
  ];
  const api = loadBackgroundForTest({
    sleep: async () => {},
    tabs: {
      async create() { return { id: 21, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1232862422', status: 'complete' }; },
      async get(id) { return { id, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1232862422', status: 'complete' }; },
      async query() { return [{ id: 21, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1232862422', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        if (payload.files) return undefined;
        if (payload.args && payload.args.length) {
          actions.push(payload.args[1]);
          if (payload.args[1] === 'review') stateReadsAtReviewClick = stateReads;
          return [{ result: { success: true, text: 'clicked' } }];
        }
        stateReads += 1;
        return [{ result: states.shift() || { success: true, state: { complete: true } } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 21, productId: 'p1232862422', transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1232862422', finalPrice: 19800, effectiveShippingFeeText: '900\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.deepEqual(actions, ['review', 'finalize']);
  assert.equal(stateReadsAtReviewClick >= 4, true);
  assert.equal(calls[0].orderId, 21);
  assert.equal(calls[0].status, 'success');
}

async function testModernStoreReviewUsesSyntheticClickBeforeTrustedClick() {
  const calls = [];
  const actions = [];
  let trustedMouseCommands = 0;
  const states = [
    {
      success: true,
      state: {
        url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1232862422',
        hasReviewButton: true,
        paymentAmountJpy: 20700,
        reviewPageReady: true,
        textSample: '\u304a\u652f\u6255\u3044\u65b9\u6cd5 \u5546\u54c1\u5408\u8a08 19,800\u5186 \u9001\u6599 900\u5186 \u304a\u652f\u6255\u3044\u91d1\u984d 20,700\u5186 \u78ba\u8a8d\u3059\u308b'
      }
    },
    {
      success: true,
      state: {
        url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1232862422',
        hasReviewButton: true,
        paymentAmountJpy: 20700,
        reviewPageReady: true,
        textSample: '\u304a\u652f\u6255\u3044\u65b9\u6cd5 \u5546\u54c1\u5408\u8a08 19,800\u5186 \u9001\u6599 900\u5186 \u304a\u652f\u6255\u3044\u91d1\u984d 20,700\u5186 \u78ba\u8a8d\u3059\u308b'
      }
    },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/confirm?auctionId=p1232862422', hasFinalizeButton: true, paymentAmountJpy: 20700 } },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/thank-you?auctionId=p1232862422', complete: true } }
  ];
  const api = loadBackgroundForTest({
    sleep: async () => {},
    tabs: {
      async create() { return { id: 22, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1232862422', status: 'complete', windowId: 1 }; },
      async get(id) { return { id, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1232862422', status: 'complete', windowId: 1 }; },
      async update(id, info) { return { id, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1232862422', status: 'complete', windowId: 1, ...info }; },
      async query() { return [{ id: 22, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1232862422', status: 'complete', windowId: 1 }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        const funcText = String(payload.func || '');
        if (payload.files) return undefined;
        if (payload.args && payload.args.length >= 2) {
          if (funcText.includes('payment button has no clickable rect')) {
            return [{ result: { success: true, x: 752, y: 321, text: '\u78ba\u8a8d\u3059\u308b', candidates: [] } }];
          }
          actions.push(payload.args[1]);
          return [{ result: { success: true, text: 'synthetic clicked' } }];
        }
        return [{ result: states.shift() || { success: true, state: { complete: true } } }];
      }
    },
    debuggerApi: {
      async attach() {},
      async sendCommand(target, command) {
        if (command === 'Input.dispatchMouseEvent') trustedMouseCommands += 1;
      },
      async detach() {}
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 22, productId: 'p1232862422', transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1232862422', finalPrice: 19800, effectiveShippingFeeText: '900\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.equal(actions.includes('review'), true);
  assert.equal(trustedMouseCommands, 0);
  assert.equal(calls[0].orderId, 22);
  assert.equal(calls[0].status, 'success');
}

async function testModernStoreReviewRetriesSyntheticClickAfterFiveSeconds() {
  const calls = [];
  const actions = [];
  let trustedMouseCommands = 0;
  let syntheticReviewClicks = 0;
  let now = 0;
  let finalized = false;
  const reviewState = {
    url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1232862422',
    hasReviewButton: true,
    paymentAmountJpy: 20700,
    reviewPageReady: true,
    textSample: '\u304a\u652f\u6255\u3044\u65b9\u6cd5 \u5546\u54c1\u5408\u8a08 19,800\u5186 \u9001\u6599 900\u5186 \u304a\u652f\u6255\u3044\u91d1\u984d 20,700\u5186 \u78ba\u8a8d\u3059\u308b'
  };
  const api = loadBackgroundForTest({
    disableAutoStart: true,
    now: () => now,
    sleep: async ms => { now += ms || 0; },
    tabs: {
      async create() { return { id: 23, url: reviewState.url, status: 'complete', windowId: 1 }; },
      async get(id) { return { id, url: syntheticReviewClicks >= 2 ? 'https://buy.auctions.yahoo.co.jp/order/confirm?auctionId=p1232862422' : reviewState.url, status: 'complete', windowId: 1 }; },
      async update(id, info) { return { id, url: reviewState.url, status: 'complete', windowId: 1, ...info }; },
      async query() { return [{ id: 23, url: syntheticReviewClicks >= 2 ? 'https://buy.auctions.yahoo.co.jp/order/confirm?auctionId=p1232862422' : reviewState.url, status: 'complete', windowId: 1 }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        const funcText = String(payload.func || '');
        if (payload.files) return undefined;
        if (payload.args && payload.args.length >= 2) {
          if (funcText.includes('payment button has no clickable rect')) {
            return [{ result: { success: true, x: 752, y: 321, text: '\u78ba\u8a8d\u3059\u308b', candidates: [] } }];
          }
          actions.push(payload.args[1]);
          if (payload.args[1] === 'review') syntheticReviewClicks += 1;
          if (payload.args[1] === 'finalize') finalized = true;
          return [{ result: { success: true, text: 'synthetic clicked' } }];
        }
        if (finalized) {
          return [{ result: { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/thank-you?auctionId=p1232862422', complete: true } } }];
        }
        if (syntheticReviewClicks >= 2) {
          return [{ result: { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/confirm?auctionId=p1232862422', hasFinalizeButton: true, paymentAmountJpy: 20700 } } }];
        }
        return [{ result: { success: true, state: reviewState } }];
      }
    },
    debuggerApi: {
      async attach() {},
      async sendCommand(target, command) {
        if (command === 'Input.dispatchMouseEvent') trustedMouseCommands += 1;
      },
      async detach() {}
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 23, productId: 'p1232862422', transactionUrl: reviewState.url, finalPrice: 19800, effectiveShippingFeeText: '900\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.equal(actions.filter(action => action === 'review').length >= 2, true);
  assert.equal(trustedMouseCommands, 0);
  assert.equal(calls[0].orderId, 23);
  assert.equal(calls[0].status, 'success');
}

async function testRunPaymentJobsCompletesStoreConfirmationBeforeReview() {
  const calls = [];
  const actions = [];
  let storeApplyChecks = 0;
  let storeApplySubmits = 0;
  let trustedMouseCommands = 0;
  const tabUpdates = [];
  const states = [
    {
      success: true,
      state: {
        url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017',
        hasReviewButton: true,
        hasStoreConfirmationSection: true,
        paymentAmountJpy: 43320
      }
    },
    {
      success: true,
      state: {
        url: 'https://buy.auctions.yahoo.co.jp/order/store-confirmation?auctionId=j1232680017',
        hasStoreConfirmationSection: true,
        hasStoreConfirmationEditPage: true,
        paymentAmountJpy: 41800
      }
    },
    {
      success: true,
      state: {
        url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017',
        hasReviewButton: true,
        hasStoreConfirmationSection: true,
        paymentAmountJpy: 43320
      }
    },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/confirm?auctionId=j1232680017', hasFinalizeButton: true, paymentAmountJpy: 43320 } },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/thank-you?auctionId=j1232680017', complete: true } }
  ];
  const api = loadBackgroundForTest({
    sleep: async () => {},
    tabs: {
      async create() { return { id: 19, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017', status: 'complete' }; },
      async get(id) { return { id, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017', status: 'complete' }; },
      async update(id, updateInfo) {
        tabUpdates.push({ id, updateInfo });
        return { id, url: updateInfo.url || 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017', status: 'complete' };
      },
      async query() { return [{ id: 19, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        const funcText = String(payload.func || '');
        if (payload.files) return undefined;
        if (funcText.includes('click point not found')) {
          return [{ result: { success: true, x: 700, y: 280, text: payload.args?.[0] === 'apply' ? '\u5909\u66f4\u3059\u308b' : '\u5909\u66f4' } }];
        }
        if (funcText.includes('store confirmation checkbox click points not found')) {
          return [{ result: { success: true, points: [
            { index: 0, checked: false, x: 118, y: 386, text: '\u4e86\u627f\u3057\u307e\u3057\u305f\u3002' },
            { index: 1, checked: false, x: 118, y: 474, text: '\u9818\u53ce\u66f8' }
          ] } }];
        }
        if (funcText.includes('hasSkeleton')) {
          return [{ result: { success: true, readyState: 'complete', checkboxCount: 2, checkedCount: 0, hasApplyButton: true, buttonText: '\u5909\u66f4\u3059\u308b', hasStoreOptionText: true, hasSkeleton: false, textLength: 300 } }];
        }
        if (funcText.includes('store confirmation apply button not found') && !funcText.includes('checkedCount')) {
          storeApplySubmits += 1;
          return [{ result: { success: true, text: '\u5909\u66f4\u3059\u308b' } }];
        }
        if (funcText.includes('store confirmation apply button not found')) {
          if (payload.args?.[0]) storeApplySubmits += 1;
          else storeApplyChecks += 1;
          return [{ result: { success: true, checkedCount: 2, text: '\u5909\u66f4\u3059\u308b', applyReady: !payload.args?.[0] } }];
        }
        if (payload.args && payload.args.length >= 2) {
          actions.push(payload.args[1]);
          return [{ result: { success: true, text: 'clicked' } }];
        }
        return [{ result: states.shift() || { success: true, state: { complete: true } } }];
      }
    },
    debuggerApi: {
      async attach() {},
      async sendCommand(target, command) {
        if (command === 'Input.dispatchMouseEvent') trustedMouseCommands += 1;
      },
      async detach() {}
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 19, productId: 'j1232680017', transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017', finalPrice: 41800, effectiveShippingFeeText: '1520\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.equal(storeApplyChecks, 0);
  assert.equal(storeApplySubmits, 1);
  assert.equal(trustedMouseCommands, 6);
  assert.equal(tabUpdates.some(call => call.updateInfo?.url === 'https://buy.auctions.yahoo.co.jp/order/change/store-options?auctionId=j1232680017'), true);
  assert.deepEqual(actions, ['review', 'finalize']);
  assert.equal(calls[0].orderId, 19);
  assert.equal(calls[0].status, 'success');
}

async function testRunPaymentJobsHandlesStoreConfirmationBeforeReviewButton() {
  const calls = [];
  let trustedMouseCommands = 0;
  let storeApplySubmits = 0;
  const tabUpdates = [];
  const states = [
    {
      success: true,
      state: {
        url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017',
        hasStoreConfirmationSection: true,
        paymentAmountJpy: 43320
      }
    },
    {
      success: true,
      state: {
        url: 'https://buy.auctions.yahoo.co.jp/order/store-confirmation?auctionId=j1232680017',
        hasStoreConfirmationSection: true,
        hasStoreConfirmationEditPage: true,
        paymentAmountJpy: 41800
      }
    },
    {
      success: true,
      state: {
        url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017',
        hasReviewButton: true,
        hasStoreConfirmationSection: true,
        paymentAmountJpy: 43320
      }
    },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/confirm?auctionId=j1232680017', hasFinalizeButton: true, paymentAmountJpy: 43320 } },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/thank-you?auctionId=j1232680017', complete: true } }
  ];
  const api = loadBackgroundForTest({
    sleep: async () => {},
    tabs: {
      async create() { return { id: 20, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017', status: 'complete' }; },
      async get(id) { return { id, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017', status: 'complete' }; },
      async update(id, updateInfo) {
        tabUpdates.push({ id, updateInfo });
        return { id, url: updateInfo.url || 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017', status: 'complete' };
      },
      async query() { return [{ id: 20, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        const funcText = String(payload.func || '');
        if (payload.files) return undefined;
        if (funcText.includes('click point not found')) {
          return [{ result: { success: true, x: 700, y: 280, text: payload.args?.[0] === 'apply' ? '\u5909\u66f4\u3059\u308b' : '\u5909\u66f4' } }];
        }
        if (funcText.includes('store confirmation checkbox click points not found')) {
          return [{ result: { success: true, points: [
            { index: 0, checked: false, x: 118, y: 386, text: '\u4e86\u627f\u3057\u307e\u3057\u305f\u3002' },
            { index: 1, checked: false, x: 118, y: 474, text: '\u9818\u53ce\u66f8' }
          ] } }];
        }
        if (funcText.includes('hasSkeleton')) {
          return [{ result: { success: true, readyState: 'complete', checkboxCount: 2, checkedCount: 0, hasApplyButton: true, buttonText: '\u5909\u66f4\u3059\u308b', hasStoreOptionText: true, hasSkeleton: false, textLength: 300 } }];
        }
        if (funcText.includes('store confirmation apply button not found') && !funcText.includes('checkedCount')) {
          storeApplySubmits += 1;
          return [{ result: { success: true, text: '\u5909\u66f4\u3059\u308b' } }];
        }
        if (funcText.includes('store confirmation apply button not found')) {
          if (payload.args?.[0]) storeApplySubmits += 1;
          return [{ result: { success: true, checkedCount: 2, text: '\u5909\u66f4\u3059\u308b', applyReady: !payload.args?.[0] } }];
        }
        if (payload.args && payload.args.length >= 2) {
          return [{ result: { success: true, text: 'clicked' } }];
        }
        return [{ result: states.shift() || { success: true, state: { complete: true } } }];
      }
    },
    debuggerApi: {
      async attach() {},
      async sendCommand(target, command) {
        if (command === 'Input.dispatchMouseEvent') trustedMouseCommands += 1;
      },
      async detach() {}
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 20, productId: 'j1232680017', transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017', finalPrice: 41800, effectiveShippingFeeText: '1520\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.equal(storeApplySubmits, 1);
  assert.equal(trustedMouseCommands, 6);
  assert.equal(tabUpdates.some(call => call.updateInfo?.url === 'https://buy.auctions.yahoo.co.jp/order/change/store-options?auctionId=j1232680017'), true);
  assert.equal(calls[0].orderId, 20);
  assert.equal(calls[0].status, 'success');
}

async function testPaymentTrustedClickPointFindsRoleButton() {
  const amountContainer = {
    textContent: 'お支払い金額（税込） 300円 確認する',
    value: '',
    title: '',
    getAttribute() { return ''; },
    parentElement: null,
    compareDocumentPosition() { return 4; },
    getBoundingClientRect() {
      return { left: 100, top: 180, width: 180, height: 20 };
    }
  };
  const fakeButton = {
    tagName: 'DIV',
    textContent: '確認する',
    value: '',
    title: '',
    parentElement: amountContainer,
    getAttribute(name) {
      if (name === 'role') return 'button';
      return name === 'aria-label' ? '' : null;
    },
    scrollIntoView() {},
    getBoundingClientRect() {
      return { left: 100, top: 200, width: 240, height: 48 };
    }
  };
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript(payload) {
        const result = vm.runInNewContext(`(${payload.func.toString()})(...args)`, {
          args: payload.args || [],
          document: {
            body: {},
            querySelectorAll(selector) {
              if (String(selector).startsWith('dt,')) return [amountContainer];
              assert.match(selector, /\[role="button"\]/);
              return [fakeButton];
            }
          }
        });
        return [{ result }];
      }
    }
  });

  const point = await api.getPaymentActionClickPoint(99, 'review');

  assert.equal(point.success, true);
  assert.equal(point.text, '確認する');
  assert.equal(point.x, 220);
  assert.equal(point.y, 224);
}

async function testPaymentTrustedClickPointSkipsHiddenConfirmAnchor() {
  const amountContainer = {
    textContent: 'お支払い金額（税込） 300円 確認する',
    value: '',
    title: '',
    getAttribute() { return ''; },
    parentElement: null,
    compareDocumentPosition() { return 4; },
    getBoundingClientRect() {
      return { left: 1036, top: 500, width: 180, height: 20 };
    }
  };
  const hiddenButton = {
    tagName: 'A',
    textContent: '確認する',
    value: '',
    title: '',
    href: '',
    parentElement: amountContainer,
    getAttribute(name) {
      if (name === 'data-cl-params') return '_cl_link:confirm;_cl_position:0;';
      return '';
    },
    scrollIntoView() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 0, height: 0 };
    }
  };
  const visibleButton = {
    tagName: 'A',
    textContent: '確認する',
    value: '',
    title: '',
    href: '',
    parentElement: amountContainer,
    getAttribute(name) {
      if (name === 'data-cl-params') return '_cl_link:confirm;_cl_position:1;';
      return '';
    },
    scrollIntoView() {},
    getBoundingClientRect() {
      return { left: 1036, top: 526, width: 284, height: 46 };
    }
  };
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript(payload) {
        const result = vm.runInNewContext(`(${payload.func.toString()})(...args)`, {
          args: payload.args || [],
          document: {
            body: {},
            querySelectorAll(selector) {
              if (String(selector).startsWith('dt,')) return [amountContainer];
              return [hiddenButton, visibleButton];
            }
          }
        });
        return [{ result }];
      }
    }
  });

  const point = await api.getPaymentActionClickPoint(99, 'review');

  assert.equal(point.success, true);
  assert.equal(point.text, '確認する');
  assert.equal(point.x, 1178);
  assert.equal(point.y, 549);
  assert.equal(point.rect.width, 284);
}

async function testPaymentReviewClickPointPrefersConfirmContainerOverPayPayBenefit() {
  const payPayBenefitSpan = {
    tagName: 'A',
    textContent: '確認する',
    value: '',
    title: '',
    href: '',
    disabled: false,
    getAttribute() { return ''; },
    closest(selector) {
      return selector === '#confirm' ? null : null;
    },
    scrollIntoView() {},
    getBoundingClientRect() {
      return { left: 335, top: 864, width: 288, height: 24 };
    }
  };
  const confirmContainer = { id: 'confirm' };
  const confirmAnchor = {
    tagName: 'A',
    textContent: '確認する',
    value: '',
    title: '',
    href: '',
    disabled: false,
    getAttribute(name) {
      if (name === 'data-cl-params') return '_cl_link:confirm;_cl_position:1;';
      return '';
    },
    closest(selector) {
      return selector === '#confirm' ? confirmContainer : null;
    },
    scrollIntoView() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 0, height: 0 };
    }
  };
  const confirmTextSpan = {
    tagName: 'SPAN',
    textContent: '確認する',
    value: '',
    title: '',
    href: '',
    disabled: false,
    getAttribute() { return ''; },
    closest(selector) {
      if (selector === '#confirm') return confirmContainer;
      if (selector.includes('button') || selector.includes('a')) return confirmAnchor;
      return null;
    },
    scrollIntoView() {},
    getBoundingClientRect() {
      return { left: 745, top: 531, width: 240, height: 37 };
    }
  };
  const amountLabel = {
    textContent: 'お支払い金額（税込）',
    value: '',
    title: '',
    getAttribute() { return ''; },
    compareDocumentPosition() { return 4; },
    getBoundingClientRect() {
      return { left: 745, top: 500, width: 160, height: 20 };
    }
  };
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript(payload) {
        const result = vm.runInNewContext(`(${payload.func.toString()})(...args)`, {
          args: payload.args || [],
          document: {
            querySelectorAll(selector) {
              if (String(selector).startsWith('dt,')) return [amountLabel];
              return [payPayBenefitSpan, confirmAnchor, confirmTextSpan];
            },
            querySelector(selector) {
              if (selector === '#confirm [data-cl-params*="_cl_link:confirm"]') return confirmAnchor;
              return null;
            }
          }
        });
        return [{ result }];
      }
    }
  });

  const point = await api.getPaymentActionClickPoint(99, 'review');

  assert.equal(point.success, true);
  assert.equal(point.text, '確認する');
  assert.equal(point.x, 865);
  assert.equal(point.y, 549.5);
  assert.equal(point.rect.left, 745);
}

async function testPaymentReviewClickPointUsesPaymentAmountContextFallback() {
  const payPayBenefitSpan = {
    tagName: 'SPAN',
    textContent: '確認する',
    value: '',
    title: '',
    href: '',
    disabled: false,
    parentElement: null,
    getAttribute() { return ''; },
    closest() { return null; },
    scrollIntoView() {},
    getBoundingClientRect() {
      return { left: 335, top: 864, width: 288, height: 24 };
    }
  };
  const amountContainer = {
    textContent: 'お支払い金額（税込） 300円 確認する',
    value: '',
    title: '',
    getAttribute() { return ''; },
    parentElement: null
  };
  const amountLabel = {
    textContent: 'お支払い金額（税込）',
    value: '',
    title: '',
    getAttribute() { return ''; },
    compareDocumentPosition() { return 4; },
    getBoundingClientRect() {
      return { left: 745, top: 500, width: 160, height: 20 };
    }
  };
  const orderConfirmSpan = {
    tagName: 'A',
    textContent: '確認する',
    value: '',
    title: '',
    href: '',
    disabled: false,
    parentElement: amountContainer,
    getAttribute() { return ''; },
    closest() { return null; },
    scrollIntoView() {},
    getBoundingClientRect() {
      return { left: 745, top: 531, width: 240, height: 37 };
    }
  };
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript(payload) {
        const result = vm.runInNewContext(`(${payload.func.toString()})(...args)`, {
          args: payload.args || [],
          document: {
            body: {},
            querySelectorAll(selector) {
              if (String(selector).startsWith('dt,')) return [amountLabel];
              return [payPayBenefitSpan, orderConfirmSpan];
            }
          }
        });
        return [{ result }];
      }
    }
  });

  const point = await api.getPaymentActionClickPoint(99, 'review');

  assert.equal(point.success, true);
  assert.equal(point.x, 865);
  assert.equal(point.rect.left, 745);
}

async function testPaymentReviewClickPointDoesNotFallbackToPayPayBenefit() {
  const outerPaymentPage = {
    textContent: 'お支払い金額（税込） 300円 PayPayカード入会特典 確認する',
    parentElement: null
  };
  const amountLabel = {
    textContent: 'お支払い金額（税込）',
    value: '',
    title: '',
    parentElement: outerPaymentPage,
    getAttribute() { return ''; },
    compareDocumentPosition() { return 4; },
    getBoundingClientRect() {
      return { left: 745, top: 500, width: 160, height: 20 };
    }
  };
  const payPayBenefitSpan = {
    tagName: 'SPAN',
    textContent: '確認する',
    value: '',
    title: '',
    href: '',
    disabled: false,
    parentElement: outerPaymentPage,
    getAttribute() { return ''; },
    closest() { return null; },
    scrollIntoView() {},
    getBoundingClientRect() {
      return { left: 335, top: 864, width: 288, height: 24 };
    }
  };
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript(payload) {
        const result = vm.runInNewContext(`(${payload.func.toString()})(...args)`, {
          args: payload.args || [],
          document: {
            body: {},
            querySelectorAll(selector) {
              if (String(selector).startsWith('dt,')) return [amountLabel, outerPaymentPage];
              return [payPayBenefitSpan];
            }
          }
        });
        return [{ result }];
      }
    }
  });

  const point = await api.getPaymentActionClickPoint(99, 'review');

  assert.equal(point.success, false);
  assert.match(point.error, /payment review button not found/);
}

async function testPaymentShippingChangeClickPointFindsButtonAfterHeaderSibling() {
  const makeElement = (order, text, rect = null) => ({
    order,
    textContent: text,
    value: '',
    title: '',
    disabled: false,
    href: '',
    getAttribute() { return ''; },
    scrollIntoView() {},
    compareDocumentPosition(other) {
      return this.order < other.order ? 4 : 0;
    },
    getBoundingClientRect() {
      return rect || { left: 0, top: 0, width: 0, height: 0 };
    }
  });
  const shippingHeader = makeElement(10, '\u914d\u9001\u65b9\u6cd5');
  const changeButton = makeElement(20, '\u5909\u66f4\u3059\u308b', { left: 752, top: 350, width: 108, height: 38 });
  const nextSection = makeElement(30, '\u843d\u672d\u8005\u60c5\u5831');
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript(payload) {
        const result = vm.runInNewContext(`(${payload.func.toString()})()`, {
          Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
          document: {
            querySelectorAll(selector) {
              if (String(selector).startsWith('button')) return [changeButton];
              return [shippingHeader, nextSection];
            }
          }
        });
        return [{ result }];
      }
    }
  });

  const point = await api.getPaymentShippingChangeClickPoint(99);

  assert.equal(point.success, true);
  assert.equal(point.text, '\u5909\u66f4\u3059\u308b');
  assert.equal(point.x, 806);
  assert.equal(point.y, 369);
}

async function testPaymentShippingChangeClickPointUsesShippingSectionRoleButton() {
  const makeElement = (text, rect = null) => ({
    textContent: text,
    value: '',
    title: '',
    disabled: false,
    href: '',
    getAttribute(name) {
      return name === 'role' && rect ? 'button' : '';
    },
    closest(selector) {
      return selector.includes('[role="button"]') && rect ? this : null;
    },
    scrollIntoView() {},
    getBoundingClientRect() {
      return rect || { left: 0, top: 0, width: 0, height: 0 };
    }
  });
  const sectionTitle = makeElement('\u914d\u9001\u65b9\u6cd5');
  const otherChange = makeElement('\u5909\u66f4\u3059\u308b', { left: 10, top: 20, width: 50, height: 20 });
  const shippingRoleButton = makeElement('\u304a\u3066\u304c\u308b\u914d\u9001 \u3086\u3046\u30d1\u30b1\u30c3\u30c8 230\u5186 \u5909\u66f4\u3059\u308b', { left: 700, top: 340, width: 160, height: 48 });
  const shippingChangeSpan = {
    ...makeElement('\u5909\u66f4\u3059\u308b'),
    closest(selector) {
      return selector.includes('[role="button"]') ? shippingRoleButton : null;
    }
  };
  const shippingSection = {
    querySelectorAll(selector) {
      if (String(selector).includes('h1')) return [sectionTitle, shippingChangeSpan];
      return [shippingRoleButton, shippingChangeSpan];
    }
  };
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript(payload) {
        const result = vm.runInNewContext(`(${payload.func.toString()})()`, {
          Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
          document: {
            querySelectorAll(selector) {
              if (selector === 'section') return [shippingSection];
              if (String(selector).startsWith('button')) return [otherChange, shippingRoleButton, shippingChangeSpan];
              return [sectionTitle];
            }
          }
        });
        return [{ result }];
      }
    }
  });

  const point = await api.getPaymentShippingChangeClickPoint(99);

  assert.equal(point.success, true);
  assert.equal(point.text, '\u304a\u3066\u304c\u308b\u914d\u9001 \u3086\u3046\u30d1\u30b1\u30c3\u30c8 230\u5186 \u5909\u66f4\u3059\u308b');
  assert.equal(point.x, 780);
  assert.equal(point.y, 364);
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

function testManualCaptchaTabDetection() {
  const api = loadBackgroundForTest();

  assert.equal(api.isManualCaptchaTab({ url: 'https://login.yahoo.co.jp/ncaptcha?fido=1' }), true);
  assert.equal(api.isManualCaptchaTab({ url: 'https://login.yahoo.co.jp/config/login?.src=auc' }), false);
  assert.equal(api.isManualCaptchaTab({ url: 'https://contact.auctions.yahoo.co.jp/buyer/top' }), false);
}

function testLikelyManualPinTabDetection() {
  const api = loadBackgroundForTest();

  assert.equal(api.isLikelyManualPinTab({ url: 'https://login.yahoo.co.jp/config/verify?.src=pay' }), true);
  assert.equal(api.isLikelyManualPinTab({ url: 'https://login.yahoo.co.jp/config/login?auth_lv=1&done=https%3A%2F%2Fcontact.auctions.yahoo.co.jp%2Fbuyer%2Ftop%3Faid%3Dj1230839418' }), true);
  assert.equal(api.isLikelyManualPinTab({ url: 'https://account.edit.yahoo.co.jp/verify' }), true);
  assert.equal(api.isLikelyManualPinTab({ url: 'https://contact.auctions.yahoo.co.jp/buyer/top' }), false);
  assert.equal(api.isLikelyManualPinTab({ url: 'https://login.yahoo.co.jp/ncaptcha?fido=1' }), false);
}

async function testIdleSyncSkipsNonBidWorkWhenManualPinTabExists() {
  const removed = [];
  const fetchCalls = [];
  const api = loadBackgroundForTest({
    tabs: {
      async query() {
        return [
          { id: 21, url: 'https://login.yahoo.co.jp/config/login?auth_lv=1&done=https%3A%2F%2Fcontact.auctions.yahoo.co.jp%2Fbuyer%2Ftop%3Faid%3Dj1230839418', status: 'complete', active: true },
          { id: 22, url: 'https://login.yahoo.co.jp/config/verify?.src=pay', status: 'complete' },
          { id: 23, url: 'https://example.com/' }
        ];
      },
      async remove(id) {
        removed.push(id);
      }
    },
    fetch: async (url) => {
      fetchCalls.push(String(url));
      if (String(url).includes('/api/plugin/config')) {
        return { async json() { return { idleSyncIntervalMinutes: 1 }; } };
      }
      if (String(url).includes('/api/plugin/idle-action/next')) {
        throw new Error('idle action should not be fetched while PIN is open');
      }
      return { async json() { return { task: null, canIdleSync: true }; } };
    }
  });

  await api.syncIdleYahooPages();

  assert.deepEqual([...new Set(removed)], [22]);
  assert.equal(fetchCalls.some(url => url.includes('/api/plugin/idle-action/next')), false);
}

async function testIdleSyncStaysPausedDuringCaptchaAfterPinFlowStarts() {
  let phase = 'pin';
  const fetchCalls = [];
  const api = loadBackgroundForTest({
    tabs: {
      async query() {
        if (phase === 'pin') {
          return [
            { id: 21, url: 'https://login.yahoo.co.jp/config/login?auth_lv=1&done=https%3A%2F%2Fcontact.auctions.yahoo.co.jp%2Fbuyer%2Ftop%3Faid%3Dj1230839418', status: 'complete', active: true }
          ];
        }
        return [
          { id: 21, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1', status: 'complete', active: true }
        ];
      }
    },
    fetch: async (url) => {
      fetchCalls.push(String(url));
      if (String(url).includes('/api/plugin/config')) {
        return { async json() { return { idleSyncIntervalMinutes: 1 }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/challenge')) {
        return { async json() { return { success: true }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/answer/')) {
        return { async json() { return { answered: true, answer: 'abcd' }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/close')) {
        return { async json() { return { success: true }; } };
      }
      if (String(url).includes('/api/plugin/idle-action/next')) {
        throw new Error('idle action should not be fetched during manual verification flow');
      }
      return { async json() { return { task: null, canIdleSync: true }; } };
    }
  });

  await api.syncIdleYahooPages();
  phase = 'captcha';
  await api.syncIdleYahooPages();

  assert.equal(fetchCalls.some(url => url.includes('/api/plugin/idle-action/next')), false);
}

async function testIdleSyncPostsCaptchaWhenManualCaptchaTabAlreadyOpen() {
  const challengeTypes = [];
  let captchaDone = false;
  const api = loadBackgroundForTest({
    tabs: {
      async query() {
        if (captchaDone) return [];
        return [
          { id: 21, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=abc', status: 'complete', active: true, windowId: 3 },
          { id: 22, url: 'https://login.yahoo.co.jp/config/login?auth_lv=1&done=https%3A%2F%2Faucpay.yahoo.co.jp%2Fdetail-front%2FPaymentDetailItem', status: 'complete', active: false, windowId: 3 }
        ];
      },
      async get(id) {
        if (captchaDone) return { id, url: 'https://aucpay.yahoo.co.jp/detail-front/PaymentDetailItem', status: 'complete', active: true, windowId: 3 };
        if (id === 21) return { id: 21, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=abc', status: 'complete', active: true, windowId: 3 };
        return { id, url: 'https://login.yahoo.co.jp/config/login?auth_lv=1', status: 'complete', windowId: 3 };
      },
      async update(id, props) {
        return { id, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=abc', status: 'complete', active: props?.active, windowId: 3 };
      },
      async captureVisibleTab() {
        return 'data:image/png;base64,abc';
      }
    },
    scripting: {
      async executeScript(payload) {
        if (payload.files) return undefined;
        if (String(payload.func || '').includes('captchaAnswer')) {
          captchaDone = true;
          return [{ result: { success: true } }];
        }
        return [{ result: { success: false } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/config')) {
        return { async json() { return { idleSyncIntervalMinutes: 1 }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/challenge')) {
        const body = JSON.parse(options.body || '{}');
        challengeTypes.push(body.type);
        return { async json() { return { success: true }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/answer/')) {
        return { async json() { return { answered: true, answer: 'abcd' }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/close')) {
        return { async json() { return { success: true }; } };
      }
      if (String(url).includes('/api/plugin/idle-action/next')) {
        throw new Error('idle action should not be fetched during manual captcha handling');
      }
      return { async json() { return { task: null, canIdleSync: true }; } };
    }
  });

  await api.syncIdleYahooPages();

  assert.equal(challengeTypes.includes('captcha'), true);
  assert.equal(challengeTypes.includes('pin'), false);
}

async function testIdleSyncPostsPinWhenActivePinTabOverridesStaleCaptcha() {
  const challengeTypes = [];
  let currentUrl = 'https://login.yahoo.co.jp/config/login?src=auc&done=https%3A%2F%2Fcontact.auctions.yahoo.co.jp%2Fbuyer%2Ftop%3Faid%3Dj1232375474';
  let currentChallenge = {
    id: 'captcha-j1232375474-old',
    type: 'captcha',
    answered: false,
    productId: 'j1232375474',
    pageUrl: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=old'
  };
  let typedPin = '';
  const api = loadBackgroundForTest({
    disableAutoStart: true,
    tabs: {
      async query() {
        if (!currentUrl.includes('login.yahoo.co.jp')) return [];
        return [
          { id: 21, url: currentUrl, status: 'complete', active: true, windowId: 3 },
          { id: 22, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=old', status: 'complete', active: false, windowId: 3 }
        ];
      },
      async get(id) {
        if (id === 21) return { id: 21, url: currentUrl, status: 'complete', active: true, windowId: 3 };
        return { id: 22, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=old', status: 'complete', active: false, windowId: 3 };
      },
      async update(id, props) {
        if (id === 21) return { id: 21, url: currentUrl, status: 'complete', active: props?.active, windowId: 3 };
        return { id: 22, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=old', status: 'complete', active: props?.active, windowId: 3 };
      },
      async reload(id) {
        assert.equal(id, 21);
      },
      async captureVisibleTab() {
        throw new Error('stale captcha tab should not be captured when active PIN tab is open');
      }
    },
    scripting: {
      async executeScript(payload) {
        if (payload.files) return undefined;
        return [{ result: false }];
      }
    },
    fetch: async (url, options = {}) => {
      const value = String(url);
      if (value.includes('/api/plugin/config')) {
        return { async json() { return { idleSyncIntervalMinutes: 1 }; } };
      }
      if (value.includes('/api/plugin/manual-captcha/current')) {
        return {
          async json() {
            return {
              success: true,
              found: true,
              ...currentChallenge
            };
          }
        };
      }
      if (value.includes('/api/plugin/manual-captcha/challenge')) {
        const body = JSON.parse(options.body || '{}');
        challengeTypes.push(body.type);
        currentChallenge = {
          id: body.id,
          type: body.type,
          answered: false,
          productId: body.productId || 'j1232375474',
          pageUrl: body.pageUrl || ''
        };
        return { async json() { return { success: true }; } };
      }
      if (value.includes('/api/plugin/manual-captcha/answer/')) {
        return { async json() { return { answered: true, answer: '123456' }; } };
      }
      if (value.includes('/api/plugin/manual-pin/type')) {
        const body = JSON.parse(options.body || '{}');
        typedPin = body.pin;
        currentUrl = 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=j1232375474';
        return { async json() { return { success: true, digits: 6 }; } };
      }
      if (value.includes('/api/plugin/manual-captcha/close')) {
        return { async json() { return { success: true, closed: 1 }; } };
      }
      if (value.includes('/api/plugin/idle-action/next')) {
        throw new Error('idle action should not be fetched during manual verification');
      }
      return { async json() { return { task: null, canIdleSync: true }; } };
    }
  });

  await api.syncIdleYahooPages();

  assert.equal(challengeTypes[0], 'pin');
  assert.equal(challengeTypes.includes('captcha'), false);
  assert.equal(typedPin, '');

  currentChallenge = {
    ...currentChallenge,
    answered: true,
    answer: '123456'
  };
  await api.syncIdleYahooPages();

  assert.equal(typedPin, '123456');
}

async function testIdleSyncPostsCaptchaFallbackWhenCaptureFails() {
  const challenges = [];
  let captchaDone = false;
  const api = loadBackgroundForTest({
    disableAutoStart: true,
    tabs: {
      async query() {
        if (captchaDone) return [];
        return [
          { id: 21, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=abc', status: 'complete', active: true, windowId: 3 }
        ];
      },
      async get(id) {
        if (captchaDone) return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=j1232375474', status: 'complete', active: true, windowId: 3 };
        return { id, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=abc', status: 'complete', active: true, windowId: 3 };
      },
      async update(id, props) {
        return { id, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=abc', status: 'complete', active: props?.active, windowId: 3 };
      },
      async captureVisibleTab() {
        throw new Error('capture failed');
      }
    },
    scripting: {
      async executeScript(payload) {
        if (payload.files) return undefined;
        if (String(payload.func || '').includes('captchaAnswer')) {
          captchaDone = true;
          return [{ result: { success: true } }];
        }
        return [{ result: { success: false } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/config')) {
        return { async json() { return { idleSyncIntervalMinutes: 1 }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/challenge')) {
        const body = JSON.parse(options.body || '{}');
        challenges.push(body);
        return { async json() { return { success: true }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/answer/')) {
        return { async json() { return { answered: true, answer: 'abcd' }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/close')) {
        return { async json() { return { success: true }; } };
      }
      if (String(url).includes('/api/plugin/idle-action/next')) {
        throw new Error('idle action should not be fetched during manual captcha handling');
      }
      return { async json() { return { task: null, canIdleSync: true }; } };
    }
  });

  await api.syncIdleYahooPages();

  assert.equal(challenges.length, 1);
  assert.equal(challenges[0].type, 'captcha');
  assert.match(challenges[0].imageDataUrl, /^data:image\/png;base64,/);
  assert.ok(challenges[0].message);
}

async function testIdleSyncPostsCaptchaImageFromPageWhenScreenshotFails() {
  const challenges = [];
  let captchaDone = false;
  const captchaImageDataUrl = 'data:image/png;base64,' + Buffer.from('captcha-image').toString('base64');
  const api = loadBackgroundForTest({
    disableAutoStart: true,
    tabs: {
      async query() {
        if (captchaDone) return [];
        return [
          { id: 21, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=abc', status: 'complete', active: true, windowId: 3 }
        ];
      },
      async get(id) {
        if (captchaDone) return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=j1232375474', status: 'complete', active: true, windowId: 3 };
        return { id, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=abc', status: 'complete', active: true, windowId: 3 };
      },
      async update(id, props) {
        return { id, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=abc', status: 'complete', active: props?.active, windowId: 3 };
      },
      async captureVisibleTab() {
        throw new Error('visible tab screenshot unavailable');
      }
    },
    scripting: {
      async executeScript(payload) {
        if (payload.files) return undefined;
        const source = String(payload.func || '');
        if (source.includes('captcha image element not extractable')) {
          return [{ result: { success: true, imageDataUrl: captchaImageDataUrl, method: 'img-data-src' } }];
        }
        if (source.includes('captchaAnswer')) {
          captchaDone = true;
          return [{ result: { success: true } }];
        }
        return [{ result: { success: false } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/config')) {
        return { async json() { return { idleSyncIntervalMinutes: 1 }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/challenge')) {
        const body = JSON.parse(options.body || '{}');
        challenges.push(body);
        return { async json() { return { success: true }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/answer/')) {
        return { async json() { return { answered: true, answer: 'abcd' }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/close')) {
        return { async json() { return { success: true }; } };
      }
      if (String(url).includes('/api/plugin/idle-action/next')) {
        throw new Error('idle action should not be fetched during manual captcha handling');
      }
      return { async json() { return { task: null, canIdleSync: true }; } };
    }
  });

  await api.syncIdleYahooPages();

  assert.equal(challenges.length, 1);
  assert.equal(challenges[0].type, 'captcha');
  assert.equal(challenges[0].imageDataUrl, captchaImageDataUrl);
  assert.equal(challenges[0].message || '', '');
}

async function testIdleSyncPostsCaptchaDebuggerScreenshotWhenVisibleTabFails() {
  const challenges = [];
  const debuggerCommands = [];
  let captchaDone = false;
  const screenshotData = Buffer.from('current-yahoo-captcha-pixels').toString('base64');
  const api = loadBackgroundForTest({
    disableAutoStart: true,
    tabs: {
      async query() {
        if (captchaDone) return [];
        return [
          { id: 21, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=abc', status: 'complete', active: true, windowId: 3 }
        ];
      },
      async get(id) {
        if (captchaDone) return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=j1232375474', status: 'complete', active: true, windowId: 3 };
        return { id, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=abc', status: 'complete', active: true, windowId: 3 };
      },
      async update(id, props) {
        return { id, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=abc', status: 'complete', active: props?.active, windowId: 3 };
      },
      async captureVisibleTab() {
        throw new Error('visible tab screenshot unavailable');
      }
    },
    scripting: {
      async executeScript(payload) {
        if (payload.files) return undefined;
        const source = String(payload.func || '');
        if (source.includes('captcha image rect not found')) {
          return [{ result: { success: true, rect: { left: 12, top: 34, width: 210, height: 90 }, method: 'media', deviceScaleFactor: 1 } }];
        }
        if (source.includes('captcha image element not extractable')) {
          return [{ result: { success: false, error: 'image src should not be refetched' } }];
        }
        if (source.includes('captchaAnswer')) {
          captchaDone = true;
          return [{ result: { success: true } }];
        }
        return [{ result: { success: false } }];
      }
    },
    debuggerApi: {
      async attach(target, version) {
        debuggerCommands.push({ command: 'attach', target, version });
      },
      async sendCommand(target, command, params) {
        debuggerCommands.push({ command, target, params });
        if (command === 'Page.captureScreenshot') {
          return { data: screenshotData };
        }
        return {};
      },
      async detach(target) {
        debuggerCommands.push({ command: 'detach', target });
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/config')) {
        return { async json() { return { idleSyncIntervalMinutes: 1 }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/challenge')) {
        const body = JSON.parse(options.body || '{}');
        challenges.push(body);
        return { async json() { return { success: true }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/answer/')) {
        return { async json() { return { answered: true, answer: 'abcd' }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/close')) {
        return { async json() { return { success: true }; } };
      }
      if (String(url).includes('/api/plugin/idle-action/next')) {
        throw new Error('idle action should not be fetched during manual captcha handling');
      }
      return { async json() { return { task: null, canIdleSync: true }; } };
    }
  });

  await api.syncIdleYahooPages();

  const screenshotCommand = debuggerCommands.find(item => item.command === 'Page.captureScreenshot');
  assert.ok(screenshotCommand);
  assert.equal(screenshotCommand.params.clip.x, 12);
  assert.equal(screenshotCommand.params.clip.y, 34);
  assert.equal(screenshotCommand.params.clip.width, 210);
  assert.equal(screenshotCommand.params.clip.height, 90);
  assert.equal(screenshotCommand.params.clip.scale, 1);
  assert.equal(challenges.length, 1);
  assert.equal(challenges[0].type, 'captcha');
  assert.equal(challenges[0].imageDataUrl, `data:image/png;base64,${screenshotData}`);
  assert.equal(challenges[0].message || '', '');
}

async function testIdleSyncHandlesCaptchaBeforeIdleIntervalThrottle() {
  let phase = 'normal';
  let captchaDone = false;
  const challengeTypes = [];
  const api = loadBackgroundForTest({
    tabs: {
      async query() {
        if (phase === 'captcha' && !captchaDone) {
          return [
            { id: 31, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=abc', status: 'complete', active: true, windowId: 3 }
          ];
        }
        return [];
      },
      async get(id) {
        if (phase === 'captcha' && !captchaDone) {
          return { id, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=abc', status: 'complete', active: true, windowId: 3 };
        }
        return { id, url: 'https://aucpay.yahoo.co.jp/detail-front/PaymentDetailItem', status: 'complete', active: true, windowId: 3 };
      },
      async update(id, props) {
        return { id, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=abc', status: 'complete', active: props?.active, windowId: 3 };
      },
      async captureVisibleTab() {
        return 'data:image/png;base64,abc';
      }
    },
    scripting: {
      async executeScript(payload) {
        if (payload.files) return undefined;
        if (String(payload.func || '').includes('captchaAnswer')) {
          captchaDone = true;
          return [{ result: { success: true } }];
        }
        return [{ result: { success: false } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/config')) {
        return { async json() { return { idleSyncIntervalMinutes: 60 }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/challenge')) {
        const body = JSON.parse(options.body || '{}');
        challengeTypes.push(body.type);
        return { async json() { return { success: true }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/answer/')) {
        return { async json() { return { answered: true, answer: 'abcd' }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/close')) {
        return { async json() { return { success: true }; } };
      }
      if (String(url).includes('/api/plugin/idle-action/next')) {
        return { async json() { return { action: 'none' }; } };
      }
      return { async json() { return { task: null, canIdleSync: true }; } };
    }
  });

  await api.syncIdleYahooPages();
  phase = 'captcha';
  await api.syncIdleYahooPages();

  assert.equal(challengeTypes.includes('captcha'), true);
  assert.equal(challengeTypes.includes('pin'), false);
}

async function testManualPinRefreshesPageBeforeEnteringAnswer() {
  let currentUrl = 'https://login.yahoo.co.jp/config/login?auth_lv=1&done=https%3A%2F%2Fcontact.auctions.yahoo.co.jp%2Fbuyer%2Ftop%3Faid%3Dj1230839418';
  let reloadCount = 0;
  const keyTexts = [];
  const api = loadBackgroundForTest({
    tabs: {
      async get(id) {
        return { id, url: currentUrl, status: 'complete', windowId: 3 };
      },
      async update(id, update) {
        return { id, url: currentUrl, status: 'complete', windowId: 3, active: update?.active };
      },
      async reload(id) {
        assert.equal(id, 7);
        reloadCount += 1;
      }
    },
    debuggerApi: {
      async attach() {},
      async sendCommand(target, command, params) {
        if (command === 'Input.dispatchKeyEvent' && params.type === 'char') {
          keyTexts.push(params.text);
        }
        if (keyTexts.join('') === '123456') {
          currentUrl = 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=j1230839418';
        }
      },
      async detach() {}
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/manual-captcha/challenge')) {
        const body = JSON.parse(options.body || '{}');
        assert.equal(body.type, 'pin');
        return { async json() { return { success: true }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/answer/')) {
        return { async json() { return { answered: true, answer: '123456' }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/close')) {
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  const result = await api.handleManualVerificationIfPresent(
    { id: 7, url: currentUrl, status: 'complete', windowId: 3 },
    { productId: 'j1230839418', source: 'test' }
  );

  assert.equal(result.handled, true);
  assert.equal(reloadCount, 1);
  assert.equal(keyTexts.join(''), '123456');
}

async function testIdleSyncResumesAnsweredPinChallengeOnTimedOutLoginPage() {
  let currentUrl = 'https://login.yahoo.co.jp/config/login?src=auc&done=https%3A%2F%2Fcontact.auctions.yahoo.co.jp%2Fbuyer%2Ftop%3Faid%3Dj1232375474';
  let reloadCount = 0;
  let typedPin = '';
  let closedChallengeId = '';
  const api = loadBackgroundForTest({
    disableAutoStart: true,
    tabs: {
      async query() {
        return [
          { id: 21, url: currentUrl, status: 'complete', active: true, windowId: 3 }
        ];
      },
      async get(id) {
        return { id, url: currentUrl, status: 'complete', active: true, windowId: 3 };
      },
      async update(id, props) {
        return { id, url: currentUrl, status: 'complete', active: props?.active, windowId: 3 };
      },
      async reload(id) {
        assert.equal(id, 21);
        reloadCount += 1;
      }
    },
    scripting: {
      async executeScript(payload) {
        if (payload.files) return undefined;
        return [{ result: false }];
      }
    },
    fetch: async (url, options = {}) => {
      const value = String(url);
      if (value.includes('/api/plugin/config')) {
        return { async json() { return { idleSyncIntervalMinutes: 1 }; } };
      }
      if (value.includes('/api/plugin/manual-captcha/current')) {
        return {
          async json() {
            return {
              success: true,
              found: true,
              id: 'pin-j1232375474-1',
              type: 'pin',
              answered: true,
              answer: '123456',
              productId: 'j1232375474'
            };
          }
        };
      }
      if (value.includes('/api/plugin/manual-pin/type')) {
        const body = JSON.parse(options.body || '{}');
        typedPin = body.pin;
        currentUrl = 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=j1232375474';
        return { async json() { return { success: true, digits: 6 }; } };
      }
      if (value.includes('/api/plugin/manual-captcha/close')) {
        const body = JSON.parse(options.body || '{}');
        closedChallengeId = body.id;
        return { async json() { return { success: true, closed: 1 }; } };
      }
      if (value.includes('/api/plugin/idle-action/next')) {
        throw new Error('idle action should not run while manual PIN is being resumed');
      }
      return { async json() { return { task: null, canIdleSync: true }; } };
    }
  });

  await api.syncIdleYahooPages();

  assert.ok(reloadCount >= 1);
  assert.equal(typedPin, '123456');
  assert.equal(closedChallengeId, 'pin-j1232375474-1');
}

async function testManualVerificationTransitionKeepsCurrentCaptchaWhenNewPinTabAppears() {
  const api = loadBackgroundForTest({
    tabs: {
      async get(id) {
        if (id === 7) return { id: 7, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1', status: 'complete' };
        return { id, url: 'about:blank', status: 'complete' };
      },
      async query() {
        return [
          { id: 7, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1', status: 'complete' },
          { id: 9, url: 'https://login.yahoo.co.jp/config/login?auth_lv=1&done=https%3A%2F%2Fcontact.auctions.yahoo.co.jp%2Fbuyer%2Ftop%3Faid%3Dj1230839418', status: 'complete', active: true }
        ];
      }
    }
  });

  const result = await api.findManualVerificationTransitionTab(
    { id: 7, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1', status: 'complete' },
    new Set([7])
  );

  assert.equal(result.id, 7);
}

async function testManualVerificationTransitionPrefersCaptchaAfterPinInput() {
  const api = loadBackgroundForTest({
    tabs: {
      async get(id) {
        if (id === 7) return { id: 7, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1', status: 'complete', active: true };
        if (id === 9) return { id: 9, url: 'https://login.yahoo.co.jp/config/login?auth_lv=1&done=https%3A%2F%2Fcontact.auctions.yahoo.co.jp%2Fbuyer%2Ftop%3Faid%3Dj1230839418', status: 'complete', active: false };
        return { id, url: 'about:blank', status: 'complete' };
      },
      async query() {
        return [
          { id: 7, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1', status: 'complete', active: true },
          { id: 9, url: 'https://login.yahoo.co.jp/config/login?auth_lv=1&done=https%3A%2F%2Fcontact.auctions.yahoo.co.jp%2Fbuyer%2Ftop%3Faid%3Dj1230839418', status: 'complete', active: false }
        ];
      }
    }
  });

  const result = await api.findManualVerificationTransitionTab(
    { id: 7, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1', status: 'complete', active: true },
    new Set([7]),
    { preferCaptcha: true }
  );

  assert.equal(result.id, 7);
}

async function testManualVerificationTransitionKeepsCurrentCaptchaOverOldActivePin() {
  const api = loadBackgroundForTest({
    tabs: {
      async get(id) {
        if (id === 7) return { id: 7, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1', status: 'complete' };
        if (id === 9) return { id: 9, url: 'https://login.yahoo.co.jp/config/login?auth_lv=1&done=https%3A%2F%2Fcontact.auctions.yahoo.co.jp%2Fbuyer%2Ftop%3Faid%3Dj1230839418', status: 'complete', active: true };
        return { id, url: 'about:blank', status: 'complete' };
      },
      async query() {
        return [
          { id: 7, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1', status: 'complete' },
          { id: 9, url: 'https://login.yahoo.co.jp/config/login?auth_lv=1&done=https%3A%2F%2Fcontact.auctions.yahoo.co.jp%2Fbuyer%2Ftop%3Faid%3Dj1230839418', status: 'complete', active: true }
        ];
      }
    }
  });

  const result = await api.findManualVerificationTransitionTab(
    { id: 7, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1', status: 'complete' },
    new Set([7, 9])
  );

  assert.equal(result.id, 7);
}

async function testManualVerificationReusesPinWhenCaptchaReturnsToPinPage() {
  let stage = 'captcha';
  const challengeTypes = [];
  const typedPins = [];
  const api = loadBackgroundForTest({
    tabs: {
      async get(id) {
        if (id === 7 && stage === 'pin') {
          return { id: 7, url: 'https://login.yahoo.co.jp/config/login?auth_lv=1&done=https%3A%2F%2Fcontact.auctions.yahoo.co.jp%2Fbuyer%2Ftop%3Faid%3Dj1230839418', status: 'complete', windowId: 3 };
        }
        if (id === 7) return { id: 7, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1', status: 'complete', windowId: 3 };
        return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=j1230839418', status: 'complete', windowId: 3 };
      },
      async query() {
        if (stage === 'pin') {
          return [
            { id: 7, url: 'https://login.yahoo.co.jp/config/login?auth_lv=1&done=https%3A%2F%2Fcontact.auctions.yahoo.co.jp%2Fbuyer%2Ftop%3Faid%3Dj1230839418', status: 'complete', active: true }
          ];
        }
        if (stage === 'done') {
          return [];
        }
        return [
          { id: 7, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1', status: 'complete', active: true }
        ];
      },
      async update(id, props) {
        return { id, url: stage === 'pin' ? 'https://login.yahoo.co.jp/config/login?auth_lv=1' : 'https://login.yahoo.co.jp/ncaptcha?fido=1', status: 'complete', windowId: 3, active: props?.active };
      },
      async reload() {},
      async captureVisibleTab() {
        return 'data:image/png;base64,';
      }
    },
    scripting: {
      async executeScript(payload) {
        if (payload.files) return undefined;
        if (String(payload.func || '').includes('captchaAnswer')) {
          stage = 'pin';
          return [{ result: { success: true } }];
        }
        return [{ result: { success: false } }];
      }
    },
    debuggerApi: {
      async attach() {},
      async sendCommand(target, command, params) {
        if (command === 'Input.dispatchKeyEvent' && params.type === 'char') {
          typedPins.push(params.text);
        }
        if (typedPins.join('') === '123456') {
          stage = 'done';
        }
      },
      async detach() {}
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/manual-captcha/challenge')) {
        const body = JSON.parse(options.body || '{}');
        challengeTypes.push(body.type);
        return { async json() { return { success: true }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/answer/')) {
        return { async json() { return { answered: true, answer: 'abcd' }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/close')) {
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  const result = await api.handleManualVerificationIfPresent(
    { id: 7, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1', status: 'complete', windowId: 3 },
    { productId: 'j1230839418', source: 'test', pinAnswer: '123456' }
  );

  assert.equal(result.handled, true);
  assert.equal(challengeTypes.every(type => type === 'captcha'), true);
  assert.equal(typedPins.join('').includes('123456'), true);
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

async function testTransactionCleanupKeepsManualVerificationTabsOpen() {
  const removed = [];
  const api = loadBackgroundForTest({
    tabs: {
      async query() {
        return [
          { id: 2, url: 'https://login.yahoo.co.jp/config/login?.src=auc' },
          { id: 3, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=abc' },
          { id: 4, url: 'https://login.yahoo.co.jp/config/login?auth_lv=1&done=https%3A%2F%2Faucpay.yahoo.co.jp%2Fdetail-front%2FPaymentDetailItem' }
        ];
      },
      async remove(id) {
        removed.push(id);
      }
    }
  });

  await api.closeTabsForTransactionFlow(null, new Set());

  assert.deepEqual(removed, [2]);
}

async function testTransactionCleanupKeepsCurrentManualVerificationTabFromCreatedIds() {
  const removed = [];
  const api = loadBackgroundForTest({
    tabs: {
      async get(id) {
        if (id === 3) return { id: 3, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=abc' };
        return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top' };
      },
      async query() {
        return [
          { id: 3, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=abc' }
        ];
      },
      async remove(id) {
        removed.push(id);
      }
    }
  });

  await api.closeTabsForTransactionFlow(
    { id: 3, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1&trans=abc', _gdaipaiCreatedTabIds: [3] },
    new Set()
  );

  assert.deepEqual(removed, []);
}

async function unusedLegacyWonPageSyncTestRemoved() {
  const fetchCalls = [];
  const api = loadBackgroundForTest({
    setTimeout(fn, ms) {
      if (ms >= 30000) return 1;
      return setTimeout(fn, 0);
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (String(url).includes('/api/plugin/orders/sync')) {
        return {
          ok: true,
          async json() {
            return { success: true, updated: 1 };
          }
        };
      }
      return {
        ok: true,
        async json() {
          return {};
        }
      };
    },
    tabs: {
      async query() {
        return [];
      },
      async create() {
        return { id: 9, status: 'complete', url: 'https://auctions.yahoo.co.jp/my/won' };
      },
      async get(id) {
        return { id, status: 'complete', url: 'https://auctions.yahoo.co.jp/my/won' };
      },
      async sendMessage(id, msg) {
        if (msg.type === 'EXTRACT_ORDER_HISTORY') {
          return {
            success: true,
            loginStatus: { status: 'ok' },
            orders: [{ productId: 'u1231877298', price: '350円' }]
          };
        }
        return { success: true };
      }
    }
  });

  const confirmed = false;

  assert.equal(confirmed, false);
  assert.equal(fetchCalls.some(call => String(call.url).includes('/api/plugin/orders/sync')), true);
}

async function testFailedBidDoesNotImmediatelySyncWonPage() {
  const fetchCalls = [];
  const statusBodies = [];
  const api = loadBackgroundForTest({
    setTimeout(fn, ms) {
      if (ms >= 30000) return 1;
      return setTimeout(fn, 0);
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      const value = String(url);
      if (value.includes('/api/plugin/task/42/status')) {
        statusBodies.push(JSON.parse(options.body || '{}'));
        return {
          ok: true,
          async json() {
            return { success: true };
          }
        };
      }
      if (value.includes('/api/plugin/task/42/snapshot')) {
        return {
          ok: true,
          async json() {
            return { success: true };
          }
        };
      }
      if (value.includes('/api/plugin/task')) {
        return {
          ok: true,
          async json() {
            return {
              task: {
                id: 42,
                product_url: 'https://auctions.yahoo.co.jp/jp/auction/v1231866422',
                current_price: 3400,
                max_price: 3888,
                user_max_price: 3888,
                strategy: 'direct',
                bid_mode: 'bid',
                tax_type: 'tax_zero',
                end_time: '2026-06-07T23:59:07+09:00'
              }
            };
          }
        };
      }
      if (value.includes('/api/plugin/orders/sync')) {
        return {
          ok: true,
          async json() {
            return { success: true, updated: 1 };
          }
        };
      }
      return {
        ok: true,
        async json() {
          return {};
        }
      };
    },
    tabs: {
      async create() {
        return { id: 8, status: 'complete', url: 'https://auctions.yahoo.co.jp/jp/auction/v1231866422' };
      },
      async get(id) {
        return { id, status: 'complete', url: 'https://auctions.yahoo.co.jp/jp/auction/v1231866422' };
      },
      onUpdatedAddListener(listener) {
        listener(8, { status: 'complete' });
      },
      async sendMessage(id, msg) {
        if (msg.type === 'GET_PRODUCT_SNAPSHOT') {
          return {
            auctionId: 'v1231866422',
            currentPrice: 5000,
            endTime: '2026-06-07T23:59:07+09:00'
          };
        }
        if (msg.type === 'EXECUTE_BID_V2') {
          return { success: false, error: 'Current price is above max price before execution', closeTab: true };
        }
        return { success: true };
      }
    }
  });

  await api.pollAndExecute();
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(fetchCalls.some(call => String(call.url).includes('/api/plugin/orders/sync')), false);
  assert.equal(statusBodies.some(body => body.status === 'failed'), true);
}

async function run() {
  testMultiBidSuccessKeepsTabOpenForImmediateRebid();
  testAlreadyHighestMultiBidClosesTab();
  await testWithTimeoutMarksCloseTab();
  await testBundleStartWaitsForDecideButtonState();
  await testWaitForBundleActionStateAcrossTabsFollowsNewConfirmTab();
  await testTrustedBundleClickDispatchesMouseThroughDebugger();
  await testManualPinDispatchesDigitsThroughDebuggerKeyboard();
  await testManualPinUsesSystemKeyboardEndpointBeforeDebugger();
  await testManualPinFallsBackToDebuggerWhenSystemKeyboardFails();
  await testManualPinUsesRealKeyboardBeforeInsertTextFallback();
  await testManualPinFallsBackToInsertTextWhenRealKeyboardFails();
  await testBidderPaysShippingTransactionClicksDecideAndConfirm();
  await testBidderPaysShippingTransactionAcceptsAlreadyWaitingShippingPage();
  testBuildScanStatusPayloadUsesShippingFeeOnly();
  testBuildScanStatusPayloadSkipsPendingShipping();
  testBuildScanStatusPayloadHandlesBundleShippingFee();
  testBuildScanStatusPayloadHandlesBundleRejected();
  testBundleInputActionCanRunFromWaitingAgreementState();
  testPaymentPageStateDetectsPurchaseCompletePage();
  testPaymentPageStateDetectsStoreAlreadyPaidPage();
  testPaymentPageStateKeepsSelectedShippingOption();
  testPaymentPageStateDetectsPaymentMethodFee();
  testPaymentPageStateUsesTotalAmountWithPayPayBenefitAd();
  testPaymentPageStateDetectsStoreConfirmationSection();
  testPaymentPageStateDoesNotTreatCartoptOnlyAsStoreConfirmation();
  testBuildStoreOptionsUrlUsesProductId();
  await testStoreConfirmationChangeUsesCartoptSelector();
  await testStoreConfirmationApplyUsesConfirmUpdateSelector();
  await testStoreConfirmationApplyChecksHiddenInputs();
  await testStoreConfirmationTrustedClickPointsUseRealSelectors();
  testPaymentAmountAllowsUnknownShippingWhenPageTotalEqualsFinalPrice();
  testPaymentAmountRejectsUnknownShippingWhenPageTotalExceedsFinalPrice();
  testPaymentAmountTreatsFreeAndCashOnDeliveryAsZeroShippingForAllProducts();
  testShouldSelectPaymentShippingOptionWhenDefaultDiffers();
  testRandomIntInclusiveUsesConfiguredRange();
  await testRunPaymentJobsReportsEmptyQueue();
  await testRunTransactionStartJobsCanOnlyRefreshServerSideStoreOrders();
  await testIdleTransactionStartRefreshesStoreOrdersWhenNormalFlowDisabled();
  await testRunTransactionStartMarksAlreadyWaitingShippingPageWaitingShipping();
  await testRunPaymentJobsCompletesNormalItemPayment();
  await testRunPaymentJobsCompletesNormalItemPaymentAfterTransactionInfoInput();
  await testRunPaymentJobsClicksPlacementOkAfterTransactionInfoInput();
  await testRunPaymentJobsMarksAlreadyPaidAsSuccess();
  await testRunPaymentJobsCompletesStoreItemAfterPurchaseProcedure();
  await testRunPaymentJobsUsesSinglePurchaseForStoreBundlePage();
  await testRunPaymentJobsContinuesNormalEntryAfterStorePurchaseProcedure();
  await testRunPaymentJobsWaitsRandomSecondsBeforeFinalizeAndIgnoresProcessingPage();
  await testRunConfirmReceiptJobsCompletesStoreItemWithoutOpeningTab();
  await testRunConfirmReceiptJobsWaitsForEnabledReceiveButton();
  await testRunPaymentJobsSelectsExpectedShippingBeforeReview();
  await testRunPaymentJobsWaitsForSlowReviewButtonOnPurchasePage();
  await testRunPaymentJobsWaitsForStoreReviewPageReadyBeforeConfirmClick();
  await testModernStoreReviewUsesSyntheticClickBeforeTrustedClick();
  await testModernStoreReviewRetriesSyntheticClickAfterFiveSeconds();
  await testRunPaymentJobsCompletesStoreConfirmationBeforeReview();
  await testRunPaymentJobsHandlesStoreConfirmationBeforeReviewButton();
  await testPaymentTrustedClickPointFindsRoleButton();
  await testPaymentTrustedClickPointSkipsHiddenConfirmAnchor();
  await testPaymentReviewClickPointPrefersConfirmContainerOverPayPayBenefit();
  await testPaymentReviewClickPointUsesPaymentAmountContextFallback();
  await testPaymentReviewClickPointDoesNotFallbackToPayPayBenefit();
  await testPaymentShippingChangeClickPointFindsButtonAfterHeaderSibling();
  await testPaymentShippingChangeClickPointUsesShippingSectionRoleButton();
  await testRunPaymentJobsReportsUnknownPaymentPageFailure();
  testBuildPaymentFailurePayloadIncludesProductId();
  testManualCaptchaTabDetection();
  testLikelyManualPinTabDetection();
  await testIdleSyncSkipsNonBidWorkWhenManualPinTabExists();
  await testIdleSyncStaysPausedDuringCaptchaAfterPinFlowStarts();
  await testIdleSyncPostsCaptchaWhenManualCaptchaTabAlreadyOpen();
  await testIdleSyncPostsPinWhenActivePinTabOverridesStaleCaptcha();
  await testIdleSyncPostsCaptchaFallbackWhenCaptureFails();
  await testIdleSyncPostsCaptchaImageFromPageWhenScreenshotFails();
  await testIdleSyncPostsCaptchaDebuggerScreenshotWhenVisibleTabFails();
  await testIdleSyncHandlesCaptchaBeforeIdleIntervalThrottle();
  await testManualPinRefreshesPageBeforeEnteringAnswer();
  await testIdleSyncResumesAnsweredPinChallengeOnTimedOutLoginPage();
  await testManualVerificationTransitionKeepsCurrentCaptchaWhenNewPinTabAppears();
  await testManualVerificationTransitionPrefersCaptchaAfterPinInput();
  await testManualVerificationTransitionKeepsCurrentCaptchaOverOldActivePin();
  await testManualVerificationReusesPinWhenCaptchaReturnsToPinPage();
  testYahooLoginPageCountsAsTransactionTab();
  await testTransactionCleanupClosesNewYahooLoginTabs();
  await testTransactionCleanupKeepsManualVerificationTabsOpen();
  await testTransactionCleanupKeepsCurrentManualVerificationTabFromCreatedIds();
  await testFailedBidDoesNotImmediatelySyncWonPage();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
