// routes/jobs.js — Phase 1 updated
// Change: getJob → getJobForUser (Phase 1 db.js rename for IDOR protection)
// The new function takes (jobId, userId) and returns null if user doesn't own the job,
// so the separate ownership check below is now redundant but kept for clarity.
const express = require('express');
const keyAuth  = require('../middleware/keyAuth');
const { getJobForUser, getJobsByUser } = require('../db');
const { getQueueStats } = require('../services/queue');

const router = express.Router();

router.use(keyAuth);

// GET /api/jobs/:id — Poll a specific job
router.get('/:id', (req, res) => {
  const { id } = req.params;

  if (!id || id.length < 10) {
    return res.status(400).json({ error: 'INVALID_JOB_ID' });
  }

  // getJobForUser enforces ownership at DB level — returns null if job
  // belongs to a different user (IDOR protection from Phase 1)
  const job = getJobForUser(id, req.user.id);

  if (!job) {
    // Could be not found OR belongs to another user — return 404 for both
    // (never confirm a job exists to a user who doesn't own it)
    return res.status(404).json({
      error:   'JOB_NOT_FOUND',
      message: `Job ${id} not found`,
    });
  }

  let metadata = {};
  try { metadata = JSON.parse(job.metadata || '{}'); } catch {}

  return res.json({
    job_id:     job.id,
    type:       job.type,
    status:     job.status,
    prompt:     job.prompt,
    output_url: job.output_url || null,
    error:      job.error      || null,
    metadata,
    created_at: job.created_at,
    updated_at: job.updated_at,
    is_done:    job.status === 'completed' || job.status === 'failed',
    poll_again: job.status === 'queued'    || job.status === 'processing',
  });
});

// GET /api/jobs — List recent jobs for the current user
router.get('/', (req, res) => {
  const jobs = getJobsByUser(req.user.id, 20);

  return res.json({
    jobs: jobs.map(job => ({
      job_id:     job.id,
      type:       job.type,
      status:     job.status,
      prompt:     job.prompt.slice(0, 80) + (job.prompt.length > 80 ? '...' : ''),
      output_url: job.output_url || null,
      created_at: job.created_at,
    })),
    count: jobs.length,
  });
});

// GET /api/jobs/stats/queue — Queue stats (admin/debug)
router.get('/stats/queue', async (req, res) => {
  try {
    const stats = await getQueueStats();
    return res.json(stats);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
