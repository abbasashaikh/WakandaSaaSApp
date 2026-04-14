// services/flowProxy.js — FINAL WORKING
// ============================================================
// Image URL field confirmed from live response: 
//   body.media[0].image.generatedImage.fifeUrl
// ============================================================
require('dotenv').config();

const FLOW_MODE           = (process.env.FLOW_MODE || 'mock').toLowerCase();
const FLOW_SESSION_COOKIE = process.env.FLOW_SESSION_COOKIE || '';
const FLOW_URL            = 'https://labs.google/fx/tools/flow';

const PORT = process.env.PORT || 3001;
const SELF = `http://localhost:${PORT}`;
const MOCK_IMAGES = [1,2,3,4,5].map(n => `${SELF}/mock-assets/mock-images/image${n}.jpg`);
const MOCK_VIDEOS = [1,2,3].map(n => `${SELF}/mock-assets/mock-videos/video${n}.mp4`);

let browser  = null;
let bContext = null;
let ready    = false;

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

// ── Extract image URL from batchGenerateImages response ──────
// Confirmed field path from live response: media[0].image.generatedImage.fifeUrl
function extractImageUrl(body) {
  if (!body) return null;
  const b = body;

  // PRIMARY: confirmed working path from live response
  const primary = b?.media?.[0]?.image?.generatedImage?.fifeUrl;
  if (primary) return primary;

  // FALLBACKS for other possible response shapes
  return (
    b?.media?.[0]?.image?.generatedImage?.gcsUri          ||
    b?.media?.[0]?.image?.generatedImage?.imageUri        ||
    b?.media?.[0]?.image?.generatedImage?.url             ||
    b?.media?.[0]?.video?.generatedVideo?.fifeUrl         ||
    b?.responses?.[0]?.imageMedia?.mediaUrl               ||
    b?.responses?.[0]?.imageMedia?.imageUrl               ||
    b?.responses?.[0]?.image?.imageUrl                    ||
    b?.generatedImages?.[0]?.image?.imageUrl              ||
    b?.images?.[0]?.url                                   ||
    null
  );
}

