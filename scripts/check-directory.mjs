// Is the Admin SDK Directory scope authorised, and does the subject have the rights to use
// it? Two questions that fail with the same word, asked apart.
//
// check-dwd.mjs cannot answer this. It probes for other scopes only when every required one
// fails, so on a healthy mail grant the directory scope is never tried — the run says
// "domain-wide delegation works" and tells you nothing about discovery.
//
// The distinction that matters here is between a scope that is not granted and a subject that
// is not an administrator, because the fixes are different people:
//
//   - the scope is missing        -> a super administrator edits the delegation entry
//   - the subject is not an admin -> pick another address, no console change needed
//
// Google answers `unauthorized_client` to the first and `403 Not Authorized` to the second,
// which is the one place it is helpfully specific. So this mints first (scope question) and
// then lists (rights question) and reports which step failed.
//
// Read-only. Nothing is logged that would leak the key: no assertion, no token.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/admin.directory.user.readonly';

const [keyPath, subject] = process.argv.slice(2);
if (!keyPath || !subject) {
  console.error('Usage: node scripts/check-directory.mjs <service-account-key.json> <admin@domain>');
  console.error('');
  console.error('The subject must be a person with administrator rights, not the service');
  console.error('account address: a service account has no standing in Workspace of its own.');
  process.exit(2);
}

let key;
try {
  key = JSON.parse(readFileSync(keyPath, 'utf8'));
} catch (e) {
  console.error(`Cannot read the key at ${keyPath}: ${e.message}`);
  process.exit(2);
}
if (key.type !== 'service_account' || !key.client_email || !key.private_key) {
  console.error('That file is not a service account key (needs type, client_email, private_key).');
  process.exit(2);
}

const domain = subject.includes('@') ? subject.split('@').pop() : '';
if (!domain) {
  console.error(`"${subject}" is not an email address.`);
  process.exit(2);
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const TOKEN_URI = key.token_uri ?? 'https://oauth2.googleapis.com/token';

console.log(`service account : ${key.client_email}`);
console.log(`client id       : ${key.client_id ?? '(not in the key file)'}`);
console.log(`impersonating   : ${subject}`);
console.log(`domain          : ${domain}`);
console.log(`scope           : ${SCOPE}\n`);

// 1. The scope question. Only this scope is asked for, deliberately: a mint that succeeds
// here proves the entry carries it, without the mail scopes masking the answer.
const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const payload = b64url(
  JSON.stringify({ iss: key.client_email, sub: subject, scope: SCOPE, aud: TOKEN_URI, iat: now, exp: now + 3600 }),
);
const signer = createSign('RSA-SHA256');
signer.update(`${header}.${payload}`);
const assertion = `${header}.${payload}.${b64url(signer.sign(key.private_key))}`;

let tokenRes;
try {
  tokenRes = await fetch(TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
} catch (e) {
  console.log(`mint  FAILED — unreachable: ${e.message}`);
  process.exit(1);
}
const tokenJson = await tokenRes.json().catch(() => ({}));

if (!tokenRes.ok) {
  const error = String(tokenJson.error ?? `HTTP ${tokenRes.status}`);
  console.log(`mint  FAILED — ${error}`);
  if (tokenJson.error_description) console.log(`        ${tokenJson.error_description}`);
  console.log('');
  console.log('RESULT: the directory scope is NOT authorised for this client id.');
  console.log('');
  console.log('A super administrator has to add it, in the Admin console:');
  console.log('  Security -> Access and data control -> API controls -> Manage Domain Wide Delegation');
  console.log('');
  console.log(`  Client ID:  ${key.client_id ?? '(read it from the key file)'}`);
  console.log('');
  console.log('  Add this scope to the SAME entry, keeping the ones already there. That field is');
  console.log('  one comma separated list, and replacing it revokes mail access — copying into a');
  console.log('  delegated mailbox would stop working with nothing to say why:');
  console.log(`  ${SCOPE}`);
  console.log('');
  console.log('If it was added a moment ago, this is propagation: try again in a few minutes.');
  process.exit(1);
}
console.log('mint with the directory scope   OK');

// 2. The rights question. The scope only says the token may ask; whether this person may
// read the directory is a Workspace role, and Google is specific about that one.
const url = new URL('https://admin.googleapis.com/admin/directory/v1/users');
url.searchParams.set('domain', domain);
url.searchParams.set('maxResults', '1');
url.searchParams.set('projection', 'basic');

const listRes = await fetch(url, { headers: { Authorization: `Bearer ${tokenJson.access_token}` } });
const listJson = await listRes.json().catch(() => ({}));

if (!listRes.ok) {
  const message = String(listJson?.error?.message ?? `HTTP ${listRes.status}`);
  console.log(`users.list                      FAILED — ${message}`);
  console.log('');

  // Two very different 403s, and the fix belongs to different people. Told apart on the
  // message because the status code cannot: a disabled API and a subject without the role
  // both answer 403, and advising a Workspace role change for a Cloud project problem sends
  // someone to an admin console where there is nothing to fix.
  const disabled = /has not been used in project|is disabled|SERVICE_DISABLED/i.test(message);
  if (disabled) {
    const project = message.match(/project (\d+)/)?.[1] ?? key.project_id ?? '<project>';
    console.log('RESULT: the delegation is fine — the Admin SDK API is off in the Cloud project.');
    console.log('');
    console.log('Nothing to change in the Workspace admin console: the scope minted and the');
    console.log('subject was accepted. The call never reached Directory, because the API it');
    console.log(`lives in is not enabled in project ${project}.`);
    console.log('');
    console.log('Enable it (needs a project owner or editor):');
    console.log(`  gcloud services enable admin.googleapis.com --project=${key.project_id ?? project}`);
    console.log('');
    console.log('or in the console:');
    console.log(`  https://console.developers.google.com/apis/api/admin.googleapis.com/overview?project=${project}`);
    console.log('');
    console.log('Then wait a minute for it to propagate and run this again.');
    process.exit(1);
  }

  console.log('RESULT: the scope is authorised, but this subject cannot read the directory.');
  console.log('');
  console.log(`Give ${subject} a role with the "Users -> Read" privilege, or use an address that`);
  console.log('already has one. No change to the delegation entry is needed — that part works.');
  process.exit(1);
}

const users = Array.isArray(listJson.users) ? listJson.users : [];
console.log(`users.list                      OK (${users.length} of ${domain} read back)`);
console.log('');
console.log('RESULT: delegated discovery can run.');
console.log('');
console.log('Set this in the relay\'s .env and restart it:');
console.log(`  DELEGATED_ADMIN_SUBJECT=${subject}`);
