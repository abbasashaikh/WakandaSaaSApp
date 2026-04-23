// db.js — SQLite database (Phase 1 hardened)
// ─────────────────────────────────────────────────────────────────────────────
// Changes from POC version:
//   + role column on poc_users (admin | user)
//   + audit_log table for auth/permission/generation events
//   + user_projects table for per-user Flow project caching
//   + getActiveJobCountForUser() — used by activeJobGuard
//   + logAuditEvent() — structured audit trail
//   + All job queries enforce userId ownership (no raw getJob without user check)
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const Database = require('better-sqlite3');
const crypto   = require('crypto');
const path     = require('path');
const { sysLogger } = require('./middleware/logger');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'poc.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');    // concurrent reads, serialized writes
    db.pragma('busy_timeout = 5000');   // wait up to 5s on locked writes
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');  // safe + fast for WAL mode
    initSchema();
  }
  return db;
}

function initSchema() {
  const d = db;

  // ── Users ──────────────────────────────────────────────────────────────────
  d.exec(`
    CREATE TABLE IF NOT EXISTS poc_users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL DEFAULT '',
      email       TEXT    NOT NULL UNIQUE,
      license_key TEXT    NOT NULL UNIQUE,
      role        TEXT    NOT NULL DEFAULT 'user'
                          CHECK(role IN ('admin','user','viewer')),
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Add role column to existing installs that don't have it
  try {
    d.exec(`ALTER TABLE poc_users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
  } catch { /* column already exists */ }

  // ── Jobs ───────────────────────────────────────────────────────────────────
  d.exec(`
    CREATE TABLE IF NOT EXISTS poc_jobs (
      id               TEXT    PRIMARY KEY,
      user_id          INTEGER NOT NULL,
      type             TEXT    NOT NULL CHECK(type IN ('image','video')),
      prompt           TEXT    NOT NULL,
      status           TEXT    NOT NULL DEFAULT 'queued'
                                CHECK(status IN ('queued','processing','completed','failed')),
      output_url       TEXT,
      error            TEXT,
      metadata         TEXT    DEFAULT '{}',
      attempt_count    INTEGER NOT NULL DEFAULT 0,
      correlation_id   TEXT,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES poc_users(id)
    )
  `);

  // Add correlation_id and attempt_count to existing installs
  for (const col of [
    `ALTER TABLE poc_jobs ADD COLUMN correlation_id TEXT`,
    `ALTER TABLE poc_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0`,
  ]) {
    try { d.exec(col); } catch { /* already exists */ }
  }

  // ── User projects (per-user Flow project cache) ────────────────────────────
  // WHY: the old single cachedProjectId global caused User A's project to be
  // used for User B's generation. Each user now has their own cached project.
  d.exec(`
    CREATE TABLE IF NOT EXISTS user_projects (
      user_id    INTEGER PRIMARY KEY,
      project_id TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES poc_users(id)
    )
  `);

  // ── Refresh tokens (session management) ──────────────────────────────────
  // DESIGN: store hash of token (not plaintext) — breach of DB ≠ breach of sessions
  d.exec(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      token_hash  TEXT    NOT NULL UNIQUE,
      expires_at  TEXT    NOT NULL,
      ip          TEXT,
      user_agent  TEXT,
      revoked     INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES poc_users(id)
    )
  `);

  // ── Audit log ──────────────────────────────────────────────────────────────
  d.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type     TEXT    NOT NULL,
      user_id        INTEGER,
      correlation_id TEXT,
      ip             TEXT,
      path           TEXT,
      detail         TEXT    DEFAULT '{}',
      severity       TEXT    NOT NULL DEFAULT 'info'
                             CHECK(severity IN ('info','warn','error')),
      created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ── Indexes ────────────────────────────────────────────────────────────────
  d.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_license_key   ON poc_users(license_key);
    CREATE INDEX IF NOT EXISTS idx_users_role          ON poc_users(role);
    CREATE INDEX IF NOT EXISTS idx_jobs_user_id        ON poc_jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status         ON poc_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_user_status    ON poc_jobs(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_tokens_user_id      ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_tokens_hash         ON refresh_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_tokens_expires      ON refresh_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_audit_user_id       ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_event_type    ON audit_log(event_type);
    CREATE INDEX IF NOT EXISTS idx_audit_created_at    ON audit_log(created_at);
  `);

  sysLogger.info('db', 'Schema initialized');
}

