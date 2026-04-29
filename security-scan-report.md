# AI Creative Studio — Security & Configuration Scan Report
**Scan date:** 2026-04-29  
**Files scanned:** 23 JS files + YAML + JSON  
**Total findings:** 8 Critical · 6 High · 9 Medium · 11 Low

---

## SUMMARY COUNTS

| Severity | Count | Description |
|---|---|---|
| 🔴 Critical | 3 | Issues that MUST be fixed before SaaS launch |
| 🟠 High | 6 | Issues that should be fixed before public exposure |
| 🟡 Medium | 9 | Issues to fix in hardening phase |
| 🟢 Low | 11 | Best-practice improvements |

---

## 1. SECURITY ALERTS

### 🔴 CRITICAL

| # | Issue | File | Line | Detail |
|---|---|---|---|---|
| C1 | **CORS allows all origins (`*`)** | `server.js` | 28 | `origin: '*'` — any website on the internet can make authenticated API calls on behalf of your users. Must be restricted to specific domains before SaaS launch. |
| C2 | **Test credential hardcoded in database seed** | `db.js` | 151, 161 | `poc-test-key-12345678` / `test@poc.local` auto-created every startup. Anyone who reads your GitHub repo can log into your production server with a permanent working key. |
| C3 | **Test key printed to console on every startup** | `server.js` | 162 | `console.log('Test key: poc-test-key-12345678')` — logs the working password to stdout. Any log aggregator, GitHub Actions log, or server log file exposes this. |

### 🟠 HIGH

| # | Issue | File | Line | Detail |
|---|---|---|---|---|
| H1 | **JWT_SECRET has no default guard** | `tokenService.js` | 14 | If `JWT_SECRET` env var is missing, `jsonwebtoken.sign()` receives `undefined` and throws at runtime. No startup validation catches this. Should fail fast with a clear error on boot. |
| H2 | **FLOW_MODE defaults to `mock`** | `flowProxy.js` | 20 | If `.env` is missing or `FLOW_MODE` is not set, the server silently uses fake responses. A misconfigured production deployment appears to work but generates nothing real. |
| H3 | **Rate limiting is in-memory only** | `rateLimiter.js` | 25–120 | The `userWindowMap` Map lives in Node.js process memory. On server restart, all rate limit counters reset to zero. A user can bypass limits by waiting for a restart or if multiple server processes run. |
| H4 | **No startup validation for required secrets** | `server.js` | all | Server starts successfully with missing `FLOW_SESSION_COOKIE` and `JWT_SECRET`. Errors only surface at runtime when requests hit those code paths — could be hours into production. |
| H5 | **Google session cookie stored in plaintext env var** | `.env` / `flowProxy.js` | 22 | The session cookie grants full access to the Google account. It is stored as a plain string in `.env` with no encryption. If the server is compromised, the Google account is fully exposed. |
| H6 | **Admin routes have no separate rate limiting** | `routes/admin.js` | all | Admin endpoints (user management, audit log) only require `adminGuard` but have no rate limiter. Brute-force attacks against admin endpoints are not throttled. |

### 🟡 MEDIUM

| # | Issue | File | Line | Detail |
|---|---|---|---|---|
| M1 | **reCAPTCHA public key hardcoded** | `flowProxy.js` | 12 | `6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV` — this is a public-side key (safe to expose), but hardcoding it makes rotating it require a code change instead of a config change. |
| M2 | **Flow base URL hardcoded** | `flowProxy.js` | 17 | `https://labs.google/fx/tools/flow` — if Google changes the URL, the entire generation system breaks and requires a code deployment to fix. |
| M3 | **JWT issuer and audience hardcoded** | `tokenService.js` | 58–59 | `ai-creative-studio` / `poc-client` — acceptable for POC, problematic for multi-tenant SaaS where different apps need different audiences. |
| M4 | **DB path exposed in default** | `db.js` | 17 | Default `poc.db` in project root — in a production server, database files should be outside the web-accessible directory with restricted OS permissions. |
| M5 | **Queue log message hardcodes concurrency=1** | `queue.js` | 193–194 | Log prints `concurrency: 1` regardless of `BROWSER_POOL_SIZE` env var value. Misleads operators monitoring logs. |
| M6 | **No HTTPS enforcement in Express** | `server.js` | all | No `helmet()` middleware, no HSTS header, no redirect from HTTP to HTTPS. Should be added before public exposure. |
| M7 | **Refresh tokens stored as SHA-256 hash** | `db.js` | token table | Good practice — correctly hashed. However there is no automatic cleanup of expired tokens beyond the `pruneExpiredTokens()` call. If never triggered, the token table grows unboundedly. |
| M8 | **No request size limit on media uploads** | `server.js` | 34 | `express.json({ limit: '1mb' })` — good. But media serving (`/media/*`) has no download rate limiting per user. One user can hammer the media endpoint to consume bandwidth. |
| M9 | **Console.log statements in production paths** | `flowProxy.js` | multiple | Hundreds of `console.log` calls with detailed browser automation steps, API bodies truncated to 300 chars. In production these should be behind `LOG_LEVEL=debug` guard. |

