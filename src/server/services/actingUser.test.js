const assert = require('assert/strict');
const {
  getAllowedActingUsers,
  resolveActingUserId
} = require('./actingUser');

const users = [
  { id: 1, username: 'normal', role: 'user', user_level: 1, parent_user_id: 2 },
  { id: 2, username: 'agent', role: 'user', user_level: 2, parent_user_id: 4 },
  { id: 3, username: 'child', role: 'user', user_level: 1, parent_user_id: 2 },
  { id: 4, username: 'client-admin', role: 'user', user_level: 3, parent_user_id: null },
  { id: 5, username: 'nested', role: 'user', user_level: 1, parent_user_id: 3 },
  { id: 6, username: 'server-admin', role: 'admin', user_level: 1, parent_user_id: null }
];

function createDatabase() {
  return {
    async getOne(sql, params) {
      if (/WHERE id = \? AND role = 'user'/.test(sql)) {
        return users.find(user => user.id === Number(params[0]) && user.role === 'user') || null;
      }
      return null;
    },
    async getAll(sql, params = []) {
      if (/WHERE role = 'user' AND COALESCE\(user_level, 1\) < 3/.test(sql)) {
        return users
          .filter(user => user.role === 'user' && Number(user.user_level || 1) < 3)
          .sort((a, b) => a.username.localeCompare(b.username));
      }
      if (/parent_user_id = \?/.test(sql)) {
        const userId = Number(params[0]);
        return users
          .filter(user => user.role === 'user' && (user.id === userId || user.parent_user_id === userId))
          .sort((a, b) => {
            if (a.id === userId) return -1;
            if (b.id === userId) return 1;
            return a.username.localeCompare(b.username);
          });
      }
      return [];
    }
  };
}

async function testNormalUserOnlyActsAsSelf() {
  const allowed = await getAllowedActingUsers(1, createDatabase());

  assert.deepEqual(allowed.map(user => user.username), ['normal']);
}

async function testAgentActsAsSelfAndDirectChildrenOnly() {
  const allowed = await getAllowedActingUsers(2, createDatabase());

  assert.deepEqual(allowed.map(user => user.username), ['agent', 'child', 'normal']);
  assert.equal(allowed.some(user => user.username === 'nested'), false);
}

async function testClientAdminActsAsAllNonAdminGroupUsers() {
  const allowed = await getAllowedActingUsers(4, createDatabase());

  assert.deepEqual(allowed.map(user => user.username), ['agent', 'child', 'nested', 'normal']);
  assert.equal(allowed.some(user => user.username === 'client-admin'), false);
}

async function testResolveRejectsUnauthorizedActingUser() {
  await assert.rejects(
    () => resolveActingUserId(2, 5, createDatabase()),
    /no permission/
  );
}

async function run() {
  await testNormalUserOnlyActsAsSelf();
  await testAgentActsAsSelfAndDirectChildrenOnly();
  await testClientAdminActsAsAllNonAdminGroupUsers();
  await testResolveRejectsUnauthorizedActingUser();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
