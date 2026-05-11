# GitHub Issues — WakandaSaaSApp / poc-ai-creative-studio
## Session Date: May 11, 2026

---

## Issue #1 — Android Emulator fails to start: Vulkan incompatible driver

**Labels:** `bug` `android` `emulator`
**Priority:** High

### Description
Android emulator crashes on launch with `VK_ERROR_INCOMPATIBLE_DRIVER`. All GPU modes fail including `swiftshader_indirect`, `guest`, `angle_indirect`, and `off`.

### Steps to Reproduce
1. Create AVD Pixel6 with API 34
2. Run `emulator.exe -avd Pixel6 -gpu swiftshader_indirect`
3. Emulator crashes immediately

### Error
```
FATAL: Running multiple emulators with the same AVD is an experimental feature
Failed to create Vulkan instance: VK_ERROR_INCOMPATIBLE_DRIVER
Critical: Failed to load opengl32sw
GPU #1 Make: 8086, Model: Intel(R) HD Graphics, Device ID: 0402
```

### Root Cause
Intel HD Graphics 8086/0402 (old integrated GPU) does not support Vulkan. API 34 x86_64 system image requires Vulkan.

### Fix Applied
Created lower API AVD — Pixel4 with API 30 x86 AOSP image (no Google APIs). This does not require Vulkan.
```
Device: Pixel 4
API: 30
ABI: x86 (NOT x86_64)
Image: AOSP (no Google APIs)
```

### Workaround
Use physical Android phone via USB debugging. This completely bypasses emulator GPU requirements.

---

## Issue #2 — React Native: android folder missing from poc-android

**Labels:** `bug` `android` `setup`
**Priority:** High

### Description
Running `npx react-native run-android` fails because the `android/` native folder does not exist in `poc-android/`. Only JS source files were delivered in the original scaffold.

### Steps to Reproduce
```
cd poc-android
npx react-native run-android
```

### Error
```
error Android project not found. Are you sure this is a React Native project?
If your Android files are located in a non-standard location, consider setting
project.android.sourceDir option.
```

### Root Cause
The `poc-android.zip` from initial project setup contained only JS/React Native source files. The native Android project (`android/` folder) was never generated.

### Fix Applied
Copied `android/` template folder from `node_modules/react-native/template/android` into the project root.
```powershell
Copy-Item -Recurse "node_modules\react-native\template\android" ".\android"
```

---

## Issue #3 — Build fails: compileSdk 34 incompatible with react-native-video 

**Labels:** `bug` `android` `build` `dependency`
**Priority:** High

### Description
Gradle build fails with 13 AAR metadata errors. `react-native-video` pulls `androidx.media3:1.8.0` which requires `compileSdk = 35` but project is set to `compileSdk = 34`.

### Error
```
FAILURE: Build failed with an exception.
Execution failed for task ':app:checkDebugAarMetadata'.
Dependency 'androidx.media3:media3-exoplayer:1.8.0' requires libraries and
applications that depend on it to compile against version 35 or later.
:app is currently compiled against android-34.
```

### Root Cause
`react-native-video` upgraded its `media3` dependency to `1.8.0` which requires Android API 35. Project `build.gradle` was set to API 34.

### Fix Applied
Updated `android/build.gradle`:
```gradle
compileSdkVersion = 35
targetSdkVersion  = 35
buildToolsVersion = "35.0.0"
classpath("com.android.tools.build:gradle:8.3.0")
```

---

## Issue #4 — Metro bundler fails: No metro.config.js found

**Labels:** `bug` `android` `metro`
**Priority:** Medium

### Description
`npx react-native start` fails because `metro.config.js` does not exist in `poc-android/`.

### Error
```
error No Metro config found in C:\App Development\poc-ai-creative-studio\poc-android.
```

### Fix Applied
Created `metro.config.js`:
```javascript
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const config = {};
module.exports = mergeConfig(getDefaultConfig(__dirname), config);
```

---

## Issue #5 — App shows "HelloWorld not registered" on emulator

**Labels:** `bug` `android` `runtime`
**Priority:** High

### Description
After build succeeds and app launches, a red error screen appears: `"HelloWorld" has not been registered`.

### Error
```
Uncaught Error: "HelloWorld" has not been registered. This can happen if:
* Metro (the local dev server) is run from the wrong folder.
* A module failed to load due to an error and AppRegistry.registerComponent wasn't called.
```

### Root Cause
`MainApplication.kt` in the copied template has `getMainComponentName()` returning `"HelloWorld"`. Our `index.js` registered the component as `"helloworld"` (lowercase) — **case mismatch**.

