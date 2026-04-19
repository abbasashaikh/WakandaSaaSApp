// scripts/captureVideoFull.js
// Captures ALL network requests (GET + POST) to aisandbox during video generation
// This reveals the exact polling endpoint Flow uses internally
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const COOKIE   = process.env.FLOW_SESSION_COOKIE || '';
const OUT_PATH = path.join(__dirname, 'capture-video-full.json');

async function capture() {
  if (!COOKIE || COOKIE.length < 100) {
    console.log('❌ No FLOW_SESSION_COOKIE in .env\n'); process.exit(1);
  }

  const browser = await chromium.launch({
    headless: false,
    args: ['--window-size=1400,900', '--window-position=100,100',
           '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addCookies([
    { name: '__Secure-next-auth.session-token', value: COOKIE,
      domain: 'labs.google', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
    { name: 'next-auth.session-token', value: COOKIE,
      domain: 'labs.google', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);

  const page = await ctx.newPage();
  const log  = [];

  // Capture ALL requests+responses to aisandbox (GET and POST)
  ctx.on('request', req => {
    const url = req.url();
    if (!url.includes('aisandbox')) return;
    const entry = { method: req.method(), url, ts: Date.now() };
    if (req.method() === 'POST') {
      try { entry.requestBody = req.postData(); } catch {}
    }
    log.push(entry);
    console.log(`[${req.method()}] ${url.replace('https://aisandbox-pa.googleapis.com/v1','').slice(0,80)}`);
  });

  ctx.on('response', async resp => {
    const url = resp.url();
    if (!url.includes('aisandbox')) return;
    const status = resp.status();
    let body = null;
    try { body = await resp.text(); } catch {}
    const entry = log.find(e => e.url === url && !e.responseStatus);
    if (entry) { entry.responseStatus = status; entry.responseBody = body; }
    else log.push({ method: resp.request().method(), url, responseStatus: status, responseBody: body, ts: Date.now() });
    if (status !== 304) {
      console.log(`  → ${status} ${body ? body.slice(0,150).replace(/\n/g,' ') : ''}`);
    }
  });

  await page.goto('https://labs.google/fx/tools/flow', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  console.log('\n┌────────────────────────────────────────────────────────────┐');
  console.log('│  DO THIS IN CHROME:                                        │');
  console.log('│  1. Click "Nano Banana 2" pill → select Video → close      │');
  console.log('│  2. Type: "a red ball rolling"                             │');
  console.log('│  3. Click → Generate                                       │');
  console.log('│  4. WAIT — watch this terminal for GET requests            │');
  console.log('│  5. The GET requests after generation = the poll URL       │');
  console.log('└────────────────────────────────────────────────────────────┘\n');

  // Wait 5 minutes for capture
  await new Promise(r => setTimeout(r, 300_000));
  fs.writeFileSync(OUT_PATH, JSON.stringify(log, null, 2));
  console.log(`\n📄 Saved: ${OUT_PATH}`);
  await browser.close();
}

capture().catch(e => { console.error('❌', e.message); process.exit(1); });
