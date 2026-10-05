import assert from 'node:assert/strict';
import { createBatchRequestStore, createBatchResultPoller, getBatchClientContext, isBatchContextCurrent } from './batchSubmit.js';

const values = new Map();
const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
let id = 0;
const text = 'd1246248584 11800\ne1246602869 21980';
const store = createBatchRequestStore(storage, 'user1:7', () => `request-${++id}`);
const firstId = store.get(text);
assert.equal(store.get(text), firstId);
const reopened = createBatchRequestStore(storage, 'user1:7', () => `request-${++id}`);
assert.equal(reopened.get(text), firstId, 'Unknown enqueue outcomes retain the entire batch request id');
assert.notEqual(createBatchRequestStore(storage, 'user1:8', () => `request-${++id}`).get(text), firstId);
reopened.settle(text);
assert.notEqual(reopened.get(text), firstId);
assert.notEqual(store.get('r1246380884 4980'), firstId, 'A new batch can enqueue while another is running');
storage.setItem('token', 'token-a'); storage.setItem('actingUserId', '7');
const context = getBatchClientContext(storage);
assert.equal(isBatchContextCurrent(context, storage), true);
storage.setItem('actingUserId', '8');
assert.equal(isBatchContextCurrent(context, storage), false);
let resolve, requests = 0, current = true;
const received = [];
const poll = createBatchResultPoller({
  fetchResults: () => { requests++; return new Promise(r => { resolve = r; }); },
  onResults: results => received.push(results), isCurrent: () => current
});
const one = poll(), two = poll();
assert.equal(requests, 1, 'Result polling must not overlap');
resolve({ data: { data: [{ id: 1 }] } });
await Promise.all([one, two]);
assert.deepEqual(received, [[{ id: 1 }]]);
const oldAccount = poll(); current = false;
resolve({ data: { data: [{ id: 2 }] } }); await oldAccount;
assert.equal(received.length, 1, 'A late previous-account response must not open a result popup');
const retry = createBatchResultPoller({ fetchResults: async () => { throw new Error('network'); }, onResults: () => assert.fail(), isCurrent: () => true });
await retry(); await retry();
console.log('Batch enqueue identity and background result polling tests passed.');
