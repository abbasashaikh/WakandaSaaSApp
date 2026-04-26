#!/bin/bash
# setup-server.sh — One-time VM setup for Ubuntu 22.04
# Run as: sudo bash setup-server.sh
# Takes ~5-10 minutes on a fresh B2s VM

set -e
echo "===================================================="
echo " AI Creative Studio — Server Setup"
echo "===================================================="

# ── System update ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# ── Node.js 20 LTS ───────────────────────────────────────────────────────────
echo ""
echo "▶ Installing Node.js 20 LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
echo "  Node: $(node --version)  NPM: $(npm --version)"

# ── Redis 7 (not the outdated Ubuntu default) ────────────────────────────────
echo ""
echo "▶ Installing Redis 7..."
curl -fsSL https://packages.redis.io/gpg | gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" > /etc/apt/sources.list.d/redis.list
apt-get update -qq
apt-get install -y redis
systemctl enable redis-server
systemctl start redis-server
echo "  Redis: $(redis-server --version)"

# ── Playwright system dependencies ───────────────────────────────────────────
echo ""
echo "▶ Installing Playwright Chrome dependencies..."
apt-get install -y \
  libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libdbus-1-3 libxcb1 libxkbcommon0 libx11-6 \
  libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 \
  libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 \
  fonts-liberation libappindicator3-1 xdg-utils wget -qq

# ── PM2 process manager ───────────────────────────────────────────────────────
echo ""
echo "▶ Installing PM2..."
npm install -g pm2 --quiet
pm2 install pm2-logrotate    # auto-rotate logs to prevent disk fill

# ── Create logs directory ─────────────────────────────────────────────────────
mkdir -p /home/azureuser/poc-backend/logs
mkdir -p /home/azureuser/poc-backend/public/media
chown -R azureuser:azureuser /home/azureuser/poc-backend 2>/dev/null || true

# ── Nginx (optional — reverse proxy) ─────────────────────────────────────────
echo ""
echo "▶ Installing Nginx..."
apt-get install -y nginx -qq
cat > /etc/nginx/sites-available/ai-creative << 'NGINX'
server {
    listen 80;
    server_name _;

    # Backend API
    location /api/ {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;    # long timeout for generation (90s+)
        proxy_send_timeout 300s;
    }

    # Media files (cached images/videos)
    location /media/ {
        proxy_pass         http://127.0.0.1:3001;
        proxy_cache_valid  200 7d;
        proxy_set_header   Host $host;
        add_header         Cache-Control "public, max-age=604800";
    }

    # Health check
    location /health {
        proxy_pass http://127.0.0.1:3001;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/ai-creative /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl enable nginx && systemctl restart nginx

echo ""
echo "===================================================="
echo " ✅ Server setup complete!"
echo "===================================================="
echo ""
echo " Next steps:"
echo "  1. cd /home/azureuser/poc-backend"
echo "  2. cp .env.example .env && nano .env   # fill in your values"
echo "  3. npm install"
echo "  4. npx playwright install chromium     # download Chrome"
echo "  5. node scripts/captureSession.js      # capture Google session"
echo "  6. pm2 start ecosystem.config.js"
echo "  7. pm2 save && pm2 startup             # auto-start on reboot"
echo ""
echo " Health check: curl http://localhost/health"
echo "===================================================="