### 🟢 LOW

| # | Issue | File | Line | Detail |
|---|---|---|---|---|
| L1 | `package-lock.json` npm integrity hashes flagged as base64 secrets | `package-lock.json` | multiple | False positives — these are npm integrity hashes (sha512), not secrets. Safe to ignore. |
| L2 | Test files contain short-expiry JWT (1 second) | `tests/phase2.test.js` | 105, 255 | Intentional for testing. Acceptable. |
| L3 | Redis URL defaults to `localhost` without auth | `server.js` | 100 | Acceptable for single-server setup. For production, add `REDIS_PASSWORD` support. |
| L4 | No `NODE_ENV` guard on seed user creation | `db.js` | 149 | `seedTestUser()` runs regardless of environment. Should check `NODE_ENV !== 'production'`. |
| L5 | CORS exposes `X-License-Key` header name | `server.js` | 30 | Tells attackers exactly which header to target for auth bypass attempts. Consider removing from `allowedHeaders` after full JWT migration. |
| L6 | No Content-Security-Policy header | `server.js` | all | Should add `helmet()` for CSP, X-Frame-Options, X-Content-Type-Options headers. |
| L7 | `MAX_SIZE` for media downloads is 100MB | `mediaCache.js` | 23 | A 100MB video download per job could exhaust disk quickly under load. Consider per-user or per-day limits. |
| L8 | Pool slot lease time is 5 minutes | `browserPool.js` | env | `POOL_SLOT_LEASE_MS=300000` — if Chrome hangs silently, a slot is locked for 5 full minutes blocking all other users. |
| L9 | `captureSession.js` writes cookie to `.env` | `scripts/captureSession.js` | all | The script modifies `.env` directly. If `.env` is accidentally committed after running this, the Google session cookie is exposed in git history. |
| L10 | No `Referrer-Policy` header | `server.js` | all | ngrok URLs in logs could leak referrer information. |
| L11 | Test credentials in banner visible to all users | `server.js` | 162 | Any user with server access (SSH, log viewer) sees the working test password on every restart. |

---

## 2. CONFIGURATION INVENTORY

### Timeouts

| Parameter | Value | File | Line | Env Override |
|---|---|---|---|---|
| DB busy timeout | 5,000 ms | `db.js` | 25 | None |
| Gallery page load | 30,000 ms | `flowProxy.js` | 201, 264 | None |
| Gallery networkidle | 15,000 ms | `flowProxy.js` | 203, 265 | None |
| Project page load | 25,000–45,000 ms | `flowProxy.js` | 397, 351 | None |
| Input waitForSelector | 20,000 ms (image) / 12,000 ms (video) | `flowProxy.js` | 411, 689 | None |
| Image generation wait | 120,000 ms | `flowProxy.js` | ~480 | None |
| Video job poll wait | Up to 300,000 ms (5 min) | `flowProxy.js` | async poll | None |
| Pool slot acquire | 30,000 ms | `browserPool.js` | env | `POOL_ACQUIRE_TIMEOUT_MS` |
| Pool slot lease max | 300,000 ms | `browserPool.js` | env | `POOL_SLOT_LEASE_MS` |
| Media download | 60,000 ms | `mediaCache.js` | 17 | None |
| Session keepalive ping | 600,000 ms (10 min) | `sessionKeeper.js` | env | `SESSION_PING_INTERVAL_MS` |
| Type delay (image) | 40 ms/char | `flowProxy.js` | 467 | None |
| Type delay (video) | 35 ms/char | `flowProxy.js` | 915 | None |

### Rate limits

| Parameter | Default | Env Override | File | Line |
|---|---|---|---|---|
| Image requests per window | 10 | `IMAGE_RATE_LIMIT` | `rateLimiter.js` | 25 |
| Video requests per window | 3 | `VIDEO_RATE_LIMIT` | `rateLimiter.js` | 26 |
| Rate window | 60s | `RATE_WINDOW_SEC` | `rateLimiter.js` | 27 |
| Max active jobs per user | 2 | `MAX_ACTIVE_JOBS_PER_USER` | `rateLimiter.js` | 121 |
| Min gap between generations | 5,000 ms | `MIN_GEN_GAP_MS` | `flowProxy.js` | 26 |
| BullMQ retry attempts | 3 | Hardcoded | `queue.js` | 40 |
| BullMQ retry backoff start | 10,000 ms (exponential) | Hardcoded | `queue.js` | 41 |

