const CLEANUP_TASK_STATUSES = Object.freeze(['failed', 'cancelled', 'bidding']);
const PRESERVED_TASK_STATUSES = Object.freeze(['success', 'pending', 'processing']);

function shouldCleanupTaskStatus(status) {
  return CLEANUP_TASK_STATUSES.includes(String(status || ''));
}

function buildCleanupStatusSqlList() {
  return CLEANUP_TASK_STATUSES.map(status => `'${status}'`).join(', ');
}

function buildCleanupScopeDescription() {
  return 'Deletes stale failed, cancelled, and bidding tasks plus related bid logs, orders, and bidding cache; preserves success won-order data.';
}

module.exports = {
  CLEANUP_TASK_STATUSES,
  PRESERVED_TASK_STATUSES,
  shouldCleanupTaskStatus,
  buildCleanupStatusSqlList,
  buildCleanupScopeDescription
};
