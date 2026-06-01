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
    fetch: async () => ({ async json() { return { task: null }; } }),
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

async function run() {
  testMultiBidSuccessKeepsTabOpenForImmediateRebid();
  testAlreadyHighestMultiBidClosesTab();
  await testWithTimeoutMarksCloseTab();
  await testBundleStartWaitsForDecideButtonState();
  await testWaitForBundleActionStateAcrossTabsFollowsNewConfirmTab();
  await testTrustedBundleClickDispatchesMouseThroughDebugger();
  await testBidderPaysShippingTransactionClicksDecideAndConfirm();
  await testBidderPaysShippingTransactionAcceptsAlreadyWaitingShippingPage();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
