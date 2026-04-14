// scripts/interceptGeneration.js
// ============================================================
// Intercepts fetch() INSIDE the browser to capture the EXACT
// request body Flow sends to batchGenerateImages.
// No truncation. No guessing. Ground truth.
//
// Run: node scripts/interceptGeneration.js
// Then generate an image in the Chrome window that opens.
// ============================================================
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const COOKIE   = process.env.FLOW_SESSION_COOKIE || '';
const ENV_PATH = path.join(__dirname, '../.env');
const OUT_PATH = path.join(__dirname, 'intercepted-request.json');

function writeEnvVars(updates) {
  let c = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  for (const [k, v] of Object.entries(updates)) {
    const re = new RegExp(`^#?\\s*${k}=.*$`, 'm');
    c = re.test(c) ? c.replace(re, `${k}=${v}`) : c.trimEnd() + `\n${k}=${v}\n`;
  }
  fs.writeFileSync(ENV_PATH, c);
}

async function intercept() {
  if (!COOKIE || COOKIE.length < 100) {
    console.log('❌ No cookie. Run: npm run capture\n');
    process.exit(1);
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Generation Request Interceptor                   ║');
  console.log('║  Captures EXACT body Flow sends to aisandbox     ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log('  This opens Flow with a fetch() interceptor injected.');
  console.log('  When you click Generate, the FULL request body is');
  console.log('  captured and saved — no truncation.');
  console.log('');

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
    { name: '__Secure-next-auth.session-token', value: COOKIE,
      domain: 'labs.google', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
    { name: 'next-auth.session-token', value: COOKIE,
      domain: 'labs.google', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);

  const page = await ctx.newPage();

  // ── Inject fetch interceptor on every page navigation ───────
  // This runs BEFORE any page scripts, capturing fetch calls
  await ctx.addInitScript(() => {
    const _fetch = window.fetch;
    window._interceptedRequests = [];

    window.fetch = async function(url, options = {}) {
      const urlStr = typeof url === 'string' ? url : url.toString();

      // Only intercept aisandbox generation calls
      if (urlStr.includes('aisandbox') && urlStr.includes('batchGenerateImages')) {
        try {
          const bodyStr = options.body
            ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body))
            : '';

          const entry = {
            url: urlStr,
            method: options.method || 'GET',
            headers: options.headers || {},
            body: bodyStr,
            timestamp: new Date().toISOString(),
          };

          window._interceptedRequests.push(entry);

          // Signal to Playwright that we have data
          console.log('__INTERCEPTED__:' + JSON.stringify(entry));
        } catch (e) {
          console.log('__INTERCEPT_ERROR__:' + e.message);
        }
      }

      // Always continue with the real fetch
      return _fetch.apply(this, arguments);
    };
  });

  // ── Listen for console messages from the page ────────────────
  let intercepted = null;

  page.on('console', async msg => {
    const text = msg.text();
    if (text.startsWith('__INTERCEPTED__:')) {
      try {
        const data = JSON.parse(text.replace('__INTERCEPTED__:', ''));
        intercepted = data;
        console.log('\n🎯🎯🎯 GENERATION REQUEST INTERCEPTED! 🎯🎯🎯\n');

        // Parse and display the body
        try {
          const body = JSON.parse(data.body);
          console.log('FULL REQUEST BODY:');
          console.log(JSON.stringify(body, null, 2));

          // Extract the requests array
          const req0 = body?.requests?.[0];
          if (req0) {
            console.log('\n═══════════════════════════════════════════');
            console.log('requests[0] FIELD NAMES (these are correct):');
            console.log(Object.keys(req0).join(', '));
            console.log('\nrequests[0] VALUES:');
            console.log(JSON.stringify(req0, null, 2));
            console.log('═══════════════════════════════════════════\n');
          }
        } catch (e) {
          console.log('Body (raw):', data.body.slice(0, 2000));
        }

        // Save to file
        fs.writeFileSync(OUT_PATH, JSON.stringify(data, null, 2));
        console.log(`Saved to: ${OUT_PATH}`);
        console.log('\nScript will close in 10 seconds...');

        setTimeout(async () => {
          await updateFlowProxy(data.body);
          await browser.close();
          process.exit(0);
        }, 10000);

      } catch (e) {
        console.log('Parse error:', e.message, text.slice(0, 200));
      }
    }
  });

  // ── Navigate to Flow gallery ─────────────────────────────────
  console.log('[1] Opening Flow...');
  await page.goto('https://labs.google/fx/tools/flow', {
    waitUntil: 'domcontentloaded', timeout: 30000,
  }).catch(() => {});
  await sleep(3000);

  const url = page.url();
  if (url.includes('accounts.google.com')) {
    console.log('❌ Cookie expired — redirected to login');
    console.log('   Run: npm run capture\n');
    await browser.close();
    process.exit(1);
  }

  // ── Auto-click New Project ───────────────────────────────────
  console.log('[2] Clicking New Project...');
  for (const sel of ['button:has-text("New project")', 'text="New project"']) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible().catch(() => false)) {
        await el.click();
        console.log(`    ✅ Clicked`);
        break;
      }
    } catch {}
  }

  await sleep(5000);

  // ── Auto-type prompt ─────────────────────────────────────────
  console.log('[3] Typing prompt...');
  let promptBox = null;
  for (const sel of ['[contenteditable="true"]', 'textarea', '[role="textbox"]']) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible().catch(() => false)) {
        promptBox = el;
        await el.click();
        await sleep(300);
        await el.fill('a red apple on a white table');
        console.log('    ✅ Typed prompt');
        break;
      }
    } catch {}
  }

  // ── Auto-click Generate ──────────────────────────────────────
  console.log('[4] Clicking Generate...');
  let clicked = false;
  for (const sel of ['button:has-text("Generate")', 'button:has-text("Create")',
                      'button:has-text("Run")', '[aria-label*="Generate"]']) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible().catch(() => false)) {
        await el.click();
        clicked = true;
        console.log(`    ✅ Clicked Generate`);
        break;
      }
    } catch {}
  }
  if (!clicked && promptBox) {
    await promptBox.press('Enter');
    console.log('    ✅ Pressed Enter');
  }

  // ── Wait for interception ────────────────────────────────────
  console.log('\n[5] Waiting for generation request (up to 3 minutes)...');
  console.log('    Watch Chrome — the fetch interceptor is active');
  console.log('    If auto-click failed, manually click Generate in Chrome\n');

  const timeout = Date.now() + 180_000;
  while (!intercepted && Date.now() < timeout) {
    await sleep(2000);
    const elapsed = Math.round((Date.now() - (timeout - 180_000)) / 1000);
    if (elapsed % 20 === 0) {
      console.log(`  [${elapsed}s] Waiting for generate click...`);
    }

    // Check if intercepted via page
    const check = await page.evaluate(() => window._interceptedRequests?.length > 0
      ? JSON.stringify(window._interceptedRequests[0])
      : null
    ).catch(() => null);

    if (check) {
      try {
        const data = JSON.parse(check);
        intercepted = data;
        const body = JSON.parse(data.body);
        const req0 = body?.requests?.[0];
        console.log('\n🎯 INTERCEPTED via page.evaluate!\n');
        console.log('requests[0] fields:', Object.keys(req0 || {}).join(', '));
        console.log('\nFull requests[0]:');
        console.log(JSON.stringify(req0, null, 2));
        fs.writeFileSync(OUT_PATH, JSON.stringify(data, null, 2));
        await updateFlowProxy(data.body);
        break;
      } catch {}
    }
  }

  if (!intercepted) {
    console.log('\n⏱  Timeout — no generation request captured');
    console.log('   Did you click Generate in Chrome?\n');
  }

  await browser.close();
  process.exit(0);
}

