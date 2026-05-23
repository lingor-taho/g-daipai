import assert from 'node:assert/strict';
import { IDLE_TIMEOUT_MS, isUserIdle } from './activity.js';

function testUserIsNotIdleBeforeTimeout() {
  assert.equal(isUserIdle(Date.now() + IDLE_TIMEOUT_MS - 1), false);
}

function testUserIsIdleAtTimeout() {
  assert.equal(isUserIdle(Date.now() + IDLE_TIMEOUT_MS), true);
}

testUserIsNotIdleBeforeTimeout();
testUserIsIdleAtTimeout();
