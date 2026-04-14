# AI Creative Studio — POC

A proof-of-concept for an AI image and video generation desktop app.  
**Goal:** Prove the full loop works — user opens app → enters key → generates image/video.

---

## Architecture

```
poc-website/          Single HTML page — register → get API key
    index.html

poc-backend/          Node.js + Express API server
    server.js         Entry point
    routes/
        auth.js       POST /api/validate-key, POST /api/register
        generate.js   POST /api/generate/image, POST /api/generate/video
        jobs.js       GET /api/jobs/:id
    services/
        flowProxy.js  Core: mock / API / browser mode generation
        queue.js      BullMQ queue (concurrency=1)
        sessionKeeper.js  Cron: keeps Flow session alive
    middleware/
        keyAuth.js    Validates X-License-Key header
    db.js             SQLite (better-sqlite3)
    scripts/
        investigateFlow.js  Network capture tool

poc-electron/         Electron + React desktop app
    src/main/         Electron main process + preload
    src/renderer/     React pages (Auth, Dashboard, Image, Video)
```

---

## Prerequisites

- **Node.js 20+** — https://nodejs.org
- **Redis** — required for the job queue
- **Git**

### Install Redis

**Windows:** Use WSL2, or download from https://github.com/tporadowski/redis/releases  
**macOS:** `brew install redis && brew services start redis`  
**Linux:** `sudo apt install redis-server && sudo systemctl start redis`

Verify Redis is running:
```bash
redis-cli ping
# Should respond: PONG
```

---

## Quick Start

### Step 1 — Start the Backend

```bash
cd poc-backend
npm install
cp .env.example .env
npm start
```

Expected output:
```
╔════════════════════════════════════════╗
║     AI Creative Studio POC Backend     ║
╚════════════════════════════════════════╝

  Mode:  MOCK
  Port:  3001

✅ Server running at http://localhost:3001
   Test key: poc-test-key-12345678
```

> **Note:** Default mode is `FLOW_MODE=mock` — works without any Flow credentials.  
> All generations return real images/videos from public URLs (for testing the UI loop).

---

### Step 2 — Test the Website

Open `poc-website/index.html` directly in your browser (no server needed).

1. Click **"Get POC Access"**
2. Enter your name and any email
3. Click **"Get Access"**
4. You'll receive a license key — copy it

> If you see "Cannot reach server", make sure the backend is running on port 3001.

---

### Step 3 — Run the Electron App

```bash
cd poc-electron
npm install
npm run dev
```

This starts the Vite dev server and Electron simultaneously.

1. Enter the license key from Step 2 (or use `poc-test-key-12345678`)
2. Click **Activate**
3. You should see the Dashboard

---

### Step 4 — Test Image Generation

1. Click **"Open"** on the Image card
2. Type a prompt: `"a glowing crystal forest at sunset"`
3. Press **Enter** or click the send button
4. Watch the skeleton loader appear
5. After ~4 seconds (mock mode), your image appears
6. Click **Download Image**

---

### Step 5 — Test Video Generation

1. Go back to Dashboard
2. Click **"Open"** on the Video card
3. Type a prompt: `"waves crashing on a rocky coastline"`
4. Select duration (4s or 8s) and quality (Fast/HD)
5. Press **Enter**
6. Watch the progress indicator
7. After ~8 seconds (mock mode), the video plays in the app

---

## POC Success Criteria

Run through these 7 steps in order:

- [ ] 1. `node server.js` → starts on port 3001, no errors
- [ ] 2. Open website → register → receive a key
- [ ] 3. Electron app → enter key → see DashboardPage
- [ ] 4. Click Image card → type prompt → hit send
- [ ] 5. See skeleton loading → then see a generated image
- [ ] 6. Click Video card → type prompt → hit send
- [ ] 7. See progress indicator → then see a playable video

All 7 pass = POC proven ✅

---

## Connecting Real Flow Credentials

### Option A: Investigate Flow's API First (Recommended)

Run the network investigation script to capture exactly what Flow's API looks like:

```bash
cd poc-backend
cp .env.example .env
# Set FLOW_EMAIL and FLOW_PASSWORD in .env

npm run investigate
```

This opens a visible browser, logs you in, and waits 60 seconds.  
During that time, **manually generate something in Flow**.  
The script captures all API calls and saves them to `scripts/flow-api-report.json`.

Then update `services/flowProxy.js` with:
- The exact endpoint URL
- Required headers/auth tokens
- Request body structure
- Response field containing the output URL

### Option B: Use REST API Mode

If Flow has a documented REST API:

```env
# .env
FLOW_MODE=api
FLOW_API_KEY=your_flow_api_key_here
FLOW_BASE_URL=https://flow.so
```

Update the endpoint paths in `services/flowProxy.js` in the `apiGenerateImage` and `apiGenerateVideo` functions.

### Option C: Use Browser Automation Mode

```env
# .env
FLOW_MODE=browser
FLOW_EMAIL=your@email.com
FLOW_PASSWORD=yourpassword
```

The backend will launch a headless Chromium browser, log in automatically, and reuse the session for all requests. The session keeper pings Flow every 10 minutes to prevent timeout.

---

## Environment Variables

