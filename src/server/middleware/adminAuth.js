function adminAuthMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'admin account required' });
  }
  next();
}

module.exports = adminAuthMiddleware;
