// server.js — Express app entry point
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

// ─── Routes ──────────────────────────────────────────────────
const authRoutes     = require('./routes/auth');
const generateRoutes = require('./routes/generate');
const jobsRoutes     = require('./routes/jobs');

// ─── Services ────────────────────────────────────────────────
const flowProxy      = require('./services/flowProxy');
const { startWorker } = require('./services/queue');
const sessionKeeper  = require('./services/sessionKeeper');

const PORT = parseInt(process.env.PORT || '3001');
const app = express();

// ─── Middleware ───────────────────────────────────────────────
app.use(cors({
  origin: '*', // POC: allow all origins
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-License-Key', 'Authorization'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve local mock assets (images + videos) — no external URLs needed
app.use('/mock-assets', express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Accept-Ranges', 'bytes'); // required for HTML5 video scrubbing
  }
}));

// Request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[HTTP] ${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// ─── Routes ──────────────────────────────────────────────────
app.use('/api', authRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/jobs', jobsRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0-poc',
    mode: process.env.FLOW_MODE || 'mock',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', path: req.path });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: err.message,
  });
});

// ─── Startup ─────────────────────────────────────────────────
async function start() {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║     AI Creative Studio POC Backend     ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');
  console.log(`  Mode:  ${(process.env.FLOW_MODE || 'mock').toUpperCase()}`);
  console.log(`  Port:  ${PORT}`);
  console.log(`  Redis: ${process.env.REDIS_URL || 'redis://localhost:6379'}`);
  console.log('');

  // Initialize Flow proxy
  try {
    await flowProxy.init();
  } catch (err) {
    console.error('[Startup] FlowProxy init error (non-fatal):', err.message);
    if (process.env.FLOW_MODE === 'browser' || process.env.FLOW_MODE === 'api') {
      console.warn('[Startup] ⚠️  Flow init failed. Set FLOW_MODE=mock to test without credentials.');
    }
  }

  // Start BullMQ worker
  try {
    startWorker();
  } catch (err) {
    console.error('[Startup] Worker start error:', err.message);
    console.warn('[Startup] ⚠️  Jobs will be queued but not processed until Redis is available.');
  }

  // Start session keeper
  sessionKeeper.start();

  // Start HTTP server
  app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
    console.log('');
    console.log('  Endpoints:');
    console.log(`  POST /api/validate-key`);
    console.log(`  POST /api/register`);
    console.log(`  POST /api/generate/image  (requires X-License-Key)`);
    console.log(`  POST /api/generate/video  (requires X-License-Key)`);
    console.log(`  GET  /api/jobs/:id        (requires X-License-Key)`);
    console.log(`  GET  /health`);
    console.log('');
    console.log('  Test key: poc-test-key-12345678');
    console.log('');
  });
}

// ─── Graceful shutdown ────────────────────────────────────────
async function shutdown(signal) {
  console.log(`\n[Server] ${signal} received — shutting down...`);
  sessionKeeper.stop();
  await flowProxy.destroy().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('[Uncaught]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
});

start();
