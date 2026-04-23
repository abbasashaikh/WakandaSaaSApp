// services/browserPool.js
// ─────────────────────────────────────────────────────────────────────────────
// Isolated browser context pool for concurrent multi-user generation.
//
// THE CORE PROBLEM THIS SOLVES:
//   The old architecture had a single bContext shared across all users.
//   User A's genPage and User B's genPage existed in the SAME browser context —
//   same cookie jar, same navigation history, same event listeners.
//   When two jobs ran concurrently:
//     - Response interceptors from Job A fired on Job B's network traffic
//     - dismissPopups() from Job A closed dialogs belonging to Job B
//     - page.goto() from both jobs raced and corrupted each other's navigation
//
// THE SOLUTION:
//   Each job gets its own Playwright BrowserContext. A BrowserContext is
//   Playwright's isolation boundary — separate cookies, separate pages,
//   separate network listeners, separate JavaScript execution context.
//   The browser process is shared (cheap) but contexts are isolated (safe).
//
// POOL DESIGN:
//   - Semaphore pattern: N slots, each job acquires one before starting
//   - Slot = a pre-created BrowserContext with session cookie injected
//   - Contexts are created lazily on first acquire, not at startup
//   - A context is closed and replaced after each job (no state leakage)
//   - If all slots are taken, the job waits in queue (backpressure)
//   - Pool size = BROWSER_POOL_SIZE env var (default: 2)
//
// HEALTH MONITORING:
//   - Tracks active slots, waiting jobs, context creation failures
//   - Detects context leaks (slot acquired but never released)
//   - Exposes getPoolStatus() for admin endpoint
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();
const { sysLogger } = require('../middleware/logger');

const POOL_SIZE        = parseInt(process.env.BROWSER_POOL_SIZE || '1');
const ACQUIRE_TIMEOUT  = parseInt(process.env.POOL_ACQUIRE_TIMEOUT_MS || '300000'); // 5 min
const SLOT_LEASE_MAX   = parseInt(process.env.POOL_SLOT_LEASE_MS || '600000');      // 10 min

// ── State ─────────────────────────────────────────────────────────────────────
let browser        = null; // shared browser process
let poolReady      = false;
let poolInitializing = false;

// Each slot: { id, context, acquiredAt, jobId, userId, released }
const slots    = new Array(POOL_SIZE).fill(null).map((_, i) => ({
  id:          i,
  context:     null,
  acquiredAt:  null,
  jobId:       null,
  userId:      null,
}));

// Queue of waiting acquirers: { resolve, reject, timeout, jobId }
const waitQueue = [];

// ── Browser launch ────────────────────────────────────────────────────────────

