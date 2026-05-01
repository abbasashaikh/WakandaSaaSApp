# Chrome Memory Diagnosis & Fix Report
**App:** WakandaSaaSApp backend  
**Symptom:** 7+ Chrome processes, PC slow after `npm start`

---

## PART 1 — WHY 7+ CHROME PROCESSES SPAWN

### Root cause: This is by design, but misconfigured

Your backend uses **Playwright** to automate Google Flow AI. Playwright requires a real Chrome browser. When you run `npm start`, this is the exact spawn sequence:

```
npm start
  └─ server.js
       └─ flowProxy.init()
            └─ browser.launch()   ← ONE launch, MANY processes
                 │
                 ├─ [PID 1001] chrome.exe                ← main browser process       ~200 MB
                 ├─ [PID 1002] chrome.exe --type=gpu-process               ~150 MB
                 ├─ [PID 1003] chrome.exe --type=utility --utility-sub-type=network    ~80 MB
                 ├─ [PID 1004] chrome.exe --type=utility --utility-sub-type=storage    ~60 MB
                 ├─ [PID 1005] chrome.exe --type=renderer  ← warm page tab             ~300 MB
                 └─ [PID 1006] chrome.exe --type=renderer  ← pool slot context         ~250 MB
```

This is **normal Chrome multi-process architecture** — Chrome always spawns separate processes for GPU, network, storage, and each tab (renderer). You cannot stop this. You can only minimise it.

### The specific problem: Two bad settings in your current code

```js
// flowProxy.js — CURRENT BROKEN CONFIG
browser = await stealthChromium.launch({
  headless: false,        // ← PROBLEM 1: Shows full Chrome window, +200MB overhead
  args: [
    '--no-sandbox',
    '--window-size=1280,800',   // ← PROBLEM 2: Window sizing for visible mode
    '--window-position=100,100',
    '--no-first-run',
    // MISSING: --disable-gpu, --disable-dev-shm-usage, --no-zygote
  ],
});
```

`headless: false` means Chrome launches with **full desktop rendering** even though no human ever looks at the screen. This is the equivalent of turning on your TV just to run a program in the background — wasteful.

**Memory difference:**
```
headless: false  →  ~1.2 GB - 1.8 GB at idle
headless: true   →  ~600 MB - 900 MB at idle   (30-50% reduction)
```

---

## PART 2 — REAL-TIME MONITORING

### Step 1 — See exactly which Chrome processes are yours

Open PowerShell and run:
```powershell
# Show all Chrome processes with PID, memory, and command line
Get-WmiObject Win32_Process -Filter "Name='chrome.exe'" | 
  Select-Object ProcessId, 
    @{N='RAM_MB';E={[math]::Round($_.WorkingSetSize/1MB,1)}},
    @{N='Type';E={
      if($_.CommandLine -match 'type=gpu') {'GPU'}
      elseif($_.CommandLine -match 'type=renderer') {'Renderer/Tab'}
      elseif($_.CommandLine -match 'type=utility') {'Utility'}
      elseif($_.CommandLine -match 'type=crashpad') {'Crashpad'}
      else {'Main'}
    }} | 
  Sort-Object RAM_MB -Descending |
  Format-Table -AutoSize
```

Output tells you exactly what each process is doing:
```
ProcessId  RAM_MB  Type
---------  ------  ----
12456      312     Renderer/Tab   ← warm page keeping session alive
12234      287     Renderer/Tab   ← generation tab (active job)
12890      198     Main           ← browser process
12123      154     GPU            ← GPU compositing
11998      89      Utility        ← network service
11876      64      Utility        ← storage service
```

### Step 2 — Watch memory in real time (refresh every 3 seconds)
```powershell
# Live memory monitor — updates every 3 seconds
while ($true) {
  Clear-Host
  $procs = Get-WmiObject Win32_Process -Filter "Name='chrome.exe' OR Name='node.exe'"
  $total = ($procs | Measure-Object WorkingSetSize -Sum).Sum / 1MB
  Write-Host "=== $(Get-Date -Format 'HH:mm:ss') | Total: $([math]::Round($total,1)) MB ===" -ForegroundColor Cyan
  $procs | Select-Object Name, ProcessId,
    @{N='RAM_MB';E={[math]::Round($_.WorkingSetSize/1MB,1)}} |
    Sort-Object RAM_MB -Descending |
    Format-Table -AutoSize
  Start-Sleep 3
}
```

### Step 3 — Check total memory pressure
```powershell
# Available RAM vs used
$os = Get-WmiObject Win32_OperatingSystem
$total = [math]::Round($os.TotalVisibleMemorySize/1MB, 1)
$free  = [math]::Round($os.FreePhysicalMemory/1MB, 1)
$used  = [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory)/1MB, 1)
Write-Host "Total RAM: $total GB | Used: $used GB | Free: $free GB"
```

---

## PART 3 — THE FIX

### Fix 1 — Add `HEADLESS=false` to your `.env` file

Open `poc-backend\.env` in Notepad and make sure this line exists:
```env
HEADLESS=false
```

Wait — this **keeps** the Chrome window visible. This is intentional for **local development on your PC** so you can see what Chrome is doing and capture the session cookie.

