// scripts/captureVideo.js — Captures the exact video generation API call
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const COOKIE   = process.env.FLOW_SESSION_COOKIE || '';
const OUT_PATH = path.join(__dirname, 'capture-video-report.json');

async function capture() {
  if (!COOKIE || COOKIE.length < 100) {
    console.log('❌ No FLOW_SESSION_COOKIE. Run: npm run capture first.\n');
    process.exit(1);
  }
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   VIDEO Generation Capture                        ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--window-size=1400,900', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  await ctx.addCookies([
    { name: '__Secure-next-auth.session-token', value: COOKIE, domain: 'labs.google', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
    { name: 'next-auth.session-token', value: COOKIE, domain: 'labs.google', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);

  const page = await ctx.newPage();
  const captured = [];

  // Capture ALL POST to aisandbox — both request body and response
  ctx.on('request', async req => {
    if (req.method() === 'POST' && req.url().includes('aisandbox')) {
      let body = null;
      try { body = req.postData(); } catch {}
      console.log(`\n[REQ] POST ${req.url()}`);
      if (body) console.log(`  Body (first 400): ${body.slice(0,400)}`);
      captured.push({ url: req.url(), requestBody: body, ts: Date.now() });
    }
  });
  ctx.on('response', async resp => {
    if (resp.request().method() === 'POST' && resp.url().includes('aisandbox')) {
      const status = resp.status();
      let body = null;
      try { body = await resp.text(); } catch {}
      console.log(`\n[RESP] ${status} ${resp.url()}`);
      if (body) console.log(`  Body (first 600): ${body.slice(0,600)}`);
      const req = [...captured].reverse().find(c => c.url === resp.url());
      if (req) { req.responseStatus = status; req.responseBody = body; }
    }
  });

  await page.goto('https://labs.google/fx/tools/flow', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 3000));

  console.log('');
  console.log('┌───────────────────────────────────────────────────────────┐');
  console.log('│  CHROME IS OPEN — DO THIS NOW:                            │');
  console.log('│                                                           │');
  console.log('│  1. Click "+ New project" or use existing project         │');
  console.log('│  2. Click the "🎬 Nano Banana 2" pill at the bottom       │');
  console.log('│  3. In the popup, select a VIDEO model (Veo)              │');
  console.log('│  4. Type: "a red ball rolling"                            │');
  console.log('│  5. Click the → arrow button to Generate                  │');
  console.log('│  6. Watch this terminal — it will capture the API call    │');
  console.log('│                                                           │');
  console.log('│  Script exits automatically after 5 minutes.             │');
  console.log('└───────────────────────────────────────────────────────────┘\n');

  // Wait up to 5 min
  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const videoReq = captured.find(c =>
      c.url?.includes('batchGenerateVideo') ||
      c.url?.includes('generateVideo') ||
      (c.url?.includes('batch') && c.responseBody?.includes('video')) ||
      (c.url?.includes('batch') && c.responseBody?.includes('fifeUrl'))
    );
    if (videoReq) {
      console.log('\n\n🎯🎯🎯 VIDEO API CALL CAPTURED! 🎯🎯🎯\n');
      console.log('ENDPOINT:', videoReq.url);
      console.log('REQUEST BODY:', videoReq.requestBody?.slice(0,800));
      console.log('RESPONSE STATUS:', videoReq.responseStatus);
      console.log('RESPONSE BODY:', videoReq.responseBody?.slice(0,1000));
      break;
    }
    if (i % 15 === 0) console.log(`  [${i*2}s] Waiting for video generation... (click Generate in Chrome)`);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(captured, null, 2));
  console.log(`\n📄 Saved: ${OUT_PATH}`);
  console.log('Share capture-video-report.json or paste the logs above.\n');
  await browser.close();
}
capture().catch(e => { console.error('❌', e.message); process.exit(1); });
