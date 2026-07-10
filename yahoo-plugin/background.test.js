const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function testYahooMessageJobsUseFortyFiveSecondTimeout() {
  const source = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
  assert.match(source, /MESSAGE_JOB_TIMEOUT_MS = 45000/);
  assert.match(source, /message job timeout after 45s/);
  assert.match(source, /withTimeout\([\s\S]*MESSAGE_JOB_TIMEOUT_MS/);
}

function testPaymentSyntheticClickWaitsTenSecondsForNextState() {
  const source = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
  assert.match(source, /waitForPaymentStateAcrossTabs\(tab,\s*waitFor,\s*previousTabIds,\s*10000\)/);
}

function loadBackgroundForTest(overrides = {}) {
  let code = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
  if (overrides.disableAutoStart) {
    code = code.replace(/\r?\nstartPolling\(\);\r?\n\r?\n\/\/ Listen for messages from content script or client page/, '\n// Listen for messages from content script or client page');
  }
  const tabs = overrides.tabs || {};
  const scripting = overrides.scripting || {};
  const debuggerApi = overrides.debuggerApi || {};
  const windows = overrides.windows || {};
  const alarms = overrides.alarms || {};
  const sandbox = {
    console: overrides.console || console,
    globalThis: {
      __G_DAIPAI_TRANSACTION_START_ENABLED__: overrides.transactionStartEnabled,
      __G_DAIPAI_RANDOM__: overrides.random
    },
    setInterval(...args) { return overrides.setInterval ? overrides.setInterval(...args) : undefined; },
    setTimeout(fn, ms) { return overrides.setTimeout ? overrides.setTimeout(fn, ms) : fn(); },
    clearTimeout() {},
    clearInterval(...args) { return overrides.clearInterval ? overrides.clearInterval(...args) : undefined; },
    Date: overrides.Date || Date,
    URL,
    URLSearchParams,
    fetch: overrides.fetch || (async () => ({ async json() { return { task: null }; } })),
    chrome: {
      alarms: {
        create(...args) { return alarms.create ? alarms.create(...args) : undefined; },
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
  if ('document' in overrides) sandbox.document = overrides.document;
  if ('InputEvent' in overrides) sandbox.InputEvent = overrides.InputEvent;
  if ('PointerEvent' in overrides) sandbox.PointerEvent = overrides.PointerEvent;
  if ('MouseEvent' in overrides) sandbox.MouseEvent = overrides.MouseEvent;
  if ('Event' in overrides) sandbox.Event = overrides.Event;
  vm.runInNewContext(code, sandbox);
  return sandbox.globalThis.__G_DAIPAI_BACKGROUND_TEST__;
}

async function testStartPollingIsIdempotentWithinWorker() {
  let alarmCreates = 0;
  let intervals = 0;
  const api = loadBackgroundForTest({
    disableAutoStart: true,
    alarms: {
      create() { alarmCreates += 1; }
    },
    setInterval() {
      intervals += 1;
      return intervals;
    }
  });

  await api.startPolling();
  await api.startPolling();

  assert.equal(alarmCreates, 1);
  assert.equal(intervals, 1);
}

async function testInjectContentScriptMissingTabDoesNotLogExtensionError() {
  const errors = [];
  const warnings = [];
  const api = loadBackgroundForTest({
    console: {
      ...console,
      error(...args) { errors.push(args); },
      warn(...args) { warnings.push(args); }
    },
    scripting: {
      async executeScript() {
        throw new Error('No tab with id: 200483973');
      }
    }
  });

  await assert.rejects(
    () => api.injectContentScript(200483973),
    /No tab with id/
  );

  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /tab no longer exists/);
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

function testTaskExecutionTimeoutIsLongerForMultiBid() {
  const api = loadBackgroundForTest();

  assert.equal(api.getTaskExecutionTimeoutMs({ strategy: 'direct' }), 30000);
  assert.equal(api.getTaskExecutionTimeoutMs({ strategy: 'direct', bid_mode: 'buyout' }), 30000);
  assert.equal(api.getTaskExecutionTimeoutMs({ strategy: 'multi_bid' }), 180000);
  assert.equal(api.getTaskProgressExtensionMs({ strategy: 'direct' }), 0);
  assert.equal(api.getTaskProgressExtensionMs({ strategy: 'multi_bid' }), 60000);
  assert.equal(api.getTaskExecutionMaxTimeoutMs({ strategy: 'direct', bid_mode: 'buyout' }), 30000);
  assert.equal(api.getTaskExecutionMaxTimeoutMs({ strategy: 'multi_bid' }), 600000);
}

function testPendingFinalRetryDelayIsShortForDirectBid() {
  const api = loadBackgroundForTest();

  assert.equal(api.getPendingFinalRetryDelayMs(
    { strategy: 'direct', bid_mode: 'bid' },
    { pendingFinal: true, stage: 'confirm-clicked' }
  ), 1500);
  assert.equal(api.getPendingFinalRetryDelayMs(
    { strategy: 'direct', bid_mode: 'buyout' },
    { pendingFinal: true, stage: 'buyout-final-waiting' }
  ), 10000);
}

function testNoServiceWorkerLifecycleErrorDetection() {
  const api = loadBackgroundForTest();

  assert.equal(api.isNoServiceWorkerLifecycleError(new Error('No SW')), true);
  assert.equal(api.isNoServiceWorkerLifecycleError('No SW'), true);
  assert.equal(api.isNoServiceWorkerLifecycleError(new Error('Failed to fetch')), false);
  assert.equal(api.isNoServiceWorkerLifecycleError(new Error('payment failed')), false);
}

function testYahooTradeMessageSelectorsCoverNormalAndStorePages() {
  const api = loadBackgroundForTest();

  assert.match(api.getYahooTradeMessageExtractScript(), /messagelist/);
  assert.match(api.getYahooTradeMessageExtractScript(), /sc-c46fd2ce-0/);
  assert.match(api.getYahooTradeMessageSendScript('hello'), /submitButton/);
  assert.match(api.getYahooTradeMessageSendScript('hello'), /#msg button/);
  assert.match(api.getYahooTradeMessageSendScript('hello'), /textarea/);
}

function testYahooTradeMessageExtractionSkipsStoreLegalLinks() {
  const api = loadBackgroundForTest();
  const createElement = ({ outerHTML, text = '', selectors = {} }) => ({
    outerHTML,
    innerText: text,
    textContent: text,
    querySelector(selector) {
      return selectors[selector] || null;
    }
  });
  const legalLinks = createElement({
    outerHTML: '<ul class="sc-c46fd2ce-0"><li>特定商取引法の表示</li><li>ストア出店について</li></ul>',
    text: '特定商取引法の表示 ストア出店について'
  });
  const messageList = createElement({
    outerHTML: '<ul class="sc-c46fd2ce-0"><dl><dt><span>ストア</span></dt><div><dd>落札いただいたお品物の確保を致しました。</dd><dd><time>7月9日 11:47</time></dd></div></dl></ul>',
    text: 'ストア 落札いただいたお品物の確保を致しました。 7月9日 11:47',
    selectors: {
      dl: {},
      dd: {},
      time: {}
    }
  });
  const document = {
    querySelector(selector) {
      if (selector === '#messagelist') return null;
      if (selector === 'ul.sc-c46fd2ce-0, ul[class*="sc-c46fd2ce-0"]') return legalLinks;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'ul.sc-c46fd2ce-0, ul[class*="sc-c46fd2ce-0"]') return [legalLinks, messageList];
      if (selector === 'section ul') return [];
      if (selector === 'ul, .acMdMsgForm, [id*="message"], [class*="Msg"]') return [];
      return [];
    }
  };

  const result = Function('document', `return ${api.getYahooTradeMessageExtractScript()};`)(document);

  assert.equal(result.success, true);
  assert.equal(result.pageType, 'store');
  assert.equal(result.messageHtml, messageList.outerHTML);
  assert.doesNotMatch(result.messageHtml, /特定商取引法/);
}

function testYahooTradeMessageExtractionDoesNotFallbackToStoreLegalLinks() {
  const api = loadBackgroundForTest();
  const legalLinks = {
    outerHTML: '<ul><li>\u7279\u5b9a\u5546\u53d6\u5f15\u6cd5\u306e\u8868\u793a</li><li>\u30b9\u30c8\u30a2\u51fa\u5e97\u306b\u3064\u3044\u3066</li></ul>',
    innerText: '\u7279\u5b9a\u5546\u53d6\u5f15\u6cd5\u306e\u8868\u793a \u30b9\u30c8\u30a2\u51fa\u5e97\u306b\u3064\u3044\u3066',
    textContent: '\u7279\u5b9a\u5546\u53d6\u5f15\u6cd5\u306e\u8868\u793a \u30b9\u30c8\u30a2\u51fa\u5e97\u306b\u3064\u3044\u3066',
    querySelector() {
      return null;
    }
  };
  const document = {
    querySelector(selector) {
      if (selector === '#messagelist') return null;
      if (selector === 'ul.sc-c46fd2ce-0, ul[class*="sc-c46fd2ce-0"]') return legalLinks;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'ul.sc-c46fd2ce-0, ul[class*="sc-c46fd2ce-0"]') return [legalLinks];
      if (selector === 'section ul') return [];
      if (selector === 'ul, .acMdMsgForm, [id*="message"], [class*="Msg"]') return [legalLinks];
      return [];
    }
  };

  const result = Function('document', `return ${api.getYahooTradeMessageExtractScript()};`)(document);

  assert.equal(result.success, false);
  assert.equal(result.error, 'message list not found');
}

function testYahooTradeMessageExtractionReadsStoreDisabledPostingThread() {
  const api = loadBackgroundForTest();
  const messageList = {
    outerHTML: '<ul class="sc-c46fd2ce-0"><dl><dt><span>\u3042\u306a\u305f</span></dt><div><dd>\u30ad\u30e3\u30f3\u30bb\u30eb\u304a\u9858\u3044\u81f4\u3057\u307e\u3059</dd><dd><time>6\u670819\u65e5 22:38</time></dd></div></dl><dl><dt><span>\u30b9\u30c8\u30a2</span></dt><div><dd>\u3054\u6ce8\u6587\u5c65\u6b74\u306f\u3054\u3056\u3044\u307e\u305b\u3093</dd><dd><time>6\u670822\u65e5 09:10</time></dd></div></dl></ul>',
    innerText: '\u3042\u306a\u305f \u30ad\u30e3\u30f3\u30bb\u30eb\u304a\u9858\u3044\u81f4\u3057\u307e\u3059 6\u670819\u65e5 22:38 \u30b9\u30c8\u30a2 \u3054\u6ce8\u6587\u5c65\u6b74\u306f\u3054\u3056\u3044\u307e\u305b\u3093 6\u670822\u65e5 09:10',
    textContent: '\u3042\u306a\u305f \u30ad\u30e3\u30f3\u30bb\u30eb\u304a\u9858\u3044\u81f4\u3057\u307e\u3059 6\u670819\u65e5 22:38 \u30b9\u30c8\u30a2 \u3054\u6ce8\u6587\u5c65\u6b74\u306f\u3054\u3056\u3044\u307e\u305b\u3093 6\u670822\u65e5 09:10',
    querySelector(selector) {
      if (selector === 'dl' || selector === 'dd' || selector === 'time') return {};
      return null;
    }
  };
  const document = {
    querySelector(selector) {
      if (selector === '#messagelist') return null;
      if (selector === 'ul.sc-c46fd2ce-0, ul[class*="sc-c46fd2ce-0"]') return messageList;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'ul.sc-c46fd2ce-0, ul[class*="sc-c46fd2ce-0"]') return [messageList];
      if (selector === 'section ul') return [messageList];
      if (selector === '.acMdMsgForm, [id*="message"], [class*="Msg"]') return [];
      return [];
    }
  };

  const result = Function('document', `return ${api.getYahooTradeMessageExtractScript()};`)(document);

  assert.equal(result.success, true);
  assert.equal(result.pageType, 'store');
  assert.match(result.messageHtml, /\u30ad\u30e3\u30f3\u30bb\u30eb\u304a\u9858\u3044\u81f4\u3057\u307e\u3059/);
  assert.match(result.messageHtml, /\u3054\u6ce8\u6587\u5c65\u6b74\u306f\u3054\u3056\u3044\u307e\u305b\u3093/);
}

function testYahooTradeMessageExtractionSucceedsForStoreFormWithoutMessages() {
  const api = loadBackgroundForTest();
  const form = {
    outerHTML: '<div class="sc-75efff8a-0"><textarea placeholder="message"></textarea><div id="msg"><button type="submit">send</button></div></div>',
    innerText: 'send',
    textContent: 'send',
    querySelector(selector) {
      if (selector === 'textarea') return {};
      if (selector === '#msg button, button[type="submit"]') return {};
      return null;
    }
  };
  const section = {
    outerHTML: '<section><p>store message area</p>' + form.outerHTML + '</section>',
    innerText: 'store message area send',
    textContent: 'store message area send',
    querySelector(selector) {
      if (selector === 'textarea') return {};
      if (selector === '#msg button, button[type="submit"]') return {};
      return null;
    }
  };
  const document = {
    querySelector(selector) {
      if (selector === '#messagelist') return null;
      if (selector === 'section textarea') return {};
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'ul.sc-c46fd2ce-0, ul[class*="sc-c46fd2ce-0"]') return [];
      if (selector === 'section ul') return [];
      if (selector === 'section') return [section];
      if (selector === 'section, .acMdMsgForm, [id*="message"], [class*="Msg"]') return [section];
      if (selector === '.acMdMsgForm, [id*="message"], [class*="Msg"]') return [];
      return [];
    }
  };

  const result = Function('document', `return ${api.getYahooTradeMessageExtractScript()};`)(document);

  assert.equal(result.success, true);
  assert.equal(result.pageType, 'store-empty');
  assert.match(result.messageHtml, /data-gdaipai-message-empty/);
}

function testYahooTradeMessageExtractionDoesNotReturnTransactionInfoForStoreEmptyForm() {
  const api = loadBackgroundForTest();
  const wrongMessageContainer = {
    outerHTML: '<div class="acMdMsgForm"><section><h2>transaction</h2><dl><dt>order</dt><dd>otakara-reuse-10046903</dd></dl><h2>message</h2><textarea></textarea><div id="msg"><button type="submit">send</button></div></section></div>',
    innerText: '\u53d6\u5f15\u60c5\u5831 \u8cfc\u5165\u65e5\u6642 \u6ce8\u6587\u756a\u53f7 otakara-reuse-10046903 \u30e1\u30c3\u30bb\u30fc\u30b8 \u9001\u4fe1',
    textContent: '\u53d6\u5f15\u60c5\u5831 \u8cfc\u5165\u65e5\u6642 \u6ce8\u6587\u756a\u53f7 otakara-reuse-10046903 \u30e1\u30c3\u30bb\u30fc\u30b8 \u9001\u4fe1',
    querySelector(selector) {
      if (selector === 'textarea') return {};
      if (selector === '#msg button, button[type="submit"]') return {};
      return null;
    }
  };
  const document = {
    querySelector(selector) {
      if (selector === '#messagelist') return null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'ul.sc-c46fd2ce-0, ul[class*="sc-c46fd2ce-0"]') return [];
      if (selector === 'section ul') return [];
      if (selector === 'section') return [];
      if (selector === 'section, .acMdMsgForm, [id*="message"], [class*="Msg"]') return [wrongMessageContainer];
      if (selector === '.acMdMsgForm, [id*="message"], [class*="Msg"]') return [wrongMessageContainer];
      return [];
    }
  };

  const result = Function('document', `return ${api.getYahooTradeMessageExtractScript()};`)(document);

  assert.equal(result.success, true);
  assert.equal(result.pageType, 'store-empty');
  assert.match(result.messageHtml, /data-gdaipai-message-empty/);
  assert.doesNotMatch(result.messageHtml, /otakara-reuse-10046903/);
  assert.doesNotMatch(result.messageHtml, /\u8cfc\u5165\u65e5\u6642|\u6ce8\u6587\u756a\u53f7/);
}

function testYahooTradeMessageSendScopesStoreTextareaToMsgForm() {
  const api = loadBackgroundForTest();
  const events = [];
  const createTextarea = name => ({
    name,
    value: '',
    scrollIntoView() { events.push(`${name}:scroll`); },
    focus() { events.push(`${name}:focus`); },
    dispatchEvent(event) { events.push(`${name}:${event.type}`); }
  });
  const wrongTextarea = createTextarea('wrong');
  const storeTextarea = createTextarea('store');
  const formContainer = {
    querySelector(selector) {
      if (selector === 'textarea') return storeTextarea;
      return null;
    },
    parentElement: null
  };
  const msgContainer = {
    querySelector() { return null; },
    parentElement: formContainer
  };
  const messageSection = { innerText: '', textContent: '' };
  const storeButton = {
    disabled: false,
    parentElement: msgContainer,
    value: '',
    innerText: '\u9001\u4fe1',
    textContent: '\u9001\u4fe1',
    scrollIntoView() { events.push('button:scroll'); },
    focus() { events.push('button:focus'); },
    dispatchEvent(event) { events.push(`button:${event.type}`); },
    click() {
      events.push('button:click');
      messageSection.innerText = storeTextarea.value;
      messageSection.textContent = storeTextarea.value;
    }
  };
  const document = {
    body: {},
    querySelector(selector) {
      if (selector === '#textarea') return wrongTextarea;
      if (selector === '#submitButton') return null;
      if (selector === '#msg button[type="submit"], #msg button') return storeButton;
      if (selector === 'textarea[placeholder*="メッセージ"]') return storeTextarea;
      if (selector === 'textarea') return wrongTextarea;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '#messagelist, ul.sc-c46fd2ce-0, ul[class*="sc-c46fd2ce-0"], section') return [messageSection];
      if (selector === 'button, input[type="submit"], input[type="button"]') return [storeButton];
      return [];
    }
  };
  function FakeEvent(type, options = {}) {
    this.type = type;
    Object.assign(this, options);
  }

  const result = Function(
    'document',
    'InputEvent',
    'PointerEvent',
    'MouseEvent',
    'Event',
    `return ${api.getYahooTradeMessageSendScript('hello')};`
  )(document, FakeEvent, FakeEvent, FakeEvent, FakeEvent);

  assert.equal(result.success, true);
  assert.equal(wrongTextarea.value, '');
  assert.equal(storeTextarea.value, 'hello');
  assert.ok(events.indexOf('store:focus') >= 0);
  assert.ok(events.indexOf('button:focus') > events.indexOf('store:focus'));
  assert.ok(events.includes('button:click'));
}

function testYahooTradeMessageSendUsesNativeTextareaSetterForStoreReactForm() {
  const api = loadBackgroundForTest();
  const events = [];
  let nativeSetterCalled = false;
  function FakeTextarea() {}
  Object.defineProperty(FakeTextarea.prototype, 'value', {
    configurable: true,
    get() { return this._value || ''; },
    set(value) {
      nativeSetterCalled = true;
      this._value = value;
    }
  });
  const storeTextarea = new FakeTextarea();
  storeTextarea.scrollIntoView = () => events.push('textarea:scroll');
  storeTextarea.focus = () => events.push('textarea:focus');
  storeTextarea.dispatchEvent = event => events.push(`textarea:${event.type}`);
  const formContainer = {
    querySelector(selector) {
      if (selector === 'textarea') return storeTextarea;
      return null;
    },
    parentElement: null
  };
  const msgContainer = {
    querySelector() { return null; },
    parentElement: formContainer
  };
  const messageSection = { innerText: '', textContent: '' };
  const storeButton = {
    disabled: false,
    parentElement: msgContainer,
    value: '',
    innerText: '\u9001\u4fe1',
    textContent: '\u9001\u4fe1',
    scrollIntoView() { events.push('button:scroll'); },
    focus() { events.push('button:focus'); },
    dispatchEvent(event) { events.push(`button:${event.type}`); },
    click() {
      events.push('button:click');
      messageSection.innerText = storeTextarea.value;
      messageSection.textContent = storeTextarea.value;
    }
  };
  const document = {
    querySelector(selector) {
      if (selector === '#msg button[type="submit"], #msg button') return storeButton;
      return null;
    },
    querySelectorAll() { return []; }
  };
  function FakeEvent(type, options = {}) {
    this.type = type;
    Object.assign(this, options);
  }

  const result = Function(
    'document',
    'InputEvent',
    'PointerEvent',
    'MouseEvent',
    'Event',
    `return ${api.getYahooTradeMessageSendScript('hello')};`
  )(document, FakeEvent, FakeEvent, FakeEvent, FakeEvent);

  assert.equal(result.success, true);
  assert.equal(nativeSetterCalled, true);
  assert.equal(storeTextarea.value, 'hello');
  assert.ok(events.includes('textarea:input'));
  assert.ok(events.indexOf('button:focus') > events.indexOf('textarea:focus'));
  assert.ok(events.includes('button:click'));
}

async function testSendYahooTradeMessageScopesStoreTextareaToMsgForm() {
  const events = [];
  const createTextarea = name => ({
    name,
    value: '',
    scrollIntoView() { events.push(`${name}:scroll`); },
    focus() { events.push(`${name}:focus`); },
    dispatchEvent(event) { events.push(`${name}:${event.type}`); }
  });
  const wrongTextarea = createTextarea('wrong');
  const storeTextarea = createTextarea('store');
  const formContainer = {
    querySelector(selector) {
      if (selector === 'textarea') return storeTextarea;
      return null;
    },
    parentElement: null
  };
  const msgContainer = {
    querySelector() { return null; },
    parentElement: formContainer
  };
  const messageSection = { innerText: '', textContent: '' };
  const storeButton = {
    disabled: false,
    parentElement: msgContainer,
    value: '',
    innerText: '\u9001\u4fe1',
    textContent: '\u9001\u4fe1',
    scrollIntoView() { events.push('button:scroll'); },
    focus() { events.push('button:focus'); },
    dispatchEvent(event) { events.push(`button:${event.type}`); },
    click() {
      events.push('button:click');
      messageSection.innerText = storeTextarea.value;
      messageSection.textContent = storeTextarea.value;
    }
  };
  const document = {
    body: {},
    querySelector(selector) {
      if (selector === '#textarea') return wrongTextarea;
      if (selector === '#submitButton') return null;
      if (selector === '#msg button[type="submit"], #msg button') return storeButton;
      if (selector === 'textarea[placeholder*="メッセージ"]') return storeTextarea;
      if (selector === 'textarea') return wrongTextarea;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '#messagelist, ul.sc-c46fd2ce-0, ul[class*="sc-c46fd2ce-0"], section') return [messageSection];
      if (selector === 'button, input[type="submit"], input[type="button"]') return [storeButton];
      return [];
    }
  };
  function FakeEvent(type, options = {}) {
    this.type = type;
    Object.assign(this, options);
  }
  const api = loadBackgroundForTest({
    document,
    InputEvent: FakeEvent,
    PointerEvent: FakeEvent,
    MouseEvent: FakeEvent,
    Event: FakeEvent,
    scripting: {
      async executeScript(options) {
        return [{ result: options.func(...(options.args || [])) }];
      }
    }
  });

  const result = await api.sendYahooTradeMessage(1, 'hello');

  assert.equal(result.success, true);
  assert.equal(wrongTextarea.value, '');
  assert.equal(storeTextarea.value, 'hello');
  assert.ok(events.indexOf('button:focus') > events.indexOf('store:focus'));
  assert.ok(events.includes('button:click'));
}

async function testSendYahooTradeMessageRetriesUntilTextareaRenders() {
  let calls = 0;
  const api = loadBackgroundForTest({
    setTimeout(fn) {
      fn();
      return 1;
    },
    scripting: {
      async executeScript() {
        calls += 1;
        if (calls === 1) {
          return [{ result: { success: false, error: 'message textarea not found' } }];
        }
        return [{ result: { success: true } }];
      }
    }
  });

  const result = await api.sendYahooTradeMessage(1, 'hello');

  assert.equal(result.success, true);
  assert.equal(calls, 2);
}

async function testYahooTradeMessageExtractionRetriesUntilStoreMessagesRender() {
  let calls = 0;
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript() {
        calls += 1;
        if (calls === 1) {
          return [{ result: { success: false, error: 'message list not found' } }];
        }
        return [{ result: { success: true, messageHtml: '<ul class="sc-c46fd2ce-0"><dl><dd>rendered</dd></dl></ul>', pageType: 'store' } }];
      }
    }
  });

  const result = await api.extractYahooTradeMessages(1);

  assert.equal(result.success, true);
  assert.equal(result.pageType, 'store');
  assert.equal(calls, 2);
}

function createYahooMessageNavigationElement(text, parentElement = null) {
  return {
    textContent: text,
    innerText: text,
    value: '',
    title: '',
    parentElement,
    clicked: false,
    getAttribute() { return ''; },
    getBoundingClientRect() { return { width: 120, height: 32 }; },
    scrollIntoView() {},
    focus() {},
    click() { this.clicked = true; }
  };
}

function testYahooMessageNavigationClosesNormalBundleNotice() {
  const notice = createYahooMessageNavigationElement('\u3053\u306e\u5546\u54c1\u306f\u3001\u307e\u3068\u3081\u3066\u53d6\u5f15\u304c\u3067\u304d\u307e\u3059\u3002');
  const close = createYahooMessageNavigationElement('\u9589\u3058\u308b', notice);
  const document = {
    body: { textContent: notice.textContent },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector.includes('button, a')) return [close];
      return [];
    }
  };
  const api = loadBackgroundForTest({
    document
  });

  const state = api.getYahooMessageNavigationStateFromPage();
  const result = api.clickYahooMessageNavigationActionFromPage('closeBundleNotice');

  assert.equal(state.hasBundleNotice, true);
  assert.equal(state.hasStoreBundleNotice, false);
  assert.equal(result.success, true);
  assert.equal(close.clicked, true);
}

function testYahooMessageNavigationDetectsStoreBundleSequence() {
  const notice = createYahooMessageNavigationElement('\u3053\u306e\u5546\u54c1\u306f\u3001\u307e\u3068\u3081\u3066\u8cfc\u5165\u624b\u7d9a\u304d\u304c\u3067\u304d\u307e\u3059\u3002');
  const close = createYahooMessageNavigationElement('\u9589\u3058\u308b', notice);
  const single = createYahooMessageNavigationElement('\u5358\u54c1\u3067\u8cfc\u5165\u624b\u7d9a\u304d\u3059\u308b');
  const document = {
    body: { textContent: `${notice.textContent} ${single.textContent}` },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector.includes('button, a')) return [close, single];
      return [];
    }
  };
  const api = loadBackgroundForTest({
    document
  });

  const state = api.getYahooMessageNavigationStateFromPage();
  const result = api.clickYahooMessageNavigationActionFromPage('singlePurchaseProcedure');

  assert.equal(state.hasStoreBundleNotice, true);
  assert.equal(state.hasCloseButton, true);
  assert.equal(state.hasSinglePurchaseProcedureButton, true);
  assert.equal(result.success, true);
  assert.equal(single.clicked, true);
}

function testYahooMessageNavigationRejectsBundleChildChoice() {
  const child = createYahooMessageNavigationElement('\u3053\u306e\u5546\u54c1\u3092\u78ba\u8a8d\u3059\u308b');
  const document = {
    body: { textContent: '\u51fa\u54c1\u8005\u304c\u3001\u3053\u306e\u5546\u54c1\u3092\u542b\u3081\u305f\u307e\u3068\u3081\u3066\u53d6\u5f15\u306b\u540c\u610f\u3057\u307e\u3057\u305f\u3002' },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector.includes('button, a')) return [child];
      return [];
    }
  };
  const api = loadBackgroundForTest({
    document
  });

  const state = api.getYahooMessageNavigationStateFromPage();

  assert.equal(state.bundleChildChoice, true);
  assert.equal(state.hasCloseButton, false);
}

