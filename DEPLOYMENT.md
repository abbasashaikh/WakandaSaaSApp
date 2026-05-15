# POC AI Creative Studio — Complete Deployment Guide

> For new developers setting up the project from scratch.  
> Covers: Backend · Electron (Windows) · Android  
> Last updated: May 2026

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Project Structure](#3-project-structure)
4. [Backend Setup](#4-backend-setup)
5. [Electron App Setup](#5-electron-app-setup)
6. [Android App Setup](#6-android-app-setup)
7. [Google Flow Session Setup](#7-google-flow-session-setup)
8. [Environment Variables Reference](#8-environment-variables-reference)
9. [Daily Startup Workflow](#9-daily-startup-workflow)
10. [Troubleshooting](#10-troubleshooting)
11. [Maintenance](#11-maintenance)

---

## 1. Architecture Overview

```
┌─────────────────────┐     ┌─────────────────────┐
│  Electron (Windows) │     │  Android (React RN)  │
│  poc-electron/      │     │  poc-android/        │
└────────┬────────────┘     └──────────┬───────────┘
         │ HTTP (localhost or ngrok)   │
         └──────────────┬─────────────┘
                        ▼
          ┌─────────────────────────┐
          │  Node.js Backend        │
          │  poc-backend/           │
          │  Express + BullMQ       │
          └────────────┬────────────┘
                       │ Playwright browser automation
                       ▼
          ┌─────────────────────────┐
          │  Google Flow AI         │
          │  labs.google            │
          │  (Veo video generation) │
          └─────────────────────────┘
```

**Key points:**
- Backend MUST run on a Windows PC with a residential IP. Cloud servers are blocked by Google reCAPTCHA.
- Playwright automates a real Chrome browser — it is NOT an API call.
- Session cookie expires every ~7 days and must be recaptured manually.
- Android connects to the backend via ngrok tunnel (phone cannot reach localhost directly).

---

## 2. Prerequisites

### Required Software — Install in this order

| Software | Version | Download |
|---|---|---|
| Node.js | 18+ (LTS) | https://nodejs.org |
| Git | Latest | https://git-scm.com |
| Google Chrome | Latest | https://google.com/chrome |
| Redis | 6.2+ | https://github.com/microsoftarchive/redis/releases |
| Android Studio | Latest | https://developer.android.com/studio |
| ngrok | Latest | https://ngrok.com/download |
| Java JDK | 17 | https://adoptium.net |

### Verify everything is installed

Open PowerShell and run:

```powershell
node --version        # Must show v18.x or higher
npm --version         # Must show 9.x or higher
git --version         # Any version
java --version        # Must show 17.x
redis-cli --version   # Must show 6.x or 7.x
adb --version         # If not found, see Android setup section
```

### Android Studio — Required SDK setup

After installing Android Studio:

1. Open **SDK Manager** (Tools → SDK Manager)
2. Install **Android SDK Platform 34** (API Level 34)
3. Install **Android SDK Build-Tools 34**
4. Install **NDK (Side by side)**
5. Install **CMake**

Set environment variables (PowerShell as Administrator):

```powershell
# Replace C:\Users\YourName with your actual username
[System.Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
[System.Environment]::SetEnvironmentVariable("Path", "$env:Path;$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:LOCALAPPDATA\Android\Sdk\emulator", "User")
```

Close and reopen PowerShell, then verify:

```powershell
adb --version   # Should now work
```

---

## 3. Project Structure

```
poc-ai-creative-studio/
├── poc-backend/              ← Node.js server (MUST run first)
│   ├── .env                  ← Environment config (never commit this)
│   ├── server.js             ← Entry point
│   ├── poc.db                ← SQLite database (auto-created)
│   ├── routes/
│   │   └── generate.js       ← Image/video generation endpoints
│   ├── services/
│   │   ├── flowProxy.js      ← Playwright browser automation
│   │   ├── browserPool.js    ← Browser context pool
│   │   └── queue.js          ← BullMQ job queue
│   ├── middleware/
│   │   └── rateLimiter.js    ← Per-user rate limiting
│   └── scripts/
│       ├── captureSession.js ← Captures Google session cookie
│       └── clearStaleJobs.js ← Clears stuck jobs from DB
│
├── poc-electron/             ← Windows desktop app
│   ├── src/
│   │   ├── main/             ← Electron main process
│   │   └── renderer/
│   │       ├── pages/
│   │       │   ├── VideoPage.jsx
│   │       │   └── ImagePage.jsx
│   │       └── api.js        ← API client
│   └── package.json
│
└── poc-android/              ← Android app (React Native)
    ├── src/
    │   ├── screens/
    │   │   └── VideoGenerationScreen.js
    │   └── api.js            ← API client
    └── package.json
```

---

## 4. Backend Setup

### Step 1 — Clone and install

```powershell
cd "C:\App Development"
git clone <repo-url> poc-ai-creative-studio
cd poc-ai-creative-studio\poc-backend
npm install
```

### Step 2 — Create .env file

Create a new file called `.env` in `poc-backend/` with this content:

```env
# ── Server ──────────────────────────────────────────────────────────────────
PORT=3001
FLOW_MODE=browser
NODE_ENV=production

# ── Browser mode ─────────────────────────────────────────────────────────────
HEADLESS=true

# ── Google Flow session cookie ────────────────────────────────────────────────
# Run: npm run capture:session   to get this value (see Section 7)
# Expires every ~7 days — re-capture when session stops working
FLOW_SESSION_COOKIE=REPLACE_THIS_AFTER_CAPTURE

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_URL=redis://127.0.0.1:6379

# ── JWT ───────────────────────────────────────────────────────────────────────
# Generate a real secret: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=CHANGE_ME_generate_a_real_random_string_here
ACCESS_TOKEN_TTL_SEC=3600
REFRESH_TOKEN_TTL_SEC=604800

# ── Browser pool ──────────────────────────────────────────────────────────────
# Each slot uses ~400MB RAM. Adjust based on your machine:
#   4GB RAM  → 1 or 2
#   8GB RAM  → 2 or 4
BROWSER_POOL_SIZE=2

# ── Rate limiting ─────────────────────────────────────────────────────────────
VIDEO_RATE_LIMIT=20
RATE_WINDOW_SEC=300
MIN_GEN_GAP_MS=5000

# ── Credit monitoring ─────────────────────────────────────────────────────────
CREDIT_WARN_THRESHOLD=500
CREDIT_CRITICAL_THRESHOLD=50

# ── Database ──────────────────────────────────────────────────────────────────
DB_PATH=./poc.db
```

> **IMPORTANT:** The `FLOW_SESSION_COOKIE` value is required to start. Complete Section 7 first to get it.

### Step 3 — Start Redis

Redis must be running before the backend:

```powershell
# Open a dedicated PowerShell window for Redis
redis-server
```

You should see: `Ready to accept connections`

Keep this window open. Do not close it.

### Step 4 — Capture Google session (first time)

See **Section 7** for full instructions. Quick steps:

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-backend"
npm run capture:session
# A Chrome window will open — log in with your Google account
# Script auto-captures the cookie and updates .env
```

### Step 5 — Start the backend

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-backend"
npm start
```

**Wait for ALL these lines to appear before using the app:**

```
✅ Stealth mode enabled
✅ Session: yourname@gmail.com
Pool initialised
✅ Warm page initialized on labs.google
Cookies synced from bContext
Worker started
✅ Server running at http://localhost:3001
```

If you see `veoanti69703551@anna37.sbs` as the session email instead of your Gmail, stop the server and re-read Section 7 (session capture issue).

### Step 6 — Verify backend is working

```powershell
# In a new PowerShell window:
Invoke-WebRequest http://localhost:3001/health | Select-Object -ExpandProperty Content
# Should return: {"status":"ok"}
```

---

## 5. Electron App Setup

### Step 1 — Install dependencies

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-electron"
npm install
```

### Step 2 — Start the app (development)

The backend MUST be running first (Section 4).

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-electron"
npm start
```

The Electron window will open. It connects to `http://localhost:3001` automatically.

### Step 3 — Login

Use the test key: `poc-test-key-12345678`

Or the real key if configured in the backend database.

### Step 4 — Build for production (optional)

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-electron"
npm run build
```

Output: `poc-electron/dist/` — contains the distributable `.exe` installer.

---

## 6. Android App Setup

> The Android app connects to the backend via ngrok because the phone cannot reach `localhost` on your PC.

### Step 1 — Install dependencies

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-android"
npm install
```

### Step 2 — Install react-native-image-picker

This package is required for the start/end frame upload feature:

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-android"
npm install react-native-image-picker
```

### Step 3 — Start ngrok (new terminal)

```powershell
ngrok http 3001
```

You will see output like:

```
Forwarding  https://abc123.ngrok-free.app -> http://localhost:3001
```

Copy the `https://` URL — you will need it in Step 7.

Keep this window open while using the Android app.

### Step 4 — Connect your phone

**Option A — Physical phone (recommended):**

1. On your phone: Settings → About Phone → tap **Build Number** 7 times
2. Settings → Developer Options → enable **USB Debugging**
3. Connect phone via USB cable
4. Accept the "Allow USB debugging?" prompt on your phone

Verify connection:

```powershell
adb devices
# Must show your device as "device" (not "offline"):
# XXXXXXXX    device
```

**Option B — Emulator:**

> Use Pixel 4 API 30 (x86 AOSP) only. API 34 has Vulkan crashes with this project.

1. Open Android Studio → Device Manager
2. Create virtual device → Pixel 4 → API 30 (AOSP, x86)
3. Start the emulator — wait for it to fully boot (home screen visible)
4. Run `adb devices` to confirm it shows as `device` (not `offline`)

> **IMPORTANT:** If BOTH a physical phone and emulator are connected, Gradle will try to install on both and fail if the emulator isn't fully booted. Always close the emulator when using a physical phone.

### Step 5 — Start Metro bundler (new terminal)

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-android"
npx react-native start --reset-cache
```

Wait for: `Metro waiting on exp://...`

### Step 6 — Build and install APK (new terminal, run once)

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-android"
npx react-native run-android
```

This takes 3–7 minutes the first time. The app will auto-launch on your device when done.

### Step 7 — Set server URL in app

When the app opens:

1. Tap **Server Setup** (or settings icon)
2. Enter your ngrok URL: `https://abc123.ngrok-free.app`
3. Tap **Save**
4. Login with: `poc-test-key-12345678`

### After first install — reload JS without rebuilding

After the APK is installed, you only need Metro running for JS changes. To reload:

- **Shake the phone** → tap **Reload**  
- Or press `R` twice in the Metro terminal

---

## 7. Google Flow Session Setup

This is required to generate images and videos. Google Flow has no public API — the backend uses Playwright to automate a real Chrome browser with your logged-in session.

### First-time capture

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-backend"
npm run capture:session
```

A Chrome window will open. Follow these steps:

1. **Log in** with a real Gmail account (not a disposable email)
2. Navigate to `https://labs.google/fx/tools/flow`
3. Wait until you see the Flow gallery (image grid)
4. The script will **automatically detect** the session and update `.env`

You will see:

```
✅ Logged in as: yourname@gmail.com
✅ Cookie captured (1064 chars)
✅ .env updated with new session cookie
✅ Now restart the backend: npm start
```

### Re-capture (every ~7 days)

The session cookie expires weekly. Symptoms of an expired cookie:
- Backend logs show `Session cookie expired`
- All generations fail immediately
- Logs show `accounts.google.com` redirect

Re-capture procedure:

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-backend"
npm run capture:session
# Log in again in the Chrome window
npm start
```

### Build account trust first (new account only)

Google assigns trust scores to accounts. A fresh account with no history will get reCAPTCHA 403 errors on first automated use.

Before running the backend with a new account:

1. **Manually open Chrome** (not the capture script)
2. Log in at `https://labs.google/fx/tools/flow`
3. **Manually generate 3–5 images** using the web UI
4. Leave the page open for 5–10 minutes
5. Then run `npm run capture:session`

### Important .env rule

The `.env` file must have **exactly one** `FLOW_SESSION_COOKIE=` line — no commented-out old values. If you see `//FLOW_SESSION_COOKIE=...` at the top of `.env`, delete that line. It will cause the capture script to update the wrong line.

Correct `.env` format:

```env
# Only ONE occurrence of this key:
FLOW_SESSION_COOKIE=eyJhbGci...your_token_here...
```

---

## 8. Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3001` | Backend HTTP port |
| `FLOW_MODE` | Yes | `browser` | Always set to `browser` |
| `HEADLESS` | No | `true` | `false` to see Chrome window (helps debug reCAPTCHA) |
| `FLOW_SESSION_COOKIE` | **Yes** | — | Google session token, captured via `npm run capture:session` |
| `REDIS_URL` | No | `redis://127.0.0.1:6379` | Redis connection string |
| `JWT_SECRET` | Yes | — | Random 32+ char string for JWT signing |
| `BROWSER_POOL_SIZE` | No | `2` | Max concurrent generation jobs |
| `VIDEO_RATE_LIMIT` | No | `3` | Max video jobs per rate window |
| `RATE_WINDOW_SEC` | No | `60` | Rate window in seconds |
| `MIN_GEN_GAP_MS` | No | `5000` | Min ms between jobs per user |
| `DB_PATH` | No | `./poc.db` | SQLite database file path |
| `CREDIT_WARN_THRESHOLD` | No | `500` | Log warning below this credit count |

---

## 9. Daily Startup Workflow

Every time you want to use the app, start these in order:

### Terminal 1 — Redis (if not already running)

```powershell
redis-server
```

### Terminal 2 — Backend

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-backend"
npm start
```

Wait for: `✅ Server running at http://localhost:3001`

### Terminal 3 — ngrok (Android users only)

```powershell
ngrok http 3001
```

Copy the `https://` URL for the Android app's server settings.

### Terminal 4 — Electron app

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-electron"
npm start
```

### Terminal 5 — Android Metro (Android users only)

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-android"
npx react-native start
```

> After first install, you only need Terminals 1–3 + Metro. The APK is already on the device.

---

## 10. Troubleshooting

### "Too many requests" error in app

Caused by stuck jobs in the database. Run:

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-backend"
node fix.js
redis-cli FLUSHALL
npm start
```

If `fix.js` doesn't exist, create it:

```javascript
// fix.js — run from poc-backend: node fix.js
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'poc.db'));
const before = db.prepare(
  "SELECT COUNT(*) as count FROM poc_jobs WHERE status IN ('queued','processing')"
).get();
console.log('Stuck jobs found:', before.count);

const result = db.prepare(
  "UPDATE poc_jobs SET status='failed', error='stale' WHERE status IN ('queued','processing')"
).run();
console.log('Cleared:', result.changes, 'jobs');
db.close();
```

---

### Session shows wrong email on startup

Cause: `.env` has a commented-out old cookie at the top (`//FLOW_SESSION_COOKIE=...`).

Fix:
1. Open `poc-backend/.env`
2. Delete the line starting with `//FLOW_SESSION_COOKIE=`
3. Run `npm run capture:session` again
4. `npm start`

---

### reCAPTCHA 403 "unusual activity" error

This means Google is blocking the automated browser. Causes and fixes:

| Cause | Fix |
|---|---|
| New account with no history | Use Flow manually for 5–10 minutes first |
| Disposable email domain | Switch to a real @gmail.com account |
| Repeated failed attempts | Wait 30–60 minutes, then retry |
| Headless mode detection | Set `HEADLESS=false` in `.env` |

---

### Android "Can't find service: package" build error

Caused by the emulator or phone not being ready when Gradle tries to install.

```powershell
# Check device status
adb devices
# Should show: XXXXXXXX    device
# If it shows "offline" — wait and try again

# If both emulator AND phone are connected, kill the emulator:
adb -s emulator-5554 emu kill

# Then retry:
npx react-native run-android
```

---

### Android build fails with multiple devices connected

Gradle installs on ALL connected devices simultaneously. If the emulator isn't fully booted, it fails.

**Fix:** Always close the emulator when using a physical phone. Run `adb devices` before building to confirm only one device is listed.

---

### "Video prompt input not found" error

The Playwright automation couldn't type into Google Flow's input field. This usually means the page loaded in an unexpected state.

The backend will automatically retry 3 times. If it keeps failing:

1. Check `HEADLESS=false` in `.env` to see what's happening in the browser
2. Restart the backend: `Ctrl+C` then `npm start`
3. Check if the Google Flow page (`labs.google/fx/tools/flow`) loads normally in your regular browser

---

### "Session cookie expired" error

```powershell
npm run capture:session
# Log in again, then:
npm start
```

---

### Redis not running

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

Start Redis:

```powershell
redis-server
```

---

### Image/video is generated but reference image is ignored

This is the "file deleted on retry" bug — fixed in the current `flowProxy.js`. Make sure you are using the latest version of `poc-backend/services/flowProxy.js` from the repository.

Symptoms in logs:
```
Attempt 1: ✅ Reference image set via input[type="file"]
Attempt 2: Reference image not found, skipping   ← file deleted too early
```

Fix: Use the latest `flowProxy.js` where file cleanup only happens in `browserGenerateVideo`'s `finally` block.

---

### Android image picker not working

Make sure `react-native-image-picker` is installed:

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-android"
npm install react-native-image-picker
npx react-native run-android
```

The package requires a native rebuild — shaking and reloading JS is not enough.

---

## 11. Maintenance

### Weekly — Refresh session cookie

Every ~7 days the Google Flow session expires. You will notice videos stop generating.

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-backend"
npm run capture:session
# Log in to Google Flow in the Chrome window that opens
npm start
```

### Clear stale jobs (if generation gets stuck)

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-backend"
node fix.js
redis-cli FLUSHALL
npm start
```

### Check remaining Google credits

Credits are logged automatically in the backend console:

```
[CreditMonitor] Remaining credits: 18420
```

Credits are consumed per generation:
- Image: ~2 credits
- Video 4s: ~5 credits
- Video 6s: ~8 credits
- Video 8s: ~10 credits

### Database table names (for direct SQL queries)

| Table | Purpose |
|---|---|
| `poc_jobs` | Generation job records |
| `poc_users` | User accounts |
| `audit_log` | Request audit trail |
| `refresh_tokens` | JWT refresh tokens |
| `user_projects` | Per-user Google Flow project IDs |

Example query to inspect jobs:

```powershell
# From poc-backend directory:
node -e "const DB=require('better-sqlite3')('./poc.db'); console.log(JSON.stringify(DB.prepare('SELECT id,type,status,created_at FROM poc_jobs ORDER BY created_at DESC LIMIT 10').all(),null,2))"
```

---

*End of deployment guide.*