// ── User queries ──────────────────────────────────────────────────────────────

function seedTestUser() {
  const d = getDb();
  const existing = d.prepare('SELECT id FROM poc_users WHERE license_key = ?')
    .get('poc-test-key-12345678');

  if (existing) {
    sysLogger.info('db', 'Seed user already exists, skipping');
    return;
  }

  d.prepare(`
    INSERT OR IGNORE INTO poc_users (name, email, license_key, role, is_active)
    VALUES (?, ?, ?, 'user', 1)
  `).run('Test User', 'test@poc.local', 'poc-test-key-12345678');

  sysLogger.info('db', '✅ Seed user created', { email: 'test@poc.local' });
}

function getUserByKey(licenseKey) {
  return getDb()
    .prepare('SELECT * FROM poc_users WHERE license_key = ? AND is_active = 1')
    .get(licenseKey);
}

function getUserByEmail(email) {
  return getDb()
    .prepare('SELECT * FROM poc_users WHERE email = ?')
    .get(email.toLowerCase().trim());
}

function getUserById(id) {
  return getDb()
    .prepare('SELECT id, name, email, role, is_active, created_at FROM poc_users WHERE id = ?')
    .get(id);
}

function createUser(name, email, licenseKey) {
  const result = getDb()
    .prepare(`
      INSERT INTO poc_users (name, email, license_key, role, is_active)
      VALUES (?, ?, ?, 'user', 1)
    `)
    .run(name, email.toLowerCase().trim(), licenseKey);
  return result.lastInsertRowid;
}

function getAllUsers(limit = 100) {
  return getDb()
    .prepare('SELECT id, name, email, role, is_active, created_at FROM poc_users ORDER BY created_at DESC LIMIT ?')
    .all(limit);
}

function setUserActive(userId, isActive) {
  getDb()
    .prepare('UPDATE poc_users SET is_active = ?, updated_at = datetime("now") WHERE id = ?')
    .run(isActive ? 1 : 0, userId);
}

// ── Job queries ───────────────────────────────────────────────────────────────

function createJob(jobId, userId, type, prompt, correlationId = null) {
  getDb()
    .prepare(`
      INSERT INTO poc_jobs (id, user_id, type, prompt, status, correlation_id)
      VALUES (?, ?, ?, ?, 'queued', ?)
    `)
    .run(jobId, userId, type, prompt, correlationId);
}

/**
 * SECURITY: Always requires userId to prevent IDOR.
 * Returns null if job doesn't exist OR belongs to a different user.
 */
function getJobForUser(jobId, userId) {
  return getDb()
    .prepare('SELECT * FROM poc_jobs WHERE id = ? AND user_id = ?')
    .get(jobId, userId);
}

/**
 * Admin-only: get any job by ID without ownership check.
 * Do NOT use this on user-facing endpoints.
 */
function getJobAdmin(jobId) {
  return getDb()
    .prepare('SELECT * FROM poc_jobs WHERE id = ?')
    .get(jobId);
}

function getJobsByUser(userId, limit = 20) {
  return getDb()
    .prepare(`
      SELECT * FROM poc_jobs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(userId, limit);
}

function getActiveJobCountForUser(userId) {
  const row = getDb()
    .prepare(`
      SELECT COUNT(*) as count FROM poc_jobs
      WHERE user_id = ? AND status IN ('queued', 'processing')
    `)
    .get(userId);
  return row?.count || 0;
}

function updateJob(jobId, updates) {
  const { status, output_url, error, metadata, attempt_count } = updates;
  getDb()
    .prepare(`
      UPDATE poc_jobs SET
        status        = COALESCE(?, status),
        output_url    = COALESCE(?, output_url),
        error         = COALESCE(?, error),
        metadata      = COALESCE(?, metadata),
        attempt_count = COALESCE(?, attempt_count),
        updated_at    = datetime('now')
      WHERE id = ?
    `)
    .run(
      status        ?? null,
      output_url    ?? null,
      error         ?? null,
      metadata      ?? null,
      attempt_count ?? null,
      jobId
    );
}

// ── Per-user project cache ────────────────────────────────────────────────────
// Replaces the dangerous module-level cachedProjectId global

function getUserProject(userId) {
  const row = getDb()
    .prepare('SELECT project_id FROM user_projects WHERE user_id = ?')
    .get(userId);
  return row?.project_id || null;
}

function setUserProject(userId, projectId) {
  getDb()
    .prepare(`
      INSERT INTO user_projects (user_id, project_id)
      VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET project_id = excluded.project_id, created_at = datetime('now')
    `)
    .run(userId, projectId);
}

function clearUserProject(userId) {
  getDb()
    .prepare('DELETE FROM user_projects WHERE user_id = ?')
    .run(userId);
}

// ── Audit log ─────────────────────────────────────────────────────────────────

function logAuditEvent({ eventType, userId = null, correlationId = null, ip = null, path = null, detail = {}, severity = 'info' }) {
  try {
    getDb()
      .prepare(`
        INSERT INTO audit_log (event_type, user_id, correlation_id, ip, path, detail, severity)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(eventType, userId, correlationId, ip, path, JSON.stringify(detail), severity);
  } catch (err) {
    // Never let audit logging crash the request
    sysLogger.error('db', 'Failed to write audit log', { error: err.message, eventType });
  }
}

