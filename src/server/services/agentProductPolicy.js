const { getClientUser } = require('./actingUser');

const policyKey = id => `agent_product_policy:${id}`;
const validPolicy = value => ['exclusive', 'confirm', 'allow'].includes(value);

async function getPolicy(database, userId) {
  const user = await getClientUser(userId, database);
  if (!user) return { agentId: null, policy: 'allow' };
  const agent = Number(user.user_level) === 2 ? user
    : Number(user.user_level) === 1 && user.parent_user_id
      ? await getClientUser(user.parent_user_id, database) : null;
  if (Number(agent?.user_level) !== 2) return { agentId: null, policy: 'allow' };
  const saved = await database.getOne('SELECT value FROM config WHERE key=?', [policyKey(agent.id)]);
  return { agentId: agent.id, policy: validPolicy(saved?.value) ? saved.value : 'exclusive' };
}

// Read only: this never reserves an account or creates/rejects a task.
async function checkProducts(database, userId, productIds) {
  const result = await getPolicy(database, userId);
  if (!result.agentId || result.policy === 'allow' || !productIds.length) return { ...result, conflicts: [] };
  const rows = await database.getAll(
    `SELECT DISTINCT t.product_id FROM tasks t JOIN users u ON u.id=t.user_id
     WHERE t.user_id<>? AND u.role='user'
       AND (u.id=? OR (u.parent_user_id=? AND COALESCE(u.user_level,1)=1))
       AND t.product_id IN (${productIds.map(() => '?').join(',')})
       AND NOT EXISTS (
         SELECT 1 FROM tasks own WHERE own.user_id=? AND own.product_id=t.product_id
       )`,
    [userId, result.agentId, result.agentId, ...productIds, userId]
  );
  return { ...result, conflicts: rows.map(row => row.product_id) };
}

module.exports = { policyKey, validPolicy, getPolicy, checkProducts };
