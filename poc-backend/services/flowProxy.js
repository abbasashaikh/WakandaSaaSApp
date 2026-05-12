// services/flowProxy.js — CLEAN FINAL
// Image: intercept batchGenerateImages (working ✅)
// Video: intercept batchGenerateVideos using page.evaluate direct API call
//        from GALLERY page (stable context, not project page)
//require('dotenv').config();
// NEW — force override of any existing env vars
require('dotenv').config({ override: true });

const FLOW_MODE           = (process.env.FLOW_MODE || 'mock').toLowerCase();
const FLOW_SESSION_COOKIE = process.env.FLOW_SESSION_COOKIE || '';
const FLOW_URL            = 'https://labs.google/fx/tools/flow';
const AISANDBOX_BASE      = 'https://aisandbox-pa.googleapis.com/v1';
const AISANDBOX_API_KEY   = 'AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pY';
const RECAPTCHA_KEY       = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

const PORT = process.env.PORT || 3001;
const SELF = `http://localhost:${PORT}`;
const MOCK_IMAGES = [1,2,3,4,5].map(n => `${SELF}/mock-assets/mock-images/image${n}.jpg`);
const MOCK_VIDEOS = [1,2,3].map(n => `${SELF}/mock-assets/mock-videos/video${n}.mp4`);

// ── Phase 3: Browser pool ────────────────────────────────────────────────────
const browserPool = require('./browserPool');

// ── Logger (must be before creditMonitor which uses sysLogger) ────────────────
const { sysLogger } = require('../middleware/logger');

// ── Credit monitor ────────────────────────────────────────────────────────────
// Tracks remaining Google Flow credits across all generation responses.
// Logs warnings at thresholds; pauses queue when critically low.
const creditMonitor = (() => {
  let _current = null;
  const WARN_THRESHOLD     = parseInt(process.env.CREDIT_WARN_THRESHOLD  || '500');
  const CRITICAL_THRESHOLD = parseInt(process.env.CREDIT_CRITICAL_THRESHOLD || '50');

  return {
    update(remaining) {
      const prev = _current;
      _current = remaining;

      // Log only when value changes or crosses thresholds
      if (prev === null || Math.abs(prev - remaining) >= 10) {
        console.log(`[CreditMonitor] Remaining credits: ${remaining}`);
      }
      if (remaining <= CRITICAL_THRESHOLD) {
        sysLogger.error('credits', '🚨 CRITICAL: credits nearly exhausted — generation will fail', { remaining });
        console.error(`[CreditMonitor] 🚨 CRITICAL: only ${remaining} credits left!`);
      } else if (remaining <= WARN_THRESHOLD) {
        sysLogger.warn('credits', '⚠️ Credits running low', { remaining });
        console.warn(`[CreditMonitor] ⚠️ Low credits: ${remaining} remaining`);
      }
    },
    get()  { return _current; },
    toJSON() { return { remaining: _current, warn_at: WARN_THRESHOLD, critical_at: CRITICAL_THRESHOLD }; },
  };
})();

// Per-user rate limiting (Phase 1)
const userLastGenTime = new Map();
const MIN_GAP_MS = parseInt(process.env.MIN_GEN_GAP_MS || '5000');

// browser   = shared Chrome process (launched once)
// bContext  = keepalive context for warmPage ONLY (never used for generation)
// pool      = N isolated contexts, one per concurrent job
let browser     = null;
let bContext    = null;
let warmPage    = null;

// ── Mock ──────────────────────────────────────────────────────
async function mockImage(prompt) {
  const ms = parseInt(process.env.MOCK_DELAY_IMAGE || '4000');
  console.log(`[FlowProxy:MOCK] Image "${prompt}" (${ms}ms)`);
  await sleep(ms);
  return { success: true, output_url: MOCK_IMAGES[Math.floor(Math.random() * MOCK_IMAGES.length)] };
}
async function mockVideo(prompt) {
  const ms = parseInt(process.env.MOCK_DELAY_VIDEO || '8000');
  await sleep(ms);
  return { success: true, output_url: MOCK_VIDEOS[Math.floor(Math.random() * MOCK_VIDEOS.length)] };
}

// ── Extract image URL from batchGenerateImages response ───────
function extractImageUrl(body) {
  if (!body) return null;
  return (
    body?.media?.[0]?.image?.generatedImage?.fifeUrl  ||
    body?.media?.[0]?.image?.generatedImage?.gcsUri   ||
    body?.media?.[0]?.image?.generatedImage?.url      ||
    body?.responses?.[0]?.imageMedia?.mediaUrl        ||
    body?.responses?.[0]?.image?.imageUrl             ||
    null
  );
}

// ── Init ──────────────────────────────────────────────────────
async function dismissPopups(page) {
  // CRITICAL: NEVER remove DOM nodes — breaks React vDOM and loses the input
  // ONLY use: click real close buttons OR press Escape
  try {
    // Guard: skip evaluate if page is navigating (prevents Execution context destroyed error)
    const currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com')) {
      throw new Error('Session cookie expired — run: node scripts/captureSession.js then restart npm start');
    }
    let clicked;
    try {
      clicked = await page.evaluate(() => {
      // Find and click ANY visible close/dismiss button inside dialogs or modals
      const closeSelectors = [
        '[role="dialog"] button[aria-label*="close" i]',
        '[role="dialog"] button[aria-label*="dismiss" i]',
        '[role="dialog"] button[aria-label*="got it" i]',
        '[role="dialog"] button[aria-label*="ok" i]',
        '[role="dialog"] button:last-child',  // usually the confirm/close button
        'button[aria-label*="close changelog" i]',
        'button[aria-label*="close" i]',
        // Radix dialog close button pattern
        '[data-state="open"] button[type="button"]:last-of-type',
      ];
      for (const sel of closeSelectors) {
        try {
          const btn = document.querySelector(sel);
          if (btn && btn.offsetParent !== null && !btn.disabled) {
            btn.click();
            return sel;
          }
        } catch(e) {}
      }
      return null;
    });

    } catch(evalErr) {
      if (evalErr.message && evalErr.message.includes('Execution context was destroyed')) {
        console.warn('[FlowProxy:BROWSER] dismissPopups: context destroyed (non-fatal, skipping)');
        return; // non-fatal — generation can still proceed
      }
      throw evalErr;
    }
    if (clicked) {
      console.log(`[FlowProxy:BROWSER] Dismissed dialog via button: ${clicked}`);
      await page.waitForTimeout(800);
      return;
    }

    // Check if any blocking dialog exists — if so press Escape
    const hasDialog = await page.evaluate(() =>
      !!document.querySelector('[role="dialog"][data-state="open"]')
    );
    if (hasDialog) {
      console.log('[FlowProxy:BROWSER] Dialog detected — pressing Escape');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
      // Press again in case first didn't work
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
  } catch(e) {}
}

// Track init state
let _initDone = false;

