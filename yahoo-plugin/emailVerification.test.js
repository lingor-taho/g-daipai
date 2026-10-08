const assert = require('assert/strict');
const { loadBackgroundForTest } = require('./background.test');

const emailUrl = 'https://login.yahoo.co.jp/config/login?src=auc&require_auth=1';
const mask = 'do*******@g********';
const emailPage = { email: true, maskedAddress: mask };

function createAttemptFixture(options = {}) {
  let now = new Date(2026, 9, 2, 14, 0, 30).getTime();
  const start = now;
  let yahooUrl = emailUrl;
  let submittedAt = 0;
  let reloads = 0;
  let fills = 0;
  const removed = [];
  const scripts = [];
  class Clock extends Date { static now() { return now; } }
  const api = loadBackgroundForTest({
    disableAutoStart: true, Date: Clock,
    fetch: (...args) => options.fetch ? options.fetch(...args) : Promise.resolve({ async json() { return {}; } }),
    setTimeout(fn, ms) {
      // Advance sleeps only; watchdogs remain pending unless the test explicitly fires them.
      if (!String(fn).includes('reject(')) { now += ms; queueMicrotask(fn); }
      return 1;
    },
    tabs: {
      async create(props) { assert.match(props.url, /^https:\/\/mail.google.com/); return { id: 90 }; },
      async reload(id) { assert.equal(id, 7); reloads += 1; },
      async update(id, props) { return { id, url: id === 7 ? yahooUrl : props.url, status: 'complete' }; },
      async get(id) {
        if (id === 7 && !options.newTabCaptcha && submittedAt && options.transitionAfter !== null && now - submittedAt >= (options.transitionAfter || 0)) {
          yahooUrl = 'https://login.yahoo.co.jp/ncaptcha?fido=1';
        }
        return { id, url: yahooUrl, status: 'complete' };
      },
      async remove(id) { removed.push(id); },
      async query() {
        const tabs = [{ id: 7, url: yahooUrl }, { id: 13, openerTabId: 7, url: 'https://login.yahoo.co.jp/ncaptcha?old=1', status: 'complete' }];
        if (options.newTabCaptcha && submittedAt && now - submittedAt >= (options.transitionAfter || 0)) {
          tabs.push({ id: 91, openerTabId: 7, url: 'https://login.yahoo.co.jp/ncaptcha?new=1', status: 'loading' });
        }
        return tabs;
      }
    },
    scripting: {
      async executeScript(payload) {
        scripts.push(String(payload.func));
        if (String(payload.func).includes('document.readyState')) return [{ result: true }];
        if (String(payload.func).includes('settings.baseline')) {
          if (payload.args[0].baseline) return [{ result: { ready: true, rows: [{ threadId: 'thread1', messageId: 'a1' }] } }];
          if (options.noMail || now - start < (options.mailAfter || 0)) return [{ result: { ready: true } }];
          return [{ result: { messages: [{
            messageId: 'a2', sender: 'login-master@mail.yahoo.co.jp', recipient: 'donald@gmail.com',
            date: new Date(now).toISOString(), text: '確認コード：012345'
          }] } }];
        }
        if (String(payload.func).includes('emailCode')) {
          fills += 1;
          assert.equal(payload.args[0], '012345');
          submittedAt = now;
          return [{ result: options.fillFailure ? { success: false } : { success: true, submittedAt } }];
        }
        return [{ result: { ...emailPage, error: Boolean(submittedAt && options.rejected) } }];
      }
    }
  });
  return { api, counts: () => ({ reloads, fills, removed, elapsed: now - start, submittedElapsed: now - submittedAt }), scripts };
}

async function testOneRefreshOneSubmitAndSeparateTimeouts() {
  const fixture = createAttemptFixture({ mailAfter: 45000, transitionAfter: 29000 });
  const result = await fixture.api.executeManualEmailAttempt({ id: 7, url: emailUrl }, emailPage);
  assert.equal(result.success, true);
  assert.match(result.tab.url, /ncaptcha/);
  const counts = fixture.counts();
  assert.equal(counts.reloads, 1);
  assert.equal(counts.fills, 1);
  assert.deepEqual(counts.removed, [90]);
  assert.ok(counts.elapsed > 60000, '60s receive timeout must not limit the later transition');
  assert.equal(counts.submittedElapsed, 29000);
  assert.equal(fixture.scripts.some(script => script.includes('captchaAnswer')), false, 'human text captcha is outside this 30s operation');
}