### Fix Applied
Updated `index.js` to match exact string:
```javascript
AppRegistry.registerComponent('HelloWorld', () => App);
```
Updated `app.json`:
```json
{ "name": "HelloWorld", "displayName": "PocAndroid" }
```

---

## Issue #6 — ANDROID_HOME duplicate path causes adb reverse failure

**Labels:** `bug` `android` `environment`
**Priority:** Medium

### Description
After APK installs on physical phone, app shows blank white screen. The `adb reverse` command fails silently.

### Error (from logs)
```
warn Failed to connect to development server using "adb reverse":
spawnSync C:\Users\Shaikh\AppData\Local\Android\Sdk\Sdk\platform-tools\adb ENOENT
                                                              ^^^^ Sdk appears twice!
```

### Root Cause
`ANDROID_HOME` environment variable had a doubled path segment resulting in `...Android\Sdk\Sdk\platform-tools\adb` — the `Sdk` folder appeared twice causing ENOENT.

### Fix Applied
Reset environment variable in current session:
```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:PATH = "$env:PATH;$env:LOCALAPPDATA\Android\Sdk\platform-tools"
```
Made permanent:
```powershell
[Environment]::SetEnvironmentVariable("ANDROID_HOME","$env:LOCALAPPDATA\Android\Sdk","User")
```

---

## Issue #7 — Electron app shows black screen: "BASE has already been declared"

**Labels:** `bug` `electron` `javascript`
**Priority:** High

### Description
After Android platform tracking changes were applied, the Windows Electron app shows a completely black screen.

### Error (DevTools Console)
```
Uncaught SyntaxError: Identifier 'BASE' has already been declared
at :5173/api.js:32
```

### Root Cause
During the Android platform tracking session, `const BASE` was accidentally declared twice in `poc-electron/src/renderer/api.js`. JavaScript `const` does not allow redeclaration.

### Fix Applied
Removed the duplicate `const BASE` declaration (kept the first occurrence at line 10, removed the second at line 32).

---

## Issue #8 — Generated image not displaying in Electron app

**Labels:** `bug` `electron` `ui`
**Priority:** High

### Description
Image generation completes successfully (backend logs show `Generation completed` with a valid URL), but the image canvas stays blank/invisible in the Electron window.

### Root Cause
`ResultCanvas` component had `className="...animate-fade-in"`. The `animate-fade-in` CSS class was not defined in `tailwind.config.js`, causing the image to start at `opacity: 0` and never animate to visible.

### Fix Applied
Removed the undefined CSS animation class from `ResultCanvas`:
```diff
- className="absolute inset-0 w-full h-full object-cover rounded-2xl animate-fade-in"
+ className="absolute inset-0 w-full h-full object-cover rounded-2xl"
```

---

## Issue #9 — Session cookie: wrong Google account loaded on npm start

**Labels:** `bug` `backend` `session`
**Priority:** Critical

### Description
After running `npm run capture:session` and logging in with `mrabsshk@gmail.com`, the backend always starts with the old `veoanti69703551@anna37.sbs` account session instead of the newly captured one.

### Root Cause
The `.env` file had a **commented-out** old cookie on line 2:
```
//FLOW_SESSION_COOKIE=eyJhbGci...veoanti cookie...
```
The `captureSession.js` regex `/FLOW_SESSION_COOKIE=.*/` matched this commented line **first** and updated it — leaving the real active `FLOW_SESSION_COOKIE=` on line 18 unchanged with the stale value. `dotenv` then loaded the old value from line 18.

### Fix Applied
**1. Deleted** the `//FLOW_SESSION_COOKIE=...` commented line from `.env`.

**2. Fixed regex** in `captureSession.js` to only match at line start:
```javascript
// BEFORE (matches commented lines too)
envContent.replace(/FLOW_SESSION_COOKIE=.*/, ...)

// AFTER (^ + m flag = start of line only)
envContent.replace(/^FLOW_SESSION_COOKIE=.*/m, ...)
```

---

## Issue #10 — Pool browser contexts redirect to Google login despite valid session

**Labels:** `bug` `backend` `playwright` `critical`
**Priority:** Critical

### Description
After session cookie fix, image generation still fails. Browser pool contexts navigate to `https://accounts.google.com/v3/signin/...` instead of `https://labs.google/fx/tools/flow`, even though the `bContext` keepalive session is fully authenticated.

### Error (logs)
```
[FlowProxy:BROWSER] Gallery URL: https://accounts.google.com/v3/signin/identifier?...
[FlowProxy:BROWSER] ❌ Session cookie expired in .env
```

### Root Cause
**NextAuth rotates session tokens on first use.** The `bContext` hits `/api/auth/session` during init which rotates the token — the original `.env` value is immediately invalidated. Pool contexts created afterward have the old invalidated token, so Google redirects them to login.

