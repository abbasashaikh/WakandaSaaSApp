// scripts/captureGeneration.js — v2
// ============================================================
// Captures generation API calls AND saves the fresh session cookie
// Works even when the existing cookie is expired — opens a login page
// ============================================================
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const FLOW_URL   = 'https://labs.google/fx/tools/flow';
const ENV_PATH   = path.join(__dirname, '../.env');
const REPORT_OUT = path.join(__dirname, 'capture-report.json');
const PROMPT     = 'a red apple on a white table';

function readEnv() { return fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH,'utf8') : ''; }
function writeEnvVars(updates) {
  let c = readEnv();
  for (const [k,v] of Object.entries(updates)) {
    const re = new RegExp(`^#?\\s*${k}=.*$`,'m');
    c = re.test(c) ? c.replace(re,`${k}=${v}`) : c.trimEnd()+`\n${k}=${v}\n`;
  }
  fs.writeFileSync(ENV_PATH,c);
}

async function capture() {
  const env    = readEnv();
  const match  = env.match(/^FLOW_SESSION_COOKIE=(.+)$/m);
  const oldCookie = match ? match[1].trim() : '';

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Generation Capture v2 — Saves Fresh Cookie             ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  const browser = await chromium.launch({
    headless: false,
    args: ['--window-size=1400,900', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  // Inject existing cookie (may be expired — browser will re-login if so)
  if (oldCookie && oldCookie.length > 100) {
    await context.addCookies([
      { name: '__Secure-next-auth.session-token', value: oldCookie,
        domain: 'labs.google', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
    ]);
    console.log('  Injected existing cookie (may need re-login if expired)');
  } else {
    console.log('  No existing cookie — will need to log in');
  }

  // Track all requests
  let generateClicked = false;
  const beforeGenerate = [];
  const afterGenerate  = [];

  context.on('request', async request => {
    const url = request.url(), method = request.method();
    if (url.includes('google-analytics') || url.includes('.woff') ||
        url.includes('favicon')) return;
    let body = null;
    try { body = request.postData(); } catch {}
    const entry = { time: new Date().toISOString(), method, url, body: body ? body.slice(0,2000) : null };
    if (generateClicked) {
      afterGenerate.push(entry);
      if (url.includes('/api/') || url.includes('/trpc/') || url.includes('aisandbox') || url.includes('recaptcha')) {
        console.log(`  [AFTER] ${method} ${url.slice(0,100)}`);
        if (body && body.length < 300) console.log(`         ${body}`);
      }
    } else {
      beforeGenerate.push(entry);
    }
  });

  context.on('response', async response => {
    const url = response.url(), status = response.status();
    if (url.includes('google-analytics') || url.includes('.woff') ||
        url.includes('favicon')) return;
    let body = null;
    try { body = await response.text().catch(() => ''); } catch {}
    if (generateClicked) {
      const req = [...afterGenerate].reverse().find(r => r.url === url);
      if (req) { req.responseStatus = status; req.responseBody = body ? body.slice(0,3000) : null; }
      else afterGenerate.push({ method: 'RESPONSE', url, responseStatus: status, responseBody: body ? body.slice(0,3000) : null });
      // Show important responses
      if (body && (url.includes('aisandbox') || url.includes('/trpc/'))) {
        console.log(`  [RESP]  ${status} ${url.slice(0,100)}`);
        if (body.length < 500) console.log(`         ${body}`);
      }
    }
  });

  const page = await context.newPage();

  // ── Open Flow ────────────────────────────────────────────────
  console.log('[1] Opening Flow...');
  await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(3000);

  // ── Check if login needed ────────────────────────────────────
  const urlAfterLoad = page.url();
  const needsLogin   = urlAfterLoad.includes('accounts.google.com') ||
                       urlAfterLoad.includes('/login') ||
                       urlAfterLoad.includes('/signin');

  if (needsLogin) {
    console.log('\n  ⚠️  Cookie expired — login required');
    console.log('');
    console.log('  ┌─────────────────────────────────────────────────────┐');
    console.log('  │  LOG IN WITH GOOGLE IN THE CHROME WINDOW:           │');
    console.log('  │  1. Click "Sign in with Google" or enter email      │');
    console.log('  │  2. Enter your Google password                      │');
    console.log('  │  3. Complete any 2FA if asked                       │');
    console.log('  │  4. Wait for this terminal to continue              │');
    console.log('  └─────────────────────────────────────────────────────┘\n');

    // Wait for login to complete
    const loginDeadline = Date.now() + 300_000; // 5 min
    while (Date.now() < loginDeadline) {
      await sleep(1000);
      const cur = page.url();
      if (cur.includes('labs.google') && !cur.includes('accounts.google.com') &&
          !cur.includes('/login')) {
        console.log(`  ✅ Login detected: ${cur}`);
        await sleep(3000); // let cookies settle
        break;
      }
    }
  } else {
    console.log(`  ✅ Already logged in: ${urlAfterLoad}`);
  }

  // ── Save fresh cookie IMMEDIATELY after login ────────────────
  console.log('\n[2] Saving fresh session cookie...');
  const allCookies = await context.cookies().catch(() => []);
  const freshCookie = allCookies.find(c => c.name === '__Secure-next-auth.session-token')
                   || allCookies.find(c => c.name === 'next-auth.session-token')
                   || allCookies.find(c => c.name.includes('session-token'));

  if (freshCookie) {
    writeEnvVars({ FLOW_SESSION_COOKIE: freshCookie.value, FLOW_MODE: 'browser' });
    console.log(`  ✅ Cookie saved to .env (${freshCookie.value.length} chars)`);
    console.log(`  Expires: ~30 days`);
  } else {
    console.log('  ⚠️  No session cookie found yet');
  }

  // ── Click New Project ─────────────────────────────────────────
  console.log('\n[3] Clicking New Project...');
  let clicked = false;
  for (const sel of ['button:has-text("New project")', 'button:has-text("+ New project")',
                      'text="New project"', '[aria-label*="New project"]']) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible().catch(() => false)) {
        await el.click(); clicked = true;
        console.log(`  ✅ Clicked: ${sel}`); break;
      }
    } catch {}
  }
  if (!clicked) {
    console.log('  ⚠️  Click "New project" manually in Chrome');
    await sleep(10000);
  }

  // ── Wait for editor ───────────────────────────────────────────
  console.log('\n[4] Waiting for editor...');
  await sleep(5000);
  console.log(`  URL: ${page.url()}`);

  // ── Find prompt box ───────────────────────────────────────────
  console.log('\n[5] Finding prompt input...');
  await sleep(2000);
  let promptBox = null;
  for (const sel of ['[contenteditable="true"]','textarea[placeholder*="Describe"]',
                      'textarea[placeholder*="prompt"]','textarea','[role="textbox"]']) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible().catch(() => false)) { promptBox = el; console.log(`  ✅ Found: ${sel}`); break; }
    } catch {}
  }

  if (promptBox) {
    await promptBox.click();
    await sleep(300);
    await promptBox.fill(PROMPT);
    console.log(`  ✅ Typed: "${PROMPT}"`);
  } else {
    console.log('  ⚠️  Type your prompt manually in Chrome');
  }

  // ── Click Generate — START CAPTURE ───────────────────────────
  console.log('\n[6] Clicking Generate (starting capture)...');
  generateClicked = true;

  let genClicked = false;
  for (const sel of ['button:has-text("Generate")','button:has-text("Run")',
                      'button:has-text("Create")','[aria-label*="Generate"]','button[type="submit"]']) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible().catch(() => false)) {
        await el.click(); genClicked = true;
        console.log(`  ✅ Clicked: ${sel}`); break;
      }
    } catch {}
  }
  if (!genClicked && promptBox) { await promptBox.press('Enter'); genClicked = true; console.log('  ✅ Pressed Enter'); }
  if (!genClicked) { console.log('  ⚠️  Click Generate manually in Chrome NOW'); }

  // ── Wait for result ───────────────────────────────────────────
  console.log('\n[7] Capturing requests (3 minutes)...');
  console.log('  Watch for image to appear in Chrome\n');

  for (let i = 0; i < 18; i++) {
    await sleep(10000);
    const n = afterGenerate.filter(r => r.method !== 'RESPONSE').length;
    const hasBatch = afterGenerate.some(r => r.url?.includes('batchGenerateImages'));
    const hasResp  = afterGenerate.some(r => r.url?.includes('batchGenerateImages') && r.responseStatus);
    console.log(`  [${(i+1)*10}s] ${n} requests | batchGenerate: ${hasBatch ? '✅ sent' : '⏳'} | response: ${hasResp ? '✅ captured' : '⏳'}`);
    if (hasResp) { console.log('  Response captured! Saving...'); break; }
  }

  // ── Save cookie again (final) ────────────────────────────────
  const finalCookies = await context.cookies().catch(() => []);
  const finalCookie  = finalCookies.find(c => c.name === '__Secure-next-auth.session-token')
                    || finalCookies.find(c => c.name.includes('session-token'));
  if (finalCookie) {
    writeEnvVars({ FLOW_SESSION_COOKIE: finalCookie.value, FLOW_MODE: 'browser' });
    console.log(`\n  ✅ Final cookie saved (${finalCookie.value.length} chars)`);
  }

  // ── Save report ───────────────────────────────────────────────
  fs.writeFileSync(REPORT_OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    sessionCookie: finalCookie ? { name: finalCookie.name, value: finalCookie.value } : null,
    editorUrl: page.url(),
    afterGenerateRequests: afterGenerate,
    beforeGeneratePostRequests: beforeGenerate.filter(r => r.method === 'POST'),
  }, null, 2));

  console.log(`\n  Report → ${REPORT_OUT}`);

  // ── Analysis ──────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  const batchReq  = afterGenerate.find(r => r.url?.includes('batchGenerateImages'));
  const batchResp = batchReq?.responseBody || '';

  if (batchResp) {
    console.log('✅ batchGenerateImages RESPONSE CAPTURED:');
    console.log(batchResp.slice(0, 1000));

    // Try to find image URL
    const imageUrlMatch = batchResp.match(/https:\/\/[^"]+\.(jpg|png|webp)/i);
    if (imageUrlMatch) {
      console.log(`\n✅ IMAGE URL: ${imageUrlMatch[0]}`);
    }
  } else if (batchReq) {
    console.log('⚠️  batchGenerateImages was SENT but response not captured');
    console.log('   The image was likely generated but we missed the response');
    console.log('   Try again — keep Chrome open longer after image appears');
  } else {
    console.log('❌ batchGenerateImages not captured');
  }

  console.log('\n  Run: npm run test:cookie → npm start\n');

  await browser.close();
  process.exit(0);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
capture().catch(err => { console.error('\n❌', err.message); process.exit(1); });
