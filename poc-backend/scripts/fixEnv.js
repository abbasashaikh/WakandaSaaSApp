// scripts/fixEnv.js
// Resets TRPC_IMAGE_PROC to UNKNOWN if it was set to a bad value
// Run: node scripts/fixEnv.js
const fs   = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '../.env');

// Known bad values that testApiMode incorrectly wrote
const BAD_VALUES = [
  'general.submitBatchLog',
  'general.reportClientSideError',
  'general.fetchUserAcknowledgement',
  'general.fetchUserLocale',
  'media.fetchMedia',
  'general.trackEvent',
];

if (!fs.existsSync(ENV_PATH)) {
  console.log('No .env file found.');
  process.exit(0);
}

let content = fs.readFileSync(ENV_PATH, 'utf8');
let changed = false;

for (const bad of BAD_VALUES) {
  const re = new RegExp(`^(TRPC_IMAGE_PROC|TRPC_VIDEO_PROC)=${bad.replace('.', '\\.')}$`, 'm');
  if (re.test(content)) {
    const key = content.match(re)[1];
    content = content.replace(re, `# ${key}=NEEDS_TO_BE_SET  ← run investigateFlow.js to find this`);
    console.log(`✅ Removed bad value: ${key}=${bad}`);
    changed = true;
  }
}

if (changed) {
  fs.writeFileSync(ENV_PATH, content);
  console.log('\n✅ .env cleaned up.');
  console.log('\nNext step: Run the investigation script to find the real endpoint:');
  console.log('  node scripts/investigateFlow.js');
  console.log('  → Log in, type a prompt, click Generate, wait for the image');
} else {
  console.log('No bad values found in .env.');
}

// Also show current relevant .env values
console.log('\nCurrent .env values:');
const lines = content.split('\n').filter(l =>
  l.startsWith('FLOW_MODE') ||
  l.startsWith('FLOW_SESSION_COOKIE') ||
  l.startsWith('TRPC_IMAGE') ||
  l.startsWith('TRPC_VIDEO')
);
lines.forEach(l => {
  if (l.includes('SESSION_COOKIE')) {
    const parts = l.split('=');
    const val = parts.slice(1).join('=');
    console.log(`  ${parts[0]}=${val ? val.slice(0, 20) + '... (' + val.length + ' chars)' : '(empty)'}`);
  } else {
    console.log(`  ${l}`);
  }
});