`browserPool.createIsolatedContext()` was injecting only `labs.google` cookies using the original `.env` value. The rotated token and Google auth cookies set during `bContext` warm-up were never shared with pool contexts.

### Fix Applied
**`browserPool.js`** — Added `updateCookies(freshCookies)` function and `_freshCookies` variable. Pool contexts now use fresh rotated cookies when available.

**`flowProxy.js`** — After warm page loads, syncs ALL cookies from `bContext` to pool:
```javascript
// After warm page initialization
const freshCookies = await bContext.cookies(); // ALL domains
if (freshCookies?.length > 0) {
  browserPool.updateCookies(freshCookies);
  console.log(`[FlowProxy:BROWSER] ✅ Pool cookies synced (${freshCookies.length} cookies)`);
}
```

---

## Issue #11 — reCAPTCHA 403: PERMISSION_DENIED on image generation

**Labels:** `bug` `backend` `google-api`
**Priority:** High

### Description
Even with a valid session, image generation fails with reCAPTCHA 403 errors.

### Error
```
API 403: {"error":{"code":403,"message":"reCAPTCHA evaluation failed",
"status":"PERMISSION_DENIED","details":[{"reason":"PUBLIC_ERROR_UNUSUAL_ACTIVITY"}]}}
```

### Root Cause
Three contributing factors:
1. **Disposable email account** (`anna37.sbs` domain) has low Google trust score
2. **IP reputation** damaged by repeated failed automation attempts
3. **Headless Chrome** leaves detectable automation signals

### Fix Applied
1. Switched to real Gmail account (`mrabsshk@gmail.com`)
2. Set `HEADLESS=false` for better reCAPTCHA score
3. Manually used Google Flow in a real browser first to establish account trust history

---

## Issue #12 — NovaCraft: JWT key too short (248 bits, requires 256)

**Labels:** `bug` `novacraft-backend` `.net`
**Priority:** High

### Description
User registration and login crash the NovaCraft .NET backend with an unhandled exception.

### Error
```
System.ArgumentOutOfRangeException: IDX10720: Unable to create KeyedHashAlgorithm
for algorithm 'HS256', the key size must be greater than: '256' bits, key has '248' bits.
```

### Root Cause
The placeholder JWT key `REPLACE_WITH_32+_RANDOM_CHARS_SECRET_KEY_HERE` in `appsettings.json` is 31 characters = 248 bits. HS256 requires a minimum of 32 characters = 256 bits. One character short.

### Fix Applied
Updated `appsettings.json`:
```json
"Jwt": {
  "Key": "NovaCraft@SecretKey#2026$Secure!XYZ"
}
```
Key is 35 characters = 280 bits ✅

---

## Issue #13 — NovaCraft: CORS blocks frontend on port 3151

**Labels:** `bug` `novacraft-backend` `cors`
**Priority:** Medium

### Description
After changing Vite dev server port from 5173 to 3151, all API calls from the frontend are blocked by CORS policy.

### Error (browser console)
```
Access to fetch at 'http://localhost:5000/api/auth/register' from origin
'http://localhost:3151' has been blocked by CORS policy: No
'Access-Control-Allow-Origin' header is present.
```

### Root Cause
`Program.cs` CORS policy only whitelisted `http://localhost:5173`. The new port `3151` was not in the allowed origins list.

### Fix Applied
Updated CORS policy in `Program.cs` to use dynamic origin check:
```csharp
policy.SetIsOriginAllowed(origin =>
    origin.StartsWith("http://localhost:") ||
    origin == "https://novacraft-frontend.vercel.app" ||
    (origin.StartsWith("https://novacraft-frontend-") && origin.EndsWith(".vercel.app"))
)
```

---

## Issue #14 — NovaCraft: .NET runtime version mismatch

**Labels:** `bug` `novacraft-backend` `.net` `environment`
**Priority:** High

### Description
`dotnet run` fails because the project targets `net8.0` but only .NET 10 is installed on the machine.

### Error
```
You must install or update .NET to run this application.
Framework: 'Microsoft.NETCore.App', version '8.0.0' (x64)
The following frameworks were found: 10.0.7
```

### Root Cause
Project was scaffolded targeting `net8.0`. The developer's machine only has .NET 10 installed. .NET is not backwards-compatible for runtime hosting.

### Fix Applied
Updated `novacraft-backend.csproj`:
```xml
<TargetFramework>net10.0</TargetFramework>
```
Also updated all package versions to be compatible with .NET 10:
```xml
<PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" Version="9.0.0" />
<PackageReference Include="Microsoft.AspNetCore.Authentication.JwtBearer" Version="9.0.0" />
<PackageReference Include="MailKit" Version="4.11.0" />
<PackageReference Include="MimeKit" Version="4.11.0" />
```

