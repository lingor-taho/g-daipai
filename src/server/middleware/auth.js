const jwt = require('jsonwebtoken');
const config = require('../../config');
const db = require('../models');
const { syncClientSession } = require('../services/onlineUsers');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = payload;
    syncClientSession(db, {
      user: payload,
      tokenId: payload.jti,
      token,
      expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined,
      userAgent: req.headers['user-agent'] || ''
    }).catch(() => null);
    next();
  } catch {
    return res.status(401).json({ error: 'token 无效' });
  }
}

module.exports = authMiddleware;
