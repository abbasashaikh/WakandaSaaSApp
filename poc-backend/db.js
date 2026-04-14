// db.js — SQLite database setup (better-sqlite3)
require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'poc.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL'); // Better concurrent performance
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  const database = db;

  // Users table
  database.exec(`
    CREATE TABLE IF NOT EXISTS poc_users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL DEFAULT '',
      email       TEXT    NOT NULL UNIQUE,
      license_key TEXT    NOT NULL UNIQUE,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Jobs table
  database.exec(`
    CREATE TABLE IF NOT EXISTS poc_jobs (
      id          TEXT    PRIMARY KEY,
      user_id     INTEGER NOT NULL,
      type        TEXT    NOT NULL CHECK(type IN ('image','video')),
      prompt      TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'queued'
                          CHECK(status IN ('queued','processing','completed','failed')),
      output_url  TEXT,
      error       TEXT,
      metadata    TEXT    DEFAULT '{}',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES poc_users(id)
    )
  `);

  // Index for fast key lookups
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_license_key ON poc_users(license_key);
    CREATE INDEX IF NOT EXISTS idx_jobs_user_id      ON poc_jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status       ON poc_jobs(status);
  `);

  console.log('[DB] Schema initialized');
}

function seedTestUser() {
  const database = getDb();

  // Check if seed user already exists
  const existing = database
    .prepare("SELECT id FROM poc_users WHERE license_key = ?")
    .get('poc-test-key-12345678');

  if (existing) {
    console.log('[DB] Seed user already exists, skipping');
    return;
  }

  database
    .prepare("INSERT OR IGNORE INTO poc_users (name, email, license_key, is_active) VALUES (?, ?, ?, 1)")
    .run('Test User', 'test@poc.local', 'poc-test-key-12345678');

  console.log('[DB] ✅ Seed user created:');
  console.log('     Email:       test@poc.local');
  console.log('     License Key: poc-test-key-12345678');
}

// --- Prepared statement helpers ---

function getUserByKey(licenseKey) {
  return getDb()
    .prepare("SELECT * FROM poc_users WHERE license_key = ? AND is_active = 1")
    .get(licenseKey);
}

function getUserByEmail(email) {
  return getDb()
    .prepare("SELECT * FROM poc_users WHERE email = ?")
    .get(email);
}

function createUser(name, email, licenseKey) {
  const stmt = getDb().prepare(
    "INSERT INTO poc_users (name, email, license_key, is_active) VALUES (?, ?, ?, 1)"
  );
  const result = stmt.run(name, email, licenseKey);
  return result.lastInsertRowid;
}

function createJob(id, userId, type, prompt) {
  getDb()
    .prepare(
      "INSERT INTO poc_jobs (id, user_id, type, prompt, status) VALUES (?, ?, ?, ?, 'queued')"
    )
    .run(id, userId, type, prompt);
}

function updateJob(id, fields) {
  const updates = Object.keys(fields)
    .map(k => `${k} = ?`)
    .join(', ');
  const values = Object.values(fields);
  values.push(id);

  getDb()
    .prepare(
      `UPDATE poc_jobs SET ${updates}, updated_at = datetime('now') WHERE id = ?`
    )
    .run(...values);
}

function getJob(id) {
  return getDb()
    .prepare("SELECT * FROM poc_jobs WHERE id = ?")
    .get(id);
}

function getJobsByUser(userId, limit = 20) {
  return getDb()
    .prepare(
      "SELECT * FROM poc_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(userId, limit);
}

// Auto-seed and auto-init when this module is first loaded
getDb();
seedTestUser();

module.exports = {
  getDb,
  seedTestUser,
  getUserByKey,
  getUserByEmail,
  createUser,
  createJob,
  updateJob,
  getJob,
  getJobsByUser,
};

// Run seed directly: node db.js --seed
if (process.argv[2] === '--seed') {
  console.log('[DB] Manual seed triggered');
  seedTestUser();
  process.exit(0);
}
