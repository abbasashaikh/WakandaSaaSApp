// scripts/checkEnv.js — Diagnose and fix .env before starting server
const fs   = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '../.env');

if (!fs.existsSync(ENV_PATH)) {
  console.log('❌ .env file not found.');
  console.log('   Copy .env.example to .env and fill in FLOW_SESSION_COOKIE');
  process.exit(1);
}

const lines   = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
const content = fs.readFileSync(ENV_PATH, 'utf8');

console.log('\n╔══════════════════════════════════════╗');
console.log('║   .env Diagnostic + Fix Tool         ║');
console.log('╚══════════════════════════════════════╝\n');

// Check for duplicates
const flowModeLines = lines
  .map((l, i) => ({ line: i+1, text: l }))
  .filter(l => l.text.match(/^FLOW_MODE\s*=/));

const cookieLines = lines
  .map((l, i) => ({ line: i+1, text: l }))
  .filter(l => l.text.match(/^FLOW_SESSION_COOKIE\s*=/));

console.log('FLOW_MODE entries found:');
flowModeLines.forEach(l => console.log(`  Line ${l.line}: ${l.text}`));
if (flowModeLines.length > 1) {
  console.log('  ⚠️  DUPLICATE ENTRIES — dotenv uses the FIRST one!');
} else if (flowModeLines.length === 0) {
  console.log('  ❌ No FLOW_MODE found — will default to mock');
}

console.log('\nFLOW_SESSION_COOKIE entries:');
cookieLines.forEach(l => {
  const val = l.text.split('=').slice(1).join('=');
  if (!val || val.length < 100) {
    console.log(`  Line ${l.line}: ❌ EMPTY or too short (${val.length} chars)`);
  } else {
    console.log(`  Line ${l.line}: ✅ ${val.slice(0,30)}... (${val.length} chars)`);
  }
});

// Fix duplicates and set browser mode
let fixed = content;

// Remove ALL FLOW_MODE lines
fixed = fixed.split('\n')
  .filter(l => !l.match(/^FLOW_MODE\s*=/))
  .join('\n');

// Add single FLOW_MODE=browser after PORT line
fixed = fixed.replace(
  /^(PORT=.+)$/m,
  '$1\nFLOW_MODE=browser'
);

// If PORT not found, prepend
if (!fixed.includes('FLOW_MODE=')) {
  fixed = 'FLOW_MODE=browser\n' + fixed;
}

fs.writeFileSync(ENV_PATH, fixed);
console.log('\n✅ Fixed: single FLOW_MODE=browser written to .env\n');

// Verify
const verify = fs.readFileSync(ENV_PATH, 'utf8');
const modeMatch = verify.match(/^FLOW_MODE=(.+)$/m);
const cookieMatch = verify.match(/^FLOW_SESSION_COOKIE=(.+)$/m);
const cookieVal = cookieMatch ? cookieMatch[1].trim() : '';

console.log('VERIFIED .env:');
console.log(`  FLOW_MODE     = ${modeMatch ? modeMatch[1] : 'NOT FOUND'}`);
console.log(`  SESSION_COOKIE= ${cookieVal ? cookieVal.slice(0,30)+'... ('+cookieVal.length+' chars)' : 'EMPTY'}`);

if (!cookieVal || cookieVal.length < 100) {
  console.log('\n❌ FLOW_SESSION_COOKIE is empty!');
  console.log('   Run: npm run capture — log in and generate to save cookie\n');
  process.exit(1);
}

console.log('\n✅ .env is correct. Now run:\n');
console.log('   npm start\n');
console.log('   Expected startup:');
console.log('   [FlowProxy] Mode: BROWSER');
console.log('   [FlowProxy:BROWSER] ✅ Cookie valid — mrabsshk@gmail.com');
console.log('   [FlowProxy:BROWSER] ✅ Ready\n');
