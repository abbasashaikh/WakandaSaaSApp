// routes/auth.js — Phase 2 full auth lifecycle
// ─────────────────────────────────────────────────────────────────────────────
// Routes:
//   POST /api/auth/login     — exchange license key for access + refresh tokens
//   POST /api/auth/refresh   — exchange refresh token for new access token
//   POST /api/auth/logout    — revoke current refresh token
//   POST /api/auth/logout-all — revoke ALL refresh tokens for this user
//   GET  /api/auth/me        — current user info (requires auth)
//   GET  /api/auth/sessions  — active sessions for current user
//
//   POST /api/validate-key   — KEPT for backward compat (legacy Electron flow)
//   POST /api/register       — KEPT (user creation by admin/website)
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const crypto  = require('crypto');
const {
  getUserByKey, getUserByEmail, getUserById, createUser,
  createRefreshToken, getRefreshToken, revokeRefreshToken,
  revokeAllUserTokens, getActiveSessionsForUser,
  logAuditEvent,
} = require('../db');
const {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  refreshTokenExpiresAt,
  isRefreshTokenValid,
  getAccessTokenTTL,
  getRefreshTokenTTL,
} = require('../services/tokenService');
const keyAuth = require('../middleware/keyAuth');

const router = express.Router();

// ── POST /api/auth/login ──────────────────────────────────────────────────────
// Exchange a license key for JWT access token + refresh token.
// This is the ONLY route that accepts a raw license key and issues tokens.
router.post('/login', (req, res) => {
  const { license_key } = req.body;

  if (!license_key || typeof license_key !== 'string') {
    return res.status(400).json({ error: 'MISSING_KEY', message: 'license_key is required' });
  }

  const user = getUserByKey(license_key.trim());
  if (!user || !user.is_active) {
    req.log?.auth.warn('Login failed: invalid key', { ip: req.ip });
    logAuditEvent({
      eventType: 'auth.login.failed',
      correlationId: req.correlationId,
      ip: req.ip, path: req.path,
      detail: { reason: 'invalid_key' },
      severity: 'warn',
    });
    return res.status(401).json({ error: 'INVALID_KEY', message: 'Invalid or inactive license key' });
  }

  const accessToken           = signAccessToken(user);
  const { plaintext, hash }   = generateRefreshToken();
  const expiresAt             = refreshTokenExpiresAt();
  const ua                    = req.headers['user-agent']?.slice(0, 200) || null;

  createRefreshToken(user.id, hash, expiresAt, req.ip, ua);

  req.log?.auth.info('Login successful', { userId: user.id, email: user.email });

  logAuditEvent({
    eventType:     'auth.login.success',
    userId:        user.id,
    correlationId: req.correlationId,
    ip:            req.ip,
    path:          req.path,
    detail:        { email: user.email },
    severity:      'info',
  });

  return res.json({
    access_token:  accessToken,
    refresh_token: plaintext,           // plaintext to client, hash stored in DB
    token_type:    'Bearer',
    expires_in:    getAccessTokenTTL(), // seconds
    user: {
      id:    user.id,
      email: user.email,
      name:  user.name || 'User',
      role:  user.role,
    },
  });
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
// Exchange a valid refresh token for a new access token + rotated refresh token.
// Old refresh token is revoked immediately (single-use rotation).
router.post('/refresh', (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token || typeof refresh_token !== 'string') {
    return res.status(400).json({ error: 'MISSING_TOKEN', message: 'refresh_token is required' });
  }

  const hash     = hashToken(refresh_token.trim());
  const tokenRow = getRefreshToken(hash);

  if (!isRefreshTokenValid(tokenRow)) {
    req.log?.auth.warn('Refresh failed: invalid or expired token', { ip: req.ip });
    logAuditEvent({
      eventType: 'auth.refresh.failed',
      correlationId: req.correlationId,
      ip: req.ip, path: req.path,
      detail: { reason: tokenRow ? 'expired_or_revoked' : 'not_found' },
      severity: 'warn',
    });
    return res.status(401).json({
      error:   'INVALID_REFRESH_TOKEN',
      message: 'Refresh token is invalid, expired, or already used',
    });
  }

  const user = getUserById(tokenRow.user_id);
  if (!user || !user.is_active) {
    revokeRefreshToken(hash);
    return res.status(401).json({ error: 'USER_INACTIVE', message: 'Account is inactive' });
  }

  // Rotate: revoke old token, issue new pair
  revokeRefreshToken(hash);

  const newAccessToken          = signAccessToken(user);
  const { plaintext: newPt, hash: newHash } = generateRefreshToken();
  const ua = req.headers['user-agent']?.slice(0, 200) || null;

  createRefreshToken(user.id, newHash, refreshTokenExpiresAt(), req.ip, ua);

  req.log?.auth.info('Token refreshed', { userId: user.id });

  logAuditEvent({
    eventType: 'auth.token.refreshed',
    userId:    user.id,
    correlationId: req.correlationId,
    ip: req.ip, path: req.path,
    severity: 'info',
  });

  return res.json({
    access_token:  newAccessToken,
    refresh_token: newPt,
    token_type:    'Bearer',
    expires_in:    getAccessTokenTTL(),
  });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
// Revoke the current refresh token. Requires auth (any mode).
router.post('/logout', keyAuth, (req, res) => {
  const { refresh_token } = req.body;

  if (refresh_token) {
    const hash = hashToken(refresh_token.trim());
    revokeRefreshToken(hash);
  }

  req.log?.auth.info('Logout', { userId: req.user.id });
  logAuditEvent({
    eventType: 'auth.logout',
    userId:    req.user.id,
    correlationId: req.correlationId,
    ip: req.ip, path: req.path,
    severity: 'info',
  });

  return res.json({ message: 'Logged out successfully' });
});

// ── POST /api/auth/logout-all ─────────────────────────────────────────────────
// Revoke ALL refresh tokens for the current user (kills all active sessions).
router.post('/logout-all', keyAuth, (req, res) => {
  const revoked = revokeAllUserTokens(req.user.id);

  req.log?.auth.info('All sessions revoked', { userId: req.user.id, count: revoked });
  logAuditEvent({
    eventType: 'auth.logout_all',
    userId:    req.user.id,
    correlationId: req.correlationId,
    ip: req.ip, path: req.path,
    detail:   { revokedCount: revoked },
    severity: 'info',
  });

  return res.json({ message: `Revoked ${revoked} session(s)` });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', keyAuth, (req, res) => {
  const u = req.user;
  return res.json({
    id:         u.id,
    email:      u.email,
    name:       u.name,
    role:       u.role,
    auth_mode:  req.authMode,
    created_at: u.created_at,
  });
});

// ── GET /api/auth/sessions ────────────────────────────────────────────────────
// Returns active sessions (refresh tokens) for the current user.
router.get('/sessions', keyAuth, (req, res) => {
  const sessions = getActiveSessionsForUser(req.user.id);
  return res.json({ sessions, count: sessions.length });
});

// ═════════════════════════════════════════════════════════════════════════════
// LEGACY ROUTES — backward compat for existing Electron app
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/validate-key — old Electron validation flow
// DEPRECATION NOTE: Electron app should migrate to POST /api/auth/login
// Returns the same shape as before PLUS access_token for gradual migration
router.post('/validate-key', (req, res) => {
  const { license_key } = req.body;

  if (!license_key || typeof license_key !== 'string') {
    return res.status(400).json({ valid: false, error: 'MISSING_KEY', message: 'license_key is required' });
  }

  const user = getUserByKey(license_key.trim());
  if (!user || !user.is_active) {
    return res.status(401).json({ valid: false, error: 'INVALID_KEY', message: 'Invalid or expired license key' });
  }

  const createdAt    = new Date(user.created_at);
  const expiresAt    = new Date(createdAt);
  expiresAt.setDate(expiresAt.getDate() + 30);
  const daysRemaining = Math.max(0, Math.ceil((expiresAt - new Date()) / 86_400_000));

  // Issue an access token silently for forward-compat
  const accessToken = signAccessToken(user);
  const { plaintext, hash } = generateRefreshToken();
  createRefreshToken(user.id, hash, refreshTokenExpiresAt(), req.ip,
    req.headers['user-agent']?.slice(0, 200) || null);

  return res.json({
    valid: true,
    user:  { id: user.id, email: user.email, name: user.name || 'User' },
    subscription: {
      status:        daysRemaining > 0 ? 'active' : 'expired',
      expires_at:    expiresAt.toISOString().split('T')[0],
      days_remaining: daysRemaining,
      badge:          'MONTHLY ACCESS',
    },
    // New fields — Electron app can start using these
    access_token:  accessToken,
    refresh_token: plaintext,
    token_type:    'Bearer',
    expires_in:    getAccessTokenTTL(),
  });
});

// POST /api/register — create new user
router.post('/register', (req, res) => {
  const { name, email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'INVALID_EMAIL', message: 'A valid email address is required' });
  }

  const existing = getUserByEmail(email.toLowerCase().trim());
  if (existing) {
    return res.json({
      license_key:    existing.license_key,
      email:          existing.email,
      already_existed: true,
      message:        'Account already exists — here is your existing key',
    });
  }

  const licenseKey = crypto.randomBytes(16).toString('hex');
  const userId     = createUser((name || '').trim().slice(0, 100), email.toLowerCase().trim(), licenseKey);

  req.log?.auth.info('New user registered', { email, userId });

  return res.status(201).json({
    license_key: licenseKey,
    email:       email.toLowerCase().trim(),
    message:     'Account created successfully',
  });
});

module.exports = router;
