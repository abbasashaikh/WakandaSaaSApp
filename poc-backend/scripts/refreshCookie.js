// scripts/refreshCookie.js
// Reads the latest session cookie from capture-report.json and updates .env
require('dotenv').config({ path: require('path').join(__dirname,'../.env') });
const fs   = require('fs');
const path = require('path');

const REPORT = path.join(__dirname, 'capture-report.json');
const ENV    = path.join(__dirname, '../.env');

if (!fs.existsSync(REPORT)) {
  console.log('❌ capture-report.json not found. Run: npm run capture\n');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));

// Get cookie from report
const sc = report.sessionCookie;
const cookieValue = sc?.value || '';

// Also check auth/session response for access_token
let accessToken = '';
for (const req of (report.afterGenerateRequests || [])) {
  if (req.url?.includes('auth/session') && req.responseBody) {
    try {
      const data = JSON.parse(req.responseBody);
      if (data?.access_token) { accessToken = data.access_token; break; }
    } catch {}
  }
}

console.log('\n╔══════════════════════════════════╗');
console.log('║   Refresh Cookie from Report      ║');
console.log('╚══════════════════════════════════╝\n');
console.log(`Report date: ${report.generatedAt}`);

if (cookieValue && cookieValue.length > 100) {
  let env = fs.readFileSync(ENV, 'utf8');
  const re = /^#?\s*FLOW_SESSION_COOKIE=.*$/m;
  if (re.test(env)) env = env.replace(re, `FLOW_SESSION_COOKIE=${cookieValue}`);
  else env = env.trimEnd() + `\nFLOW_SESSION_COOKIE=${cookieValue}\n`;
  fs.writeFileSync(ENV, env);
  console.log(`✅ Cookie updated (${cookieValue.length} chars)`);
} else {
  console.log('❌ No valid cookie found in report');
  console.log('   Run: npm run capture and log in again');
}

if (accessToken) {
  console.log(`✅ access_token found: ${accessToken.slice(0,40)}...`);
  console.log('   (Used automatically by flowProxy.js browser mode)');
}

console.log('\nNext: npm run test:cookie → npm start\n');
