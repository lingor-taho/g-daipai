const assert = require('assert/strict');
const Database = require('better-sqlite3');

// Exercise the real route SQL without opening the application's database.
const raw = new Database(':memory:');
raw.exec(`
  CREATE TABLE tasks (id INTEGER PRIMARY KEY, product_id TEXT);
  CREATE TABLE products (product_id TEXT PRIMARY KEY, product_type TEXT, tax_type TEXT);
  CREATE TABLE orders (id INTEGER PRIMARY KEY, task_id INTEGER, product_id TEXT, order_status TEXT, transaction_url TEXT);
  CREATE TABLE yahoo_trade_messages (
    id INTEGER PRIMARY KEY, order_id INTEGER UNIQUE, product_id TEXT, message_html TEXT,
    fetch_status TEXT DEFAULT 'idle', fetch_requested_at TEXT, fetch_started_at TEXT, fetch_error TEXT,
    send_status TEXT DEFAULT 'idle', send_text TEXT, send_requested_at TEXT, send_started_at TEXT, send_error TEXT,
    last_message_sent_at TEXT, updated_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO tasks VALUES (1, 'n100000001');
  INSERT INTO products VALUES ('n100000001', 'normal', 'tax_zero');
  INSERT INTO orders VALUES (1, 1, 'n100000001', NULL, 'https://contact.auctions.yahoo.co.jp/trade/top?aid=n100000001');
`);
const database = {
  raw,
  async query(sql, params = []) { return { rowCount: raw.prepare(sql).run(...params).changes }; },
  async getOne(sql, params = []) { return raw.prepare(sql).get(...params); },
  async getAll(sql, params = []) { return raw.prepare(sql).all(...params); }
};
const modelPath = require.resolve('../models');
require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: database };
const { getYahooMessageJobs, updateYahooMessageStatus, getNextIdleAction } = require('./plugin');
const { requestYahooMessageFetch, requestYahooMessageSend } = require('./admin');
const row = () => raw.prepare('SELECT * FROM yahoo_trade_messages WHERE order_id = 1').get();
const html = text => `<div id="messagelist">${text}</div>`;
const complete = (job, text) => updateYahooMessageStatus({ orderId: 1, jobType: job.jobType, startedAt: job.startedAt, messageHtml: html(text) }, database);

async function run() {
  assert.equal(getNextIdleAction({ separateMessages: true, yahooMessagePending: 1, transactionStartRequested: 1 }).action, 'transaction_start');

  await requestYahooMessageFetch(database, 1);
  const [first, concurrent] = await Promise.all([getYahooMessageJobs(database, 1), getYahooMessageJobs(database, 1)]);
  assert.equal(first.total + concurrent.total, 1, 'concurrent polls claim a read only once');
  const fetchJob = [...first.jobs, ...concurrent.jobs][0];
  await requestYahooMessageFetch(database, 1);
  assert.equal(row().fetch_status, 'processing', 'refresh must not reset an active read');
  assert.equal(row().fetch_started_at, fetchJob.startedAt);
  await requestYahooMessageSend(database, 1, 'hello');
  assert.equal((await getYahooMessageJobs(database, 1)).total, 0, 'same-order send waits for read');
  await complete(fetchJob, 'before send');
  const sendJob = (await getYahooMessageJobs(database, 1)).jobs[0];
  assert.equal(sendJob.jobType, 'send');
  await requestYahooMessageFetch(database, 1);
  assert.equal((await getYahooMessageJobs(database, 1)).total, 0, 'same-order read waits for send');
  await complete(sendJob, 'after send');
  assert.equal(row().fetch_status, 'idle');
  assert.equal((await complete(fetchJob, 'late stale read')).updated, 0);
  assert.equal(row().message_html, html('after send'));

  raw.prepare(`UPDATE yahoo_trade_messages SET send_status = 'processing', send_started_at = datetime('now', '-4 minutes'), fetch_status = 'pending'`).run();
  const staleSendStartedAt = row().send_started_at;
  const recoveredRead = (await getYahooMessageJobs(database, 1)).jobs[0];
  assert.equal(recoveredRead.jobType, 'fetch', 'stale send must not block a fresh read forever');
  assert.equal(row().send_status, 'failed', 'uncertain send is not automatically retried');
  assert.match(row().send_error, /核对是否送达/);
  assert.equal((await updateYahooMessageStatus({ orderId: 1, jobType: 'send', startedAt: staleSendStartedAt, messageHtml: html('late send') }, database)).updated, 0);
  await complete(recoveredRead, 'current read');

  await requestYahooMessageFetch(database, 1);
  const activeRead = (await getYahooMessageJobs(database, 1)).jobs[0];
  await requestYahooMessageSend(database, 1, 'next');
  raw.prepare(`UPDATE yahoo_trade_messages SET fetch_started_at = datetime('now', '-2 minutes')`).run();
  assert.equal((await getYahooMessageJobs(database, 1)).total, 0, 'unexpired read remains protected');
  raw.prepare(`UPDATE yahoo_trade_messages SET fetch_started_at = datetime('now', '-4 minutes')`).run();
  const recoveredSend = (await getYahooMessageJobs(database, 1)).jobs[0];
  assert.equal(recoveredSend.jobType, 'send');
  assert.equal(row().fetch_status, 'failed');
  assert.equal((await complete(activeRead, 'expired read')).updated, 0);
  await complete(recoveredSend, 'latest');
  assert.equal(row().message_html, html('latest'));
  console.log('Yahoo message queue integration tests passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => raw.close());
