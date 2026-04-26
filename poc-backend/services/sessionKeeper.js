// services/sessionKeeper.js
// Periodically pings labs.google to keep the Playwright browser session alive.
// If the session dies (cookie expired), browser keepalive ping will fail and log a warning.

const { sysLogger } = require('../middleware/logger');

const PING_INTERVAL_MS = parseInt(process.env.SESSION_PING_INTERVAL_MS || String(10 * 60 * 1000)); // 10 min
const MAX_FAILURES     = 3;

let _timer        = null;
let _failureCount = 0;

async function ping() {
  console.log('[SessionKeeper] Running keep-alive ping...');
  try {
    const flowProxy = require('./flowProxy');
    await flowProxy.keepAlive();
    _failureCount = 0;
    console.log(`[SessionKeeper] ✅ Session alive at ${new Date().toISOString()}`);
  } catch (err) {
    _failureCount++;
    console.warn(`[SessionKeeper] ⚠️ Ping failed (${_failureCount}/${MAX_FAILURES}): ${err.message}`);
    if (_failureCount >= MAX_FAILURES) {
      sysLogger.error('sessionKeeper', 'Session keepalive failed repeatedly', {
        failures: _failureCount,
        error:    err.message,
      });
    }
  }
}

function start() {
  if (_timer) return;
  console.log('[SessionKeeper] Started — pinging Flow every 10 minutes');
  _timer = setInterval(ping, PING_INTERVAL_MS);
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = { start, stop, ping };
