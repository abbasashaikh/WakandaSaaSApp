// services/sessionKeeper.js
// ============================================================
// Cron job that keeps the Flow session alive every 10 minutes
// Auto re-logs if session expires
// ============================================================
const cron = require('node-cron');
const flowProxy = require('./flowProxy');

let cronTask = null;
let lastPingAt = null;
let consecutiveFailures = 0;
const MAX_FAILURES = 3;

function start() {
  // Run every 10 minutes
  cronTask = cron.schedule('*/10 * * * *', async () => {
    console.log('[SessionKeeper] Running keep-alive ping...');

    try {
      const ok = await flowProxy.keepAlive();

      if (ok) {
        lastPingAt = new Date();
        consecutiveFailures = 0;
        console.log(`[SessionKeeper] ✅ Session alive at ${lastPingAt.toISOString()}`);
      } else {
        consecutiveFailures++;
        console.warn(`[SessionKeeper] ⚠️ Ping failed (${consecutiveFailures}/${MAX_FAILURES})`);

        if (consecutiveFailures >= MAX_FAILURES) {
          console.error('[SessionKeeper] ❌ Too many failures — session may be broken');
          // Could send alert/notification here in production
        }
      }
    } catch (err) {
      consecutiveFailures++;
      console.error(`[SessionKeeper] Error: ${err.message}`);
    }
  });

  console.log('[SessionKeeper] Started — pinging Flow every 10 minutes');
}

function stop() {
  if (cronTask) {
    cronTask.destroy();
    cronTask = null;
    console.log('[SessionKeeper] Stopped');
  }
}

function getStatus() {
  return {
    running: !!cronTask,
    lastPingAt: lastPingAt?.toISOString() || null,
    consecutiveFailures,
  };
}

module.exports = { start, stop, getStatus };
