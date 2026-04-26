// services/mediaCache.js — Phase 4: Media URL persistence
// ─────────────────────────────────────────────────────────────────────────────
// PROBLEM: Generated URLs from Google Flow expire in ~20 minutes.
//   https://flow-content.google/image/xxx?Expires=17769...&Signature=xxx
// After expiry the Electron app can no longer display the image/video.
//
// SOLUTION: Download the binary at generation time, store locally in
// /public/media/, and return a local URL served from Express.
// The local URL never expires.
//
// USAGE (from queue.js after generation completes):
//   const localUrl = await mediaCache.persist(cdnUrl, jobId, 'image');
//   updateJob(jobId, { output_url: localUrl });
// ─────────────────────────────────────────────────────────────────────────────
const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { sysLogger } = require('../middleware/logger');

const MEDIA_DIR  = path.join(__dirname, '..', 'public', 'media');
const MAX_SIZE   = 100 * 1024 * 1024; // 100 MB max per file
const TIMEOUT_MS = 60 * 1000;          // 60s download timeout

// Ensure media directory exists
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

/**
 * Download a CDN URL and save it locally.
 * Returns the local URL path (e.g. /media/abc123.mp4) or the original URL on failure.
 *
 * @param {string} cdnUrl - The expiring CDN URL from Flow
 * @param {string} jobId  - Used for logging
 * @param {'image'|'video'} type
 * @returns {Promise<string>} local URL served by Express
 */
async function persist(cdnUrl, jobId, type) {
  if (!cdnUrl) return cdnUrl;

  // Already a local URL — already persisted
  if (cdnUrl.startsWith('/media/') || cdnUrl.includes('localhost')) return cdnUrl;

  try {
    const ext      = type === 'video' ? 'mp4' : 'jpg';
    const filename = `${jobId}.${ext}`;
    const filepath = path.join(MEDIA_DIR, filename);

    // Skip download if file already exists (retry-safe)
    if (fs.existsSync(filepath)) {
      sysLogger.info('mediaCache', 'File already cached', { jobId, filename });
      return `/media/${filename}`;
    }

    sysLogger.info('mediaCache', 'Downloading media', { jobId, type, url: cdnUrl.slice(0, 80) });

    await downloadFile(cdnUrl, filepath);

    const stat   = fs.statSync(filepath);
    const sizeMb = (stat.size / 1024 / 1024).toFixed(2);
    sysLogger.info('mediaCache', 'Media cached', { jobId, filename, sizeMb: `${sizeMb}MB` });

    return `/media/${filename}`;

  } catch (err) {
    sysLogger.warn('mediaCache', 'Failed to cache media — using original URL', {
      jobId, error: err.message,
    });
    // Fall back to CDN URL (will expire but better than failing the whole job)
    return cdnUrl;
  }
}

/**
 * Download a URL to a local file path.
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;

    const req = proto.get(url, { timeout: TIMEOUT_MS }, (res) => {
      // Follow redirects (up to 3 hops)
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} downloading media`));
      }

      const contentType = res.headers['content-type'] || '';
      if (!contentType.includes('image') && !contentType.includes('video') && !contentType.includes('octet')) {
        // Probably an error page — log and reject
        return reject(new Error(`Unexpected content-type: ${contentType}`));
      }

      let bytesReceived = 0;
      const ws = fs.createWriteStream(destPath);

      res.on('data', chunk => {
        bytesReceived += chunk.length;
        if (bytesReceived > MAX_SIZE) {
          ws.destroy();
          res.destroy();
          fs.unlink(destPath, () => {});
          return reject(new Error(`File too large (>${MAX_SIZE / 1024 / 1024}MB)`));
        }
      });

      res.pipe(ws);

      ws.on('finish', resolve);
      ws.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });

    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Download timeout')); });
  });
}

/**
 * Clean up media files older than maxAgeMs (default 7 days).
 * Call this on server startup and periodically.
 */
function pruneOldMedia(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  try {
    const files   = fs.readdirSync(MEDIA_DIR);
    const cutoff  = Date.now() - maxAgeMs;
    let   removed = 0;

    for (const file of files) {
      if (file === '.gitkeep') continue;
      const filePath = path.join(MEDIA_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          removed++;
        }
      } catch {}
    }

    if (removed > 0) {
      sysLogger.info('mediaCache', 'Pruned old media files', { removed });
    }
  } catch (err) {
    sysLogger.warn('mediaCache', 'Prune error', { error: err.message });
  }
}

/**
 * Get total size of cached media in MB.
 */
function getCacheStats() {
  try {
    const files = fs.readdirSync(MEDIA_DIR);
    let   total = 0;
    for (const f of files) {
      try { total += fs.statSync(path.join(MEDIA_DIR, f)).size; } catch {}
    }
    return { files: files.length, totalMb: (total / 1024 / 1024).toFixed(1) };
  } catch {
    return { files: 0, totalMb: '0' };
  }
}

module.exports = { persist, pruneOldMedia, getCacheStats };
