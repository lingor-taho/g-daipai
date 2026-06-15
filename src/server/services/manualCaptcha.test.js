const assert = require('assert/strict');
const {
  saveCaptchaChallenge,
  getCaptchaChallenge,
  answerCaptchaChallenge,
  closeCaptchaChallenge
} = require('./manualCaptcha');

function createFakeDb() {
  const store = new Map();
  return {
    async query(sql, params) {
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
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
