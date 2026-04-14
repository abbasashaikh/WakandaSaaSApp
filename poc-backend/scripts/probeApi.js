// scripts/probeApi.js — v2
// Tests different request body structures to find correct field names
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const COOKIE    = process.env.FLOW_SESSION_COOKIE || '';
const AISANDBOX = 'https://aisandbox-pa.googleapis.com/v1';
const API_KEY   = 'AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pY';
const RECAPTCHA = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
const ENV_PATH  = path.join(__dirname, '../.env');

// All body variants to test — ordered by most likely to work first
const VARIANTS = [
  // CONFIRMED: imageAspectRatio is the correct field (proto: image_aspect_ratio)
  // CONFIRMED: 'LANDSCAPE' is wrong value — testing correct enum values
  // Also testing: does sampleCount work when aspect ratio is valid?
  
  // Try IMAGE_ASPECT_RATIO_* prefix (Google standard proto enum)
  { label: 'imageAspectRatio=IMAGE_ASPECT_RATIO_LANDSCAPE',
    body: { prompt:'a red apple', imageAspectRatio:'IMAGE_ASPECT_RATIO_LANDSCAPE' } },
  { label: 'imageAspectRatio=IMAGE_ASPECT_RATIO_PORTRAIT',
    body: { prompt:'a red apple', imageAspectRatio:'IMAGE_ASPECT_RATIO_PORTRAIT' } },
  { label: 'imageAspectRatio=IMAGE_ASPECT_RATIO_SQUARE',
    body: { prompt:'a red apple', imageAspectRatio:'IMAGE_ASPECT_RATIO_SQUARE' } },
  { label: 'imageAspectRatio=IMAGE_ASPECT_RATIO_WIDESCREEN',
    body: { prompt:'a red apple', imageAspectRatio:'IMAGE_ASPECT_RATIO_WIDESCREEN' } },
  
  // Try ratio strings (16:9 style)
  { label: 'imageAspectRatio=16:9',
    body: { prompt:'a red apple', imageAspectRatio:'16:9' } },
  { label: 'imageAspectRatio=1:1',
    body: { prompt:'a red apple', imageAspectRatio:'1:1' } },
  { label: 'imageAspectRatio=9:16',
    body: { prompt:'a red apple', imageAspectRatio:'9:16' } },
  { label: 'imageAspectRatio=4:3',
    body: { prompt:'a red apple', imageAspectRatio:'4:3' } },
  { label: 'imageAspectRatio=3:4',
    body: { prompt:'a red apple', imageAspectRatio:'3:4' } },
  
  // Try ASPECT_RATIO_* prefix
  { label: 'imageAspectRatio=ASPECT_RATIO_LANDSCAPE',
    body: { prompt:'a red apple', imageAspectRatio:'ASPECT_RATIO_LANDSCAPE' } },
  { label: 'imageAspectRatio=ASPECT_RATIO_WIDESCREEN',
    body: { prompt:'a red apple', imageAspectRatio:'ASPECT_RATIO_WIDESCREEN' } },
  
  // Try with sampleCount too (once we find valid aspect ratio value)
  { label: 'prompt + imageAspectRatio=16:9 + sampleCount=1',
    body: { prompt:'a red apple', imageAspectRatio:'16:9', sampleCount:1 } },
  { label: 'prompt + imageAspectRatio=IMAGE_ASPECT_RATIO_LANDSCAPE + sampleCount=1',
    body: { prompt:'a red apple', imageAspectRatio:'IMAGE_ASPECT_RATIO_LANDSCAPE', sampleCount:1 } },
  
  // Baseline
  { label: 'prompt only',
    body: { prompt:'a red apple' } },
];

function readEnv() { return fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH,'utf8') : ''; }
function setEnvVar(c,k,v) {
  const re = new RegExp(`^#?\\s*${k}=.*$`,'m');
  return re.test(c) ? c.replace(re,`${k}=${v}`) : c.trimEnd()+`\n${k}=${v}\n`;
}

