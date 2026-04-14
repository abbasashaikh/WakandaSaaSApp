// middleware/keyAuth.js
// ============================================================
// Validates X-License-Key header on every protected route
// ============================================================
const { getUserByKey } = require('../db');

function keyAuth(req, res, next) {
  const licenseKey = req.headers['x-license-key'];

  if (!licenseKey) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Missing X-License-Key header',
    });
  }

  const user = getUserByKey(licenseKey);

  if (!user) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Invalid or inactive license key',
    });
  }

  // Attach user to request for downstream use
  req.user = user;
  req.licenseKey = licenseKey;

  next();
}

module.exports = keyAuth;
