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
  let pinReady = false;
  let pinFinished = false;
  const removed = [];
  const scripts = [];
  class Clock extends Date { static now() { return now; } }
  const api = loadBackgroundForTest({
    disableAutoStart: true, Date: Clock,
    fetch: (...args) => {
      if (options.finishPin && String(args[0]).includes('/manual-pin/type')) {
        assert.equal(JSON.parse(args[1].body).pin, '765432', 'email code must never become the PIN');
        pinFinished = true;
        return Promise.resolve({ async json() { return { success: true }; } });
      }
      return options.fetch ? options.fetch(...args) : Promise.resolve({ async json() { return {}; } });
    },
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
        if (pinFinished) return { id, url: 'https://auctions.yahoo.co.jp/', status: 'complete' };
        if (id === 7 && !options.newTabCaptcha && !options.newTabPin && submittedAt && options.transitionAfter !== null && now - submittedAt >= (options.transitionAfter || 0)) {
          pinReady = Boolean(options.pinAfterSubmit) && fills > (options.emailLoops || 0);
          yahooUrl = pinReady || options.emailLoops ? emailUrl : 'https://login.yahoo.co.jp/ncaptcha?fido=1';
        }
        if (id === 91 && options.newTabPin) return { id, url: emailUrl, status: 'complete' };
        return { id, url: yahooUrl, status: 'complete' };
      },
      async remove(id) { removed.push(id); },
      async query() {
        const tabs = [{ id: 7, url: yahooUrl }, { id: 13, openerTabId: 7, url: 'https://login.yahoo.co.jp/ncaptcha?old=1', status: 'complete' }];
        if (options.newTabCaptcha && submittedAt && now - submittedAt >= (options.transitionAfter || 0)) {
          tabs.push({ id: 91, openerTabId: 7, url: 'https://login.yahoo.co.jp/ncaptcha?new=1', status: 'loading' });
        }
        if (options.newTabPin && submittedAt) tabs.push({ id: 91, openerTabId: 7, url: emailUrl, status: 'complete' });
        return tabs;
      }
    },
    scripting: {
      async executeScript(payload) {
        scripts.push(String(payload.func));
        if (String(payload.func).includes('const codeInput') &&
            (pinReady || (options.newTabPin && payload.target.tabId === 91))) return [{ result: null }];
        if (String(payload.func).includes('document.readyState')) return [{ result: true }];
        if (String(payload.func).includes('settings.baseline')) {
          if (payload.args[0].baseline) return [{ result: { ready: true, rows: [{ threadId: 'thread1', messageId: 'a1' }] } }];
          if (options.noMail || now - start < (options.mailAfter || 0)) return [{ result: { ready: true } }];
          return [{ result: { messages: [{
            messageId: `a${fills + 2}`, sender: 'login-master@mail.yahoo.co.jp', recipient: 'donald@gmail.com',
            date: new Date(now).toISOString(), text: '確認コード：012345'
          }] } }];
        }
        if (String(payload.func).includes('emailCode')) {
          fills += 1;
          assert.equal(payload.args[0], '012345');
          submittedAt = now;
          return [{ result: options.fillFailure ? { success: false } : { success: true, submittedAt } }];
        }
        return [{ result: { ...emailPage, ...(options.emailLoops && submittedAt ? { submitted: false } : {}), error: Boolean(submittedAt && options.rejected) } }];
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

async function testEmailSubmissionHandsOffToOriginalPinFlow() {
  for (const options of [{ pinAfterSubmit: true }, { pinAfterSubmit: true, transitionAfter: 29000 }, { newTabPin: true }]) {
    let challenge;
    const posted = [];
    const closed = [];
    const fixture = createAttemptFixture({ ...options, fetch: async (url, request = {}) => {
      if (String(url).includes('/current')) return { async json() { return { found: false }; } };
      if (String(url).includes('/challenge')) {
        challenge = JSON.parse(request.body);
        posted.push(challenge);
      }
      if (String(url).includes('/close')) closed.push(JSON.parse(request.body).id);
      return { async json() { return { success: true, answered: true, answer: 'continue', claimed: true }; } };
    } });
    const next = await fixture.api.handleManualEmailVerification({ id: 7, url: emailUrl });
    assert.equal(next.id, options.newTabPin ? 91 : 7);
    assert.equal(next.url, emailUrl, 'PIN can appear without changing the email page URL');
    assert.equal(await fixture.api.detectManualPinPage(next), true);
    assert.deepEqual(closed, [challenge.id], 'close the email challenge before returning to the existing PIN handler');
    assert.equal(posted.length, 1, 'do not publish a false Gmail error or submit PIN in the email operation');
    assert.equal(posted[0].type, 'email');
    assert.equal(fixture.counts().reloads, 1);
    assert.equal(fixture.counts().fills, 1);
    assert.deepEqual(fixture.counts().removed, options.newTabPin ? [90, 7] : [90]);
    assert.equal(fixture.counts().submittedElapsed, options.transitionAfter || 0);
    assert.equal(fixture.scripts.some(script => script.includes('pinAnswer')), false);
  }
}

async function testRetryOnExistingPinDoesNotRefreshOrReadGmail() {
  const closed = [];
  let refreshed = 0;
  const api = loadBackgroundForTest({ disableAutoStart: true,
    fetch: async (url, request = {}) => {
      if (String(url).includes('/current')) return { async json() { return { found: true, id: 'email-existing', type: 'email', tabId: 7, phase: 'error' }; } };
      if (String(url).includes('/close')) closed.push(JSON.parse(request.body).id);
      return { async json() { return { success: true, answered: true, answer: 'continue', claimed: true }; } };
    },
    tabs: { async get() { return { id: 7, url: emailUrl, status: 'complete' }; },
      async reload() { refreshed += 1; }, async create() { throw new Error('must not reopen Gmail'); } },
    scripting: { async executeScript() { return [{ result: null }]; } }
  });
  const next = await api.handleManualEmailVerification({ id: 7, url: emailUrl });
  assert.equal(next.id, 7);
  assert.deepEqual(closed, ['email-existing']);
  assert.equal(refreshed, 0);
}

async function testEmailReturnsToOuterPinChallengeWithoutReusingCode() {
  const events = [];
  let pinPosted = false;
  const fixture = createAttemptFixture({ pinAfterSubmit: true, fetch: async (url, request = {}) => {
    if (pinPosted && String(url).includes('/answer/')) return { async json() { return { found: true, answered: false }; } };
    if (String(url).includes('/current')) return { async json() { return { found: false }; } };
    if (String(url).includes('/close')) events.push('close email');
    if (String(url).includes('/challenge')) {
      const challenge = JSON.parse(request.body);
      events.push(challenge.type);
      if (challenge.type === 'pin') {
        assert.equal(challenge.message, 'Yahoo 需要 PIN 码验证，请输入 PIN 码');
        pinPosted = true;
      }
    }
    return { async json() { return { success: true, answered: true, answer: 'continue', claimed: true }; } };
  } });
  await assert.rejects(() => fixture.api.handleManualVerificationIfPresent({ id: 7, url: emailUrl }), /manual captcha answer timeout/);
  assert.deepEqual(events, ['email', 'close email', 'pin']);
  assert.equal(fixture.counts().fills, 1);
  assert.equal(fixture.counts().reloads, 1);
}

async function testReceiveAndTransitionTimeoutsDoNotRetry() {
  for (const [options, error, expectedFills, expectedElapsed] of [
    [{ noMail: true }, '60秒未收到验证码，请重试', 0, 60000],
    [{ transitionAfter: null }, '邮箱验证码提交后30秒未进入后续验证，请人工处理', 1, 32000],
    [{ fillFailure: true }, '邮箱验证码填写或提交失败，请重试', 1, 2000],
    [{ rejected: true, transitionAfter: null }, 'Yahoo 提示邮箱验证码错误或已过期，请人工检查', 1, 2000]
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
  assert.deepEqual(fixture.counts().removed, [90, 7]);
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
  await testTwoEmailRoundsCompleteOriginalPinBeforeReturning();
  await testThirdEmailAfterWorkerRestartNeverReadsOrSubmits();
  await testLockedEmailTabClosesDuplicateLoginPages();
  await testSecondEmailWaitsForClick();
  await testRepeatedEmailIsBoundedWithoutRefresh();
  await testEmailSubmissionHandsOffToOriginalPinFlow();
  await testRetryOnExistingPinDoesNotRefreshOrReadGmail();
  await testEmailReturnsToOuterPinChallengeWithoutReusingCode();
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
async function testTwoEmailRoundsCompleteOriginalPinBeforeReturning() {
  let pinPosted = false;
  const types = [];
  const fixture = createAttemptFixture({ emailLoops: 1, pinAfterSubmit: true, finishPin: true,
    fetch: async (url, request = {}) => {
      if (String(url).includes('/current')) return { async json() { return { found: false }; } };
      if (String(url).includes('/challenge')) {
        const challenge = JSON.parse(request.body);
        types.push(challenge.type);
        if (challenge.type === 'pin') pinPosted = true;
      }
      return { async json() { return { success: true, answered: true, answer: pinPosted ? '765432' : 'continue', claimed: true }; } };
    }
  });
  const result = await fixture.api.handleManualVerificationIfPresent({ id: 7, url: emailUrl });
  assert.equal(result.handled, true);
  assert.equal(result.tab.url, 'https://auctions.yahoo.co.jp/', 'only return after PIN has completed');
  assert.deepEqual(types, ['email', 'email', 'pin']);
  assert.equal(fixture.counts().fills, 2);
  assert.equal(fixture.counts().reloads, 2, 'initial email refresh plus original PIN refresh; no second email refresh');
}
async function testThirdEmailAfterWorkerRestartNeverReadsOrSubmits() {
  const posted = [];
  const api = loadBackgroundForTest({ disableAutoStart: true,
    sessionStorage: {
      async get() { return { manualEmailVerificationSession: { tabId: 7, submissions: 2, submittedAt: Date.now() } }; },
      async set() {}, async remove() {}
    },
    tabs: {
      async get() { return { id: 7, url: emailUrl, status: 'complete' }; },
      async create() { throw new Error('third visit must not read Gmail'); },
      async reload() { throw new Error('third visit must not reload Yahoo'); }
    },
    scripting: { async executeScript() { return [{ result: { ...emailPage, submitted: false } }]; } },
    fetch: async (url, request = {}) => {
      if (String(url).includes('/current')) return { async json() { return { found: true, id: 'email-old', type: 'email', tabId: 7, phase: 'processing' }; } };
      if (String(url).includes('/challenge')) posted.push(JSON.parse(request.body));
      if (String(url).includes('/claim') || String(url).includes('/answer/')) throw new Error('third visit must stop before another continue');
      return { async json() { return { success: true }; } };
    }
  });
  await assert.rejects(api.handleManualEmailVerification({ id: 7, url: emailUrl }), /邮箱跳第三次验证/);
  assert.equal(posted.at(-1).message, '邮箱跳第三次验证，请人工处理！');
}

async function testLockedEmailTabClosesDuplicateLoginPages() {
  const tabs = new Map([[7, { id: 7, url: emailUrl, status: 'complete', active: true }]]);
  const removed = [];
  const api = loadBackgroundForTest({ disableAutoStart: true,
    tabs: {
      async query() { return [...tabs.values()]; }, async get(id) { return tabs.get(id); },
      async update(id) { return tabs.get(id); },
      async remove(id) { removed.push(id); tabs.delete(id); }
    },
    scripting: { async executeScript() { return [{ result: emailPage }]; } },
    fetch: async () => ({ async json() { return { found: false, success: true }; } })
  });
  assert.equal(await api.pauseIdleWorkForOpenManualPin(), true);
  tabs.set(8, { id: 8, url: emailUrl, status: 'complete' });
  assert.equal(await api.pauseIdleWorkForOpenManualPin(), true);
  assert.deepEqual(removed, [8]);
  assert.deepEqual([...tabs.keys()], [7]);
}
async function testSecondEmailWaitsForClick() {
  let answers = 0;
  let releaseSecond;
  let notifyWaiting;
  const waiting = new Promise(resolve => { notifyWaiting = resolve; });
  const fixture = createAttemptFixture({ emailLoops: 1, pinAfterSubmit: true, fetch: async (url) => {
    if (String(url).includes('/current')) return { async json() { return { found: false }; } };
    if (String(url).includes('/answer/')) {
      answers += 1;
      if (answers === 2) {
        notifyWaiting();
        await new Promise(resolve => { releaseSecond = resolve; });
      }
    }
    return { async json() { return { success: true, answered: true, answer: 'continue', claimed: true }; } };
  } });
  const operation = fixture.api.handleManualEmailVerification({ id: 7, url: emailUrl });
  await waiting;
  assert.equal(fixture.counts().fills, 1, 'second email is not submitted before another click');
  assert.equal(fixture.counts().reloads, 1);
  releaseSecond();
  await operation;
  assert.equal(fixture.counts().fills, 2);
  assert.equal(fixture.counts().reloads, 1, 'second email page is not refreshed');
}

async function testRepeatedEmailIsBoundedWithoutRefresh() {
  for (const emailLoops of [1, 2]) {
    const posted = [];
    let claims = 0;
    const fixture = createAttemptFixture({ emailLoops, pinAfterSubmit: true, fetch: async (url, request = {}) => {
      if (String(url).includes('/current')) return { async json() { return { found: false }; } };
      if (String(url).includes('/challenge')) posted.push(JSON.parse(request.body));
      if (String(url).includes('/claim')) claims += 1;
      return { async json() { return { success: true, answered: true, answer: 'continue', claimed: true }; } };
    } });
    if (emailLoops === 1) {
      const tab = await fixture.api.handleManualEmailVerification({ id: 7, url: emailUrl });
      assert.equal(await fixture.api.detectManualPinPage(tab), true, 'second email continues to the original PIN handler');
      assert.equal(posted.length, 2, 'second email publishes a new continue prompt');
      assert.equal(posted[1].message, '第二次邮箱验证');
      assert.equal(posted[1].phase, 'waiting');
    } else {
      await assert.rejects(fixture.api.handleManualEmailVerification({ id: 7, url: emailUrl }), /邮箱跳第三次验证，请人工处理！/);
      assert.equal(posted.at(-1).message, '邮箱跳第三次验证，请人工处理！');
      assert.equal(posted.at(-1).phase, 'error');
    }
    assert.equal(fixture.counts().fills, 2, 'never submit the third email verification');
    assert.equal(fixture.counts().reloads, 1, 'only the initial email page refreshes');
    assert.equal(claims, 2, 'each email round requires a human continue');
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