async function probe() {
  if (!COOKIE || COOKIE.length < 100) {
    console.log('❌ No FLOW_SESSION_COOKIE. Run: npm run capture\n');
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════╗');
  console.log('║   API Body Structure Probe  v2        ║');
  console.log('╚══════════════════════════════════════╝\n');
  console.log(`Cookie: ${COOKIE.slice(0,30)}... (${COOKIE.length} chars)\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

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

  // ── Step 1: Verify session via REST (no browser needed) ──────
  console.log('STEP 1: Verify session...');
  const sessPage = await ctx.newPage();
  await sessPage.goto('https://labs.google/fx/api/auth/session', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  });
  const sessText = await sessPage.evaluate(() => document.body.innerText).catch(() => '{}');
  let sessData = {};
  try { sessData = JSON.parse(sessText); } catch {}
  await sessPage.close();

  if (!sessData?.user?.email) {
    console.log('❌ Session cookie rejected:', sessText.slice(0,100));
    console.log('   Run: npm run capture to get a fresh cookie\n');
    await browser.close(); process.exit(1);
  }
  const accessToken = sessData.access_token;
  console.log(`  ✅ Logged in: ${sessData.user.email}`);
  console.log(`  AccessToken: ${accessToken?.slice(0,30)}...\n`);

  if (!accessToken) {
    console.log('❌ No access_token in session response');
    console.log('   The session may be partially expired');
    console.log('   Run: npm run capture to get a fresh session\n');
    await browser.close(); process.exit(1);
  }

  // ── Step 2: Navigate to Flow (need reCAPTCHA) ───────────────
  console.log('STEP 2: Loading Flow for reCAPTCHA...');
  await page.goto('https://labs.google/fx/tools/flow', {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await new Promise(r => setTimeout(r, 4000));

  const currentUrl = page.url();
  console.log(`  URL: ${currentUrl}`);

  if (currentUrl.includes('accounts.google.com')) {
    console.log('❌ Redirected to Google login — cookie expired for web app');
    console.log('   Run: npm run capture — log in manually to refresh\n');
    await browser.close(); process.exit(1);
  }

  // ── Step 3: Create project ───────────────────────────────────
  console.log('\nSTEP 3: Creating project...');
  const projResult = await page.evaluate(async () => {
    const res = await fetch('https://labs.google/fx/api/trpc/project.createProject', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ json: { projectTitle: 'Probe ' + Date.now(), toolName: 'PINHOLE' } }),
    });
    const data = await res.json();
    return { status: res.status, projectId: data?.result?.data?.json?.result?.projectId };
  });

  if (!projResult.projectId) {
    console.log(`❌ project.createProject failed (status ${projResult.status})`);
    await browser.close(); process.exit(1);
  }
  console.log(`  ✅ Project: ${projResult.projectId}`);

  // Navigate to the project page so reCAPTCHA is available
  await page.goto(`https://labs.google/fx/tools/flow/project/${projResult.projectId}`, {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await new Promise(r => setTimeout(r, 5000));

  // ── Step 4: Get reCAPTCHA token ───────────────────────────────
  console.log('\nSTEP 4: Getting reCAPTCHA token...');
  const recaptchaToken = await page.evaluate(async (key) => {
    if (!window.grecaptcha?.enterprise) return null;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 20000);
      window.grecaptcha.enterprise.ready(async () => {
        try {
          const tok = await window.grecaptcha.enterprise.execute(key, { action: 'probe' });
          clearTimeout(t); resolve(tok);
        } catch(e) { clearTimeout(t); reject(e); }
      });
    });
  }, RECAPTCHA).catch(e => null);

  if (!recaptchaToken) {
    console.log('  ⚠️  reCAPTCHA not available — probing without it');
  } else {
    console.log(`  ✅ reCAPTCHA: ${recaptchaToken.slice(0,20)}...`);
  }

  // ── Step 5: Probe each body variant ──────────────────────────
  const apiUrl = `${AISANDBOX}/projects/${projResult.projectId}/flowMedia:batchGenerateImages`;
  console.log(`\nSTEP 5: Probing ${VARIANTS.length} body variants...`);
  console.log(`API URL: ${apiUrl}\n`);

  let workingVariant = null;

  for (const variant of VARIANTS) {
    const reqBody = {
      clientContext: recaptchaToken
        ? { recaptchaContext: { token: recaptchaToken } }
        : {},
      requests: [variant.body],
    };

    const result = await page.evaluate(
      async ({ apiUrl, accessToken, apiKey, body }) => {
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(body),
        });
        let data;
        try { data = await res.json(); } catch(e) { data = { parseError: e.message }; }
        return { status: res.status, data };
      },
      { apiUrl, accessToken, apiKey: API_KEY, body: reqBody }
    );

    const icon = result.status === 200 ? '✅' :
                 result.status === 400 ? '❌' :
                 result.status === 403 ? '🔒' :
                 result.status === 429 ? '⏱️' : `⚠️(${result.status})`;

    const resp = JSON.stringify(result.data);

    // For 400, extract which fields are unknown
    const unknowns = resp.match(/Unknown name \\"([^"]+)\\"/g) || [];
    const hint = unknowns.length
      ? ` — unknown: ${unknowns.map(u => u.match(/\\"([^"]+)\\"/)?.[1]).join(', ')}`
      : (result.status !== 200 ? ` — ${resp.slice(0,100)}` : '');

    console.log(`  ${icon} [${result.status}] ${variant.label}${hint}`);

    if (result.status === 200) {
      workingVariant = { variant, response: result.data };
      console.log(`\n  RESPONSE: ${JSON.stringify(result.data).slice(0,500)}`);
      break;
    }

    await new Promise(r => setTimeout(r, 300));
  }

  // ── Save results ─────────────────────────────────────────────
  if (workingVariant) {
    const outPath = path.join(__dirname, 'working-body.json');
    fs.writeFileSync(outPath, JSON.stringify(workingVariant, null, 2));

    // Extract image URL
    const d = workingVariant.response;
    const imageUrl =
      d?.responses?.[0]?.imageMedia?.mediaUrl ||
      d?.responses?.[0]?.imageMedia?.imageUrl ||
      d?.responses?.[0]?.image?.imageUrl ||
      d?.generatedImages?.[0]?.image?.imageUrl ||
      JSON.stringify(d).match(/https:\/\/[^"]+\.(jpg|png|webp)/i)?.[0];

    console.log(`\n🎉 WORKING BODY FOUND!\n`);
    console.log('Correct requests[0] body:');
    console.log(JSON.stringify(workingVariant.variant.body, null, 2));
    if (imageUrl) {
      console.log(`\nGenerated image URL: ${imageUrl}`);
      console.log('\n✅ NOW UPDATE flowProxy.js requests[0] with the body above');
      console.log('   Then run: npm run check:env && npm start\n');
    } else {
      console.log('\nFull response (find image URL field):');
      console.log(JSON.stringify(d, null, 2).slice(0, 1000));
      console.log('\nUpdate flowProxy.js with the body above and the correct URL field\n');
    }
  } else {
    console.log('\n❌ No variant returned 200\n');
    console.log('This means:');
    console.log('  1. The reCAPTCHA token may be invalid for headless browser');
    console.log('  2. OR the access_token has expired (token lasts ~1 hour)');
    console.log('  3. OR the field names need further investigation\n');
    console.log('Try: npm run capture (run a fresh generation to see the live request)\n');
  }

  await browser.close();
}

probe().catch(e => { console.error('\n❌', e.message, e.stack?.slice(0,200)); process.exit(1); });
