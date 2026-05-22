const db = require('../models');

function normalizeLevel(value) {
  const level = Number(value || 1);
  return [1, 2, 3].includes(level) ? level : 1;
}

async function getClientUser(userId, database = db) {
  if (!userId) return null;
  return database.getOne(
    `SELECT id, username, role, COALESCE(user_level, 1) AS user_level, parent_user_id
     FROM users
     WHERE id = ? AND role = 'user'`,
    [userId]
  );
}

async function getAllowedActingUsers(userId, database = db) {
  const currentUser = await getClientUser(userId, database);
  if (!currentUser) return [];
  const level = normalizeLevel(currentUser.user_level);

  if (level >= 3) {
    return database.getAll(
      `SELECT id, username, role, COALESCE(user_level, 1) AS user_level, parent_user_id
       FROM users
       WHERE role = 'user' AND COALESCE(user_level, 1) < 3
       ORDER BY username ASC`
    );
  }

  if (level >= 2) {
    return database.getAll(
      `SELECT id, username, role, COALESCE(user_level, 1) AS user_level, parent_user_id
       FROM users
       WHERE role = 'user'
         AND (id = ? OR parent_user_id = ?)
       ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, username ASC`,
      [currentUser.id, currentUser.id, currentUser.id]
    );
  }

  return [currentUser];
}

async function resolveActingUserId(loginUserId, requestedUserId, database = db) {
  const allowedUsers = await getAllowedActingUsers(loginUserId, database);
  if (!allowedUsers.length) {
    const error = new Error('acting user is not available');
    error.statusCode = 403;
    throw error;
  }

  const selectedId = requestedUserId ? Number(requestedUserId) : Number(allowedUsers[0].id);
  const actingUser = allowedUsers.find(user => Number(user.id) === selectedId);
  if (!actingUser) {
    const error = new Error('no permission for selected user');
    error.statusCode = 403;
    throw error;
  }

  return {
    actingUserId: Number(actingUser.id),
    actingUser,
    allowedUsers
  };
}

async function actingUserMiddleware(req, res, next) {
  try {
    const requestedUserId =
      req.headers['x-acting-user-id'] ||
      req.query.acting_user_id ||
      req.body?.acting_user_id;
    const result = await resolveActingUserId(req.user?.id, requestedUserId);
    req.actingUser = result.actingUser;
    req.allowedActingUsers = result.allowedUsers;
    next();
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}

module.exports = {
  normalizeLevel,
  getAllowedActingUsers,
  resolveActingUserId,
  actingUserMiddleware
};
