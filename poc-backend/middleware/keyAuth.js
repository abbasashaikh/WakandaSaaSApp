// middleware/keyAuth.js — Phase 2 dual-mode auth
// ─────────────────────────────────────────────────────────────────────────────
// Accepts EITHER:
//   Authorization: Bearer <accessToken>   ← new JWT flow (Phase 2+)
//   X-License-Key: <licenseKey>           ← legacy flow (backward compat)
//
// WHY DUAL-MODE:
//   The Electron app currently sends X-License-Key on every request.
//   We cannot break existing clients during the migration.
//   Dual-mode lets us ship Phase 2 server-side changes while the client
//   migrates to JWT in Phase 2b (Electron-side changes).
//
// SECURITY PROPERTIES:
//   JWT path: no DB query — stateless validation using JWT_SECRET
//   Legacy path: one DB query per request (acceptable for POC/migration period)
//   Both paths: attach full user object including role to req.user
//   Both paths: log auth failure with structured event for audit trail
// ─────────────────────────────────────────────────────────────────────────────
const { verifyAccessToken } = require('../services/tokenService');
const { getUserByKey, getUserById, logAuditEvent } = require('../db');

function keyAuth(req, res, next) {
  const log = req.log; // set by correlationMiddleware

  // ── Path 1: JWT Bearer token ─────────────────────────────────────────────
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (!token) {
      return _unauthorized(res, log, 'MISSING_TOKEN', 'Bearer token is empty', req);
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (err) {
      const isExpired = err.name === 'TokenExpiredError';
      const code      = isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
      const message   = isExpired
        ? 'Access token expired — use /api/auth/refresh to get a new one'
        : 'Invalid access token';

      _logAuthFailure(req, log, code, err.message);

      return res.status(401).json({
        error:       code,
        message,
        should_refresh: isExpired,
      });
    }

    // Token is valid — fetch fresh user record to catch revocations / deactivation
    const user = getUserById(parseInt(payload.sub));
    if (!user || !user.is_active) {
      _logAuthFailure(req, log, 'USER_INACTIVE', `userId=${payload.sub}`);
      return _unauthorized(res, log, 'USER_INACTIVE', 'Account is inactive or not found', req);
    }

    req.user  = user;
    req.authMode = 'jwt';
    log?.auth.debug('JWT auth passed', { userId: user.id, email: user.email });
    log?.setUserId(user.id);
    return next();
  }

  // ── Path 2: Legacy X-License-Key header (backward compat) ────────────────
  const licenseKey = req.headers['x-license-key'];
  if (licenseKey) {
    const user = getUserByKey(licenseKey.trim());
    if (!user || !user.is_active) {
      _logAuthFailure(req, log, 'INVALID_KEY', 'Key not found or inactive');
      return _unauthorized(res, log, 'UNAUTHORIZED', 'Invalid or inactive license key', req);
    }

    req.user     = user;
    req.authMode = 'legacy_key';
    log?.auth.debug('Legacy key auth passed', { userId: user.id, email: user.email });
    log?.setUserId(user.id);
    return next();
  }

  // ── No credentials provided ───────────────────────────────────────────────
  _logAuthFailure(req, log, 'NO_CREDENTIALS', 'No auth header or license key');
  return res.status(401).json({
    error:   'UNAUTHORIZED',
    message: 'Provide either "Authorization: Bearer <token>" or "X-License-Key: <key>"',
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _unauthorized(res, log, code, message, req) {
  return res.status(401).json({ error: code, message });
}

function _logAuthFailure(req, log, code, detail) {
  log?.auth.warn('Auth failed', { code, detail });

  logAuditEvent({
    eventType:     'auth.failed',
    userId:        null,
    correlationId: req.correlationId,
    ip:            req.ip,
    path:          req.path,
    detail:        { code, detail: detail?.slice?.(0, 200) },
    severity:      'warn',
  });
}

module.exports = keyAuth;
