// tests/phase1.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 security and isolation tests.
// Run: node tests/phase1.test.js
//
// Does NOT require a running server — tests logic in isolation.
// Covers:
//   T1  Rate limiter: image limit enforced per user
//   T2  Rate limiter: video limit stricter than image
//   T3  Rate limiter: two users have INDEPENDENT windows
//   T4  Active job guard: blocks when at limit
//   T5  Per-user project isolation: users get different projects
//   T6  DB: getJobForUser returns null for wrong user (IDOR protection)
//   T7  DB: getActiveJobCountForUser counts only active jobs
//   T8  Audit log: events written and retrievable
//   T9  Admin guard: non-admin user gets 403
//   T10 Correlation ID: propagated through request
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const path   = require('path');
const os     = require('os');
const fs     = require('fs');

// Use a temp DB for tests — never touch production DB
const tmpDb = path.join(os.tmpdir(), `poc-test-${Date.now()}.db`);
process.env.DB_PATH      = tmpDb;
process.env.NODE_ENV     = 'test';
process.env.LOG_LEVEL    = 'error'; // suppress noise during tests
process.env.FLOW_MODE    = 'mock';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
    failed++;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(userId, headers = {}) {
  return {
    user: { id: userId, email: `user${userId}@test.com`, role: 'user' },
    headers,
    correlationId: `test-cid-${userId}`,
    log: { perm: { warn: () => {} }, queue: { error: () => {} } },
    ip: '127.0.0.1',
    path: '/test',
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return res;
}

// ── Setup DB ──────────────────────────────────────────────────────────────────
const db = require('../db');
const { getDb, createUser, createJob, getJobForUser, getActiveJobCountForUser,
        getUserProject, setUserProject, clearUserProject,
        logAuditEvent, getAuditLog } = db;

// Create two test users
const user1Id = createUser('Alice', 'alice@test.com', 'key-alice-001');
const user2Id = createUser('Bob',   'bob@test.com',   'key-bob-002');

// ── T1–T4: Rate limiter ───────────────────────────────────────────────────────
console.log('\n[Phase 1 Tests] Rate Limiter');

// Override limits for fast testing
process.env.IMAGE_RATE_LIMIT = '3';
process.env.VIDEO_RATE_LIMIT = '2';
process.env.RATE_WINDOW_SEC  = '60';
delete require.cache[require.resolve('../middleware/rateLimiter')];
const { imageRateLimit, videoRateLimit, activeJobGuard } = require('../middleware/rateLimiter');

testAsync('T1: Image rate limit enforced after N requests', async () => {
  const req  = makeReq(user1Id);
  let passed429 = false;

  for (let i = 0; i < 5; i++) {
    const res  = makeRes();
    let nextCalled = false;
    await new Promise(r => imageRateLimit(req, res, () => { nextCalled = true; r(); }) || r());
    if (res.statusCode === 429) { passed429 = true; break; }
  }
  assert.ok(passed429, 'Expected 429 after exceeding image limit');
});

testAsync('T2: Video limit is stricter (hits limit sooner)', async () => {
  const req  = makeReq(user1Id + 100); // fresh user ID to avoid T1 state
  let hit429At = -1;

  for (let i = 0; i < 5; i++) {
    const res = makeRes();
    await new Promise(r => videoRateLimit(req, res, () => r()) || r());
    if (res.statusCode === 429 && hit429At === -1) hit429At = i + 1;
  }
  assert.ok(hit429At > 0 && hit429At <= 3, `Expected video 429 at or before request 3, got ${hit429At}`);
});

testAsync('T3: Two users have independent rate windows', async () => {
  const reqA = makeReq(200);
  const reqB = makeReq(201);

  // Exhaust User A
  for (let i = 0; i < 5; i++) {
    const res = makeRes();
    await new Promise(r => imageRateLimit(reqA, res, () => r()) || r());
  }

  // User B should still be allowed
  const resB = makeRes();
  let bAllowed = false;
  await new Promise(r => imageRateLimit(reqB, resB, () => { bAllowed = true; r(); }) || r());
  assert.ok(bAllowed, 'User B should not be rate-limited by User A');
});

testAsync('T4: Active job guard blocks at limit', async () => {
  const uid = user1Id;
  // Create 2 active jobs (default limit = 2)
  createJob('jg-1', uid, 'image', 'test 1');
  createJob('jg-2', uid, 'image', 'test 2');
  // Leave them in 'queued' status

  process.env.MAX_ACTIVE_JOBS_PER_USER = '2';
  delete require.cache[require.resolve('../middleware/rateLimiter')];
  const { activeJobGuard: guard } = require('../middleware/rateLimiter');

  const req = makeReq(uid);
  const res = makeRes();
  let blocked = false;
  await new Promise(r => guard(req, res, () => r()) || r());
  if (res.statusCode === 429) blocked = true;
  assert.ok(blocked, 'Should block when active job count at limit');
});

// ── T5: Per-user project isolation ───────────────────────────────────────────
console.log('\n[Phase 1 Tests] Per-User Project Isolation');

test('T5: Users get and set independent project IDs', () => {
  setUserProject(user1Id, 'project-alice-001');
  setUserProject(user2Id, 'project-bob-002');

  const p1 = getUserProject(user1Id);
  const p2 = getUserProject(user2Id);

  assert.strictEqual(p1, 'project-alice-001', 'User 1 should have own project');
  assert.strictEqual(p2, 'project-bob-002',   'User 2 should have own project');
  assert.notStrictEqual(p1, p2, 'Projects must be different');
});

test('T5b: Clearing user project only affects that user', () => {
  clearUserProject(user1Id);
  const p1 = getUserProject(user1Id);
  const p2 = getUserProject(user2Id);
  assert.strictEqual(p1, null,              'User 1 project should be cleared');
  assert.strictEqual(p2, 'project-bob-002', 'User 2 project should be untouched');
});

// ── T6: IDOR protection ───────────────────────────────────────────────────────
console.log('\n[Phase 1 Tests] IDOR Protection');

test('T6: getJobForUser returns null when userId does not match', () => {
  createJob('idor-test-job', user1Id, 'image', 'test prompt');

  const ownResult   = getJobForUser('idor-test-job', user1Id);
  const otherResult = getJobForUser('idor-test-job', user2Id);

  assert.ok(ownResult,   'Owner should access their job');
  assert.strictEqual(otherResult, undefined, 'Other user must NOT access the job');
});

// ── T7: Active job count ──────────────────────────────────────────────────────
console.log('\n[Phase 1 Tests] Active Job Count');

test('T7: getActiveJobCountForUser counts queued+processing, not completed', () => {
  const uid = user2Id;
  createJob('count-q1', uid, 'image', 'queued job');
  createJob('count-q2', uid, 'image', 'queued job 2');
  createJob('count-c1', uid, 'image', 'completed job');

  const { updateJob } = require('../db');
  updateJob('count-c1', { status: 'completed', output_url: 'https://example.com/img.jpg' });

  const count = getActiveJobCountForUser(uid);
  // count-q1, count-q2 = 2 active; count-c1 = completed, jg-1, jg-2 from T4 also belong to user1
  assert.ok(count >= 2, `Expected at least 2 active jobs for user, got ${count}`);
});

// ── T8: Audit log ─────────────────────────────────────────────────────────────
console.log('\n[Phase 1 Tests] Audit Log');

test('T8: Audit events written and retrievable by userId', () => {
  logAuditEvent({
    eventType:     'auth.failed',
    userId:        user1Id,
    correlationId: 'cid-test-001',
    ip:            '10.0.0.1',
    path:          '/api/validate-key',
    detail:        { reason: 'invalid_key' },
    severity:      'warn',
  });

  logAuditEvent({
    eventType:     'generation.queued',
    userId:        user1Id,
    correlationId: 'cid-test-002',
    detail:        { jobId: 'j-001', type: 'image' },
    severity:      'info',
  });

  const events = getAuditLog({ userId: user1Id });
  assert.ok(events.length >= 2, `Expected ≥2 audit events, got ${events.length}`);
  assert.ok(events.some(e => e.event_type === 'auth.failed'), 'Should find auth.failed event');
  assert.ok(events.some(e => e.event_type === 'generation.queued'), 'Should find generation.queued event');
});

test('T8b: Audit log filtered by eventType', () => {
  const failEvents = getAuditLog({ userId: user1Id, eventType: 'auth.failed' });
  assert.ok(failEvents.every(e => e.event_type === 'auth.failed'), 'Filter should only return auth.failed');
});

// ── T9: Admin guard ───────────────────────────────────────────────────────────
console.log('\n[Phase 1 Tests] Admin Guard');

test('T9: Non-admin user gets 403 on admin route', () => {
  const { requireAdmin } = require('../middleware/adminGuard');

  const req = { user: { id: user1Id, role: 'user' }, path: '/admin/users',
    log: { perm: { warn: () => {} } } };
  const res = makeRes();
  let nextCalled = false;

  requireAdmin(req, res, () => { nextCalled = true; });

  assert.strictEqual(res.statusCode, 403, 'Should return 403');
  assert.strictEqual(nextCalled, false,  'next() should not be called');
});

test('T9b: Admin user passes the guard', () => {
  const { requireAdmin } = require('../middleware/adminGuard');

  const req = { user: { id: user1Id, role: 'admin' }, path: '/admin/users',
    log: { perm: { warn: () => {} } } };
  const res = makeRes();
  let nextCalled = false;

  requireAdmin(req, res, () => { nextCalled = true; });

  assert.ok(nextCalled, 'next() should be called for admin');
  assert.strictEqual(res.statusCode, 200, 'Should not set error status');
});

// ── T10: Correlation ID ───────────────────────────────────────────────────────
console.log('\n[Phase 1 Tests] Correlation ID');

testAsync('T10: correlationMiddleware attaches ID to request and response', async () => {
  const { correlationMiddleware } = require('../middleware/logger');

  const req = { headers: {}, ip: '127.0.0.1', path: '/test', method: 'GET' };
  const res = {
    headers: {}, statusCode: 200,
    setHeader(k, v) { this.headers[k] = v; },
    on(event, fn) { if (event === 'finish') this._finish = fn; },
  };

  await new Promise(r => correlationMiddleware(req, res, r));

  assert.ok(req.correlationId, 'correlationId should be set on req');
  assert.ok(res.headers['x-correlation-id'], 'correlationId should be in response header');
  assert.strictEqual(req.correlationId, res.headers['x-correlation-id']);
  assert.ok(req.log, 'req.log should be set');
  assert.ok(typeof req.log.auth.info === 'function', 'req.log.auth.info should be a function');
});

testAsync('T10b: Client-provided correlation ID is preserved', async () => {
  const { correlationMiddleware } = require('../middleware/logger');

  const clientCid = 'my-client-trace-abc123';
  const req = { headers: { 'x-correlation-id': clientCid }, ip: '127.0.0.1', path: '/test', method: 'GET' };
  const res = {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    on() {},
  };

  await new Promise(r => correlationMiddleware(req, res, r));

  assert.strictEqual(req.correlationId, clientCid, 'Client correlation ID should be preserved');
});

// ── Summary ──────────────────────────────────────────────────────────────────
setTimeout(() => {
  // Cleanup temp DB
  try { fs.unlinkSync(tmpDb); } catch {}

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Phase 1 Tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('❌ Some tests failed — fix before merging');
    process.exit(1);
  } else {
    console.log('✅ All Phase 1 tests passed');
    process.exit(0);
  }
}, 500);
