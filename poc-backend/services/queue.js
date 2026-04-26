// services/queue.js — Phase 1 hardened
// ─────────────────────────────────────────────────────────────────────────────
// Changes from POC:
//   + userId passed to flowProxy.generate* (fixes shared project state)
//   + correlationId tracked through job lifecycle
//   + Structured logging on all failure paths
//   + lockDuration = 10 min (video jobs take up to 8 min)
//   + lockRenewTime = 2.5 min (must be < lockDuration/2)
//   + concurrency = 1 for Phase 1 (safe single-browser, will increase in Phase 4)
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const { Queue, Worker, QueueEvents } = require('bullmq');
const { updateJob, logAuditEvent }   = require('../db');
const flowProxy = require('./flowProxy');
const { sysLogger } = require('../middleware/logger');
const { makeRequestLogger } = require('../middleware/logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

function parseRedisUrl(url) {
  try {
    const p = new URL(url);
    return {
      host:     p.hostname || '127.0.0.1',
      port:     parseInt(p.port) || 6379,
      password: p.password || undefined,
      db:       parseInt(p.pathname?.replace('/', '') || '0') || 0,
    };
  } catch {
    return { host: '127.0.0.1', port: 6379 };
  }
}

const redisConnection = parseRedisUrl(REDIS_URL);

// ── Queue definition ──────────────────────────────────────────────────────────
const generationQueue = new Queue('generation-queue', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts:    3,                           // retry up to 3× on failure
    backoff: { type: 'exponential', delay: 10000 }, // 10s, 20s, 40s back-off
    removeOnComplete: 100,
    removeOnFail:     200,
  },
});

const queueEvents = new QueueEvents('generation-queue', { connection: redisConnection });

queueEvents.on('completed', ({ jobId }) => sysLogger.info('queue', `Job completed`, { bullJobId: jobId }));
queueEvents.on('failed',    ({ jobId, failedReason }) => sysLogger.error('queue', `Job failed`, { bullJobId: jobId, reason: failedReason }));

// ── Worker ────────────────────────────────────────────────────────────────────
let worker;

