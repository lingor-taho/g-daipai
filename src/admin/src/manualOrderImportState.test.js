const assert = require('assert/strict');
const {
  formatManualOrderImportFlag,
  getManualOrderImportStatusView,
  canClearManualOrderImportBatch,
  shouldEditManualImportShippingFee,
  shouldAutoRefreshManualOrderImportBatch
} = require('./manualOrderImportState');

function testReadyWithCandidatesNeedsAssignment() {
  const view = getManualOrderImportStatusView({ status: 'ready', candidate_count: 2 });

  assert.equal(view.label, '待分配用户');
  assert.equal(view.canConfirm, true);
  assert.equal(view.isCompleteWithoutCandidates, false);
}

function testReadyWithoutCandidatesIsComplete() {
  const view = getManualOrderImportStatusView({
    status: 'ready',
    candidate_count: 0,
    skipped_existing_count: 5
  });

  assert.equal(view.label, '读取完成（无新订单）');
  assert.equal(view.canConfirm, false);
  assert.equal(view.isCompleteWithoutCandidates, true);
}

function testOnlyActiveScanStatusesAutoRefresh() {
  assert.equal(shouldAutoRefreshManualOrderImportBatch({ status: 'requested' }), true);
  assert.equal(shouldAutoRefreshManualOrderImportBatch({ status: 'scanning' }), true);
  assert.equal(shouldAutoRefreshManualOrderImportBatch({ status: 'ready', candidate_count: 1 }), false);
  assert.equal(shouldAutoRefreshManualOrderImportBatch({ status: 'failed' }), false);
}

function testManualOrderImportFlagOnlyShowsQueueState() {
  assert.equal(formatManualOrderImportFlag({ manualOrderImportFlag: 1, manualOrderImportReady: 3 }), '1');
  assert.equal(formatManualOrderImportFlag({ manualOrderImportFlag: 0, manualOrderImportReady: 3 }), '0');
}

function testOnlyAmbiguousShippingFeesAreEditable() {
  assert.equal(shouldEditManualImportShippingFee('送料 落札者負担'), true);
  assert.equal(shouldEditManualImportShippingFee('着払い'), true);
  assert.equal(shouldEditManualImportShippingFee('送料 780円'), false);
  assert.equal(shouldEditManualImportShippingFee('送料無料'), false);
}

testReadyWithCandidatesNeedsAssignment();
testReadyWithoutCandidatesIsComplete();
testOnlyActiveScanStatusesAutoRefresh();
testManualOrderImportFlagOnlyShowsQueueState();
testOnlyAmbiguousShippingFeesAreEditable();

function testCurrentImportBatchCanBeClearedWhenLoaded() {
  assert.equal(canClearManualOrderImportBatch({ id: 9, status: 'confirmed' }), true);
  assert.equal(canClearManualOrderImportBatch({ id: 10, status: 'ready' }), true);
  assert.equal(canClearManualOrderImportBatch(null), false);
  assert.equal(canClearManualOrderImportBatch({}), false);
}

testCurrentImportBatchCanBeClearedWhenLoaded();
