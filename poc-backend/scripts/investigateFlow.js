// scripts/investigateFlow.js — v8 FULLY AUTOMATED
// ============================================================
// Cookie injection works. Now we automate the rest:
//   1. Inject session cookie → open Flow gallery (no login)
//   2. Click "New project" automatically  
//   3. Wait for editor to load
//   4. Type prompt automatically
//   5. Click Generate automatically
//   6. Capture the API call
//   7. Auto-update .env
//
// USER DOES NOTHING — just watches Chrome and this terminal.
// ============================================================
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const FLOW_URL  = 'https://labs.google/fx/tools/flow';
const ENV_PATH  = path.join(__dirname, '../.env');
const REPORT    = path.join(__dirname, 'flow-api-report.json');
const PROMPT    = 'a red apple on a white table';

const IGNORE = [
  'general.submitBatchLog','general.reportClientSideError',
  'general.fetchUserAcknowledgement','general.fetchUserLocale',
  'general.fetchUserInfo','general.trackEvent',
  'general.fetchToolAvailability','media.fetchMedia',
  '/api/auth/','videoFx.getUserSettings','videoFx.getFlowAppConfig',
];

const FALSE_POS = ['.wav','.mp3','.ogg','aistudio/voices','presetAudio',
  'audioSample','banners','changeLogId','siteContent'];

function isNoise(url) { return IGNORE.some(i => url.includes(i)); }

function isRealImageResult(body) {
  if (!body) return false;
  const s = typeof body === 'string' ? body : JSON.stringify(body);
  if (FALSE_POS.some(p => s.includes(p))) return false;
  return s.includes('generatedImage') || s.includes('generationResult') ||
    s.includes('imageUri') || s.includes('outputImage') ||
    (s.includes('storage.googleapis.com') &&
      (s.includes('.jpg')||s.includes('.png')||s.includes('.webp')));
}

function tryJson(s) { if(!s)return null; try{return JSON.parse(s);}catch{return s;} }

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    const ex = path.join(__dirname,'../.env.example');
    if (fs.existsSync(ex)) fs.copyFileSync(ex,ENV_PATH); else fs.writeFileSync(ENV_PATH,'');
  }
  return fs.readFileSync(ENV_PATH,'utf8');
}

function writeEnvVars(updates) {
  let c = readEnv();
  for(const [k,v] of Object.entries(updates)){
    const re = new RegExp(`^#?\\s*${k}=.*$`,'m');
    c = re.test(c) ? c.replace(re,`${k}=${v}`) : c.trimEnd()+`\n${k}=${v}\n`;
  }
  fs.writeFileSync(ENV_PATH,c);
}