### Pool and concurrency

| Parameter | Default | Env Override | File |
|---|---|---|---|
| Browser pool size | 1 | `BROWSER_POOL_SIZE` | `browserPool.js` |
| Queue concurrency | 1 (mirrors pool size) | `BROWSER_POOL_SIZE` | `queue.js` |
| Max media file size | 100 MB | None | `mediaCache.js` |
| Media prune age | 7 days | None | `mediaCache.js` |

### JWT configuration

| Parameter | Default | Env Override | File |
|---|---|---|---|
| Access token TTL | 3600s (1 hour) | `ACCESS_TOKEN_TTL_SEC` | `tokenService.js` |
| Refresh token TTL | 604800s (7 days) | `REFRESH_TOKEN_TTL_SEC` | `tokenService.js` |
| Algorithm | HS256 | Hardcoded | `tokenService.js` |
| Issuer | `ai-creative-studio` | Hardcoded | `tokenService.js` |
| Audience | `poc-client` | Hardcoded | `tokenService.js` |

---

## 3. SECRETS LOCATIONS MATRIX

| Secret | File | Line | Current State | Recommendation |
|---|---|---|---|---|
| `JWT_SECRET` | `tokenService.js` | 14 | Read from env — no default | Add startup guard: fail if missing |
| `FLOW_SESSION_COOKIE` | `flowProxy.js` | 22 | Read from env — no default | Add startup guard; consider vault storage |
| `poc-test-key-12345678` | `db.js` | 151, 161 | Hardcoded in seed function | Remove before production; use env or admin API |
| `poc-test-key-12345678` | `server.js` | 162 | Printed to console on startup | Remove before production |
| `test@poc.local` | `db.js` | 163 | Hardcoded test email | Remove before production |
| reCAPTCHA public key | `flowProxy.js` | 12 | Hardcoded string | Move to `RECAPTCHA_SITE_KEY` env var |
| Google session cookie | `.env` file | runtime | Plaintext in `.env` | Store in OS keychain or secrets manager |
| Redis URL | `server.js` | 100 | Default no-auth local | Add `REDIS_PASSWORD` support for production |

---

## 4. ENVIRONMENT VARIABLES REFERENCE

| Variable | Used In | Default | Required | Description |
|---|---|---|---|---|
| `PORT` | `server.js` | `3001` | No | HTTP server port |
| `NODE_ENV` | multiple | `development` | No | `production` disables verbose errors |
| `FLOW_MODE` | `flowProxy.js` | `mock` ⚠️ | **Effectively YES** | `browser` for real generation |
| `HEADLESS` | `flowProxy.js` | `true` | No | `false` for local dev with visible Chrome |
| `FLOW_SESSION_COOKIE` | `flowProxy.js` | none | **YES** | Google auth cookie (expires ~7 days) |
| `JWT_SECRET` | `tokenService.js` | none | **YES** | Min 32 random characters |
| `ACCESS_TOKEN_TTL_SEC` | `tokenService.js` | `3600` | No | Access token lifetime in seconds |
| `REFRESH_TOKEN_TTL_SEC` | `tokenService.js` | `604800` | No | Refresh token lifetime in seconds |
| `REDIS_URL` | `server.js`, `queue.js` | `redis://127.0.0.1:6379` | No | Full Redis connection string |
| `BROWSER_POOL_SIZE` | `browserPool.js`, `queue.js` | `1` | No | Concurrent generation slots |
| `POOL_ACQUIRE_TIMEOUT_MS` | `browserPool.js` | `30000` | No | Max ms to wait for a free slot |
| `POOL_SLOT_LEASE_MS` | `browserPool.js` | `300000` | No | Max ms a slot can be held |
| `SESSION_PING_INTERVAL_MS` | `sessionKeeper.js` | `600000` | No | Google session keepalive interval |
| `MIN_GEN_GAP_MS` | `flowProxy.js` | `5000` | No | Per-user min gap between requests |
| `IMAGE_RATE_LIMIT` | `rateLimiter.js` | `10` | No | Image requests per `RATE_WINDOW_SEC` |
| `VIDEO_RATE_LIMIT` | `rateLimiter.js` | `3` | No | Video requests per `RATE_WINDOW_SEC` |
| `RATE_WINDOW_SEC` | `rateLimiter.js` | `60` | No | Rate limit rolling window in seconds |
| `MAX_ACTIVE_JOBS_PER_USER` | `rateLimiter.js` | `2` | No | Max concurrent queued jobs per user |
| `DB_PATH` | `db.js` | `poc.db` | No | SQLite file path |
| `LOG_LEVEL` | `logger.js` | `info` | No | `debug`, `info`, `warn`, `error` |
| `CREDIT_WARN_THRESHOLD` | `flowProxy.js` | `500` | No | Log warn when credits drop below this |
| `CREDIT_CRITICAL_THRESHOLD` | `flowProxy.js` | `50` | No | Log error when credits drop below this |
| `MOCK_DELAY_IMAGE` | `flowProxy.js` | `4000` | No | Mock mode: image response delay ms |
| `MOCK_DELAY_VIDEO` | `flowProxy.js` | `8000` | No | Mock mode: video response delay ms |