async function updateFlowProxy(bodyStr) {
  try {
    const body = JSON.parse(bodyStr);
    const req0 = body?.requests?.[0];
    if (!req0) return;

    console.log('\n══════════════════════════════════════════════════');
    console.log('UPDATING flowProxy.js with correct field names...');

    const proxyPath = path.join(__dirname, '../services/flowProxy.js');
    let proxy = fs.readFileSync(proxyPath, 'utf8');

    // Build the correct requests body from what we intercepted
    // Replace the prompt value with our template literal
    const template = JSON.stringify(req0, null, 16)
      .replace(/"a red apple on a white table"/, 'prompt')
      .replace(/"LANDSCAPE"/, 'aspectRatio')
      .replace(/^/gm, '              ');

    console.log('Captured requests[0] structure:');
    console.log(JSON.stringify(req0, null, 2));
    console.log('\n✅ Saved to scripts/intercepted-request.json');
    console.log('   Manually update flowProxy.js requests[0] with these exact field names.');
    console.log('   Replace each value with your variable: prompt, aspectRatio, etc.');
    console.log('\n══════════════════════════════════════════════════\n');
  } catch (e) {
    console.log('Could not parse body:', e.message);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
intercept().catch(e => { console.error('\n❌', e.message); process.exit(1); });