async function investigate() {
  // Read cookie
  const env = readEnv();
  const cookieMatch = env.match(/^FLOW_SESSION_COOKIE=(.+)$/m);
  const cookie = cookieMatch ? cookieMatch[1].trim() : '';

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Flow Investigation v8 — Fully Automated                ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  if (!cookie || cookie.length < 100) {
    console.log('❌ FLOW_SESSION_COOKIE not found in .env\n');
    console.log('   Open scripts/flow-api-report.json');
    console.log('   Copy the value from: sessionCookie.value');
    console.log('   Add to .env: FLOW_SESSION_COOKIE=<paste here>\n');
    process.exit(1);
  }

  console.log(`  ✅ Cookie found (${cookie.length} chars)`);
  console.log('');
  console.log('  This script will:');
  console.log('  → Open Flow gallery (already logged in)');
  console.log('  → Click "New project" automatically');
  console.log('  → Type a prompt automatically');
  console.log('  → Click Generate automatically');
  console.log('  → Capture the API call');
  console.log('  → Update your .env file');
  console.log('');
  console.log('  YOU DO NOT NEED TO DO ANYTHING IN CHROME.');
  console.log('  Just watch this terminal.');
  console.log('');

  const browser = await chromium.launch({
    headless: false,
    args: ['--window-size=1400,900','--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  // Inject cookie
  await context.addCookies([
    { name:'__Secure-next-auth.session-token', value:cookie, domain:'labs.google',
      path:'/', httpOnly:true, secure:true, sameSite:'Lax' },
    { name:'next-auth.session-token', value:cookie, domain:'labs.google',
      path:'/', httpOnly:true, secure:true, sameSite:'Lax' },
  ]);

  // Track all calls
  const allCalls = [];

  context.on('request', async req => {
    const url=req.url(), method=req.method();
    if (!url.includes('/api/')&&!url.includes('/trpc/')) return;
    if (isNoise(url)) return;
    let body=null; try{body=req.postData();}catch{}
    const proc = url.includes('/trpc/') ? url.split('/trpc/')[1].split('?')[0] : url;
    allCalls.push({time:Date.now(),method,url,proc,reqBody:body?tryJson(body):null,reqRaw:body});
    if (method==='POST') {
      console.log(`  📤 POST ${proc}`);
      if (body) console.log(`     ${body.slice(0,250)}`);
    }
  });

  context.on('response', async res => {
    const url=res.url(), status=res.status();
    if (!url.includes('/api/')&&!url.includes('/trpc/')) return;
    if (isNoise(url)) return;
    let body=null; try{body=tryJson(await res.text().catch(()=>''));}catch{}
    const proc = url.includes('/trpc/') ? url.split('/trpc/')[1].split('?')[0] : url;
    const call = [...allCalls].reverse().find(c=>c.url===url);
    if (call){call.resStatus=status;call.resBody=body;}
    else allCalls.push({time:Date.now(),method:'GET',url,proc,resStatus:status,resBody:body});
    if (call?.method==='POST') {
      const s=body?JSON.stringify(body):'';
      console.log(`  📥 ${status} ${proc}`);
      if (s&&s.length<400) console.log(`     ${s}`);
    }
  });

  const page = await context.newPage();

  // ── Step 1: Open gallery ─────────────────────────────────────
  console.log('[1] Opening Flow gallery...');
  await page.goto(FLOW_URL, {waitUntil:'domcontentloaded', timeout:30000}).catch(()=>{});
  await sleep(4000);
  console.log(`    URL: ${page.url()}`);

  // ── Step 2: Click New Project ─────────────────────────────────
  console.log('\n[2] Finding "New project" button...');

  // Try multiple selector strategies
  const newProjectSelectors = [
    'button:has-text("New project")',
    '[aria-label*="New project"]',
    'button:has-text("New Project")',
    '[data-testid*="new-project"]',
    'button:has-text("new project")',
    // The + New project shown in screenshot
    'button:has-text("+ New project")',
  ];

  let clicked = false;
  for (const sel of newProjectSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        console.log(`    ✅ Clicked: ${sel}`);
        clicked = true;
        break;
      }
    } catch {}
  }

  if (!clicked) {
    // Try clicking by visible text anywhere
    try {
      await page.click('text="New project"');
      clicked = true;
      console.log('    ✅ Clicked via text match');
    } catch {}
  }

  if (!clicked) {
    // Last resort: find all buttons and look for "new project"
    try {
      const buttons = await page.$$('button');
      for (const btn of buttons) {
        const txt = (await btn.innerText().catch(() => '')).toLowerCase();
        if (txt.includes('new') && txt.includes('project')) {
          await btn.click();
          clicked = true;
          console.log('    ✅ Clicked via button scan');
          break;
        }
      }
    } catch {}
  }

  if (!clicked) {
    console.log('    ⚠️  Could not click "New project" automatically');
    console.log('');
    console.log('    ━━━ MANUAL ACTION NEEDED ━━━━━━━━━━━━━━━━━━━━');
    console.log('    Please click "New project" in the Chrome window.');
    console.log('    Terminal will continue automatically after that.');
    console.log('    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  // ── Step 3: Wait for editor / project.createProject ──────────
  console.log('\n[3] Waiting for editor to load...');
  const editorDeadline = Date.now() + 60_000;
  let projectId = null;

  while (Date.now() < editorDeadline) {
    await sleep(1000);
    const createCall = allCalls.find(c => c.proc==='project.createProject' && c.resStatus===200);
    if (createCall) {
      try { projectId = createCall.resBody?.result?.data?.json?.result?.projectId; } catch {}
      console.log(`    ✅ Editor loaded! Project: ${projectId}`);
      break;
    }
  }

  if (!projectId) {
    console.log('    ⚠️  project.createProject not detected yet, waiting for editor...');
    await sleep(5000);
  }

  // ── Step 4: Find and type in the prompt box ───────────────────
  console.log('\n[4] Finding prompt input box...');
  await sleep(3000); // Let editor fully render

  const promptSelectors = [
    'textarea[placeholder*="Describe"]',
    'textarea[placeholder*="describe"]',
    'textarea[placeholder*="prompt"]',
    'textarea[placeholder*="type"]',
    'textarea[placeholder*="write"]',
    'textarea[placeholder*="Enter"]',
    '[contenteditable="true"]',
    'textarea',
    'input[type="text"]',
    '[role="textbox"]',
    '[data-testid*="prompt"]',
    '[data-testid*="input"]',
  ];

  let promptBox = null;
  let usedSelector = '';

  for (const sel of promptSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const visible = await el.isVisible().catch(() => false);
        if (visible) {
          promptBox = el;
          usedSelector = sel;
          break;
        }
      }
    } catch {}
  }

  if (promptBox) {
    console.log(`    ✅ Found prompt box: ${usedSelector}`);
    console.log(`\n[5] Typing prompt: "${PROMPT}"...`);
    await promptBox.click();
    await sleep(500);
    await promptBox.fill(PROMPT);
    await sleep(500);
    console.log('    ✅ Prompt typed!');
  } else {
    console.log('    ⚠️  Could not find prompt box automatically.');
    console.log('');
    console.log('    ━━━ MANUAL ACTION NEEDED ━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`    Click the text/prompt box and type: ${PROMPT}`);
    console.log('    Then press Enter or click Generate.');
    console.log('    Terminal will detect and capture automatically.');
    console.log('    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  // ── Step 5: Click Generate ────────────────────────────────────
  if (promptBox) {
    console.log('\n[6] Clicking Generate...');
    await sleep(500);

    const generateSelectors = [
      'button:has-text("Generate")',
      'button:has-text("Run")',
      'button:has-text("Create")',
      'button[aria-label*="Generate"]',
      'button[aria-label*="generate"]',
      'button[type="submit"]',
      '[data-testid*="generate"]',
      '[data-testid*="run"]',
    ];

    let genClicked = false;
    for (const sel of generateSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          const visible = await el.isVisible().catch(() => false);
          if (visible) {
            await el.click();
            genClicked = true;
            console.log(`    ✅ Clicked Generate: ${sel}`);
            break;
          }
        }
      } catch {}
    }

    if (!genClicked) {
      // Try pressing Enter in the prompt box
      console.log('    Trying Enter key...');
      await promptBox.press('Enter');
      genClicked = true;
      console.log('    ✅ Pressed Enter');
    }

    if (!genClicked) {
      console.log('    ⚠️  Could not click Generate automatically.');
      console.log('');
      console.log('    ━━━ MANUAL ACTION NEEDED ━━━━━━━━━━━━━━━━━━━━');
      console.log('    Press Enter or click the Generate button in Chrome.');
      console.log('    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }
  }

  // ── Step 6: Wait for generation ───────────────────────────────
  console.log('\n[7] Waiting for generation result (up to 5 minutes)...');
  console.log('    Watch Chrome — image should appear in 15-30 seconds\n');

  const genStart  = Date.now();
  const genMax    = 360_000;
  let genDetected = false;
  let genDone     = false;

  while (Date.now() - genStart < genMax) {
    await sleep(2000);

    const genCalls = allCalls.filter(c =>
      c.method==='POST' && c.proc!=='project.createProject' && !isNoise(c.url)
    );

    if (genCalls.length > 0 && !genDetected) {
      genDetected = true;
      console.log(`  🎯 Generation call: ${genCalls[0].proc}`);
      if (genCalls[0].reqRaw) console.log(`     Body: ${genCalls[0].reqRaw.slice(0,300)}`);
      console.log('     Generating image...\n');
    }

    if (allCalls.some(c => c.resBody && isRealImageResult(c.resBody)) && !genDone) {
      genDone = true;
      console.log('\n  ✅ Image generation COMPLETE!');
      await sleep(3000);
      break;
    }

    if (genDetected && Date.now()-genStart > 120_000) {
      console.log('\n  ⏱  Extended wait — saving...');
      break;
    }

    const elapsed = Math.round((Date.now()-genStart)/1000);
    if (elapsed > 0 && elapsed % 20 === 0) {
      const n = allCalls.filter(c => c.method==='POST' && c.proc!=='project.createProject' && !isNoise(c.url)).length;
      console.log(`  [${elapsed}s] ${n===0 ? 'Waiting for generation...' : `${n} call(s) detected, waiting for result...`}`);
    }
  }

  // ── Save ──────────────────────────────────────────────────────
  const allPostCalls = allCalls.filter(c => c.method==='POST');
  const genCalls = allCalls.filter(c =>
    c.method==='POST' && c.proc!=='project.createProject' && !isNoise(c.url)
  );

  const freshCookie = (await context.cookies().catch(()=>[])).find(c =>
    c.name==='__Secure-next-auth.session-token' || c.name.includes('session-token')
  );

  fs.writeFileSync(REPORT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    projectId,
    sessionCookie: { name: '__Secure-next-auth.session-token', value: freshCookie?.value || cookie },
    postCalls: allPostCalls.map(c=>({proc:c.proc,url:c.url,
      reqBody:c.reqRaw?c.reqRaw.slice(0,5000):null,
      resStatus:c.resStatus,resBody:c.resBody?JSON.stringify(c.resBody).slice(0,5000):null})),
    generationCalls: genCalls.map(c=>({proc:c.proc,url:c.url,
      reqBody:c.reqRaw?c.reqRaw.slice(0,5000):null,
      resStatus:c.resStatus,resBody:c.resBody?JSON.stringify(c.resBody).slice(0,5000):null})),
    allCalls: allCalls.map(c=>({method:c.method,proc:c.proc,url:c.url,
      reqBody:c.reqRaw?c.reqRaw.slice(0,500):null,
      resStatus:c.resStatus,resBody:c.resBody?JSON.stringify(c.resBody).slice(0,500):null})),
  }, null, 2));

  console.log(`\n  Report → ${REPORT}`);

  // Print all POSTs
  console.log('\n  ALL POST CALLS:');
  allPostCalls.forEach((c,i) => {
    console.log(`  [${i+1}] ${c.proc}`);
    if (c.reqRaw) console.log(`       REQ: ${c.reqRaw.slice(0,200)}`);
    if (c.resBody) console.log(`       RES: ${JSON.stringify(c.resBody).slice(0,200)}`);
    console.log('');
  });

  // Update .env
  const updates = { FLOW_MODE:'api', FLOW_SESSION_COOKIE: freshCookie?.value || cookie };
  const genCall = genCalls[0];
  if (genCall) {
    const proc = genCall.proc;
    console.log(`  ✅ Generation endpoint found: ${proc}`);
    if (proc.toLowerCase().includes('video')) updates.TRPC_VIDEO_PROC = proc;
    else updates.TRPC_IMAGE_PROC = proc;
  }
  writeEnvVars(updates);
  console.log('  ✅ .env updated!\n');

  if (genCall) {
    console.log('🎉 SUCCESS! Run:\n');
    console.log('   npm run test:api');
    console.log('   npm start\n');
  } else {
    console.log('⚠️  Generation call not captured. Run again.\n');
    console.log('   If Chrome opened but no prompt box appeared,');
    console.log('   click "New project" manually, then type a prompt.\n');
  }

  await browser.close();
  process.exit(0);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
investigate().catch(err => { console.error('\n❌', err.message); process.exit(1); });