| Variable           | Default                   | Description                          |
|--------------------|---------------------------|--------------------------------------|
| `PORT`             | `3001`                    | Backend HTTP port                    |
| `FLOW_MODE`        | `mock`                    | `mock` / `api` / `browser`           |
| `FLOW_EMAIL`       | —                         | Flow account email (browser mode)    |
| `FLOW_PASSWORD`    | —                         | Flow account password (browser mode) |
| `FLOW_API_KEY`     | —                         | Flow API key (api mode)              |
| `FLOW_BASE_URL`    | `https://flow.so`         | Flow base URL                        |
| `REDIS_URL`        | `redis://localhost:6379`  | Redis connection URL                 |
| `MOCK_DELAY_IMAGE` | `4000`                    | Mock image generation delay (ms)     |
| `MOCK_DELAY_VIDEO` | `8000`                    | Mock video generation delay (ms)     |

---

## API Reference

### POST `/api/validate-key`
Validates a license key.
```json
// Request
{ "license_key": "poc-test-key-12345678" }

// Response 200
{
  "valid": true,
  "user": { "id": 1, "email": "test@poc.local", "name": "Test User" },
  "subscription": {
    "status": "active",
    "expires_at": "2025-03-01",
    "days_remaining": 28,
    "badge": "MONTHLY ACCESS"
  }
}
```

### POST `/api/register`
Registers a new user and returns a license key.
```json
// Request
{ "name": "Jane Smith", "email": "jane@example.com" }

// Response 201
{ "license_key": "a1b2c3d4e5f6...", "email": "jane@example.com" }
```

### POST `/api/generate/image`
Queues an image generation job.
```
Header: X-License-Key: your-key
```
```json
// Request
{ "prompt": "a sunset over mountains", "aspect_ratio": "16:9" }

// Response 202
{ "job_id": "uuid-here", "status": "queued", "type": "image" }
```

### POST `/api/generate/video`
Queues a video generation job.
```json
// Request
{ "prompt": "ocean waves", "duration": 8, "quality": "fast" }

// Response 202
{ "job_id": "uuid-here", "status": "queued", "type": "video" }
```

### GET `/api/jobs/:id`
Polls a job for status. Call every 3 seconds until `is_done: true`.
```json
// Response
{
  "job_id": "uuid",
  "status": "completed",
  "output_url": "https://...",
  "is_done": true,
  "poll_again": false
}
```

### GET `/health`
Server health check — no auth required.

---

## Building the Electron App (Portable .exe)

```bash
cd poc-electron
npm install
npm run build
```

Output: `poc-electron/dist-electron/YourBrand App POC.exe`

This is a single portable `.exe` — no installer, no code signing needed for POC.

> **Note:** The app will try to connect to `http://localhost:3001` by default.  
> To point to a hosted backend, set `VITE_API_URL=https://your-backend.com` before building:
> ```bash
> VITE_API_URL=https://your-backend.com npm run build
> ```

---

## Test Credentials

| Field       | Value                     |
|-------------|---------------------------|
| Email       | `test@poc.local`          |
| License Key | `poc-test-key-12345678`   |

---

## Troubleshooting

**"Cannot reach server"**  
→ Make sure `npm start` is running in `poc-backend/`  
→ Check that port 3001 is not blocked by a firewall

**"QUEUE_ERROR: Failed to queue generation job"**  
→ Redis is not running. Start it: `redis-server` or `brew services start redis`

**Electron shows blank white screen**  
→ Wait a few seconds for Vite to compile  
→ Check the terminal for errors

**"Invalid or expired key"**  
→ Use `poc-test-key-12345678` for instant testing  
→ Or register a new user via the website

**Jobs stuck in "queued" forever**  
→ Redis is not running — the worker needs Redis  
→ Check `redis-cli ping` returns `PONG`

**Browser mode login fails**  
→ Run `node scripts/investigateFlow.js` first to verify credentials work  
→ Flow may have changed their login page selectors — update `browserInit()` in `flowProxy.js`

---

## File Structure

```
/
├── poc-backend/
│   ├── server.js
│   ├── db.js
│   ├── poc.db              (auto-created on first run)
│   ├── .env                (copy from .env.example)
│   ├── routes/
│   │   ├── auth.js
│   │   ├── generate.js
│   │   └── jobs.js
│   ├── services/
│   │   ├── flowProxy.js    ← UPDATE THIS for real Flow credentials
│   │   ├── queue.js
│   │   └── sessionKeeper.js
│   ├── middleware/
│   │   └── keyAuth.js
│   └── scripts/
│       └── investigateFlow.js
│
├── poc-electron/
│   ├── src/
│   │   ├── main/
│   │   │   ├── main.js
│   │   │   └── preload.js
│   │   └── renderer/
│   │       ├── App.jsx
│   │       ├── main.jsx
│   │       ├── index.html
│   │       ├── index.css
│   │       ├── api.js
│   │       ├── store/
│   │       │   └── appStore.js
│   │       └── pages/
│   │           ├── AuthPage.jsx
│   │           ├── DashboardPage.jsx
│   │           ├── ImagePage.jsx
│   │           └── VideoPage.jsx
│   ├── package.json
│   ├── vite.config.js
│   ├── electron-builder.yml
│   └── tailwind.config.js
│
├── poc-website/
│   └── index.html
│
└── README.md
```
