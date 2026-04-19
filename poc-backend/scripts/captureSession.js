// scripts/captureSession.js
// Opens Chrome, user logs into Flow, script captures the session cookie
// and automatically writes it to .env
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '../.env');

async function capture() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   Flow Session Cookie Capture                     ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--window-size=1280,800', '--window-position=100,100',
           '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  await page.goto('https://labs.google/fx/tools/flow', { waitUntil: 'domcontentloaded' });

  console.log('┌───────────────────────────────────────────────────────┐');
  console.log('│  Chrome is open. Please:                              │');
  console.log('│  1. Sign in with the account that has more credits    │');
  console.log('│  2. Wait until you see the Flow gallery page          │');
  console.log('│  3. This script will capture the cookie automatically │');
  console.log('└───────────────────────────────────────────────────────┘\n');

  // Poll until user is logged in (max 5 min)
  let cookie = null;
  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const url = page.url();
    if (url.includes('labs.google') && !url.includes('signin')) {
      // Try to get session cookie
      const cookies = await ctx.cookies('https://labs.google');
      const sessionCookie = cookies.find(c =>
        c.name === '__Secure-next-auth.session-token' ||
        c.name === 'next-auth.session-token'
      );
      if (sessionCookie && sessionCookie.value.length > 100) {
        cookie = sessionCookie.value;
        // Verify by hitting the session endpoint
        const sessPage = await ctx.newPage();
        await sessPage.goto('https://labs.google/fx/api/auth/session', { waitUntil: 'domcontentloaded' });
        const text = await sessPage.evaluate(() => document.body.innerText).catch(() => '{}');
        await sessPage.close();
        let sess = {};
        try { sess = JSON.parse(text); } catch {}
        if (sess?.user?.email) {
          console.log(`\n✅ Logged in as: ${sess.user.email}`);
          console.log(`✅ Cookie captured (${cookie.length} chars)`);
          break;
        }
        cookie = null; // not verified yet
      }
    }
    if (i % 10 === 0) console.log(`  Waiting for login... (${i*2}s)`);
  }

  await browser.close();

  if (!cookie) {
    console.log('\n❌ No session cookie captured. Make sure you logged in.');
    process.exit(1);
  }

  // Read current .env
  let envContent = '';
  try { envContent = fs.readFileSync(ENV_PATH, 'utf8'); } catch {}

  // Update or add FLOW_SESSION_COOKIE
  if (envContent.includes('FLOW_SESSION_COOKIE=')) {
    envContent = envContent.replace(
      /FLOW_SESSION_COOKIE=.*/,
      `FLOW_SESSION_COOKIE=${cookie}`
    );
  } else {
    envContent += `\nFLOW_SESSION_COOKIE=${cookie}\n`;
  }

  fs.writeFileSync(ENV_PATH, envContent);
  console.log(`\n✅ .env updated with new session cookie`);
  console.log('✅ Now restart the backend: npm start\n');
}

capture().catch(e => { console.error('❌', e.message); process.exit(1); });
