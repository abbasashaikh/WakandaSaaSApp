// tests/phase2.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 session & token lifecycle tests.
// Run: node tests/phase2.test.js
//
// Tests:
//   T1  signAccessToken produces a valid JWT with correct claims
//   T2  verifyAccessToken rejects tampered token
//   T3  verifyAccessToken throws TokenExpiredError for expired token
//   T4  generateRefreshToken: plaintext ≠ hash, hash is 64 chars
//   T5  isRefreshTokenValid: rejects expired row
//   T6  isRefreshTokenValid: rejects revoked row
//   T7  DB: createRefreshToken + getRefreshToken round-trip
//   T8  DB: revokeRefreshToken prevents subsequent lookup
//   T9  DB: revokeAllUserTokens bulk-revokes all user sessions
//   T10 DB: getActiveSessionsForUser only returns non-revoked, non-expired
//   T11 keyAuth: accepts valid JWT Bearer token
//   T12 keyAuth: returns TOKEN_EXPIRED with should_refresh flag
//   T13 keyAuth: accepts legacy X-License-Key (backward compat)
//   T14 keyAuth: rejects both missing → 401 with clear message
//   T15 Admin guard: role=admin passes, role=user blocked
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const path   = require('path');
const os     = require('os');
const fs     = require('fs');
const jwt    = require('jsonwebtoken');

const tmpDb = path.join(os.tmpdir(), `poc-p2-test-${Date.now()}.db`);
process.env.DB_PATH              = tmpDb;
process.env.NODE_ENV             = 'test';
process.env.LOG_LEVEL            = 'error';
process.env.FLOW_MODE            = 'mock';
process.env.JWT_SECRET           = 'test-secret-32-chars-minimum-abc';
process.env.ACCESS_TOKEN_TTL_SEC = '3600';

let passed = 0; let failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => { console.log(`  ✅ ${name}`); passed++; })
              .catch(e => { console.log(`  ❌ ${name}\n     ${e.message}`); failed++; });
    }
    console.log(`  ✅ ${name}`); passed++;
  } catch(e) { console.log(`  ❌ ${name}\n     ${e.message}`); failed++; }
}

// ── Shared setup ──────────────────────────────────────────────────────────────
const {
  createUser, getUserByKey,
  createRefreshToken, getRefreshToken,
  revokeRefreshToken, revokeAllUserTokens,
  getActiveSessionsForUser,
} = require('../db');
const {
  signAccessToken, verifyAccessToken,
  generateRefreshToken, hashToken,
  refreshTokenExpiresAt, isRefreshTokenValid,
} = require('../services/tokenService');

const testUser = {
  id:          createUser('Test Phase2', 'p2@test.com', 'p2-test-key-00001'),
  email:       'p2@test.com',
  role:        'user',
  license_key: 'p2-test-key-00001',
  is_active:   1,
};

// ── T1–T3: JWT signing / verification ─────────────────────────────────────────
console.log('\n[Phase 2 Tests] JWT Access Token');

test('T1: signAccessToken produces valid JWT with correct claims', () => {
  const token = signAccessToken(testUser);
  assert.ok(typeof token === 'string');
  assert.ok(token.split('.').length === 3, 'JWT must have 3 parts');

  const decoded = jwt.decode(token);
  assert.strictEqual(decoded.sub,  String(testUser.id));
  assert.strictEqual(decoded.email, testUser.email);
  assert.strictEqual(decoded.role,  'user');
  assert.ok(decoded.exp > Date.now() / 1000, 'Token should not be expired');
  assert.ok(decoded.iss === 'ai-creative-studio');
});

test('T2: verifyAccessToken rejects tampered token', () => {
  const token  = signAccessToken(testUser);
  const parts  = token.split('.');
  parts[2]     = 'invalidsignature';
  const tampered = parts.join('.');

  assert.throws(
    () => verifyAccessToken(tampered),
    /invalid signature/i,
    'Should throw on invalid signature'
  );
});

test('T3: verifyAccessToken throws TokenExpiredError for expired token', () => {
  // Sign with 1s TTL, wait 1.1s
  const shortToken = jwt.sign(
    { sub: '1', email: 'x@x.com', role: 'user' },
    process.env.JWT_SECRET,
    { expiresIn: 1, issuer: 'ai-creative-studio', audience: 'poc-client' }
  );

  return new Promise(resolve => {
    setTimeout(() => {
      let caught = null;
      try { verifyAccessToken(shortToken); } catch(e) { caught = e; }
      assert.ok(caught, 'Should throw');
      assert.strictEqual(caught.name, 'TokenExpiredError');
      resolve();
    }, 1100);
  });
});

