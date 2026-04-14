// routes/generate.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const keyAuth = require('../middleware/keyAuth');
const { createJob } = require('../db');
const { enqueueJob } = require('../services/queue');

const router = express.Router();

// All generation routes require a valid license key
router.use(keyAuth);

// ─── POST /api/generate/image ─────────────────────────────────
router.post('/image', async (req, res) => {
  const { prompt, model, aspect_ratio } = req.body;

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({
      error: 'MISSING_PROMPT',
      message: 'prompt is required',
    });
  }

  if (prompt.trim().length > 2000) {
    return res.status(400).json({
      error: 'PROMPT_TOO_LONG',
      message: 'Prompt must be under 2000 characters',
    });
  }

  const jobId = uuidv4();
  const userId = req.user.id;

  // Create job record in DB
  createJob(jobId, userId, 'image', prompt.trim());

  // Enqueue for processing
  try {
    await enqueueJob({
      jobId,
      type: 'image',
      prompt: prompt.trim(),
      options: {
        model: model || 'default',
        aspect_ratio: aspect_ratio || '16:9',
      },
      userId,
    });

    console.log(`[Generate] Image job queued: ${jobId} by user ${req.user.email}`);

    return res.status(202).json({
      job_id: jobId,
      status: 'queued',
      type: 'image',
      message: 'Image generation queued — poll /api/jobs/:id for status',
    });
  } catch (err) {
    console.error('[Generate] Failed to enqueue image job:', err.message);
    return res.status(500).json({
      error: 'QUEUE_ERROR',
      message: 'Failed to queue generation job. Is Redis running?',
      detail: err.message,
    });
  }
});

// ─── POST /api/generate/video ─────────────────────────────────
router.post('/video', async (req, res) => {
  const { prompt, duration, quality } = req.body;

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({
      error: 'MISSING_PROMPT',
      message: 'prompt is required',
    });
  }

  if (prompt.trim().length > 2000) {
    return res.status(400).json({
      error: 'PROMPT_TOO_LONG',
      message: 'Prompt must be under 2000 characters',
    });
  }

  const validDurations = [4, 8, 16];
  const parsedDuration = parseInt(duration) || 8;

  if (!validDurations.includes(parsedDuration)) {
    return res.status(400).json({
      error: 'INVALID_DURATION',
      message: `duration must be one of: ${validDurations.join(', ')}`,
    });
  }

  const validQualities = ['fast', 'hd'];
  const normalizedQuality = (quality || 'fast').toLowerCase();

  if (!validQualities.includes(normalizedQuality)) {
    return res.status(400).json({
      error: 'INVALID_QUALITY',
      message: `quality must be one of: ${validQualities.join(', ')}`,
    });
  }

  const jobId = uuidv4();
  const userId = req.user.id;

  createJob(jobId, userId, 'video', prompt.trim());

  try {
    await enqueueJob({
      jobId,
      type: 'video',
      prompt: prompt.trim(),
      options: {
        duration: parsedDuration,
        quality: normalizedQuality,
      },
      userId,
    });

    console.log(`[Generate] Video job queued: ${jobId} by user ${req.user.email}`);

    return res.status(202).json({
      job_id: jobId,
      status: 'queued',
      type: 'video',
      estimated_seconds: parsedDuration === 4 ? 60 : 90,
      message: 'Video generation queued — poll /api/jobs/:id for status',
    });
  } catch (err) {
    console.error('[Generate] Failed to enqueue video job:', err.message);
    return res.status(500).json({
      error: 'QUEUE_ERROR',
      message: 'Failed to queue generation job. Is Redis running?',
      detail: err.message,
    });
  }
});

module.exports = router;
