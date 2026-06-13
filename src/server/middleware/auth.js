const jwt = require('jsonwebtoken');
const config = require('../../config');
const db = require('../models');
const { touchClientSession } = require('../services/onlineUsers');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = payload;
    touchClientSession(db, { tokenId: payload.jti, role: payload.role }).catch(() => null);
    next();
  } catch {
    return res.status(401).json({ error: 'token 无效' });
  }
}

module.exports = authMiddleware;