---

## 5. DEPENDENCY CONFIGURATIONS

### Database (SQLite)
- **File:** `poc.db` (configurable via `DB_PATH`)
- **WAL mode:** enabled — `PRAGMA journal_mode = WAL`
- **Busy timeout:** 5,000 ms — `PRAGMA busy_timeout = 5000`
- **Foreign keys:** enabled
- **Synchronous:** NORMAL (safe for WAL)
- **Tables:** `poc_users`, `poc_jobs`, `poc_refresh_tokens`, `poc_audit_log`, `poc_user_projects`

### Redis (BullMQ)
- **Connection:** `REDIS_URL` env var, default `redis://127.0.0.1:6379`
- **Recommended version:** 6.2+ (current in logs: 5.0.14 — outdated)
- **Queue name:** `ai-generation`
- **Lock duration:** 600,000 ms (10 minutes)
- **Job TTL after completion:** not set — jobs accumulate in Redis

### Chrome (Playwright)
- **Mode:** headless (configurable)
- **Pool size:** 1–8 (configurable via `BROWSER_POOL_SIZE`)
- **Args:** `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`, `--disable-gpu`, `--no-zygote`
- **Stealth plugin:** `playwright-extra` with `puppeteer-extra-plugin-stealth`

### External services
- **Google Flow:** `https://labs.google/fx/tools/flow`
- **Google AI Sandbox API:** `https://aisandbox-pa.googleapis.com/v1`
- **Firebase (used internally by Flow):** `gweb-ai-sandbox-prod`

---

## 6. DEBUGGING QUICK REFERENCE

### Log locations
```
Server logs:    stdout (console) + structured JSON
PM2 logs:       ./logs/out.log  and  ./logs/error.log
Log format:     { ts, level, domain, msg, ...context }
Log domains:    server, db, auth, http, queue, gen, browserPool, mediaCache, rateLimiter
```

### Configuration override mechanism
```bash
# Override any setting at runtime:
PORT=8080 BROWSER_POOL_SIZE=3 node server.js

# Or in .env file (loaded by dotenv):
FLOW_MODE=browser
JWT_SECRET=your-secret-here
BROWSER_POOL_SIZE=2
```

### Feature flags for debug mode
```env
FLOW_MODE=mock          # Skip real Chrome — instant fake responses
HEADLESS=false          # Show Chrome window during generation
LOG_LEVEL=debug         # Verbose logging (all SQL queries, all HTTP)
MOCK_DELAY_IMAGE=100    # Speed up mock mode for testing
MOCK_DELAY_VIDEO=100    # Speed up mock mode for testing
```

### Health check endpoint
```
GET /health
Returns: status, version, mode, uptime, media_cache stats, browser_pool status, credits
```

### Key file paths
```
Database:       poc.db (or DB_PATH)
Media files:    public/media/
Mock assets:    public/mock-images/ + public/mock-videos/
Session script: scripts/captureSession.js
```

---

## PRIORITY FIX ORDER (before SaaS launch)

1. **[C1]** Restrict CORS origin from `*` to specific domain
2. **[C2]** Remove hardcoded test credentials from `db.js` seed
3. **[C3]** Remove test key from startup banner in `server.js`
4. **[H1]** Add startup validation — crash on missing `JWT_SECRET` and `FLOW_SESSION_COOKIE`
5. **[H2]** Change `FLOW_MODE` default from `mock` to `browser` OR add warning if not explicitly set
6. **[H3]** Move rate limiting to Redis to survive restarts and multiple instances
7. **[H4]** Add `helmet()` middleware for security headers
8. **[M1/M2]** Move reCAPTCHA key and Flow URL to env vars
9. **[L4]** Guard `seedTestUser()` with `NODE_ENV !== 'production'`
10. **[L9]** Add `.env` to `.gitignore` and add a check that verifies it is not tracked

