const assert = require('assert/strict');
const {
  saveCaptchaChallenge,
  getCaptchaChallenge,
  answerCaptchaChallenge,
  requestEmailVerification,
  claimEmailVerification,
  closeCaptchaChallenge
} = require('./manualCaptcha');

function createFakeDb() {
  const store = new Map();
  return {
    async query(sql, params) {
      if (/UPDATE config/.test(sql)) {
        if (store.get(params[1]) !== params[2]) return { rowCount: 0 };
        store.set(params[1], params[0]);
        return { rowCount: 1 };
      }
      store.set(params[0], params[1]);
      return { rowCount: 1 };
    },
    async getOne(sql, params) {
      const value = store.get(params[0]);
      return value ? { value } : null;
    }
  };
}

async function testCaptchaChallengeCanBeAnswered() {
  const db = createFakeDb();
  const imageDataUrl = 'data:image/png;base64,' + Buffer.from('captcha').toString('base64');

  const saved = await saveCaptchaChallenge(db, {
    id: 'captcha-u123-1',
    imageDataUrl,
    pageUrl: 'https://login.yahoo.co.jp/ncaptcha?fido=1',
    productId: 'u1231877298',
    source: 'transaction_contact'
  });
  assert.equal(saved.answer, '');

  const answered = await answerCaptchaChallenge(db, {
    id: 'captcha-u123-1',
    answer: 'あいうえお'
  });
  assert.equal(answered.answer, 'あいうえお');
  assert.ok(answered.answeredAt);

  const current = await getCaptchaChallenge(db);
  assert.equal(current.answer, 'あいうえお');
}

async function testCaptchaChallengeCanBeClosed() {
  const db = createFakeDb();
  const imageDataUrl = 'data:image/png;base64,' + Buffer.from('captcha').toString('base64');

  await saveCaptchaChallenge(db, { id: 'captcha-1', imageDataUrl });
  const result = await closeCaptchaChallenge(db, 'captcha-1');
  assert.equal(result.closed, 1);
  assert.equal(await getCaptchaChallenge(db), null);
}

async function testPinChallengeCanBeAnsweredWithoutImage() {
  const db = createFakeDb();

  await saveCaptchaChallenge(db, {
    id: 'pin-u123-1',
    type: 'pin',
    message: 'Yahoo PIN码验证',
    productId: 'u1231877298'
  });
  const answered = await answerCaptchaChallenge(db, {
    id: 'pin-u123-1',
    answer: '123456'
  });

  assert.equal(answered.type, 'pin');
  assert.equal(answered.answer, '123456');
}

async function testSameAnsweredPinChallengeIsKeptConfirmingWhenReposted() {
  const db = createFakeDb();

  await saveCaptchaChallenge(db, {
    id: 'pin-u123-1',
    type: 'pin',
    message: 'Yahoo PIN check',
    productId: 'u1231877298'
  });
  const answered = await answerCaptchaChallenge(db, {
    id: 'pin-u123-1',
    answer: '123456'
  });

  const reposted = await saveCaptchaChallenge(db, {
    id: 'pin-u123-1',
    type: 'pin',
    message: 'Yahoo PIN check',
    productId: 'u1231877298'
  });

  assert.equal(reposted.answer, '123456');
  assert.equal(reposted.answeredAt, answered.answeredAt);
  const current = await getCaptchaChallenge(db);
  assert.equal(current.answer, '123456');
  assert.equal(current.answeredAt, answered.answeredAt);
}

async function testPinRetryChallengeCanResetAnsweredState() {
  const db = createFakeDb();

  await saveCaptchaChallenge(db, {
    id: 'pin-u123-1',
    type: 'pin',
    message: 'Yahoo PIN check',
    productId: 'u1231877298'
  });
  await answerCaptchaChallenge(db, {
    id: 'pin-u123-1',
    answer: '123456'
  });

  const retry = await saveCaptchaChallenge(db, {
    id: 'pin-u123-2',
    type: 'pin',
    message: 'last PIN was wrong, retry PIN',
    productId: 'u1231877298'
  });

  assert.equal(retry.id, 'pin-u123-2');
  assert.equal(retry.answer, '');
  assert.equal(retry.answeredAt, '');
}

async function run() {
  await testCaptchaChallengeCanBeAnswered();
  await testCaptchaChallengeCanBeClosed();
  await testPinChallengeCanBeAnsweredWithoutImage();
  await testSameAnsweredPinChallengeIsKeptConfirmingWhenReposted();
  await testPinRetryChallengeCanResetAnsweredState();
  await testEmailContinueAndClaimAreOneShot();
}

async function testEmailContinueAndClaimAreOneShot() {
  const db = createFakeDb();
  await saveCaptchaChallenge(db, { id: 'email-1', type: 'email', tabId: 7 });
  await assert.rejects(answerCaptchaChallenge(db, { id: 'email-1', answer: '123456' }), /use continue/);
  const requested = await requestEmailVerification(db, { id: 'email-1' });
  assert.equal(requested.phase, 'requested');
  assert.equal((await requestEmailVerification(db, { id: 'email-1' })).answeredAt, requested.answeredAt);
  const claims = await Promise.all([claimEmailVerification(db, { id: 'email-1' }), claimEmailVerification(db, { id: 'email-1' })]);
  assert.equal(claims.filter(result => result.claimed).length, 1);
  assert.equal((await claimEmailVerification(db, { id: 'email-1' })).claimed, false);
  assert.equal((await saveCaptchaChallenge(db, { id: 'email-1', type: 'email' })).phase, 'processing');
  const retry = await saveCaptchaChallenge(db, { id: 'email-2', expectedId: 'email-1', type: 'email', tabId: 7, phase: 'error', message: '60秒未收到验证码，请重试' });
  assert.equal(retry.answer, '');
  assert.equal(retry.answeredAt, '');
  assert.equal((await claimEmailVerification(db, { id: 'email-2' })).claimed, false);
  await assert.rejects(requestEmailVerification(db, { id: 'email-1' }), /not found/);
  await assert.rejects(saveCaptchaChallenge(db, { id: 'email-stale', expectedId: 'email-1', type: 'email' }), /changed/);
  assert.equal((await getCaptchaChallenge(db)).id, 'email-2');
  await requestEmailVerification(db, { id: 'email-2' });
  assert.equal((await claimEmailVerification(db, { id: 'email-2' })).claimed, true);
  await closeCaptchaChallenge(db, 'email-2');
  assert.equal((await claimEmailVerification(db, { id: 'email-2' })).claimed, false);
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
