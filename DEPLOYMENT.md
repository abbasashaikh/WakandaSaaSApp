# POC AI Creative Studio — Complete Deployment Guide

> For new developers setting up the project from scratch.  
> Covers: Backend · Electron (Windows) · Android Dev · Android Release APK  
> Last updated: May 2026

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Project Structure](#3-project-structure)
4. [Backend Setup](#4-backend-setup)
5. [Electron App Setup](#5-electron-app-setup)
6. [Android App Setup — Development](#6-android-app-setup--development)
7. [Android Release APK Build](#7-android-release-apk-build)
8. [Electron Production Build (.exe)](#8-electron-production-build-exe)
9. [Google Flow Session Setup](#9-google-flow-session-setup)
10. [Environment Variables Reference](#10-environment-variables-reference)
11. [Daily Startup Workflow](#11-daily-startup-workflow)
12. [Troubleshooting](#12-troubleshooting)
13. [Maintenance](#13-maintenance)

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
- The release APK is a standalone installer — does not need Metro or a PC once built.

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
| Java JDK | 17 | https://adoptium.net |
| ngrok | Latest | https://ngrok.com/download |
| 7-Zip | Latest | https://www.7-zip.org (needed for Electron build) |

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
│   ├── fix.js                ← Clears stuck jobs
│   ├── routes/
│   │   └── generate.js       ← Image/video generation endpoints
│   ├── services/
│   │   ├── flowProxy.js      ← Playwright browser automation
│   │   ├── browserPool.js    ← Browser context pool
│   │   └── queue.js          ← BullMQ job queue
│   ├── middleware/
│   │   └── rateLimiter.js    ← Per-user rate limiting
│   └── scripts/
│       └── captureSession.js ← Captures Google session cookie
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
    ├── android/
    │   ├── app/
    │   │   ├── build.gradle          ← Signing config lives here
    │   │   └── my-release-key.keystore  ← Generated once, never commit
    │   └── gradle.properties         ← Keystore credentials
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
# Run: npm run capture:session   to get this value (see Section 9)
# Expires every ~7 days — re-capture when session stops working
# CRITICAL: Only ONE line with FLOW_SESSION_COOKIE= — no commented copies
FLOW_SESSION_COOKIE=REPLACE_THIS_AFTER_CAPTURE

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_URL=redis://127.0.0.1:6379

# ── JWT ───────────────────────────────────────────────────────────────────────
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=CHANGE_ME_generate_a_real_random_string_here
ACCESS_TOKEN_TTL_SEC=3600
REFRESH_TOKEN_TTL_SEC=604800

# ── Browser pool ──────────────────────────────────────────────────────────────
# Each slot uses ~400MB RAM
#   4GB RAM  → BROWSER_POOL_SIZE=2
#   8GB RAM  → BROWSER_POOL_SIZE=4
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

> **IMPORTANT:** The `FLOW_SESSION_COOKIE` value is required to start. Complete Section 9 first to get it.

### Step 3 — Start Redis

```powershell
# Open a dedicated PowerShell window for Redis
redis-server
```

You should see: `Ready to accept connections`. Keep this window open.

### Step 4 — Capture Google session (first time)

See **Section 9** for full instructions. Quick steps:

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-backend"
npm run capture:session
# A Chrome window opens — log in with your Google account
# Script auto-captures the cookie and updates .env
```

### Step 5 — Start the backend

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-backend"
npm start
```

**Wait for ALL these lines before using the app:**

```
✅ Stealth mode enabled
✅ Session: yourname@gmail.com
Pool initialised
✅ Warm page initialized on labs.google
Cookies synced from bContext
Worker started
✅ Server running at http://localhost:3001
```

### Step 6 — Verify backend is working

```powershell
Invoke-WebRequest http://localhost:3001/health | Select-Object -ExpandProperty Content
# Should return: {"status":"ok"}
```

---

## 5. Electron App Setup

### Development (run locally)

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-electron"
npm install
npm start
```

The Electron window opens and connects to `http://localhost:3001` automatically.

Login with test key: `poc-test-key-12345678`

See **Section 8** for building the production `.exe` installer.

---

## 6. Android App Setup — Development

> Development mode requires Metro bundler running on your PC. Use this for testing/coding. For distribution to testers, see **Section 7 (Release APK)**.

### Step 1 — Install dependencies

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-android"
npm install
npm install react-native-image-picker
```

### Step 2 — Start ngrok (new terminal)

```powershell
ngrok http 3001
```

Copy the `https://abc123.ngrok-free.app` URL — needed in Step 6.

### Step 3 — Connect your phone

**Physical phone (recommended):**

1. Settings → About Phone → tap **Build Number** 7 times
2. Settings → Developer Options → enable **USB Debugging**
3. Connect via USB → accept "Allow USB debugging?" on phone

```powershell
adb devices
# Must show: XXXXXXXX    device
```

**Emulator (if no physical phone):**

> Use Pixel 4 API 30 (x86 AOSP) only. API 34 has Vulkan crashes.

1. Android Studio → Device Manager → Create → Pixel 4 → API 30 (AOSP, x86)
2. Start emulator — wait until home screen is fully visible
3. `adb devices` → confirm shows `device` not `offline`

> **CRITICAL:** If BOTH emulator and phone are connected, Gradle installs on both and fails if emulator isn't ready. Always close emulator when using phone.

### Step 4 — Start Metro bundler (new terminal)

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-android"
npx react-native start --reset-cache
```

Wait for: `Metro waiting on exp://...`

### Step 5 — Build and install debug APK (new terminal, run once)

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-android"
npx react-native run-android
```

Takes 3–7 minutes first time. App auto-launches on device when done.

### Step 6 — Set server URL in app

1. Tap **Server Setup** in the app
2. Enter ngrok URL: `https://abc123.ngrok-free.app`
3. Tap **Save**
4. Login with: `poc-test-key-12345678`

### Reload JS without rebuilding

After first install, for JS-only changes just shake phone → **Reload** (or press `R` twice in Metro terminal).

---

## 7. Android Release APK Build

> The release APK is a **signed, standalone installer** — no Metro, no PC required. Share this file with testers or install on any Android device.

### Step 1 — Generate signing keystore (ONE TIME ONLY)

The keystore is your app's identity. **If you lose it you cannot update the app.**

```powershell
# Navigate to the EXACT folder — keystore must live here
cd "C:\App Development\poc-ai-creative-studio\poc-android\android\app"

keytool -genkey -v -keystore my-release-key.keystore -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

Fill in the prompts (use your real info or placeholders):

```
Enter keystore password:  yourpassword123
Re-enter new password:    yourpassword123
What is your first and last name?  Your Name
What is the name of your org unit?  Dev
What is the name of your organization?  YourBrand
What is the name of your City?  Pune
What is the name of your State?  Maharashtra
What is the two-letter country code?  IN
Is this correct? yes
```

Verify it was created:

```powershell
dir my-release-key.keystore
# Must show the file (~2KB)
```

> **BACKUP:** Copy `my-release-key.keystore` to a safe location (Google Drive, USB). Never commit it to Git.

### Step 2 — Add keystore credentials to gradle.properties

Open `poc-android/android/gradle.properties` and add at the bottom:

```properties
MYAPP_RELEASE_STORE_FILE=my-release-key.keystore
MYAPP_RELEASE_KEY_ALIAS=my-key-alias
MYAPP_RELEASE_STORE_PASSWORD=yourpassword123
MYAPP_RELEASE_KEY_PASSWORD=yourpassword123
```

### Step 3 — Verify build.gradle signing config

Open `poc-android/android/app/build.gradle`. The `signingConfigs` and `buildTypes` blocks must look exactly like this — **no commas between blocks** (common mistake):

```gradle
signingConfigs {
    debug {
        storeFile file('debug.keystore')
        storePassword 'android'
        keyAlias 'androiddebugkey'
        keyPassword 'android'
    }
    release {
        storeFile file(MYAPP_RELEASE_STORE_FILE)
        storePassword MYAPP_RELEASE_STORE_PASSWORD
        keyAlias MYAPP_RELEASE_KEY_ALIAS
        keyPassword MYAPP_RELEASE_KEY_PASSWORD
    }
}
buildTypes {
    debug {
        signingConfig signingConfigs.debug
    }
    release {
        signingConfig signingConfigs.release
        minifyEnabled false
        proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
    }
}
```

> **Common mistake:** A comma after the `debug { }` closing brace causes: `Could not find method debug() for arguments`. Remove it if present.

### Step 4 — Create the assets folder (if missing)

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-android"
New-Item -ItemType Directory -Force "android\app\src\main\assets"
```

### Step 5 — Bundle the JavaScript

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-android"

npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output android/app/src/main/assets/index.android.bundle --assets-dest android/app/src/main/res
```

Expected output:
```
info Writing bundle output to: android/app/src/main/assets/index.android.bundle
info Done writing bundle output
info Copying 6 asset files
info Done copying assets
```

### Step 6 — Build the release APK

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-android\android"
.\gradlew.bat assembleRelease
```

Takes 5–10 minutes. Expected final line: `BUILD SUCCESSFUL`

### Step 7 — Find your APK

```powershell
dir "C:\App Development\poc-ai-creative-studio\poc-android\android\app\build\outputs\apk\release\"
```

File: **`app-release.apk`**

### Step 8 — Install or distribute

**Install via USB:**
```powershell
adb install "android\app\build\outputs\apk\release\app-release.apk"
```

**Install manually (no cable):**
1. Copy `app-release.apk` to your phone via WhatsApp, Google Drive, or USB
2. On phone: tap the APK file
3. If prompted: Settings → Security → allow **Install unknown apps**
4. Tap Install

**Share with testers:**
Just send the `app-release.apk` file — they install it the same way.

### Step 9 — Configure server URL after install

After installing the release APK:
1. Open the app → go to **Server Setup**
2. Enter your ngrok URL: `https://abc123.ngrok-free.app`
3. Tap Save → Login with: `poc-test-key-12345678`

### APK build — complete command sequence

```powershell
# Run these in order every time you want a new release APK:

# 1. Create assets folder (only if missing)
cd "C:\App Development\poc-ai-creative-studio\poc-android"
New-Item -ItemType Directory -Force "android\app\src\main\assets"

# 2. Bundle JS
npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output android/app/src/main/assets/index.android.bundle --assets-dest android/app/src/main/res

# 3. Build APK
cd android
.\gradlew.bat assembleRelease

# 4. Install (optional)
adb install app\build\outputs\apk\release\app-release.apk
```

---

## 8. Electron Production Build (.exe)

### Build the installer

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-electron"
npm run build
```

Output: `poc-electron/dist-electron/NovaCraft Setup 1.0.0.exe`

### If build fails with "Access is denied" (NSIS cache error)

This is a Windows Defender issue — it holds a lock on the downloaded NSIS executable during antivirus scanning.

**Fix A — Add Defender exclusion (permanent fix):**
```powershell
# Run PowerShell as Administrator
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\electron-builder\Cache"
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache\nsis" -ErrorAction SilentlyContinue
npm run build
```

**Fix B — Manually extract NSIS (no security changes):**
```powershell
# Clear corrupt cache
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache\nsis" -ErrorAction SilentlyContinue

# Create target directory
New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\electron-builder\Cache\nsis\nsis-3.0.4.1"

# Download
$url = "https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-3.0.4.1/nsis-3.0.4.1.7z"
Invoke-WebRequest -Uri $url -OutFile "$env:TEMP\nsis-3.0.4.1.7z"

# Extract with 7-Zip (install from https://www.7-zip.org if missing)
& "C:\Program Files\7-Zip\7z.exe" x "$env:TEMP\nsis-3.0.4.1.7z" -o"$env:LOCALAPPDATA\electron-builder\Cache\nsis\nsis-3.0.4.1" -y

# Build
npm run build
```

---

## 9. Google Flow Session Setup

This is required to generate images and videos. Google Flow has no public API — the backend uses Playwright to automate a real Chrome browser with your logged-in session.

### First-time capture

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-backend"
npm run capture:session
```

A Chrome window opens. Follow these steps:

1. **Log in** with a real Gmail account (not a disposable email domain)
2. Navigate to `https://labs.google/fx/tools/flow`
3. Wait until you see the Flow gallery (image grid)
4. The script **automatically** detects the session and updates `.env`

You will see:
```
✅ Logged in as: yourname@gmail.com
✅ Cookie captured (1064 chars)
✅ .env updated with new session cookie
✅ Now restart the backend: npm start
```

### Re-capture (every ~7 days)

Session cookie expires weekly. Symptoms of an expired cookie:
- Backend shows `Session cookie expired`
- All generations fail immediately
- Logs show redirect to `accounts.google.com`

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-backend"
npm run capture:session
npm start
```

### Build account trust first (new account only)

Fresh accounts have zero trust score and get reCAPTCHA 403 errors.

Before first automated use:
1. Open regular Chrome (NOT the capture script)
2. Log in at `https://labs.google/fx/tools/flow`
3. Manually generate 3–5 images/videos in the web UI
4. Leave the page open for 5–10 minutes
5. Then run `npm run capture:session`

### Critical .env rule

The `.env` file must have **exactly one** `FLOW_SESSION_COOKIE=` line. A commented-out old value at the top (`//FLOW_SESSION_COOKIE=...`) causes the capture script to update the wrong line — server loads the old stale cookie.

Correct format:
```env
# Only ONE occurrence, no // prefixed copies above it:
FLOW_SESSION_COOKIE=eyJhbGci...your_token_here...
```

---

## 10. Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3001` | Backend HTTP port |
| `FLOW_MODE` | Yes | `browser` | Always set to `browser` |
| `HEADLESS` | No | `true` | `false` shows Chrome window (helps debug reCAPTCHA) |
| `FLOW_SESSION_COOKIE` | **Yes** | — | Google session token, captured via `npm run capture:session` |
| `REDIS_URL` | No | `redis://127.0.0.1:6379` | Redis connection string |
| `JWT_SECRET` | Yes | — | Random 32+ char string for JWT signing |
| `BROWSER_POOL_SIZE` | No | `2` | Max concurrent generation jobs |
| `VIDEO_RATE_LIMIT` | No | `20` | Max video jobs per rate window |
| `RATE_WINDOW_SEC` | No | `300` | Rate window in seconds |
| `MIN_GEN_GAP_MS` | No | `5000` | Min ms between jobs per user |
| `DB_PATH` | No | `./poc.db` | SQLite database file path |
| `CREDIT_WARN_THRESHOLD` | No | `500` | Log warning below this credit count |
| `CREDIT_CRITICAL_THRESHOLD` | No | `50` | Log critical alert below this count |

---

## 11. Daily Startup Workflow

Start in this exact order every session:

### Terminal 1 — Redis

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

### Terminal 5 — Android Metro (development only, not needed for release APK)

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-android"
npx react-native start
```

> **Release APK users:** Only need Terminals 1–3. The installed APK runs standalone — no Metro needed.

---

## 12. Troubleshooting

### "Too many requests" error in app

Caused by stuck jobs in the database.

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-backend"
node fix.js
redis-cli FLUSHALL
npm start
```

If `fix.js` doesn't exist, create it in `poc-backend/`:

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

Cause: `.env` has a commented-out old cookie line (`//FLOW_SESSION_COOKIE=...`).

Fix:
1. Open `poc-backend/.env`
2. Delete the line starting with `//FLOW_SESSION_COOKIE=`
3. Confirm only ONE `FLOW_SESSION_COOKIE=` line exists
4. Run `npm run capture:session` again → `npm start`

---

### reCAPTCHA 403 "unusual activity" error

| Cause | Fix |
|---|---|
| New account with no history | Use Flow manually for 5–10 minutes first |
| Disposable email domain | Switch to a real @gmail.com account |
| Repeated failed attempts | Wait 30–60 minutes before retrying |
| Headless mode detection | Set `HEADLESS=false` in `.env` |

---

### Android "Can't find service: package" build error

The emulator isn't fully booted when Gradle tries to install.

```powershell
adb devices
# Must show: XXXXXXXX    device  (not "offline")

# If emulator is connected alongside phone, kill it:
adb -s emulator-5554 emu kill

# Then retry:
npx react-native run-android
```

---

### Android build fails with multiple devices connected

Gradle installs on ALL connected devices. If any device isn't ready, the whole task fails.

**Fix:** Close the emulator when using physical phone. Always verify `adb devices` shows only one device before building.

---

### APK build — "Could not find method debug()" error

Cause: A comma after the `debug { }` block in `build.gradle` (Groovy syntax error).

Find and remove the comma:
```gradle
# WRONG — comma causes the error:
signingConfigs {
    debug {
        ...
    },     ← remove this comma
    release {
```

```gradle
# CORRECT:
signingConfigs {
    debug {
        ...
    }
    release {
```

---

### APK build — "Keystore file not found" error

```
Keystore file 'android/app/my-release-key.keystore' not found
```

The keystore was not generated in the correct folder. Generate it in the exact location Gradle expects:

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-android\android\app"
keytool -genkey -v -keystore my-release-key.keystore -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

---

### APK bundle error — "ENOENT: no such file or directory"

```
error ENOENT: no such file or directory, open '...assets/index.android.bundle'
```

The `assets` folder doesn't exist yet.

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-android"
New-Item -ItemType Directory -Force "android\app\src\main\assets"
# Then re-run the bundle command
```

---

### "Video prompt input not found" error

Playwright couldn't type into Google Flow's input. Backend retries automatically 3 times. If it keeps failing:

1. Set `HEADLESS=false` in `.env` to see what Chrome is doing
2. Restart the backend: `Ctrl+C` → `npm start`
3. Check `labs.google/fx/tools/flow` loads normally in your regular browser

---

### "Session cookie expired" error

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-backend"
npm run capture:session
npm start
```

---

### Redis not running

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

```powershell
redis-server
```

---

### Reference image ignored in video generation

Symptom in logs:
```
Attempt 1: ✅ Reference image set via input[type="file"]
Attempt 2: Reference image not found, skipping
```

Fix: Make sure you are using the latest `poc-backend/services/flowProxy.js`. The file cleanup must only happen in `browserGenerateVideo`'s `finally` block — not inside `uploadReferenceImage`'s own `finally` block.

---

### Android image picker not working

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-android"
npm install react-native-image-picker
npx react-native run-android   # full native rebuild required
```

Shaking and reloading JS is not enough — this package requires a native rebuild.

---

### Electron build "Access is denied" (NSIS cache)

See **Section 8** for the full fix. Quick version:

```powershell
# Run as Administrator:
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\electron-builder\Cache"
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache\nsis"
npm run build
```

---

## 13. Maintenance

### Weekly — Refresh session cookie

Every ~7 days the Google Flow session expires.

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-backend"
npm run capture:session
# Log in to Google Flow in the Chrome window that opens
npm start
```

### Clear stale jobs

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-backend"
node fix.js
redis-cli FLUSHALL
npm start
```

### Check remaining Google credits

Credits appear automatically in backend logs:
```
[CreditMonitor] Remaining credits: 18420
```

Credits consumed per generation:
- Image: ~2 credits
- Video 4s: ~5 credits
- Video 6s: ~8 credits
- Video 8s: ~10 credits

### Rebuild release APK after code changes

Every time you change Android code and want a new release APK:

```powershell
cd "C:\App Development\poc-ai-creative-studio\poc-android"

# Re-bundle JS (always do this before assembleRelease)
npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output android/app/src/main/assets/index.android.bundle --assets-dest android/app/src/main/res

# Rebuild APK
cd android
.\gradlew.bat assembleRelease

# New APK at:
# android\app\build\outputs\apk\release\app-release.apk
```

### Database table names

| Table | Purpose |
|---|---|
| `poc_jobs` | Generation job records |
| `poc_users` | User accounts |
| `audit_log` | Request audit trail |
| `refresh_tokens` | JWT refresh tokens |
| `user_projects` | Per-user Google Flow project IDs |

Inspect recent jobs:
```powershell
# From poc-backend directory:
node -e "const DB=require('better-sqlite3')('./poc.db'); console.log(JSON.stringify(DB.prepare('SELECT id,type,status,created_at FROM poc_jobs ORDER BY created_at DESC LIMIT 10').all(),null,2))"
```

### Key files to back up

Never lose these files:

| File | Why critical |
|---|---|
| `poc-backend/.env` | All config including session cookie |
| `poc-android/android/app/my-release-key.keystore` | App signing identity — losing it means you cannot update the app |
| `poc-android/android/gradle.properties` | Keystore credentials |

---

*End of deployment guide.*
