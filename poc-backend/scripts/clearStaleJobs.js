// scripts/clearStaleJobs.js
// Resets all stuck queued/processing jobs to 'failed' so activeJobGuard
// doesn't block new generations.
// Usage: node scripts/clearStaleJobs.js

require('dotenv').config({ override: true });

const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = path.join(__dirname, '..', 'poc.db');

try {
  const db = new Database(DB_PATH);

  // Count stuck jobs first
  const stuck = db.prepare(
    "SELECT COUNT(*) as count FROM jobs WHERE status IN ('queued','processing')"
  ).get();

  console.log(`Found ${stuck.count} stuck job(s)`);

  if (stuck.count > 0) {
    // Reset them to failed
    const result = db.prepare(
      "UPDATE jobs SET status='failed', error='Cleared by clearStaleJobs script', updated_at=? WHERE status IN ('queued','processing')"
    ).run(new Date().toISOString());

    console.log(`✅ Cleared ${result.changes} stuck job(s)`);
  } else {
    console.log('✅ No stuck jobs found');
  }

  db.close();
} catch (err) {
  // If db module not available, try the project's db.js
  try {
    const { db } = require('../db');
    db.exec("UPDATE jobs SET status='failed', error='Cleared by script' WHERE status IN ('queued','processing')");
    console.log('✅ Stale jobs cleared via project db');
  } catch (e2) {
    console.error('Could not clear jobs:', e2.message);
    console.log('\nManual fix — run this in your project:');
    console.log('node -e "const {db} = require(\'./db\'); db.exec(\'UPDATE jobs SET status=\\\'failed\\\' WHERE status IN (\\\'queued\\\',\\\'processing\\\')\'); console.log(\'Done\');"');
  }
}
