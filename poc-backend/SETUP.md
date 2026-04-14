# POC Backend — Setup & Mode Guide

## TL;DR — Start Here

```
FLOW_MODE=mock  → Just works. No credentials. No Chrome. Use this first.
FLOW_MODE=api   → Needs session cookie. No Chrome.
FLOW_MODE=browser → Needs session cookie. Headless Chrome runs in background.
```

**investigateFlow.js ALWAYS opens a visible Chrome.** It is a dev tool,
not part of the normal server. Do not run it to start the server.

---

## The 3 Modes Explained

### MODE: mock (default)

What it does:
- Returns a real public image or video URL after a delay
- No network calls to Flow whatsoever
- Chrome never opens
- No credentials needed

When to use:
- First time setting up — verify the full stack works
- Frontend development — test UI without real generation
- CI / automated testing

How to run:
```
FLOW_MODE=mock in .env  (this is the default)
npm start
```

---

### MODE: api

What it does:
- Sends authenticated POST requests directly to Flow's tRPC API using axios
- Uses your session cookie (FLOW_SESSION_COOKIE) as auth
- No browser at all — pure HTTP calls
- Fastest option once you have a valid cookie

When to use:
- You have a valid session cookie from the investigate script
- You want the lightest-weight option (no Playwright overhead)

How to set up:
```
1. Run: node scripts/investigateFlow.js
2. Log in via Google OAuth in the opened browser
3. Generate something in Flow
4. Find next-auth.session-token in the output (authCookies section)
5. Set in .env:
     FLOW_MODE=api
     FLOW_SESSION_COOKIE=<paste the token value here>
     TRPC_IMAGE_PROC=<procedure name from flow-api-report.json>
     TRPC_VIDEO_PROC=<procedure name from flow-api-report.json>
6. npm start
```

Note: Session cookies expire (typically 30 days). Re-run the
investigate script when you get 401 errors.

---

### MODE: browser

What it does:
- Launches a HEADLESS (invisible) Chromium browser in the background
- Injects your session cookie directly — no login screen shown to users
- Makes tRPC calls from within the browser context (full cookie support)
- Chrome runs silently as a background process

When to use:
- Flow blocks direct axios calls (CORS / bot protection)
- You need full browser context for requests to succeed
- api mode returns 401 even with a valid cookie

How to set up:
```
1. Run: node scripts/investigateFlow.js
2. Log in via Google OAuth
3. Copy FLOW_SESSION_COOKIE from the output
4. Set in .env:
     FLOW_MODE=browser
     FLOW_SESSION_COOKIE=<your cookie>
     TRPC_IMAGE_PROC=<from flow-api-report.json>
     TRPC_VIDEO_PROC=<from flow-api-report.json>
5. npm start
   → "Headless browser ready" confirms it's working
```

---

## Why Does Chrome Open When I Run the Server?

It doesn't — unless you set `FLOW_MODE=browser`.

**investigateFlow.js is a separate dev tool.** It ALWAYS opens Chrome.
It is not the server. The commands are:

| Command | Opens Chrome? | Purpose |
|---|---|---|
| `npm start` with `FLOW_MODE=mock` | ❌ No | Start server in mock mode |
| `npm start` with `FLOW_MODE=api` | ❌ No | Start server with direct API calls |
| `npm start` with `FLOW_MODE=browser` | ✅ Yes (headless) | Start server with browser automation |
| `npm run investigate` | ✅ Yes (visible) | One-time dev tool to capture API endpoints |

---

## Why Can't the Script Log In Automatically?

**Flow uses Google OAuth.** There is no email + password form.

Google OAuth requires:
- A real browser session
- A human clicking "Sign in with Google"
- Google's own login flow (which blocks automation)

The investigate script cannot automate Google login. This is intentional
Google security. You must log in once manually, then the script saves your
session cookie for subsequent automated use.

---

## Step-by-Step: First Time Setup

```bash
# Step 1: Verify mock mode works (no credentials needed)
cd poc-backend
cp .env.example .env
# FLOW_MODE=mock is already set in .env
npm start
# Open another terminal:
curl -X POST http://localhost:3001/api/validate-key \
  -H "Content-Type: application/json" \
  -d '{"license_key":"poc-test-key-12345678"}'
# Should return: {"valid":true,...}

# Step 2: Test image generation in mock mode
curl -X POST http://localhost:3001/api/generate/image \
  -H "Content-Type: application/json" \
  -H "X-License-Key: poc-test-key-12345678" \
  -d '{"prompt":"a sunset"}'
# Returns: {"job_id":"...","status":"queued"}

# Step 3 (optional): Capture real Flow API endpoints
node scripts/investigateFlow.js
# → visible Chrome opens
# → log in with Google manually  
# → generate something in Flow
# → copy session cookie and tRPC procedure names from output
# → update .env with FLOW_SESSION_COOKIE, TRPC_IMAGE_PROC, TRPC_VIDEO_PROC
# → change FLOW_MODE to api or browser
# → npm start again
```

---

## Troubleshooting

**Chrome opens when I run `npm start`**
→ You have `FLOW_MODE=browser` set in .env. Change to `FLOW_MODE=mock` to test without it.

**"FLOW_SESSION_COOKIE is not set" error**
→ Run `node scripts/investigateFlow.js`, log in, copy the cookie from the output.

**Session cookie expired (401 from Flow)**
→ Re-run `node scripts/investigateFlow.js` to get a fresh cookie.

**"No URL in tRPC response" error**
→ The tRPC procedure name is wrong. Re-run investigate script, generate something,
   check `generationRequests[0].url` in flow-api-report.json for the correct name.

**Jobs stuck in "queued" forever**
→ Redis is not running. Run `redis-server` in a separate terminal.

**investigateFlow.js crashes with "Target page closed"**
→ This was a bug in the old script. The new version handles this gracefully.