async function testReceiveAndTransitionTimeoutsDoNotRetry() {
  for (const [options, error, expectedFills, expectedElapsed] of [
    [{ noMail: true }, '60秒未收到验证码，请重试', 0, 60000],
    [{ transitionAfter: null }, 'gmail验证码填入错误，请重试', 1, 32000],
    [{ fillFailure: true }, 'gmail验证码填入错误，请重试', 1, 2000],
    [{ rejected: true, transitionAfter: null }, 'gmail验证码填入错误，请重试', 1, 2000]
  ]) {
    const fixture = createAttemptFixture(options);
    const result = await fixture.api.executeManualEmailAttempt({ id: 7, url: emailUrl }, emailPage);
    assert.equal(result.success, false);
    assert.equal(result.error, error);
    const counts = fixture.counts();
    assert.equal(counts.reloads, 1);
    assert.equal(counts.fills, expectedFills);
    assert.equal(counts.elapsed, expectedElapsed);
    assert.deepEqual(counts.removed, [90]);
  }
}

async function testNewCaptchaTabIsScopedAndDoesNotWaitForAllResources() {
  const fixture = createAttemptFixture({ newTabCaptcha: true, transitionAfter: 1000 });
  const result = await fixture.api.executeManualEmailAttempt({ id: 7, url: emailUrl }, emailPage);
  assert.equal(result.success, true);
  assert.equal(result.tab.id, 91, 'existing unrelated captcha must not complete the attempt');
  assert.equal(result.tab.status, 'loading', 'ready captcha DOM may precede completion of other resources');
  assert.equal(fixture.counts().reloads, 1);
  assert.equal(fixture.counts().fills, 1);
  assert.deepEqual(fixture.counts().removed, [90]);
}

function testFreshMailSelectionRejectsOldOtherAccountAndWrongSender() {
  const api = loadBackgroundForTest({ disableAutoStart: true });
  const now = Date.now();
  const valid = { messageId: 'a2', sender: 'login-master@mail.yahoo.co.jp', recipient: 'donald@gmail.com', date: new Date(now).toISOString(), text: '確認コード\n012345\n' };
  const previous = new Set(['a1']);
  assert.equal(api.selectFreshGmailCode([valid], previous, now, mask), '012345');
  assert.equal(api.selectFreshGmailCode([{ ...valid, text: '確認コードは以下のとおりです。\n012345\n有効期間は10分です。' }], previous, now, mask), '012345');
  assert.equal(api.selectFreshGmailCode([{ ...valid, text: '確認コードのお知らせ\n012345\n999999\n' }], previous, now, mask), '');
  for (const change of [
    { messageId: 'a1' }, { messageId: '#msg-f:161' }, { sender: 'fake@example.com' },
    { recipient: 'another@gmail.com' }, { recipient: '' }, { date: new Date(now - 600000).toISOString() },
    { date: '2:00 PM' }, { text: 'Some number 012345' }
  ]) assert.equal(api.selectFreshGmailCode([{ ...valid, ...change }], previous, now, mask), '');
  assert.equal(api.normalizeGmailMessageId('#msg-f:161'), 'a1');
  assert.equal(api.matchesMaskedEmail('donald@gmail.com', mask), true);
  assert.equal(api.matchesMaskedEmail('donald@example.com', mask), false);
  assert.equal(api.parseGmailMessageTime('2026年10月2日 午後 2:03'), new Date(2026, 9, 2, 14, 3).getTime());
}

async function testEmailDetectionOverridesPinUrlUsingActualPageScript() {
  const input = { placeholder: '確認コード', name: '', disabled: false, offsetWidth: 200, getAttribute: () => '' };
  const document = {
    body: { innerText: 'do*******@g******** に届いた確認コードを入力してください。' },
    querySelectorAll(selector) { return selector === 'input' ? [input] : []; }
  };
  const api = loadBackgroundForTest({ disableAutoStart: true, document,
    tabs: { async get() { return { id: 7, url: emailUrl }; } },
    scripting: { async executeScript(payload) { return [{ result: payload.func() }]; } }
  });
  assert.equal((await api.detectManualEmailPage({ id: 7, url: emailUrl })).maskedAddress, mask);
  assert.equal(await api.detectManualPinPage({ id: 7, url: emailUrl }), false);
  document.body.innerText = 'PINコードを入力してください';
  assert.equal(await api.detectManualPinPage({ id: 7, url: emailUrl }), true);
}