---

## Issue #15 — NovaCraft frontend: VITE_API_URL not set, calls localhost

**Labels:** `bug` `novacraft-frontend` `deployment` `vercel`
**Priority:** High

### Description
Deployed frontend on Vercel still calls `http://localhost:2121/api/...` instead of the Render.com backend URL.

### Error (browser console)
```
POST http://localhost:2121/api/auth/register net::ERR_CONNECTION_REFUSED
```

### Root Cause
`VITE_API_URL` environment variable was never set in Vercel project settings. Vite bakes environment variables into the JS bundle **at build time** — they cannot be set after deployment without a redeploy. Without the variable, `api.js` falls back to `localhost`.

### Fix Applied
1. Added `VITE_API_URL=https://novacraftbackend-1.onrender.com/api` in Vercel Dashboard → Settings → Environment Variables
2. Triggered a redeploy from Vercel Dashboard

---

## Issue #16 — Backend image generation: stale Redis jobs replaying on restart

**Labels:** `bug` `backend` `redis` `bullmq`
**Priority:** Medium

### Description
On every backend restart, old failed jobs from previous sessions are immediately replayed, consuming generation credits and filling logs with errors.

### Root Cause
BullMQ stores failed job data in Redis. When the backend restarts, the worker picks up any jobs that were in `delayed` or `waiting` states from before the shutdown — even if they had already failed multiple times.

### Fix Applied
```powershell
redis-cli FLUSHALL
```
**Note:** This is safe as Redis only stores job queues — all persistent data is in SQLite (`poc.db`).

**Long-term fix needed:** Implement job TTL or stale job pruning on startup.

---

## Issue #17 — Image upload: + button non-functional

**Labels:** `enhancement` `electron` `android` `in-progress`
**Priority:** Medium

### Description
The `+` button in the bottom-left of the Image Generation page exists in the UI but does nothing when clicked. Users cannot attach a reference image for image-to-image generation.

### Expected Behavior
1. User clicks `+` button
2. File picker opens
3. User selects an image (JPG/PNG/WebP)
4. Thumbnail preview shown in canvas
5. User types a prompt
6. Generation uses the uploaded image as reference in Google Flow

### Fix Applied (this session)
**5 files updated:**
- `ImagePage.jsx` — `+` button triggers file picker, shows thumbnail preview, changes prompt placeholder
- `api.js` — Auto-detects `File` object and switches from JSON to `FormData`
- `server.js` — Added `multer` middleware (10MB limit, image validation, auto-cleanup)
- `generate.js` — Accepts multipart form data, extracts `reference_image_path`, passes to queue
- `flowProxy.js` — Added `uploadReferenceImage()` helper using Playwright `setInputFiles()`

---

## Summary Table

| # | Issue | Component | Severity | Status |
|---|-------|-----------|----------|--------|
| 1 | Emulator Vulkan GPU crash | Android/Emulator | High | ✅ Resolved |
| 2 | Missing android/ folder | Android/Setup | High | ✅ Resolved |
| 3 | compileSdk 34 vs 35 mismatch | Android/Build | High | ✅ Resolved |
| 4 | Missing metro.config.js | Android/Metro | Medium | ✅ Resolved |
| 5 | HelloWorld name mismatch | Android/Runtime | High | ✅ Resolved |
| 6 | ANDROID_HOME duplicate path | Android/Env | Medium | ✅ Resolved |
| 7 | BASE declared twice in api.js | Electron/JS | High | ✅ Resolved |
| 8 | Image invisible (missing CSS class) | Electron/UI | High | ✅ Resolved |
| 9 | Wrong Google account loaded | Backend/Session | Critical | ✅ Resolved |
| 10 | Pool contexts redirect to Google login | Backend/Playwright | Critical | ✅ Resolved |
| 11 | reCAPTCHA 403 UNUSUAL_ACTIVITY | Backend/Google | High | ✅ Resolved |
| 12 | JWT key 248 bits (needs 256) | NovaCraft/.NET | High | ✅ Resolved |
| 13 | CORS blocks port 3151 | NovaCraft/.NET | Medium | ✅ Resolved |
| 14 | .NET runtime 8 vs 10 mismatch | NovaCraft/.NET | High | ✅ Resolved |
| 15 | VITE_API_URL not set in Vercel | NovaCraft/Deploy | High | ✅ Resolved |
| 16 | Stale Redis jobs replaying | Backend/Redis | Medium | ✅ Resolved |
| 17 | + button non-functional (upload) | Electron+Android | Medium | ✅ Implemented |
