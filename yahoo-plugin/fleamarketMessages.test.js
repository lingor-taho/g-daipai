const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const source = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const pageCode = source.slice(source.indexOf('async function fleamarketMessageFromPage('), source.indexOf('function extractYahooTradeMessageFromPage('));
const openCode = source.slice(source.indexOf('async function openYahooMessageTransactionPage('), source.indexOf('// Injected independently'));
const sendCode = source.slice(source.indexOf('async function sendYahooTradeMessage('), source.indexOf('function extractAuctionIdFromText('));
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/fleamarket-messages.html'), 'utf8');
const id = 'z707487598';
const url = `https://paypayfleamarket-sec.yahoo.co.jp/item/${id}/trade/buyer`;

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture }));
    const reset = async (target = url) => { await page.goto(target); await page.evaluate(`(() => { ${pageCode}; window.readP = fleamarketMessageFromPage; })()`); };
    const run = (action = 'read', text = '') => page.evaluate(({ id, action, text }) => window.readP(id, action, text), { id, action, text });
    await reset();
    let result = await run();
    assert.equal(result.success, true);
    assert.match(result.messageHtml, /data-gdaipai-message-empty/);
    assert.doesNotMatch(result.messageHtml, /textarea|プライバシー|指定配送/);
    // The supplied page has an empty thread. Populated entries below are synthetic.
    await page.evaluate(() => {
      const li = document.createElement('li');
      li.textContent = '出品者 10/21 21:35\n発送します <img onerror=alert(1)> 取引情報';
      document.querySelector('[class*="sc-9985ddbc-0"] > ul').append(li);
      document.body.insertAdjacentHTML('beforeend', '<h2>受取評価をして取引を完了する</h2><button id="receipt">受取評価をして取引を完了する</button><button id="other">取引メッセージを送る</button>');
    });
    result = await run();
    assert.match(result.messageHtml, /発送します &lt;img/);
    assert.doesNotMatch(result.messageHtml, /<img|受取評価|プライバシー|textarea/);
    assert.match(result.messageHtml, /<dl><dt>取引メッセージ<\/dt><dd>/);
    // Existing frontends consume the exact same dl/dd HTML, without a frontend change.
    for (const relative of ['../src/client/src/pages/WonItems.jsx', '../src/admin/src/MessageRead.tsx']) {
      const front = fs.readFileSync(path.join(__dirname, relative), 'utf8');
      const sanitize = front.slice(front.indexOf('function sanitizeTradeHtml('), front.indexOf('function renderTradeHtml('));
      const renderStart = front.indexOf('function renderTradeHtml(');
      const renderEnd = front.indexOf('\n}', renderStart) + 2;
      const frontCode = (sanitize + front.slice(renderStart, renderEnd)).replace(/: string/g, '');
      const html = await page.evaluate(({ code, html }) => { return eval(`${code}; renderTradeHtml(${JSON.stringify(html)})`); }, { code: frontCode, html: result.messageHtml });
      assert.match(html, /発送します &lt;img/);
    }
    await page.evaluate(() => {
      window.clicks = 0;
      document.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
        window.clicks++;
        window.clickedText = button.textContent.trim();
      }));
      const textarea = document.querySelector('textarea');
      textarea.addEventListener('input', () => setTimeout(() => {
        document.querySelector('[class*="sc-15ad2869-1"] button').disabled = false;
      }, 250));
    });
    result = await run('send', 'テストメッセージ');
    assert.equal(result.success, true);
    assert.equal(result.matchingCount, 0);
    assert.deepEqual(await page.evaluate(() => [window.clicks, window.clickedText, document.querySelector('textarea').value]), [1, '取引メッセージを送る', 'テストメッセージ']);
    assert.equal((await run('send', 'a'.repeat(1025))).success, false);
    assert.equal(await page.evaluate(() => window.clicks), 1);
    await reset(url.replace(id, 'z700000000'));
    assert.equal((await run()).success, false);
    assert.equal((await run('send', 'wrong product')).success, false);
    await reset(url.replace('paypayfleamarket-sec.yahoo.co.jp', 'auctions.yahoo.co.jp'));
    assert.equal((await run()).success, false);
    await reset();
    await page.evaluate(() => document.querySelector('[class*="sc-9985ddbc-0"]').remove());
    assert.equal((await run()).success, false, 'loading/missing list must not become empty success');
    await reset();
    await page.evaluate(() => { document.querySelector('[class*="sc-15ad2869-0"]').style.display = 'none'; });
    assert.equal((await run('send', 'hidden')).success, false);
    await reset();
    await page.evaluate(() => {
      window.clicks = 0;
      document.querySelectorAll('button').forEach(button => button.onclick = () => window.clicks++);
      let now = 0;
      Date.now = () => { now += 9000; return now; };
    });
    assert.equal((await run('send', 'disabled')).success, false);
    assert.equal(await page.evaluate(() => window.clicks), 0);
    await reset();
    await page.evaluate(() => {
      window.clicks = 0;
      document.querySelectorAll('button').forEach(button => button.onclick = () => window.clicks++);
      document.querySelector('textarea').addEventListener('input', () => {
        document.querySelector('[class*="sc-15ad2869-1"] button').disabled = false;
        history.replaceState({}, '', '/item/z700000000/trade/buyer');
      });
    });
    assert.equal((await run('send', 'page changed')).success, false);
    assert.equal(await page.evaluate(() => window.clicks), 0);
    await reset();
    await page.evaluate(() => {
      document.querySelector('textarea').remove();
      document.querySelectorAll('button').forEach(button => button.remove());
      document.querySelector('[class*="sc-9985ddbc-0"] > ul').innerHTML = '<li>過去のメッセージ</li>';
    });
    assert.match((await run()).messageHtml, /過去のメッセージ/);
    assert.equal((await run('send', 'readonly')).success, false);

    // Real plugin sender: one click only, identical old text is not proof of a new send.
    for (const confirmed of [true, false]) {
      let now = 0, sends = 0, reads = 0;
      const send = vm.runInNewContext(`${sendCode}; sendYahooTradeMessage`, {
        Date: { now: () => now }, MESSAGE_EXTRACT_RENDER_WAIT_MS: 1000, MESSAGE_EXTRACT_POLL_MS: 200,
        sleep: async ms => { now += ms; }, assertYahooMessageActive() {}, yahooMessageTabOwners: new Map(),
        extractYahooTradeMessages: async () => ({ success: true }),
        fleamarketMessageFromPage() {}, chrome: { scripting: { executeScript: async ({ args }) => {
          if (args[1] === 'send') { sends++; return [{ result: { success: true, matchingCount: 1 } }]; }
          reads++;
          return [{ result: { success: true, matchingCount: confirmed && reads > 1 ? 2 : 1 } }];
        } } }
      });
      assert.equal((await send(7, 'hello', { fleamarketProductId: id })).success, confirmed);
      assert.equal(sends, 1);
    }
    // P opens its own same-product page even if the saved URL is missing or stale.
    for (const transactionUrl of ['', 'https://auctions.yahoo.co.jp/my/won']) {
      const visited = [];
      const context = { tabIds: new Set() };
      const open = vm.runInNewContext(`${openCode}; openYahooMessageTransactionPage`, {
        yahooMessageTabOwners: new Map(), assertYahooMessageActive() {}, waitForYahooMessageDocument: async () => {},
        isManualVerificationTab: () => false,
        chrome: { tabs: { create: async () => ({ id: 7 }), update: async (_, value) => visited.push(value.url), get: async () => ({ id: 7, url }) } }
      });
      await open({ orderId: 1, productId: id, productType: 'fleamarket', transactionUrl }, context);
      assert.deepEqual(visited, [url]);
    }
    // Execute the real queue worker to check P options reach read/send and the original callback.
    const workerCode = source.slice(source.indexOf('async function executeYahooMessageJob('), source.indexOf('async function runYahooMessageJobs('));
    for (const jobType of ['fetch', 'send']) {
      const updates = [];
      const worker = vm.runInNewContext(`${workerCode}; executeYahooMessageJob`, {
        MESSAGE_JOB_TIMEOUT_MS: 45000, yahooMessageTabOwners: new Map(),
        openYahooMessageTransactionPage: async () => ({ id: 7 }),
        closeYahooMessageTabs: async () => {}, assertYahooMessageActive() {},
        withTimeout: async promise => promise, prepareYahooMessagePage: async tab => tab,
        sendYahooTradeMessage: async (_, text, options) => { assert.equal(options.fleamarketProductId, id); assert.equal(text, 'hello'); return { success: true }; },
        extractYahooTradeMessages: async (_, options) => { assert.equal(options.fleamarketProductId, id); return { success: true, messageHtml: '<dl><dt>取引メッセージ</dt><dd>hello</dd></dl>' }; },
        updateYahooMessageStatus: async payload => updates.push(payload)
      });
      assert.equal((await worker({ orderId: 2, productId: id, productType: 'fleamarket', jobType, sendText: 'hello', startedAt: 'original-claim' })).success, true);
      assert.equal(updates.length, 1);
      assert.equal(updates[0].jobType, jobType);
      assert.equal(updates[0].startedAt, 'original-claim');
      assert.match(updates[0].messageHtml, /hello/);
    }
    console.log('fleamarket message browser, frontend compatibility, routing and single-send checks passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