// Note: in Phase 3, browser is provided via initPool(sharedBrowser).
// This function is kept only as a standalone fallback.
async function launchBrowser() {
  if (browser) return browser;

  const { chromium } = require('playwright');
  let launcher = chromium;

  try {
    const { chromium: pExtra } = require('playwright-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    pExtra.use(StealthPlugin());
    launcher = pExtra;
    sysLogger.info('browserPool', 'Stealth mode enabled');
  } catch {
    sysLogger.warn('browserPool', 'playwright-extra not found — using plain Playwright');
  }

  const fs       = require('fs');
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
  ];
  const realExe = chromePaths.find(p => { try { return fs.existsSync(p); } catch { return false; } });

  browser = await launcher.launch({
    headless: false,
    executablePath: realExe || undefined,
    args: [
      '--no-sandbox',
      '--window-size=1280,800',
      '--window-position=100,100',
      '--no-first-run',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  sysLogger.info('browserPool', 'Browser launched', { exe: realExe || 'bundled' });
  return browser;
}

// ── Context factory ───────────────────────────────────────────────────────────

async function createIsolatedContext(sessionCookie) {
  const b = await launchBrowser();

  const ctx = await b.newContext({
    viewport:  { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  // Inject session cookie into this context's isolated jar
  if (sessionCookie && sessionCookie.length > 100) {
    await ctx.addCookies([
      { name: '__Secure-next-auth.session-token', value: sessionCookie,
        domain: 'labs.google', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
      { name: 'next-auth.session-token', value: sessionCookie,
        domain: 'labs.google', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
    ]);
  }

  return ctx;
}

// ── Pool init ─────────────────────────────────────────────────────────────────

/**
 * Initialise the pool using an EXISTING shared browser instance.
 * Call this from flowProxy after browser.launch() so both the
 * warmPage keepalive AND the pool use the same Chrome process.
 *
 * @param {import('playwright').Browser} sharedBrowser
 */
async function initPool(sharedBrowser) {
  if (poolReady || poolInitializing) return;
  poolInitializing = true;

  try {
    if (!sharedBrowser) throw new Error('browserPool.initPool requires a browser instance');
    browser = sharedBrowser; // use the already-launched browser from flowProxy
    poolReady = true;
    poolInitializing = false;
    sysLogger.info('browserPool', `Pool initialised`, { size: POOL_SIZE });
  } catch (err) {
    poolInitializing = false;
    sysLogger.error('browserPool', 'Pool init failed', { error: err.message });
    throw err;
  }
}

// ── Acquire ───────────────────────────────────────────────────────────────────

/**
 * Acquire an isolated browser context for a job.
 * Waits if all slots are busy (backpressure — honours ACQUIRE_TIMEOUT).
 * Returns a release() function that MUST be called in a finally block.
 *
 * Usage:
 *   const { context, release } = await browserPool.acquire({ jobId, userId });
 *   try {
 *     const page = await context.newPage();
 *     // ... do work ...
 *   } finally {
 *     await release();
 *   }
 */
async function acquire({ jobId, userId, sessionCookie }) {
  if (!poolReady) {
    throw new Error('browserPool not initialised — call browserPool.initPool(browser) from flowProxy first');
  }

  // Try to find a free slot immediately
  const freeSlot = slots.find(s => !s.acquiredAt);

  if (freeSlot) {
    return _assignSlot(freeSlot, jobId, userId, sessionCookie);
  }

  // All slots busy — queue the request
  sysLogger.info('browserPool', 'All slots busy — queuing', {
    jobId, userId, queueDepth: waitQueue.length,
  });

  return new Promise((resolve, reject) => {
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      const idx = waitQueue.findIndex(w => w.jobId === jobId);
      if (idx !== -1) waitQueue.splice(idx, 1);
      sysLogger.error('browserPool', 'Acquire timeout', { jobId, userId, waitMs: ACQUIRE_TIMEOUT });
      reject(new Error(`Browser pool acquire timeout after ${ACQUIRE_TIMEOUT}ms — all ${POOL_SIZE} slots busy`));
    }, ACQUIRE_TIMEOUT);

    waitQueue.push({ resolve, reject, timeout, jobId, userId, sessionCookie, timedOut: () => timedOut });
  });
}

async function _assignSlot(slot, jobId, userId, sessionCookie) {
  // Create a fresh isolated context for this job
  try {
    slot.context    = await createIsolatedContext(
      sessionCookie || process.env.FLOW_SESSION_COOKIE || ''
    );
    slot.acquiredAt = Date.now();
    slot.jobId      = jobId;
    slot.userId     = userId;

    sysLogger.info('browserPool', 'Slot acquired', {
      slotId: slot.id, jobId, userId,
      activeSlots: slots.filter(s => !!s.acquiredAt).length,
    });
  } catch (err) {
    sysLogger.error('browserPool', 'Failed to create context for slot', {
      slotId: slot.id, jobId, error: err.message,
    });
    throw err;
  }

  const release = async () => {
    await _releaseSlot(slot);
  };

  // Detect leaked slots — log warning if slot held for too long
  const leakCheck = setInterval(() => {
    if (slot.acquiredAt && Date.now() - slot.acquiredAt > SLOT_LEASE_MAX) {
      sysLogger.warn('browserPool', 'Possible slot leak — held too long', {
        slotId:  slot.id,
        jobId:   slot.jobId,
        userId:  slot.userId,
        heldMs:  Date.now() - slot.acquiredAt,
      });
    }
  }, 60_000);

  // Clear leak check when released
  const origRelease = release;
  return {
    context: slot.context,
    slotId:  slot.id,
    release: async () => {
      clearInterval(leakCheck);
      await origRelease();
    },
  };
}

async function _releaseSlot(slot) {
  const { slotId: id, jobId, userId, acquiredAt } = { slotId: slot.id, ...slot };

  // Close the used context — drops all cookies, pages, network listeners
  try {
    if (slot.context) {
      await slot.context.close();
    }
  } catch (err) {
    sysLogger.warn('browserPool', 'Context close error (non-fatal)', {
      slotId: slot.id, error: err.message,
    });
  }

  const heldMs = slot.acquiredAt ? Date.now() - slot.acquiredAt : 0;

  // Reset slot
  slot.context    = null;
  slot.acquiredAt = null;
  slot.jobId      = null;
  slot.userId     = null;

  sysLogger.info('browserPool', 'Slot released', {
    slotId: slot.id, jobId, userId, heldMs,
    activeSlots: slots.filter(s => !!s.acquiredAt).length,
  });

  // Dispatch to waiting queue if anyone is waiting
  _dispatchWaitQueue();
}

function _dispatchWaitQueue() {
  if (waitQueue.length === 0) return;

  const freeSlot = slots.find(s => !s.acquiredAt);
  if (!freeSlot) return;

  // Get next non-timed-out waiter
  let waiter;
  while (waitQueue.length > 0) {
    const w = waitQueue.shift();
    if (!w.timedOut()) {
      waiter = w;
      break;
    }
  }
  if (!waiter) return;

  clearTimeout(waiter.timeout);

  _assignSlot(freeSlot, waiter.jobId, waiter.userId, waiter.sessionCookie)
    .then(result => waiter.resolve(result))
    .catch(err   => waiter.reject(err));
}

// ── Pool status ───────────────────────────────────────────────────────────────

function getPoolStatus() {
  return {
    size:        POOL_SIZE,
    ready:       poolReady,
    activeSlots: slots.filter(s => !!s.acquiredAt).map(s => ({
      id:        s.id,
      jobId:     s.jobId,
      userId:    s.userId,
      heldMs:    s.acquiredAt ? Date.now() - s.acquiredAt : 0,
    })),
    freeSlots:   slots.filter(s => !s.acquiredAt).length,
    queueDepth:  waitQueue.length,
    queuedJobs:  waitQueue.map(w => ({ jobId: w.jobId, userId: w.userId })),
  };
}

// ── Teardown ──────────────────────────────────────────────────────────────────

async function destroyPool() {
  // Release any slots still held
  for (const slot of slots) {
    if (slot.context) {
      try { await slot.context.close(); } catch {}
      slot.context = null; slot.acquiredAt = null; slot.jobId = null; slot.userId = null;
    }
  }

  // Reject any waiting acquirers
  while (waitQueue.length > 0) {
    const w = waitQueue.shift();
    clearTimeout(w.timeout);
    w.reject(new Error('Browser pool destroyed'));
  }

  if (browser) {
    try { await browser.close(); } catch {}
    browser = null;
  }

  poolReady = false;
  sysLogger.info('browserPool', 'Pool destroyed');
}

module.exports = {
  initPool,
  acquire,
  getPoolStatus,
  destroyPool,
};
