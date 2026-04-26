// ecosystem.config.js — PM2 process manager config
// Usage:
//   pm2 start ecosystem.config.js          # start
//   pm2 stop  ecosystem.config.js          # stop
//   pm2 logs  ai-creative-backend          # view logs
//   pm2 monit                              # live dashboard
//   pm2 save && pm2 startup                # auto-restart on VM reboot

module.exports = {
  apps: [
    {
      name:        'ai-creative-backend',
      script:      'server.js',
      cwd:         './',
      instances:   1,              // single instance — Playwright requires it
      exec_mode:   'fork',         // NOT cluster — browser state can't be shared
      node_args:   '--max-old-space-size=2048',   // 2GB Node heap limit
      env: {
        NODE_ENV:  'production',
        PORT:      3001,
        HEADLESS:  'true',
      },

      // ── Restart policy ──────────────────────────────────────────────────
      restart_delay:       5000,   // wait 5s before restarting after crash
      max_restarts:        10,     // stop restarting after 10 consecutive crashes
      min_uptime:          '30s',  // must stay up 30s to count as stable
      exp_backoff_restart_delay: 100,

      // ── Log config ──────────────────────────────────────────────────────
      out_file:    './logs/out.log',
      error_file:  './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:  true,

      // ── Memory guard ────────────────────────────────────────────────────
      // Restart if Node process exceeds 3GB (Chrome leak protection)
      max_memory_restart: '3G',

      // ── Watch ───────────────────────────────────────────────────────────
      watch:       false,          // don't watch files in production
    },
  ],
};