async function testEmailFillScriptDoesOneNativeInputAndOneClick() {
  let clicks = 0;
  let assignments = 0;
  const events = [];
  class Input {
    get value() { return this.stored; }
    set value(value) { assignments += 1; this.stored = value; }
  }
  const input = new Input();
  Object.assign(input, { placeholder: '確認コード', offsetWidth: 200, disabled: false, getAttribute: () => '', focus() {}, dispatchEvent(event) { events.push(event.type); } });
  const button = { disabled: false, offsetWidth: 200, textContent: 'ログイン', click() { clicks += 1; } };
  const document = { body: { innerText: 'メールに届いた確認コード' }, querySelectorAll(selector) { return selector === 'input' ? [input] : [button]; } };
  const api = loadBackgroundForTest({ disableAutoStart: true, document, HTMLInputElement: Input, Event: class { constructor(type) { this.type = type; } },
    scripting: { async executeScript(payload) { return [{ result: payload.func(...payload.args) }]; } }
  });
  assert.equal((await api.fillManualEmailCodeOnce(7, '012345', Date.now() + 30000)).success, true);
  assert.equal(input.value, '012345');
  assert.equal(assignments, 1);
  assert.equal(clicks, 1);
  assert.deepEqual(events, ['input', 'change']);
  assert.equal((await api.fillManualEmailCodeOnce(7, '012345', Date.now() - 1)).success, false);
  assert.equal(clicks, 1);
}

async function testClaimedEmailAfterWorkerRestartBecomesRetryWithoutReplay() {
  const posts = [];
  const api = loadBackgroundForTest({ disableAutoStart: true,
    fetch: async (url, options = {}) => {
      if (String(url).includes('/current')) return { async json() { return { found: true, id: 'email-old', type: 'email', phase: 'processing', tabId: 7 }; } };
      posts.push(JSON.parse(options.body));
      return { async json() { return { success: true }; } };
    },
    tabs: { async reload() { throw new Error('must not replay'); } }
  });
  const retry = await api.ensureManualEmailChallenge({ id: 7, url: emailUrl });
  assert.equal(retry.phase, 'error');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].message, 'gmail验证码填入错误，请重试');
  assert.equal(posts[0].expectedId, 'email-old');
  assert.notEqual(posts[0].id, 'email-old');
}

async function testGmailPageReaderUsesNewMessageAndDoesNotClickAfterExpiry() {
  let clicks = 0;
  let open = false;
  const row = { getAttribute(name) { return { 'data-legacy-thread-id': 't1', 'data-legacy-last-message-id': open ? 'a2' : 'a1' }[name] || ''; }, click() { clicks += 1; } };
  const message = id => ({
    getAttribute(name) { return name === 'data-legacy-message-id' ? id : ''; },
    querySelector(selector) {
      if (selector.startsWith('.gD')) return { getAttribute: () => 'login-master@mail.yahoo.co.jp' };
      if (selector.startsWith('.g3')) return { getAttribute: () => new Date().toISOString() };
      if (selector.startsWith('.g2')) return { getAttribute: () => 'donald@gmail.com' };
      if (selector === '.a3s') return { innerText: `確認コード：${id === 'a2' ? '012345' : '999999'}` };
      return null;
    }
  });
  const main = { innerText: 'Yahoo mail', querySelectorAll(selector) { return selector === '.adn' ? (open ? [message('a1'), message('a2')] : []) : [row]; } };
  const document = { querySelector: () => main, querySelectorAll: () => [] };
  const api = loadBackgroundForTest({ disableAutoStart: true, document,
    scripting: { async executeScript(payload) { return [{ result: payload.func(...payload.args) }]; } }
  });
  const deadline = Date.now() + 60000;
  const baseline = await api.getGmailVerificationSnapshot(90, { baseline: true, deadline });
  assert.equal(baseline.ready, true);
  assert.equal(baseline.rows[0].messageId, 'a1');
  row.getAttribute = name => ({ 'data-legacy-thread-id': 't1', 'data-legacy-last-message-id': 'a2' }[name] || '');
  await api.getGmailVerificationSnapshot(90, { previous: { t1: 'a1' }, deadline });
  assert.equal(clicks, 1);
  open = true;
  const fresh = await api.getGmailVerificationSnapshot(90, { previous: { t1: 'a1' }, deadline });
  assert.equal(fresh.messages.length, 1);
  assert.equal(fresh.messages[0].messageId, 'a2');
  assert.equal(fresh.messages[0].recipient, 'donald@gmail.com');
  const expired = await api.getGmailVerificationSnapshot(90, { previous: {}, deadline: Date.now() - 1 });
  assert.equal(expired.expired, true);
  assert.equal(clicks, 1);
}

