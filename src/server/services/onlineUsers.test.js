const assert = require('assert/strict');
const {
  buildOnlineUsersQuery,
  recordClientSession,
  touchClientSession,
  getExpiryIso
} = require('./onlineUsers');

function testBuildOnlineUsersQueryOnlyIncludesUnexpiredClientUsers() {
  const query = buildOnlineUsersQuery();

  assert.match(query.sql, /FROM user_sessions s/);
  assert.match(query.sql, /s\.role = 'user'/);
  assert.match(query.sql, /u\.role = 'user'/);
  assert.match(query.sql, /datetime\(s\.expires_at\) > datetime\('now'\)/);
  assert.match(query.sql, /COUNT\(\*\) AS session_count/);
  assert.match(query.sql, /GROUP BY u\.id/);
}

async function testRecordClientSessionSkipsAdminAndRecordsUser() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const adminResult = await recordClientSession(fakeDb, {
    user: { id: 1, username: 'admin', role: 'admin' },
    tokenId: 'admin-token'
  });
  assert.equal(adminResult.skipped, true);
  assert.equal(calls.length, 0);

  await recordClientSession(fakeDb, {
    user: { id: 2, username: 'client', role: 'user', user_level: 2 },
    tokenId: 'client-token',
    expiresAt: '2026-06-20T00:00:00.000Z',
    userAgent: 'browser'
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO user_sessions/);
  assert.deepEqual(calls[0].params, [2, 'client-token', 'client', 'user', 2, '2026-06-20T00:00:00.000Z', 'browser']);
}

async function testTouchClientSessionOnlyTouchesUserRole() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const adminResult = await touchClientSession(fakeDb, { tokenId: 'admin-token', role: 'admin' });
  assert.equal(adminResult.skipped, true);
  assert.equal(calls.length, 0);

  await touchClientSession(fakeDb, { tokenId: 'client-token', role: 'user' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /UPDATE user_sessions/);
  assert.deepEqual(calls[0].params, ['client-token']);
}

function testExpiryUsesSevenDayTtl() {
  assert.equal(getExpiryIso(Date.parse('2026-06-13T00:00:00.000Z')), '2026-06-20T00:00:00.000Z');
}

testBuildOnlineUsersQueryOnlyIncludesUnexpiredClientUsers();
testExpiryUsesSevenDayTtl();
Promise.all([
  testRecordClientSessionSkipsAdminAndRecordsUser(),
  testTouchClientSessionOnlyTouchesUserRole()
]).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
