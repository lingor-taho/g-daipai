const MANUAL_CAPTCHA_CONFIG_KEY = 'manual_captcha_challenge';
const MAX_IMAGE_DATA_URL_LENGTH = 5 * 1024 * 1024;

function normalizeCaptchaId(value) {
  return String(value || '').trim().slice(0, 96);
}

function normalizeCaptchaAnswer(value) {
  return String(value || '').trim().slice(0, 32);
}

function normalizeCaptchaChallenge(payload = {}) {
  const id = normalizeCaptchaId(payload.id);
  const type = payload.type === 'pin' ? 'pin' : 'captcha';
  const imageDataUrl = String(payload.imageDataUrl || '').trim();
  if (!id) {
    const error = new Error('captcha id is required');
    error.statusCode = 400;
    throw error;
  }
  if (type === 'captcha' && (!/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(imageDataUrl) || imageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH)) {
    const error = new Error('valid captcha imageDataUrl is required');
    error.statusCode = 400;
    throw error;
  }
  return {
    id,
    type,
    imageDataUrl: type === 'captcha' ? imageDataUrl : '',
    message: String(payload.message || '').trim().slice(0, 200),
    pageUrl: String(payload.pageUrl || '').slice(0, 1000),
    productId: String(payload.productId || '').trim().slice(0, 32),
    source: String(payload.source || '').trim().slice(0, 64),
    createdAt: new Date().toISOString(),
    answer: '',
    answeredAt: '',
    closedAt: ''
  };
}

async function saveCaptchaChallenge(database, payload) {
  const challenge = normalizeCaptchaChallenge(payload);
  const current = await getCaptchaChallenge(database);
  const next = current?.id === challenge.id && current.answeredAt
    ? {
        ...challenge,
        answer: current.answer || '',
        answeredAt: current.answeredAt || ''
      }
    : challenge;
  await database.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)`,
    [MANUAL_CAPTCHA_CONFIG_KEY, JSON.stringify(next)]
  );
  return next;
}

async function getCaptchaChallenge(database) {
  const row = await database.getOne(
    `SELECT value FROM config WHERE key = ?`,
    [MANUAL_CAPTCHA_CONFIG_KEY]
  );
  if (!row?.value) return null;
  try {
    const challenge = JSON.parse(row.value);
    if (!challenge?.id || challenge.closedAt) return null;
    return challenge;
  } catch {
    return null;
  }
}

async function answerCaptchaChallenge(database, payload = {}) {
  const id = normalizeCaptchaId(payload.id);
  const answer = normalizeCaptchaAnswer(payload.answer);
  if (!id || !answer) {
    const error = new Error('captcha id and answer are required');
    error.statusCode = 400;
    throw error;
  }
  const challenge = await getCaptchaChallenge(database);
  if (!challenge || challenge.id !== id) {
    const error = new Error('captcha challenge not found');
    error.statusCode = 404;
    throw error;
  }
  const next = {
    ...challenge,
    answer,
    answeredAt: new Date().toISOString()
  };
  await database.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)`,
    [MANUAL_CAPTCHA_CONFIG_KEY, JSON.stringify(next)]
  );
  return next;
}

async function closeCaptchaChallenge(database, id) {
  const challenge = await getCaptchaChallenge(database);
  if (!challenge || (id && challenge.id !== normalizeCaptchaId(id))) {
    return { closed: 0 };
  }
  const next = {
    ...challenge,
    closedAt: new Date().toISOString()
  };
  await database.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)`,
    [MANUAL_CAPTCHA_CONFIG_KEY, JSON.stringify(next)]
  );
  return { closed: 1 };
}

module.exports = {
  MANUAL_CAPTCHA_CONFIG_KEY,
  normalizeCaptchaAnswer,
  saveCaptchaChallenge,
  getCaptchaChallenge,
  answerCaptchaChallenge,
  closeCaptchaChallenge
};