For running the backend without Chrome windows visible (better for performance):
```env
HEADLESS=true
```

> **Which to use:** Use `HEADLESS=false` only when you need to capture a new session cookie via `npm run capture:session`. Use `HEADLESS=true` for all normal backend operation.

### Fix 2 — Replace `flowProxy.js` with the memory-optimised version

Your current `flowProxy.js` has `headless: false` hardcoded at line 159 and is missing critical memory-saving Chrome arguments. The **server-ready-update.zip** from our previous session contains the fixed version.

**What the fixed version changes:**
```js
// BEFORE (current) — wasteful
browser = await stealthChromium.launch({
  headless: false,        // always shows Chrome window
  args: ['--no-sandbox', '--window-size=1280,800', '--window-position=100,100'],
});

// AFTER (fixed) — efficient
const isHeadless = process.env.HEADLESS !== 'false';  // reads from .env
browser = await stealthChromium.launch({
  headless: isHeadless,   // true by default = no window = less memory
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',  // prevents memory spikes
    '--disable-gpu',            // GPU process not needed headless = saves 150 MB
    '--no-first-run',
    '--no-zygote',              // fewer sub-processes
  ],
});
```

**Replace your `poc-backend/services/flowProxy.js` with the one from `server-ready-update.zip`.**

### Fix 3 — Reduce memory per Chrome context

Add these to your `.env`:
```env
# Use 1 pool slot for local dev (default already, but make it explicit)
BROWSER_POOL_SIZE=1

# Reduce viewport to minimum needed (smaller = less memory)
# (no env for this yet, but it helps to know)
```

### Fix 4 — Reduce the viewport size (optional deeper fix)

In `flowProxy.js`, the viewport is set to `1280x800`. For headless operation this can be reduced to `1024x768` which saves memory on renderer processes. This is a code change, not an env change.

---

## PART 4 — EXPECTED MEMORY AFTER FIX

```
BEFORE fix (headless: false):
  Chrome main:       ~200 MB
  Chrome GPU:        ~150 MB   ← eliminated with --disable-gpu in headless
  Chrome utility x2: ~140 MB
  Chrome renderer:   ~300 MB   (warm page)
  Chrome renderer:   ~280 MB   (pool context)
  ─────────────────────────
  Total Chrome:      ~1070 MB

AFTER fix (headless: true + memory flags):
  Chrome main:       ~180 MB
  Chrome GPU:        ~0 MB     ← eliminated
  Chrome utility x2: ~100 MB
  Chrome renderer:   ~200 MB   (warm page)
  ─────────────────────────
  Total Chrome:      ~480 MB   ← 55% reduction
```

---

## PART 5 — IMMEDIATE RELIEF RIGHT NOW

If you need to free memory immediately **without restarting the server**:

### Option A — Kill all Chrome processes and let the server restart them
```powershell
# WARNING: this will fail any in-progress generation jobs
# but the server will auto-recover (crash recovery is built in)
Get-Process chrome | Stop-Process -Force
```
The `setupCrashRecovery()` in `flowProxy.js` will detect the disconnection and reinitialise Chrome after 3 seconds automatically.

### Option B — Restart the server with HEADLESS=true
```powershell
# In poc-backend terminal:
Ctrl+C     # stop the server

# Edit .env and ensure:
# HEADLESS=true

npm start  # restart — Chrome starts headless, saves ~500 MB
```

### Option C — Set Windows process priority (temporary)
```powershell
# Lower Chrome process priority so they don't steal from other apps
Get-Process chrome | ForEach-Object { $_.PriorityClass = 'BelowNormal' }
```
This does not reduce memory but makes PC more responsive by giving other processes higher CPU priority.

---

## PART 6 — WHY YOU CANNOT HAVE ZERO CHROME PROCESSES

This is the fundamental architecture constraint. The backend automates Google's AI website which requires a real browser. There is no way to interact with `labs.google/fx/tools/flow` without Chrome because:

1. The site uses React with complex JavaScript rendering
2. The generation uses browser-side cookies for authentication
3. The API interception (catching `batchGenerateImages` responses) requires browser-level hooks

**The minimum Chrome footprint is:**
```
1× main process      (cannot eliminate)
2× utility processes (cannot eliminate — handles network + storage)
1× renderer process  (the warm page — can be eliminated if session keepalive is disabled)
─────────────────────
Minimum: 4 Chrome processes, ~480 MB headless
```

To go to zero Chrome processes would require Google to release a public API — which they have not done.

---

## SUMMARY TABLE

| Action | Memory Saved | Time to do | Risk |
|---|---|---|---|
| Set `HEADLESS=true` in .env | ~400-600 MB | 1 minute | None |
| Apply `server-ready-update.zip` flowProxy.js | ~150 MB extra | 2 minutes | None |
| Set `BROWSER_POOL_SIZE=1` (if not already) | ~250 MB if was 2 | 1 minute | None |
| Kill Chrome + restart server headless | Immediate relief | 2 minutes | Fails in-progress jobs |
| Lower Chrome CPU priority | 0 MB | 30 seconds | PC more responsive |
| **Total achievable reduction** | **~550-900 MB** | **5 minutes** | **None** |

