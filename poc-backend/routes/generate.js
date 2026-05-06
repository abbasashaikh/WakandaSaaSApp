// routes/generate.js — Phase 1 hardened
// ─────────────────────────────────────────────────────────────────────────────
// Changes from POC:
//   + Per-user rate limiting on image and video routes
//   + activeJobGuard: max 2 queued/processing jobs per user at once
//   + correlationId threaded from request into job record
//   + Structured logging on all paths
//   + logAuditEvent on generation.queued
// ─────────────────────────────────────────────────────────────────────────────
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const keyAuth  = require('../middleware/keyAuth');
const { imageRateLimit, videoRateLimit, activeJobGuard } = require('../middleware/rateLimiter');
const { createJob, logAuditEvent } = require('../db');
const { enqueueJob } = require('../services/queue');

const router = express.Router();

// All generation routes require valid license key
router.use(keyAuth);

// ── POST /api/generate/image ──────────────────────────────────────────────────
router.post(
  '/image',
  imageRateLimit,    // per-user rate limit
  activeJobGuard,    // max N active jobs per user
  async (req, res) => {
    const { prompt, model, aspect_ratio } = req.body;
    const userId        = req.user.id;
    const correlationId = req.correlationId;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'MISSING_PROMPT', message: 'prompt is required' });
    }
    if (prompt.trim().length > 2000) {
      return res.status(400).json({ error: 'PROMPT_TOO_LONG', message: 'Prompt must be under 2000 characters' });
    }

    const jobId = uuidv4();

    createJob(jobId, userId, 'image', prompt.trim(), correlationId, req.platform || 'unknown');

    try {
      await enqueueJob({
        jobId,
        type:   'image',
        prompt: prompt.trim(),
        options: {
          model:        model        || 'default',
          aspect_ratio: aspect_ratio || '16:9',
        },
        userId,
        correlationId,
      });

      req.log?.gen?.info('Image job queued', { jobId, userId: req.user.email });

      logAuditEvent({
        eventType:     'generation.queued',
        userId,
        correlationId,
        ip:     req.ip,
        path:   req.path,
        detail: { jobId, type: 'image', prompt: prompt.trim().slice(0, 100) },
        severity: 'info',
      });

      return res.status(202).json({
        job_id: jobId,
        status: 'queued',
        type:   'image',
        message: 'Image generation queued — poll /api/jobs/:id for status',
      });
    } catch (err) {
      req.log?.gen?.error('Failed to enqueue image job', { error: err.message });
      return res.status(500).json({
        error:   'QUEUE_ERROR',
        message: 'Failed to queue generation job. Is Redis running?',
        detail:  err.message,
      });
    }
  }
);

// ── POST /api/generate/video ──────────────────────────────────────────────────
router.post(
  '/video',
  videoRateLimit,    // stricter limit — videos cost 10× credits
  activeJobGuard,
  async (req, res) => {
    const { prompt, duration, quality } = req.body;
    const userId        = req.user.id;
    const correlationId = req.correlationId;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'MISSING_PROMPT', message: 'prompt is required' });
    }
    if (prompt.trim().length > 2000) {
      return res.status(400).json({ error: 'PROMPT_TOO_LONG', message: 'Prompt must be under 2000 characters' });
    }

    const validDurations = ['4s', '8s'];
    const validQualities = ['fast', 'hd'];
    const cleanDuration  = validDurations.includes(duration) ? duration : '8s';
    const cleanQuality   = validQualities.includes(quality?.toLowerCase()) ? quality.toLowerCase() : 'fast';

    const jobId = uuidv4();

    createJob(jobId, userId, 'video', prompt.trim(), correlationId, req.platform || 'unknown');

    try {
      await enqueueJob({
        jobId,
        type:   'video',
        prompt: prompt.trim(),
        options: { duration: cleanDuration, quality: cleanQuality },
        userId,
        correlationId,
      });

      req.log?.gen?.info('Video job queued', { jobId, userId: req.user.email, duration: cleanDuration, quality: cleanQuality });

      logAuditEvent({
        eventType: 'generation.queued',
        userId,
        correlationId,
        ip:     req.ip,
        path:   req.path,
        detail: { jobId, type: 'video', prompt: prompt.trim().slice(0, 100), duration: cleanDuration, quality: cleanQuality },
        severity: 'info',
      });

      return res.status(202).json({
        job_id:   jobId,
        status:   'queued',
        type:     'video',
        duration: cleanDuration,
        quality:  cleanQuality,
        message:  'Video generation queued — poll /api/jobs/:id for status',
      });
    } catch (err) {
      req.log?.gen?.error('Failed to enqueue video job', { error: err.message });
      return res.status(500).json({
        error:   'QUEUE_ERROR',
        message: 'Failed to queue video job. Is Redis running?',
        detail:  err.message,
      });
    }
  }
);

module.exports = router;
