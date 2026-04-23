// middleware/adminGuard.js
// ─────────────────────────────────────────────────────────────────────────────
// RBAC role guard for admin-only routes.
//
// DESIGN PRINCIPLES:
//   1. Role is stored in DB (poc_users.role), never trusted from client headers
//   2. Middleware runs AFTER keyAuth so req.user is always set
//   3. Failures are logged with structured entries for audit trail
//   4. Returns 403 (not 401) — the user IS authenticated, just not authorized
// ─────────────────────────────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
  }

  if (req.user.role !== 'admin') {
    req.log?.perm.warn('Admin access denied', {
      requiredRole: 'admin',
      actualRole:   req.user.role || 'user',
      path:         req.path,
    });

    return res.status(403).json({
      error:   'FORBIDDEN',
      message: 'Admin role required for this endpoint',
    });
  }

  next();
}

/**
 * Generic role guard factory.
 * Usage: router.use(requireRole('admin')) or requireRole(['admin','moderator'])
 */
function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];

  return function roleGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }

    const userRole = req.user.role || 'user';

    if (!allowed.includes(userRole)) {
      req.log?.perm.warn('Role access denied', {
        requiredRoles: allowed,
        actualRole:    userRole,
        path:          req.path,
      });
      return res.status(403).json({
        error:   'FORBIDDEN',
        message: `Requires one of: ${allowed.join(', ')}`,
      });
    }

    next();
  };
}

module.exports = { requireAdmin, requireRole };
