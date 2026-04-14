// services/queue.js
// ============================================================
// BullMQ job queue — concurrency 1 (one job at a time)
// Prevents concurrent Flow session conflicts
// ============================================================
require('dotenv').config();
const { Queue, Worker, QueueEvents } = require('bullmq');
const { updateJob } = require('../db');
const flowProxy = require('./flowProxy');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Parse Redis URL into ioredis connection options
function parseRedisUrl(url) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || '127.0.0.1',
      port: parseInt(parsed.port) || 6379,
      password: parsed.password || undefined,
      db: parseInt(parsed.pathname?.replace('/', '') || '0') || 0,
    };
  } catch {
    return { host: '127.0.0.1', port: 6379 };
  }
}

const redisConnection = parseRedisUrl(REDIS_URL);

// Create the queue
const generationQueue = new Queue('generation-queue', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,               // Retry once on failure
    backoff: { type: 'fixed', delay: 5000 },
    removeOnComplete: 100,     // Keep last 100 completed
    removeOnFail: 200,         // Keep last 200 failed
  },
});

// Queue events for monitoring
const queueEvents = new QueueEvents('generation-queue', {
  connection: redisConnection,
});

queueEvents.on('completed', ({ jobId }) => {
  console.log(`[Queue] Job ${jobId} completed`);
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  console.error(`[Queue] Job ${jobId} failed: ${failedReason}`);
});

// ─── Worker — concurrency 1 ───────────────────────────────────
let worker;

function startWorker() {
  worker = new Worker(
    'generation-queue',
    async (job) => {
      const { jobId, type, prompt, options, userId } = job.data;

      console.log(`[Worker] Processing job ${jobId} | type=${type} | prompt="${prompt}"`);

      // Mark as processing
      updateJob(jobId, { status: 'processing' });

      let result;

      if (type === 'image') {
        result = await flowProxy.generateImage(prompt, options || {});
      } else if (type === 'video') {
        result = await flowProxy.generateVideo(prompt, options || {});
      } else {
        throw new Error(`Unknown job type: ${type}`);
      }

      // Mark as completed
      updateJob(jobId, {
        status: 'completed',
        output_url: result.output_url,
        metadata: JSON.stringify(result.metadata || {}),
      });

      console.log(`[Worker] Job ${jobId} completed → ${result.output_url}`);
      return result;
    },
    {
      connection: redisConnection,
      concurrency: 1, // ← CRITICAL: one at a time
    }
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    const { jobId } = job.data;
    console.error(`[Worker] Job ${jobId} failed: ${err.message}`);

    updateJob(jobId, {
      status: 'failed',
      error: err.message,
    });
  });

  worker.on('error', (err) => {
    console.error('[Worker] Worker error:', err.message);
  });

  console.log('[Queue] Worker started (concurrency=1)');
}

// Add a job to the queue
async function enqueueJob({ jobId, type, prompt, options, userId }) {
  const job = await generationQueue.add(
    `${type}-generation`,
    { jobId, type, prompt, options, userId },
    {
      jobId: `bullmq-${jobId}`, // Use our UUID as BullMQ job ID
    }
  );

  console.log(`[Queue] Enqueued job ${jobId} (BullMQ: ${job.id})`);
  return job;
}

// Get queue stats
async function getQueueStats() {
  const [waiting, active, completed, failed] = await Promise.all([
    generationQueue.getWaitingCount(),
    generationQueue.getActiveCount(),
    generationQueue.getCompletedCount(),
    generationQueue.getFailedCount(),
  ]);

  return { waiting, active, completed, failed };
}

async function closeQueue() {
  if (worker) await worker.close();
  await generationQueue.close();
  await queueEvents.close();
  console.log('[Queue] Closed');
}

module.exports = { startWorker, enqueueJob, getQueueStats, closeQueue };
