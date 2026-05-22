const express = require('express');
const router = express.Router();
const db = require('../models');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../../config');
const authMiddleware = require('../middleware/auth');
const { getAllowedActingUsers } = require('../services/actingUser');

function signUserToken(user) {
  const role = user.role || 'user';
  return jwt.sign(
    { id: user.id, username: user.username, role, user_level: user.user_level || 1 },
    config.jwtSecret,
    { expiresIn: '7d' }
  );
}

async function verifyUser(username, password) {
  if (!username || !password) {
    const err = new Error('username and password are required');
    err.status = 400;
    throw err;
  }

  const user = await db.getOne('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) {
    const err = new Error('invalid username or password');
    err.status = 401;
    throw err;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const err = new Error('invalid username or password');
    err.status = 401;
    throw err;
  }

  return user;
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const user = await verifyUser(req.body.username, req.body.password);
    const role = user.role || 'user';
    const token = signUserToken(user);
    res.json({ success: true, token, username: user.username, role, userLevel: Number(user.user_level || 1) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'login failed' });
  }
});

// POST /api/auth/admin-login
router.post('/admin-login', async (req, res) => {
  try {
    const user = await verifyUser(req.body.username, req.body.password);
    if ((user.role || 'user') !== 'admin') {
      return res.status(403).json({ error: 'admin account required' });
    }
    const token = signUserToken(user);
    res.json({ success: true, token, username: user.username, role: 'admin' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'login failed' });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const existing = await db.getOne('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return res.status(409).json({ error: 'username already exists' });

  const hash = await bcrypt.hash(password, 10);
  try {
    await db.query(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [username, hash, 'user']
    );
  } catch (err) {
    return res.status(500).json({ error: 'server error' });
  }
  const inserted = await db.getOne('SELECT last_insert_rowid() as id');
  res.json({ success: true, id: inserted.id, role: 'user' });
});

router.get('/acting-users', authMiddleware, async (req, res) => {
  const users = await getAllowedActingUsers(req.user.id);
  res.json({
    success: true,
    data: users,
    defaultUserId: users[0]?.id || null
  });
});

module.exports = router;
