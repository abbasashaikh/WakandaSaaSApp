// fix.js — run from poc-backend: node fix.js
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'poc.db');
console.log('Opening:', dbPath);

const db = new Database(dbPath);

const before = db.prepare(
  "SELECT id, type, status FROM poc_jobs WHERE status IN ('queued','processing')"
).all();

console.log('Stuck jobs found:', before.length);
before.forEach(j => console.log(' -', j.status, j.type, j.id));

const result = db.prepare(
  "UPDATE poc_jobs SET status='failed', error='stale' WHERE status IN ('queued','processing')"
).run();

console.log('Cleared:', result.changes, 'jobs');
db.close();
console.log('Done. Now run: redis-cli FLUSHALL && npm start');
