// scripts/testApiMode.js — v4
// Uses known projectId and flow.* namespace to find the generation endpoint
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const SESSION_COOKIE = process.env.FLOW_SESSION_COOKIE || '';
const TRPC_BASE      = process.env.FLOW_TRPC_BASE || 'https://labs.google/fx/api/trpc';
const ENV_PATH       = path.join(__dirname, '../.env');
const REPORT_PATH    = path.join(__dirname, 'flow-api-report.json');

function buildHeaders(tok) {
  return {
    'Content-Type':    'application/json',
    'Cookie':          `__Secure-next-auth.session-token=${tok}; next-auth.session-token=${tok}`,
    'Origin':          'https://labs.google',
    'Referer':         'https://labs.google/fx/tools/flow',
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept':          'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

function readEnv() { return fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : ''; }
function setVar(c, k, v) {
  const re = new RegExp(`^#?\\s*${k}=.*$`, 'm');
  return re.test(c) ? c.replace(re, `${k}=${v}`) : c.trimEnd() + `\n${k}=${v}\n`;
}
function writeVars(updates) {
  let c = readEnv();
  for (const [k, v] of Object.entries(updates)) c = setVar(c, k, v);
  fs.writeFileSync(ENV_PATH, c);
}

async function post(proc, body, tok) {
  try {
    const r = await axios.post(`${TRPC_BASE}/${proc}`, { json: body },
      { headers: buildHeaders(tok), timeout: 12000, validateStatus: null });
    return { status: r.status, data: r.data };
  } catch (e) { return { status: 'ERR', error: e.message }; }
}

async function run() {
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║     API Mode Diagnostic v4 — flow.* namespace         ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  if (!SESSION_COOKIE) {
    // Try rescue from report
    if (fs.existsSync(REPORT_PATH)) {
      const r = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
      if (r.sessionCookie?.value) {
        writeVars({ FLOW_SESSION_COOKIE: r.sessionCookie.value });
        console.log('✅ Rescued cookie from report → re-run npm run test:api\n');
        return;
      }
    }
    console.log('❌ FLOW_SESSION_COOKIE is empty. Run: node scripts/investigateFlow.js\n');
    return;
  }

  // ── Step 1: Verify session ────────────────────────────────────
  console.log('━━━ STEP 1: Verify session ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  let cookieOk = false;

  try {
    const r = await axios.get('https://labs.google/fx/api/auth/session',
      { headers: buildHeaders(SESSION_COOKIE), timeout: 12000, validateStatus: null });
    if (r.status === 200 && r.data?.user?.email) {
      cookieOk = true;
      console.log(`  ✅ Session VALID — ${r.data.user.email}\n`);
    } else {
      console.log(`  ❌ Status ${r.status} — cookie may be expired`);
      console.log('  → Re-run: node scripts/investigateFlow.js\n');
      return;
    }
  } catch (e) { console.log(`  ❌ Network error: ${e.message}\n`); return; }

  // ── Step 2: Get or create a project to use as test ────────────
  console.log('━━━ STEP 2: Get projectId for testing ━━━━━━━━━━━━━━━━━\n');

  let projectId = null;

  // First check report for existing projectId
  if (fs.existsSync(REPORT_PATH)) {
    const rep = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
    projectId = rep.projectId;
    if (projectId) console.log(`  Using projectId from report: ${projectId}\n`);
  }

  // If not in report, create a new project
  if (!projectId) {
    console.log('  Creating test project...');
    const r = await post('project.createProject',
      { projectTitle: 'Test - ' + new Date().toISOString(), toolName: 'PINHOLE' },
      SESSION_COOKIE);

    if (r.status === 200) {
      projectId = r.data?.result?.data?.json?.result?.projectId;
      console.log(`  ✅ Created project: ${projectId}\n`);
    } else {
      console.log(`  ❌ Could not create project (${r.status}). Cookie may be expired.\n`);
      return;
    }
  }

  if (!projectId) {
    console.log('  ❌ No projectId available\n');
    return;
  }

  // ── Step 3: Probe flow.* generation endpoints ─────────────────
  console.log('━━━ STEP 3: Probe generation endpoints ━━━━━━━━━━━━━━━━\n');
  console.log('  Testing flow.* and pinhole.* endpoints with real projectId...\n');

  // These are the most likely generation endpoints based on the "flow." namespace
  // and "PINHOLE" toolName discovered from the report
  const candidates = [
    // flow.* namespace (most likely based on flow.projectInitialData)
    { proc: 'flow.runGeneration',     body: { projectId, prompt: 'a red apple' } },
    { proc: 'flow.generate',          body: { projectId, prompt: 'a red apple' } },
    { proc: 'flow.createGeneration',  body: { projectId, prompt: 'a red apple' } },
    { proc: 'flow.startGeneration',   body: { projectId, prompt: 'a red apple' } },
    { proc: 'flow.runInference',      body: { projectId, prompt: 'a red apple' } },
    { proc: 'flow.createRun',         body: { projectId, prompt: 'a red apple' } },
    { proc: 'flow.run',               body: { projectId, prompt: 'a red apple' } },
    { proc: 'flow.submit',            body: { projectId, prompt: 'a red apple' } },
    { proc: 'flow.createExecution',   body: { projectId, prompt: 'a red apple' } },
    // pinhole.* (the internal name of the tool)
    { proc: 'pinhole.run',            body: { projectId, prompt: 'a red apple' } },
    { proc: 'pinhole.generate',       body: { projectId, prompt: 'a red apple' } },
    { proc: 'pinhole.runGeneration',  body: { projectId, prompt: 'a red apple' } },
    { proc: 'pinhole.createRun',      body: { projectId, prompt: 'a red apple' } },
    // project.* with generation action
    { proc: 'project.runGeneration',  body: { projectId, prompt: 'a red apple' } },
    { proc: 'project.generate',       body: { projectId, prompt: 'a red apple' } },
    { proc: 'project.run',            body: { projectId, prompt: 'a red apple' } },
    // generation.* namespace
    { proc: 'generation.create',      body: { projectId, prompt: 'a red apple' } },
    { proc: 'generation.run',         body: { projectId, prompt: 'a red apple' } },
    { proc: 'generation.start',       body: { projectId, prompt: 'a red apple' } },
    // Also try with different body shapes
    { proc: 'flow.runGeneration',     body: { projectId, inputs: [{ type: 'text', value: 'a red apple' }] } },
    { proc: 'flow.runGeneration',     body: { projectId, userInput: 'a red apple' } },
    { proc: 'flow.runGeneration',     body: { projectId, textInput: 'a red apple', aspectRatio: 'LANDSCAPE' } },
  ];

  const found = [];

  for (const { proc, body } of candidates) {
    const r = await post(proc, body, SESSION_COOKIE);
    const icon = r.status === 404 ? '✗' :
                 (r.status === 401 || r.status === 403) ? '✗' :
                 r.status === 400 ? '?' :
                 (r.status === 200 || r.status === 202) ? '✅' : '?';
    const label = r.status === 404 ? '404' :
                  r.status === 400 ? `400 wrong body` :
                  (r.status === 200 || r.status === 202) ? `${r.status} ✅ WORKS` :
                  r.status === 'ERR' ? 'ERR' : `${r.status}`;

    console.log(`  ${icon} ${proc.padEnd(35)} ${label}`);

    if (r.status !== 404 && r.status !== 401 && r.status !== 403 && r.status !== 'ERR') {
      const snippet = r.data ? JSON.stringify(r.data).slice(0, 200) : '';
      found.push({ proc, status: r.status, data: r.data, snippet });
      if (r.status === 400) {
        // Show zodError so we know WHAT body field is wrong
        const zodErr = r.data?.error?.json?.data?.zodError;
        if (zodErr) console.log(`       ZodError: ${JSON.stringify(zodErr).slice(0, 200)}`);
      }
    }
  }

  // ── Step 4: Results ───────────────────────────────────────────
  console.log('\n━━━ STEP 4: Results ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (found.length === 0) {
    console.log('  ❌ No endpoints responded (all 404).\n');
    console.log('  The generation endpoint is NOT in our list of candidates.');
    console.log('  We MUST capture it from the browser during generation.\n');
    console.log('  ┌─────────────────────────────────────────────────────┐');
    console.log('  │  Run: node scripts/investigateFlow.js               │');
    console.log('  │  Then follow EXACTLY:                               │');
    console.log('  │  1. Wait for "*** TYPE YOUR PROMPT ***" message     │');
    console.log('  │  2. Click the prompt box in Flow                    │');
    console.log('  │  3. Type: a red apple                               │');
    console.log('  │  4. Press Enter                                     │');
    console.log('  │  5. Watch image appear (15-30 sec) - DO NOT CLOSE  │');
    console.log('  └─────────────────────────────────────────────────────┘\n');
    return;
  }

  const working = found.filter(e => e.status === 200 || e.status === 202);
  const partial  = found.filter(e => e.status === 400);

  if (working.length > 0) {
    const best = working[0];
    console.log(`  🎉 WORKING ENDPOINT: ${best.proc}\n`);
    writeVars({ TRPC_IMAGE_PROC: best.proc });
    console.log(`  ✅ TRPC_IMAGE_PROC=${best.proc} written to .env\n`);
    console.log('  Run: npm start\n');
  } else if (partial.length > 0) {
    console.log(`  Found ${partial.length} endpoint(s) that EXIST but need correct body:\n`);
    partial.forEach(e => {
      console.log(`  → ${e.proc}`);
      if (e.snippet) console.log(`    Response: ${e.snippet.slice(0, 200)}`);
    });
    console.log('');
    console.log('  ⚠️  These endpoints exist but our request body is wrong.');
    console.log('  The ONLY way to get the correct body is to capture it from');
    console.log('  the browser during a real generation.\n');
    console.log('  → Run: node scripts/investigateFlow.js');
    console.log('  → Generate something to capture the exact request body\n');

    // Still write the best candidate
    const best = partial[0];
    writeVars({ TRPC_IMAGE_PROC: best.proc });
    console.log(`  Saved best candidate: TRPC_IMAGE_PROC=${best.proc}`);
  }
}

run().catch(e => { console.error('\n❌', e.message); process.exit(1); });