function getAuditLog({ userId, eventType, limit = 50, since } = {}) {
  let sql  = 'SELECT * FROM audit_log WHERE 1=1';
  const params = [];

  if (userId)    { sql += ' AND user_id = ?';    params.push(userId); }
  if (eventType) { sql += ' AND event_type = ?'; params.push(eventType); }
  if (since)     { sql += ' AND created_at > ?'; params.push(since); }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  return getDb().prepare(sql).all(...params);
}

// ── Admin stats ───────────────────────────────────────────────────────────────

function getQueueSnapshot() {
  const d = getDb();
  return {
    queued:     d.prepare(`SELECT COUNT(*) as n FROM poc_jobs WHERE status = 'queued'`).get().n,
    processing: d.prepare(`SELECT COUNT(*) as n FROM poc_jobs WHERE status = 'processing'`).get().n,
    completed:  d.prepare(`SELECT COUNT(*) as n FROM poc_jobs WHERE status = 'completed'`).get().n,
    failed:     d.prepare(`SELECT COUNT(*) as n FROM poc_jobs WHERE status = 'failed'`).get().n,
  };
}

// ── Refresh token functions ──────────────────────────────────────────────────

function createRefreshToken(userId, tokenHash, expiresAt, ip, userAgent) {
  getDb()
    .prepare(`
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip, user_agent)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(userId, tokenHash, expiresAt, ip || null, userAgent || null);
}

function getRefreshToken(tokenHash) {
  return getDb()
    .prepare('SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked = 0')
    .get(tokenHash);
}

function revokeRefreshToken(tokenHash) {
  getDb()
    .prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?')
    .run(tokenHash);
}

function revokeAllUserTokens(userId) {
  const result = getDb()
    .prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND revoked = 0')
    .run(userId);
  return result.changes;
}

function getActiveSessionsForUser(userId) {
  return getDb()
    .prepare(`
      SELECT id, ip, user_agent, created_at, expires_at
      FROM refresh_tokens
      WHERE user_id = ? AND revoked = 0 AND expires_at > datetime('now')
      ORDER BY created_at DESC
    `)
    .all(userId);
}

function pruneExpiredTokens() {
  const result = getDb()
    .prepare("DELETE FROM refresh_tokens WHERE expires_at < datetime('now')")
    .run();
  if (result.changes > 0) sysLogger.info('db', `Pruned ${result.changes} expired refresh tokens`);
}

module.exports = {
  getDb,
  seedTestUser,
  // Users
  getUserByKey,
  getUserByEmail,
  getUserById,
  createUser,
  getAllUsers,
  setUserActive,
  // Jobs
  createJob,
  getJobForUser,
  getJobAdmin,
  getJobsByUser,
  getActiveJobCountForUser,
  updateJob,
  // Per-user project cache
  getUserProject,
  setUserProject,
  clearUserProject,
  // Audit
  logAuditEvent,
  getAuditLog,
  // Sessions / refresh tokens
  createRefreshToken,
  getRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  getActiveSessionsForUser,
  pruneExpiredTokens,
  // Stats
  getQueueSnapshot,
};
