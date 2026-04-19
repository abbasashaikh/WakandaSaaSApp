// services/queue.js — BullMQ job queue
require('dotenv').config();
const { Queue, Worker, QueueEvents } = require('bullmq');
const { updateJob } = require('../db');
const flowProxy = require('./flowProxy');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

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

const generationQueue = new Queue('generation-queue', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

const queueEvents = new QueueEvents('generation-queue', {
  connection: redisConnection,
});

queueEvents.on('completed', ({ jobId }) => {
  console.log(`[Queue] Job ${jobId} completed`);
});
queueEvents.on('failed', ({ jobId, failedReason }) => {
  console.log(`[Queue] Job ${jobId} failed: ${failedReason}`);
});

let worker;

function startWorker() {
  worker = new Worker(
    'generation-queue',
    async (job) => {
      const { jobId, type, prompt, options, userId } = job.data;
      console.log(`[Worker] Processing job ${jobId} | type=${type} | prompt="${prompt}"`);
      updateJob(jobId, { status: 'processing' });

      let result;
      if (type === 'image') {
        result = await flowProxy.generateImage(prompt, options || {});
      } else if (type === 'video') {
        result = await flowProxy.generateVideo(prompt, options || {});
      } else {
        throw new Error(`Unknown job type: ${type}`);
      }

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
      concurrency: 1,
      // CRITICAL: Video generation takes 5-8 minutes
      // lockDuration must exceed the total job time to prevent "could not renew lock"
      // Default is 30000ms (30s) — way too short for video
      lockDuration:  600000,   // 10 minutes lock
      lockRenewTime: 150000,   // Renew every 2.5 minutes (must be < lockDuration/2)
    }
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    const { jobId } = job.data;
    console.error(`[Worker] Job ${jobId} failed: ${err.message}`);
    updateJob(jobId, { status: 'failed', error: err.message });
  });

  worker.on('error', (err) => {
    console.error('[Worker] Worker error:', err.message);
  });

  console.log('[Queue] Worker started (concurrency=1, lockDuration=10min)');
}

async function enqueueJob({ jobId, type, prompt, options, userId }) {
  const job = await generationQueue.add(
    `${type}-generation`,
    { jobId, type, prompt, options: options || {}, userId },
    { jobId: `bullmq-${jobId}` }
  );
  console.log(`[Queue] Enqueued job ${jobId} (BullMQ: ${job.id})`);
  return job;
}

async function stopWorker() {
  if (worker) {
    await worker.close();
    worker = null;
  }
}

module.exports = { startWorker, stopWorker, enqueueJob };
