// scripts/testCookie.js
// Tests cookie validity AND tRPC project creation (with correct headers via browser)
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { chromium } = require('playwright');

const COOKIE = process.env.FLOW_SESSION_COOKIE || '';

async function test() {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║    Cookie Diagnostic Test             ║');
  console.log('╚══════════════════════════════════════╝\n');

  if (!COOKIE || COOKIE.length < 100) {
    console.log('❌ FLOW_SESSION_COOKIE not set. Run: npm run capture\n');
    process.exit(1);
  }
  console.log(`Cookie: ${COOKIE.slice(0, 30)}... (${COOKIE.length} chars)\n`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  await ctx.addCookies([
    { name: '__Secure-next-auth.session-token', value: COOKIE,
      domain: 'labs.google', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
    { name: 'next-auth.session-token', value: COOKIE,
      domain: 'labs.google', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);

  const page = await ctx.newPage();

  // ── Test 1: Auth session ──────────────────────────────────────
  console.log('━━━ TEST 1: Session cookie ━━━━━━━━━━━━━━━━━━\n');
  await page.goto('https://labs.google/fx/api/auth/session', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  });
  const sessionText = await page.evaluate(() => document.body.innerText).catch(() => '{}');
  let sessionData = {};
  try { sessionData = JSON.parse(sessionText); } catch {}

  if (sessionData?.user?.email) {
    console.log(`  ✅ Cookie VALID — ${sessionData.user.email}`);
    console.log(`  Expires: ${sessionData.expires}\n`);
  } else {
    console.log('  ❌ Cookie INVALID or EXPIRED');
    console.log('  Response:', sessionText.slice(0, 200));
    console.log('\n  Run: npm run capture — log in and generate to get fresh cookie.\n');
    await browser.close();
    process.exit(1);
  }

  // ── Test 2: Navigate to Flow ──────────────────────────────────
  console.log('━━━ TEST 2: Flow page load ━━━━━━━━━━━━━━━━━━\n');
  await page.goto('https://labs.google/fx/tools/flow', {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await new Promise(r => setTimeout(r, 2000));
  const flowUrl = page.url();
  console.log(`  URL: ${flowUrl}`);
  const onLoginPage = flowUrl.includes('/login') || flowUrl.includes('accounts.google.com');
  console.log(onLoginPage ? '  ❌ Redirected to login page' : '  ✅ Flow loaded\n');

  if (onLoginPage) {
    console.log('  Cookie works for API but Flow redirects to login.');
    console.log('  Run: npm run capture to refresh.\n');
    await browser.close();
    process.exit(1);
  }

  // ── Test 3: tRPC project creation (via page.evaluate) ─────────
  console.log('━━━ TEST 3: project.createProject via browser ━\n');
  const projResult = await page.evaluate(async () => {
    const res = await fetch('https://labs.google/fx/api/trpc/project.createProject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        json: { projectTitle: 'Cookie Test ' + Date.now(), toolName: 'PINHOLE' }
      }),
    });
    const data = await res.json();
    return { status: res.status, data };
  });

  console.log(`  HTTP status: ${projResult.status}`);
  if (projResult.status === 200) {
    const projectId = projResult.data?.result?.data?.json?.result?.projectId;
    console.log(`  ✅ Project created: ${projectId}\n`);

    // ── Test 4: Navigate to project page ─────────────────────
    console.log('━━━ TEST 4: Project page + reCAPTCHA ━━━━━━━━\n');
    await page.goto(`https://labs.google/fx/tools/flow/project/${projectId}`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await new Promise(r => setTimeout(r, 5000));

    const recaptchaReady = await page.evaluate(() => {
      return !!(window.grecaptcha?.enterprise);
    });
    console.log(recaptchaReady
      ? '  ✅ reCAPTCHA loaded — browser mode will work!'
      : '  ⚠️  reCAPTCHA not detected — generation may fail');

    if (recaptchaReady) {
      console.log('\n🎉 ALL TESTS PASSED! Run:\n');
      console.log('   npm start\n');
    } else {
      console.log('\n  Trying generation anyway (reCAPTCHA may still work)...\n');
      console.log('  Run: npm start and test from the Electron app.\n');
    }
  } else {
    console.log('  ❌ tRPC returned:', JSON.stringify(projResult.data).slice(0, 300));
    console.log('\n  Even with page.evaluate(), tRPC is rejecting the request.');
    console.log('  Cookie may have expired. Run: npm run capture\n');
  }

  await browser.close();
}

test().catch(e => { console.error('❌', e.message); process.exit(1); });