// ── T4–T6: Refresh token helpers ─────────────────────────────────────────────
console.log('\n[Phase 2 Tests] Refresh Token Helpers');

test('T4: generateRefreshToken: plaintext ≠ hash, hash is 64 chars (sha256)', () => {
  const { plaintext, hash } = generateRefreshToken();
  assert.ok(plaintext.length === 64,   'Plaintext should be 64 hex chars');
  assert.ok(hash.length === 64,        'Hash should be 64 hex chars');
  assert.notStrictEqual(plaintext, hash, 'Plaintext must differ from its hash');
  assert.strictEqual(hash, hashToken(plaintext), 'hashToken must be deterministic');
});

test('T5: isRefreshTokenValid rejects expired row', () => {
  const expired = {
    revoked:    0,
    expires_at: new Date(Date.now() - 1000).toISOString(),
  };
  assert.strictEqual(isRefreshTokenValid(expired), false, 'Should be invalid when expired');
});

test('T6: isRefreshTokenValid rejects revoked row', () => {
  const revoked = {
    revoked:    1,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  };
  assert.strictEqual(isRefreshTokenValid(revoked), false, 'Should be invalid when revoked');
});

// ── T7–T10: DB session management ─────────────────────────────────────────────
console.log('\n[Phase 2 Tests] DB Session Management');

test('T7: createRefreshToken + getRefreshToken round-trip', () => {
  const { plaintext, hash } = generateRefreshToken();
  const expiresAt = refreshTokenExpiresAt();
  createRefreshToken(testUser.id, hash, expiresAt, '127.0.0.1', 'TestAgent/1.0');

  const row = getRefreshToken(hash);
  assert.ok(row,                                    'Row should exist');
  assert.strictEqual(row.user_id, testUser.id);
  assert.strictEqual(row.token_hash, hash);
  assert.strictEqual(row.revoked, 0);
  assert.strictEqual(row.ip, '127.0.0.1');
  assert.ok(isRefreshTokenValid(row),               'Row should be valid');
});

test('T8: revokeRefreshToken prevents subsequent lookup', () => {
  const { plaintext, hash } = generateRefreshToken();
  createRefreshToken(testUser.id, hash, refreshTokenExpiresAt(), null, null);

  revokeRefreshToken(hash);

  const row = getRefreshToken(hash);
  assert.strictEqual(row, undefined, 'Revoked token should not be returned');
});

test('T9: revokeAllUserTokens bulk-revokes all active sessions', () => {
  // Create 3 active tokens for a new user
  const bulkUserId = createUser('Bulk', 'bulk@test.com', 'bulk-key-00002');
  const tokens = [1, 2, 3].map(() => {
    const { hash } = generateRefreshToken();
    createRefreshToken(bulkUserId, hash, refreshTokenExpiresAt(), null, null);
    return hash;
  });

  const count = revokeAllUserTokens(bulkUserId);
  assert.ok(count >= 3, `Should revoke at least 3 tokens, got ${count}`);

  // Verify all are gone
  tokens.forEach(hash => {
    const row = getRefreshToken(hash);
    assert.strictEqual(row, undefined, `Token ${hash.slice(0,8)}... should be revoked`);
  });
});

test('T10: getActiveSessionsForUser returns only valid sessions', () => {
  const uid = createUser('Session Test', 'sess@test.com', 'sess-key-00003');

  // Create 2 valid + 1 expired
  const { hash: h1 } = generateRefreshToken();
  const { hash: h2 } = generateRefreshToken();
  const { hash: h3 } = generateRefreshToken();

  createRefreshToken(uid, h1, refreshTokenExpiresAt(), null, null);
  createRefreshToken(uid, h2, refreshTokenExpiresAt(), null, null);
  // Expired: set past date
  const past = new Date(Date.now() - 1000).toISOString().replace('T', ' ').slice(0, 19);
  createRefreshToken(uid, h3, past, null, null);

  const sessions = getActiveSessionsForUser(uid);
  assert.ok(sessions.length >= 2, `Should have at least 2 active sessions, got ${sessions.length}`);

  // All returned sessions should be in the future
  sessions.forEach(s => {
    assert.ok(new Date(s.expires_at) > new Date(), 'Session should not be expired');
  });
});

