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

for (const message of ['需要邮箱验证码。', '60秒未收到验证码，请重试', 'gmail验证码填入错误，请重试']) {
  const view = getManualVerificationDisplayState({ id: 'email-2', type: 'email', message, phase: message === '需要邮箱验证码。' ? 'waiting' : 'error' }, { submittedChallengeId: 'email-1' });
  assert.equal(view.title, message);
  assert.equal(view.showInput, false);
  assert.equal(view.showContinue, true);
}
const pendingEmail = getManualVerificationDisplayState({ id: 'email-1', type: 'email', answeredAt: 'now', phase: 'processing' });
assert.equal(pendingEmail.status, 'confirming');
assert.equal(Boolean(pendingEmail.showContinue), false);
assert.equal(getManualVerificationDisplayState(null, { passedChallengeType: 'email' }).visible, false);
const terminalEmail = getManualVerificationDisplayState({ id: 'email-terminal', type: 'email', phase: 'error', message: '邮箱跳第三次验证，请人工处理！' });
assert.equal(terminalEmail.title, '邮箱跳第三次验证，请人工处理！');
assert.equal(terminalEmail.status, 'error');
assert.equal(terminalEmail.showContinue, false);
for (const phase of ['waiting', 'error']) {
  const view = getManualVerificationDisplayState({ id: 'login-1', type: 'login', phase, message: '登录方式跳第三次验证，请人工处理！' });
  assert.equal(view.showInput, false);
  assert.equal(view.showContinue, false);
  assert.equal(view.status, phase === 'error' ? 'error' : 'confirming');
}

const secondEmail = getManualVerificationDisplayState({ id: 'email-second', type: 'email', message: '第二次邮箱验证', phase: 'waiting' });
assert.equal(secondEmail.continueLabel, '第二次邮箱验证 继续');
assert.equal(secondEmail.showContinue, true);
