// scripts/analyzeReport.js
// ============================================================
// Reads flow-api-report.json and shows EVERY call captured,
// helping you manually identify the generation endpoint.
//
// Run: node scripts/analyzeReport.js
// ============================================================
const fs   = require('fs');
const path = require('path');

const REPORT = path.join(__dirname, 'flow-api-report.json');
const ENV    = path.join(__dirname, '../.env');

if (!fs.existsSync(REPORT)) {
  console.log('❌ flow-api-report.json not found. Run: node scripts/investigateFlow.js first.');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║         Flow API Report Analyzer                         ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');
console.log(`Report generated: ${report.generatedAt}`);
console.log(`Login success:    ${report.loginSuccess}`);
if (report.sessionCookie) {
  console.log(`Session cookie:   ${report.sessionCookie.value.slice(0, 30)}... (${report.sessionCookie.value.length} chars)`);
}
console.log('');

// Show ALL POST calls
const postCalls = report.postCalls || [];
const allCalls  = report.allCalls  || [];

// Reconstruct post calls from allCalls if postCalls is missing
const posts = postCalls.length > 0 ? postCalls :
  allCalls.filter(c => c.method === 'POST');

console.log('═══════════════════════════════════════════════════════════');
console.log(`ALL POST /trpc/ CALLS (${posts.length} total):`);
console.log('═══════════════════════════════════════════════════════════\n');

if (posts.length === 0) {
  console.log('No POST calls found in report.\n');
  console.log('This means you did not generate anything during the capture window.');
  console.log('Run: node scripts/investigateFlow.js and CLICK GENERATE\n');
} else {
  posts.forEach((c, i) => {
    const proc = c.proc || (c.url || '').split('/trpc/')[1] || c.url;
    console.log(`[${String(i+1).padStart(2)}] ${proc}`);
    if (c.reqBody) {
      const body = typeof c.reqBody === 'string' ? c.reqBody : JSON.stringify(c.reqBody);
      console.log(`     REQ:  ${body.slice(0, 200)}`);
    }
    if (c.resStatus) console.log(`     RES:  ${c.resStatus}`);
    if (c.resBody) {
      const res = typeof c.resBody === 'string' ? c.resBody : JSON.stringify(c.resBody);
      console.log(`     RESP: ${res.slice(0, 200)}`);
    }
    console.log('');
  });
}

// Look for anything that might be the generation call
console.log('═══════════════════════════════════════════════════════════');
console.log('GENERATION SEQUENCE ANALYSIS:');
console.log('═══════════════════════════════════════════════════════════\n');

// Step 1: project.createProject — this fires when user opens the tool
const projectCreate = posts.find(c => (c.proc || c.url || '').includes('project.createProject'));
if (projectCreate) {
  const body = typeof projectCreate.reqBody === 'string' ? projectCreate.reqBody : JSON.stringify(projectCreate.reqBody);
  const res  = typeof projectCreate.resBody === 'string' ? projectCreate.resBody : JSON.stringify(projectCreate.resBody || '');
  console.log('✅ Step 1: project.createProject found');
  console.log(`   Body: ${body}`);
  console.log(`   Response: ${res.slice(0, 200)}`);

  // Extract projectId from response
  let projectId = null;
  try {
    const parsed = JSON.parse(res);
    projectId = parsed?.result?.data?.json?.id ||
                parsed?.result?.data?.json?.projectId ||
                parsed?.result?.data?.id ||
                parsed?.id;
  } catch {}
  if (projectId) console.log(`   Project ID: ${projectId}`);
  console.log('');
} else {
  console.log('❌ Step 1: project.createProject NOT found');
  console.log('   This fires when you open Flow. It means you may not have');
  console.log('   fully loaded the page before the capture window ended.\n');
}

// Step 2: Find the generation call (comes after createProject)
const knownNonGen = [
  'submitBatchLog', 'reportClientSideError', 'fetchUser',
  'fetchLocale', 'fetchAcknowledgement', 'fetchMedia',
  'createProject', 'trackEvent', '/auth/',
];

const afterCreate = projectCreate
  ? posts.slice(posts.indexOf(projectCreate) + 1)
  : posts;

const genCandidates = afterCreate.filter(c => {
  const proc = c.proc || c.url || '';
  return !knownNonGen.some(bad => proc.includes(bad));
});

if (genCandidates.length > 0) {
  console.log(`✅ Step 2: Found ${genCandidates.length} candidate generation call(s):\n`);
  genCandidates.forEach((c, i) => {
    const proc = c.proc || (c.url || '').split('/trpc/')[1] || c.url;
    const req  = typeof c.reqBody === 'string' ? c.reqBody : JSON.stringify(c.reqBody);
    const res  = typeof c.resBody === 'string' ? c.resBody : JSON.stringify(c.resBody || '');
    console.log(`  Candidate ${i+1}: ${proc}`);
    console.log(`    Request body: ${req ? req.slice(0, 300) : '(empty)'}`);
    console.log(`    Response:     ${res.slice(0, 300)}`);
    console.log('');
  });

  // Recommend the best candidate
  const best = genCandidates[0];
  const proc = best.proc || (best.url || '').split('/trpc/')[1] || best.url;
  console.log('─────────────────────────────────────────────────────────');
  console.log(`RECOMMENDED: Set TRPC_IMAGE_PROC=${proc}`);
  console.log('─────────────────────────────────────────────────────────\n');

  // Ask to update .env
  const readEnv = () => fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '';
  let envContent = readEnv();
  const re = /^#?\s*TRPC_IMAGE_PROC=.*$/m;
  if (re.test(envContent)) {
    envContent = envContent.replace(re, `TRPC_IMAGE_PROC=${proc}`);
  } else {
    envContent = envContent.trimEnd() + `\nTRPC_IMAGE_PROC=${proc}\n`;
  }
  fs.writeFileSync(ENV, envContent);
  console.log(`✅ TRPC_IMAGE_PROC=${proc} written to .env\n`);

  console.log('Next: npm run test:api  →  npm start\n');

} else {
  console.log('❌ Step 2: No generation call found after project creation.\n');
  console.log('REASON: You probably submitted the prompt but did not WAIT for the image.');
  console.log('        The generation call fires when the image is being created,');
  console.log('        and may take 10-30 seconds to complete.\n');
  console.log('SOLUTION: Run the investigation script again:');
  console.log('  node scripts/investigateFlow.js\n');
  console.log('  Then:');
  console.log('  1. Log in');
  console.log('  2. Type "a red apple" and click Generate');
  console.log('  3. STAY ON THE PAGE — watch the clock in terminal');
  console.log('  4. Watch the image FULLY APPEAR before timer runs out');
  console.log('  5. The script will capture the generation API call\n');
}

// Show session cookie status
console.log('═══════════════════════════════════════════════════════════');
console.log('SESSION COOKIE:');
if (report.sessionCookie?.value) {
  console.log(`  ✅ Found in report (${report.sessionCookie.value.length} chars)`);
  // Auto-save to .env if not already there
  const envContent = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '';
  const currentCookie = (envContent.match(/^FLOW_SESSION_COOKIE=(.*)$/m) || [])[1] || '';
  if (!currentCookie || currentCookie.length < 100) {
    let updated = envContent;
    const re2 = /^#?\s*FLOW_SESSION_COOKIE=.*$/m;
    if (re2.test(updated)) {
      updated = updated.replace(re2, `FLOW_SESSION_COOKIE=${report.sessionCookie.value}`);
    } else {
      updated = updated.trimEnd() + `\nFLOW_SESSION_COOKIE=${report.sessionCookie.value}\n`;
    }
    fs.writeFileSync(ENV, updated);
    console.log('  ✅ Session cookie written to .env from report');
  } else {
    console.log('  ✅ Session cookie already in .env');
  }
} else {
  console.log('  ❌ No session cookie in report — run investigateFlow.js again');
}
console.log('');
