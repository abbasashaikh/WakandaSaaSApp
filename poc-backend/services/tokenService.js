// services/tokenService.js
// ─────────────────────────────────────────────────────────────────────────────
// JWT access tokens + cryptographic refresh tokens.
//
// TOKEN DESIGN:
//   Access token  — JWT, HS256, 1 hour, contains userId/email/role/licenseKey
//                   Stateless: no DB hit needed to validate
//                   Short-lived: a stolen token expires quickly
//
//   Refresh token — 32-byte random hex, 7 days, stored as SHA-256 hash in DB
//                   Revocable: delete/revoke the row to invalidate
//                   Never stored in plaintext in DB (hash only)
//
// SECURITY RULES:
//   - JWT_SECRET must be ≥ 32 chars, set in .env, never committed
//   - If JWT_SECRET is missing in production, process exits immediately
//   - Refresh token is single-use: rotated on each /auth/refresh call
//   - Token family tracking prevents refresh token reuse attacks (Phase 3)
// ─────────────────────────────────────────────────────────────────────────────
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { sysLogger } = require('../middleware/logger');

// ── Secret validation ─────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    sysLogger.error('auth', 'JWT_SECRET is not set — refusing to start in production');
    process.exit(1);
  }
  sysLogger.warn('auth', 'JWT_SECRET not set — using insecure dev default. SET THIS IN .env');
}

const SECRET = JWT_SECRET || 'dev-insecure-secret-change-before-production-min-32-chars';

const ACCESS_TOKEN_TTL_SEC  = parseInt(process.env.ACCESS_TOKEN_TTL_SEC  || '3600');    // 1 hour
const REFRESH_TOKEN_TTL_SEC = parseInt(process.env.REFRESH_TOKEN_TTL_SEC || '604800');  // 7 days

// ── Access token ──────────────────────────────────────────────────────────────

/**
 * Sign a new JWT access token for a user.
 * @param {object} user — must contain id, email, role, license_key
 * @returns {string} signed JWT
 */
function signAccessToken(user) {
  return jwt.sign(
    {
      sub:  String(user.id),
      email:       user.email,
      role:        user.role || 'user',
      licenseKey:  user.license_key,
    },
    SECRET,
    {
      expiresIn: ACCESS_TOKEN_TTL_SEC,
      issuer:    'ai-creative-studio',
      audience:  'poc-client',
    }
  );
}

/**
 * Verify and decode a JWT access token.
 * Returns decoded payload or throws on invalid/expired.
 */
function verifyAccessToken(token) {
  return jwt.verify(token, SECRET, {
    issuer:   'ai-creative-studio',
    audience: 'poc-client',
  });
}

// ── Refresh token ─────────────────────────────────────────────────────────────

/**
 * Generate a new cryptographically random refresh token.
 * Returns both the plaintext token (give to client) and its hash (store in DB).
 */
function generateRefreshToken() {
  const plaintext = crypto.randomBytes(32).toString('hex'); // 64-char hex
  const hash      = hashToken(plaintext);
  return { plaintext, hash };
}

/**
 * Hash a token for DB storage.
 * Never store the plaintext refresh token.
 */
function hashToken(plaintext) {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Calculate the expiry datetime string for a new refresh token.
 */
function refreshTokenExpiresAt() {
  const d = new Date();
  d.setSeconds(d.getSeconds() + REFRESH_TOKEN_TTL_SEC);
  return d.toISOString().replace('T', ' ').slice(0, 19); // SQLite datetime format
}

/**
 * Check if a refresh token DB row is still valid (not expired, not revoked).
 */
function isRefreshTokenValid(tokenRow) {
  if (!tokenRow)            return false;
  if (tokenRow.revoked)     return false;
  if (new Date(tokenRow.expires_at) < new Date()) return false;
  return true;
}

// ── Token TTL accessors ───────────────────────────────────────────────────────
function getAccessTokenTTL()  { return ACCESS_TOKEN_TTL_SEC; }
function getRefreshTokenTTL() { return REFRESH_TOKEN_TTL_SEC; }

module.exports = {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken,
  refreshTokenExpiresAt,
  isRefreshTokenValid,
  getAccessTokenTTL,
  getRefreshTokenTTL,
};
