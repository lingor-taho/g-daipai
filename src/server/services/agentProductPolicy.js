const policyKey = id => `agent_product_policy:${id}`;
const validPolicy = value => ['exclusive', 'confirm', 'allow'].includes(value);
const agentQuery = `SELECT a.id FROM users u JOIN users a ON a.id=CASE
  WHEN COALESCE(u.user_level,1)=2 THEN u.id
  WHEN COALESCE(u.user_level,1)=1 THEN u.parent_user_id END
  WHERE u.id=? AND u.role='user' AND a.role='user' AND COALESCE(a.user_level,1)=2`;
const conflictQuery = ids => `SELECT DISTINCT t.product_id FROM tasks t JOIN users u ON u.id=t.user_id
  WHERE t.user_id<>? AND u.role='user'
    AND (u.id=? OR (u.parent_user_id=? AND COALESCE(u.user_level,1)=1))
    AND t.product_id IN (${ids.map(() => '?').join(',')})
    AND NOT EXISTS (SELECT 1 FROM tasks own WHERE own.user_id=? AND own.product_id=t.product_id)`;
const conflictParams = (userId, agentId, ids) => [userId, agentId, agentId, ...ids, userId];
const policyResult = (agent, saved) => agent
  ? { agentId: agent.id, policy: validPolicy(saved?.value) ? saved.value : 'exclusive' }
  : { agentId: null, policy: 'allow' };

async function getPolicy(database, userId) {
  const agent = await database.getOne(agentQuery, [userId]);
  const saved = agent ? await database.getOne('SELECT value FROM config WHERE key=?', [policyKey(agent.id)]) : null;
  return policyResult(agent, saved);
}

// Read only: this never reserves an account or creates/rejects a task.
async function checkProducts(database, userId, productIds) {
  const result = await getPolicy(database, userId);
  if (!result.agentId || result.policy === 'allow' || !productIds.length) return { ...result, conflicts: [] };
  const rows = await database.getAll(conflictQuery(productIds), conflictParams(userId, result.agentId, productIds));
  return { ...result, conflicts: rows.map(row => row.product_id) };
}

// Must run inside the task-creation write transaction. Reuse the preview's
// group/ownership queries so preflight and final submission cannot disagree.
function assertSubmissionAllowed(raw, userId, productId) {
  const agent = raw.prepare(agentQuery).get(userId);
  const saved = agent ? raw.prepare('SELECT value FROM config WHERE key=?').get(policyKey(agent.id)) : null;
  const { agentId, policy } = policyResult(agent, saved);
  if (!agentId || policy !== 'exclusive') return;
  if (raw.prepare(`${conflictQuery([productId])} LIMIT 1`).get(...conflictParams(userId,agentId,[productId]))) {
    throw Object.assign(new Error('代理组内该商品有人提交，请联系代理！'), { statusCode: 409 });
  }
}

module.exports = { policyKey, validPolicy, getPolicy, checkProducts, assertSubmissionAllowed };
