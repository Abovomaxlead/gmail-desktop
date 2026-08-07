// Puts this machine's google-oauth.json where the build can pick it up, so the installer
// ships a working default and a fresh machine can link accounts without anyone copying a
// file into AppData first.
//
// Run before packaging: `npm run bundle:oauth-config`.
//
// The output is git-ignored and must stay that way. The repository is public, and a client
// secret committed to a public repository is found by credential scanners within a day;
// Google withdraws the client, linking breaks for every user at once, and deleting the file
// does not help because git history keeps it — recovery means a new client and fresh
// consent from everyone. In CI the release workflow writes the same file from a repository
// secret instead of running this script.
//
// Copies the file whole rather than picking out the two credential fields: relayUrl and
// pushTopic live in it too and are what make push notifications work, so a "helpful" subset
// would ship a build that links accounts and then never notifies about them.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const OUT = join(process.cwd(), 'assets', 'oauth-defaults.json');

function userDataConfigPath() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'gmail-desktop', 'google-oauth.json');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'gmail-desktop', 'google-oauth.json');
  }
  return join(homedir(), '.config', 'gmail-desktop', 'google-oauth.json');
}

const source = process.argv[2] ?? userDataConfigPath();

let text;
try {
  text = readFileSync(source, 'utf8');
} catch {
  console.error(`No OAuth config to bundle at:\n  ${source}\n`);
  console.error('Pass a path explicitly if it lives elsewhere:');
  console.error('  node scripts/bundle-oauth-config.mjs <path-to-google-oauth.json>\n');
  console.error('A build without it still works — the app then reports that the machine is');
  console.error('not set up and offers its import button.');
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(text);
} catch (e) {
  console.error(`${source} is not valid JSON: ${e.message}`);
  process.exit(1);
}

const missing = ['clientId', 'clientSecret'].filter(
  (k) => typeof parsed?.[k] !== 'string' || parsed[k].trim() === '',
);
if (missing.length > 0) {
  console.error(`${source} is missing: ${missing.join(', ')}`);
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, text, 'utf8');

const extras = Object.keys(parsed).filter((k) => k !== 'clientId' && k !== 'clientSecret');
console.log(`Bundled ${source}`);
console.log(`     -> ${OUT}`);
console.log(`   keys: clientId, clientSecret${extras.length ? ', ' + extras.join(', ') : ''}`);
if (!extras.includes('relayUrl') || !extras.includes('pushTopic')) {
  console.log('\n   Note: no relayUrl/pushTopic in this config, so the build ships without');
  console.log('   push settings and notifications will stay quiet.');
}
