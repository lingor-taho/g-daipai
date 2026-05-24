import assert from 'node:assert/strict';
import { createDedupedRunner } from './requestDedupe.js';

async function testSameKeyWithinWindowRunsOnce() {
  let now = 1000;
  const timers = [];
  const runDeduped = createDedupedRunner({
    now: () => now,
    schedule: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    }
  });
  let calls = 0;

  const first = runDeduped('won:list', () => {
    calls += 1;
    return Promise.resolve('first');
  });
  const second = runDeduped('won:list', () => {
    calls += 1;
    return Promise.resolve('second');
  });

  assert.equal(first, second);
  assert.equal(await first, 'first');
  assert.equal(calls, 1);
}

await testSameKeyWithinWindowRunsOnce();