async function browserInit() {
  if (_initDone) return;
  if (!FLOW_SESSION_COOKIE || FLOW_SESSION_COOKIE.length < 100) {
    throw new Error('FLOW_SESSION_COOKIE not set. Run: npm run capture:session');
  }
  console.log('[FlowProxy:BROWSER] Starting browser...');
  const { chromium } = require('playwright');
// Stealth plugin — patches automation signals reCAPTCHA detects
// Falls back to plain playwright if not installed
let stealthChromium = chromium;
try {
  const { chromium: pExtra } = require('playwright-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  pExtra.use(StealthPlugin());
  stealthChromium = pExtra;
  console.log('[FlowProxy] ✅ Stealth mode enabled');
} catch {
  console.log('[FlowProxy] ⚠️  playwright-extra not found — run: npm install playwright-extra puppeteer-extra-plugin-stealth');
  console.log('[FlowProxy] ⚠️  Falling back to plain Playwright (reCAPTCHA may block)');
}
  const _fs = require('fs');
  const exePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
  ];
  const realExe = exePaths.find(p => _fs.existsSync(p));
  if (realExe) console.log(`[FlowProxy:BROWSER] Chrome: ${realExe}`);

  // HEADLESS: set HEADLESS=false in .env for local development (shows Chrome window)
  // On a server (Azure/Linux) always runs headless — no display available
  const isHeadless = process.env.HEADLESS !== 'false';
  console.log(`[FlowProxy:BROWSER] Mode: ${isHeadless ? 'headless' : 'headed (visible window)'}`);

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',   // prevents crashes on low /dev/shm (common on Linux VMs)
    '--disable-gpu',             // not needed headless, reduces memory
    '--no-first-run',
    '--no-zygote',               // reduces process count on Linux
  ];

  // Only add window args in headed mode (server has no display)
  if (!isHeadless) {
    launchArgs.push('--window-size=1280,800', '--window-position=100,100');
  }

  browser = await stealthChromium.launch({
    headless: isHeadless,
    executablePath: realExe || undefined,
    args: launchArgs,
    ignoreDefaultArgs: ['--enable-automation'],
  });
  bContext = await browser.newContext({
    viewport:  { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  await bContext.addCookies([
    { name: '__Secure-next-auth.session-token', value: FLOW_SESSION_COOKIE,
      domain: 'labs.google', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
    { name: 'next-auth.session-token', value: FLOW_SESSION_COOKIE,
      domain: 'labs.google', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
  const vp = await bContext.newPage();
  await vp.goto('https://labs.google/fx/api/auth/session', { waitUntil: 'domcontentloaded', timeout: 20000 });
  const txt = await vp.evaluate(() => document.body.innerText).catch(() => '{}');
  await vp.close();

  let sess = {};
  try { sess = JSON.parse(txt); } catch {}
  if (!sess?.user?.email) {
    throw new Error(`Cookie rejected. Run: npm run capture\nResponse: ${txt.slice(0,100)}`);
  }
  console.log(`[FlowProxy:BROWSER] ✅ Session: ${sess.user.email}`);
  // Phase 3: Share the launched browser with the pool
  await browserPool.initPool(browser);

  // Set up crash recovery listener
  setupCrashRecovery();

  _initDone = true;
  console.log(`[FlowProxy:BROWSER] ✅ Ready — session: ${sess?.user?.email || 'unknown'}`);

  // Warm page: separate context just for session keepalive
  // Does NOT participate in generation — just keeps cookies fresh
  try {
    warmPage = await bContext.newPage();
    await warmPage.goto('https://labs.google/fx/tools/flow', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await warmPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    console.log('[FlowProxy:BROWSER] ✅ Warm page initialized on labs.google');

    // ── COOKIE SYNC FIX ────────────────────────────────────────────────────
    // NextAuth rotates session tokens on first use. bContext now holds the
    // fresh rotated token after visiting /api/auth/session + warm page load.
    // Pool contexts created later must use this rotated token — the original
    // .env value is already invalidated by Google at this point.
    // Sync ALL cookies from bContext → pool so generation contexts have the
    // correct token and don't get redirected to Google login on navigation.
    try {
      //const freshCookies = await bContext.cookies(['https://labs.google']);
      const freshCookies = await bContext.cookies(); // ALL domains — includes Google auth cookies
      if (freshCookies && freshCookies.length > 0) {
        browserPool.updateCookies(freshCookies);
        console.log(`[FlowProxy:BROWSER] ✅ Pool cookies synced (${freshCookies.length} cookies)`);
      }
    } catch (syncErr) {
      console.warn('[FlowProxy:BROWSER] Cookie sync warning (non-fatal):', syncErr.message);
    }
    // ───────────────────────────────────────────────────────────────────────

  } catch (err) {
    console.warn('[FlowProxy:BROWSER] Warm page init failed (non-fatal):', err.message);
  }
}

// ── createProject helper ──────────────────────────────────────
async function createProject(page, userId = null) {
  // Per-user project cache via DB (replaces shared module-level cachedProjectId)
  if (userId) {
    const { getUserProject } = require('../db');
    const cached = getUserProject(userId);
    if (cached) {
      console.log(`[FlowProxy:BROWSER] Reusing project for user ${userId}: ${cached}`);
      return cached;
    }
  }
  console.log('[FlowProxy:BROWSER] Navigating to gallery...');
  await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await sleep(2000);
  const url = page.url();
  console.log(`[FlowProxy:BROWSER] Gallery URL: ${url}`);
  if (url.includes('accounts.google.com')) {
    // Session expired — auto-reinit browser with fresh cookies
    // Cookie in .env is expired — auto-reinit cannot fix this because it reuses
    // the same expired cookie from process.env. User must run captureSession.js.
    console.error('[FlowProxy:BROWSER] ❌ Session cookie expired in .env');
    console.error('[FlowProxy:BROWSER] Run: node scripts/captureSession.js');
    _initDone = false; // reset so next startup re-initialises after cookie is refreshed
    throw new Error('Session cookie expired — run: node scripts/captureSession.js then restart npm start');
  }
  if (url.includes('/project/')) {
    await page.goto(FLOW_URL, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    await sleep(1500);
  }
  // Guard: re-check URL just before evaluate — SPA may have navigated internally
  const urlBeforeEval = page.url();
  if (urlBeforeEval.includes('accounts.google.com')) {
    _initDone = false;
    throw new Error('Session cookie expired — run: node scripts/captureSession.js then restart npm start');
  }

  let result;
  try {
    result = await page.evaluate(async () => {
      try {
        const r = await fetch('https://labs.google/fx/api/trpc/project.createProject', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ json: { projectTitle: new Date().toLocaleString(), toolName: 'PINHOLE' } }),
        });
        const d = await r.json();
        return { status: r.status, projectId: d?.result?.data?.json?.result?.projectId, raw: JSON.stringify(d).slice(0,200) };
      } catch(e) { return { status: 0, error: e.message }; }
    });
  } catch(evalErr) {
    if (evalErr.message && evalErr.message.includes('Execution context was destroyed')) {
      console.warn('[FlowProxy:BROWSER] createProject: context destroyed — waiting and retrying navigate...');
      await sleep(3000);
      await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await sleep(2000);
      result = await page.evaluate(async () => {
        try {
          const r = await fetch('https://labs.google/fx/api/trpc/project.createProject', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ json: { projectTitle: new Date().toLocaleString(), toolName: 'PINHOLE' } }),
          });
          const d = await r.json();
          return { status: r.status, projectId: d?.result?.data?.json?.result?.projectId, raw: JSON.stringify(d).slice(0,200) };
        } catch(e) { return { status: 0, error: e.message }; }
      });
    } else {
      throw evalErr;
    }
  }
  if (result.error) throw new Error(`createProject fetch error: ${result.error}`);
  if (result.status !== 200 || !result.projectId) throw new Error(`project.createProject failed (${result.status}): ${result.raw}`);
  console.log(`[FlowProxy:BROWSER] Project: ${result.projectId}`);
  // Store in DB per-user cache (safe for concurrent users)
  if (userId) {
    const { setUserProject } = require('../db');
    setUserProject(userId, result.projectId);
  }
  return result.projectId;
}

// ── IMAGE generation (intercept approach — proven working) ────
async function browserGenerateImage(prompt, options = {}) {
  if (!_initDone) await browserInit();
  console.log(`[FlowProxy:BROWSER] Generating: "${prompt}"`);
  // Per-user rate limiter (each user has independent timing, not shared global)
  const imgUserId = options?.userId || null;
  const imgNow    = Date.now();
  const imgLast   = imgUserId ? (userLastGenTime.get(`img_${imgUserId}`) || 0) : 0;
  const imgGap    = imgNow - imgLast;
  if (imgGap < MIN_GAP_MS) {
    const wait = MIN_GAP_MS - imgGap;
    console.log(`[FlowProxy:BROWSER] User ${imgUserId} rate gap: waiting ${wait}ms`);
    await sleep(wait);
  }
  if (imgUserId) userLastGenTime.set(`img_${imgUserId}`, Date.now());

  // Phase 3: acquire isolated context from pool
  const { context: imgCtx, slotId: imgSlot, release: imgRelease } =
    await browserPool.acquire({
      jobId:         options?.jobId  || `img-${Date.now()}`,
      userId:        imgUserId,
      sessionCookie: FLOW_SESSION_COOKIE,
    });
  console.log(`[FlowProxy:BROWSER] Pool slot ${imgSlot} acquired for image job`);
  const genPage = await imgCtx.newPage();
  try {
    const projectId = await createProject(genPage, imgUserId);

    let resolveUrl, rejectUrl;
    const urlPromise = new Promise((res, rej) => { resolveUrl = res; rejectUrl = rej; });
    genPage.on('response', async (response) => {
      if (!response.url().includes('batchGenerateImages')) return;
      try {
        const status = response.status();
        const body   = await response.json().catch(() => ({}));
        console.log(`[FlowProxy:BROWSER] batchGenerateImages → ${status}`);
        if (status !== 200) { rejectUrl(new Error(`API ${status}: ${JSON.stringify(body).slice(0,200)}`)); return; }
        console.log(`[FlowProxy:BROWSER] Body: ${JSON.stringify(body).slice(0,300)}`);
        const imgCr = body?.remainingCredits;
        if (typeof imgCr === 'number') { creditMonitor.update(imgCr); }
        const url = extractImageUrl(body);
        if (url) { resolveUrl(url); }
        else { console.log('[FlowProxy:BROWSER] FULL RESPONSE:', JSON.stringify(body)); rejectUrl(new Error('URL not found')); }
      } catch(e) { rejectUrl(e); }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Navigation: gallery warm-up → project page
    //
    // WHY GALLERY FIRST:
    //   Fresh pool contexts have no DNS cache, no TLS session, no HTTP resource
    //   cache. Navigating directly to /project/UUID cold can exceed 30s on first
    //   load (DNS + TLS + full Next.js bundle download).
    //   Loading FLOW_URL (gallery) first primes all caches. Then the project page
    //   loads in ~3-5s using cached resources — well within any timeout.
    //   BONUS: The gallery dwell time also starts building the reCAPTCHA score.
    // ─────────────────────────────────────────────────────────────────────────

    // Step A: Gallery warm-up (DNS + TLS + CDN cache + reCAPTCHA Phase 1)
    console.log('[FlowProxy:BROWSER] Gallery warm-up (priming cache)...');
    await genPage.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await genPage.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    // Verify session is still valid
    const imgGalleryUrl = genPage.url();
    if (imgGalleryUrl.includes('accounts.google.com')) {
      _initDone = false;
      throw new Error('Session cookie expired — run: node scripts/captureSession.js then restart');
    }
    console.log(`[FlowProxy:BROWSER] Gallery ready: ${imgGalleryUrl}`);
    await dismissPopups(genPage);

    // ── reCAPTCHA warm-up (runs on gallery page) ─────────────────────────────
    // Fresh contexts have zero reCAPTCHA score. We build it during gallery dwell
    // BEFORE generating, so the project page navigation arrives with a warm score.
    console.log('[FlowProxy:BROWSER] reCAPTCHA warm-up...');

    // Phase 1: Dwell — reCAPTCHA observes the page load
    await sleep(1200 + Math.random() * 600);

    // Phase 2: Reading sweep — slow left-to-right mouse movement
    const startX = 300 + Math.random() * 100;
    const startY = 200 + Math.random() * 80;
    await genPage.mouse.move(startX, startY);
    await sleep(300 + Math.random() * 200);
    for (let x = startX; x < startX + 350; x += 45 + Math.random() * 20) {
      await genPage.mouse.move(x, startY + Math.random() * 8);
      await sleep(55 + Math.random() * 55);
    }
    await sleep(200 + Math.random() * 200);

    // Phase 3: Brief scroll (natural page exploration)
    await genPage.evaluate(() => window.scrollBy(0, 50 + Math.random() * 30));
    await sleep(400 + Math.random() * 200);

    // Phase 4: Move toward bottom of viewport (user looking for the prompt)
    await genPage.mouse.move(500 + Math.random() * 80, 600 + Math.random() * 60);
    await sleep(250 + Math.random() * 150);
    await genPage.evaluate(() => window.scrollBy(0, -(15 + Math.random() * 10)));
    await sleep(500 + Math.random() * 300);

    console.log('[FlowProxy:BROWSER] reCAPTCHA warm-up complete');

    // Step B: Navigate to project page — uses cached resources, loads fast
    const projectUrl = `${FLOW_URL}/project/${projectId}`;
    console.log('[FlowProxy:BROWSER] Loading project...');
    await genPage.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await genPage.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await dismissPopups(genPage);

    // Give React time to hydrate and mount the prompt bar component.
    // Even with warm resources, React needs ~2-3s after networkidle to render the
    // contenteditable input. Without this sleep, waitForSelector times out.
    await sleep(2500);
    await dismissPopups(genPage); // second check — dialogs sometimes appear after hydration

    // Wait for prompt input with generous timeout (React hydration can be slow)
    let inputEl = null, inputSel = '';
    for (const sel of ['[contenteditable="true"]', 'textarea', '[role="textbox"]']) {
      try {
        await genPage.waitForSelector(sel, { state: 'visible', timeout: 20000 });
        const el = await genPage.$(sel);
        if (el && await el.isVisible().catch(() => false)) { inputEl = el; inputSel = sel; break; }
      } catch {}
    }

    // Fallback: if project page didn't render input, stale project — clear cache and use gallery
    if (!inputEl) {
      const btnCount = await genPage.evaluate(() =>
        document.querySelectorAll('button, [role="button"]').length
      ).catch(() => 0);
      console.warn(`[FlowProxy:BROWSER] ⚠️ Project page blank (${btnCount} buttons) — navigating to gallery as fallback`);

      // Clear stale project so next attempt creates a fresh one
      if (imgUserId) {
        try { const { clearUserProject } = require('../db'); clearUserProject(imgUserId); } catch {}
      }

      // Navigate BACK to gallery — waiting on a blank page never recovers.
      // The gallery page reliably renders the prompt input for logged-in users.
      console.log('[FlowProxy:BROWSER] Navigating to gallery...');
      try {
        await genPage.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await genPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        console.log(`[FlowProxy:BROWSER] Gallery URL: ${genPage.url()}`);
        await dismissPopups(genPage);
        await sleep(1500);
      } catch(navErr) {
        throw new Error(`Gallery fallback navigation failed: ${navErr.message}`);
      }

      // Create new project from gallery context (clears the stale one)
      const newProjectId = await createProject(genPage, imgUserId);
      console.log(`[FlowProxy:BROWSER] Project: ${newProjectId}`);

      // Navigate to the new project page
      const newProjectUrl = `${FLOW_URL}/project/${newProjectId}`;
      await genPage.goto(newProjectUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await genPage.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await dismissPopups(genPage);
      await sleep(2500);

      // Try selectors on the fresh project page
      for (const sel of ['[contenteditable="true"]', 'textarea', '[role="textbox"]']) {
        try {
          await genPage.waitForSelector(sel, { state: 'visible', timeout: 20000 });
          const el = await genPage.$(sel);
          if (el && await el.isVisible().catch(() => false)) { inputEl = el; inputSel = sel; break; }
        } catch {}
      }
      if (!inputEl) throw new Error('Prompt input not found even after gallery fallback — will retry');
    }
    console.log(`[FlowProxy:BROWSER] Input: ${inputSel}`);

    await inputEl.click(); await sleep(400);
    await genPage.keyboard.press('Control+A');
    await inputEl.type(prompt, { delay: 40 });
    await sleep(600);
    await genPage.evaluate(sel => {
      const el = document.querySelector(sel);
      if (el) { el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
    }, inputSel);
    await sleep(600);

    console.log('[FlowProxy:BROWSER] Pressing Enter...');
    await inputEl.press('Enter');
    await sleep(500);

    const quick = await Promise.race([
      urlPromise.then(u=>({type:'url',url:u})).catch(e=>({type:'error',error:e})),
      sleep(5000).then(()=>({type:'timeout'})),
    ]);
    if (quick.type === 'url') { console.log(`[FlowProxy:BROWSER] ✅ Image: ${quick.url}`); return { success:true, output_url:quick.url, metadata:{projectId} }; }
    if (quick.type === 'error') throw new Error(quick.error.message);

    await genPage.mouse.move(640, 400); await sleep(300);
    for (const sel of ['[aria-label*="run" i]','[aria-label*="generate" i]','div:has([contenteditable="true"]) button:last-child','div:has(textarea) button:last-child']) {
      try { const el = await genPage.$(sel); if (el && await el.isVisible().catch(()=>false)) { const box=await el.boundingBox(); if(box){await genPage.mouse.move(box.x+box.width/2,box.y+box.height/2);await sleep(200);await el.click();console.log(`[FlowProxy:BROWSER] Clicked: ${sel}`);break;} } } catch {}
    }

    console.log('[FlowProxy:BROWSER] Waiting for image (120s)...');
    const imageUrl = await Promise.race([urlPromise, sleep(120000).then(()=>{throw new Error('Timed out')})]);
    console.log(`[FlowProxy:BROWSER] ✅ Image: ${imageUrl}`);
    return { success:true, output_url:imageUrl, metadata:{projectId} };
  } finally {
    await genPage.close().catch(() => {});
    await imgRelease(); // return slot to pool
    console.log(`[FlowProxy:BROWSER] Pool slot ${imgSlot} released`);
  }
}
// ── VIDEO generation ──────────────────────────────────────────
// Uses the SAME intercept approach as image generation.
// Forces video mode by manipulating the URL hash/localStorage before typing.
// Then intercepts batchGenerateVideos response — no direct API calls needed.
async function browserGenerateVideo(prompt, options = {}) {
  if (!_initDone) await browserInit();
  console.log(`[FlowProxy:BROWSER] Generating VIDEO: "${prompt}"`);
  // Per-user rate limiter for video
  const vidUserId = options?.userId || null;
  const vidNow    = Date.now();
  const vidLast   = vidUserId ? (userLastGenTime.get(`vid_${vidUserId}`) || 0) : 0;
  const vidGap    = vidNow - vidLast;
  if (vidGap < MIN_GAP_MS) {
    const wait = MIN_GAP_MS - vidGap;
    console.log(`[FlowProxy:BROWSER] User ${vidUserId} rate gap: waiting ${wait}ms`);
    await sleep(wait);
  }
  if (vidUserId) userLastGenTime.set(`vid_${vidUserId}`, Date.now());

  // Phase 3: acquire isolated context from pool
  const { context: vidCtx, slotId: vidSlot, release: vidRelease } =
    await browserPool.acquire({
      jobId:         options?.jobId  || `vid-${Date.now()}`,
      userId:        vidUserId,
      sessionCookie: FLOW_SESSION_COOKIE,
    });
  console.log(`[FlowProxy:BROWSER] Pool slot ${vidSlot} acquired for video job`);
  const genPage = await vidCtx.newPage();
  try {
    // Step 1: Create/reuse project
    const projectId = await createProject(genPage, vidUserId);

    // Step 2: Intercept video API calls
    // PRIMARY: catch batchAsyncGenerateVideoText POST → get mediaId
    // SECONDARY: catch Flow's own GET polls → discover the actual poll URL
    let resolveMediaInfo, rejectMediaInfo;
    const mediaPromise = new Promise((res, rej) => { resolveMediaInfo = res; rejectMediaInfo = rej; });

    let discoveredPollUrl   = null; // Flow's own polling URL once detected
    let generationTriggered = false; // set to true after Enter/send button pressed

    // Intercept Flow's own GET requests to discover the poll URL
    genPage.on('request', (request) => {
      const url = request.url();
      if (request.method() !== 'GET') return;
      if (!url.includes('aisandbox') && !url.includes('googleapis')) return;
      // Log all GET requests to aisandbox after generation starts
      if (url.includes('flowMedia') || url.includes('workflows') ||
          url.includes('operations') || url.includes('video/')) {
        console.log(`[FlowProxy:BROWSER] Flow GET poll detected: ${url.replace('https://aisandbox-pa.googleapis.com/v1','')}`);
        if (!discoveredPollUrl) discoveredPollUrl = url;
      }
    });

    genPage.on('response', async (response) => {
      const respUrl = response.url();
      const method  = response.request().method();

      // Also intercept Flow's GET poll responses to get the video URL directly
      if (method === 'GET' && respUrl.includes('aisandbox') &&
          (respUrl.includes('flowMedia') || respUrl.includes('workflows'))) {
        try {
          const body = await response.json().catch(() => ({}));
          const state = body?.mediaMetadata?.state || body?.metadata?.state || body?.state;
          if (state) console.log(`[FlowProxy:BROWSER] Flow's own poll: ${state} — ${respUrl.split('/').slice(-2).join('/')}`);
          // If Flow's poll shows video URL, grab it
          const vUrl = body?.video?.generatedVideo?.fifeUrl || body?.media?.[0]?.video?.generatedVideo?.fifeUrl;
          if (vUrl && !resolveMediaInfo._called) {
            console.log(`[FlowProxy:BROWSER] ✅ Captured from Flow's own poll: ${vUrl}`);
          }
        } catch {}
      }

      if (method !== 'POST') return;

      // DEBUG: Log ALL POST requests to aisandbox so we can see which endpoint fires
      if (respUrl.includes('aisandbox') || respUrl.includes('googleapis')) {
        console.log(`[FlowProxy:BROWSER] POST intercepted: ${respUrl.split('/').slice(-2).join('/')} → ${response.status()}`);
      }

      // THE FIX: Only match real aisandbox video API endpoints.
      // EXCLUDE Google Analytics collect URLs which contain "video" in query params
      // but are NOT the generation API. GA URLs look like:
      //   https://*.google-analytics.com/g/collect?...media_generation_type=video...
      // Real video API:
      //   https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText
      //   https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus
      //   https://<projectId>/flowMedia:batchGenerateVideos

      // Step 1: Must be from aisandbox or labs.google API (not GA analytics)
      const isRealApi = respUrl.includes('aisandbox-pa.googleapis.com') ||
                        (respUrl.includes('labs.google') && !respUrl.includes('collect?'));
      if (!isRealApi) return;

      // Step 2: Must contain a video generation endpoint keyword in the URL PATH
      //         (not just anywhere in query params)
      const urlPath = respUrl.split('?')[0]; // strip query string
      const isTriggerEndpoint = urlPath.includes('batchAsyncGenerateVideoText') ||
                               urlPath.includes('batchGenerateVideos')        ||
                               urlPath.includes('generateVideos')             ||
                               urlPath.includes('AsyncGenerate');
      const isStatusEndpoint  = urlPath.includes('batchCheckAsyncVideo')     ||
                                urlPath.includes('batchCheckAsync');
      const isVideoPath       = urlPath.includes('/video:') || urlPath.includes('/video/');
      if (!isTriggerEndpoint && !isStatusEndpoint && !isVideoPath) return;

      try {
        const status = response.status();
        const body   = await response.json().catch(() => ({}));
        console.log(`[FlowProxy:BROWSER] Video API intercepted → ${status}`);
        console.log(`[FlowProxy:BROWSER] Endpoint: ${urlPath.split('/').pop()}`);
        console.log(`[FlowProxy:BROWSER] Body: ${JSON.stringify(body).slice(0,300)}`);
        // Only reject on server errors (5xx), not on 204 or other 2xx
        if (status >= 400) { rejectMediaInfo(new Error(`API ${status}: ${JSON.stringify(body).slice(0,200)}`)); return; }
        if (status !== 200) return; // 204/202/etc = ignore, keep waiting

        // Extract mediaId and projectId for polling
        const mediaId    = body?.operations?.[0]?.operation?.name ||
                           body?.media?.[0]?.name;
        const projectId  = body?.media?.[0]?.projectId ||
                           body?.workflows?.[0]?.projectId;
        const workflowId = body?.workflows?.[0]?.name;

        // Check if URL is already present (synchronous endpoint)
        const directUrl = body?.media?.[0]?.video?.generatedVideo?.fifeUrl ||
                          body?.media?.[0]?.video?.generatedVideo?.gcsUri;

        if (directUrl) {
          console.log('[FlowProxy:BROWSER] Direct video URL in response!');
          resolveMediaInfo({ type: 'direct', url: directUrl });
          return;
        }

        // For the TRIGGER endpoint: always resolve (this is our generation starting)
        // For batchCheckAsyncVideoGenerationStatus: only resolve AFTER Enter was pressed
        // to avoid capturing stale status checks from previous sessions on page load
        const isTriggerUrl = urlPath.includes('batchAsyncGenerateVideoText') ||
                             urlPath.includes('batchGenerateVideos')         ||
                             urlPath.includes('generateVideos');
        const isStatusCheckUrl = urlPath.includes('batchCheckAsyncVideo');

        if (isStatusCheckUrl && !generationTriggered) {
          console.log(`[FlowProxy:BROWSER] Ignoring pre-trigger status check: ${urlPath.split('/').pop()}`);
          return; // stale status from page load — ignore
        }

        // Track remaining credits for monitoring
        const credits = body?.remainingCredits;
        if (typeof credits === 'number') {
          creditMonitor.update(credits);
        }

        if (mediaId) {
          console.log(`[FlowProxy:BROWSER] Async job: mediaId=${mediaId} projectId=${projectId} workflowId=${workflowId}`);
          resolveMediaInfo({ type: 'async', mediaId, projectId, workflowId });
          return;
        }
        console.log('[FlowProxy:BROWSER] FULL RESPONSE:', JSON.stringify(body));
        rejectMediaInfo(new Error('No mediaId or URL in video response'));
      } catch(e) { rejectMediaInfo(e); }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Step 3: Navigate directly to project page
    //
    // IMPORTANT: No gallery warm-up for video.
    // Reason: a fresh isolated pool context navigating to the gallery first
    //         consistently times out (30s+) because it has no cached resources.
    //         Image generation proves that going DIRECTLY to /project/UUID works
    //         without any warm-up — the SPA routes fine from a cold context.
    //
    // The gallery root (/fx/tools/flow) shows a media GRID with no prompt bar.
    // The project page (/project/UUID) always has the contenteditable input.
    // ─────────────────────────────────────────────────────────────────────────
    const projectUrl = `${FLOW_URL}/project/${projectId}`;
    console.log(`[FlowProxy:BROWSER] Navigating to project page: ${projectId}`);
    await genPage.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await genPage.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    // Session check
    const vidProjUrl = genPage.url();
    if (vidProjUrl.includes('accounts.google.com')) {
      _initDone = false;
      throw new Error('Session cookie expired — run: node scripts/captureSession.js then restart npm start');
    }
    console.log(`[FlowProxy:BROWSER] Project page loaded: ${vidProjUrl}`);

    await dismissPopups(genPage);
    await sleep(2000);

    // Step 3c: Wait for prompt input (project page always has this)
    let promptBarReady = false;
    for (const sel of ['[contenteditable="true"]', 'textarea', '[role="textbox"]']) {
      try {
        await genPage.waitForSelector(sel, { state: 'visible', timeout: 12000 });
        console.log(`[FlowProxy:BROWSER] ✅ Prompt bar ready (${sel})`);
        promptBarReady = true;
        break;
      } catch {}
    }

    // Step 3d: If project page blank, clear stale project and retry
    if (!promptBarReady) {
      const btnCount = await genPage.evaluate(() =>
        document.querySelectorAll('button, [role="button"]').length
      ).catch(() => 0);
      console.warn(`[FlowProxy:BROWSER] ⚠️ Prompt bar not found (${btnCount} buttons) — clearing stale project`);

      if (vidUserId) {
        try { const { clearUserProject } = require('../db'); clearUserProject(vidUserId); } catch {}
      }

      // Retry: create a NEW project (stale cached ID was the cause)
      const { clearUserProject } = require('../db');
      if (vidUserId) clearUserProject(vidUserId);
      const freshProjectId = await createProject(genPage, vidUserId);
      const freshUrl = `${FLOW_URL}/project/${freshProjectId}`;
      console.log(`[FlowProxy:BROWSER] Retrying with fresh project: ${freshProjectId}`);
      await genPage.goto(freshUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await genPage.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await dismissPopups(genPage);
      await sleep(2000);

      for (const sel of ['[contenteditable="true"]', 'textarea', '[role="textbox"]']) {
        try {
          await genPage.waitForSelector(sel, { state: 'visible', timeout: 12000 });
          console.log(`[FlowProxy:BROWSER] ✅ Fresh project prompt bar ready (${sel})`);
          promptBarReady = true;
          break;
        } catch {}
      }

      if (!promptBarReady) {
        throw new Error('Prompt bar not found — run: node scripts/captureSession.js then restart npm start');
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 4: Switch to Video mode
    // ─────────────────────────────────────────────────────────────────────────

    // Step 4a: Dump toolbar buttons for diagnostics
    const vidBtnsInfo = await genPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
      return btns.filter(b => { const r=b.getBoundingClientRect(); return r.width>0&&r.height>0; })
        .map((b,i) => ({ i, text: (b.innerText||'').trim().slice(0,40), rect: { x:Math.round(b.getBoundingClientRect().x), y:Math.round(b.getBoundingClientRect().y), w:Math.round(b.getBoundingClientRect().width), h:Math.round(b.getBoundingClientRect().height) } }));
    }).catch(() => []);
    console.log(`[FlowProxy:BROWSER] Gallery buttons (${vidBtnsInfo.length}):`, JSON.stringify(vidBtnsInfo.slice(0, 20)));

    // Step 4b: Detect current mode from pill (second-to-last toolbar button)
    const vidModeDetect = await genPage.evaluate(() => {
      const input = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
      if (!input) return { mode: 'unknown', pillText: '', coords: null };
      const inputRect = input.getBoundingClientRect();
      const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
      const toolbarBtns = allBtns
        .filter(b => { const r=b.getBoundingClientRect(); return r.width>15&&r.height>15&&Math.abs((r.top+r.height/2)-(inputRect.top+inputRect.height/2))<80; })
        .sort((a,b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      const pill = toolbarBtns.length >= 2 ? toolbarBtns[toolbarBtns.length-2] : toolbarBtns[0];
      const pillText = (pill?.innerText||pill?.getAttribute('aria-label')||'').toLowerCase();
      const pillRect = pill?.getBoundingClientRect();
      let mode = 'unknown';
      const fw = pillText.split('\n')[0].trim();
      if (fw === 'video' || fw.includes('videocam') || fw.includes('video_cam')) mode='video';
      else if (pillText.includes('crop_') || pillText.includes('panorama')) mode='image';
      return { mode, pillText: pillText.slice(0,60), coords: pillRect ? {x:pillRect.x+pillRect.width/2, y:pillRect.y+pillRect.height/2} : null, toolbarCount: toolbarBtns.length };
    }).catch(() => ({ mode:'unknown', pillText:'', coords:null }));

    console.log(`[FlowProxy:BROWSER] Mode detect: mode="${vidModeDetect.mode}" pill="${vidModeDetect.pillText}" toolbar=${vidModeDetect.toolbarCount}`);

    if (vidModeDetect.mode === 'video') {
      console.log('[FlowProxy:BROWSER] ✅ Already in video mode on gallery');
    } else {
      console.log('[FlowProxy:BROWSER] Switching to video mode...');

      // Step 4c: Click the pill using Playwright mouse (React-safe)
      let pillClicked = false;

      // Use coords from detection if available
      if (vidModeDetect.coords) {
        await genPage.mouse.click(vidModeDetect.coords.x, vidModeDetect.coords.y);
        pillClicked = true;
        console.log(`[FlowProxy:BROWSER] Pill clicked at (${Math.round(vidModeDetect.coords.x)}, ${Math.round(vidModeDetect.coords.y)})`);
        await sleep(1200);
      } else {
        // Fallback: try named selectors
        for (const sel of ['button:has-text("Nano")', 'button:has-text("Flow")', 'button:has-text("Imagen")', 'button:has-text("Gemini")', '[aria-label*="model" i]']) {
          try {
            const el = await genPage.$(sel);
            if (el && await el.isVisible().catch(()=>false)) {
              const box = await el.boundingBox().catch(()=>null);
              if (box) { await genPage.mouse.click(box.x+box.width/2, box.y+box.height/2); }
              else { await el.click({force:true}); }
              pillClicked = true;
              console.log(`[FlowProxy:BROWSER] Pill clicked via selector: ${sel}`);
              await sleep(1200);
              break;
            }
          } catch {}
        }
      }

      if (!pillClicked) {
        console.warn('[FlowProxy:BROWSER] ⚠️ Could not click pill');
      }

      // Step 4d: Click the "Video" tab — only non-sidebar, non-toolbar buttons
      // CRITICAL: sidebar buttons are at x<=60 (left nav). Exclude them.
      // Popup buttons appear above the toolbar (y < toolbar_y - 20).
      await sleep(600);
      const videoTabResult = await genPage.evaluate(() => {
        const allBtns = Array.from(document.querySelectorAll('button, [role="button"], [role="tab"], [role="option"]'));
        const candidates = allBtns.filter(b => {
          const r = b.getBoundingClientRect();
          const t = (b.innerText||b.getAttribute('aria-label')||b.textContent||'').toLowerCase().trim();
          if (!t.includes('video')) return false;
          if (r.x <= 60) return false;   // exclude sidebar (x≤60)
          if (r.y > 680) return false;   // exclude toolbar area (y>680)
          if (r.width < 10 || r.height < 10) return false;
          return true;
        });
        console.log('[VideoTab] Non-sidebar candidates:', JSON.stringify(
          candidates.map(b => ({
            text: (b.innerText||b.textContent||'').trim().slice(0,40),
            x: Math.round(b.getBoundingClientRect().x),
            y: Math.round(b.getBoundingClientRect().y),
          }))
        ));
        if (candidates.length > 0) {
          const btn = candidates[0];
          const r = btn.getBoundingClientRect();
          return { clicked: true, x: r.x+r.width/2, y: r.y+r.height/2, text: (btn.innerText||btn.textContent||'').trim().slice(0,40) };
        }
        return { clicked: false };
      }).catch(() => ({ clicked: false }));

      if (videoTabResult.clicked && videoTabResult.x) {
        await genPage.mouse.click(videoTabResult.x, videoTabResult.y);
        console.log(`[FlowProxy:BROWSER] ✅ Video tab clicked: "${videoTabResult.text}" at (${Math.round(videoTabResult.x)},${Math.round(videoTabResult.y)})`);
        await sleep(800);
      } else {
        console.warn('[FlowProxy:BROWSER] ⚠️ Video tab not found in popup');
      }

      // Step 4e: Select x1 (single output)
      try {
        await genPage.waitForSelector('button:has-text("x1")', { state:'visible', timeout:2500 });
        const x1Btns = await genPage.$$('button:has-text("x1")');
        for (const btn of x1Btns) {
          if (await btn.isVisible().catch(()=>false)) {
            const box = await btn.boundingBox().catch(()=>null);
            if (box) await genPage.mouse.click(box.x+box.width/2, box.y+box.height/2);
            else await btn.click({force:true});
            console.log('[FlowProxy:BROWSER] ✅ x1 selected');
            await sleep(400);
            break;
          }
        }
      } catch { console.log('[FlowProxy:BROWSER] x1 not found'); }

      // Step 4f: Close popup
      // Do NOT press Escape — it cancels mode selection in some React versions.
      // Click the pill button again to toggle the popup closed (confirms selection).
      // Then wait for React state to fully commit the mode change.
      try {
        // Click the pill coords again to close popup (pill is a toggle)
        if (vidModeDetect.coords) {
          await genPage.mouse.click(vidModeDetect.coords.x, vidModeDetect.coords.y);
          await sleep(600);
        } else {
          // Fallback: click empty canvas area well away from all controls
          await genPage.mouse.click(640, 400);
          await sleep(600);
        }
      } catch {}

      // Give React 2 seconds to commit the mode state change
      await sleep(2000);
    }

    // Step 4g: Confirm mode via pill
    const vidModeConfirm = await genPage.evaluate(() => {
      const input = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
      if (!input) return { videoActive:false, pillText:'no input' };
      const inputRect = input.getBoundingClientRect();
      const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
      const toolbarBtns = allBtns
        .filter(b=>{const r=b.getBoundingClientRect();return r.width>15&&r.height>15&&Math.abs((r.top+r.height/2)-(inputRect.top+inputRect.height/2))<80;})
        .sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left);
      const pill = toolbarBtns.length>=2 ? toolbarBtns[toolbarBtns.length-2] : toolbarBtns[0];
      const pillText = (pill?.innerText||'').toLowerCase();
      const firstPillWord = pillText.split('\n')[0].trim();
      const videoActive = firstPillWord === 'video' || firstPillWord.includes('videocam') || firstPillWord.includes('video_cam');
      return { videoActive, pillText: pillText.slice(0, 60), firstWord: firstPillWord };
    }).catch(()=>({videoActive:false, pillText:'eval error'}));

    console.log(`[FlowProxy:BROWSER] Mode confirm: videoActive=${vidModeConfirm.videoActive} pill="${vidModeConfirm.pillText}"`);

    // ── Bug fix: Google sometimes shows "swap" sub-mode after clicking Video ──
    // If we ended up in swap mode, try clicking the pill again to cycle back
    // to the standard video generation mode.
    const pillLow = (vidModeConfirm.pillText || '').toLowerCase();
    if (!vidModeConfirm.videoActive && (pillLow.includes('swap') || pillLow.includes('horiz'))) {
      console.warn('[FlowProxy:BROWSER] ⚠️ Landed in swap mode — clicking pill to cycle to video mode');
      try {
        // Click the pill to open the selector again
        if (vidModeDetect.coords) {
          await genPage.mouse.click(vidModeDetect.coords.x, vidModeDetect.coords.y);
          await sleep(700);
        }
        // Now look for any button with "video" text that is NOT swap
        const videoGenBtn = await genPage.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
          for (const b of btns) {
            const txt = (b.innerText || b.textContent || '').toLowerCase();
            if (txt.includes('video') && !txt.includes('swap') && !txt.includes('scenebuilder')) {
              const r = b.getBoundingClientRect();
              if (r.width > 20 && r.height > 20) {
                return { x: r.x + r.width/2, y: r.y + r.height/2, text: txt.slice(0, 40) };
              }
            }
          }
          return null;
        });
        if (videoGenBtn) {
          await genPage.mouse.click(videoGenBtn.x, videoGenBtn.y);
          console.log(`[FlowProxy:BROWSER] Clicked video button: "${videoGenBtn.text}"`);
          await sleep(1500);
        }
      } catch (e) {
        console.warn('[FlowProxy:BROWSER] Swap mode recovery failed:', e.message);
      }
    }

    // ── Proceed regardless of strict videoActive check ─────────────────────────
    // Even if mode confirm is uncertain, attempt generation — the interceptor
    // will catch the API call. If truly wrong mode, Google returns no video job.

        // ─────────────────────────────────────────────────────────────────────────
    // Step 5: Type the prompt
    // ─────────────────────────────────────────────────────────────────────────
    await sleep(800);

    // Wait for input to be available (React may still be updating after mode switch)
    let inputEl = null;
    const inputSelectors = ['[contenteditable="true"]', 'textarea', '[role="textbox"]'];

    for (const sel of inputSelectors) {
      try {
        await genPage.waitForSelector(sel, { state: 'visible', timeout: 8000 });
        const el = await genPage.$(sel);
        if (el && await el.isVisible().catch(() => false)) {
          await el.click();
          await sleep(400);
          // Clear existing text
          await genPage.keyboard.press('Control+A');
          await sleep(100);
          await genPage.keyboard.press('Delete');
          await sleep(200);
          // Type the prompt
          await el.type(prompt, { delay: 35 });
          await sleep(600);
          const typed = await el.evaluate(e => e.innerText || e.value || '').catch(() => '');
          console.log(`[FlowProxy:BROWSER] Video prompt typed: "${typed.slice(0, 50)}"`);
          inputEl = el;
          break;
        }
      } catch(e) {
        console.warn(`[FlowProxy:BROWSER] Input selector "${sel}" failed: ${e.message}`);
      }
    }

    if (!inputEl) throw new Error('Video prompt input not found — check Flow UI selectors');

    await genPage.evaluate(() => {
      const el = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
      if (el) { el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
    });
    await sleep(800);

    // Step 7: Trigger video generation
    //
    // ROOT CAUSE (confirmed from logs):
    //   When text is typed in the input, a "Clear prompt" (×) button appears.
    //   It becomes the RIGHTMOST toolbar button, so our "find rightmost = send" logic
    //   was clicking "Clear prompt" instead of the generate arrow.
    //   Log evidence: "Clicking send button at (919,641) text='close\nClear prompt'"
    //
    // THE FIX:
    //   PRIMARY: keyboard.press('Enter') on focused input — no button detection needed.
    //   Mode is confirmed video=true, so Enter fires batchAsyncGenerateVideoText.
    //   This matches how a human generates: focus input → type → press Enter.
    //
    //   FALLBACK: find the GENERATE button by excluding "clear"/"close" buttons.
    //   The generate button has aria-label "Create" or "arrow_forward" icon text.
    console.log('[FlowProxy:BROWSER] Triggering video generation...');

    // Focus the input so Enter key goes to it
    try {
      await inputEl.click();
      await sleep(300);
    } catch {}

    let triggered = false;

    // PRIMARY: Enter key on focused input (simplest, most reliable, no button detection)
    try {
      await genPage.keyboard.press('Enter');
      triggered = true;
      generationTriggered = true; // now accept batchCheckAsyncVideoGenerationStatus responses
      console.log('[FlowProxy:BROWSER] ✅ Enter key pressed on focused input');
      await sleep(500);
    } catch(e) {
      console.log('[FlowProxy:BROWSER] Enter key failed:', e.message);
    }

    // FALLBACK: find the actual generate/arrow button, explicitly skip "clear" buttons
    if (!triggered) {
      const generateBtnCoords = await genPage.evaluate(() => {
        const input = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
        if (!input) return null;
        const inputRect = input.getBoundingClientRect();
        const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));

        // Filter to toolbar buttons near the input
        const toolbarBtns = allBtns
          .filter(b => {
            const r = b.getBoundingClientRect();
            return r.width > 15 && r.height > 15
                && Math.abs((r.top + r.height/2) - (inputRect.top + inputRect.height/2)) < 80;
          })
          .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

        // EXCLUDE "clear" / "close" buttons — they appear when text is typed
        const generateBtn = [...toolbarBtns].reverse().find(b => {
          const text = (b.innerText || b.getAttribute('aria-label') || '').toLowerCase();
          return !text.includes('clear') && !text.includes('close') && !text.includes('delete');
        });

        if (!generateBtn) return null;
        const r = generateBtn.getBoundingClientRect();
        const btnText = generateBtn.innerText?.trim().slice(0, 40);
        const aria = generateBtn.getAttribute('aria-label');
        return { x: r.x + r.width/2, y: r.y + r.height/2, text: btnText, aria };
      }).catch(() => null);

      if (generateBtnCoords) {
        try {
          console.log(`[FlowProxy:BROWSER] Fallback: clicking generate button at (${Math.round(generateBtnCoords.x)},${Math.round(generateBtnCoords.y)}) aria="${generateBtnCoords.aria}" text="${generateBtnCoords.text}"`);
          // Re-focus input first, then click the button
          await inputEl.click();
          await sleep(200);
          await genPage.mouse.click(generateBtnCoords.x, generateBtnCoords.y);
          triggered = true;
          generationTriggered = true;
          console.log('[FlowProxy:BROWSER] ✅ Generate button mouse.click fired');
        } catch(e) {
          console.log('[FlowProxy:BROWSER] Generate button click failed:', e.message);
        }
      } else {
        console.warn('[FlowProxy:BROWSER] ⚠️ No generate button found — generation may not trigger');
      }
    }


    // Step 8: Wait for async job to start — with retry trigger at 30s
    console.log('[FlowProxy:BROWSER] Waiting for video job to start...');

    // After 30s with no response, retry via send button then Enter
    const retryTimer = setTimeout(async () => {
      console.log('[FlowProxy:BROWSER] No response after 30s — retrying...');
      try {
        const el = await genPage.$('[contenteditable="true"]') || await genPage.$('textarea');
        if (el) {
          // Primary retry: Enter key (avoids clear button detection bug)
          await el.click(); await sleep(300);
          await genPage.keyboard.press('Enter');
          console.log('[FlowProxy:BROWSER] Retry Enter key pressed');
        }
      } catch(e) { console.log('[FlowProxy:BROWSER] Retry failed:', e.message); }
    }, 30000);

    const mediaInfo = await Promise.race([
      mediaPromise.then(r => { clearTimeout(retryTimer); return r; }),
      sleep(90000).then(() => { clearTimeout(retryTimer); throw new Error('Video job did not start within 90s'); }),
    ]);

    if (mediaInfo.type === 'direct') {
      console.log(`[FlowProxy:BROWSER] ✅ Video (direct): ${mediaInfo.url}`);
      return { success: true, output_url: mediaInfo.url, metadata: { projectId } };
    }

    // Step 9: Poll using batchCheckAsyncVideoGenerationStatus (POST, not GET)
    // Discovered from network capture — Flow polls with POST, returns video when done
    const { mediaId, projectId: vidProjectId, workflowId } = mediaInfo;
    const pollProjectId = vidProjectId || projectId;
    console.log(`[FlowProxy:BROWSER] Polling: mediaId=${mediaId} project=${pollProjectId}`);

    // Get access_token once before polling
    const tokenResult = await genPage.evaluate(async () => {
      try {
        const r = await fetch('https://labs.google/fx/api/auth/session', { credentials: 'include' });
        const d = await r.json();
        return { token: d?.access_token };
      } catch(e) { return { error: e.message }; }
    });
    const accessToken = tokenResult?.token;
    console.log(accessToken ? '[FlowProxy:BROWSER] Got access_token' : '[FlowProxy:BROWSER] No access_token');

    const https  = require('https');
    const pollEndpoint = `${AISANDBOX_BASE}/video:batchCheckAsyncVideoGenerationStatus`;
    // Correct body structure — uses operation.name (the mediaId)
    // NOT { mediaId, projectId } — those fields don't exist in this endpoint
    const pollBody = JSON.stringify({
      operations: [{ operation: { name: mediaId } }],
    });

    function httpsPost(url, headers, body) {
      return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = https.request({
          hostname: parsed.hostname,
          path:     parsed.pathname + parsed.search,
          method:   'POST',
          headers:  { ...headers, 'Content-Length': Buffer.byteLength(body) },
        }, res => {
          let data = '';
          res.on('data', c => { data += c; });
          res.on('end', () => {
            try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
            catch(e) { resolve({ status: res.statusCode, data: {}, raw: data.slice(0,300) }); }
          });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
      });
    }

    const pollHeaders = {
      'Content-Type': 'application/json',
      'x-goog-api-key': AISANDBOX_API_KEY,
      'Referer': 'https://labs.google/',      // required — API key is referrer-restricted
      'Origin': 'https://labs.google',
    };
    if (accessToken) pollHeaders['Authorization'] = `Bearer ${accessToken}`;

    const deadline = Date.now() + 600000; // 10 minutes
    let videoUrl = null;
    let pollCount = 0;

    while (Date.now() < deadline) {
      await sleep(5000);
      pollCount++;
      try {
        const pr = await httpsPost(pollEndpoint, pollHeaders, pollBody);
        const elapsed = Math.round((Date.now() - (deadline - 600000)) / 1000);

        // Log full response on first poll for debugging
        if (pollCount === 1) {
          console.log(`[FlowProxy:BROWSER] Poll #1 response (${pr.status}): ${JSON.stringify(pr.data).slice(0,500)}`);
        }

        if (pr.status !== 200) {
          console.log(`[FlowProxy:BROWSER] Poll error body: ${JSON.stringify(pr.data).slice(0,200)}`);
          continue;
        }

        // Response structure: { operations: [{ operation: { name, metadata: { video: { generatedVideo } } }, status }] }
        const op       = pr.data?.operations?.[0];
        const opMeta   = op?.operation?.metadata;
        const state    = op?.status || '?';
        const elapsed2 = Math.round((Date.now() - (deadline - 600000)) / 1000);
        console.log(`[FlowProxy:BROWSER] Poll #${pollCount} (${elapsed2}s): ${state} [HTTP ${pr.status}]`);

        // Extract video URL from the operation metadata
        videoUrl =
          opMeta?.video?.generatedVideo?.fifeUrl  ||
          opMeta?.video?.generatedVideo?.gcsUri   ||
          opMeta?.video?.generatedVideo?.videoUrl ||
          opMeta?.generatedVideo?.fifeUrl         ||
          pr.data?.operations?.[0]?.operation?.metadata?.video?.fifeUrl;

        if (videoUrl) {
          console.log(`[FlowProxy:BROWSER] ✅ Video URL found at poll #${pollCount}: ${videoUrl.slice(0,80)}`);
          break;
        }

        // Also log if done but no URL found
        if (state === 'MEDIA_GENERATION_STATUS_SUCCEEDED' && !videoUrl) {
          console.log('[FlowProxy:BROWSER] SUCCEEDED but no URL — full op:', JSON.stringify(op).slice(0,600));
        }
        if (state && (state.includes('FAIL') || state.includes('ERROR'))) {
          throw new Error(`Video generation failed: ${state}`);
        }
      } catch(e) {
        if (e.message.includes('Video generation failed')) throw e;
        console.log(`[FlowProxy:BROWSER] Poll #${pollCount} error: ${e.message}`);
      }
    }

    if (!videoUrl) throw new Error('Video did not complete within 10 minutes');
        console.log(`[FlowProxy:BROWSER] ✅ Video: ${videoUrl}`);
    return { success: true, output_url: videoUrl, metadata: { projectId } };

  } finally {
    await genPage.close().catch(() => {});
    await vidRelease(); // return slot to pool
    console.log(`[FlowProxy:BROWSER] Pool slot ${vidSlot} released`);
  }
}

// ── Keep-alive ────────────────────────────────────────────────
async function browserKeepAlive() {
  if (!_initDone) return false;
  try {
    // Use the warmPage for keepalive ping — it stays open between generations
    if (warmPage) {
      await warmPage.goto('https://labs.google/fx/api/auth/session', {
        waitUntil: 'domcontentloaded', timeout: 10000
      });
      const text = await warmPage.evaluate(() => document.body.innerText).catch(() => '{}');
      const data = JSON.parse(text);
      if (data?.user?.email) {
        console.log(`[FlowProxy:BROWSER] Session alive — ${data.user.email}`);
        return true;
      }
      // Session genuinely expired — cannot auto-fix, needs captureSession.js
      console.error('[FlowProxy:BROWSER] ❌ Keep-alive: session expired');
      console.error('[FlowProxy:BROWSER] Run: node scripts/captureSession.js');
      _initDone = false;
      return false;
    }
    return _initDone;
  } catch(e) {
    console.error('[FlowProxy:BROWSER] Keep-alive error:', e.message);
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────
async function generateImage(prompt, options = {}) {
  if (FLOW_MODE === 'browser') return browserGenerateImage(prompt, options);
  return mockImage(prompt);
}
async function generateVideo(prompt, options = {}) {
  if (FLOW_MODE === 'browser') return browserGenerateVideo(prompt, options);
  return mockVideo(prompt);
}
async function keepAlive() {
  if (FLOW_MODE === 'browser') return browserKeepAlive();
  console.log('[FlowProxy:MOCK] Keep-alive (no-op)'); return true;
}
async function init() {
  console.log(`[FlowProxy] Mode: ${FLOW_MODE.toUpperCase()}`);
  if (FLOW_MODE === 'browser') await browserInit();
  else console.log('[FlowProxy:MOCK] Ready');
}
async function destroy() {
  _initDone = false;
  if (warmPage) { try { await warmPage.close(); } catch {} warmPage = null; }
  await browserPool.destroyPool(); // closes all pool contexts
  if (browser) { await browser.close().catch(() => {}); browser = null; bContext = null; }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
// ── Browser crash recovery ────────────────────────────────────────────────────
// On server, Chrome can crash or become unresponsive under load.
// Detect disconnection and automatically reinitialise.
function setupCrashRecovery() {
  if (!browser) return;
  browser.on('disconnected', async () => {
    console.error('[FlowProxy:BROWSER] ⚠️ Browser disconnected unexpectedly — reinitialising in 3s...');
    sysLogger.error('flowProxy', 'Browser disconnected — will auto-reinitialise', {});
    _initDone = false;
    browser   = null;
    bContext  = null;
    warmPage  = null;
    await browserPool.destroyPool().catch(() => {});

    // Wait then re-init so in-flight jobs can drain first
    await sleep(3000);
    browserInit().catch(err => {
      console.error('[FlowProxy:BROWSER] ❌ Auto-reinitialise failed:', err.message);
      sysLogger.error('flowProxy', 'Auto-reinitialise failed', { error: err.message });
    });
  });
}

module.exports = {
  init:          browserInit,
  generateImage,
  generateVideo,
  keepAlive:     browserKeepAlive,
  destroy,
  getPoolStatus: () => browserPool.getPoolStatus(),
  getCredits:    () => creditMonitor.toJSON(),
};