async function browserInit() {
  if (ready && bContext) { console.log('[FlowProxy:BROWSER] Already ready'); return; }

  if (!FLOW_SESSION_COOKIE || FLOW_SESSION_COOKIE.length < 100) {
    throw new Error('FLOW_SESSION_COOKIE not set. Run: npm run capture');
  }

  console.log('[FlowProxy:BROWSER] Starting browser...');
  const { chromium } = require('playwright');
  const _fs = require('fs');

  const exePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
  ];
  const realExe = exePaths.find(p => _fs.existsSync(p));
  if (realExe) console.log(`[FlowProxy:BROWSER] Chrome: ${realExe}`);

  browser = await chromium.launch({
    headless: false,
    executablePath: realExe || undefined,
    args: [
      '--no-sandbox',
      '--window-size=1280,800',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run', '--no-default-browser-check',
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

  // Verify cookie with a temporary page
  const verifyPage = await bContext.newPage();
  await verifyPage.goto('https://labs.google/fx/api/auth/session', {
    waitUntil: 'domcontentloaded', timeout: 20000,
  });
  const sessText = await verifyPage.evaluate(() => document.body.innerText).catch(() => '{}');
  await verifyPage.close();

  let sessData = {};
  try { sessData = JSON.parse(sessText); } catch {}
  if (!sessData?.user?.email) {
    await browser.close(); browser = null; bContext = null;
    throw new Error(`Cookie rejected. Run: npm run capture\nResponse: ${sessText.slice(0,100)}`);
  }
  console.log(`[FlowProxy:BROWSER] ✅ Cookie valid — ${sessData.user.email}`);
  ready = true;
  console.log('[FlowProxy:BROWSER] ✅ Ready');
}

async function browserGenerateImage(prompt, options = {}) {
  if (!ready) await browserInit();
  console.log(`[FlowProxy:BROWSER] Generating: "${prompt}"`);

  const genPage = await bContext.newPage();

  try {
    // Step 1: Create project
    await genPage.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);

    if (genPage.url().includes('accounts.google.com')) {
      throw new Error('Cookie expired. Run: npm run capture');
    }

    const projResult = await genPage.evaluate(async () => {
      const r = await fetch('https://labs.google/fx/api/trpc/project.createProject', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { projectTitle: new Date().toLocaleString(), toolName: 'PINHOLE' } }),
      });
      const d = await r.json();
      return { status: r.status, projectId: d?.result?.data?.json?.result?.projectId };
    });

    if (!projResult.projectId) throw new Error(`project.createProject failed (${projResult.status})`);
    console.log(`[FlowProxy:BROWSER] Project: ${projResult.projectId}`);

    // Step 2: Set up response interceptor
    let resolveUrl, rejectUrl;
    const urlPromise = new Promise((res, rej) => { resolveUrl = res; rejectUrl = rej; });

    genPage.on('response', async (response) => {
      if (!response.url().includes('batchGenerateImages')) return;
      try {
        const status = response.status();
        const body   = await response.json().catch(() => ({}));
        console.log(`[FlowProxy:BROWSER] batchGenerateImages → ${status}`);
        if (status !== 200) {
          rejectUrl(new Error(`API ${status}: ${JSON.stringify(body).slice(0,200)}`));
          return;
        }
        console.log(`[FlowProxy:BROWSER] Body: ${JSON.stringify(body).slice(0,300)}`);
        const url = extractImageUrl(body);
        if (url) {
          console.log(`[FlowProxy:BROWSER] ✅ Image URL: ${url.slice(0,80)}...`);
          resolveUrl(url);
        } else {
          console.log('[FlowProxy:BROWSER] FULL RESPONSE:', JSON.stringify(body));
          rejectUrl(new Error('URL not found — see FULL RESPONSE above'));
        }
      } catch (e) { rejectUrl(e); }
    });

    // Step 3: Navigate to project page
    const projectUrl = `${FLOW_URL}/project/${projResult.projectId}`;
    console.log('[FlowProxy:BROWSER] Loading project page...');
    await genPage.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(4000);

    // Step 4: Type prompt
    let typed = false;
    for (const sel of ['[contenteditable="true"]', 'textarea', '[role="textbox"]']) {
      try {
        const el = await genPage.$(sel);
        if (el && await el.isVisible().catch(() => false)) {
          await el.click(); await sleep(500);
          await genPage.keyboard.press('Control+A');
          await el.type(prompt, { delay: 30 });
          await sleep(500);
          typed = true;
          console.log(`[FlowProxy:BROWSER] Typed into: ${sel}`);
          break;
        }
      } catch {}
    }
    if (!typed) throw new Error('Prompt input not found');
    await sleep(800);

    // Step 5: Click Generate
    await genPage.mouse.move(640, 400); await sleep(300);
    let clicked = false;
    for (const sel of [
      'button:has-text("Generate")', 'button:has-text("Create")',
      'button:has-text("Run")', '[aria-label*="enerate"]', 'button[type="submit"]',
    ]) {
      try {
        const el = await genPage.$(sel);
        if (el && await el.isVisible().catch(() => false)) {
          const box = await el.boundingBox();
          if (box) {
            await genPage.mouse.move(box.x + box.width/2, box.y + box.height/2);
            await sleep(200);
            await el.click(); clicked = true;
            console.log(`[FlowProxy:BROWSER] Clicked: ${sel}`); break;
          }
        }
      } catch {}
    }
    if (!clicked) {
      for (const sel of ['[contenteditable="true"]', 'textarea']) {
        try { const el = await genPage.$(sel); if (el) { await el.press('Enter'); clicked = true; break; } } catch {}
      }
    }
    if (!clicked) throw new Error('Generate button not found');
    console.log('[FlowProxy:BROWSER] Waiting for image (120s)...');

    // Step 6: Wait for intercepted image URL
    const imageUrl = await Promise.race([
      urlPromise,
      sleep(120000).then(() => { throw new Error('Timed out after 120s'); }),
    ]);

    console.log(`[FlowProxy:BROWSER] ✅ Image: ${imageUrl}`);
    return { success: true, output_url: imageUrl, metadata: { projectId: projResult.projectId } };

  } finally {
    await genPage.close().catch(() => {});
  }
}

async function browserGenerateVideo(prompt) { return mockVideo(prompt); }

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
  } catch (e) { console.error('[FlowProxy:BROWSER] Keep-alive error:', e.message); return false; }
}

async function generateImage(prompt, options = {}) {
  if (FLOW_MODE === 'browser') return browserGenerateImage(prompt, options);
  return mockImage(prompt);
}
async function generateVideo(prompt, options = {}) {
  if (FLOW_MODE === 'browser') return browserGenerateVideo(prompt);
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
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
module.exports = { init, destroy, generateImage, generateVideo, keepAlive };
