const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
if (!process.env.DATABASE_URL?.includes('gdaipai-regression-')) throw new Error('Run with scripts/run-isolated-regression.cjs');
process.env.JWT_SECRET = 'fleamarket-negotiation-regression';
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../models');
const proxy = require('./proxy');
const plugin = require('./plugin');
const task = require('./task');
const accounts = require('../services/yahooAccounts');
const negotiation = require('../services/fleamarketNegotiation');

const id = 'z650804548';
const url = `https://paypayfleamarket.yahoo.co.jp/item/${id}`;
const productHtml = fs.readFileSync(path.join(__dirname, 'fixtures/fleamarket-product.html'), 'utf8');
const form = `<div id="fltdscnt"><span>価格の相談</span><div><input type="tel" placeholder="購入したい金額を入力">
  <button disabled data-cl-params="_cl_link:discount;_cl_position:1;">➤</button></div></div>`;
const parse = html => proxy.parseProductHtml(html, id, url);

(async () => {
  assert.equal(parse(form + productHtml).canNegotiate, true);
  assert.equal(parse('<div>価格の相談</div>' + productHtml).canNegotiate, undefined);
  assert.equal(parse(form.replace('<input', '<input readonly') + productHtml).canNegotiate, undefined);
  assert.equal(parse(productHtml.replace('購入手続きへ', '相談した価格で購入手続きへ')).auctionStatus, 'open');
  const otherLink = productHtml.replace(`/item/${id}/order`, '/item/z123456789/order');
  assert.equal(parse(otherLink.replace('購入手続きへ', '相談した価格で購入手続きへ')).auctionStatus, 'ended');
  const data = parse(form + productHtml);
  if (process.env.NEGOTIATION_REFERENCE_HTML) {
    const html = fs.readFileSync(process.env.NEGOTIATION_REFERENCE_HTML, 'utf8');
    assert.equal(proxy.parseProductHtml(html, 'z188576864', 'https://paypayfleamarket.yahoo.co.jp/item/z188576864').canNegotiate, true);
  }
  let source = 'cache-fallback';
  proxy.productService.fetchProduct = async () => ({ success: true, source, data });
  db.raw.exec("INSERT INTO users(id,username,password_hash,role,user_level) VALUES(1,'offer-a','x','user',1),(2,'offer-b','x','user',1)");
  const user = id => ({ Authorization: 'Bearer ' + jwt.sign({ id, role: 'user', user_level: 1 }, process.env.JWT_SECRET) });
  const account = accounts.list(db, Date.now(), true)[0];
  const context = { accountId: account.id, instanceId: 'negotiation-regression-01' };
  const binding = {
    'X-Yahoo-Account': String(account.id), 'X-Yahoo-Token': account.binding_token, 'X-Yahoo-Instance': context.instanceId
  };
  const app = express();
  app.use(express.json());
  app.use('/proxy', proxy);
  app.use('/plugin', plugin);
  app.use('/task', task);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const request = async (path, headers = {}, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, body === undefined ? { headers } : {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
  const route = '/proxy/fleamarket-negotiation/' + id;
  const report = (action, claimToken) => request('/plugin/fleamarket-negotiation/status', binding, { action, productId: id, claimToken });
  try {
    assert.equal((await request(route, {}, { price: 23760 })).status, 401);
    assert.equal((await request(route, user(1), { price: 23760 })).status, 409, 'a stale cached product cannot queue a quote');
    source = 'http';
    assert.equal((await request(route, user(1), { price: 23759 })).status, 400);
    assert.equal((await request(route, user(2), { price: 29700 })).status, 400);
    const simultaneous = await Promise.all([
      request(route, user(1), { price: 23760 }),
      request('/proxy/fleamarket-negotiation/' + id.toUpperCase(), user(2), { price: 23760 })
    ]);
    assert.deepEqual(simultaneous.map(value => value.status).sort(), [202, 409]);
    assert.equal(simultaneous.find(value => value.status === 409).body.error, '该商品已经提交过砍价了！');
    assert.deepEqual((await request(route, user(2))).body, { state: 'pending' });
    assert.deepEqual((await request('/plugin/yahoo-messages/jobs?limit=1', binding)).body.jobs, []);
    const sharedQueue = '/plugin/yahoo-messages/jobs?limit=1&includeNegotiation=1';
    const [job] = (await request(sharedQueue, binding)).body.jobs;
    assert.deepEqual({ ...job, claimToken: Boolean(job.claimToken) }, { jobType: 'negotiate', productId: id, price: 23760, claimToken: true });
    assert.equal((await report('begin', 'wrong-claim')).status, 409);
    assert.equal((await report('begin', job.claimToken)).status, 200);
    assert.equal((await report('begin', job.claimToken)).status, 409);
    const afterDeadline = Date.now() + 61000;
    assert.equal(negotiation.claim(db.raw, context, afterDeadline), null, 'an expired quote is removed, never automatically claimed again');
    assert.equal(negotiation.getStatus(db.raw, id).state, 'available', 'an expired send restores access for everyone');
    assert.equal((await report('success', job.claimToken)).status, 409, 'a late result cannot revive a timed out reservation');
    assert.equal((await request(route, user(2), { price: 24000 })).status, 202);
    const [rejected] = (await request(sharedQueue, binding)).body.jobs;
    assert.equal((await report('begin', rejected.claimToken)).status, 200);
    assert.equal((await report('failed', job.claimToken)).status, 409, 'an old callback cannot release a newer reservation');
    assert.equal((await report('failed', rejected.claimToken)).status, 200);
    assert.deepEqual((await request(route, user(1))).body, { state: 'available' });
    assert.deepEqual((await request(sharedQueue, binding)).body.jobs, []);
    assert.equal((await request(route, user(1), { price: 23760 })).status, 202);
    const [confirmed] = (await request(sharedQueue, binding)).body.jobs;
    assert.equal((await report('begin', confirmed.claimToken)).status, 200);
    assert.equal((await report('success', confirmed.claimToken)).status, 200);
    assert.equal((await report('success', confirmed.claimToken)).status, 200, 'acknowledgement is replay safe');
    const history = (await request(route, user(2))).body;
    assert.deepEqual(history, { state: 'submitted', productId: id, submittedAt: history.submittedAt, price: 23760 });
    assert.ok(Number.isFinite(Date.parse(history.submittedAt)));
    assert.equal((await request(route, user(2), { price: 24500 })).status, 409);
    for (const table of ['products', 'tasks', 'orders', 'yahoo_trade_messages', 'yahoo_product_assignments']) {
      assert.equal(db.raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
    }
    const purchase = await request('/task/submit', user(2), {
      product_url: url, max_price: 29700, strategy: 'direct', bid_mode: 'buyout', product_type: 'fleamarket',
      product_title: data.title, product_image_url: data.imageUrl, current_price: 29700, buyout_price: 29700,
      tax_type: 'tax_zero', shipping_fee_text: '送料無料'
    });
    assert.equal(purchase.status, 200, JSON.stringify(purchase.body));
    assert.deepEqual(db.raw.prepare('SELECT user_id,max_price FROM tasks WHERE product_id=?').get(id), { user_id: 2, max_price: 29700 });
    console.log('Fleamarket negotiation parser, global HTTP dedupe, failure/timeout release, shared queue, and independent purchase passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
