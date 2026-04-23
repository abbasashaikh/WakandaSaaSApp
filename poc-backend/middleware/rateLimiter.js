// middleware/rateLimiter.js
// ─────────────────────────────────────────────────────────────────────────────
// Per-user sliding-window rate limiter for generation endpoints.
//
// WHY THIS EXISTS:
//   Without rate limiting, a single user can:
//     1. Exhaust all Google Flow credits for every user
//     2. Flood the BullMQ queue making other users wait indefinitely
//     3. Cause reCAPTCHA blocks that affect everyone sharing the browser pool
//
// DESIGN:
//   - In-memory sliding window (good for single-node POC → Phase 5 replaces
//     with Redis-backed counter for multi-node production)
//   - Separate limits for images vs videos (videos are 10× more expensive)
//   - Limit is per userId, not per IP (IPs can be shared via NAT)
//   - Returns 429 with Retry-After header so client can back off gracefully
//
// LIMITS (tunable via env vars):
//   IMAGE_RATE_LIMIT  = max image jobs per window (default: 10)
//   VIDEO_RATE_LIMIT  = max video jobs per window (default: 3)
//   RATE_WINDOW_SEC   = sliding window in seconds  (default: 60)
// ─────────────────────────────────────────────────────────────────────────────
const { sysLogger } = require('./logger');

const IMAGE_LIMIT   = parseInt(process.env.IMAGE_RATE_LIMIT  || '10');
const VIDEO_LIMIT   = parseInt(process.env.VIDEO_RATE_LIMIT  || '3');
const WINDOW_MS     = parseInt(process.env.RATE_WINDOW_SEC   || '60') * 1000;

// Map<userId, { image: number[], video: number[] }>
// Each array contains timestamps of requests in the current window
const windows = new Map();

function getWindow(userId) {
  if (!windows.has(userId)) {
    windows.set(userId, { image: [], video: [] });
  }
  return windows.get(userId);
}

function pruneOld(timestamps, now) {
  const cutoff = now - WINDOW_MS;
  return timestamps.filter(ts => ts > cutoff);
}

// Clean up stale entries every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [userId, w] of windows.entries()) {
    w.image = pruneOld(w.image, now);
    w.video = pruneOld(w.video, now);
    if (w.image.length === 0 && w.video.length === 0) {
      windows.delete(userId);
    }
  }
}, 5 * 60 * 1000);

/**
 * Factory: creates rate limit middleware for a specific generation type.
 * @param {'image'|'video'} type
 */
function createRateLimiter(type) {
  const limit = type === 'video' ? VIDEO_LIMIT : IMAGE_LIMIT;

  return function rateLimitMiddleware(req, res, next) {
    // Must run after keyAuth so req.user is set
    if (!req.user) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    const userId = req.user.id;
    const now    = Date.now();
    const win    = getWindow(userId);

    // Prune old timestamps
    win[type] = pruneOld(win[type], now);

    const count = win[type].length;

    if (count >= limit) {
      // Oldest timestamp tells us when the window will have space
      const oldestTs   = win[type][0];
      const retryAfter = Math.ceil((oldestTs + WINDOW_MS - now) / 1000);

      req.log?.perm.warn(`Rate limit exceeded`, {
        type, count, limit,
        retryAfterSec: retryAfter,
      });

      sysLogger.warn('rateLimiter', `User ${userId} exceeded ${type} rate limit`, {
        userId, type, count, limit,
      });

      res.setHeader('Retry-After', retryAfter);
      res.setHeader('X-RateLimit-Limit',     limit);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('X-RateLimit-Reset',     Math.ceil((oldestTs + WINDOW_MS) / 1000));

      return res.status(429).json({
        error:       'RATE_LIMIT_EXCEEDED',
        message:     `Too many ${type} generation requests. Maximum ${limit} per ${WINDOW_MS / 1000}s.`,
        retry_after: retryAfter,
        limit,
        window_sec:  WINDOW_MS / 1000,
      });
    }

    // Record this request
    win[type].push(now);

    // Expose remaining count to downstream handlers
    res.setHeader('X-RateLimit-Limit',     limit);
    res.setHeader('X-RateLimit-Remaining', limit - win[type].length);

    next();
  };
}

// ── Queue depth guard ────────────────────────────────────────────────────────
// Prevents a user from having more than N queued/processing jobs at once.
// This is a secondary defense beyond rate limiting.
const MAX_ACTIVE_JOBS = parseInt(process.env.MAX_ACTIVE_JOBS_PER_USER || '2');

async function activeJobGuard(req, res, next) {
  if (!req.user) return next();
  const { getActiveJobCountForUser } = require('../db');

  try {
    const active = getActiveJobCountForUser(req.user.id);
    if (active >= MAX_ACTIVE_JOBS) {
      req.log?.perm.warn('Active job limit reached', { active, max: MAX_ACTIVE_JOBS });
      return res.status(429).json({
        error:   'TOO_MANY_ACTIVE_JOBS',
        message: `You already have ${active} active job(s). Wait for them to complete before submitting more.`,
        max:     MAX_ACTIVE_JOBS,
        active,
      });
    }
  } catch (err) {
    // Non-fatal — log but don't block generation
    req.log?.queue.error('activeJobGuard check failed', { error: err.message });
  }

  next();
}

module.exports = {
  imageRateLimit: createRateLimiter('image'),
  videoRateLimit: createRateLimiter('video'),
  activeJobGuard,
};