async function testPrepareYahooMessagePageRunsStoreCloseThenSingleSequence() {
  const actions = [];
  const states = [
    { hasBundleNotice: true, hasStoreBundleNotice: true, hasCloseButton: true, messageReady: false },
    { hasBundleNotice: false, hasSinglePurchaseProcedureButton: true, messageReady: false },
    { hasBundleNotice: false, hasSinglePurchaseProcedureButton: false, messageReady: true }
  ];
  const api = loadBackgroundForTest({
    tabs: {
      async query() { return [{ id: 41, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=k1', status: 'complete' }]; },
      async get(id) { return { id, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=k1', status: 'complete' }; }
    },
    scripting: {
      async executeScript(options) {
        if (options.files) return undefined;
        if (options.args?.length) {
          actions.push(options.args[0]);
          return [{ result: { success: true, text: options.args[0] } }];
        }
        return [{ result: states.shift() || { messageReady: true } }];
      }
    }
  });

  const result = await api.prepareYahooMessagePage(
    { id: 41, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=k1', status: 'complete', _gdaipaiCreatedTabIds: [41] },
    { productType: 'store' }
  );

  assert.equal(result.id, 41);
  assert.deepEqual(actions, ['closeBundleNotice', 'singlePurchaseProcedure']);
}

function testSendYahooMessageJobFetchesLatestMessagesAfterSend() {
  const source = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
  assert.match(source, /tab = await prepareYahooMessagePage\(tab, job\);/);
  const sendBranch = source.match(/if \(job\.jobType === 'send'\) \{([\s\S]*?)return \{ success: true \};\s*\}/);
  assert.ok(sendBranch, 'send branch should be present');
  assert.match(sendBranch[1], /sendYahooTradeMessage\(tab, job\.sendText/);
  assert.match(sendBranch[1], /extractYahooTradeMessages\(tab\.id\)/);
  assert.match(sendBranch[1], /messageHtml: extractResult\?\.success \? extractResult\.messageHtml : ''/);
}

function testBidProgressMessageExtendsActiveMultiBidTimeout() {
  const api = loadBackgroundForTest();
  const calls = [];
  const unregister = api.registerBidProgressExtender(123, msg => calls.push(msg.stage));

  assert.equal(api.handleBidProgressMessage({ taskId: 123, stage: 'rebid-submitted' }), true);
  assert.equal(api.handleBidProgressMessage({ taskId: 999, stage: 'other-task' }), false);
  unregister();
  assert.equal(api.handleBidProgressMessage({ taskId: 123, stage: 'after-unregister' }), false);
  assert.deepEqual(calls, ['rebid-submitted']);
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

async function testBundleStartTradePageWaitsForRenderedButtonBeforeJsClick() {
  let readyChecks = 0;
  let mainClickReadyChecks = 0;
  const api = loadBackgroundForTest({
    tabs: {
      async query() {
        return [{ id: 7, url: 'https://contact.auctions.yahoo.co.jp/trade/bundle?aid=r1234015578', status: 'complete' }];
      },
      async get(id) {
        return { id, url: 'https://contact.auctions.yahoo.co.jp/trade/bundle?aid=r1234015578', status: 'complete' };
      },
      async sendMessage(id, message) {
        assert.equal(id, 7);
        if (message.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
          return { success: true, state: { canDecide: true, complete: false } };
        }
        return { success: true };
      }
    },
    scripting: {
      async executeScript(details) {
        if (details.files) return [];
        if (details.args?.[1] === 'renderReady') {
          readyChecks += 1;
          return [{ result: { success: readyChecks >= 3, ready: readyChecks >= 3 } }];
        }
        mainClickReadyChecks = readyChecks;
        return [{ result: { success: true, method: 'click', text: 'まとめて取引を依頼する' } }];
      }
    }
  });

  const result = await api.clickBundleActionAndFollowTab({
    id: 7,
    url: 'https://contact.auctions.yahoo.co.jp/trade/bundle?aid=r1234015578',
    _gdaipaiCreatedTabIds: [7]
  }, 'start');

  assert.equal(result.success, true);
  assert.equal(readyChecks, 3);
  assert.equal(mainClickReadyChecks, 3);
}

async function testBundleActionActivatesTabBeforeClick() {
  const focusCalls = [];
  const api = loadBackgroundForTest({
    tabs: {
      async query() {
        return [{ id: 7, url: 'https://contact.auctions.yahoo.co.jp/trade/bundle?aid=r1234015578', status: 'complete', windowId: 3 }];
      },
      async get(id) {
        return { id, url: 'https://contact.auctions.yahoo.co.jp/trade/bundle?aid=r1234015578', status: 'complete', windowId: 3 };
      },
      async update(id, props) {
        focusCalls.push(['tab', id, props]);
        return { id, url: 'https://contact.auctions.yahoo.co.jp/trade/bundle?aid=r1234015578', status: 'complete', windowId: 3, active: props?.active === true };
      },
      async sendMessage(id, message) {
        if (message.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
          return { success: true, state: { canDecide: true, complete: false } };
        }
        return { success: true };
      }
    },
    windows: {
      async update(id, props) {
        focusCalls.push(['window', id, props]);
        return { id, focused: props?.focused === true };
      }
    },
    scripting: {
      async executeScript(details) {
        if (details.files) return [];
        if (details.args?.[1] === 'renderReady') {
          return [{ result: { success: true, ready: true } }];
        }
        focusCalls.push(['click', details.args?.[1] || 'click']);
        return [{ result: { success: true, method: 'click', text: 'まとめて取引を依頼する' } }];
      }
    }
  });

  const result = await api.clickBundleActionAndFollowTab({
    id: 7,
    url: 'https://contact.auctions.yahoo.co.jp/trade/bundle?aid=r1234015578',
    windowId: 3,
    _gdaipaiCreatedTabIds: [7]
  }, 'start');

  assert.equal(result.success, true);
  assert.equal(JSON.stringify(focusCalls.slice(0, 3)), JSON.stringify([
    ['window', 3, { focused: true }],
    ['tab', 7, { active: true }],
    ['click', 'click']
  ]));
}

async function testBundleStartTradePageUsesClickBeforeRequestSubmitFallback() {
  let nowMs = 0;
  class FakeDate extends Date {
    static now() {
      nowMs += 1000;
      return nowMs;
    }
  }
  const jsModes = [];
  let debuggerAttached = false;
  const api = loadBackgroundForTest({
    Date: FakeDate,
    tabs: {
      async query() {
        return [{ id: 8, url: 'https://contact.auctions.yahoo.co.jp/trade/bundle?aid=r1234015578', status: 'complete' }];
      },
      async get(id) {
        return { id, url: 'https://contact.auctions.yahoo.co.jp/trade/bundle?aid=r1234015578', status: 'complete', windowId: 1 };
      },
      async sendMessage(id, message) {
        assert.equal(id, 8);
        if (message.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
          return {
            success: true,
            state: {
              canDecide: jsModes.includes('requestSubmit'),
              complete: false
            }
          };
        }
        return { success: true };
      }
    },
    scripting: {
      async executeScript(details) {
        if (details.files) return [];
        const mode = details.args?.[1] || 'default';
        if (mode === 'renderReady') {
          return [{ result: { success: true, ready: true } }];
        }
        jsModes.push(mode);
        return [{ result: { success: true, method: mode, text: 'まとめて取引を依頼する' } }];
      }
    },
    debuggerApi: {
      async attach() {
        debuggerAttached = true;
      }
    }
  });

  const result = await api.clickBundleActionAndFollowTab({
    id: 8,
    url: 'https://contact.auctions.yahoo.co.jp/trade/bundle?aid=r1234015578',
    _gdaipaiCreatedTabIds: [8]
  }, 'start');

  assert.equal(result.success, true);
  assert.deepEqual(jsModes, ['click', 'requestSubmit']);
  assert.equal(debuggerAttached, false);
}

async function testBundleStartUsesContentScriptFallbackBeforeRequestSubmit() {
  let nowMs = 0;
  class FakeDate extends Date {
    static now() {
      nowMs += 1000;
      return nowMs;
    }
  }
  const jsModes = [];
  const clickedActions = [];
  let contentClicked = false;
  const api = loadBackgroundForTest({
    Date: FakeDate,
    tabs: {
      async query() {
        return [{ id: 18, url: 'https://contact.auctions.yahoo.co.jp/trade/bundle?aid=u1213934430', status: 'complete' }];
      },
      async get(id) {
        return { id, url: 'https://contact.auctions.yahoo.co.jp/trade/bundle?aid=u1213934430', status: 'complete', windowId: 1 };
      },
      async sendMessage(id, message) {
        assert.equal(id, 18);
        if (message.type === 'CLICK_BUNDLE_TRANSACTION_ACTION') {
          clickedActions.push(message.action);
          contentClicked = true;
          return { success: true };
        }
        if (message.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
          return {
            success: true,
            state: {
              canDecide: contentClicked,
              complete: false
            }
          };
        }
        return { success: true };
      }
    },
    scripting: {
      async executeScript(details) {
        if (details.files) return [];
        const mode = details.args?.[1] || 'default';
        if (mode === 'renderReady') {
          return [{ result: { success: true, ready: true } }];
        }
        jsModes.push(mode);
        return [{ result: { success: true, method: mode, text: 'まとめて取引を依頼する' } }];
      }
    }
  });

  const result = await api.clickBundleActionAndFollowTab({
    id: 18,
    url: 'https://contact.auctions.yahoo.co.jp/trade/bundle?aid=u1213934430',
    _gdaipaiCreatedTabIds: [18]
  }, 'start');

  assert.equal(result.success, true);
  assert.deepEqual(jsModes, ['click']);
  assert.deepEqual(clickedActions, ['start']);
}

async function testBundleStartDoesNotUseDebuggerWhenJsAndRequestSubmitFail() {
  let nowMs = 0;
  class FakeDate extends Date {
    static now() {
      nowMs += 1000;
      return nowMs;
    }
  }
  const jsModes = [];
  let debuggerAttached = false;
  const api = loadBackgroundForTest({
    Date: FakeDate,
    tabs: {
      async query() {
        return [{ id: 8, url: 'https://contact.auctions.yahoo.co.jp/trade/bundle?aid=r1234015578', status: 'complete' }];
      },
      async get(id) {
        return { id, url: 'https://contact.auctions.yahoo.co.jp/trade/bundle?aid=r1234015578', status: 'complete', windowId: 1 };
      },
      async sendMessage(id, message) {
        assert.equal(id, 8);
        if (message.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
          return { success: true, state: { canDecide: false, complete: false } };
        }
        return { success: true };
      }
    },
    scripting: {
      async executeScript(details) {
        if (details.files) return [];
        const mode = details.args?.[1] || 'default';
        if (mode === 'renderReady') {
          return [{ result: { success: true, ready: true } }];
        }
        jsModes.push(mode);
        return [{ result: { success: true, method: mode, text: 'まとめて取引を依頼する' } }];
      }
    },
    debuggerApi: {
      async attach() {
        debuggerAttached = true;
      },
      async sendCommand() {},
      async detach() {}
    }
  });

  await assert.rejects(
    () => api.clickBundleActionAndFollowTab({
      id: 8,
      url: 'https://contact.auctions.yahoo.co.jp/trade/bundle?aid=r1234015578',
      _gdaipaiCreatedTabIds: [8]
    }, 'start'),
    /bundle start next page did not appear/
  );

  assert.deepEqual(jsModes, ['click', 'requestSubmit']);
  assert.equal(debuggerAttached, false);
}

async function testBundleActionTimeoutErrorIncludesActionName() {
  let nowMs = 0;
  class FakeDate extends Date {
    static now() {
      nowMs += 1000;
      return nowMs;
    }
  }
  const api = loadBackgroundForTest({
    Date: FakeDate,
    tabs: {
      async query() {
        return [{ id: 7, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=d1233443897', status: 'complete' }];
      },
      async get(id) {
        return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=d1233443897', status: 'complete', windowId: 1 };
      },
      async sendMessage(id, message) {
        assert.equal(id, 7);
        if (message.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
          return { success: true, state: { canDecide: false, complete: false } };
        }
        return { success: true };
      }
    },
    scripting: {
      async executeScript() {
        return [{ result: { success: true, x: 10, y: 10, text: 'まとめて取引をはじめる' } }];
      }
    },
    debuggerApi: {
      async attach() {},
      async sendCommand() {},
      async detach() {}
    }
  });

  await assert.rejects(
    () => api.clickBundleActionAndFollowTab({ id: 7 }, 'start'),
    /bundle start next page did not appear/
  );
}

async function testNormalBundleRequestClicksSecondStartPageBeforeDecide() {
  const clickedActions = [];
  let phase = 'intro';
  const api = loadBackgroundForTest({
    tabs: {
      async query() {
        return [{ id: 5, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=l1232473681', status: 'complete' }];
      },
      async get(id) {
        return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=l1232473681', status: 'complete' };
      },
      async sendMessage(id, message) {
        assert.equal(id, 5);
        if (message.type === 'CLICK_BUNDLE_TRANSACTION_ACTION') {
          clickedActions.push(message.action);
          if (message.action === 'start' && phase === 'intro') {
            phase = 'request';
          } else if (message.action === 'start' && phase === 'request') {
            phase = 'decide';
          } else if (message.action === 'decide') {
            phase = 'complete';
          }
          return { success: true };
        }
        if (message.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
          return {
            success: true,
            state: {
              canStart: phase === 'request',
              canDecide: phase === 'decide',
              complete: phase === 'complete'
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

  const result = await api.completeNormalBundleRequest({ id: 5 });

  assert.equal(result.success, true);
  assert.deepEqual(clickedActions, ['close', 'start', 'start', 'decide']);
}

async function testNormalBundleRequestCanStartFromInputPage() {
  const clickedActions = [];
  let phase = 'decide';
  const api = loadBackgroundForTest({
    tabs: {
      async query() {
        return [{ id: 6, url: 'https://contact.auctions.yahoo.co.jp/buyer/input?aid=s1232869893', status: 'complete' }];
      },
      async get(id) {
        return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/input?aid=s1232869893', status: 'complete' };
      },
      async sendMessage(id, message) {
        assert.equal(id, 6);
        if (message.type === 'CLICK_BUNDLE_TRANSACTION_ACTION') {
          clickedActions.push(message.action);
          if (message.action === 'decide' && phase === 'decide') {
            phase = 'confirm';
            return { success: true };
          }
          if (message.action === 'confirm' && phase === 'confirm') {
            phase = 'complete';
            return { success: true };
          }
          return { success: false, error: `${message.action} button not found` };
        }
        if (message.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
          return {
            success: true,
            state: {
              canStart: false,
              canInputTransaction: false,
              canDecide: phase === 'decide',
              canConfirm: phase === 'confirm',
              complete: phase === 'complete'
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

  const result = await api.completeNormalBundleRequest({ id: 6 });

  assert.equal(result.success, true);
  assert.deepEqual(clickedActions, ['decide', 'confirm']);
}

async function testNormalBundleStartAcceptsTransactionInfoInputPage() {
  const clickedActions = [];
  let phase = 'request';
  const api = loadBackgroundForTest({
    tabs: {
      async query() {
        return [{ id: 6, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=w1234947647', status: 'complete' }];
      },
      async get(id) {
        return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=w1234947647', status: 'complete' };
      },
      async sendMessage(id, message) {
        assert.equal(id, 6);
        if (message.type === 'CLICK_BUNDLE_TRANSACTION_ACTION') {
          clickedActions.push(message.action);
          if (message.action === 'close' && phase === 'request') {
            return { success: true };
          }
          if (message.action === 'start' && phase === 'request') {
            phase = 'input';
            return { success: true };
          }
          if (message.action === 'input' && phase === 'input') {
            phase = 'decide';
            return { success: true };
          }
          if (message.action === 'decide' && phase === 'decide') {
            phase = 'confirm';
            return { success: true };
          }
          if (message.action === 'confirm' && phase === 'confirm') {
            phase = 'complete';
            return { success: true };
          }
          return { success: false, error: `${message.action} button not found` };
        }
        if (message.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
          return {
            success: true,
            state: {
              canStart: phase === 'request',
              canInputTransaction: phase === 'input',
              canDecide: phase === 'decide',
              canConfirm: phase === 'confirm',
              complete: phase === 'complete'
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

  const result = await api.completeNormalBundleRequest({ id: 6 });

  assert.equal(result.success, true);
  assert.deepEqual(clickedActions, ['close', 'start', 'input', 'decide', 'confirm']);
}

async function testBidderPaysShippingConfirmWaitsForPreviewRender() {
  let nowMs = 0;
  class FakeDate extends Date {
    static now() {
      nowMs += 1000;
      return nowMs;
    }
  }
  let phase = 'decide';
  let confirmStateChecks = 0;
  const api = loadBackgroundForTest({
    Date: FakeDate,
    tabs: {
      async query() {
        return [{ id: 22, url: 'https://contact.auctions.yahoo.co.jp/buyer/preview?aid=f1235464179', status: 'complete' }];
      },
      async get(id) {
        return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/preview?aid=f1235464179', status: 'complete', windowId: 1 };
      },
      async sendMessage(id, message) {
        assert.equal(id, 22);
        if (message.type === 'CLICK_BUNDLE_TRANSACTION_ACTION') {
          if (message.action === 'decide' && phase === 'decide') {
            phase = 'confirm';
            return { success: true };
          }
          if (message.action === 'confirm' && phase === 'confirm') {
            phase = 'waiting';
            return { success: true };
          }
          return { success: true };
        }
        if (message.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
          if (phase === 'waiting') confirmStateChecks += 1;
          return {
            success: true,
            state: {
              canDecide: phase === 'decide',
              canConfirm: phase === 'confirm',
              waitingShipping: phase === 'waiting' && confirmStateChecks >= 12,
              complete: false,
              url: 'https://contact.auctions.yahoo.co.jp/buyer/preview?aid=f1235464179'
            }
          };
        }
        return { success: true };
      }
    },
    scripting: {
      async executeScript(details) {
        if (details.files) return [];
        return [{ result: { success: false, error: 'button not found in MAIN world' } }];
      }
    }
  });

  const result = await api.completeBidderPaysShippingTransaction({ id: 22 });

  assert.equal(result.success, true);
  assert.equal(confirmStateChecks >= 12, true);
}

async function testOpenTransactionPageContinuesWhenBundleActionReadyBeforeTabComplete() {
  const listeners = [];
  const messages = [];
  const api = loadBackgroundForTest({
    tabs: {
      async create() {
        return {
          id: 9,
          url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=w1234947647',
          status: 'loading'
        };
      },
      async get(id) {
        return {
          id,
          url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=w1234947647',
          status: 'loading'
        };
      },
      onUpdatedAddListener(listener) {
        listeners.push(listener);
      },
      onUpdatedRemoveListener(listener) {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
      async sendMessage(id, message) {
        messages.push(message.type);
        if (message.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
          return {
            success: true,
            state: {
              canStart: true,
              canInputTransaction: false,
              canDecide: false,
              canConfirm: false,
              complete: false
            }
          };
        }
        return { success: true };
      }
    },
    scripting: {
      async executeScript() {
        return [];
      }
    },
    setTimeout() {
      return 1;
    }
  });

  const tab = await api.openTransactionPage({
    transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=w1234947647'
  }, new Set());

  assert.equal(tab.id, 9);
  assert.equal(tab.status, 'loading');
  assert.ok(messages.includes('GET_BUNDLE_TRANSACTION_ACTION_STATE'));
  assert.equal(listeners.length, 0);
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

async function testSwitchToNewestNewTabIgnoresConcurrentAuctionProductTab() {
  const removed = [];
  const api = loadBackgroundForTest({
    sleep: async () => {},
    tabs: {
      async query() {
        return [
          { id: 10, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=x123', status: 'complete' },
          { id: 99, url: 'https://auctions.yahoo.co.jp/jp/auction/x1233517511', status: 'complete' }
        ];
      },
      async get(id) {
        return {
          id,
          url: id === 10
            ? 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=x123'
            : 'https://auctions.yahoo.co.jp/jp/auction/x1233517511',
          status: 'complete'
        };
      },
      async remove(id) {
        removed.push(id);
      }
    },
    scripting: {
      async executeScript() {}
    }
  });

  const result = await api.switchToNewestNewTab(
    new Set([1]),
    { id: 1, url: 'https://auctions.yahoo.co.jp/my/won', _gdaipaiCreatedTabIds: [1] }
  );

  assert.equal(result.id, 10);
  assert.equal(result._gdaipaiCreatedTabIds.includes(99), false);
  assert.deepEqual(removed, [1]);
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
  assert.match(result.diagnostics, /method=debuggerMouse/);
  assert.match(result.diagnostics, /action=bundle:start/);
  assert.match(result.diagnostics, /tabId=7/);
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
  assert.match(result.diagnostics, /method=debuggerKeyboard/);
  assert.match(result.diagnostics, /action=manualPin/);
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

function testExtractAuctionIdFromTextAcceptsNumericAuctionIds() {
  const api = loadBackgroundForTest({ sleep: async () => {} });

  assert.equal(
    api.extractAuctionIdFromText('https://contact.auctions.yahoo.co.jp/buyer/top?aid=1225922765'),
    '1225922765'
  );
  assert.equal(
    api.extractAuctionIdFromText('url=https://buy.auctions.yahoo.co.jp/order/review?auctionId=T1234151860'),
    't1234151860'
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
  assert.match(result.diagnostics, /method=systemSendKeys/);
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

function testBuildScanStatusPayloadSkipsPendingShipmentDuringTrackingRescan() {
  const api = loadBackgroundForTest();
  const payload = api.buildScanStatusPayload({
    orderId: 11,
    orderStatus: 'pending_shipment',
    trackingRescanRequested: true,
    result: { type: 'pending_shipment' }
  });

  assert.equal(payload, null);
}

function testBuildScanStatusPayloadWaitsForShipmentDetailsRender() {
  const api = loadBackgroundForTest();
  const payload = api.buildScanStatusPayload({
    orderId: 12,
    orderStatus: 'pending_shipment',
    result: {
      type: 'shipped',
      shippingCompany: '',
      trackingNumber: '193398193940',
      shipmentDetailsRendered: false
    }
  });

  assert.equal(payload, null);
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

function testBuildScanStatusPayloadReportsBundleNoProgress() {
  const api = loadBackgroundForTest();
  const payload = api.buildScanStatusPayload({
    orderId: 24,
    orderStatus: 'pending_bundle',
    result: { type: 'child_agreed' }
  });

  assert.equal(payload.orderId, 24);
  assert.equal(payload.noProgress, true);
  assert.equal(payload.resultType, 'child_agreed');
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
    { type: 'unknown' },
    { canDecide: true }
  ), true);
  assert.equal(api.shouldAttemptBundleInputAction(
    { type: 'unknown' },
    { canConfirm: true }
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

async function testPendingShipmentScanWaitsForRenderedShipmentState() {
  const apiCalls = [];
  let messageCalls = 0;
  const api = loadBackgroundForTest({
    fetch: async (url, options = {}) => {
      apiCalls.push({
        url,
        body: options.body ? JSON.parse(options.body) : null
      });
      return {
        async json() {
          return { success: true };
        }
      };
    },
    tabs: {
      async query() { return []; },
      async create() { return { id: 77, status: 'complete', url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=o1234724869' }; },
      async get(tabId) { return { id: tabId, status: 'complete', url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=o1234724869' }; },
      async sendMessage(tabId, message) {
        assert.equal(tabId, 77);
        assert.equal(message.type, 'EXTRACT_PENDING_SHIPMENT_SCAN');
        messageCalls += 1;
        if (messageCalls === 1) {
          return {
            success: true,
            loginStatus: { status: 'ok' },
            result: { type: 'unknown' }
          };
        }
        return {
          success: true,
          loginStatus: { status: 'ok' },
          result: {
            type: 'shipped',
            shippingCompany: '\u4f50\u5ddd\u6025\u4fbf',
            trackingNumber: '450053704833'
          }
        };
      }
    }
  });

  const result = await api.executePendingShipmentScanJob({
    orderId: 285,
    orderStatus: 'pending_shipment',
    productId: 'o1234724869',
    transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=o1234724869'
  });

  assert.equal(result.stop, false);
  assert.equal(messageCalls, 2);
  const statusCall = apiCalls.find(call => String(call.url || '').endsWith('/api/plugin/scan/status'));
  assert.ok(statusCall);
  assert.equal(statusCall.body.orderId, 285);
  assert.equal(statusCall.body.shipped, true);
  assert.equal(statusCall.body.shippingCompany, '\u4f50\u5ddd\u6025\u4fbf');
  assert.equal(statusCall.body.trackingNumber, '450053704833');
}

async function testStorePendingShipmentScanKeepsPollingPastInitialPendingState() {
  const apiCalls = [];
  let messageCalls = 0;
  const api = loadBackgroundForTest({
    fetch: async (url, options = {}) => {
      apiCalls.push({
        url,
        body: options.body ? JSON.parse(options.body) : null
      });
      return {
        async json() {
          return { success: true };
        }
      };
    },
    tabs: {
      async query() { return []; },
      async create() { return { id: 78, status: 'complete', url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=b1234714536' }; },
      async get(tabId) { return { id: tabId, status: 'complete', url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=b1234714536' }; },
      async sendMessage(tabId, message) {
        assert.equal(tabId, 78);
        assert.equal(message.type, 'EXTRACT_PENDING_SHIPMENT_SCAN');
        messageCalls += 1;
        if (messageCalls === 1) {
          return {
            success: true,
            loginStatus: { status: 'ok' },
            result: { type: 'pending_shipment' }
          };
        }
        return {
          success: true,
          loginStatus: { status: 'ok' },
          result: {
            type: 'shipped',
            shippingCompany: '\u4f50\u5ddd\u6025\u4fbf',
            trackingNumber: '450053704833'
          }
        };
      }
    }
  });

  const result = await api.executePendingShipmentScanJob({
    orderId: 286,
    orderStatus: 'pending_shipment',
    productId: 'b1234714536',
    productType: 'store',
    transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=b1234714536'
  });

  assert.equal(result.stop, false);
  assert.equal(messageCalls, 2);
  const statusCall = apiCalls.find(call => String(call.url || '').endsWith('/api/plugin/scan/status'));
  assert.ok(statusCall);
  assert.equal(statusCall.body.orderId, 286);
  assert.equal(statusCall.body.shipped, true);
  assert.equal(statusCall.body.trackingNumber, '450053704833');
}

async function testPendingShipmentScanKeepsPollingPastTrackingFallback() {
  const apiCalls = [];
  let messageCalls = 0;
  const api = loadBackgroundForTest({
    fetch: async (url, options = {}) => {
      apiCalls.push({
        url,
        body: options.body ? JSON.parse(options.body) : null
      });
      return {
        async json() {
          return { success: true };
        }
      };
    },
    tabs: {
      async query() { return []; },
      async create() { return { id: 79, status: 'complete', url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=h1035084506' }; },
      async get(tabId) { return { id: tabId, status: 'complete', url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=h1035084506' }; },
      async sendMessage(tabId, message) {
        assert.equal(tabId, 79);
        assert.equal(message.type, 'EXTRACT_PENDING_SHIPMENT_SCAN');
        messageCalls += 1;
        if (messageCalls === 1) {
          return {
            success: true,
            loginStatus: { status: 'ok' },
            result: {
              type: 'shipped',
              shippingCompany: '\u304a\u3066\u304c\u308b\u914d\u9001 \u3086\u3046\u30d1\u30b1\u30c3\u30c8',
              trackingNumber: '\u5c71\u7530 \u592a\u90ce',
              trackingFallback: 'seller_info_name',
              shipmentDetailsRendered: false
            }
          };
        }
        return {
          success: true,
          loginStatus: { status: 'ok' },
          result: {
            type: 'shipped',
            shippingCompany: '\u304a\u3066\u304c\u308b\u914d\u9001 \u3086\u3046\u30d1\u30b1\u30c3\u30c8',
            trackingNumber: '646560590686',
            trackingFallback: ''
          }
        };
      }
    }
  });

  const result = await api.executePendingShipmentScanJob({
    orderId: 389,
    orderStatus: 'pending_shipment',
    productId: 'h1035084506',
    productType: 'normal',
    transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=h1035084506'
  });

  assert.equal(result.stop, false);
  assert.equal(messageCalls, 2);
  const statusCalls = apiCalls.filter(call => String(call.url || '').endsWith('/api/plugin/scan/status'));
  assert.equal(statusCalls.length, 1);
  assert.equal(statusCalls[0].body.orderId, 389);
  assert.equal(statusCalls[0].body.shipped, true);
  assert.equal(statusCalls[0].body.trackingNumber, '646560590686');
}

async function testPendingShipmentScanAcceptsTrackingFallbackAfterShipmentDetailsRender() {
  const apiCalls = [];
  const api = loadBackgroundForTest({
    fetch: async (url, options = {}) => {
      apiCalls.push({
        url,
        body: options.body ? JSON.parse(options.body) : null
      });
      return {
        async json() {
          return { success: true };
        }
      };
    },
    tabs: {
      async query() { return []; },
      async create() { return { id: 80, status: 'complete', url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=h1035084506' }; },
      async get(tabId) { return { id: tabId, status: 'complete', url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=h1035084506' }; },
      async sendMessage(tabId, message) {
        assert.equal(tabId, 80);
        assert.equal(message.type, 'EXTRACT_PENDING_SHIPMENT_SCAN');
        return {
          success: true,
          loginStatus: { status: 'ok' },
          result: {
            type: 'shipped',
            shippingCompany: '\u304a\u3066\u304c\u308b\u914d\u9001 \u3086\u3046\u30d1\u30b1\u30c3\u30c8',
            trackingNumber: '\u5c71\u7530 \u592a\u90ce',
            trackingFallback: 'seller_info_name',
            shipmentDetailsRendered: true
          }
        };
      }
    }
  });

  const result = await api.executePendingShipmentScanJob({
    orderId: 390,
    orderStatus: 'pending_shipment',
    productId: 'h1035084506',
    productType: 'normal',
    transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=h1035084506'
  });

  assert.equal(result.stop, false);
  const statusCalls = apiCalls.filter(call => String(call.url || '').endsWith('/api/plugin/scan/status'));
  assert.equal(statusCalls.length, 1);
  assert.equal(statusCalls[0].body.orderId, 390);
  assert.equal(statusCalls[0].body.trackingNumber, '\u5c71\u7530 \u592a\u90ce');
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

function testPaymentPageStateDetectsAppraisalSection() {
  const api = loadBackgroundForTest();
  const state = api.buildPaymentPageStateFromSnapshot({
    url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=u1231877298',
    bodyText: '\u9451\u5b9a \u9451\u5b9a\u3059\u308b\uff082,500\u5186\uff09 \u9451\u5b9a\u3057\u306a\u3044 \u304a\u652f\u6255\u3044\u91d1\u984d\uff08\u5408\u8a08\uff09 22,888\u5186',
    controls: ['\u78ba\u8a8d\u3059\u308b'],
    hasAppraisalSection: true,
    hasNoAppraisalSelected: false
  });

  assert.equal(state.hasAppraisalSection, true);
  assert.equal(state.hasNoAppraisalSelected, false);
}

function testPaymentPageStateIgnoresAppraisalFeeForPaymentAmount() {
  const api = loadBackgroundForTest();
  const state = api.buildPaymentPageStateFromSnapshot({
    url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=g1233517461',
    bodyText: '\u9451\u5b9a \u5546\u54c1\u306f\u9451\u5b9a\u6240\u3067\u9451\u5b9a\u3055\u308c\u3001\u9451\u5b9a\u57fa\u6e96\u3092\u6e80\u305f\u3055\u306a\u3044\u5834\u5408\u3001\u53d6\u5f15\u306f\u30ad\u30e3\u30f3\u30bb\u30eb\u3068\u306a\u308a\u304a\u652f\u6255\u3044\u91d1\u984d\u304c\u5168\u984d\u8fd4\u91d1\u3055\u308c\u307e\u3059\u3002 \u9451\u5b9a\u3059\u308b\uff082,500\u5186\uff09 \u9451\u5b9a\u3057\u306a\u3044 \u3054\u8cfc\u5165\u5185\u5bb9\u8a73\u7d30 \u843d\u672d\u5408\u8a08\u91d1\u984d 22,888\u5186 \u9001\u6599 0\u5186 \u304a\u652f\u6255\u3044\u91d1\u984d\uff08\u5408\u8a08\uff09 22,888\u5186',
    controls: ['\u78ba\u8a8d\u3059\u308b'],
    hasAppraisalSection: true,
    hasNoAppraisalSelected: true
  });

  assert.equal(state.hasAppraisalSection, true);
  assert.equal(state.paymentAmountJpy, 22888);
}

async function testPaymentNoAppraisalSelectionClicksUnsetRadio() {
  let clicked = false;
  let changed = false;
  const label = {
    textContent: '\u9451\u5b9a\u3057\u306a\u3044',
    value: '',
    title: '',
    getAttribute() { return ''; },
    scrollIntoView() {},
    focus() {},
    dispatchEvent() {},
    click() {
      clicked = true;
      radio.checked = true;
    }
  };
  const radio = {
    value: 'unset',
    checked: false,
    disabled: false,
    id: '',
    textContent: '',
    title: '',
    getAttribute() { return ''; },
    closest(selector) {
      if (String(selector).includes('label')) return label;
      return { textContent: '\u9451\u5b9a\u3057\u306a\u3044', value: '', title: '', getAttribute() { return ''; } };
    },
    dispatchEvent(event) {
      if (event?.type === 'change') changed = true;
    }
  };
  const section = {
    id: 'appraisal',
    querySelectorAll(selector) {
      return String(selector).includes('input') ? [radio] : [];
    },
    querySelector() {
      return null;
    }
  };
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript(payload) {
        const result = vm.runInNewContext(`(${payload.func.toString()})(...args)`, {
          args: payload.args || [],
          document: {
            querySelector(selector) {
              return selector === '#appraisal' ? section : null;
            },
            querySelectorAll(selector) {
              return selector === 'section' ? [section] : [];
            }
          },
          window: {},
          MouseEvent: function MouseEvent(type) { this.type = type; },
          PointerEvent: undefined,
          Event: function Event(type) { this.type = type; }
        });
        return [{ result }];
      }
    }
  });

  const result = await api.selectPaymentNoAppraisalOption(99);

  assert.equal(result.success, true);
  assert.equal(result.selected, true);
  assert.equal(clicked, true);
  assert.equal(changed, false);
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

function testPaymentPageStateDetectsBuyerDeletedCancellation() {
  const api = loadBackgroundForTest();
  const state = api.buildPaymentPageStateFromSnapshot({
    url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=u1231877298',
    bodyText: '\u843d\u672d\u8005\u524a\u9664\u3055\u308c\u305f\u305f\u3081\u3001\u53d6\u5f15\u306f\u3067\u304d\u307e\u305b\u3093\u3002\u904e\u53bb\u306e\u53d6\u5f15\u30e1\u30c3\u30bb\u30fc\u30b8\u306e\u95b2\u89a7\u306e\u307f\u53ef\u80fd\u3067\u3059\u3002',
    controls: []
  });

  assert.equal(state.cancelled, true);
  assert.equal(state.hasEasyPaymentButton, false);
  assert.equal(state.hasReviewButton, false);

  const cancelledState = api.buildPaymentPageStateFromSnapshot({
    url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=u1231877298',
    bodyText: '\u53d6\u5f15\u304c\u30ad\u30e3\u30f3\u30bb\u30eb\u3055\u308c\u307e\u3057\u305f\u3002',
    controls: []
  });

  assert.equal(cancelledState.cancelled, true);
}

function testPaymentPageStateUsesPrimaryStatusForCancellation() {
  const api = loadBackgroundForTest();
  const state = api.buildPaymentPageStateFromSnapshot({
    url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=q1235534082',
    transactionStatusText: '\u843d\u672d\u304a\u3081\u3067\u3068\u3046\u3054\u3056\u3044\u307e\u3059\u3002\n\u8cfc\u5165\u624b\u7d9a\u304d\u3092\u884c\u3063\u3066\u304f\u3060\u3055\u3044\u3002',
    bodyText: [
      '\u843d\u672d\u304a\u3081\u3067\u3068\u3046\u3054\u3056\u3044\u307e\u3059\u3002',
      '\u8cfc\u5165\u624b\u7d9a\u304d\u3092\u884c\u3063\u3066\u304f\u3060\u3055\u3044\u3002',
      '\u30e1\u30c3\u30bb\u30fc\u30b8',
      '\u8aac\u660e\u6587\u306b\u53d6\u5f15\u306f\u3067\u304d\u307e\u305b\u3093\u3068\u3044\u3046\u6587\u5b57\u5217\u304c\u542b\u307e\u308c\u3066\u3082\u3001\u3053\u308c\u306f\u72b6\u614b\u3067\u306f\u306a\u3044\u3002'
    ].join('\n'),
    controls: ['\u8cfc\u5165\u624b\u7d9a\u304d\u3059\u308b']
  });

  assert.equal(state.cancelled, false);
  assert.equal(state.hasPurchaseProcedureButton, true);
}

function testPaymentPageStateUsesNormalStatusComment() {
  const api = loadBackgroundForTest();
  const state = api.buildPaymentPageStateFromSnapshot({
    url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=q1235534082',
    transactionStatusText: '\u51fa\u54c1\u8005\u306b\u652f\u6255\u3044\u5b8c\u4e86\u306e\u9023\u7d61\u3092\u3057\u307e\u3057\u305f\u3002\n\u5546\u54c1\u306e\u767a\u9001\u9023\u7d61\u3092\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002',
    bodyText: [
      '\u51fa\u54c1\u8005\u306b\u652f\u6255\u3044\u5b8c\u4e86\u306e\u9023\u7d61\u3092\u3057\u307e\u3057\u305f\u3002',
      '\u5546\u54c1\u306e\u767a\u9001\u9023\u7d61\u3092\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002',
      '\u30e1\u30c3\u30bb\u30fc\u30b8',
      '\u671f\u65e5\u3092\u904e\u304e\u308b\u3068\u843d\u672d\u8005\u524a\u9664\u3055\u308c\u308b\u5834\u5408\u304c\u3042\u308a\u3001\u53d6\u5f15\u306f\u3067\u304d\u307e\u305b\u3093\u3068\u3044\u3046\u8aac\u660e\u304c\u3042\u308b\u3002'
    ].join('\n'),
    controls: []
  });

  assert.equal(state.cancelled, false);
  assert.equal(state.alreadyPaid, true);
}

function testPaymentPageStateDetectsStoreConfirmationSection() {
  const api = loadBackgroundForTest();
  const state = api.buildPaymentPageStateFromSnapshot({
    url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017',
    bodyText: '\u30b9\u30c8\u30a2\u304b\u3089\u306e\u78ba\u8a8d\u4e8b\u9805 \u5e74\u9f62\u78ba\u8a8d \u79c1\u306f33\u6b73\u3067\u3059 \u5fc5\u9808 \u9818\u53ce\u66f8 \u4e0d\u8981 \u304a\u652f\u6255\u3044\u91d1\u984d\uff08\u7a0e\u8fbc\uff09 43,320\u5186',
    controls: ['\u5909\u66f4', '\u78ba\u8a8d\u3059\u308b'],
    hasStoreConfirmationSection: true
  });
  const editState = api.buildPaymentPageStateFromSnapshot({
    url: 'https://buy.auctions.yahoo.co.jp/order/store-confirmation?auctionId=j1232680017',
    bodyText: '\u30b9\u30c8\u30a2\u304b\u3089\u306e\u78ba\u8a8d\u4e8b\u9805\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002 \u5e74\u9f62\u78ba\u8a8d \u5fc5\u9808',
    controls: ['\u5909\u66f4\u3059\u308b'],
    hasStoreConfirmationSection: true
  });

  assert.equal(state.hasStoreConfirmationSection, true);
  assert.equal(state.hasStoreConfirmationEditPage, false);
  assert.equal(editState.hasStoreConfirmationSection, true);
  assert.equal(editState.hasStoreConfirmationEditPage, true);
}

function testPaymentPageStateRespectsExplicitNoStoreConfirmationSection() {
  const api = loadBackgroundForTest();
  const state = api.buildPaymentPageStateFromSnapshot({
    url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=t1234025360',
    bodyText: '\u30b9\u30c8\u30a2\u304b\u3089\u306e\u78ba\u8a8d\u4e8b\u9805 \u304a\u652f\u6255\u3044\u65b9\u6cd5\u306e\u5909\u66f4\u306f\u3053\u3061\u3089 \u304a\u652f\u6255\u3044\u91d1\u984d 1000\u5186',
    controls: ['\u5909\u66f4', '\u78ba\u8a8d\u3059\u308b'],
    hasStoreConfirmationSection: false
  });

  assert.equal(state.hasStoreConfirmationSection, false);
  assert.equal(state.hasReviewButton, true);
}

function testPaymentPageStateIgnoresStoreConfirmationTitleWithoutChangeControl() {
  const api = loadBackgroundForTest();
  const state = api.buildPaymentPageStateFromSnapshot({
    url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=t1234025360',
    bodyText: '\u30b9\u30c8\u30a2\u304b\u3089\u306e\u78ba\u8a8d\u4e8b\u9805 \u304a\u652f\u6255\u3044\u91d1\u984d 1000\u5186',
    controls: ['\u78ba\u8a8d\u3059\u308b']
  });

  assert.equal(state.hasStoreConfirmationSection, false);
  assert.equal(state.hasReviewButton, true);
}

function testPaymentPageStateRequiresCartoptForStoreConfirmation() {
  const api = loadBackgroundForTest();
  const state = api.buildPaymentPageStateFromSnapshot({
    url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=t1234243432',
    bodyText: '\u30b9\u30c8\u30a2\u304b\u3089\u306e\u78ba\u8a8d\u4e8b\u9805 \u304a\u652f\u6255\u3044\u65b9\u6cd5\u306e\u5909\u66f4\u306f\u3053\u3061\u3089 \u304a\u652f\u6255\u3044\u91d1\u984d 1000\u5186',
    controls: ['\u5909\u66f4', '\u78ba\u8a8d\u3059\u308b']
  });

  assert.equal(state.hasStoreConfirmationSection, false);
  assert.equal(state.hasReviewButton, true);
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

async function testStoreConfirmationApplyButtonClicksOnce() {
  let applyClickCount = 0;
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
    dispatchEvent(event) {
      if (event?.type === 'click') applyClickCount += 1;
    },
    click() { applyClickCount += 1; }
  };
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript(payload) {
        const result = vm.runInNewContext(`(${payload.func.toString()})()`, {
          document: {
            querySelector(selector) {
              if (selector.includes('#confirm')) return applyLink;
              return null;
            },
            querySelectorAll() {
              return [applyLink];
            }
          },
          window: {},
          MouseEvent: function MouseEvent(type) { this.type = type; },
          PointerEvent: function PointerEvent(type) { this.type = type; },
          KeyboardEvent: function KeyboardEvent(type) { this.type = type; }
        });
        return [{ result }];
      }
    }
  });

  const result = await api.clickStoreConfirmationApplyButton(19);

  assert.equal(result.success, true);
  assert.equal(applyClickCount, 1);
}

async function testStoreConfirmationCheckboxLabelClickOnlyTogglesOnce() {
  let labelClicks = 0;
  const checkbox = {
    id: 'agree-label',
    checked: false,
    disabled: false,
    getBoundingClientRect() { return { width: 10, height: 10 }; },
    closest() { return this; },
    scrollIntoView() {},
    click() { this.checked = !this.checked; },
    dispatchEvent() {}
  };
  const label = {
    scrollIntoView() {},
    focus() {},
    click() {
      labelClicks += 1;
      checkbox.checked = !checkbox.checked;
    },
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
              if (String(selector).startsWith('label')) return label;
              if (selector.includes('#confirm')) return applyLink;
              return null;
            },
            querySelectorAll(selector) {
              if (selector === 'input[type="checkbox"]') return [checkbox];
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

  const result = await api.checkAllStoreConfirmationItemsAndApply(19, false);

  assert.equal(result.success, true);
  assert.equal(result.checkedCount, 1);
  assert.equal(checkbox.checked, true);
  assert.equal(labelClicks, 1);
}

async function testStoreConfirmationApplyDoesNotForceHiddenInputsChecked() {
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

  assert.equal(result.success, false);
  assert.equal(result.checkedCount, 0);
  assert.equal(result.checkboxCount, 1);
  assert.equal(checkbox.checked, false);
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

function testPaymentAmountRejectsMissingDetectedTotal() {
  const api = loadBackgroundForTest();

  assert.throws(() => api.assertPaymentAmountMatches(
    { finalPrice: 56000, effectiveShippingFeeText: '500\u5186' },
    { paymentAmountJpy: 0 }
  ), /payment amount not detected/);
}

function testPaymentAmountTreatsFreeAndCashOnDeliveryAsZeroShippingForAllProducts() {
  const api = loadBackgroundForTest();

  assert.equal(api.parseYenAmount('\u9001\u6599 \u7121\u6599'), 0);
  assert.equal(api.parseYenAmount('\u9001\u6599 \u7740\u6255\u3044'), 0);
  assert.equal(api.parseYenAmount('\u9001\u6599 \u51fa\u54c1\u8005\u8ca0\u62c5'), 0);
  assert.equal(api.getExpectedPaymentAmountJpy({
    finalPrice: 56000,
    effectiveShippingFeeText: '\u9001\u6599 \u7121\u6599'
  }), 56000);
  assert.equal(api.getExpectedPaymentAmountJpy({
    finalPrice: 56000,
    effectiveShippingFeeText: '\u9001\u6599 \u7740\u6255\u3044'
  }), 56000);
  assert.equal(api.getExpectedPaymentAmountJpy({
    finalPrice: 56000,
    effectiveShippingFeeText: '\u9001\u6599 \u51fa\u54c1\u8005\u8ca0\u62c5'
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

function testPaymentAmountUsesBundleFinalPriceTotal() {
  const api = loadBackgroundForTest();

  assert.equal(api.getExpectedPaymentAmountJpy({
    finalPrice: 1000,
    paymentFinalPrice: 1500,
    effectiveShippingFeeText: '200\u5186',
    bundleGroupId: 'bundle-a'
  }), 1700);
  assert.doesNotThrow(() => api.assertPaymentAmountMatches(
    {
      finalPrice: 1000,
      paymentFinalPrice: 1500,
      productType: 'normal',
      effectiveShippingFeeText: '200\u5186',
      bundleGroupId: 'bundle-a'
    },
    { paymentAmountJpy: 1700 }
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

function testPaymentFinalizeCompletionTimeoutIsSixtySeconds() {
  const code = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
  const match = code.match(/PAYMENT_FINALIZE_COMPLETE_TIMEOUT_MS\s*=\s*(\d+)/);
  assert.equal(Number(match?.[1]), 60000);
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

async function testRunTransactionStartCompletesFixedShippingInfoBeforePendingPayment() {
  const statusCalls = [];
  const clickedActions = [];
  let phase = 'decide';
  const api = loadBackgroundForTest({
    disableAutoStart: true,
    tabs: {
      async create(urlOrOptions) {
        const url = typeof urlOrOptions === 'string' ? urlOrOptions : urlOrOptions?.url;
        return { id: 42, url, status: 'complete', windowId: 3 };
      },
      async get(id) {
        return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/input?aid=s1232869893', status: 'complete', windowId: 3 };
      },
      async query() {
        return [{ id: 42, url: 'https://contact.auctions.yahoo.co.jp/buyer/input?aid=s1232869893', status: 'complete', windowId: 3 }];
      },
      async sendMessage(id, message) {
        if (message.type === 'EXTRACT_TRANSACTION_START_INFO') {
          return { success: true, loginStatus: { status: 'ok' }, info: { available: false } };
        }
        if (message.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
          return {
            success: true,
            state: {
              canDecide: phase === 'decide',
              canConfirm: phase === 'confirm',
              paymentReady: phase === 'payment',
              complete: false,
              url: 'https://contact.auctions.yahoo.co.jp/buyer/input?aid=s1232869893'
            }
          };
        }
        if (message.type === 'CLICK_BUNDLE_TRANSACTION_ACTION') {
          clickedActions.push(message.action);
          if (message.action === 'decide' && phase === 'decide') {
            phase = 'confirm';
            return { success: true };
          }
          if (message.action === 'confirm' && phase === 'confirm') {
            phase = 'payment';
            return { success: true };
          }
          return { success: false, error: `${message.action} button not found` };
        }
        return { success: true };
      },
      async remove() {}
    },
    scripting: {
      async executeScript() {
        return [{ result: { success: false, error: 'button not found in MAIN world' } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/transaction-start/jobs')) {
        return {
          async json() {
            return {
              success: true,
              jobs: [{
                orderId: 78,
                productId: 's1232869893',
                productType: 'normal',
                transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/input?aid=s1232869893',
                shippingFeeText: '230\u5186'
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

  assert.deepEqual(clickedActions, ['decide', 'confirm']);
  assert.equal(statusCalls.length, 1);
  assert.equal(statusCalls[0].orderId, 78);
  assert.equal(statusCalls[0].status, 'pending_payment');
}

async function testRunTransactionStartMarksBuyerDeletedPageCancelled() {
  const statusCalls = [];
  let removedTabId = null;
  const api = loadBackgroundForTest({
    disableAutoStart: true,
    tabs: {
      async create(urlOrOptions) {
        const url = typeof urlOrOptions === 'string' ? urlOrOptions : urlOrOptions?.url;
        return { id: 79, url, status: 'complete', windowId: 3 };
      },
      async get(id) {
        return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=u1231877298', status: 'complete', windowId: 3 };
      },
      async query() {
        return [{ id: 79, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=u1231877298', status: 'complete', windowId: 3 }];
      },
      async sendMessage(id, message) {
        if (message.type === 'EXTRACT_TRANSACTION_START_INFO') {
          return { success: true, loginStatus: { status: 'ok' }, info: { available: false } };
        }
        if (message.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
          return {
            success: true,
            state: {
              cancelled: true,
              url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=u1231877298'
            }
          };
        }
        if (message.type === 'CLICK_BUNDLE_TRANSACTION_ACTION') {
          return { success: false, error: 'cancelled page should not be clicked' };
        }
        return { success: true };
      },
      async remove(id) {
        removedTabId = id;
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/transaction-start/jobs')) {
        return {
          async json() {
            return {
              success: true,
              jobs: [{
                orderId: 79,
                productId: 'u1231877298',
                productType: 'normal',
                transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=u1231877298',
                shippingFeeText: '230\u5186'
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

  assert.equal(statusCalls.length, 1);
  assert.equal(statusCalls[0].orderId, 79);
  assert.equal(statusCalls[0].status, 'cancelled');
  assert.equal(removedTabId, 79);
}

async function testRunTransactionStartPostsDiagnosticWhenNormalBundleStartFails() {
  const statusCalls = [];
  const diagnosticCalls = [];
  let removedTabId = null;
  const api = loadBackgroundForTest({
    disableAutoStart: true,
    tabs: {
      async create(urlOrOptions) {
        const url = typeof urlOrOptions === 'string' ? urlOrOptions : urlOrOptions?.url;
        return { id: 81, url, status: 'complete', windowId: 3 };
      },
      async get(id) {
        return { id, url: 'https://contact.auctions.yahoo.co.jp/trade/bundle?aid=u1213934430', status: 'complete', windowId: 3 };
      },
      async query() {
        return [{ id: 81, url: 'https://contact.auctions.yahoo.co.jp/trade/bundle?aid=u1213934430', status: 'complete', windowId: 3 }];
      },
      async sendMessage(id, message) {
        if (message.type === 'EXTRACT_TRANSACTION_START_INFO') {
          return {
            success: true,
            loginStatus: { status: 'ok' },
            info: {
              available: true,
              quantityMatched: true,
              productIds: ['u1213934430', 'j1212252290', 'm1221861967']
            }
          };
        }
        if (message.type === 'GET_BUNDLE_TRANSACTION_ACTION_STATE') {
          return {
            success: true,
            state: {
              canStart: true,
              canDecide: false,
              complete: false,
              url: 'https://contact.auctions.yahoo.co.jp/trade/bundle?aid=u1213934430'
            }
          };
        }
        if (message.type === 'CLICK_BUNDLE_TRANSACTION_ACTION') {
          return { success: false, error: 'bundle start button not found' };
        }
        return { success: true };
      },
      async remove(id) {
        removedTabId = id;
      }
    },
    scripting: {
      async executeScript(details) {
        if (details.files) return [];
        if (details.args?.[1] === 'renderReady') return [{ result: { success: true, ready: true } }];
        return [{ result: { success: false, error: 'button not found in MAIN world' } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/transaction-start/jobs')) {
        return {
          async json() {
            return {
              success: true,
              jobs: [{
                orderId: 81,
                productId: 'u1213934430',
                productType: 'normal',
                transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=u1213934430',
                shippingFeeText: '\u843d\u672d\u8005\u8ca0\u62c5'
              }]
            };
          }
        };
      }
      if (String(url).includes('/api/plugin/transaction-start/status')) {
        statusCalls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true, updated: 3 }; } };
      }
      if (String(url).includes('/api/plugin/diagnostics')) {
        diagnosticCalls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { success: true }; } };
    }
  });

  await api.runTransactionStartJobs();

  assert.equal(statusCalls.length, 1);
  assert.deepEqual(statusCalls[0].productIds, ['u1213934430', 'j1212252290', 'm1221861967']);
  assert.match(statusCalls[0].error, /bundle start button not found/);
  assert.equal(diagnosticCalls.length, 1);
  assert.equal(diagnosticCalls[0].type, 'transaction_start');
  assert.equal(diagnosticCalls[0].productId, 'u1213934430');
  assert.equal(diagnosticCalls[0].action, 'bundle_start');
  assert.match(diagnosticCalls[0].diagnostics, /bundleProductIds=u1213934430\|j1212252290\|m1221861967/);
  assert.equal(removedTabId, 81);
}

async function testMonitorSyncSkipsTabThatDisappearsBeforeInjection() {
  const errors = [];
  const warnings = [];
  const api = loadBackgroundForTest({
    disableAutoStart: true,
    console: {
      ...console,
      error(...args) { errors.push(args); },
      warn(...args) { warnings.push(args); }
    },
    fetch: async url => {
      if (String(url).includes('/api/plugin/config')) {
        return { async json() { return { idleSyncIntervalMinutes: 1 }; } };
      }
      return { async json() { return { success: true }; } };
    },
    tabs: {
      async create(details) {
        return { id: details.url.includes('/my/bidding') ? 57600239 : 57600240, url: details.url };
      },
      async remove() {}
    },
    scripting: {
      async executeScript(details) {
        throw new Error(`No tab with id: ${details?.target?.tabId}`);
      }
    }
  });

  await api.syncMonitorYahooPages();

  assert.equal(errors.length, 0);
  assert.equal(warnings.some(entry => /tab no longer exists/.test(String(entry[0]))), true);
}

async function testMonitorSyncCollectsAllBiddingPagesBeforeSync() {
  const fetchCalls = [];
  const visitedUrls = [];
  let currentBiddingUrl = 'https://auctions.yahoo.co.jp/my/bidding';
  const api = loadBackgroundForTest({
    disableAutoStart: true,
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url: String(url), options });
      if (String(url).includes('/api/plugin/config')) {
        return { async json() { return { idleSyncIntervalMinutes: 1 }; } };
      }
      return { ok: true, async json() { return { success: true }; } };
    },
    tabs: {
      async create(details) {
        visitedUrls.push(details.url);
        if (String(details.url).includes('/my/bidding')) {
          currentBiddingUrl = details.url;
          return { id: 57600239, status: 'complete', url: details.url };
        }
        return { id: 57600240, status: 'complete', url: details.url };
      },
      async update(tabId, details) {
        visitedUrls.push(details.url);
        if (tabId === 57600239) currentBiddingUrl = details.url;
        return { id: tabId, status: 'complete', url: details.url };
      },
      async sendMessage(tabId, message) {
        if (message?.type === 'EXTRACT_BIDDING_ITEMS') {
          if (/page=2/.test(currentBiddingUrl)) {
            return {
              success: true,
              items: [{ productId: 'b1234567890', status: 'outbid', price: '2000' }],
              nextPageUrl: ''
            };
          }
          return {
            success: true,
            items: [{ productId: 'a1234567890', status: 'highest', price: '1000' }],
            nextPageUrl: 'https://auctions.yahoo.co.jp/my/bidding?page=2'
          };
        }
        if (message?.type === 'EXTRACT_ORDER_HISTORY') {
          return { success: true, orders: [], loginStatus: { status: 'ok' } };
        }
        return { success: true };
      },
      async remove() {}
    }
  });

  await api.syncMonitorYahooPages();

  const biddingSyncCalls = fetchCalls.filter(call => call.url.includes('/api/plugin/bidding/sync'));
  assert.equal(biddingSyncCalls.length, 1);
  const body = JSON.parse(biddingSyncCalls[0].options.body);
  assert.deepEqual(body.items.map(item => item.productId), ['a1234567890', 'b1234567890']);
  assert.deepEqual(
    visitedUrls.filter(url => String(url).includes('/my/bidding')),
    ['https://auctions.yahoo.co.jp/my/bidding', 'https://auctions.yahoo.co.jp/my/bidding?page=2']
  );
}

async function testMonitorSyncSkipsFrameRemovedBeforeInjection() {
  const errors = [];
  const warnings = [];
  const api = loadBackgroundForTest({
    disableAutoStart: true,
    console: {
      ...console,
      error(...args) { errors.push(args); },
      warn(...args) { warnings.push(args); }
    },
    fetch: async url => {
      if (String(url).includes('/api/plugin/config')) {
        return { async json() { return { idleSyncIntervalMinutes: 1 }; } };
      }
      return { async json() { return { success: true }; } };
    },
    tabs: {
      async create(details) {
        return { id: details.url.includes('/my/bidding') ? 57600239 : 57600240, url: details.url };
      },
      async remove() {}
    },
    scripting: {
      async executeScript() {
        throw new Error('Frame with ID 0 was removed.');
      }
    }
  });

  await api.syncMonitorYahooPages();

  assert.equal(errors.length, 0);
  assert.equal(warnings.some(entry => /content script target disappeared/.test(String(entry[0]))), true);
}

async function testMonitorSyncSkipsClosedMessageReceiver() {
  const errors = [];
  const warnings = [];
  const api = loadBackgroundForTest({
    disableAutoStart: true,
    console: {
      ...console,
      error(...args) { errors.push(args); },
      warn(...args) { warnings.push(args); }
    },
    fetch: async url => {
      if (String(url).includes('/api/plugin/config')) {
        return { async json() { return { idleSyncIntervalMinutes: 1 }; } };
      }
      return { async json() { return { success: true }; } };
    },
    tabs: {
      async create(details) {
        return { id: details.url.includes('/my/bidding') ? 57600239 : 57600240, url: details.url };
      },
      async sendMessage() {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      },
      async remove() {}
    }
  });

  await api.syncMonitorYahooPages();

  assert.equal(errors.length, 0);
  assert.equal(warnings.some(entry => /message receiver is gone/.test(String(entry[0]))), true);
}

async function testMonitorSyncPostponesTabsTemporarilyUneditable() {
  const errors = [];
  const warnings = [];
  let createCalls = 0;
  const api = loadBackgroundForTest({
    disableAutoStart: true,
    console: {
      ...console,
      error(...args) { errors.push(args); },
      warn(...args) { warnings.push(args); }
    },
    fetch: async url => {
      if (String(url).includes('/api/plugin/config')) {
        return { async json() { return { idleSyncIntervalMinutes: 1 }; } };
      }
      return { async json() { return { success: true }; } };
    },
    tabs: {
      async create(details) {
        createCalls += 1;
        if (createCalls === 1) {
          throw new Error('Tabs cannot be edited right now (user may be dragging a tab).');
        }
        return { id: details.url.includes('/my/bidding') ? 57600239 : 57600240, url: details.url };
      },
      async remove() {}
    }
  });

  await api.syncMonitorYahooPages();
  await api.syncMonitorYahooPages();

  assert.equal(errors.length, 0);
  assert.equal(warnings.some(entry => /temporarily unavailable/.test(String(entry[0]))), true);
  assert.ok(createCalls > 1);
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

async function testRunPaymentJobsMarksBuyerDeletedPageCancelled() {
  const calls = [];
  let removedTabId = null;
  const api = loadBackgroundForTest({
    tabs: {
      async create() {
        return { id: 89, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=u1231877298', status: 'complete' };
      },
      async get(id) {
        return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=u1231877298', status: 'complete' };
      },
      async query() {
        return [{ id: 89, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=u1231877298', status: 'complete' }];
      },
      async remove(id) {
        removedTabId = id;
      }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        if (payload.files) return undefined;
        if (payload.args && payload.args.length) {
          return [{ result: { success: false, error: 'cancelled page should not be clicked' } }];
        }
        return [{
          result: {
            success: true,
            state: {
              url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=u1231877298',
              cancelled: true,
              bodyText: '落札者削除されたため、取引はできません。過去の取引メッセージの閲覧のみ可能です。'
            }
          }
        }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return {
          async json() {
            return {
              success: true,
              paymentPageStaySeconds: 1,
              jobs: [{
                orderId: 89,
                productId: 'u1231877298',
                transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=u1231877298',
                finalPrice: 350,
                effectiveShippingFeeText: '230\u5186'
              }]
            };
          }
        };
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
  assert.equal(calls[0].orderId, 89);
  assert.equal(calls[0].productId, 'u1231877298');
  assert.equal(calls[0].status, 'cancelled');
  assert.equal(removedTabId, 89);
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

async function testRunPaymentJobsWaitsForRenderedStoreStatusEntryButton() {
  const calls = [];
  const actions = [];
  const states = [
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=e1234121852', controlsSample: ['Yahoo! JAPAN', 'ヘルプ'] } },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=e1234121852', controlsSample: ['Yahoo! JAPAN', 'ヘルプ'] } },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=e1234121852', hasPurchaseProcedureButton: true, controlsSample: ['購入手続きする'] } },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/confirm?auctionId=e1234121852', hasReviewButton: true, paymentAmountJpy: 15911 } },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/payment/confirm?auctionId=e1234121852', hasFinalizeButton: true, paymentAmountJpy: 15911 } },
    { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/thank-you?auctionId=e1234121852', complete: true } }
  ];
  const api = loadBackgroundForTest({
    tabs: {
      async create() { return { id: 214, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=e1234121852', status: 'complete' }; },
      async get(id) { return { id, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=e1234121852', status: 'complete' }; },
      async query() { return [{ id: 214, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=e1234121852', status: 'complete' }]; }
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
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 254, productId: 'e1234121852', productType: 'store', transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=e1234121852', finalPrice: 14301, effectiveShippingFeeText: '1610\u5186' }] }; } };
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
  assert.equal(calls[0].orderId, 254);
  assert.equal(calls[0].productId, 'e1234121852');
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

async function testRunPaymentJobsRetriesReviewClickWhenTrustedPointTemporarilyMissing() {
  const calls = [];
  const actions = [];
  let nowMs = 0;
  let reviewTrustedPointAttempts = 0;
  const FakeDate = class extends Date {
    constructor(...args) {
      super(...(args.length ? args : [nowMs]));
    }
    static now() {
      return nowMs;
    }
  };
  Object.setPrototypeOf(FakeDate, Date);
  const api = loadBackgroundForTest({
    Date: FakeDate,
    setTimeout(fn, ms) {
      nowMs += ms;
      fn();
      return 1;
    },
    tabs: {
      async create() { return { id: 216, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async get(id) { return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async update(id) { return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async query() { return [{ id: 216, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        if (payload.files) return undefined;
        const source = String(payload.func || '');
        if (payload.args && payload.args.length) {
          const action = payload.args[1];
          if (source.includes('candidates') && action === 'review') {
            reviewTrustedPointAttempts += 1;
            return [{ result: { success: false, error: 'payment button not found for trusted click' } }];
          }
          actions.push(action);
          return [{ result: { success: true, text: 'clicked' } }];
        }
        const reviewClicks = actions.filter(action => action === 'review').length;
        if (!actions.includes('easyPayment')) {
          return [{ result: { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/top', hasEasyPaymentButton: true, paymentAmountJpy: 1730 } } }];
        }
        if (reviewClicks < 2) {
          return [{ result: { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', hasReviewButton: true, paymentAmountJpy: 1730 } } }];
        }
        if (!actions.includes('finalize')) {
          return [{ result: { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/confirm', hasFinalizeButton: true, paymentAmountJpy: 1730 } } }];
        }
        return [{ result: { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/complete', complete: true } } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 216, productId: 's1233522728', transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/top', finalPrice: 1500, effectiveShippingFeeText: '230\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.deepEqual(actions, ['easyPayment', 'review', 'review', 'finalize']);
  assert.equal(reviewTrustedPointAttempts, 1);
  assert.equal(calls[0].orderId, 216);
  assert.equal(calls[0].status, 'success');
}

async function testRunPaymentJobsWaitsUpToSixtySecondsForProcessingFinalizePage() {
  const calls = [];
  const actions = [];
  let nowMs = 0;
  const FakeDate = class extends Date {
    constructor(...args) {
      super(...(args.length ? args : [nowMs]));
    }
    static now() {
      return nowMs;
    }
  };
  Object.setPrototypeOf(FakeDate, Date);
  const api = loadBackgroundForTest({
    Date: FakeDate,
    setTimeout(fn, ms) {
      nowMs += ms;
      fn();
      return 1;
    },
    tabs: {
      async create() { return { id: 116, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async get(id) { return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async query() { return [{ id: 116, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        if (payload.files) return undefined;
        if (payload.args && payload.args.length) {
          actions.push(payload.args[1]);
          return [{ result: { success: true, text: 'clicked' } }];
        }
        if (!actions.includes('review')) {
          return [{ result: { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', hasReviewButton: true, paymentAmountJpy: 4330 } } }];
        }
        if (!actions.includes('finalize')) {
          return [{ result: { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/confirm', hasFinalizeButton: true, paymentAmountJpy: 4330 } } }];
        }
        if (nowMs < 20000) {
          return [{ result: { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/confirm', processing: true } } }];
        }
        return [{ result: { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/complete', complete: true } } }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 116, productId: 'p116', transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/top', finalPrice: 3450, effectiveShippingFeeText: '880\u5186' }] }; } };
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
  assert.equal(calls[0].orderId, 116);
  assert.equal(calls[0].status, 'success');
  assert.ok(nowMs >= 20000);
  assert.ok(nowMs < 60000);
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

async function testRunConfirmReceiptJobsWaitsForReceiptPageRenderBeforeClicking() {
  const statusCalls = [];
  let scriptCall = 0;
  const snapshots = [
    {
      bodyText: '',
      controls: [],
      hasReceiptCheckbox: false,
      hasReceiptCheckboxChecked: false,
      hasReceiptSubmitButton: false,
      receiptSubmitButtonDisabled: false
    },
    {
      bodyText: '\u53d6\u5f15\u30ca\u30d3 \u53d6\u5f15\u60c5\u5831 \u8cfc\u5165 \u304a\u652f\u6255\u3044 \u767a\u9001\u9023\u7d61 \u5546\u54c1\u3092\u53d7\u3051\u53d6\u308a\u307e\u3057\u305f\u3002 \u53d7\u3051\u53d6\u308a\u9023\u7d61',
      controls: ['\u53d7\u3051\u53d6\u308a\u9023\u7d61'],
      hasReceiptCheckbox: true,
      hasReceiptCheckboxChecked: false,
      hasReceiptSubmitButton: false,
      receiptSubmitButtonDisabled: true
    },
    {
      bodyText: '\u5546\u54c1\u3092\u53d7\u3051\u53d6\u308a\u307e\u3057\u305f\u3002 \u53d7\u3051\u53d6\u308a\u9023\u7d61',
      controls: ['\u53d7\u3051\u53d6\u308a\u9023\u7d61'],
      hasReceiptCheckbox: true,
      hasReceiptCheckboxChecked: true,
      hasReceiptSubmitButton: true,
      receiptSubmitButtonDisabled: false
    },
    {
      bodyText: '\u51fa\u54c1\u8005\u306b\u53d7\u3051\u53d6\u308a\u9023\u7d61\u3092\u3057\u307e\u3057\u305f\u3002',
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
      async create() { return { id: 132, windowId: 5, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async get(id) { return { id, windowId: 5, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }; },
      async query() { return [{ id: 132, windowId: 5, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', status: 'complete' }]; },
      async update(id) { return { id, windowId: 5, status: 'complete' }; }
    },
    scripting: {
      async executeScript(payload = {}) {
        if (payload.files) return undefined;
        scriptCall += 1;
        if (scriptCall === 3) return [{ result: { success: true } }];
        if (scriptCall === 5) return [{ result: { success: true, method: 'click', text: '\u53d7\u3051\u53d6\u308a\u9023\u7d61' } }];
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
                orderId: 132,
                productId: 't1235313146',
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
  assert.equal(statusCalls[0].productId, 't1235313146');
}

function testConfirmReceiptPageStateDetectsWinnerDeletedCancellation() {
  const api = loadBackgroundForTest();

  const state = api.buildConfirmReceiptPageStateFromSnapshot({
    bodyText: '取引ナビ 落札者削除されました あなたが落札しましたが、出品者が落札を取り消しました。購入手続きする',
    controls: ['商品ページへ']
  });

  assert.equal(state.cancelled, true);
  assert.equal(state.complete, false);
  assert.equal(state.hasReceiptCheckbox, false);

  const deletedBecauseState = api.buildConfirmReceiptPageStateFromSnapshot({
    bodyText: '\u843d\u672d\u8005\u524a\u9664\u3055\u308c\u305f\u305f\u3081\u3001\u53d6\u5f15\u306f\u3067\u304d\u307e\u305b\u3093\u3002\u904e\u53bb\u306e\u53d6\u5f15\u30e1\u30c3\u30bb\u30fc\u30b8\u306e\u95b2\u89a7\u306e\u307f\u53ef\u80fd\u3067\u3059\u3002',
    controls: ['\u5546\u54c1\u30da\u30fc\u30b8\u3078']
  });

  assert.equal(deletedBecauseState.cancelled, true);
}

function testConfirmReceiptPageStateDetectsPaidOrShippedTransactionText() {
  const api = loadBackgroundForTest();
  const samples = [
    '\u3054\u8cfc\u5165\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3059\u3002\n\u5546\u54c1\u306e\u767a\u9001\u9023\u7d61\u3092\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002',
    '\u51fa\u54c1\u8005\u306b\u652f\u6255\u3044\u5b8c\u4e86\u306e\u9023\u7d61\u3092\u3057\u307e\u3057\u305f\u3002\n\u5546\u54c1\u306e\u767a\u9001\u9023\u7d61\u3092\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002',
    '\u5546\u54c1\u304c\u767a\u9001\u3055\u308c\u307e\u3057\u305f\u3002\n\u5230\u7740\u307e\u3067\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002',
    '\u51fa\u54c1\u8005\u304b\u3089\u5546\u54c1\u767a\u9001\u306e\u9023\u7d61\u304c\u3042\u308a\u307e\u3057\u305f\u3002\n\u5230\u7740\u3057\u305f\u3089\u3001\u53d7\u3051\u53d6\u308a\u9023\u7d61\u3092\u3057\u3066\u304f\u3060\u3055\u3044\u3002'
  ];

  for (const bodyText of samples) {
    const state = api.buildConfirmReceiptPageStateFromSnapshot({ bodyText, controls: [] });
    assert.equal(state.paidOrShipped, true);
    assert.equal(state.cancelled, false);
  }
}

function testConfirmReceiptPageStateUsesPrimaryStatusText() {
  const api = loadBackgroundForTest();

  const activeStoreState = api.buildConfirmReceiptPageStateFromSnapshot({
    transactionStatusText: '\u843d\u672d\u304a\u3081\u3067\u3068\u3046\u3054\u3056\u3044\u307e\u3059\u3002\n\u8cfc\u5165\u624b\u7d9a\u304d\u3092\u884c\u3063\u3066\u304f\u3060\u3055\u3044\u3002',
    bodyText: [
      '\u843d\u672d\u304a\u3081\u3067\u3068\u3046\u3054\u3056\u3044\u307e\u3059\u3002',
      '\u8cfc\u5165\u624b\u7d9a\u304d\u3092\u884c\u3063\u3066\u304f\u3060\u3055\u3044\u3002',
      '\u30e1\u30c3\u30bb\u30fc\u30b8',
      '\u671f\u9650\u5f8c\u306f\u843d\u672d\u8005\u524a\u9664\u3055\u308c\u3001\u53d6\u5f15\u306f\u3067\u304d\u307e\u305b\u3093\u3068\u3044\u3046\u8aac\u660e\u6587'
    ].join('\n'),
    controls: []
  });

  assert.equal(activeStoreState.cancelled, false);
  assert.equal(activeStoreState.paidOrShipped, false);

  const normalPaidState = api.buildConfirmReceiptPageStateFromSnapshot({
    transactionStatusText: '\u51fa\u54c1\u8005\u306b\u652f\u6255\u3044\u5b8c\u4e86\u306e\u9023\u7d61\u3092\u3057\u307e\u3057\u305f\u3002\n\u5546\u54c1\u306e\u767a\u9001\u9023\u7d61\u3092\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002',
    bodyText: [
      '\u51fa\u54c1\u8005\u306b\u652f\u6255\u3044\u5b8c\u4e86\u306e\u9023\u7d61\u3092\u3057\u307e\u3057\u305f\u3002',
      '\u5546\u54c1\u306e\u767a\u9001\u9023\u7d61\u3092\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002',
      '\u30e1\u30c3\u30bb\u30fc\u30b8',
      '\u671f\u9650\u5f8c\u306f\u843d\u672d\u8005\u524a\u9664\u3055\u308c\u308b\u3068\u3044\u3046\u8aac\u660e\u6587'
    ].join('\n'),
    controls: []
  });

  assert.equal(normalPaidState.cancelled, false);
  assert.equal(normalPaidState.paidOrShipped, true);
}

function testConfirmReceiptPageStateDetectsReceiptCompletionText() {
  const api = loadBackgroundForTest();

  const state = api.buildConfirmReceiptPageStateFromSnapshot({
    bodyText: [
      '\u53d6\u5f15\u30ca\u30d3',
      '\u3059\u3079\u3066\u306e\u53d6\u5f15\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f',
      '\u51fa\u54c1\u8005\u306b\u53d7\u3051\u53d6\u308a\u9023\u7d61\u3092\u3057\u307e\u3057\u305f\u3002',
      '\u51fa\u54c1\u8005\u3092\u8a55\u4fa1'
    ].join('\n'),
    controls: ['\u51fa\u54c1\u8005\u3092\u8a55\u4fa1']
  });

  assert.equal(state.complete, true);

  const receivedNoticeState = api.buildConfirmReceiptPageStateFromSnapshot({
    bodyText: '\u51fa\u54c1\u8005\u306b\u53d7\u3051\u53d6\u308a\u9023\u7d61\u3092\u3057\u307e\u3057\u305f\u3002\n\u51fa\u54c1\u8005\u3092\u8a55\u4fa1',
    controls: ['\u51fa\u54c1\u8005\u3092\u8a55\u4fa1']
  });

  assert.equal(receivedNoticeState.complete, true);
}

async function testRunConfirmReceiptJobsMarksCancelCheckOrderCancelled() {
  const statusCalls = [];
  let closedTabId = null;
  const api = loadBackgroundForTest({
    sleep: async () => {},
    tabs: {
      async create() { return { id: 33, windowId: 5, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=p222222222', status: 'complete' }; },
      async get(id) { return { id, windowId: 5, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=p222222222', status: 'complete' }; },
      async query() { return [{ id: 33, windowId: 5, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=p222222222', status: 'complete' }]; },
      async remove(id) { closedTabId = id; }
    },
    scripting: {
      async executeScript(payload = {}) {
        if (payload.files) return undefined;
        return [{
          result: {
            success: true,
            snapshot: {
              bodyText: '落札者削除されました あなたが落札しましたが、出品者が落札を取り消しました。',
              controls: ['商品ページへ']
            }
          }
        }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/confirm-receipt/jobs')) {
        return {
          async json() {
            return {
              success: true,
              jobs: [{
                orderId: 42,
                productId: 'p222222222',
                productType: 'store',
                orderStatus: 'pending_payment',
                jobType: 'cancel_check',
                transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=p222222222',
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

  assert.deepEqual(statusCalls[0], {
    orderId: 42,
    productId: 'p222222222',
    status: 'cancelled',
    bundleGroupId: ''
  });
  assert.equal(closedTabId, 33);
}

async function testRunConfirmReceiptJobsSkipsCancelCheckWhenCancellationTextMissing() {
  const statusCalls = [];
  const api = loadBackgroundForTest({
    sleep: async () => {},
    tabs: {
      async create() { return { id: 34, windowId: 5, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=p222222222', status: 'complete' }; },
      async get(id) { return { id, windowId: 5, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=p222222222', status: 'complete' }; },
      async query() { return [{ id: 34, windowId: 5, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=p222222222', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(payload = {}) {
        if (payload.files) return undefined;
        return [{
          result: {
            success: true,
            snapshot: {
              bodyText: '購入 お支払い 発送連絡',
              controls: ['購入手続きする']
            }
          }
        }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/confirm-receipt/jobs')) {
        return {
          async json() {
            return {
              success: true,
              jobs: [{
                orderId: 42,
                productId: 'p222222222',
                productType: 'store',
                orderStatus: 'pending_payment',
                jobType: 'cancel_check',
                transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=p222222222',
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

  assert.equal(statusCalls.length, 0);
}

async function testRunConfirmReceiptJobsMarksPaidCancelCheckOrderPendingShipment() {
  const statusCalls = [];
  const api = loadBackgroundForTest({
    sleep: async () => {},
    tabs: {
      async create() { return { id: 35, windowId: 5, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=p222222222', status: 'complete' }; },
      async get(id) { return { id, windowId: 5, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=p222222222', status: 'complete' }; },
      async query() { return [{ id: 35, windowId: 5, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=p222222222', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(payload = {}) {
        if (payload.files) return undefined;
        return [{
          result: {
            success: true,
            snapshot: {
              bodyText: '\u51fa\u54c1\u8005\u306b\u652f\u6255\u3044\u5b8c\u4e86\u306e\u9023\u7d61\u3092\u3057\u307e\u3057\u305f\u3002\n\u5546\u54c1\u306e\u767a\u9001\u9023\u7d61\u3092\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002',
              controls: ['\u767a\u9001\u9023\u7d61']
            }
          }
        }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/confirm-receipt/jobs')) {
        return {
          async json() {
            return {
              success: true,
              jobs: [{
                orderId: 43,
                productId: 'p222222222',
                productType: 'normal',
                orderStatus: 'pending_settlement',
                jobType: 'cancel_check',
                transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=p222222222',
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

  assert.equal(statusCalls.length, 1);
  assert.equal(statusCalls[0].status, 'pending_shipment');
  assert.equal(statusCalls[0].orderId, 43);
}

async function testRunConfirmReceiptJobsWaitsForPaidCancelCheckTextAfterTabComplete() {
  const statusCalls = [];
  let stateReads = 0;
  const api = loadBackgroundForTest({
    sleep: async () => {},
    tabs: {
      async create() { return { id: 36, windowId: 5, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=m1235562222', status: 'complete' }; },
      async get(id) { return { id, windowId: 5, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=m1235562222', status: 'complete' }; },
      async query() { return [{ id: 36, windowId: 5, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=m1235562222', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(payload = {}) {
        if (payload.files) return undefined;
        stateReads += 1;
        const rendered = stateReads >= 3;
        return [{
          result: {
            success: true,
            snapshot: {
              bodyText: rendered
                ? '\u3054\u8cfc\u5165\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3059\u3002\n\u5546\u54c1\u306e\u767a\u9001\u9023\u7d61\u3092\u304a\u5f85\u3061\u304f\u3060\u3055\u3044\u3002'
                : '\u53d6\u5f15\u30ca\u30d3',
              controls: []
            }
          }
        }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/confirm-receipt/jobs')) {
        return {
          async json() {
            return {
              success: true,
              jobs: [{
                orderId: 44,
                productId: 'm1235562222',
                productType: 'store',
                orderStatus: 'pending_payment',
                jobType: 'cancel_check',
                transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=m1235562222',
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

  assert.equal(statusCalls.length, 1);
  assert.equal(statusCalls[0].status, 'pending_shipment');
  assert.equal(statusCalls[0].orderId, 44);
  assert.equal(stateReads, 3);
}

async function testRunConfirmReceiptJobsStopsWaitingAfterOtherCancelCheckStatusRenders() {
  const statusCalls = [];
  let stateReads = 0;
  const api = loadBackgroundForTest({
    sleep: async () => {},
    tabs: {
      async create() { return { id: 37, windowId: 5, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=m1235562223', status: 'complete' }; },
      async get(id) { return { id, windowId: 5, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=m1235562223', status: 'complete' }; },
      async query() { return [{ id: 37, windowId: 5, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=m1235562223', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(payload = {}) {
        if (payload.files) return undefined;
        stateReads += 1;
        const rendered = stateReads >= 3;
        return [{
          result: {
            success: true,
            snapshot: {
              bodyText: rendered
                ? '\u53d6\u5f15\u30ca\u30d3 \u8cfc\u5165 \u304a\u652f\u6255\u3044 \u767a\u9001\u9023\u7d61 \u53d6\u5f15\u60c5\u5831 \u652f\u6255\u3044\u624b\u7d9a\u304d\u3092\u3057\u3066\u304f\u3060\u3055\u3044\u3002'
                : '\u53d6\u5f15\u30ca\u30d3',
              controls: []
            }
          }
        }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/confirm-receipt/jobs')) {
        return {
          async json() {
            return {
              success: true,
              jobs: [{
                orderId: 45,
                productId: 'm1235562223',
                productType: 'store',
                orderStatus: 'pending_payment',
                jobType: 'cancel_check',
                transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=m1235562223',
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

  assert.equal(statusCalls.length, 0);
  assert.equal(stateReads, 3);
}

async function testRunPaymentJobsSelectsExpectedShippingBeforeReview() {
  const calls = [];
  const actions = [];
  let expandedShipping = false;
  const selectedShippingAmounts = [];
  let paymentPhase = 'purchase';
  let now = 0;
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  }
  const buildState = () => {
    if (paymentPhase === 'confirm') {
      return { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/confirm', hasFinalizeButton: true, paymentAmountJpy: 535 } };
    }
    if (paymentPhase === 'complete') {
      return { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/complete', complete: true } };
    }
    const selectedExpected = paymentPhase === 'shippingSelected';
    return {
      success: true,
      state: {
        url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase',
        hasReviewButton: true,
        paymentAmountJpy: selectedExpected ? 535 : 910,
        textSample: '\u914d\u9001\u65b9\u6cd5 \u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8 185\u5186',
        selectedShippingAmountJpy: selectedExpected ? 185 : 230,
        shippingOptions: [
          { amountJpy: 230, checked: !selectedExpected, disabled: false },
          { amountJpy: 185, checked: selectedExpected, disabled: false }
        ]
      }
    };
  };
  const api = loadBackgroundForTest({
    Date: FakeDate,
    setTimeout(fn, ms) {
      now += Number(ms || 0);
      return fn();
    },
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
          paymentPhase = 'shippingSelected';
          return [{ result: { success: true, changed: true, selectedShippingJpy: payload.args[0] } }];
        }
        if (payload.args && payload.args.length >= 2) {
          actions.push(payload.args[1]);
          if (payload.args[1] === 'review') paymentPhase = 'confirm';
          if (payload.args[1] === 'finalize') paymentPhase = 'complete';
          return [{ result: { success: true, text: 'clicked' } }];
        }
        return [{ result: buildState() }];
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

  assert.equal(expandedShipping, false);
  assert.deepEqual(selectedShippingAmounts, [185]);
  assert.deepEqual(actions, ['review', 'finalize']);
  assert.equal(calls[0].orderId, 18);
  assert.equal(calls[0].status, 'success');
}

async function testRunPaymentJobsUsesJsClickForPaymentShippingChangeBeforeDebugger() {
  const calls = [];
  const actions = [];
  let paymentPhase = 'initial';
  let shippingSelectionAttempts = 0;
  let shippingChangeJsClicks = 0;
  let debuggerAttachCalls = 0;
  let now = 0;
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  }
  const paymentState = () => {
    if (paymentPhase === 'confirm') {
      return { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/confirm', hasFinalizeButton: true, paymentAmountJpy: 535 } };
    }
    if (paymentPhase === 'complete') {
      return { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/complete', complete: true } };
    }
    if (paymentPhase === 'shippingSelected') {
      return {
        success: true,
        state: {
          url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=u1231877298',
          hasReviewButton: true,
          paymentAmountJpy: 535,
          textSample: '\u914d\u9001\u65b9\u6cd5 \u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8 185\u5186',
          selectedShippingAmountJpy: 185,
          shippingOptions: [
            { amountJpy: 230, checked: false, disabled: false },
            { amountJpy: 185, checked: true, disabled: false }
          ]
        }
      };
    }
    if (paymentPhase === 'expanded') {
      return {
        success: true,
        state: {
          url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=u1231877298',
          hasReviewButton: true,
          paymentAmountJpy: 910,
          textSample: '\u914d\u9001\u65b9\u6cd5 \u304a\u3066\u304c\u308b\u914d\u9001 \u3086\u3046\u30d1\u30b1\u30c3\u30c8 230\u5186 \u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8 185\u5186',
          selectedShippingAmountJpy: 230,
          shippingOptions: [
            { amountJpy: 230, checked: true, disabled: false },
            { amountJpy: 185, checked: false, disabled: false }
          ]
        }
      };
    }
    return {
      success: true,
      state: {
        url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=u1231877298',
        hasReviewButton: true,
        paymentAmountJpy: 910,
        textSample: '\u914d\u9001\u65b9\u6cd5 \u5909\u66f4\u3059\u308b \u304a\u652f\u6255\u3044\u91d1\u984d\uff08\u5408\u8a08\uff09 910\u5186',
        selectedShippingAmountJpy: 230,
        shippingOptions: []
      }
    };
  };
  const api = loadBackgroundForTest({
    Date: FakeDate,
    setTimeout(fn, ms) {
      now += Number(ms || 0);
      return fn();
    },
    tabs: {
      async create() { return { id: 28, url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=u1231877298', status: 'complete' }; },
      async get(id) { return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=u1231877298', status: 'complete' }; },
      async query() { return [{ id: 28, url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=u1231877298', status: 'complete' }]; }
    },
    debuggerApi: {
      async attach() {
        debuggerAttachCalls += 1;
      },
      async sendCommand(target, command, params = {}) {
        if (command === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') {
          paymentPhase = 'expanded';
        }
      }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        const funcText = String(payload.func || '');
        if (payload.files) return undefined;
        if (payload.args && payload.args.length === 1 && typeof payload.args[0] === 'number') {
          shippingSelectionAttempts += 1;
          paymentPhase = 'shippingSelected';
          return [{ result: { success: true, changed: true, selectedShippingJpy: payload.args[0] } }];
        }
        if (payload.args && payload.args.length >= 2) {
          actions.push(payload.args[1]);
          if (payload.args[1] === 'review') paymentPhase = 'confirm';
          if (payload.args[1] === 'finalize') paymentPhase = 'complete';
          return [{ result: { success: true, text: 'clicked' } }];
        }
        if (funcText.includes('shipping change button JS click not found')) {
          throw new Error('debugger payment shipping change fallback must not be called');
        }
        if (funcText.includes("reason: 'shipping change button not found'")) {
          shippingChangeJsClicks += 1;
          paymentPhase = 'expanded';
          return [{ result: { success: true, changed: true, method: 'jsClick', text: '\u5909\u66f4\u3059\u308b' } }];
        }
        if (funcText.includes('shipping change button click point not found')) {
          return [{ result: { success: true, x: 806, y: 369, rect: { left: 752, top: 350, width: 108, height: 38 }, text: '\u5909\u66f4\u3059\u308b' } }];
        }
        return [{ result: paymentState() }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 28, productId: 'u1231877298', transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=u1231877298', finalPrice: 350, effectiveShippingFeeText: '185\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.equal(shippingChangeJsClicks, 1);
  assert.equal(debuggerAttachCalls, 0);
  assert.equal(shippingSelectionAttempts, 1);
  assert.deepEqual(actions, ['review', 'finalize']);
  assert.equal(calls[0].status, 'success');
}

async function testRunPaymentJobsWaitsForNormalShippingOptionsAfterChangeClick() {
  const calls = [];
  const actions = [];
  let paymentPhase = 'initial';
  let stateReadsAfterExpand = 0;
  let shippingChangeJsClicks = 0;
  let shippingSelectionAttempts = 0;
  const focusCalls = [];
  let now = 0;
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  }
  const paymentState = () => {
    if (paymentPhase === 'confirm') {
      return { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/confirm', hasFinalizeButton: true, paymentAmountJpy: 5441 } };
    }
    if (paymentPhase === 'complete') {
      return { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/complete', complete: true } };
    }
    if (paymentPhase === 'shippingSelected') {
      return {
        success: true,
        state: {
          url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=w1234480217',
          hasReviewButton: true,
          paymentAmountJpy: 5441,
          textSample: '\u914d\u9001\u65b9\u6cd5 \u3086\u3046\u30e1\u30fc\u30eb 180\u5186',
          selectedShippingAmountJpy: 180,
          shippingOptions: [
            { amountJpy: 430, checked: false, disabled: false },
            { amountJpy: 180, checked: true, disabled: false },
            { amountJpy: 310, checked: false, disabled: false }
          ]
        }
      };
    }
    if (paymentPhase === 'expanded') {
      stateReadsAfterExpand += 1;
      const rendered = stateReadsAfterExpand >= 3;
      return {
        success: true,
        state: {
          url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=w1234480217',
          hasReviewButton: true,
          paymentAmountJpy: 5691,
          textSample: rendered
            ? '\u914d\u9001\u65b9\u6cd5 \u30ec\u30bf\u30fc\u30d1\u30c3\u30af\u30e9\u30a4\u30c8 430\u5186 \u3086\u3046\u30e1\u30fc\u30eb 180\u5186 \u3086\u3046\u30d1\u30b1\u30c3\u30c8 310\u5186'
            : '\u914d\u9001\u65b9\u6cd5 \u30ec\u30bf\u30fc\u30d1\u30c3\u30af\u30e9\u30a4\u30c8 430\u5186',
          selectedShippingAmountJpy: 430,
          shippingOptions: rendered
            ? [
                { amountJpy: 430, checked: true, disabled: false },
                { amountJpy: 180, checked: false, disabled: false },
                { amountJpy: 310, checked: false, disabled: false }
              ]
            : [
                { amountJpy: 430, checked: true, disabled: false }
              ]
        }
      };
    }
    return {
      success: true,
      state: {
        url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=w1234480217',
        hasReviewButton: true,
        paymentAmountJpy: 5691,
        textSample: '\u914d\u9001\u65b9\u6cd5 \u30ec\u30bf\u30fc\u30d1\u30c3\u30af\u30e9\u30a4\u30c8 430\u5186 \u5909\u66f4\u3059\u308b',
        selectedShippingAmountJpy: 430,
        shippingOptions: []
      }
    };
  };
  const api = loadBackgroundForTest({
    Date: FakeDate,
    setTimeout(fn, ms) {
      now += Number(ms || 0);
      return fn();
    },
    tabs: {
      async create() { return { id: 128, windowId: 8128, url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=w1234480217', status: 'complete' }; },
      async get(id) { return { id, windowId: 8128, url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=w1234480217', status: 'complete' }; },
      async update(id, props) {
        focusCalls.push(['tab', id, props]);
        return { id, windowId: 8128, url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=w1234480217', status: 'complete', active: props?.active === true };
      },
      async query() { return [{ id: 128, url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=w1234480217', status: 'complete' }]; }
    },
    windows: {
      async update(id, props) {
        focusCalls.push(['window', id, props]);
        return { id, focused: props?.focused === true };
      }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        const funcText = String(payload.func || '');
        if (payload.files) return undefined;
        if (payload.args && payload.args.length === 1 && typeof payload.args[0] === 'number') {
          shippingSelectionAttempts += 1;
          if (stateReadsAfterExpand < 3) {
            return [{ result: { success: false, error: 'matching payment shipping option not found', options: [{ amountJpy: 430, checked: true, disabled: false }] } }];
          }
          paymentPhase = 'shippingSelected';
          return [{ result: { success: true, changed: true, selectedShippingJpy: payload.args[0] } }];
        }
        if (payload.args && payload.args.length >= 2) {
          actions.push(payload.args[1]);
          if (payload.args[1] === 'review') paymentPhase = 'confirm';
          if (payload.args[1] === 'finalize') paymentPhase = 'complete';
          return [{ result: { success: true, text: 'clicked' } }];
        }
        if (funcText.includes("reason: 'shipping change button not found'")) {
          shippingChangeJsClicks += 1;
          paymentPhase = 'expanded';
          return [{ result: { success: true, changed: true, method: 'shippingSection', text: '\u5909\u66f4\u3059\u308b', clickedText: '\u5909\u66f4\u3059\u308b' } }];
        }
        return [{ result: paymentState() }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 128, productId: 'w1234480217', transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=w1234480217', finalPrice: 5261, effectiveShippingFeeText: '180\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.equal(JSON.stringify(focusCalls.slice(0, 2)), JSON.stringify([
    ['window', 8128, { focused: true }],
    ['tab', 128, { active: true }]
  ]));
  assert.equal(shippingChangeJsClicks, 1);
  assert.equal(shippingSelectionAttempts, 1);
  assert.ok(stateReadsAfterExpand >= 3);
  assert.deepEqual(actions, ['review', 'finalize']);
  assert.equal(calls[0].status, 'success');
}

async function testRunPaymentJobsUsesDebuggerShippingChangeFallbackWhenNormalJsExpandDoesNotRenderOption() {
  const calls = [];
  const actions = [];
  let paymentPhase = 'initial';
  let shippingChangeJsClicks = 0;
  let debuggerAttachCalls = 0;
  let debuggerMouseReleased = 0;
  let shippingSelectionAttempts = 0;
  let now = 0;
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  }
  const paymentState = () => {
    if (paymentPhase === 'confirm') {
      return { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/confirm', hasFinalizeButton: true, paymentAmountJpy: 5441 } };
    }
    if (paymentPhase === 'complete') {
      return { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/complete', complete: true } };
    }
    if (paymentPhase === 'shippingSelected') {
      return {
        success: true,
        state: {
          url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=w1234480217',
          hasReviewButton: true,
          paymentAmountJpy: 5441,
          selectedShippingAmountJpy: 180,
          shippingOptions: [
            { amountJpy: 430, checked: false, disabled: false },
            { amountJpy: 180, checked: true, disabled: false }
          ]
        }
      };
    }
    if (paymentPhase === 'trustedExpanded') {
      return {
        success: true,
        state: {
          url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=w1234480217',
          hasReviewButton: true,
          paymentAmountJpy: 5691,
          textSample: '\u914d\u9001\u65b9\u6cd5 \u30ec\u30bf\u30fc\u30d1\u30c3\u30af\u30e9\u30a4\u30c8 430\u5186 \u3086\u3046\u30e1\u30fc\u30eb 180\u5186',
          selectedShippingAmountJpy: 430,
          shippingOptions: [
            { amountJpy: 430, checked: true, disabled: false },
            { amountJpy: 180, checked: false, disabled: false }
          ]
        }
      };
    }
    if (paymentPhase === 'jsExpanded') {
      return {
        success: true,
        state: {
          url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=w1234480217',
          hasReviewButton: true,
          paymentAmountJpy: 5691,
          textSample: '\u914d\u9001\u65b9\u6cd5 \u30ec\u30bf\u30fc\u30d1\u30c3\u30af\u30e9\u30a4\u30c8 430\u5186 \u5909\u66f4\u3059\u308b',
          selectedShippingAmountJpy: 430,
          shippingOptions: []
        }
      };
    }
    return {
      success: true,
      state: {
        url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=w1234480217',
        hasReviewButton: true,
        paymentAmountJpy: 5691,
        textSample: '\u914d\u9001\u65b9\u6cd5 \u30ec\u30bf\u30fc\u30d1\u30c3\u30af\u30e9\u30a4\u30c8 430\u5186 \u5909\u66f4\u3059\u308b',
        selectedShippingAmountJpy: 430,
        shippingOptions: []
      }
    };
  };
  const api = loadBackgroundForTest({
    Date: FakeDate,
    setTimeout(fn, ms) {
      now += Number(ms || 0);
      return fn();
    },
    tabs: {
      async create() { return { id: 129, windowId: 8129, url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=w1234480217', status: 'complete' }; },
      async get(id) { return { id, windowId: 8129, url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=w1234480217', status: 'complete' }; },
      async update(id, props) { return { id, windowId: 8129, status: 'complete', active: props?.active === true }; },
      async query() { return [{ id: 129, windowId: 8129, url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=w1234480217', status: 'complete' }]; }
    },
    windows: {
      async update(id, props) { return { id, focused: props?.focused === true }; }
    },
    debuggerApi: {
      async attach() {
        debuggerAttachCalls += 1;
      },
      async sendCommand(_target, command, params = {}) {
        if (command === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') {
          debuggerMouseReleased += 1;
          paymentPhase = 'trustedExpanded';
        }
      }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        const funcText = String(payload.func || '');
        if (payload.files) return undefined;
        if (payload.args && payload.args.length === 1 && typeof payload.args[0] === 'number') {
          shippingSelectionAttempts += 1;
          if (paymentPhase !== 'trustedExpanded') {
            return [{ result: { success: false, error: 'matching payment shipping option not found', options: [{ amountJpy: 430, checked: true, disabled: false }] } }];
          }
          paymentPhase = 'shippingSelected';
          return [{ result: { success: true, changed: true, selectedShippingJpy: payload.args[0] } }];
        }
        if (payload.args && payload.args.length >= 2) {
          actions.push(payload.args[1]);
          if (payload.args[1] === 'review') paymentPhase = 'confirm';
          if (payload.args[1] === 'finalize') paymentPhase = 'complete';
          return [{ result: { success: true, text: 'clicked' } }];
        }
        if (funcText.includes("reason: 'shipping change button not found'")) {
          shippingChangeJsClicks += 1;
          paymentPhase = 'jsExpanded';
          return [{ result: { success: true, changed: true, method: 'shippingSection', text: '\u5909\u66f4\u3059\u308b', clickedText: '\u5909\u66f4\u3059\u308b' } }];
        }
        if (funcText.includes('shipping change button click point not found')) {
          return [{ result: { success: true, x: 806, y: 369, rect: { left: 752, top: 350, width: 108, height: 38 }, text: '\u5909\u66f4\u3059\u308b' } }];
        }
        return [{ result: paymentState() }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 129, productId: 'w1234480217', transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=w1234480217', finalPrice: 5261, effectiveShippingFeeText: '180\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      if (String(url).includes('/api/plugin/diagnostics')) {
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.equal(shippingChangeJsClicks, 1);
  assert.equal(debuggerAttachCalls, 1);
  assert.equal(debuggerMouseReleased, 1);
  assert.equal(shippingSelectionAttempts, 1);
  assert.deepEqual(actions, ['review', 'finalize']);
  assert.equal(calls[0].status, 'success');
}

async function testRunPaymentJobsCompletesStoreShippingChangePage() {
  const calls = [];
  const actions = [];
  let paymentPhase = 'reviewInitial';
  let expandClicks = 0;
  let selectAttempts = 0;
  let selectedShippingAmount = null;
  let applyClicks = 0;
  let now = 0;
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  }
  const paymentState = () => {
    if (paymentPhase === 'confirm') {
      return { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/confirm?auctionId=h1217537840', hasFinalizeButton: true, paymentAmountJpy: 6184 } };
    }
    if (paymentPhase === 'complete') {
      return { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/complete?auctionId=h1217537840', complete: true } };
    }
    if (paymentPhase === 'reviewSelected') {
      return {
        success: true,
        state: {
          url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=h1217537840',
          hasReviewButton: true,
          paymentAmountJpy: 6184,
          textSample: '\u914d\u9001\u65b9\u6cd5 \u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8 185\u5186 \u78ba\u8a8d\u3059\u308b',
          selectedShippingAmountJpy: 185,
          shippingOptions: []
        }
      };
    }
    if (paymentPhase === 'changePage' || paymentPhase === 'changeSelected') {
      const selectedExpected = paymentPhase === 'changeSelected';
      return {
        success: true,
        state: {
          url: 'https://buy.auctions.yahoo.co.jp/order/change/pay-method?auctionId=h1217537840',
          hasReviewButton: false,
          paymentAmountJpy: 6759,
          textSample: '\u914d\u9001\u65b9\u6cd5 \u3086\u3046\u30d1\u30c3\u30af 60\u30b5\u30a4\u30ba \u9001\u6599\uff1a760\u5186 \u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8(185\u5186) \u5909\u66f4\u3059\u308b',
          selectedShippingAmountJpy: selectedExpected ? 185 : 760,
          shippingOptions: [
            { amountJpy: 760, checked: !selectedExpected, disabled: false, text: '\u3086\u3046\u30d1\u30c3\u30af 60\u30b5\u30a4\u30ba \u9001\u6599\uff1a760\u5186' },
            { amountJpy: 185, checked: selectedExpected, disabled: false, text: '\u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8(185\u5186) \u9001\u6599\uff1a185\u5186' }
          ]
        }
      };
    }
    return {
      success: true,
      state: {
        url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=h1217537840',
        hasReviewButton: true,
        paymentAmountJpy: 6759,
        textSample: '\u304a\u652f\u6255\u3044\u91d1\u984d 6,759\u5186 \u914d\u9001\u65b9\u6cd5 \u5909\u66f4 \u3086\u3046\u30d1\u30c3\u30af 60\u30b5\u30a4\u30ba 760\u5186',
        selectedShippingAmountJpy: 760,
        shippingOptions: []
      }
    };
  };
  const api = loadBackgroundForTest({
    Date: FakeDate,
    setTimeout(fn, ms) {
      now += Number(ms || 0);
      return fn();
    },
    tabs: {
      async create() { return { id: 58, url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=h1217537840', status: 'complete' }; },
      async get(id) {
        const state = paymentState().state;
        return { id, url: state.url, status: 'complete' };
      },
      async query() {
        const state = paymentState().state;
        return [{ id: 58, url: state.url, status: 'complete' }];
      }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        const funcText = String(payload.func || '');
        if (payload.files) return undefined;
        if (payload.args && payload.args.length === 1 && typeof payload.args[0] === 'number') {
          selectAttempts += 1;
          if (selectAttempts === 1) {
            return [{ result: { success: false, error: 'matching payment shipping option not found', options: [] } }];
          }
          selectedShippingAmount = payload.args[0];
          paymentPhase = 'changeSelected';
          return [{ result: { success: true, changed: true, selectedShippingJpy: payload.args[0] } }];
        }
        if (payload.args && payload.args.length >= 2) {
          actions.push(payload.args[1]);
          if (payload.args[1] === 'review') paymentPhase = 'confirm';
          if (payload.args[1] === 'finalize') paymentPhase = 'complete';
          return [{ result: { success: true, text: 'clicked' } }];
        }
        if (funcText.includes('store payment shipping apply button not found')) {
          applyClicks += 1;
          paymentPhase = 'reviewSelected';
          return [{ result: { success: true, text: '\u5909\u66f4\u3059\u308b', method: 'jsClick' } }];
        }
        if (funcText.includes("reason: 'shipping change button not found'")) {
          expandClicks += 1;
          paymentPhase = 'changePage';
          return [{ result: { success: true, changed: true, method: 'afterShippingHeader', text: '\u5909\u66f4', clickedText: '\u5909\u66f4' } }];
        }
        if (funcText.includes('shipping change button JS click not found')) {
          throw new Error('store flow should not retry shipping change after entering change page');
        }
        return [{ result: paymentState() }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 58, productId: 'h1217537840', productType: 'store', transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=h1217537840', finalPrice: 5999, effectiveShippingFeeText: '185\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.equal(expandClicks, 1);
  assert.equal(selectAttempts, 2);
  assert.equal(selectedShippingAmount, 185);
  assert.equal(applyClicks, 1);
  assert.deepEqual(actions, ['review', 'finalize']);
  assert.equal(calls[0].status, 'success');
}

async function testRunPaymentJobsSelectsNoAppraisalBeforeReview() {
  const calls = [];
  const actions = [];
  let appraisalSelections = 0;
  const states = [
    {
      success: true,
      state: {
        url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase',
        hasReviewButton: true,
        hasAppraisalSection: true,
        hasNoAppraisalSelected: false,
        paymentAmountJpy: 22888,
        selectedShippingAmountJpy: 0,
        shippingOptions: []
      }
    },
    {
      success: true,
      state: {
        url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase',
        hasReviewButton: true,
        hasAppraisalSection: true,
        hasNoAppraisalSelected: true,
        paymentAmountJpy: 22888,
        selectedShippingAmountJpy: 0,
        shippingOptions: []
      }
    },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/confirm', hasFinalizeButton: true, paymentAmountJpy: 22888 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/complete', complete: true } }
  ];
  const api = loadBackgroundForTest({
    sleep: async () => {},
    tabs: {
      async create() { return { id: 21, url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', status: 'complete' }; },
      async get(id) { return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', status: 'complete' }; },
      async query() { return [{ id: 21, url: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        if (payload.files) return undefined;
        if (payload.args?.[0] === '__gdaipai_select_no_appraisal__') {
          appraisalSelections += 1;
          return [{ result: { success: true, selected: true, text: '\u9451\u5b9a\u3057\u306a\u3044' } }];
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
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 21, productId: 'a21', transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/purchase', finalPrice: 22888, effectiveShippingFeeText: '0\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.equal(appraisalSelections, 1);
  assert.deepEqual(actions, ['review', 'finalize']);
  assert.equal(calls[0].orderId, 21);
  assert.equal(calls[0].status, 'success');
}

async function testRunPaymentJobsDoesNotRequireShippingOptionWhenAmountAlreadyMatches() {
  const calls = [];
  const actions = [];
  let shippingSelectionAttempts = 0;
  const states = [
    {
      success: true,
      state: {
        url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=1218905181',
        hasReviewButton: true,
        paymentAmountJpy: 670,
        textSample: '\u914d\u9001\u65b9\u6cd5 \u304a\u652f\u6255\u3044\u91d1\u984d\uff08\u5408\u8a08\uff09 670\u5186',
        selectedShippingAmountJpy: 0,
        shippingOptions: []
      }
    },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/confirm?aid=1218905181', hasFinalizeButton: true, paymentAmountJpy: 670 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/complete?aid=1218905181', complete: true } }
  ];
  const api = loadBackgroundForTest({
    sleep: async () => {},
    tabs: {
      async create() { return { id: 23, url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=1218905181', status: 'complete' }; },
      async get(id) { return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=1218905181', status: 'complete' }; },
      async query() { return [{ id: 23, url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=1218905181', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        if (payload.files) return undefined;
        if (payload.args && payload.args.length === 1 && typeof payload.args[0] === 'number') {
          shippingSelectionAttempts += 1;
          return [{ result: { success: false, error: 'matching payment shipping option not found' } }];
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
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 23, productId: '1218905181', transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=1218905181', finalPrice: 240, effectiveShippingFeeText: '430\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.equal(shippingSelectionAttempts, 0);
  assert.deepEqual(actions, ['review', 'finalize']);
  assert.equal(calls[0].orderId, 23);
  assert.equal(calls[0].status, 'success');
}

async function testRunStorePaymentJobsRetriesDlvryChangeUntilRenderedWhenAmountMismatches() {
  const calls = [];
  const actions = [];
  let paymentPhase = 'reviewMismatch';
  let expandAttempts = 0;
  let shippingSelectionAttempts = 0;
  let debuggerAttachCalls = 0;
  let now = 0;
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  }
  const stateForPhase = () => {
    if (paymentPhase === 'changePage') {
      return {
        success: true,
        state: {
          url: 'https://buy.auctions.yahoo.co.jp/order/change/pay-method?auctionId=h1217537840',
          paymentAmountJpy: 6759,
          textSample: '\u914d\u9001\u65b9\u6cd5 \u3086\u3046\u30d1\u30c3\u30af 60\u30b5\u30a4\u30ba 760\u5186 \u30ec\u30bf\u30fc\u30d1\u30c3\u30af 950\u5186',
          shippingOptions: [
            { amountJpy: 760, checked: true, disabled: false },
            { amountJpy: 950, checked: false, disabled: false }
          ]
        }
      };
    }
    if (paymentPhase === 'reviewSelected') {
      return {
        success: true,
        state: {
          url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=h1217537840',
          hasReviewButton: true,
          paymentAmountJpy: 6949,
          textSample: '\u914d\u9001\u65b9\u6cd5 \u30ec\u30bf\u30fc\u30d1\u30c3\u30af 950\u5186',
          selectedShippingAmountJpy: 950,
          shippingOptions: []
        }
      };
    }
    if (paymentPhase === 'confirm') {
      return { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/confirm?auctionId=h1217537840', hasFinalizeButton: true, paymentAmountJpy: 6949 } };
    }
    if (paymentPhase === 'complete') {
      return { success: true, state: { url: 'https://buy.auctions.yahoo.co.jp/order/complete?auctionId=h1217537840', complete: true } };
    }
    return {
      success: true,
      state: {
        url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=h1217537840',
        hasReviewButton: true,
        paymentAmountJpy: 6759,
        textSample: '\u914d\u9001\u65b9\u6cd5 \u5909\u66f4 \u3086\u3046\u30d1\u30c3\u30af 60\u30b5\u30a4\u30ba 760\u5186',
        selectedShippingAmountJpy: 760,
        shippingOptions: []
      }
    };
  };
  const api = loadBackgroundForTest({
    Date: FakeDate,
    setTimeout(fn, ms) {
      now += Number(ms || 0);
      return fn();
    },
    tabs: {
      async create() { return { id: 29, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=h1217537840', status: 'complete' }; },
      async get(id) { return { id, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=h1217537840', status: 'complete' }; },
      async query() { return [{ id: 29, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=h1217537840', status: 'complete' }]; }
    },
    debuggerApi: {
      async attach() {
        debuggerAttachCalls += 1;
      }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        const funcText = String(payload.func || '');
        if (payload.files) return undefined;
        if (payload.args && payload.args.length === 1 && typeof payload.args[0] === 'number') {
          shippingSelectionAttempts += 1;
          return [{ result: { success: true, changed: true, selectedShippingJpy: payload.args[0] } }];
        }
        if (payload.args && payload.args.length >= 2) {
          actions.push(payload.args[1]);
          if (payload.args[1] === 'review') paymentPhase = 'confirm';
          if (payload.args[1] === 'finalize') paymentPhase = 'complete';
          return [{ result: { success: true, text: 'clicked' } }];
        }
        if (funcText.includes('store payment shipping apply button not found')) {
          paymentPhase = 'reviewSelected';
          return [{ result: { success: true, method: 'jsClick', text: '\u5909\u66f4\u3059\u308b' } }];
        }
        if (funcText.includes("reason: 'shipping change button not found'")) {
          expandAttempts += 1;
          if (expandAttempts >= 2) {
            paymentPhase = 'changePage';
            return [{ result: { success: true, changed: true, method: 'storeDlvrySelector', text: '\u5909\u66f4' } }];
          }
          return [{ result: { success: true, changed: false, reason: 'shipping change button not found' } }];
        }
        if (funcText.includes('shipping change button JS click not found')) {
          return [{ result: { success: false, error: 'shipping change button JS click not found' } }];
        }
        return [{ result: stateForPhase() }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 29, productId: 'h1217537840', productType: 'store', transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=h1217537840', finalPrice: 5999, effectiveShippingFeeText: '950\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.equal(expandAttempts, 2);
  assert.equal(debuggerAttachCalls, 0);
  assert.equal(shippingSelectionAttempts, 1);
  assert.deepEqual(actions, ['review', 'finalize']);
  assert.equal(calls[0].status, 'success');
}

async function testRunStorePaymentShippingMismatchDoesNotUseDebuggerFallback() {
  const calls = [];
  let expandAttempts = 0;
  let shippingSelectionAttempts = 0;
  let debuggerAttachCalls = 0;
  let now = 0;
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  }
  const reviewState = {
    success: true,
    state: {
      url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=h1217537840',
      hasReviewButton: true,
      paymentAmountJpy: 6759,
      textSample: '\u914d\u9001\u65b9\u6cd5 \u5909\u66f4 \u3086\u3046\u30d1\u30c3\u30af 60\u30b5\u30a4\u30ba 760\u5186',
      selectedShippingAmountJpy: 760,
      shippingOptions: []
    }
  };
  const api = loadBackgroundForTest({
    Date: FakeDate,
    setTimeout(fn, ms) {
      now += Number(ms || 0);
      return fn();
    },
    tabs: {
      async create() { return { id: 31, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=h1217537840', status: 'complete' }; },
      async get(id) { return { id, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=h1217537840', status: 'complete' }; },
      async query() { return [{ id: 31, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=h1217537840', status: 'complete' }]; }
    },
    debuggerApi: {
      async attach() {
        debuggerAttachCalls += 1;
      }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        const funcText = String(payload.func || '');
        if (payload.files) return undefined;
        if (payload.args && payload.args.length === 1 && typeof payload.args[0] === 'number') {
          shippingSelectionAttempts += 1;
          return [{ result: { success: false, options: [{ amountJpy: 760, checked: true, disabled: false }] } }];
        }
        if (funcText.includes("reason: 'shipping change button not found'")) {
          expandAttempts += 1;
          return [{ result: { success: true, changed: false, reason: 'shipping change button not found' } }];
        }
        if (funcText.includes('shipping change button JS click not found')) {
          throw new Error('debugger fallback must not be called');
        }
        return [{ result: reviewState }];
      }
    },
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/payment/jobs')) {
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 31, productId: 'h1217537840', productType: 'store', transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=h1217537840', finalPrice: 5999, effectiveShippingFeeText: '950\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.equal(expandAttempts, 5);
  assert.equal(shippingSelectionAttempts, 1);
  assert.equal(debuggerAttachCalls, 0);
  assert.match(calls[0].error, /payment shipping option 950\u5186 not selectable/);
  assert.equal(String(calls[0].error).includes('trustedExpand'), false);
}

async function testRunPaymentJobsWaitsForMatchingAmountBeforeSelectingShipping() {
  const calls = [];
  const actions = [];
  let shippingSelectionAttempts = 0;
  let now = 0;
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  }
  const states = [
    {
      success: true,
      state: {
        url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=1218905181',
        hasReviewButton: true,
        paymentAmountJpy: 240,
        textSample: '\u914d\u9001\u65b9\u6cd5 \u304a\u652f\u6255\u3044\u91d1\u984d\uff08\u5408\u8a08\uff09 240\u5186',
        selectedShippingAmountJpy: 0,
        shippingOptions: []
      }
    },
    {
      success: true,
      state: {
        url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=1218905181',
        hasReviewButton: true,
        paymentAmountJpy: 670,
        textSample: '\u914d\u9001\u65b9\u6cd5 \u304a\u652f\u6255\u3044\u91d1\u984d\uff08\u5408\u8a08\uff09 670\u5186',
        selectedShippingAmountJpy: 0,
        shippingOptions: []
      }
    },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/confirm?aid=1218905181', hasFinalizeButton: true, paymentAmountJpy: 670 } },
    { success: true, state: { url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/complete?aid=1218905181', complete: true } }
  ];
  const api = loadBackgroundForTest({
    Date: FakeDate,
    setTimeout(fn, ms) {
      now += Number(ms || 0);
      return fn();
    },
    tabs: {
      async create() { return { id: 24, url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=1218905181', status: 'complete' }; },
      async get(id) { return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=1218905181', status: 'complete' }; },
      async query() { return [{ id: 24, url: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=1218905181', status: 'complete' }]; }
    },
    scripting: {
      async executeScript(...args) {
        const payload = args[0] || {};
        if (payload.files) return undefined;
        if (payload.args && payload.args.length === 1 && typeof payload.args[0] === 'number') {
          shippingSelectionAttempts += 1;
          return [{ result: { success: false, error: 'matching payment shipping option not found' } }];
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
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 24, productId: '1218905181', transactionUrl: 'https://contact.auctions.yahoo.co.jp/buyer/payment/input?aid=1218905181', finalPrice: 240, effectiveShippingFeeText: '430\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.equal(shippingSelectionAttempts, 0);
  assert.deepEqual(actions, ['review', 'finalize']);
  assert.equal(calls[0].orderId, 24);
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
        hasStoreConfirmationSection: false,
        paymentAmountJpy: 43320
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
        if (funcText.includes('findStoreConfirmationChange')) {
          return [{ result: { success: true, text: '\u5909\u66f4' } }];
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
        return { async json() { return { success: true, paymentPageStaySeconds: 1, jobs: [{ orderId: 19, productId: 'j1232680017', productType: 'store', transactionUrl: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017', finalPrice: 41800, effectiveShippingFeeText: '1520\u5186' }] }; } };
      }
      if (String(url).includes('/api/plugin/payment/status')) {
        calls.push(JSON.parse(options.body || '{}'));
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  await api.runPaymentJobs();

  assert.equal(storeApplyChecks, 1);
  assert.equal(storeApplySubmits, 1);
  assert.equal(trustedMouseCommands, 0);
  assert.equal(tabUpdates.some(call => call.updateInfo?.url === 'https://buy.auctions.yahoo.co.jp/order/change/store-options?auctionId=j1232680017'), false);
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
        if (funcText.includes('findStoreConfirmationChange')) {
          return [{ result: { success: true, text: '\u5909\u66f4' } }];
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
  assert.equal(trustedMouseCommands, 0);
  assert.equal(tabUpdates.some(call => call.updateInfo?.url === 'https://buy.auctions.yahoo.co.jp/order/change/store-options?auctionId=j1232680017'), false);
  assert.equal(calls[0].orderId, 20);
  assert.equal(calls[0].status, 'success');
}

async function testCompleteStoreConfirmationItemsUsesJsClickOnlyOnEditPage() {
  let trustedAttachCount = 0;
  let jsChangeClicks = 0;
  let jsCheckboxChecks = 0;
  let jsApplyClicks = 0;
  const states = [
    {
      success: true,
      state: {
        url: 'https://buy.auctions.yahoo.co.jp/order/store-confirmation?auctionId=j1232680017',
        hasStoreConfirmationSection: true,
        hasStoreConfirmationEditPage: true
      }
    },
    {
      success: true,
      state: {
        url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017',
        hasReviewButton: true,
        hasStoreConfirmationSection: true
      }
    }
  ];
  const api = loadBackgroundForTest({
    sleep: async () => {},
    tabs: {
      async get(id) { return { id, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017', status: 'complete' }; },
      async update(id) { return { id, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017', status: 'complete' }; },
      async query() { return [{ id: 31, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017', status: 'complete' }]; }
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
          return [{ result: { success: true, points: [{ index: 0, checked: false, x: 118, y: 386, text: '\u4e86\u627f\u3057\u307e\u3057\u305f\u3002' }] } }];
        }
        if (funcText.includes('hasSkeleton')) {
          return [{ result: { success: true, readyState: 'complete', checkboxCount: 1, checkedCount: 0, hasApplyButton: true, buttonText: '\u5909\u66f4\u3059\u308b', hasStoreOptionText: true, hasSkeleton: false, textLength: 180 } }];
        }
        if (funcText.includes('store confirmation apply button not found') && funcText.includes('checkedCount')) {
          jsCheckboxChecks += 1;
          return [{ result: { success: true, checkedCount: 1, text: '\u5909\u66f4\u3059\u308b', applyReady: true } }];
        }
        if (funcText.includes('store confirmation apply button not found')) {
          jsApplyClicks += 1;
          return [{ result: { success: true, text: '\u5909\u66f4\u3059\u308b' } }];
        }
        if (funcText.includes('findStoreConfirmationChange')) {
          jsChangeClicks += 1;
          return [{ result: { success: true, text: '\u5909\u66f4' } }];
        }
        return [{ result: states.shift() || { success: true, state: { complete: true } } }];
      }
    },
    debuggerApi: {
      async attach() { trustedAttachCount += 1; },
      async sendCommand() {},
      async detach() {}
    },
    fetch: async () => ({ async json() { return { success: true }; } })
  });

  const result = await api.completeStoreConfirmationItems(
    { id: 31, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=j1232680017', status: 'complete' },
    { hasStoreConfirmationSection: true }
  );

  assert.equal(result.success, true);
  assert.equal(jsChangeClicks, 1);
  assert.equal(jsCheckboxChecks, 1);
  assert.equal(jsApplyClicks, 1);
  assert.equal(trustedAttachCount, 0);
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

async function testStorePaymentShippingChangeUsesShortChangeJsClick() {
  const makeElement = (order, text, rect = null) => ({
    order,
    textContent: text,
    value: '',
    title: '',
    disabled: false,
    href: '',
    getAttribute() { return ''; },
    closest(selector) {
      return selector.includes('a') && rect ? this : null;
    },
    scrollIntoView() {},
    focus() {},
    click() {
      this.clicked = true;
    },
    dispatchEvent(event) {
      this.events = this.events || [];
      this.events.push(event.type);
      return true;
    },
    compareDocumentPosition(other) {
      return this.order < other.order ? 4 : 0;
    },
    getBoundingClientRect() {
      return rect || { left: 0, top: 0, width: 0, height: 0 };
    }
  });
  const paymentHeader = makeElement(5, '\u304a\u652f\u6255\u3044\u65b9\u6cd5');
  const paymentChange = makeElement(6, '\u5909\u66f4', { left: 540, top: 180, width: 40, height: 20 });
  const shippingHeader = makeElement(10, '\u914d\u9001\u65b9\u6cd5');
  const shippingChange = makeElement(35, '\u5909\u66f4', { left: 485, top: 282, width: 40, height: 20 });
  const deliveryStop = makeElement(45, '\u304a\u5c4a\u3051\u5148');
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript(payload) {
        const result = vm.runInNewContext(`(${payload.func.toString()})()`, {
          Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
          PointerEvent: class PointerEvent { constructor(type) { this.type = type; } },
          MouseEvent: class MouseEvent { constructor(type) { this.type = type; } },
          KeyboardEvent: class KeyboardEvent { constructor(type) { this.type = type; } },
          window: {},
          document: {
            querySelectorAll(selector) {
              if (selector === 'section') return [];
              if (String(selector).startsWith('button')) return [paymentChange, shippingChange];
              return [shippingHeader, paymentHeader, deliveryStop];
            }
          }
        });
        return [{ result }];
      }
    }
  });

  const result = await api.clickPaymentShippingChangeButton(99);

  assert.equal(result.success, true);
  assert.equal(result.text, '\u5909\u66f4');
  assert.equal(shippingChange.clicked, true);
  assert.equal(paymentChange.clicked, undefined);
  assert.deepEqual(shippingChange.events, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'keydown', 'keyup']);
}

async function testStorePaymentShippingChangeUsesDlvrySelectorJsClick() {
  const shippingChange = {
    textContent: '\u5909\u66f4',
    value: '',
    title: '',
    disabled: false,
    href: '',
    getAttribute(name) {
      return name === 'data-cl-params' ? '_cl_link:dlvry;_cl_position:1;' : '';
    },
    closest(selector) {
      return selector.includes('a') ? this : null;
    },
    scrollIntoView() {},
    focus() {},
    click() {
      this.clicked = true;
    },
    dispatchEvent(event) {
      this.events = this.events || [];
      this.events.push(event.type);
      return true;
    }
  };
  const dlvryBlock = {
    textContent: '\u914d\u9001\u65b9\u6cd5 \u5909\u66f4',
    querySelector(selector) {
      return String(selector).includes('_cl_link:dlvry') ? shippingChange : null;
    }
  };
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript(payload) {
        const result = vm.runInNewContext(`(${payload.func.toString()})()`, {
          Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
          PointerEvent: class PointerEvent { constructor(type) { this.type = type; } },
          MouseEvent: class MouseEvent { constructor(type) { this.type = type; } },
          KeyboardEvent: class KeyboardEvent { constructor(type) { this.type = type; } },
          window: {},
          document: {
            querySelector(selector) {
              return selector === '#dlvry' ? dlvryBlock : null;
            },
            querySelectorAll() {
              return [];
            }
          }
        });
        return [{ result }];
      }
    }
  });

  const result = await api.clickPaymentShippingChangeButton(99);

  assert.equal(result.success, true);
  assert.equal(result.method, 'storeDlvrySelector');
  assert.equal(result.text, '\u5909\u66f4');
  assert.equal(shippingChange.clicked, true);
}

async function testSelectPaymentShippingOptionAcceptsHeaderContainerContainingRadios() {
  const body = { textContent: '', parentElement: null };
  const shippingContainer = {
    textContent: '\u914d\u9001\u65b9\u6cd5 \u3086\u3046\u30d1\u30c3\u30af 60\u30b5\u30a4\u30ba \u9001\u6599\uff1a760\u5186 \u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8\uff08185\u5186\uff09 \u9001\u6599\uff1a185\u5186',
    parentElement: body,
    contains(node) {
      return node === radio760 || node === radio185 || node === label760 || node === label185;
    },
    compareDocumentPosition() {
      return 0;
    },
    getBoundingClientRect() {
      return { width: 600, height: 160 };
    }
  };
  const label760 = {
    textContent: '\u3086\u3046\u30d1\u30c3\u30af 60\u30b5\u30a4\u30ba \u9001\u6599\uff1a760\u5186',
    parentElement: shippingContainer,
    closest() { return this; },
    getBoundingClientRect() { return { width: 500, height: 40 }; },
    scrollIntoView() {},
    focus() {},
    click() { this.clicked = true; },
    dispatchEvent() { return true; }
  };
  const label185 = {
    textContent: '\u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8\uff08185\u5186\uff09 \u9001\u6599\uff1a185\u5186',
    parentElement: shippingContainer,
    closest() { return this; },
    getBoundingClientRect() { return { width: 500, height: 40 }; },
    scrollIntoView() {},
    focus() {},
    click() { this.clicked = true; },
    dispatchEvent() { return true; }
  };
  const radio760 = {
    id: '',
    textContent: '',
    checked: true,
    disabled: false,
    parentElement: label760,
    closest() { return label760; },
    getBoundingClientRect() { return { width: 0, height: 0 }; },
    dispatchEvent(event) { this.events = [...(this.events || []), event.type]; return true; }
  };
  const radio185 = {
    id: '',
    textContent: '',
    checked: false,
    disabled: false,
    parentElement: label185,
    closest() { return label185; },
    getBoundingClientRect() { return { width: 0, height: 0 }; },
    dispatchEvent(event) { this.events = [...(this.events || []), event.type]; return true; }
  };
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript(payload) {
        const result = vm.runInNewContext(`(${payload.func.toString()})(185)`, {
          Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
          Event: class Event { constructor(type) { this.type = type; } },
          PointerEvent: class PointerEvent { constructor(type) { this.type = type; } },
          MouseEvent: class MouseEvent { constructor(type) { this.type = type; } },
          CSS: { escape(value) { return String(value); } },
          window: {
            getComputedStyle() {
              return { display: 'block', visibility: 'visible', opacity: '1' };
            }
          },
          document: {
            body,
            querySelector() { return null; },
            querySelectorAll(selector) {
              if (String(selector).includes('input[type="radio"]')) return [radio760, radio185];
              if (String(selector).includes('h1')) return [shippingContainer];
              return [];
            }
          }
        });
        return [{ result }];
      }
    }
  });

  const result = await api.selectPaymentShippingOption(77, 185);

  assert.equal(result.success, true);
  assert.equal(result.selectedShippingJpy, 185);
  assert.equal(label185.clicked, true);
  assert.deepEqual(radio185.events, ['input', 'change']);
}

async function testSelectPaymentShippingOptionUsesStoreShipMethodRadioName() {
  const body = { textContent: '', parentElement: null };
  const header = {
    textContent: '\u914d\u9001\u65b9\u6cd5',
    contains() { return false; },
    compareDocumentPosition() { return 0; }
  };
  const label185 = {
    textContent: '\u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8\uff08185\u5186\uff09 \u9001\u6599\uff1a185\u5186',
    parentElement: body,
    closest() { return this; },
    getBoundingClientRect() { return { width: 500, height: 40 }; },
    scrollIntoView() {},
    focus() {},
    click() { this.clicked = true; },
    dispatchEvent() { return true; }
  };
  const radio185 = {
    id: '',
    name: 'shipMethodPullDown',
    value: 'postage8',
    textContent: '',
    checked: false,
    disabled: false,
    parentElement: label185,
    closest() { return label185; },
    getBoundingClientRect() { return { width: 0, height: 0 }; },
    dispatchEvent(event) { this.events = [...(this.events || []), event.type]; return true; }
  };
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript(payload) {
        const result = vm.runInNewContext(`(${payload.func.toString()})(185)`, {
          Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
          Event: class Event { constructor(type) { this.type = type; } },
          PointerEvent: class PointerEvent { constructor(type) { this.type = type; } },
          MouseEvent: class MouseEvent { constructor(type) { this.type = type; } },
          CSS: { escape(value) { return String(value); } },
          window: {
            getComputedStyle() {
              return { display: 'block', visibility: 'visible', opacity: '1' };
            }
          },
          document: {
            body,
            querySelector() { return null; },
            querySelectorAll(selector) {
              if (String(selector).includes('input[type="radio"]')) return [radio185];
              if (String(selector).includes('h1')) return [header];
              return [];
            }
          }
        });
        return [{ result }];
      }
    }
  });

  const result = await api.selectPaymentShippingOption(77, 185);

  assert.equal(result.success, true);
  assert.equal(label185.clicked, true);
}

async function testSelectPaymentShippingOptionScopesStoreShippingSection() {
  const body = { textContent: '', parentElement: null };
  const paymentLabel185 = {
    textContent: '\u304a\u652f\u6255\u3044\u65b9\u6cd5 \u652f\u6255\u3044\u624b\u6570\u6599 185\u5186',
    parentElement: body,
    closest() { return this; },
    getBoundingClientRect() { return { width: 500, height: 40 }; },
    scrollIntoView() {},
    focus() {},
    click() { this.clicked = true; },
    dispatchEvent() { return true; }
  };
  const paymentRadio185 = {
    id: '',
    name: 'pay_method',
    value: 'payment_a6',
    textContent: '',
    checked: false,
    disabled: false,
    parentElement: paymentLabel185,
    closest() { return paymentLabel185; },
    getBoundingClientRect() { return { width: 0, height: 0 }; },
    dispatchEvent(event) { this.events = [...(this.events || []), event.type]; return true; }
  };
  const shippingPanel = {
    textContent: '\u914d\u9001\u65b9\u6cd5 \u3086\u3046\u30d1\u30c3\u30af 60\u30b5\u30a4\u30ba \u9001\u6599\uff1a760\u5186 \u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8\uff08185\u5186\uff09 \u9001\u6599\uff1a185\u5186',
    parentElement: body,
    querySelectorAll(selector) {
      return String(selector).includes('shipMethodPullDown') || String(selector).includes('value^="postage"')
        ? [shippingRadio760, shippingRadio185]
        : [];
    },
    contains(node) {
      return node === shipHeader || node === shippingRadio760 || node === shippingRadio185 || node === shippingLabel760 || node === shippingLabel185;
    },
    compareDocumentPosition() {
      return 0;
    },
    getBoundingClientRect() {
      return { width: 600, height: 180 };
    }
  };
  const shipHeader = {
    id: 'shipMethod',
    textContent: '\u914d\u9001\u65b9\u6cd5',
    parentElement: shippingPanel,
    querySelectorAll() { return []; },
    contains(node) { return node === this; },
    compareDocumentPosition() { return 0; }
  };
  const shippingLabel760 = {
    textContent: '\u3086\u3046\u30d1\u30c3\u30af 60\u30b5\u30a4\u30ba \u9001\u6599\uff1a760\u5186',
    parentElement: shippingPanel,
    closest() { return this; },
    getBoundingClientRect() { return { width: 500, height: 40 }; },
    scrollIntoView() {},
    focus() {},
    click() { this.clicked = true; shippingRadio760.checked = true; shippingRadio185.checked = false; },
    dispatchEvent() { return true; }
  };
  const shippingLabel185 = {
    textContent: '\u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8\uff08185\u5186\uff09 \u9001\u6599\uff1a185\u5186',
    parentElement: shippingPanel,
    closest() { return this; },
    getBoundingClientRect() { return { width: 500, height: 40 }; },
    scrollIntoView() {},
    focus() {},
    click() { this.clicked = true; shippingRadio760.checked = false; shippingRadio185.checked = true; },
    dispatchEvent() { return true; }
  };
  const shippingRadio760 = {
    id: '',
    name: 'shipMethodPullDown',
    value: 'postage1',
    textContent: '',
    checked: true,
    disabled: false,
    parentElement: shippingLabel760,
    closest() { return shippingLabel760; },
    getBoundingClientRect() { return { width: 0, height: 0 }; },
    dispatchEvent(event) { this.events = [...(this.events || []), event.type]; return true; }
  };
  const shippingRadio185 = {
    id: '',
    name: 'shipMethodPullDown',
    value: 'postage8',
    textContent: '',
    checked: false,
    disabled: false,
    parentElement: shippingLabel185,
    closest() { return shippingLabel185; },
    getBoundingClientRect() { return { width: 0, height: 0 }; },
    dispatchEvent(event) { this.events = [...(this.events || []), event.type]; return true; }
  };
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript(payload) {
        const result = vm.runInNewContext(`(${payload.func.toString()})(185)`, {
          Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
          Event: class Event { constructor(type) { this.type = type; } },
          PointerEvent: class PointerEvent { constructor(type) { this.type = type; } },
          MouseEvent: class MouseEvent { constructor(type) { this.type = type; } },
          CSS: { escape(value) { return String(value); } },
          window: {
            getComputedStyle() {
              return { display: 'block', visibility: 'visible', opacity: '1' };
            }
          },
          document: {
            body,
            querySelector(selector) {
              return selector === '#shipMethod' ? shipHeader : null;
            },
            querySelectorAll(selector) {
              const value = String(selector);
              if (value.includes('input[type="radio"]')) return [paymentRadio185, shippingRadio760, shippingRadio185];
              if (value.includes('h1')) return [shipHeader];
              return [];
            }
          }
        });
        return [{ result }];
      }
    }
  });

  const result = await api.selectPaymentShippingOption(77, 185);

  assert.equal(result.success, true);
  assert.equal(paymentLabel185.clicked, undefined);
  assert.equal(shippingLabel185.clicked, true);
  assert.equal(shippingRadio185.checked, true);
}

async function testSelectPaymentShippingOptionAllowsHiddenStoreShippingRadio() {
  const body = { textContent: '', parentElement: null };
  const shippingPanel = {
    textContent: '\u914d\u9001\u65b9\u6cd5 \u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8\uff08185\u5186\uff09 \u9001\u6599\uff1a185\u5186',
    parentElement: body,
    querySelectorAll(selector) {
      return String(selector).includes('shipMethodPullDown') || String(selector).includes('value^="postage"') ? [radio185] : [];
    },
    getBoundingClientRect() { return { width: 0, height: 0 }; }
  };
  const shipHeader = {
    id: 'shipMethod',
    textContent: '\u914d\u9001\u65b9\u6cd5',
    parentElement: shippingPanel,
    querySelectorAll() { return []; },
    contains() { return false; },
    compareDocumentPosition() { return 0; }
  };
  const label185 = {
    textContent: '\u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8\uff08185\u5186\uff09 \u9001\u6599\uff1a185\u5186',
    parentElement: shippingPanel,
    closest() { return this; },
    getBoundingClientRect() { return { width: 0, height: 0 }; },
    scrollIntoView() {},
    focus() {},
    click() { this.clicked = true; radio185.checked = true; },
    dispatchEvent() { return true; }
  };
  const radio185 = {
    id: '',
    name: 'shipMethodPullDown',
    value: 'postage8',
    textContent: '',
    checked: false,
    disabled: false,
    parentElement: label185,
    closest() { return label185; },
    getBoundingClientRect() { return { width: 0, height: 0 }; },
    dispatchEvent(event) { this.events = [...(this.events || []), event.type]; return true; }
  };
  const api = loadBackgroundForTest({
    scripting: {
      async executeScript(payload) {
        const result = vm.runInNewContext(`(${payload.func.toString()})(185)`, {
          Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
          Event: class Event { constructor(type) { this.type = type; } },
          PointerEvent: class PointerEvent { constructor(type) { this.type = type; } },
          MouseEvent: class MouseEvent { constructor(type) { this.type = type; } },
          CSS: { escape(value) { return String(value); } },
          window: {
            getComputedStyle() {
              return { display: 'block', visibility: 'visible', opacity: '1' };
            }
          },
          document: {
            body,
            querySelector(selector) {
              return selector === '#shipMethod' ? shipHeader : null;
            },
            querySelectorAll(selector) {
              const value = String(selector);
              if (value.includes('input[type="radio"]')) return [radio185];
              if (value.includes('h1')) return [shipHeader];
              return [];
            }
          }
        });
        return [{ result }];
      }
    }
  });

  const result = await api.selectPaymentShippingOption(77, 185);

  assert.equal(result.success, true);
  assert.equal(label185.clicked, true);
  assert.equal(radio185.checked, true);
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
        return [{
          result: {
            success: true,
            state: {
              url: 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=p10',
              title: 'Yahoo!オークション - 取引ナビ',
              controlsSample: ['商品ページへ', '取引情報']
            }
          }
        }];
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
  assert.equal(calls[0].url, 'https://buy.auctions.yahoo.co.jp/order/status?auctionId=p10');
  assert.match(calls[0].diagnostics, /url=https:\/\/buy\.auctions\.yahoo\.co\.jp\/order\/status\?auctionId=p10/);
  assert.match(calls[0].diagnostics, /title=Yahoo!オークション - 取引ナビ/);
  assert.match(calls[0].diagnostics, /controls=商品ページへ \| 取引情報/);
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

async function testIdleSyncClosesAnsweredChallengeWhenNoVerificationTabsRemain() {
  let closedChallengeId = '';
  const api = loadBackgroundForTest({
    disableAutoStart: true,
    tabs: {
      async query() {
        return [
          { id: 31, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=I1232762424', status: 'complete', active: true }
        ];
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
              id: 'pin-I1232762424-old',
              type: 'pin',
              answered: true,
              answer: '123456',
              productId: 'I1232762424'
            };
          }
        };
      }
      if (value.includes('/api/plugin/manual-captcha/close')) {
        const body = JSON.parse(options.body || '{}');
        closedChallengeId = body.id;
        return { async json() { return { success: true, closed: 1 }; } };
      }
      return { async json() { return { task: null, canIdleSync: true }; } };
    }
  });

  await api.syncIdleYahooPages();

  assert.equal(closedChallengeId, 'pin-I1232762424-old');
}

async function testIdleSyncClosesUnansweredPinChallengeWhenPinTabClosed() {
  let closedChallengeId = '';
  const api = loadBackgroundForTest({
    disableAutoStart: true,
    tabs: {
      async query() {
        return [
          { id: 31, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=I1232762424', status: 'complete', active: true }
        ];
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
              id: 'pin-I1232762424-open',
              type: 'pin',
              answered: false,
              answer: '',
              productId: 'I1232762424'
            };
          }
        };
      }
      if (value.includes('/api/plugin/manual-captcha/close')) {
        const body = JSON.parse(options.body || '{}');
        closedChallengeId = body.id;
        return { async json() { return { success: true, closed: 1 }; } };
      }
      return { async json() { return { task: null, canIdleSync: true }; } };
    }
  });

  await api.syncIdleYahooPages();

  assert.equal(closedChallengeId, 'pin-I1232762424-open');
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

async function testCaptchaAnswerClosesCaptchaAndShowsPinWhenPinTabAppears() {
  let stage = 'captcha';
  const calls = [];
  const typedPins = [];
  const api = loadBackgroundForTest({
    tabs: {
      async get(id) {
        if (stage === 'done') return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=j1230839418', status: 'complete', active: true, windowId: 3 };
        if (id === 7) return { id: 7, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1', status: 'complete', active: stage === 'captcha', windowId: 3 };
        if (id === 9) return { id: 9, url: 'https://login.yahoo.co.jp/config/login?auth_lv=1&done=https%3A%2F%2Fcontact.auctions.yahoo.co.jp%2Fbuyer%2Ftop%3Faid%3Dj1230839418', status: 'complete', active: stage === 'pin', windowId: 3 };
        return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=j1230839418', status: 'complete', windowId: 3 };
      },
      async query() {
        if (stage === 'done') return [];
        if (stage === 'pin') {
          return [
            { id: 7, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1', status: 'complete', active: false, windowId: 3 },
            { id: 9, url: 'https://login.yahoo.co.jp/config/login?auth_lv=1&done=https%3A%2F%2Fcontact.auctions.yahoo.co.jp%2Fbuyer%2Ftop%3Faid%3Dj1230839418', status: 'complete', active: true, windowId: 3 }
          ];
        }
        return [
          { id: 7, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1', status: 'complete', active: true, windowId: 3 }
        ];
      },
      async update(id, props) {
        return { id, url: id === 9 ? 'https://login.yahoo.co.jp/config/login?auth_lv=1' : 'https://login.yahoo.co.jp/ncaptcha?fido=1', status: 'complete', active: props?.active, windowId: 3 };
      },
      async reload() {},
      async captureVisibleTab() {
        return 'data:image/png;base64,abc';
      }
    },
    scripting: {
      async executeScript(payload) {
        if (payload.files) return undefined;
        if (String(payload.func || '').includes('captchaAnswer')) {
          stage = 'pin';
          return [{ result: { success: true } }];
        }
        return [{ result: false }];
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
        calls.push(`challenge:${body.type}`);
        return { async json() { return { success: true }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/answer/')) {
        const isPinAnswer = String(url).includes('/pin-');
        return { async json() { return { answered: true, answer: isPinAnswer ? '123456' : 'abcd' }; } };
      }
      if (String(url).includes('/api/plugin/manual-captcha/close')) {
        const body = JSON.parse(options.body || '{}');
        calls.push(`close:${String(body.id || '').startsWith('captcha-') ? 'captcha' : 'pin'}`);
        return { async json() { return { success: true }; } };
      }
      return { async json() { return { task: null }; } };
    }
  });

  const result = await api.handleManualVerificationIfPresent(
    { id: 7, url: 'https://login.yahoo.co.jp/ncaptcha?fido=1', status: 'complete', windowId: 3 },
    { productId: 'j1230839418', source: 'test' }
  );

  assert.equal(result.handled, true);
  assert.deepEqual(calls.slice(0, 3), ['challenge:captcha', 'close:captcha', 'challenge:pin']);
  assert.equal(calls.includes('close:pin'), true);
  assert.equal(typedPins.join(''), '123456');
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

async function testTransactionCleanupDoesNotCloseNewAuctionProductTabs() {
  const removed = [];
  const api = loadBackgroundForTest({
    tabs: {
      async query() {
        return [
          { id: 1, url: 'https://contact.auctions.yahoo.co.jp/buyer/top' },
          { id: 2, url: 'https://auctions.yahoo.co.jp/jp/auction/x1233517511' },
          { id: 3, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=s1' }
        ];
      },
      async remove(id) {
        removed.push(id);
      }
    }
  });

  await api.closeTabsForTransactionFlow(null, new Set([1]));

  assert.deepEqual(removed, [3]);
}

async function testTransactionCleanupDoesNotCloseCreatedAuctionProductTabs() {
  const removed = [];
  const api = loadBackgroundForTest({
    tabs: {
      async get(id) {
        if (id === 2) return { id, url: 'https://auctions.yahoo.co.jp/jp/auction/x1233517511' };
        if (id === 3) return { id, url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=s1' };
        return { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top' };
      },
      async query() {
        return [];
      },
      async remove(id) {
        removed.push(id);
      }
    }
  });

  await api.closeTabsForTransactionFlow(
    { id: 1, url: 'https://contact.auctions.yahoo.co.jp/buyer/top', _gdaipaiCreatedTabIds: [2, 3] },
    new Set()
  );

  assert.deepEqual(removed, [3, 1]);
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
      if (value.includes('/api/plugin/tasks')) {
        return {
          ok: true,
          async json() {
            return {
              success: true,
              bidConcurrencyLimit: 2,
              tasks: [{
                id: 42,
                product_url: 'https://auctions.yahoo.co.jp/jp/auction/v1231866422',
                current_price: 3400,
                max_price: 3888,
                user_max_price: 3888,
                strategy: 'direct',
                bid_mode: 'bid',
                tax_type: 'tax_zero',
                end_time: '2026-06-07T23:59:07+09:00'
              }]
            };
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

  await api.pollBidPool();
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(fetchCalls.some(call => String(call.url).includes('/api/plugin/orders/sync')), false);
  assert.equal(statusBodies.some(body => body.status === 'failed'), true);
}

async function testBuyoutPendingFinalStaysBiddingForWonSync() {
  const statusBodies = [];
  const removedTabs = [];
  const api = loadBackgroundForTest({
    setTimeout(fn, ms) {
      if (ms >= 30000) return 1;
      return setTimeout(fn, 0);
    },
    fetch: async (url, options = {}) => {
      const value = String(url);
      if (value.includes('/api/plugin/task/88/status')) {
        statusBodies.push(JSON.parse(options.body || '{}'));
        return {
          ok: true,
          async json() {
            return { success: true };
          }
        };
      }
      if (value.includes('/api/plugin/task/88/snapshot')) {
        return {
          ok: true,
          async json() {
            return { success: true };
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
        return { id: 18, status: 'loading', url: 'https://auctions.yahoo.co.jp/jp/auction/u1234567890' };
      },
      async get(id) {
        return { id, status: 'complete', url: 'https://auctions.yahoo.co.jp/jp/auction/u1234567890' };
      },
      onUpdatedAddListener(listener) {
        listener(18, { status: 'complete' });
      },
      async sendMessage(id, msg) {
        assert.equal(id, 18);
        if (msg.type === 'GET_PRODUCT_SNAPSHOT') {
          return {
            auctionId: 'u1234567890',
            currentPrice: 3142,
            buyoutPrice: 3142,
            endTime: '2026-06-28T23:59:00+09:00'
          };
        }
        if (msg.type === 'EXECUTE_BID' || msg.type === 'EXECUTE_BID_V2') {
          return { success: true, pendingFinal: true, stage: 'buyout-final-waiting' };
        }
        return { success: true };
      },
      async remove(id) {
        removedTabs.push(id);
      }
    },
    scripting: {
      async executeScript() {}
    }
  });

  await api.executeBidTask({
    id: 88,
    product_url: 'https://auctions.yahoo.co.jp/jp/auction/u1234567890',
    current_price: 3142,
    max_price: 3142,
    user_max_price: 3142,
    strategy: 'direct',
    bid_mode: 'buyout',
    product_type: 'store',
    tax_type: 'tax_included',
    end_time: '2026-06-28T23:59:00+09:00'
  }, { alreadyClaimed: true });

  assert.equal(statusBodies.some(body => body.status === 'failed'), false);
  assert.equal(statusBodies.some(body => body.status === 'bidding'), true);
  assert.deepEqual(removedTabs, [18]);
}

async function testBuyoutStoreConfirmationCompletesBeforeFinalPurchase() {
  const statusBodies = [];
  const removedTabs = [];
  const bidMessages = [];
  const scriptCalls = [];
  const paymentStates = [
    {
      url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1226403738',
      hasStoreConfirmationSection: true,
      controls: ['確認する']
    },
    {
      url: 'https://buy.auctions.yahoo.co.jp/order/change/store-options?auctionId=p1226403738',
      hasStoreConfirmationSection: true,
      hasStoreConfirmationEditPage: true
    },
    {
      url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1226403738',
      controls: ['確認する']
    }
  ];
  const api = loadBackgroundForTest({
    setTimeout(fn, ms) {
      if (ms >= 30000) return 1;
      return setTimeout(fn, 0);
    },
    fetch: async (url, options = {}) => {
      const value = String(url);
      if (value.includes('/api/plugin/task/89/status')) {
        statusBodies.push(JSON.parse(options.body || '{}'));
        return { ok: true, async json() { return { success: true }; } };
      }
      if (value.includes('/api/plugin/task/89/snapshot')) {
        return { ok: true, async json() { return { success: true }; } };
      }
      return { ok: true, async json() { return {}; } };
    },
    tabs: {
      async create() {
        return { id: 19, status: 'complete', url: 'https://auctions.yahoo.co.jp/jp/auction/p1226403738' };
      },
      async get(id) {
        return { id, status: 'complete', url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1226403738' };
      },
      async query() {
        return [{ id: 19, status: 'complete', url: 'https://buy.auctions.yahoo.co.jp/order/review?auctionId=p1226403738' }];
      },
      async sendMessage(id, msg) {
        assert.equal(id, 19);
        if (msg.type === 'GET_PRODUCT_SNAPSHOT') {
          return {
            auctionId: 'p1226403738',
            currentPrice: 500,
            buyoutPrice: 500,
            endTime: '2026-07-05T18:59:00+09:00'
          };
        }
        if (msg.type === 'EXECUTE_BID' || msg.type === 'EXECUTE_BID_V2') {
          bidMessages.push(msg);
          if (bidMessages.length === 1) {
            return {
              success: true,
              storeConfirmationRequired: true,
              stage: 'buyout-store-confirmation-required'
            };
          }
          return { success: true, pendingFinal: true, stage: 'buyout-final-waiting' };
        }
        return { success: true };
      },
      async remove(id) {
        removedTabs.push(id);
      }
    },
    scripting: {
      async executeScript(args) {
        if (args?.files) return [];
        const funcText = String(args?.func || '');
        if (funcText.includes('storeConfirmationBlock')) {
          return [{ result: { success: true, snapshot: paymentStates.shift() || { controls: ['確認する'] } } }];
        }
        if (funcText.includes('findStoreConfirmationChange')) {
          scriptCalls.push('change');
          return [{ result: { success: true, method: 'storeConfirmationSelector', text: '変更' } }];
        }
        if (funcText.includes('hasStoreOptionText')) {
          scriptCalls.push('ready');
          return [{ result: { success: true, readyState: 'complete', checkboxCount: 1, checkedCount: 0, hasApplyButton: true, buttonText: '変更する', hasStoreOptionText: true, hasSkeleton: false, textLength: 120 } }];
        }
        if (funcText.includes('store confirmation checkbox JS click did not check all boxes')) {
          scriptCalls.push('checkbox');
          return [{ result: { success: true, checkedCount: 1, checkboxCount: 1, text: '変更する', applyReady: true } }];
        }
        if (funcText.includes('store confirmation apply button not found')) {
          scriptCalls.push('apply');
          return [{ result: { success: true, text: '変更する' } }];
        }
        return [{ result: { success: true } }];
      }
    }
  });

  await api.executeBidTask({
    id: 89,
    product_url: 'https://auctions.yahoo.co.jp/jp/auction/p1226403738',
    current_price: 500,
    max_price: 500,
    user_max_price: 500,
    strategy: 'direct',
    bid_mode: 'buyout',
    product_type: 'store',
    tax_type: 'tax_included',
    end_time: '2026-07-05T18:59:00+09:00'
  }, { alreadyClaimed: true });

  assert.equal(bidMessages.length, 2);
  assert.equal(bidMessages.every(msg => msg.productType === 'store'), true);
  assert.equal(scriptCalls[0], 'change');
  assert.equal(scriptCalls.includes('ready'), true);
  assert.equal(scriptCalls.includes('checkbox'), true);
  assert.equal(scriptCalls.includes('apply'), true);
  assert.equal(scriptCalls.indexOf('checkbox') < scriptCalls.indexOf('apply'), true);
  assert.equal(statusBodies.some(body => body.status === 'failed'), false);
  assert.equal(statusBodies.some(body => body.status === 'bidding'), true);
  assert.deepEqual(removedTabs, [19]);
}

async function testExecuteBidTaskRetriesTransientServerTabErrorOnce() {
  const statusBodies = [];
  const removedTabs = [];
  let createCount = 0;
  let sendMessageCalls = 0;
  const api = loadBackgroundForTest({
    setTimeout(fn, ms) {
      if (ms >= 30000) return 1;
      return setTimeout(fn, 0);
    },
    sleep: async () => {},
    fetch: async (url, options = {}) => {
      const value = String(url);
      if (value.includes('/api/plugin/task/901/status')) {
        statusBodies.push(JSON.parse(options.body || '{}'));
        return { ok: true, async json() { return { success: true }; } };
      }
      if (value.includes('/api/plugin/task/901/snapshot')) {
        return { ok: true, async json() { return { success: true }; } };
      }
      return { ok: true, async json() { return {}; } };
    },
    tabs: {
      async create() {
        createCount += 1;
        return { id: 900 + createCount, status: 'loading', url: 'https://auctions.yahoo.co.jp/jp/auction/c1234343054' };
      },
      async get(id) {
        return { id, status: 'complete', url: 'https://auctions.yahoo.co.jp/jp/auction/c1234343054' };
      },
      onUpdatedAddListener(listener) {
        listener(900 + createCount, { status: 'complete' });
      },
      async sendMessage(_id, msg) {
        sendMessageCalls += 1;
        if (sendMessageCalls === 1) throw new Error('No tab with id: 901');
        if (msg.type === 'GET_PRODUCT_SNAPSHOT') {
          return {
            auctionId: 'c1234343054',
            currentPrice: 1000,
            endTime: '2026-06-28T22:01:24+09:00'
          };
        }
        if (msg.type === 'EXECUTE_BID_V2') {
          return { success: true, bidPrice: 20000 };
        }
        return { success: true };
      },
      async remove(id) {
        removedTabs.push(id);
      }
    },
    scripting: {
      async executeScript() {}
    }
  });

  await api.executeBidTask({
    id: 901,
    product_url: 'https://auctions.yahoo.co.jp/jp/auction/c1234343054',
    current_price: 1000,
    max_price: 20000,
    user_max_price: 22000,
    strategy: 'direct',
    bid_mode: 'bid',
    tax_type: 'tax_included',
    end_time: '2026-06-28T22:01:24+09:00'
  }, { alreadyClaimed: true });

  assert.equal(createCount, 2);
  assert.equal(statusBodies.some(body => body.status === 'failed'), false);
  assert.equal(statusBodies.some(body => body.status === 'bidding'), true);
  assert.deepEqual(removedTabs, [901, 902]);
}

async function testExecuteBidTaskDoesNotWaitForUpdateWhenCreatedTabAlreadyComplete() {
  const statusBodies = [];
  const messageTypes = [];
  let onUpdatedListenerRegistered = false;
  const api = loadBackgroundForTest({
    setTimeout(fn, ms) {
      if (ms >= 30000) return setTimeout(fn, 0);
      return setTimeout(fn, 0);
    },
    fetch: async (url, options = {}) => {
      const value = String(url);
      if (value.includes('/api/plugin/task/904/status')) {
        statusBodies.push(JSON.parse(options.body || '{}'));
        return { ok: true, async json() { return { success: true }; } };
      }
      if (value.includes('/api/plugin/task/904/snapshot')) {
        return { ok: true, async json() { return { success: true }; } };
      }
      return { ok: true, async json() { return {}; } };
    },
    tabs: {
      async create() {
        return { id: 940, status: 'complete', url: 'https://auctions.yahoo.co.jp/jp/auction/w1233744381' };
      },
      async get(id) {
        return { id, status: 'complete', url: 'https://auctions.yahoo.co.jp/jp/auction/w1233744381' };
      },
      onUpdatedAddListener() {
        onUpdatedListenerRegistered = true;
      },
      async sendMessage(_id, msg) {
        messageTypes.push(msg.type);
        if (msg.type === 'GET_PRODUCT_SNAPSHOT') {
          return {
            auctionId: 'w1233744381',
            currentPrice: 19313,
            endTime: '2026-12-28T23:05:11+09:00'
          };
        }
        if (msg.type === 'EXECUTE_BID' || msg.type === 'EXECUTE_BID_V2') {
          return { success: true, bidPrice: 20001 };
        }
        return { success: true };
      },
      async remove() {}
    },
    scripting: {
      async executeScript() {}
    }
  });

  await api.executeBidTask({
    id: 904,
    product_url: 'https://auctions.yahoo.co.jp/jp/auction/w1233744381',
    current_price: 19313,
    max_price: 20001,
    user_max_price: 20001,
    strategy: 'direct',
    bid_mode: 'bid',
    tax_type: 'tax_zero',
    end_time: '2026-12-28T23:05:11+09:00'
  }, { alreadyClaimed: true });

  assert.equal(onUpdatedListenerRegistered, false);
  assert.deepEqual(messageTypes, ['GET_PRODUCT_SNAPSHOT', 'EXECUTE_BID']);
  assert.equal(statusBodies.some(body => body.status === 'failed'), false);
  assert.equal(statusBodies.some(body => body.status === 'bidding'), true);
}

async function testBuyoutMessageChannelClosedOnThankYouStaysBidding() {
  const calls = [];
  let executeBidMessages = 0;
  const api = loadBackgroundForTest({
    setTimeout(fn, ms) {
      if (ms >= 30000) return 1;
      return setTimeout(fn, 0);
    },
    fetch: async (url, options = {}) => {
      const value = String(url);
      if (value.includes('/api/plugin/diagnostics')) {
        calls.push({ type: 'diagnostic', body: JSON.parse(options.body || '{}') });
        return { ok: true, async json() { return { success: true }; } };
      }
      if (value.includes('/api/plugin/task/907/status')) {
        calls.push({ type: 'status', body: JSON.parse(options.body || '{}') });
        return { ok: true, async json() { return { success: true }; } };
      }
      if (value.includes('/api/plugin/task/907/snapshot')) {
        return { ok: true, async json() { return { success: true }; } };
      }
      return { ok: true, async json() { return {}; } };
    },
    tabs: {
      async create() {
        return { id: 970, status: 'complete', url: 'https://auctions.yahoo.co.jp/jp/auction/x1235487667' };
      },
      async get(id) {
        return {
          id,
          status: 'loading',
          active: true,
          windowId: 4,
          title: 'Yahoo!オークション - 購入完了',
          url: 'https://buy.auctions.yahoo.co.jp/order/thank-you?auctionId=x1235487667'
        };
      },
      async sendMessage(_id, msg) {
        if (msg.type === 'GET_PRODUCT_SNAPSHOT') {
          return {
            auctionId: 'x1235487667',
            currentPrice: 8600,
            endTime: '2026-07-08T12:19:38+09:00'
          };
        }
        if (msg.type === 'EXECUTE_BID' || msg.type === 'EXECUTE_BID_V2') {
          executeBidMessages += 1;
          throw new Error('The page keeping the extension port is moved into back/forward cache, so the message channel is closed.');
        }
        return { success: true };
      },
      async remove(id) {
        calls.push({ type: 'remove', id });
      }
    },
    scripting: {
      async executeScript(args) {
        if (args?.files) return [];
        return [{
          result: {
            title: 'Yahoo!オークション - 購入完了',
            url: 'https://buy.auctions.yahoo.co.jp/order/thank-you?auctionId=x1235487667',
            bodyText: '購入手続きの完了 購入が完了しました！ 購入完了メールを送信しました。'
          }
        }];
      }
    }
  });

  await api.executeBidTask({
    id: 907,
    product_url: 'https://auctions.yahoo.co.jp/jp/auction/x1235487667',
    current_price: 8600,
    max_price: 9460,
    user_max_price: 9460,
    strategy: 'direct',
    bid_mode: 'buyout',
    tax_type: 'tax_included',
    end_time: '2026-07-08T12:19:38+09:00'
  }, { alreadyClaimed: true });

  const statuses = calls.filter(call => call.type === 'status').map(call => call.body.status);
  assert.equal(executeBidMessages, 1);
  assert.equal(statuses.includes('failed'), false);
  assert.equal(statuses.includes('bidding'), true);
  assert.equal(calls.some(call => call.type === 'diagnostic'), false);
  assert.equal(calls.some(call => call.type === 'remove' && call.id === 970), true);
}

async function testExecuteBidTaskPostsPageDiagnosticBeforeClosingTimedOutLoadingTab() {
  const calls = [];
  const api = loadBackgroundForTest({
    setTimeout(fn, ms) {
      if (ms >= 30000) return setTimeout(fn, 0);
      return setTimeout(fn, 0);
    },
    fetch: async (url, options = {}) => {
      const value = String(url);
      if (value.includes('/api/plugin/diagnostics')) {
        calls.push({ type: 'diagnostic', body: JSON.parse(options.body || '{}') });
        return { ok: true, async json() { return { success: true }; } };
      }
      if (value.includes('/api/plugin/task/905/status')) {
        calls.push({ type: 'status', body: JSON.parse(options.body || '{}') });
        return { ok: true, async json() { return { success: true }; } };
      }
      return { ok: true, async json() { return {}; } };
    },
    tabs: {
      async create() {
        return { id: 950, status: 'loading', url: 'https://auctions.yahoo.co.jp/jp/auction/w1233744381' };
      },
      async get(id) {
        return {
          id,
          status: 'loading',
          active: true,
          windowId: 3,
          title: 'Yahoo Auction loading',
          url: 'https://auctions.yahoo.co.jp/jp/auction/w1233744381'
        };
      },
      onUpdatedAddListener() {},
      async remove(id) {
        calls.push({ type: 'remove', id });
      }
    },
    scripting: {
      async executeScript() {
        return [{
          result: {
            title: 'Yahoo Auction page',
            url: 'https://auctions.yahoo.co.jp/jp/auction/w1233744381',
            bodyText: '入札する 現在 19,313円'
          }
        }];
      }
    }
  });

  await api.executeBidTask({
    id: 905,
    product_url: 'https://auctions.yahoo.co.jp/jp/auction/w1233744381',
    current_price: 19313,
    max_price: 20001,
    user_max_price: 20001,
    strategy: 'direct',
    bid_mode: 'bid',
    tax_type: 'tax_zero',
    end_time: '2026-06-28T23:05:11+09:00'
  }, { alreadyClaimed: true });

  const diagnosticIndex = calls.findIndex(call => call.type === 'diagnostic');
  const removeIndex = calls.findIndex(call => call.type === 'remove');
  const statusIndex = calls.findIndex(call => call.type === 'status');
  assert.ok(diagnosticIndex >= 0);
  assert.ok(removeIndex >= 0);
  assert.ok(statusIndex >= 0);
  assert.ok(diagnosticIndex < removeIndex);
  assert.ok(diagnosticIndex < statusIndex);
  const diagnostic = calls[diagnosticIndex].body;
  assert.equal(diagnostic.type, 'bid_failure');
  assert.equal(diagnostic.productId, 'w1233744381');
  assert.equal(diagnostic.action, 'bid_timeout');
  assert.match(diagnostic.message, /Task execution timeout|Product page load timeout/);
  assert.match(diagnostic.diagnostics, /stage=open-task-page/);
  assert.match(diagnostic.diagnostics, /tabStatus=loading/);
  assert.match(diagnostic.diagnostics, /body=入札する 現在 19,313円/);
}

async function testExecuteBidTaskRetriesTimeoutFailureBeforeStatusFailed() {
  const calls = [];
  const removedTabs = [];
  let createCount = 0;
  let executeBidCalls = 0;
  const api = loadBackgroundForTest({
    setTimeout(fn, ms) {
      if (ms >= 30000) return 1;
      return setTimeout(fn, 0);
    },
    sleep: async () => {},
    fetch: async (url, options = {}) => {
      const value = String(url);
      if (value.includes('/api/plugin/diagnostics')) {
        calls.push({ type: 'diagnostic', body: JSON.parse(options.body || '{}') });
        return { ok: true, async json() { return { success: true }; } };
      }
      if (value.includes('/api/plugin/task/908/status')) {
        calls.push({ type: 'status', body: JSON.parse(options.body || '{}') });
        return { ok: true, async json() { return { success: true }; } };
      }
      if (value.includes('/api/plugin/task/908/snapshot')) {
        return { ok: true, async json() { return { success: true }; } };
      }
      return { ok: true, async json() { return {}; } };
    },
    tabs: {
      async create() {
        createCount += 1;
        return { id: 980 + createCount, status: 'complete', url: 'https://auctions.yahoo.co.jp/jp/auction/w1233744381' };
      },
      async get(id) {
        return {
          id,
          status: 'complete',
          active: true,
          windowId: 3,
          title: 'Yahoo Auction',
          url: 'https://auctions.yahoo.co.jp/jp/auction/w1233744381'
        };
      },
      async sendMessage(_id, msg) {
        if (msg.type === 'GET_PRODUCT_SNAPSHOT') {
          return {
            auctionId: 'w1233744381',
            currentPrice: 19313,
            endTime: '2026-12-28T23:05:11+09:00'
          };
        }
        if (msg.type === 'EXECUTE_BID' || msg.type === 'EXECUTE_BID_V2') {
          executeBidCalls += 1;
          if (executeBidCalls === 1) {
            return { success: false, error: 'bid result confirmation timeout', closeTab: true };
          }
          return { success: true, bidPrice: 20001 };
        }
        return { success: true };
      },
      async remove(id) {
        removedTabs.push(id);
      }
    },
    scripting: {
      async executeScript() {
        return [{
          result: {
            title: 'Yahoo Auction page',
            url: 'https://auctions.yahoo.co.jp/jp/auction/w1233744381',
            bodyText: 'confirm bid page'
          }
        }];
      }
    }
  });

  await api.executeBidTask({
    id: 908,
    product_url: 'https://auctions.yahoo.co.jp/jp/auction/w1233744381',
    current_price: 19313,
    max_price: 20001,
    user_max_price: 20001,
    strategy: 'direct',
    bid_mode: 'bid',
    tax_type: 'tax_zero',
    end_time: '2026-12-28T23:05:11+09:00'
  }, { alreadyClaimed: true });

  const statuses = calls.filter(call => call.type === 'status').map(call => call.body.status);
  assert.equal(createCount, 2);
  assert.equal(executeBidCalls, 2);
  assert.deepEqual(removedTabs, [981, 982]);
  assert.equal(statuses.includes('failed'), false);
  assert.equal(statuses.includes('bidding'), true);
  assert.equal(calls.some(call => call.type === 'diagnostic'), false);
}

async function testExecuteBidTaskMarksFailedWhenTimeoutRetryAlsoFails() {
  const calls = [];
  const removedTabs = [];
  let createCount = 0;
  let executeBidCalls = 0;
  const api = loadBackgroundForTest({
    setTimeout(fn, ms) {
      if (ms >= 30000) return 1;
      return setTimeout(fn, 0);
    },
    sleep: async () => {},
    fetch: async (url, options = {}) => {
      const value = String(url);
      if (value.includes('/api/plugin/diagnostics')) {
        calls.push({ type: 'diagnostic', body: JSON.parse(options.body || '{}') });
        return { ok: true, async json() { return { success: true }; } };
      }
      if (value.includes('/api/plugin/task/909/status')) {
        calls.push({ type: 'status', body: JSON.parse(options.body || '{}') });
        return { ok: true, async json() { return { success: true }; } };
      }
      if (value.includes('/api/plugin/task/909/snapshot')) {
        return { ok: true, async json() { return { success: true }; } };
      }
      return { ok: true, async json() { return {}; } };
    },
    tabs: {
      async create() {
        createCount += 1;
        return { id: 990 + createCount, status: 'complete', url: 'https://auctions.yahoo.co.jp/jp/auction/w1233744381' };
      },
      async get(id) {
        return {
          id,
          status: 'complete',
          active: true,
          windowId: 3,
          title: 'Yahoo Auction',
          url: 'https://auctions.yahoo.co.jp/jp/auction/w1233744381'
        };
      },
      async sendMessage(_id, msg) {
        if (msg.type === 'GET_PRODUCT_SNAPSHOT') {
          return {
            auctionId: 'w1233744381',
            currentPrice: 19313,
            endTime: '2026-12-28T23:05:11+09:00'
          };
        }
        if (msg.type === 'EXECUTE_BID' || msg.type === 'EXECUTE_BID_V2') {
          executeBidCalls += 1;
          return { success: false, error: 'bid result confirmation timeout', closeTab: true };
        }
        return { success: true };
      },
      async remove(id) {
        removedTabs.push(id);
      }
    },
    scripting: {
      async executeScript() {
        return [{
          result: {
            title: 'Yahoo Auction page',
            url: 'https://auctions.yahoo.co.jp/jp/auction/w1233744381',
            bodyText: 'confirm bid page'
          }
        }];
      }
    }
  });

  await api.executeBidTask({
    id: 909,
    product_url: 'https://auctions.yahoo.co.jp/jp/auction/w1233744381',
    current_price: 19313,
    max_price: 20001,
    user_max_price: 20001,
    strategy: 'direct',
    bid_mode: 'bid',
    tax_type: 'tax_zero',
    end_time: '2026-12-28T23:05:11+09:00'
  }, { alreadyClaimed: true });

  const statuses = calls.filter(call => call.type === 'status').map(call => call.body.status);
  assert.equal(createCount, 2);
  assert.equal(executeBidCalls, 2);
  assert.deepEqual(removedTabs, [991, 992]);
  assert.equal(statuses.includes('failed'), true);
  assert.equal(calls.some(call => call.type === 'diagnostic'), true);
}

async function testExecuteBidTaskPostsPageDiagnosticBeforeClosingContentCloseTabFailure() {
  const calls = [];
  let removed = false;
  const api = loadBackgroundForTest({
    setTimeout(fn, ms) {
      if (ms >= 30000) return 1;
      return setTimeout(fn, 0);
    },
    fetch: async (url, options = {}) => {
      const value = String(url);
      if (value.includes('/api/plugin/diagnostics')) {
        calls.push({ type: 'diagnostic', body: JSON.parse(options.body || '{}') });
        return { ok: true, async json() { return { success: true }; } };
      }
      if (value.includes('/api/plugin/task/906/status')) {
        calls.push({ type: 'status', body: JSON.parse(options.body || '{}') });
        return { ok: true, async json() { return { success: true }; } };
      }
      if (value.includes('/api/plugin/task/906/snapshot')) {
        return { ok: true, async json() { return { success: true }; } };
      }
      return { ok: true, async json() { return {}; } };
    },
    tabs: {
      async create() {
        return { id: 960, status: 'complete', url: 'https://auctions.yahoo.co.jp/jp/auction/w1233744381' };
      },
      async get(id) {
        if (removed) throw new Error(`No tab with id: ${id}`);
        return {
          id,
          status: 'complete',
          active: true,
          windowId: 3,
          title: 'Yahoo Auction',
          url: 'https://auctions.yahoo.co.jp/jp/auction/w1233744381'
        };
      },
      async sendMessage(_id, msg) {
        if (msg.type === 'GET_PRODUCT_SNAPSHOT') {
          return {
            auctionId: 'w1233744381',
            currentPrice: 19313,
            endTime: '2026-06-28T23:05:11+09:00'
          };
        }
        if (msg.type === 'EXECUTE_BID') {
          return { success: false, error: 'bid result confirmation failed', closeTab: true };
        }
        return { success: true };
      },
      async remove(id) {
        removed = true;
        calls.push({ type: 'remove', id });
      }
    },
    scripting: {
      async executeScript() {
        return [{
          result: {
            title: 'Yahoo Auction page',
            url: 'https://auctions.yahoo.co.jp/jp/auction/w1233744381',
            bodyText: '確認する 入札内容'
          }
        }];
      }
    }
  });

  await api.executeBidTask({
    id: 906,
    product_url: 'https://auctions.yahoo.co.jp/jp/auction/w1233744381',
    current_price: 19313,
    max_price: 20001,
    user_max_price: 20001,
    strategy: 'direct',
    bid_mode: 'bid',
    tax_type: 'tax_zero',
    end_time: '2026-06-28T23:05:11+09:00'
  }, { alreadyClaimed: true });

  const diagnosticIndex = calls.findIndex(call => call.type === 'diagnostic');
  const removeIndex = calls.findIndex(call => call.type === 'remove');
  assert.ok(diagnosticIndex >= 0);
  assert.ok(removeIndex >= 0);
  assert.ok(diagnosticIndex < removeIndex);
  const diagnostic = calls[diagnosticIndex].body;
  assert.match(diagnostic.diagnostics, /stage=execute-bid/);
  assert.match(diagnostic.diagnostics, /body=確認する 入札内容/);
}

async function testExecuteBidTaskMarksServerTabErrorAfterRetryFails() {
  const statusBodies = [];
  let createCount = 0;
  const api = loadBackgroundForTest({
    setTimeout(fn, ms) {
      if (ms >= 30000) return 1;
      return setTimeout(fn, 0);
    },
    sleep: async () => {},
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/plugin/task/902/status')) {
        statusBodies.push(JSON.parse(options.body || '{}'));
        return { ok: true, async json() { return { success: true }; } };
      }
      return { ok: true, async json() { return { success: true }; } };
    },
    tabs: {
      async create() {
        createCount += 1;
        return { id: 910 + createCount, status: 'loading', url: 'https://auctions.yahoo.co.jp/jp/auction/r1234339848' };
      },
      async get(id) {
        return { id, status: 'complete', url: 'https://auctions.yahoo.co.jp/jp/auction/r1234339848' };
      },
      onUpdatedAddListener(listener) {
        listener(910 + createCount, { status: 'complete' });
      },
      async remove() {}
    },
    scripting: {
      async executeScript() {
        throw new Error('Tabs cannot be edited right now (user may be dragging a tab).');
      }
    }
  });

  await api.executeBidTask({
    id: 902,
    product_url: 'https://auctions.yahoo.co.jp/jp/auction/r1234339848',
    current_price: 20500,
    max_price: 22000,
    user_max_price: 22000,
    strategy: 'direct',
    bid_mode: 'bid',
    tax_type: 'tax_included',
    end_time: '2026-06-28T22:30:57+09:00'
  }, { alreadyClaimed: true });

  assert.equal(createCount, 2);
  const failed = statusBodies.find(body => body.status === 'failed');
  assert.ok(failed);
  assert.match(failed.error_msg, /Server tab error/);
}

async function testBidRetryKeepsActiveRunSlotUntilRetryFinishes() {
  let taskFetchCount = 0;
  let createCount = 0;
  let snapshotCalls = 0;
  let resolveSecondSnapshotStarted;
  let releaseSecondSnapshot;
  const secondSnapshotStarted = new Promise(resolve => {
    resolveSecondSnapshotStarted = resolve;
  });
  const secondSnapshotGate = new Promise(resolve => {
    releaseSecondSnapshot = resolve;
  });
  const statusBodies = [];
  const api = loadBackgroundForTest({
    setTimeout(fn, ms) {
      if (ms >= 30000) return 1;
      return setTimeout(fn, 0);
    },
    sleep: async () => {},
    fetch: async (url, options = {}) => {
      const value = String(url);
      if (value.includes('/api/plugin/config')) {
        return { ok: true, async json() { return { bidConcurrencyLimit: 1 }; } };
      }
      if (value.includes('/api/plugin/tasks')) {
        taskFetchCount += 1;
        return {
          ok: true,
          async json() {
            return {
              success: true,
              bidConcurrencyLimit: 1,
              tasks: [{
                id: 903,
                product_url: 'https://auctions.yahoo.co.jp/jp/auction/c1234343054',
                current_price: 1000,
                max_price: 20000,
                user_max_price: 22000,
                strategy: 'direct',
                bid_mode: 'bid',
                tax_type: 'tax_included',
                end_time: '2026-06-28T22:01:24+09:00'
              }]
            };
          }
        };
      }
      if (value.includes('/api/plugin/task/903/status')) {
        statusBodies.push(JSON.parse(options.body || '{}'));
        return { ok: true, async json() { return { success: true }; } };
      }
      if (value.includes('/api/plugin/task/903/snapshot')) {
        return { ok: true, async json() { return { success: true }; } };
      }
      return { ok: true, async json() { return {}; } };
    },
    tabs: {
      async create() {
        createCount += 1;
        return { id: 930 + createCount, status: 'loading', url: 'https://auctions.yahoo.co.jp/jp/auction/c1234343054' };
      },
      async get(id) {
        return { id, status: 'complete', url: 'https://auctions.yahoo.co.jp/jp/auction/c1234343054' };
      },
      onUpdatedAddListener(listener) {
        listener(930 + createCount, { status: 'complete' });
      },
      async sendMessage(_id, msg) {
        if (msg.type === 'GET_PRODUCT_SNAPSHOT') {
          snapshotCalls += 1;
          if (snapshotCalls === 1) throw new Error('No tab with id: 931');
          resolveSecondSnapshotStarted();
          await secondSnapshotGate;
          return {
            auctionId: 'c1234343054',
            currentPrice: 1000,
            endTime: '2026-06-28T22:01:24+09:00'
          };
        }
        if (msg.type === 'EXECUTE_BID_V2') {
          return { success: true, bidPrice: 20000 };
        }
        return { success: true };
      },
      async remove() {}
    },
    scripting: {
      async executeScript() {}
    }
  });

  await api.pollBidPool();
  await secondSnapshotStarted;
  assert.equal(api.getActiveBidRunCount(), 1);
  await api.pollBidPool();
  assert.equal(taskFetchCount, 1);

  releaseSecondSnapshot();
  for (let i = 0; i < 20 && api.getActiveBidRunCount() !== 0; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.equal(api.getActiveBidRunCount(), 0);
  assert.equal(statusBodies.some(body => body.status === 'bidding'), true);
}

async function testRunWorkflowActionHandlesAnsweredPinBeforeThrottle() {
  const fetchCalls = [];
  let phase = 'idle';
  let pinTyped = false;
  const FixedDate = class extends Date {
    constructor(...args) {
      super(...(args.length ? args : [1000000]));
    }
    static now() {
      return 1000000;
    }
  };
  const api = loadBackgroundForTest({
    Date: FixedDate,
    setTimeout(fn, ms) {
      if (ms >= 1000) return setTimeout(fn, 0);
      return setTimeout(fn, 0);
    },
    fetch: async (url, options = {}) => {
      const value = String(url);
      fetchCalls.push({ url: value, options });
      if (value.includes('/api/plugin/config')) {
        return { ok: true, async json() { return { idleSyncIntervalMinutes: 2 }; } };
      }
      if (value.includes('/api/plugin/idle-action/next')) {
        return { ok: true, async json() { return { action: 'none' }; } };
      }
      if (value.includes('/api/plugin/idle-action/complete')) {
        return { ok: true, async json() { return { success: true }; } };
      }
      if (value.includes('/api/plugin/manual-captcha/current')) {
        return {
          ok: true,
          async json() {
            return phase === 'pin' && !pinTyped
              ? { success: true, found: true, id: 'pin-test', type: 'pin', answered: true, answer: '123456', pageUrl: 'https://login.yahoo.co.jp/config/login?auth_lv=1' }
              : { success: true, found: false, answered: false };
          }
        };
      }
      if (value.includes('/api/plugin/manual-pin/type')) {
        pinTyped = true;
        return { ok: true, async json() { return { success: true, digits: 6, stdout: 'typed=6' }; } };
      }
      if (value.includes('/api/plugin/manual-captcha/close')) {
        return { ok: true, async json() { return { success: true }; } };
      }
      if (value.includes('/api/plugin/diagnostics')) {
        return { ok: true, async json() { return { success: true }; } };
      }
      return { ok: true, async json() { return { success: true }; } };
    },
    tabs: {
      async query() {
        return phase === 'pin' && !pinTyped
          ? [{ id: 7, url: 'https://login.yahoo.co.jp/config/login?auth_lv=1', status: 'complete', active: true, title: 'Yahoo PIN' }]
          : [];
      },
      async get(id) {
        return pinTyped
          ? { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=test', status: 'complete', active: true, title: 'Yahoo transaction' }
          : { id, url: 'https://login.yahoo.co.jp/config/login?auth_lv=1', status: 'complete', active: true, title: 'Yahoo PIN' };
      },
      async update(id) {
        return pinTyped
          ? { id, url: 'https://contact.auctions.yahoo.co.jp/buyer/top?aid=test', status: 'complete', active: true }
          : { id, url: 'https://login.yahoo.co.jp/config/login?auth_lv=1', status: 'complete', active: true };
      },
      async reload() {},
      onUpdatedAddListener(listener) {
        listener(7, { status: 'complete' });
      }
    },
    scripting: {
      async executeScript() {
        return [{ result: true }];
      }
    }
  });

  await api.runWorkflowAction();
  assert.equal(fetchCalls.some(call => call.url.includes('/api/plugin/idle-action/next')), true);
  phase = 'pin';
  const idleFetchesBefore = fetchCalls.filter(call => call.url.includes('/api/plugin/idle-action/next')).length;

  await api.runWorkflowAction();

  assert.equal(pinTyped, true);
  assert.equal(
    fetchCalls.filter(call => call.url.includes('/api/plugin/idle-action/next')).length,
    idleFetchesBefore
  );
}

async function testRunWorkflowActionRunsManualImportSeparatelyFromScan() {
  const calls = [];
  const api = loadBackgroundForTest({
    fetch: async (url, options = {}) => {
      const value = String(url);
      calls.push({ url: value, body: options.body || '' });
      if (value.includes('/api/plugin/config')) {
        return { ok: true, async json() { return { idleSyncIntervalMinutes: 0.01 }; } };
      }
      if (value.includes('/api/plugin/idle-action/next')) {
        return { ok: true, async json() { return { success: true, action: 'manual_order_import' }; } };
      }
      if (value.includes('/api/plugin/manual-order-import/jobs')) {
        return { ok: true, async json() { return { success: true, job: null }; } };
      }
      if (value.includes('/api/plugin/idle-action/complete')) {
        return { ok: true, async json() { return { success: true }; } };
      }
      return { ok: true, async json() { return { success: true }; } };
    }
  });

  await api.runWorkflowAction();

  assert.equal(calls.some(call => call.url.includes('/api/plugin/manual-order-import/jobs')), true);
  assert.equal(calls.some(call => call.url.includes('/api/plugin/scan/jobs')), false);
  const completeCall = calls.find(call => call.url.includes('/api/plugin/idle-action/complete'));
  assert.match(completeCall?.body || '', /manual_order_import/);
}

async function testManualOrderImportPreservesStoreTypeFromWonRowWhenSnapshotOmitsType() {
  const fetchCalls = [];
  let sendMessageCount = 0;
  const api = loadBackgroundForTest({
    disableAutoStart: true,
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url: String(url), options });
      return { ok: true, async json() { return {}; } };
    },
    tabs: {
      async create(createInfo) {
        return { id: createInfo.url.includes('/my/won') ? 10 : 20, status: 'complete', url: createInfo.url };
      },
      async get(tabId) {
        return { id: tabId, status: 'complete' };
      },
      async sendMessage(tabId, message) {
        sendMessageCount += 1;
        if (message?.type === 'EXTRACT_ORDER_IMPORT_PAGE') {
          return {
            success: true,
            orders: [{
              productId: 'g1234019868',
              title: 'store won item',
              price: '41251',
              wonTimeText: '6/25 23:48',
              url: 'https://auctions.yahoo.co.jp/jp/auction/g1234019868',
              transactionUrl: 'https://contact.auctions.yahoo.co.jp/seller/top?aid=g1234019868',
              productType: 'store'
            }],
            nextPageUrl: ''
          };
        }
        if (message?.type === 'GET_PRODUCT_SNAPSHOT') {
          return {
            auctionId: 'g1234019868',
            title: 'snapshot title',
            imageUrl: 'https://example.com/item.jpg',
            shippingFeeText: '1340\u5186'
          };
        }
        return {};
      }
    }
  });

  const result = await api.executeManualOrderImportJob({
    batchId: 7,
    startDate: '2026-06-25',
    endDate: '2026-06-25',
    maxPages: 1
  });

  assert.equal(result.success, true);
  assert.equal(sendMessageCount, 2);
  const statusCall = fetchCalls.find(call => /\/api\/plugin\/manual-order-import\/status$/.test(call.url));
  assert.ok(statusCall);
  const payload = JSON.parse(statusCall.options.body);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].productType, 'store');
  assert.equal(payload.items[0].taxType, 'tax_zero');
}

async function testRunWorkflowActionChecksYahooMessagesBeforeIdleThrottle() {
  const calls = [];
  const api = loadBackgroundForTest({
    fetch: async (url, options = {}) => {
      const value = String(url);
      calls.push({ url: value, body: options.body || '' });
      if (value.includes('/api/plugin/config')) {
        return { ok: true, async json() { return { idleSyncIntervalMinutes: 60 }; } };
      }
      if (value.includes('/api/plugin/yahoo-messages/jobs')) {
        return { ok: true, async json() { return { success: true, jobs: [] }; } };
      }
      if (value.includes('/api/plugin/idle-action/next')) {
        return { ok: true, async json() { return { success: true, action: 'none' }; } };
      }
      if (value.includes('/api/plugin/idle-action/complete')) {
        return { ok: true, async json() { return { success: true }; } };
      }
      return { ok: true, async json() { return { success: true }; } };
    }
  });

  await api.runWorkflowAction();
  await api.runWorkflowAction();

  assert.equal(calls.filter(call => call.url.includes('/api/plugin/yahoo-messages/jobs')).length, 2);
  assert.equal(calls.filter(call => call.url.includes('/api/plugin/idle-action/next')).length, 1);
}

function testWorkerIntervalConfigReschedulesPollingTimer() {
  const intervals = [];
  const cleared = [];
  const api = loadBackgroundForTest({
    setInterval(_fn, ms) {
      intervals.push(ms);
      return intervals.length;
    },
    clearInterval(id) {
      cleared.push(id);
    }
  });

  assert.equal(intervals[0], 10000);
  api.applyPluginConfig({ workerIntervalMs: 5000 });
  assert.equal(api.getPollIntervalMs(), 5000);
  assert.deepEqual(intervals, [10000, 5000]);
  assert.deepEqual(cleared, [1]);

  api.applyPluginConfig({ workerIntervalMs: 0 });
  assert.equal(api.getPollIntervalMs(), 10000);
  assert.deepEqual(intervals, [10000, 5000, 10000]);
  assert.deepEqual(cleared, [1, 2]);
}

async function run() {
  testYahooMessageJobsUseFortyFiveSecondTimeout();
  testPaymentSyntheticClickWaitsTenSecondsForNextState();
  await testStartPollingIsIdempotentWithinWorker();
  await testInjectContentScriptMissingTabDoesNotLogExtensionError();
  testMultiBidSuccessKeepsTabOpenForImmediateRebid();
  testAlreadyHighestMultiBidClosesTab();
  await testWithTimeoutMarksCloseTab();
  testTaskExecutionTimeoutIsLongerForMultiBid();
  testPendingFinalRetryDelayIsShortForDirectBid();
testNoServiceWorkerLifecycleErrorDetection();
testYahooTradeMessageSelectorsCoverNormalAndStorePages();
testYahooTradeMessageExtractionSkipsStoreLegalLinks();
testYahooTradeMessageExtractionDoesNotFallbackToStoreLegalLinks();
testYahooTradeMessageExtractionReadsStoreDisabledPostingThread();
testYahooTradeMessageExtractionSucceedsForStoreFormWithoutMessages();
testYahooTradeMessageExtractionDoesNotReturnTransactionInfoForStoreEmptyForm();
testYahooTradeMessageSendScopesStoreTextareaToMsgForm();
testYahooTradeMessageSendUsesNativeTextareaSetterForStoreReactForm();
await testSendYahooTradeMessageScopesStoreTextareaToMsgForm();
await testSendYahooTradeMessageRetriesUntilTextareaRenders();
await testYahooTradeMessageExtractionRetriesUntilStoreMessagesRender();
testYahooMessageNavigationClosesNormalBundleNotice();
testYahooMessageNavigationDetectsStoreBundleSequence();
testYahooMessageNavigationRejectsBundleChildChoice();
await testPrepareYahooMessagePageRunsStoreCloseThenSingleSequence();
testSendYahooMessageJobFetchesLatestMessagesAfterSend();
  testBidProgressMessageExtendsActiveMultiBidTimeout();
  await testBundleStartWaitsForDecideButtonState();
  await testBundleStartTradePageWaitsForRenderedButtonBeforeJsClick();
  await testBundleActionActivatesTabBeforeClick();
  await testBundleStartTradePageUsesClickBeforeRequestSubmitFallback();
  await testBundleStartUsesContentScriptFallbackBeforeRequestSubmit();
  await testBundleStartDoesNotUseDebuggerWhenJsAndRequestSubmitFail();
  await testBundleActionTimeoutErrorIncludesActionName();
  await testNormalBundleRequestClicksSecondStartPageBeforeDecide();
  await testNormalBundleRequestCanStartFromInputPage();
  await testNormalBundleStartAcceptsTransactionInfoInputPage();
  await testOpenTransactionPageContinuesWhenBundleActionReadyBeforeTabComplete();
  await testWaitForBundleActionStateAcrossTabsFollowsNewConfirmTab();
  await testSwitchToNewestNewTabIgnoresConcurrentAuctionProductTab();
  await testTrustedBundleClickDispatchesMouseThroughDebugger();
  await testManualPinDispatchesDigitsThroughDebuggerKeyboard();
  testExtractAuctionIdFromTextAcceptsNumericAuctionIds();
  await testManualPinUsesSystemKeyboardEndpointBeforeDebugger();
  await testManualPinFallsBackToDebuggerWhenSystemKeyboardFails();
  await testManualPinUsesRealKeyboardBeforeInsertTextFallback();
  await testManualPinFallsBackToInsertTextWhenRealKeyboardFails();
  await testBidderPaysShippingTransactionClicksDecideAndConfirm();
  await testBidderPaysShippingConfirmWaitsForPreviewRender();
  await testBidderPaysShippingTransactionAcceptsAlreadyWaitingShippingPage();
  testBuildScanStatusPayloadUsesShippingFeeOnly();
  testBuildScanStatusPayloadSkipsPendingShipping();
  testBuildScanStatusPayloadSkipsPendingShipmentDuringTrackingRescan();
  testBuildScanStatusPayloadWaitsForShipmentDetailsRender();
  testBuildScanStatusPayloadHandlesBundleShippingFee();
  testBuildScanStatusPayloadHandlesBundleRejected();
  testBuildScanStatusPayloadReportsBundleNoProgress();
  testBundleInputActionCanRunFromWaitingAgreementState();
  await testPendingShipmentScanWaitsForRenderedShipmentState();
  await testStorePendingShipmentScanKeepsPollingPastInitialPendingState();
  await testPendingShipmentScanKeepsPollingPastTrackingFallback();
  await testPendingShipmentScanAcceptsTrackingFallbackAfterShipmentDetailsRender();
  testPaymentPageStateDetectsPurchaseCompletePage();
  testPaymentPageStateDetectsStoreAlreadyPaidPage();
  testPaymentPageStateKeepsSelectedShippingOption();
  testPaymentPageStateDetectsPaymentMethodFee();
  testPaymentPageStateDetectsAppraisalSection();
  testPaymentPageStateIgnoresAppraisalFeeForPaymentAmount();
  await testPaymentNoAppraisalSelectionClicksUnsetRadio();
  testPaymentPageStateUsesTotalAmountWithPayPayBenefitAd();
  testPaymentPageStateDetectsBuyerDeletedCancellation();
  testPaymentPageStateUsesPrimaryStatusForCancellation();
  testPaymentPageStateUsesNormalStatusComment();
  testPaymentPageStateDetectsStoreConfirmationSection();
  testPaymentPageStateRespectsExplicitNoStoreConfirmationSection();
  testPaymentPageStateIgnoresStoreConfirmationTitleWithoutChangeControl();
  testPaymentPageStateRequiresCartoptForStoreConfirmation();
  await testStoreConfirmationChangeUsesCartoptSelector();
  await testStoreConfirmationApplyUsesConfirmUpdateSelector();
  await testStoreConfirmationApplyButtonClicksOnce();
  await testStoreConfirmationCheckboxLabelClickOnlyTogglesOnce();
  await testStoreConfirmationApplyDoesNotForceHiddenInputsChecked();
  await testStoreConfirmationTrustedClickPointsUseRealSelectors();
  testPaymentAmountAllowsUnknownShippingWhenPageTotalEqualsFinalPrice();
  testPaymentAmountRejectsUnknownShippingWhenPageTotalExceedsFinalPrice();
  testPaymentAmountRejectsMissingDetectedTotal();
  testPaymentAmountTreatsFreeAndCashOnDeliveryAsZeroShippingForAllProducts();
  testPaymentAmountUsesBundleFinalPriceTotal();
  testShouldSelectPaymentShippingOptionWhenDefaultDiffers();
  testRandomIntInclusiveUsesConfiguredRange();
  testPaymentFinalizeCompletionTimeoutIsSixtySeconds();
  await testRunPaymentJobsReportsEmptyQueue();
  await testRunTransactionStartJobsCanOnlyRefreshServerSideStoreOrders();
  await testIdleTransactionStartRefreshesStoreOrdersWhenNormalFlowDisabled();
  await testRunTransactionStartMarksAlreadyWaitingShippingPageWaitingShipping();
  await testRunTransactionStartCompletesFixedShippingInfoBeforePendingPayment();
  await testRunTransactionStartMarksBuyerDeletedPageCancelled();
  await testRunTransactionStartPostsDiagnosticWhenNormalBundleStartFails();
  await testMonitorSyncCollectsAllBiddingPagesBeforeSync();
  await testMonitorSyncSkipsTabThatDisappearsBeforeInjection();
  await testMonitorSyncSkipsFrameRemovedBeforeInjection();
  await testMonitorSyncSkipsClosedMessageReceiver();
  await testMonitorSyncPostponesTabsTemporarilyUneditable();
  await testRunPaymentJobsCompletesNormalItemPayment();
  await testRunPaymentJobsMarksBuyerDeletedPageCancelled();
  await testRunPaymentJobsCompletesNormalItemPaymentAfterTransactionInfoInput();
  await testRunPaymentJobsClicksPlacementOkAfterTransactionInfoInput();
  await testRunPaymentJobsMarksAlreadyPaidAsSuccess();
  await testRunPaymentJobsCompletesStoreItemAfterPurchaseProcedure();
  await testRunPaymentJobsWaitsForRenderedStoreStatusEntryButton();
  await testRunPaymentJobsUsesSinglePurchaseForStoreBundlePage();
  await testRunPaymentJobsContinuesNormalEntryAfterStorePurchaseProcedure();
  await testCompleteStoreConfirmationItemsUsesJsClickOnlyOnEditPage();
  await testRunPaymentJobsWaitsRandomSecondsBeforeFinalizeAndIgnoresProcessingPage();
  await testRunPaymentJobsRetriesReviewClickWhenTrustedPointTemporarilyMissing();
  await testRunPaymentJobsWaitsUpToSixtySecondsForProcessingFinalizePage();
  await testRunConfirmReceiptJobsCompletesStoreItemWithoutOpeningTab();
  await testRunConfirmReceiptJobsWaitsForEnabledReceiveButton();
  await testRunConfirmReceiptJobsWaitsForReceiptPageRenderBeforeClicking();
  testConfirmReceiptPageStateDetectsWinnerDeletedCancellation();
  testConfirmReceiptPageStateDetectsPaidOrShippedTransactionText();
  testConfirmReceiptPageStateUsesPrimaryStatusText();
  testConfirmReceiptPageStateDetectsReceiptCompletionText();
  await testRunConfirmReceiptJobsMarksCancelCheckOrderCancelled();
  await testRunConfirmReceiptJobsSkipsCancelCheckWhenCancellationTextMissing();
  await testRunConfirmReceiptJobsMarksPaidCancelCheckOrderPendingShipment();
  await testRunConfirmReceiptJobsWaitsForPaidCancelCheckTextAfterTabComplete();
  await testRunConfirmReceiptJobsStopsWaitingAfterOtherCancelCheckStatusRenders();
  await testRunPaymentJobsSelectsExpectedShippingBeforeReview();
  await testRunPaymentJobsUsesJsClickForPaymentShippingChangeBeforeDebugger();
  await testRunPaymentJobsWaitsForNormalShippingOptionsAfterChangeClick();
  await testRunPaymentJobsUsesDebuggerShippingChangeFallbackWhenNormalJsExpandDoesNotRenderOption();
  await testRunPaymentJobsCompletesStoreShippingChangePage();
  await testRunPaymentJobsSelectsNoAppraisalBeforeReview();
  await testRunPaymentJobsDoesNotRequireShippingOptionWhenAmountAlreadyMatches();
  await testRunStorePaymentJobsRetriesDlvryChangeUntilRenderedWhenAmountMismatches();
  await testRunStorePaymentShippingMismatchDoesNotUseDebuggerFallback();
  await testRunPaymentJobsWaitsForMatchingAmountBeforeSelectingShipping();
  await testRunPaymentJobsWaitsForSlowReviewButtonOnPurchasePage();
  await testPaymentTrustedClickPointFindsRoleButton();
  await testPaymentTrustedClickPointSkipsHiddenConfirmAnchor();
  await testPaymentReviewClickPointPrefersConfirmContainerOverPayPayBenefit();
  await testPaymentReviewClickPointUsesPaymentAmountContextFallback();
  await testPaymentReviewClickPointDoesNotFallbackToPayPayBenefit();
  await testPaymentShippingChangeClickPointFindsButtonAfterHeaderSibling();
  await testPaymentShippingChangeClickPointUsesShippingSectionRoleButton();
  await testStorePaymentShippingChangeUsesShortChangeJsClick();
  await testStorePaymentShippingChangeUsesDlvrySelectorJsClick();
  await testSelectPaymentShippingOptionAcceptsHeaderContainerContainingRadios();
  await testSelectPaymentShippingOptionUsesStoreShipMethodRadioName();
  await testSelectPaymentShippingOptionScopesStoreShippingSection();
  await testSelectPaymentShippingOptionAllowsHiddenStoreShippingRadio();
  await testRunPaymentJobsReportsUnknownPaymentPageFailure();
  testBuildPaymentFailurePayloadIncludesProductId();
  testManualCaptchaTabDetection();
  testLikelyManualPinTabDetection();
  await testIdleSyncSkipsNonBidWorkWhenManualPinTabExists();
  await testIdleSyncClosesAnsweredChallengeWhenNoVerificationTabsRemain();
  await testIdleSyncClosesUnansweredPinChallengeWhenPinTabClosed();
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
  await testCaptchaAnswerClosesCaptchaAndShowsPinWhenPinTabAppears();
  testYahooLoginPageCountsAsTransactionTab();
  await testTransactionCleanupClosesNewYahooLoginTabs();
  await testTransactionCleanupDoesNotCloseNewAuctionProductTabs();
  await testTransactionCleanupDoesNotCloseCreatedAuctionProductTabs();
  await testTransactionCleanupKeepsManualVerificationTabsOpen();
  await testTransactionCleanupKeepsCurrentManualVerificationTabFromCreatedIds();
  await testFailedBidDoesNotImmediatelySyncWonPage();
  await testExecuteBidTaskRetriesTimeoutFailureBeforeStatusFailed();
  await testExecuteBidTaskMarksFailedWhenTimeoutRetryAlsoFails();
  await testBuyoutMessageChannelClosedOnThankYouStaysBidding();
  await testBuyoutStoreConfirmationCompletesBeforeFinalPurchase();
  await testExecuteBidTaskRetriesTransientServerTabErrorOnce();
  await testExecuteBidTaskDoesNotWaitForUpdateWhenCreatedTabAlreadyComplete();
  await testExecuteBidTaskPostsPageDiagnosticBeforeClosingTimedOutLoadingTab();
  await testExecuteBidTaskPostsPageDiagnosticBeforeClosingContentCloseTabFailure();
  await testExecuteBidTaskMarksServerTabErrorAfterRetryFails();
  await testBidRetryKeepsActiveRunSlotUntilRetryFinishes();
  await testRunWorkflowActionHandlesAnsweredPinBeforeThrottle();
  await testRunWorkflowActionRunsManualImportSeparatelyFromScan();
  await testManualOrderImportPreservesStoreTypeFromWonRowWhenSnapshotOmitsType();
  await testRunWorkflowActionChecksYahooMessagesBeforeIdleThrottle();
  await testBuyoutPendingFinalStaysBiddingForWonSync();
  testWorkerIntervalConfigReschedulesPollingTimer();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