async function testLateGmailTabCreationIsCleanedWithoutYahooRefresh() {
  let resolveCreate;
  let fireWatchdog;
  const removed = [];
  let refreshes = 0;
  const api = loadBackgroundForTest({ disableAutoStart: true,
    setTimeout(fn) { fireWatchdog = fn; return 1; },
    tabs: {
      create() { return new Promise(resolve => { resolveCreate = resolve; }); },
      async remove(id) { removed.push(id); },
      async reload() { refreshes += 1; }
    }
  });
  const operation = api.executeManualEmailAttempt({ id: 7, url: emailUrl }, emailPage);
  fireWatchdog();
  const result = await operation;
  assert.equal(result.success, false);
  assert.equal(result.error, 'gmail验证码填入错误，请重试');
  resolveCreate({ id: 90 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(removed, [90]);
  assert.equal(refreshes, 0);
}

async function testRetryRequiresAnotherHumanClickAndSharesConcurrentFlow() {
  let challenge = null;
  let pendingAnswer;
  let answerWaiting;
  let failed;
  const waiting = () => new Promise(resolve => { answerWaiting = resolve; });
  let ready = waiting();
  const failurePosted = new Promise(resolve => { failed = resolve; });
  const options = { noMail: true, fetch: async (url, request = {}) => {
    let data = {};
    if (String(url).includes('/current')) data = challenge ? { ...challenge, found: true } : { found: false };
    if (String(url).includes('/challenge')) {
      challenge = JSON.parse(request.body);
      if (challenge.phase === 'error') failed();
      data = { success: true };
    }
    if (String(url).includes('/answer/')) {
      return new Promise(resolve => {
        pendingAnswer = () => {
          challenge.phase = 'requested';
          resolve({ async json() { return { answered: true, answer: 'continue' }; } });
        };
        answerWaiting();
      });
    }
    if (String(url).includes('/email/claim')) {
      assert.equal(challenge.phase, 'requested');
      challenge.phase = 'processing';
      data = { claimed: true };
    }
    if (String(url).includes('/close')) data = { success: true };
    return { async json() { return data; } };
  } };
  const fixture = createAttemptFixture(options);
  const operation = fixture.api.handleManualEmailVerification({ id: 7, url: emailUrl });
  await ready;
  const sameFlow = fixture.api.handleManualEmailVerification({ id: 7, url: emailUrl });
  assert.equal(fixture.counts().reloads, 0);
  const firstId = challenge.id;
  ready = waiting();
  pendingAnswer();
  await failurePosted;
  await ready;
  assert.equal(challenge.message, '60秒未收到验证码，请重试');
  assert.notEqual(challenge.id, firstId);
  assert.equal(fixture.counts().reloads, 1);
  assert.equal(fixture.counts().fills, 0);
  options.noMail = false;
  pendingAnswer();
  assert.match((await operation).url, /ncaptcha/);
  assert.match((await sameFlow).url, /ncaptcha/);
  assert.equal(fixture.counts().reloads, 2);
  assert.equal(fixture.counts().fills, 1);
}

async function testRealReaderOpensRowsWithoutListMessageIdAndSubmitsFreshCode(existingMail, options = {}) {
  let now = new Date(2026, 9, 8, 14, 0, 30).getTime();
  let targetId = 90;
  let refreshed = false;
  let opened = false;
  let yahooUrl = emailUrl;
  const counts = { yahooReloads: 0, gmailReloads: 0, opens: 0, baselineOpens: 0, fills: 0, removed: [] };
  class Clock extends Date { static now() { return now; } }
  const metadata = { getAttribute(name) { return name === 'data-thread-id' ? '#thread-f:123' : ''; }, closest() { return row; } };
  const row = {
    innerText: 'Yahoo 確認コードのお知らせ',
    getAttribute() { return ''; },
    querySelector(selector) {
      if (selector.startsWith('.xW')) return options.oldDate ? { getAttribute: () => new Date(now - 600000).toISOString() } : null;
      return options.noThreadId ? null : metadata;
    },
    querySelectorAll() { return [metadata]; },
    closest() { return this; },
    click() { opened = true; counts.opens += 1; if (!refreshed) counts.baselineOpens += 1; }
  };
  const mail = (id, code) => ({
    getAttribute(name) { return name === 'data-message-id' ? `#msg-f:${id}` : ''; },
    querySelector(selector) {
      if (selector.startsWith('.gD')) return { getAttribute: () => 'login-master@mail.yahoo.co.jp' };
      if (selector.startsWith('.g3')) return { getAttribute: () => new Date(now - (options.oldDate && id === 161 ? 600000 : 0)).toISOString() };
      if (selector.startsWith('.g2')) return { getAttribute: () => 'donald@gmail.com' };
      if (selector === '.a3s') return { innerText: `確認コード：${code}` };
      return null;
    }
  });
  const main = {
    get innerText() { return existingMail || refreshed ? 'Yahoo verification email' : 'No conversations found.'; },
    querySelectorAll(selector) {
      if (selector === '.adn') return opened ? [...(existingMail ? [mail(161, '999999')] : []),
        ...(refreshed && (!options.cached || counts.gmailReloads > 0) ? [mail(162, '012345')] : [])] : [];
      return existingMail || refreshed ? [row, metadata] : [];
    }
  };
  class Input { set value(value) { this.stored = value; } get value() { return this.stored; } }
  const input = Object.assign(new Input(), { placeholder: '確認コード', disabled: false, offsetWidth: 200, getAttribute: () => '', focus() {}, dispatchEvent() {} });
  const submit = { disabled: false, offsetWidth: 200, textContent: 'ログイン', click() {
    counts.fills += 1;
    assert.equal(input.value, '012345', 'must not reuse the old code from the same minute');
    yahooUrl = 'https://login.yahoo.co.jp/ncaptcha?fido=1';
  } };
  const document = {
    get body() { return { innerText: targetId === 7 ? `${mask} に届いた確認コードを入力してください。` : main.innerText }; },
    querySelector() { return main; },
    querySelectorAll(selector) {
      if (targetId === 7) return selector === 'input' ? [input] : /button, input/.test(selector) ? [submit] : [];
      return [];
    }
  };
  const api = loadBackgroundForTest({ disableAutoStart: true, Date: Clock, document, HTMLInputElement: Input, Event: class {},
    setTimeout(fn, ms) { if (!String(fn).includes('reject(')) { now += ms; queueMicrotask(fn); } return 1; },
    tabs: {
      async create() { return { id: 90 }; },
      async reload(id) { if (id === 7) { refreshed = true; counts.yahooReloads += 1; } else { counts.gmailReloads += 1; opened = false; } },
      async update(id, props) { if (id === 90 && props.url) opened = false; return { id }; },
      async get(id) { return { id, url: yahooUrl, status: 'complete' }; },
      async query() { return [{ id: 7, url: yahooUrl }]; },
      async remove(id) { counts.removed.push(id); }
    },
    scripting: { async executeScript(payload) { targetId = payload.target.tabId; return [{ result: payload.func(...(payload.args || [])) }]; } }
  });
  const result = await api.executeManualEmailAttempt({ id: 7, url: emailUrl }, emailPage);
  assert.equal(result.success, true, `missing list message id, existingMail=${existingMail}: ${result.error}`);
  assert.equal(counts.yahooReloads, 1);
  assert.equal(counts.fills, 1);
  assert.ok(counts.opens >= (existingMail && !options.oldDate ? 2 : 1));
  if (options.oldDate) assert.equal(counts.baselineOpens, 0, 'clearly older rows need not consume the 15s preparation window');
  if (options.cached) assert.ok(counts.gmailReloads > 0, 'refresh Gmail even when toolbar labels cannot be found');
  assert.deepEqual(counts.removed, [90]);
}

async function run() {
  await testOneRefreshOneSubmitAndSeparateTimeouts();
  await testReceiveAndTransitionTimeoutsDoNotRetry();
  await testNewCaptchaTabIsScopedAndDoesNotWaitForAllResources();
  testFreshMailSelectionRejectsOldOtherAccountAndWrongSender();
  await testEmailDetectionOverridesPinUrlUsingActualPageScript();
  await testEmailFillScriptDoesOneNativeInputAndOneClick();
  await testClaimedEmailAfterWorkerRestartBecomesRetryWithoutReplay();
  await testGmailPageReaderUsesNewMessageAndDoesNotClickAfterExpiry();
  await testLateGmailTabCreationIsCleanedWithoutYahooRefresh();
  await testRetryRequiresAnotherHumanClickAndSharesConcurrentFlow();
  await testRealReaderOpensRowsWithoutListMessageIdAndSubmitsFreshCode(false);
  await testRealReaderOpensRowsWithoutListMessageIdAndSubmitsFreshCode(true);
  await testRealReaderOpensRowsWithoutListMessageIdAndSubmitsFreshCode(true, { cached: true });
  await testRealReaderOpensRowsWithoutListMessageIdAndSubmitsFreshCode(true, { noThreadId: true });
  await testRealReaderOpensRowsWithoutListMessageIdAndSubmitsFreshCode(true, { cached: true, oldDate: true });
  console.log('Email verification tests passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
