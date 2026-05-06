// server.js — Phase 2 hardened
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

// ── Middleware ─────────────────────────────────────────────────────────────
const { correlationMiddleware, sysLogger } = require('./middleware/logger');

// ── Routes ─────────────────────────────────────────────────────────────────
const authRoutes     = require('./routes/auth');
const generateRoutes = require('./routes/generate');
const jobsRoutes     = require('./routes/jobs');
const adminRoutes    = require('./routes/admin');

// ── Services ────────────────────────────────────────────────────────────────
const flowProxy               = require('./services/flowProxy');
const { startWorker }         = require('./services/queue');
const sessionKeeper           = require('./services/sessionKeeper');
const { seedTestUser, pruneExpiredTokens } = require('./db');

const PORT = parseInt(process.env.PORT || '3001');
const app  = express();

// ── Global middleware ────────────────────────────────────────────────────────
app.use(cors({
  origin:         '*',
  methods:        ['GET', 'POST', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-License-Key',
    'X-Correlation-ID',
    'X-Platform',                  // platform flag (windows/android/web)
    'ngrok-skip-browser-warning',  // bypass ngrok interstitial page
    'x-github-token',              // bypass GitHub Codespace auth wall
  ],
  exposedHeaders: ['X-Correlation-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
  optionsSuccessStatus: 200,       // some browsers (IE11) choke on 204
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Correlation ID + structured request logger (Phase 1)
app.use(correlationMiddleware);

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api',           authRoutes);      // /api/auth/* + /api/validate-key + /api/register
app.use('/api/generate',  generateRoutes);  // /api/generate/image + /api/generate/video
app.use('/api/jobs',      jobsRoutes);      // /api/jobs/:id + /api/jobs
app.use('/api/admin',     adminRoutes);     // /api/admin/* (requires admin role)

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const mediaCache = require('./services/mediaCache');
  const { getPoolStatus } = require('./services/flowProxy');
  const cacheStats = mediaCache.getCacheStats();
  res.json({
    status:    'ok',
    version:   '2.0.0-phase4',
    mode:      process.env.FLOW_MODE || 'browser',
    timestamp: new Date().toISOString(),
    uptime:    Math.floor(process.uptime()),
    media_cache: cacheStats,
    browser_pool: (() => { try { return getPoolStatus(); } catch { return null; } })(),
  });
});

// ── Static file routes — MUST be before the 404 handler ────────────────────────
// /media serves generated images and videos (Phase 4 media cache)
app.use('/media', express.static(path.join(__dirname, 'public', 'media'), {
  maxAge: '7d',
  etag:    true,
  setHeaders: (res, filePath) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (filePath.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
    }
  },
}));

// /mock-assets serves mock images/videos used in FLOW_MODE=mock
app.use('/mock-assets', express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag:   true,
}));

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', path: req.path });
});

// ── Global error handler ──────────────────────────────────────────────────────
// Catches any unhandled errors thrown in route handlers
app.use((err, req, res, next) => {
  req.log?.sys.error('Unhandled error', { error: err.message, stack: err.stack?.slice(0, 500) });
  sysLogger.error('server', 'Unhandled request error', {
    correlationId: req.correlationId,
    error:         err.message,
    path:          req.path,
    method:        req.method,
  });

  res.status(500).json({
    error:          'INTERNAL_ERROR',
    message:        process.env.NODE_ENV === 'production' ? 'An internal error occurred' : err.message,
    correlation_id: req.correlationId,
  });
});

// ── Unhandled rejection safety net ───────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  sysLogger.error('server', 'UnhandledRejection', { error: String(reason) });
  console.error('[UnhandledRejection]', reason);
});

// ── Startup ───────────────────────────────────────────────────────────────────
async function start() {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║     AI Creative Studio POC Backend     ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');
  console.log(`  Mode:    ${(process.env.FLOW_MODE || 'mock').toUpperCase()}`);
  console.log(`  Port:    ${PORT}`);
  console.log(`  Redis:   ${process.env.REDIS_URL || 'redis://localhost:6379'}`);
  console.log(`  Auth:    JWT (HS256) + X-License-Key (legacy compat)`);
  console.log('');


  // Seed test user + schema migration
  seedTestUser();

  // Prune expired refresh tokens at startup and every hour
  if (typeof pruneExpiredTokens === 'function') {
    pruneExpiredTokens();
    setInterval(pruneExpiredTokens, 60 * 60 * 1000);
  }

  // Prune expired media files (older than 7 days) at startup and daily
  const mediaCache = require('./services/mediaCache');
  mediaCache.pruneOldMedia();
  setInterval(() => mediaCache.pruneOldMedia(), 24 * 60 * 60 * 1000);

  // Init browser (non-blocking for mock mode)
  try {
    await flowProxy.init();
  } catch (err) {
    sysLogger.warn('server', 'FlowProxy init failed — server still starts', { error: err.message });
    console.warn(`[Server] FlowProxy init warning: ${err.message}`);
  }

  // Start BullMQ worker
  startWorker();

  // Start session keepalive
  sessionKeeper.start();

  // Start listening
  const server = app.listen(PORT, () => {
    sysLogger.info('server', `Server running on port ${PORT}`);
    console.log(`✅ Server running at http://localhost:${PORT}`);
    console.log('');
    console.log('  Endpoints:');
    console.log('  POST /api/auth/login       (exchange license key for JWT)');
    console.log('  POST /api/auth/refresh     (refresh access token)');
    console.log('  POST /api/auth/logout      (revoke session)');
    console.log('  GET  /api/auth/me          (current user)');
    console.log('  POST /api/validate-key     (legacy — still works)');
    console.log('  POST /api/generate/image   (requires auth)');
    console.log('  POST /api/generate/video   (requires auth)');
    console.log('  GET  /api/jobs/:id         (requires auth)');
        console.log('  GET  /health');
    console.log('');
    console.log(`  Test key: poc-test-key-12345678`);
    console.log('');
  });

  // ── Graceful shutdown ────────────────────────────────────────────────────
  async function shutdown(signal) {
    sysLogger.info('server', `${signal} received — shutting down gracefully`);
    console.log(`\n[Server] ${signal} received — shutting down...`);

    sessionKeeper.stop();

    server.close(async () => {
      const { stopWorker } = require('./services/queue');
      await stopWorker();
      sysLogger.info('server', 'Clean shutdown complete');
      process.exit(0);
    });

    setTimeout(() => {
      sysLogger.error('server', 'Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch(err => {
  sysLogger.error('server', 'Failed to start', { error: err.message });
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
