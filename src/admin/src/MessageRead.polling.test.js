const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, 'MessageRead.tsx'), 'utf8');
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const progressCode = source.slice(source.indexOf('function isMessageFetchInProgress('), source.indexOf('function shouldShowMessageFetchError('));
const progress = vm.runInNewContext(compile(`${progressCode}\nisMessageFetchInProgress;`), { MESSAGE_PROCESSING_TIMEOUT_MS: 180000 });
const started = '2026-09-28 00:00:00';
const now = Date.parse('2026-09-28T00:01:00Z');
assert.equal(progress({ order_id: 1, fetch_status: 'pending', fetch_requested_at: started }, null, now), true);
assert.equal(progress({ order_id: 1, fetch_status: 'pending', fetch_requested_at: started }, null, now + 180000), false);
assert.equal(progress({ order_id: 1, fetch_status: 'processing', fetch_started_at: started }, null, now), true);
assert.equal(progress({ order_id: 1, fetch_status: 'idle' }, null, now), false);

async function run() {
  const calls = [];
  const state = { items: [], selected: { order_id: 2 }, selection: {}, loading: false };
  const activeQuery = { current: null };
  const sandbox = {
    AbortController, URLSearchParams,
    pagination: { current: 1, pageSize: 20, total: 0 },
    form: { getFieldsValue() { return {}; } },
    activeQuery, loadSequence: { current: 0 }, loadController: { current: null },
    window: { setTimeout() { return 1; }, clearTimeout() {} },
    message: { error(text) { throw new Error(text); } },
    formatDateOnly: value => value,
    setLoading(value) { state.loading = value; },
    setItems(value) { state.items = value; },
    setSelected(update) { state.selected = update(state.selected); },
    setSelectedRowsByKey(update) { state.selection = update(state.selection); },
    setPagination(value) { state.pagination = value; },
    fetchAdminJson(url, options) {
      return new Promise(resolve => { calls.push({ url, signal: options.signal, resolve }); });
    }
  };
  const loadCode = source.slice(source.indexOf('  async function load('), source.indexOf('  async function requestUpdate('));
  const load = vm.runInNewContext(compile(`${loadCode}\nload;`), sandbox);
  const page = { current: 1, pageSize: 20, total: 0 };
  const older = load(page, { productId: 'old' });
  await load(page, { productId: 'old' }, true);
  assert.equal(calls.length, 1, 'silent polling must not overlap a pending list request');
  const newer = load(page, { productId: 'new' });
  assert.equal(calls[0].signal.aborted, true, 'new search cancels older request');
  calls[1].resolve({ items: [{ order_id: 2, message_html: 'new' }], total: 1 });
  await newer;
  calls[0].resolve({ items: [{ order_id: 1, message_html: 'old' }], total: 1 });
  await older;
  assert.equal(state.items[0].order_id, 2, 'late response cannot replace current search');
  assert.equal(state.selected.message_html, 'new', 'open chat receives fresh message content');
  assert.equal(state.loading, false);
  const refresh = load(activeQuery.current.next, activeQuery.current.values, true);
  assert.equal(state.loading, false, 'refresh does not flash the table loading overlay');
  assert.ok(calls[2].url.includes('productId=new'));
  calls[2].resolve({ items: [{ order_id: 2, message_html: 'finished', fetch_status: 'idle' }], total: 1 });
  await refresh;
  assert.equal(state.selected.message_html, 'finished');
  console.log('Message list polling tests passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
