// routes/generate.js — Production Grade
// ─────────────────────────────────────────────────────────────────────────────
// Handles both JSON and multipart/form-data for image and video routes.
// Video route accepts: start_frame, end_frame, reference_image (File uploads).
// ─────────────────────────────────────────────────────────────────────────────
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const keyAuth  = require('../middleware/keyAuth');
const { imageRateLimit, videoRateLimit, activeJobGuard } = require('../middleware/rateLimiter');
const { createJob, logAuditEvent } = require('../db');
const { enqueueJob } = require('../services/queue');

const router = express.Router();

// All generation routes require valid license key
router.use(keyAuth);

// ── Multer middleware factory ─────────────────────────────────────────────────
// Applies multer ONLY when Content-Type is multipart/form-data.
// Falls through silently for JSON requests — no breaking change for existing callers.
function withMulter(fields) {
  return (req, res, next) => {
    const upload = req.app.locals.upload;

    // Skip if multer not configured (server.js not updated yet)
    if (!upload) return next();

    // Skip if not a multipart request — let express.json() handle it
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('multipart/form-data')) return next();

    const handler = Array.isArray(fields)
      ? upload.fields(fields)
      : upload.single(fields);

    handler(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE')
          return res.status(400).json({ error: 'FILE_TOO_LARGE', message: 'Image must be under 10MB' });
        if (err.message?.startsWith('INVALID_FILE_TYPE'))
          return res.status(400).json({ error: 'INVALID_FILE_TYPE', message: err.message });
        return res.status(400).json({ error: 'UPLOAD_ERROR', message: err.message });
      }
      next();
    });
  };
}

// ── Helper: safely unlink temp file ──────────────────────────────────────────
function cleanupFile(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch {}
}

function cleanupFiles(...paths) {
  paths.filter(Boolean).forEach(cleanupFile);
}

// ── POST /api/generate/image ──────────────────────────────────────────────────
router.post(
  '/image',
  withMulter('reference_image'),
  imageRateLimit,
  activeJobGuard,
  async (req, res) => {
    const { prompt, model, aspect_ratio } = req.body;
    const userId        = req.user.id;
    const correlationId = req.correlationId;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      if (req.file) cleanupFile(req.file.path);
      return res.status(400).json({ error: 'MISSING_PROMPT', message: 'prompt is required' });
    }
    if (prompt.trim().length > 2000) {
      if (req.file) cleanupFile(req.file.path);
      return res.status(400).json({ error: 'PROMPT_TOO_LONG', message: 'Prompt must be under 2000 characters' });
    }

    const referenceImagePath = req.file ? req.file.path : null;
    const jobId = uuidv4();
    createJob(jobId, userId, 'image', prompt.trim(), correlationId, req.platform || 'unknown');

    try {
      await enqueueJob({
        jobId,
        type:   'image',
        prompt: prompt.trim(),
        options: {
          model:                model        || 'default',
          aspect_ratio:         aspect_ratio || '16:9',
          reference_image_path: referenceImagePath || null,
        },
        userId,
        correlationId,
      });

      req.log?.gen?.info('Image job queued', { jobId, userId: req.user.email, hasReference: !!referenceImagePath });

      logAuditEvent({
        eventType: 'generation.queued', userId, correlationId, ip: req.ip, path: req.path,
        detail:    { jobId, type: 'image', prompt: prompt.trim().slice(0, 100), hasReference: !!referenceImagePath },
        severity:  'info',
      });

      return res.status(202).json({
        job_id:        jobId,
        status:        'queued',
        type:          'image',
        has_reference: !!referenceImagePath,
        message:       'Image generation queued — poll /api/jobs/:id for status',
      });
    } catch (err) {
      cleanupFile(referenceImagePath);
      req.log?.gen?.error('Failed to enqueue image job', { error: err.message });
      return res.status(500).json({ error: 'QUEUE_ERROR', message: 'Failed to queue generation job. Is Redis running?', detail: err.message });
    }
  }
);

