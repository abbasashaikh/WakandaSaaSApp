// routes/admin.js — Phase 2 admin endpoints
// ─────────────────────────────────────────────────────────────────────────────
// ALL routes require: valid auth + role === 'admin'
//
// Endpoints:
//   GET  /api/admin/users                  — list all users
//   GET  /api/admin/users/:userId          — user detail + active sessions
//   POST /api/admin/users/:userId/revoke   — revoke all sessions for user
//   POST /api/admin/users/:userId/deactivate — deactivate account
//   GET  /api/admin/audit-log              — recent audit events
//   GET  /api/admin/queue                  — queue snapshot
//   GET  /api/admin/jobs                   — recent jobs (all users)
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const keyAuth  = require('../middleware/keyAuth');
const { requireAdmin } = require('../middleware/adminGuard');
const {
  getAllUsers, getUserById, setUserActive,
  revokeAllUserTokens, getActiveSessionsForUser,
  getAuditLog, getQueueSnapshot, getJobAdmin,
} = require('../db');

// Use dynamic import to avoid circular dep with queue service
async function queueStats() {
  try {
    const { getQueueStats } = require('../services/queue');
    return await getQueueStats();
  } catch {
    return { error: 'Queue not available' };
  }
}

const router = express.Router();

// All admin routes: must be authenticated AND be admin role
router.use(keyAuth, requireAdmin);

// ── GET /api/admin/users ──────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  const users = getAllUsers(200);
  req.log.sys.info('Admin: listed users', { count: users.length });
  return res.json({ users, count: users.length });
});

// ── GET /api/admin/users/:userId ──────────────────────────────────────────────
router.get('/users/:userId', (req, res) => {
  const id   = parseInt(req.params.userId);
  const user = getUserById(id);

  if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });

  const sessions = getActiveSessionsForUser(id);
  const recentAudit = getAuditLog({ userId: id, limit: 20 });

  return res.json({ user, sessions, recentAudit });
});

// ── POST /api/admin/users/:userId/revoke ──────────────────────────────────────
// Force-logout: revoke all active sessions for a user
router.post('/users/:userId/revoke', (req, res) => {
  const id      = parseInt(req.params.userId);
  const revoked = revokeAllUserTokens(id);

  req.log.sys.info('Admin: sessions revoked', { targetUserId: id, count: revoked, by: req.user.id });

  return res.json({ message: `Revoked ${revoked} session(s) for user ${id}`, revoked });
});

// ── POST /api/admin/users/:userId/deactivate ──────────────────────────────────
router.post('/users/:userId/deactivate', (req, res) => {
  const id = parseInt(req.params.userId);

  if (id === req.user.id) {
    return res.status(400).json({ error: 'CANNOT_DEACTIVATE_SELF', message: 'Cannot deactivate your own account' });
  }

  setUserActive(id, false);
  revokeAllUserTokens(id);

  req.log.sys.warn('Admin: user deactivated', { targetUserId: id, by: req.user.id });

  return res.json({ message: `User ${id} deactivated and all sessions revoked` });
});

// ── POST /api/admin/users/:userId/reactivate ──────────────────────────────────
router.post('/users/:userId/reactivate', (req, res) => {
  const id = parseInt(req.params.userId);
  setUserActive(id, true);
  req.log.sys.info('Admin: user reactivated', { targetUserId: id, by: req.user.id });
  return res.json({ message: `User ${id} reactivated` });
});

// ── GET /api/admin/audit-log ──────────────────────────────────────────────────
router.get('/audit-log', (req, res) => {
  const { userId, eventType, limit = 100, since } = req.query;
  const events = getAuditLog({
    userId:    userId    ? parseInt(userId) : undefined,
    eventType: eventType || undefined,
    limit:     Math.min(parseInt(limit) || 100, 500),
    since:     since     || undefined,
  });
  return res.json({ events, count: events.length });
});

// ── GET /api/admin/queue ──────────────────────────────────────────────────────
router.get('/queue', async (req, res) => {
  const [bullStats, dbSnapshot] = await Promise.all([
    queueStats(),
    Promise.resolve(getQueueSnapshot()),
  ]);

  // Phase 3: include browser pool status
  let poolStatus = null;
  try {
    const flowProxy = require('../services/flowProxy');
    poolStatus = flowProxy.getPoolStatus ? flowProxy.getPoolStatus() : null;
  } catch {}

  return res.json({ bullmq: bullStats, db: dbSnapshot, browserPool: poolStatus });
});

module.exports = router;