function startWorker() {
  worker = new Worker(
    'generation-queue',
    async (job) => {
      const { jobId, type, prompt, options, userId, correlationId } = job.data;

      // Create a request-scoped logger using the job's correlation ID
      const log = makeRequestLogger(correlationId || job.id, userId);

      log.queue.info(`Processing job`, { jobId, type, attempt: job.attemptsMade + 1 });
      console.log(`[Worker] Processing job ${jobId} | type=${type} | prompt="${prompt.slice(0, 60)}"`);

      updateJob(jobId, {
        status:        'processing',
        attempt_count: job.attemptsMade + 1,
      });

      let result;

      try {
        if (type === 'image') {
          result = await flowProxy.generateImage(prompt, { ...options, userId, jobId });
        } else if (type === 'video') {
          result = await flowProxy.generateVideo(prompt, { ...options, userId, jobId });
        } else {
          throw new Error(`Unknown job type: ${type}`);
        }
      } catch (genErr) {
        const maxAttempts  = job.opts?.attempts ?? 1;
        const isFinalAttempt = job.attemptsMade >= maxAttempts - 1;

        // Use WARN for retryable failures, ERROR only for final permanent failure.
        // This prevents alarming [ERROR] logs for transient issues that self-recover.
        if (isFinalAttempt) {
          log.gen.error('Generation failed', {
            jobId, type,
            error:   genErr.message,
            attempt: job.attemptsMade + 1,
            maxAttempts,
          });
          logAuditEvent({
            eventType: 'generation.failed',
            userId, correlationId,
            detail: { jobId, type, error: genErr.message, attempt: job.attemptsMade + 1 },
            severity: 'error',
          });
        } else {
          log.gen.warn('Generation attempt failed (will retry)', {
            jobId, type,
            error:        genErr.message,
            attempt:      job.attemptsMade + 1,
            maxAttempts,
            nextAttemptIn: `${Math.pow(2, job.attemptsMade) * 10}s`,
          });
          logAuditEvent({
            eventType: 'generation.attempt_failed',
            userId, correlationId,
            detail: { jobId, type, error: genErr.message, attempt: job.attemptsMade + 1 },
            severity: 'warn',
          });
        }

        throw genErr; // rethrow so BullMQ handles retry
      }

      // Phase 4: Persist media to local cache (CDN URLs expire in ~20 min)
      const mediaCache = require('./mediaCache');
      const localUrl   = await mediaCache.persist(result.output_url, jobId, type);
      if (localUrl !== result.output_url) {
        console.log(`[Worker] Media cached: ${result.output_url?.slice(0,60)} → ${localUrl}`);
      }

      // Success
      updateJob(jobId, {
        status:     'completed',
        output_url: localUrl,
        metadata:   JSON.stringify(result.metadata || {}),
      });

      log.gen.info('Generation completed', { jobId, type, url: localUrl?.slice(0, 60) });
      console.log(`[Worker] Job ${jobId} completed → ${localUrl}`);

      logAuditEvent({
        eventType: 'generation.completed',
        userId,
        correlationId,
        detail:    { jobId, type },
        severity:  'info',
      });

      return result;
    },
    {
      connection:    redisConnection,
      // Phase 3: concurrency matches pool size exactly
      // Each concurrent job gets its own isolated browser context from the pool
      // Default BROWSER_POOL_SIZE=2 → 2 concurrent generation jobs
      // Increase to 3+ in .env for more users (each slot ~500MB RAM)
      concurrency:   parseInt(process.env.BROWSER_POOL_SIZE || '1'),
      lockDuration:  600_000,        // 10 minutes — covers longest video job
      lockRenewTime: 150_000,        // renew every 2.5 min (must be < lockDuration/2)
    }
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    const { jobId, userId, correlationId } = job.data;
    const maxAttempts = job.opts?.attempts ?? 1;
    const noRetries   = job.attemptsMade >= maxAttempts - 1;
    const willRetry   = !noRetries;

    if (noRetries) {
      // All retries exhausted — mark permanently failed
      updateJob(jobId, { status: 'failed', error: err.message });
      sysLogger.error('queue', `Job permanently failed (all retries exhausted)`, {
        jobId, userId, correlationId,
        error: err.message, attempts: job.attemptsMade, maxAttempts,
      });
      console.error(`[Worker] Job ${jobId} permanently failed (attempt ${job.attemptsMade + 1}/${maxAttempts}): ${err.message}`);
    } else {
      // Will retry — set status back to 'queued' so Electron keeps polling
      // and does NOT display the intermediate error to the user
      updateJob(jobId, { status: 'queued', attempt_count: job.attemptsMade + 1 });
      sysLogger.warn('queue', `Job attempt failed, will retry`, {
        jobId, userId, correlationId,
        error: err.message,
        attempt: job.attemptsMade + 1, maxAttempts,
        nextAttemptIn: `${Math.pow(2, job.attemptsMade) * 10}s`,
      });
      console.warn(`[Worker] Job ${jobId} attempt ${job.attemptsMade + 1}/${maxAttempts} failed (retrying): ${err.message}`);
    }
  });

  worker.on('error', (err) => {
    sysLogger.error('queue', 'Worker error', { error: err.message });
    console.error('[Worker] Worker error:', err.message);
  });

  sysLogger.info('queue', 'Worker started', { concurrency: 1, lockDurationMin: 10 });
  console.log('[Queue] Worker started (concurrency=1, lockDuration=10min)');
}

// ── Enqueue ───────────────────────────────────────────────────────────────────
async function enqueueJob({ jobId, type, prompt, options, userId, correlationId }) {
  const job = await generationQueue.add(
    `${type}-generation`,
    { jobId, type, prompt, options: options || {}, userId, correlationId },
    { jobId: `bullmq-${jobId}` }
  );

  sysLogger.info('queue', `Job enqueued`, { jobId, type, userId, bullJobId: job.id });
  console.log(`[Queue] Enqueued job ${jobId} (BullMQ: ${job.id})`);
  return job;
}

async function getQueueStats() {
  const [waiting, active, completed, failed] = await Promise.all([
    generationQueue.getWaitingCount(),
    generationQueue.getActiveCount(),
    generationQueue.getCompletedCount(),
    generationQueue.getFailedCount(),
  ]);
  return { waiting, active, completed, failed };
}

async function stopWorker() {
  if (worker) { await worker.close(); worker = null; }
}

module.exports = { startWorker, stopWorker, enqueueJob, getQueueStats };
