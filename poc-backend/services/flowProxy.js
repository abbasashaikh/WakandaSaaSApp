// services/flowProxy.js — CLEAN FINAL
// Image: intercept batchGenerateImages (working ✅)
// Video: intercept batchGenerateVideos using page.evaluate direct API call
//        from GALLERY page (stable context, not project page)
require('dotenv').config();

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

let browser         = null;
let bContext        = null;
let ready           = false;
let cachedProjectId = null;   // reuse same project
let warmPage        = null;   // persistent warm page on labs.google
let lastGenTime     = 0;      // timestamp of last generation (rate limiter)
const MIN_GAP_MS    = 5000;   // minimum 5s between generations

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
    const clicked = await page.evaluate(() => {
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

async function browserInit() {
  if (ready && bContext) { console.log('[FlowProxy:BROWSER] Already ready'); return; }
  if (!FLOW_SESSION_COOKIE || FLOW_SESSION_COOKIE.length < 100) {
    throw new Error('FLOW_SESSION_COOKIE not set. Run: npm run capture');
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

  browser = await stealthChromium.launch({
    headless: false,
    executablePath: realExe || undefined,
    args: [
      '--no-sandbox',
      '--window-size=1280,800',
      '--window-position=100,100',
      '--no-first-run',
      // DO NOT add --disable-blink-features=AutomationControlled here
      // stealth plugin handles it correctly — adding it twice breaks stealth
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  bContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
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
    await browser.close(); browser = null; bContext = null;
    throw new Error(`Cookie rejected. Run: npm run capture\nResponse: ${txt.slice(0,100)}`);
  }
  console.log(`[FlowProxy:BROWSER] ✅ Session: ${sess.user.email}`);
  ready = true;
  console.log('[FlowProxy:BROWSER] ✅ Ready');

  // Warm page: stays on labs.google between generations
  // Keeps reCAPTCHA score high by simulating idle browsing
  warmPage = await bContext.newPage();
  await warmPage.goto('https://labs.google/fx/tools/flow', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await warmPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  console.log('[FlowProxy:BROWSER] ✅ Warm page initialized on labs.google');
}

// ── createProject helper ──────────────────────────────────────
async function createProject(page) {
  // Reuse cached project if available — reduces API calls, lowers reCAPTCHA risk
  if (cachedProjectId) {
    console.log(`[FlowProxy:BROWSER] Reusing cached project: ${cachedProjectId}`);
    return cachedProjectId;
  }
  console.log('[FlowProxy:BROWSER] Navigating to gallery...');
  await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await sleep(2000);
  const url = page.url();
  console.log(`[FlowProxy:BROWSER] Gallery URL: ${url}`);
  if (url.includes('accounts.google.com')) {
    // Session expired — auto-reinit browser with fresh cookies
    console.log('[FlowProxy:BROWSER] Session expired, attempting auto-reinit...');
    ready = false;
    try {
      await browserInit();
      // Retry navigation after reinit
      await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await sleep(2000);
      const retryUrl = page.url();
      if (retryUrl.includes('accounts.google.com')) {
        throw new Error('Session expired — run: npm run capture to refresh cookie');
      }
      console.log('[FlowProxy:BROWSER] Auto-reinit succeeded');
    } catch(e) {
      throw new Error('Session expired — run: npm run capture to refresh cookie');
    }
  }
  if (url.includes('/project/')) {
    await page.goto(FLOW_URL, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    await sleep(1500);
  }
  const result = await page.evaluate(async () => {
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
  if (result.error) throw new Error(`createProject fetch error: ${result.error}`);
  if (result.status !== 200 || !result.projectId) throw new Error(`project.createProject failed (${result.status}): ${result.raw}`);
  console.log(`[FlowProxy:BROWSER] Project: ${result.projectId}`);
  cachedProjectId = result.projectId; // cache for reuse
  return result.projectId;
}

// ── IMAGE generation (intercept approach — proven working) ────
async function browserGenerateImage(prompt, options = {}) {
  if (!ready) await browserInit();
  console.log(`[FlowProxy:BROWSER] Generating: "${prompt}"`);
  // Rate limiter — minimum 5s between generations
  const now = Date.now();
  const gap = now - lastGenTime;
  if (gap < MIN_GAP_MS) {
    const wait = MIN_GAP_MS - gap;
    console.log(`[FlowProxy:BROWSER] Rate limiter: waiting ${wait}ms`);
    await sleep(wait);
  }
  lastGenTime = Date.now();

  // Always use a FRESH page per generation — ensures clean reCAPTCHA token
  // The warm page stays alive separately to keep the browser session warm
  const genPage = await bContext.newPage();
  const usingWarmPage = false;
  try {
    const projectId = await createProject(genPage);

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
        const url = extractImageUrl(body);
        if (url) { resolveUrl(url); }
        else { console.log('[FlowProxy:BROWSER] FULL RESPONSE:', JSON.stringify(body)); rejectUrl(new Error('URL not found')); }
      } catch(e) { rejectUrl(e); }
    });

    const projectUrl = `${FLOW_URL}/project/${projectId}`;
    console.log(`[FlowProxy:BROWSER] Loading project...`);
    await genPage.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await genPage.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await dismissPopups(genPage); // close changelog/update overlay
    await sleep(2000);

    // Human-like behavior: move mouse, slight scroll — helps reCAPTCHA scoring
    await genPage.mouse.move(400 + Math.random()*200, 300 + Math.random()*100);
    await sleep(300 + Math.random()*400);
    await genPage.mouse.move(500 + Math.random()*100, 400 + Math.random()*80);
    await sleep(200 + Math.random()*300);
    await genPage.evaluate(() => window.scrollBy(0, 30 + Math.random()*20));
    await sleep(1500 + Math.random()*1000);

    // Final popup check just before trying to type — dialogs can appear after networkidle
    await dismissPopups(genPage);

    let inputEl = null, inputSel = '';
    for (const sel of ['[contenteditable="true"]', 'textarea', '[role="textbox"]']) {
      try {
        await genPage.waitForSelector(sel, { state: 'visible', timeout: 10000 });
        const el = await genPage.$(sel);
        if (el && await el.isVisible().catch(() => false)) { inputEl = el; inputSel = sel; break; }
      } catch {}
    }
    if (!inputEl) throw new Error('Prompt input not found');
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
  } finally { if (!usingWarmPage) await genPage.close().catch(()=>{}); }
}

// ── VIDEO generation ──────────────────────────────────────────
// Uses the SAME intercept approach as image generation.
// Forces video mode by manipulating the URL hash/localStorage before typing.
// Then intercepts batchGenerateVideos response — no direct API calls needed.
async function browserGenerateVideo(prompt, options = {}) {
  if (!ready) await browserInit();
  console.log(`[FlowProxy:BROWSER] Generating VIDEO: "${prompt}"`);
  // Rate limiter
  const nowV = Date.now();
  const gapV = nowV - lastGenTime;
  if (gapV < MIN_GAP_MS) {
    const wait = MIN_GAP_MS - gapV;
    console.log(`[FlowProxy:BROWSER] Rate limiter: waiting ${wait}ms`);
    await sleep(wait);
  }
  lastGenTime = Date.now();

  // Fresh page per generation — clean reCAPTCHA token each time
  const genPage = await bContext.newPage();
  const usingWarmPage = false;
  try {
    // Step 1: Create/reuse project
    const projectId = await createProject(genPage);

    // Step 2: Intercept video API calls
    // PRIMARY: catch batchAsyncGenerateVideoText POST → get mediaId
    // SECONDARY: catch Flow's own GET polls → discover the actual poll URL
    let resolveMediaInfo, rejectMediaInfo;
    const mediaPromise = new Promise((res, rej) => { resolveMediaInfo = res; rejectMediaInfo = rej; });

    let discoveredPollUrl = null; // Flow's own polling URL once detected

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
      // The real video endpoint from capture analysis
      if (!respUrl.includes('batchAsyncGenerateVideoText') &&
          !respUrl.includes('batchGenerateVideos') &&
          !respUrl.includes('generateVideos')) return;

      try {
        const status = response.status();
        const body   = await response.json().catch(() => ({}));
        console.log(`[FlowProxy:BROWSER] Video API intercepted → ${status}`);
        console.log(`[FlowProxy:BROWSER] Endpoint: ${respUrl.split('/').pop()}`);
        console.log(`[FlowProxy:BROWSER] Body: ${JSON.stringify(body).slice(0,300)}`);
        if (status !== 200) { rejectMediaInfo(new Error(`API ${status}: ${JSON.stringify(body).slice(0,200)}`)); return; }

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
        if (mediaId) {
          console.log(`[FlowProxy:BROWSER] Async job: mediaId=${mediaId} projectId=${projectId} workflowId=${workflowId}`);
          resolveMediaInfo({ type: 'async', mediaId, projectId, workflowId });
          return;
        }
        console.log('[FlowProxy:BROWSER] FULL RESPONSE:', JSON.stringify(body));
        rejectMediaInfo(new Error('No mediaId or URL in video response'));
      } catch(e) { rejectMediaInfo(e); }
    });

    // Step 3: Navigate to project page
    const projectUrl = `${FLOW_URL}/project/${projectId}`;
    console.log('[FlowProxy:BROWSER] Loading project page for video...');
    await genPage.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await genPage.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await dismissPopups(genPage); // close any changelog/update overlay
    await sleep(2000);

    // Step 4: Click the model pill → click "Video" tab → close popup
    // From screenshot analysis:
    // - The pill button shows "Nano Banana 2 □ x2" (current model name)
    // - Clicking it opens a popup with "Image" | "Video" tabs at the top
    // - Clicking "Video" tab switches to video mode
    // - Bottom bar changes to "Video □ x2"
    // - Then Enter fires batchGenerateVideos instead of batchGenerateImages

    console.log('[FlowProxy:BROWSER] Opening model picker...');

    // Step 4a: Find and click the model pill button
    // It contains text like "Nano Banana 2" or "Video" (if already in video mode)
    let pillClicked = false;
    const pillSelectors = [
      // Match the pill by its partial text content
      'button:has-text("Nano Banana")',
      'button:has-text("Nano")',
      'button:has-text("Video □")',
      'button:has-text("Image □")',
      // The pill is the button to the left of the → arrow button
      // Find it by position: rightmost button BEFORE the send arrow
    ];

    for (const sel of pillSelectors) {
      try {
        const el = await genPage.$(sel);
        if (el && await el.isVisible().catch(() => false)) {
          await el.click();
          pillClicked = true;
          console.log(`[FlowProxy:BROWSER] Model pill clicked: ${sel}`);
          await sleep(800);
          break;
        }
      } catch {}
    }

    if (!pillClicked) {
      // Fallback: find by position — pill is second-to-last element in the prompt bar
      pillClicked = await genPage.evaluate(() => {
        const input = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
        if (!input) return false;
        const inputRect = input.getBoundingClientRect();
        // Find all buttons to the RIGHT of the input and above the bottom of screen
        const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
        const rightBtns = allBtns.filter(b => {
          const r = b.getBoundingClientRect();
          return r.left > inputRect.right && r.width > 20 && r.height > 10 && r.top > 0;
        }).sort((a,b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        
        console.log('[Pill] Buttons to right of input:', rightBtns.map(b => ({
          text: b.innerText?.trim().slice(0,30),
          x: Math.round(b.getBoundingClientRect().left)
        })));
        
        // The pill is the FIRST button to the right of input (not the send arrow)
        if (rightBtns.length >= 1) {
          rightBtns[0].click();
          return true;
        }
        return false;
      });
      if (pillClicked) {
        console.log('[FlowProxy:BROWSER] Model pill clicked by position');
        await sleep(800);
      }
    }

    if (!pillClicked) {
      console.log('[FlowProxy:BROWSER] ⚠️ Model pill not found');
    }

    // Step 4b: Click the "Video" tab in the popup
    let videoTabClicked = false;
    const videoTabSelectors = [
      'button:has-text("Video")',
      '[role="tab"]:has-text("Video")',
    ];

    for (const sel of videoTabSelectors) {
      try {
        // Wait briefly for popup to appear
        await genPage.waitForSelector(sel, { state: 'visible', timeout: 3000 });
        const els = await genPage.$$(sel);
        for (const el of els) {
          if (await el.isVisible().catch(() => false)) {
            const text = await el.innerText().catch(() => '');
            // Make sure it's exactly "Video" not something containing "Video"
            if (text.trim() === 'Video' || text.includes('Video')) {
              await el.click();
              videoTabClicked = true;
              console.log('[FlowProxy:BROWSER] ✅ "Video" tab clicked');
              await sleep(600);
              break;
            }
          }
        }
        if (videoTabClicked) break;
      } catch {}
    }

    if (!videoTabClicked) {
      console.log('[FlowProxy:BROWSER] ⚠️ "Video" tab not found in popup');
    }

    // Step 4c: Select x1 (single output) — popup shows x1/x2/x3/x4
    // Default is x2 which wastes double credits. Click x1 first.
    try {
      await genPage.waitForSelector('button:has-text("x1")', { state: 'visible', timeout: 2000 });
      const x1Btns = await genPage.$$('button:has-text("x1")');
      for (const btn of x1Btns) {
        if (await btn.isVisible().catch(() => false)) {
          await btn.click();
          console.log('[FlowProxy:BROWSER] ✅ x1 selected (single output)');
          await sleep(300);
          break;
        }
      }
    } catch { console.log('[FlowProxy:BROWSER] x1 button not found in popup'); }

    // Step 4d: Click outside popup to close it
    await genPage.mouse.click(300, 300); // click empty canvas area
    await sleep(1200); // give React time to commit the mode change

    // Verify video mode is active
    const pillText = await genPage.evaluate(() => {
      // Find all buttons and log their text to find the pill
      const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
      const btnsInfo = allBtns.map(b => b.innerText?.trim().slice(0,40)).filter(Boolean);
      console.log('[PillCheck]', JSON.stringify(btnsInfo));
      // The pill now says "Video □ x2" when video mode is active
      const videoBtn = allBtns.find(b => b.innerText?.includes('Video'));
      return videoBtn?.innerText?.trim() || btnsInfo.join(' | ').slice(0,100);
    });
    console.log(`[FlowProxy:BROWSER] Mode check: "${pillText}"`);
    const isVideoMode = pillText.toLowerCase().includes('video');
    console.log(`[FlowProxy:BROWSER] Video mode active: ${isVideoMode}`);


    // Step 6: Type prompt — ensure popup is fully closed first
    await sleep(1500); // Extra wait for popup to fully dismiss after canvas click
    
    let inputEl = null;
    for (const sel of ['[contenteditable="true"]', 'textarea', '[role="textbox"]']) {
      try {
        const el = await genPage.$(sel);
        if (el && await el.isVisible().catch(() => false)) {
          // Click to focus, then clear any existing text
          await el.click(); await sleep(500);
          await genPage.keyboard.press('Control+A');
          await genPage.keyboard.press('Delete'); // Clear before typing
          await sleep(200);
          await el.type(prompt, { delay: 40 });
          await sleep(800);
          inputEl = el;
          // Verify text was typed
          const typed = await el.evaluate(e => e.innerText || e.value || '');
          console.log(`[FlowProxy:BROWSER] Video prompt typed: "${typed.slice(0,40)}"`);
          break;
        }
      } catch {}
    }
    if (!inputEl) throw new Error('Video prompt input not found');

    await genPage.evaluate(() => {
      const el = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
      if (el) { el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
    });
    await sleep(800);

    // Step 7: Press Enter — if Flow is in video mode, this fires batchGenerateVideos
    // Step 7: Try multiple trigger methods — Enter alone may not work after mode switch
    console.log('[FlowProxy:BROWSER] Triggering video generation...');

    // Trigger generation: Enter key only (proven reliable, avoids double-generation)
    // DO NOT also click the send button — that causes two API calls = 2x credit waste
    console.log('[FlowProxy:BROWSER] Pressing Enter to generate video...');
    try {
      await inputEl.click();
      await sleep(300);
      await inputEl.press('Enter');
      console.log('[FlowProxy:BROWSER] Enter pressed on input');
    } catch(e) {
      console.log('[FlowProxy:BROWSER] Enter failed:', e.message);
    }

    // Step 8: Wait for async job to start — with retry trigger at 30s
    console.log('[FlowProxy:BROWSER] Waiting for video job to start...');

    // After 30s with no response, try pressing Enter again (prompt may have lost focus)
    const retryTimer = setTimeout(async () => {
      console.log('[FlowProxy:BROWSER] No response after 30s — retrying Enter...');
      try {
        // Re-find and re-focus the input
        const el = await genPage.$('[contenteditable="true"]') || await genPage.$('textarea');
        if (el) {
          await el.click();
          await sleep(300);
          await el.press('Enter');
          console.log('[FlowProxy:BROWSER] Retry Enter pressed');
        }
      } catch(e) { console.log('[FlowProxy:BROWSER] Retry Enter failed:', e.message); }
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
    if (usingWarmPage) {
      sleep(1000).then(() =>
        warmPage.goto('https://labs.google/fx/tools/flow', { waitUntil: 'domcontentloaded', timeout: 15000 })
          .catch(() => {})
      );
    }
    return { success: true, output_url: videoUrl, metadata: { projectId } };

  } finally { await genPage.close().catch(()=>{}); }
}

// ── Keep-alive ────────────────────────────────────────────────
async function browserKeepAlive() {
  if (!ready || !bContext) return false;
  try {
    const p = await bContext.newPage();
    await p.goto('https://labs.google/fx/api/auth/session', { waitUntil: 'domcontentloaded', timeout: 10000 });
    const text = await p.evaluate(() => document.body.innerText).catch(() => '{}');
    await p.close();
    const data = JSON.parse(text);
    if (data?.user?.email) { console.log(`[FlowProxy:BROWSER] Session alive — ${data.user.email}`); return true; }
    ready = false; await browserInit(); return true;
  } catch(e) { console.error('[FlowProxy:BROWSER] Keep-alive error:', e.message); ready = false; return false; }
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
  if (browser) { await browser.close(); browser = null; bContext = null; ready = false; }
  cachedProjectId = null; // reset project cache on restart
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
module.exports = { init, destroy, generateImage, generateVideo, keepAlive };