// ── T11–T14: keyAuth dual-mode ────────────────────────────────────────────────
console.log('\n[Phase 2 Tests] keyAuth Dual-Mode Middleware');

function makeReq(headers = {}) {
  return {
    headers,
    correlationId: 'test-cid',
    ip:            '127.0.0.1',
    path:          '/test',
    log:           { auth: { debug: () => {}, warn: () => {}, info: () => {} }, setUserId: () => {} },
  };
}
function makeRes() {
  const r = { statusCode: 200, headers: {}, body: null };
  r.setHeader = (k,v) => { r.headers[k] = v; };
  r.status    = (c) => { r.statusCode = c; return r; };
  r.json      = (b) => { r.body = b; return r; };
  return r;
}

test('T11: keyAuth accepts valid JWT Bearer token', async () => {
  const keyAuth = require('../middleware/keyAuth');
  const token   = signAccessToken(testUser);
  const req     = makeReq({ authorization: `Bearer ${token}` });
  const res     = makeRes();
  let nextCalled = false;

  await new Promise(r => keyAuth(req, res, () => { nextCalled = true; r(); }));

  assert.ok(nextCalled,                'next() should be called');
  assert.ok(req.user,                  'req.user should be set');
  assert.strictEqual(req.user.id, testUser.id);
  assert.strictEqual(req.authMode, 'jwt');
});

test('T12: keyAuth returns TOKEN_EXPIRED with should_refresh=true', async () => {
  const keyAuth = require('../middleware/keyAuth');
  const expired = jwt.sign(
    { sub: String(testUser.id), email: testUser.email, role: 'user' },
    process.env.JWT_SECRET,
    { expiresIn: 1, issuer: 'ai-creative-studio', audience: 'poc-client' }
  );

  await new Promise(r => setTimeout(r, 1100));
  delete require.cache[require.resolve('../middleware/keyAuth')];
  const freshKeyAuth = require('../middleware/keyAuth');

  const req = makeReq({ authorization: `Bearer ${expired}` });
  const res = makeRes();

  await new Promise(r => freshKeyAuth(req, res, r) || r());

  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body?.error, 'TOKEN_EXPIRED');
  assert.strictEqual(res.body?.should_refresh, true, 'should_refresh must be true for expired tokens');
});

test('T13: keyAuth accepts legacy X-License-Key (backward compat)', async () => {
  const keyAuth = require('../middleware/keyAuth');
  const req = makeReq({ 'x-license-key': 'p2-test-key-00001' });
  const res = makeRes();
  let nextCalled = false;

  await new Promise(r => keyAuth(req, res, () => { nextCalled = true; r(); }));

  assert.ok(nextCalled,               'next() should be called');
  assert.ok(req.user,                 'req.user should be set');
  assert.strictEqual(req.authMode, 'legacy_key');
});

test('T14: keyAuth rejects missing credentials with clear message', async () => {
  const keyAuth = require('../middleware/keyAuth');
  const req = makeReq({});
  const res = makeRes();
  let nextCalled = false;

  await new Promise(r => keyAuth(req, res, () => { nextCalled = true; r(); }));

  assert.strictEqual(res.statusCode, 401,   'Should return 401');
  assert.strictEqual(nextCalled,     false,  'next() should NOT be called');
  assert.ok(res.body?.message?.includes('Authorization') || res.body?.message?.includes('Bearer'));
});

// ── T15: Admin guard ──────────────────────────────────────────────────────────
console.log('\n[Phase 2 Tests] Admin Guard with Roles');

test('T15: requireRole blocks user role from admin-only resource', () => {
  const { requireRole } = require('../middleware/adminGuard');
  const guard = requireRole('admin');

  const req = { user: { id: testUser.id, role: 'user' }, path: '/admin',
    log: { perm: { warn: () => {} } } };
  const res = makeRes();
  let nextCalled = false;

  guard(req, res, () => { nextCalled = true; });

  assert.strictEqual(res.statusCode, 403,  'Should return 403');
  assert.strictEqual(nextCalled,     false, 'next() should not be called');
});

// ── Summary ───────────────────────────────────────────────────────────────────
setTimeout(() => {
  try { fs.unlinkSync(tmpDb); } catch {}
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Phase 2 Tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}, 2000); // allow async tests to complete
