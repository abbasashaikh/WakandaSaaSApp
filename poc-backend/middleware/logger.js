// middleware/logger.js
// ─────────────────────────────────────────────────────────────────────────────
// Structured JSON logger + correlation ID middleware.
//
// WHY THIS EXISTS:
//   console.log("thing happened") is invisible in production.
//   Every auth failure, permission denial, and generation error must be
//   traceable across a full request lifecycle. Correlation IDs allow you
//   to grep a single user's journey through logs even under concurrent load.
//
// WHAT IT PROVIDES:
//   - req.correlationId  — unique per-request ID (set by client or generated)
//   - req.log            — structured logger bound to this request context
//   - log.auth / log.perm / log.gen / log.queue — domain-specific loggers
//   - HTTP access log with timing, user, and status
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');

// ── Log levels ──────────────────────────────────────────────────────────────
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_LEVEL = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function emit(level, domain, message, fields = {}) {
  if (LEVELS[level] < LOG_LEVEL) return;

  const entry = {
    ts:     new Date().toISOString(),
    level,
    domain,
    msg:    message,
    ...fields,
  };

  // In production, pipe to your log aggregator.
  // In dev, pretty-print for readability.
  if (process.env.NODE_ENV === 'production') {
    process.stdout.write(JSON.stringify(entry) + '\n');
  } else {
    const color = level === 'error' ? '\x1b[31m' : level === 'warn' ? '\x1b[33m' : '\x1b[0m';
    const reset = '\x1b[0m';
    const cid   = fields.correlationId ? ` [${fields.correlationId.slice(0,8)}]` : '';
    const usr   = fields.userId ? ` uid=${fields.userId}` : '';
    console.log(`${color}[${level.toUpperCase()}][${domain}]${cid}${usr} ${message}${reset}`,
      Object.keys(fields).filter(k => !['correlationId','userId'].includes(k)).length > 0
        ? JSON.stringify(Object.fromEntries(Object.entries(fields).filter(([k]) => !['correlationId','userId'].includes(k))))
        : ''
    );
  }
}

// ── Request-scoped logger factory ────────────────────────────────────────────
function makeRequestLogger(correlationId, userId = null) {
  const base = { correlationId, userId };

  const make = (domain) => ({
    debug: (msg, extra = {}) => emit('debug', domain, msg, { ...base, ...extra }),
    info:  (msg, extra = {}) => emit('info',  domain, msg, { ...base, ...extra }),
    warn:  (msg, extra = {}) => emit('warn',  domain, msg, { ...base, ...extra }),
    error: (msg, extra = {}) => emit('error', domain, msg, { ...base, ...extra }),
  });

  return {
    http:  make('http'),
    auth:  make('auth'),
    perm:  make('perm'),
    gen:   make('gen'),
    queue: make('queue'),
    db:    make('db'),
    sys:   make('sys'),
    setUserId(id) { base.userId = id; },
  };
}

// ── Express middleware ────────────────────────────────────────────────────────
function correlationMiddleware(req, res, next) {
  // Accept correlation ID from client (Electron app sets this) or generate
  req.correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
  res.setHeader('x-correlation-id', req.correlationId);

  // ── Platform detection ─────────────────────────────────────────────────────
  // Clients send X-Platform header to identify themselves.
  // Values: 'windows' | 'android' | 'ios' | 'web' | 'unknown'
  // Falls back to User-Agent sniffing if header is absent (e.g. old clients).
  const platformHeader = req.headers['x-platform'];
  if (platformHeader) {
    req.platform = platformHeader.toLowerCase().trim();
  } else {
    const ua = req.headers['user-agent'] || '';
    if (/android/i.test(ua))          req.platform = 'android';
    else if (/electron/i.test(ua))    req.platform = 'windows';
    else if (/iphone|ipad/i.test(ua)) req.platform = 'ios';
    else if (ua)                       req.platform = 'web';
    else                               req.platform = 'unknown';
  }

  // Create request-scoped logger
  req.log = makeRequestLogger(req.correlationId);

  const start = Date.now();
  res.on('finish', () => {
    const ms   = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    req.log.http[level](`${req.method} ${req.path}`, {
      status:   res.statusCode,
      ms,
      userId:   req.user?.id,
      platform: req.platform,
      ip:       req.ip,
    });
  });

  next();
}

// ── Module-level logger (for use outside request context) ─────────────────────
const sysLogger = {
  debug: (domain, msg, f = {}) => emit('debug', domain, msg, f),
  info:  (domain, msg, f = {}) => emit('info',  domain, msg, f),
  warn:  (domain, msg, f = {}) => emit('warn',  domain, msg, f),
  error: (domain, msg, f = {}) => emit('error', domain, msg, f),
};

module.exports = { correlationMiddleware, makeRequestLogger, sysLogger };
