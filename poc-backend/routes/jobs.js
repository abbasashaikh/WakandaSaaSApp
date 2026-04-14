// routes/jobs.js
const express = require('express');
const keyAuth = require('../middleware/keyAuth');
const { getJob, getJobsByUser } = require('../db');
const { getQueueStats } = require('../services/queue');

const router = express.Router();

router.use(keyAuth);

// GET /api/jobs/:id — Poll a specific job
router.get('/:id', (req, res) => {
  const { id } = req.params;

  if (!id || id.length < 10) {
    return res.status(400).json({ error: 'INVALID_JOB_ID' });
  }

  const job = getJob(id);

  if (!job) {
    return res.status(404).json({
      error: 'JOB_NOT_FOUND',
      message: `Job ${id} does not exist`,
    });
  }

  // Ensure user can only access their own jobs
  if (job.user_id !== req.user.id) {
    return res.status(403).json({
      error: 'FORBIDDEN',
      message: 'You do not have access to this job',
    });
  }

  // Parse metadata safely
  let metadata = {};
  try {
    metadata = JSON.parse(job.metadata || '{}');
  } catch {}

  return res.json({
    job_id: job.id,
    type: job.type,
    status: job.status,
    prompt: job.prompt,
    output_url: job.output_url || null,
    error: job.error || null,
    metadata,
    created_at: job.created_at,
    updated_at: job.updated_at,
    // Hints for the frontend
    is_done: job.status === 'completed' || job.status === 'failed',
    poll_again: job.status === 'queued' || job.status === 'processing',
  });
});

// GET /api/jobs — List recent jobs for the current user
router.get('/', (req, res) => {
  const jobs = getJobsByUser(req.user.id, 20);

  return res.json({
    jobs: jobs.map(job => ({
      job_id: job.id,
      type: job.type,
      status: job.status,
      prompt: job.prompt.slice(0, 80) + (job.prompt.length > 80 ? '...' : ''),
      output_url: job.output_url || null,
      created_at: job.created_at,
    })),
    count: jobs.length,
  });
});

// GET /api/jobs/stats/queue — Queue stats (for debugging)
router.get('/stats/queue', async (req, res) => {
  try {
    const stats = await getQueueStats();
    return res.json(stats);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
