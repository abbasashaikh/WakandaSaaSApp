// server.js — Phase 2 hardened + Image Upload support
require('dotenv').config({ override: true });

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const multer  = require('multer');
const fs      = require('fs');

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

// ── Uploads directory ─────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads', 'references');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ── Multer config — stores uploaded reference images temporarily ──────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase() || '.jpg'
    const name = `ref_${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`
    cb(null, name)
  },
})

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
    files:    3,
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (allowed.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error(`INVALID_FILE_TYPE: Only JPG, PNG, WebP and GIF are allowed. Got: ${file.mimetype}`))
    }
  },
})

// Export multer instance so generate.js can use it
app.locals.upload = upload

// ── Global middleware ─────────────────────────────────────────────────────────
app.use(cors({
  origin:         '*',
  methods:        ['GET', 'POST', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-License-Key',
    'X-Correlation-ID',
    'X-Platform',
    'ngrok-skip-browser-warning',
    'x-github-token',
  ],
  exposedHeaders: ['X-Correlation-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
  optionsSuccessStatus: 200,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Correlation ID + structured request logger
app.use(correlationMiddleware);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api',           authRoutes);
app.use('/api/generate',  generateRoutes);
app.use('/api/jobs',      jobsRoutes);
app.use('/api/admin',     adminRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
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

// ── Static file routes ────────────────────────────────────────────────────────
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

app.use('/mock-assets', express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag:   true,
}));

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', path: req.path });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  // Handle multer file size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'FILE_TOO_LARGE', message: 'Image must be under 10MB' })
  }
  // Handle multer invalid file type
  if (err.message?.startsWith('INVALID_FILE_TYPE')) {
    return res.status(400).json({ error: 'INVALID_FILE_TYPE', message: err.message })
  }

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
  console.log(`  Upload:  ${UPLOADS_DIR}`);
  console.log('');

  seedTestUser();

  if (typeof pruneExpiredTokens === 'function') {
    pruneExpiredTokens();
    setInterval(pruneExpiredTokens, 60 * 60 * 1000);
  }

  const mediaCache = require('./services/mediaCache');
  mediaCache.pruneOldMedia();
  setInterval(() => mediaCache.pruneOldMedia(), 24 * 60 * 60 * 1000);

  // Prune old reference images every hour (keep for 1 hour after upload)
  setInterval(() => {
    try {
      const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour
      fs.readdirSync(UPLOADS_DIR).forEach(f => {
        const fp = path.join(UPLOADS_DIR, f);
        try {
          const stat = fs.statSync(fp);
          if (stat.mtimeMs < cutoff) fs.unlinkSync(fp);
        } catch {}
      });
    } catch {}
  }, 60 * 60 * 1000);

  try {
    await flowProxy.init();
  } catch (err) {
    sysLogger.warn('server', 'FlowProxy init failed — server still starts', { error: err.message });
    console.warn(`[Server] FlowProxy init warning: ${err.message}`);
  }

  startWorker();
  sessionKeeper.start();

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
    console.log('  POST /api/generate/image   (JSON or multipart with reference_image)');
    console.log('  POST /api/generate/video   (requires auth)');
    console.log('  GET  /api/jobs/:id         (requires auth)');
    console.log('  GET  /health');
    console.log('');
    console.log(`  Test key: poc-test-key-12345678`);
    console.log('');
  });

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
