const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadBackgroundForTest() {
  const code = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
  const sandbox = {
    console,
    globalThis: {},
    setInterval() {},
    setTimeout(fn) { fn(); },
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
        async query() { return []; },
        async create() { return { id: 1 }; },
        async get(id) { return { id }; },
        async update(id) { return { id }; },
        async remove() {},
        onRemoved: { addListener() {} }
      },
      scripting: {
        async executeScript() {}
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

testMultiBidSuccessKeepsTabOpenForImmediateRebid();
testAlreadyHighestMultiBidClosesTab();
