const assert = require('assert/strict');
const {
  CLEANUP_TASK_STATUSES,
  PRESERVED_TASK_STATUSES,
  shouldCleanupTaskStatus,
  buildCleanupScopeDescription
} = require('./dataCleanupPolicy');

assert.deepEqual(CLEANUP_TASK_STATUSES, ['failed', 'cancelled', 'bidding']);
assert.equal(shouldCleanupTaskStatus('failed'), true);
assert.equal(shouldCleanupTaskStatus('cancelled'), true);
assert.equal(shouldCleanupTaskStatus('bidding'), true);
assert.equal(shouldCleanupTaskStatus('success'), false);
assert.equal(shouldCleanupTaskStatus('pending'), false);
assert.equal(shouldCleanupTaskStatus('processing'), false);
assert.equal(PRESERVED_TASK_STATUSES.includes('success'), true);
assert.match(buildCleanupScopeDescription(), /failed/);
assert.match(buildCleanupScopeDescription(), /success/);

console.log('data cleanup policy tests passed');