// ── POST /api/generate/video ──────────────────────────────────────────────────
// Accepts both:
//   application/json          → { prompt, duration, quality }
//   multipart/form-data       → { prompt, duration, quality, start_frame?, end_frame?, reference_image? }
router.post(
  '/video',
  withMulter([
    { name: 'start_frame',     maxCount: 1 },
    { name: 'end_frame',       maxCount: 1 },
    { name: 'reference_image', maxCount: 1 },
  ]),
  videoRateLimit,
  activeJobGuard,
  async (req, res) => {
    const { prompt, duration, quality, aspect_ratio } = req.body;
    const userId        = req.user.id;
    const correlationId = req.correlationId;

    // Collect any uploaded files for cleanup on error
    const uploadedFiles = [
      req.files?.start_frame?.[0]?.path,
      req.files?.end_frame?.[0]?.path,
      req.files?.reference_image?.[0]?.path,
      req.file?.path, // fallback for single-file upload
    ].filter(Boolean);

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      cleanupFiles(...uploadedFiles);
      return res.status(400).json({ error: 'MISSING_PROMPT', message: 'prompt is required' });
    }
    if (prompt.trim().length > 2000) {
      cleanupFiles(...uploadedFiles);
      return res.status(400).json({ error: 'PROMPT_TOO_LONG', message: 'Prompt must be under 2000 characters' });
    }

    // Normalise duration — accept both "8s" and "8" (number or string)
    const validDurations = ['4s', '6s', '8s'];
    const durationStr    = String(duration || '8').replace(/s$/i, '') + 's'; // "8" → "8s", "8s" → "8s"
    const cleanDuration  = validDurations.includes(durationStr) ? durationStr : '8s';
    const cleanQuality   = ['fast', 'hd'].includes(quality?.toLowerCase()) ? quality.toLowerCase() : 'fast';
    const cleanAspect    = aspect_ratio || '16:9';

    // Extract file paths from multer (upload.fields gives req.files object)
    const startFramePath     = req.files?.start_frame?.[0]?.path     || null;
    const endFramePath       = req.files?.end_frame?.[0]?.path       || null;
    const referenceImagePath = req.files?.reference_image?.[0]?.path || null;

    const jobId = uuidv4();
    createJob(jobId, userId, 'video', prompt.trim(), correlationId, req.platform || 'unknown');

    try {
      await enqueueJob({
        jobId,
        type:   'video',
        prompt: prompt.trim(),
        options: {
          duration:             cleanDuration,
          quality:              cleanQuality,
          aspect_ratio:         cleanAspect,
          start_frame_path:     startFramePath     || null,
          end_frame_path:       endFramePath       || null,
          reference_image_path: referenceImagePath || null,
        },
        userId,
        correlationId,
      });

      req.log?.gen?.info('Video job queued', {
        jobId, userId: req.user.email,
        duration: cleanDuration, quality: cleanQuality,
        hasStart: !!startFramePath, hasEnd: !!endFramePath, hasReference: !!referenceImagePath,
      });

      logAuditEvent({
        eventType: 'generation.queued', userId, correlationId, ip: req.ip, path: req.path,
        detail:    { jobId, type: 'video', prompt: prompt.trim().slice(0, 100), duration: cleanDuration, quality: cleanQuality, hasStart: !!startFramePath, hasEnd: !!endFramePath },
        severity:  'info',
      });

      return res.status(202).json({
        job_id:    jobId,
        status:    'queued',
        type:      'video',
        duration:  cleanDuration,
        quality:   cleanQuality,
        has_start: !!startFramePath,
        has_end:   !!endFramePath,
        message:   'Video generation queued — poll /api/jobs/:id for status',
      });
    } catch (err) {
      cleanupFiles(...uploadedFiles);
      req.log?.gen?.error('Failed to enqueue video job', { error: err.message });
      return res.status(500).json({ error: 'QUEUE_ERROR', message: 'Failed to queue video job. Is Redis running?', detail: err.message });
    }
  }
);

module.exports = router;
