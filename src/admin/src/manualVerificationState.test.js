const assert = require('assert/strict');
const { getManualVerificationDisplayState } = require('./manualVerificationState');

function testAnsweredPinShowsConfirmingInsteadOfInput() {
  const view = getManualVerificationDisplayState(
    { id: 'pin-1', type: 'pin', answeredAt: '2026-06-15T10:00:00.000Z' },
    {}
  );

  assert.equal(view.visible, true);
  assert.equal(view.status, 'confirming');
  assert.equal(view.showInput, false);
  assert.equal(view.title, '服务器确认中');
}

function testLocallySubmittedPinShowsConfirmingBeforeNextPoll() {
  const view = getManualVerificationDisplayState(
    { id: 'pin-1', type: 'pin', answeredAt: '' },
    { submittedChallengeId: 'pin-1' }
  );

  assert.equal(view.status, 'confirming');
  assert.equal(view.showInput, false);
}

function testNewPinChallengeShowsInputAgainAfterFailure() {
  const view = getManualVerificationDisplayState(
    { id: 'pin-2', type: 'pin', answeredAt: '', message: '上次 PIN 码可能错误，请重新输入 PIN 码' },
    { submittedChallengeId: 'pin-1' }
  );

  assert.equal(view.status, 'input');
  assert.equal(view.showInput, true);
}

function testSubmittedCaptchaCanShowPassedNoticeAfterChallengeCloses() {
  const view = getManualVerificationDisplayState(null, { passedChallengeType: 'captcha' });

  assert.equal(view.visible, true);
  assert.equal(view.status, 'passed');
  assert.equal(view.showInput, false);
  assert.equal(view.title, '验证通过！');
}

testAnsweredPinShowsConfirmingInsteadOfInput();
testLocallySubmittedPinShowsConfirmingBeforeNextPoll();
testNewPinChallengeShowsInputAgainAfterFailure();
testSubmittedCaptchaCanShowPassedNoticeAfterChallengeCloses();
