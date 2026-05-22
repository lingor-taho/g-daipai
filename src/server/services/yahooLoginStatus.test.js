const assert = require('assert/strict');
const {
  buildYahooLoginStatus,
  isYahooLoginError
} = require('./yahooLoginStatus');

function testMissingYahooLoginStatusIsUnknown() {
  assert.deepEqual(buildYahooLoginStatus(null, null), {
    status: 'unknown',
    message: '',
    updatedAt: null
  });
}

function testFailedYahooLoginStatusIsPreserved() {
  assert.deepEqual(
    buildYahooLoginStatus(
      { value: 'failed', updated_at: '2026-05-22 12:00:00' },
      { value: '需要登录 Yahoo' }
    ),
    {
      status: 'failed',
      message: '需要登录 Yahoo',
      updatedAt: '2026-05-22 12:00:00'
    }
  );
}

function testOkYahooLoginStatusIsPreserved() {
  assert.equal(buildYahooLoginStatus({ value: 'ok' }, null).status, 'ok');
}

function testYahooLoginErrorMatchesChineseAndJapanese() {
  assert.equal(isYahooLoginError('需要登录 Yahoo'), true);
  assert.equal(isYahooLoginError('ログインしてください'), true);
  assert.equal(isYahooLoginError('normal bid error'), false);
}

testMissingYahooLoginStatusIsUnknown();
testFailedYahooLoginStatusIsPreserved();
testOkYahooLoginStatusIsPreserved();
testYahooLoginErrorMatchesChineseAndJapanese();
