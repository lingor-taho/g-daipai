const crypto = require('crypto');

const CLIENT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function createTokenId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function getExpiryIso(nowMs = Date.now(), ttlSeconds = CLIENT_SESSION_TTL_SECONDS) {
  return new Date(nowMs + ttlSeconds * 1000).toISOString();
}

async function recordClientSession(database, { user, tokenId, expiresAt, userAgent = '' }) {
  if (!user || (user.role || 'user') !== 'user') return { skipped: true };
  const normalizedTokenId = String(tokenId || '').trim();
  if (!normalizedTokenId) return { skipped: true };
  return database.query(
    `INSERT INTO user_sessions (
       user_id, token_id, username, role, user_level, login_at, last_seen_at, expires_at, user_agent
     ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?)
     ON CONFLICT(token_id) DO UPDATE SET
       user_id = excluded.user_id,
       username = excluded.username,
       role = excluded.role,
       user_level = excluded.user_level,
       last_seen_at = CURRENT_TIMESTAMP,
       expires_at = excluded.expires_at,
       user_agent = excluded.user_agent`,
    [
      user.id,
      normalizedTokenId,
      user.username || '',
      user.role || 'user',
      Number(user.user_level || 1),
      expiresAt || getExpiryIso(),
      String(userAgent || '').slice(0, 512)
    ]
  );
}

async function touchClientSession(database, { tokenId, role }) {
  if ((role || 'user') !== 'user') return { skipped: true };
  const normalizedTokenId = String(tokenId || '').trim();
  if (!normalizedTokenId) return { skipped: true };
  return database.query(
    `UPDATE user_sessions
     SET last_seen_at = CURRENT_TIMESTAMP
     WHERE token_id = ?
       AND role = 'user'
       AND datetime(expires_at) > datetime('now')`,
    [normalizedTokenId]
  );
}

function buildOnlineUsersQuery() {
  return {
    sql: `SELECT u.id AS user_id,
                 u.username,
                 COALESCE(u.user_level, s.user_level, 1) AS user_level,
                 COUNT(*) AS session_count,
                 MAX(s.login_at) AS latest_login_at,
                 MAX(s.last_seen_at) AS latest_seen_at,
                 MAX(s.expires_at) AS latest_expires_at
          FROM user_sessions s
          INNER JOIN users u ON u.id = s.user_id
          WHERE s.role = 'user'
            AND u.role = 'user'
            AND datetime(s.expires_at) > datetime('now')
          GROUP BY u.id, u.username, COALESCE(u.user_level, s.user_level, 1)
          ORDER BY datetime(latest_seen_at) DESC, u.username ASC`,
    params: []
  };
}

async function getOnlineUsers(database) {
  const query = buildOnlineUsersQuery();
  const items = await database.getAll(query.sql, query.params);
  return { items, total: items.length };
}

module.exports = {
  CLIENT_SESSION_TTL_SECONDS,
  createTokenId,
  getExpiryIso,
  recordClientSession,
  touchClientSession,
  buildOnlineUsersQuery,
  getOnlineUsers
};
